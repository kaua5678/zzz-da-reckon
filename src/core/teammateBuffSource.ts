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

function addSourcePanelAliases(
  map: SourcePanelsByOwner,
  agent: Agent,
  panels: { outOfCombat: PanelValues; inCombat: PanelValues },
): void {
  map[agent.id] = panels
  if (agent.teammateBuffId) map[agent.teammateBuffId] = panels
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
    })
  }

  const enabledTeammateBuffs: TeammateBuff[] = collectInCombatTeamBuffs(team, {
    ...deps,
    wearerPanels: sourcePanelsByOwner,
  })

  return { enabledTeammateBuffs, sourcePanelsByOwner }
}
