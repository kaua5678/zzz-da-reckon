/** 失衡内异常系统 v2 单测：进窗初始状态 / 中途触发一次 / 多槽并行 / 跨窗继承 */
import { describe, expect, it } from 'vitest'
import { computeInStunAnomalyTimeline } from '../inStunAnomaly'

describe('computeInStunAnomalyTimeline（失衡内多属性积蓄槽）', () => {
  it('进窗带以太积蓄余量，轴内一击跨阈值 → 触发一次以太异常，覆盖至窗尾', () => {
    const r = computeInStunAnomalyTimeline({
      windows: [{
        entryStates: [{ element: 'ether', gauge: 2500 }],
        actions: [{ element: 'ether', perHitBuildUp: 600, count: 1, startTime: 4, duration: 1 }],
      }],
      windowDuration: 16,
    })
    expect(r.triggers).toHaveLength(1)
    expect(r.triggers[0]).toMatchObject({ windowIndex: 0, element: 'ether' })
    expect(r.triggers[0].offsetSeconds).toBeCloseTo(4.5)
    expect(r.coveragePerWindow[0].ether).toBeCloseTo(10 / 16)
    expect(r.endGaiges[0][0].gauge).toBeCloseTo(100)
  })

  it('多槽并行：以太触发不影响火槽继续累积并独立触发', () => {
    const r = computeInStunAnomalyTimeline({
      windows: [{
        actions: [
          { element: 'ether', perHitBuildUp: 1600, count: 2, startTime: 0, duration: 4 },
          { element: 'fire', perHitBuildUp: 1800, count: 2, startTime: 5, duration: 4 },
        ],
      }],
      windowDuration: 16,
    })
    const els = r.triggers.map(t => t.element).sort()
    expect(els).toEqual(['ether', 'fire'])
    expect(r.coveragePerWindow[0].fire).toBeGreaterThan(0)
  })

  it('同元素同窗只触发一次（第二管不重复出事件）；跨窗余量继承', () => {
    const r = computeInStunAnomalyTimeline({
      windows: [
        { actions: [{ element: 'electric', perHitBuildUp: 3200, count: 2, startTime: 0 }] },
        { actions: [{ element: 'electric', perHitBuildUp: 2900, count: 1, startTime: 0 }] },
      ],
      windowDuration: 16,
    })
    expect(r.triggers.filter(t => t.windowIndex === 0)).toHaveLength(1)
    expect(r.endGaiges[0][0].gauge).toBeCloseTo(3400)
    expect(r.triggers.filter(t => t.windowIndex === 1)).toHaveLength(1)
  })

  it('零动作窗口：仅继承 entry 状态，无触发', () => {
    const r = computeInStunAnomalyTimeline({
      windows: [{ entryStates: [{ element: 'fire', gauge: 100 }] }],
      windowDuration: 16,
    })
    expect(r.triggers).toHaveLength(0)
    expect(Object.keys(r.coveragePerWindow[0])).toHaveLength(0)
  })
})
