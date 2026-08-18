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

/* 佩洛伊斯终结技分支模型（用户口径）：
 * - 一个大招消耗 2000 喧响（cfg.ultimateCost）；大招行按上分支 moveId 生成，patchExecutions 拆三分支。
 * - 下分支·凯旋坦途：开局必打、整局仅一次（固定 1）；耀斑 = 能量获得效率+15%、伤害+40%（200s≈全程，面板无条件挂）。
 *   影画2 发动时回 1500 喧响由编排层注入 extraSelfDecibelReward（上限不建模）。
 * - 右分支·永陷幽囚 = 决算：一次失衡打一次（滑块 peiluo.verdictCount，-1=自动=失衡次数），
 *   编排层解析后写入 cfg.peiluoVerdictCount；非轴模式不模拟失衡窗口截断（轴模式待接入）。
 * - 上分支·万军诛绝：剩余喧响全打（+30日珥由 spec 资源规则承载）；阳炎暴伤+40% 按失衡内近似挂 critDmgBonus。
 * - 左分支·无拘剑势：不建模（当前版本不打；未来新队友适配时由用户录入逻辑）。
 */
const PEILUO_ULT_COST = 2000
const PEILUO_ULT_UPPER = '1551015' // 万军诛绝
const PEILUO_ULT_LOWER = '1551014' // 凯旋坦途
const PEILUO_ULT_VERDICT = '1551016' // 永陷幽囚（决算）
const PEILUO_FLARE_ENERGY = 15 // 耀斑：能量获得效率 +15%
const PEILUO_FLARE_DMG = 40 // 耀斑：造成的伤害 +40%
const PEILUO_KAGEROU_CRIT = 40 // 阳炎：终结技对失衡敌人暴伤 +40%

peiluoProminenceMechanic.settings = [{
  id: 'peiluo.verdictCount',
  label: '佩洛伊斯·决算次数（右分支终结）',
  description: '-1=自动（一次失衡一次决算）；>=0=固定次数。封顶于可用大招数-1（下分支固定占 1 次）。',
  default: -1,
  min: -1,
  max: 20,
  step: 1,
  suffix: '',
}]
peiluoProminenceMechanic.buildCharConfig = ({ cfg, cinemaLevel }: any) => {
  // 影画1 黄昏旧章：进场获得 1000 点喧响值（勘域模式 180s 一次，整局口径按一次计）
  if ((cinemaLevel ?? 0) >= 1) {
    cfg.initialDecibelGift = (cfg.initialDecibelGift ?? 0) + 1000
  }
  // 大招口径：2000 喧响/次；通用大招行走上分支 moveId（patchExecutions 拆分三分支）
  cfg.ultimateCost = PEILUO_ULT_COST
  cfg.ultimateMoveId = PEILUO_ULT_UPPER
}
peiluoProminenceMechanic.transformSkillExecutions = (input: any) => {
  const panel = input.panel
  if (!panel) return
  delete (panel as any).__specPanelBuffApplied
  // 耀斑（下分支开局必打，200s≈全程覆盖）：无条件挂面板
  panel.energyGainEfficiency = (panel.energyGainEfficiency ?? 0) + PEILUO_FLARE_ENERGY
  panel.dmgBonus = (panel.dmgBonus ?? 0) + PEILUO_FLARE_DMG
}
peiluoProminenceMechanic.patchExecutions = ({ cfg, state, executions }: any) => {
  const ultCount = Math.max(0, Math.floor(state.ultimateCount ?? 0))
  if (ultCount <= 0) return
  const lower = 1
  const verdict = Math.min(Math.max(0, Math.floor(Number(cfg.peiluoVerdictCount ?? 0))), ultCount - lower)
  const upper = ultCount - lower - verdict
  // 通用大招行（moveId = 上分支）改写为剩余上分支次数；阳炎暴伤挂执行行
  const genericIdx = executions.findIndex((e: any) => e.moveId === PEILUO_ULT_UPPER && e.category === 'chain')
  const ultActionTime = genericIdx >= 0 ? (executions[genericIdx].actionTime ?? 0) : (cfg.ultimateActionTime ?? 0)
  const ultCar = genericIdx >= 0 ? (executions[genericIdx].comboAlignRatio ?? 0) : (cfg.ultimateComboAlignRatio ?? 0)
  if (genericIdx >= 0) {
    if (upper > 0) {
      const g = executions[genericIdx]
      g.count = upper
      g.totalTime = (g.actionTime ?? 0) * upper
      g.totalComboAlignTime = (g.actionTime ?? 0) * (g.comboAlignRatio ?? 0) * upper
      g.totalDecibelRecovery = (g.decibelRecovery ?? 0) * upper
      g.critDmgBonus = (g.critDmgBonus ?? 0) + PEILUO_KAGEROU_CRIT
      g.skillTableNote = `上分支·万军诛绝 ×${upper}（剩余喧响；阳炎暴伤+40%按失衡内近似）`
    } else {
      executions.splice(genericIdx, 1)
    }
  }
  const pushUlt = (moveId: string, count: number, note: string) => {
    if (count <= 0) return
    executions.push({
      moveId,
      moveName: note,
      category: 'chain',
      count,
      actionTime: ultActionTime,
      comboAlignRatio: ultCar,
      totalTime: ultActionTime * count,
      totalComboAlignTime: ultActionTime * ultCar * count,
      energyConsume: 0,
      totalEnergyConsume: 0,
      decibelRecovery: 0,
      totalDecibelRecovery: 0,
      energyRecovery: 0,
      totalEnergyRecovery: 0,
      skillTableNote: note,
    })
  }
  pushUlt(PEILUO_ULT_LOWER, lower, '下分支·凯旋坦途（开局固定一次）')
  pushUlt(PEILUO_ULT_VERDICT, verdict, `右分支·永陷幽囚（决算）×${verdict}`)
}

