import { computed, toRaw } from 'vue'
import { guaranteeStunShortfall, type GuaranteeStunShortfall } from '@/core/parrySplit'
import { useConfigStore } from '@/stores/config'
import { useCatalogStore } from '@/stores/catalog'
import { activeRowFusionRulesSnapshot } from '@/logicEditor/fusion'
import { INNER_LOOP_MAX_ITERATIONS } from '@/core/resource'
import { COMBO_ALIGN_ABSORB_RATIO_SETTING, DEFAULT_COMBO_ALIGN_ABSORB_RATIO } from '@/data/resourceDefaults'
import { DEFAULT_STUN_PLAN_PROJECTION_CODE, stunPlanProjectionFromCode } from '@/core/stunPlanProjection'
import { calcStunAxis } from '@/core/stunAxis'
import type { InStunAnomalySummary } from '@/types/resource'
import type { StunAxis } from '@/types/resource'
import { calcStunAxisStack } from '@/core/stunAxisStack'
import { calcSpecialActionBonus } from '@/core/anomalyPool'
import { BossAnomalyStateResult } from '@/core/stunAxis/inStunAnomaly'
import { getAgentMechanic } from '@/mechanics'
import { buildDamagePoolRows } from './resourceCalc/damagePool'
import { freezeCached } from './resourceCalc/freezeCached'
import { createConvergenceRoundInputs, createRunCalcRound } from './resourceCalc/convergence'
// CC-10（2026-09-25）：外层不动点 + S3 可行化决策已原样外提 `./resourceCalc/solveTeam`，
// 本文件不再 import `roundThreads` / `outerCycle` / `feasibilitySearch` / `netFrontlineOccupation`
// （全部随搬移成为新文件的依赖）。
import { solveTeam } from './resourceCalc/solveTeam'
import type {
  CharacterOperationConfig,
  ResourceCalcConfig,
  TeamResourceResult,
  StunPoolResult,
  AnomalyPoolResult,
  SpecialActionBonusResult,
  AnomalyEventRecord,
} from '@/types/resource'
import type { PanelValues } from '@/types/catalog'
import { panelAt } from '@/core/panel'
import * as ResourceCalcHelpers from './resourceCalc/helpers'
import type { DamagePoolRow, DamageSourceBreakdown, AnomalyVirtualPanelBuild } from './resourceCalc/helpers'

/**
 * **calcOutput 记忆化**（2026-09-23 mcp-engine，用户批准高风险引擎优化）。
 *
 * 背景（实测）：引擎一次完整求值 = 外层不动点 × 可行性降配扫描（最多 8 档，每档又是一整个外层不动点），
 * 单队 60–230ms；而**搜索型调用方**（权重分配 B/C、难度爬梯试开/回滚、散点页、合轴松弛）反复「改 → 读 → 改回」，
 * 同一配置被重算多次：难度曲线 G2 爬梯 31 次真重算里只有 12 个不同配置（`.zc/mcp-engine/keys.json`）。
 *
 * 做法：calcOutput 是**确定性纯函数**——输入 = config store 全部 state + 目录数据 + 生效的行融合规则。
 * 以它们为键做小容量 LRU；命中直接返回上次的结果对象（同一引用，下游 computed 正常失效/重算）。
 *
 * 正确性护栏：
 *  - 键 = `config.$state` 的 JSON（**经响应式代理读取**，于是每个字段都建立依赖；不能 toRaw——那样读到的是 ref 对象且不追踪），
 *    **默认全部 state 进键**（漏字段 = 静默错值，这正是高风险所在；宁可多失效）。store 的 24 个 ref 全部在 `$state` 里（已核）。
 *    唯一排除的是 `CALC_MEMO_KEY_EXCLUDE`：纯触发器 `refreshTrigger` 与**引擎不读的纯 UI 态**（已 grep 核引擎/编排/机制/数据层零引用）。
 *    排除项**连读都不读**（不经 replacer），否则会建立依赖、切 tab 也触发重算。
 *  - `triggerRefresh()`/`refreshTrigger++` 的语义因此从「强制重算」变成「state 没变就复用」：全库调用点都是
 *    「先改 store 再触发」（setComboAlignOverride / toggleTeammateBuff 等，已核），改动本身已进键。
 *  - 目录数据按**对象身份**进键（`catalog` / `teammateBuffGroups` / `buildRecommendations` 整体替换才会变；
 *    全库无原地改目录的生产代码，已核）。
 *  - **读 `$state` 的每个字段本身就建立了响应式依赖**——键计算让 calcOutput 依赖全部 state，比原来更宽，不会漏失效。
 *  - 求值有副作用的路径**不记忆**：降配单调闸门（`interactionScaleMonotone`）经 `solveTeam` 返回
 *    `ceilingWriteBack` 后在 `computeCalcOutput` 内写回 `interactionScaleCeiling`（CC-10 起写回点外移，
 *    见 `resourceCalc/solveTeam.ts` 头注释），命中会跳过这次写回 ⇒ 闸门开启时直接走原路径。
 *  - 结果对象被视为只读（全库无对 resourceResult/stunPool/anomalyPool 的原地写，已 grep 核）。
 */
/** 容量 16：难度爬梯单队 G2 实测 12 个不同配置（8 装不下、命中率掉一半）；每个 useResourceCalc 实例各一份 */
const CALC_OUTPUT_MEMO_MAX = 16
/** 不进 calcOutput 记忆化键的 state 字段（见上）。新增字段**默认进键**；只有确认引擎不读的纯 UI 态才可加到这里。 */
const CALC_MEMO_KEY_EXCLUDE: ReadonlySet<string> = new Set(['refreshTrigger', 'activeTab', 'selectedSlot'])
/** 对象身份 → 序号（目录数据进键用；WeakMap 不阻止回收） */
const memoIdentity = new WeakMap<object, number>()
let memoIdentitySeq = 0
function identityOf(o: unknown): number {
  if (o === null || typeof o !== 'object') return 0
  const raw = toRaw(o as object)
  let id = memoIdentity.get(raw)
  if (id === undefined) { id = ++memoIdentitySeq; memoIdentity.set(raw, id) }
  return id
}
/** 测试/诊断：记忆化命中统计（每个 useResourceCalc 实例各自计数，这里汇总） */
const calcOutputMemoStats = { hits: 0, misses: 0, bypass: 0 }
export function getCalcOutputMemoStats(): { hits: number; misses: number; bypass: number } {
  return { ...calcOutputMemoStats }
}
/** 全局开关（测试做 A/B 逐位对照用；生产恒开） */
let calcOutputMemoEnabled = true
export function setCalcOutputMemoEnabled(on: boolean): void {
  calcOutputMemoEnabled = on
}

