/**
 * **连续失衡·缺口标注判据**（用户口径 2026-10-23）。
 *
 * ⚠ 2026-10-25：原「末窗兑现折算 / 连续覆盖率」两条 describe 随实现一起删除（未接生产通道，见
 * `core/continuousStun.ts` 文件头与 `docs/STUN_CONTINUOUS_LASTWINDOW.md`）；本文件现在只钉
 * 「离下一次完整失衡还差多少」的标注口径。
 */
import { describe, expect, it } from 'vitest'
import { continuousStunProgress, continuousWindowSplit } from '@/core/continuousStun'

/**
 * 用户公式（2026-10-25，逐字见 `.claude/TASK-continuous-stun.md` §1）：
 *   unit = b + e；N = 1 + floor((Σ−b)/unit)；frac = ((Σ−b) mod unit)/e
 * 用户例子：b=1w、窗口 16s、窗内每秒 100 点 ⇒ e=0.16w。
 */
describe('连续失衡·末窗兑现（用户 1w/16s/100 例子）', () => {
  const b = 10000
  const e = 1600

  it('Σ = 1.00w ⇒ 窗开了但一秒爆发都没有（frac 0）', () => {
    const r = continuousWindowSplit({ totalBuildUp: 10000, bossStunValue: b, eatenPerWindow: e })
    expect(r.openedWindows).toBe(1)
    expect(r.lastFraction).toBe(0)
    expect(r.unit).toBe(11600)
  })

  it('Σ = 1.08w ⇒ 8 秒爆发（frac 0.5）', () => {
    const r = continuousWindowSplit({ totalBuildUp: 10800, bossStunValue: b, eatenPerWindow: e })
    expect(r.openedWindows).toBe(1)
    expect(r.lastFraction).toBeCloseTo(0.5, 9)
  })

  it('Σ = 1.16w ⇒ 完整 16 秒（frac 1，且记为一窗完整兑现）', () => {
    const r = continuousWindowSplit({ totalBuildUp: 11600, bossStunValue: b, eatenPerWindow: e })
    expect(r.openedWindows).toBe(1)
    expect(r.lastFraction).toBeCloseTo(1, 9)
    expect(r.fullWindows).toBe(1)
    expect(r.clamped).toBe(false)
  })

/**
   * **已兑现等效窗数** = 施工图 §0 的 `完整窗数 + 末窗兑现比例`（接数值路径的唯一读数）。
   *
   * 判据专治一个**必踩的坑**：本仓 `fullWindows` 在末窗完整时**已含末窗**，所以
   * `fullWindows + lastFraction` 会在 frac = 1 时凭空多出一窗（1.16w 报 2 窗）。
   * 这里逐档钉死，任何"顺手写成 fullWindows + lastFraction"的改法立刻红。
   */
  it('已兑现等效窗数：frac=1 不得重复计窗（fullWindows 已含末窗）', () => {
    const at = (sigma: number) => continuousWindowSplit({ totalBuildUp: sigma, bossStunValue: b, eatenPerWindow: e })
    // 用户三档：1.00w / 1.08w / 1.16w ⇒ 0 / 0.5 / 1
    expect(at(10000).realizedWindows).toBe(0)
    expect(at(10800).realizedWindows).toBeCloseTo(0.5, 9)
    expect(at(11600).realizedWindows).toBeCloseTo(1, 9)
    // 两整窗、不足一窗、以及"1.16w 打完 + 0.84w 进度"的反例
    expect(at(23200).realizedWindows).toBeCloseTo(2, 9)
    expect(at(9000).realizedWindows).toBe(0)
    expect(at(20000).realizedWindows).toBeCloseTo(1, 9)
    // 反空洞：这三档里 fullWindows + lastFraction 会给出 2 / 3 / 2 —— 必须与 realizedWindows 不同
    expect(at(11600).fullWindows + at(11600).lastFraction).not.toBeCloseTo(at(11600).realizedWindows, 6)
    // 单调：Σ 越大越不下滑（跨 unit 时窗数 +1，不会回退）
    let prev = 0
    for (let sigma = 9000; sigma <= 50000; sigma += 125) {
      const cur = at(sigma).realizedWindows
      expect(cur, `Σ=${sigma}`).toBeGreaterThanOrEqual(prev - 1e-9)
      prev = cur
    }
  })

  it('Σ = 2.32w ⇒ 两窗完整；Σ 不足一窗 ⇒ 0 窗 0 frac', () => {
    const two = continuousWindowSplit({ totalBuildUp: 23200, bossStunValue: b, eatenPerWindow: e })
    expect(two.openedWindows).toBe(2)
    expect(two.lastFraction).toBeCloseTo(1, 9)
    const none = continuousWindowSplit({ totalBuildUp: 9000, bossStunValue: b, eatenPerWindow: e })
    expect(none.openedWindows).toBe(0)
    expect(none.lastFraction).toBe(0)
  })

  it('本仓量级（b=15486 / e=7795）：frac 恒落在 [0,1]，不靠钳位（施工图 §1 的等价改写）', () => {
    // 用户式在这里会给出 (Σ−b) mod unit / e > 1 的值；等价改写换算成「第 full+1 窗的兑现」
    const r = continuousWindowSplit({ totalBuildUp: 15486 + 7795 * 1.5, bossStunValue: 15486, eatenPerWindow: 7795 })
    expect(r.clamped).toBe(false)
    expect(r.lastFraction).toBeGreaterThanOrEqual(0)
    expect(r.lastFraction).toBeLessThanOrEqual(1)
    // 逐档扫：frac 连续、跨 unit 时归零且开窗数 +1
    const unit = 15486 + 7795
    const prev = continuousWindowSplit({ totalBuildUp: unit - 1, bossStunValue: 15486, eatenPerWindow: 7795 })
    const next = continuousWindowSplit({ totalBuildUp: unit, bossStunValue: 15486, eatenPerWindow: 7795 })
    expect(prev.openedWindows).toBe(1)
    expect(prev.lastFraction).toBeCloseTo(7794 / 7795, 6)
    // 跨过 unit：这一窗从 0.99987 变成完整 1（不归零、不跳窗；下一窗的进度由 continuousStunProgress 表达）
    expect(next.openedWindows).toBe(1)
    expect(next.lastFraction).toBe(1)
    expect(next.fullWindows).toBe(1)
  })

  it('用户反例：Σ = 2.00w（1.16w 打完 + 0.84w 进度）⇒ 只有 1 个完整窗，不是"1 窗 + 6.25"', () => {
    const r = continuousWindowSplit({ totalBuildUp: 20000, bossStunValue: 10000, eatenPerWindow: 1600 })
    expect(r.openedWindows).toBe(1)
    expect(r.fullWindows).toBe(1)
    expect(r.lastFraction).toBe(1)   // 末窗（唯一那个）是完整的；0.84w 是攒向下一窗的进度，不在这里
    expect(r.clamped).toBe(false)
  })

  it('b / e 缺一 ⇒ 退化为 0（调用方走旧整数口径）', () => {
    expect(continuousWindowSplit({ totalBuildUp: 50000, bossStunValue: 0, eatenPerWindow: 100 }).openedWindows).toBe(0)
    expect(continuousWindowSplit({ totalBuildUp: 50000, bossStunValue: 10000, eatenPerWindow: 0 }).openedWindows).toBe(0)
  })
})

