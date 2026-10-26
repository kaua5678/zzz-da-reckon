import type {
  AgentCharConfigInput,
  AgentMechanicModule,
  AgentPanelInput,
  AgentResourceInput,
  AgentResourceResultInput,
  AgentResourceSectionsInput,
  AgentTeamPanelEffectInput,
} from '../types'
import type { MechanicSetting } from '@/types/resource'
import type { SkillMove } from '@/types/catalog'
import type { CharacterResourceResult} from '@/types/resource'
import { fmt } from '@/utils/format'
import { getAgentSpec } from '@/specs/registry'
import { buildSpecEventExecutions } from '@/specs/mechanics'
import { specAdjustableRate } from '@/specs/resources'
import { findMoveById, getRowValue } from '@/data/moveTableQueries'
import { cinemaLevelOf } from '@/data/cinemaLevel'
import { additionalAbilityActiveOf } from '@/core/additionalAbilityActive'
import { evalAdditionalAbility } from '@/specs/teamCondition'
import { panelOfSlot } from '@/core/sourcePanels'

/**
 * 洛克茜（1621）v12 重录（2026-09-03，nanoka 3.2.12+18601660）：
 * - 核心被动·热夜初拥（Lv.7 原文）：每消耗 25 点能量获得 1 点[风能]（上限 3 点）；
 *   初始能量自动回复 >1.2 时，每超过 0.01 攻击 +5（上限 960）、冲击 +0.4（上限 76.8）；
 *   恕不远送命中[风化] → [浸染]还原、队友[浸染]增益按职业等：依赖风化队伍，未建模（note）。
 * - 额外能力·辉金心脏（强攻/命破/锋御队友）：自身伤害 +8%+1.2%/**角色等级**（Lv60 命中上限 80%）；
 *   攻击命中 → 失衡易伤倍率 +30%（至失衡结束，满覆盖近似）+ 失衡时长 +2s；
 *   敌方[风化]时风/浸染直伤 +8%（按风化覆盖率近似全伤通道）；进场回 40 能量（勘域 180s）；
 *   风化延长 20s（无数值）；强特后异常积蓄效率 +30%（50s ⇒ 满覆盖近似，已接）。
 * - 资源循环（v12）：小心风寒（1621007，10 能量启动 +30/s 自旋）→ 结束自动 敬请安息（1621023）
 *   消耗全部[风能]（每 1 点 = 额外 1621021 一段 + 生成 1 个[风眼]，上限 9 同时存在、30s 自爆/超限最早引爆）；
 *   风眼爆鸣 1621022；敬请安息后场上+自身≥3 → 自动 恕不远送（1621005，引爆至多 3 个风眼：
 *   3 个同命中 → 巨旋风 1621020（1s）；不足 → 小旋风 1621019（1s/个，v12 = 1 秒）；终结技 +1 点[风能]。
 * - 影画：C1 敬请安息命中 → 全抗-15%（50s）+ 自身暴伤+40%；C2 小心风寒失衡易伤 +30%（v12：旧 25% → 30%）
 *   + 流势/自旋维持（机动向不建模）；C4 招架+1/闪反+2 能量 + 终结 +20% 伤（失衡+10% 未单接）；
 *   C6 无视 15% 风抗（v12：旧 20% → 15%）+ 巨旋风 ×250%（失衡+20% 未单接）+ [余响]每次引爆额外 2 次
 *   巨旋风——**精确值**：巨型风旋是次数启动器，每生成一个必然附送 2 个额外巨型风旋，重复触发叠加
 *   不吞掉 ⇒ 与[余响]持续秒数无关（用户口径 2026-10-25「总量计算器不需要管他持续几秒」）。
 */
const ROXY_AGENT_ID = '1621'
/** 风能：每 25 能量 +1 点（核心被动 Lv.7），存量上限 3；终结技额外 +1 点 */
/**
 * 满自旋秒数 = 长按到攒满 3 风能松手（75 能量 / 30 每秒）。**不是滑块**——用户裁决 2026-10-19：
 * 自旋秒数由能量预算自动算（若干满发 + 1 次零散），见 `computeRoxyExCount`。
 */
export const ROXY_FULL_SPIN_SECONDS = 2.5
export const ENERGY_PER_WIND_ENERGY = 25
export const WIND_ENERGY_MAX = 3
/** 敬请安息每消耗 1 点[风能]：额外 1621021（52.5%）+ 生成 1 个[风眼] */
export const WIND_EYE_PER_ENERGY = 1
export const WIND_EYE_MAX = 9
/** 恕不远送：引爆至多 3 个风眼；3 个同命中 → 巨旋风（1621020）；不足 → 小旋风（1621019，1s/个） */
export const SEND_OFF_BURST_MAX = 3
export const MINI_TORNADO_SECONDS = 1
/** moveId（v12）：小心风寒/自旋每秒/敬请安息/额外段/风眼爆鸣/小旋风每秒/巨旋风每秒/恕不远送/终结 */
const EX_CHILL_MOVE_ID = '1621007'
const SPIN_SECOND_MOVE_ID = '1621008'
const REST_PEACE_MOVE_ID = '1621023'
const PER_ENERGY_EXTRA_MOVE_ID = '1621021'
const EYE_BURST_MOVE_ID = '1621022'
const MINI_TORNADO_MOVE_ID = '1621019'
const MEGA_TORNADO_MOVE_ID = '1621020'
const SEND_OFF_MOVE_ID = '1621005'
const ROXY_ULT_MOVE_ID = '1621012'
/** 影画1：敬请安息命中 → 全抗-15%（50s）+ 自身暴伤+40% */
export const ROXY_C1_CRIT_DMG = 40
/** 影画2：小心风寒命中 → 失衡易伤+30%（v12：旧 25% → 30%）+ 小心风寒失衡值+5% */
export const ROXY_C2_EX_CHILL_DAZE_BONUS = 5
/** 影画4：招架回1/闪反回2 能量 + 终结技伤害+20%（失衡值+10%） */
export const ROXY_C4_PARRY_ENERGY = 1
export const ROXY_C4_DODGE_ENERGY = 2
export const ROXY_C4_ULT_DMG = 20
export const ROXY_C4_ULT_DAZE_BONUS = 10
/** 影画6：无视 15% 风抗（v12：旧 20% → 15%）+ 巨旋风倍率 ×250%（失衡值+20%）+ 余响 2 次/引爆（上界） */
export const ROXY_C6_WIND_RES_REDUCTION = 15
export const ROXY_C6_MEGA_TORNADO_MULT = 2.5
export const ROXY_C6_MEGA_DAZE_BONUS = 20
export const ROXY_C6_ECHO_BURSTS = 2
/** 额外能力：自身伤害 +8%+1.2%/级（**角色等级**轴，Lv60 命中「最多提升80%」上限）；进场回 40 能量 */
// @fact agent:1621/额外能力伤害·等级轴 口径: 「洛克茜造成的伤害提升8%，该效果随**角色等级**提升，每级增加1.2%，最多提升80%」的「级」是**角色等级**（60 级满级）而非核心被动等级 ⇒ 取上限 80（8+1.2×60=80 恰等于原文写的上限，自洽）；判据 = 该子句在 raw 的 7 条 passive.level 里**逐字恒定**（8/1.2/80 三级都不随被动等级变），而真正走被动等级轴的子句（如 1611 核心 20→50）在 7 条里**逐级递增** ⇒ 两类轴可用「是否随 passive.level 变化」机械区分；同族三条（1571 44+14/级→870、1591 120+12/级→840、1631 100+10/级→700）同样取各自上限，本条的 15.2（=8+1.2×6，误按被动 Lv.7 读）是**孤例** | 据 nanoka 3.2 raw passive.level.1621501~07@2026-09-20·外部复核（zh/en/ja/ko 四语言 + 3.3.3 构建 + gachabase 均作「角色等级」；ja=エージェントレベル、ko=캐릭터 레벨）@2026-09-20·复核@2026-09-25·锚未变@2026-09-27·复核@2026-09-30 | 验 src/specs/__tests__/roxyAdditionalAbility.test.ts | 锚 src/mechanics/agents/roxy.ts#ROXY_AA_DMG_BONUS_LV60 | 信 高
// ⟳复核: 官方若给出「随角色等级提升」的等级-数值对照表（或本仓引入角色等级输入）时复核本上限 | 到期 2027-03-31
export const ROXY_AA_DMG_BONUS_LV60 = 80
export const ROXY_AA_ENTER_ENERGY = 40
/**
 * 额外能力·辉金心脏：「攻击命中 → **失衡时长 +2s**」（原文见本文件头注释）。
 *
 * ⚠ **此前只在注释里、从未写进面板**（2026-10-20 用户点出：「我记得洛克茜有延长失衡 2s 的被动」）——
 * `applyRoxyPanel` 自 v12 重录起就没有这一项 ⇒ 含洛克茜的队失衡窗口恒按 `stunTime + 4`（缺省 16s）算，
 * 而不是原文的 18s。实测（`.zc/perf/windowDurationAudit.perf.ts`）：`banyue-roxy-lucia` 全槽
 * `stunDurationBonusSeconds = 0` ⇒ W=16。
 *
 * 口径：**满覆盖**（与同文件其它「攻击命中 →」条目同款近似：失衡窗口内洛克茜的攻击必然命中）。
 * 门控：额外能力需「强攻/命破/锋御」队友——由 `additionalAbilityActiveOf(panel)` 判定（与伤害 +80%
 * 同一处门控；原文把两条写在同一句里）。
 */
