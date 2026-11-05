/**
 * **Boss 出手预算** —— 「前台闪反/弹刀次数」的物理来源（用户口径 2026-11-04，唯一实现）。
 *
 * ## 为什么要它（根因）
 *
 * 用户逐字：
 * > 「我不希望判据决定错误，我希望**计算引擎用时间限制自主推导**出失衡的上限和溢出性。」
 * > 「本质还是**前台闪反的产出太多了，没有哪个 boss 会如此高频的一直攻击**。」
 * > 「你找不到出手频率的，只能**大致估算**，**2s 有效战斗时间 / 每人一次**估计差不多」
 *
 * 修前病灶：`dodgeCounterCount` 的界只有 `ACTION_COUNT_BOUNDS` 的 `{min:0, max:99}`
 * （`stores/config.ts`）——**纯 UI 常量、零物理来源**。于是旗舰夹具 `auto-1611-1141-1211`
 * 上「槽0 闪反 81」既能被用户填出来、也能被自动交互**搜**出来：同一现场必要动作合计
 * **133s**，而非失衡只有 **84s**（1.58×），物理不可能。
 *
 * ⚠ **`parryTotal` 不是上限**（用户 2026-11-04 连续纠正两次）——它是**用户填写的「boss 机制
 * 强制弹刀」必要招式**，是**输入/下限**；不能拿它反推 boss 出手次数，也不是交互搜索的坐标边界。
 *
 * ## 口径（用户裁决 2026-11-04；不要再问、也不要自己改）
 *
 * 1. **闪反与弹刀各自独立**（逐字：「各自独立，有时可以闪反后选别人弹刀」）
 *    ⇒ **各有一份预算，不相加、不互斥、不从同一池扣**（不同角色可以先后各打一次）。
 * 2. **预算 = 非失衡时间 / 2s**（逐字：「我说是**非失衡时间/2s**，因为**失衡期内 boss 都瘫痪了**」）。
 *    ⇒ **不是整场 180s**：失衡期 boss 瘫痪 ⇒ 不出手 ⇒ 那段时间不产出任何可交互的黄光。
 *
 * 仓库**没有** boss 出手频率的数据（`attackInterval` / `attackCount` / `parryWindow` /
 * `yellowFlash` 全无命中；`bossSchedule.ts` 只是版本排期）⇒ 2s/次是**估算口径**，用户已给定。
 *
 * ## ⚠ 这是**推导**，不是判据
 *
 * 本模块只回答一个物理问题：「这么多非失衡秒里，boss 最多给出几次可交互的攻击」。
 * - **推导**（正确）：当**可行性上界**——引擎只兑现装得下的量并如实报出夹取；
 *   自动搜索把它当**搜索空间上界**（天然搜不出非法值，策略层不需要任何判断）。
 * - **判据**（禁止）：先算出非法值、再拿它判红/否决。用户原话「我不希望判据决定错误」。
 *
 * ## 两把不同的尺，别混
 *
 * - 本模块限的是**次数**（boss 出手频率）；
 * - 招式自身耗时（闪反 0.6s/次等）限的是**时间**，由引擎净占用/截断账兜住。
 * 两把尺都要满足，缺一不可。
 */

/** 一次可交互攻击的估算间隔（秒/次）——用户 2026-11-04 口径「2s 有效战斗时间 / 每人一次」 */
export const BOSS_ATTACK_INTERVAL_SECONDS = 2

/** 受 boss 出手频率约束的交互字段（闪反、弹刀；**各自独立各算一份**） */
export const BOSS_ATTACK_LIMITED_FIELDS = ['dodgeCounterCount', 'parryCount'] as const
export type BossAttackLimitedField = typeof BOSS_ATTACK_LIMITED_FIELDS[number]

/**
 * **非失衡时间**（秒）—— 预算的分母。
 *
 * `effectiveTime` = 有效战斗时间（战斗时间 − boss 无敌，见 `core/effectiveTime#effectiveBattleTime`）。
 * `stunSeconds` = **真在失衡里的秒数**（调用方给引擎已算出的值，例如 `min(effTime, K×窗长)`
 * 或覆盖率分子；**不在这里重算**，否则就是第二个事实源）。
 */
