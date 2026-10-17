import { describe, expect, it } from 'vitest'
import {
  datasetCsv,
  datasetFromBossInflation,
  datasetFromFreeCompare,
  datasetFromTeamGold,
  datasetFromTimeline,
  resultFromDataset,
  type FreeCompareDatasetInput,
} from '@/composables/analysis/dataset'

const input: FreeCompareDatasetInput = {
  axisLabel: '命座',
  sliceLabel: '影画',
  metricId: 'teamTotalDamage',
  metricLabel: '队伍总伤',
  levels: [
    { x: 0, label: '0命', override: {} },
    { x: 1, label: '1命', override: {} },
  ],
  slices: [
    {
      id: 's0',
      label: '0影',
      series: [
        { id: 'a', baseId: 'a', label: 'A', buffTitle: null, values: [100, null], skipped: 0 },
        { id: 'b', baseId: 'b', label: 'B', buffTitle: null, values: [120, 150], skipped: 0 },
      ],
    },
    {
      id: 's1',
      label: '1影',
      series: [
        { id: 'a', baseId: 'a', label: 'A', buffTitle: '牌', values: [110, 210], skipped: 0 },
        { id: 'b', baseId: 'b', label: 'B', buffTitle: null, values: [130, 160], skipped: 0 },
      ],
    },
  ],
}

describe('自由对比 → 长表', () => {
  it('x 档位 → 切片 → 系列逐个摊平；缺失读数保留 null（不填 0）', () => {
    const ds = datasetFromFreeCompare(input)
    expect(ds.rows).toHaveLength(8)
    expect(ds.xLabel).toBe('命座')
    expect(ds.sliceLabel).toBe('影画')
    expect(ds.measure).toEqual({ id: 'teamTotalDamage', label: '队伍总伤' })
    expect(ds.rows[0]).toMatchObject({ x: 0, xLabel: '0命', sliceId: 's0', sliceLabel: '0影', seriesId: 'a', value: 100 })
    expect(ds.rows[4]).toMatchObject({ x: 1, sliceId: 's0', seriesId: 'a', value: null })
    expect(ds.rows[7]).toMatchObject({ x: 1, sliceId: 's1', seriesId: 'b', value: 160 })
    expect(ds.rows.find(r => r.buffTitle === '牌')?.seriesId).toBe('a')
  })

  it('无切片：sliceLabel=null、行仍可摊平，CSV 显示「全部」', () => {
    const ds = datasetFromFreeCompare({
      ...input,
      sliceLabel: null,
      slices: [{ id: '', label: '', series: input.slices[0].series }],
      levels: [input.levels[0]],
    })
    expect(ds.sliceLabel).toBeNull()
    expect(ds.rows).toHaveLength(2)
    const csv = datasetCsv(ds)
    expect(csv).toContain('0,0命,全部,A,100')
  })

  it('CSV：BOM + CRLF、空值留空、逗号/引号按 RFC 4180 转义', () => {
    const ds = datasetFromFreeCompare({
      ...input,
      levels: [input.levels[0], input.levels[1]],
      slices: [{
        id: 's',
        label: '影,画',
        series: [{ id: 'a', baseId: 'a', label: 'A "q"', buffTitle: null, values: [1, null], skipped: 0 }],
      }],
    })
    const csv = datasetCsv(ds)
    expect(csv.startsWith('\ufeff')).toBe(true)
    expect(csv.endsWith('\r\n')).toBe(true)
    expect(csv).toContain('"影,画"')
    expect(csv).toContain('"A ""q"""')
    expect(csv).toContain('1,1命,"影,画","A ""q""",')
    expect(csv).not.toContain('NaN')
  })
})

describe('跨页结果 → 长表 → 合成结果', () => {
  it('队伍加金：一行一个队伍×金数，合成结果对齐 x/系列', () => {
    const ds = datasetFromTeamGold([
      { presetId: 'p1', presetName: 'A队', goldCount: 0, damage: 100, hpRatio: 100 },
      { presetId: 'p1', presetName: 'A队', goldCount: 1, damage: 120, hpRatio: 110 },
      { presetId: 'p2', presetName: 'B队', goldCount: 0, damage: 90, hpRatio: 90 },
      { presetId: 'p2', presetName: 'B队', goldCount: 1, damage: 105, hpRatio: 95 },
    ], { metric: 'damage' })
    expect(ds.rows).toHaveLength(4)
    expect(ds.rows.map(r => r.xLabel)).toEqual(['0金', '0金', '1金', '1金'])
    expect(ds.measure).toMatchObject({ id: 'teamGoldDamage', label: '队伍加金伤害' })
    const res = resultFromDataset(ds)
    expect(res.levels.map(l => l.label)).toEqual(['0金', '1金'])
    expect(res.series.map(s => s.id)).toEqual(['p1', 'p2'])
    expect(res.series[0].values).toEqual([100, 120])
    expect(res.series[1].values).toEqual([90, 105])
    expect(res.slices).toHaveLength(1)
    expect(res.evaluations).toBe(0)
  })

  it('时间图表：主C 包络线跨期；队伍组合不拆成互不连续的多条线', () => {
    const ds = datasetFromTimeline({
      mainAgentId: 'main',
      mainName: '仪玄',
      nodes: [
        { nodeLabel: '2.0', damage: 10, hpRatio: 20 },
        { nodeLabel: '2.1', damage: 12, hpRatio: 24 },
      ],
    }, { metric: 'damage' })
    expect(ds.rows.map(r => r.seriesLabel)).toEqual(['仪玄', '仪玄'])
    const res = resultFromDataset(ds)
    expect(res.series).toHaveLength(1)
    expect(res.series[0].values).toEqual([10, 12])
    expect(res.levels.map(l => l.label)).toEqual(['2.0', '2.1'])
  })

  it('血量膨胀：Boss 系列 × 期数；合成结果保留缺失组合为 null', () => {
    const ds = datasetFromBossInflation([
      { id: 'b1', name: 'Boss甲', points: [{ seasonIdx: 0, coeff: 100 }, { seasonIdx: 1, coeff: 120 }] },
      { id: 'b2', name: 'Boss乙', points: [{ seasonIdx: 0, coeff: 90 }] },
    ], { seasonLabel: i => 'S' + i })
    expect(ds.rows).toHaveLength(3)
    const res = resultFromDataset(ds)
    expect(res.series.map(s => s.id)).toEqual(['b1', 'b2'])
    expect(res.series[1].values).toEqual([90, null])
    expect(res.series[1].skipped).toBe(1)
  })

  it('往返：合成结果再摊平，行与原始长表一致', () => {
    const ds = datasetFromTeamGold([
      { presetId: 'p1', presetName: 'A队', goldCount: 0, damage: 100, hpRatio: 100 },
      { presetId: 'p1', presetName: 'A队', goldCount: 1, damage: 120, hpRatio: 110 },
    ], { metric: 'hpRatio' })
    const round = datasetFromFreeCompare(resultFromDataset(ds))
    expect(round.rows).toEqual(ds.rows)
    expect(round.measure.id).toBe(ds.measure.id)
    expect(round.measure.label).toBe(ds.measure.label)
  })
})
