/**
 * 失衡内异常系统 v2（2026-08-24 用户指令）：
 * 逐窗模拟多属性积蓄槽——可指定进窗时的异常状态（元素+已有积蓄），轴内招式按时间序累积
 * 各元素槽，某槽积蓄超过上限（BUILDUP_THRESHOLD_TABLE 第1管 × 系数）即触发一次对应异常。
 * 输出：触发事件序列（窗口/元素/时刻）、每窗各元素异常覆盖占比（供「异常状态单开一栏」展示）、
 * 跨窗结束余量。消费方：失衡内异放/极性紊乱的次数与元素归因、南宫羽颤音自动层数。
 *
 * 口径：同一元素同一窗口只触发一次异常事件（用户口径「触发一次对应异常」）；异常激活后持续
 * ANOMALY_DURATION 秒（通常覆盖至窗尾）。积蓄速率均匀摊到动作时长内（瞬发招式记在起点）。
 */
import { ANOMALY_DURATION, BUILDUP_THRESHOLD_TABLE, getBaseElement } from '@/core/anomalyPool/helpers'

export interface InStunAction {
  /** 招式积蓄元素 */
  element: string
  /** 单次积蓄值（池口径 perHit，已含效率区） */
  perHitBuildUp: number
  count: number
  /** 相对窗口起点的开始秒 */
  startTime: number
  /** 动作时长（秒），缺省 0 = 瞬发 */
  duration?: number
}

/** 进窗时目标身上的异常状态：元素 + 已有积蓄进度（0=刚触发完清零） */
export interface InStunEntryState {
  element: string
  gauge: number
}

export interface InStunWindowInput {
  actions?: InStunAction[]
  entryStates?: InStunEntryState[]
}

export interface InStunTrigger {
  windowIndex: number
  element: string
  /** 触发时刻（相对该窗口起点，秒） */
  offsetSeconds: number
}

export interface InStunAnomalyResult {
  triggers: InStunTrigger[]
  /** 每窗各元素异常覆盖占比（0-1；key=element，仅含有覆盖的元素） */
  coveragePerWindow: Array<Record<string, number>>
  /** 每窗结束时各元素槽余量（下一窗的 entryStates 继承用） */
  endGaiges: Array<InStunEntryState[]>
  note: string
}

interface SlotEvent {
  element: string
  time: number
  amount: number
}

export function computeInStunAnomalyTimeline(input: {
  windows: InStunWindowInput[]
  /** 窗口时长（秒），coverage 分母与截断用 */
  windowDuration: number
  /** 阈值系数（bossCoeff × 危局系数），同 simulateTriggerCount 口径 */
  coeff?: number
}): InStunAnomalyResult {
  const windowDuration = Math.max(0, input.windowDuration)
  const coeff = input.coeff && input.coeff > 0 ? input.coeff : 1
  const triggers: InStunTrigger[] = []
  const coveragePerWindow: Array<Record<string, number>> = []
  const endGaiges: Array<InStunEntryState[]> = []

  let carried: InStunEntryState[] = []
  for (let w = 0; w < input.windows.length; w++) {
    const win = input.windows[w]
    const entry = win.entryStates?.length ? win.entryStates : carried
    const gauges = new Map<string, number>()
    const activeUntil = new Map<string, number>()
    for (const st of entry) {
      gauges.set(st.element, Math.max(0, st.gauge))
    }

    // 展开动作 → 槽事件序列（积蓄按时长均摊；瞬发记起点）
    const slotEvents: SlotEvent[] = []
    for (const act of win.actions ?? []) {
      const n = Math.max(0, Math.floor(act.count))
      if (n <= 0 || act.perHitBuildUp <= 0) continue
      const dur = Math.max(0, act.duration ?? 0)
      for (let i = 0; i < n; i++) {
        const t = dur > 0 ? (act.startTime ?? 0) + ((i + 0.5) / n) * dur : (act.startTime ?? 0)
        slotEvents.push({ element: act.element, time: t, amount: act.perHitBuildUp })
      }
    }
    slotEvents.sort((a, b) => a.time - b.time)

    let cursor = 0
    const coverage: Record<string, number> = {}
    const baseElementOf = new Map<string, string>()
    for (const ev of slotEvents) {
      const base = getBaseElement(ev.element)
      baseElementOf.set(base, ev.element)
      // 结算 [cursor, ev.time] 的覆盖时长
      for (const [el, until] of activeUntil) {
        const overlap = Math.max(0, Math.min(until, windowDuration) - Math.min(cursor, windowDuration))
        coverage[el] = (coverage[el] ?? 0) + overlap
      }
      cursor = ev.time

      const key = base
      const g = (gauges.get(key) ?? 0) + ev.amount
      const thresholds = BUILDUP_THRESHOLD_TABLE[key] ?? BUILDUP_THRESHOLD_TABLE.ice
      gauges.set(key, g)
      if (activeUntil.has(key)) continue // 同元素同窗只触发一次
      if (g >= thresholds[0] * coeff) {
        triggers.push({ windowIndex: w, element: ev.element, offsetSeconds: ev.time })
        activeUntil.set(key, ev.time + (ANOMALY_DURATION[base] ?? 10))
        gauges.set(key, g - thresholds[0] * coeff)
      }
    }
    // 收尾覆盖
    for (const [el, until] of activeUntil) {
      const overlap = Math.max(0, Math.min(until, windowDuration) - Math.min(cursor, windowDuration))
      coverage[el] = (coverage[el] ?? 0) + overlap
    }
    const covOut: Record<string, number> = {}
    for (const [el, secs] of Object.entries(coverage)) {
      const v = windowDuration > 0 ? Math.min(1, secs / windowDuration) : 0
      if (v > 0) covOut[el] = v
    }
    coveragePerWindow.push(covOut)

    const ends: InStunEntryState[] = []
    for (const [key, g] of gauges) {
      const displayEl = baseElementOf.get(key) ?? key
      ends.push({ element: displayEl, gauge: g })
    }
    endGaiges.push(ends)
    carried = ends
  }

  return {
    triggers,
    coveragePerWindow,
    endGaiges,
    note: `逐窗多属性积蓄槽模拟：共 ${triggers.length} 次轴内异常触发；同元素同窗一次、激活持续按 ANOMALY_DURATION 表。`,
  }
}