/* 日珥账本（数据源 catalog attack_data_0=回复 / attack_data_1=消耗，原始值已 ÷100）：
 * - 回复：余晖/旭日/朝晖/EX日华/快支/支援突击 命中按段回复 + 入场30 + 接战0.5/s(上限60) + 上分支30 + 强特完美格挡10（后四项在 spec 资源规则）
 * - 消耗：天光 a1-a4 命中消耗（a3/a4 为连段主消耗）
 * - 口径：账本核对型——倍率表无强化/普通天光差异行，日珥不足不改变伤害，只校验循环是否打得起 a3/a4 连段。
 */
const PEILUO_PROMINENCE_GAIN: Record<string, number> = {
  '1551001': 1.4001, // 普通攻击：余晖 #1
  '1551002': 1.5321, // 余晖 #2
  '1551003': 6.2014, // 余晖 #3
  '1551010': 1.4661, // 冲刺攻击：旭日
  '1551011': 2.3347, // 闪避反击：朝晖
  '1551009': 4.9987, // 强化特殊技：日华
  '1551017': 1.2674, // 快速支援：黄昏禁卫
  '1551021': 2.1327, // 支援突击：重睹天日
}
const PEILUO_PROMINENCE_SPEND: Record<string, number> = {
  '1551004': 1.5007, // 天光 #1
  '1551005': 2.0459, // 天光 #2
  '1551006': 14.6107, // 天光 #3（连段）
  '1551007': 11.8234, // 天光 #4（连段）
}
const PEILUO_CHAIN_COST = PEILUO_PROMINENCE_SPEND['1551006'] + PEILUO_PROMINENCE_SPEND['1551007'] // a3+a4 连段单价 26.4341

const peiluoUltBranchPatch = peiluoProminenceMechanic.patchExecutions!
peiluoProminenceMechanic.patchExecutions = (input: any) => {
  peiluoUltBranchPatch(input)
  const { cfg, executions } = input
  let hitGain = 0
  let spend = 0
  let lowSpend = 0
  let a3 = 0
  let a4 = 0
  for (const e of executions) {
    const n = e.count ?? 0
    const g = PEILUO_PROMINENCE_GAIN[e.moveId]
    if (g) hitGain += g * n
    const s = PEILUO_PROMINENCE_SPEND[e.moveId]
    if (s) {
      spend += s * n
      if (e.moveId === '1551006') a3 += n
      else if (e.moveId === '1551007') a4 += n
      else lowSpend += s * n
    }
  }
  cfg.peiluoProminenceLedger = { hitGain, spend, lowSpend, a3, a4 }
}

