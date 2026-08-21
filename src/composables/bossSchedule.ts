/**
 * Boss 排期 × 版本节点：危局/试炼期数按开打时间（phase.begin）归入版本节点窗口，
 * 供时间图表页把「Boss 排期」标在「角色 UP 节点」时间轴上——选中某 Boss 时高亮其历次出场，
 * 这些节点上的换人/入队判定（上位/平替、实装未进队）即「当期新队友入队比较」。
 *
 * 匹配规则：begin 落入 [node.date, 下一 node.date) 窗口即归该节点；早于首节点 → null
 * （不在时间轴上）；晚于末节点 → 归末节点（当期）。不依赖 phase.version 字符串
 * （label/version 有错位先例）。危局期数目前仅数期（导入管道随版本增长），补导历史后标记自动变全。
 * 计算口径不变：整条曲线仍用所选 Boss 一套数值（跨节点强度可比），排期标记只负责定位比较窗口。
 */
import type { VersionNode } from '@/data/versionTimeline'
import type { BossPreset } from '@/types/bossPreset'

/** 单条排期：某 Boss 某期数落在某版本节点 */
export interface BossScheduleEntry {
  nodeId: string
  bossId: string
  bossName: string
  phaseId: string
  /** 期数标签（如 '3.1 · 2026-08-14'） */
  phaseLabel: string
  /** 开打日期（YYYY-MM-DD，取 begin 前 10 位） */
  beginDate: string
  modeType: 'critical_assault' | 'defense'
  stageName: string
}

type ScheduleNode = Pick<VersionNode, 'id' | 'date'>

/** 日期字符串（YYYY-MM-DD 或带时分秒）→ 版本节点 id；早于首节点/空值返回 null */
export function nodeIdForDate(nodes: ScheduleNode[], date: string): string | null {
  if (!date) return null
  const d = date.slice(0, 10)
  for (let i = 0; i < nodes.length; i++) {
    const next = nodes[i + 1]?.date
    if (d >= nodes[i].date && (next == null || d < next)) return nodes[i].id
  }
  return null
}

/**
 * 全部 Boss 期数 → 排期表（时间轴顺序；同节点内危局在前、按开打日期排序）。
 * 缺 begin 的期数跳过（无法定位节点）；同 (节点, Boss, 模式) 去重（复刻/数据重复只留一条）。
 */
export function buildBossSchedule(nodes: ScheduleNode[], bosses: BossPreset[]): BossScheduleEntry[] {
  const out: BossScheduleEntry[] = []
  const seen = new Set<string>()
  for (const b of bosses) {
    for (const ph of b.phases) {
      if (!ph.begin) continue
      const nodeId = nodeIdForDate(nodes, ph.begin)
      if (!nodeId) continue
      const key = `${nodeId}:${b.id}:${ph.modeType}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({
        nodeId,
        bossId: b.id,
        bossName: b.name,
        phaseId: ph.phaseId,
        phaseLabel: ph.label,
        beginDate: ph.begin.slice(0, 10),
        modeType: ph.modeType,
        stageName: ph.stageName,
      })
    }
  }
  const orderOf = (id: string) => nodes.findIndex(n => n.id === id)
  out.sort((x, y) =>
    orderOf(x.nodeId) - orderOf(y.nodeId)
    || x.beginDate.localeCompare(y.beginDate)
    || (x.modeType === y.modeType ? 0 : x.modeType === 'critical_assault' ? -1 : 1),
  )
  return out
}

/** 排期按节点分组（渲染用；组内保持 buildBossSchedule 的排序） */
export function scheduleByNode(entries: BossScheduleEntry[]): Map<string, BossScheduleEntry[]> {
  const m = new Map<string, BossScheduleEntry[]>()
  for (const e of entries) {
    const list = m.get(e.nodeId) ?? []
    list.push(e)
    m.set(e.nodeId, list)
  }
  return m
}