export const ROXY_AA_STUN_DURATION = 2
/** 额外能力：「释放[强化特殊技]时，自身异常积蓄效率提升 30%，持续 50 秒」（自身，非全队） */
export const ROXY_AA_BUILDUP_EFFICIENCY = 30
/** 额外能力：「全队角色施加的[风化]效果延长 20 秒」⇒ 风化持续时间 30 → 50s（覆盖率通道） */
export const ROXY_AA_WIND_DURATION_EXTENSION = 20
/**
 * 影画2·流势（免费自旋）：「每引爆 1 个[风眼]获得一层[流势]，至多 3 层；[小心风寒]期间进入[自旋]状态下
 * 换人时，洛克茜将消耗所有[流势]，每消耗 1 层可以维持[自旋]状态 0.2 秒，**期间不消耗能量**，至多维持 0.6 秒」。
 *
 * **用户口径 2026-10-26**：「免费自旋你假设全吃满就行，有多少流势都可以吃完。因为换人不能作为条件，
 * 很容易达成。本来他转完就要换人。」⇒ 按**满层（3 层 = 0.6s）**建模，不作覆盖率滑块。
 *
 * 收益面：0.6s **不花能量**的自旋 ⇒ 白得 `0.6 × 自旋每秒倍率` 的伤害 + `0.6 × 84.343` 的喧响，
 * 且不占能量预算（不减少可打强特次数，是纯增量）。
 */
export const ROXY_C2_FLOW_MOMENTUM_SECONDS_PER_STACK = 0.2
export const ROXY_C2_FLOW_MOMENTUM_MAX_STACKS = 3
/**
 * 核心被动·热夜初拥（Lv.7）：「队伍中任意队友触发[浸染]或[净化]时，洛克茜按自身每 1% 暴击率
 * 为全队提供：非[锋御]角色对应属性与风属性伤害暴击伤害 +0.4%（上限 40%）；[锋御]角色锐暴伤害
 * +0.2%（上限 20%）；每个属性增益持续 50 秒」。
 *
 * **用户口径 2026-10-26**：「洛克茜本人足够达到多次浸染，净化也是他自己的机制」⇒ 按**满覆盖**建模
 * （不做覆盖率滑块——这正是它与维琳娜 6 命风化增伤那条的区别）。
 *
 * 落点 = `teamPanelEffects`（全队每个槽位各写一次）：x 必须取**洛克茜自己**的局内暴击率，
 * 面板阶段只有该钩子能拿到 `sourcePanels`（`applyPanel` 手上只有自己的、收不到队友的；
 * spec `teamBuffs` 的 `formula.sourceStat` 读的是**接收者**面板 ⇒ 用它会把队友暴击率当基数，错）。
 * 两条按目标职业分流：锐化角色只读 `sharpCritDmg`、其余只读 `critDmg`，各写一条，天然不双计。
 */
export const ROXY_CORE_CRIT_DMG_PER_CRIT = 0.4
export const ROXY_CORE_CRIT_DMG_CAP = 40
export const ROXY_CORE_SHARP_CRIT_DMG_PER_CRIT = 0.2
export const ROXY_CORE_SHARP_CRIT_DMG_CAP = 20

/** 转模：初始能量回复 >1.2 → 每 0.01：攻击 +5（上限 960）、冲击 +0.4（上限 76.8） */
export const ROXY_REGEN_ATK_PER_0_01 = 5
export const ROXY_REGEN_ATK_CAP = 960
export const ROXY_REGEN_IMPACT_PER_0_01 = 0.4
export const ROXY_REGEN_IMPACT_CAP = 76.8

/**
 * 小心风寒（1621007）耗能（CC-109，R5 D28）：catalog `energyCost` 的「Energy Cost」= 启动耗能，
 * 「Energy Cost Per Second」= 自旋每秒耗能（v12：10 + 30/s）。解析失败回落 10 / 30。
 */
export function roxyExEnergyCost(move: SkillMove | null | undefined): { start: number; perSecond: number } {
  const raw = (move?.energyCost ?? {}) as Record<string, string>
  const num = (k: string, fb: number) => {
    const n = parseFloat(raw[k] ?? '')
    return Number.isFinite(n) && n >= 0 ? n : fb
  }
  return { start: num('Energy Cost', 10), perSecond: num('Energy Cost Per Second', 30) }
}

/** 两条 `adjustable` 的 id（spec 声明与本模块消费同源引用，规则 11 单一事实源）；比例由 `specAdjustableRate` 按 spec 声明读（缺省值与区间） */
export const ROXY_WIND_ENERGY_RATE_ID = '1621.roxy_wind_energy.wind_energy_per_30_energy.rate'
export const ROXY_WIND_EYE_RATE_ID = '1621.roxy_wind_eye.wind_eye_from_cannon.rate'

/**
 * 洛克茜风能/风眼资源（v12 + 用户手法 2026-09-03）：
 * 手法：强特长按（小心风寒→自旋）直到获得 3 风能就松手 → 敬请安息消耗全部风能。
 * 每轮强特 = 风能 +3（自旋 75 能量 = 2.5s × 30/s → 每 25 能量 +1 ×3）+ 终结技 +1；
 * 每轮敬请安息消耗 3 点（= 3 额外段 1621021 + 3 风眼）→ 恕不远送 = floor(消耗/3) = 每轮 1 次巨旋风（1s），
 * 无余数（3/轮 手法下小旋风恒 0，留作余数兜底）。
 */
/**
 * 洛克茜强特**次数**：若干次满自旋 + 1 次零散发把能量放完（用户口径 2026-10-19）。
 *
 * 用户原话：「用户滑块感觉也没必要，这里的自旋秒数应该自动计算，自动把能量放完。
 * 他会放多次满秒数和1次零散的，打出全部能量。」
 *
 * 旧实现走通用 `floor(E / 满发耗能)` ⇒ 剩余能量只要够一发（哪怕只有启动那 10 点）就被丢掉，
 * 少算一整次强特。本式：
 *   n_full = floor(E / 满发耗能)，R = E − n_full × 满发耗能；
 *   R ≥ 启动耗能（10）⇒ 还能打**一次零散发**（自旋秒数由 R 反推）⇒ 次数 +1。
 * R < 10 时确实打不出来（连启动都付不起），与旧式相同。
 */
export function computeRoxyExCount(totalEnergy: number, fullSpinSeconds: number): number {
  const fullSpin = Math.max(0, fullSpinSeconds)
  const start = 10
  const perSecond = 30
  const fullCost = start + fullSpin * perSecond
  if (!Number.isFinite(totalEnergy) || totalEnergy <= 0 || fullCost <= 0) return 0
  const nFull = Math.floor(totalEnergy / fullCost)
  const remainder = totalEnergy - nFull * fullCost
  /**
   * 剩余够启动（10 点）⇒ 还能打**一次零散发**（自旋秒数由剩余反推，可以很短）。
   *
   * ⚠ **不设「最短自旋秒数」门槛**（试过 1 秒，实测否决）：用户口径是「**打出全部能量**」，
   * 只要付得起启动就打得出来。加门槛会让 `banyue-roxy-lucia` 丢掉那一发（0.204s ⇒ 不计）
   * ⇒ 它的外层环立刻复发（`cycle/20`）——**那正是本卡要修的形态**，所以门槛不能有。
   * 时间账上的代价由「零散发只占它自己的秒数」承担（见 `partialSpinSeconds` / 执行行拆两行）。
   *
   * ⚠ **`Math.floor` 只对满发数取整，零散发是「有/无」的 0-1 台阶**——这是**真实的不连续**，
   * 不是建模瑕疵：能量刚好跨过 10 点启动线时，玩家确实多打一次。它的副作用是「迭代相位
   * 不同 ⇒ 收敛到不同格」，实测 `landingPointUniqueness` 的 claret 夹具三槽 `totalDecibel`
   * 差 1.5254（`weighted` 相位 vs 其它三个）。**不为此加平滑**：平滑会让「差 1 点就能多打一发」
   * 这个用户明确关心的台阶消失（那正是本卡的 B 项）。
   */
  return nFull + (remainder >= start - 1e-9 ? 1 : 0)
}

