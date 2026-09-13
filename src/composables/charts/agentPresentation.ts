/**
 * 时间图表页 · 纯展示助手（第一片拆分，2026-09-13）。
 *
 * 从 `src/views/TimeChartsPage.vue` 的 `<script setup>` **原样搬迁**：这些函数不碰组件生命周期、
 * 不读 store（store 由调用方注入），是可单测的纯函数。搬迁原则 = 不改名、不改默认值、不顺手重写；
 * 页面侧只把定义换成 import，调用点逐字保留（`benchText`/`bossCell*` 因依赖注入多了一个参数，见各自注释）。
 *
 * 落点选 composables 而非 components：展示层越层棘轮只度量 views/components 对 @/core|@/specs|
 * @/mechanics 的 import，composables 不在度量面内（本文件零该类 import）。
 */
import { fmt } from '@/utils/format'
import type { PeriodAxisNode } from '@/composables/bossSchedule'
import type { NewAgentBench, SwapKind } from '@/composables/teamTimeline'

/** 角色调色板（16 色轮转） */
export const PALETTE = ['#63e2b7', '#63b3ed', '#f6ad55', '#f687b3', '#b794f4', '#f6e05e', '#4fd1c5', '#fc8181', '#68d391', '#90cdf4', '#fbd38d', '#fbb6ce', '#d6bcfa', '#fefcbf', '#81e6d9', '#feb2b2']

/** 角色 id → 调色板色（djb2 变体散列，稳定不随版本漂移） */
export function colorOf(agentId: string): string {
  let h = 0
  for (let i = 0; i < agentId.length; i++) h = (h * 31 + agentId.charCodeAt(i)) >>> 0
  return PALETTE[h % PALETTE.length]
}

/** 换人判定徽标文案：上位 +12.4% / 平替 +0.8% */
export function swapKindLabel(kind: SwapKind, pct?: number): string {
  const label = kind === 'upgrade' ? '上位' : '平替'
  return pct == null ? label : `${label} ${pct > 0 ? '+' : ''}${fmt(pct, 1)}%`
}

/**
 * 实装未进队标注：X 实装未进队 · 平替（差 y%，可不抽）/ 未上位（差 y%）
 * ⚠ 搬迁时新增 `nameOf` 参数：原函数直接闭包页面的 `agentName`（读 catalogStore），
 * 搬进 composables 后由调用方注入，语义逐字不变。
 */
export function benchText(b: NewAgentBench, nameOf: (id: string) => string): string {
  const names = b.agents.map(nameOf).join('/')
  const gap = fmt(Math.abs(b.gapPct), 1)
  return b.kind === 'lateral'
    ? `${names} 实装未进队 · 平替（差 ${gap}%，可不抽）`
    : `${names} 实装未进队 · 未上位（差 ${gap}%）`
}

/**
 * 节点车道文案：该期危局·普通首个 Boss（多个标注 ×n）
 * ⚠ 搬迁时入参从 `nodeId` 改为已解析的 `PeriodAxisNode | undefined`（原函数先调 `periodOf(nodeId)`），
 * 判定与文案逐字不变。
 */
export function bossCellText(p: PeriodAxisNode | undefined): string {
  if (!p || p.normalBosses.length === 0) return ''
  const first = p.normalBosses[0].bossName
  return p.normalBosses.length > 1 ? `${first} 等${p.normalBosses.length}` : first
}

/** 节点车道 title（悬停提示）：普通/困难 Boss 全列；无排期时给统一兜底文案 */
export function bossCellTitle(p: PeriodAxisNode | undefined): string {
  if (!p) return '当期无排期数据'
  const parts: string[] = []
  if (p.normalBosses.length > 0) parts.push(`危局·普通：${p.normalBosses.map(b => b.bossName).join('/')}`)
  if (p.criticalBosses.length > 0) parts.push(`危局·困难：${p.criticalBosses.map(b => b.bossName).join('/')}`)
  return parts.join('\n') || '当期无排期数据'
}
