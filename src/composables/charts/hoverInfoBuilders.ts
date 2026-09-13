/**
 * 时间图表页 · 悬浮**信息对象**构造（第二片拆分，2026-09-14）。
 *
 * 与同目录 `hoverCardRows.ts` 的分工：那边是「信息对象 → HoverCardRow[]」（纯映射，零依赖），
 * 这边是「页面状态切片 → 信息对象」。第一片拆分时把这层留在页面，理由是「它们闭包
 * `agentName`/`periodOf`/`benchText` 等页面上下文」——本轮复核后确认：这些依赖全部可以
 * **参数注入**（`agentName`/`periodOf`/`benchText` 都是纯函数，页面侧本来就是这么传的），
 * 故按第一片末尾留的建议（「剩余 script 侧还可再吃 ~60 行」）搬出。
 *
 * 搬迁纪律（零行为 delta）：
 * - 入参 = 页面 computed 的**输入**（`node`/`point`/`agentName` 等），返回值**逐字段同形状**；
 * - `agentName`/`periodOf`/`benchText` 由调用方注入，模块内不 import 页面/store（保持可单测）；
 * - 文案、三元分支顺序、`Math.round(...*1000)/10` 的取整口径逐字保留；
 * - 页面侧仍保留同名 computed（1 行委托），模板与调用点零改动。
 */
import { fmt } from '@/utils/format'
import { benchText, swapKindLabel } from './agentPresentation'
import type { FilmSimPoint, SlotComparePoint, TimelineNodeResult } from '@/composables/teamTimeline'
import type { TimelineHoverInfo, SlotCompareHoverInfo, FilmSimHoverInfo } from './hoverCardRows'

/** Chart 1 节点 = 真实的 `TimelineNodeResult`（不复制结构，规则 11 单一事实源） */
export type TimelineHoverNode = TimelineNodeResult

/** 危局期（`periodOf` 的返回值里本模块用到的字段；完整类型由页面侧 `periodOf` 决定） */
export interface HoverPeriod {
  normalBosses: { bossName: string }[]
  criticalBosses: { bossName: string }[]
}

export interface TimelineHoverDeps {
  agentName: (id: string) => string
  periodOf: (nodeId: string) => HoverPeriod | undefined
}

/**
 * Chart 1：队伍强度随版本演变 —— 悬浮信息对象。
 * 原页面 computed：`const n = result.value?.nodes[hoverNode.value]; if (!n) return null`。
 */
export function buildTimelineHoverInfo(
  n: TimelineHoverNode | undefined | null,
  deps: TimelineHoverDeps,
): TimelineHoverInfo | null {
  if (!n) return null
  const { agentName, periodOf } = deps
  return {
    nodeLabel: n.nodeLabel,
    teamNames: n.team.map(agentName),
    damage: n.damage,
    hpRatio: n.hpRatio,
    goldLabel: n.goldLabel,
    swap: n.swappedIn
      ? `换上 ${agentName(n.swappedIn)}，换下 ${agentName(n.swappedOut!)}` +
        (n.swapKind ? `（${swapKindLabel(n.swapKind, n.swapUpliftPct)}）` : '')
      : '',
    bench: n.newAgentBench ? benchText(n.newAgentBench, agentName) : '',
    schedule: (() => {
      const p = periodOf(n.nodeId)
      if (!p) return ''
      const parts: string[] = []
      if (p.normalBosses.length > 0) parts.push(`危局·普通：${p.normalBosses.map(x => x.bossName).join('/')}`)
      if (p.criticalBosses.length > 0) parts.push(`危局·困难：${p.criticalBosses.map(x => x.bossName).join('/')}`)
      return parts.join(' · ')
    })(),
  }
}

export interface SlotCompareHoverDeps {
  agentName: (id: string) => string
  /** 当前 A/B 两队的主C（用于 diffText 的「谁高」文案） */
  scAgentA: string
  scAgentB: string
}

/** Chart 7：同槽位角色对比 —— 悬浮信息对象（点类型 = 真实的 `SlotComparePoint`） */
export function buildSlotCompareHoverInfo(
  p: SlotComparePoint | undefined | null,
  deps: SlotCompareHoverDeps,
): (SlotCompareHoverInfo & { nodeLabel: string; mainName: string; supportName: string }) | null {
  if (!p) return null
  const { agentName, scAgentA, scAgentB } = deps
  const diff = p.damageB > 0 ? Math.round(((p.damageA - p.damageB) / p.damageB) * 1000) / 10 : 0
  return {
    nodeLabel: p.nodeLabel,
    mainName: p.mainName,
    supportName: agentName(p.supportId),
    teamANames: p.teamA.map(agentName),
    teamBNames: p.teamB.map(agentName),
    damageA: p.damageA,
    damageB: p.damageB,
    diff,
    diffText: diff > 0
      ? `${agentName(scAgentA)} 高 ${fmt(diff, 1)}%`
      : diff < 0
        ? `${agentName(scAgentB)} 高 ${fmt(-diff, 1)}%`
        : '两队持平',
  }
}

/** Chart 4：菲林经济模拟 —— 悬浮信息对象（点类型 = 真实的 `FilmSimPoint`） */
export function buildFilmSimHoverInfo(
  p: FilmSimPoint | undefined | null,
  deps: { agentName: (id: string) => string },
): (FilmSimHoverInfo & { label: string }) | null {
  if (!p) return null
  return {
    label: p.label,
    date: p.date,
    teamNames: p.team.map(deps.agentName),
    damage: p.damage,
    hpRatio: p.hpRatio,
    totalGold: p.totalGold,
    goldLabel: p.goldLabel,
    filmBank: p.filmBank,
    filmSpent: p.filmSpent,
    filmInvestedTotal: p.filmInvestedTotal,
  }
}
