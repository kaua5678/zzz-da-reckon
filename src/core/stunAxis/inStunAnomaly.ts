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
  /** 来源招式 id（可选）：填了才会在触发事件上标注「哪个招式触发的」（轴编辑器块级可视化用） */
  moveId?: string
  /** 原始动作索引（可选）：编辑器把积蓄槽快照映射回动作块用 */
  srcIndex?: number
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
  /** 触发来源招式（动作带 moveId 时回填） */
  moveId?: string
  /**
   * 稳定 id：`${windowIndex}:${基础元素}:${序数}`。轴条目 suppressedTriggers 引用该 id——
   * 被抑制的触发不生效且满槽保持（模拟施加者后台/CD 无法结算触发），可在编辑器恢复。
   */
  id?: string
}

/** 动作完成后的积蓄槽快照（用户口径：每个动作块末尾显示对应积蓄槽状态） */
export interface InStunGaugeSnapshot {
  windowIndex: number
  /** 原始动作索引（InStunAction.srcIndex 回传） */
  srcIndex?: number
  /** 各元素槽占第一管百分比（0-100，超满截断到 100） */
  pct: Record<string, number>
}

export interface InStunAnomalyResult {
  triggers: InStunTrigger[]
  /** 每窗各元素异常覆盖占比（0-1；key=element，仅含有覆盖的元素） */
  coveragePerWindow: Array<Record<string, number>>
  /** 每个动作块完成后的积蓄槽状态快照 */
  gaugeSnapshots: InStunGaugeSnapshot[]
  note: string
}

interface SlotEvent {
  element: string
  time: number
  amount: number
  moveId?: string
  srcIndex?: number
  actionIndex: number
}

