/**
 * 局内拐力统一收集
 *
 * 所有“进战斗后给全队/队友”的拐力集中在这里收集：
 *   - 角色 teammate-buffs（核心被动、额外能力、命座拐）
 *   - 音擎 teamBuff
 *   - 驱动盘 4 件套 teamBuff
 *
 * 统一输出成 TeammateBuff 结构，由 buff.ts 的 collectTeammateBuffs 应用到每个目标。
 * 已并入装备者自身 buff 收集的来源（如音擎团队效果）传播时用 excludeTargetAgentIds 排除装备者，避免重复；
 * 不设 excludeTargetAgentIds 即装备者本人同样吃到（角色队友 buff、驱动盘 4 件套 teamBuff）。
 * （原 `includeOwner` 布尔标签从无读取方，是上述行为的冗余描述，第 213 轮 CC-190 删除——
 *   只改标签而不设 excludeTargetAgentIds 不会有任何效果，留着会误导。）
 */
import type {
  Agent, WEngine, DriveDiscSet, DriveDiscConfig, TeammateBuff, TeammateBuffGroup,
} from '@/types/catalog'
import { applyWEngineModLevel, discRequirementMet, resolveDiscStatTemplate } from './buff'
import type { SourcePanelsByOwner } from './buff'
import { wEngineConditionMet, wEngineEffectRequirementMet } from './wengineConditions'

import { localized } from '@/utils/format'
export type InCombatTeamBuff = TeammateBuff

export interface InCombatBuffSourceDeps {
  teammateBuffGroups: TeammateBuffGroup[]
  driveDiscSetsMap: Map<string, DriveDiscSet>
  getAgent(id: string): Agent | undefined
  getWEngine(id: string): WEngine | undefined
  isTeammateBuffEnabled(id: string): boolean
  /** 各成员源面板（outOfCombat），供驱动盘 teamBuff 的装备者属性门槛判断（如山大王暴击率≥50%） */
  wearerPanels?: SourcePanelsByOwner
  /** 当前敌人弱点。缺省 = 不拦截 attributeCounter（未选 Boss）。 */
  enemyWeakness?: readonly string[]
}

export interface InCombatBuffTeamMember {
  agentId: string
  wEngineId?: string
  wEngineModLevel?: number
  driveDisc: DriveDiscConfig
  cinemaLevel: number
}

