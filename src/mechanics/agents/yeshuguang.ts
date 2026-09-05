/**
 * 叶瞬光（1431）—— 用户确认口径
 *
 * 无需失衡轴：白毛（明心境）关键伤害一律满易伤；真失衡只送连携。
 * 帷幕易伤 = min(最终易伤, 2.1)；影画4 = min(..., 3.0)。
 *
 * 资源：
 * - 局外剑势：attack_data_0 + 帷幕×3 + C1 进场6；照影耗 6 启动。
 * - 明心境青溟剑势：进入固定 6（≠ 局外剑势）。
 * - 观止：基础 2；C2 每耗 1 青溟剑势 +1。
 *
 * 轴（每轮明心境，setting: yeshuguang.formAxis）：
 * - full：打满 (灭#1+极)×2 + 扶摇 + 飞光(总观止/6×满档倍率线性)+ 收尾
 * - 凛刃：白毛物理直伤，紊乱按物理继承（无需单独标签）
 * - 非白毛：通用普攻/连携(吃覆盖率易伤)/强特(基本无易伤)；局外剑势靠 attack_data_0 链接
 * - short_pair / short_mie：少打灭极**只省时间不省资源**——每轮仍消耗满 6 点青溟剑势
 *   （归尘按「剑势耗尽」触发、飞光「持续消耗直至耗尽」），省下的段数换成更快的飞光；
 *   观止按每轮 6 点结算 ⇒ 三档轴的观止/飞光当量相同，短轴亏的是灭极段本身的时间与伤害
 *
 * 收尾：喧响逐云进 → 斩妄；照影/琉音转大进 → 归尘。
 * C6 明灯愿：进场 2 + 每进明心境 1；强化次数 = floor(次数/3) 把归尘换成斩妄；
 * 每次白毛收尾（归尘/斩妄）附伤 1500% 攻击力物理（吃满易伤）。
 */
import type {
  AgentCharConfigInput,
  AgentExSpecialTimeInput,
  AgentExSpecialTimeEstimate,
  AgentMechanicModule,
  AgentResourceInput,
  AgentResourceResultInput,
  AgentResourceSectionsInput,
} from '../types'
import type { AgentSkills, SkillMove } from '@/types/catalog'
import type { CharacterOperationConfig, MechanicSetting, SkillExecution } from '@/types/resource'
import { fmt } from '@/utils/format'

export const YESHUGUANG_ID = '1431'

const MOVE = {
  entryUlt: '1431025',
  entryAssist: '1431028',
  mie1: '1431013',
  ji: '1431009',
  fuyao: '1431017',
  feiguang: '1431018',
  guichen: '1431019',
  zhanwang: '1431027',
  c6Attach: '1431_c6_finisher_attach',
} as const

export const YESHUGUANG_FULL_STUN_MOVES = new Set<string>([
  MOVE.entryUlt,
  MOVE.entryAssist,
  MOVE.mie1,
  MOVE.ji,
  MOVE.fuyao,
  MOVE.feiguang,
  MOVE.guichen,
  MOVE.zhanwang,
  MOVE.c6Attach,
  '1431026',
  '1431006', '1431007', '1431008',
  '1431010', '1431011', '1431012',
  '1431034', '1431035',
])

// @fact agent:1431/帷幕易伤 口径: 帷幕基于开帷幕时的失衡易伤倍率，玩家先把易伤buff上满再开 ⇒ 取「boss基础失衡易伤 + 全部失衡易伤加成」，再按影画封顶（C0-3 = 2.1 / C4+ = 3.0） | 据 用户@2026-09-01·复核@2026-09-04 | 验 src/mechanics/__tests__/yeshuguang.test.ts | 锚 src/mechanics/agents/yeshuguang.ts#veilStunMultiplier | 信 确认

/**
 * 帷幕易伤的最终失衡倍率。
 *
 * 之前的实现是 min(boss基础, cap)——boss 基础 1.5 永远小于 cap 2.1/3.0，**封顶从未生效**，
 * 影画4 的「上限提升至 200%」在引擎里完全空转（2026-09-01 归档校准排查发现）。
 * 正确口径（用户裁决）：帷幕吃满「基础 + 队友给的全部失衡易伤加成」，再按影画封顶。
 *
 * @param bossStunVuln Boss 基础失衡易伤倍率（configStore.enemy.stunVuln，默认 1.5）
 * @param bonusPct     失衡易伤加成合计（百分点，已按 capAlways 钳过）
 * @param cap          影画封顶倍率（C0-3 = 2.1、C4+ = 3.0）
 */
export function veilStunMultiplier(bossStunVuln: number, bonusPct: number, cap: number): number {
  return Math.min(Math.max(0, bossStunVuln) + Math.max(0, bonusPct) / 100, cap)
}

export type YeshuguangFormAxis = 'full' | 'short_pair' | 'short_mie'

const SWORD_MAX = 6
const FORM_SWORD = 6
const BASE_GUANZHI = 2
const FEIGUANG_FULL_GUANZHI = 6
const ZHAOYING_COST = 6
const C6_ATTACH_MULT = 1500
const C6_MINGDENG_ENTRY = 2
const C6_MINGDENG_CAP_NOTE = 4