export function computeInStunAnomalyTimeline(input: {
  windows: InStunWindowInput[]
  /** 窗口时长（秒），coverage 分母与截断用 */
  windowDuration: number
  /** 阈值系数（bossCoeff × 危局系数），同 simulateTriggerCount 口径 */
  coeff?: number
  /**
   * 被抑制的触发事件 id（`${windowIndex}:${基础元素}:${序数}`）：
   * 满槽保持不触发（施加者后台/CD 无法结算的场景由用户自行判断），编辑器可恢复。
   */
  suppressedTriggerIds?: string[]
}): InStunAnomalyResult {
  const windowDuration = Math.max(0, input.windowDuration)
  const coeff = input.coeff && input.coeff > 0 ? input.coeff : 1
  const suppressed = new Set(input.suppressedTriggerIds ?? [])
  const triggers: InStunTrigger[] = []
  const coveragePerWindow: Array<Record<string, number>> = []
  const gaugeSnapshots: InStunGaugeSnapshot[] = []

  // 窗口独立模拟（2026-08-24 用户口径）：跨出窗口是非失衡期且未建模，下次失衡拿不到
  // 先前状态——每窗仅按条目声明的 entryStates 初始化，无跨窗余量/状态继承。
  for (let w = 0; w < input.windows.length; w++) {
    const win = input.windows[w]
    const gauges = new Map<string, number>()
    const activeUntil = new Map<string, number>()
    for (const st of win.entryStates ?? []) {
      gauges.set(st.element, Math.max(0, st.gauge))
    }

    // 展开动作 → 槽事件序列（积蓄按时长均摊；瞬发记起点）
    const slotEvents: SlotEvent[] = []
    for (let ai = 0; ai < (win.actions?.length ?? 0); ai++) {
      const act = win.actions![ai]
      const n = Math.max(0, Math.floor(act.count))
      if (n <= 0 || act.perHitBuildUp <= 0) continue
      const dur = Math.max(0, act.duration ?? 0)
      for (let i = 0; i < n; i++) {
        // 命中按动作时长末对齐分布：积蓄在动作结束点才攒满——触发事件附着在动作末尾（用户口径）
        const t = dur > 0 ? (act.startTime ?? 0) + dur * ((i + 1) / n) : (act.startTime ?? 0)
        slotEvents.push({ element: act.element, time: t, amount: act.perHitBuildUp, moveId: act.moveId, srcIndex: act.srcIndex ?? ai, actionIndex: ai })
      }
    }
    slotEvents.sort((a, b) => a.time - b.time)
    const actionTotals = new Map<number, number>()
    for (const ev of slotEvents) actionTotals.set(ev.actionIndex, (actionTotals.get(ev.actionIndex) ?? 0) + 1)
    const actionDone = new Map<number, number>()

    let cursor = 0
    const coverage: Record<string, number> = {}
    // 同一元素同一窗的触发序数（含被抑制的提案，保证 id 稳定）；被抑制后满槽封顶不再提案
    const ordinalByEl = new Map<string, number>()
    const saturated = new Set<string>()

    const snapshotIfActionDone = (ev: SlotEvent, triggeredHere: boolean) => {
      const done = (actionDone.get(ev.actionIndex) ?? 0) + 1
      actionDone.set(ev.actionIndex, done)
      if (done !== actionTotals.get(ev.actionIndex)) return
      const pct: Record<string, number> = {}
      for (const [key, g] of gauges) {
        const th = (BUILDUP_THRESHOLD_TABLE[key] ?? BUILDUP_THRESHOLD_TABLE.ice)[0] * coeff
        pct[key] = th > 0 ? Math.min(100, Math.round((g / th) * 1000) / 10) : 0
      }
      if (triggeredHere) pct[getBaseElement(ev.element)] = 0
      gaugeSnapshots.push({ windowIndex: w, srcIndex: ev.srcIndex, pct })
    }

    for (const ev of slotEvents) {
      const base = getBaseElement(ev.element)
      // 结算 [cursor, ev.time] 的覆盖时长
      for (const [el, until] of activeUntil) {
        const overlap = Math.max(0, Math.min(until, windowDuration) - Math.min(cursor, windowDuration))
        coverage[el] = (coverage[el] ?? 0) + overlap
      }
      cursor = ev.time

      const g = (gauges.get(base) ?? 0) + ev.amount
      gauges.set(base, g)

      const thresholds = BUILDUP_THRESHOLD_TABLE[base] ?? BUILDUP_THRESHOLD_TABLE.ice
      const full = thresholds[0] * coeff
      let triggeredHere = false
      if (g >= full && !saturated.has(base)) {
        const ordinal = (ordinalByEl.get(base) ?? 0) + 1
        ordinalByEl.set(base, ordinal)
        const id = `${w}:${base}:${ordinal}`
        if (suppressed.has(id)) {
          saturated.add(base) // 已满槽且被抑制：保持满槽不触发，积蓄浪费
        } else {
          triggers.push({ windowIndex: w, element: ev.element, offsetSeconds: ev.time, moveId: ev.moveId, id })
          activeUntil.set(base, ev.time + (ANOMALY_DURATION[base] ?? 10))
          gauges.set(base, 0) // 触发块清空满槽，下一波重新积蓄尝试
          triggeredHere = true
        }
      }
      // 动作末尾槽状态快照：触发事件附着在动作末尾——取触发结算后的槽（清空后）
      snapshotIfActionDone(ev, triggeredHere)
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
  }

  return {
    triggers,
    coveragePerWindow,
    gaugeSnapshots,
    note: `逐窗独立积蓄槽模拟：每窗按条目声明初始化（无跨窗继承），满槽经触发块清空并触发异常；被抑制的触发保持满槽。`,
  }
}

// ============ Boss 异常状态轴（2026-08-24 用户指令） ============
//
// 用户口径：极性紊乱看「当前时间点」目标处于什么属性异常状态，就触发对应效果；
// 不同属性异常在已有时状态下触发 = 紊乱并**替换**状态；风化保持不变（独立覆盖层，
// 不参与替换、也不被替换）。本函数把 v2 时间线的触发序列推进成逐窗状态链。

/**
 * Boss 进窗初始异常状态选项（用户口径 v2 需求②「可指定进入窗口时的异常状态」）。
 * 机制设置键 `boss.entryAnomaly`，存 number 索引（设置存储为 number），0=无。
 */
export const BOSS_ENTRY_ANOMALY_OPTIONS: ReadonlyArray<{ value: number; element: string }> = [
  { value: 0, element: '' },
  { value: 1, element: 'fire' },
  { value: 2, element: 'electric' },
  { value: 3, element: 'ice' },
  { value: 4, element: 'ether' },
  { value: 5, element: 'physical' },
  { value: 6, element: 'wind' },
]

/** 设置索引 → 初始状态元素（''=无） */
export function bossEntryAnomalyElement(settingValue: number): string {
  return BOSS_ENTRY_ANOMALY_OPTIONS.find(o => o.value === settingValue)?.element ?? ''
}

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
  /** 替换型紊乱点：time=相对该窗口起点的秒；element = **被替换的原状态**元素（「当前时点的状态」口径，如需改新状态一行可翻） */
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

/** 窗口边界强制状态注入（用户口径：每次失衡都是中间态——轴条目声明敌方以什么状态进入该段失衡） */
export interface BoundaryStateInjection {
  windowIndex: number
  element: string
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
  /**
   * 窗口边界强制状态注入（轴条目声明「以什么状态进入该段失衡」；不记紊乱，风化走覆盖层）。
   * 每个窗口独立模拟：未声明的窗口开局无状态——跨窗继承已按用户口径移除（窗口外未建模）。
   */
  boundaryStates?: BoundaryStateInjection[]
}): BossAnomalyStateResult {
  const D = Math.max(0, input.windowDuration)
  const durOf = (el: string) => ANOMALY_DURATION[getBaseElement(el)] ?? 10

  const chainsPerWindow: BossStateSegment[][] = []
  const windPerWindow: BossStateSegment[][] = []
  const disorders: BossAnomalyStateResult['disorders'] = []

  // 逐窗独立：每窗从边界声明（或空）开始，窗内触发演化，不与相邻窗互通
  for (let w = 0; w < Math.max(1, input.windowCount); w++) {
    const chain: BossStateSegment[] = []
    const windSegs: BossStateSegment[] = []
    let std: ActiveInterval | null = null
    let windEnd = -1

    const applyWind = (t: number, el: string) => {
      if (windEnd >= t) windSegs[windSegs.length - 1].end = t + durOf(el)
      else windSegs.push({ start: t, end: t + durOf(el), element: el })
      windEnd = windSegs[windSegs.length - 1].end
    }

    const bounds = (input.boundaryStates ?? []).filter(b => b.windowIndex === w)
    if (bounds.length > 0) {
      const b = bounds[bounds.length - 1]
      const base = getBaseElement(b.element)
      if (base === 'wind') {
        applyWind(0, b.element)
      } else {
        std = { start: 0, end: durOf(b.element), element: b.element }
        chain.push(std)
      }
    }

    const trigs = input.triggers
      .filter(t => t.windowIndex === w)
      .sort((a, b) => a.offsetSeconds - b.offsetSeconds)
    for (const trig of trigs) {
      const t = trig.offsetSeconds
      const base = getBaseElement(trig.element)
      if (base === 'wind') {
        // 风化保持不变：独立层激活/刷新，不动标准槽
        applyWind(t, trig.element)
        continue
      }
      if (!std || std.end <= t) {
        // 无活跃状态（含过期后重激活）：不算紊乱
        std = { start: t, end: t + durOf(trig.element), element: trig.element }
        chain.push(std)
        continue
      }
      if (getBaseElement(std.element) === base) {
        std.end = t + durOf(trig.element) // 同元素刷新
        continue
      }
      // 替换型紊乱：归因取被替换的原状态（当前时点状态），随后状态切到新元素
      disorders.push({ windowIndex: w, time: t, element: std.element })
      std.end = t // 截断原状态时段，避免新旧重叠
      std = { start: t, end: t + durOf(trig.element), element: trig.element }
      chain.push(std)
    }
    // 截断到窗口时长内展示（状态本身只在本窗有意义——跨窗继承已移除）
    for (const seg of [...chain, ...windSegs]) seg.end = Math.min(seg.end, D)
    chainsPerWindow.push(chain.filter(s => s.end - s.start > 1e-9))
    windPerWindow.push(windSegs.filter(s => s.end - s.start > 1e-9))
  }

  return {
    stateChainsPerWindow: chainsPerWindow,
    windOverlayPerWindow: windPerWindow,
    disorders,
    note: `Boss 异常状态轴：逐窗独立模拟（跨窗继承已按用户口径移除）；不同属性异常触发即紊乱并替换状态（归因取原状态）；风化为独立覆盖层。共 ${disorders.length} 次替换型紊乱。`,
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
