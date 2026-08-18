import type {
  AgentMechanicModule,
  AgentResourceInput,
  AgentResourceResultInput,
  AgentResourceSectionsInput,
  AgentSkillTransformInput,
} from '../types'
import type { PanelValues } from '@/types/catalog'
import { getAgentSpec } from '@/specs/registry'
import { computeSpecResources, type SpecResourceResult } from '@/specs/resources'
import { specToMechanicModule } from '@/specs/mechanics'

function buildResourceResult(agentId: string) {
  return ({ cfg, state }: AgentResourceResultInput) => ({
    specResources: (() => {
      const spec = getAgentSpec(agentId)
      return spec ? Object.fromEntries(computeSpecResources(spec, cfg, state)) : {}
    })(),
  })
}

function makePanelBuffModule(
  id: string,
  agentIds: string[],
  name: string,
  resourceId: string,
  apply: (resource: SpecResourceResult | undefined, panel: PanelValues) => void,
): AgentMechanicModule {
  const transform = (input: AgentSkillTransformInput) => {
    const panel = input.panel
    if (!panel) return
    if ((panel as any).__specPanelBuffApplied) return
    ;(panel as any).__specPanelBuffApplied = true
    const map = input.charResult.specResources ?? {}
    apply(map[resourceId], panel)
  }
  return {
    id,
    agentIds,
    name,
    buildResourceResult: buildResourceResult(agentIds[0]),
    transformSkillExecutions: transform,
    resourceSections: (input: AgentResourceSectionsInput) => {
      const spec = getAgentSpec(agentIds[0])
      return spec ? specToMechanicModule(spec).resourceSections?.(input) ?? [] : []
    },
  }
}

function stackCount(resource: SpecResourceResult | undefined): number {
  const total = Math.floor(resource?.total ?? 0)
  const cap = resource?.maxValue
  return cap == null ? total : Math.min(total, Math.floor(cap))
}

export const piperMomentumMechanic = makePanelBuffModule(
  'agent:piper_momentum',
  ['1281'],
  '派派·动力',
  'piper_momentum',
  (resource, panel) => {
    const stacks = stackCount(resource)
    panel.physicalAnomalyBuildUpEfficiency = (panel.physicalAnomalyBuildUpEfficiency ?? 0) + stacks * 4
    if (stacks >= 20) panel.dmgBonus = (panel.dmgBonus ?? 0) + 18
  },
)

export const hugoAbyssEchoMechanic = makePanelBuffModule(
  'agent:hugo_abyss_echo',
  ['1291'],
  '雨果·暗渊回响',
  'hugo_abyss_echo',
  (resource, panel) => {
    if ((resource?.total ?? 0) > 0) {
      panel.critRate = (panel.critRate ?? 0) + 12
      panel.critDmg = (panel.critDmg ?? 0) + 25
    }
  },
)

export const pulchraHuntStepMechanic = makePanelBuffModule(
  'agent:pulchra_hunt_step',
  ['1351'],
  '波可娜·猎步',
  'pulchra_hunt_step',
  (resource, panel) => {
    if ((resource?.total ?? 0) > 0) {
      panel.stunBuildUpBonus = (panel.stunBuildUpBonus ?? 0) + 30
    }
  },
)

export const billyHitStacksMechanic = makePanelBuffModule(
  'agent:billy_hit_stacks',
  ['1081'],
  '比利·命中层数',
  'billy_hit_stacks',
  (resource, panel) => {
    const stacks = stackCount(resource)
    panel.dmgBonus = (panel.dmgBonus ?? 0) + stacks * 6
  },
)

export const benGuardShieldMechanic = makePanelBuffModule(
  'agent:ben_guard_shield',
  ['1121'],
  '本·守卫护盾',
  'ben_guard_shield',
  (resource, panel) => {
    if ((resource?.total ?? 0) > 0) {
      panel.critRate = (panel.critRate ?? 0) + 16
    }
  },
)

export const nekomataPurrMechanic = makePanelBuffModule(
  'agent:nekomata_purr',
  ['1021'],
  '猫又·呼噜能量',
  'nekomata_purr',
  (resource, panel) => {
    if ((resource?.total ?? 0) > 0) {
      panel.dmgBonus = (panel.dmgBonus ?? 0) + 60
    }
  },
)

export const ellenFrostChargeMechanic = makePanelBuffModule(
  'agent:ellen_frost_charge',
  ['1191'],
  '艾莲·急冻充能',
  'ellen_frost_charge',
  (resource, panel) => {
    if ((resource?.total ?? 0) > 0) {
      panel.critDmg = (panel.critDmg ?? 0) + 100
    }
  },
)

export const harumasaEdgeMechanic = makePanelBuffModule(
  'agent:harumasa_edge',
  ['1201'],
  '悠真·锋芒',
  'harumasa_edge',
  (resource, panel) => {
    const stacks = stackCount(resource)
    panel.critDmg = (panel.critDmg ?? 0) + stacks * 12
  },
)