export function computeRoxyWindEnergy(input: {
  exSpecialCount: number
  exSpecialEnergyConsume?: number
  ultimateCount?: number
  /** 满自旋秒数（默认 2.5s = 长按到 3 风能松手）。零散发由剩余能量反推，见 `partialSpinSeconds` */
  spinSeconds?: number
  /**
   * 本局可用能量总额（点）。给了 ⇒ 自旋秒数按「放完全部能量」求解（若干次满自旋 + 1 次零散），
   * 不给 ⇒ 退回旧口径（每次强特都按满自旋记）。用户口径 2026-10-19。
   */
  totalEnergy?: number
  cinemaLevel?: number
  /** 风能转化率（spec `adjustable`，生产侧已按声明钳到区间；未传 = 1 不缩放）——缩放「每轮耗能」这一侧，见下 */
  energyRate?: number
  /** 风眼转化率（spec `adjustable`，生产侧已按声明钳到区间；未传 = 1 不缩放）——缩放「风能 → 风眼」的生成数，见下 */
  eyeRate?: number
}): RoxyWindEnergySource {
  /**
   * ## 自旋秒数 = **自动放完能量**（用户口径 2026-10-19，取代固定滑块）
   *
   * 用户原话：「用户滑块感觉也没必要，这里的自旋秒数应该自动计算，自动把能量放完。
   * 他会放多次满秒数和1次零散的，打出全部能量。」
   *
   * ⇒ 一次强特 = 10 启动 + 30/s 自旋；玩家会用**若干次满自旋**（`fullSpinSeconds`，默认 2.5s）
   * 加**一次零散自旋**（把剩下的能量放完，可能 0 秒）来清空能量池。旧实现把「每次强特都满 2.5s」
   * 当固定口径 ⇒ 剩余能量不足一发满自旋时，要么少算一发、要么整发按 85 记（虚构耗能）。
   *
   * 本函数现在按「总能量 → 拆成满发 + 零散发」求解：`fullSpinSeconds` 只决定**满发那一档多长**，
   * 零散发的秒数由剩余能量反推（`partialSpinSeconds`）。不传 `totalEnergy` 时退回旧口径（每次满秒）。
   */
  const fullSpinSeconds = Math.max(0, Number(input.spinSeconds ?? 2.5))
  const exCount = Math.max(0, Math.floor(input.exSpecialCount))
  const cinema = cinemaLevelOf(input.cinemaLevel)
  const energyRate = input.energyRate ?? 1
  const eyeRate = input.eyeRate ?? 1
  // 每轮自旋耗能 = 自旋秒 × 30/s（+ 10 启动）；风能 = 每 25 能量 +1，手法按 3 点/轮攒满
  // ⚠ `ENERGY_PER_WIND_ENERGY = 25` 是**原文口径**（nanoka 3.2 raw 的 passive Lv.1~7 逐字 7 处
  // 「每消耗25点能量，获得1点[风能]」，3.3.3 构建同样 25）。spec `1621.json` 曾写「30」= 2026-08-04
  // 一份 scratch 摘要（`data/raw/_archive/scratch/spec_notes_1621.txt:4`）的**笔误**，
  // `docs/MECHANICS_IMPLEMENTATION.md:149` 早已记为「旧口径已废除」⇒ **不要**把 25 改成 30
  // （R51 隔离 worktree 实测：改成 30 ⇒ `roxy`/`specialMechanics` 5 failed，全管线伤害 −1.59%）。
  /**
   * **每次强特的耗能拆解**（用户口径 2026-10-19「他会放多次满秒数和 1 次零散的，打出全部能量」）。
   *
   * 满发自旋 = `fullSpinSeconds`、每秒 30 点、启动 10 点 ⇒ 满发耗能 = `10 + 30 × fullSpinSeconds`。
   * 给了 `totalEnergy` 时：先按满发数出能打几次，**最后那一次用剩余能量决定自旋秒数**
   * （`partialSpinSeconds = (剩余 − 10) / 30`，剩余连 10 点启动都不够 ⇒ 打不出零散发）。
   * 不给 `totalEnergy` ⇒ 旧口径（每次都是满发）。
   *
   * ⚠ 这修掉的是**旧实现的两个虚假量**：① 每次强特都按满发记耗能 ⇒ 最后一次虚构了用不掉的能量；
   * ② 次数 = `floor(能量 / 满发耗能)` ⇒ 剩余能量永远进不了账 ⇒ 自旋总时长被系统性少算。
   */
  const exStart = 10
  const perSecond = 30
  const perExEnergy = input.exSpecialEnergyConsume !== undefined && input.exSpecialEnergyConsume > 0
    ? input.exSpecialEnergyConsume
    : (exStart + fullSpinSeconds * perSecond)
  const totalEnergy = Number(input.totalEnergy)
  const haveEnergyBudget = Number.isFinite(totalEnergy) && totalEnergy > 0
  /** 零散发自旋秒数：由剩余能量反推；不够启动（10 点）⇒ 0 = 这一发不存在 */
  const partialSpinSeconds = (() => {
    if (!haveEnergyBudget) return fullSpinSeconds
    /**
     * ⚠ 零散发**也是 exCount 里的那一发**（次数已由 `computeRoxyExCount` 算成「满发 + 零散」），
     * 不是「满发之外的额外一发」。故剩余 = 总能量 − (满发数 − 1) × 满发耗能 − 启动。
     * 用 `exCount × perExEnergy` 会多减一整发 ⇒ 算出的零散秒数恒偏小、行耗能对不上账
     * （实测 spin=2.5：预算 396.45 / 5 发 / 行耗能 350，差 46.45 = 一整发的 46.45s 自旋）。
     */
    const nFull = Math.max(0, exCount - 1)
    const remainder = totalEnergy - nFull * perExEnergy
    if (remainder < exStart) return 0
    return Math.max(0, (remainder - exStart) / perSecond)
  })()
  /** 最后一次是零散发（自旋秒数 > 0 且 < 满发）⇒ 它的耗能按实际秒数记，不是满发 */
  const lastIsPartial = haveEnergyBudget && exCount > 0 && partialSpinSeconds > 0 && partialSpinSeconds < fullSpinSeconds
  /** 实际自旋总秒数 = 满发次数 × 满发秒 + （零散发时）零散秒 */
  const effectiveSpinSecondsTotal = lastIsPartial
    ? (exCount - 1) * fullSpinSeconds + partialSpinSeconds
    : exCount * fullSpinSeconds
  const energySpentTotal = lastIsPartial
    ? (exCount - 1) * perExEnergy + (exStart + partialSpinSeconds * perSecond)
    : exCount * perExEnergy
  // `adjustable` 的计数源就是「每消耗 N 点能量」⇒ 比例必须乘在**耗能**这一侧（不是 gain）：
  // 乘 gain 会让 `energySpentTotal`（有独立执行行 `totalEnergyConsume`）与风能脱钩 ⇒ 双账。
  const energyPerRound = perExEnergy * energyRate
  /**
   * 风能 = 每消耗 25 能量 +1。**按实际耗能算**（含零散发那一发比满发少的部分）——
   * 旧实现按「次数 × 满发耗能」算 ⇒ 零散发被当成满发，凭空多给风能。
   */
  const windEnergyGain = (lastIsPartial
    ? (exCount - 1) * Math.floor(energyPerRound / ENERGY_PER_WIND_ENERGY)
      + Math.floor(((exStart + partialSpinSeconds * perSecond) * energyRate) / ENERGY_PER_WIND_ENERGY)
    : exCount * Math.floor(energyPerRound / ENERGY_PER_WIND_ENERGY))
    + Math.max(0, Math.floor(Number(input.ultimateCount ?? 0)))
  // 存量上限 3：每发敬请安息至多消耗 3 点 → 总消耗 = min(总获得, 强特次数 × 3)
  const windEnergyConsumed = Math.min(windEnergyGain, exCount * WIND_ENERGY_MAX)
  // ── 风眼账本（R51 用户裁决「对该资源进行建模，计数，回复和消耗」）──────────────────
  // 原文 `special.description[3]`：「每消耗1点[风能]，在攻击后额外造成一次风属性伤害，
  // 并在原地生成1个[风眼]」⇒ 风眼**生成数 = 消耗的风能点数 × WIND_EYE_PER_ENERGY**（本条 = 回复侧）。
  const windEyeGenerated = Math.floor(windEnergyConsumed * WIND_EYE_PER_ENERGY * eyeRate + 1e-9)
  // ⚠ **恕不远送与大小旋风必须从「风眼数」推，不能从「风能消耗」推**：原文 `description[1]`
  // 的触发条件是「场上[风眼]和自身[风能]共计至少3个」⇒ 消耗侧是**风眼**。
  // 默认 `eyeRate=1` 且 `WIND_EYE_PER_ENERGY=1` 时 `windEyeGenerated === windEnergyConsumed`
  // ⇒ 本式与旧式 `floor(windEnergyConsumed / 3)` **逐位相同**（改的是口径来源不是数值）。
  // ── 风眼「同时存量≤9 / 30s 自然引爆 / 超限最早引爆」时序口径（R52 收口，原 debt 销号）──────
  // 原文 `special.description[4]`：「持续30秒后自动引爆；最多同时存在9个，超出上限后**最早生成**的
  // 会自动引爆」= FIFO 队列 + 逐事件计时。R52 把逐事件队列**真建出来**跑闸门（全库 5702 次引擎求值：
  // 105 预设 + 60 角色 × 命座 0/3/4/5/6），结论 = **默认手法下本式与真队列逐位相同**，理由是结构性的：
  //   单发风眼上界 = `min(WIND_ENERGY_MAX=3, floor(单轮耗能/25))` ≤ 3；
  //   而每次恕不远送恰引爆 `SEND_OFF_BURST_MAX`=3 ⇒ 队**每发清空**，队列长度恒 ≤ 3 < 9
  //   ⇒ 9 上限与 30s 自爆**结构性不可达**（不是「影响小」，是「到不了」）。
  // 默认 `spinSeconds=2.5` ⇒ 单轮耗能 10+75=85 ⇒ `floor(85/25)`=3 ⇒ 风眼数恒为 3 的倍数
  // ⇒ 连余数项都恒 0 ⇒ 本式**就是**原文语义的精确解，不是近似。
  // ⚠ 两个**滑块域**边界（默认域之外仍是近似；逐事件真值需要引擎没有的「逐发绝对时刻」）：
  //   ① `eyeRate > 4/3`（spec `adjustable` 上限 2）⇒ 单发可 > 3 ⇒ 9 上限真的咬合，本式**高估**
  //      （本文件夹具实测 `rate=2`：本式 so=86 / FIFO so=43）；
  //   ② `spinSeconds < 65/30`（≈2.1667）⇒ 单发 1~2 ⇒ 局末留 1~2 个未触发的眼，本式把余数计成
  //      小旋风而 FIFO 判其未发动 ⇒ 小旋风偏乐观（本文件夹具实测 `spin=0.5`：本式 mini=2 / FIFO=0）。
  // ⚠ 为什么不把真队列落进引擎：`buildExecutions`/`buildResourceResult` 的入参只有**整局总量**
  // （`IterationState` 无逐动作时刻、`SkillExecution` 无时间戳），轴内 `StunAxisAction.startTime`
  // 也只是**相对窗口起点**、窗口绝对时刻全仓无生产者 ⇒ 落真队列必须**编造**发次间隔，那等于把
  // 未建模假设写进伤害数（R52 侦察的实测证据，见 `.claude/PROMPT-handoff-round52.md` §3）。
  // ⚠ 同样刻意**不**把 `WIND_EYE_MAX` 当总量上限用：那是「同时存在」上限，按总量钳会让
  // `sendOffCount` 从 38 塌成 3（R51 侦察实测）——属把时序约束误当总量约束，比不建模更错。
  // @fact agent:1621/风眼时序 近似: 「同时存量≤9 / 30s 自然引爆」在默认手法下**结构性不可达**（单发风眼 ≤ WIND_ENERGY_MAX=3 < 9，且每发恕不远送清空队列）⇒ `sendOffCount = floor(windEyeGenerated/SEND_OFF_BURST_MAX)` 是精确解而非近似；天花板 = 滑块域 `eyeRate>4/3`（单发>3 ⇒ 9 上限咬合，本式高估）与 `spinSeconds<65/30`（局末余留眼被本式计成小旋风） | 据 nanoka 3.2 raw special.description[4]@2026-09-20·R52 全库 5702 次引擎求值零 delta@2026-09-20·复核@2026-09-25·锚未变@2026-09-27·复核@2026-09-30·复核@2026-10-07·复核@2026-10-08 | 验 src/mechanics/__tests__/roxyWindEyeTiming.test.ts | 锚 src/mechanics/agents/roxy.ts#computeRoxyWindEnergy | 信 确认
  // ⟳复核: 引擎若获得「逐发绝对时刻」通道（或在 eyeRate>1 滑块域落地真 FIFO 队列）时复核本近似边界 | 到期 2027-03-31
  const sendOffCount = Math.floor(windEyeGenerated / SEND_OFF_BURST_MAX)
  // ── 影画6 [余响]：**精确值**（用户 2026-10-25 裁决，取代 R52/R53 的「只能给上界」）──────
  // 原文 `talent.6.desc`（`data/raw/nanoka_missing/full/1621.json`；EN 同构
  // 「A Giant Windstorm is generated at the target's location every 3s, for a total of 2
  //  additional Giant Windstorms. Repeated triggers stack the number of additional Giant
  //  Windstorm instances generated and refresh the duration of Afterecho.」）：
  //   「[特殊技：恕不远送]引爆[风眼]生成巨型风旋时，主目标会被赋予[余响]效果，**每间隔3秒**在目标
  //     位置生成一次巨型风旋，**共额外生成2次**巨型风旋，重复触发时额外生成次数**叠加**且**刷新**
  //     [余响]的持续时间」。
  //
  // ★【用户口径 2026-10-25，逐字】：
  //   > 「这个和时间没关系，首先生成巨型风旋作为次数启动器，一个余响共额外生成 2 个巨型风旋，
  //   >   重复触发可以叠加次数，意思是**不会吞掉**。这就很简单的逻辑了，
  //   >   引爆[风眼]生成巨型风旋的数量 × 2 = 他赠送的额外巨型风旋数量。
  //   >   **总量计算器不需要管他持续几秒**，而是观察到他**总会生成 2 个**巨型风旋就行了。」
  //
  // ⇒ **正确读法**：巨型风旋 = **次数启动器**，每生成一个就**必然**附送 2 个额外的；
  //   重复触发**叠加**（不吞掉、不排队、不溢出）⇒ 额外数量 **恒 = 引爆数 × 2**，**精确、无区间**。
  //
  // ⚠ **本段推翻了 R52/R53 的「合法区间 [17, 86]、只能给共同上界」**：
  //   那套推理的前提是「[余响] 有持续秒数 D，3s 节拍会在窗口内发不完」——但「每间隔 3 秒」
  //   描述的是**赠送出来的那两个巨型风旋之间的间隔**，不是「一个会过期的计时池」。
  //   既然叠加不吞掉，D 根本不进入总量公式 ⇒ 原文没给 D **不是缺口**，是**不需要**。
  //   已实测：`D=6 ⇒ 17 / D=180 ⇒ 60 / 逐实例 86` 那组「分歧」全部是把节拍误当容量上限的产物。
  //
  // 判据：`src/mechanics/__tests__/roxyEchoTiming.test.ts`（③ 真管线 `echo === 2×sendOff`、
  //   ③b 纯函数账本闭合、② 判别力负控）。旧「上界定理」用例已按本裁决改写为**等式**用例。
  // @fact agent:1621/余响时序 口径: [余响] 的额外巨型风旋数 = **引爆数 × 2**（精确值，非上界）——巨型风旋是次数启动器，每生成一个必然附送 2 个额外巨型风旋；重复触发**叠加不吞掉** ⇒ 与 [余响] 持续秒数无关，D 不进入公式 | 据 用户@2026-10-25「引爆[风眼]生成巨型风旋的数量*2=他赠送的额外巨型风旋数量。总量计算器不需要管他持续几秒」+ nanoka raw talent.6.desc 原文「共额外生成2次…叠加且刷新」 | 验 src/mechanics/__tests__/roxyEchoTiming.test.ts | 锚 src/mechanics/agents/roxy.ts#computeRoxyWindEnergy | 信 确认
  // ⟳复核: 若官方改「共额外生成 2 次」这个数字，或引入「同一时刻只能存在 N 个余响」的容量上限，重核本式 | 到期 2027-09-30
  const megaTornadoCount = sendOffCount + (cinema >= 6 ? sendOffCount * ROXY_C6_ECHO_BURSTS : 0)
  const miniTornadoCount = Math.max(0, windEyeGenerated - sendOffCount * SEND_OFF_BURST_MAX)

  return {
    energySpentTotal,
    windEnergyGain,
    windEnergyCap: WIND_ENERGY_MAX,
    windEnergyConsumed,
    windEyeGenerated,
    windEyeDestroyed: windEyeGenerated,
    sendOffCount,
    megaTornadoCount,
    miniTornadoCount,
    miniTornadoSeconds: miniTornadoCount * MINI_TORNADO_SECONDS,
    spinSeconds: fullSpinSeconds,
    /** 零散发（最后一发）的自旋秒数；未走「放完全部能量」口径时等于满发秒数 */
    partialSpinSeconds,
    /** 实际自旋总秒数（满发 × 满发秒 + 零散秒）——执行行与伤害按它算 */
    effectiveSpinSecondsTotal,
    /** 最后一发是不是零散发（自旋秒数 < 满发，耗能按实际秒数记） */
    lastIsPartial,
    note: 'v12+手法（用户 2026-09-03）：长按强特攒满 3 风能（自旋 2.5s×30/s≈75 能量）松手 → 敬请安息消耗 3（3 额外段+3 风眼）→ 恕不远送 1 次巨旋风（1s）；终结技 +1 风能。',
  }
}

