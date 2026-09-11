/**
 * 版本轴两张图的几何/标度（评审 #14 第三刀，从 TimeChartsPage.vue 抽出）。
 *
 * 覆盖 Chart 3（每期新角色·强队强度）与 Chart 7（同槽位对比）以及两图**共享的版本轴**。
 * 这些读数此前埋在 3148 行页面里，且 Chart 3/7 需要「跑搜索」才能看到——抽出后用合成数据
 * 即可钉住边界：单节点居中、版本轴抽稀、Chart3 纵轴两档、Chart7 的优美步长与退化范围、
 * 两图散点错开间距刻意不同（7px vs 14px）。
 */
import { describe, expect, it } from 'vitest'
import {
  buildChart3Scatter,
  buildScPts,
  chart3YGridOf,
  chart3YLabelOf,
  chart3YMaxOf,
  chart3YOf,
  chart3YStepOf,
  linePointsOf,
  niceStep,
  scGridStartOf,
  scYGridOf,
  scYLabelOf,
  scYOf,
  scYRangeOf,
  scYStepOf,
  versionXOf,
  versionXTicksOf,
} from '@/composables/versionChartGeometry'
import type { VersionNode } from '@/data/versionTimeline'

const BOX = { padT: 26, plotH: 300 }
const vn = (label: string): VersionNode => ({ id: label, version: label, phaseLabel: '上半', label } as unknown as VersionNode)

describe('共享版本轴', () => {
  it('versionXOf：多节点首末贴两端；单节点居中', () => {
    expect(versionXOf(0, 3, 54, 900)).toBe(54)
    expect(versionXOf(2, 3, 54, 900)).toBe(954)
    expect(versionXOf(1, 3, 54, 900)).toBe(504)
    expect(versionXOf(0, 1, 54, 900)).toBe(54 + 450)
    expect(versionXOf(0, 0, 54, 900)).toBe(54 + 450)
  })

  it('versionXTicksOf：按 maxTicks 抽稀，索引与标签一一对应', () => {
    const nodes = Array.from({ length: 40 }, (_, i) => vn(`v${i}`))
    const ticks = versionXTicksOf(nodes, 16)
    expect(ticks.length).toBeLessThanOrEqual(16)
    expect(ticks[0]).toEqual({ index: 0, label: 'v0' })
    for (const t of ticks) expect(t.label).toBe(`v${t.index}`)
    // 节点少时不抽稀
    expect(versionXTicksOf([vn('a'), vn('b')], 16).map(t => t.label)).toEqual(['a', 'b'])
  })
})

describe('Chart 3 纵轴（0 起、50/100 两档）', () => {
  it('峰值 <100 → 100；150 → 200；300 → 400', () => {
    expect(chart3YMaxOf([42])).toBe(100)
    expect(chart3YMaxOf([150])).toBe(200)
    expect(chart3YMaxOf([300])).toBe(400)
    expect(chart3YMaxOf([])).toBe(100)
  })

  it('步长与刻度、标签一致', () => {
    expect(chart3YStepOf(200)).toBe(50)
    expect(chart3YStepOf(300)).toBe(100)
    expect(chart3YGridOf(100, BOX)).toHaveLength(3)          // 0/50/100
    expect(chart3YLabelOf(2, 100)).toBe(100)
    expect(chart3YGridOf(400, BOX)).toHaveLength(5)          // 0/100/200/300/400
  })

  it('chart3YOf：0 贴底、上限贴顶', () => {
    expect(chart3YOf(0, 200, BOX)).toBeCloseTo(BOX.padT + BOX.plotH, 6)
    expect(chart3YOf(200, 200, BOX)).toBeCloseTo(BOX.padT, 6)
  })
})

