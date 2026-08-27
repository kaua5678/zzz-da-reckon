import type {
  AgentMechanicModule,
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

// 格莉丝电能（旧全局 electricAnomalyBuildUpEfficiency+130 面板近似）已由 agents/grace.ts
// 完整模块取代（2026-08-23 口供：行级 ×2.3 精确限定特殊技 + A3/特/A4/特 显式循环）。
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

/** 叶瞬光完整模块见 agents/yeshuguang.ts；此处保留别名供旧测试 import */
export { yeshuguangMechanic as yeshuguangMingxinMechanic } from './yeshuguang'

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
 * - 右分支·永陷幽囚 = 决算：一次失衡只能决算一次（决算后即出失衡）。无滑块——
 *   非轴模式决算次数 = 失衡次数（编排层写入 cfg.peiluoVerdictCount）；轴模式按轴内 1551016 块计数。
 *   轴模式窗口截断：1551016 块标记 endsStunWindow，栈引擎做完决算即清空窗口剩余失衡时间
 *   （平A填充归零、有效失衡时长按截断时刻），损失秒数从失衡覆盖率扣除（useResourceCalc verdictSecondsLost）。
 * - 上分支·万军诛绝：剩余喧响全打（+30日珥由 spec 资源规则承载）；阳炎暴伤+40% 按失衡内近似挂 critDmgBonus。
 * - 左分支·无拘剑势：不建模（当前版本不打；未来新队友适配时由用户录入逻辑）。
 */
const PEILUO_ULT_COST = 2000
const PEILUO_ULT_UPPER = '1551015' // 万军诛绝
const PEILUO_ULT_LOWER = '1551014' // 凯旋坦途
const PEILUO_ULT_VERDICT = '1551016' // 永陷幽囚（决算）
const PEILUO_FLARE_ENERGY = 15 // 耀斑：能量获得效率 +15%
const PEILUO_FLARE_DMG = 40 // 耀斑：造成的伤害 +40%
export const PEILUO_KAGEROU_CRIT = 40 // 阳炎：终结技对失衡敌人暴伤 +40%

// 决算次数无滑块：轴模式由轴内 1551016 块计数，非轴模式 = 失衡次数（编排层写入 cfg.peiluoVerdictCount）
peiluoProminenceMechanic.settings = [{
  id: 'peiluo.kagerouCoverage',
  label: '佩洛伊斯·阳炎暴伤覆盖率（非轴模式）',
  description: '非轴模式近似：上分支/决算终结吃阳炎暴伤+40% 的覆盖率。轴模式走 buff 轴扫描，不用此滑块。',
  default: 1,
  min: 0,
  max: 1,
  step: 0.05,
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
      g.skillTableNote = `上分支·万军诛绝 ×${upper}（剩余喧响；阳炎暴伤+40% 走 buff 轴扫描，见 computePeiluoKagerouBonus）`
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
  // 阳炎配对比例（非轴模式用）：决算只在失衡内放，通常一次失衡 = 上分支+决算各一（都吃阳炎）；
  // 喧响不够只打决算时没有上分支铺垫 → 不吃阳炎。可受益决算数 = min(上分支次数, 决算次数)。
  if (verdict > 0) {
    const row = executions.find((e: any) => e.moveId === PEILUO_ULT_VERDICT)
    if (row) row.peiluoKagerouPairRatio = Math.min(upper, verdict) / verdict
  }
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
        { label: '回复·入场+被动+大招侧', value: pf(entry + passive + upper + block), detail: `入场30 / 被动固定60 / 上分支×30 / 完美格挡×10` },
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

/** 阳炎 buff 轴扫描（参考仪玄凝神模式）：上分支（1551015）发动后 21s 窗口内，
 * [终结技]对失衡敌人的暴伤 +40%。用户口径：触发块自身也享受；受益限定上分支与右分支决算（1551016）。
 * 返回 moveId → 实例加权平均暴伤（0-40），非轴模式由调用方按覆盖率滑块近似。 */
// 特殊技：强袭训令（1551022，佩洛伊斯格挡招式）：主页交互栏填写次数 → 执行行（倍率表 166.4% 以太）
peiluoProminenceMechanic.buildExecutions = ({ cfg, executions }: any) => {
  const count = Math.max(0, Math.floor(cfg.assaultOrderCount ?? 0))
  if (count <= 0) return
  executions.push({
    moveId: '1551022',
    moveName: '特殊技：强袭训令',
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
    skillTableNote: `特殊技：强袭训令 ×${count}（主页交互栏填写）`,
  })
}

export const PEILUO_KAGEROU_SECONDS = 21
export function computePeiluoKagerouBonus(
  slot: number,
  axes: { actions: { slot: number; moveId: string; count: number; startTime?: number }[] }[],
): Map<string, number> {
  const TRIGGER = '1551015'
  const BENEFICIARIES = new Set<string>(['1551015', '1551016'])
  const actions = axes
    .flatMap(axis => axis.actions ?? [])
    .filter(a => a.slot === slot)
    .sort((a, b) => (a.startTime ?? 0) - (b.startTime ?? 0))
  let windowEnd = Number.NEGATIVE_INFINITY
  const weighted = new Map<string, { total: number; count: number }>()
  for (const act of actions) {
    const start = act.startTime ?? 0
    const count = Math.max(0, Math.floor(act.count) || 1)
    if (act.moveId === TRIGGER) windowEnd = start + PEILUO_KAGEROU_SECONDS
    if (!BENEFICIARIES.has(act.moveId)) continue
    if (start > windowEnd) continue
    const prev = weighted.get(act.moveId) ?? { total: 0, count: 0 }
    weighted.set(act.moveId, { total: prev.total + PEILUO_KAGEROU_CRIT * count, count: prev.count + count })
  }
  const result = new Map<string, number>()
  for (const [moveId, w] of weighted) {
    if (w.count > 0) result.set(moveId, w.total / w.count)
  }
  return result
}

const jufufuSpec = getAgentSpec('1391')
const jufufuSpecModule = jufufuSpec ? specToMechanicModule(jufufuSpec) : null

/** 虎威自动攻击间隔（秒）：后台每 4 秒 1 次（用户确认） */
export const JUFUFU_HUWEI_INTERVAL = 4
/** 虎威命中回复威风 */
export const JUFUFU_HUWEI_AWE = 20
/** 虎釜震煞消耗威风 */
export const JUFUFU_CHAIN_AWE_COST = 100
/** 高速旋转（山君鼎戏·威势）每次消耗 1 威势 → +25 威风 */
export const JUFUFU_SPIN_AWE = 25
/** 影画6：每次旋转耗威势命中发射 3 爆米花，每个 160% 攻击力（视为连携） */
export const JUFUFU_C6_POPCORN_PER_SPIN = 3
export const JUFUFU_C6_POPCORN_MULT = 160
export const JUFUFU_C6_CHAIN_DMG_BONUS = 30

const JUFUFU_MOVE = {
  huwei: '1391005', // 普通攻击：「虎威」
  spinWeishi: '1391010', // 冲刺攻击：恶虎七式·山君鼎戏·威势
  tigerChain: '1391013', // 连携技：虎釜震煞
  tigerChainManual: '1391012', // 连携技：虎釜崩
  popcorn: '1391_c6_popcorn',
} as const

export interface JufufuCycleInput {
  backstageTime: number
  exSpecialCount: number
  ultimateCount: number
  /** 支援突击近似（招架次数） */
  parryCount: number
  cinemaLevel: number
  /** 影画1 进场威风 */
  aweInitial: number
  /** 影画2：任意角色终结技回威势量/次（0/3） */
  c2WeishiPerUlt: number
  /**
   * 影画2 终结回威势的次数源：
   * - 默认用自身 ultimateCount（与旧 spec 一致）
   * - 编排层可注入队伍终结总次数（含仪玄符法千重等）
   */
  teamUltimateCount?: number
}

export interface JufufuCycleResult {
  huweiHits: number
  weishiGain: number
  spinCount: number
  aweBase: number
  aweFromSpin: number
  aweTotal: number
  tigerChainCount: number
  popcornHits: number
}

/**
 * 橘福福威风/威势/虎釜震煞/旋转次数账本（用户确认口径）：
 * - 虎威后台自动攻击：floor(后场时间/4) 次，每次 +20 威风
 * - 威势 = 强特×3 + 终结×6 + 支援突击×1 + 影画2 队伍终结×3
 * - 高速旋转（山君鼎戏·威势）：威势全部用于旋转命中，每次 +25 威风
 * - 虎釜震煞 = floor(威风总量/100)；虎啸满覆盖
 */
export function computeJufufuCycle(input: JufufuCycleInput): JufufuCycleResult {
  const backstage = Math.max(0, Number(input.backstageTime) || 0)
  const ex = Math.max(0, Math.floor(Number(input.exSpecialCount) || 0))
  const ult = Math.max(0, Math.floor(Number(input.ultimateCount) || 0))
  const parry = Math.max(0, Math.floor(Number(input.parryCount) || 0))
  const cinema = Math.max(0, Math.floor(Number(input.cinemaLevel) || 0))
  const aweInitial = Math.max(0, Number(input.aweInitial) || 0)
  const c2Per = Math.max(0, Number(input.c2WeishiPerUlt) || 0)
  const teamUlt = Math.max(0, Math.floor(Number(input.teamUltimateCount ?? ult) || 0))

  const huweiHits = Math.floor(backstage / JUFUFU_HUWEI_INTERVAL)
  const weishiGain = ex * 3 + ult * 6 + parry * 1 + (cinema >= 2 ? teamUlt * c2Per : 0)
  // 威势全部投入高速旋转（后台虎釜震煞后进入旋转；整局总量口径）
  const spinCount = weishiGain
  const aweFromHuwei = huweiHits * JUFUFU_HUWEI_AWE
  const aweFromSkills = ex * 80 + ult * 100
  const aweFromSpin = spinCount * JUFUFU_SPIN_AWE
  const aweBase = aweInitial + aweFromHuwei + aweFromSkills
  const aweTotal = aweBase + aweFromSpin
  const tigerChainCount = Math.floor(aweTotal / JUFUFU_CHAIN_AWE_COST)
  const popcornHits = cinema >= 6 ? spinCount * JUFUFU_C6_POPCORN_PER_SPIN : 0

  return {
    huweiHits,
    weishiGain,
    spinCount,
    aweBase,
    aweFromSpin,
    aweTotal,
    tigerChainCount,
    popcornHits,
  }
}

function jufufuRowValue(skills: any, moveId: string, rowId: string): number {
  for (const cat of skills?.categories ?? []) {
    const move = (cat.moves ?? []).find((m: any) => m.id === moveId)
    if (!move) continue
    const row = (move.rows ?? []).find((r: any) => r.id === rowId)
    const vals = row?.values ?? []
    if (!vals.length) return 0
    return Number(vals[11] ?? vals[vals.length - 1] ?? 0) || 0
  }
  return 0
}

function pushJufufuExec(
  executions: any[],
  moveId: string,
  moveName: string,
  category: string,
  count: number,
  multiplier: number,
  opts: { override?: boolean; dmgBonus?: number; skillDamageTarget?: string; note?: string; element?: string } = {},
) {
  if (count <= 0 || multiplier <= 0) return
  executions.push({
    moveId,
    moveName,
    category,
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
    damageMultiplier: multiplier,
    damageMultiplierOverride: opts.override ?? true,
    element: opts.element ?? 'fire',
    dmgBonus: opts.dmgBonus ?? 0,
    skillDamageTarget: opts.skillDamageTarget,
    skillTableNote: opts.note ?? '',
  })
}

export const jufufuTigerRoarMechanic: AgentMechanicModule = {
  id: 'agent:jufufu_tiger_roar',
  agentIds: ['1391'],
  name: '橘福福·虎啸',
  description: '虎威4秒/次驱动威风；虎釜震煞/山君鼎戏·威势次数由账本收敛；虎啸满覆盖冲击+50；影画1/2/4/6 面板与附伤。',
  buildCharConfig: (input) => {
    jufufuSpecModule?.buildCharConfig?.(input)
    const cinema = input.cinemaLevel ?? 0
    const cfg = input.cfg
    cfg.jufufuCinemaLevel = cinema
    // 影画1：进场 100 威风
    if (cinema >= 1) {
      cfg.jufufuAweInitial = (cfg.jufufuAweInitial ?? 0) + 100
    }
    // 影画2：终结回威势量/次（0命=0）
    cfg.jufufuC2WeishiPerUlt = cinema >= 2 ? 3 : 0
    // 预存倍率
    const record = cfg as unknown as Record<string, unknown>
    record.jufufuMoveDmg = {
      [JUFUFU_MOVE.huwei]: jufufuRowValue(input.skills, JUFUFU_MOVE.huwei, 'damage'),
      [JUFUFU_MOVE.spinWeishi]: jufufuRowValue(input.skills, JUFUFU_MOVE.spinWeishi, 'damage'),
      [JUFUFU_MOVE.tigerChain]: jufufuRowValue(input.skills, JUFUFU_MOVE.tigerChain, 'damage'),
      [JUFUFU_MOVE.tigerChainManual]: jufufuRowValue(input.skills, JUFUFU_MOVE.tigerChainManual, 'damage'),
    }
  },
  buildExecutions: ({ cfg, state, executions }) => {
    // 不再走 spec 事件（虎釜震煞改由账本精确次数生成）
    const cinema = Math.max(0, Math.floor(Number(cfg.jufufuCinemaLevel ?? 0)))
    const dmg = ((cfg as any).jufufuMoveDmg ?? {}) as Record<string, number>
    const cycle = computeJufufuCycle({
      backstageTime: state.backstageTime ?? 0,
      exSpecialCount: state.exSpecialCount ?? 0,
      ultimateCount: state.ultimateCount ?? 0,
      parryCount: cfg.parryCount ?? 0,
      cinemaLevel: cinema,
      aweInitial: cfg.jufufuAweInitial ?? 0,
      c2WeishiPerUlt: cfg.jufufuC2WeishiPerUlt ?? 0,
      teamUltimateCount: (cfg as any).jufufuTeamUltimateCount,
    })
    cfg.jufufuHuweiHits = cycle.huweiHits
    cfg.jufufuTigerChainCount = cycle.tigerChainCount
    cfg.jufufuSpinCount = cycle.spinCount
    ;(cfg as any).jufufuCycle = cycle

    const c6Bonus = cinema >= 6 ? JUFUFU_C6_CHAIN_DMG_BONUS : 0

    // 虎威自动攻击（后台，不占前台时间）
    pushJufufuExec(
      executions,
      JUFUFU_MOVE.huwei,
      '普通攻击：「虎威」',
      'basic',
      cycle.huweiHits,
      dmg[JUFUFU_MOVE.huwei] ?? 0,
      { note: `虎威自动 ×${cycle.huweiHits}（后场 floor(t/4)，每次 +20 威风）` },
    )

    // 虎釜震煞（后台连携，actionTime=0）
    pushJufufuExec(
      executions,
      JUFUFU_MOVE.tigerChain,
      '连携技：虎釜震煞',
      'chain',
      cycle.tigerChainCount,
      dmg[JUFUFU_MOVE.tigerChain] ?? 0,
      {
        dmgBonus: c6Bonus,
        skillDamageTarget: 'chain',
        note: `虎釜震煞 ×${cycle.tigerChainCount}（威风 ${cycle.aweTotal.toFixed(0)}/100；影画6 连携+${c6Bonus}%）`,
      },
    )

    // 山君鼎戏·威势（高速旋转耗威势命中）
    pushJufufuExec(
      executions,
      JUFUFU_MOVE.spinWeishi,
      '冲刺攻击：恶虎七式·山君鼎戏·威势',
      'basic',
      cycle.spinCount,
      dmg[JUFUFU_MOVE.spinWeishi] ?? 0,
      { note: `山君鼎戏·威势 ×${cycle.spinCount}（耗威势旋转，每次 +25 威风）` },
    )

    // 影画6 爆米花附伤：次数 = 旋转次数 × 3，每个 160% 攻击力，视为连携
    if (cycle.popcornHits > 0) {
      pushJufufuExec(
        executions,
        JUFUFU_MOVE.popcorn,
        '影画6·爆米花附伤',
        'chain',
        cycle.popcornHits,
        JUFUFU_C6_POPCORN_MULT,
        {
          dmgBonus: c6Bonus,
          skillDamageTarget: 'chain',
          note: `爆米花 ×${cycle.popcornHits}（旋转 ${cycle.spinCount}×3，每个 160% 攻击力，视为连携；影画6 连携+${c6Bonus}%）`,
        },
      )
    }
  },
  patchExecutions: ({ cfg, executions }) => {
    const cinema = Math.max(0, Math.floor(Number(cfg.jufufuCinemaLevel ?? 0)))
    if (cinema < 6) return
    // 影画6：所有连携技（含虎釜崩手动连携，若有）+30% 招式限定增伤
    for (const e of executions) {
      if (e.moveId === JUFUFU_MOVE.tigerChain || e.moveId === JUFUFU_MOVE.tigerChainManual || e.moveId === JUFUFU_MOVE.popcorn) {
        e.dmgBonus = (e.dmgBonus ?? 0) // already set on generated rows
        if (e.moveId === JUFUFU_MOVE.tigerChainManual) {
          e.dmgBonus = (e.dmgBonus ?? 0) + JUFUFU_C6_CHAIN_DMG_BONUS
          e.skillDamageTarget = e.skillDamageTarget ?? 'chain'
        }
      } else if (e.category === 'chain' && (e.moveId ?? '').startsWith('1391')) {
        // 通用连携行（若引擎生成）
        const name = `${e.moveName ?? ''}`
        if (name.includes('连携') || name.toLowerCase().includes('chain')) {
          e.dmgBonus = (e.dmgBonus ?? 0) + JUFUFU_C6_CHAIN_DMG_BONUS
          e.skillDamageTarget = e.skillDamageTarget ?? 'chain'
        }
      }
    }
  },
  buildResourceResult: ({ cfg, state }) => {
    const cinema = Math.max(0, Math.floor(Number(cfg.jufufuCinemaLevel ?? 0)))
    const cycle: JufufuCycleResult = (cfg as any).jufufuCycle ?? computeJufufuCycle({
      backstageTime: state.backstageTime ?? 0,
      exSpecialCount: state.exSpecialCount ?? 0,
      ultimateCount: state.ultimateCount ?? 0,
      parryCount: cfg.parryCount ?? 0,
      cinemaLevel: cinema,
      aweInitial: cfg.jufufuAweInitial ?? 0,
      c2WeishiPerUlt: cfg.jufufuC2WeishiPerUlt ?? 0,
      teamUltimateCount: (cfg as any).jufufuTeamUltimateCount,
    })
    // 覆盖 spec 资源账本为精确次数模型
    const aweSpend = cycle.tigerChainCount * JUFUFU_CHAIN_AWE_COST
    const aweGains: Record<string, number> = {
      jufufu_tiger_awe_gain: cycle.huweiHits * JUFUFU_HUWEI_AWE,
      jufufu_awe_ex_special: Math.max(0, Math.floor(state.exSpecialCount ?? 0)) * 80,
      jufufu_awe_ultimate: Math.max(0, Math.floor(state.ultimateCount ?? 0)) * 100,
      jufufu_awe_spin: cycle.aweFromSpin,
    }
    const weishiGains: Record<string, number> = {
      jufufu_weishi_ex_special: Math.max(0, Math.floor(state.exSpecialCount ?? 0)) * 3,
      jufufu_weishi_ultimate: Math.max(0, Math.floor(state.ultimateCount ?? 0)) * 6,
      jufufu_weishi_assist: Math.max(0, Math.floor(cfg.parryCount ?? 0)) * 1,
      jufufu_team_ult_weishi_gain: cinema >= 2
        ? Math.max(0, Math.floor(Number((cfg as any).jufufuTeamUltimateCount ?? state.ultimateCount ?? 0))) * (cfg.jufufuC2WeishiPerUlt ?? 0)
        : 0,
    }
    const aweTotalGain = Object.values(aweGains).reduce((a, b) => a + b, 0)
    const weishiTotalGain = Object.values(weishiGains).reduce((a, b) => a + b, 0)
    const aweInitial = cfg.jufufuAweInitial ?? 0
    return {
      jufufuCycle: cycle,
      specResources: {
        jufufu_awe: {
          id: 'jufufu_awe',
          name: '威风',
          initialValue: aweInitial,
          maxValue: 200,
          totalGain: aweTotalGain,
          gains: aweGains,
          bonusCount: 0,
          total: aweInitial + aweTotalGain,
          remaining: Math.max(0, aweInitial + aweTotalGain - aweSpend),
          spendCounts: { jufufu_tiger_chain_spend: cycle.tigerChainCount },
          spendCosts: { jufufu_tiger_chain_spend: aweSpend },
        },
        jufufu_weishi: {
          id: 'jufufu_weishi',
          name: '威势',
          initialValue: 0,
          maxValue: 15,
          totalGain: weishiTotalGain,
          gains: weishiGains,
          bonusCount: 0,
          total: weishiTotalGain,
          remaining: Math.max(0, weishiTotalGain - cycle.spinCount),
          spendCounts: { jufufu_spin_spend: cycle.spinCount },
          spendCosts: { jufufu_spin_spend: cycle.spinCount },
        },
      },
    }
  },
  transformSkillExecutions: (input: AgentSkillTransformInput) => {
    const panel = input.panel
    if (!panel) return
    if ((panel as any).__jufufuTigerRoarApplied) return
    ;(panel as any).__jufufuTigerRoarApplied = true
    // 虎啸满覆盖（用户确认）：自身冲击 +50
    panel.impact = (panel.impact ?? 0) + 50
  },
  resourceSections: (input: AgentResourceSectionsInput) => {
    const cycle = (input.result as any)?.jufufuCycle as JufufuCycleResult | undefined
    const awe = input.result.specResources?.['jufufu_awe']
    const weishi = input.result.specResources?.['jufufu_weishi']
    const rows = [
      { label: '虎威次数', value: String(cycle?.huweiHits ?? 0), detail: '后场 floor(t/4)，每次 +20 威风' },
      { label: '威风总量', value: String(cycle?.aweTotal ?? awe?.total ?? 0), detail: `初始+虎威+强特/终结+旋转(+${cycle?.aweFromSpin ?? 0})` },
      { label: '虎釜震煞', value: String(cycle?.tigerChainCount ?? 0), detail: 'floor(威风/100)' },
      { label: '威势/旋转', value: `${cycle?.weishiGain ?? weishi?.total ?? 0} / ${cycle?.spinCount ?? 0}`, detail: '威势全投山君鼎戏·威势，每次 +25 威风' },
    ]
    if ((cycle?.popcornHits ?? 0) > 0) {
      rows.push({ label: '爆米花', value: String(cycle!.popcornHits), detail: '影画6：旋转×3，每个 160% 攻击力（连携）' })
    }
    return [{
      id: 'jufufu-cycle',
      title: '橘福福·威风/虎釜账本',
      summary: `虎威 ${cycle?.huweiHits ?? 0} · 震煞 ${cycle?.tigerChainCount ?? 0} · 旋转 ${cycle?.spinCount ?? 0}`,
      rows,
    }]
  },
}

