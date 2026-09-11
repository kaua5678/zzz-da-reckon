/**
 * Chart 6「抽卡规划器」几何与泳道模型（评审 #14 第八刀）。
 *
 * 覆盖：画布高度公式（泳道数硬编码 3）、期分折线纵轴下限防除零、泳道单元格空/非空两态文案、
 * 以及一条**易被"顺手改错"的 UI 语义**——隐藏房2 后房3 仍写「房3」（房号不重编）。
 */
import { describe, expect, it } from 'vitest'
import { PP_LANE_DEFS, buildPlannerChart, ppTierLabelOf } from '@/composables/pullPlannerChart'
import type { PlannerStep } from '@/composables/pullPlanner'

const pick = (o: { bossName?: string; team?: [string, string, string]; score?: number } = {}) => ({
  bossRoom: { bossName: o.bossName ?? 'Boss' },
  team: o.team ?? (['a', 'b', 'c'] as [string, string, string]),
  score: o.score ?? 100,
})

const step = (o: {
  date?: string; label?: string; score?: number
  picks?: Array<ReturnType<typeof pick> | undefined>
} = {}): PlannerStep => ({
  periodId: 'p', periodLabel: o.label ?? '期1', date: o.date ?? '2026-07-08',
  purchases: [], bankBefore: 0, bankAfter: 0,
  assignment: { periodId: 'p', picks: (o.picks ?? [pick()]) as never, totalScore: o.score ?? 100 },
} as unknown as PlannerStep)

const build = (o: Partial<Parameters<typeof buildPlannerChart>[0]> = {}) =>
  buildPlannerChart({
    steps: [], svgW: 1000,
    nameOf: (id) => `名(${id})`, fmt: (n, d) => n.toFixed(d),
    isLaneVisible: () => true,
    ...o,
  })

describe('布局', () => {
  it('画布高度 = padT + purchaseH + scorePlotH + 3×(laneH+6) + xLabelH', () => {
    const g = build()
    expect(g.svgH).toBe(g.padT + g.purchaseH + g.scorePlotH + 3 * (g.laneH + 6) + g.xLabelH)
  })

  it('列宽与列中心；空步数时不除零', () => {
    const g = build({ steps: [step(), step(), step(), step()] })
    expect(g.plotW).toBe(1000 - g.labelW - 16)
    expect(g.cellW).toBeCloseTo(g.plotW / 4, 6)
    expect(g.x(0)).toBeCloseTo(g.labelW + g.cellW / 2, 6)
    expect(g.x(3)).toBeCloseTo(g.labelW + 3.5 * g.cellW, 6)
    expect(build().cellW).toBe(build().plotW)      // max(1, 0)
    expect(Number.isFinite(build().x(0))).toBe(true)
  })
})

describe('期分折线', () => {
  it('纵轴至少 1（防除零）；0 贴底、上限贴顶', () => {
    const g = build({ steps: [step({ score: 0 })] })
    expect(g.scoreMax).toBe(1)
    const top = g.padT + g.purchaseH
    expect(g.scoreY(0)).toBeCloseTo(top + g.scorePlotH, 6)
    expect(g.scoreY(g.scoreMax)).toBeCloseTo(top, 6)
  })

  it('点位与折线串同期数一致', () => {
    const g = build({ steps: [step({ score: 50 }), step({ score: 150 })] })
    expect(g.scoreMax).toBe(150)
    expect(g.scorePts).toHaveLength(2)
    expect(g.scorePts[0].score).toBe(50)
    expect(g.scoreLine.split(' ')).toHaveLength(2)
    expect(g.scoreLine).toMatch(/^-?[\d.]+,-?[\d.]+ -?[\d.]+,-?[\d.]+$/)
  })

  it('空步数：折线为空串且不抛错', () => {
    const g = build()
    expect(g.scoreLine).toBe('')
    expect(g.scorePts).toEqual([])
    expect(g.xTicks).toEqual([])
  })
})

describe('房间泳道', () => {
  it('3 条泳道、y 递增、每泳道格数 = 期数', () => {
    const g = build({ steps: [step(), step(), step()] })
    expect(g.teamLanes).toHaveLength(3)
    expect(g.teamLanes[0].cells).toHaveLength(3)
    expect(g.teamLanes[1].y).toBeGreaterThan(g.teamLanes[0].y)
    expect(g.teamLanes[2].y).toBeGreaterThan(g.teamLanes[1].y)
    expect(g.teamLanes[0].h).toBe(g.laneH)
  })

  it('空选队 → empty + 「无可用队」；有队 → 三人名与 Boss/分数 title', () => {
    const g = build({ steps: [step({ label: '期7', picks: [undefined, pick({ bossName: '危局X', score: 321 })] })] })
    expect(g.teamLanes[0].cells[0]).toEqual({ empty: true, text: '', title: '期7 房1：无可用队' })
    const c = g.teamLanes[1].cells[0]
    expect(c.empty).toBe(false)
    expect(c.text).toBe('名(a)+名(b)+名(c)')
    expect(c.title).toBe('期7 房2（危局X）：名(a)+名(b)+名(c) = 321 分')
  })

  it('全空槽位（team 全空串）也视为无可用队', () => {
    const g = build({ steps: [step({ picks: [pick({ team: ['', '', ''] })] })] })
    expect(g.teamLanes[0].cells[0].empty).toBe(true)
  })

  it('★ 可见性过滤保留原房号：隐藏房2 后房3 仍写「房3」（不重编号）', () => {
    const g = build({ steps: [step()], isLaneVisible: (id) => id !== 'room2' })
    expect(g.teamLanes).toHaveLength(3)
    expect(g.visibleTeamLanes.map(l => l.roomNo)).toEqual([1, 3])
  })

  it('图例定义：2 固定 + 3 房间，房号 1..3', () => {
    expect(PP_LANE_DEFS.map(d => d.id)).toEqual(['purchase', 'score', 'room1', 'room2', 'room3'])
    expect(PP_LANE_DEFS.filter(d => 'fixed' in d && d.fixed)).toHaveLength(2)
  })
})

describe('期刻度与档位文案', () => {
  it('刻度抽稀 ≤13 且末期必标注；标签取 MM-DD', () => {
    const steps = Array.from({ length: 40 }, (_, i) => step({ date: `2026-08-${String((i % 28) + 1).padStart(2, '0')}` }))
    const g = build({ steps })
    expect(g.xTicks.length).toBeLessThanOrEqual(13)
    expect(g.xTicks[g.xTicks.length - 1].index).toBe(39)
    expect(g.xTicks[0].label).toHaveLength(5)
  })

  it('档位文案四态', () => {
    expect(ppTierLabelOf(3)).toBe('满配')
    expect(ppTierLabelOf(2)).toBe('本体+专武')
    expect(ppTierLabelOf(1)).toBe('本体')
    expect(ppTierLabelOf(0)).toBe('—')
  })
})
