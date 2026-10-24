/**
 * **连续失衡·缺口标注判据**（用户口径 2026-10-23）。
 *
 * ⚠ 2026-10-25：原「末窗兑现折算 / 连续覆盖率」两条 describe 随实现一起删除（未接生产通道，见
 * `core/continuousStun.ts` 文件头与 `docs/STUN_CONTINUOUS_LASTWINDOW.md`）；本文件现在只钉
 * 「离下一次完整失衡还差多少」的标注口径。
 */
import { describe, expect, it } from 'vitest'
import { continuousStunProgress } from '@/core/continuousStun'

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
