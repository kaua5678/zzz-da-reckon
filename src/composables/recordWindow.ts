/**
 * 便携记录小窗 · 读数核心（单一事实源：指标口径、基准 Δ、行标签）。
 *
 * ## 为什么有这个模块
 * 用户原话（2026-10-09）：「比如我要换个配置看伤害变化，就可以在操作页操作，小窗看伤害变化」
 * ——即**跨页签常驻的悬浮读数窗**。它必须解决三件事，且三件都不许各写一份：
 *  ① **显示哪些指标**：直接吃 `freeCompare/metrics.ts` 的 `METRICS` 注册表（规则 11）。
 *     该注册表的设计判据就是「加一个指标 = 往数组加一行」⇒ 小窗**自动**获得全部新指标，
 *     本文件与组件都不感知具体有哪些指标。
 *  ② **显隐交互**：用户口径「就像筛选器那样」= `seriesFilter.ts#useSeriesFilter`
 *     （默认全可见、只记被关掉的、不允许全关）。本文件只提供**稳定的行 id**（`pickKey`），
 *     筛选实例由组件持有（与自由对比页/时间图表页同款）。
 *  ③ **基准 Δ**：能「以当前为基准」钉一次读数，之后显示 `当前 / 基准 / Δ`，
 *     且 **Δ 的颜色方向读 `MetricDef.higherBetter`** —— 越小越好的指标（前台时间 /
 *     时间预算残差 / 招式截断秒数）变红绿的方向必须反过来。**绝不自己写一套方向判断**
 *     （那正是 `higherBetter` 字段存在的理由，CC-204 已在用它做汇总表着色）。
 *
 * ## ⚠ 性能：本模块只「读」传进来的 calc，绝不自建实例
 * `useResourceCalc()` 每次调用都新建一整套 computed 图（r705 事故：`ImpactChart` 自建第二个实例
 * ⇒ 资源利用率页每次状态变化整条管线跑两遍，重队每遍 430–506ms）。
 * ⇒ 小窗的 calc 由页面（`CalculatorView` 的应用级实例）经 **props** 传入，本模块的每个函数
 *   都只接收 `calc` 参数，模块内**没有** `useResourceCalc()` 调用点（判据：`recordWindow.test.ts`
 *   的源码锁断言）。
 *
 * @fact ui:记录小窗/读数口径 口径: 小窗指标只用 freeCompare/metrics.ts#METRICS（不另造指标表）、显隐只用 seriesFilter 口径、Δ 颜色方向只读 MetricDef.higherBetter；读数由页面经 props 传入的 calc 实例读取，小窗内不得调用 useResourceCalc()（r705：自建第二实例 ⇒ 管线跑两遍） | 据 用户@2026-10-09·口径=「换个配置看伤害变化」+「就像筛选器那样」 | 验 src/composables/__tests__/recordWindow.test.ts | 锚 src/composables/recordWindow.ts#readRecordRows + src/composables/recordWindow.ts#deltaTone | 信 确认
 * ⟳复核: 若 METRICS 的 read 契约或 MetricVector 分量键（TOTAL_KEY/agentId）改变，复核小窗读数与 Δ 方向是否仍成立 | 到期 2026-12-31
 */
import { computed, ref, type ComputedRef, type Ref } from 'vue'
import {
  METRICS,
  TOTAL_KEY,
  formatMetric,
  metricDef,
  type Calc,
  type MetricDef,
  type MetricEnv,
} from '@/composables/freeCompare/metrics'

/**
 * 一行读数 = 「一个指标 × 一个分量」。
 * 分量取 `TOTAL_KEY`（全队）或 `agentId`（perSlot 指标的分人分量）——与 `MetricVector` 的键一一对应。
 */
export interface MetricPick {
  metricId: string
  slot: string
}

/** 行 id：显隐筛选与基准表都用它（指标 id 与分量 id 各自可能含 `|`？不会——但用 `|` 拼仍要能唯一，故两者都不含） */
export function pickKey(pick: MetricPick): string {
  return `${pick.metricId}|${pick.slot}`
}

/** Δ 的方向语义（颜色由消费方按它选令牌，见 `deltaTone`） */
export type DeltaTone = 'good' | 'bad' | 'same' | 'none'

export interface RecordRow {
  key: string
  pick: MetricPick
  def: MetricDef
  /** 当前值；该分量在向量里不存在（如角色已离队）= null ⇒ 显示 `—`，不假装是 0 */
  value: number | null
  formatted: string
  base: number | null
  baseFormatted: string
  delta: number | null
  deltaFormatted: string
  tone: DeltaTone
}

/** 默认读数：首次打开小窗时不该是空窗（用户开箱即见最常看的三项） */
export const DEFAULT_PICKS: ReadonlyArray<MetricPick> = [
  { metricId: 'teamTotalDamage', slot: TOTAL_KEY },
  { metricId: 'dmgPerSecond', slot: TOTAL_KEY },
  { metricId: 'stunCount', slot: TOTAL_KEY },
]

/**
 * Δ 的方向判据。**唯一的颜色方向来源** = `MetricDef.higherBetter`：
 * - `higherBetter: true`（伤害/次数）⇒ Δ > 0 是好事；
 * - `higherBetter: false`（前台时间 / 时间预算残差 / 招式截断秒数）⇒ Δ > 0 是坏事。
 *
 * 「持平」的阈值取**展示精度**而不是 `1e-9`（`bestSeriesIndexByLevel` 用后者是因为它在比名次）：
 * 小窗上 `+0.00` 却染成绿色会让用户以为改动了，而实际读数没动。
 * 展示精度：`digits` 位小数，百分比类再 ×0.01（`formatMetric` 对 `%` 会 ×100）。
 */
