/**
 * 命座提升率分析（逐级影画的伤害增量 + 死数据自检）
 *
 * 从 `views/ResourceUtilizationPage.vue` 抽出来的原因：这段逻辑是本项目**最高频事故类型**
 * （「机制录了但没接进计算」）的唯一检测器，AGENTS 规则 5 却只能靠人去页面上肉眼找橙色
 * 「⚠无变化」角标。埋在 .vue 里意味着测试用不了它。抽到这里后：
 * - 页面照旧调用（展示逐级提升率 + 自检角标）；
 * - 测试可以直接调用，把「命座必须有效果」变成红灯（见 `__tests__/cinemaUplift.test.ts`；
 *   另有零成本的全角色版不变量在 `allAgentsSweep.test.ts`）。
 *
 * 口径（沿用页面原实现，未改数值语义）：
 * - **固定失衡次数**：命座提升率 = 只变命座的同场景对比。3/5 命的技能等级会抬失衡值 →
 *   失衡次数联动放大成 20%+ 的假提升（失衡次数↑ → 连携/喧响↑ → 失衡总量自激，阈值无稳定点），
 *   因此用 `enemy.stunCountLock` 把失衡次数锁在当前收敛值上再逐级对比。
 * - **多指标栏（R1，`docs/REQUIREMENTS.md`）**：除伤害外再给 失衡值 / 积蓄 / 喧响 / 能量 等栏，
 *   栏位定义与中文列名的单一事实源是 `CINEMA_METRICS`；读数与伤害**同在那个锁定场景内**取，
 *   保证「同场景、同固定条件」。**失衡栏用失衡值总量而不是失衡次数**——次数正是被锁的量，
 *   实测 3 队里 2 队逐级 Δ 恒为 0（选谁进栏的探针证据见 `docs/mcp-cinema-uplift-multi-metric.md` §2）。
 * - **口径统一（本次改动，2026-09-26）**：`ultBefore/ultAfter`（全队大招次数）原先在**解锁**后读，
 *   与伤害的锁定场景不一致；现改为与伤害/新增栏同在锁定场景内读。三态自检（`warn`）只依赖
 *   `changedFields` 与 `gainPct`，**不受影响**；页面上「全队大招 X→Y」的数字在部分队伍会变。
 *   回退点：把 `readScene()` 里的 `ult` 移回锁外单独读一次即可（见交接文档 §5）。
 * - **自检三态**：`ok` = 局内面板有字段变化；`execLevel` = 面板无变化但伤害有移动（含负号——
 *   资源侧联动可能被时间预算抵消，如卢西娅C4帷幕喧响，命座定案 2026-08）
 *   （执行级效果：moveId 增伤/暴伤/附伤，正常）；`unimplemented` = 面板无变化且伤害无提升
 *   （效果可能完全没接进计算 —— 需要人看的信号）。
 *
 * 现场隔离（CC-347，2026-10）：`analyzeCinemaUplift` 只在调用方给的独立场景（`AnalysisContext`，
 * 见 `analysisScenario.ts`）里改命座等级 / stunCountLock 并读该场景的 `calc`，**不碰 UI store**；
 * 迁移前它直接改 UI configStore、靠页面传入的三个读数闭包读 UI 现场、finally 再恢复。
 */
import { getPanelStat } from '@/utils/panelStat'
import { fmt } from '@/utils/format'
import { nextTick } from 'vue'
import { useCatalogStore } from '@/stores/catalog'
import type { AnalysisContext } from '@/composables/analysisScenario'
import { isBatchAborted, type BatchControl } from '@/composables/batchTask'
import type { ResourceCalc } from '@/composables/useResourceCalc'
import { computePanelPhases } from '@/composables/resourceCalc/panelPhases'
import { bindPoolStore, computeCinemaBreakdown, formulaRoleOf, isExecPanelStat } from '@/composables/cinemaUpliftBreakdown'
import type { DamagePoolContext } from '@/composables/resourceCalc/damagePool'
import {
  compareAtSameK,
  sameKBand,
  scanKFrontier,
  type KFrontier,
  type SameKBand,
  type SameKComparison,
} from '@/composables/cinemaUpliftFrontier'
import type { PanelValues } from '@/types/catalog'
import type { AnomalyPoolResult, CharacterResourceResult, StunPoolResult } from '@/types/resource'

/** 三分区分解在页面上的**一行**（数字口径全部来自 cinemaUpliftBreakdown，页面不重算 —— 规则 11） */
export interface CinemaUpliftBreakdown {
  /** 资源型 %（次数/能量/喧响/失衡换来） */
  resourcePct: number
  /** 执行级 %（招式/倍率/附伤/新招式行） */
  execPct: number
  /** 属性型 %（在**新资源基线**上乘的面板属性增益） */
  attrPct: number
  /** 组成标签（'ATTR' / 'RESOURCE+EXEC+ATTR' / 'NONE' …） */
  tier: string
  /** 三段商没法定义（旧池某种伤害彻底消失）⇒ 读数不可逐段解读 */
  coupled: boolean
  /** 本级只出现的新招式行数（结构型执行级的机器读数） */
  newRowCount: number
  /**
   * 走资源管线的白名单字段（公式上是乘区、实测面板增益 ≈ 0，因为效果体现在**次数**上）。
   * 非空 ≠ 缺陷：它们的收益已计在资源/执行段（见 `cinemaUpliftBreakdown#CinemaBreakdown`）。
   */
  attrFieldsViaResource: string[]
}

