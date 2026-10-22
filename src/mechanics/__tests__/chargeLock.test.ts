import { describe, it, expect } from 'vitest'
import { chargeLockComboAlignRatio } from '@/mechanics/chargeLock'

describe('蓄力 1 秒锁合轴率（用户口径 2026-10-22）', () => {
  it('净前台恒为 lockSeconds（蓄力期间锁死、其余并行）', () => {
    for (const t of [1, 1.217, 2.234, 2.833, 3.167, 3.983]) {
      const r = chargeLockComboAlignRatio(t)
      expect(t * (1 - r), 'net = actionTime × (1−ratio)').toBeCloseTo(1, 9)
    }
  })

  it('边界：actionTime ≤ 1s ⇒ 没有可合轴的时间（ratio 钳到 0）', () => {
    expect(chargeLockComboAlignRatio(1)).toBe(0)
    expect(chargeLockComboAlignRatio(0.5)).toBe(0)
    expect(chargeLockComboAlignRatio(0)).toBe(0)
    expect(chargeLockComboAlignRatio(-3)).toBe(0)
  })

  it('自定义锁定时长（雅霜月 #3 传 1.0，与缺省同值）', () => {
    expect(chargeLockComboAlignRatio(3.434, 1)).toBeCloseTo((3.434 - 1) / 3.434, 9)
    expect(chargeLockComboAlignRatio(3.434, 2)).toBeCloseTo((3.434 - 2) / 3.434, 9)
  })

  it('ratio 恒在 [0,1]（不会因 actionTime 极小/极大越界）', () => {
    for (const t of [0.001, 0.5, 1, 100, 1e6]) {
      const r = chargeLockComboAlignRatio(t)
      expect(r).toBeGreaterThanOrEqual(0)
      expect(r).toBeLessThanOrEqual(1)
    }
  })
})
