/**
 * Chart 1 时间线图几何/标度（评审 #14 第二刀，从 TimeChartsPage.vue 抽出）。
 *
 * 为什么值得测：这段 ~100 行此前埋在 3216 行页面里，只能靠「跑一遍 timeline 搜索（慢）再点开图」验证。
 * 抽出后用合成节点序列即可钉住边界：单节点居中、空节点、y 轴步长两档（50/100）、
 * 泳道首格贴 padL、换人标签只在变化处、x 轴抽稀且末节点必标注。
 */
import { describe, expect, it } from 'vitest'
import {
  AGENT_PALETTE,
  TIMELINE_LAYOUT,
  agentColorOf,
  buildTimelineChart,
  timelineBossLaneY,
  timelineLaneTotalH,
  timelineSvgH,
  timelineSvgWidth,
} from '@/composables/timelineChart'
import type { TimelineNodeResult } from '@/composables/teamTimeline'

/** 最小节点 fixture：只填几何读取的字段 */
const node = (opts: {
  hpRatio?: number
  team?: [string, string, string]
  swappedIn?: string
  nodeLabel?: string
} = {}): TimelineNodeResult => ({
  nodeId: 'n',
  nodeLabel: opts.nodeLabel ?? '2.0',
  team: opts.team ?? ['A', 'B', 'C'],
  hpRatio: opts.hpRatio ?? 100,
  swappedIn: opts.swappedIn,
} as unknown as TimelineNodeResult)

const nameOf = (id: string) => `name:${id}`
const build = (nodes: TimelineNodeResult[], svgW = 1000) =>
  buildTimelineChart({ nodes, svgW, nameOf, colorOf: agentColorOf })

describe('布局常量（与页面其余图表共享，改动需同步评估）', () => {
  it('泳道总高 / Boss 车道 y / 总高 的算术关系', () => {
    const { padT, plotH, laneH, laneGap, laneGapTop, xLabelH } = TIMELINE_LAYOUT
    expect(timelineLaneTotalH()).toBe(laneH * 3 + laneGap * 2)
    expect(timelineBossLaneY()).toBe(padT + plotH + laneGapTop + timelineLaneTotalH() + laneGap)
    expect(timelineSvgH()).toBe(padT + plotH + laneGapTop + timelineLaneTotalH() + laneGap + laneH + xLabelH)
  })

  it('画布宽度钳在 480..1180（无 window 回落 960-120）', () => {
    expect(timelineSvgWidth(2000)).toBe(1180)
    expect(timelineSvgWidth(300)).toBe(480)
    expect(timelineSvgWidth(800)).toBe(680)
    expect(timelineSvgWidth(undefined)).toBe(840)
  })

  it('配色稳定且落在调色板内', () => {
    expect(agentColorOf('1371')).toBe(agentColorOf('1371'))
    expect(AGENT_PALETTE).toContain(agentColorOf('1371'))
    expect(agentColorOf('')).toBeTruthy()
  })
})

describe('横向：按节点索引等距（与直伤图的按宽度权重不同）', () => {
  it('多节点：首末贴绘图区两端', () => {
    const g = build([node(), node(), node()])
    expect(g.xOf(0)).toBeCloseTo(TIMELINE_LAYOUT.padL, 6)
    expect(g.xOf(2)).toBeCloseTo(TIMELINE_LAYOUT.padL + g.plotW, 6)
    expect(g.xOf(1) - g.xOf(0)).toBeCloseTo(g.plotW / 2, 6)
  })

  it('单节点：居中（不除零）', () => {
    const g = build([node()])
    expect(g.xOf(0)).toBeCloseTo(TIMELINE_LAYOUT.padL + g.plotW / 2, 6)
    expect(g.cellW).toBe(g.plotW)
  })

  it('空节点：不抛错且读数为空', () => {
    const g = build([])
    expect(g.nodeCount).toBe(0)
    expect(g.chartPts).toEqual([])
    expect(g.xTicks).toEqual([])
    expect(g.linePoints).toBe('')
    expect(g.laneDefs).toHaveLength(3)   // 泳道结构仍在（只是没有格）
    expect(g.laneDefs[0].cells).toEqual([])
  })
})