export interface CinemaUpliftEntry {
  /** 目标命座等级（本条 = 从 to-1 升到 to） */
  to: number
  /**
   * **本队伤害提升率**（口径 = 自由收敛，即玩家不锁失衡次数时看到的数）。
   * 用户 2026-11-05 裁决「还是不锁吧」：锁口径会把命座的三条真实收益（加速失衡/加速积蓄/新招式）全清零
   * —— 那一栏保留在 `lockedGainPct`，本栏是自由口径。
   */
  gainPct: number
  /**
   * **本队伤害 X→Y（确切值 + 同条件对照）**——用户 2026-11-06 口径「用户可能想要的是当前情况的一个确切值」。
   *
   * 只在调用方传 `frontier: true` 时提供（每次逐级扫描 = `maxK + 1` 次完整外层求值，不默认开）：
   * - `before` / `after` = **交付点**的伤害（= 前沿点，见 `cinemaUpliftFrontier#pickDelivery`）；
   * - `gainPct` = 由交付点算的提升率（与上面的 `gainPct`（收敛停点口径）可能不同——差值就是交付点漂移）；
   * - `sameK` = **同窗数对照**（把两级钉在同一个 K 上比），回答「不改操作强度，加这一级多打多少」；
   * - `attribution` = 归因一行（含所用 K 与前沿值）。
   */
  frontier?: CinemaUpliftFrontierEntry

  /** 本级命座切换前后的全队终结技总次数（检测加喧响/加能量类命座是否推动大招 +1） */
  ultBefore: number
  ultAfter: number
  /** 本级命座切换前后该角色局内面板有变化的字段（无字段变化 = 效果可能未接进计算） */
  changedFields: string[]
  /** 自检结论：ok 有字段变化 / execLevel 无面板变化但伤害有移动（含负号）/ unimplemented 疑似未实现 */
  warn: 'ok' | 'execLevel' | 'unimplemented'
  /**
   * R1 附加指标栏（失衡值/积蓄/喧响/能量…），顺序与 `CINEMA_METRICS` 一致。
   * 未传 `readMetrics` 时为空数组（既有调用方与既有测试零改动）。
   */
  metrics: CinemaUpliftMetric[]
  /**
   * **三分区分解**（用户 2026-11-05 裁决）：资源型 / 执行级 / 属性型三段，由引擎三反事实算出
   * （`cinemaUpliftBreakdown#computeCinemaBreakdown`）。同一份分解也决定 `warn`——见该模块头注释。
   * 恒等式：`(1+resource)(1+exec)(1+attr) = 1+gainPct`。
   */
  breakdown: CinemaUpliftBreakdown
}

/**
 * 一级命座的**前沿口径**读数（用户 2026-11-06：「用户可能想要的是当前情况的一个确切值」+「同条件对照」）。
 *
 * 三条量分工（页面主读数三行就是这三条，规则 11：页面不重算）：
 * 1. `beforeDmg → afterDmg`（`pct`）= **本队伤害 X→Y**：两级各自的**交付点**（前沿点）之间的比；
 * 2. `sameK.pct` = **同窗数对照**：把两级钉在**同一个 K**（= 前一级的交付 K）上比；
 * 3. `attribution` = **归因一行**：所用 K 与两个前沿值。
 *
 * ⚠ 三条必须一起给：只有 (1) 时读者无法判断「提升是因为命座，还是因为引擎把这一级交付到了更值钱的 K」；
 * 只有 (2) 时读者看到的是「同样的操作强度」但可能不是任何一级的最优点。
 */
