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
  levelDeltaRowsOf,
  levelOptionsOf,
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
    expect(availableViews(1, 2)).toEqual(['table', 'long', 'line', 'delta', 'step'])
    expect(availableViews(2, 2)).toEqual(['table', 'long', 'line', 'grid', '3d', 'delta', 'step'])
    // 档位不足 2 时「两档对比」结构性无意义（画出来必然与折线重复）
    expect(availableViews(1, 1)).toEqual(['table', 'long', 'line', 'delta'])
    expect(availableViews(2, 1)).toEqual(['table', 'long', 'line', 'grid', '3d', 'delta'])
  })

  it('当前视角失效时回落折线；仍可用则不动', () => {
    expect(fallbackView('grid', 1, 2)).toBe('line')
    expect(fallbackView('3d', 1, 2)).toBe('line')
    expect(fallbackView('delta', 1, 2)).toBe('delta')
    expect(fallbackView('grid', 2, 2)).toBe('grid')
    expect(fallbackView('long', 1, 2)).toBe('long')
    // 只有 1 档时「两档对比」不可用 ⇒ 回落折线（而不是留一个空表）
    expect(fallbackView('step', 1, 1)).toBe('line')
    expect(fallbackView('step', 1, 2)).toBe('step')
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

describe('两档对比（同一系列内 x=起点 vs x=终点）', () => {
  it('★ 一行一个系列：起点/终点/差值/提升% 全部给齐（用户不用再抄数字做除法）', () => {
    const rows = levelDeltaRowsOf(result(), 0, 1)
    expect(rows.map(r => r.seriesId)).toEqual(['a', 'b'])
    // A：100 → 200，差 +100，提升 +100%
    expect(rows[0]).toMatchObject({ fromValue: 100, toValue: 200, delta: 100, pct: 100 })
    // B：120 → null ⇒ 差值与百分比都 null（不是 0、不是 Infinity）
    expect(rows[1]).toMatchObject({ fromValue: 120, toValue: null, delta: null, pct: null })
  })

  it('★ 分母取 |起点|：起点为负也不能把方向拧反', () => {
    const r: FreeCompareResult = { ...result(), series: [series('neg', '负值', [-100, -50])] }
    const [row] = levelDeltaRowsOf(r, 0, 1)
    // (−50 − (−100)) / |−100| = +50%（变大了就是正的，与实际方向一致）
    expect(row!.delta).toBe(50)
    expect(row!.pct).toBe(50)
  })

  it('★ 起点 0 / 越界 / 起点=终点 ⇒ 该行 null（不落成 Infinity，也不回落到相邻档）', () => {
    const zero: FreeCompareResult = { ...result(), series: [series('z', 'Z', [0, 100])] }
    expect(levelDeltaRowsOf(zero, 0, 1)[0]).toMatchObject({ delta: 100, pct: null }) // 绝对差仍可读
    const oob = levelDeltaRowsOf(result(), 0, 9)
    expect(oob.every(r => r.fromValue === null && r.toValue === null && r.delta === null && r.pct === null)).toBe(true)
    const same = levelDeltaRowsOf(result(), 1, 1)
    expect(same.every(r => r.delta === null)).toBe(true)
  })

  it('档位候选 = 轴档位名（30 / 11 / 精3 这类），下标即选择值', () => {
    expect(levelOptionsOf(result())).toEqual([{ value: 0, label: '01' }, { value: 1, label: '21' }])
    expect(levelOptionsOf(null)).toEqual([])
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
