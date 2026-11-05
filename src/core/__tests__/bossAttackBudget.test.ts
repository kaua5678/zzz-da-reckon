import { describe, expect, it } from 'vitest'
import {
  BOSS_ATTACK_INTERVAL_SECONDS, BOSS_ATTACK_LIMITED_FIELDS,
  bossAttackBudget, bossAttackBudgetReadings, capToBossAttackBudget, nonStunSeconds,
} from '@/core/bossAttackBudget'
import { lycaonHuntWindowSeconds, LYCAON_HUNT_FULL_SECONDS } from '@/mechanics/agents/lycaon'

/**
 * **Boss 出手预算**（用户口径 2026-11-04）的纯函数判据。
 *
 * 用户逐字：「我不希望判据决定错误，我希望**计算引擎用时间限制自主推导**出失衡的上限和溢出性。」
 * 「本质还是**前台闪反的产出太多了，没有哪个 boss 会如此高频的一直攻击**。」
 * 「你找不到出手频率的，只能大致估算，**2s 有效战斗时间 / 每人一次**」。
 *
 * 这里的断言锁的是**推导本身**（它算得对不对、是不是推导），
 * 引擎侧「算出来装不下就只兑现装得下的量」另由 `bossAttackBudgetEngine.test.ts` 锁。
 */
describe('Boss 出手预算（推导，不是判据）', () => {
  it('分母是**非失衡时间**：失衡期 boss 瘫痪 ⇒ 不出手（用户逐字「失衡期内 boss 都瘫痪了」）', () => {
    // 整场 180s、失衡 96s ⇒ 非失衡 84s（不是 180s）
    expect(nonStunSeconds(180, 96)).toBe(84)
    // 失衡时长不许超过有效时间（clamp）
    expect(nonStunSeconds(180, 999)).toBe(0)
    expect(nonStunSeconds(180, -5)).toBe(180)
    expect(nonStunSeconds(-5, 0)).toBe(0)
  })

  it('预算 = floor(非失衡 / 2s)，2s 是唯一间隔来源', () => {
    expect(BOSS_ATTACK_INTERVAL_SECONDS).toBe(2)
    expect(bossAttackBudget(84)).toBe(42)
    expect(bossAttackBudget(68)).toBe(34)
    expect(bossAttackBudget(1.99)).toBe(0)
    expect(bossAttackBudget(0)).toBe(0)
    expect(bossAttackBudget(-10)).toBe(0)
  })

  it('旗舰夹具的量级：非失衡 84s ⇒ 42 次、68s ⇒ 34 次（交接 §3.1b 的估算表）', () => {
    expect(bossAttackBudget(84)).toBe(42)
    expect(bossAttackBudget(68)).toBe(34)
    // 分界线：20 合理（20 ≤ 34）/ 40 略超 / 81 严重超（2 倍以上）
    expect(20).toBeLessThanOrEqual(bossAttackBudget(68))
    expect(40).toBeGreaterThan(bossAttackBudget(68))
    expect(81).toBeGreaterThan(2 * bossAttackBudget(68))
  })

  it('夹取 = 只兑现装得下的量，并**如实**报出夹取（不 throw、不否决）', () => {
    const ok = capToBossAttackBudget(20, 34)
    expect(ok).toMatchObject({ count: 20, capped: false, requested: 20, budget: 34 })
    const cut = capToBossAttackBudget(81, 34)
    expect(cut).toMatchObject({ count: 34, capped: true, requested: 81, budget: 34 })
    // 边界与异常输入不产生非法值
    expect(capToBossAttackBudget(34, 34).capped).toBe(false)
    expect(capToBossAttackBudget(0, 0).count).toBe(0)
    expect(capToBossAttackBudget(Number.NaN, 10).count).toBe(0)
    expect(capToBossAttackBudget(10, Number.NaN).count).toBe(0)
  })

  it('★ 闪反与弹刀**各自一份**：同一预算、不相加、不互斥（用户逐字「各自独立」）', () => {
    expect([...BOSS_ATTACK_LIMITED_FIELDS]).toEqual(['dodgeCounterCount', 'parryCount'])
    const requested = { dodgeCounterCount: 81, parryCount: 30 }
    const r = bossAttackBudgetReadings({ nonStunSeconds: 68, requestedOf: f => requested[f] })
    // 同一入参 ⇒ 两份预算同值（各 34），而不是相加成 68
    expect(r.dodgeCounterCount!.budget).toBe(34)
    expect(r.parryCount!.budget).toBe(34)
    // 各自独立夹取：闪反超（81>34）、弹刀不超（30≤34）
    expect(r.dodgeCounterCount).toMatchObject({ delivered: 34, capped: true })
    expect(r.parryCount).toMatchObject({ delivered: 30, capped: false })
    // 反空洞：两者都拿到完整额度时，说明它们**没有**共享同一池（否则合起来只能 34）
    const both = bossAttackBudgetReadings({ nonStunSeconds: 68, requestedOf: () => 34 })
    expect(both.dodgeCounterCount!.delivered + both.parryCount!.delivered).toBe(68)
  })
})