describe('纵向：y 轴上限与两档步长', () => {
  it('峰值 <100 → 上限 100、步长 50', () => {
    const g = build([node({ hpRatio: 42 })])
    expect(g.yMax).toBe(100)
    expect(g.yTicks).toHaveLength(3)          // 0/50/100
    expect(g.yLabel(1)).toBe(50)
  })

  it('峰值 150 → 1.05 倍后仍 ≤200，向上取整到 50 的倍数', () => {
    const g = build([node({ hpRatio: 150 })])
    expect(g.yMax).toBe(200)                  // 157.5 → ceil 到 200
    expect(g.yLabel(4)).toBe(200)
  })

  it('峰值 300 → 切到 100 步长', () => {
    const g = build([node({ hpRatio: 300 })])
    expect(g.yMax).toBe(400)                  // 315 → ceil 到 400
    expect(g.yTicks).toHaveLength(5)          // 0/100/200/300/400
  })

  it('yOf：0 在底部、yMax 在顶部，且超上限被 chartPts 钳制', () => {
    const g = build([node({ hpRatio: 999 })])
    expect(g.yOf(0)).toBeCloseTo(TIMELINE_LAYOUT.padT + TIMELINE_LAYOUT.plotH, 6)
    expect(g.yOf(g.yMax)).toBeCloseTo(TIMELINE_LAYOUT.padT, 6)
    // 峰值 999 > yMax（1050？不——999*1.05=1048.95 → ceil 到 1100）→ 该点应贴顶不越界
    const top = g.chartPts[0]
    expect(top.y).toBeGreaterThanOrEqual(TIMELINE_LAYOUT.padT)
  })
})

describe('折线 / 换人导引 / 泳道 / 轴标签', () => {
  it('chartPts 带颜色与换人标记；linePoints 是 "x,y" 空格串', () => {
    const g = build([node({ swappedIn: 'X' }), node()])
    expect(g.chartPts[0].isSwap).toBe(true)
    expect(g.chartPts[1].isSwap).toBe(false)
    expect(g.chartPts[0].color).toBe(agentColorOf('A'))
    expect(g.linePoints.split(' ')).toHaveLength(2)
    expect(g.linePoints).toMatch(/^-?[\d.]+,-?[\d.]+ -?[\d.]+,-?[\d.]+$/)
  })

  it('swapGuides 只含换人节点', () => {
    const g = build([node(), node({ swappedIn: 'X' }), node()])
    expect(g.swapGuides).toHaveLength(1)
    expect(g.swapGuides[0].x).toBeCloseTo(g.xOf(1), 6)
  })

  it('泳道：3 条、首格贴 padL、y 递增、格数 = 节点数', () => {
    const g = build([node(), node(), node(), node()])
    expect(g.laneDefs.map(l => l.label)).toEqual(['主C', '队友1', '队友2'])
    expect(g.laneDefs[0].cells[0].x).toBe(TIMELINE_LAYOUT.padL)
    expect(g.laneDefs[0].cells[1].x).toBeCloseTo(TIMELINE_LAYOUT.padL + g.cellW, 6)
    expect(g.laneDefs[0].cells).toHaveLength(4)
    expect(g.laneDefs[1].y).toBeGreaterThan(g.laneDefs[0].y)
    expect(g.laneDefs[2].y).toBeGreaterThan(g.laneDefs[1].y)
  })

  it('换人标签只在角色变化处各打一个（连续同角色不重复）', () => {
    const teams: Array<[string, string, string]> = [
      ['A', 'B', 'C'], ['A', 'B', 'C'], ['D', 'B', 'C'], ['D', 'E', 'C'],
    ]
    const g = build(teams.map(t => node({ team: t })))
    const mainLabels = g.laneDefs[0].labels
    expect(mainLabels.map(l => l.text)).toEqual(['name:A', 'name:D'])
    expect(g.laneDefs[1].labels.map(l => l.text)).toEqual(['name:B', 'name:E'])
    expect(g.laneDefs[2].labels.map(l => l.text)).toEqual(['name:C'])
  })

  it('x 轴标签抽稀到 ≤15 且**末节点必被标注**', () => {
    const nodes = Array.from({ length: 40 }, (_, i) => node({ nodeLabel: `v${i}` }))
    const g = build(nodes)
    expect(g.xTicks.length).toBeLessThanOrEqual(15)
    expect(g.xTicks[g.xTicks.length - 1].label).toBe('v39')
    // 标签 x 落在绘图区内
    for (const t of g.xTicks) {
      expect(t.x).toBeGreaterThanOrEqual(TIMELINE_LAYOUT.padL - 1e-6)
      expect(t.x).toBeLessThanOrEqual(TIMELINE_LAYOUT.padL + g.plotW + 1e-6)
    }
  })

  it('节点少时不抽稀（逐步长 1）', () => {
    const g = build([node({ nodeLabel: 'a' }), node({ nodeLabel: 'b' }), node({ nodeLabel: 'c' })])
    expect(g.xTicks.map(t => t.label)).toEqual(['a', 'b', 'c'])
  })
})
