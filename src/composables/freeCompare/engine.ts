/**
 * 自由对比工作台 · 求值器（唯一碰 store / 引擎的地方）
 *
 * 分层（判据 7 展示层越层 import 棘轮：本文件在 `src/composables/` = 编排层，
 * 页面/组件不许直接 import `@/core`、`@/mechanics`，也不许自己写装配逻辑）：
 * ```
 * metrics.ts   纯读（引擎值 → 数字向量）     零 store 写入
 * axes.ts      纯枚举（系列 → x 档位清单）    零 store 写入
 * engine.ts    装配 store → 求值 → 恢复现场  ← 本文件
 * ```
 *
 * **现场快照/恢复口径**（照抄 `teamCompare.ts#computeTeamComparePoints` 的 `:1029/:1170-1172`，
 * 不另发明）：进函数先 `snapshotStore`，`try/finally` 里 `restoreStore`，跑完不留痕。
 */

import { useConfigStore } from '@/stores/config'
import { useCatalogStore } from '@/stores/catalog'
import { snapshotStore, restoreStore } from '@/composables/teamCompare'
import type { useResourceCalc } from '@/composables/useResourceCalc'
import {
  type AxisId,
  type AxisLevel,
  type AxisOptions,
  type SeriesSpec,
  type SetupCode,
  AXIS_BY_ID,
  DEFAULT_AXIS_ID,
} from './axes'
import { type ConstraintSpec, conditionToCode } from './constraints'
import {
  type MetricDef,
  type MetricEnv,
  type MetricVector,
  TOTAL_KEY,
  metricDef,
} from './metrics'

export type Calc = ReturnType<typeof useResourceCalc>

// ========== 结果 ==========

export interface FreeCompareSeries {
  /** 系列 id（= SeriesSpec.id） */
  id: string
  label: string
  /** 该系列在各 x 档位上的取值（与 `result.levels` 同序） */
  values: Array<number | null>
  /** 未取到值的档位数（如未收敛/跳过） */
  skipped: number
}

export interface FreeComparePoint {
  levelIndex: number
  seriesId: string
  value: number | null
}

export interface FreeCompareResult {
  axisId: AxisId
  axisLabel: string
  levels: AxisLevel[]
  series: FreeCompareSeries[]
  metricId: string
  metricLabel: string
  /** 耗时（毫秒） */
  durationMs: number
  /** 求值次数（档位 × 系列） */
  evaluations: number
  /** 被跳过的次数（未收敛等） */
  skipped: number
}

export interface FreeCompareOptions {
  series: SeriesSpec[]
  axisId: AxisId
  axisOptions?: AxisOptions
  metricId: string
  constraints?: ConstraintSpec
  /** 单人系列挑哪个角色的分量（缺省 = 该系列自己的成员） */
  onProgress?: (p: { pct: number; text: string }) => void
  /** 中断（页面「取消」按钮） */
  shouldAbort?: () => boolean
}

// ========== 装配 ==========

/** 专武 id：音擎的 `ownerAgentId === agentId`（与 `teamCompare.ts:359` 同口径） */
export function signatureWEngineId(catalog: ReturnType<typeof useCatalogStore>, agentId: string): string | null {
  const w = (catalog.displayWEngines ?? []).find(x => x.ownerAgentId === agentId)
  return w ? w.id : null
}

/**
 * 把「角色 + 配置码」装配到 store 的某个槽位。
 *
 * ⚠ **无专武（wengine=0）必须显式写常驻/A 音擎**：`configStore.setAgent` 会自动给角色
 * 推荐专属音擎（`config.ts:594-599` `char.wEngineId = exclusive.id`），不显式覆盖就会
 * 得到「嘴上无专武、身上穿专武」的假结果（数值偏高、零报错）。
 * 这条坑 `computeAutoEnginePicks`（`teamCompare.ts:530-533`）与 `computeOptimalGoldAllocations`
 * （`:651-653`）的注释都是防它 —— 它们只认 `preset.wEngines` 不回读 store，同一个道理。
 *
 * ⚠ 空串 `wEngineId: ''` 是安全的：全仓消费点一律 `char.wEngineId ? getWEngine(...) : undefined`
 * （`resourceCalc/helpers.ts:464/:811/:1659`），不会炸。
 */