function findMove(skills: AgentSkills | undefined, id: string): SkillMove | null {
  if (!skills) return null
  for (const c of skills.categories) {
    const m = c.moves.find(x => x.id === id)
    if (m) return m
  }
  return null
}

function rowVal(move: SkillMove | null | undefined, rowId: string): number {
  const row = move?.rows?.find(r => r.id === rowId)
  const vals = row?.values ?? []
  if (!vals.length) return 0
  return Number(vals[11] ?? vals[vals.length - 1] ?? 0) || 0
}

function cfgNum(cfg: CharacterOperationConfig, key: string, fallback: number): number {
  const raw = Number((cfg as unknown as Record<string, unknown>)[`setting:${key}`] ?? fallback)
  return Number.isFinite(raw) ? raw : fallback
}

/** 自动选轴的超支阈值（秒）：timeBudgetExcess 超过此值才退化，避免量化残差（~1s）误触降轴 */
// @fact agent:1431/自动选轴 口径: 明心境轴默认自动(-1)，按**真实时间压力**（cfg.timePressureSeconds>5s，不是累加的 timeBudgetExcess）逐级退化 full→short_pair→short_mie，换轴时清零旧轴折叠残差；仍超预算由外层 interactionScale 缩交互兜底 | 据 用户@2026-09-05 | 验 src/mechanics/__tests__/yeshuguang.test.ts | 锚 src/mechanics/agents/yeshuguang.ts#cfgAxis | 信 确认
const AUTO_AXIS_DEGRADE_THRESHOLD = 5

function cfgAxis(cfg: CharacterOperationConfig): YeshuguangFormAxis {
  const record = cfg as unknown as Record<string, unknown>
  const raw = String(record[`setting:yeshuguang.formAxis`] ?? 'auto')
  if (raw === 'short_pair' || raw === 'short_mie' || raw === 'full') return raw
  // 兼容数值滑块：0 full / 1 short_pair / 2 short_mie / -1 auto
  const n = Number(raw)
  if (n === 1) return 'short_pair'
  if (n === 2) return 'short_mie'
  if (n === 0) return 'full'
  // auto：时间不够时按超支信号逐级退化（estimateExSpecialTime 写 yeshuguangAutoAxis）
  const auto = record.yeshuguangAutoAxis
  if (auto === 'short_pair' || auto === 'short_mie') return auto
  return 'full'
}

export interface YeshuguangCycleInput {
  ultimateCount: number
  giftUltCount: number
  zhaoyingCountSetting: number
  outsideSwordGain: number
  cinemaLevel: number
  battleTime: number
  formAxis: YeshuguangFormAxis
}

export interface YeshuguangCycleResult {
  formAxis: YeshuguangFormAxis
  decibelForms: number
  giftForms: number
  zhaoyingForms: number
  totalForms: number
  outsideSword: number
  /** 本轴每轮消耗的青溟剑势（用于 C2 观止） */
  swordSpentPerForm: number
  guanzhiPerForm: number
  /** 全局飞光：总观止/6（满档倍率当量，线性） */
  feiguangFullCasts: number
  /** @deprecated 兼容旧字段，= feiguangFullCasts */
  feiguangPerForm: number
  feiguangScaleEach: number
  miePerForm: number
  jiPerForm: number
  fuyaoPerForm: number
  finisherZhanwang: number
  finisherGuichen: number
  /** C6 明灯愿总层（进场2+每轮+1） */
  mingdengTotal: number
  /** floor(明灯愿/3) 归尘→斩妄次数 */
  mingdengUpgrade: number
  /** 白毛收尾附伤次数（= totalForms） */
  c6AttachCount: number
}

/**
 * **未接线**（2026-09-05 核对）：全仓零调用点，真实飞光一律走 `总观止 ÷ 6` 线性
 * （见 computeYeshuguangCycle）。下面的 4/10/5/12 是历史口径，留着会误导（AGENTS 规则 16：
 * 挂着「用户确认」的死口径比没注释更危险）——要么接线要么删除，别再当依据引用。
 *
 * 短轴飞光次数（用户确认）：
 * short_pair：0–1 命 4 / 2 命+ 10
 * short_mie：0–1 命 5 / 2 命+ 12
 */
export function shortAxisFeiguangCount(axis: YeshuguangFormAxis, cinemaLevel: number): number {
  const c2 = cinemaLevel >= 2
  if (axis === 'short_pair') return c2 ? 10 : 4
  if (axis === 'short_mie') return c2 ? 12 : 5
  return 1
}