/**
 * 核心被动·热夜初拥的**队伍级**那一半（用户口径 2026-10-26）。
 *
 * 「队伍中任意队友触发[浸染]或[净化]效果时，洛克茜将根据[浸染]或[净化]的属性为全队角色提供增益：
 *   洛克茜每拥有 1% 暴击率，非[锋御]角色造成对应属性以及风属性伤害时，暴击伤害提升 0.4%，最多 22%…
 *   [锋御]角色造成对应属性以及风属性伤害时，锐暴伤害提升 0.2%，最多 10%」
 * （上限随核心被动等级 Lv.1→7 递增 22→40 / 10→20，取 Lv.7 = 40 / 20）。
 *
 * ⚠ 基数 = **洛克茜自己**的局内暴击率（不是接收者的）⇒ 必须读 `sourcePanels[自己槽位][inCombat]`。
 * `panel` 是**目标槽位**的面板，读它会拿到队友的暴击率（spec formula 的 `sourceStat` 就是这个坑）。
 */
function applyRoxyTeamPanelEffects({
  slot, panel, targetAgent, sourcePanels, report,
}: AgentTeamPanelEffectInput): void {
  const ownPanel = panelOfSlot(sourcePanels, slot, 'inCombat')
  if (!ownPanel) return
  const critRate = Math.max(0, ownPanel.critRate)
  // 目标职业分流：锐化（锋御）吃锐暴伤害，其余吃通用暴伤。两条字段互斥读取（见 core/damage.ts 的
  // critModel 分支：sharp profile 只读 sharpCritDmg，其余只读 critDmg）⇒ 不会双计。
  if (targetAgent.specialty === 'sharpen') {
    const add = Math.min(ROXY_CORE_SHARP_CRIT_DMG_CAP, critRate * ROXY_CORE_SHARP_CRIT_DMG_PER_CRIT)
    if (add > 0) {
      panel.sharpCritDmg = panel.sharpCritDmg + add
      report?.({ stat: 'sharpCritDmg', value: add, mode: 'flat' })
    }
    return
  }
  const add = Math.min(ROXY_CORE_CRIT_DMG_CAP, critRate * ROXY_CORE_CRIT_DMG_PER_CRIT)
  if (add > 0) {
    panel.critDmg = panel.critDmg + add
    report?.({ stat: 'critDmg', value: add, mode: 'flat' })
  }
}