function applyCodeToSlot(
  configStore: ReturnType<typeof useConfigStore>,
  catalog: ReturnType<typeof useCatalogStore>,
  slot: number,
  agentId: string,
  code: SetupCode,
  fallbackWEngine: string,
): void {
  configStore.setAgent(slot, agentId)
  configStore.setCinemaLevel(slot, code.cinema)
  if (code.wengine >= 1) {
    const sig = signatureWEngineId(catalog, agentId)
    // 该角色没有专武（A 级/常驻）时退回基础音擎：假装有专武会静默给一个不存在的 id
    const wid = sig ?? fallbackWEngine
    configStore.setWEngine(slot, wid)
    configStore.setWEngineModLevel(slot, Math.max(1, Math.min(5, code.wengine)))
  } else {
    // 无专武：显式穿下位（fallback 由调用方给，缺省 '' = 裸奔，引擎按无音擎算）
    configStore.setWEngine(slot, fallbackWEngine)
    configStore.setWEngineModLevel(slot, 1)
  }
}

/** 装配时的下位音擎兜底：优先角色所属「常驻/A」池里的第一件，否则空串（引擎按无音擎算） */
function fallbackFor(catalog: ReturnType<typeof useCatalogStore>, agentId: string): string {
  const agent = catalog.getAgent(agentId)
  if (!agent) return ''
  const same = (catalog.displayWEngines ?? []).find(
    w => !w.ownerAgentId && w.specialty === agent.specialty && w.rarity !== 'S',
  )
  return same?.id ?? ''
}

// ========== 主入口 ==========

/**
 * 跑一次自由对比。
 *
 * 复杂度：档位数 × 系列数 次全量引擎求值（单次 ~0.3-0.4s，见 `TeamComparePage.vue` 注释
 * 「每队 ~10 次 ≈ 3~4 秒」推算）⇒ **默认要给出代价预告**，别让用户点下去才知道要等一分钟。
 */
export async function computeFreeCompare(
  calc: Calc,
  options: FreeCompareOptions,
): Promise<FreeCompareResult> {
  const started = Date.now()
  const configStore = useConfigStore()
  const catalog = useCatalogStore()

  const axis = AXIS_BY_ID.get(options.axisId) ?? AXIS_BY_ID.get(DEFAULT_AXIS_ID)!
  const metric = metricDef(options.metricId)
  if (!metric) throw new Error(`[freeCompare] 未注册的指标 id: ${options.metricId}`)
  // 提前解包：TS 的窄化跨不过下面的闭包（`finalize` 会读它），显式收成一个非空的局部常量
  const m: MetricDef = metric

  const snap = snapshotStore(configStore)
  const cs = options.constraints ?? {}
  const env: MetricEnv = { hp: configStore.enemy.hp ?? 0 }

  const series = options.series
  // 档位按第一个系列枚举（x 维度与系列无关 ⇒ 取任一即可，取第一个保证 label 稳定）
  const levels = series.length > 0 ? axis.levels(series[0], options.axisOptions ?? {}) : []

  const out: FreeCompareSeries[] = series.map(s => ({
    id: s.id,
    label: '',
    values: new Array(levels.length).fill(null),
    skipped: 0,
  }))
  let evaluations = 0
  let skipped = 0

  try {
    for (let si = 0; si < series.length; si++) {
      const spec = series[si]
      const nameOf = (id: string) => catalog.getAgent(id)?.name.zhCN ?? id
      out[si].label = seriesLabelOf(spec, nameOf)

      for (let li = 0; li < levels.length; li++) {
        if (options.shouldAbort?.()) return finalize()
        const level = levels[li]

        // ---- 装配：约束 → 系列成员 → x 档位覆盖 ----
        applyConstraintBaseline(configStore, catalog, spec, cs)
        const code: SetupCode = {
          cinema: level.override.cinema ?? spec.code.cinema,
          wengine: level.override.wengine ?? spec.code.wengine,
        }
        const team = teamOf(spec, cs)
        for (let slot = 0; slot < 3; slot++) {
          const agentId = team[slot]
          if (!agentId) continue
          applyCodeToSlot(configStore, catalog, slot, agentId, code, fallbackFor(catalog, agentId))
        }
        applyConditions(configStore, catalog, cs, team)

        // ---- 求值 ----
        const value = readMetric(calc, m, env, spec)
        evaluations++
        if (value === null) { skipped++; out[si].skipped++; out[si].values[li] = null }
        else out[si].values[li] = value

        const done = si * levels.length + li + 1
        options.onProgress?.({
          pct: (levels.length * series.length) > 0 ? done / (levels.length * series.length) : 1,
          text: `${out[si].label} · ${level.label}`,
        })
      }
    }
  } finally {
    restoreStore(configStore, snap)
  }
  return finalize()

  function finalize(): FreeCompareResult {
    return {
      axisId: axis.id,
      axisLabel: axis.label,
      levels,
      series: out,
      metricId: m.id,
      metricLabel: m.label,
      durationMs: Date.now() - started,
      evaluations,
      skipped,
    }
  }
}