// @fact agent:1431/短轴资源 口径: 三档轴（打满/灭极/仅灭）**每轮都消耗满 6 点青溟剑势**——归尘触发条件是「青溟剑势耗尽」、飞光是「持续消耗直至耗尽」，所以短轴只省段数与时间，不省资源也不省观止（C2+ 观止/轮 = 2+6 = 8 三档相同）；旧实现按 6/3/2 递减，与它自己的注释「剩余资源压进观止→飞光」相反 | 据 用户@2026-09-05 + nanoka 1431 招式原文 | 验 src/mechanics/__tests__/yeshuguang.test.ts#三档轴每轮资源消耗相同 | 锚 src/mechanics/agents/yeshuguang.ts#computeYeshuguangCycle | 信 确认
// @fact agent:1431/轮数实数化 口径: 明心境轮数（喧响进轮/转大赠轮/照影轮）与定风波时间一律以**实数**参与收敛，不再模块内 floor —— 局外剑势 ∝ 平A时间，`floor(剑势/6)` 一次翻转就是一整轮（full 轴 ≈10.9s），是「平A→剑势→轮数→必要时间→平A」环增益 >1 的原产地；实数化语义 = 最后一轮只打 0.4 轮、段数/观止/飞光/收尾同比例兑现（实战 180s 到点）。手动滑块 zhaoyingCount 仍取整（用户显式指定的次数，非资源推导量） | 据 用户@2026-09-05「实数化确实很好…做吧」 | 验 src/mechanics/__tests__/yeshuguang.test.ts#轮数实数化 | 锚 src/mechanics/agents/yeshuguang.ts#computeYeshuguangCycle | 信 确认
export function computeYeshuguangCycle(input: YeshuguangCycleInput): YeshuguangCycleResult {
  const cinema = Math.max(0, Math.floor(input.cinemaLevel || 0))
  const axis = input.formAxis ?? 'full'
  // ===== 轮数实数化（2026-09-05 用户裁决「做吧」）=====
  // 引擎本来就有连续松弛骨架（坑17：迭代期次数以实数参与 + 终局 floor + 预算内加回；1051 的
  // `ultForTime` 是同款 targeted 前例），但这里三处 `Math.floor` 又把它离散化回去 —— 其中
  // `autoZhao = floor(局外剑势/6)` 直接挂在平A时间上（剑势 ∝ 平A），正是
  // 「平A↑→剑势↑→轮数+1整轮→必要时间↑→平A↓」环增益 >1 的来源：一次 floor 翻转就是一整轮
  // （full 轴 ≈10.9s），阻尼/封顶都只是在重排吸引盆。
  // 实数化后是"最后一轮只打 0.4 轮"——实战语义本来就是 180s 到点、这一轮的段数与伤害都只兑现
  // 0.4。手动滑块（zhaoSetting）仍是整数：那是用户显式指定的次数，不是资源推导量。
  let decibelForms = Math.max(0, input.ultimateCount || 0)
  let giftForms = Math.max(0, input.giftUltCount || 0)
  const outside = Math.max(0, Number(input.outsideSwordGain) || 0)
  const autoZhao = outside / ZHAOYING_COST
  const zhaoSetting = Math.floor(input.zhaoyingCountSetting)
  let zhaoyingForms = Math.max(0, zhaoSetting >= 0 ? Math.min(zhaoSetting, autoZhao) : autoZhao)
  let totalForms = decibelForms + giftForms + zhaoyingForms

  let miePerForm = 0
  let jiPerForm = 0
  let fuyaoPerForm = 0
  let swordSpentPerForm = 0

  if (axis === 'full') {
    miePerForm = 2
    jiPerForm = 2
    fuyaoPerForm = 1
    swordSpentPerForm = FORM_SWORD // 6
  } else if (axis === 'short_pair') {
    // 灭#1+极各一段（省掉第二段灭极与扶摇），但**本轮 6 点青溟剑势照样打完**：
    // 归尘的触发条件是「青溟剑势耗尽」，飞光是「持续消耗直至耗尽」——省下的段数不是省下的
    // 资源，而是**换成更快的飞光把同一批剑势花掉**（用户口径 2026-09-05）。
    miePerForm = 1
    jiPerForm = 1
    fuyaoPerForm = 0
    swordSpentPerForm = FORM_SWORD
  } else {
    // short_mie：仅灭#1，同理仍打满 6 点剑势，只是更快
    miePerForm = 1
    jiPerForm = 0
    fuyaoPerForm = 0
    swordSpentPerForm = FORM_SWORD
  }

  // 观止：基础 2 + C2 每耗 1 青溟剑势 +1
  const guanzhiPerForm = BASE_GUANZHI + (cinema >= 2 ? swordSpentPerForm : 0)
  // 飞光全局线性：总观止/6 × 满档倍率行（表值=耗 6 观止）；不再拆多次 hit
  const guanzhiTotal = guanzhiPerForm * totalForms
  const feiguangFullCasts = guanzhiTotal / FEIGUANG_FULL_GUANZHI
  const feiguangPerForm = totalForms > 0 ? feiguangFullCasts / totalForms : 0
  const feiguangScaleEach = 1 // 行上直接用满档倍率 × feiguangFullCasts 当 count 缩放

  // 基础收尾
  let finisherZhanwang = decibelForms
  let finisherGuichen = giftForms + zhaoyingForms

  // C6 明灯愿：进场 2 + 每进明心境 1；强化次数 = floor(总层/3) 把归尘换成斩妄
  const mingdengTotal = cinema >= 6 ? C6_MINGDENG_ENTRY + totalForms : 0
  const mingdengUpgrade = cinema >= 6 ? Math.floor(mingdengTotal / 3) : 0
  if (mingdengUpgrade > 0 && finisherGuichen > 0) {
    const up = Math.min(mingdengUpgrade, finisherGuichen)
    finisherGuichen -= up
    finisherZhanwang += up
  }

  const c6AttachCount = cinema >= 6 ? totalForms : 0

  return {
    formAxis: axis,
    decibelForms,
    giftForms,
    zhaoyingForms,
    totalForms,
    outsideSword: outside,
    swordSpentPerForm,
    guanzhiPerForm,
    feiguangFullCasts,
    feiguangPerForm,
    feiguangScaleEach,
    miePerForm,
    jiPerForm,
    fuyaoPerForm,
    finisherZhanwang,
    finisherGuichen,
    mingdengTotal,
    mingdengUpgrade,
    c6AttachCount,
  }
}