function buildRoxyCharConfig({ skills, cfg, cinemaLevel }: AgentCharConfigInput): void {
  cfg.skipGenericExSpecial = true
  cfg.roxyCinemaLevel = cinemaLevelOf(cinemaLevel)
  // v12 moveIds
  const spinSeconds = ROXY_FULL_SPIN_SECONDS
  // CC-109（R5 D28）：一次强特 = 小心风寒启动 + 自旋 spinSeconds 秒，耗能按 catalog 两项合计。
  // 修前沿用通用 findExSpecial 的「Energy Cost」10（只算启动），自旋 30/s 零扣费 ⇒ 强特次数按 能量/10 推，
  // 而风能账本 computeRoxyWindEnergy 按 10 + 30×秒 记耗能，两本账不一致。
  const exCost = roxyExEnergyCost(findMoveById(skills, EX_CHILL_MOVE_ID))
  cfg.roxyExStartEnergy = exCost.start
  cfg.roxySpinEnergyPerSecond = exCost.perSecond
  cfg.exSpecialEnergyConsume = exCost.start + exCost.perSecond * spinSeconds
  cfg.roxySpinSecondDamage = getRowValue(findMoveById(skills, SPIN_SECOND_MOVE_ID), 'damage')
  // 自旋喧响表值（1621008 decibel_recovery，每秒口径——与同行 damage 已录的「每秒 × spinSeconds」口径一致；
  // 行值经 decibelRecoveryOverride 跳过表值回填，见 buildRoxyExecutions）
  cfg.roxySpinSecondDecibel = getRowValue(findMoveById(skills, SPIN_SECOND_MOVE_ID), 'decibel_recovery')
  cfg.mechanicRowValues = {
    [PER_ENERGY_EXTRA_MOVE_ID]: getRowValue(findMoveById(skills, PER_ENERGY_EXTRA_MOVE_ID), 'damage'),
    [EYE_BURST_MOVE_ID]: getRowValue(findMoveById(skills, EYE_BURST_MOVE_ID), 'damage'),
    [MINI_TORNADO_MOVE_ID]: getRowValue(findMoveById(skills, MINI_TORNADO_MOVE_ID), 'damage'),
    [MEGA_TORNADO_MOVE_ID]: getRowValue(findMoveById(skills, MEGA_TORNADO_MOVE_ID), 'damage'),
    [SEND_OFF_MOVE_ID]: getRowValue(findMoveById(skills, SEND_OFF_MOVE_ID), 'damage'),
  }
  // 影画4：招架支援回1能量/次 + 闪避反击回2能量/次（招式内至多1次）
  if (cinemaLevelOf(cinemaLevel) >= 4) {
    const energy = cfg.parryCount * ROXY_C4_PARRY_ENERGY + cfg.dodgeCounterCount * ROXY_C4_DODGE_ENERGY
    if (energy > 0) cfg.initialEnergyGift = cfg.initialEnergyGift + energy
  }
  // 额外能力·辉金心脏：进场回 40 能量（勘域 180s 一次 → 每局一次；门控未接，note）
  cfg.initialEnergyGift = cfg.initialEnergyGift + ROXY_AA_ENTER_ENERGY
  // 影画失衡值（v12 原文「失衡值提升」）：预缩倍率表 daze 值，patchRoxyExecutions 经 dazeMultiplierOverride 精确结算
  if (cinemaLevelOf(cinemaLevel) >= 2) {
    cfg.roxyExChillDaze = getRowValue(findMoveById(skills, EX_CHILL_MOVE_ID), 'daze') * (1 + ROXY_C2_EX_CHILL_DAZE_BONUS / 100)
  }
  if (cinemaLevelOf(cinemaLevel) >= 4) {
    cfg.roxyUltDaze = getRowValue(findMoveById(skills, ROXY_ULT_MOVE_ID), 'daze') * (1 + ROXY_C4_ULT_DAZE_BONUS / 100)
  }
  if (cinemaLevelOf(cinemaLevel) >= 6) {
    cfg.roxyMegaDaze = getRowValue(findMoveById(skills, MEGA_TORNADO_MOVE_ID), 'daze') * (1 + ROXY_C6_MEGA_DAZE_BONUS / 100)
  }
}