export function collectInCombatTeamBuffs(
  team: InCombatBuffTeamMember[],
  deps: InCombatBuffSourceDeps,
): InCombatTeamBuff[] {
  const buffs: InCombatTeamBuff[] = []

  // 角色队友拐：按用户在属性配置页的启用状态。
  // 先收集后应用修饰器，保证修饰器与目标在数据中的顺序无关。
  // `singleSourced`（原字段名 `hidden`，2026-09-20 R65 改名）条**不进数值通道**：
  // 其数值由角色模块/helpers 单通道接入，此处过滤是防「同一效果算两遍」。
  // ⚠ 该字段与 UI 可见性**无关** —— 渲染面不读它，可交互性由 src/utils/teammateBuffRows.ts 派生。
  // r411（CC-385）：**队友 buff 只来自在队拥有者**（组 id = 拥有者 agentId，CC-275 归一；45 组全部是角色 id）。
  // 此前引擎完全依赖 store `syncTeammateBuffsFromTeam` 把不在队拥有者的勾选关掉——残留勾选（存档恢复 / defer /
  // 独立调用方）会直接进面板（探针：不在队拥有者 132 条全勾时 95 条漏进）。规则下沉到这个唯一收集入口。
  const owners = new Set(team.map(member => member.agentId).filter(Boolean))
  const enabledAgentBuffs = deps.teammateBuffGroups.filter(group => owners.has(group.id)).flatMap(group =>
    (group.buffs ?? []).filter(buff => buff.singleSourced !== true && deps.isTeammateBuffEnabled(buff.id)),
  )
  // 收集所有已启用 buff 上的 multiplyResolvedValue 修饰器（丽娜C1 / 莱特C2 等）
  const modifiers = enabledAgentBuffs.flatMap(buff => buff.buffModifiers ?? [])
  for (const buff of enabledAgentBuffs) {
    const effects = (buff.effects ?? []).map(effect => {
      let resolved = effect
      for (const modifier of modifiers) {
        if (modifier.operation !== 'multiplyResolvedValue') continue
        if (!(modifier.targetBuffIds ?? []).includes(buff.id)) continue
        if (modifier.targetEffectIds?.length && !modifier.targetEffectIds.includes(effect.id)) continue
        const factor = Number(modifier.factor)
        if (!Number.isFinite(factor)) continue
        if (resolved.type === 'formula') {
          resolved = {
            ...resolved,
            formula: {
              ...resolved.formula,
              expression: `(${resolved.formula?.expression ?? '0'}) * ${factor}`,
            },
          }
        } else if (resolved.type === 'derived') {
          // cap 与 ratio 同源放大（如潘引壶6命：比例18%→24%，上限540→720）
          resolved = {
            ...resolved,
            ratio: (resolved.ratio ?? 0) * factor,
            cap: resolved.cap == null ? undefined : resolved.cap * factor,
          }
        } else if (resolved.type === 'stacked') {
          resolved = {
            ...resolved,
            value: (resolved.value ?? 0) * factor,
            valuePerStack: resolved.valuePerStack == null ? undefined : resolved.valuePerStack * factor,
          }
        } else {
          resolved = { ...resolved, value: (resolved.value ?? 0) * factor }
        }
      }
      return resolved
    })
    buffs.push({ ...buff, effects })
  }

  // CC-101（R5 D8）：已发放的 exclusiveGroup。同组全队效果只计一次（先到先得：按槽位顺序，
  // 取第一个通过门槛的穿戴者）。只对数据显式标了 exclusiveGroup 的组生效，不推断其他套装互斥。
  const grantedExclusiveGroups = new Set<string>()

  for (const char of team) {
    if (!char?.agentId) continue
    const agent = deps.getAgent(char.agentId)
    if (!agent) continue
    const aliases = [agent.id]

    // 音擎团队效果：装备者已通过自身 buff 收集，传播时排除装备者
    if (char.wEngineId) {
      const wEngine = deps.getWEngine(char.wEngineId)
      const group = wEngine?.effect?.teamBuff
      if (
        wEngine && group?.effects?.length
        // CC-110（R5 身份类 specialty）：特化不符的装备者不发动音擎效果——与自身通路
        // `collectAllBuffs` 的 `matchSpecialty` 同口径（数据 `effect.requirement.specialty` / 游戏规则）。
        // 此前团队通路漏了这道门，特化不符时队友照吃团队效果。
        && wEngine.specialty === agent.specialty
        && wEngineConditionMet(group.condition, {
          wearerAttribute: agent.attribute,
          enemyWeakness: deps.enemyWeakness,
        })
      ) {
        buffs.push({
          id: `wengine-team-${wEngine.id}`,
          source: { zhCN: '音擎' },
          description: group.description ?? wEngine.effect?.description,
          scope: group.scope,
          effects: group.effects
            .filter(e => e && e.stat && wEngineEffectRequirementMet(e.requirement, { wearerAttribute: agent.attribute, wearerSpecialty: agent.specialty, wearerAgentId: agent.id }))
            .map(e => applyWEngineModLevel(e, char.wEngineModLevel ?? 1)),
          buffModifiers: group.buffModifiers ?? [],
          sourceType: 'teammate',
          sourceCategory: 'wEngine',
          sourceKind: 'team',
          sourceLabel: { zhCN: `音擎团队效果（${localized(wEngine.name, wEngine.id)}）` },
          ownerId: agent.id,
          ownerName: agent.name,
          teammateId: agent.id,
          teammateName: agent.name,
          excludeTargetAgentIds: aliases,
        })
      }
    }

    // 驱动盘 4 件套团队效果：装备者自身收集不含 teamBuff，需要包含装备者。
    // 装备者不满足门槛（特化/属性/局外面板）时整组不传播。
    if (char.driveDisc?.fourPieceSetId) {
      const set = deps.driveDiscSetsMap.get(char.driveDisc.fourPieceSetId)
      const group = set?.fourPiece?.teamBuff
      const wearerPanel = aliases.map(a => deps.wearerPanels?.[a]?.outOfCombat).find(p => p != null)
      if (set && group?.effects?.length && discRequirementMet(group.requirement, agent, wearerPanel)) {
        const effects = group.effects
          .filter(e => e && e.stat && discRequirementMet(e.requirement, agent, wearerPanel))
          // {attribute} 模板按【装备者】属性落键（自由蓝调 4pc：挂在敌人身上 8s，
          // 全队同属性积蓄都吃到——苍角装备时队友的冰系积蓄同样受益），不能按受益者属性解析
          .map(e => resolveDiscStatTemplate(e, agent.attribute))
        const exclusive = group.exclusiveGroup
        if (effects.length && !(exclusive && grantedExclusiveGroups.has(exclusive))) {
          if (exclusive) grantedExclusiveGroups.add(exclusive)
          buffs.push({
            id: `drivedisc-team-${set.id}`,
            source: { zhCN: '驱动盘' },
            description: group.description ?? set.fourPiece?.effectText,
            scope: group.scope,
            effects,
            buffModifiers: group.buffModifiers ?? [],
            sourceType: 'teammate',
            sourceCategory: 'driveDisc',
            sourceKind: 'team',
            sourceLabel: { zhCN: `驱动盘团队效果（${localized(set.name, set.id)}）` },
            ownerId: agent.id,
            ownerName: agent.name,
            teammateId: agent.id,
            teammateName: agent.name,
          })
        }
      }
    }
  }

  return buffs
}
