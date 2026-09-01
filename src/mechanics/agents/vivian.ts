/**
 * 薇薇安（1331）—— 飞羽/护羽资源循环、落羽生花双源触发与影画整局总量模型
 *
 * 原文来源：data/raw/nanoka_missing/full/1331.json，按核心被动 Lv.7。
 * - 资源循环：飞羽（进场2/淑女礼仪命中+1/强特+3/连携+2/终结+5/支援突击+2）
 *   → 悬落消耗全部飞羽转护羽（1:1）→ 落羽生花消耗护羽（1点/次）
 *   → C1 每消耗4护羽回1飞羽（资源回复加强）；C4 进场+5护羽；C6 强特额外+1飞羽
 * - 落羽生花双源触发：源1=任意角色强化特殊技命中（同招式至多一次）；
 *   源2=队友施加属性异常（0.5s 至多一次，额外能力门控）。次数受护羽总量约束。
 * - 影画4 苇间风：悬落/落羽生花必定暴击（critRateBonus+100），攻击+12% 加算进 atkPct 乘区。
 * - 影画6 薇薇安：以太伤害+40%（etherDmg）；悬落消耗全部护羽的特殊异放比例 ×5（5 点护羽封顶）。
 * - 影画1：预言下目标异常/紊乱伤害+16%（spec teamBuffs，enemy 目标等效全队拐力）。
 *
 * 异常结算区（2026-08 接入，releaseRatio/releaseCrit 引擎框架，参照爱芮模板）：
 * - 核心被动异放：落羽生花命中异常目标额外结算属性异常伤害，比例为每10点异常精通
 *   6.15%/3.2%/8%/0.75%/1.08%/0.32%（以太/电/火/物理/冰/风）。
 * - 影画2：以太异常积蓄效率 +25%（etherAnomalyBuildUpEfficiency，元素限定）；异放精通收益 ×130%（perTen 放大）
 *   + 无视15%全属性抗性（releaseModifier 异放限定）。
 * - 预言 DoT：悬落/落羽生花命中异常目标施加，每0.55秒 55% 攻击力以太伤害。
 * - 额外能力全队侵蚀/紊乱伤害+12%（spec teamBuffs 记录，引擎无侵蚀限定字段待近似）。
 */
import type {
  AgentCharConfigInput,
  AgentEventInput,
  AgentMechanicModule,
  AgentPanelInput,
  AgentResourceInput,
  AgentResourceResultInput,
  AgentResourceSectionsInput,
  ReleaseModifierInput,
} from '../types'
import { minusInvincibleTime } from '@/core/effectiveTime'

export const VIVIAN_ID = '1331'
export const VIVIAN_XUANLUO_MOVE_ID = '1331006'
export const VIVIAN_LUOYU_MOVE_ID = '1331008'
export const VIVIAN_C4_ATK_PCT = 12
export const VIVIAN_C6_ETHER_DMG = 40
export const VIVIAN_C1_REFUND_PER_GUARD = 4

// —— 核心被动·命运悲歌（Lv.7）异放：每 10 点异常精通 → 各元素异放比例（%） ——
export const VIVIAN_RELEASE_RATIO_PER_TEN: Record<string, number> = {
  ether: 6.15,
  electric: 3.2,
  fire: 8,
  physical: 0.75,
  ice: 1.08,
  wind: 0.32,
}
/** 影画2：异放从精通中获得的收益 ×130% */
export const VIVIAN_C2_RELEASE_MULT = 1.3
/** 影画2：异放无视 15% 全属性伤害抗性 */
export const VIVIAN_C2_RELEASE_RES_IGNORE = 15
/** 影画2：以太异常积蓄效率 +25% */
export const VIVIAN_C2_BUILDUP_EFF = 25
/** 影画6：悬落消耗全部护羽的特殊异放，比例最多提高至 5 倍（5 点护羽） */
export const VIVIAN_C6_RELEASE_MAX_MULT = 5
/** 预言 DoT：每 0.55 秒 55% 攻击力以太伤害 */
export const VIVIAN_PREDICTION_DOT_INTERVAL = 0.55
export const VIVIAN_PREDICTION_DOT_RATIO = 55

