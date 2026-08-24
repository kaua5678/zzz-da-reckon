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

// ============ Boss 异常状态轴（2026-08-24 用户指令） ============
//
// 用户口径：极性紊乱看「当前时间点」目标处于什么属性异常状态，就触发对应效果；
// 不同属性异常在已有时状态下触发 = 紊乱并**替换**状态；风化保持不变（独立覆盖层，
// 不参与替换、也不被替换）。本函数把 v2 时间线的触发序列推进成逐窗状态链。

/** 状态时段（相对该窗口起点的秒；end 截断到窗口时长，状态本身可跨窗延续） */
export interface BossStateSegment {
  start: number
  end: number
  element: string
}

export interface BossAnomalyStateResult {
  /** 每窗标准属性异常状态链（风化除外） */
  stateChainsPerWindow: BossStateSegment[][]
  /** 风化覆盖层逐窗时段（独立计时，持续 ANOMALY_DURATION.wind） */
  windOverlayPerWindow: BossStateSegment[][]
  /** 替换型紊乱点：element = **被替换的原状态**元素（「当前时点的状态」口径，如需改新状态一行可翻） */
  disorders: Array<{ windowIndex: number; time: number; element: string }>
  /**
   * 接线层注入（纯函数不填）：本轮失衡总次数。轴条目按「代表窗」模拟，
   * 事件总次数按 stunsTotal 缩放回代表窗取样。
   */
  stunsTotal?: number
  /** 接线层注入（纯函数不填）：构建状态链用的窗口时长；消费端取样必须用同一值，禁止重算 */
  windowDuration?: number
  note: string
}

interface ActiveInterval {
  start: number
  end: number
  element: string
}

/**
 * Boss 异常状态轴：把 v2 触发序列（窗口/元素/相对时刻）按绝对时间序推进状态机。
 * 规则：无状态→激活；同元素→刷新时长；不同标准元素→紊乱（记原状态）+替换；
 * 风化走独立覆盖层（刷新/激活均不影响标准槽）；状态过期后再触发=重新激活（非紊乱）。
 */
export function computeBossAnomalyStateTimeline(input: {
  triggers: InStunTrigger[]
  windowDuration: number
  windowCount: number
  /** 开战时目标身上已有的属性异常（可选） */
  entryElement?: string
}): BossAnomalyStateResult {
  const D = Math.max(0, input.windowDuration)
  const totalEnd = D * Math.max(1, input.windowCount)
  const durOf = (el: string) => ANOMALY_DURATION[getBaseElement(el)] ?? 10

  const stdIntervals: ActiveInterval[] = []
  const windIntervals: ActiveInterval[] = []
  const disorders: BossAnomalyStateResult['disorders'] = []

  let std: ActiveInterval | null = null
  let windEnd = -1
  if (input.entryElement) {
    const base = getBaseElement(input.entryElement)
    const iv: ActiveInterval = { start: 0, end: durOf(base), element: input.entryElement }
    if (base === 'wind') {
      windIntervals.push(iv)
      windEnd = iv.end
    } else {
      stdIntervals.push(iv)
      std = iv
    }
  }

  const sorted = [...input.triggers].sort((a, b) =>
    (a.windowIndex * D + a.offsetSeconds) - (b.windowIndex * D + b.offsetSeconds))
  for (const trig of sorted) {
    const t = trig.windowIndex * D + trig.offsetSeconds
    const base = getBaseElement(trig.element)
    if (base === 'wind') {
      // 风化保持不变：独立层激活/刷新，不动标准槽
      if (windEnd >= t) windIntervals[windIntervals.length - 1].end = t + durOf(trig.element)
      else windIntervals.push({ start: t, end: t + durOf(trig.element), element: trig.element })
      windEnd = windIntervals[windIntervals.length - 1].end
      continue
    }
    if (!std || std.end <= t) {
      // 无活跃状态（含过期后重激活）：不算紊乱
      std = { start: t, end: t + durOf(trig.element), element: trig.element }
      stdIntervals.push(std)
      continue
    }
    if (getBaseElement(std.element) === base) {
      std.end = t + durOf(trig.element) // 同元素刷新
      continue
    }
    // 替换型紊乱：归因取被替换的原状态（当前时点状态），随后状态切到新元素
    disorders.push({ windowIndex: trig.windowIndex, time: t, element: std.element })
    std.end = t // 截断原状态时段，避免新旧重叠
    std = { start: t, end: t + durOf(trig.element), element: trig.element }
    stdIntervals.push(std)
  }

  const projectToWindows = (intervals: ActiveInterval[]): BossStateSegment[][] => {
    const out: BossStateSegment[][] = Array.from({ length: Math.max(1, input.windowCount) }, () => [])
    for (const iv of intervals) {
      for (let w = 0; w < out.length; w++) {
        const s = Math.max(iv.start, w * D)
        const e = Math.min(Math.min(iv.end, totalEnd), (w + 1) * D)
        if (e - s > 1e-9) out[w].push({ start: s - w * D, end: e - w * D, element: iv.element })
      }
    }
    return out
  }

  return {
    stateChainsPerWindow: projectToWindows(stdIntervals),
    windOverlayPerWindow: projectToWindows(windIntervals),
    disorders,
    note: `Boss 异常状态轴：不同属性异常触发即紊乱并替换状态（归因取原状态）；风化为独立覆盖层不参与替换。共 ${disorders.length} 次替换型紊乱。`,
  }
}

/**
 * 极性紊乱点时归因：把一次事件的次数按「窗口内均匀取样时刻查当时状态」分配到元素。
 * 返回按元素合计的次数（总量守恒，最大余数法取整）；无状态的取样点计入 fallback 元素。
 */
export function attributeCountByStateChain(
  count: number,
  chain: BossStateSegment[],
  windowDuration: number,
  fallbackElement: string,
): Array<{ element: string; count: number }> {
  const n = Math.max(0, Math.floor(count))
  if (n <= 0) return []
  const D = Math.max(0, windowDuration)
  const hits = new Map<string, number>()
  for (let i = 0; i < n; i++) {
    const t = ((i + 0.5) / n) * D
    const seg = chain.find(s => t >= s.start && t < s.end)
    const el = seg?.element ?? fallbackElement
    hits.set(el, (hits.get(el) ?? 0) + 1)
  }
  return [...hits.entries()]
    .map(([element, c]) => ({ element, count: c }))
    .sort((a, b) => b.count - a.count)
}