peiluoProminenceMechanic.buildResourceResult = ({ cfg, state }: any) => {
  const spec = getAgentSpec('1551')
  const specResources: Record<string, SpecResourceResult> = spec
    ? Object.fromEntries(computeSpecResources(spec, cfg, state))
    : {}
  const prom = specResources['peiluo_prominence']
  const ledger = cfg.peiluoProminenceLedger ?? { hitGain: 0, spend: 0, lowSpend: 0, a3: 0, a4: 0 }
  if (prom) {
    if (ledger.hitGain > 0) {
      prom.gains['peiluo_hit_gain'] = ledger.hitGain
      prom.totalGain += ledger.hitGain
      prom.total += ledger.hitGain
      prom.remaining += ledger.hitGain
    }
    if (ledger.spend > 0) {
      prom.spendCounts['peiluo_tianguang_spend'] = 1
      prom.spendCosts['peiluo_tianguang_spend'] = ledger.spend
      prom.remaining -= ledger.spend
    }
  }
  return { specResources, peiluoProminenceLedger: ledger }
}

peiluoProminenceMechanic.resourceSections = (input: AgentResourceSectionsInput) => {
  const spec = getAgentSpec('1551')
  const specSections = spec ? specToMechanicModule(spec).resourceSections?.(input) ?? [] : []
  const result = input.result as any
  const prom = result.specResources?.['peiluo_prominence'] as SpecResourceResult | undefined
  const ledger = result.peiluoProminenceLedger ?? { hitGain: 0, spend: 0, lowSpend: 0, a3: 0, a4: 0 }
  if (!prom) return specSections
  const pf = (n: number) => String(Math.round(n * 10) / 10)
  const entry = prom.initialValue
  const passive = prom.gains['peiluo_frontline_gain'] ?? 0
  const upper = prom.gains['peiluo_upper_ult_gain'] ?? 0
  const block = prom.gains['peiluo_perfect_block_gain'] ?? 0
  const totalGain = entry + passive + upper + block + ledger.hitGain
  const surplus = totalGain - ledger.spend
  // 连段校验：a3+a4 成对为连段；日珥（含入场）能否支付全部天光消耗
  const chainPairs = Math.min(ledger.a3, ledger.a4)
  const affordable = surplus >= -1e-9
  return [
    {
      id: 'peiluo-prominence-ledger',
      title: '佩洛伊斯·日珥账本',
      summary: `回复 ${pf(totalGain)} · 消耗 ${pf(ledger.spend)} · ${affordable ? `结余 ${pf(surplus)}` : `缺口 ${pf(-surplus)}`}`,
      rows: [
        { label: '回复·入场+被动+大招侧', value: pf(entry + passive + upper + block), detail: `入场30 / 接战0.5s×${pf(passive / 0.5)}s（上限60） / 上分支×30 / 完美格挡×10` },
        { label: '回复·技能命中', value: pf(ledger.hitGain), detail: '余晖/旭日/朝晖/EX日华/快支/支援突击 按段回复（attack_data_0）' },
        { label: '消耗·天光连段', value: pf(ledger.spend - ledger.lowSpend), detail: `a3×${ledger.a3}（14.61）+ a4×${ledger.a4}（11.82），连段 ${chainPairs} 组（单价 ${pf(PEILUO_CHAIN_COST)}）` },
        { label: '消耗·天光低段', value: pf(ledger.lowSpend), detail: 'a1（1.50）+ a2（2.05）' },
        { label: '核对结论', value: affordable ? '日珥足够' : '日珥不足', detail: affordable ? '循环打得起当前 a3/a4 配置' : '消耗超出回复，实战需减少天光连段或等待被动回复' },
      ],
      footer: '倍率表无强化/普通天光差异行，日珥只校验循环可行性、不影响伤害。消耗/回复数值来自 catalog attack_data 行（原始值÷100）。',
    },
    ...specSections,
  ]
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