export interface VivianCycle {
  cinemaLevel: number
  /** 落羽生花总次数（源1 全队强特命中 + 源2 队友施加异常，0.5s CD 折算） */
  followUpCount: number
  /** 护羽可用量（决定落羽生花实际次数上限） */
  guardFeatherAvailable: number
  /** 飞羽总量 */
  flyFeatherTotal: number
  /** C1：累计消耗4护羽回1飞羽 */
  c1FeatherRefund: number
  /** 悬落次数（后台自动衔接 E/Q/支援突击/连携 后，不占前台） */
  xuanluoCount: number
  additionalActive: boolean
  c4AtkCoverage: number
  c4AtkBonus: number
  c6EtherDmg: number
  /** C6：悬落特殊异放增强倍数（消耗护羽，最多5点→×5） */
  c6ReleaseMult: number
  note: string
}

function setting(cfg: AgentCharConfigInput['cfg'], id: string, fallback: number): number {
  const value = Number((cfg as unknown as Record<string, unknown>)[`setting:${id}`])
  return Number.isFinite(value) ? value : fallback
}

function clampRatio(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0))
}

function whole(value: number): number {
  return Math.max(0, Math.floor(Number.isFinite(value) ? value : 0))
}

export function computeVivianCycle(input: {
  cinemaLevel: number
  /** 源1：全队强化特殊技命中次数（触发落羽生花，同一招式至多一次） */
  teamExSpecialCount: number
  /** 薇薇安自身强化特殊技次数（悬落衔接源 + 飞羽强特源） */
  selfExSpecialCount: number
  /** 源2：队友施加属性异常次数（0.5s 至多一次，受 CD 封顶） */
  teammateAnomalyCount: number
  /** 战斗时长（秒），用于 0.5s CD 封顶 */
  battleTime: number
  /** 淑女礼仪·舞步命中次数（飞羽+1/次） */
  danceHitCount: number
  /** 连携次数（飞羽+2/次） */
  chainCount: number
  /** 终结次数（飞羽+5/次） */
  ultimateCount: number
  /** 支援突击次数（飞羽+2/次） */
  assistCount: number
  additionalActive: boolean
  c4AtkCoverage: number
}): VivianCycle {
  const cinemaLevel = whole(input.cinemaLevel)
  const c4AtkCoverage = clampRatio(input.c4AtkCoverage)
  const battleTime = Math.max(0, input.battleTime)

  // 飞羽获取（整局总量，原文各招式描述）：
  //   进场 +2（核心被动）、淑女礼仪·舞步命中 +1、强化特殊技 +3（C6 额外+1）、
  //   连携 +2、终结 +5、支援突击 +2
  const selfEx = Math.max(0, whole(input.selfExSpecialCount))
  const teamEx = Math.max(0, whole(input.teamExSpecialCount))
  const flyFeatherTotal = 2
    + Math.max(0, whole(input.danceHitCount))
    + selfEx * (cinemaLevel >= 6 ? 4 : 3)
    + Math.max(0, whole(input.chainCount)) * 2
    + Math.max(0, whole(input.ultimateCount)) * 5
    + Math.max(0, whole(input.assistCount)) * 2

  // 落羽生花触发源：
  //   源1 = 全队强特命中次数（每招至多一次，耗1护羽）
  //   源2 = 队友施加异常次数（0.5s 至多一次，耗1护羽；受 0.5s CD 封顶）
  const source1 = teamEx
  const source2 = input.additionalActive
    ? Math.min(
        Math.max(0, whole(input.teammateAnomalyCount)),
        Math.max(0, Math.floor(battleTime / VIVIAN_ANOMALY_TRIGGER_CD)),
      )
    : 0
  const luoyuDemand = source1 + source2

  // 护羽可用量：C4 进场 +5；悬落消耗全部飞羽（1飞羽=1护羽）补充。
  // 护羽最多持有5点（原文），但整局可经飞羽转化补充 → 总量口径不截断单次存量。
  const initialGuardFeather = cinemaLevel >= 4 ? 5 : 0
  const guardFeatherFromFeather = Math.max(0, Math.floor(flyFeatherTotal))
  const guardFeatherAvailable = Math.max(0, initialGuardFeather + guardFeatherFromFeather)

  // 落羽生花实际次数受护羽总量约束
  const luoyuCount = Math.min(luoyuDemand, guardFeatherAvailable)

  // C1：累计消耗4点护羽回1点飞羽（资源回复加强，返还会继续转化护羽，近似整局叠加）
  const c1FeatherRefund = cinemaLevel >= 1 ? Math.floor(luoyuCount / VIVIAN_C1_REFUND_PER_GUARD) : 0
  // C6：悬落消耗全部护羽的特殊异放增强倍数（最多5点→×5）
  const c6ReleaseMult = cinemaLevel >= 6 ? VIVIAN_C6_RELEASE_MAX_MULT : 1
  // 悬落次数：后台自动衔接 E（自身强特）/Q（终结）/支援突击/连携 后，每招一次，不占前台
  const xuanluoCount = selfEx
    + Math.max(0, whole(input.ultimateCount))
    + Math.max(0, whole(input.assistCount))
    + Math.max(0, whole(input.chainCount))

  return {
    cinemaLevel,
    followUpCount: luoyuCount,
    guardFeatherAvailable,
    flyFeatherTotal,
    c1FeatherRefund,
    xuanluoCount,
    additionalActive: input.additionalActive,
    c4AtkCoverage,
    c4AtkBonus: cinemaLevel >= 4 ? VIVIAN_C4_ATK_PCT * c4AtkCoverage : 0,
    c6EtherDmg: cinemaLevel >= 6 ? VIVIAN_C6_ETHER_DMG : 0,
    c6ReleaseMult,
    note: '飞羽→护羽→落羽生花资源循环；落羽双源=全队强特命中+队友施加异常(0.5s CD)；C1 每4护羽回1飞羽；C6 悬落异放按护羽消耗×5。悬落后台衔接 E/Q/支援/连携。',
  }
}