export const sigridLanceMechanic = makePanelBuffModule(
  'agent:sigrid_lance',
  ['1591'],
  '希格莉德·敛枪式',
  'sigrid_lance_opportunity',
  (resource, panel) => {
    if ((resource?.total ?? 0) > 0) {
      panel.critRate = (panel.critRate ?? 0) + 66
    }
  },
)

export const koledaFurnaceMechanic = makePanelBuffModule(
  'agent:koleda_furnace',
  ['1101'],
  '珂蕾妲·熔炉升温',
  'koleda_furnace',
  (resource, panel) => {
    if ((resource?.total ?? 0) > 0) {
      panel.dmgBonus = (panel.dmgBonus ?? 0) + 25
    }
  },
)

export const anbyChargeMechanic = makePanelBuffModule(
  'agent:anby_charge',
  ['1011'],
  '安比·充能',
  'anby_charge',
  (resource, panel) => {
    if ((resource?.total ?? 0) > 0) {
      panel.dmgBonus = (panel.dmgBonus ?? 0) + 45
    }
  },
)

export const corinChargeMechanic = makePanelBuffModule(
  'agent:corin_charge',
  ['1061'],
  '可琳·充能',
  'corin_charge',
  (resource, panel) => {
    const stacks = stackCount(resource)
    panel.dmgBonus = (panel.dmgBonus ?? 0) + stacks * 3
  },
)

export const graceChargeMechanic = makePanelBuffModule(
  'agent:grace_charge',
  ['1181'],
  '格莉丝·电能',
  'grace_electric_charge',
  (resource, panel) => {
    if ((resource?.total ?? 0) > 0) {
      panel.electricAnomalyBuildUpEfficiency = (panel.electricAnomalyBuildUpEfficiency ?? 0) + 130
    }
  },
)

export const prometheusGuiltyMechanic = makePanelBuffModule(
  'agent:prometheus_guilty',
  ['1541'],
  '普罗米娅·有罪推定',
  'prometheus_guilty_presumption',
  (resource, panel) => {
    if ((resource?.total ?? 0) > 0) {
      panel.enemyDefReduction = (panel.enemyDefReduction ?? 0) + 40
    }
  },
)

export const zhendouHeartfireMechanic = makePanelBuffModule(
  'agent:zhendou_heartfire',
  ['1441'],
  '真斗·熔锋',
  'zhendou_heartfire',
  (resource, panel) => {
    if ((resource?.total ?? 0) >= 75) {
      panel.critRate = (panel.critRate ?? 0) + 10
      panel.fireDmg = (panel.fireDmg ?? 0) + 20
    }
  },
)

export const yeshuguangMingxinMechanic = makePanelBuffModule(
  'agent:yeshuguang_mingxin',
  ['1431'],
  '叶瞬光·明心境',
  'yeshuguang_mingxin',
  (resource, panel) => {
    if ((resource?.total ?? 0) > 0) {
      panel.critRate = (panel.critRate ?? 0) + 30
      panel.dmgBonus = (panel.dmgBonus ?? 0) + 25
    }
  },
)

export const aireProficiencyMechanic = makePanelBuffModule(
  'agent:aire_proficiency',
  ['1501'],
  '爱芮·异常精通',
  'aire_cheer_energy',
  (resource, panel) => {
    if ((resource?.total ?? 0) >= 0) {
      panel.anomalyProficiency = (panel.anomalyProficiency ?? 0) + 90
    }
  },
)

export const peiluoProminenceMechanic = makePanelBuffModule(
  'agent:peiluo_prominence',
  ['1551'],
  '佩洛伊斯·日珥',
  'peiluo_prominence',
  (resource, panel) => {
    if ((resource?.total ?? 0) >= 30) {
      panel.critDmg = (panel.critDmg ?? 0) + 40
    }
  },
)

