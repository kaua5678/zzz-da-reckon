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
    // v2.9 触发块清空满槽
    expect(r.gaugeSnapshots[0]?.pct.ether ?? 0).toBe(0)
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

  it('触发块清空满槽：同元素同窗可再次积蓄再触发（多波连打口径，v2.9）', () => {
    const r = computeInStunAnomalyTimeline({
      windows: [
        { actions: [{ moveId: 'm1', element: 'electric', perHitBuildUp: 3200, count: 2, startTime: 0 }] },
        { actions: [{ element: 'electric', perHitBuildUp: 3100, count: 1, startTime: 0 }] },
      ],
      windowDuration: 16,
    })
    // 窗0：首击过管触发清槽（id 0:electric:1），次击再过管二次触发（0:electric:2）
    const w0 = r.triggers.filter(t => t.windowIndex === 0)
    expect(w0.map(t => t.id)).toEqual(['0:electric:1', '0:electric:2'])
    expect(w0[0].moveId).toBe('m1')
    // 窗口独立：窗1 不继承窗0任何东西，单击过管照常触发
    expect(r.triggers.filter(t => t.windowIndex === 1)).toHaveLength(1)
  })

  it('抑制触发：满槽保持不触发且本窗不再提案（施加者后台/CD 场景），恢复后重新生效', () => {
    const mk = (suppressed: string[]) => computeInStunAnomalyTimeline({
      windows: [
        { actions: [{ moveId: 'm1', element: 'electric', perHitBuildUp: 3200, count: 2, startTime: 0 }] },
      ],
      windowDuration: 16,
      suppressedTriggerIds: suppressed,
    })
    const off = mk([])
    expect(off.triggers).toHaveLength(2)
    const on = mk(['0:electric:1'])
    // 第一次提案被抑制：满槽保持、后续积蓄不再提案（无第二次）
    expect(on.triggers).toHaveLength(0)
    const snap = on.gaugeSnapshots.find(g => g.srcIndex === 0)!
    expect(snap.pct.electric).toBe(100)
  })

  it('动作末尾积蓄槽快照：每块完成后的各元素槽百分比', () => {
    const r = computeInStunAnomalyTimeline({
      windows: [
        {
          actions: [
            { srcIndex: 0, moveId: 'a', element: 'electric', perHitBuildUp: 900, count: 2, startTime: 0 },
            { srcIndex: 1, moveId: 'b', element: 'ether', perHitBuildUp: 1500, count: 1, startTime: 2 },
          ],
        },
      ],
      windowDuration: 16,
    })
    // 电块完成：1800/3000=60%；以太块完成：1500/3000=50%（未传 coeff）
    expect(r.gaugeSnapshots.find(g => g.srcIndex === 0)?.pct.electric).toBeCloseTo(60, 1)
    expect(r.gaugeSnapshots.find(g => g.srcIndex === 1)?.pct.ether).toBeCloseTo(50, 1)
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

  it('窗口独立：上一窗的状态不带进下一窗（跨窗继承已移除）', () => {
    const r = computeBossAnomalyStateTimeline({
      triggers: [{ windowIndex: 0, element: 'ether', offsetSeconds: 12 }],
      windowDuration: 16,
      windowCount: 2,
    })
    expect(r.stateChainsPerWindow[0]).toEqual([{ start: 12, end: 16, element: 'ether' }])
    expect(r.stateChainsPerWindow[1]).toEqual([])
  })

  it('边界注入作为开局状态参与替换循环（entryElement 已并入 boundaryStates）', () => {
    const r = computeBossAnomalyStateTimeline({
      triggers: [{ windowIndex: 0, element: 'ice', offsetSeconds: 3 }],
      windowDuration: 16,
      windowCount: 1,
      boundaryStates: [{ windowIndex: 0, element: 'fire' }],
    })
    expect(r.disorders).toEqual([{ windowIndex: 0, time: 3, element: 'fire' }])
    // 开场火 [0,3)，被冰替换后截断；冰持续 ANOMALY_DURATION.ice=10s，截到窗尾内 [3,13)
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

describe('中间态注入（2026-08-24 用户口径：每次失衡都是中间态）', () => {
  it('窗口独立：每窗仅按声明 entryStates 初始化（无跨窗余量继承）', () => {
    const r = computeInStunAnomalyTimeline({
      windows: [
        { actions: [{ element: 'ether', perHitBuildUp: 1600, count: 2, startTime: 0 }] },
        { entryStates: [{ element: 'electric', gauge: 3100 }], actions: [{ element: 'electric', perHitBuildUp: 400, count: 1, startTime: 0 }] },
      ],
      windowDuration: 16,
    })
    // 窗0 以太触发一次；窗1 只带电的声明条（3100+400 过管触发），以太余量不跨窗
    expect(r.triggers.filter(t => t.windowIndex === 0).map(t => t.element)).toEqual(['ether'])
    expect(r.triggers.filter(t => t.windowIndex === 1).map(t => t.element)).toEqual(['electric'])
  })

  it('边界注入：轴段开始强制设状态（不记紊乱），窗内触发按新状态演化', () => {
    const r = computeBossAnomalyStateTimeline({
      triggers: [{ windowIndex: 1, element: 'fire', offsetSeconds: 4 }],
      windowDuration: 16,
      windowCount: 2,
      boundaryStates: [{ windowIndex: 1, element: 'ice' }],
    })
    // 窗1 开局强制冰（相对时刻 0）；t=4 火替换冰 → 紊乱归因冰（time 已改相对该窗口）
    expect(r.disorders).toEqual([{ windowIndex: 1, time: 4, element: 'ice' }])
    expect(r.stateChainsPerWindow[1][0]).toEqual({ start: 0, end: 4, element: 'ice' })
  })
})

describe('触发来源标注（v2.9 块级可视化）', () => {
  it('动作带 moveId 时，触发事件回填来源招式', () => {
    const r = computeInStunAnomalyTimeline({
      windows: [
        {
          entryStates: [{ element: 'ether', gauge: 2500 }],
          actions: [{ moveId: '1511006', element: 'ether', perHitBuildUp: 600, count: 1, startTime: 4, duration: 1 }],
        },
        {
          actions: [{ moveId: '1181005', element: 'electric', perHitBuildUp: 3200, count: 1, startTime: 0 }],
        },
      ],
      windowDuration: 16,
    })
    expect(r.triggers).toHaveLength(2)
    expect(r.triggers[0]).toMatchObject({ windowIndex: 0, element: 'ether', moveId: '1511006' })
    expect(r.triggers[1]).toMatchObject({ windowIndex: 1, element: 'electric', moveId: '1181005' })
  })
})
