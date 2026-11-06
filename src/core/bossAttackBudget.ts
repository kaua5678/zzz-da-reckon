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
 * ## 口径（用户裁决 2026-11-04，2026-11-06 收紧；不要再问、也不要自己改）
 *
 * 1. **全队一共就这么多次**（2026-11-06 逐字：「**全队交互次数上限还是改为非失衡时间/3**」）
 *    ⇒ 全队**所有槽位的闪反 + 弹刀合计**共用一个池：`floor(非失衡时间 / 3s)`。
 *    ⚠ 与 2026-11-04 的「每槽各一份 /2」**不是同一把尺**：那次实测全库最优搜索中位要到
 *    **40 次闪反**、单槽顶满预算的有 18 队，用户判定「太多了」⇒ 改为**全队合计**口径。
 * 2. **单人上限 = 非失衡 × 1/4**（逐字：「**单人交互上限为非失衡*1/4**」）
 *    ⇒ 任一槽位（不分字段，闪反 + 弹刀合计）不得超过 `floor(非失衡 / 4s)`。
 *    两条同时生效：**全队池管总量，单人上限管集中度**。
 * 3. **主体是「次数」，不分闪反/弹刀**：同一个池按「一次可交互攻击」计，
 *    谁去打（闪反还是弹刀）由队伍/机制决定 —— 这正是用户 2026-11-06 的
 *    「**般岳这种需要更多嗔火就刚需双弹，提高每次交互的利用率**」：
 *    一次攻击吃两次交互（双反 = 完美闪避 + 金身弹刀，嗔火 +4/+6）**不占用两份预算**，
 *    它仍然只是 boss 的**一次出手**。
 *    ⚠ 这条把 2026-11-04 的「闪反与弹刀各自独立各一份」**收掉了**：现在两者**共用**一个池。
 * 4. **预算 = 非失衡时间**（逐字：「因为**失衡期内 boss 都瘫痪了**」）。
 *    ⇒ **不是整场 180s**：失衡期 boss 瘫痪 ⇒ 不出手 ⇒ 那段时间不产出任何可交互的黄光。
 *
 * 仓库**没有** boss 出手频率的数据（`attackInterval` / `attackCount` / `parryWindow` /
 * `yellowFlash` 全无命中；`bossSchedule.ts` 只是版本排期）⇒ 3s / 4s 是**估算口径**，用户已给定。
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

/**
 * **全队**一次可交互攻击的估算间隔（秒/次）——用户 2026-11-06 口径
 * 「全队交互次数上限还是改为非失衡时间/3」。
 *
 * ⚠ 2026-11-04 是「2s / 每人一次」（每槽各一份）；2026-11-06 收紧成全队合计 /3。
 */
export const BOSS_ATTACK_INTERVAL_SECONDS = 3

/**
 * **单人**上限的分母（秒/次）——用户 2026-11-06 口径「单人交互上限为非失衡*1/4」。
 *
 * 与 `BOSS_ATTACK_INTERVAL_SECONDS` 是**两条独立的尺**：全队池管总量、单人上限管集中度。
 * 单人上限**按槽位合计**（该槽闪反 + 弹刀之和），不按字段各算。
 */
export const BOSS_ATTACK_PER_SLOT_INTERVAL_SECONDS = 4

/**
 * 受 boss 出手频率约束的交互字段（闪反、弹刀）。
 *
 * ⚠ 2026-11-06 起这两者**共用一个全队池**（不再是「各自独立各算一份」）——它们都只是
 * 「boss 的一次出手」，谁去打由队伍决定（用户：「般岳这种需要更多嗔火就刚需双弹，
 * 提高每次交互的利用率」）。
 */
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
 * **全队**交互次数上限（次数）= `floor(非失衡秒数 / 3s)`。
 *
 * ⚠ 这是**全队共用一个池**（所有槽位的闪反 + 弹刀合计），不是每槽各一份——
 * 2026-11-04 的「每槽 /2」已被 2026-11-06 的用户裁决取代。
 */
export function bossAttackBudget(nonStun: number): number {
  const seconds = Math.max(0, nonStun)
  return Math.max(0, Math.floor(seconds / BOSS_ATTACK_INTERVAL_SECONDS + 1e-9))
}

/**
 * **单人**交互次数上限（次数）= `floor(非失衡秒数 / 4s)`。
 *
 * 按**槽位合计**（该槽闪反 + 弹刀之和）限制集中度；与全队池同时生效。
 */
export function bossAttackPerSlotBudget(nonStun: number): number {
  const seconds = Math.max(0, nonStun)
  return Math.max(0, Math.floor(seconds / BOSS_ATTACK_PER_SLOT_INTERVAL_SECONDS + 1e-9))
}