function applyRoxyPanel({ panel, cinemaLevel }: AgentPanelInput): void {
  /**
   * 额外能力·辉金心脏的触发条件写在原文前一行：「队伍中存在[强攻]角色或[命破]角色或[锋御]角色时触发：」
   * ⇒ 下面两条（自身伤害 +80%、失衡时长 +2s）都只在 `additionalAbilityActiveOf(panel)` 时生效。
   * ⚠ 原实现无条件施加，注释写「面板统一施加…略高估」——那不是近似而是可判定的门：
   * 实测「洛克茜+凯撒+本」（无 attack/rupture/sharpen）AA=0 仍拿到 dmgBonus 含 80、stunDur 2。
   */
  const aa = additionalAbilityActiveOf(panel)
  // 核心被动转模（v12）：初始能量回复 >1.2 → 每 0.01：攻击 +5（上限960）、冲击 +0.4（上限76.8）
  // 「初始能量自动回复」= 局外总回能（基础 × 局外加成 + 固定，panelPhases 写入 energyRegenOutOfCombat）。
  // CC-127：原读 `panel.energyRegen`——那是**基础**回能（恒 1.2，catalog.ts PanelValues 注释），转模从未触发。
  const regen = Math.max(0, panel.energyRegenOutOfCombat - 1.2)
  // CC-135 第 159 轮：「每超过 N」统一 floor 整步，docs/mcp-r6-refactor-list.md §2.18（原：攻击 = 连续步数×5 再 Math.round，冲击连续）。+1e-9 防 1.23−1.2=0.0299… 少算一步
  const regenSteps = Math.floor(regen / 0.01 + 1e-9)
  const atkBonus = Math.min(ROXY_REGEN_ATK_CAP, regenSteps * ROXY_REGEN_ATK_PER_0_01)
  const impactBonus = Math.min(ROXY_REGEN_IMPACT_CAP, regenSteps * ROXY_REGEN_IMPACT_PER_0_01)
  if (atkBonus > 0) panel.atk = panel.atk + atkBonus
  if (impactBonus > 0) panel.impact = panel.impact + impactBonus
  // 额外能力：自身伤害 +80%（Lv60 上限；门控 = 队内有强攻/命破/锋御，见函数头 aa）
  if (aa) panel.dmgBonus = panel.dmgBonus + ROXY_AA_DMG_BONUS_LV60
  /**
   * 额外能力同一句的**另一半**：「攻击命中 → 失衡时长 +2s」（用户 2026-10-20 点出「我记得洛克茜有
   * 延长失衡 2s 的被动」）。此前只在文件头注释里、**从未写进面板** ⇒ 含洛克茜的队窗口恒 16s 而非 18s。
   *
   * 满覆盖近似（同上面那条「攻击命中」）：失衡窗口内洛克茜的攻击必然命中，故按常驻 +2s 计。
   * 门控与伤害那条**同一句原文**（强攻/命破/锋御队友）⇒ 同样只在 `aa` 时施加。
   */
  if (aa) panel.stunDurationBonusSeconds = panel.stunDurationBonusSeconds + ROXY_AA_STUN_DURATION
  /**
   * 额外能力同一段最后一句：「释放[强化特殊技]时，自身异常积蓄效率提升 30%，持续 50 秒，重复触发刷新」。
   * 主语是**自身**（不是全队）⇒ 写本槽面板；50s 相对失衡窗口是全程覆盖，按常驻近似。
   * 落点 `anomalyBuildUpEfficiency`（`core/anomalyPool.ts` 的积蓄乘区 `1 + eff/100`，决定异常触发次数）。
   */
  if (aa && panel.anomalyBuildUpEfficiency !== undefined) {
    panel.anomalyBuildUpEfficiency = panel.anomalyBuildUpEfficiency + ROXY_AA_BUILDUP_EFFICIENCY
  }
  const cinema = cinemaLevelOf(cinemaLevel)
  // 影画1 自身段只有暴伤 +40%；「使敌方全属性抗性 -15%」是**敌方减益（全队每个攻击者都吃）** ⇒
  // 走 spec `teamBuffs` 的 `roxy.cinema_1_enemy_res` 采集通道，此处写自己的面板只有洛克茜吃得到。
  if (cinema >= 1) panel.critDmg = panel.critDmg + ROXY_C1_CRIT_DMG
  // 影画2「失衡易伤 +30%」同理走采集通道 `roxy.cinema_2_stun_vulnerability`（敌方减益）；
  // 写 `panel.stunDmgMultiplierBonus` 只会让洛克茜自己吃、且与采集通道叠加即双计。
  if (cinema >= 6) {
    panel.enemyWindResReduction = panel.enemyWindResReduction + ROXY_C6_WIND_RES_REDUCTION
  }
}

function roxyWindEnergySourceOf(
  cfg: AgentResourceInput['cfg'],
  state: Pick<AgentResourceInput['state'], 'exSpecialCount' | 'ultimateCount' | 'totalEnergy'>,
): RoxyWindEnergySource {
  return computeRoxyWindEnergy({
    exSpecialCount: state.exSpecialCount,
    exSpecialEnergyConsume: cfg.exSpecialEnergyConsume,
    ultimateCount: state.ultimateCount,
    spinSeconds: ROXY_FULL_SPIN_SECONDS,
    // 用户口径 2026-10-19：自旋秒数自动算（放完全部能量）⇒ 需要能量总额
    totalEnergy: state.totalEnergy,
    cinemaLevel: cinemaLevelOf(cfg.roxyCinemaLevel),
    energyRate: specAdjustableRate(cfg, ROXY_WIND_ENERGY_RATE_ID),
    eyeRate: specAdjustableRate(cfg, ROXY_WIND_EYE_RATE_ID),
  })
}

function buildRoxyResourceResult({ cfg, state }: AgentResourceResultInput): Partial<CharacterResourceResult> {
  return {
    roxyWindEnergySource: roxyWindEnergySourceOf(cfg, state),
  }
}

function buildRoxyExecutions({ cfg, state, executions }: AgentResourceInput): void {
  const source = roxyWindEnergySourceOf(cfg, state)
  const exCount = Math.max(0, Math.floor(state.exSpecialCount))
  if (exCount > 0) {
    // 小心风寒（1621007）+ 自旋（1621008 每秒）+ 敬请安息（1621023）
    executions.push({
      moveId: EX_CHILL_MOVE_ID, moveName: '强化特殊技：小心风寒', category: 'special',
      count: exCount, actionTime: 0, comboAlignRatio: 0,
      totalTime: 0, totalComboAlignTime: 0,
      energyConsume: Number(cfg.roxyExStartEnergy ?? 10), totalEnergyConsume: exCount * Number(cfg.roxyExStartEnergy ?? 10),
      energyRecovery: 0, totalEnergyRecovery: 0,
      timeBucket: 'necessary',
    })
    const spinMoveMult = Number(cfg.roxySpinSecondDamage ?? 0)
    const spinDecibelPerSec = Number(cfg.roxySpinSecondDecibel ?? 0)
    if (source.spinSeconds > 0) {
      // @fact agent:1621/自旋喧响每秒口径 口径: 自旋(1621008)倍率表 damage=2608.6 与 decibel_recovery=84.343 同为「每秒」值——damage 侧已按 每秒×spinSeconds 录入并被 roxy 测试锁定，喧响同构：行值=84.343×spinSeconds/次、总=×exCount；表值直填会把持续段少算 spinSeconds 倍，故 decibelRecoveryOverride 跳过 enrich 表值覆盖 | 据 catalog 1621008 行值+damage 侧已录口径@2026-09-08·复核@2026-09-25·锚未变@2026-09-27·复核@2026-09-30·复核@2026-10-07 | 验 src/core/__tests__/decibelRowParity.test.ts | 锚 src/mechanics/agents/roxy.ts#buildRoxyExecutions + src/core/resource/rowAccounting.ts#resolveRecoveryPerCount | 信 高
      /**
       * 自旋段**拆成两行**（用户口径 2026-10-19「他会放多次满秒数和 1 次零散的，打出全部能量」）：
       *  · 满发行：`count = 满发次数`，每发 2.5s；
       *  · 零散发行：`count` 恒 ≤1，秒数 = 剩余能量反推（`partialSpinSeconds`），可能整行不存在。
       * 拆行的理由 = 行模型的口径是「每行一个 `count × 每发量`」⇒ 把「满发 + 零散」塞进一行会让
       * `decibelRecovery`（单发值）变成一个谁都不认识的加权平均（实测 159.31 vs 应有 210.86）。
       */
      const perSecondEnergy = Number(cfg.roxySpinEnergyPerSecond ?? 30)
      const pushSpinRow = (count: number, secondsEach: number) => {
        if (count <= 0 || secondsEach <= 0) return
        executions.push({
          moveId: SPIN_SECOND_MOVE_ID, moveName: '自旋（每秒，耗能 30/s）', category: 'special',
          count, actionTime: 0, comboAlignRatio: 0,
          totalTime: 0, totalComboAlignTime: 0,
          energyConsume: perSecondEnergy * secondsEach,
          totalEnergyConsume: perSecondEnergy * secondsEach * count,
          decibelRecovery: spinDecibelPerSec * secondsEach,
          totalDecibelRecovery: spinDecibelPerSec * secondsEach * count,
          decibelRecoveryOverride: true,
          energyRecovery: 0, totalEnergyRecovery: 0,
          timeBucket: 'backstage',
          damageMultiplier: spinMoveMult * secondsEach,
          damageMultiplierOverride: true,
        })
      }
      const fullCasts = source.lastIsPartial ? Math.max(0, exCount - 1) : exCount
      pushSpinRow(fullCasts, source.spinSeconds)
      if (source.lastIsPartial) pushSpinRow(1, source.partialSpinSeconds)
      /**
       * 影画2·流势：自旋结束换人 ⇒ 消耗满层[流势]续 0.6s **免费自旋**（不耗能量）。
       * 用户口径 2026-10-26：「免费自旋你假设全吃满就行，有多少流势都可以吃完」⇒ 每局一次，
       * 固定 0.6s；不乘 exCount（流势按「引爆风眼」层叠，单次换人消费全部，是**每局一次**的机动收益）。
       * ⚠ 单独成行（不并进 pushSpinRow）：它的 energyConsume 必须为 0，与耗能自旋行混在一起
       * 会让能量账把免费秒数也扣成 30/s（实测会少算 18 点能量）。
       */
      const cinemaNow = cinemaLevelOf(cfg.roxyCinemaLevel)
      if (cinemaNow >= 2) {
        const freeSeconds = ROXY_C2_FLOW_MOMENTUM_SECONDS_PER_STACK * ROXY_C2_FLOW_MOMENTUM_MAX_STACKS
        executions.push({
          moveId: SPIN_SECOND_MOVE_ID, moveName: '自旋（流势免费，不耗能）', category: 'special',
          count: 1, actionTime: 0, comboAlignRatio: 0,
          totalTime: 0, totalComboAlignTime: 0,
          energyConsume: 0, totalEnergyConsume: 0,
          decibelRecovery: spinDecibelPerSec * freeSeconds,
          totalDecibelRecovery: spinDecibelPerSec * freeSeconds,
          decibelRecoveryOverride: true,
          energyRecovery: 0, totalEnergyRecovery: 0,
          timeBucket: 'backstage',
          damageMultiplier: spinMoveMult * freeSeconds,
          damageMultiplierOverride: true,
        })
      }
    }
    executions.push({
      moveId: REST_PEACE_MOVE_ID, moveName: '强化特殊技：敬请安息（风炮）', category: 'special',
      count: exCount, actionTime: 0, comboAlignRatio: 0,
      totalTime: 0, totalComboAlignTime: 0,
      energyConsume: 0, totalEnergyConsume: 0,
      energyRecovery: 0, totalEnergyRecovery: 0,
      timeBucket: 'necessary',
    })
  }
  const spec = getAgentSpec(ROXY_AGENT_ID)
  if (!spec) return
  const generated = buildSpecEventExecutions(spec, {
    cfg,
    state,
    counts: {
      roxyPerEnergyExtraCount: source.windEnergyConsumed,
      roxyEyeBurstCount: source.windEyeGenerated,
      roxySendOffCount: source.sendOffCount,
      roxyMiniTornadoSeconds: source.miniTornadoSeconds,
      roxyMegaTornadoCount: source.megaTornadoCount,
    },
  })
  executions.push(...generated)
}

