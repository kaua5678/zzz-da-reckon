/**
 * Boss 排期 × 危局期数轴：把 bosses[].phases 按 phaseId 聚合成「危局期数」节点
 * （一个版本上下两个卡池，但约 3 期危局、每期 ~14 天），供时间图表页做横轴与排期车道。
 *
 * 口径（用户拍板）：
 * - 演变只看**危局·普通**（defense）；**危局·困难**（critical_assault，仅最近数期有）仅记录不作为轴依据。
 * - 排序按 begin（尾部 3.2 测试服占位期 id 不单调，不能按 id 数值序）。
 * - 角色在期数中途实装也算该期可用：实装日落在某期 [begin, 下一期 begin) 窗口内即算该期
 *   （`indexForDate` 窗口匹配；早于首期 → -1，由调用方钳制为「从轴起点可用」）。
 */
import type { VersionNode } from '@/data/versionTimeline'
import type { BossPreset } from '@/types/bossPreset'

type ScheduleNode = Pick<VersionNode, 'id' | 'date'>

/**
 * 日期字符串（YYYY-MM-DD 或带时分秒）→ 轴节点 id；早于首节点/空值返回 null。
 * 窗口 = [node.date, 下一 node.date)；末节点无上界。
 */
export function nodeIdForDate(nodes: ScheduleNode[], date: string): string | null {
  const idx = indexForDate(nodes, date)
  return idx < 0 ? null : nodes[idx].id
}

/** 同 nodeIdForDate 的下标版；早于首节点返回 -1 */
export function indexForDate(nodes: ScheduleNode[], date: string): number {
  if (!date) return -1
  const d = date.slice(0, 10)
  for (let i = 0; i < nodes.length; i++) {
    const next = nodes[i + 1]?.date
    if (d >= nodes[i].date && (next == null || d < next)) return i
  }
  return -1
}

/** 危局·普通 Boss 条目 */
export interface PeriodBossBrief {
  bossId: string
  bossName: string
}

/** 危局期数轴节点：一个 phaseId = 一期 */
export interface PeriodAxisNode {
  /** 期数 id（phaseId，如 '690421'） */
  id: string
  /** 期数标签（如 '3.1 · 2026-08-14'） */
  label: string
  version: string
  /** 期数序号：剔除测试服占位期后按时间序 1 起编（横轴刻度用，如「45」代表 69045） */
  seq: number
  /** 开打日期 YYYY-MM-DD */
  begin: string
  /** 危局·普通 Boss（defense 模式，去重，通常 1~3 个） */
  normalBosses: PeriodBossBrief[]
  /** 危局·困难 Boss（critical_assault 模式；历史期多为空） */
  criticalBosses: PeriodBossBrief[]
}

/**
 * 危局期数轴：聚合全部 Boss 的 phases 按 phaseId 归期、按 begin 排序（同 begin 按 id 稳定）。
 * 默认排除测试服占位期（version ∈ testServerVersions）；同 (期, Boss, 模式) 去重。
 */
export function buildPeriodAxis(
  bosses: BossPreset[],
  opts: { includeTestServer?: boolean; testServerVersions?: Set<string> } = {},
): PeriodAxisNode[] {
  interface Draft extends Omit<PeriodAxisNode, 'normalBosses' | 'criticalBosses' | 'seq'> {
    normalBosses: PeriodBossBrief[]
    criticalBosses: PeriodBossBrief[]
    seen: Set<string>
  }
  const map = new Map<string, Draft>()
  for (const b of bosses) {
    for (const ph of b.phases) {
      if (!ph.begin) continue
      let node = map.get(ph.phaseId)
      if (!node) {
        node = {
          id: ph.phaseId,
          label: ph.label,
          version: ph.version,
          begin: ph.begin.slice(0, 10),
          normalBosses: [],
          criticalBosses: [],
          seen: new Set(),
        }
        map.set(ph.phaseId, node)
      }
      const kind = ph.modeType === 'critical_assault' ? 'criticalBosses' : 'normalBosses'
      const dedupeKey = `${kind}:${b.id}`
      if (node.seen.has(dedupeKey)) continue
      node.seen.add(dedupeKey)
      node[kind].push({ bossId: b.id, bossName: b.name })
    }
  }
  return [...map.values()]
    .sort((x, y) => x.begin.localeCompare(y.begin) || x.id.localeCompare(y.id))
    .filter(node => opts.includeTestServer || !opts.testServerVersions?.has(node.version))
    .map(({ seen, ...node }, i) => ({ ...node, seq: i + 1 }))
}