// @fact agent:1431/载物 未建模: 载物只是青溟剑势的溢出暂存，而总量计算器天然不做上限截断，溢出本就不丢 ⇒ 建模它没有任何数值意义，不补 | 据 用户@2026-09-01·复核@2026-09-04 | 验 src/mechanics/__tests__/yeshuguang.test.ts | 锚 src/mechanics/agents/yeshuguang.ts#computeOutsideSwordGain | 信 确认
// @fact agent:1431/局外连接段 决: **局外**（非明心境）连接段不建执行行——它的占用时间就是平A池（basicAttackTime，按 atk0PerSec 攒青溟剑势）；明心境内的连接段（斩流光灭/极/扶摇）**照常建行**。总量计算器按资源算招式而非按连段顺序 | 据 用户@2026-09-01·复核@2026-09-05（主体加限定词：曾被读成"明心境连接段不建行"并输出错误归因） | 验 src/mechanics/__tests__/yeshuguang.test.ts | 锚 src/mechanics/agents/yeshuguang.ts#computeOutsideSwordGain | 信 确认
export function computeOutsideSwordGain(cfg: CharacterOperationConfig, state: {
  basicAttackTime?: number
  exSpecialCount?: number
  ultimateCount?: number
  dodgeCounterCount?: number
  chainCountTotal?: number
}): number {
  const record = cfg as unknown as Record<string, unknown>
  const initial = Math.max(0, Number(record.yeshuguangSwordInitial ?? 0) || 0)
  const atk0PerSec = Math.max(0, Number(record.yeshuguangAtk0PerSec ?? 0) || 0)
  const basic = Math.max(0, state.basicAttackTime ?? 0)
  const fromBasic = basic * atk0PerSec
  const perDodge = Math.max(0, Number(record.yeshuguangAtk0Dodge ?? 0) || 0)
  const perEx = Math.max(0, Number(record.yeshuguangAtk0Ex ?? 0) || 0)
  const perChain = Math.max(0, Number(record.yeshuguangAtk0Chain ?? 0) || 0)
  const fromDodge = (cfg.dodgeCounterCount ?? 0) * perDodge
  // 定风波：文本明确发动后 +1 青溟剑势（局外）；attack_data_0 表值为 0，单独 +1/次
  const fromEx = (state.exSpecialCount ?? 0) * (perEx + 1)
  const fromChain = (state.chainCountTotal ?? 0) * perChain
  // 额外能力·溯影惊鸿：队友开帷幕 +3 局外剑势/次。手动滑块 >0 优先；否则自动用全队帷幕次数
  //（useResourceCalc 收敛注入 teamVeilCountTotal：照 veilCount + 爱芮/叶瞬光大招 + 千夏强特，2026-08-31）。
  const manualCurtains = Math.max(0, Math.floor(cfgNum(cfg, 'yeshuguang.teamCurtainCount', 0) || 0))
  const autoCurtains = Math.max(0, Math.floor(Number(record.teamVeilCountTotal ?? 0) || 0))
  const curtains = manualCurtains > 0 ? manualCurtains : autoCurtains
  const aa = Number(record.yeshuguangAdditionalAbilityActive ?? 0) > 0
  const fromCurtain = aa ? curtains * 3 : 0
  return initial + fromBasic + fromDodge + fromEx + fromChain + fromCurtain
}

function pushExec(
  executions: SkillExecution[],
  moveId: string,
  moveName: string,
  category: string,
  count: number,
  actionTime: number,
  dmg: number,
  note: string,
  extra?: Partial<SkillExecution>,
) {
  if (count <= 0 || dmg <= 0) return
  executions.push({
    moveId,
    moveName,
    category,
    count,
    actionTime,
    comboAlignRatio: 0,
    totalTime: actionTime * count,
    totalComboAlignTime: 0,
    energyConsume: 0,
    totalEnergyConsume: 0,
    decibelRecovery: 0,
    totalDecibelRecovery: 0,
    energyRecovery: 0,
    totalEnergyRecovery: 0,
    damageMultiplier: dmg,
    damageMultiplierOverride: true,
    element: 'physical',
    skillTableNote: note,
    ...extra,
  } as SkillExecution)
}

