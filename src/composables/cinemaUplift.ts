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
import { nextTick } from 'vue'
import { useCatalogStore } from '@/stores/catalog'
import type { AnalysisContext } from '@/composables/analysisScenario'
import { isBatchAborted, type BatchControl } from '@/composables/batchTask'
import type { ResourceCalc } from '@/composables/useResourceCalc'
import { computePanelPhases } from '@/composables/resourceCalc/panelPhases'
import { bindPoolStore, computeCinemaBreakdown, formulaRoleOf, isExecPanelStat } from '@/composables/cinemaUpliftBreakdown'
import type { DamagePoolContext } from '@/composables/resourceCalc/damagePool'
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
  /** 伤害提升百分比 */
  gainPct: number
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

export interface CinemaUpliftRow {
  slot: number
  agentId: string
  name: string
  entries: CinemaUpliftEntry[]
}

/** 判定 execLevel 与 unimplemented 的伤害变化阈值（百分比，取绝对值）。零移动才是「未接入」。 */
export const UPLIFT_EPSILON_PCT = 0.05

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
  const { targetStunCount, slots = [0, 1, 2], maxLevel = 6, resolveName, control } = opts
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
      entries.push({
        to,
        gainPct,
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