/** 队友施加异常触发落羽生花的 0.5s CD（原文：0.5秒内至多触发一次） */
export const VIVIAN_ANOMALY_TRIGGER_CD = 0.5

function buildVivianCharConfig({ cinemaLevel, cfg, panel }: AgentCharConfigInput): void {
  const record = cfg as unknown as Record<string, unknown>
  record.vivianCinemaLevel = cinemaLevel
  record.vivianC4AtkCoverage = clampRatio(setting(cfg, 'vivian.c4AtkCoverage', 1))
  record.vivianAdditionalActive = (panel.additionalAbilityActive ?? 0) > 0
  // 落羽生花双源由 useResourceCalc 收敛注入（vivianTeamExTotal / vivianAnomalyTriggerTotal），
  // 首轮缺省时 buildExecutions 内回退到 state.exSpecialCount。
}

function cycleFromInput({ cfg, state }: Pick<AgentResourceInput, 'cfg' | 'state'>): VivianCycle {
  const record = cfg as unknown as Record<string, unknown>
  return computeVivianCycle({
    cinemaLevel: Number(record.vivianCinemaLevel ?? 0),
    // 源1：全队强特命中次数（useResourceCalc 收敛注入 vivianTeamExTotal，含薇薇安自己）
    teamExSpecialCount: Number(record.vivianTeamExTotal ?? state.exSpecialCount ?? 0),
    // 自身强特次数（飞羽强特源 + 悬落衔接源）
    selfExSpecialCount: Number(state.exSpecialCount ?? 0),
    // 源2：全队异常触发次数（useResourceCalc 收敛注入 vivianAnomalyTriggerTotal）
    teammateAnomalyCount: Number(record.vivianAnomalyTriggerTotal ?? 0),
    // 落羽生花源2 的 0.5s CD 封顶按有效战斗时间（扣 boss 无敌，core/effectiveTime.ts）
    battleTime: minusInvincibleTime(Number(record.battleTime ?? 180), cfg),
    danceHitCount: Number(record.vivianDanceHit ?? 0),
    chainCount: state.chainCountTotal ?? 0,
    ultimateCount: state.ultimateCount ?? 0,
    assistCount: Number(record.vivianAssistCount ?? 0),
    additionalActive: record.vivianAdditionalActive === true,
    c4AtkCoverage: Number(record.vivianC4AtkCoverage ?? 1),
  })
}