describe('Chart 3 散点（同节点错开 7px、字段映射）', () => {
  const pt = (i: number, nodeId: string, hp: number, teamIdx = 0) => ({
    nodeId, hpRatio: hp, team: ['A', 'B', 'C'], charName: `c${i}`, nodeLabel: nodeId,
    teamIndex: teamIdx, damage: 1000 + i, goldLabel: `${i}金`,
  })
  const input = (points: ReturnType<typeof pt>[]) => ({
    points,
    nodeIndexOf: (id: string) => Number(id),
    yMax: 200,
    box: BOX,
    padL: 54,
    plotW: 900,
    versionTotal: 20,
    colorOf: (k: string) => `color:${k}`,
    nameOf: (id: string) => `name:${id}`,
  })

  it('单点时无偏移；同节点两点对称 ±3.5px（间距 7）', () => {
    const one = buildChart3Scatter(input([pt(0, '0', 100)]))
    expect(one[0].x).toBeCloseTo(versionXOf(0, 20, 54, 900), 6)
    const two = buildChart3Scatter(input([pt(0, '5', 100), pt(1, '5', 120)]))
    const base = versionXOf(5, 20, 54, 900)
    expect(two[0].x).toBeCloseTo(base - 3.5, 6)
    expect(two[1].x).toBeCloseTo(base + 3.5, 6)
  })

  it('字段映射：颜色按队伍 key、队名数组、队号 +1、y 夹到上限', () => {
    const [r] = buildChart3Scatter(input([pt(0, '0', 999, 2)]))
    expect(r.color).toBe('color:A,B,C')
    expect(r.teamNames).toEqual(['name:A', 'name:B', 'name:C'])
    expect(r.teamNo).toBe(3)
    expect(r.y).toBeCloseTo(chart3YOf(200, 200, BOX), 6)   // min(999, 200)
  })
})

describe('Chart 7 纵轴（贴合可见伤害、±8%、优美步长）', () => {
  it('空数据 → {0,1}；退化范围 → 先撑 ±1 再留 8% 边距', () => {
    expect(scYRangeOf([])).toEqual({ min: 0, max: 1 })
    // 退化分支围绕**实际值**各撑 ±1（不是围绕 0/1），再留 8% 边距：
    // min=999,max=1001 → pad=0.16 → {998.84, 1001.16}
    const d = scYRangeOf([1000, 1000])
    expect(d.min).toBeCloseTo(1000 - 1 - 0.16, 6)
    expect(d.max).toBeCloseTo(1000 + 1 + 0.16, 6)
  })

  it('常规范围：上下各留 8% 边距', () => {
    const r = scYRangeOf([1000, 2000])
    expect(r.min).toBeCloseTo(1000 - 80, 6)
    expect(r.max).toBeCloseTo(2000 + 80, 6)
  })

  it('niceStep 取 1/2/5×10^n', () => {
    expect(niceStep(0.9)).toBe(1)
    expect(niceStep(1.5)).toBe(2)
    expect(niceStep(3)).toBe(5)
    expect(niceStep(7)).toBe(10)
    expect(niceStep(120)).toBe(200)
    expect(niceStep(0)).toBe(1)      // 防除零
  })

  it('网格与标签同源：起点上取整到步长整数倍', () => {
    const r = { min: 117, max: 1000 }
    const step = scYStepOf(r)
    const start = scGridStartOf(r, step)
    expect(start % step).toBeCloseTo(0, 6)
    expect(start).toBeGreaterThanOrEqual(r.min)
    expect(scYLabelOf(0, r, n => `f${Math.round(n)}`)).toBe(`f${Math.round(start)}`)
    expect(scYGridOf(r, BOX).length).toBeGreaterThan(0)
    expect(scYGridOf(r, BOX).every(Number.isFinite)).toBe(true)
  })

  it('scYOf：min 贴底、max 贴顶', () => {
    const r = { min: 100, max: 200 }
    expect(scYOf(100, r, BOX)).toBeCloseTo(BOX.padT + BOX.plotH, 6)
    expect(scYOf(200, r, BOX)).toBeCloseTo(BOX.padT, 6)
  })
})

describe('Chart 7 散点与折线', () => {
  const pt = (nodeId: string, a: number, b: number) => ({ nodeId, damageA: a, damageB: b })
  const opts = {
    nodeIndexOf: (id: string) => Number(id),
    range: { min: 0, max: 2000 },
    box: BOX, padL: 54, plotW: 900, versionTotal: 20,
  }

  it('同节点错开 14px（刻意与 Chart 3 的 7px 不同）；两线各自 y', () => {
    const two = buildScPts([pt('3', 1000, 1200), pt('3', 900, 1100)], opts)
    const base = versionXOf(3, 20, 54, 900)
    expect(two[0].x).toBeCloseTo(base - 7, 6)
    expect(two[1].x).toBeCloseTo(base + 7, 6)
    expect(two[0].yA).toBeCloseTo(scYOf(1000, opts.range, BOX), 6)
    expect(two[0].yB).toBeCloseTo(scYOf(1200, opts.range, BOX), 6)
  })

  it('linePointsOf 生成 "x,y" 串（空数组 → 空串）', () => {
    const pts = buildScPts([pt('0', 1000, 1000)], opts)
    expect(linePointsOf(pts, p => ({ x: p.x, y: p.yA })).split(' ')).toHaveLength(1)
    expect(linePointsOf([], (p: { x: number; y: number }) => p)).toBe('')
  })
})
