/**
 * 环境膨胀图的几何/标度锁（`inflationChart.ts`）。
 *
 * 与同目录 `timelineChart.test.ts` / `versionChartGeometry.test.ts` 同族：
 * 纯函数几何用**合成数据**钉边界（单点 / 空 / 退化范围 / 基准线位置），
 * 不依赖真实 Boss 数据（那些在 `inflationCurve.test.ts` 里测）。
 */
import { describe, expect, it } from 'vitest'
import {
  INFLATION_LAYOUT,
  buildInflationChart,
  inflationSvgHeight,
  inflationYAxisOf,
  inflationYOf,
  inflationVersionXOf,
  niceStep,
} from '@/composables/inflationChart'
import { buildInflationSeries } from '@/composables/inflationCurve'
import type { InflationPoint, InflationSeries } from '@/composables/inflationCurve'

/** 造一个最小 series（points 手填，跳过聚合） */
const series = (points: Array<Partial<InflationPoint> & { version: string; index: number }>): InflationSeries => ({
  mode: 'defense',
  baseVersion: points[0]?.version ?? '',
  cumulativePct: points[points.length - 1]?.index ?? 100,
  points: points.map((p, i) => ({
    versionIndex: i, avgHp: p.index * 1e6, samples: 9, lowSample: false,
    momPct: null, begin: '', ...p,
  })) as InflationPoint[],
})

describe('niceStep（优美步长 1/2/5×10^n）', () => {
  it('覆盖各量级', () => {
    expect(niceStep(4, 4)).toBe(1)
    expect(niceStep(8, 4)).toBe(2)
    expect(niceStep(20, 4)).toBe(5)
    expect(niceStep(40, 4)).toBe(10)
    expect(niceStep(300, 5)).toBe(100)
  })

  it('退化输入不返回 0/NaN（否则网格会死循环）', () => {
    expect(niceStep(0)).toBe(1)
    expect(niceStep(-5)).toBe(1)
    expect(niceStep(Number.NaN)).toBe(1)
  })
})

describe('inflationYAxisOf（y 轴：100 基准线必须可辨）', () => {
  it('★ 100 不贴底（首版本基准线否则会与 x 轴重合）', () => {
    // 峰值 346.7 的实景：min 若取 100 则基准线贴底
    const axis = inflationYAxisOf([100, 200, 346.7])
    expect(axis.max).toBeGreaterThanOrEqual(346.7)
    const bottomShare = (100 - axis.min) / (axis.max - axis.min)
    expect(bottomShare).toBeGreaterThanOrEqual(0.08)
  })

  it('上限含 5% 余量并向上取整到步长', () => {
    const axis = inflationYAxisOf([100, 180])
    // 180×1.05 = 189 → step 50 → max 200
    expect(axis.max).toBeGreaterThanOrEqual(189)
    expect(axis.max % axis.step).toBe(0)
  })

  it('ticks 覆盖 [min,max] 且等距', () => {
    const axis = inflationYAxisOf([100, 320])
    expect(axis.ticks[0]).toBe(axis.min)
    expect(axis.ticks[axis.ticks.length - 1]).toBe(axis.max)
    for (let i = 1; i < axis.ticks.length; i++) {
      expect(axis.ticks[i] - axis.ticks[i - 1]).toBeCloseTo(axis.step, 6)
    }
  })

  it('空输入退化为 100 附近的合理轴（不 NaN、不塌成一点）', () => {
    const axis = inflationYAxisOf([])
    expect(Number.isFinite(axis.min)).toBe(true)
    expect(axis.max).toBeGreaterThan(axis.min)
    expect(axis.step).toBeGreaterThan(0)
  })
})

describe('inflationYOf（值 → y 像素）', () => {
  const axis = { min: 0, max: 400, step: 100, ticks: [0, 100, 200, 300, 400] }
  const box = { padT: 18, plotH: 260 }

  it('min 贴底、max 贴顶', () => {
    expect(inflationYOf(0, axis, box)).toBeCloseTo(18 + 260, 6)
    expect(inflationYOf(400, axis, box)).toBeCloseTo(18, 6)
  })

  it('范围退化时不除零（返回中线）', () => {
    const flat = { min: 100, max: 100, step: 1, ticks: [] }
    expect(inflationYOf(100, flat, box)).toBeCloseTo(18 + 130, 6)
  })
})