export interface CinemaUpliftFrontierEntry {
  /** 前一级（C_{to-1}）的交付点 */
  beforeK: number
  beforeDmg: number
  /** 后一级（C_to）的交付点 */
  afterK: number
  afterDmg: number
  /** 交付点之间的提升率（%）；与 `CinemaUpliftEntry.gainPct` 的差 = 交付点漂移 */
  pct: number
  /** 两级各自相对自己**收敛停点**的漂移（%；0 = 引擎交付点已经是前沿点） */
  beforeDriftPct: number
  afterDriftPct: number
  /** 交付点来源（`converged` = 收敛停点已最优；`pinned` = 前沿扩展选中了别的 K） */
  beforeSource: 'converged' | 'pinned'
  afterSource: 'converged' | 'pinned'
  /** **同窗数对照**（`k` = 前一级的交付 K） */
  sameK: SameKComparison
  /**
   * **同 K 提升的整条分布**（用户 2026-11-07：「正确的显示不是挑选好看或者不好看的交付点数字展示，
   * 而是在整个面板显示完整的提升分布」）。
   *
   * `sameK` 只给一个 K（前一级的交付 K）⇒ 100/105 队那个稳定的 +11% 被压成一个数，
   * 而 5/105 「丢窗」队的两面性（同 K 仍 +13.8%、交付口径只剩 +6.5%）被藏成一个负号。
   * 本字段逐 K 给提升率 + 可行性三态，页面画分布条。
   */
  band: SameKBand
  /**
   * **逐槽 Δ%**（用户 2026-11-07 口径：主 C 自己涨跌看不见）。
   *
   * 数据 = 两个**交付帧**的 `damagePoolRows` 按 `slot` 求和（同一帧内取，不另做求值）。
   * 恒等式：`Σ slots.delta === afterDmg − beforeDmg`（`teamTotalDamage` 的定义就是 Σ 行伤害，
   * 判据 `cinemaUpliftSlots.test.ts`）。**不做**的：把主读数换成主 C 口径（那会让「队伍总伤害」失真）。
   */
  slots: CinemaSlotDelta[]
  /** 该行分析的是哪个槽位（= 本行的命座被切换的那个槽，页面块标题同名） */
  analyzedSlot: number
  /** 一行「本槽 / 队友」读数（页面只印；缺队友或本槽无伤害时为空串） */
  slotSummary: string
  /** 逐槽明细（悬浮提示用，多行字符串） */
  slotDetail: string
  /**
   * **交付点 K 的移动**（"掉窗 K3→K2（同 K2 仍 +9.4%）" / "增窗 K2→K3" / ""）。
   *
   * 存在的理由：主读数「本队伤害 X→Y（Δ%）」在丢掉一个窗时会是负的，而读者无法从这一个数
   * 分辨「命座让队伍变弱」与「这个命座把操作强度从 3 窗降到了 2 窗、同 K 仍然是涨的」。
   * 实测（2026-11-07 全库 105 队 × C0..C6）：交付点掉窗的级 = 2 条负值（−10.14% / −4.20%），
   * 同 K 口径分别是 +9.4% / +9.9%。⇒ 这句话必须与主读数**同一行**，不能只躺在归因行里。
   */
  deliveryNote: string
  /** 归因一行（页面直接印，不自己拼字符串） */
  attribution: string
  /** 两次扫描的物理输入（窗长 / 有效战斗时间，秒）——归因的下钻面 */
  windowDuration: number
  effectiveTime: number
  /** 前一级的可行点数 / 扫描行数（0 可行 = 前沿扩展无从谈起，如实上报） */
  beforeFeasibleCount: number
  afterFeasibleCount: number
}

/**
 * **交付点 K 移动的一句话**（`掉窗 K3→K2（同 K2 仍 +9.4%）` / `增窗 K2→K3` / `''`）。
 *
 * 抽成纯函数是为了让「掉窗」这条分支有独立判据：2026-11-07 连续失衡落地后，交付点掉窗的级从 9 条
 * 掉到几乎为零（攒不满的 K 现在按「末窗截短」兑现），**没有真实预设再走这条分支**——
 * 但预算类不可行仍会掉窗，字符串不能没有判据。
 */
export function buildDeliveryNote(beforeK: number, afterK: number, sameK: SameKComparison): string {
  if (afterK === beforeK) return ''
  if (afterK > beforeK) return `增窗 K${beforeK}→K${afterK}`
  const same = sameK.pct === null ? '' : `（同 K${sameK.k} 仍 ${signed1(sameK.pct)}%）`
  return `掉窗 K${beforeK}→K${afterK}${same}`
}

/**
 * 一个槽位的伤害增量（两个**交付帧**之间）。
 *
 * `pct` 为 `null` = 该槽在前一帧没有伤害（分母 0）⇒ 「不可比」，**不是 0**（§4.2 判据②）。
 */
export interface CinemaSlotDelta {
  slot: number
  before: number
  after: number
  /** after − before（绝对伤害） */
  delta: number
  pct: number | null
}

/** 两个交付帧的逐槽伤害 → 逐槽 Δ（纯函数，页面与测试共用；规则 11） */
export function computeSlotDeltas(before: readonly number[], after: readonly number[]): CinemaSlotDelta[] {
  const n = Math.max(before.length, after.length)
  const out: CinemaSlotDelta[] = []
  for (let slot = 0; slot < n; slot++) {
    const b = before[slot] ?? 0
    const a = after[slot] ?? 0
    out.push({ slot, before: b, after: a, delta: a - b, pct: b > 0 ? ((a - b) / b) * 100 : null })
  }
  return out
}

/** 一行「本槽 / 队友」读数：队友 = 其余槽位**合计**后的增量（合计算 pct，不是各槽 pct 求平均） */
export function buildSlotSummary(slots: readonly CinemaSlotDelta[], analyzedSlot: number): string {
  const main = slots.find(s => s.slot === analyzedSlot)
  const mates = slots.filter(s => s.slot !== analyzedSlot && (s.before > 0 || s.after > 0))
  const parts: string[] = []
  if (main && main.pct !== null) parts.push(`本槽 ${signed1(main.pct)}%`)
  if (mates.length > 0) {
    const b = mates.reduce((s, x) => s + x.before, 0)
    const a = mates.reduce((s, x) => s + x.after, 0)
    if (b > 0) parts.push(`队友 ${signed1(((a - b) / b) * 100)}%`)
  }
  return parts.length ? parts.join('｜') : ''
}