/**
 * **围猎提前终止**（缺口二，用户口径 2026-11-04）的纯函数判据。
 *
 * 用户逐字：「这个狼的后台状态会终止的，**进入失衡放连携或者大招就终止了**。」
 * 原文 1141508：「当前操作中角色停止进攻或发动[连携技]和[终结技]时，莱卡恩会**提前结束**[围猎]状态。」
 *
 * 验收要求（交接 §6-3）：**围猎窗口时长随「该次围猎期间队伍连携/大招次数」单调不增**。
 */
describe('围猎提前终止：窗口随连携/大招次数单调不增', () => {
  it('★ 单调性（交接 §6-3 的验收判据）', () => {
    const ns = [0, 0.5, 1, 2, 4, 8]
    const windows = ns.map(n => lycaonHuntWindowSeconds(3, n))
    for (let i = 1; i < windows.length; i++) {
      expect(windows[i]!).toBeLessThanOrEqual(windows[i - 1]! + 1e-12)
    }
    // 严格下降（不是恒等）：提前终止必须真的起作用
    expect(windows[windows.length - 1]!).toBeLessThan(windows[0]! - 1e-9)
  })

  it('n = 0（不打连携也不放大招）⇒ 满额 8s × 次数（与修改前逐位相同，零 delta 前提）', () => {
    expect(lycaonHuntWindowSeconds(1, 0)).toBe(LYCAON_HUNT_FULL_SECONDS)
    expect(lycaonHuntWindowSeconds(2, 0)).toBe(16)
    expect(lycaonHuntWindowSeconds(0, 5)).toBe(0)
  })

  it('折算 = 8 / (1 + n)：到第一个中断动作的期望时刻（位置均匀分布）', () => {
    expect(lycaonHuntWindowSeconds(1, 1)).toBeCloseTo(4, 9)
    expect(lycaonHuntWindowSeconds(1, 3)).toBeCloseTo(2, 9)
    expect(lycaonHuntWindowSeconds(2, 1)).toBeCloseTo(8, 9)
    // 非法输入不产生 NaN / 负值
    expect(lycaonHuntWindowSeconds(Number.NaN, 1)).toBe(0)
    expect(lycaonHuntWindowSeconds(-1, 1)).toBe(0)
    expect(lycaonHuntWindowSeconds(2, -3)).toBe(16)
  })

  it('★ 窗口永远不会被扣成 0（打连携终止的是**那一次**围猎，不是围猎机制本身）', () => {
    // 否决记录：「每打一个扣半个窗口」在 n ≥ 2 时把窗口扣成 0 ⇒ 连一次围猎都不成立
    for (const n of [1, 2, 4, 16]) {
      expect(lycaonHuntWindowSeconds(2, n)).toBeGreaterThan(0)
    }
  })
})