function resolveCycle(cfg: CharacterOperationConfig, state: {
  ultimateCount?: number
  exSpecialCount?: number
  basicAttackTime?: number
  chainCountTotal?: number
}): YeshuguangCycleResult {
  const record = cfg as unknown as Record<string, unknown>
  const cinema = Math.max(0, Math.floor(Number(record.yeshuguangCinemaLevel ?? 0)))
  const outside = computeOutsideSwordGain(cfg, state)
  const gift = Math.max(0, Math.floor(Number(record.yeshuguangGiftUltCount ?? 0) || 0))
  return computeYeshuguangCycle({
    ultimateCount: state.ultimateCount ?? 0,
    giftUltCount: gift,
    zhaoyingCountSetting: cfgNum(cfg, 'yeshuguang.zhaoyingCount', -1),
    outsideSwordGain: outside,
    cinemaLevel: cinema,
    battleTime: cfg.battleTime ?? 180,
    formAxis: cfgAxis(cfg),
  })
}

function buildCharConfig({ skills, cinemaLevel, panel, cfg }: AgentCharConfigInput): void {
  const cinema = cinemaLevel ?? 0
  const record = cfg as unknown as Record<string, unknown>
  record.yeshuguangCinemaLevel = cinema
  // 自动选轴：初始打满（full），estimateExSpecialTime 按超支信号逐级退化。
  if (record.yeshuguangAutoAxis !== 'short_pair' && record.yeshuguangAutoAxis !== 'short_mie') {
    record.yeshuguangAutoAxis = 'full'
  }

  cfg.yeshuguangSwordInitial = cinema >= 1 ? 6 : 0
  if (cinema >= 4) {
    cfg.initialDecibelGift = (cfg.initialDecibelGift ?? 0) + 1000
  }

  cfg.ultimateMoveId = MOVE.entryUlt
  const ult = findMove(skills, MOVE.entryUlt)
  if (ult) cfg.ultimateActionTime = ult.actionTime ?? cfg.ultimateActionTime

  const dmg: Record<string, number> = {}
  const times: Record<string, number> = {}
  for (const id of Object.values(MOVE)) {
    if (id === MOVE.c6Attach) continue
    const mv = findMove(skills, id)
    dmg[id] = rowVal(mv, 'damage')
    times[id] = mv?.actionTime ?? 0
  }
  record.yeshuguangMoveDmg = dmg
  record.yeshuguangMoveTimes = times

  const basicIds = ['1431001', '1431002', '1431003', '1431005']
  let basicAtk0 = 0
  let basicTime = 0
  for (const id of basicIds) {
    const mv = findMove(skills, id)
    basicAtk0 += rowVal(mv, 'attack_data_0')
    basicTime += mv?.actionTime ?? 0
  }
  record.yeshuguangAtk0PerSec = basicTime > 0 ? basicAtk0 / basicTime : 0
  record.yeshuguangAtk0Dodge = rowVal(findMove(skills, '1431022'), 'attack_data_0')
  record.yeshuguangAtk0Ex = rowVal(findMove(skills, '1431016'), 'attack_data_0')
  record.yeshuguangAtk0Chain = rowVal(findMove(skills, '1431024'), 'attack_data_0')
  record.yeshuguangAdditionalAbilityActive = (panel as any)?.additionalAbilityActive ?? 0
}