/** 一槽的读入次数（逐字段） */
export type BossAttackSlotRequest = Partial<Record<BossAttackLimitedField, number>>

export interface BossAttackSlotAllocation {
  slot: number
  /** 该槽读入的闪反 / 弹刀 */
  requested: BossAttackSlotRequest
  /** 该槽兑现的闪反 / 弹刀 */
  delivered: BossAttackSlotRequest
  /** 该槽读入合计 / 兑现合计（两个字段相加 —— 它们共用同一个池） */
  requestedTotal: number
  deliveredTotal: number
  /** 该槽被削掉的原因（空 = 原样兑现） */
  reasons: BossAttackCutReason[]
}

export type BossAttackCutReason = 'teamPool' | 'slotCap'

export interface BossAttackAllocation {
  /** 非失衡秒数（分母） */
  nonStunSeconds: number
  /** 全队池上限（次数） */
  teamBudget: number
  /** 单人上限（次数） */
  perSlotBudget: number
  /** 全队读入合计 / 兑现合计 */
  requestedTotal: number
  deliveredTotal: number
  slots: BossAttackSlotAllocation[]
}

/**
 * **全队交互次数分配**（唯一实现）：把各槽读入的闪反/弹刀夹进
 * 「全队池 `floor(非失衡/3)`」+「单人上限 `floor(非失衡/4)`」两条尺。
 *
 * ## 分配顺序（确定性，不看谁先谁后）
 *
 * 1. **先按单人上限截**每个槽的合计；
 * 2. 再按**比例**把全队池分给各槽（`min(槽合计, 池剩余 × 槽占比)`，逐轮收敛直到不再变化）。
 *
 * ⚠ **为什么按比例而不是先到先得**：槽序是 UI 位置、不是优先级。先到先得会让「槽0 填满」
 * 静默吃掉槽1/槽2 的额度，用户改个槽序结果就变。按比例分配与顺序无关。
 *
 * ⚠ **为什么两个字段合并计数**：用户 2026-11-06「般岳这种需要更多嗔火就刚需双弹，
 * 提高每次交互的利用率」——双反是一次 boss 出手吃两下交互，它不该占两份预算。
 * 合并后「用弹刀换闪反」不改变总量，只有「总次数」受物理约束。
 *
 * ⚠ 语义 = 「引擎只兑现装得下的量」，**不是判红**：调用方照常算，只是兑现量更小、读数如实。
 */
