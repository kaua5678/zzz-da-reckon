/** 失衡内异常系统 v1 单测：窗口内触发数分配与异常存活覆盖（均匀速率近似 golden 值） */
import { describe, expect, it } from 'vitest'
import { computeInStunAnomalyEvents } from '../inStunEvents'

describe('computeInStunAnomalyEvents（失衡内异常事件分配）', () => {
  it('窗口占比分配：180s 总时长、3 窗 × 10s = 30s → 20 触发分进窗口 3 次', () => {
    const r = computeInStunAnomalyEvents({
      perElement: [{ element: 'ether', triggerCount: 20 }],
      totalTime: 180,
      stunCount: 3,
      windowDuration: 10,
    })
    expect(r.triggersInWindows).toBe(Math.round(20 * (30 / 180)))
    expect(r.triggersInWindows).toBe(3)
    expect(r.elements).toEqual(['ether'])
  })

  it('异常存活覆盖：平均时长 10s / 窗口 10s → 100%；风化 30s 封顶 100%', () => {
    const ether = computeInStunAnomalyEvents({
      perElement: [{ element: 'ether', triggerCount: 5 }],
      totalTime: 180, stunCount: 3, windowDuration: 10,
    })
    expect(ether.activeCoveragePerWindow).toBeCloseTo(1)
    const wind = computeInStunAnomalyEvents({
      perElement: [{ element: 'wind', triggerCount: 5 }],
      totalTime: 180, stunCount: 2, windowDuration: 10,
    })
    expect(wind.activeCoveragePerWindow).toBeCloseTo(1) // min(1, 30/10)
  })

  it('多元素按触发次数加权平均时长；零触发元素不参与', () => {
    const r = computeInStunAnomalyEvents({
      perElement: [
        { element: 'ether', triggerCount: 8 },   // 10s
        { element: 'wind', triggerCount: 2 },    // 30s
        { element: 'fire', triggerCount: 0 },    // 不参与
      ],
      totalTime: 90, stunCount: 1, windowDuration: 12,
    })
    // 加权平均 = (10×8 + 30×2)/10 = 14 → 覆盖 min(1, 14/12) 封顶 100%
    expect(r.activeCoveragePerWindow).toBeCloseTo(1)
    expect(r.triggersInWindows).toBe(Math.round(8 * (12 / 90)) + Math.round(2 * (12 / 90)))
    expect(r.elements).toEqual(['ether', 'wind'])
  })

  it('零失衡 / 零触发 → 全 0，不产生 NaN', () => {
    const r = computeInStunAnomalyEvents({ perElement: [], totalTime: 180, stunCount: 0, windowDuration: 10 })
    expect(r.triggersInWindows).toBe(0)
    expect(r.activeCoveragePerWindow).toBe(0)
  })
})
