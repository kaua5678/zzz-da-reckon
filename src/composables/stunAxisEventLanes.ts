/**
 * 失衡轴编辑器的**事件道**派生量（2026-10-26，用户报「毁伤或者异常事件也夹在块里面，
 * 这些内容该新开一个展示轴啊」）。
 *
 * ## 病灶（改前实测）
 * 异常触发（`触电·紊`）、积蓄槽快照（`条电34%·以太95%`）、边界注入（`入窗·火`）、
 * 毁伤触发全部以 `.sap-mw` 小标签**画在动作块内部**。块的宽度 = 招式时长（0.5s 的块只有约 2% 宽），
 * 块里塞 3~5 个不收缩的标签后，招式名（`.sap-block-text`）被动收缩到 0 宽 ⇒ **看不见招式名字**。
 * 这不是"标签太多"的观感问题，是两类**不同维度**的信息挤在同一条轴上：
 *   · 块 = 「我打这个招式，占多少时间」（时间轴本义）；
 *   · 异常/毁伤 = 「这一刻发生了什么」（**事件**，有自己的时刻）。
 *
 * ## 分工（本模块只做纯派生，渲染留在页面）
 * 事件道 = 按时刻定位的**离散事件**，一条道一类语义：
 *   · 异常道：边界注入 / 满槽触发异常 / 紊乱替换 / 每个动作块末尾的积蓄槽快照；
 *   · 毁伤道：残痕消耗型毁伤（触发 / 层数不足未触发）。
 * 动作块内**只留招式级元数据**（明王/凝神窗口标签、+30%失衡徽标）——那些是招式的属性，
 * 不是某一刻发生的事件。
 *
 * ⚠ 单一事实源：事件时刻/元素/是否紊乱全部**照抄引擎产物**（`inStunAnomalyState.triggerSources` /
 *   `gaugeSnapshots` / `bossAnomalyState.disorders` / `claretSharpResourceSource.axisGashSteps`），
 *   本模块**不重推**任何判定（不判满槽、不判层数够不够），只做「挑出代表窗 + 排成一条道 + 起标签」。
 *
 * ⚠ 代表窗口径：编辑器展示的是**单窗模板**（一个失衡窗口内打什么），与 `anomalyTagsFor` /
 *   `gashTimeline` 原有的取窗方式一致（异常取 `windowEntryIdx.indexOf(ai)`，毁伤取第 1 窗）。
 */

import type { InStunGaugeSnapshot, InStunTriggerSource } from '@/types/resource'
import type { BossDisorderPoint } from '@/core/stunAxis/inStunAnomaly'

/** 事件道上的一个标记 */
export interface AxisEventMarker {
  key: string
  /** 相对窗口起点的秒（定位用；与动作块同一坐标系） */
  at: number
  /** 画在道上的短标签（≤ 约 8 字） */
  label: string
  /** 悬停说明（完整口径） */
  title: string
  kind: AxisEventKind
  /** 关联的动作块序（`inStunAnomalyState.triggerSources[].srcIndex`）；无关联 = undefined */
  srcIndex?: number
  /** 被抑制（画成删除线）——只有异常触发会有 */
  dim?: boolean
}

export type AxisEventKind =
  /** 边界注入：条目声明的进窗初始状态 */
  | 'entry'
  /** 满槽触发异常 */
  | 'trigger'
  /** 触发时替换了原状态（紊乱） */
  | 'disorder'
  /** 动作块末尾的积蓄槽快照 */
  | 'gauge'
  /** 毁伤触发 */
  | 'maim'
  /** 毁伤未触发（残痕层数不足） */
  | 'maimMiss'

/**
 * 引擎残痕步骤（`AxisGashStep` 的元素）。
 *
 * ⚠ 这里是**子集**（只用展示需要的字段），不是同形副本：判据 29 只管「逐字段相同」的副本，
 *   子集是另一种类型（残痕步骤将来加字段，本模块不该被迫跟改）。真正同形的三件
 *   （触发来源 / 积蓄槽快照 / 紊乱点）已改为**引用**引擎/类型层的具名类型，见文件头 import。
 */
