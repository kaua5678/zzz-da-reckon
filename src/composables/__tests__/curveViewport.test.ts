/**
 * 曲线取值域自适应判据（用户 2026-10-25「xy 轴标尺」）。
 *
 * ## 锁什么
 *
 * 1. **上下不浪费**：数据 25~53% ⇒ y 上界 100（不再被硬编码 150 顶住）；数据纵向占比 ≥ 阈值；
 * 2. **击杀线不贴边也不出界**：100% 在域内且离上界有距离（除非数据本身超过 100）；
 * 3. **不许丢点**：所有 ratio ≤ yMax、所有 cost ≤ xMax（这条错了就是静默裁掉数据）；
 * 4. **压缩只在需要时**：跨度接近的道不压（breaks 为空）、纯线性；
 * 5. **压了必须可读**：breaks 非空 ⇒ 页面画断口；且投影**严格单增**（x 大 ⇒ 位置不小）；
 * 6. **有数据的地方不压**：压缩只吃掉空白段，点与点的相对顺序不变。
 *
 * ## 负控（改这些会红）
 *
 * - 把 y 上界的下限改回 150（常量）⇒ 用例 ① / ② 红；
 * - 让 yMax 不覆盖击杀线（keepKillLine:false 时仍断言 100 在域内）⇒ 用例 ③ 红；
 * - 让 project 在空白段的**有数据侧**打折（压到点上）⇒ 用例 ⑥ 红；
 * - 无条件压缩（不看 laneSpanShare）⇒ 用例 ④ 红。
 */
import { describe, expect, it } from 'vitest'
import { planCurveViewport, planXDomain, planYDomain, type LaneXRange } from '@/composables/curveViewport'

describe('planYDomain（Y 轴贴合数据）', () => {
  it('① 上下不浪费：数据 25~53% ⇒ 上界贴合数据（75），击杀线如实记为「在画面之上」', () => {
    const y = planYDomain([25, 38, 44, 53])
    // 上界贴数据（53 ⇒ 75），不再为了容纳击杀线硬抬到 100/150
    expect(y.max).toBe(75)
    expect(y.min).toBe(0)
    expect(y.anchorsAbove, '击杀线 100% 在域外就必须报出来，否则没人知道它去哪了').toEqual([100])
    const occupancy = (53 - 25) / (y.max - y.min)
    expect(occupancy, `纵向占比 ${(occupancy * 100).toFixed(0)}% 太低 ⇒ 上方仍是大片空白`).toBeGreaterThan(0.35)
    // 反空洞：旧口径（上界 150）只有 28/150 = 18.7%；与旧口径拉开一倍以上
    expect(occupancy).toBeGreaterThan(2 * (19 / 150))
  })

  it('①′ 旧口径仍可选（killLineInDomain）——但要付出「数据被压扁」的代价', () => {
    const y = planYDomain([25, 38, 44, 53], { killLineInDomain: true })
    expect(y.max).toBe(100)
    expect(y.anchorsAbove).toEqual([])
    const occupancy = (53 - 25) / (y.max - y.min)
    expect(occupancy, '这就是用户报的「上下浪费」：数据只占 28%').toBeLessThan(0.3)
  })

  it('② 数据超过击杀线 ⇒ 上界跟数据走（不把超过 100 的点切掉）', () => {
    const y = planYDomain([120, 180, 240])
    expect(y.max).toBeGreaterThanOrEqual(240)
    expect(y.max % 50).toBe(0)
    for (const v of [120, 180, 240]) expect(v).toBeLessThanOrEqual(y.max)
  })

  it('③ 击杀线**要么在域内、要么在 anchorsAbove 里**——不许静默消失', () => {
    for (const data of [[10], [25, 53], [90, 99], [120, 240]]) {
      const y = planYDomain(data)
      const inDomain = y.max >= 100
      const declared = y.anchorsAbove.includes(100)
      expect(inDomain || declared, `data=${JSON.stringify(data)} 把 100% 击杀线弄丢了`).toBe(true)
      // 二选一，不能既在域内又报「在域上」
      if (inDomain) expect(y.anchorsAbove).not.toContain(100)
    }
    // 空数据也不许出现 0 宽域（除零会画出 NaN）
    const empty = planYDomain([])
    expect(empty.max).toBeGreaterThan(0)
    expect(empty.ticks.length).toBeGreaterThan(1)
    expect(empty.anchorsAbove).toEqual([100])
  })

  it('④ 刻度整齐且覆盖到上界（页面直接 map 画网格）', () => {
    const y = planYDomain([25, 53])
    expect(y.ticks[0]).toBe(0)
    expect(y.ticks[y.ticks.length - 1]).toBe(y.max)
    expect(y.ticks.length).toBeLessThanOrEqual(7)
    // 等距
    const step = y.ticks[1]! - y.ticks[0]!
    for (let i = 2; i < y.ticks.length; i++) expect(y.ticks[i]! - y.ticks[i - 1]!).toBeCloseTo(step, 6)
  })
})

