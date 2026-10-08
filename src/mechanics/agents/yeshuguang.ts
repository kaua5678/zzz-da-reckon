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
import { moduleExecRow, ENERGY_RECOVERY_OFF } from '@/mechanics/moduleExecRow'
import type {
  AgentCharConfigInput,
  AgentExSpecialTimeInput,
  AgentExSpecialTimeEstimate,
  AgentMechanicModule,
  AgentNextRoundFeedbackInput,
  AgentPanelInput,
  AgentResourceInput,
  AgentResourceResultInput,
  AgentResourceSectionsInput,
  AgentStunOverrideInput,
  AgentTeamConfigInput,
} from '../types'
import type { CharacterOperationConfig, CharacterResourceResult, MechanicSetting, SkillExecution } from '@/types/resource'
import { fmt } from '@/utils/format'
import { mechanicSettingReader } from '@/utils/mechanicSettingCfg'
import { findMoveById as findMove, getRowValue as rowVal } from '@/data/moveTableQueries'
import { cinemaLevelOf } from '@/data/cinemaLevel'

const cfgNum = mechanicSettingReader(() => yeshuguangMechanic.settings)
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

// @fact agent:1431/帷幕易伤 口径: 帷幕基于开帷幕时的失衡易伤倍率，玩家先把易伤buff上满再开 ⇒ 取「boss基础失衡易伤 + 全部失衡易伤加成」，再按影画封顶（C0-3 = 2.1 / C4+ = 3.0） | 据 用户@2026-09-01·复核@2026-09-04·复核@2026-09-08·复核@2026-09-25·锚未变@2026-09-27·复核@2026-09-30 | 验 src/mechanics/__tests__/yeshuguang.test.ts | 锚 src/mechanics/agents/yeshuguang.ts#veilStunMultiplier | 信 确认

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

/**
 * 帷幕易伤基数 = 伤害池 `pushDirect` 里本行 `stunBase` 的取值（2026-09-17 round 18 / R15-d）。
 *
 * 口径（逐位保留迁移前 `damagePool.ts` 的算式）：
 *   `veilStunMultiplier(boss基础易伤, 全部失衡易伤加成, cap) − 加成/100`
 * 减掉 `bonus/100` 是因为 `calcDirectDamage` 内部**还会再加一次**
 * `stunDmgMultiplierBonus + stunDmgMultiplierBonusAlways`（见 `core/damage.ts` 的
 * `calcStunMultiplier` 调用），这里先反向扣掉，使最终落到 `veilStunMultiplier` 的值上。
 *
 * @param bossStunVuln  Boss 基础失衡易伤倍率（`configStore.enemy.stunVuln`，默认 1.5）
 * @param rawBonus      面板失衡易伤加成合计（`stunDmgMultiplierBonus + stunDmgMultiplierBonusAlways`，百分点）
 * @param capAlways     `stunDmgMultiplierBonusCapAlways`（百分点；>0 才钳）
 * @param cap           影画封顶倍率（C0-3 = 2.1、C4+ = 3.0）
 */