function patchRoxyExecutions({ cfg, state: _state, executions }: AgentResourceInput): void {
  const cinema = cinemaLevelOf(cfg.roxyCinemaLevel)
  for (const exec of executions) {
    // 影画2：小心风寒（1621007）失衡值 +5%
    if (cinema >= 2 && exec.moveId === EX_CHILL_MOVE_ID) {
      const d = Number(cfg.roxyExChillDaze ?? 0)
      if (d > 0) {
        exec.dazeMultiplier = d
        exec.dazeMultiplierOverride = true
      }
    }
    if (cinema >= 4 && exec.moveId === ROXY_ULT_MOVE_ID) {
      exec.dmgBonus = (exec.dmgBonus ?? 0) + ROXY_C4_ULT_DMG
      // 影画4：终结技（1621012）失衡值 +10%
      const d = Number(cfg.roxyUltDaze ?? 0)
      if (d > 0) {
        exec.dazeMultiplier = d
        exec.dazeMultiplierOverride = true
      }
    }
    // 影画6：巨型风旋（1621020）倍率 ×250%（含余响生成行，共用 moveId）失衡值 +20%
    if (cinema >= 6 && exec.moveId === MEGA_TORNADO_MOVE_ID) {
      exec.damageMultiplier = (exec.damageMultiplier ?? 0) * ROXY_C6_MEGA_TORNADO_MULT
      exec.damageMultiplierOverride = true
      const d = Number(cfg.roxyMegaDaze ?? 0)
      if (d > 0) {
        exec.dazeMultiplier = d
        exec.dazeMultiplierOverride = true
      }
    }
  }
}

function buildRoxyResourceSections({ result }: AgentResourceSectionsInput) {
  const source = result.roxyWindEnergySource
  if (!source) return []
  return [
    {
      id: 'roxy-wind-energy',
      title: '洛克茜风能',
      summary: `风能 +${source.windEnergyGain} · 敬请安息消耗 ${source.windEnergyConsumed} · 风眼 × ${source.windEyeGenerated}`,
      rows: [
        { label: '强特/终结耗能', value: `${fmt(source.energySpentTotal)}`, detail: '每 25 能量获得 1 点风能（核心被动 Lv.7）+ 终结技 +1' },
        { label: '风能获取', value: `+${source.windEnergyGain}`, detail: '存量上限 3（每发敬请安息至多消耗 3）' },
        { label: '敬请安息消耗', value: `-${source.windEnergyConsumed}`, detail: '每点 = 额外 1621021 一段 + 生成 1 个风眼' },
      ],
      footer: source.note,
    },
    {
      id: 'roxy-wind-eye',
      title: '洛克茜风眼·恕不远送',
      summary: `风眼 ${source.windEyeGenerated} · 恕不远送 × ${source.sendOffCount} · 巨旋风 ${source.megaTornadoCount} · 小旋风 ${source.miniTornadoSeconds}s`,
      rows: [
        { label: '风眼生成', value: `${source.windEyeGenerated} 个`, detail: `同时存在上限 ${WIND_EYE_MAX}（默认手法下单发 ≤ 3 ⇒ 结构性不可达）、30s 自爆/超限最早引爆（爆鸣 1621022 × ${source.windEyeDestroyed}）` },
        { label: '恕不远送', value: `${source.sendOffCount} 次`, detail: '敬请安息后场上+自身≥3 → 自动发动（引爆至多 3 个风眼）' },
        { label: '巨型风旋', value: `${source.megaTornadoCount} 次`, detail: '3 个风眼同时命中 → 巨旋风（1621020）持续 1 秒；影画6 ×250%' },
        { label: '微型风旋', value: `${fmt(source.miniTornadoSeconds)}s`, detail: '不足 3 个的余数 → 小旋风（1621019）1s/个' },
      ],
      footer: 'v12 口径；余响（影画6）按「引爆数 × 2」计——巨型风旋是次数启动器，每生成一个必然附送 2 个额外巨型风旋，重复触发叠加不吞掉 ⇒ 与持续秒数无关（用户口径 2026-10-25）。',
    },
  ]
}

const settings: MechanicSetting[] = [
  /**
   * ## 为什么**不是**滑块（用户裁决 2026-10-19）
   *
   * 用户原话：「用户滑块感觉也没必要，这里的自旋秒数应该自动计算，自动把能量放完。
   * 他会放多次满秒数和1次零散的，打出全部能量。」
   *
   * ⇒ 自旋秒数不是玩家选的档位，而是**能量预算的算术结果**：满发 2.5s（长按到 3 风能松手）
   * 打若干次，最后用一次零散发把余额放完（`computeRoxyExCount` + `partialSpinSeconds`）。
   * 滑块留着只会让人误以为可以「少放点能量」，而那在游戏里没有对应操作。
   *
   * 保留的常量 `ROXY_FULL_SPIN_SECONDS` 只表达**满发档位**（3 风能 = 75 能量 = 2.5s），
   * 不是可调项。回退点：把它写回 `settings` 并恢复 `cfgSetting(cfg, 'roxy.spinSeconds')` 两处读点。
   */
]

