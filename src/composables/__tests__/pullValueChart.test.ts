/**
 * Chart 5「抽卡价值 · 危局兑现」派生模型（评审 #14 第七刀）。
 *
 * 覆盖：两层过滤的正交与顺序、气泡图 16 行上限、sqrt 柱长、气泡半径的零点特例、
 * 悬浮文案三态（未出场 / 有配对 / 顶分在场）、房间刻度抽稀与末房间必标。
 * 这些此前全部内联在 2930 行页面里且零单测。
 */
import { describe, expect, it } from 'vitest'
import {
  PV_GRADE_NONE,
  PV_MAX_ROWS,
  buildPullValueChart,
  pvBarFillOf,
  pvGradeOf,
  pvTierLabel,
  pvXTicksOf,
} from '@/composables/pullValueChart'
import type { PvCardRoomEffect, PvCardValue } from '@/composables/pullValue'

const eff = (o: Partial<PvCardRoomEffect> = {}): PvCardRoomEffect =>
  ({ effect: 0, appeared: true, pairs: 0, frontier: false, roomKey: 'r', ...o } as unknown as PvCardRoomEffect)

const card = (o: Partial<PvCardValue> = {}): PvCardValue => ({
  agentId: 'A1', tier: 'limited', grade: 'T1', cumulative: 100, avgPerRoom: 10, recentAvg: 12,
  roomsAppeared: 3, observableRooms: 5, frontierRooms: 1, totalPairs: 4, roiPer10kFilm: 7,
  releaseDate: '2026-01-01', roomEffects: [eff()], ...o,
} as unknown as PvCardValue)

const rooms = (n: number) => Array.from({ length: n }, (_, i) => ({
  label: `R${i}`, runCount: 3, date: `2026-01-${String(i + 1).padStart(2, '0')}`,
}))

const build = (o: Partial<Parameters<typeof buildPullValueChart>[0]> = {}) =>
  buildPullValueChart({
    cards: [], rooms: rooms(4), svgW: 1000,
    tierFilter: 'limited', isGradeVisible: () => true,
    nameOf: (id) => `名(${id})`, fmt: (n, d) => n.toFixed(d),
    ...o,
  })

describe('两层过滤（层在前、分级在后，正交）', () => {
  it('limited 层 = 限定 + 赠送；all 层 = 全部', () => {
    const cards = [card({ agentId: 'a', tier: 'limited' }), card({ agentId: 'b', tier: 'freeGift' }),
      card({ agentId: 'c', tier: 'standard' }), card({ agentId: 'd', tier: 'aRank' })]
    expect(build({ cards }).filteredCards.map(c => c.agentId)).toEqual(['a', 'b'])
    expect(build({ cards, tierFilter: 'all' }).filteredCards).toHaveLength(4)
  })

  it('分级过滤作用在层过滤之后，且 tableRows 与 rows 同源', () => {
    const cards = [card({ agentId: 'a', grade: 'T0' }), card({ agentId: 'b', grade: undefined }),
      card({ agentId: 'c', grade: 'T1' })]
    const g = build({ cards, isGradeVisible: (id) => id === PV_GRADE_NONE })
    expect(g.gradeFilteredCards.map(c => c.agentId)).toEqual(['b'])   // 只剩样本不足档
    expect(g.tableRows.map(c => c.agentId)).toEqual(['b'])
    expect(g.rows.map(r => r.agentId)).toEqual(['b'])
  })

  it('无 grade 的卡归入「样本不足」档；gradeText 有样本时显示「·」', () => {
    expect(pvGradeOf(card({ grade: undefined }))).toBe(PV_GRADE_NONE)
    const g = build({ cards: [card({ agentId: 'x', grade: undefined, totalPairs: 3 }),
      card({ agentId: 'y', grade: undefined, totalPairs: 0 })] })
    expect(g.rows.map(r => r.gradeText)).toEqual(['·', ''])
  })
})

describe('行整形与布局', () => {
  it('气泡图最多 PV_MAX_ROWS 行，表格保留全部', () => {
    const cards = Array.from({ length: 20 }, (_, i) => card({ agentId: `a${i}` }))
    const g = build({ cards })
    expect(g.rows).toHaveLength(PV_MAX_ROWS)
    expect(g.tableRows).toHaveLength(20)
    expect(g.rows[0].rowIndex).toBe(0)
  })

  it('行高/表头高与总高一致；列中心与行中心公式', () => {
    const g = build({ cards: [card(), card()] })
    expect(g.svgH).toBe(g.padT + 2 * g.rowH + g.xLabelH)
    expect(g.rowY(0)).toBe(g.padT + g.rowH / 2)
    expect(g.rowY(1)).toBe(g.padT + g.rowH * 1.5)
    // 房间列中心：列宽 = plotW / 房间数，首列中心 = labelW + cw/2
    const cw = g.plotW / 4
    expect(g.x(0)).toBeCloseTo(g.labelW + cw / 2, 6)
    expect(g.x(3)).toBeCloseTo(g.labelW + cw * 3.5, 6)
  })

  it('空结果：不抛错，行/表为空、总高只含表头', () => {
    const g = build({ cards: [] })
    expect(g.rows).toEqual([])
    expect(g.svgH).toBe(g.padT + g.xLabelH)
    expect(g.maxAbsEffect).toBe(1)   // 下限 1，防除零
    expect(g.maxCum).toBe(1)
  })
})