export interface AxisGashStepLike {
  moveId: string
  kind: 'gain' | 'consume'
  layers: number
  fired: boolean
  at: number
  poolAfter: number
  window: number
}

/**
 * 异常道的标记（代表窗 `windowIndex`；`windowIndex < 0` 表示该条目没有代表窗 ⇒ 空）。
 *
 * @param blockAtOf 动作块「末尾时刻」查询（积蓄槽快照挂在块末尾）——页面传
 *   `srcIndex => (act.startTime ?? 0) + actDuration(act)`；取不到 ⇒ 退化为 `startTime`。
 */
export function buildAnomalyEventMarkers(input: {
  windowIndex: number
  triggers?: ReadonlyArray<InStunTriggerSource>
  gaugeSnapshots?: ReadonlyArray<InStunGaugeSnapshot>
  disorders?: ReadonlyArray<BossDisorderPoint>
  /** 条目声明的进窗状态（`axis.entryAnomaly` 已解析成元素）；未声明 ⇒ undefined */
  entry?: { element: string; pct?: number }
  /** 该条目被抑制的触发 id（`axis.suppressedTriggers`） */
  suppressed?: readonly string[]
  /** 元素中文名（页面传 `damageElementLabel`，单一来源 CC-214/447） */
  labelOf: (element: string) => string
  /** 招式中文名（页面传 catalog 查询；取不到时回落 moveId） */
  moveNameOf: (moveId: string) => string
  /** 动作块末尾时刻（积蓄槽快照定位） */
  blockAtOf?: (srcIndex: number | undefined) => number
}): AxisEventMarker[] {
  const { windowIndex, labelOf, moveNameOf } = input
  if (!Number.isFinite(windowIndex) || windowIndex < 0) return []
  const suppressed = new Set(input.suppressed ?? [])
  const out: AxisEventMarker[] = []
  const disorders = input.disorders ?? []

  if (input.entry) {
    const pctTxt = input.entry.pct && input.entry.pct > 0 ? ` ${input.entry.pct}%` : ''
    out.push({
      key: 'entry',
      at: 0,
      label: `入窗·${labelOf(input.entry.element)}`,
      title: `边界注入：敌人以「${labelOf(input.entry.element)}」状态进入本段失衡${pctTxt}`,
      kind: 'entry',
    })
  }

  for (const t of input.triggers ?? []) {
    if (t.windowIndex !== windowIndex) continue
    const label = labelOf(t.element)
    const replaced = disorders.some(d => d.windowIndex === windowIndex && Math.abs(d.time - t.offsetSeconds) < 1e-6)
    const isSuppressed = !!t.id && suppressed.has(t.id)
    out.push({
      key: `trigger:${t.id || `${t.moveId}@${t.offsetSeconds}`}`,
      at: t.offsetSeconds,
      label: `${isSuppressed ? '✕' : '触'}${label}${replaced ? '·紊' : ''}`,
      title: `${moveNameOf(t.moveId)} @${t.offsetSeconds.toFixed(2)}s → ${label}异常`
        + `${replaced ? '（触发时替换了原状态 = 紊乱）' : ''}`
        + `${isSuppressed ? '｜已抑制：满槽保持不触发，积蓄保留到下一个倍数' : ''}`,
      kind: replaced ? 'disorder' : 'trigger',
      srcIndex: t.srcIndex,
      dim: isSuppressed,
    })
  }

  for (const g of input.gaugeSnapshots ?? []) {
    if (g.windowIndex !== windowIndex) continue
    const parts = Object.entries(g.pct).filter(([, v]) => v > 0)
    if (parts.length === 0) continue
    const txt = parts.map(([el, v]) => `${labelOf(el)}${Math.round(v)}%`).join('·')
    out.push({
      key: `gauge:${g.srcIndex ?? out.length}`,
      at: input.blockAtOf ? input.blockAtOf(g.srcIndex) : 0,
      label: `条${txt}`,
      title: `该动作块打完时各异常积蓄槽状态：${txt}（100% = 满槽即触发）`,
      kind: 'gauge',
      srcIndex: g.srcIndex,
    })
  }

  // 同一时刻多标记时保持稳定序：入窗 → 触发/紊乱（按时刻）→ 积蓄槽（按时刻）
  return out
}

