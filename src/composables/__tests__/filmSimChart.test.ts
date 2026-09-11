/**
 * Chart 4「菲林经济模拟」几何/标度（评审 #14 第四刀）。
 *
 * 该图有**两个纵轴**：主轴 = 队伍强度%（与 Chart 1/3 共享 hpRatioAxis 口径），
 * 副轴 = 总金数（独立缩放、至少 6 起）。两者口径不同，最容易在改动中互相污染，故分别钉住。
 */
import { describe, expect, it } from 'vitest'
import { buildFilmSimChart, simGoldMaxOf } from '@/composables/filmSimChart'
import { hpRatioYGridOf, hpRatioYMaxOf, hpRatioYOf } from '@/composables/hpRatioAxis'
import type { FilmSimPoint } from '@/composables/teamTimeline'

const BOX = { padT: 26, plotH: 300 }
const pt = (label: string, hpRatio: number, totalGold: number, team: string[] = ['A', 'B', 'C']): FilmSimPoint =>
  ({ label, hpRatio, totalGold, team } as unknown as FilmSimPoint)

const build = (points: FilmSimPoint[]) =>
  buildFilmSimChart({ points, svgW: 1000, padL: 54, plotW: 900, box: BOX, colorOf: k => `c:${k}` })

describe('副纵轴（金数）：独立缩放、至少 6', () => {
  it('simGoldMaxOf：空/低于 6 → 6；否则取最大值', () => {
    expect(simGoldMaxOf([])).toBe(6)
    expect(simGoldMaxOf([1, 3])).toBe(6)
    expect(simGoldMaxOf([6, 12, 9])).toBe(12)
  })

  it('金数线用副轴缩放（与主轴的百分数无关）', () => {
    const g = build([pt('a', 50, 6), pt('b', 50, 12)])
    expect(g.goldMax).toBe(12)
    expect(g.goldY(0)).toBeCloseTo(BOX.padT + BOX.plotH, 6)
    expect(g.goldY(12)).toBeCloseTo(BOX.padT, 6)
    expect(g.goldY(6)).toBeCloseTo(BOX.padT + BOX.plotH / 2, 6)
  })

  it('金数超上限时被夹住（不越界）', () => {
    const g = build([pt('a', 50, 6)])
    expect(g.goldY(Math.min(99, g.goldMax))).toBeGreaterThanOrEqual(BOX.padT)
  })
})

describe('主纵轴：与 Chart 1/3 共享 hpRatioAxis', () => {
  it('上限与网格逐位等于共享实现', () => {
    const g = build([pt('a', 150, 6), pt('b', 80, 8)])
    const yMax = hpRatioYMaxOf([150, 80])
    expect(g.yMax).toBe(yMax)
    expect(g.yGrid).toEqual(hpRatioYGridOf(yMax, BOX))
    expect(g.y(37)).toBeCloseTo(hpRatioYOf(37, yMax, BOX), 6)
    expect(g.yLabel(0)).toBe(0)
  })
})

describe('横轴与标签（末点必标）', () => {
  it('等距；单点居中', () => {
    const g = build([pt('a', 100, 6), pt('b', 100, 6), pt('c', 100, 6)])
    expect(g.x(0)).toBeCloseTo(54, 6)
    expect(g.x(2)).toBeCloseTo(954, 6)
    expect(build([pt('only', 100, 6)]).x(0)).toBeCloseTo(54 + 450, 6)
  })

  it('点数多时抽稀 ≤13 且末点必标注', () => {
    const pts = Array.from({ length: 40 }, (_, i) => pt(`v${i}`, 100, 6))
    const g = build(pts)
    expect(g.xTicks.length).toBeLessThanOrEqual(13)
    expect(g.xTicks[g.xTicks.length - 1].label).toBe('v39')
    expect(g.xTicks[0].index).toBe(0)
    // 索引递增
    for (let i = 1; i < g.xTicks.length; i++) expect(g.xTicks[i].index).toBeGreaterThan(g.xTicks[i - 1].index)
  })
})

describe('折线与散点产物', () => {
  it('hpLine/goldLine 都是 "x,y" 串且点数与输入一致', () => {
    const g = build([pt('a', 100, 6), pt('b', 120, 9)])
    expect(g.hpLine.split(' ')).toHaveLength(2)
    expect(g.goldLine.split(' ')).toHaveLength(2)
    expect(g.pts).toHaveLength(2)
    expect(g.pts[0].color).toBe('c:A,B,C')
    expect(g.pts[0].label).toBe('a')
  })

  it('空数据：不抛错、产出空串、上限回落 100/6', () => {
    const g = build([])
    expect(g.yMax).toBe(100)
    expect(g.goldMax).toBe(6)
    expect(g.hpLine).toBe('')
    expect(g.goldLine).toBe('')
    expect(g.xTicks).toEqual([])
    expect(g.pts).toEqual([])
  })
})