function buildVivianExecutions({ cfg, state, executions }: AgentResourceInput): void {
  const cycle = cycleFromInput({ cfg, state })
  if (cycle.followUpCount > 0) {
    executions.push({
      moveId: VIVIAN_LUOYU_MOVE_ID,
      moveName: '普通攻击：落羽生花（强特命中/队友施加异常触发）',
      category: 'basic',
      element: 'ether',
      count: cycle.followUpCount,
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
    })
  }
  // 悬落：后台自动衔接 E/Q/支援突击/连携 后，不占前台时间（timeBucket=backstage + 0s）
  if (cycle.xuanluoCount > 0) {
    executions.push({
      moveId: VIVIAN_XUANLUO_MOVE_ID,
      moveName: '普通攻击：裙裾浮游·悬落（E/Q/支援/连携后自动衔接）',
      category: 'basic',
      element: 'ether',
      count: cycle.xuanluoCount,
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
      timeBucket: 'backstage',
    })
  }
}

/** 强化特殊技全部合轴：后台打完，不占必做前台时间（necessaryTime=0） */
function vivianEstimateExSpecialTime(): { necessaryTime: number; comboAlignTime: number } {
  return { necessaryTime: 0, comboAlignTime: 0 }
}

function patchVivianExecutions({ cfg, state, executions }: AgentResourceInput): void {
  const cycle = cycleFromInput({ cfg, state })
  // 强化特殊技全部合轴（后台打完，不占前台）：timeBucket=backstage
  for (const exec of executions) {
    if (exec.moveId === '1331010') exec.timeBucket = 'backstage'
  }
  if (cycle.cinemaLevel < 4) return
  for (const exec of executions) {
    if (exec.moveId === VIVIAN_XUANLUO_MOVE_ID || exec.moveId === VIVIAN_LUOYU_MOVE_ID) {
      exec.critRateBonus = (exec.critRateBonus ?? 0) + 100
    }
  }
}

function applyVivianPanel({ cinemaLevel, panel, settings }: AgentPanelInput): void {
  // 面板字段与 computeVivianCycle 同源（c6EtherDmg / c4AtkBonus）。
  const c4AtkCoverage = clampRatio(settings['vivian.c4AtkCoverage'] ?? 1)
  if (cinemaLevel >= 6) panel.etherDmg = (panel.etherDmg ?? 0) + VIVIAN_C6_ETHER_DMG
  // 影画4：攻击力 +12% → 加算进局内百分比攻击乘区（atkPct），非独立乘算
  if (cinemaLevel >= 4) panel.atkPct = (panel.atkPct ?? 0) + VIVIAN_C4_ATK_PCT * c4AtkCoverage
  // 影画2 异放精通收益 ×130%（buildAnomalyEvents perTen 放大）；无视15%全抗走 releaseModifier（仅异放结算）
  if (cinemaLevel >= 2) {
    ;(panel as Record<string, unknown>).vivianCinemaLevel = cinemaLevel
    // 影画2：以太异常积蓄效率 +25%（薇薇安含物理积蓄，用元素限定字段避免污染物理积蓄）
    panel.etherAnomalyBuildUpEfficiency = (panel.etherAnomalyBuildUpEfficiency ?? 0) + VIVIAN_C2_BUILDUP_EFF
  }
}

function buildVivianResourceResult({ cfg, state }: AgentResourceResultInput) {
  return { specResources: { vivian_cycle: cycleFromInput({ cfg, state }) } }
}

