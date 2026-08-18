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
} from '@/types/catalog'
import { applyWEngineModLevel } from './buff'

export interface InCombatTeamBuff extends TeammateBuff {
  includeOwner: boolean
}

export interface InCombatBuffSourceDeps {
  teammateBuffGroups: TeammateBuffGroup[]
  driveDiscSetsMap: Map<string, DriveDiscSet>
  getAgent(id: string): Agent | undefined
  getWEngine(id: string): WEngine | undefined
  isTeammateBuffEnabled(id: string): boolean
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

export function collectInCombatTeamBuffs(
  team: InCombatBuffTeamMember[],
  deps: InCombatBuffSourceDeps,
): InCombatTeamBuff[] {
  const buffs: InCombatTeamBuff[] = []

  // 角色队友拐：按用户在属性配置页的启用状态。
  // 先收集后应用修饰器，保证修饰器与目标在数据中的顺序无关。
  const enabledAgentBuffs = deps.teammateBuffGroups.flatMap(group =>
    (group.buffs ?? []).filter(buff => deps.isTeammateBuffEnabled(buff.id)),
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
          resolved = { ...resolved, ratio: (resolved.ratio ?? 0) * factor }
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

  for (const char of team) {
    if (!char?.agentId) continue
    const agent = deps.getAgent(char.agentId)
    if (!agent) continue
    const aliases = ownerAliases(agent)

    // 音擎团队效果：装备者已通过自身 buff 收集，传播时排除装备者
    if (char.wEngineId) {
      const wEngine = deps.getWEngine(char.wEngineId)
      const group = wEngine?.effect?.teamBuff
      if (wEngine && group?.effects?.length) {
        buffs.push({
          id: `wengine-team-${wEngine.id}`,
          source: { zhCN: '音擎' },
          description: group.description ?? wEngine.effect?.description,
          scope: group.scope,
          effects: group.effects.filter(e => e && e.stat).map(e => applyWEngineModLevel(e, char.wEngineModLevel ?? 1)),
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

    // 驱动盘 4 件套团队效果：装备者自身收集不含 teamBuff，需要包含装备者
    if (char.driveDisc?.fourPieceSetId) {
      const set = deps.driveDiscSetsMap.get(char.driveDisc.fourPieceSetId)
      const group = set?.fourPiece?.teamBuff
      if (set && group?.effects?.length) {
        buffs.push({
          id: `drivedisc-team-${set.id}`,
          source: { zhCN: '驱动盘' },
          description: group.description ?? set.fourPiece?.effectText,
          scope: group.scope,
          effects: group.effects.filter(e => e && e.stat),
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

  return buffs
}
