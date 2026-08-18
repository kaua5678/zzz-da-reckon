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
}

export interface TeammateBuffSourceDeps {
  teammateBuffGroups: TeammateBuffGroup[]
  driveDiscSetsMap: Map<string, DriveDiscSet>
  statRules: StatRules | null
  getAgent: (id: string) => Agent | undefined
  getWEngine: (id: string) => WEngine | undefined
  isTeammateBuffEnabled: (id: string) => boolean
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
      },
    )
    addSourcePanelAliases(sourcePanelsByOwner, agent, {
      outOfCombat: result.outOfCombat,
      inCombat: result.inCombat,
    })
  }

  const enabledTeammateBuffs: TeammateBuff[] = collectInCombatTeamBuffs(team, deps)

  return { enabledTeammateBuffs, sourcePanelsByOwner }
}