function buildVivianResourceSections({ result }: AgentResourceSectionsInput) {
  const cycle = result.specResources?.vivian_cycle as VivianCycle | undefined
  if (!cycle) return []
  return [{
    id: 'vivian-cycle',
    title: '薇薇安·飞羽/护羽与落羽生花',
    summary: `落羽生花 ${cycle.followUpCount} 次 · 飞羽 ${cycle.flyFeatherTotal} · 护羽 ${cycle.guardFeatherAvailable}`,
    rows: [
      { label: '飞羽获取', value: `${cycle.flyFeatherTotal} 点`, detail: '进场2 + 淑女礼仪命中 + 强特×3 + 连携×2 + 终结×5 + 支援突击×2（C6 强特额外+1）' },
      { label: '护羽可用', value: `${cycle.guardFeatherAvailable} 点`, detail: 'C4 进场5 + 悬落消耗全部飞羽转化（1:1）' },
      { label: '悬落次数', value: `${cycle.xuanluoCount} 次`, detail: '后台自动衔接 E/Q/支援突击/连携 后，不占前台' },
      { label: '落羽生花次数', value: `${cycle.followUpCount} 次`, detail: `源1 全队强特命中 + 源2 队友施加异常（0.5s CD），受护羽总量约束` },
      { label: '影画1返还飞羽', value: `${cycle.c1FeatherRefund} 点`, detail: '每消耗4点护羽返1点飞羽（资源回复加强）' },
      { label: '影画4攻击力', value: `+${cycle.c4AtkBonus}%`, detail: '悬落/落羽生花必定暴击，攻击加算进 atkPct 乘区' },
      { label: '影画6以太伤害', value: `+${cycle.c6EtherDmg}%`, detail: '计入面板以太增伤' },
      { label: '影画6悬落异放', value: `×${cycle.c6ReleaseMult}`, detail: '悬落消耗护羽的特殊异放，最多5点→×5（按全局护羽消耗分配）' },
    ],
    footer: cycle.note,
  }]
}

/**
 * 核心被动·命运悲歌异放（releaseRatio 比例型，参照爱芮模板）。
 * 落羽生花命中异常目标 → 额外结算属性异常伤害：
 *   倍率 = 原异常单次/单跳倍率(element) × (异常精通/10 × perTen%) × 失衡加成
 * 次数 = 落羽生花次数 × 命中异常目标占比（vivian.releaseCoverage 滑块，默认满）。
 * 落羽生花触发源（原文）：
 *   - 技能自带：任意角色发动[强化特殊技]命中目标后消耗 1 护羽发动（同一招式至多一次）
 *   - 额外能力：队伍其他角色施加属性异常时消耗 1 护羽发动（0.5s 至多一次）
 * C2：perTen ×1.3（精通收益 130%）；C6：悬落特殊异放 perTen ×5（消耗 5 点护羽封顶）。
 */
