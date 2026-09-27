/**
 * 局内拐力统一收集
 *
 * 所有“进战斗后给全队/队友”的拐力集中在这里收集：
 *   - 角色 teammate-buffs（核心被动、额外能力、命座拐）
 *   - 音擎 teamBuff
 *   - 驱动盘 4 件套 teamBuff
 *
 * 统一输出成 TeammateBuff 结构，由 buff.ts 的 collectTeammateBuffs 应用到每个目标。
 * includeOwner=false 表示该来源已并入装备者自身的 buff 收集（如音擎团队效果），
 * 传播时用 excludeTargetAgentIds 排除装备者，避免重复。
 */
import type {
  Agent, WEngine, DriveDiscSet, DriveDiscConfig, TeammateBuff, TeammateBuffGroup,
  EffectRequirement, PanelValues, StatId,
} from '@/types/catalog'
import { applyWEngineModLevel, parseStatRequirement, resolveAttributeTemplateStat } from './buff'
import type { SourcePanelsByOwner } from './buff'
import { wEngineConditionMet, wEngineEffectRequirementMet } from './wengineConditions'

export interface InCombatTeamBuff extends TeammateBuff {
  includeOwner: boolean
}

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

function ownerAliases(agent: Agent): string[] {
  return [agent.id, agent.teammateBuffId].filter((x): x is string => !!x)
}

/**
 * 驱动盘 teamBuff 门槛：装备者特化/属性 + 局外面板属性（装备者源面板已算好，用精确值；面板缺失时门槛按不满足处理）。
 * selfBuff 侧自 CC-108（R5 D26）起也读精确局外面板（`calcPanel` 两段式），两侧口径相同。
 */
function discTeamRequirementMet(
  req: EffectRequirement | undefined,
  agent: Agent,
  wearerPanel: PanelValues | undefined,
): boolean {
  if (!req) return true
  if (req.specialty && agent.specialty !== req.specialty) return false
  if (req.attribute && agent.attribute !== req.attribute) return false
  const statReq = parseStatRequirement(req.outOfCombatStat)
  if (statReq) {
    const value = wearerPanel ? (wearerPanel[statReq.stat as StatId] ?? 0) : undefined
    if (value == null || value < statReq.min) return false
  }
  return true
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
  const enabledAgentBuffs = deps.teammateBuffGroups.flatMap(group =>
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
    buffs.push({ ...buff, effects, includeOwner: true })
  }

  // CC-101（R5 D8）：已发放的 exclusiveGroup。同组全队效果只计一次（先到先得：按槽位顺序，
  // 取第一个通过门槛的穿戴者）。只对数据显式标了 exclusiveGroup 的组生效，不推断其他套装互斥。
  const grantedExclusiveGroups = new Set<string>()

  for (const char of team) {
    if (!char?.agentId) continue
    const agent = deps.getAgent(char.agentId)
    if (!agent) continue
    const aliases = ownerAliases(agent)

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
          sourceLabel: { zhCN: `音擎团队效果（${wEngine.name?.zhCN ?? wEngine.id}）` },
          ownerId: agent.id,
          ownerName: agent.name,
          teammateId: agent.teammateBuffId ?? agent.id,
          teammateName: agent.name,
          excludeTargetAgentIds: aliases,
          includeOwner: false,
        } as InCombatTeamBuff)
      }
    }

    // 驱动盘 4 件套团队效果：装备者自身收集不含 teamBuff，需要包含装备者。
    // 装备者不满足门槛（特化/属性/局外面板）时整组不传播。
    if (char.driveDisc?.fourPieceSetId) {
      const set = deps.driveDiscSetsMap.get(char.driveDisc.fourPieceSetId)
      const group = set?.fourPiece?.teamBuff
      const wearerPanel = aliases.map(a => deps.wearerPanels?.[a]?.outOfCombat).find(p => p != null)
      if (set && group?.effects?.length && discTeamRequirementMet(group.requirement, agent, wearerPanel)) {
        const effects = group.effects
          .filter(e => e && e.stat && discTeamRequirementMet(e.requirement, agent, wearerPanel))
          // {attribute} 模板按【装备者】属性落键（自由蓝调 4pc：挂在敌人身上 8s，
          // 全队同属性积蓄都吃到——苍角装备时队友的冰系积蓄同样受益），不能按受益者属性解析
          .map(e => (e.stat as string).includes('{attribute}')
            ? { ...e, stat: resolveAttributeTemplateStat(e.stat as string, agent.attribute) }
            : e)
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
            sourceLabel: { zhCN: `驱动盘团队效果（${set.name?.zhCN ?? set.id}）` },
            ownerId: agent.id,
            ownerName: agent.name,
            teammateId: agent.teammateBuffId ?? agent.id,
            teammateName: agent.name,
            includeOwner: true,
          } as InCombatTeamBuff)
        }
      }
    }
  }

  return buffs
}