/** 逐槽明细（悬浮提示）：每槽 before→after 与 Δ%，并印出「Σ槽 == 全队」的核对值 */
export function buildSlotDetail(
  slots: readonly CinemaSlotDelta[],
  analyzedSlot: number,
  beforeTotal: number,
  afterTotal: number,
): string {
  const lines = slots.map(s => {
    const tag = s.slot === analyzedSlot ? '（本槽）' : ''
    return `槽${s.slot + 1}${tag} ${millions(s.before)}→${millions(s.after)}（${s.pct === null ? '前一帧无伤害，不可比' : `${signed1(s.pct)}%`}）`
  })
  const sumDelta = slots.reduce((s, x) => s + x.delta, 0)
  lines.push(`Σ槽增量 ${millions(sumDelta)} = 全队增量 ${millions(afterTotal - beforeTotal)}（逐槽之和恒等于全队，两数应逐位相同）`)
  return lines.join('\n')
}

export interface CinemaUpliftRow {
  slot: number
  agentId: string
  name: string
  entries: CinemaUpliftEntry[]
}

/** 判定 execLevel 与 unimplemented 的伤害变化阈值（百分比，取绝对值）。零移动才是「未接入」。 */
export const UPLIFT_EPSILON_PCT = 0.05

/** 归因行里的伤害读数：百万级，两位小数（与页面其它伤害读数同精度） */
function millions(v: number): string {
  return `${(v / 1e6).toFixed(2)}M`
}

/** 带符号一位小数（页面与逐槽读数共用一份，避免两处各写一遍舍入口径） */
export function signed1(v: number): string {
  return `${v >= 0 ? '+' : ''}${fmt(v, 1)}`
}

/**
 * **归因一行**（页面主读数第三行；字符串在这里拼，页面只印——规则 11：页面不重算）。
 *
 * 必须含**所用的 K 与两个前沿值**（用户 2026-11-06 完成标准），因为「提升率变了」可能来自两种完全不同的原因：
 * - 真·命座变强 ⇒ 两个交付点的差；
 * - **交付点漂移**（引擎把这一级交付到了另一个 K）⇒ `drift` 段。
 * 读者要能一眼分开这两者，否则「命座提升率」又会变成不可解释的数字。
 */
export function buildFrontierAttribution(
  before: KFrontier,
  after: KFrontier,
  sameK: SameKComparison,
): string {
  const b = before.delivery
  const a = after.delivery
  const driftOf = (d: KFrontier['delivery']): string =>
    d.source === 'pinned' ? `前沿扩展 K${d.convergedK}→K${d.k}（+${d.driftPct.toFixed(1)}%）` : `收敛停点已达前沿`
  const why = ({ budget: `超出时间预算`, contiguous: `窗攒不出`, both: `超预算且窗攒不出`, 'out-of-range': `超出扫描域` } as const)
  const sameKText = sameK.pct === null || sameK.k === null
    ? `同 K${sameK.preferredK} 两级无公共可行操作点（后一级${sameK.preferredReason ? why[sameK.preferredReason] : '不可行'}）`
    : `同 K${sameK.k}${sameK.atPreferred ? '' : `（首选 K${sameK.preferredK} 后一级${sameK.preferredReason ? why[sameK.preferredReason] : '不可行'}）`} ${millions(sameK.beforeDmg)}→${millions(sameK.afterDmg ?? 0)}（${sameK.pct >= 0 ? '+' : ''}${sameK.pct.toFixed(1)}%）`
  return `K${b.k} ${millions(b.dmg)} → K${a.k} ${millions(a.dmg)}｜${driftOf(b)} / ${driftOf(a)}｜${sameKText}｜窗 ${before.windowDuration.toFixed(1)}s／有效 ${before.effectiveTime.toFixed(0)}s`
}

/** 一栏附加指标的显示形态：value=大数量 / count=整数次数 / rate=比率（按百分点显示） */
export type CinemaMetricKind = 'value' | 'count' | 'rate'

export interface CinemaMetricDef {
  /** `collectCinemaMetrics` 返回对象的键 */
  key: string
  /** 中文列名（与游戏内叫法一致，R1 验收项） */
  label: string
  kind: CinemaMetricKind
}