export function veilStunBase(
  bossStunVuln: number,
  rawBonus: number,
  capAlways: number,
  cap: number,
): number {
  const bonusPct = capAlways > 0 ? Math.min(rawBonus, capAlways) : rawBonus
  return veilStunMultiplier(bossStunVuln, bonusPct, cap) - bonusPct / 100
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

/** 自动选轴的超支阈值（秒）：timeBudgetExcess 超过此值才退化，避免量化残差（~1s）误触降轴 */
// @fact agent:1431/自动选轴 口径: 明心境轴**滑块默认打满(0)**——R2C 用户裁决 2026-09-25：能打完的队不该退化（短轴亏灭极段伤害），故默认不自动退化。auto(-1) 的退化判据 = **本槽物化行 − 战斗窗口**（`timePressureSeconds`，**不减队友占用**，同裁决修复：旧口径减队友致满命队误退化 −11%）；仅当用户显式设 -1 且该压力 >5s 时逐级退化 full→short_pair→short_mie，换轴时清零旧轴折叠残差；仍超预算由外层 interactionScale 缩交互兜底 | 据 用户@2026-09-05·复核@2026-09-08·R2C裁决@2026-09-25·锚未变@2026-09-27·复核@2026-09-30·复核@2026-10-07·复核@2026-10-08 | 验 src/mechanics/__tests__/yeshuguang.test.ts | 锚 src/mechanics/agents/yeshuguang.ts#cfgAxis | 信 确认
const AUTO_AXIS_DEGRADE_THRESHOLD = 5

/** 明心境轴滑块（声明见 yeshuguangSettings）：0 打满 / 1 灭极短轴 / 2 仅灭短轴；其余（-1）= 自动 */
function axisSettingOf(cfg: CharacterOperationConfig): YeshuguangFormAxis | 'auto' {
  const n = cfgNum(cfg, 'yeshuguang.formAxis')
  return n === 0 ? 'full' : n === 1 ? 'short_pair' : n === 2 ? 'short_mie' : 'auto'
}

function cfgAxis(cfg: CharacterOperationConfig): YeshuguangFormAxis {
  const axis = axisSettingOf(cfg)
  if (axis !== 'auto') return axis
  // auto：时间不够时按超支信号逐级退化（estimateExSpecialTime 写 yeshuguangAutoAxis）
  const auto = cfg.yeshuguangAutoAxis
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
  /**
   * 终局整数化（引擎收敛后置 true；见 `cfg.yeshuguangFinalizeForms`）。
   * 缺省 false = 迭代期实数，正反馈环的收敛语义逐位不变（既有模块测试直调不带此字段）。
   */
  finalizeForms?: boolean
  /**
   * CC-160：终局冻结的照影轮数（`finalizePass.begin` 按入口态 floor 一次写入）。仅 finalizeForms 时生效；
   * 存在时不再从局外剑势重推照影——切断「平A→剑势→轮数→必要→平A」在整数态下的跨盆 2-循环。
   */
  frozenZhaoying?: number
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

// @fact agent:1431/短轴资源 口径: 三档轴（打满/灭极/仅灭）**每轮都消耗满 6 点青溟剑势**——归尘触发条件是「青溟剑势耗尽」、飞光是「持续消耗直至耗尽」，所以短轴只省段数与时间，不省资源也不省观止（C2+ 观止/轮 = 2+6 = 8 三档相同）；旧实现按 6/3/2 递减，与它自己的注释「剩余资源压进观止→飞光」相反 | 据 用户@2026-09-05 + nanoka 1431 招式原文·复核@2026-09-08·复核@2026-09-25·锚未变@2026-09-27·复核@2026-09-30·复核@2026-10-07 | 验 src/mechanics/__tests__/yeshuguang.test.ts#三档轴每轮资源消耗相同 | 锚 src/mechanics/agents/yeshuguang.ts#computeYeshuguangCycle | 信 确认
// @fact agent:1431/轮数实数化 口径: 明心境轮数（喧响进轮/转大赠轮/照影轮）与定风波时间**迭代期**一律以**实数**参与收敛（模块内不 floor；终局由引擎置 `finalizeForms` 后取整一次，见 `agent:1431/终局整数化`） —— 局外剑势 ∝ 平A时间，`floor(剑势/6)` 一次翻转就是一整轮（full 轴 ≈10.9s），是「平A→剑势→轮数→必要时间→平A」环增益 >1 的原产地；实数化语义 = 最后一轮只打 0.4 轮、段数/观止/飞光/收尾同比例兑现（实战 180s 到点）。手动滑块 zhaoyingCount 仍取整（用户显式指定的次数，非资源推导量） | 据 用户@2026-09-05「实数化确实很好…做吧」·复核@2026-09-08·复核@2026-09-25（W14 drifted：终局整数化后本条限定为迭代期）·锚未变@2026-09-27·复核@2026-09-30·复核@2026-10-07 | 验 src/mechanics/__tests__/yeshuguang.test.ts#轮数实数化 | 锚 src/mechanics/agents/yeshuguang.ts#computeYeshuguangCycle | 信 确认
// @fact agent:1431/终局整数化 口径: 引擎收敛后置 `finalizeForms=true` 重推一次——照影轮、喧响进轮、转大赠轮各 floor 一次（离散触发只兑现装得下的部分，余数剑势留着不打），多出的那一轮时间由合轴率与短轴分担；迭代期实数语义不变（见 `agent:1431/轮数实数化`）；手动滑块 zhaoyingCount 本就取整 | 据 用户@2026-09-20「余数剑势本来就该留着不打…离散轮数被换成短轴分担了」·复核@2026-09-25（此前 3 处引用、0 处声明，W14 补登）·锚未变@2026-09-27·复核@2026-09-30·复核@2026-10-07 | 验 src/mechanics/__tests__/mechanicSettingsEffect.test.ts | 锚 src/mechanics/agents/yeshuguang.ts#computeYeshuguangCycle | 信 确认
// ⟳复核: 叶瞬光原文改版（明心境进轮/赠轮/照影条件或剑势消耗变动）或「连携/破阵按实际失衡次数」改造开工时，复核终局取整的范围与分担方式 | 到期 2026-12-31
export function computeYeshuguangCycle(input: YeshuguangCycleInput): YeshuguangCycleResult {
  const cinema = cinemaLevelOf(input.cinemaLevel)
  const axis = input.formAxis
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
  /**
   * 照影是「攒满 6 点局外剑势 ⇒ 变身一次」的**离散触发**：不足 6 点的余数只能留着不打。
   *
   * 迭代期保持实数（防「平A↑→剑势↑→轮数+1整轮→必要时间↑→平A↓」正反馈环，见上方 `@fact
   * agent:1431/轮数实数化`）；**终局**（引擎置 `yeshuguangFinalizeForms`，同 1051/1531 骨架）
   * 才 floor —— 余数剑势留着，多出的那一轮由合轴率 + 缩时轴承担，而不是把离散触发切成小数。
   * 用户口径 2026-09-20：「余数剑势本来就该留着不打，我解决的问题是如果最后没有时间但是多了1轮，
   * 这一轮的时间由合轴率和短轴承担。离散轮数被换成短轴分担了」。
   * 手动滑块（zhaoSetting）本就是用户显式指定的整数次数，不受此影响。
   */
  const finalizeForms = input.finalizeForms === true
  const autoZhaoRaw = outside / ZHAOYING_COST
  const autoZhao = finalizeForms ? Math.floor(autoZhaoRaw) : autoZhaoRaw
  const zhaoSetting = Math.floor(input.zhaoyingCountSetting)
  let zhaoyingForms = Math.max(0, zhaoSetting >= 0 ? Math.min(zhaoSetting, autoZhao) : autoZhao)
  // CC-160：终局照影 = 入口态实数轮数 floor 一次后冻结（余数剑势留着不打；装不下由重折/截断/降配承担）
  if (finalizeForms && input.frozenZhaoying != null) zhaoyingForms = Math.max(0, input.frozenZhaoying)
  // 喧响进轮 / 转大赠轮同样是离散事件（一次终结技 = 一轮），终局一并取整
  if (finalizeForms) {
    decibelForms = Math.floor(decibelForms)
    giftForms = Math.floor(giftForms)
  }
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

// @fact agent:1431/载物 未建模: 载物只是青溟剑势的溢出暂存，而总量计算器天然不做上限截断，溢出本就不丢 ⇒ 建模它没有任何数值意义，不补 | 据 用户@2026-09-01·复核@2026-09-04·复核@2026-09-08·复核@2026-09-25·锚未变@2026-09-27·复核@2026-09-30·复核@2026-10-07 | 验 src/mechanics/__tests__/yeshuguang.test.ts | 锚 src/mechanics/agents/yeshuguang.ts#computeOutsideSwordGain | 信 确认
// @fact agent:1431/局外连接段 决: **局外**（非明心境）连接段不建执行行——它的占用时间就是平A池（basicAttackTime，按 atk0PerSec 攒青溟剑势）；明心境内的连接段（斩流光灭/极/扶摇）**照常建行**。总量计算器按资源算招式而非按连段顺序 | 据 用户@2026-09-01·复核@2026-09-05（主体加限定词：曾被读成"明心境连接段不建行"并输出错误归因）·复核@2026-09-08·复核@2026-09-25·锚未变@2026-09-27·复核@2026-09-30·复核@2026-10-07 | 验 src/mechanics/__tests__/yeshuguang.test.ts | 锚 src/mechanics/agents/yeshuguang.ts#computeOutsideSwordGain | 信 确认
export function computeOutsideSwordGain(cfg: CharacterOperationConfig, state: {
  basicAttackTime?: number
  exSpecialCount?: number
  ultimateCount?: number
  dodgeCounterCount?: number
  chainCountTotal?: number
}): number {
  const initial = Math.max(0, Number(cfg.yeshuguangSwordInitial ?? 0) || 0)
  const atk0PerSec = Math.max(0, Number(cfg.yeshuguangAtk0PerSec ?? 0) || 0)
  const basic = Math.max(0, state.basicAttackTime ?? 0)
  const fromBasic = basic * atk0PerSec
  const perDodge = Math.max(0, Number(cfg.yeshuguangAtk0Dodge ?? 0) || 0)
  const perEx = Math.max(0, Number(cfg.yeshuguangAtk0Ex ?? 0) || 0)
  const perChain = Math.max(0, Number(cfg.yeshuguangAtk0Chain ?? 0) || 0)
  const fromDodge = cfg.dodgeCounterCount * perDodge
  // 定风波：文本明确发动后 +1 青溟剑势（局外）；attack_data_0 表值为 0，单独 +1/次
  const fromEx = (state.exSpecialCount ?? 0) * (perEx + 1)
  const fromChain = (state.chainCountTotal ?? 0) * perChain
  // 额外能力·溯影惊鸿：队友开帷幕 +3 局外剑势/次。手动滑块 >0 优先；否则自动用全队帷幕次数
  //（useResourceCalc 收敛注入 teamVeilCountTotal：照 veilCount + 爱芮/叶瞬光大招 + 千夏强特，2026-08-31）。
  const manualCurtains = Math.max(0, Math.floor(cfgNum(cfg, 'yeshuguang.teamCurtainCount') || 0))
  const autoCurtains = Math.max(0, Math.floor(Number(cfg.teamVeilCountTotal ?? 0) || 0))
  const curtains = manualCurtains > 0 ? manualCurtains : autoCurtains
  const aa = Number(cfg.yeshuguangAdditionalAbilityActive ?? 0) > 0
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
  executions.push(moduleExecRow({
    moveId,
    moveName,
    category,
    count,
    actionTime,
    totalTime: actionTime * count,
    ...ENERGY_RECOVERY_OFF,
    damageMultiplier: dmg,
    damageMultiplierOverride: true,
    element: 'physical',
    skillTableNote: note,
    ...extra,
  }))
}

function resolveCycle(cfg: CharacterOperationConfig, state: {
  ultimateCount?: number
  exSpecialCount?: number
  basicAttackTime?: number
  chainCountTotal?: number
}): YeshuguangCycleResult {
  const cinema = cinemaLevelOf(cfg.yeshuguangCinemaLevel)
  const outside = computeOutsideSwordGain(cfg, state)
  const gift = Math.max(0, Math.floor(Number(cfg.yeshuguangGiftUltCount ?? 0) || 0))
  return computeYeshuguangCycle({
    ultimateCount: state.ultimateCount ?? 0,
    giftUltCount: gift,
    zhaoyingCountSetting: cfgNum(cfg, 'yeshuguang.zhaoyingCount'),
    outsideSwordGain: outside,
    cinemaLevel: cinema,
    battleTime: cfg.battleTime,
    // 终局整数化旗标（引擎在收敛后置位；见 cfg.yeshuguangFinalizeForms 的语义说明）
    finalizeForms: Number(cfg.yeshuguangFinalizeForms ?? 0) > 0,
    frozenZhaoying: typeof cfg.yeshuguangFrozenZhaoying === 'number' ? cfg.yeshuguangFrozenZhaoying : undefined,
    formAxis: cfgAxis(cfg),
  })
}

function buildCharConfig({ skills, cinemaLevel, panel, cfg }: AgentCharConfigInput): void {
  const cinema = cinemaLevelOf(cinemaLevel)
  cfg.yeshuguangCinemaLevel = cinema
  // 自动选轴：初始打满（full），estimateExSpecialTime 按超支信号逐级退化。
  if (cfg.yeshuguangAutoAxis !== 'short_pair' && cfg.yeshuguangAutoAxis !== 'short_mie') {
    cfg.yeshuguangAutoAxis = 'full'
  }

  cfg.yeshuguangSwordInitial = cinema >= 1 ? 6 : 0
  /**
   * 能力声明（规则 6：引擎按**能力**查询，不按 agentId 找槽）——模块声明自己需要
   * 「迭代期实数 + 终局整数化」的收尾骨架（1051 `exContinuous` / 1531 `billyFinalizeChain` 同款）。
   * 引擎据本字段置 `yeshuguangFinalizeForms` 并做整数态重推；见 `cfg.yeshuguangFinalizeForms` 语义。
   */
  cfg.yeshuguangContinuousForms = true
  if (cinema >= 4) {
    cfg.initialDecibelGift = cfg.initialDecibelGift + 1000
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
  cfg.yeshuguangMoveDmg = dmg
  cfg.yeshuguangMoveTimes = times

  const basicIds = ['1431001', '1431002', '1431003', '1431005']
  let basicAtk0 = 0
  let basicTime = 0
  for (const id of basicIds) {
    const mv = findMove(skills, id)
    basicAtk0 += rowVal(mv, 'attack_data_0')
    basicTime += mv?.actionTime ?? 0
  }
  cfg.yeshuguangAtk0PerSec = basicTime > 0 ? basicAtk0 / basicTime : 0
  cfg.yeshuguangAtk0Dodge = rowVal(findMove(skills, '1431022'), 'attack_data_0')
  cfg.yeshuguangAtk0Ex = rowVal(findMove(skills, '1431016'), 'attack_data_0')
  cfg.yeshuguangAtk0Chain = rowVal(findMove(skills, '1431024'), 'attack_data_0')
  cfg.yeshuguangAdditionalAbilityActive = panel.additionalAbilityActive
}

function buildExecutions({ cfg, state, executions }: AgentResourceInput): void {
  const dmg: Record<string, number> = cfg.yeshuguangMoveDmg ?? {}
  const times: Record<string, number> = cfg.yeshuguangMoveTimes ?? {}
  const cycle = resolveCycle(cfg, state)
  // cycle 的相位写入（供下一轮 estimate 复用）已拆到 materializePhaseState——本钩子对 cfg 只读
  // （阶段1 第二刀 2026-09-09）。

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
      { skillDamageTarget: 'ultimate' },
    )
  }
}

function estimateExSpecialTime({ cfg, exSpecialCount, ultimateCount, state }: AgentExSpecialTimeInput): AgentExSpecialTimeEstimate | null {
  // 自动选轴：**真实时间压力**（cfg.timePressureSeconds = 本槽物化行 − 战斗窗口，不减队友占用）
  // 超过阈值时逐级退化 full→short_pair→short_mie，并把旧轴的折叠残差清零——否则换轴后 necessary
  // 仍被旧轴残差虚高、平A池照样被挤 0。
  // 判据历史上用过两种错误信号：① 累加的 timeBudgetExcess（pass0 平A池满额发放灌出的只增不减
  // 巨大值）→ 「其实装得下」的队被误判超支、一路退化到仅灭；② 减了队友账本净占用的相对压力
  // （2026-09-25 前）→ 队友吃掉前台就把满命队顶过阈值、白丢灭极段伤害 −11%。现读「自己行绝对
  // 超窗口」的诚实信号（用户裁决 2026-09-25：只有绝对打不完才退化，能打完不退）。
  if (axisSettingOf(cfg) === 'auto') {
    const excess = Number(cfg.timePressureSeconds ?? 0)
    if (excess > AUTO_AXIS_DEGRADE_THRESHOLD) {
      const cur = cfg.yeshuguangAutoAxis ?? 'full'
      if (cur === 'full') cfg.yeshuguangAutoAxis = 'short_pair'
      else if (cur === 'short_pair') cfg.yeshuguangAutoAxis = 'short_mie'
      // 换轴后旧轴的折叠残差不适用新轴，清零让 necessary 从新轴重估；同时失效旧轴缓存的 cycle
      cfg.timeBudgetExcess = 0
      cfg.yeshuguangCycle = undefined
    }
  }

  const times: Record<string, number> = cfg.yeshuguangMoveTimes ?? {}
  // 估计与物化单源（R37-J5 ④，2026-09-19；与星徽·比利同款——AgentExSpecialTimeInput.state 的设计意图）：
  // 引擎 iterate 传入上一轮收敛状态时，用**与 buildExecutions 同一份输入**（basicAttackTime / exSpecialCount / chainCountTotal +
  // 本轮 ultimateCount）现算 cycle；此前读相位缓存 `yeshuguangCycle`（上一 pass 物化时的状态）或缺 basicAttackTime 的
  // resolveCycle，剑势来自平A时间 ⇒ 两边轮数可以差很多（动态合轴给足 180s 后实测账本 179.8 / 行 125.1，留白 10.9s）。
  // 外部直调（无 state）仍走缓存/退化路径。
  const cycle = state
    ? resolveCycle(cfg, {
      ultimateCount,
      exSpecialCount,
      basicAttackTime: state.basicAttackTime,
      chainCountTotal: state.chainCountTotal,
    })
    : cfg.yeshuguangCycle ?? resolveCycle(cfg, { ultimateCount })
  if (cycle.totalForms <= 0) return null

  // 收尾（归尘/斩妄）按**实际归属**计，不按 `max(两者)` 一律套用：
  // `buildExecutions` 物化的是 `finisherZhanwang × t_斩妄 + finisherGuichen × t_归尘`
  // （`:485-493`，C6 明灯愿的「归尘→斩妄」强化已在该 cycle 里换过），而这里此前记
  // `totalForms × max(t_归尘, t_斩妄)` —— 每轮一律按**较长的那个**算，于是恒**高估**
  // `totalForms × (max − 实际归属加权)`。实测 `auto-1431-1481-1491` 被接受态：
  // 11 轮 = 2 斩妄(2.75) + 9 归尘(2.533)，estimate 记 11×2.75 = 30.25、行记 28.297 ⇒ **+1.953s**。
  // 这正是本函数上方「估计与物化单源（R37-J5 ④）」承诺未兑现的最后一处（`docs` 坑 19 族）。
  const finisherTime =
    cycle.finisherZhanwang * (times[MOVE.zhanwang] ?? 0)
    + cycle.finisherGuichen * (times[MOVE.guichen] ?? 0)
  const melee =
    cycle.totalForms * (
      cycle.miePerForm * (times[MOVE.mie1] ?? 0)
      + cycle.jiPerForm * (times[MOVE.ji] ?? 0)
      + cycle.fuyaoPerForm * (times[MOVE.fuyao] ?? 0)
    )
    + finisherTime
  const feiguangTime = cycle.feiguangFullCasts * (times[MOVE.feiguang] ?? 0)
  const zhao = cycle.zhaoyingForms * (times[MOVE.entryAssist] ?? 0)
  // 定风波（通用强化特殊技）前台时间：estimateExSpecialTime 覆盖了 exSpecialNecessaryTime 的通用公式，
  // 必须把 exSpecialCount × exSpecialActionTime 也计入，否则定风波时间丢失、经 timeBudgetExcess 折叠造成
  // 必要时间虚高（曾致叶瞬光 necessary≈151s > rowTime≈113s，平A池被挤到 0）。
  // 定风波时间同样实数化（同 1051 `ultForTime` 的理由：整数在阈值处翻转会把实数次数拽成
  // 2-循环，必要时间随之跳变 → 平A池/回能/喧响同步跳）
  const genericExTime = Math.max(0, exSpecialCount) * cfg.exSpecialActionTime
  return { necessaryTime: melee + feiguangTime + zhao + genericExTime, comboAlignTime: 0 }
}

function buildResourceResult({ cfg, state }: AgentResourceResultInput): Partial<CharacterResourceResult> {
  const cinema = cinemaLevelOf(cfg.yeshuguangCinemaLevel)
  const cycle = resolveCycle(cfg, state)
  cfg.yeshuguangCycle = cycle
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
  const cycle = result.yeshuguangCycle
  if (!cycle) return []
  const axisLabel = cycle.formAxis === 'full' ? '打满'
    : cycle.formAxis === 'short_pair' ? '短轴·灭极'
      : '短轴·仅灭'
  const rows = [
    { label: '轴类型', value: axisLabel, detail: '时间不足时可换 short_pair / short_mie' },
    { label: '局外剑势', value: fmt(cycle.outsideSword, 1), detail: 'attack_data_0 + 帷幕×3 + 影画1' },
    { label: '明心境轮次', value: String(cycle.totalForms), detail: `逐云${cycle.decibelForms}+转大${cycle.giftForms}+照影${cycle.zhaoyingForms}` },
    // 白毛启动按触发拆分（用户口径 2026-09-19「白毛启动了几次按启动方式分」）；`N 次` 格式进难度曲线关键次数
    { label: '白毛·喧响触发（逐云）', value: `${cycle.decibelForms} 次`, detail: '自攒喧响终结技进白毛；收尾=斩妄' },
    { label: '白毛·转大触发', value: `${cycle.giftForms} 次`, detail: '队友赠大（琉音好评转大等）触发白毛；收尾=归尘' },
    { label: '白毛·照影触发', value: `${cycle.zhaoyingForms} 次`, detail: `快速支援进白毛，耗局外剑势 6/次；收尾=归尘` },
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
    description: '打满(默认)：每轮 (灭#1+极)×2+扶摇+飞光+收尾，伤害最高。短轴**只省时间不省资源**（每轮仍打满 6 点青溟剑势，归尘按「剑势耗尽」触发），亏的是灭极段本身的伤害。自动(-1)：仅当本槽物化行**绝对超过战斗窗口**（不减队友占用，R2C 修复 2026-09-25）时，按真实时间压力超 5s 逐级退化打满→灭极→仅灭——能打完的队不再误退化。',
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
  const cinema = cinemaLevelOf(cfg.yeshuguangCinemaLevel)
  if (cinema < 2) return
  // 影画2：飞光、斩妄开天 无视目标 40% 防御（moveId 限定）
  for (const exec of executions) {
    if (C2_DEF_IGNORE_MOVES.has(exec.moveId)) {
      exec.defIgnore = (exec.defIgnore ?? 0) + 40
    }
  }
}

/** 调整后赠大行反馈；兼容既有名称标记，迁移不改变行匹配口径。 */
function yeshuguangNextRoundFeedback({ adjustedResult }: AgentNextRoundFeedbackInput) {
  let yeshuguangGiftUlt = 0
  const ye = adjustedResult.characters.find(c => c.agentId === YESHUGUANG_ID)
  for (const e of ye?.executions ?? []) {
    if (e.source === 'gift' || e.moveName.includes('好评转大')) {
      yeshuguangGiftUlt += e.count
    }
  }
  return { yeshuguangGiftUlt }
}

export const yeshuguangMechanic: AgentMechanicModule = {
  nextRoundFeedback: yeshuguangNextRoundFeedback,
  id: 'agent:yeshuguang',
  agentIds: [YESHUGUANG_ID],
  // CC-80：终结技开启帷幕 1:1（原 mechanics/teamVeil.ts 写死集合）
  teamVeilCount: ({ ultimateCount }) => ultimateCount,
  name: '叶瞬光·明心境',
  description: '白毛明心境：打满/两条提速短轴；满易伤；C6 明灯愿强化与 1500% 收尾附伤。',
  settings: yeshuguangSettings,
  /**
   * 面板阶段：核心被动/影画1 的面板直加 + **帷幕易伤封顶**（2026-09-17 round 18 / R15-d 迁入）。
   *
   * 迁移前这段住在 `composables/resourceCalc/helpers.ts#computePanelPhases` 的
   * `if (agent.id === '1431')` 硬编码块里（历史绕法①：applyPanel 早于 cfg 构建、拿不到
   * configStore），而**消费**它的帷幕算式又住在伤害池的 `row.agentId === '1431'` 分支里。
   * 本钩子把两者一并收回模块：`applyPanel` 拿到 `enemyStunVuln`（面板阶段的新只读入参）
   * 后**当场算出基数**并盖章 `panel.veilStunVulnBase`，伤害池只做「字段非 0 ⇒ 用该值」，
   * 不再出现角色 id 判据（判据同 T6：唯一写入方 = 本模块）。
   *
   * ⚠ 三项门控**逐位保留**（R14 分诊 §4.2/§4.3 实测）：
   *  · `capMult` 非 0（= 本钩子只对本角色写，非本角色 `emptyPanel` 恒 0）；
   *  · `stunForThis > 0`（= 「轴外段不吃帷幕封顶」的**必要**门控，不是冗余）——它依赖**行级**
   *    `stunOverride`，面板阶段拿不到 ⇒ **刻意留在伤害池**（见 `damagePool.ts` 消费端注释）；
   *  · `stunDmgMultiplierBonusCapAlways` 全仓零写入（分诊 §4.3）⇒ 算式里原样保留，
   *    但**不许**把它当成「需要搬运的量」。
   */
  applyPanel: ({ panel, cinemaLevel, enemyStunVuln }: AgentPanelInput) => {
    // 叶瞬光核心被动·合道：进场常驻暴击 +30%、伤害 +25%（Lv.7）。
    // 影画1：合道额外伤害 +10%、无视防御 20%；影画2：飞光/斩妄 40% 减防走 moveId defIgnore。
    panel.critRate = panel.critRate + 30
    panel.dmgBonus = panel.dmgBonus + 25
    if (cinemaLevel >= 1) {
      panel.dmgBonus = panel.dmgBonus + 10
      panel.enemyDefReduction = panel.enemyDefReduction + 20
    }
    // 帷幕易伤 = min(boss基础易伤 + 全部失衡易伤加成, 2.1 或 3.0)。
    // 基数在**面板阶段**算好盖章（此时 bonus/capAlways 已由 buff 通道写入面板），
    // 伤害池在 `stunOverride > 0` 的行上直接取用。
    const cap = cinemaLevel >= 4 ? 3.0 : 2.1
    panel.veilStunCapMult = cap
    panel.veilStunVulnBase = veilStunBase(
      enemyStunVuln,
      panel.stunDmgMultiplierBonus + panel.stunDmgMultiplierBonusAlways,
      panel.stunDmgMultiplierBonusCapAlways,
      cap,
    )
  },
  buildCharConfig,
  /**
   * converge 阶段：注入上一轮「琉音转大赠送的叶瞬光逐云次数」（跨轮反馈）。
   * 2026-09-15 arch 棘轮第 2 批自 `convergence.ts` 的 `merged.agentId === '1431'` 分支搬入（规则 6）。
   */
  applyTeamConfig: ({ cfg, phase, threads }: AgentTeamConfigInput) => {
    if (phase !== 'converge' || !threads) return
    ;cfg.yeshuguangGiftUltCount = (threads.moduleFeedback.yeshuguangGiftUlt ?? 0)
  },
  /**
   * 终局整数重推（规则 6 引擎落点，2026-09-25 CC-6c）：明心境轮数实数化收尾。
   * `stage='preTail'`（S2 折叠之后、S3a 欠打回填之前）。
   *
   * ⚠ `reset` **不对称**（逐位保留原语义）：只在 `yeshuguangContinuousForms === 1` 时写 false，
   * 否则字段保持 `undefined`——引擎对所有声明者都调 reset，语义门控必须在模块内。
   */
  finalizePass: {
    stage: 'preTail',
    applies: cfg => Number(cfg.yeshuguangContinuousForms ?? 0) === 1,
    // CC-160（第 187 轮）：先按入口态（实数期，旗标未置）算照影轮数并 floor 一次冻结，再置旗标。
    // 旧行为 = 终局每轮都从上一态平A重推照影，整数态下增益 >1 ⇒ 跨盆 2-循环（c3–c6：强特 15↔6、平A 18↔165），
    // 停点与账本不自洽。冻结后终局只剩终结技/平A随资源变化，配合引擎终局后重折消掉过期折叠残差。
    // `@fact agent:1431/终局整数化`「各 floor 一次」的字面实现。回退点：删冻结两行。docs/mcp-stun-dual-source.md §24.9。
    begin: (cfg, entry) => {
      cfg.yeshuguangFinalizeForms = false
      delete cfg.yeshuguangFrozenZhaoying
      cfg.yeshuguangFrozenZhaoying = Math.floor(resolveCycle(cfg, entry).zhaoyingForms + 1e-9)
      cfg.yeshuguangFinalizeForms = true
    },
    refoldAfter: true,
    reset: cfg => {
      if (Number(cfg.yeshuguangContinuousForms ?? 0) === 1) {
        cfg.yeshuguangFinalizeForms = false
        delete cfg.yeshuguangFrozenZhaoying
      }
    },
  },
  buildExecutions,
  /** 相位写入（引擎在物化调用点补写）：本次物化的明心境 cycle 缓存，供下一轮 estimate 复用 */
  materializePhaseState: ({ cfg, state }) => {
    const cycle = resolveCycle(cfg, state)
    cfg.yeshuguangCycle = cycle
  },
  patchExecutions,
  estimateExSpecialTime,
  /**
   * 行级失衡易伤自报（规则 6 落点，2026-09-16 round 17 / R15-c）：
   * 关键招（`YESHUGUANG_FULL_STUN_MOVES`）走「明心境满易伤」，吃满 `stunOverride = 1`。
   *
   * ⚠ **刻意没有 `isAxis` 项**——这不是漏写：伤害池的轴内分段链是
   * `else if (isAxis && axisSlots.has(slot))`，而 `axisSlots.has(slot)` 在「轴模式下本槽没进轴」
   * 时为假 ⇒ 兜底臂**在轴模式下也会被问到**（R14 分诊 §4.1 实测）。加 `!isAxis` = 静默改行为
   * （未进轴槽位的关键招会从「满易伤」掉回全局覆盖率）。
   * 上限 210%/300%（影画4）仍由 `pushDirect` 的帷幕封顶路径处理，不在本钩子内。
   */
  stunOverrideForMove: ({ moveId }: AgentStunOverrideInput) => {
    if (!YESHUGUANG_FULL_STUN_MOVES.has(moveId)) return null
    return { stunOverride: 1, note: ' · 明心境满易伤' }
  },
  buildResourceResult,
  resourceSections,
}


/**
 * D2（CC-359）：本模块私有的 cfg 字段——只有本文件读写，声明随模块走，不再堆在 `types/resource/config.ts`。
 * 仍是 `CharacterOperationConfig` 的成员（模块扩充，纯类型、零运行时）；被第二处引用时请迁回公共接口。
 */
/**
 * r406：本模块 `buildResourceResult` 写、`resourceSections` 等读的结果字段（模块扩充，纯类型、零运行时）。
 * 此前未声明 ⇒ 写端无类型、读端 `as any`，拼错键两头都不报错。
 */
declare module '@/types/resource/agentResources' {
  interface CharacterResourceResult {
    /** 叶曙光循环明细 */
    yeshuguangCycle?: YeshuguangCycleResult
  }
}

declare module '@/types/resource/config' {
  interface CharacterOperationConfig {
    // r392（D2 §5）：以下原经 Record 强转读写、无声明（拼错键名不报错），现补声明
    /** 影画等级（buildCharConfig 写） */
    yeshuguangCinemaLevel?: number
    /** auto 明心境轴当前退化档（estimateExSpecialTime 按 timePressureSeconds 逐级写） */
    yeshuguangAutoAxis?: YeshuguangFormAxis
    /** 连续形态开关（buildCharConfig 恒写 true） */
    yeshuguangContinuousForms?: boolean
    /** 招式伤害行 moveId → 倍率（buildCharConfig 预存） */
    yeshuguangMoveDmg?: Record<string, number>
    /** 招式次数 moveId → 次数（buildCharConfig 预存） */
    yeshuguangMoveTimes?: Record<string, number>
    /** 普攻秒均 attack_data_0 */
    yeshuguangAtk0PerSec?: number
    /** 闪避反击 attack_data_0（1431022） */
    yeshuguangAtk0Dodge?: number
    /** 强特 attack_data_0（1431016） */
    yeshuguangAtk0Ex?: number
    /** 连携 attack_data_0（1431024） */
    yeshuguangAtk0Chain?: number
    /** 额外能力是否生效（面板 additionalAbilityActive） */
    yeshuguangAdditionalAbilityActive?: number
    /** 本轮循环结算（resolveCycle 结果；换轴时清空） */
    yeshuguangCycle?: YeshuguangCycleResult
    /** 叶瞬光青溟剑势初始（影画1：进场 6 点；未达1命为 0） */
    yeshuguangSwordInitial?: number
    /** 叶瞬光：琉音转大赠送逐云次数（编排层注入） */
    yeshuguangGiftUltCount?: number
    /**
     * CC-160：终局冻结的照影轮数 = 终局入口态实数照影轮数 floor 一次（`finalizePass.begin` 写入、`reset` 清除）。
     * 存在时终局重推不再从平A重推照影（`@fact agent:1431/终局整数化`「floor 一次」）。
     */
    yeshuguangFrozenZhaoying?: number
    /**
     * 叶瞬光终局整数化旗标（引擎写入，同 `exFinalize` / `billyFinalizeChain` 骨架）。
     *
     * 迭代期明心境轮数以**实数**参与收敛（防「平A↑→剑势↑→轮数+1整轮→必要时间↑→平A↓」正反馈环，
     * 见 `@fact agent:1431/轮数实数化`）；收敛后置 true ⇒ 模块把**资源推导的触发次数**（照影）
     * floor 一次，再重推 ≤12 轮到全状态逐位稳定。语义 = 余数剑势留着不打（不足 6 点不能变身），
     * 「多出的那一轮」由合轴率 + 缩时轴承担，而不是把离散轮数切成小数。
     * 旗标在最终装配后才复位（与 1531 同款：装配行必须按终局语义出账）。
     */
    yeshuguangFinalizeForms?: boolean
  }
}

/**
 * D2（CC-359/360）：本模块自产自读的跨轮反馈键（nextRoundFeedback 产出、下一轮本模块读回），声明随模块走，不堆在 `mechanics/types.ts`。
 * 仍是 `ModuleFeedback` 的成员（模块扩充，纯类型、零运行时）；被第二处引用时请迁回公共接口。
 */
declare module '@/mechanics/types' {
  interface ModuleFeedback {
    /** 琉音转大赠送的叶瞬光逐云次数 */
    yeshuguangGiftUlt?: number
  }
}
