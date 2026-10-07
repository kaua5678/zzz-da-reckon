/**
 * 自由对比工作台 · 求值器（唯一碰 store / 引擎的地方）
 *
 * 分层（判据 7 展示层越层 import 棘轮：本文件在 `src/composables/` = 编排层，
 * 页面/组件不许直接 import `@/core`、`@/mechanics`，也不许自己写装配逻辑）：
 * ```
 * metrics.ts   纯读（引擎值 → 数字向量）     零 store 写入
 * axes.ts      纯枚举（系列 → x 档位清单）    零 store 写入
 * engine.ts    装配场景 config → 求值  ← 本文件
 * ```
 *
 * **隔离口径**（r372，CC-343 第 2 阶段；取代此前的「快照 / 恢复」）：调用方经 `withAnalysisScenario`
 * 建独立场景传进来，本文件只在 `scenario.config` 上装配、读 `scenario.calc`，不读 UI config store、
 * 不做快照恢复 ⇒ UI store 全程不被碰（CC-251 / 278 / 338 / 339 / 340 那一类「漏快照 → 污染现场」不再可能）。
 * catalog 仍取全局 `useCatalogStore()`：目录是只读数据，场景不持有独立副本（见 §8）。
 */

import { applyBossRoom } from '@/composables/bossRoom'
import { applyBuffToStore } from '@/composables/teamCompare'
import type { PhaseBuffCard } from '@/types/bossPreset'
import type { ConfigModel } from '@/stores/config'
import { useCatalogStore } from '@/stores/catalog'
import { isLimitedWEngine } from '@/composables/teamCompare'
import type { ResourceCalc } from '@/composables/useResourceCalc'
import type { AnalysisContext } from '@/composables/analysisScenario'
import { isBatchAborted, type BatchTaskOptions } from '@/composables/batchTask'
import {
  type AxisId,
  type AxisLevel,
  type AxisOptions,
  type SeriesSpec,
  type SetupCode,
  AXIS_BY_ID,
  DEFAULT_AXIS_ID,
} from './axes'
import { type ConstraintSpec, conditionToCode, constraintSummary } from './constraints'
import {
  type MetricDef,
  type MetricEnv,
  type MetricVector,
  TOTAL_KEY,
  metricDef,
} from './metrics'

import { localized } from '@/utils/format'
import { signatureWEngineOf } from '@/composables/signatureWEngine'
export type Calc = ResourceCalc

// ========== 结果 ==========

export interface FreeCompareSeries {
  /** 系列 id（buff 拆分后 = `${SeriesSpec.id}|${buffKey}`，全状态模式下每个 buff 态一条） */
  id: string
  label: string
  /** 拆分前的主系列 id（全状态模式下同组系列共享；图例分组/本体线型用） */
  baseId: string
  /** 该系列应用的当期 buff 牌标题；`null` = 本体（无 buff）。展示与归因用 */
  buffTitle: string | null
  /** 该系列在各 x 档位上的取值（与 `result.levels` 同序） */
  values: Array<number | null>
  /** 未取到值的档位数（如未收敛/跳过） */
  skipped: number
  /**
   * 「无专武」档实际穿上的下位音擎（label，去重后按首次出现序）。
   * 为什么要露出来：下位是**按伤害择优**挑的（同职业三把 A 级实测差 3–8pp），
   * 不显示的话用户看到「20」的数字却不知道底下穿的是哪把 —— 无法核对也无法复现。
   */
  downgrades?: string[]
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
  /**
   * 「无专武」档挑下位音擎时的额外试算次数（**不含**在 `evaluations` 里）。
   * 池大小 × 首个未命中的 (队友,角色,命座) 键；同键后续档位走缓存不重复试算。
   */
  pickEvaluations: number
  /**
   * 环境摘要（`constraintSummary` 产出）：Boss（期数）· 锁定条件 · 配装模式 · 当期 buff 状态 · 交互/失衡轴声明。
   * 用户裁决 2026-10-02：「环境条件是决定数据质量的关键，不能掐头去尾给结论」⇒ 每张图必须自带完整环境声明。
   */
  environmentSummary: string
}

export interface FreeCompareOptions extends BatchTaskOptions {
  // 取消：页面「取消」经 BatchOwner 的 AbortSignal 传入 control；中止时保留已算档位
  series: SeriesSpec[]
  axisId: AxisId
  axisOptions?: AxisOptions
  metricId: string
  constraints?: ConstraintSpec
}