function buildVivianAnomalyEvents({ cfg, state, events, totalTime }: AgentEventInput): void {
  const cycle = cycleFromInput({ cfg, state })
  const cinemaLevel = cycle.cinemaLevel
  const followUpCount = cycle.followUpCount
  if (followUpCount <= 0) return

  // 命中异常目标占比：异常角色异常覆盖率高，默认满覆盖（用户口径 2026-08）
  const hitAnomalyRatio = clampRatio(Number((cfg as unknown as Record<string, unknown>)['setting:vivian.releaseCoverage'] ?? 1))
  const releaseCount = Math.max(0, Math.floor(followUpCount * hitAnomalyRatio))

  const perTen: Record<string, number> = {}
  for (const [element, ratio] of Object.entries(VIVIAN_RELEASE_RATIO_PER_TEN)) {
    perTen[element] = cinemaLevel >= 2 ? ratio * VIVIAN_C2_RELEASE_MULT : ratio
  }

  // 落羽生花命中异常目标触发异放（dominant 元素按异常覆盖率分配，引擎处理）
  events.push({
    eventId: 'vivian_luoyu_release',
    eventName: '落羽生花·异放',
    eventType: 'release',
    element: 'dominant',
    carrierMoveId: VIVIAN_LUOYU_MOVE_ID,
    carrierMoveName: '普通攻击：落羽生花',
    // 异放随落羽生花（资源驱动特殊普攻，消耗护羽）触发：轴内占比 = 载体轴内单位/载体总次数。
    // 载体总次数必须用落羽生花次数本身（carrierTotalCount）——事件次数 = 落羽生花×命中异常占比
    // 已被占比稀释，作分母会缩小轴内占比。特殊普攻非 filler 兜底可打出：不捏轴=轴外
    // （2026-08 审计，用户口径「计数轴内消耗了多少资源」）
    followCarrierInStun: true,
    carrierTotalCount: cycle.followUpCount,
    count: releaseCount,
    formula: 'releaseMultiplier = 原异常单次倍率 × (异常精通/10 × 比例%) × (失衡?1.5:1)',
    fields: ['anomalyProficiency', 'VIVIAN_RELEASE_RATIO_PER_TEN', 'followUpCount', 'vivian.releaseCoverage'],
    releaseRatio: {
      basis: 'anomalyProficiency',
      perTenByElement: perTen,
      stunBonusPct: 50,
    },
    note: `落羽生花命中异常目标触发（${followUpCount} 次 × 命中异常占比 ${(hitAnomalyRatio * 100).toFixed(0)}% = ${releaseCount} 次）${cinemaLevel >= 2 ? '；影画2 精通收益×130%' : ''}${cinemaLevel >= 6 ? '；影画6 悬落特殊异放另行记录' : ''}`,
  })

  // 影画6：悬落消耗全部护羽触发特殊异放，比例按护羽消耗提高（最多5点→×5）。
  // 总量口径：悬落异放次数 = 落羽生花次数（护羽消耗载体），倍率按 c6ReleaseMult 全局折算。
  if (cinemaLevel >= 6 && cycle.c6ReleaseMult > 1) {
    const c6PerTen: Record<string, number> = {}
    for (const [element, ratio] of Object.entries(VIVIAN_RELEASE_RATIO_PER_TEN)) {
      c6PerTen[element] = ratio * (cinemaLevel >= 2 ? VIVIAN_C2_RELEASE_MULT : 1) * cycle.c6ReleaseMult
    }
    events.push({
      eventId: 'vivian_xuanluo_c6_release',
      eventName: '悬落·特殊异放（影画6）',
      eventType: 'release',
      element: 'dominant',
      carrierMoveId: VIVIAN_XUANLUO_MOVE_ID,
      carrierMoveName: '普通攻击：裙裾浮游·悬落',
      // 同落羽生花异放：跟随载体（悬落，消耗护羽的特殊普攻），分母用落羽生花次数（护羽消耗载体）
      followCarrierInStun: true,
      carrierTotalCount: cycle.followUpCount,
      count: releaseCount,
      formula: 'releaseMultiplier = 原异常单次倍率 × (异常精通/10 × 比例% × c6ReleaseMult) × (失衡?1.5:1)',
      fields: ['anomalyProficiency', 'VIVIAN_RELEASE_RATIO_PER_TEN', 'c6ReleaseMult', 'followUpCount'],
      releaseRatio: {
        basis: 'anomalyProficiency',
        perTenByElement: c6PerTen,
        stunBonusPct: 50,
      },
      note: `影画6：悬落消耗全部护羽的特殊异放，比例 ×${cycle.c6ReleaseMult}（按全局护羽消耗分配，最多5点→×5）`,
    })
  }

  // 预言 DoT：悬落/落羽生花命中异常目标施加，每 0.55 秒 55% 攻击力以太伤害。
  // 次数 = floor(战斗时长 × 异常覆盖占比 × 命中异常占比 / 0.55)；异常角色默认满覆盖。
  // 战斗时长扣 boss 无敌（dot 不在无敌期间结算，core/effectiveTime.ts）。
  const dotCoverage = clampRatio(Number((cfg as unknown as Record<string, unknown>)['setting:vivian.dotCoverage'] ?? 1))
  const dotEffectiveSeconds = minusInvincibleTime(totalTime, cfg)
  const dotTicks = Math.max(0, Math.floor((dotEffectiveSeconds * dotCoverage * hitAnomalyRatio) / VIVIAN_PREDICTION_DOT_INTERVAL))
  if (dotTicks > 0) {
    events.push({
      eventId: 'vivian_prediction_dot',
      eventName: '薇薇安的预言 DoT',
      eventType: 'direct_damage',
      element: 'ether',
      carrierMoveId: VIVIAN_LUOYU_MOVE_ID,
      carrierMoveName: '薇薇安的预言',
      count: dotTicks,
      damageMultiplier: VIVIAN_PREDICTION_DOT_RATIO,
      formula: `每 ${VIVIAN_PREDICTION_DOT_INTERVAL}s 造成 ${VIVIAN_PREDICTION_DOT_RATIO}% 攻击力以太伤害；次数 = floor(战斗时长 × 异常覆盖占比 × 命中异常占比 / ${VIVIAN_PREDICTION_DOT_INTERVAL})`,
      fields: ['totalTime', 'vivian.dotCoverage', 'vivian.releaseCoverage', 'VIVIAN_PREDICTION_DOT_INTERVAL', 'VIVIAN_PREDICTION_DOT_RATIO'],
      note: `预言 DoT：悬落/落羽生花命中异常目标施加，目标脱离异常状态时结束；次数按异常覆盖时长近似（${(dotCoverage * 100).toFixed(0)}% × ${(hitAnomalyRatio * 100).toFixed(0)}% × ${dotEffectiveSeconds}s，已扣无敌）`,
    })
  }
}

