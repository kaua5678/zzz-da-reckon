import { describe, expect, it } from 'vitest'
import { calcStunAxis, computeInAxisRatio } from '@/core/stunAxis'

describe('computeInAxisRatio', () => {
  it('computes window coverage for in/out/cross-boundary blocks', () => {
    expect(computeInAxisRatio(0, 5, 16)).toBe(1)
    expect(computeInAxisRatio(14, 5, 16)).toBeCloseTo(0.4) // 2s 在窗口内
    expect(computeInAxisRatio(-2, 5, 16)).toBeCloseTo(0.6) // 3s 在窗口内
    expect(computeInAxisRatio(20, 5, 16)).toBe(0)
  })
})

describe('calcStunAxis', () => {
  it('固定轴不截断：资源超额只警告，仍按满额计入', () => {
    const axis = calcStunAxis({
      axes: [{
        name: 'Axis A',
        count: 2,
        actions: [{ slot: 0, moveId: 'exSpecial', count: 2, startTime: 0 }],
      }],
      globalPool: { '0:exSpecial': 3 },
      perActionStun: { '0:exSpecial': 800 },
      perActionDuration: { '0:exSpecial': 2 },
      stunCount: 2,
      windowDuration: 16,
      bossStunValue: 15486,
      battleTime: 180,
      invincibleTime: 0,
    })

    // 固定轴：需 4 次、池里只有 3 次 → 仍按 4 次计入，overuse=1 仅警告
    expect(axis.totalInAxisStun).toBe(3200)
    expect(axis.stunCount).toBe(2)
    expect(axis.allocation['0:exSpecial'].inAxisUnits).toBe(4)
    expect(axis.allocation['0:exSpecial'].outAxisUnits).toBe(0)
    expect(axis.axisDetails[0].actions[0].overuse).toBe(1)
    expect(axis.globalWarnings.some(w => w.includes('超额'))).toBe(true)
  })

  it('缺省 count = 兜底吃剩余窗口（与 allocateAxisWindows 同口径）', () => {
    const axis = calcStunAxis({
      axes: [{ name: 'Axis B', actions: [{ slot: 0, moveId: 'exSpecial', count: 2, startTime: 0 }] }],
      globalPool: { '0:exSpecial': 20 },
      perActionStun: { '0:exSpecial': 100 },
      perActionDuration: { '0:exSpecial': 2 },
      stunCount: 4,
      windowDuration: 16,
      bossStunValue: 1000,
      battleTime: 180,
    })

    expect(axis.totalAxisRounds).toBe(4)
    expect(axis.allocation['0:exSpecial'].inAxisUnits).toBe(8)
  })

  it('splits cross-boundary basic seconds into fractional in/out units', () => {
    const axis = calcStunAxis({
      axes: [{ name: 'Axis C', count: 1, actions: [{ slot: 1, moveId: 'basic', count: 10, startTime: 11 }] }],
      globalPool: { '1:basic': 10 },
      perActionStun: { '1:basic': 5 },
      perActionDuration: { '1:basic': 1 },
      stunCount: 3,
      windowDuration: 16,
      bossStunValue: 1000,
      battleTime: 180,
    })

    // basic 10s 从 11s 起手：11..16 在窗口内 = 5s，比例 0.5
    expect(axis.allocation['1:basic'].inAxisUnits).toBeCloseTo(5)
    expect(axis.allocation['1:basic'].outAxisUnits).toBeCloseTo(5)
  })

  it('固定轮数合计超过失衡次数时警告（窗口被截断）', () => {
    const axis = calcStunAxis({
      axes: [{ name: 'Axis D', count: 3, actions: [{ slot: 0, moveId: 'ultimate', count: 1, startTime: 0 }] }],
      globalPool: { '0:ultimate': 3 },
      perActionStun: { '0:ultimate': 100 },
      perActionDuration: { '0:ultimate': 3 },
      stunCount: 2,
      windowDuration: 16,
      bossStunValue: 1000,
      battleTime: 180,
    })

    expect(axis.totalAxisRounds).toBe(2)
    expect(axis.globalWarnings.some(w => w.includes('超过失衡次数'))).toBe(true)
  })

  it('合轴：单轮时长按槽位并行取最大值，不是相加', () => {
    const axis = calcStunAxis({
      axes: [{
        name: 'Axis E',
        count: 1,
        actions: [
          { slot: 0, moveId: 'a', count: 1, startTime: 0 },
          { slot: 1, moveId: 'b', count: 1, startTime: 0 },
        ],
      }],
      globalPool: { '0:a': 10, '1:b': 10 },
      perActionStun: { '0:a': 100, '1:b': 100 },
      perActionDuration: { '0:a': 6, '1:b': 6 },
      stunCount: 1,
      windowDuration: 10,
      bossStunValue: 1000,
      battleTime: 180,
    })

    expect(axis.axisDetails[0].axisDuration).toBe(6)
    expect(axis.globalWarnings.some(w => w.includes('超过失衡窗口'))).toBe(false)
  })
})
