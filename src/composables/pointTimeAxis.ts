/**
 * 队伍对比散点的「第三轴」：角色首池时间（2026-09-14 用户新增需求）。
 *
 * ## 需求
 * 用户：「队伍对比中 x 轴是难度，y 是伤害，还可以找第三个轴，就是时间。时间代指变化的那
 * 一个角色的首次卡池时间。」——即每个散点除了 (难度, 伤害) 之外，还要能读出「这支队的
 * 主C是什么时候出的」，从而看「新角色是否真的更强 / 老角色是否被膨胀淘汰」。
 *
 * ## 为什么不做真 3D，而做「2D + 颜色/大小编码」（实测依据，非偏好）
 * ① **可读性**：散点上叠第三个空间轴后，比较两点必须旋转/遮挡判断（人眼在 2D 上读精确
 *    坐标本来就吃力，加深度轴后 z 的判读误差远大于颜色/大小编码）；
 * ② **零依赖**：仓库 7 张图全是手写 SVG（`package.json` 无 three/d3/plotly），真 3D 要引新依赖
 *    （违反规则 12「已装依赖能覆盖吗」），且 canvas/WebGL 渲染**无自动化 verifier**
 *    （现有 ui-check 只查 DOM/重叠/溢出）；
 * ③ **可测**：颜色/大小编码是纯函数（本模块），真 3D 的投影矩阵在这里没有可断言的业务语义。
 * ⇒ 本模块产出「时间 → 颜色 + 半径 + 图例分档」的纯映射；**若用户仍要真 3D 再单独立项**。
 *
 * ## 时间轴口径
 * 「变化的那一个角色」= 队伍**主C（槽位 0）**——与散点页「按主C快选」、`preset.team[0]`
 * 的既有约定一致（击破/辅助是围绕主C选的，主C才是抽取决策对象）。
 * 实装时间取 `AGENT_RELEASE_NODE`（S 级首 UP 节点）→ `VERSION_NODES.date`。
 * **主C不在表里**（A 级特例/未收录）→ `null`，该点**不参与时间着色**（用中性色 + 图例外列出，
 * 不猜时间也不静默当最新）。
 */
import { AGENT_RELEASE_NODE, VERSION_NODES } from '@/data/versionTimeline'

/** 主C实装时间点 */
export interface ReleaseTime {
  agentId: string
  nodeId: string
  /** 版本节点标签（如 '2.0 上半'） */
  nodeLabel: string
  /** 实装日期 YYYY-MM-DD */
  date: string
  /** 时间戳（排序/归一用） */
  ts: number
}

/** 查一支队伍主C的实装时间；主C未收录 → null */
export function releaseTimeOfMain(agentId: string): ReleaseTime | null {
  const nodeId = AGENT_RELEASE_NODE[agentId]
  if (!nodeId) return null
  const node = VERSION_NODES.find(n => n.id === nodeId)
  if (!node) return null
  return {
    agentId,
    nodeId,
    nodeLabel: node.label,
    date: node.date,
    ts: Date.parse(node.date),
  }
}

/** 时间分档（等宽分位；行为可预测，不用聚类以免每换一批队就重排图例） */
export interface TimeBucket {
  /** 档序号（0 = 最早） */
  index: number
  /** 档标签（如 '2.0 ~ 2.3'） */
  label: string
  /** 该档起止时间戳 */
  from: number
  to: number
  color: string
}

/** 分档数：4 档（与 T0~T3 分级同量级；超过 6 档颜色难辨） */
export const TIME_BUCKET_COUNT = 4

/**
 * 时间分档调色板（**冷 → 暖 = 早 → 晚**，符合「新角色」直觉：
 * 越新的角色越暖/越显眼）。用主题图表色，明暗通吃。
 */
export const TIME_BUCKET_COLORS = [
  'var(--c-chart-9)',   // 最早（冷）
  'var(--c-chart-3)',
  'var(--c-chart-4)',
  'var(--c-chart-6)',   // 最新（暖）
]

/** 主C未收录时的中性色（不算入任何档） */
export const TIME_UNKNOWN_COLOR = 'var(--fg-3)'

/**
 * 按实际出现的时间范围等宽分档。
 *
 * @param times 全部已知时间戳（升序或乱序都可）
 * @returns 档数组（空输入返回空数组）
 */