export function deltaTone(
  def: Pick<MetricDef, 'higherBetter' | 'digits' | 'unit'>,
  delta: number | null,
): DeltaTone {
  if (delta === null || !Number.isFinite(delta)) return 'none'
  const eps = 0.5 * 10 ** -def.digits * (def.unit === '%' ? 0.01 : 1)
  if (Math.abs(delta) < eps) return 'same'
  return (delta > 0) === def.higherBetter ? 'good' : 'bad'
}

/** 带符号的 Δ 展示（正数补 `+`；百分比 ×100 由 `formatMetric` 负责） */
export function formatDelta(def: MetricDef, delta: number | null): string {
  if (delta === null || !Number.isFinite(delta)) return '—'
  const body = formatMetric(def, Math.abs(delta))
  if (body === '—') return body
  return delta > 0 ? `+${body}` : delta < 0 ? `-${body}` : body
}

/** 一行读数的展示名：`指标名` 或 `指标名 · 角色名`（全队分量不加后缀） */
export function pickLabel(def: MetricDef, pick: MetricPick, nameOf: (agentId: string) => string): string {
  return pick.slot === TOTAL_KEY ? def.label : `${def.label} · ${nameOf(pick.slot)}`
}

/**
 * 读一批读数（**纯读**：只碰传进来的 calc，不写任何 store）。
 * 未登记的指标 id 静默跳过——存档里的旧 id 不该让整窗崩掉（迁移在 `normalizePicks`）。
 */
export function readRecordRows(
  calc: Calc,
  env: MetricEnv,
  picks: ReadonlyArray<MetricPick>,
  baseline: ReadonlyMap<string, number> | null,
): RecordRow[] {
  const rows: RecordRow[] = []
  for (const pick of picks) {
    const def = metricDef(pick.metricId)
    if (!def) continue
    const vector = def.read(calc, env)
    const raw = vector[pick.slot]
    const value = Number.isFinite(raw) ? raw : null
    const key = pickKey(pick)
    const base = baseline?.get(key) ?? null
    const delta = value === null || base === null ? null : value - base
    rows.push({
      key,
      pick,
      def,
      value,
      formatted: value === null ? '—' : formatMetric(def, value),
      base,
      baseFormatted: base === null ? '—' : formatMetric(def, base),
      delta,
      deltaFormatted: formatDelta(def, delta),
      tone: deltaTone(def, delta),
    })
  }
  return rows
}

/**
 * 小窗读数 composable：把「当前读数 + 基准 + Δ」收成一条链。
 * `picks` 用 getter 传（响应式）；`baseline` 由本 composable 持有（组件不再自己管一份 Map）。
 */
export function useRecordRows(
  calc: () => Calc,
  env: () => MetricEnv,
  picks: () => ReadonlyArray<MetricPick>,
): {
  rows: ComputedRef<RecordRow[]>
  hasBaseline: ComputedRef<boolean>
  /** 以当前读数钉住基准 */
  capture: () => void
  clearBaseline: () => void
} {
  const baseline: Ref<ReadonlyMap<string, number> | null> = ref(null)
  const rows = computed(() => readRecordRows(calc(), env(), picks(), baseline.value))
  return {
    rows,
    hasBaseline: computed(() => baseline.value !== null),
    capture: () => {
      baseline.value = new Map(rows.value.filter(r => r.value !== null).map(r => [r.key, r.value!]))
    },
    clearBaseline: () => { baseline.value = null },
  }
}

/**
 * 存档读回时的形态校验（小窗设置存 localStorage，见 `stores/ui.ts`）：
 * 逐条剔掉不是 `{ metricId: string, slot: string }` 的项与**已不在注册表里**的指标 id
 * （指标被改名/删除后旧存档不该让窗口显示空行）。
 * 全部无效 ⇒ 回落 `DEFAULT_PICKS`（不返回空数组：空窗分不清「筛没了」还是「没数据」）。
 */
export function normalizePicks(raw: unknown): MetricPick[] {
  if (!Array.isArray(raw)) return [...DEFAULT_PICKS]
  const out: MetricPick[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const { metricId, slot } = item as Partial<MetricPick>
    if (typeof metricId !== 'string' || typeof slot !== 'string') continue
    if (!metricDef(metricId)) continue
    if (out.some(p => p.metricId === metricId && p.slot === slot)) continue
    out.push({ metricId, slot })
  }
  return out.length > 0 ? out : [...DEFAULT_PICKS]
}

/** 勾选清单的一项（形状写两处以上 ⇒ 就地起名，判据 29） */
interface MetricPickOption {
  metricId: string
  slot: string
  label: string
  group: string
}

/** 指标勾选清单（设置弹层用）：`METRICS` 全量 × 队伍槽位（perSlot 指标才有角色分量） */
export function metricPickOptions(
  team: ReadonlyArray<{ agentId: string; slot: number }>,
  nameOf: (agentId: string) => string,
): MetricPickOption[] {
  const out: MetricPickOption[] = []
  const members = team.filter(c => !!c.agentId)
  for (const metric of METRICS) {
    out.push({ metricId: metric.id, slot: TOTAL_KEY, label: `${metric.label} · 全队`, group: metric.label })
    if (metric.scope !== 'perSlot') continue
    for (const member of members) {
      out.push({
        metricId: metric.id,
        slot: member.agentId,
        label: `${metric.label} · ${nameOf(member.agentId)}`,
        group: metric.label,
      })
    }
  }
  return out
}