// ========== 装配 ==========

/** 专武 id（判定走 `signatureWEngineOf`，CC-498）；无专武 null。 */
export function signatureWEngineId(catalog: ReturnType<typeof useCatalogStore>, agentId: string): string | null {
  return signatureWEngineOf(catalog, agentId)?.id ?? null
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
 * ⚠ **也不能裸奔**：空音擎实测比专武本体低 **34–41%**（探针 `freeCompareDowngradeProbe.test.ts`
 * 三角色实测：柏妮思 −39.4% / 菲欧妮 −34.4% / 维琳娜 −41.2%）—— 那不是「没抽专武」，
 * 那是「没带武器」，两者差着一个量级，混起来读会让整个无专武档失真。
 * ⇒ 用户口径 2026-09-15「右位 0 = 用了下位武器，比如 A 级武器」= 必须穿一件下位。
 *
 * ⚠ **下位挑哪把不能按 id 顺序**（本函数第一版就是 `find()` 取第一件 = 武断）：
 * 实测同职业三把 A 级音擎差 **3–8 个百分点**（柏妮思：双生泣星 −8.9% / 触电唇彩 −8.6% /
 * 咚哒回声 −16.9%），挑错一把会让「无专武」档凭空多亏 8pp。
 * ⇒ 默认走 **按伤害择优**（`pickDowngradeByDamage`），与 `computeAutoEnginePicks` 同思路。
 */
function applyCodeToSlot(
  configStore: ConfigModel,
  catalog: ReturnType<typeof useCatalogStore>,
  slot: number,
  agentId: string,
  code: SetupCode,
  fallbackWEngine: string,
  fallbackMod: number,
): void {
  // CC-340：先设命座与精炼再调 setAgent，保证 setAgent 内部的 applyBuildRecommendationForSlot
  // （默认副词条百暴计算）与 syncTeammateBuffsFromTeam 按本档目标命座/精炼求值，而非上一档残留值
  configStore.setCinemaLevel(slot, code.cinema)
  const modLevel = code.wengine >= 1 ? Math.max(1, Math.min(5, code.wengine)) : (fallbackWEngine ? fallbackMod : 1)
  configStore.setWEngineModLevel(slot, modLevel)
  configStore.setAgent(slot, agentId)
  if (code.wengine >= 1) {
    const sig = signatureWEngineId(catalog, agentId)
    // 该角色没有专武（A 级/常驻）时退回基础音擎：假装有专武会静默给一个不存在的 id
    const wid = sig ?? fallbackWEngine
    configStore.setWEngine(slot, wid)
  } else {
    configStore.setWEngine(slot, fallbackWEngine)
  }
}

/** 下位候选：同职业的**非常驻 S / A 级**音擎（`ownerAgentId` 为空 = 不是谁的专武） */
export interface DowngradeCandidate {
  id: string
  mod: number
  label: string
}

/**
 * 枚举某角色的「下位音擎」候选池：同职业、非专属（`ownerAgentId` 空）、非限定。
 *
 * 口径（三条都对着用户原话「用了下位武器，比如 a 级武器」）：
 *  - **同职业**：音擎被动多数带专精要求（`WEngineEffect.requirement.specialty`），
 *    跨职业穿等于白板 —— 与 `computeAutoEnginePicks` 的「试算天然只让匹配角色吃满」同源。
 *  - **非专属**：`ownerAgentId` 有值 = 别人的专武，那不是「下位」是「另一把专武」（要花金）。
 *  - **非限定**：常驻 S 与 A 级都不占限定金 ⇒ 整个「无专武」档 0 金，与配置码金数口径自洽。
 * 精炼档：A 级默认 5、常驻 S 默认 3（`teamCompare.ts:523-524` 同口径，可经 `mods` 覆盖）。
 */
export function downgradeCandidates(
  catalog: ReturnType<typeof useCatalogStore>,
  agentId: string,
  mods: { aRank?: number; standard?: number } = {},
): DowngradeCandidate[] {
  const agent = catalog.getAgent(agentId)
  if (!agent) return []
  const aMod = mods.aRank ?? 5
  const stdMod = mods.standard ?? 3
  return catalog.displayWEngines
    .filter(w => !w.ownerAgentId && w.specialty === agent.specialty && !isLimitedWEngine(w.id))
    .map(w => ({
      id: w.id,
      mod: w.rarity === 'A' ? aMod : stdMod,
      label: `${localized(w.name, w.id)} R${w.rarity === 'A' ? aMod : stdMod}`,
    }))
}

/**
 * 按伤害择优挑下位音擎（**与 `computeAutoEnginePicks` 同思路**：逐个试算全队伤害取最高）。
 *
 * 为什么必须择优而不是取第一件：实测同职业 A 级之间差 3–8pp（见 `applyCodeToSlot` 注释），
 * 而「无专武」是用户明确要比的一个档位 —— 用一个随机偏低的基准去比，结论就是错的。
 *
 * 代价：池大小（异常职业 3 件）× 1 次全量求值。**调用方负责缓存**（`engine.ts` 用
 * `${teamKey}|${agentId}|${cinema}` 做键），否则档位 × 系列会被放大成 N×池 次求值。
 * 池为空（A 级角色等）返回 null，调用方回落空音擎。
 */
function pickDowngradeByDamage(
  calc: Calc,
  configStore: ConfigModel,
  catalog: ReturnType<typeof useCatalogStore>,
  slot: number,
  agentId: string,
  mods: { aRank?: number; standard?: number } = {},
): DowngradeCandidate | null {
  const pool = downgradeCandidates(catalog, agentId, mods)
  if (pool.length === 0) return null
  // 单件池不用试算（省一次全量求值）：没有可比的第二件，择优退化成恒等
  if (pool.length === 1) {
    configStore.setWEngine(slot, pool[0].id)
    configStore.setWEngineModLevel(slot, pool[0].mod)
    return pool[0]
  }
  let best: DowngradeCandidate | null = null
  let bestDmg = -Infinity
  for (const c of pool) {
    configStore.setWEngine(slot, c.id)
    configStore.setWEngineModLevel(slot, c.mod)
    const dmg = calc.teamTotalDamage.value
    if (Number.isFinite(dmg) && dmg > bestDmg) { bestDmg = dmg; best = c }
  }
  // 提交赢家：下一槽的试算/最终读数都基于它
  if (best) {
    configStore.setWEngine(slot, best.id)
    configStore.setWEngineModLevel(slot, best.mod)
  }
  return best
}

/**
 * 下位音擎解析器（带缓存）——「无专武」档每次都择优会 ×池大小 次求值，
 * 而同一个 (队友组合, 角色, 命座) 的择优结果在一轮对比里是常量 ⇒ 缓存是必需的，不是优化。
 *
 * 缓存键含 `cinema`：命座会改角色机制（如某命座改强特占比），可能翻转最优下位（实测三把差 3–8pp，
 * 不是不可能翻转）；键含队友组合是因为择优读的是**全队伤害**，换队友就换了判据。
 */
function makeDowngradeResolver(calc: Calc, configStore: ConfigModel, catalog: ReturnType<typeof useCatalogStore>) {
  const cache = new Map<string, DowngradeCandidate | null>()
  return {
    /** 解析并**把结果写进 store**（调用方随后求值即为该下位配置） */
    resolve(slot: number, agentId: string, cinema: number, teamKey: string): DowngradeCandidate | null {
      const key = `${teamKey}|${agentId}|${cinema}`
      const hit = cache.get(key)
      if (hit !== undefined) {
        if (hit) {
          configStore.setWEngine(slot, hit.id)
          configStore.setWEngineModLevel(slot, hit.mod)
        } else {
          configStore.setWEngine(slot, '')
        }
        this.lastPicked = hit
        return hit
      }
      const best = pickDowngradeByDamage(calc, configStore, catalog, slot, agentId)
      cache.set(key, best)
      this.lastPicked = best
      if (!best) configStore.setWEngine(slot, '')
      return best
    },
    /** 缓存统计（供 UI 显示真实求值次数；也便于测试断言缓存真的生效） */
    get size() { return cache.size },
    /** 最近一次 resolve 选中的件（调用方收集起来展示「20 档底下穿的是哪把」） */
    lastPicked: null as DowngradeCandidate | null,
  }
}

// ========== 主入口 ==========

/**
 * 跑一次自由对比。
 *
 * 复杂度：档位数 × 系列数 次全量引擎求值（单次 ~0.3-0.4s，见 `TeamComparePage.vue` 注释
 * 「每队 ~10 次 ≈ 3~4 秒」推算）⇒ **默认要给出代价预告**，别让用户点下去才知道要等一分钟。
 */
export async function computeFreeCompare(
  scenario: AnalysisContext,
  options: FreeCompareOptions,
): Promise<FreeCompareResult> {
  const started = Date.now()
  // r372：装配与求值都落在调用方给的独立场景上（原 useConfigStore + snapshotStore/restoreStore 已删）
  const { config: configStore, calc } = scenario
  const catalog = useCatalogStore()

  const axis = AXIS_BY_ID.get(options.axisId) ?? AXIS_BY_ID.get(DEFAULT_AXIS_ID)!
  const metric = metricDef(options.metricId)
  if (!metric) throw new Error(`[freeCompare] 未注册的指标 id: ${options.metricId}`)
  // 提前解包：TS 的窄化跨不过下面的闭包（`finalize` 会读它），显式收成一个非空的局部常量
  const m: MetricDef = metric

  const cs = options.constraints ?? {}

  const series = options.series
  // 档位按第一个系列枚举（x 维度与系列无关 ⇒ 取任一即可，取第一个保证 label 稳定）
  const levels = series.length > 0 ? axis.levels(series[0], options.axisOptions ?? {}) : []

  // ---- buff 状态展开（用户裁决 2026-10-02「本体强度 + 吃 buff 强度都要算」）----
  // 三态：'none' = 不使用（每个主系列 1 条输出）；'all' = 全状态对比（本体 + 每张可用牌各一条）；
  // PhaseBuffCard = 手动指定一张牌（每个主系列 1 条输出，该牌生效）。
  // 拆分在装配前完成 ⇒ 主循环对「输出系列」无差别遍历，buff 只是输出系列自带的装配参数。
  const usableBuffs = (cs.buffs ?? []).filter(b => !b.testOnly)
  interface RunRow { spec: SeriesSpec; baseId: string; buff: PhaseBuffCard | null; outKey: string }
  const runRows: RunRow[] = []
  for (const spec of series) {
    const choice = cs.buffChoice ?? 'none'
    if (choice === 'all') {
      // 全状态：本体（无 buff）+ 每张可用牌；无可用牌时退化为只有本体
      runRows.push({ spec, baseId: spec.id, buff: null, outKey: `${spec.id}|base` })
      for (const card of usableBuffs) {
        runRows.push({ spec, baseId: spec.id, buff: card, outKey: `${spec.id}|buff:${card.title}` })
      }
    } else if (choice === 'none') {
      runRows.push({ spec, baseId: spec.id, buff: null, outKey: `${spec.id}|base` })
    } else {
      runRows.push({ spec, baseId: spec.id, buff: choice, outKey: `${spec.id}|buff:${choice.title}` })
    }
  }
  /** 图头摘要里的 buff 状态（模式级，不逐系列重复牌名） */
  const choice0 = cs.buffChoice ?? 'none'
  const buffModeLabel = choice0 === 'all'
    ? (usableBuffs.length > 0 ? `全状态对比（本体 + ${usableBuffs.length} 张牌）` : '全状态对比（当期无可用牌，仅本体）')
    : choice0 === 'none' ? '' : (choice0 as PhaseBuffCard).title

  const out: FreeCompareSeries[] = runRows.map(r => ({
    id: r.outKey,
    baseId: r.baseId,
    buffTitle: r.buff?.title ?? null,
    label: '',
    values: new Array(levels.length).fill(null),
    skipped: 0,
  }))
  const downgrade = makeDowngradeResolver(calc, configStore, catalog)
  let evaluations = 0
  let skipped = 0
  /** 择优自身的试算次数（池大小 × 首个未命中），单独计，避免它被误读成"档位求值" */
  let pickEvaluations = 0

  const nameOf = catalog.agentName
  for (let si = 0; si < runRows.length; si++) {
    const { spec, buff } = runRows[si]
    const baseLabel = seriesLabelOf(spec, nameOf)
    // 全状态模式下牌名进系列标签（「柏妮思 21 · 本体」/「柏妮思 21 · 异象」）；单牌/无牌模式保持原标签
    out[si].label = (cs.buffChoice ?? 'none') === 'all' && buff ? `${baseLabel} · ${buff.title}` : baseLabel

    for (let li = 0; li < levels.length; li++) {
      if (isBatchAborted(options.control)) return finalize()
      const level = levels[li]

      // ---- 装配：约束 → 系列成员 → x 档位覆盖 ----
      // period 维度：档位的 periodId 覆盖约束里的 phaseId（CC-189；此前该覆盖从未被读 ⇒ 期数轴是假轴）
      applyConstraintBaseline(configStore, catalog, spec, cs, level.override.periodId ?? cs.phaseId)
      // 当期 buff 牌：整表替换成这张牌（保留关卡固有 layer-buff；`applyBuffToStore` 单一口径，与队伍对比页同源）
      applyBuffToStore(configStore, buff)
      const code: SetupCode = {
        cinema: level.override.cinema ?? spec.code.cinema,
        wengine: level.override.wengine ?? spec.code.wengine,
      }
      const team = teamOf(spec, cs)
      // 条件角色先定位槽位。条件与系列成员重叠时**条件胜**（用户原话「维琳娜0命1命2命的情况下」
      // 是场景约束，系列只描述「谁跟谁比」；场景约束理应对该角色生效）
      const condSlots = new Map<number, SetupCode>()
      for (const c of cs.conditions ?? []) {
        const s = team.indexOf(c.agentId)
        if (s >= 0) condSlots.set(s, conditionToCode(c))
      }
      // 第一遍：把三槽的角色/命座/专武写全（**择优要读全队伤害，必须等队伍齐了再试**）
      // CC-338：空槽（!agentId）必须显式清空——否则 autoBuild=false（默认轻量速算）时，
      // 用户页面原有槽位或上一条 3 人系列的残留角色会漏进本系列的 1~2 人队求值。
      const needPick: Array<{ slot: number; agentId: string; cinema: number }> = []
      for (let slot = 0; slot < 3; slot++) {
        const agentId = team[slot]
        if (!agentId) {
          configStore.setAgent(slot, '')
          configStore.setCinemaLevel(slot, 0)
          configStore.setWEngine(slot, '')
          configStore.setWEngineModLevel(slot, 1)
          continue
        }
        const slotCode = condSlots.get(slot) ?? code
        applyCodeToSlot(configStore, catalog, slot, agentId, slotCode, '', 1)
        if (slotCode.wengine === 0) needPick.push({ slot, agentId, cinema: slotCode.cinema })
      }
      // 第二遍：无专武的槽位按伤害择优挑下位（池>1 时内部会试算；缓存跨档位复用）
      for (const p of needPick) {
        const before = downgrade.size
        downgrade.resolve(p.slot, p.agentId, p.cinema, `${team.join(',')}|${code.cinema}${code.wengine}`)
        if (downgrade.size > before) {
          // 新键 = 真的试算了；单件池（n <= 1）直接采用不试算，多件池逐件试算 n 次
          const n = downgradeCandidates(catalog, p.agentId).length
          pickEvaluations += n > 1 ? n : 0
        }
        const picked = downgrade.lastPicked
        if (picked) {
          const list = (out[si].downgrades ??= [])
          const tag = `${nameOf(p.agentId)}：${picked.label}`
          if (!list.includes(tag)) list.push(tag)
        }
      }

      // ---- 求值 ----
      // env 必须在装配之后读：Boss / 期数由装配段写入，提前读会拿到用户页面原来那个 Boss 的血量（CC-189 修）
      const env: MetricEnv = { hp: configStore.enemy.hp }
      const value = readMetric(calc, m, env, spec)
      evaluations++
      if (value === null) { skipped++; out[si].skipped++; out[si].values[li] = null }
      else out[si].values[li] = value

      const done = si * levels.length + li + 1
      options.onProgress?.({
        pct: (levels.length * runRows.length) > 0 ? done / (levels.length * runRows.length) : 1,
        text: `${out[si].label} · ${level.label}`,
      })
    }
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
      pickEvaluations,
      environmentSummary: constraintSummary(cs, nameOf, buffModeLabel || undefined),
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
  configStore: ConfigModel,
  catalog: ReturnType<typeof useCatalogStore>,
  spec: SeriesSpec,
  cs: ConstraintSpec,
  phaseId: string | undefined,
): void {
  // Boss 装配失败不该炸掉整轮对比（预设数据缺字段时如实跳过，而不是让工作台白屏）
  if (cs.boss) {
    const phase = cs.boss.phases.find(p => p.phaseId === phaseId) ?? cs.boss.phases[0]
    if (phase) {
      try {
        applyBossRoom(configStore, cs.boss, phase)
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