/** 影画2：异放无视 15% 全属性伤害抗性（releaseModifier 仅作用于异放结算，不作用于普通伤害） */
function vivianReleaseModifier({ panels }: ReleaseModifierInput): { enemyResReduction: number; note: string } {
  const hasC2 = panels.some(panel => (panel.vivianCinemaLevel ?? 0) >= 2)
  return hasC2
    ? { enemyResReduction: VIVIAN_C2_RELEASE_RES_IGNORE, note: '；影画2：异放无视 15% 全属性伤害抗性（releaseModifier 异放限定）' }
    : { enemyResReduction: 0, note: '' }
}

export const vivianMechanic: AgentMechanicModule = {
  id: 'agent:vivian',
  agentIds: [VIVIAN_ID],
  name: '薇薇安·命运悲歌',
  description: '落羽生花追击、护羽/飞羽折算、影画4必暴与影画6以太增伤；核心异放/预言DoT已接入（releaseRatio 框架）。',
  settings: [
    { id: 'vivian.c4AtkCoverage', label: '影画4攻击力覆盖率', description: '悬落/落羽生花命中触发攻击力+12%的整局覆盖率', default: 1, min: 0, max: 1, step: 0.05, suffix: '%' },
    { id: 'vivian.dotCoverage', label: '预言 DoT 异常覆盖占比', description: '预言 DoT 命中异常目标期间的整局占比（异常角色默认满覆盖）', default: 1, min: 0, max: 1, step: 0.05, suffix: '%' },
    { id: 'vivian.releaseCoverage', label: '异放命中异常目标占比', description: '落羽生花/悬落命中处于异常状态目标的整局占比（异常角色默认满覆盖）', default: 1, min: 0, max: 1, step: 0.05, suffix: '%' },
  ],
  applyPanel: applyVivianPanel,
  buildCharConfig: buildVivianCharConfig,
  buildExecutions: buildVivianExecutions,
  patchExecutions: patchVivianExecutions,
  estimateExSpecialTime: vivianEstimateExSpecialTime,
  buildResourceResult: buildVivianResourceResult,
  resourceSections: buildVivianResourceSections,
  buildAnomalyEvents: buildVivianAnomalyEvents,
  releaseModifier: vivianReleaseModifier,
}

export default vivianMechanic