const peiluoSpec = getAgentSpec('1551')
peiluoProminenceMechanic.settings = [{
  id: 'peiluo.ultBranch',
  label: '佩洛伊斯终结分支',
  description: '1=上分支阳炎（暴伤）；2=下分支耀斑（回能与增伤）；3=左分支无拘剑势（900%）；4=右分支永陷幽囚（2250%）。',
  default: 1,
  min: 1,
  max: 4,
  step: 1,
  suffix: '',
}]
peiluoProminenceMechanic.buildCharConfig = ({ cfg, panel, cinemaLevel }: any) => {
  const branch = Math.floor(Number((cfg as any)['setting:peiluo.ultBranch'] ?? 1) || 1)
  ;(cfg as any).peiluoUltBranch = branch
  ;(panel as any).__peiluoBranch = branch
  // 影画1 黄昏旧章：进场获得 1000 点喧响值（勘域模式 180s 一次，整局口径按一次计）
  if ((cinemaLevel ?? 0) >= 1) {
    cfg.initialDecibelGift = (cfg.initialDecibelGift ?? 0) + 1000
  }
}
peiluoProminenceMechanic.transformSkillExecutions = (input: any) => {
  const panel = input.panel
  if (!panel) return
  delete (panel as any).__specPanelBuffApplied
  const branch = (panel as any).__peiluoBranch ?? 1
  const resource = input.charResult.specResources?.['peiluo_prominence']
  if ((resource?.total ?? 0) < 30) return
  if (branch === 1) {
    panel.critDmg = (panel.critDmg ?? 0) + 40
  } else if (branch === 2) {
    panel.energyGainEfficiency = (panel.energyGainEfficiency ?? 0) + 15
    panel.dmgBonus = (panel.dmgBonus ?? 0) + 40
  }
}
peiluoProminenceMechanic.buildExecutions = ({ cfg, state, executions }: any) => {
  const branch = Number((cfg as any).peiluoUltBranch ?? 1)
  const count = Math.floor(state.ultimateCount ?? 0)
  if (count <= 0 || (branch !== 3 && branch !== 4)) return
  executions.push({
    moveId: '1551008',
    moveName: branch === 3 ? '终结技：无拘剑势（浸染重击）' : '终结技：永陷幽囚（失衡重击）',
    category: 'chain',
    count,
    actionTime: 0,
    comboAlignRatio: 0,
    totalTime: 0,
    totalComboAlignTime: 0,
    energyConsume: 0,
    totalEnergyConsume: 0,
    decibelRecovery: 0,
    totalDecibelRecovery: 0,
    energyRecovery: 0,
    totalEnergyRecovery: 0,
    damageMultiplier: branch === 3 ? 900 : 2250,
    damageMultiplierOverride: true,
    element: 'physical',
    skillTableNote: branch === 3 ? '无拘剑势：浸染目标额外900%攻击力' : '永陷幽囚：失衡目标额外2250%攻击力',
  })
}

export const sethShieldMechanic = makePanelBuffModule(
  'agent:seth_shield',
  ['1271'],
  '赛斯·匪石之盾',
  'seth_stone_shield',
  (resource, panel) => {
    if ((resource?.total ?? 0) > 0) {
      panel.anomalyProficiency = (panel.anomalyProficiency ?? 0) + 100
    }
  },
)

const anbyZeroSpec = getAgentSpec('1381')
export const anbyZeroVortexMechanic: AgentMechanicModule = {
  id: 'agent:anby_zero_vortex',
  agentIds: ['1381'],
  name: '零号·安比·电磁涡流',
  buildResourceResult: buildResourceResult('1381'),
  buildExecutions: ({ cfg, state, executions }: AgentResourceInput) => {
    if (!anbyZeroSpec) return
    const resources = computeSpecResources(anbyZeroSpec, cfg, state)
    const whiteLightning = resources.get('anby_zero_white_lightning')
    const total = Math.floor(whiteLightning?.total ?? 0)
    const count = Math.floor(total / 6)
    if (count <= 0) return
    executions.push({
      moveId: '1381004',
      moveName: '电磁涡流',
      category: 'special',
      count,
      actionTime: 0,
      comboAlignRatio: 0,
      totalTime: 0,
      totalComboAlignTime: 0,
      energyConsume: 0,
      totalEnergyConsume: 0,
      decibelRecovery: 0,
      totalDecibelRecovery: 0,
      energyRecovery: 0,
      totalEnergyRecovery: 0,
      damageMultiplier: 1000,
      damageMultiplierOverride: true,
      element: 'electric',
      skillTableNote: '6命电磁涡流：每6次白雷额外伤害触发一次',
    })
  },
  resourceSections: (input: AgentResourceSectionsInput) => {
    return anbyZeroSpec ? specToMechanicModule(anbyZeroSpec).resourceSections?.(input) ?? [] : []
  },
}

const jufufuSpec = getAgentSpec('1391')
export const jufufuTigerRoarMechanic: AgentMechanicModule = {
  id: 'agent:jufufu_tiger_roar',
  agentIds: ['1391'],
  name: '橘福福·虎啸',
  description: '虎啸自身冲击+50（虎釜震煞消耗威风≥1 次即视为覆盖）；威风/威势资源与虎釜震煞事件由 spec 通用解释器承接。',
  buildResourceResult: buildResourceResult('1391'),
  buildCharConfig: jufufuSpec ? specToMechanicModule(jufufuSpec).buildCharConfig : undefined,
  buildExecutions: jufufuSpec ? specToMechanicModule(jufufuSpec).buildExecutions : undefined,
  buildAnomalyEvents: jufufuSpec ? specToMechanicModule(jufufuSpec).buildAnomalyEvents : undefined,
  transformSkillExecutions: (input: AgentSkillTransformInput) => {
    const panel = input.panel
    if (!panel) return
    if ((panel as any).__jufufuTigerRoarApplied) return
    ;(panel as any).__jufufuTigerRoarApplied = true
    // [已确认·数据] 核心被动虎虎生威：虎啸状态下橘福福自身冲击力+50。
    const resource = input.charResult.specResources?.['jufufu_awe']
    const spend = resource?.spendCounts?.['jufufu_tiger_chain_spend'] ?? 0
    if (spend > 0) {
      panel.impact = (panel.impact ?? 0) + 50
    }
  },
  resourceSections: (input: AgentResourceSectionsInput) => {
    return jufufuSpec ? specToMechanicModule(jufufuSpec).resourceSections?.(input) ?? [] : []
  },
}