export function buildTimeBuckets(times: ReadonlyArray<number>): TimeBucket[] {
  const valid = times.filter(t => Number.isFinite(t))
  if (valid.length === 0) return []
  const min = Math.min(...valid)
  const max = Math.max(...valid)
  // 全部同一时间（单档场景）：返回 1 档，避免 (max-min)/n = 0 造成归属除零
  if (max === min) {
    return [{ index: 0, label: shortDate(min), from: min, to: max, color: TIME_BUCKET_COLORS[0] }]
  }
  const span = (max - min) / TIME_BUCKET_COUNT
  const out: TimeBucket[] = []
  for (let i = 0; i < TIME_BUCKET_COUNT; i++) {
    const from = min + span * i
    // 末档上界含端点（否则 max 会落到档外）
    const to = i === TIME_BUCKET_COUNT - 1 ? max : min + span * (i + 1)
    out.push({
      index: i,
      label: `${shortDate(from)} ~ ${shortDate(to)}`,
      from,
      to,
      color: TIME_BUCKET_COLORS[i],
    })
  }
  return out
}

/**
 * 时间戳 → 档序号；无有效档返回 -1。
 *
 * 边界口径（实测踩过一次，故写明）：
 * - 档区间**左闭右开**，仅**末档含右端点**（否则最大值会落到档外）；
 * - 早于首档的时间 → 钳到 **0**（不是末档）；晚于末档 → 钳到末档。
 *   首版写成「遍历不到就 `return buckets.length - 1`」，于是 **2020 年的时间会得到末档**
 *   （= 被当成最新角色，方向完全反了）——测试当场抓到。
 */
export function bucketIndexOf(ts: number, buckets: ReadonlyArray<TimeBucket>): number {
  if (!Number.isFinite(ts) || buckets.length === 0) return -1
  const last = buckets.length - 1
  if (ts < buckets[0].from) return 0                 // 早于范围 → 最早档
  if (ts > buckets[last].to) return last             // 晚于范围 → 最新档
  for (const b of buckets) {
    // 末档含右端点；其余左闭右开
    if (ts >= b.from && (ts < b.to || (b.index === last && ts <= b.to))) return b.index
  }
  return last
}

/** 时间戳 → 'YY.MM' 短标签（图例与 tooltip 用） */
export function shortDate(ts: number): string {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return '—'
  const yy = String(d.getUTCFullYear()).slice(2)
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  return `${yy}.${mm}`
}

/** 一个散点的时间编码结果 */
export interface PointTimeEncoding {
  /** 主C实装时间（null = 未收录） */
  release: ReleaseTime | null
  /** 档序号（-1 = 未收录，用中性色） */
  bucketIndex: number
  /** 填充色（档色或中性色） */
  color: string
  /** 半径加成：越新的角色点略大（0 / 0.6 / 1.2 / 1.8，叠加在基础半径上） */
  radiusBonus: number
}

/**
 * 给一批 (主C, 基础半径) 产出时间编码。
 * 分档范围**只由本批已知时间的点决定**（未收录点不参与 min/max——否则会把范围拉偏）。
 */
export function encodePointTimes(
  mains: ReadonlyArray<string>,
): { buckets: TimeBucket[]; byIndex: PointTimeEncoding[]; unknownCount: number } {
  const times = mains.map(m => releaseTimeOfMain(m))
  const knownTs = times.filter((t): t is ReleaseTime => t != null).map(t => t.ts)
  const buckets = buildTimeBuckets(knownTs)
  const byIndex = times.map(t => {
    if (!t) return { release: null, bucketIndex: -1, color: TIME_UNKNOWN_COLOR, radiusBonus: 0 }
    const bi = bucketIndexOf(t.ts, buckets)
    return {
      release: t,
      bucketIndex: bi,
      color: bi >= 0 ? buckets[bi].color : TIME_UNKNOWN_COLOR,
      // 越新越大：档序号线性映射（单档时给 0，避免全部点变大）
      radiusBonus: buckets.length > 1 ? (bi / (buckets.length - 1)) * 1.8 : 0,
    }
  })
  return { buckets, byIndex, unknownCount: times.filter(t => t == null).length }
}

/** 图例条目（页面直接渲染）：4 档 + 可选的「未收录」条 */
export function timeLegendRows(
  buckets: ReadonlyArray<TimeBucket>,
  unknownCount: number,
  namesOf: (bucketIndex: number) => string[] = () => [],
): Array<{ label: string; color: string; count: number; title: string }> {
  const rows = buckets.map(b => ({
    label: b.label,
    color: b.color,
    count: namesOf(b.index).length,
    title: namesOf(b.index).join(' / ') || '（本批无此档队伍）',
  }))
  if (unknownCount > 0) {
    rows.push({
      label: '主C未收录',
      color: TIME_UNKNOWN_COLOR,
      count: unknownCount,
      title: '主C 不在 AGENT_RELEASE_NODE（A 级特例/未收录）⇒ 不参与时间着色，也不猜时间',
    })
  }
  return rows
}
