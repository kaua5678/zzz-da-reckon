/**
 * 自由对比 · 视图/差值纯函数测试
 *
 * 判据（AGENTS 规则 9）：差值的方向、缺失值、基准隐藏后的行为都会让图**静默读错**，
 * 所以每条断言都针对一个真实错读，不是复读实现。
 */
import { describe, expect, it } from 'vitest'
import type { FreeCompareResult, FreeCompareSeries, FreeCompareSlice } from '@/composables/freeCompare/engine'
import {
  availableViews,
  baselineOptionsOf,
  defaultBaselineId,
  deltaPanelsOf,
  fallbackView,
  formatDeltaPercent,
  selectedSliceOf,
  seriesItemsOf,
} from '@/composables/freeCompare/views'

const series = (id: string, label: string, values: Array<number | null>): FreeCompareSeries => ({
  id,
  baseId: id,
  label,
  buffTitle: null,
  values,
  skipped: 0,
})

const slice = (id: string, label: string, items: FreeCompareSeries[]): FreeCompareSlice => ({
  id,
  label,
  series: items,
})

const result = (): FreeCompareResult => ({
  axisId: 'setupCode',
  axisLabel: '配置码',
  levels: [{ x: 0, label: '01', override: {} }, { x: 1, label: '21', override: {} }],
  series: [series('a', 'A', [100, 200]), series('b', 'B', [120, null])],
  slices: [
    slice('s0', '0命', [series('a', 'A', [100, 200]), series('b', 'B', [120, null])]),
    slice('s1', '1命', [series('a', 'A', [110, 220]), series('b', 'B', [132, 240])]),
  ],
  sliceLabel: '影画',
  metricId: 'teamTotalDamage',
  metricLabel: '队伍总伤',
  durationMs: 1,
  evaluations: 8,
  skipped: 0,
  pickEvaluations: 0,
  environmentSummary: 'test',
})

describe('视图可用性（无切片时不重复展示折线）', () => {
  it('单切片隐藏 切片/3D，保留 表格/折线/差值', () => {
    expect(availableViews(1)).toEqual(['table', 'long', 'line', 'delta'])
    expect(availableViews(2)).toEqual(['table', 'long', 'line', 'grid', '3d', 'delta'])
  })

  it('当前视角失效时回落折线；仍可用则不动', () => {
    expect(fallbackView('grid', 1)).toBe('line')
    expect(fallbackView('3d', 1)).toBe('line')
    expect(fallbackView('delta', 1)).toBe('delta')
    expect(fallbackView('grid', 2)).toBe('grid')
    expect(fallbackView('long', 1)).toBe('long')
  })
})

describe('当前切片', () => {
  it('按 id 命中；id 失效回落第一片；空结果 null', () => {
    expect(selectedSliceOf(result(), 's1')?.label).toBe('1命')
    expect(selectedSliceOf(result(), 'missing')?.label).toBe('0命')
    expect(selectedSliceOf(null, 's0')).toBeNull()
  })

  it('图例项/基准候选来自第一片，基准默认第一项', () => {
    expect(seriesItemsOf(result()).map(s => s.id)).toEqual(['a', 'b'])
    expect(baselineOptionsOf(result()).map(s => s.value)).toEqual(['a', 'b'])
    expect(defaultBaselineId(result())).toBe('a')
    expect(defaultBaselineId(null)).toBe('')
  })
})

describe('差值（相对基准，%）', () => {
  it('逐片逐档算 (v-b)/|b|；基准 0 / 空值 / 基准缺失均为 null（断线，不落到 0）', () => {
    const panels = deltaPanelsOf(result(), 'a')
    expect(panels.map(p => p.label)).toEqual(['0命', '1命'])
    expect(panels[0].series.find(s => s.id === 'b')?.values).toEqual([20, null])
    expect(panels[0].series.find(s => s.id === 'a')?.values).toEqual([0, 0])
    expect(panels[1].series.find(s => s.id === 'b')?.values).toEqual([20, (240 - 220) / 220 * 100])
  })

  it('★ 基准为 0 / 基准系列缺失：该点 null，不把除零变成 Infinity 或 0', () => {
    const zeroBase: FreeCompareResult = {
      ...result(),
      slices: [slice('s0', '0命', [series('a', 'A', [0, null]), series('b', 'B', [10, 20])])],
    }
    const p0 = deltaPanelsOf(zeroBase, 'a')
    expect(p0[0].series.find(s => s.id === 'b')?.values).toEqual([null, null])
    const missing = deltaPanelsOf(zeroBase, 'nope')
    expect(missing[0].series.every(s => s.values.every(v => v === null))).toBe(true)
  })

  it('★ 图例隐藏基准：基准仍按未过滤系列查（隐藏基准线不该让差值变 NaN）', () => {
    const panels = deltaPanelsOf(result(), 'a', new Set(['b']))
    expect(panels[0].series.map(s => s.id)).toEqual(['b'])
    expect(panels[0].series[0].values).toEqual([20, null])
  })

  it('格式：始终一位小数 + %，0 也带符号', () => {
    expect(formatDeltaPercent(0)).toBe('0.0%')
    expect(formatDeltaPercent(12.345)).toBe('12.3%')
    expect(formatDeltaPercent(-3.21)).toBe('-3.2%')
  })
})