/** 系列实际要装配的队伍：整队 = 自身成员；单人 = 本人 + 约束里的基底队友 */
function teamOf(spec: SeriesSpec, cs: ConstraintSpec): [string, string, string] {
  if (spec.kind === 'team') {
    return [spec.members[0] ?? '', spec.members[1] ?? '', spec.members[2] ?? '']
  }
  const [a, b] = cs.baseTeammates ?? ['', '']
  return [spec.members[0] ?? '', a, b]
}

function seriesLabelOf(spec: SeriesSpec, nameOf: (id: string) => string): string {
  const who = spec.members.map(nameOf).join('+')
  return `${who} ${spec.code.cinema}${spec.code.wengine}`
}

/**
 * 约束基线：Boss + 自动配装。
 * 只改「场景」，不改系列成员 —— 保证「改约束不动系列」这条判据。
 */
function applyConstraintBaseline(
  configStore: ReturnType<typeof useConfigStore>,
  catalog: ReturnType<typeof useCatalogStore>,
  spec: SeriesSpec,
  cs: ConstraintSpec,
): void {
  // Boss 装配失败不该炸掉整轮对比（预设数据缺字段时如实跳过，而不是让工作台白屏）
  if (cs.boss) {
    const phase = cs.boss.phases.find(p => p.phaseId === cs.phaseId) ?? cs.boss.phases[0]
    if (phase) {
      try {
        configStore.applyBossPreset({ id: cs.boss.id }, phase, cs.boss.monster, cs.boss.defaults)
      } catch {
        // 静默：约束里的 Boss 不是本任务的正确性判据，装配失败就沿用当前 Boss
      }
    }
  }
  // 自动配装（推荐驱动盘 + 副词条优化器）：buildRecs 没加载会抛（config.ts:1261），调用方负责先加载
  if (cs.autoBuild && catalog.buildRecsLoaded) {
    const team = teamOf(spec, cs)
    configStore.applyTeamPreset([team[0], team[1], team[2]] as [string, string, string])
  }
}

/** 条件角色（用户原话「维琳娜 0命1命2命」）：找到它在队里的槽位并覆盖配置码 */
function applyConditions(
  configStore: ReturnType<typeof useConfigStore>,
  catalog: ReturnType<typeof useCatalogStore>,
  cs: ConstraintSpec,
  team: readonly string[],
): void {
  for (const c of cs.conditions ?? []) {
    const slot = team.indexOf(c.agentId)
    if (slot < 0) continue // 条件角色不在队里 = 该约束不适用（如实忽略，不报错）
    const code = conditionToCode(c)
    applyCodeToSlot(configStore, catalog, slot, c.agentId, code, fallbackFor(catalog, c.agentId))
  }
}

/** 读指标：单人系列取该角色的分量，整队取 __total__ */
function readMetric(calc: Calc, metric: MetricDef, env: MetricEnv, spec: SeriesSpec): number | null {
  const vec: MetricVector = metric.read(calc, env)
  if (metric.scope === 'perSlot' && spec.kind === 'agent') {
    const v = vec[spec.members[0] ?? '']
    return Number.isFinite(v) ? v : null
  }
  const v = vec[TOTAL_KEY]
  return Number.isFinite(v) ? v : null
}