describe('「离下一次完整失衡还差多少」标注', () => {
  const b = 10000

  it('★ 正好整数 ⇒ atStep，没有「再加点」可言', () => {
    const r = continuousStunProgress({ builtWindows: 5, bossStunValue: b })
    expect(r.atStep).toBe(true)
    expect(r.missingBars).toBe(0)
    expect(r.missingBuildUp).toBe(0)
    expect(r.nextWindowProgress).toBe(0)
  })

  it('★ 差一点（cont=5.958）⇒ 进度 95.8%、还差 0.042 条 —— 这正是要标注的那一段', () => {
    const r = continuousStunProgress({ builtWindows: 5.958, bossStunValue: b })
    expect(r.completeWindows, '已完整 5 次').toBe(5)
    expect(r.nextWindowProgress).toBeCloseTo(0.958, 6)
    expect(r.missingBars).toBeCloseTo(0.042, 6)
    expect(r.missingBuildUp).toBeCloseTo(0.042 * b, 3)
  })

  it('★ 返还比例进边际成本（第 1 次满额、之后 b(1−r)，与池的计数律同源）', () => {
    const noRefund = continuousStunProgress({ builtWindows: 3.5, bossStunValue: b, stunRefundRatio: 0 })
    const withRefund = continuousStunProgress({ builtWindows: 3.5, bossStunValue: b, stunRefundRatio: 0.2 })
    expect(noRefund.missingBuildUp).toBeCloseTo(0.5 * b, 3)
    expect(withRefund.missingBuildUp, '返还 20% ⇒ 下一次更便宜').toBeCloseTo(0.5 * b * 0.8, 3)
  })

  it('★ 退化输入不编数据', () => {
    expect(continuousStunProgress({ builtWindows: 0, bossStunValue: b }).atStep).toBe(true)
    expect(continuousStunProgress({ builtWindows: 3.5, bossStunValue: 0 }).missingBuildUp).toBe(0)
    expect(continuousStunProgress({ builtWindows: Number.NaN, bossStunValue: b }).completeWindows).toBe(0)
  })
})

describe('缺口折成用户口径（「几个失衡窗被吃掉的量」）', () => {
  const b = 10000

  it('★ 给了 eatenPerWindow ⇒ 缺口折成窗数；没给 ⇒ null（不编数）', () => {
    const withEaten = continuousStunProgress({ builtWindows: 3.5, bossStunValue: b, eatenPerWindow: 5000 })
    expect(withEaten.missingBuildUp).toBeCloseTo(0.5 * b, 3)
    expect(withEaten.missingInEatenWindows, '缺 5000 点 / 每窗被吃 5000 点 = 1 个窗').toBeCloseTo(1, 6)

    const noEaten = continuousStunProgress({ builtWindows: 3.5, bossStunValue: b })
    expect(noEaten.missingInEatenWindows, '没读数 ⇒ null，UI 退回裸失衡值').toBeNull()

    const zeroEaten = continuousStunProgress({ builtWindows: 3.5, bossStunValue: b, eatenPerWindow: 0 })
    expect(zeroEaten.missingInEatenWindows).toBeNull()
  })

  it('★ 已完整（atStep）⇒ 窗数为 0，不是 null', () => {
    const r = continuousStunProgress({ builtWindows: 4, bossStunValue: b, eatenPerWindow: 5000 })
    expect(r.atStep).toBe(true)
    expect(r.missingInEatenWindows).toBe(0)
  })
})