describe('气泡（半径/取色/文案）', () => {
  it('effect 0 固定半径 1.6（不随缩放）；非零按 sqrt 缩放', () => {
    const g = build({ cards: [card({ roomEffects: [eff({ effect: 100 }), eff({ effect: -25 })] })] })
    expect(g.bubbleR({ effect: 0 })).toBe(1.6)
    expect(g.maxAbsEffect).toBe(100)
    expect(g.bubbleR({ effect: 100 })).toBeCloseTo(7, 6)      // 2 + 5*1
    expect(g.bubbleR({ effect: -25 })).toBeCloseTo(2 + 5 * 0.5, 6)
  })

  it('取色：正 / 负 / 零三态', () => {
    const g = build({})
    expect(g.bubbleFill({ effect: 1 })).toBe('#f6ad55')
    expect(g.bubbleFill({ effect: -1 })).toBe('#63b3ed')
    expect(g.bubbleFill({ effect: 0 })).toBe('var(--wa-140)')
  })

  it('文案三态：未出场计 0 / 有配对中位数 / 顶分在场；房间名带投稿数', () => {
    const g = build({ rooms: [{ label: '危局A', runCount: 7, date: '2026-01-01' }] })
    const c = card({ agentId: 'X' })
    expect(g.bubbleTitle(c, eff({ effect: 0, appeared: false }), 0)).toContain('未出场/实装前（计 0）')
    const t1 = g.bubbleTitle(c, eff({ effect: 12, pairs: 3 }), 0)
    expect(t1).toContain('危局A（7 投稿）')
    expect(t1).toContain('边际兑现 12 分（3 配对中位数）')
    expect(g.bubbleTitle(c, eff({ effect: 12, pairs: 0, frontier: true }), 0)).toContain('｜顶分在场')
  })

  it('detailBarH 最小 2%', () => {
    const g = build({ cards: [card({ roomEffects: [eff({ effect: 100 })] })] })
    expect(g.detailBarH(eff({ effect: 100 }))).toBe('100%')
    expect(g.detailBarH(eff({ effect: 0 }))).toBe('2%')
  })
})

describe('行末累计柱（sqrt 尺度）', () => {
  it('cumulative ≤ 0 → 0 宽；>0 按 sqrt 比例；未知卡 → y=0', () => {
    const g = build({ cards: [card({ agentId: 'a', cumulative: 400 }), card({ agentId: 'b', cumulative: 100 })] })
    expect(g.maxCum).toBe(400)
    expect(g.barW(card({ cumulative: 0 }))).toBe(0)
    expect(g.barW(card({ cumulative: 400 }))).toBeCloseTo(g.barMaxW, 6)
    expect(g.barW(card({ cumulative: 100 }))).toBeCloseTo(g.barMaxW * 0.5, 6)
    expect(g.barY(card({ agentId: '不在图里' }))).toBe(0)
    expect(g.barY(g.rows[0].card)).toBeCloseTo(g.rowY(0) - g.barH / 2, 6)
  })

  it('柱色按分级；默认档用 --wa-150（原 --wa-160 不存在）', () => {
    expect(pvBarFillOf(card({ grade: 'T0' }))).toBe('#ff8f5a')
    expect(pvBarFillOf(card({ grade: 'T3' }))).toBe('#5f6373')
    expect(pvBarFillOf(card({ grade: undefined }))).toBe('var(--wa-150)')
  })

  it('行标题含队层/累计/场均/上场/每万菲林；赠送（roi null）显示破折号', () => {
    const g = build({})
    const t = g.rowTitle({ card: card({ agentId: 'X', tier: 'freeGift', roiPer10kFilm: null }) })
    expect(t).toContain('名(X)（赠送，实装 2026-01-01）')
    expect(t).toContain('累计兑现 100 分')
    expect(t).toContain('每万菲林 —（赠送）')
  })
})

describe('房间刻度', () => {
  it('抽稀上限 12 且末房间必标注；标签取 MM-DD', () => {
    const ticks = pvXTicksOf(rooms(40))
    expect(ticks.length).toBeLessThanOrEqual(13)
    expect(ticks[0]).toEqual({ index: 0, label: '01-01' })
    expect(ticks[ticks.length - 1].index).toBe(39)
  })

  it('房间少时不抽稀', () => {
    expect(pvXTicksOf(rooms(3)).map(t => t.index)).toEqual([0, 1, 2])
  })

  it('层标签文案', () => {
    expect(pvTierLabel('limited')).toBe('限定')
    expect(pvTierLabel('freeGift')).toBe('赠送')
    expect(pvTierLabel('standard')).toBe('常驻')
    expect(pvTierLabel('aRank')).toBe('A级')
  })
})
