/** 失衡内异常系统 v2 单测：进窗初始状态 / 中途触发一次 / 多槽并行 / 跨窗继承 */
import { describe, expect, it } from 'vitest'
import { attributeCountByStateChain, computeBossAnomalyStateTimeline, computeInStunAnomalyTimeline } from '../inStunAnomaly'

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

describe('computeBossAnomalyStateTimeline（Boss 异常状态轴）', () => {
  it('不同属性触发 = 紊乱并替换状态，紊乱归因取被替换的原状态', () => {
    const r = computeBossAnomalyStateTimeline({
      triggers: [
        { windowIndex: 0, element: 'electric', offsetSeconds: 2 },
        { windowIndex: 0, element: 'fire', offsetSeconds: 8 },
      ],
      windowDuration: 16,
      windowCount: 1,
    })
    // 电 @2s 激活；火 @8s 替换 → 紊乱归因电（原状态）
    expect(r.disorders).toEqual([{ windowIndex: 0, time: 8, element: 'electric' }])
    const chain = r.stateChainsPerWindow[0]
    expect(chain).toEqual([
      { start: 2, end: 8, element: 'electric' },
      { start: 8, end: 16, element: 'fire' },
    ])
  })

  it('同元素刷新时长（不产生紊乱）；过期后再激活=重新激活（非紊乱）', () => {
    const r = computeBossAnomalyStateTimeline({
      triggers: [
        { windowIndex: 0, element: 'fire', offsetSeconds: 1 },
        { windowIndex: 0, element: 'fire', offsetSeconds: 5 },
        { windowIndex: 3, element: 'fire', offsetSeconds: 4 },
      ],
      windowDuration: 16,
      windowCount: 4,
    })
    expect(r.disorders).toHaveLength(0)
    // 窗0：1s 激活持续 ANOMALY_DURATION.fire（>15s 跨到窗尾之后）；窗3 时已过期重新激活
    expect(r.stateChainsPerWindow[0].length).toBeGreaterThanOrEqual(1)
    expect(r.stateChainsPerWindow[3].some(s => s.element === 'fire' && s.start <= 4.5)).toBe(true)
  })

  it('风化独立覆盖层：不被其他元素替换、自身触发也不挤掉标准槽', () => {
    const r = computeBossAnomalyStateTimeline({
      triggers: [
        { windowIndex: 0, element: 'wind', offsetSeconds: 2 },
        { windowIndex: 0, element: 'electric', offsetSeconds: 6 },
        { windowIndex: 0, element: 'fire', offsetSeconds: 10 },
      ],
      windowDuration: 16,
      windowCount: 1,
    })
    // 风化全程在覆盖层；标准槽电→火替换一次
    expect(r.disorders).toEqual([{ windowIndex: 0, time: 10, element: 'electric' }])
    expect(r.windOverlayPerWindow[0][0].element).toBe('wind')
    expect(r.stateChainsPerWindow[0].map(s => s.element)).toEqual(['electric', 'fire'])
  })

  it('跨窗延续：状态未过期则下一窗继续同一状态链', () => {
    const r = computeBossAnomalyStateTimeline({
      triggers: [{ windowIndex: 0, element: 'ether', offsetSeconds: 12 }],
      windowDuration: 16,
      windowCount: 2,
    })
    expect(r.stateChainsPerWindow[0][0]).toEqual({ start: 12, end: 16, element: 'ether' })
    expect(r.stateChainsPerWindow[1][0].element).toBe('ether')
    expect(r.stateChainsPerWindow[1][0].start).toBe(0)
  })

  it('进窗初始 entryElement 作为开战状态参与替换循环', () => {
    const r = computeBossAnomalyStateTimeline({
      triggers: [{ windowIndex: 0, element: 'ice', offsetSeconds: 3 }],
      windowDuration: 16,
      windowCount: 1,
      entryElement: 'fire',
    })
    expect(r.disorders).toEqual([{ windowIndex: 0, time: 3, element: 'fire' }])
    // 开场火 [0,3)，被冰替换后截断；冰激活持续 ANOMALY_DURATION.ice=10s → [3,13)
    expect(r.stateChainsPerWindow[0]).toEqual([
      { start: 0, end: 3, element: 'fire' },
      { start: 3, end: 13, element: 'ice' },
    ])
  })
})

describe('attributeCountByStateChain（极性紊乱点时归因）', () => {
  it('次数按取样时刻落点分摊到状态段，总量守恒', () => {
    // 链：0-8 电、8-16 火；6 次均匀取样 t=1.33,4,6.67,9.33,12,14.67 → 电3+火3
    const parts = attributeCountByStateChain(6, [
      { start: 0, end: 8, element: 'electric' },
      { start: 8, end: 16, element: 'fire' },
    ], 16, 'physical')
    expect(parts).toEqual([
      { element: 'electric', count: 3 },
      { element: 'fire', count: 3 },
    ])
  })

  it('无状态的取样点计入 fallback 元素', () => {
    const parts = attributeCountByStateChain(4, [
      { start: 8, end: 16, element: 'ice' },
    ], 16, 'physical')
    expect(parts).toContainEqual({ element: 'physical', count: 2 })
    expect(parts).toContainEqual({ element: 'ice', count: 2 })
  })
})
