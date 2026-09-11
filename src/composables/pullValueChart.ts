/**
 * Chart 5「抽卡价值 · 危局兑现」的派生模型（纯计算，2026-09-12 评审 #14 第七刀）。
 *
 * 抽的是该图的**全部派生量**：层过滤 → 分级过滤 → 行/表整形 → SVG 布局 → 悬浮与柱状文案。
 * 这些此前内联在 3019 行的页面里，与响应式状态混在一起且零单测；抽出后可用合成卡片钉住边界
 * （空结果 / 单卡 / 超行数上限 / 无 grade 的样本不足档 / sqrt 柱长）。
 *
 * 口径要点（与抽取前逐条一致）：
 * - **两层过滤正交且有序**：先按「层」（limited = 限定+赠送 / all）过滤，再按「分级」（T0~T3 + 样本不足）；
 * - 气泡图只画**前 16 行**（累计降序，防 SVG 过高），排行榜表则展示过滤后全部；
 * - 气泡半径 `2 + 5·sqrt(|effect|/maxAbs)`；`effect === 0` 时固定 1.6（不参与缩放，避免"零点变大"）；
 * - 行末累计柱用 **sqrt 尺度**（防一张大卡压扁全表），颜色按分级取色；
 * - 房间刻度按日期 `slice(5)`（MM-DD），抽稀上限 12，且**末房间必标注**。
 *
 * 取色说明：分级/气泡色是**字面色值**（不是语义令牌）——其中 `pvBarFill` 的默认色原是
 * `var(--wa-160)`，而色阶里并无 160 档（只有 150/200）⇒ 该描边长期静默失效，抽取时**保持原样**
 * 以免改变观感，仅在注释保留记号。
 */
import type { PvCardRoomEffect, PvCardTier, PvCardValue } from '@/composables/pullValue'

/** 无分级（样本不足）的档位 id */
export const PV_GRADE_NONE = 'na'
/** 气泡图行数上限（累计降序取前 N，防 SVG 过高） */
export const PV_MAX_ROWS = 16

/** 分级清单（含「样本不足」，它也是一档可筛的类别） */
export const PV_GRADE_DEFS = [
  { id: 'T0', label: 'T0', desc: '累计兑现前 25%', color: '#ff8f5a' },
  { id: 'T1', label: 'T1', desc: '累计兑现 25~50%', color: '#f6ad55' },
  { id: 'T2', label: 'T2', desc: '累计兑现 50~75%', color: '#a3a3b8' },
  { id: 'T3', label: 'T3', desc: '累计兑现后 25%', color: '#5f6373' },
  { id: PV_GRADE_NONE, label: '样本不足', desc: '配对数不足，不参与分级', color: 'var(--fg-3)' },
] as const

/** 某张卡属于哪一档（无 grade = 样本不足档） */
export function pvGradeOf(card: PvCardValue): string {
  return card.grade ?? PV_GRADE_NONE
}

/** 层标签 */
export function pvTierLabel(tier: PvCardTier): string {
  return tier === 'limited' ? '限定' : tier === 'freeGift' ? '赠送' : tier === 'standard' ? '常驻' : 'A级'
}

/** 行末累计柱配色（按分级；默认档色阶无 160 ⇒ 用 150，原样保留） */
export function pvBarFillOf(card: PvCardValue): string {
  if (card.grade === 'T0') return '#ff8f5a'
  if (card.grade === 'T1') return '#f6ad55'
  if (card.grade === 'T2') return '#a3a3b8'
  if (card.grade === 'T3') return '#5f6373'
  return 'var(--wa-150)'
}

/** 房间刻度：日期取 MM-DD，抽稀上限 12 且末房间必标注 */
export function pvXTicksOf(
  rooms: ReadonlyArray<{ date: string }>,
  maxTicks = 12,
): Array<{ index: number; label: string }> {
  const step = Math.max(1, Math.ceil(rooms.length / maxTicks))
  const out: Array<{ index: number; label: string }> = []
  for (let i = 0; i < rooms.length; i += step) out.push({ index: i, label: rooms[i].date.slice(5) })
  const last = rooms.length - 1
  if (rooms.length > 1 && last % step !== 0) out.push({ index: last, label: rooms[last].date.slice(5) })
  return out
}

export interface PvChartRow {
  card: PvCardValue
  rowIndex: number
  agentId: string
  label: string
  gradeText: string
}

export interface PvChartRoom {
  label: string
  runCount: number
  date: string
  key?: string
}

export interface PvChart {
  /** 层过滤结果 */
  filteredCards: PvCardValue[]
  /** 层 + 分级过滤结果（排行榜表用） */
  gradeFilteredCards: PvCardValue[]
  /** 气泡图行（前 PV_MAX_ROWS） */
  rows: PvChartRow[]
  tableRows: PvCardValue[]
  // 布局
  labelW: number
  barAreaW: number
  rowH: number
  padT: number
  xLabelH: number
  svgH: number
  plotW: number
  barX: number
  barMaxW: number
  barH: number
  x(i: number): number
  rowY(rowIndex: number): number
  // 气泡
  maxAbsEffect: number
  bubbleR(e: { effect: number }): number
  bubbleFill(e: { effect: number }): string
  bubbleTitle(card: PvCardValue, e: PvCardRoomEffect, i: number): string
  detailBarH(e: PvCardRoomEffect): string
  // 行末累计柱
  maxCum: number
  barW(card: PvCardValue): number
  barY(card: PvCardValue): number
  barFill(card: PvCardValue): string
  rowTitle(row: { card: PvCardValue }): string
  xTicks: Array<{ index: number; label: string }>
}