function buildExecutions({ cfg, state, executions }: AgentResourceInput): void {
  const record = cfg as unknown as Record<string, unknown>
  const dmg = (record.yeshuguangMoveDmg ?? {}) as Record<string, number>
  const times = (record.yeshuguangMoveTimes ?? {}) as Record<string, number>
  const cycle = resolveCycle(cfg, state)
  record.yeshuguangCycle = cycle
  record.yeshuguangOutsideSword = cycle.outsideSword

  if (cycle.totalForms <= 0) return

  const forms = cycle.totalForms
  const axisLabel = cycle.formAxis === 'full' ? '打满'
    : cycle.formAxis === 'short_pair' ? '短轴·灭极'
      : '短轴·仅灭'

  pushExec(
    executions, MOVE.entryAssist, '登场技：照影', 'assist',
    cycle.zhaoyingForms, times[MOVE.entryAssist] ?? 0, dmg[MOVE.entryAssist] ?? 0,
    `照影进入 ×${cycle.zhaoyingForms}（耗局外剑势 6/次）`,
  )

  const mie = cycle.miePerForm * forms
  const ji = cycle.jiPerForm * forms
  const fuyao = cycle.fuyaoPerForm * forms

  pushExec(
    executions, MOVE.mie1, '普通攻击：明心境·斩流光 灭 #1', 'basic',
    mie, times[MOVE.mie1] ?? 0, dmg[MOVE.mie1] ?? 0,
    `斩流光·灭#1 ×${mie}（${axisLabel}，每轮 ${cycle.miePerForm}）`,
  )
  pushExec(
    executions, MOVE.ji, '普通攻击：明心境·斩流光 极', 'basic',
    ji, times[MOVE.ji] ?? 0, dmg[MOVE.ji] ?? 0,
    `斩流光·极 ×${ji}（${axisLabel}，每轮 ${cycle.jiPerForm}）`,
  )
  pushExec(
    executions, MOVE.fuyao, '普通攻击：明心境·扶摇势', 'basic',
    fuyao, times[MOVE.fuyao] ?? 0, dmg[MOVE.fuyao] ?? 0,
    `扶摇势 ×${fuyao}`,
  )

  // 飞光：全局线性 总观止/6 × 满档倍率行（表=耗6观止）；count=1，倍率与时间按当量缩放
  const fgCasts = cycle.feiguangFullCasts
  const fgDmg = (dmg[MOVE.feiguang] ?? 0) * fgCasts
  const fgTime = (times[MOVE.feiguang] ?? 0) * fgCasts
  if (fgCasts > 0 && fgDmg > 0) {
    pushExec(
      executions, MOVE.feiguang, '强化特殊技：明心境·飞光', 'special',
      1, fgTime, fgDmg,
      `飞光 总观止 ${fmt(cycle.guanzhiPerForm * forms, 1)} ÷6 = ${fmt(fgCasts, 3)} 满档当量（${axisLabel}；线性）`,
    )
  }

  pushExec(
    executions, MOVE.zhanwang, '终结技：斩妄开天', 'chain',
    cycle.finisherZhanwang, times[MOVE.zhanwang] ?? 0, dmg[MOVE.zhanwang] ?? 0,
    `斩妄开天 ×${cycle.finisherZhanwang}（喧响逐云进${cycle.mingdengUpgrade > 0 ? ` + 明灯愿强化 ${cycle.mingdengUpgrade}` : ''}）`,
  )
  pushExec(
    executions, MOVE.guichen, '强化特殊技：明心境·归尘', 'special',
    cycle.finisherGuichen, times[MOVE.guichen] ?? 0, dmg[MOVE.guichen] ?? 0,
    `归尘 ×${cycle.finisherGuichen}（照影/转大进收尾）`,
  )

  // C6：每次白毛收尾附伤 1500%（吃满易伤）
  if (cycle.c6AttachCount > 0) {
    pushExec(
      executions, MOVE.c6Attach, '影画6·收尾附伤（明灯愿）', 'chain',
      cycle.c6AttachCount, 0, C6_ATTACH_MULT,
      `明灯愿附伤 ×${cycle.c6AttachCount}（每轮白毛收尾 1500% 攻击力，吃满易伤）`,
      { skillDamageTarget: 'ultimate' as any },
    )
  }
}

function estimateExSpecialTime({ cfg, exSpecialCount, ultimateCount }: AgentExSpecialTimeInput): AgentExSpecialTimeEstimate | null {
  const record = cfg as unknown as Record<string, unknown>
  // 自动选轴：**真实时间压力**（cfg.timePressureSeconds = 本槽物化行 − 队友占完后可用前台）
  // 超过阈值时逐级退化 full→short_pair→short_mie，并把旧轴的折叠残差清零——否则换轴后 necessary
  // 仍被旧轴残差虚高、平A池照样被挤 0。
  // 判据历史上用的是累加的 timeBudgetExcess，而它 pass0 会被平A池满额发放灌出一个后续再也不会
  // 出现的巨大值（只增不减）→ 「其实装得下」的队被误判超支、一路退化到仅灭，于是 auto 被人为
  // 关掉（default 0 打满）。改读诚实信号后 auto 重新可用（2026-09-05 用户口径：时间不够就该
  // 自动打短轴压时间，甚至减交互，把时间弄回 180s 内）。
  const rawAxis = String(record[`setting:yeshuguang.formAxis`] ?? 'auto')
  const isAuto = rawAxis !== 'full' && rawAxis !== 'short_pair' && rawAxis !== 'short_mie'
    && Number(rawAxis) !== 0 && Number(rawAxis) !== 1 && Number(rawAxis) !== 2
  if (isAuto) {
    const excess = Number(cfg.timePressureSeconds ?? 0)
    if (excess > AUTO_AXIS_DEGRADE_THRESHOLD) {
      const cur = record.yeshuguangAutoAxis ?? 'full'
      if (cur === 'full') record.yeshuguangAutoAxis = 'short_pair'
      else if (cur === 'short_pair') record.yeshuguangAutoAxis = 'short_mie'
      // 换轴后旧轴的折叠残差不适用新轴，清零让 necessary 从新轴重估；同时失效旧轴缓存的 cycle
      cfg.timeBudgetExcess = 0
      record.yeshuguangCycle = undefined
    }
  }

  const times = (record.yeshuguangMoveTimes ?? {}) as Record<string, number>
  const cycle = (record.yeshuguangCycle as YeshuguangCycleResult | undefined)
    ?? resolveCycle(cfg, { ultimateCount })
  if (cycle.totalForms <= 0) return null

  const melee =
    cycle.totalForms * (
      cycle.miePerForm * (times[MOVE.mie1] ?? 0)
      + cycle.jiPerForm * (times[MOVE.ji] ?? 0)
      + cycle.fuyaoPerForm * (times[MOVE.fuyao] ?? 0)
      + Math.max(times[MOVE.guichen] ?? 0, times[MOVE.zhanwang] ?? 0)
    )
  const feiguangTime = cycle.feiguangFullCasts * (times[MOVE.feiguang] ?? 0)
  const zhao = cycle.zhaoyingForms * (times[MOVE.entryAssist] ?? 0)
  // 定风波（通用强化特殊技）前台时间：estimateExSpecialTime 覆盖了 exSpecialNecessaryTime 的通用公式，
  // 必须把 exSpecialCount × exSpecialActionTime 也计入，否则定风波时间丢失、经 timeBudgetExcess 折叠造成
  // 必要时间虚高（曾致叶瞬光 necessary≈151s > rowTime≈113s，平A池被挤到 0）。
  // 定风波时间同样实数化（同 1051 `ultForTime` 的理由：整数在阈值处翻转会把实数次数拽成
  // 2-循环，必要时间随之跳变 → 平A池/回能/喧响同步跳）
  const genericExTime = Math.max(0, exSpecialCount ?? 0) * (cfg.exSpecialActionTime ?? 0)
  return { necessaryTime: melee + feiguangTime + zhao + genericExTime, comboAlignTime: 0 }
}