/**
 * 栏位定义 = **页面列顺序 + 中文列名 + 求和口径的单一事实源**（AGENTS 规则 11：跨文件常量只从单一来源引用）。
 *
 * 谁进栏是**引擎实测**决定的，不是推理（探针与逐队 Δ 表见 `docs/mcp-cinema-uplift-multi-metric.md` §2）：
 * - ✅ `totalStunBuildUp`（失衡值总量）3/3 队逐级会动 ⇒ 作「失衡」栏。
 * - ❌ `stunCount`（失衡次数）在锁定场景 3 队里 2 队 Δ 恒 0——它是被 `stunCountLock` 钉死的量，进栏即恒 0，
 *   直接违反 R1 验收「新增栏位不是恒 0」。这就是需求里说的口径冲突，处置 = 方案 B（换不受次数锁影响的量）。
 * - ❌ `chainCountTotal`（连携次数）/ `disorderCount`（紊乱次数）：都由失衡次数派生，3 队里 2 队恒不变；
 *   只有改成「不锁次数」的第二组对比（方案 A）才有意义，代价见文档 §3。
 * - ❌ `derivedEnergy`：实测与 `energySource.total` 逐位相同（类型注释本就要求二者一致，差值≠0 才是回归信号）
 *   ⇒ 进栏是冗余。
 */
export const CINEMA_METRICS: CinemaMetricDef[] = [
  { key: 'stunBuildUp', label: '失衡值', kind: 'value' },
  { key: 'anomBuildUp', label: '积蓄', kind: 'value' },
  { key: 'decibelTotal', label: '喧响', kind: 'value' },
  { key: 'energyTotal', label: '能量', kind: 'value' },
  { key: 'exSpecial', label: '强特次数', kind: 'count' },
  { key: 'anomTriggers', label: '异常触发', kind: 'count' },
  { key: 'coverage', label: '异常覆盖', kind: 'rate' },
]

/** 一栏指标的逐级读数（before/after 都是「全队合计」口径） */
export interface CinemaUpliftMetric {
  key: string
  label: string
  kind: CinemaMetricKind
  before: number
  after: number
  /** after - before；**可为负**（命座的资源侧收益被时间预算抵消，与伤害栏的负增益同族，不是错误） */
  delta: number
  /** 提升率%；before<=0 时为 0（与 gainPct 同口径） */
  pct: number
}

export interface CinemaMetricSource {
  characters: CharacterResourceResult[] | null | undefined
  stunPool: StunPoolResult | null | undefined
  anomalyPool: AnomalyPoolResult | null | undefined
}

/**
 * 从引擎结果收集一帧指标读数。页面与测试**共用这一份**，避免两处各写一套求和口径（规则 11）。
 * 口径：能量/喧响/强特 = 全队逐角色求和；失衡值/异常触发/覆盖率 = 池级总量；积蓄 = 各属性池 totalBuildUp 求和。
 */
export function collectCinemaMetrics(src: CinemaMetricSource): Record<string, number> {
  const chars = src.characters ?? []
  const sum = (f: (c: CharacterResourceResult) => number | undefined) =>
    chars.reduce((s, c) => s + (f(c) ?? 0), 0)
  const perElement = src.anomalyPool?.perElement ?? []
  return {
    stunBuildUp: src.stunPool?.totalStunBuildUp ?? 0,
    anomBuildUp: perElement.reduce((s, p) => s + p.totalBuildUp, 0),
    decibelTotal: sum(c => c.decibelSource.total),
    energyTotal: sum(c => c.energySource.total),
    exSpecial: sum(c => c.exSpecialCount),
    anomTriggers: src.anomalyPool?.totalTriggerCount ?? 0,
    coverage: src.anomalyPool?.coverage.coverageRate ?? 0,
  }
}

/** 两帧读数 → 逐栏 delta/pct。未提供读数（readMetrics 缺省）时返回空数组，保持既有调用方零改动。 */
export function buildCinemaMetrics(
  before: Record<string, number> | null,
  after: Record<string, number> | null,
): CinemaUpliftMetric[] {
  if (!before || !after) return []
  return CINEMA_METRICS.map(def => {
    const b = Number(before[def.key] ?? 0) || 0
    const a = Number(after[def.key] ?? 0) || 0
    return {
      key: def.key,
      label: def.label,
      kind: def.kind,
      before: b,
      after: a,
      delta: a - b,
      pct: b > 0 ? ((a - b) / b) * 100 : 0,
    }
  })
}

/** 锁定场景内的一帧读数（伤害 / 大招 / 附加指标同场景，R1 要求「同场景、同固定条件」） */
export interface SceneReading {
  dmg: number
  ult: number
  metrics: Record<string, number> | null
}

export interface AnalyzeCinemaUpliftOptions {
  /** 锁定的失衡次数（页面传 UI 现场当前收敛的 stunPoolResult.stunCount；<=0 表示不锁） */
  targetStunCount: number
  /**
   * **前沿扩展**（用户 2026-11-06 口径「用户可能想要的是当前情况的一个确切值」）：为每级额外跑一遍
   * 钉 K 扫描，求出两级的**交付点**（= 前沿点）与**同窗数对照**，写进 `entry.frontier`。
   *
   * 成本：每槽 `Σ_{to=0..maxLevel}(maxK + 2)` 次完整外层求值（maxK = `floor(effTime / 窗长)`，实测 6~11）
   * ⇒ 1 槽 6 级约 60~80 次求值。**所以不默认开**：`cinemaUpliftGrid` 的 N×M 采样网格与
   * `allAgentsSweep` 都不开；只有收益分析页那一次显式计算（和本专项判据）会开。
   */
  frontier?: boolean
  /** 要分析的槽位，默认 0/1/2 */
  slots?: number[]
  /** 最高命座等级，默认 6 */
  maxLevel?: number
  /** 角色名解析（页面传 agentNames 映射；缺省回落 catalog 名） */
  resolveName?: (agentId: string, slot: number) => string
  /** 页面「重新计算」/ 离开页面时中止；中止后返回已算完的槽位（未完成的槽位整行丢弃） */
  control?: BatchControl
}