const { computePanel, computeEntrySnapshotPanel, getTeamAnomalyDurationBonus, getWindInfectionCoverage, elementLabel, buildCharConfig, applyTeamMechanics, buildAnomalyVirtualPanel, collectAxisWindowOverlays } = ResourceCalcHelpers
export function useResourceCalc() {
  const configStore = useConfigStore()
  const catalogStore = useCatalogStore()
  // 队友命座/核心拐（teammate-buffs）是全局计算依赖，不等到属性配置页才加载
  catalogStore.loadTeammateBuffs()

  /** 构建资源池计算配置 */
  const resourceConfig = computed<ResourceCalcConfig | null>(() => {
    // 依赖 refreshTrigger，用户点击刷新键时强制重算
    configStore.refreshTrigger

    // 就绪门：teammate-buffs 未就绪时返回 null，杜绝「首算无队友 buff、数据到达后数值漂移」的
    // 异步竞态（曾致同配置两次全新计算 12/3,9/1 vs 12/4,8/1）。失败也会置就绪（空数据语义）。
    if (!catalogStore.ready || !catalogStore.teammateBuffsReady) return null

    const characters: CharacterOperationConfig[] = []
    for (let i = 0; i < 3; i++) {
      const cfg = buildCharConfig(i, configStore, catalogStore)
      if (cfg) characters.push(cfg)
    }

    // 队伍级机制（跨槽位联动）统一经 applyTeamConfig 钩子派发，按槽位 0→1→2。
    // 迁移前这里是 5 个 applyXxxTeamFlags 的手工 import + 手工按序调用（含莱特后场占比等
    // 内联 cfg 写入）；现在新角色的队伍级机制只改自己的模块，不必再动本文件。
    // build 阶段的内联特判也已清零（2026-09-12 #10 真清偿）：橘福福八面威风 → specPanelBuffs，
    // 卢西娅 4命帷幕 + 回血→伊德海莉 → luciaElowen，均在同一钩子的 build 相位完成。
    applyTeamMechanics({ characters, configStore, catalogStore, phase: 'build' })

    if (characters.length === 0) return null

    return {
      totalTime: configStore.enemy.battleTime ?? 180,
      invincibleTime: configStore.enemy.invincibleTime ?? 0,
      bossStunValue: configStore.enemy.stunValue,
      shieldCount: configStore.enemy.shieldCount,
      energyShieldCount: configStore.enemy.energyShield,
      maxIterations: INNER_LOOP_MAX_ITERATIONS,
      // 失衡计划值 → 计数的投影方式（C7 实验开关，默认 off = 现行口径；见 core/stunPlanProjection.ts）
      // CC-151（第 175 轮）：锁定失衡次数（`enemy.stunCountLock ≥ 0`，命座对比「操作够就能打 N 次」口径）时，physical 投影
      // 读的是池的物理次数，锁定值被绕过（实测 adjustableEffect：lock=3/4 连携都按池 2 次算 = 4）⇒ 锁定 + physical 回落 off
      // （countStun ≡ 锁定值）。其他投影（round/floor…）作用于锁定值本身，照常生效（lycaonC2Contract lock 3.6 + round 契约）。
      // 回退点：删去本 IIFE 的锁定判断，恢复直接读机制参数。
      stunPlanProjection: (() => {
        const proj = stunPlanProjectionFromCode(configStore.getMechanicSetting('time.stunPlanProjection', DEFAULT_STUN_PLAN_PROJECTION_CODE))
        return proj === 'physical' && (configStore.enemy.stunCountLock ?? -1) >= 0 ? 'off' : proj
      })(),
      // 动态合轴吸收上限（全局变量，用户口径 2026-09-19 v3；见 data/resourceDefaults#DEFAULT_COMBO_ALIGN_ABSORB_RATIO）
      comboAlignAbsorbRatio: configStore.getMechanicSetting(COMBO_ALIGN_ABSORB_RATIO_SETTING, DEFAULT_COMBO_ALIGN_ABSORB_RATIO),
      // 降配档单向闸门（用户口径 2026-09-20；缺省 ceiling=1 / monotone=false ⇒ 普通计算路径逐位不变）
      interactionScaleCeiling: configStore.interactionScaleCeiling,
      interactionScaleMonotone: configStore.interactionScaleMonotone,
      characters,
    }
  })

  /** 各角色面板 */
  const panels = computed<PanelValues[]>(() => {
    const result: PanelValues[] = []
    for (let i = 0; i < 3; i++) {
      const p = computePanel(i, configStore, catalogStore)
      // 盖章槽位号：本数组**按位置压缩**（空槽不 push）⇒ 下标 ≠ 槽位号，
      // 下游一律经 `panelAt(panels, slot)` 按身份取（见 core/panel.ts 头注释）。
      if (p) result.push({ ...p, slot: i })
    }
    // 共享缓存 ⇒ 测试环境深冻结（写入即抛错，见 freezeCached.ts）；面板加成只许走 applyPanel
    return freezeCached(result)
  })

  /** 各角色“进场记录面板”（特殊虚耀使用） */
  const entrySnapshotPanels = computed<PanelValues[]>(() => {
    const result: PanelValues[] = []
    for (let i = 0; i < 3; i++) {
      const p = computeEntrySnapshotPanel(i, configStore, catalogStore)
      if (p) result.push({ ...p, slot: i })
    }
    return result
  })

  /**
   * 全队异常伤害乘区（CC-21 2026-09-26，census §5.14）：各槽模块能力 `globalAnomalyMultiplierFactor`
   * 连乘，无提供者 = 1，乘到所有异常相关伤害。现仅蕾米埃尔（异化系数 1 + (异化度 + 异化度提升) / 100，
   * 公式在 `mechanics/agents/remielle.ts`）。原为本处按身份 `['1581']` 找槽 + 读角色面板字段的编排层特判。
   */
  const globalAnomalyMultiplier = computed<number>(() => {
    let multiplier = 1
    configStore.team.forEach((char, slot) => {
      const mod = char?.agentId ? getAgentMechanic(char.agentId) : undefined
      if (!mod?.globalAnomalyMultiplierFactor) return
      // ⚠ 判据 17：`panels` 按位置压缩（下标 ≠ 槽位号）⇒ 必须 `panelAt` 按盖章身份取
      // （2026-09-18 round 21 夜实测：`panels.value[slot]` 在前导/中间空槽时取到别人那份面板）。
      const panel = panelAt(panels.value, slot)
      if (panel) multiplier *= mod.globalAnomalyMultiplierFactor(panel)
    })
    return multiplier
  })

  // ===== 两轮迭代破循环（anomalyPool ↔ stunPool ↔ stunCoverage） =====
  // Round 0: 无易伤 → 畏缩覆盖率初算
  // Round 1: 有易伤 → 畏缩覆盖率修正 → 最终收敛

  // 收敛轮输入簇已迁 resourceCalc/convergence.ts（#10 首批租户；逐字搬移，deps 注入 store/computed ref）
  const {
    extractAnomalyExecsFrom, extractStunExecsFrom, autoPreset, autoActive,
    resolveAxes, buildStackAxes, expandExecutedToCounts, calcAnomalyPoolInput,
  } = createConvergenceRoundInputs({ configStore, catalogStore, panels, resourceConfig, globalAnomalyMultiplier })


  /**
   * 单轮计算：给定失衡次数输入，重算资源池（连携 = 每失衡连携数 × 失衡次数）→ 转大不动点 → 失衡池 → 易伤覆盖率 → 异常池。
   * 抱拳→转大因果链：抱拳（客诉）命中后检查好评≥90 打开大招选择窗口；60 需目标队友有连携窗口（替换连携），90 直接打出大招。
   */


  /**
   * 单轮计算：给定失衡次数输入与上一轮收敛线程，重算资源池（连携 = 每失衡连携数 × 失衡次数）→
   * 转大不动点 → 失衡池 → 易伤覆盖率 → 异常池。跨轮反馈量统一走 threads（见 roundThreads.ts，
   * 含各线程的语义注释）；返回 threadsNext 供外层不动点传入下一轮。
   * opts.forceNoAxis = 轴退化重算（轴资源需求超出时间预算 → 不可操作 → 退化为一般轴，见 calcOutput）。
   * opts.interactionScale < 1 = 非轴降配：超预算时缩放用户交互次数（招架/金身/双反/闪反，round），
   * 只缩放 store 侧输入——后续 boss 强制弹刀（parrySplit 直读 store）与轴补齐注入不被缩放。
   */
  /** 单轮计算输出：下游 computed 消费的计算结果（10 个字段）+ 下一轮收敛线程 */

  /**
   * 外不动点：失衡次数 ↔ 资源池（连携次数 = 每失衡连携数 × 失衡次数）↔ 失衡池 全链路循环收敛。
   * 同时追踪失衡次数/连携次数/好评转大等反馈，区分固定点、离散环与耗尽未收敛。
   */
  const calcOutput = computed(() => {
    if (!resourceConfig.value || !catalogStore.ready) return null
    if (!calcOutputMemoEnabled || configStore.interactionScaleMonotone) {
      calcOutputMemoStats.bypass++
      return freezeCached(computeCalcOutput())
    }
    const state = configStore.$state as unknown as Record<string, unknown>
    const stateForKey: Record<string, unknown> = {}
    for (const k of Object.keys(state)) if (!CALC_MEMO_KEY_EXCLUDE.has(k)) stateForKey[k] = state[k]
    const key = JSON.stringify([
      stateForKey,
      identityOf(catalogStore.catalog),
      identityOf(catalogStore.teammateBuffGroups),
      identityOf(catalogStore.buildRecommendations),
      catalogStore.teammateBuffsReady,
      activeRowFusionRulesSnapshot(),
    ])
    const hit = calcOutputMemo.get(key)
    if (hit !== undefined) {
      calcOutputMemo.delete(key)
      calcOutputMemo.set(key, hit)
      calcOutputMemoStats.hits++
      return hit
    }
    calcOutputMemoStats.misses++
    // 记忆化命中会把同一对象交给下一位读者 ⇒ 测试环境深冻结，任何下游原地改写立即抛错
    const out = freezeCached(computeCalcOutput())
    calcOutputMemo.set(key, out)
    if (calcOutputMemo.size > CALC_OUTPUT_MEMO_MAX) calcOutputMemo.delete(calcOutputMemo.keys().next().value!)
    return out
  })
  /** calcOutput 记忆化 LRU（本实例私有；见文件头 CALC_OUTPUT_MEMO_MAX 注释） */
  const calcOutputMemo = new Map<string, ReturnType<typeof computeCalcOutput>>()

  function computeCalcOutput() {
    // 锁定失衡次数（命座对比固定场景）：stunCount 固定输入不回填（"操作够就能打 N 次失衡"口径），
    // 但异常喧响/终结技次数反馈仍收敛，避免与资源利用率页口径分裂
    const lockedStunCount = configStore.enemy.stunCountLock ?? -1
    const stunWindowDur = computeWindowDuration()
    const stunEffTime = Math.max(0, (configStore.enemy.battleTime ?? 180) - (configStore.enemy.invincibleTime ?? 0))
    // CC-10（2026-09-25）：外层不动点 + S3 可行化决策整段原样外提 `resourceCalc/solveTeam.ts#solveTeam`。
    // 唯一 store 副作用（降配闸门 ceiling 下调）改由本函数在 solveTeam 返回后执行 —— 原写回是
    // stageResolveFeasibility 的最后一条语句，之后到原 :653 再无 resourceConfig/configStore 读，
    // 故读写时序逐位不变（详见 solveTeam.ts 头注释）。
    const { out, ceilingWriteBack } = solveTeam({
      runCalcRound, lockedStunCount, stunWindowDur, stunEffTime, resourceConfig: resourceConfig.value,
    })
    if (ceilingWriteBack !== null) {
      configStore.interactionScaleCeiling = Math.min(configStore.interactionScaleCeiling, ceilingWriteBack)
    }
    return out
  }

  // 下游统一从 calcOutput 取（名称保持，伤害池/结果页等无需改动）
  const resourceResult = computed<TeamResourceResult | null>(() => calcOutput.value?.resourceResult ?? null)
  const stunPoolResult = computed<StunPoolResult | null>(() => calcOutput.value?.stunPool ?? null)
  /** 失衡内异常状态（轴模式）：每元素触发次数/窗均覆盖（失衡内异常系统 v2） */
  const inStunAnomalyState = computed<InStunAnomalySummary | null>(() => calcOutput.value?.inStunAnomalyState ?? null)
  /** Boss 异常状态轴（轴模式）：逐窗状态链 + 风化覆盖层，极性紊乱点时归因数据源 */
  const bossAnomalyState = computed<BossAnomalyStateResult | null>(() => calcOutput.value?.bossAnomalyState ?? null)
  const anomalyPoolResult = computed<AnomalyPoolResult | null>(() => calcOutput.value?.anomalyPool ?? null)
  const adjustedResourceResult = computed<TeamResourceResult | null>(() => calcOutput.value?.adjustedResourceResult ?? null)
  /** 琉音好评转大收敛后的转大次数（60+90 抱拳之和），供伤害池/影画6/倍率表消费 */
  const ultPromoteCount = computed(() => calcOutput.value?.promote ?? 0)
  /** 琉音好评转大收敛后的 60 抱拳次数（被替换掉的连携数；90 档 = ultPromoteCount − 本值）。纯展示载荷。 */
  const ultPromoteHug60 = computed(() => calcOutput.value?.promoteHug60 ?? 0)

  /** 生效轴：条件轴方案命中后的轴（无方案时回退手动 stunAxes），供下游栈遍历/易伤分配统一消费 */
  const effectiveStunAxes = computed<StunAxis[]>(() => calcOutput.value?.resolvedAxes ?? configStore.stunAxes)

  /**
   * 失衡轴窗口覆盖：按槽归属的 `bucketsBySlot` + 标量表（般岳明王 / 仪玄凝神 / 佩洛伊斯阳炎 /
   * 可琳扫除帮手 / 希格莉德浸染）。
   *
   * 2026-09-12 #10 真清偿（棘轮站点 4-7/8）：原本是四个各自
   * `configStore.team.findIndex(...)` 按角色 id 找槽位的 computed——编排层替角色找槽位、
   * 判空、判轴，每加一个轴覆盖角色都要再改本文件。现在统一走注册表派发
   * （`collectAxisWindowOverlays` → 模块自己的 `axisWindowOverlays` 钩子），
   * 本文件不再出现任何角色 id。
   *
   * 2026-09-16 round 16：入参补 `isAxis`（真轴模式布尔，**不是** `axes.length > 0`）与
   * `damagePanels`（提供 `additionalAbilityActive` / `windInfectionRate` 两个门控值，
   * 与伤害池 `execPanel` 同源同值 ⇒ 迁移前后逐位一致）。
   * ⚠ `isAxis` 必须与伤害池**同一个表达式**——`configStore.useStunAxis || autoActive` 与
   * `stunAxisResult` 都已在下方/上方就绪；用 `effectiveStunAxes.length > 0` 代替会让
   * `forceNoAxis` 轴退化态（`resolvedAxes` 清空、但 `effectiveStunAxes` 回落到手动轴）
   * 静默走错支。
   *
   * 2026-09-26 CC-17：四个 moveId 桶不再跨模块合并成全局表（会泄漏 `basic_attack`），
   * 改为按槽归属的 `bucketsBySlot`（设计稿 `docs/mcp-cc17-axis-overlay-consume.md` §3）。
   */
  const axisOverlays = computed(() => collectAxisWindowOverlays(
    effectiveStunAxes.value,
    configStore,
    catalogStore,
    (configStore.useStunAxis || autoActive.value) && !!stunAxisResult.value,
    damagePanels.value,
  ))

  /** 当前命中的轴方案名（条件轴模式用于 UI 展示；无方案 = null） */
  const matchedPlanName = computed<string | null>(() => calcOutput.value?.matchedPlanName ?? null)

  /** 霜寒暴击加成与风化侵染区按覆盖率折算到伤害结算面板 */
  const damagePanels = computed<PanelValues[]>(() => {
    const frostBonus = 10 * (anomalyPoolResult.value?.coverage?.frostCoverageRate ?? 0)
    const windAutoRate = anomalyPoolResult.value?.coverage?.windCoverageRate ?? 0
    const infectionCoverage = getWindInfectionCoverage(configStore, windAutoRate)
    const hasWindChar = configStore.team.some(char => {
      const agent = char.agentId ? catalogStore.agentsMap.get(char.agentId) : null
      return agent?.damageElement === 'wind'
    })
    const infectionBonus = hasWindChar ? 10 * infectionCoverage : 0
    // windInfectionRate：风化侵染覆盖率原值盖章（队伍无风角色时 0）——角色模块按自身口径消费（如希格莉德浸染增伤 15%×覆盖率）
    // 注：`panels` 已在自己那份 producer 里盖过槽位章，`.map` 保序展开 ⇒ 印章自然带到 damagePanels。
    return panels.value.map(p => ({
      ...p,
      enemyCritDmgTakenBonus: (p.enemyCritDmgTakenBonus ?? 0) + frostBonus,
      infectionZoneBonus: Math.max(0, infectionBonus),
      windInfectionRate: hasWindChar ? infectionCoverage : 0,
    }))
  })

  /** 单次失衡窗口时长（秒）= stunTime + 连携窗口(4) + 全队角色级失衡持续时间延长（琉音+2/般岳C1+2等） */
  function computeWindowDuration(): number {
    const teamStunDurationBonus = panels.value.reduce((sum, p) => sum + (p.stunDurationBonusSeconds ?? 0), 0)
    return (configStore.enemy.stunTime ?? 12) + 4 + teamStunDurationBonus
  }
  /** 轴编辑器同口径：当前失衡窗口时长（含全队失衡延时） */
  const windowDuration = computed<number>(() => computeWindowDuration())

  function computeStunCoverage(sp: any, lostSeconds = 0): number {
    const stunCount = sp?.stunCount ?? 0
    if (stunCount <= 0) return 0
    const battleTime = configStore.enemy.battleTime ?? 180
    const invTime = configStore.enemy.invincibleTime ?? 0
    const effectiveTime = Math.max(0, battleTime - invTime)
    if (effectiveTime <= 0) return 0
    // 决算截断：有效失衡时长 = 窗口总时长 − 截断损失秒数（佩洛伊斯右分支做完即清空剩余失衡时间）
    const stunSeconds = Math.max(0, stunCount * computeWindowDuration() - lostSeconds)
    return Math.min(1, stunSeconds / effectiveTime)
  }

  /** 失衡易伤覆盖率：固定来自 calcOutput 收敛结果（捏轴只决定哪些动作吃易伤，不改变覆盖率） */
  const stunCoverage = computed<number>(() => calcOutput.value?.stunCoverage ?? 0)

  /** 普攻段 id → 'basic' 归一（轴编辑器口径）：catalog 平A段（如 1061001）在轴内时归并到 basic 池/聚合行，
   *  与 computeCorinStunBonusMoves 的 basicMoveIds 归并口径一致（否则 raw 普攻段永远匹配不上 '0:basic' 池）。 */
  const basicMoveIdsBySlot = computed<Map<number, Set<string>>>(() => {
    const m = new Map<number, Set<string>>()
    for (const c of configStore.team) {
      const skills = catalogStore.agentSkillsByAgentMap.get(c.agentId)
      const ids = skills?.categories.find(cat => cat.id === 'basic')?.moves.map(mv => mv.id) ?? []
      if (ids.length > 0) m.set(c.slot, new Set(ids))
    }
    return m
  })

  /** 失衡轴计算结果（轴启用时计算，否则 null） */
  const stunAxisResult = computed(() => {
    if (!configStore.useStunAxis && !autoActive.value) return null
    const axes = effectiveStunAxes.value
      .filter(a => a.actions.length > 0)
      .map(axis => ({
        ...axis,
        actions: axis.actions.map(act => {
          const basicIds = basicMoveIdsBySlot.value.get(act.slot)
          if (basicIds?.has(act.moveId)) return { ...act, moveId: 'basic' }
          return act
        }),
      }))
    if (axes.length === 0) return null
    const stunRes = stunPoolResult.value
    const resRes = adjustedResourceResult.value
    if (!stunRes || !resRes) return null

    // 按 (slot, moveId) 构建全局资源池 / 单位时长（basic 单位=秒，其余单位=次）
    const globalPool: Record<string, number> = {}
    const perActionDuration: Record<string, number> = {}
    for (const char of resRes.characters) {
      const slot = char.slot
      const basicTime = char.timeAllocation.basicAttackTime ?? 0
      if (basicTime > 0) {
        globalPool[`${slot}:basic`] = basicTime
        perActionDuration[`${slot}:basic`] = 1
      }
      for (const exec of char.executions) {
        const mid = exec.moveId === 'basic_attack' ? 'basic' : exec.moveId
        if (!mid || exec.count <= 0) continue
        // 诺姆赠送连携行（chainGift）不进全局池：赠送次数由膛温自动决定、吃易伤由轴内标记块计数，
        // 混进 globalPool 会把普通连携的轴内配额虚高（普通 8 + 赠送 6 = 14）
        if (exec.chainGift) continue
        const key = `${slot}:${mid}`
        globalPool[key] = (globalPool[key] ?? 0) + exec.count
        if (perActionDuration[key] === undefined) perActionDuration[key] = exec.actionTime || 2
      }
    }

    // 每单位失衡值：basic=每秒失衡值（总失衡/平A秒数），其他=单次失衡值（总失衡/次数）
    const perActionStun: Record<string, number> = {}
    for (const c of stunRes.contributions ?? []) {
      const mid = c.moveId === 'basic_attack' ? 'basic' : c.moveId
      if (!mid) continue
      const key = `${c.slot}:${mid}`
      if (mid === 'basic') {
        // ⚠ 按身份查（`resRes.characters` 由 `configs.map` 产、根因同上：压缩数组下标 ≠ 槽位号）
        const basicTime = resRes.characters.find(ch => ch.slot === c.slot)?.timeAllocation.basicAttackTime ?? 0
        perActionStun[key] = basicTime > 0 ? c.totalStun / basicTime : 0
      } else {
        const perHit = c.count > 0 ? c.totalStun / c.count : 0
        perActionStun[key] = (perActionStun[key] ?? 0) + perHit
      }
    }

    return calcStunAxis({
      axes,
      globalPool,
      perActionStun,
      perActionDuration,
      stunCount: stunRes.stunCount,
      windowDuration: computeWindowDuration(),
      bossStunValue: configStore.enemy.stunValue,
      battleTime: configStore.enemy.battleTime ?? 180,
      invincibleTime: configStore.enemy.invincibleTime ?? 0,
    })
  })

  /** 轴模式自动补齐的交互次数（保底，最终收敛值）：交互栏显示「弹刀 +N / 双反 +M」用 */
  const interactionTopUp = computed<{ slot: number; parry: number; dual: number } | null>(() => {
    // 懒守卫：无声明该能力的角色或非轴模式 → 不触发全量计算（首页交互栏只在选中该角色时读取）。
    // 槽位由模块声明（producesInteractionTopUp）驱动，本文件不含角色 id（2026-09-12 #10 真清偿）。
    const slot = configStore.team.findIndex(c => c.agentId && getAgentMechanic(c.agentId)?.producesInteractionTopUp)
    if (slot < 0 || (!configStore.useStunAxis && !autoActive.value)) return null
    const topUp = calcOutput.value?.interactionTopUp
    if (!topUp || (topUp.parry === 0 && topUp.dual === 0)) return null
    return { slot, ...topUp }
  })

  // ===== runCalcRound 本体在 resourceCalc/convergence.ts（#10 收线刀：1180 行逐字整体搬）=====
  // deps = 函数自由面 13 名（侦察：本函数体内零外层 let 依赖，跨轮态走显式 threads）；
  // 不注入任何下游 computed（单轮计算只经返回值流出，见 convergence.ts#createRunCalcRound 头注释）。
  const runCalcRound = createRunCalcRound({
    configStore, catalogStore, panels, resourceConfig,
    computeWindowDuration, computeStunCoverage, buildStackAxes, expandExecutedToCounts,
    resolveAxes, calcAnomalyPoolInput, extractAnomalyExecsFrom, extractStunExecsFrom, autoActive,
  })

  /** Boss 预设弹刀反推（保底4失衡，最终收敛值）：交互栏显示「击破位弹刀 +N / 主C 剩余」用 */
  const parrySplitResult = computed<{ breakerSlot: number; topUp: number; breakerParry: number; mainDpsParry: number; breakerNoFollowUp: number; mainDpsNoFollowUp: number; breakerDecibelOnly: number; parryTotal: number; parryNoFollowUpTotal: number } | null>(() => {
    // 懒守卫：未应用带 parryTotal/parryNoFollowUpTotal/parryDecibelOnlyTotal 的 Boss、未勾选「保底4失衡」或队伍无击破位时不触发全量计算
    const parryTotal = configStore.appliedBoss?.parryTotal ?? 0
    const parryNoFollowUpTotal = configStore.appliedBoss?.parryNoFollowUpTotal ?? 0
    const parryDecibelOnlyTotal = configStore.appliedBoss?.parryDecibelOnlyTotal ?? 0
    if (parryTotal + parryNoFollowUpTotal + parryDecibelOnlyTotal <= 0) return null
    if (configStore.getMechanicSetting('guarantee.stun', 0) === 0) return null
    const breakerSlot = configStore.team.findIndex(c => c?.agentId && catalogStore.agentsMap.get(c.agentId)?.specialty === 'stun')
    // 无击破位队伍：弹刀由主C（槽位 0）承担（noBreakerFallback，见 runCalcRound 同款回落）
    if (breakerSlot < 0 && configStore.team.length === 0) return null
    const split = calcOutput.value?.parrySplit
    if (!split) return null
    const effectiveBreakerSlot = breakerSlot >= 0 ? breakerSlot : 0
    return { breakerSlot: effectiveBreakerSlot, topUp: split.topUp, breakerParry: split.breakerParry, mainDpsParry: split.mainDpsParry, breakerNoFollowUp: split.breakerNoFollowUp, mainDpsNoFollowUp: split.mainDpsNoFollowUp, breakerDecibelOnly: parryDecibelOnlyTotal, parryTotal, parryNoFollowUpTotal }
  })

  /** 保底4失衡未达成诊断（CC-156）：未勾选 / 无池结果 / 已达成 → null；判定见 core/parrySplit.ts#guaranteeStunShortfall */
  const guaranteeStunShortfallResult = computed<(GuaranteeStunShortfall & { parryTotal: number }) | null>(() => {
    if (configStore.getMechanicSetting('guarantee.stun', 0) === 0) return null
    const sp = stunPoolResult.value
    if (!sp) return null
    const split = parrySplitResult.value
    const s = guaranteeStunShortfall(sp.stunCount, split)
    return s ? { ...s, parryTotal: split?.parryTotal ?? 0 } : null
  })

  /** 特殊动作喧响奖励 */
  const specialActionBonus = computed<SpecialActionBonusResult | null>(() => {
    const topUp = interactionTopUp.value
    const split = parrySplitResult.value
    const perSlotParry = configStore.team.map((c, s) => {
      let p = (c.parryCount ?? 0) + (topUp && s === topUp.slot ? topUp.parry : 0)
      if (split) {
        if (s === split.breakerSlot) p = split.breakerParry + split.breakerNoFollowUp + split.breakerDecibelOnly
        // 主C：正常弹刀剩余 + **不带支援突击弹刀的对半分那一半**（用户口径 2026-09-10）
        else if (s === 0 && (c.parryCount ?? 0) <= 0) p = split.mainDpsParry + split.mainDpsNoFollowUp
      }
      return p
    })
    const perSlotDodgeCounter = configStore.team.map(c => c.dodgeCounterCount ?? 0)
    const perSlotQuickAssist = configStore.team.map(c => c.quickAssistCount ?? 0)
    const perSlotChain = [0, 0, 0]

    for (const charResult of resourceResult.value?.characters ?? []) {
      perSlotChain[charResult.slot] = charResult.chainCountTotal ?? 0
    }

    const result = calcSpecialActionBonus(perSlotParry, perSlotChain, perSlotDodgeCounter, perSlotQuickAssist)
    return result as SpecialActionBonusResult
  })



  // ===== 轴内易伤分配 =====
  /** 栈遍历：按资源（闪能/喧响/时间）门控，决定轴内实际执行哪些动作 */
  const stackTraversalResult = computed(() => {
    if ((!configStore.useStunAxis && !autoActive.value) || !stunAxisResult.value) return null
    const resRes = adjustedResourceResult.value
    const sp = stunPoolResult.value
    if (!resRes || !sp) return null

    // 各槽位可用闪能/喧响
    const energyBySlot: Record<number, number> = {}
    const decibelBySlot: Record<number, number> = {}
    for (const c of resRes.characters) {
      energyBySlot[c.slot] = c.energySource?.total ?? 0
      decibelBySlot[c.slot] = c.decibelSource?.total ?? 0
    }

    return calcStunAxisStack({
      axes: buildStackAxes(effectiveStunAxes.value),
      stunCount: sp.stunCount,
      windowDuration: computeWindowDuration(),
      energyBySlot,
      decibelBySlot,
    })
  })

  /** (slot, moveId) → 轴内单位数分配（来自栈遍历 executed，连段展开成招式，outAxisUnits 由 axisSplitFor 反推） */
  const axisAllocation = computed(() => {
    const exec = stackTraversalResult.value?.executed
    if (!exec) return {}
    const counts = expandExecutedToCounts(exec, stackTraversalResult.value?.basicFillBySlot ?? {})
    const out: Record<string, { slot: number; moveId: string; inAxisUnits: number; outAxisUnits: number }> = {}
    for (const v of Object.values(counts)) {
      out[`${v.slot}:${v.moveId}`] = { slot: v.slot, moveId: v.moveId, inAxisUnits: v.count, outAxisUnits: 0 }
    }
    return out
  })

  /**
   * 伴随事件（子事件易伤跟随父动作的轴内占比）：child moveId → 0-1。
   * 占比 = Σ父动作栈执行轴内单位 / Σ父动作全局总单位（与直伤 axisSplitFor 同源，栈遍历口径）。
   * 替代旧的「axisDetails 布尔 OR」：①父动作被 basicMoveIdsBySlot 改写为 'basic' 导致按原
   * moveId 查不到（爱丽丝 SW3 极性强击轴内易伤整段丢失）；②多次出现一窗在内即全量易伤、
   * 跨边界分数 inAxisRatio<1 反而归 0——布尔口径与直伤的分数期望模型不一致。
   */
  const attachedInAxisMap = computed<Record<string, number>>(() => {
    const out: Record<string, number> = {}
    const alloc = axisAllocation.value
    if (!alloc || Object.keys(alloc).length === 0) return out
    const totalUnits: Record<string, number> = {}
    for (const ch of adjustedResourceResult.value?.characters ?? []) {
      for (const e of ch.executions ?? []) {
        if (!e.moveId || (e.count ?? 0) <= 0) continue
        const key = `${ch.slot}:${e.moveId}`
        totalUnits[key] = (totalUnits[key] ?? 0) + e.count
      }
    }
    for (const char of configStore.team) {
      if (!char.agentId) continue
      const mod = getAgentMechanic(char.agentId)
      if (!mod?.attachedEvents) continue
      for (const [parent, children] of Object.entries(mod.attachedEvents)) {
        let inAxis = 0
        let total = 0
        for (const [key, v] of Object.entries(alloc)) {
          if (key.endsWith(`:${parent}`)) inAxis += v.inAxisUnits
        }
        for (const [key, t] of Object.entries(totalUnits)) {
          if (key.endsWith(`:${parent}`)) total += t
        }
        const frac = total > 0 ? Math.max(0, Math.min(1, inAxis / total)) : 0
        for (const child of children) out[child] = frac
      }
    }
    return out
  })

  /** 伤害池：按角色/事件拆分直伤、异放、乱流（消费转大修正后的执行计划） */
  /** 伤害池行（构建逻辑在 resourceCalc/damagePool.ts，纯函数 + 快照入参） */
  const damagePoolRows = computed<DamagePoolRow[]>(() => buildDamagePoolRows({
    configStore,
    catalogStore,
    adjustedResourceResult: adjustedResourceResult.value,
    damagePanels: damagePanels.value,
    stunCoverage: stunCoverage.value,
    axisAllocation: axisAllocation.value,
    attachedInAxisMap: attachedInAxisMap.value,
    anomalyPoolResult: anomalyPoolResult.value,
    inStunAnomalyState: inStunAnomalyState.value,
    bossAnomalyState: bossAnomalyState.value,
    stunPoolResult: stunPoolResult.value,
    effectiveStunAxes: effectiveStunAxes.value,
    entrySnapshotPanels: entrySnapshotPanels.value,
    globalAnomalyMultiplier: globalAnomalyMultiplier.value,
    ultPromoteCount: ultPromoteCount.value,
    agentNames: agentNames.value,
    autoActive: autoActive.value,
    stunAxisResult: stunAxisResult.value,
    axisBucketsBySlot: axisOverlays.value.bucketsBySlot,
    axisScalarBySlot: axisOverlays.value.scalarBySlot,
    computeWindowDuration,
  }))

  /**
   * 模块异常事件记录（CC-28；原 `remielleVoidflareEvents`——按身份 `['1581']` 找槽、读蕾米面板的**编排层角色分支**，
   * 违反 AGENTS.md「禁止在 useResourceCalc 加角色分支」）。槽位 0→2 逐模块派发 `anomalyEventRecords` 并拼接；
   * 该槽无面板 ⇒ 跳过（= 原 `panelAt` 缺失返回 []）。实现：蕾米埃尔（虚耀池/耀变/特殊虚耀）；
   * 简（CC-29：6 命强击暴击附伤，原 `anomalyDamageEvents` 末尾按身份 `['1261']` 的分支——迁移后展示顺序由
   * 「通用异常伤害事件之后」变为「之前」，已拍板接受，见 census §5.23）。
   */
  const moduleAnomalyEventRecords = computed<AnomalyEventRecord[]>(() => {
    const perSlotAnomalyTriggers = anomalyPoolResult.value?.perSlotAnomalyTriggers ?? []
    const teamAgentIds = [0, 1, 2].map(slot => configStore.team[slot]?.agentId)
    // 逐属性触发次数：同 element 取首条（= 原 `perElement.find` 语义）
    const perElementTriggerCounts: Partial<Record<string, number>> = {}
    for (const prog of anomalyPoolResult.value?.perElement ?? []) {
      if (!(prog.element in perElementTriggerCounts)) perElementTriggerCounts[prog.element] = prog.triggerCount
    }
    const out: AnomalyEventRecord[] = []
    for (let slot = 0; slot < 3; slot++) {
      const agentId = configStore.team[slot]?.agentId
      const hook = agentId ? getAgentMechanic(agentId)?.anomalyEventRecords : undefined
      if (!hook) continue
      const panel = panelAt(panels.value, slot)
      if (!panel) continue
      const cinemaLevel = configStore.team[slot]?.cinemaLevel ?? 0
      out.push(...hook({ slot, panel, teamAgentIds, perSlotAnomalyTriggers, cinemaLevel, perElementTriggerCounts }))
    }
    return out
  })

  /** 通用异常事件：灼烧/感电/侵蚀/强击/碎冰 */
  const anomalyVirtualPanels = computed<AnomalyVirtualPanelBuild[]>(() =>
    (anomalyPoolResult.value?.perElement ?? [])
      .map(prog => buildAnomalyVirtualPanel(prog, panels.value, configStore, catalogStore))
      .filter((build): build is AnomalyVirtualPanelBuild => !!build),
  )

  const anomalyDamageEvents = computed<AnomalyEventRecord[]>(() => {
    const specs: Record<string, { label: string; baseTicks?: number; tickInterval?: number; single?: boolean }> = {
      fire: { label: '灼烧', baseTicks: 20, tickInterval: 0.5 },
      electric: { label: '感电', baseTicks: 10, tickInterval: 1 },
      ether: { label: '侵蚀', baseTicks: 20, tickInterval: 0.5 },
      physical: { label: '强击', single: true },
      ice: { label: '碎冰', single: true },
    }
    const events: AnomalyEventRecord[] = []
    for (const build of anomalyVirtualPanels.value) {
      const prog = anomalyPoolResult.value?.perElement.find(item => item.element === build.element)
      if (!prog) continue
      const spec = specs[prog.element]
      if (!spec) continue
      const durationBonus = getTeamAnomalyDurationBonus(configStore, catalogStore, prog.element)
      const formula = spec.single
        ? `${spec.label} ${prog.element === 'ice' ? '500%' : '713%'} 单次`
        : `${spec.label} ${prog.element === 'electric' ? '125' : prog.element === 'ether' ? '62.5' : '50'}% × ${(spec.baseTicks ?? 0) + Math.round((durationBonus ?? 0) / (spec.tickInterval ?? 1))} tick`
      events.push({
        id: `anomaly-damage-event-${prog.element}`,
        type: 'anomaly_trigger',
        label: spec.label,
        source: `${elementLabel(prog.element)}异常虚拟面板`,
        count: prog.triggerCount,
        formula,
        fields: ['虚拟面板.ATK', '虚拟面板.异常精通', '虚拟面板.增伤', '虚拟面板.穿透率/穿透值'],
        note: `按积蓄权重加权：${build.rows.map(row => `${row.name} ${(row.weight * 100).toFixed(1)}%`).join(' + ')}`,
      })
    }

    // 简 6 命强击暴击附伤事件已迁 jane 模块 `anomalyEventRecords`（CC-29），经 `moduleAnomalyEventRecords` 派发。
    return events
  })


  /** 角色名称映射（agentId → 中文名） */
  const agentNames = computed<Record<string, string>>(() => {
    const map: Record<string, string> = {}
    for (let i = 0; i < 3; i++) {
      const char = configStore.team[i]
      if (!char?.agentId) continue
      const agent = catalogStore.agentsMap.get(char.agentId)
      if (agent) {
        map[char.agentId] = agent.name.zhCN || agent.name.en || char.agentId
      }
    }
    return map
  })

/** 队伍总伤害 = 伤害池求和（供影响图等外部使用） */
const teamTotalDamage = computed(() =>
  damagePoolRows.value.reduce((sum, row) => sum + row.totalDamage, 0),
)

/** 伤害来源分解（诊断）：每角色 直伤/异常 × 总倍率/属性区——检查总伤害异常时定位是倍率错还是属性区错 */
const damageSourceBreakdown = computed<DamageSourceBreakdown[]>(() =>
  ResourceCalcHelpers.computeDamageSourceBreakdown(damagePoolRows.value),
)

  return {
    resourceConfig,
    resourceResult,
    stunPoolResult,
    inStunAnomalyState,
    bossAnomalyState,
    anomalyPoolResult,
    specialActionBonus,
    damagePoolRows,
    damageSourceBreakdown,
    moduleAnomalyEventRecords,
    anomalyDamageEvents,
    anomalyVirtualPanels,
    agentNames,
    panels,
    teamTotalDamage,
    stunAxisResult,
    stackTraversalResult,
    effectiveStunAxes,
    matchedPlanName,
    autoPreset,
    autoActive,
    windowDuration,
    /**
     * **失衡窗口占比（0..1）**——含**决算截断损失秒**的权威口径
     * （`stunSeconds = 次数 × 窗长 − verdictSecondsLost`，见 `runCalcRound` 的决算段）。
     *
     * 为什么暴露它：难度轴的「非失衡占比」修正（`computeDifficulty` 的逐类型公式 `interactionFormula`）要的是
     * 「真有多少秒在失衡里」。用户口径 2026-09-20 点名的场景 = **雨果多次结算让非失衡时间上升、
     * 弹刀等交互次数也跟着上升，但那不代表难度高** —— 决算把窗口剩余失衡时间清空，实际失衡时间
     * 比「次数 × 窗长」少，用近似值会把难度算**高**。
     * 此前它只在内部消费（伤害池按覆盖率折易伤），展示层若自行重算就拿不到 `verdictSecondsLost`
     * ⇒ 这里按规则 11（共享量从单一来源引用）暴露，不再让调用方各自近似。
     */
    stunCoverage,
    interactionTopUp,
    parrySplitResult,
    guaranteeStunShortfallResult,
    ultPromoteCount,
    ultPromoteHug60,
  }
}