function buildResourceResult({ cfg, state }: AgentResourceResultInput) {
  const record = cfg as unknown as Record<string, unknown>
  const cinema = Math.max(0, Math.floor(Number(record.yeshuguangCinemaLevel ?? 0)))
  const cycle = resolveCycle(cfg, state)
  record.yeshuguangCycle = cycle
  const formSwordTotal = cycle.totalForms * cycle.swordSpentPerForm
  const guanzhiTotal = cycle.totalForms * cycle.guanzhiPerForm
  return {
    yeshuguangCycle: cycle,
    specResources: {
      yeshuguang_sword_momentum: {
        id: 'yeshuguang_sword_momentum',
        name: '局外剑势',
        initialValue: cfg.yeshuguangSwordInitial ?? 0,
        maxValue: SWORD_MAX,
        totalGain: Math.max(0, cycle.outsideSword - (cfg.yeshuguangSwordInitial ?? 0)),
        gains: { outside_total: cycle.outsideSword },
        bonusCount: 0,
        total: cycle.outsideSword,
        remaining: Math.max(0, cycle.outsideSword - cycle.zhaoyingForms * ZHAOYING_COST),
        spendCounts: { zhaoying: cycle.zhaoyingForms },
        spendCosts: { zhaoying: cycle.zhaoyingForms * ZHAOYING_COST },
      },
      yeshuguang_qingming_burst: {
        id: 'yeshuguang_qingming_burst',
        name: '明心境·青溟剑势',
        initialValue: 0,
        maxValue: FORM_SWORD,
        totalGain: cycle.totalForms * FORM_SWORD,
        gains: { enter: cycle.totalForms * FORM_SWORD },
        bonusCount: 0,
        total: cycle.totalForms * FORM_SWORD,
        remaining: Math.max(0, cycle.totalForms * FORM_SWORD - formSwordTotal),
        spendCounts: { axis: cycle.totalForms },
        spendCosts: { axis: formSwordTotal },
      },
      yeshuguang_guanzhi: {
        id: 'yeshuguang_guanzhi',
        name: '观止',
        initialValue: 0,
        maxValue: cinema >= 2 ? 9 : 2,
        totalGain: guanzhiTotal,
        gains: { per_form: guanzhiTotal },
        bonusCount: 0,
        total: guanzhiTotal,
        remaining: 0,
        spendCounts: { feiguang: cycle.feiguangFullCasts },
        spendCosts: { feiguang: guanzhiTotal },
      },
      yeshuguang_mingxin: {
        id: 'yeshuguang_mingxin',
        name: '明心境',
        initialValue: 0,
        maxValue: 1,
        totalGain: cycle.totalForms,
        gains: {
          decibel: cycle.decibelForms,
          gift: cycle.giftForms,
          zhaoying: cycle.zhaoyingForms,
        },
        bonusCount: 0,
        total: cycle.totalForms,
        remaining: 0,
        spendCounts: {},
        spendCosts: {},
      },
      ...(cinema >= 6 ? {
        yeshuguang_mingdeng: {
          id: 'yeshuguang_mingdeng',
          name: '明灯愿',
          initialValue: C6_MINGDENG_ENTRY,
          maxValue: C6_MINGDENG_CAP_NOTE,
          totalGain: cycle.totalForms,
          gains: { per_form: cycle.totalForms },
          bonusCount: 0,
          total: cycle.mingdengTotal,
          remaining: Math.max(0, cycle.mingdengTotal - cycle.mingdengUpgrade * 3),
          spendCounts: { upgrade: cycle.mingdengUpgrade },
          spendCosts: { upgrade: cycle.mingdengUpgrade * 3 },
        },
      } : {}),
    },
  }
}

