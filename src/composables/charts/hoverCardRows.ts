/**
 * 时间图表页 · 悬浮卡行构造（第一片拆分，2026-09-13）。
 *
 * 从 `src/views/TimeChartsPage.vue` 的 `<script setup>` **原样搬迁**：四张图各有一份
 * 「悬浮信息对象 → HoverCardRow[]」的纯映射，外壳统一由 `components/ChartHoverCard.vue` 渲染
 * （上一轮已抽，勿再造）。搬迁原则 = 行序、文案、强调类（`hc-swap`/`hc-bench`/`sc-diff-*`）逐字不变。
 *
 * 只搬「对象 → 行」这一层；`hoverInfo`/`scHoverInfo` 等**信息对象**的构造仍留在页面
 * （它们闭包 `agentName`/`periodOf`/`benchText` 等页面上下文，搬走要多穿一层依赖，不值）。
 */
import type { HoverCardRow } from '@/components/ChartHoverCard.vue'
import { compact, fmt } from '@/utils/format'

/** Chart 1 悬浮信息（页面 `hoverInfo` computed 的形状） */
export interface TimelineHoverInfo {
  nodeLabel: string
  teamNames: string[]
  damage: number
  hpRatio: number
  goldLabel: string
  swap: string
  bench: string
  schedule: string
}

/** Chart 1：队伍强度随版本演变 —— 悬浮卡行 */
export function timelineHoverRows(h: TimelineHoverInfo | null): HoverCardRow[] {
  if (!h) return []
  const rows: HoverCardRow[] = [
    { text: `队伍：${h.teamNames.join(' + ')}` },
    { text: `伤害 ${compact(h.damage)}（${fmt(h.hpRatio, 1)}%）` },
    { text: h.goldLabel },
  ]
  if (h.schedule) rows.push({ text: h.schedule })
  if (h.swap) rows.push({ text: h.swap, cls: 'hc-swap' })
  if (h.bench) rows.push({ text: h.bench, cls: 'hc-bench' })
  return rows
}

/** Chart 3 悬浮信息（页面 `chart3HoverInfo` 的形状） */
export interface Chart3HoverInfo {
  teamNames: string[]
  damage: number
  hpRatio: number
  goldLabel: string
}

/** Chart 3：每期新角色 · 强队强度 —— 悬浮卡行 */
export function chart3HoverRows(h: Chart3HoverInfo | null): HoverCardRow[] {
  if (!h) return []
  return [
    { text: `强队：${h.teamNames.join(' + ')}` },
    { text: `伤害 ${compact(h.damage)}（${fmt(h.hpRatio, 1)}%）` },
    { text: h.goldLabel },
  ]
}

/** Chart 7 悬浮信息（页面 `scHoverInfo` 的形状） */
export interface SlotCompareHoverInfo {
  teamANames: string[]
  teamBNames: string[]
  damageA: number
  damageB: number
  diff: number
  diffText: string
}

/** Chart 7：同槽位角色对比 —— 悬浮卡行（`diff` 正负决定强调类，0 不强调） */
export function slotCompareHoverRows(h: SlotCompareHoverInfo | null): HoverCardRow[] {
  if (!h) return []
  return [
    { text: `蓝 ${h.teamANames.join(' + ')}：${compact(h.damageA)}` },
    { text: `橙 ${h.teamBNames.join(' + ')}：${compact(h.damageB)}` },
    { text: h.diffText, cls: h.diff > 0 ? 'sc-diff-a' : h.diff < 0 ? 'sc-diff-b' : '' },
  ]
}

/** Chart 4 悬浮信息（页面 `simHoverInfo` 的形状） */
export interface FilmSimHoverInfo {
  date: string
  teamNames: string[]
  damage: number
  hpRatio: number
  totalGold: number
  goldLabel: string
  filmBank: number
  filmSpent: number
  filmInvestedTotal: number
}

/** Chart 4：菲林经济模拟 —— 悬浮卡行 */
export function filmSimHoverRows(h: FilmSimHoverInfo | null): HoverCardRow[] {
  if (!h) return []
  return [
    { text: `${h.date} · 队伍 ${h.teamNames.join('+')}` },
    { text: `伤害 ${compact(h.damage)}（${fmt(h.hpRatio, 1)}%）` },
    { text: `${h.totalGold} 金 · ${h.goldLabel}` },
    { text: `菲林：存 ${h.filmBank} · 本期投 ${h.filmSpent} · 累计 ${h.filmInvestedTotal}` },
  ]
}