export function allocateBossAttackBudget(args: {
  nonStunSeconds: number
  slots: readonly BossAttackSlotRequest[]
}): BossAttackAllocation {
  const nonStun = Math.max(0, Number.isFinite(args.nonStunSeconds) ? args.nonStunSeconds : 0)
  const teamBudget = bossAttackBudget(nonStun)
  const perSlotBudget = bossAttackPerSlotBudget(nonStun)

  const clampField = (v: number): number => Math.max(0, Number.isFinite(v) ? v : 0)
  const rows = args.slots.map((req, slot) => {
    const requested: BossAttackSlotRequest = {}
    for (const f of BOSS_ATTACK_LIMITED_FIELDS) requested[f] = clampField(Number(req[f] ?? 0))
    const requestedTotal = BOSS_ATTACK_LIMITED_FIELDS.reduce((a, f) => a + (requested[f] ?? 0), 0)
    return { slot, requested, requestedTotal, capTotal: Math.min(requestedTotal, perSlotBudget) }
  })

  // 第 1 轮：单人上限
  const afterSlotCap = rows.map(r => {
    const reasons: BossAttackCutReason[] = r.capTotal < r.requestedTotal - 1e-9 ? ['slotCap'] : []
    return { ...r, capTotal: r.capTotal, reasons }
  })

  // 第 2 轮：全队池按比例分配（不动点：反复削到不再变化）
  const granted = afterSlotCap.map(r => r.capTotal)
  let remaining = teamBudget
  let poolBound = true
  let changed = true
  while (changed && poolBound) {
    changed = false
    const activeTotal = granted.reduce((a, v) => a + v, 0)
    if (activeTotal <= teamBudget + 1e-9) { poolBound = false; break }
    remaining = teamBudget
    // 按「本槽已授予量」占全队已授予量的比例分配池
    for (let i = 0; i < granted.length; i++) {
      if (granted[i]! <= 1e-9) continue
      const share = activeTotal > 0 ? granted[i]! / activeTotal : 0
      const next = Math.min(granted[i]!, remaining * share)
      if (Math.abs(next - granted[i]!) > 1e-9) { granted[i] = next; changed = true }
    }
    // 收敛后若有残余（浮点/余数），按剩余额度补回未满的槽
    let leftover = teamBudget - granted.reduce((a, v) => a + v, 0)
    for (let i = 0; i < granted.length && leftover > 1e-9; i++) {
      const room = afterSlotCap[i]!.capTotal - granted[i]!
      if (room <= 1e-9) continue
      const add = Math.min(room, leftover)
      granted[i]! += add
      leftover -= add
    }
  }

  const slots: BossAttackSlotAllocation[] = afterSlotCap.map((r, i) => {
    const total = granted[i]!
    const reasons: BossAttackCutReason[] = [...r.reasons]
    if (total < r.capTotal - 1e-9) reasons.push('teamPool')
    const delivered: BossAttackSlotRequest = {}
    if (r.requestedTotal > 1e-9) {
      // 逐字段按同比例缩放（保持该槽「闪反:弹刀」的构成）
      const ratio = total / r.requestedTotal
      for (const f of BOSS_ATTACK_LIMITED_FIELDS) {
        const want = r.requested[f] ?? 0
        // 取整只在最终落地上做一次，避免中间态把小数当次数
        delivered[f] = Math.max(0, Math.floor(want * ratio + 1e-9))
      }
      // 取整可能留下 <1 的余量：补到该槽读入最多的那个字段上（不越过上限）
      let sum = BOSS_ATTACK_LIMITED_FIELDS.reduce((a, f) => a + (delivered[f] ?? 0), 0)
      let guard = 0
      while (sum < Math.floor(total + 1e-9) && guard++ < 8) {
        let best: BossAttackLimitedField | null = null
        let bestRoom = 0
        for (const f of BOSS_ATTACK_LIMITED_FIELDS) {
          const room = (r.requested[f] ?? 0) - (delivered[f] ?? 0)
          if (room > bestRoom) { bestRoom = room; best = f }
        }
        if (!best) break
        delivered[best] = (delivered[best] ?? 0) + 1
        sum++
      }
    } else {
      for (const f of BOSS_ATTACK_LIMITED_FIELDS) delivered[f] = 0
    }
    return {
      slot: r.slot, requested: r.requested, delivered,
      requestedTotal: r.requestedTotal,
      deliveredTotal: BOSS_ATTACK_LIMITED_FIELDS.reduce((a, f) => a + (delivered[f] ?? 0), 0),
      reasons,
    }
  })

  return {
    nonStunSeconds: nonStun, teamBudget, perSlotBudget,
    requestedTotal: slots.reduce((a, s) => a + s.requestedTotal, 0),
    deliveredTotal: slots.reduce((a, s) => a + s.deliveredTotal, 0),
    slots,
  }
}

/**
 * 把某字段的**读入次数夹到预算内**，并给出夹取读数（单条上界的薄壳）。
 *
 * ⚠ 全队口径的分配请用 `allocateBossAttackBudget`（它同时管全队池与单人上限）；
 * 本函数只回答「单个量不超过某个上界」这一件事。
 *
 * ⚠ 语义 = 「引擎只兑现装得下的量」，**不是**「判红」：调用方照常往下算，只是兑现量更小、读数如实。
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

/**
 * **计算失真**的一处读数（按槽位；「被削了什么、为什么」）。
 *
 * 页面提示与自动交互 note 都从这里取素材，不各自复算（防两把尺漂移——2026-11-05 踩过）。
 */
export interface BossAttackSlotReading {
  slot: number
  /** 该槽读入的闪反 / 弹刀 */
  requested: BossAttackSlotRequest
  /** 该槽兑现的闪反 / 弹刀 */
  delivered: BossAttackSlotRequest
  requestedTotal: number
  deliveredTotal: number
  /** 被削的原因（空 = 原样兑现） */
  reasons: BossAttackCutReason[]
}

/** 供提示消费的读数（全队池 + 单人上限 + 逐槽明细） */
export function bossAttackBudgetReadings(args: {
  nonStunSeconds: number
  slots: readonly BossAttackSlotRequest[]
}): {
  allocation: BossAttackAllocation
  slots: BossAttackSlotReading[]
  /** 是否有任何槽被削 */
  capped: boolean
} {
  const allocation = allocateBossAttackBudget(args)
  const slots: BossAttackSlotReading[] = allocation.slots.map(s => ({
    slot: s.slot,
    requested: s.requested,
    delivered: s.delivered,
    requestedTotal: s.requestedTotal,
    deliveredTotal: s.deliveredTotal,
    reasons: s.reasons,
  }))
  return { allocation, slots, capped: slots.some(s => s.reasons.length > 0) }
}
