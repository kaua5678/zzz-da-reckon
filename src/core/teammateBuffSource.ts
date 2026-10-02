import { calcPanel } from './panel'
import { collectInCombatTeamBuffs } from './inCombatBuffs'
import type {
  Agent, WEngine, DriveDiscConfig, DriveDiscSet, PanelValues,
  StatRules, TeammateBuff, TeammateBuffGroup,
} from '@/types/catalog'
import type { SourcePanelsByOwner } from './buff'

export interface TeamMemberPanelConfig {
  agentId: string
  wEngineId?: string
  driveDisc: DriveDiscConfig
  cinemaLevel: number
  wEngineModLevel: number
  potentialLevel?: number
}

export interface TeammateBuffSourceDeps {
  teammateBuffGroups: TeammateBuffGroup[]
  driveDiscSetsMap: Map<string, DriveDiscSet>
  statRules: StatRules | null
  getAgent: (id: string) => Agent | undefined
  getWEngine: (id: string) => WEngine | undefined
  isTeammateBuffEnabled: (id: string) => boolean
  /** 当前敌人弱点。缺省 = 不拦截 attributeCounter。 */
  enemyWeakness?: readonly string[]
  /**
   * 来源角色**自身**条件效果（音擎 / 驱动盘）的覆盖率表（effectId → 0..1）。CC-172（第 197 轮）：
   * 此前来源面板不传 ⇒ 自身条件效果按 100% 算，与该角色自己槽位的面板（按覆盖率算）口径分裂。
   * 缺省 = 全 100%（与旧行为相同；store 层整队贪心仍不传）。
   */
  effectCoverageMap?: Map<string, number>
}

export interface TeammateBuffSourceContext {
  enabledTeammateBuffs: TeammateBuff[]
  sourcePanelsByOwner: SourcePanelsByOwner
}

/**
 * 把 agent.id 的面板挂进 sourcePanelsByOwner，并补**别名键**。
 *
 * 为什么要有别名：catalog `teammate-buffs.json` 里 5 个角色的 buff `ownerId` 写的是
 * **英文 slug**（youye/remielle/nangongyu/burnice_white/jane_doe）而不是数字 agentId。
 * 虽然 `mergeSpecTeamBuffs`（stores/catalog）在加载时已把 ownerId 归一到组 id，
 * 但 spec `teamBuffs` 侧的 `specTeamBuffToTeammateBuff` 转换产物**不经过**那一步归一
 * （spec 侧 ownerId 由转换器生成，可能仍是 slug 或拼音）⇒ 防御性保留别名通道。
 *
 * 别名键来源：teammateBuffGroups 里该组所有 buff 的 `ownerId`/`teammateId` 并集
 * （数字 id 自身由 `map[agent.id]` 覆盖，slug 别名只是补充）。
 */
function addSourcePanelAliases(
  map: SourcePanelsByOwner,
  agent: Agent,
  panels: { outOfCombat: PanelValues; inCombat: PanelValues },
  aliasKeys: readonly string[] = [],
): void {
  map[agent.id] = panels
  for (const key of aliasKeys) map[key] = panels
}

/**
 * 为队友 buff 准备来源角色自己的局外/局内面板。
 * 来源面板只计算角色自身配置、音擎、驱动盘、自身 buff，不再带队友 buff，避免转模互相递归。
 */
export function buildTeammateBuffSourceContext(
  team: TeamMemberPanelConfig[],
  deps: TeammateBuffSourceDeps,
): TeammateBuffSourceContext {
  const sourcePanelsByOwner: SourcePanelsByOwner = {}

  // 一次性扫全库 buff，建「数字 agentId → slug 别名键」表
  // （teammate-buffs.json 的 ownerId/teammateId 里混着英文 slug，见 addSourcePanelAliases 头注）
  const aliasByAgentId = new Map<string, string[]>()
  for (const group of deps.teammateBuffGroups) {
    for (const buff of group.buffs ?? []) {
      for (const key of [buff.ownerId, buff.teammateId]) {
        if (!key || /^\d+$/.test(key)) continue // 纯数字 = agentId，不是别名
        const list = aliasByAgentId.get(group.id) ?? []
        if (!list.includes(key)) list.push(key)
        aliasByAgentId.set(group.id, list)
      }
    }
  }

  for (const char of team) {
    if (!char?.agentId) continue
    const agent = deps.getAgent(char.agentId)
    if (!agent) continue
    const wEngine = char.wEngineId ? deps.getWEngine(char.wEngineId) : undefined
    const result = calcPanel(
      agent,
      wEngine,
      char.driveDisc,
      deps.driveDiscSetsMap,
      [],
      deps.statRules,
      {
        cinemaLevel: char.cinemaLevel,
        wEngineModLevel: char.wEngineModLevel,
        potentialLevel: char.potentialLevel,
        enemyWeakness: deps.enemyWeakness,
        effectCoverageMap: deps.effectCoverageMap,
      },
    )
    addSourcePanelAliases(sourcePanelsByOwner, agent, {
      outOfCombat: result.outOfCombat,
      inCombat: result.inCombat,
    }, aliasByAgentId.get(agent.id))
  }

  const enabledTeammateBuffs: TeammateBuff[] = collectInCombatTeamBuffs(team, {
    ...deps,
    wearerPanels: sourcePanelsByOwner,
  })

  return { enabledTeammateBuffs, sourcePanelsByOwner }
}