export function nonStunSeconds(effectiveTime: number, stunSeconds = 0): number {
  const eff = Math.max(0, effectiveTime)
  const stun = Math.max(0, Math.min(eff, stunSeconds))
  return eff - stun
}

/**
 * Boss 出手预算（次数）= `floor(非失衡秒数 / 2s)`。
 *
 * 闪反与弹刀**各自各算一份**（本函数只返回一份预算，调用方对两个字段各调一次；
 * 同一入参 ⇒ 同值，但语义上是两份独立额度，不相加、不互斥）。
 */
export function bossAttackBudget(nonStun: number): number {
  const seconds = Math.max(0, nonStun)
  return Math.max(0, Math.floor(seconds / BOSS_ATTACK_INTERVAL_SECONDS + 1e-9))
}

/**
 * 把某字段的**读入次数夹到预算内**，并给出夹取读数。
 *
 * ⚠ 语义 = 「引擎只兑现装得下的量」，**不是**「判红」：调用方照常往下算，只是兑现量更小、读数如实。
 * 用户硬填极端值时的**失真提示**走另一条通道（`capabilityGateNotice`），不在这里否决。
 */
export function capToBossAttackBudget(
  requested: number,
  budget: number,
): { count: number; capped: boolean; requested: number; budget: number } {
  const wanted = Math.max(0, Number.isFinite(requested) ? requested : 0)
  const limit = Math.max(0, Number.isFinite(budget) ? budget : 0)
  const count = Math.min(wanted, limit)
  return { count, capped: wanted > limit + 1e-9, requested: wanted, budget: limit }
}

/** 单字段的预算读数（页面提示与自动交互 note 的素材；「计算失真」的判据 = `capped`） */
export interface BossAttackBudgetReading {
  /** 非失衡秒数（预算分母） */
  nonStunSeconds: number
  /** 估算间隔（秒/次） */
  intervalSeconds: number
  /** 该字段预算（次数） */
  budget: number
  /** 读入/请求次数（夹取前） */
  requested: number
  /** 实际兑现次数（夹取后） */
  delivered: number
  /** 是否被夹掉（读入超出物理可能性） */
  capped: boolean
}

/**
 * 逐字段预算读数。`requestedOf` 给**读入**次数（store 原值 / 本轮注入值），
 * 返回的 `delivered` 才是引擎该兑現的量。
 */
export function bossAttackBudgetReadings(args: {
  nonStunSeconds: number
  requestedOf: (field: BossAttackLimitedField) => number
}): Partial<Record<BossAttackLimitedField, BossAttackBudgetReading>> {
  const budget = bossAttackBudget(args.nonStunSeconds)
  const out: Partial<Record<BossAttackLimitedField, BossAttackBudgetReading>> = {}
  for (const field of BOSS_ATTACK_LIMITED_FIELDS) {
    const requested = Math.max(0, Number.isFinite(args.requestedOf(field)) ? args.requestedOf(field) : 0)
    const { count, capped } = capToBossAttackBudget(requested, budget)
    out[field] = {
      nonStunSeconds: args.nonStunSeconds,
      intervalSeconds: BOSS_ATTACK_INTERVAL_SECONDS,
      budget, requested, delivered: count, capped,
    }
  }
  return out
}

/** 全队合计的请求/兑现（提示文案用；闪反与弹刀**各占一行**，不相加） */
export function bossAttackBudgetTotals(
  readings: Partial<Record<BossAttackLimitedField, BossAttackBudgetReading>>,
): Array<{ field: BossAttackLimitedField; requested: number; delivered: number; budget: number; capped: boolean }> {
  return BOSS_ATTACK_LIMITED_FIELDS.flatMap(field => {
    const r = readings[field]
    return r ? [{ field, requested: r.requested, delivered: r.delivered, budget: r.budget, capped: r.capped }] : []
  })
}
