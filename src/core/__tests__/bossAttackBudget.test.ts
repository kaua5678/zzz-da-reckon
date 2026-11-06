import { describe, expect, it } from 'vitest'
import {
  BOSS_ATTACK_INTERVAL_SECONDS, BOSS_ATTACK_LIMITED_FIELDS, BOSS_ATTACK_PER_SLOT_INTERVAL_SECONDS,
  allocateBossAttackBudget, bossAttackBudget, bossAttackPerSlotBudget,
  capToBossAttackBudget, nonStunSeconds,
} from '@/core/bossAttackBudget'
import { lycaonHuntWindowSeconds, LYCAON_HUNT_FULL_SECONDS } from '@/mechanics/agents/lycaon'

/**
 * **Boss 出手预算**（用户口径 2026-11-04）的纯函数判据。
 *
 * 用户逐字：「我不希望判据决定错误，我希望**计算引擎用时间限制自主推导**出失衡的上限和溢出性。」
 * 「本质还是**前台闪反的产出太多了，没有哪个 boss 会如此高频的一直攻击**。」
 * 「你找不到出手频率的，只能大致估算，**2s 有效战斗时间 / 每人一次**」。
 *
 * ## ⚠ 2026-11-06 口径收紧（用户逐字）
 *
 * 「**全队交互次数上限还是改为非失衡时间/3**」「**单人交互上限为非失衡*1/4**」
 * 「**般岳这种需要更多嗔火就刚需双弹，提高每次交互的利用率**」
 * ⇒ 预算从「每槽各一份 /2」变成「**全队共用 /3** + **单人 /4**」，且**闪反与弹刀合并计数**
 * （一次 boss 出手吃两下交互不该占两份额度）。
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

  it('★ 全队预算 = floor(非失衡 / 3s)，3s 是唯一间隔来源（用户 2026-11-06）', () => {
    expect(BOSS_ATTACK_INTERVAL_SECONDS).toBe(3)
    expect(bossAttackBudget(84)).toBe(28)
    expect(bossAttackBudget(68)).toBe(22)
    expect(bossAttackBudget(126)).toBe(42)
    expect(bossAttackBudget(2.99)).toBe(0)
    expect(bossAttackBudget(0)).toBe(0)
    expect(bossAttackBudget(-10)).toBe(0)
  })

  it('★ 单人上限 = floor(非失衡 / 4s)（用户 2026-11-06「单人交互上限为非失衡*1/4」）', () => {
    expect(BOSS_ATTACK_PER_SLOT_INTERVAL_SECONDS).toBe(4)
    expect(bossAttackPerSlotBudget(84)).toBe(21)
    expect(bossAttackPerSlotBudget(68)).toBe(17)
    expect(bossAttackPerSlotBudget(126)).toBe(31)
    expect(bossAttackPerSlotBudget(0)).toBe(0)
    // 单人上限恒小于全队池（3 < 4 ⇒ 分母越大额度越小），否则「单人上限」这个词没有意义
    for (const s of [12, 40, 84, 180]) {
      expect(bossAttackPerSlotBudget(s)).toBeLessThanOrEqual(bossAttackBudget(s))
    }
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

  it('★ 闪反与弹刀**共用一个池**（2026-11-06 取代「各自独立」）', () => {
    expect([...BOSS_ATTACK_LIMITED_FIELDS]).toEqual(['dodgeCounterCount', 'parryCount'])
    // 非失衡 126s ⇒ 全队池 42、单人 31
    const r = allocateBossAttackBudget({
      nonStunSeconds: 126,
      slots: [{ dodgeCounterCount: 20, parryCount: 20 }],
    })
    // 同一个槽填了 40 次合计，超过单人上限 31 ⇒ 被削到 31（**不是**每个字段各 31 = 62）
    expect(r.slots[0]!.deliveredTotal).toBe(31)
    expect(r.slots[0]!.reasons).toContain('slotCap')
    expect(r.teamBudget).toBe(42)
    expect(r.perSlotBudget).toBe(31)
  })

  it('★ 全队合计 ≤ 池：三槽各自合规、合计超池时按比例削（跨槽耦合）', () => {
    // 非失衡 126s ⇒ 池 42、单人 31。三槽各填 31（各自都 ≤ 单人上限）⇒ 合计 93 > 42
    const r = allocateBossAttackBudget({
      nonStunSeconds: 126,
      slots: [
        { dodgeCounterCount: 31 }, { dodgeCounterCount: 31 }, { dodgeCounterCount: 31 },
      ],
    })
    expect(r.requestedTotal).toBe(93)
    expect(r.deliveredTotal).toBeLessThanOrEqual(42)
    // 三槽均分（不是「槽0 吃满」）
    const [a, b, c] = r.slots.map(s => s.deliveredTotal)
    expect(Math.abs(a! - b!)).toBeLessThanOrEqual(1)
    expect(Math.abs(b! - c!)).toBeLessThanOrEqual(1)
    // 每个非零槽都标了 teamPool
    expect(r.slots.every(s => s.reasons.includes('teamPool'))).toBe(true)
  })

  it('★ 分配与槽序无关（同一组输入换顺序 ⇒ 同值集合）', () => {
    const a = allocateBossAttackBudget({
      nonStunSeconds: 126,
      slots: [{ dodgeCounterCount: 40 }, { dodgeCounterCount: 10 }, { dodgeCounterCount: 5 }],
    })
    const b = allocateBossAttackBudget({
      nonStunSeconds: 126,
      slots: [{ dodgeCounterCount: 5 }, { dodgeCounterCount: 40 }, { dodgeCounterCount: 10 }],
    })
    expect(a.slots.map(s => s.deliveredTotal).sort((x, y) => x - y))
      .toEqual(b.slots.map(s => s.deliveredTotal).sort((x, y) => x - y))
  })

  it('★ 不动点平凡：合计不超池时逐位原样兑现（不因新口径改变正常输入）', () => {
    const r = allocateBossAttackBudget({
      nonStunSeconds: 180, // 池 60、单人 45
      slots: [{ dodgeCounterCount: 10, parryCount: 2 }, { parryCount: 3 }, {}],
    })
    expect(r.slots[0]!.delivered).toMatchObject({ dodgeCounterCount: 10, parryCount: 2 })
    expect(r.slots[1]!.delivered).toMatchObject({ parryCount: 3 })
    expect(r.slots[2]!.deliveredTotal).toBe(0)
    expect(r.slots.every(s => s.reasons.length === 0)).toBe(true)
  })

  it('反空洞：全 0 ⇒ 全 0、无 NaN（不伪造动作）', () => {
    const r = allocateBossAttackBudget({ nonStunSeconds: 0, slots: [{ dodgeCounterCount: 99, parryCount: 99 }] })
    expect(r.teamBudget).toBe(0)
    expect(r.perSlotBudget).toBe(0)
    expect(r.slots[0]!.deliveredTotal).toBe(0)
    expect(Number.isFinite(r.deliveredTotal)).toBe(true)
    expect(allocateBossAttackBudget({ nonStunSeconds: Number.NaN, slots: [{}] }).deliveredTotal).toBe(0)
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