export const roxyMechanic: AgentMechanicModule = {
  id: 'agent:roxy',
  agentIds: [ROXY_AGENT_ID],
  // CC-391 D1：自旋（每秒）是小心风寒启动后的持续段（次数 = EX 次数），易伤跟随 EX 启动的轴内占比
  attachedEvents: { [EX_CHILL_MOVE_ID]: [SPIN_SECOND_MOVE_ID] },
  /** CC-402：恕不远送两分支互斥（引爆满 3 风眼 → 巨旋风 1621020；不足 → 小旋风 1621019）；两段都列。 */
  moveBranchGroups: [[MINI_TORNADO_MOVE_ID, MEGA_TORNADO_MOVE_ID]],
  /**
   * 副词条优化模板（CC-81：原 core/substatOptimizer.ts AGENT_TEMPLATES）。
   *
   * ⚠ **2026-10-26 订正**：原写 `['defPct','atkPct','critRate']` = **v12 之前**的旧转模口径
   * （旧 kit「初始防御 >1500 → 防御转攻击/冲击」）。v12 已改为**初始能量自动回复 >1.2 → 攻击/冲击**
   * （见 `applyRoxyPanel` 的 `energyRegenOutOfCombat` 转模），防御对伤害**零贡献** ⇒
   * 旧模板会让「最优副词条」把 20 步预算全砸进防御（用户 2026-10-26 抓到「配装默认带防御」）。
   *
   * v12 口径：洛克茜是**击破**（stun）职业、自身直伤占比较小、拐力来自暴击率（核心被动按洛克茜
   * 每 1% 暴击率给全队暴伤，未接）⇒ 与职业兜底 `_default_stun` 同序即可（暴击率→暴伤→攻击→穿透）。
   * 与兜底相同就不该声明（CC-186 已删过 6 条同型声明）⇒ 本字段删除，回落 `_default_stun`。
   */
  name: '洛克茜',
  description: 'v12：风能（25能量/点+终结+1）→ 敬请安息（消耗全部，每点额外段+1风眼）→ 风眼爆鸣/恕不远送（引爆至多3 → 巨旋风或小旋风）+ 自旋每秒伤害；核心转模（能量回复>1.2→攻击/冲击）；C1 全抗-15%/暴伤+40%、C2 易伤+30%、C4 回能+终结+20%、C6 风抗15%+巨旋风×250%。',
  applyPanel: applyRoxyPanel,
  teamPanelEffects: applyRoxyTeamPanelEffects,
  /**
   * 额外能力·同一段：「全队角色施加的[风化]效果延长 20 秒」。
   *
   * 用户口径 2026-10-26：「延长异常状态很常见，本来就该建模…延长风化虽然她没有 dot 不能加伤害，
   * 但是可以加**风化覆盖率**啊，侵染的直伤独立乘区也是依靠这个」。
   *
   * 落点 = `windAnomalyDurationBonusSeconds`（`core/anomalyPool/helpers#getAnomalyDuration` 读，
   * `calcCoverage` 用 `次数 × 时长 / 有效战斗时间` 算 `windCoverageRate`，封顶 1）⇒
   * 直接抬高风化覆盖率 ⇒ 抬高侵染区覆盖率与乱流窗口。**不是**面板上的伤害量。
   *
   * ⚠ 用户同口径：「他有延长效果，通常打 4 次就有 200s 了，达到全覆盖了」——20s 加成后
   * 单次风化 30→50s，4 次即 200s ≥ 任意常规战斗时长 ⇒ 覆盖率自然收到 1，无需另设封顶逻辑。
   */
  teamAnomalyDurationBonus: ({ element, slot, agent, team }) =>
    (element === 'wind' && evalAdditionalAbility(team, slot, agent, getAgentSpec(ROXY_AGENT_ID)?.additionalAbility)
      ? ROXY_AA_WIND_DURATION_EXTENSION
      : 0),
  buildCharConfig: buildRoxyCharConfig,
  /**
   * 引擎期强特次数求解（规则 6 引擎落点）：洛克茜的自旋秒数是**自动放完能量**的
   * （用户口径 2026-10-19：「他会放多次满秒数和 1 次零散的，打出全部能量」）⇒
   * 次数不能用通用 `floor(E / 满发耗能)`（那会把剩余能量里能打出的那次零散发丢掉）。
   * 纯函数：只读 `totalEnergy` 与 cfg 上的满自旋秒数。
   */
  exSpecialCount: ({ totalEnergy }) => computeRoxyExCount(totalEnergy, ROXY_FULL_SPIN_SECONDS),
  buildExecutions: buildRoxyExecutions,
  patchExecutions: patchRoxyExecutions,
  buildResourceResult: buildRoxyResourceResult,
  resourceSections: buildRoxyResourceSections,
  settings,
}

/**
 * D2（CC-359）：本模块私有的 cfg 字段——只有本文件读写，声明随模块走，不再堆在 `types/resource/config.ts`。
 * 仍是 `CharacterOperationConfig` 的成员（模块扩充，纯类型、零运行时）；被第二处引用时请迁回公共接口。
 */
declare module '@/types/resource/config' {
  interface CharacterOperationConfig {
    /** 命座等级：buildCharConfig 写 */
    roxyCinemaLevel?: number
    /** 强化特殊技起手耗能（exCost.start） */
    roxyExStartEnergy?: number
    /** 旋转每秒耗能（exCost.perSecond） */
    roxySpinEnergyPerSecond?: number
    /** 旋转每秒段伤害倍率（技能表 damage） */
    roxySpinSecondDamage?: number
    /** 旋转每秒段喧响回复（技能表 decibel_recovery） */
    roxySpinSecondDecibel?: number
    /** 强化特殊技「寒意」失衡值（含影画2 加成） */
    roxyExChillDaze?: number
    /** 终结技失衡值（含影画4 加成） */
    roxyUltDaze?: number
    /** 「巨型龙卷」失衡值（含影画6 加成） */
    roxyMegaDaze?: number
    /** 洛克茜小旋风持续秒数，默认 5 */
    roxyMiniTornadoSeconds?: number
  }
}

/**
 * D2（CC-359/360）：本模块私有的结果字段——只有本文件读写，声明随模块走，不堆在 `types/resource/agentResources.ts`。
 * 仍是 `CharacterResourceResult` 的成员（模块扩充，纯类型、零运行时）；被第二处引用时请迁回公共接口。
 */
declare module '@/types/resource/agentResources' {
  interface CharacterResourceResult {
    /** 洛克茜风能/风眼资源明细 */
    roxyWindEnergySource?: RoxyWindEnergySource
  }
}

// ===== 本模块私有的结果类型（D2 / CC-360：原在 types/resource/agentResources.ts，只有本文件引用）=====

/** 洛克茜风能/风眼资源明细 */
export interface RoxyWindEnergySource {
  /** 强特消耗能量合计（当前按强特次数 × 单次耗能） */
  energySpentTotal: number
  /** 风能总量 = floor(总耗能 / 25) + 终结技次数（核心被动 Lv.7：每 25 能量 +1）；3 为存量上限 */
  windEnergyGain: number
  windEnergyCap: number
  /** 敬请安息消耗风能 = min(总获得, 强特次数 × 3)（存量上限 3/发） */
  windEnergyConsumed: number
  /** 敬请安息每消耗 1 点风能生成的风眼数（同时存在上限 9、30s 自爆；默认手法单发 ≤3 ⇒ 两约束不可达） */
  windEyeGenerated: number
  /** 被引爆的风眼数（全部，爆鸣结算） */
  windEyeDestroyed: number
  /** 恕不远送次数 = floor(消耗/3)（每次引爆至多 3 个风眼） */
  sendOffCount: number
  /** 巨型风旋次数（3 个风眼同命中 → 1s） */
  megaTornadoCount: number
  /** 小旋风个数（不足 3 的余数） */
  miniTornadoCount: number
  /** 小旋风总秒数 = miniTornadoCount × 1s（v12 持续 1 秒） */
  miniTornadoSeconds: number
  /** 满自旋秒数（滑块，30 能量/s）：一次「长按到攒满 3 风能」的满发时长 */
  spinSeconds: number
  /**
   * **零散发**（最后一发）的自旋秒数——用户口径 2026-10-19：玩家会「放多次满秒数和 1 次零散的，
   * 打出全部能量」⇒ 最后一发的秒数由剩余能量反推，可以 < 满发（甚至 0 = 这一发打不出来）。
   * 未走「放完全部能量」口径（没传 `totalEnergy`）时等于 `spinSeconds`。
   */
  partialSpinSeconds: number
  /** 实际自旋总秒数 = 满发次数 × 满发秒 + 零散秒（执行行/伤害按它算，不是次数 × 满发秒） */
  effectiveSpinSecondsTotal: number
  /** 最后一发是否是**零散发**（自旋秒数 < 满发）：执行行据此拆成「满发行 + 零散发行」 */
  lastIsPartial: boolean
  note: string
}
