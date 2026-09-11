/**
 * Chart 6「抽卡规划器」的几何与泳道模型（纯计算，2026-09-12 评审 #14 第八刀）。
 *
 * 抽的是该图**从 plan.steps 到可画元素**的全部派生：布局 / 期分折线 / 三房间选队泳道 /
 * 泳道图例与可见性过滤。此前内联在 2922 行页面里、零单测。
 *
 * 口径要点（与抽取前逐条一致）：
 * - 画布高度 = `padT + purchaseH + scorePlotH + 3×(laneH+6) + xLabelH`（**泳道数硬编码 3**）；
 * - 期分折线纵轴至少 1（防除零），`scoreY` 把 0 放绘图区底部；
 * - 泳道单元格：该房无可用队 → `empty: true` 且文案为「无可用队」；否则文本 = 三人名 `+` 连接、
 *   title 带房号/Boss 名/分数；
 * - **可见泳道过滤保留原房号**（隐藏房2 后房3 仍写「房3」，不串号）——这是 ui 语义，别改成重编号。
 */
import type { PlannerStep } from '@/composables/pullPlanner'

/** 泳道图例定义：2 个固定泳道 + 3 个房间泳道 */
export const PP_LANE_DEFS = [
  { id: 'purchase', label: '购买', desc: '每期买了哪张卡（方块 = 卡，颜色同角色）', color: 'var(--app-primary)', fixed: true },
  { id: 'score', label: '期分', desc: '每期危局总分折线', color: 'var(--app-primary)', fixed: true },
  { id: 'room1', label: '房1', desc: '当期第 1 个 Boss 的选队', color: 'var(--c-info)', roomNo: 1 },
  { id: 'room2', label: '房2', desc: '当期第 2 个 Boss 的选队', color: 'var(--c-info)', roomNo: 2 },
  { id: 'room3', label: '房3', desc: '当期第 3 个 Boss 的选队', color: 'var(--c-info)', roomNo: 3 },
] as const

/** 档位文案（购买方块/表内用） */
export function ppTierLabelOf(tier: number): string {
  return tier === 3 ? '满配' : tier === 2 ? '本体+专武' : tier === 1 ? '本体' : '—'
}

export interface PlannerLaneCell {
  empty: boolean
  text: string
  title: string
}
export interface PlannerLane {
  y: number
  h: number
  cells: PlannerLaneCell[]
  /** 过滤后附加的房号（1..3），保留原编号 */
  roomNo?: number
}
export interface PlannerChartPoint {
  x: number
  y: number
  score: number
  label: string
}

export interface PlannerChart {
  labelW: number
  padT: number
  xLabelH: number
  purchaseH: number
  scorePlotH: number
  laneH: number
  svgH: number
  stepCount: number
  plotW: number
  cellW: number
  x(i: number): number
  xTicks: Array<{ index: number; label: string }>
  scoreMax: number
  scoreY(v: number): number
  scorePts: PlannerChartPoint[]
  scoreLine: string
  teamLanes: PlannerLane[]
  visibleTeamLanes: PlannerLane[]
}

export function buildPlannerChart(input: {
  steps: ReadonlyArray<PlannerStep>
  svgW: number
  nameOf: (agentId: string) => string
  fmt: (n: number, digits: number) => string
  /** 泳道可见性（隐藏房间泳道不画） */
  isLaneVisible: (laneId: string) => boolean
}): PlannerChart {
  const { steps, svgW, nameOf, fmt, isLaneVisible } = input

  const labelW = 60
  const padT = 26
  const xLabelH = 26
  const purchaseH = 44
  const scorePlotH = 90
  const laneH = 20
  const svgH = padT + purchaseH + scorePlotH + 3 * (laneH + 6) + xLabelH

  const stepCount = steps.length
  const plotW = svgW - labelW - 16
  const cellW = plotW / Math.max(1, stepCount)
  const x = (i: number): number => labelW + (i + 0.5) * (plotW / Math.max(1, stepCount))

  const xTicks: Array<{ index: number; label: string }> = []
  {
    const step = Math.max(1, Math.ceil(steps.length / 12))
    for (let i = 0; i < steps.length; i += step) xTicks.push({ index: i, label: steps[i].date.slice(5) })
    const last = steps.length - 1
    if (steps.length > 1 && last % step !== 0) xTicks.push({ index: last, label: steps[last].date.slice(5) })
  }

  const scoreMax = Math.max(1, ...(steps.length ? steps.map(s => s.assignment.totalScore) : [1]))
  const scoreY = (v: number): number => {
    const top = padT + purchaseH
    return top + scorePlotH - (v / scoreMax) * scorePlotH
  }
  const scorePts: PlannerChartPoint[] = steps.map((s, i) => ({
    x: x(i),
    y: scoreY(s.assignment.totalScore),
    score: s.assignment.totalScore,
    label: s.periodLabel,
  }))
  const scoreLine = scorePts.map(p => `${p.x},${p.y}`).join(' ')

  const lanesTop = padT + purchaseH + scorePlotH + 8
  const teamLanes: PlannerLane[] = [0, 1, 2].map(li => ({
    y: lanesTop + li * (laneH + 6),
    h: laneH,
    cells: steps.map(s => {
      const pick = s.assignment.picks[li]
      if (!pick || pick.team.every(m => !m)) {
        return { empty: true, text: '', title: `${s.periodLabel} 房${li + 1}：无可用队` }
      }
      const names = pick.team.map(nameOf).join('+')
      return {
        empty: false,
        text: names,
        title: `${s.periodLabel} 房${li + 1}（${pick.bossRoom.bossName}）：${names} = ${fmt(pick.score, 0)} 分`,
      }
    }),
  }))

  const visibleTeamLanes: PlannerLane[] = teamLanes
    .map((lane, li) => ({ ...lane, roomNo: li + 1 }))
    .filter(lane => isLaneVisible(`room${lane.roomNo}`))

  return {
    labelW, padT, xLabelH, purchaseH, scorePlotH, laneH, svgH,
    stepCount, plotW, cellW,
    x, xTicks, scoreMax, scoreY, scorePts, scoreLine,
    teamLanes, visibleTeamLanes,
  }
}