export function buildPullValueChart(input: {
  cards: ReadonlyArray<PvCardValue>
  rooms: ReadonlyArray<PvChartRoom>
  svgW: number
  tierFilter: 'limited' | 'all'
  isGradeVisible: (gradeId: string) => boolean
  nameOf: (agentId: string) => string
  /** 数字格式化（原页面的 fmt，调用时固定 0 位） */
  fmt: (n: number, digits: number) => string
}): PvChart {
  const { cards, rooms, svgW, tierFilter, isGradeVisible, nameOf, fmt } = input

  const filteredCards = tierFilter === 'limited'
    ? cards.filter(c => c.tier === 'limited' || c.tier === 'freeGift')
    : [...cards]
  const gradeFilteredCards = filteredCards.filter(c => isGradeVisible(pvGradeOf(c)))

  const rows: PvChartRow[] = gradeFilteredCards.slice(0, PV_MAX_ROWS).map((card, rowIndex) => ({
    card,
    rowIndex,
    agentId: card.agentId,
    label: nameOf(card.agentId),
    gradeText: card.grade ?? (card.totalPairs > 0 ? '·' : ''),
  }))

  const labelW = 96
  const barAreaW = 120
  const rowH = 22
  const padT = 18
  const xLabelH = 26
  const svgH = padT + rows.length * rowH + xLabelH
  const plotW = svgW - labelW - barAreaW - 8
  const barX = svgW - barAreaW + 10
  const barH = 10
  const barMaxW = barAreaW - 44

  const x = (i: number): number => {
    const n = rooms.length || 1
    const cw = plotW / Math.max(1, n)
    return labelW + cw * i + cw / 2
  }
  const rowY = (rowIndex: number): number => padT + rowH * rowIndex + rowH / 2

  let maxAbsEffect = 1
  for (const row of rows) for (const e of row.card.roomEffects) maxAbsEffect = Math.max(maxAbsEffect, Math.abs(e.effect))

  const bubbleR = (e: { effect: number }): number =>
    e.effect === 0 ? 1.6 : 2 + 5 * Math.sqrt(Math.abs(e.effect) / maxAbsEffect)
  const bubbleFill = (e: { effect: number }): string =>
    e.effect > 0 ? '#f6ad55' : e.effect < 0 ? '#63b3ed' : 'var(--wa-140)'
  const bubbleTitle = (card: PvCardValue, e: PvCardRoomEffect, i: number): string => {
    const room = rooms[i]
    const roomLabel = room ? `${room.label}（${room.runCount} 投稿）` : e.roomKey
    if (!e.appeared && e.effect === 0) return `${nameOf(card.agentId)} · ${roomLabel}\n未出场/实装前（计 0）`
    const pairNote = e.pairs > 0 ? `（${e.pairs} 配对中位数）` : `（无配对样本，计 0）`
    return `${nameOf(card.agentId)} · ${roomLabel}\n边际兑现 ${fmt(e.effect, 0)} 分${pairNote}${e.frontier ? '｜顶分在场' : ''}`
  }
  const detailBarH = (e: PvCardRoomEffect): string => {
    const pct = (Math.abs(e.effect) / maxAbsEffect) * 100
    return `${Math.max(2, pct)}%`
  }

  const maxCum = Math.max(1, ...rows.map(r => Math.max(0, r.card.cumulative)))
  const barW = (card: PvCardValue): number =>
    card.cumulative <= 0 ? 0 : Math.sqrt(card.cumulative / maxCum) * barMaxW
  const barY = (card: PvCardValue): number => {
    const row = rows.find(r => r.card === card)
    return row ? rowY(row.rowIndex) - barH / 2 : 0
  }
  const rowTitle = (row: { card: PvCardValue }): string => {
    const c = row.card
    return [
      `${nameOf(c.agentId)}（${pvTierLabel(c.tier)}${c.releaseDate ? `，实装 ${c.releaseDate}` : ''}）`,
      `累计兑现 ${fmt(c.cumulative, 0)} 分 · 场均 ${fmt(c.avgPerRoom, 0)} · 近3期 ${fmt(c.recentAvg, 0)}`,
      `上场 ${c.roomsAppeared}/${c.observableRooms} 期 · 顶分在场 ${c.frontierRooms} 期 · ${c.totalPairs} 配对`,
      `每万菲林 ${c.roiPer10kFilm == null ? '—（赠送）' : fmt(c.roiPer10kFilm, 0)} 分${c.grade ? ` · 分级 ${c.grade}` : ''}`,
    ].join('\n')
  }

  return {
    filteredCards, gradeFilteredCards, rows, tableRows: gradeFilteredCards,
    labelW, barAreaW, rowH, padT, xLabelH, svgH, plotW, barX, barMaxW, barH,
    x, rowY,
    maxAbsEffect, bubbleR, bubbleFill, bubbleTitle, detailBarH,
    maxCum, barW, barY, barFill: pvBarFillOf, rowTitle,
    xTicks: pvXTicksOf(rooms),
  }
}