/**
 * 场景当前结果的一帧读数：伤害 / 全队大招次数 / 附加指标（求和口径单源在 `collectCinemaMetrics`）。
 * CC-347 前由页面以 `readDamage / readUltimateTotal / readMetrics` 三个闭包传入（读的是 UI 现场）；
 * 现在三者都是 `calc` 的纯函数，分析器在自己的场景里直接读，调用方不再能传错现场。
 */
export function readCinemaScene(calc: ResourceCalc): SceneReading {
  const characters = calc.resourceResult.value?.characters
  return {
    dmg: calc.teamTotalDamage.value,
    ult: (characters ?? []).reduce((sum, c) => sum + c.ultimateCount, 0),
    metrics: collectCinemaMetrics({
      characters,
      stunPool: calc.stunPoolResult.value,
      anomalyPool: calc.anomalyPoolResult.value,
    }),
  }
}

/**
 * 逐槽位、逐级计算命座提升率与自检结论。
 * 只改写 `scenario.config`（命座等级 / stunCountLock），UI 现场全程不动；场景由调用方 dispose
 * （页面用 `withAnalysisScenario`），所以这里不再有「finally 恢复现场」。
 */
export async function analyzeCinemaUplift(
  scenario: AnalysisContext,
  opts: AnalyzeCinemaUpliftOptions,
): Promise<CinemaUpliftRow[]> {
  const { config, calc } = scenario
  const { targetStunCount, slots = [0, 1, 2], maxLevel = 6, resolveName, control, frontier = false } = opts
  const catalogStore = useCatalogStore()
  const originalCinemas = config.team.map(c => c.cinemaLevel)
  const rows: CinemaUpliftRow[] = []

  /**
   * 锁定失衡次数后读一帧：3/5 命抬技能等级 → 失衡值↑ → 失衡次数联动放大成假提升，
   * 故按「操作够就能打 N 次失衡」的用户口径把次数钉死再比。
   * 伤害 / 大招 / 附加指标同帧读，保证各栏**同场景**（锁的加解锁序列与迁移前逐位一致，结果零差异）。
   */
  /**
   * 锁定失衡次数后读一帧：3/5 命抬技能等级 → 失衡值↑ → 失衡次数联动放大成假提升，
   * 故按「操作够就能打 N 次失衡」的用户口径把次数钉死再比。
   * 伤害 / 大招 / 附加指标同帧读，保证各栏**同场景**（锁的加解锁序列与迁移前逐位一致，结果零差异）。
   *
   * ⚠ **分解快照也在这里读**（2026-11-05 修）：`breakdown` 与 `gainPct` 必须是**同一个现场**。
   * 修前分解在锁窗外单独读 ⇒ 资源型命座（尤其改循环的 6 命）两个口径对不上
   * （实测 1181C6：页面 59.45% vs 分解连乘 71.02%；1011C2：3.65% vs 16.26%）。
   */
  async function readScene(slot: number): Promise<SceneReading & { shot: BreakdownSnapshot }> {
    const target = targetStunCount > 0 ? targetStunCount : -1
    config.enemy.stunCountLock = target
    await nextTick()
    const reading = readCinemaScene(calc)
    const shot = readBreakdownSnapshot(slot)
    config.enemy.stunCountLock = -1
    await nextTick()
    return { ...reading, shot }
  }

  /**
   * 一帧的**分解快照**：伤害池上下文（已绑定该级的命座等级）+ 结算面板。
   *
   * 三者必须同帧取（面板与伤害池必须来自同一次求值，否则分解会拿错现场）。
   * **不读 `teamTotalDamage`**：一是伤害基数由分解自己从同一份上下文重算（逐位相同，见
   * `cinemaUpliftBreakdown#computeCinemaBreakdown` 的 beforeTotal 缺省分支），
   * 二是这里读值发生在**锁窗外**（用户 2026-11-05「不锁吧」的自由口径），
   * 若顺手读一下总伤害，就会撞碎 R1 的「伤害/栏位同在一个锁定场景内」纪律判据。
   */
  interface BreakdownSnapshot {
    ctx: DamagePoolContext
    panels: PanelValues[]
  }
  function readBreakdownSnapshot(slot: number): BreakdownSnapshot {
    const ctx = calc.damagePoolContext.value
    return {
      ctx: bindPoolStore(ctx, { [slot]: config.team[slot]?.cinemaLevel ?? 0 }),
      panels: [...ctx.damagePanels],
    }
  }

  /**
   * 一级命座的**前沿读数**（`frontier` 开启时才有）：扫后一级的钉 K 前沿，与前一级的复用，
   * 取两条交付点之间的差 + 同窗数对照 + 归因一行。
   *
   * ⚠ 扫描**必须在锁窗外**跑（`scanKFrontier` 自己会设/复位 `stunCountLock`）；调用方保证
   * `readScene` 已经把锁复位成 -1（它 finally 段复位）。
   * ⚠ 前一级的前沿**按槽复用**（逐级 0→1→…→6 是链式的）：不复用就要扫 2×maxLevel 条，
   * 复用只要 maxLevel+1 条（实测 1 槽 6 级 6 条 vs 12 条）。
   */
  async function readFrontier(to: number, cachedBefore: KFrontier | null, slot: number): Promise<{ entry: CinemaUpliftFrontierEntry; after: KFrontier } | null> {
    // 复用的前提：缓存的 before 必须真的属于「按 to-1 级、与当前其余配置一致」的那一帧。
    // 缓存由本函数在上一次调用后立即写入，中间只有 readScene（改锁再复位）⇒ 其余配置不变。
    const before = cachedBefore ?? await scanKFrontier(scenario, { cinemaLevel: to - 1, control })
    if (!before) return null
    const after = await scanKFrontier(scenario, { cinemaLevel: to, control })
    if (!after) return null
    const b = before.delivery
    const a = after.delivery
    // 同窗数对照的 K = **前一级的交付 K**（「玩家现在就在这个操作点上」）
    const sameK = compareAtSameK(before, after, b.k)
    // 逐槽 Δ：两个**交付帧**各自的逐槽伤害相减（同一帧内取，不另做求值）
    const slots = computeSlotDeltas(b.slots, a.slots)
    /**
     * 交付点掉窗时必须当场说出来（用户 2026-11-07 的分布口径的另一半）：
     * 主读数一个负数无法区分「命座让队伍变弱」与「命座把操作强度从 3 窗降到 2 窗」。
     * 同 K 提升率非空时一并印出——那就把「掉的是操作强度，不是同 K 收益」钉死了。
     */
    const deliveryNote = buildDeliveryNote(b.k, a.k, sameK)
    return {
      entry: {
        beforeK: b.k,
        beforeDmg: b.dmg,
        afterK: a.k,
        afterDmg: a.dmg,
        pct: b.dmg > 0 ? ((a.dmg - b.dmg) / b.dmg) * 100 : 0,
        beforeDriftPct: b.driftPct,
        afterDriftPct: a.driftPct,
        beforeSource: b.source,
        afterSource: a.source,
        sameK,
        band: sameKBand(before, after),
        slots,
        analyzedSlot: slot,
        slotSummary: buildSlotSummary(slots, slot),
        slotDetail: buildSlotDetail(slots, slot, b.dmg, a.dmg),
        deliveryNote,
        attribution: buildFrontierAttribution(before, after, sameK),
        windowDuration: before.windowDuration,
        effectiveTime: before.effectiveTime,
        beforeFeasibleCount: b.feasibleCount,
        afterFeasibleCount: a.feasibleCount,
      },
      after,
    }
  }

  for (const slot of slots) {
    if (isBatchAborted(control)) break
    const char = config.team[slot]
    if (!char?.agentId) continue
    const name = resolveName?.(char.agentId, slot)
      || catalogStore.getAgent(char.agentId)?.name.zhCN
      || `槽${slot + 1}`
    const entries: CinemaUpliftEntry[] = []

    // CC-338：① C0 基线只求值一次，逐级复用上一档 (after, panelAfter) 作下一档 (before, panelBefore)，
    // 单槽求值次数由 2×maxLevel 降为 maxLevel+1；② 每槽跑完立即把该槽命座恢复为 originalCinemas[slot]，
    // 防止多槽分析（slots=[0,1,2]）时前序槽位留在 C6 污染后续槽位的命座提升率（场景内同样需要）。
    config.setCinemaLevel(slot, 0)
    config.syncTeammateBuffsFromTeam()
    /** 本槽的前沿缓存：`to-1` 那条扫描结果，供 `to` 那一级当 before 复用（链式逐级，见 readFrontier） */
    let frontierCache: KFrontier | null = null
    const beforeScene = await readScene(slot)
    let before = beforeScene
    let panelBefore = computePanelPhases(slot, config, catalogStore, calc.effectiveWEngineCoverages.value, calc.effectiveDiscEffectCoverages.value, calc.effectiveTeammateBuffCoverages.value)?.inCombat ?? null
    // 分解用的 C0 现场 = 与 gainPct **同一次**锁窗内读出的快照（面板数组取结算侧那一份）
    let breakBefore = beforeScene.shot

    for (let to = 1; to <= maxLevel; to++) {
      if (isBatchAborted(control)) return rows
      config.setCinemaLevel(slot, to)
      config.syncTeammateBuffsFromTeam()
      const afterScene = await readScene(slot)
      const after = afterScene
      const panelAfter = computePanelPhases(slot, config, catalogStore, calc.effectiveWEngineCoverages.value, calc.effectiveDiscEffectCoverages.value, calc.effectiveTeammateBuffCoverages.value)?.inCombat ?? null
      const breakAfter = afterScene.shot
      const pb = panelBefore

      const changedFields = pb && panelAfter
        ? Object.keys(panelAfter).filter(k => Math.abs((getPanelStat(panelAfter, k) ?? 0) - (getPanelStat(pb, k) ?? 0)) > 1e-9)
        : []
      const gainPct = before.dmg > 0 ? ((after.dmg - before.dmg) / before.dmg) * 100 : 0
      const metrics = buildCinemaMetrics(before.metrics, after.metrics)
      // 三态判定：面板字段变化 → ok；无面板变化但伤害移动（|gain| ≥ ε，含负号）→ execLevel
      // ——伤害发生符号变化本身就是执行/资源级生效的证据（如卢西娅C4帷幕喧响挤占时间预算，
      // 命座定案 2026-08：预算极紧时可为轻微负增益），不是死数据；零移动才是未接入。
      //
      // 第三条证据（2026-10-25）：**资源指标移动**也算接入。判的是「接没接进计算」，不是「本夹具赚没赚」——
      // 加喧响/加能量的命座要推动「大招次数」这个整数阈值才会进伤害，夹具没跨过阈值时伤害恒 0，
      // 但资源账已经变了（实测 1451 影画四：帷幕喧响每触发 +100/人，伤害零移动被误判成死数据）。
      const metricMoved = metrics.some(m => Math.abs(m.delta) > 1e-6)
      // 三分区分解（用户 2026-11-05 裁决）：同一份分解既出读数，也判「本级到底动了哪条通道」
      const breakdown = computeCinemaBreakdown({
        beforeCtx: breakBefore.ctx,
        afterCtx: breakAfter.ctx,
        beforePanels: breakBefore.panels,
        afterPanels: breakAfter.panels,
        withPanels: (ctx, next) => calc.damagePoolContextWithPanels(next, ctx),
        slots: [slot],
      })
      /**
       * 三态自检（口径随分解升级，2026-11-05）：
       * - `ok` 有面板字段变化 **或** 分解判定面板通道真的动了（`ATTR` 在场）。判据从
       *   「面板有字段变化」换成「分解说了算」的理由：`energyGainEfficiency` 这类**资源通道**字段也长在面板上，
       *   旧判据会把它们记成 ok（1011C1 就是），而它们与属性增益毫无关系。
       * - `execLevel` 面板没动但**执行级或资源**动了——这正是用户点名的「加速失衡/加速积蓄/新招式」那一类。
       * - `unimplemented` 三块全不动（面板/资源/执行都没收益）：效果可能完全没接进计算。
       */
      // 「面板 ok」只认**属性通道**：changedFields 里混着资源通道（能量效率/冲击波…）与倍率类（技能等级），
      // 它们长在面板上却不是属性增益 —— 用 formulaRoleOf 把它们挡在 ok 之外（与分解的判据同源）。
      const attrChannelMoved = breakdown.components.includes('ATTR')
        || changedFields.some(f => formulaRoleOf(f) !== null && !isExecPanelStat(f))
      const warn: CinemaUpliftEntry['warn'] = attrChannelMoved
        ? 'ok'
        : Math.abs(gainPct) >= UPLIFT_EPSILON_PCT || metricMoved || breakdown.components.length > 0
          ? 'execLevel' // 面板无变化但伤害 / 资源 / 执行级有移动：资源型或执行级效果
          : 'unimplemented' // 无字段无伤害无资源移动：效果可能未接进计算
      // 前沿扩展（opt-in，见 AnalyzeCinemaUpliftOptions#frontier）：前一级的前沿按槽复用 ⇒ 每级只扫 1 条
      const frontierRun: { entry: CinemaUpliftFrontierEntry; after: KFrontier } | null =
        frontier ? await readFrontier(to, frontierCache, slot) : null
      if (frontierRun) frontierCache = frontierRun.after
      const frontierEntry = frontierRun?.entry
      entries.push({
        to,
        gainPct,
        frontier: frontierEntry ?? undefined,
        ultBefore: before.ult,
        ultAfter: after.ult,
        changedFields,
        warn,
        metrics,
        breakdown: {
          resourcePct: breakdown.resourcePct,
          execPct: breakdown.execPct,
          attrPct: breakdown.attrPct,
          tier: breakdown.tier,
          coupled: breakdown.coupled,
          newRowCount: breakdown.newRows.length,
          attrFieldsViaResource: breakdown.attrFieldsViaResource,
        },
      })
      before = after
      panelBefore = panelAfter
      breakBefore = breakAfter
    }
    config.setCinemaLevel(slot, originalCinemas[slot] ?? 0)
    config.syncTeammateBuffsFromTeam()
    rows.push({ slot, agentId: char.agentId, name, entries })
  }

  return rows
}