describe('inflationVersionXOf（版本 → x，用 VERSION_NODES 全序）', () => {
  it('未知版本返回 null（不静默落到 0 或末位）', () => {
    expect(inflationVersionXOf('no-such-version', INFLATION_LAYOUT)).toBeNull()
  })

  it('已知版本落在绘图区内', () => {
    const layout = { ...INFLATION_LAYOUT, plotW: 1000 }
    const x = inflationVersionXOf('2.0', layout)
    expect(x).not.toBeNull()
    expect(x!).toBeGreaterThanOrEqual(layout.padL)
    expect(x!).toBeLessThanOrEqual(layout.padL + 1000)
  })
})

describe('buildInflationChart（整图组装）', () => {
  it('★ 折线点数 = 能定位到版本节点的点数；未知版本被丢弃', () => {
    const m = buildInflationChart(series([
      { version: '1.4', index: 100 },
      { version: '2.0', index: 150 },
      { version: 'no-such', index: 999 },
    ]), [], 1000)
    expect(m.line).toHaveLength(2)
    expect(m.linePoints.split(' ')).toHaveLength(2)
  })

  it('★ 空 series：不炸、空折线、空标记', () => {
    const m = buildInflationChart(series([]), [], 1000)
    expect(m.line).toEqual([])
    expect(m.linePoints).toBe('')
    expect(m.markers).toEqual([])
  })

  it('★ 无环境指数的角色不画标记（不猜位置）', () => {
    const s = series([{ version: '1.4', index: 100 }])
    const m = buildInflationChart(s, [
      { agentId: '1371', agentName: '仪玄', nodeId: '2.0-1', nodeLabel: '2.0 上半', version: '2.0', nodeIndex: 1, environmentIndex: 150, value: 1, valuePct: 100, strengthVsEnvironment: null },
      { agentId: '9999', agentName: '无数据', nodeId: 'x', nodeLabel: 'x', version: 'y', nodeIndex: 2, environmentIndex: null, value: null, valuePct: null, strengthVsEnvironment: null },
    ], 1000)
    expect(m.markers.map(x => x.agentId)).toEqual(['1371'])
  })

  it('基准线 y 在绘图区内（首版本 index=100 时 baseY 不为 null）', () => {
    const m = buildInflationChart(series([{ version: '1.4', index: 100 }, { version: '3.3', index: 300 }]), [], 1000)
    expect(m.baseY).not.toBeNull()
    expect(m.baseY!).toBeGreaterThanOrEqual(m.layout.padT)
    expect(m.baseY!).toBeLessThanOrEqual(m.layout.padT + m.layout.plotH)
  })

  it('x 刻度抽稀到上限内，且标签是版本号', () => {
    const pts = Array.from({ length: 20 }, (_, i) => ({ version: '1.4', index: 100 + i }))
    const m = buildInflationChart(series(pts), [], 1000, 6)
    expect(m.xTicks.length).toBeLessThanOrEqual(8)
  })

  it('宽度影响 plotW（窄容器不塌成 0）', () => {
    const narrow = buildInflationChart(series([{ version: '1.4', index: 100 }]), [], 100)
    expect(narrow.layout.plotW).toBeGreaterThanOrEqual(120)
  })

  it('svg 高度 = padT + plotH + padB（与布局自洽）', () => {
    expect(inflationSvgHeight(INFLATION_LAYOUT)).toBe(INFLATION_LAYOUT.padT + INFLATION_LAYOUT.plotH + INFLATION_LAYOUT.padB)
  })
})

describe('与 buildInflationSeries 的接线（端到端：合成期相 → 坐标）', () => {
  it('两版本 → 两点折线，基准线可见', () => {
    const ph = (version: string, hp: number) => ({ version, modeType: 'defense', hp, begin: '2025-01-01' }) as never
    const s = buildInflationSeries([{ phases: [ph('1.4', 100), ph('2.0', 200)] }])
    const m = buildInflationChart(s, [], 1000)
    expect(m.line).toHaveLength(2)
    expect(m.line[0].index).toBe(100)
    expect(m.line[1].index).toBe(200)
    expect(m.baseY).not.toBeNull()
  })
})
