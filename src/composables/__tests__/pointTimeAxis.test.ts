/**
 * 散点「第三轴 = 主C首池时间」的编码锁（`pointTimeAxis.ts`）。
 *
 * 覆盖：时间查询 / 等宽分档 / 档归属边界 / 颜色与半径映射 / 未收录点的诚实处理 / 图例。
 * 边界是重点：末档必须含右端点（否则最新角色落到档外）、单档场景不能除零、
 * 未收录点**不参与**分档范围（否则会把 min/max 拉偏）。
 */
import { describe, expect, it } from 'vitest'
import {
  TIME_BUCKET_COLORS,
  TIME_BUCKET_COUNT,
  TIME_UNKNOWN_COLOR,
  bucketIndexOf,
  buildTimeBuckets,
  encodePointTimes,
  releaseTimeOfMain,
  shortDate,
  timeLegendRows,
} from '@/composables/pointTimeAxis'
import { AGENT_RELEASE_NODE } from '@/data/versionTimeline'

const D = (s: string) => Date.parse(s)

describe('releaseTimeOfMain（主C → 首池时间）', () => {
  it('★ 已知角色返回节点/日期（与 AGENT_RELEASE_NODE 同源）', () => {
    const r = releaseTimeOfMain('1371')   // 仪玄 2.0 上半
    expect(r).not.toBeNull()
    expect(r!.nodeId).toBe('2.0-1')
    expect(r!.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(Number.isFinite(r!.ts)).toBe(true)
  })

  it('★ 未收录角色返回 null（不猜时间）', () => {
    expect(releaseTimeOfMain('999999')).toBeNull()
    expect(releaseTimeOfMain('')).toBeNull()
  })

  it('表里每个角色都能解析出日期（防 AGENT_RELEASE_NODE 与 VERSION_NODES 漂移）', () => {
    for (const [id, nodeId] of Object.entries(AGENT_RELEASE_NODE)) {
      const r = releaseTimeOfMain(id)
      expect(r, `${id} → ${nodeId} 应可解析`).not.toBeNull()
      expect(r!.nodeId).toBe(nodeId)
    }
  })
})

describe('buildTimeBuckets（等宽分档）', () => {
  it('★ 等宽切 4 档，首档含 min、末档含 max（右端闭）', () => {
    const buckets = buildTimeBuckets([D('2024-01-01'), D('2024-12-31')])
    expect(buckets).toHaveLength(TIME_BUCKET_COUNT)
    expect(buckets[0].from).toBe(D('2024-01-01'))
    expect(buckets[TIME_BUCKET_COUNT - 1].to).toBe(D('2024-12-31'))
    // 相邻档首尾相接（不留缝）
    for (let i = 1; i < buckets.length; i++) expect(buckets[i].from).toBe(buckets[i - 1].to)
  })

  it('★ 全部同一时间 → 1 档（避免除零与四档同值）', () => {
    const t = D('2025-01-01')
    const buckets = buildTimeBuckets([t, t, t])
    expect(buckets).toHaveLength(1)
    expect(buckets[0].from).toBe(t)
    expect(buckets[0].to).toBe(t)
  })

  it('空输入 → 空数组（不炸）', () => {
    expect(buildTimeBuckets([])).toEqual([])
  })

  it('非有限时间戳被过滤（NaN 不参与 min/max）', () => {
    const buckets = buildTimeBuckets([Number.NaN, D('2024-01-01'), D('2024-12-31'), Number.POSITIVE_INFINITY])
    expect(buckets).toHaveLength(TIME_BUCKET_COUNT)
    expect(buckets[0].from).toBe(D('2024-01-01'))
  })

  it('颜色与档序号一一对应（冷 → 暖）', () => {
    const buckets = buildTimeBuckets([D('2024-01-01'), D('2026-01-01')])
    expect(buckets.map(b => b.color)).toEqual(TIME_BUCKET_COLORS.slice(0, TIME_BUCKET_COUNT))
  })
})

describe('bucketIndexOf（档归属边界）', () => {
  const buckets = buildTimeBuckets([D('2024-01-01'), D('2024-12-31')])

  it('★ 最大值落在末档（右端闭）', () => {
    expect(bucketIndexOf(D('2024-12-31'), buckets)).toBe(TIME_BUCKET_COUNT - 1)
  })

  it('★ 最小值落在首档', () => {
    expect(bucketIndexOf(D('2024-01-01'), buckets)).toBe(0)
  })

  it('★ 相邻档的分界点归入后一档（左闭右开），不留空档', () => {
    for (let i = 1; i < buckets.length; i++) {
      expect(bucketIndexOf(buckets[i].from, buckets)).toBe(i)
    }
  })

  it('无档 / 非法时间 → -1（调用方据此用中性色）', () => {
    expect(bucketIndexOf(D('2024-06-01'), [])).toBe(-1)
    expect(bucketIndexOf(Number.NaN, buckets)).toBe(-1)
  })

  it('超出范围的时间钳到最近档（数据更新后旧代码不崩）', () => {
    expect(bucketIndexOf(D('2020-01-01'), buckets)).toBe(0)
    expect(bucketIndexOf(D('2030-01-01'), buckets)).toBe(TIME_BUCKET_COUNT - 1)
  })
})

describe('encodePointTimes（批量编码）', () => {
  it('★ 真实主C批量：分档范围只由已知时间的点决定，未知不参与', () => {
    const enc = encodePointTimes(['1371', '999999', '1191'])
    expect(enc.unknownCount).toBe(1)
    const unknown = enc.byIndex[1]
    expect(unknown.release).toBeNull()
    expect(unknown.bucketIndex).toBe(-1)
    expect(unknown.color).toBe(TIME_UNKNOWN_COLOR)
    expect(unknown.radiusBonus).toBe(0)
    // 1371(2.0) 与 1191(1.0) 都在已知集合里 ⇒ 范围由它们决定
    expect(enc.buckets.length).toBeGreaterThan(0)
    expect(enc.byIndex[0].bucketIndex).toBeGreaterThan(enc.byIndex[2].bucketIndex)
  })

  it('★ 越新的角色点越大（radiusBonus 单调不减）', () => {
    const enc = encodePointTimes(['1191', '1371', '1591'])   // 1.0 / 2.0 / 3.1
    const rs = enc.byIndex.map(e => e.radiusBonus)
    expect(rs[0]).toBeLessThanOrEqual(rs[1])
    expect(rs[1]).toBeLessThanOrEqual(rs[2])
    expect(rs[2]).toBeGreaterThan(0)
  })

  it('全部未收录：无档、全中性色（不产生空图例档）', () => {
    const enc = encodePointTimes(['bad1', 'bad2'])
    expect(enc.buckets).toEqual([])
    expect(enc.byIndex.every(e => e.color === TIME_UNKNOWN_COLOR)).toBe(true)
    expect(enc.unknownCount).toBe(2)
  })

  it('同一时间多点：单档且半径不加成（不全体变大）', () => {
    const enc = encodePointTimes(['1191', '1191'])
    expect(enc.buckets).toHaveLength(1)
    expect(enc.byIndex.every(e => e.radiusBonus === 0)).toBe(true)
  })
})

describe('timeLegendRows（图例）', () => {
  it('★ 未收录 > 0 时补一条中性色条目，并说明为什么不参与着色', () => {
    const rows = timeLegendRows(buildTimeBuckets([D('2024-01-01'), D('2026-01-01')]), 2)
    expect(rows).toHaveLength(TIME_BUCKET_COUNT + 1)
    const last = rows[rows.length - 1]
    expect(last.color).toBe(TIME_UNKNOWN_COLOR)
    expect(last.count).toBe(2)
    expect(last.title).toContain('不参与时间着色')
  })

  it('无未收录时不补条目', () => {
    expect(timeLegendRows(buildTimeBuckets([D('2024-01-01'), D('2026-01-01')]), 0)).toHaveLength(TIME_BUCKET_COUNT)
  })

  it('namesOf 注入的队名进 title 与 count', () => {
    const rows = timeLegendRows(buildTimeBuckets([D('2024-01-01'), D('2026-01-01')]), 0, i => (i === 0 ? ['A队', 'B队'] : []))
    expect(rows[0].count).toBe(2)
    expect(rows[0].title).toBe('A队 / B队')
    expect(rows[1].title).toBe('（本批无此档队伍）')
  })

  it('空档 + 无未收录 → 空图例', () => {
    expect(timeLegendRows([], 0)).toEqual([])
  })
})

describe('shortDate（短标签）', () => {
  it('YY.MM 格式（补零）', () => {
    expect(shortDate(D('2024-07-04'))).toBe('24.07')
    expect(shortDate(D('2026-12-31'))).toBe('26.12')
  })

  it('非法输入返回占位符（不抛错）', () => {
    expect(shortDate(Number.NaN)).toBe('—')
  })
})