/**
 * 毁伤道的标记（残痕消耗型事件；代表窗 = 第 `window` 窗）。
 *
 * @param window 代表窗号（从 1 起）；`steps` 里其它窗的步骤被过滤掉
 * @param perLayer 每层点数（残痕 600）——只用于把 `poolAfter` 换回层数展示
 */
export function buildMaimEventMarkers(input: {
  steps?: ReadonlyArray<AxisGashStepLike>
  window: number
  perLayer: number
  labelOf: (moveId: string) => string
}): AxisEventMarker[] {
  const perLayer = Math.max(1, Number(input.perLayer))
  const out: AxisEventMarker[] = []
  for (const st of input.steps ?? []) {
    if (st.kind !== 'consume') continue
    if (st.window !== input.window) continue
    const name = input.labelOf(st.moveId)
    const after = (st.poolAfter / perLayer).toFixed(2)
    out.push({
      key: `maim:${st.moveId}:${st.at}:${out.length}`,
      at: st.at,
      label: st.fired ? `毁伤×${st.layers}` : '毁伤✕',
      title: st.fired
        ? `${name} 触发 ${st.layers} 次毁伤（打完后剩 ${after} 层）`
        : `${name} 未触发毁伤：要 ${st.layers} 层、当时只有 ${after} 层（招式本体照打，不消耗残痕）`,
      kind: st.fired ? 'maim' : 'maimMiss',
    })
  }
  return out
}

/**
 * 事件道的**道定义**（决定画几条道、各自底色）——页面按它渲染，不自立条件。
 * `hasAnomaly` = 引擎给出了失衡内异常摘要（非轴 / 未建模时为 null）⇒ 没有就不画；
 * `hasMaim` = 队内有残痕资源且拿到了逐条推演轨迹 ⇒ 没有就不画。
 */
export function axisEventLaneDefs(input: { hasAnomaly: boolean; hasMaim: boolean }): Array<{ key: 'anomaly' | 'maim'; name: string }> {
  const out: Array<{ key: 'anomaly' | 'maim'; name: string }> = []
  if (input.hasAnomaly) out.push({ key: 'anomaly', name: '异常事件' })
  if (input.hasMaim) out.push({ key: 'maim', name: '毁伤事件' })
  return out
}

/**
 * 同刻标记的**分行**（同一时刻可能同时有「触发」与「块末积蓄槽」，两颗标记会重叠成一颗）。
 *
 * 规则：按时刻排序后，若某标记与**同排**上一颗的水平间距 < `minGapSeconds`，就换到下一排；
 * 排号从 0 起，页面用 `row * 16px` 叠到该道内部（道高 = 行数 × 16 + 4）。
 * 纯几何，不改任何事件语义；返回顺序与原数组一致（只多一个 `row` 字段）。
 */
export function layoutEventMarkers(
  markers: ReadonlyArray<AxisEventMarker>,
  /** 窗口时长（秒）——只作可读性上下文，不参与分行（间距按固定秒数给，缺省 2.4s ≈ 一颗标记的宽度） */
  _windowSeconds: number,
  minGapSeconds = 2.4,
): { rows: number; placed: Array<AxisEventMarker & { row: number }> } {
  const placed: Array<AxisEventMarker & { row: number }> = []
  // 各排最后一颗的时刻（只在「已占用」的排里）
  const lastAtPerRow: number[] = []
  for (const m of markers) {
    const at = Math.max(0, Number(m.at) || 0)
    let row = 0
    while (row < lastAtPerRow.length && at - lastAtPerRow[row] < minGapSeconds) row += 1
    lastAtPerRow[row] = at
    placed.push({ ...m, row })
  }
  // 行数语义 = 该道**占几行版面**：空道也占 1 行（只画道名，用户能看出「这类事件今天没有」）。
  // `windowSeconds` 只作上下文，不参与行数（缺省间距已按固定秒数给出）。
  return { rows: Math.max(1, lastAtPerRow.length), placed }
}