function resourceSections({ result }: AgentResourceSectionsInput) {
  const cycle = (result as any)?.yeshuguangCycle as YeshuguangCycleResult | undefined
  if (!cycle) return []
  const axisLabel = cycle.formAxis === 'full' ? '打满'
    : cycle.formAxis === 'short_pair' ? '短轴·灭极'
      : '短轴·仅灭'
  const rows = [
    { label: '轴类型', value: axisLabel, detail: '时间不足时可换 short_pair / short_mie' },
    { label: '局外剑势', value: fmt(cycle.outsideSword, 1), detail: 'attack_data_0 + 帷幕×3 + 影画1' },
    { label: '明心境轮次', value: String(cycle.totalForms), detail: `逐云${cycle.decibelForms}+转大${cycle.giftForms}+照影${cycle.zhaoyingForms}` },
    { label: '每轮结构', value: `灭${cycle.miePerForm}/极${cycle.jiPerForm}/扶摇${cycle.fuyaoPerForm}`, detail: `耗剑势 ${cycle.swordSpentPerForm} · 观止 ${cycle.guanzhiPerForm}` },
    { label: '飞光', value: `${fmt(cycle.feiguangFullCasts, 3)} 满档当量`, detail: `总观止/6 × 倍率行` },
    { label: '收尾', value: `斩妄${cycle.finisherZhanwang}/归尘${cycle.finisherGuichen}`, detail: cycle.mingdengUpgrade > 0 ? `明灯愿强化 ${cycle.mingdengUpgrade}` : '喧响进斩妄，其余归尘' },
  ]
  if (cycle.c6AttachCount > 0) {
    rows.push({ label: 'C6 附伤', value: String(cycle.c6AttachCount), detail: '每轮收尾 1500% 攻击力（满易伤）' })
  }
  return [{
    id: 'yeshuguang-cycle',
    title: '叶瞬光·明心境账本',
    summary: `${axisLabel} · ${cycle.totalForms} 轮 · 飞光 ${fmt(cycle.feiguangFullCasts, 2)} 满档当量`,
    rows,
  }]
}

export const yeshuguangSettings: MechanicSetting[] = [
  {
    id: 'yeshuguang.formAxis',
    label: '叶瞬光·明心境轴（-1自动/0打满/1灭极短轴/2仅灭短轴）',
    description: '自动：按真实时间压力（本槽物化行 − 队友占完后可用前台）超 5s 时逐级退化打满→灭极→仅灭。短轴**只省时间不省资源**（每轮仍打满 6 点青溟剑势，归尘按「剑势耗尽」触发）。**暂不作默认**：轮数由资源驱动，轴变短→每轮更快→平A/回能/终结技/喧响反而供给更多轮（实测 1431/1341/1031 full 6 轮 → short_mie 9 轮，净占用不降），要真压回预算需轮数与平A池联立求解（DEBT_REGISTRY「全局实数化收敛重构」）。',
    default: 0,
    min: -1,
    max: 2,
    step: 1,
  },
  {
    id: 'yeshuguang.teamCurtainCount',
    label: '叶瞬光·队友以太帷幕次数（手动覆盖）',
    description: '额外能力：每次 +3 局外剑势（需支援/防护）。0=自动按全队帷幕次数（照/千夏/爱芮大招，收敛注入）；>0 强制用该值。',
    default: 0,
    min: 0,
    max: 30,
    step: 1,
  },
  {
    id: 'yeshuguang.zhaoyingCount',
    label: '叶瞬光·照影进入次数',
    description: '耗 6 局外剑势/次。默认 -1 = 自动 floor(局外剑势/6)。',
    default: -1,
    min: -1,
    max: 20,
    step: 1,
  },
]


const C2_DEF_IGNORE_MOVES = new Set<string>([MOVE.feiguang, MOVE.zhanwang])

function patchExecutions({ cfg, executions }: AgentResourceInput): void {
  const cinema = Math.max(0, Math.floor(Number((cfg as any).yeshuguangCinemaLevel ?? 0)))
  if (cinema < 2) return
  // 影画2：飞光、斩妄开天 无视目标 40% 防御（moveId 限定）
  for (const exec of executions) {
    if (C2_DEF_IGNORE_MOVES.has(exec.moveId)) {
      exec.defIgnore = (exec.defIgnore ?? 0) + 40
    }
  }
}

export const yeshuguangMechanic: AgentMechanicModule = {
  id: 'agent:yeshuguang',
  agentIds: [YESHUGUANG_ID],
  name: '叶瞬光·明心境',
  description: '白毛明心境：打满/两条提速短轴；满易伤；C6 明灯愿强化与 1500% 收尾附伤。',
  settings: yeshuguangSettings,
  buildCharConfig,
  buildExecutions,
  patchExecutions,
  estimateExSpecialTime,
  buildResourceResult,
  resourceSections,
}

export default yeshuguangMechanic