describe('planXDomain（X 轴压缩空白）', () => {
  const wideLane: LaneXRange[] = [{ laneKey: 'a', min: 0, max: 100 }]

  it('① 跨度小 ⇒ 纯线性、无断口（不制造噪音）', () => {
    const x = planXDomain([0, 1, 2, 3], { laneRanges: [{ laneKey: 'a', min: 0, max: 3 }] })
    expect(x.breaks).toEqual([])
    expect(x.project(0)).toBeCloseTo(0, 9)
    expect(x.project(1.5)).toBeCloseTo(0.5, 9)
    expect(x.project(3)).toBeCloseTo(1, 9)
  })

  it('② 跨度大且有空白段 ⇒ 压掉空白并报断口', () => {
    // 一条道 0→100，但点只落在 0~10 与 95~100 两簇（中间 85 点空白）
    const values = [0, 2, 4, 6, 8, 10, 95, 97, 99, 100]
    const x = planXDomain(values, { laneRanges: wideLane })
    expect(x.breaks.length, '大空白没被压 ⇒ 中间仍是横线').toBeGreaterThan(0)
    expect(x.breaks[0]!.from).toBe(10)
    expect(x.breaks[0]!.to).toBe(95)
    // 压缩后：原本 10/100 = 10% 的位置仍是 10% 附近；100 仍在最右
    expect(x.project(100)).toBeCloseTo(1, 9)
    expect(x.project(0)).toBeCloseTo(0, 9)
    // 关键：95 与 100 之间**没被拉得太开**（有数据的地方不压，但也不该比原来更宽）
    // 压缩后相邻点间距应 ≥ 线性间距（"有数据的地方"被放大），且不至于夸张到半张图
    const w95 = x.project(100) - x.project(95)
    expect(w95).toBeGreaterThan(5 / 100)
    expect(w95, `相邻 5 点占 ${(w95 * 100).toFixed(0)}% 横向，太宽`).toBeLessThan(0.35)
  })

  it('③ 跨度大但点均匀铺开 ⇒ 不压（压了也没用，只制造断口噪音）', () => {
    const values = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]
    const x = planXDomain(values, { laneRanges: wideLane })
    expect(x.breaks).toEqual([])
  })

  it('④ 跨度大但没有道占大头 ⇒ 不压（laneSpanShare 闸门）', () => {
    const values = [0, 40, 80]
    const lanes: LaneXRange[] = [
      { laneKey: 'a', min: 0, max: 20 },
      { laneKey: 'b', min: 60, max: 80 },
    ]
    const x = planXDomain(values, { laneRanges: lanes })
    expect(x.breaks).toEqual([])
  })

  it('⑤ 投影严格单增（x 大 ⇒ 位置不小）且值域封闭', () => {
    const values = [0, 2, 4, 6, 8, 10, 95, 97, 99, 100]
    const x = planXDomain(values, { laneRanges: wideLane })
    let prev = -1
    for (let v = 0; v <= 100; v += 0.5) {
      const p = x.project(v)
      expect(p).toBeGreaterThanOrEqual(prev - 1e-12)
      expect(p).toBeGreaterThanOrEqual(0)
      expect(p).toBeLessThanOrEqual(1)
      prev = p
    }
    // 越界输入夹住而不是溢出
    expect(x.project(-5)).toBe(0)
    expect(x.project(999)).toBe(1)
  })

  it('⑥ 有数据的地方不压：点与点之间的相对顺序与线性一致', () => {
    const values = [0, 2, 4, 6, 8, 10, 95, 97, 99, 100]
    const x = planXDomain(values, { laneRanges: wideLane })
    const lin = (v: number) => v / 100
    // 同一簇内（0~10）的顺序与线性比例一致
    expect(x.project(10)).toBeGreaterThan(x.project(8))
    expect(x.project(8) - x.project(6)).toBeCloseTo(x.project(4) - x.project(2), 6)
    // 簇内宽度 = 线性宽度 × (100 / 压缩后跨度)
    const ratio = x.project(10) - x.project(0)
    expect(ratio).toBeGreaterThan(lin(10))
  })
})

describe('planCurveViewport（唯一入口）', () => {
  it('① 组合两轴并报越界（越界 = 实现 bug，页面应报警而不是静默裁点）', () => {
    const plan = planCurveViewport({
      ratios: [25, 53],
      costs: [0, 4, 100],
      laneRanges: [{ laneKey: 'a', min: 0, max: 100 }],
    })
    expect(plan.y.max).toBe(75)          // 贴合数据（53 ⇒ 75），不再硬抬到 100
    expect(plan.y.anchorsAbove).toEqual([100])
    expect(plan.x.max).toBe(100)
    expect(plan.outOfDomain).toEqual([])
  })

  it('② 反空洞：数据贴近上界时越界清单为空，而把上界改小就会被抓到', () => {
    const plan = planCurveViewport({ ratios: [99.6], costs: [1] })
    expect(plan.outOfDomain).toEqual([])
    expect(plan.y.max).toBeGreaterThanOrEqual(99.6)
  })
})
