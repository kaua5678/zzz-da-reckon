import { computed } from 'vue'
import { useConfigStore } from '@/stores/config'
import { useCatalogStore } from '@/stores/catalog'
import { TIME_BUDGET_TOLERANCE_SECONDS } from '@/core/resource'
import { stunPlanProjectionFromCode } from '@/core/stunPlanProjection'
import { calcStunAxis } from '@/core/stunAxis'
import type { InStunAnomalySummary } from '@/types/resource'
import type { StunAxis } from '@/types/resource'
import { netFrontlineOccupation } from '@/core/resource/helpers'
import { calcStunAxisStack } from '@/core/stunAxisStack'
import { calcSpecialActionBonus } from '@/core/anomalyPool'
import { BossAnomalyStateResult } from '@/core/stunAxis/inStunAnomaly'
import { getAgentMechanic } from '@/mechanics'
import { initialCalcRoundThreads, threadsAfterNullRound } from './resourceCalc/roundThreads'
import { buildDamagePoolRows } from './resourceCalc/damagePool'
import { createConvergenceRoundInputs, createRunCalcRound, type CalcRoundResult } from './resourceCalc/convergence'
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
import * as ResourceCalcHelpers from './resourceCalc/helpers'
import type { DamagePoolRow, DamageSourceBreakdown, AnomalyVirtualPanelBuild } from './resourceCalc/helpers'

/**
 * 失衡次数 ↔ 资源池（连携=每失衡连携×失衡次数）↔ 失衡池 外不动点迭代上限。
 * 2026-08-24 实证（南宫羽C6+踉跄失衡延长+3s）：窗口延长加强「窗口↑→前台预算↓→失衡值↓→
 * 失衡次数↓」负反馈，整数边界间呈阻尼震荡（振幅≈×0.55/轮），12 轮不够落定 → 提到 20；
 * 收敛后结果不变，只多花极少数非收敛场景的轮次成本。
 */
const MAX_OUTER_ITER = 20

const { computePanel, computeRemielleEntryPanel, getTeamAnomalyDurationBonus, getWindInfectionCoverage, elementLabel, remielleSpecialVoidflareCount, buildCharConfig, applyTeamMechanics, buildAnomalyVirtualPanel, collectAxisWindowOverlays } = ResourceCalcHelpers
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
      maxIterations: 20,
      // 失衡计划值 → 计数的投影方式（C7 实验开关，默认 off = 现行口径；见 core/stunPlanProjection.ts）
      stunPlanProjection: stunPlanProjectionFromCode(configStore.getMechanicSetting('time.stunPlanProjection', 0)),
      characters,
    }
  })

  /** 各角色面板 */
  const panels = computed<PanelValues[]>(() => {
    const result: PanelValues[] = []
    for (let i = 0; i < 3; i++) {
      const p = computePanel(i, configStore, catalogStore)
      if (p) result.push(p)
    }
    return result
  })

  /** 各角色“进场记录面板”（特殊虚耀使用） */
  const remielleEntryPanels = computed<PanelValues[]>(() => {
    const result: PanelValues[] = []
    for (let i = 0; i < 3; i++) {
      const p = computeRemielleEntryPanel(i, configStore, catalogStore)
      if (p) result.push(p)
    }
    return result
  })

  /** 蕾米异化系数倍率：1 + (异化度 + 异化度提升) / 100，乘到所有异常相关伤害 */
  const remielleAnomalyMultiplier = computed<number>(() => {
    const slot = configStore.team.findIndex(char => {
      const agent = char.agentId ? catalogStore.getAgent(char.agentId) : null
      return agent?.id === '1581' || agent?.teammateBuffId === '1581'
    })
    const panel = slot >= 0 ? panels.value[slot] : null
    if (!panel) return 1
    const coefficient = (panel.remielleRefringeCoefficient ?? 0) + (panel.remielleRefringeCoefficientBonusPct ?? 0)
    return 1 + coefficient / 100
  })

  // ===== 两轮迭代破循环（anomalyPool ↔ stunPool ↔ stunCoverage） =====
  // Round 0: 无易伤 → 畏缩覆盖率初算
  // Round 1: 有易伤 → 畏缩覆盖率修正 → 最终收敛

  // 收敛轮输入簇已迁 resourceCalc/convergence.ts（#10 首批租户；逐字搬移，deps 注入 store/computed ref）
  const {
    extractAnomalyExecsFrom, extractStunExecsFrom, autoPreset, autoActive,
    resolveAxes, buildStackAxes, expandExecutedToCounts, calcAnomalyPoolInput,
  } = createConvergenceRoundInputs({ configStore, catalogStore, panels, resourceConfig, remielleAnomalyMultiplier })


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
   * 计算器就是要循环计算（游戏实时因果，计算器定点迭代）；失衡次数/连携次数/好评转大互为反馈，单调有界必收敛。
   */
  const calcOutput = computed(() => {
    if (!resourceConfig.value || !catalogStore.ready) return null
    // 锁定失衡次数（命座对比固定场景）：stunCount 固定输入不回填（"操作够就能打 N 次失衡"口径），
    // 但异常喧响/终结技次数反馈仍收敛，避免与资源利用率页口径分裂
    const lockedStunCount = configStore.enemy.stunCountLock ?? -1
    const stunWindowDur = computeWindowDuration()
    const stunEffTime = Math.max(0, (configStore.enemy.battleTime ?? 180) - (configStore.enemy.invincibleTime ?? 0))
    /** 轴退化判据容差（秒）：收敛后仍留 ~2s 合轴可覆盖的量化残差（与 timeLedger 测试口径一致） */
    const AXIS_FALLBACK_TOLERANCE_SEC = 2
    /** Σ前台行净占用（扣轴内合轴节省 + 招式合轴抵扣，max 不叠加；与 iterate 平A池、
     *  teamCompare.actionTimeTotal 同口径，单一事实源 netFrontlineOccupation） */
    const frontlineTotalOf = (r: CalcRoundResult | null): number => {
      if (!r?.resourceResult) return 0
      return netFrontlineOccupation(r.resourceResult)
    }
    /**
     * 跑完整外层不动点。forceNoAxis = 轴退化重算（用户口径 2026-08：轴的资源需求
     * （喧响/嗔火/轴内块 × 窗口数）超出时间预算 → 必要时间 > 战斗时间 → 该轴不可操作
     * （需 boss 秽盾等外界环境才打得成）→ 退化为一般轴（不注入轴块/连携覆盖/自动补齐）重算）。
     */
    function runOuterLoop(forceNoAxis: boolean, interactionScale?: number): { out: CalcRoundResult | null; outerRounds: number; outerConverged: boolean; outerExit: 'stable' | 'cycle' | 'maxIter' } {
      let stunCount = lockedStunCount >= 0 ? lockedStunCount : 0
      let out: CalcRoundResult | null = null
      let threads = initialCalcRoundThreads()
      let prevUltSeq = ''
      let prevAnomalySeq = ''
      let prevTopUpSeq = ''
      let prevParrySplitSeq = ''
      let prevBackstageSeq = ''
      let prevBuildUpFracSeq = ''
      let prevDecibelParrySeq = ''
      const seenStunCounts = new Set<number>()
      let outerRounds = 0
      let outerConverged = false
      let outerExit: 'stable' | 'cycle' | 'maxIter' = 'maxIter'
      // 净失衡迭代（用户 Excel 口径）：覆盖率由上一轮失衡次数得出，非失衡占比缩放全来源净失衡，
      // 时间预算把超出的残失衡折成小数——正反馈被全局负反馈对抗，收敛到静止
      for (let k = 0; k < MAX_OUTER_ITER; k++) {
        outerRounds = k + 1
        // 锁定次数（用户明确意图）不走净失衡缩放与小数截断，仍用原始池计数
        const locked = lockedStunCount >= 0
        out = runCalcRound(stunCount, threads, { forceNoAxis, interactionScale })
        // null 轮（如无失衡行队伍）：反馈线程按 threadsAfterNullRound 规则回退（持久组保留、其余重置）
        if (!out) {
          threads = threadsAfterNullRound(threads)
          // null 轮重置收敛序列判据：防止下一轮非 null 拿陈旧 prev* 误判 stable（防御性）
          prevUltSeq = ''
          prevAnomalySeq = ''
          prevTopUpSeq = ''
          prevParrySplitSeq = ''
          prevDecibelParrySeq = ''
          continue
        }
        const t = out.threadsNext
        const ait = t.auricInkFlash
        const rawNext = out?.stunPool?.stunCount ?? 0
        // 净失衡缩放 + 时间可行性截断：非失衡占比缩放全来源净失衡，超出可容纳窗口数的残失衡按残差时间系数折成小数
        let next = rawNext
        if (!locked && stunWindowDur > 0 && stunEffTime > 0) {
          const coverage = Math.min(1, stunCount * stunWindowDur / stunEffTime)
          next = rawNext * (1 - coverage)
          const maxFull = Math.floor(stunEffTime / stunWindowDur)
          if (next > maxFull) {
            const residualFactor = stunEffTime / stunWindowDur - maxFull
            const excess = next - maxFull
            next = maxFull + Math.min(Math.max(0, excess), residualFactor)
          }
        }
        // 非失衡时间充足性约束：失衡次数过高时，角色的必做动作（回能/强特/喧响）时间
        // 会被挤到没有足够非失衡时间去执行，打法循环本身就不成立。
        // 收敛到非失衡时间 ≥ 该轮实际必要时间（含链的保守上界，但安全）。
        if (!locked && stunEffTime > 0 && stunWindowDur > 0) {
          const totalNecessary = (out?.resourceResult?.characters ?? []).reduce(
            (s, c) => s + (c.timeAllocation?.necessaryTime ?? 0), 0)
          const nonStunTime = stunEffTime - next * stunWindowDur
          if (nonStunTime < totalNecessary) {
            next = Math.max(0, (stunEffTime - totalNecessary) / stunWindowDur)
          }
        }
        // 终结技次数与异常喧响奖励序列稳定才收敛（异常奖励 → 终结技次数 → 执行计划/时间分配 → 异常触发次数）
        const ultSeq = (out?.resourceResult?.characters ?? []).map(c => c.ultimateCount).join(',')
        const anomalySeq = (out?.anomalyPool?.perSlotBonus ?? []).map(v => Math.round(v)).join(',')
        const topUpSeq = `${out?.banyueTopUp?.parry},${out?.banyueTopUp?.dual}`
        const parrySplitSeq = out?.parrySplit ? `${out.parrySplit.breakerParry},${out.parrySplit.mainDpsParry}` : ''
        const backstageSeq = JSON.stringify(out?.threadsNext?.backstageAuto ?? {})
        // 失衡分数序列：合轴自动填充反推以 buildUp 分数收敛（floor 后 stunCount 在 3.0-3.99 区间
        // 恒为 3，仅按 stunCount 判稳会让 N 没爬完就提前 stable——用户口径：保底4要打满）
        const buildUpFracSeq = out?.stunPool ? (out.stunPool.totalStunBuildUp / out.stunPool.bossStunValue).toFixed(2) : ''
        const decibelParrySeq = `${t.decibelParry ?? 0}`
        const feedbackStable = ultSeq === prevUltSeq && anomalySeq === prevAnomalySeq && topUpSeq === prevTopUpSeq && parrySplitSeq === prevParrySplitSeq && decibelParrySeq === prevDecibelParrySeq && backstageSeq === prevBackstageSeq && buildUpFracSeq === prevBuildUpFracSeq
        if (lockedStunCount >= 0) {
          if (feedbackStable) { outerConverged = true; outerExit = 'stable'; break }
        } else {
          // 失衡次数与玄墨异常触发次数双稳定才收敛（异常触发 → 回闪能 → 强特 → 积蓄 → 触发）
          // 小数失衡时代：浮点比较改 0.05 容差；2-循环去重键取 0.1 粒度
          if (Math.abs(next - stunCount) < 0.05 && ait === threads.auricInkFlash && feedbackStable) { outerConverged = true; outerExit = 'stable'; break }
          if (seenStunCounts.has(Math.round(next * 10))) { outerExit = 'cycle'; break }
          seenStunCounts.add(Math.round(stunCount * 10))
          stunCount = next
        }
        // 线程推进：anomalyDecibelBonus 旧版从 out.anomalyPool 现取（threadsNext 内置空数组占位），
        // 其余 = threadsNext（runCalcRound 已按 prev 兜底算好下一轮值）
        threads = { ...t, anomalyDecibelBonus: out?.anomalyPool?.perSlotBonus ?? [] }
        prevDecibelParrySeq = decibelParrySeq
        prevUltSeq = ultSeq
        prevAnomalySeq = anomalySeq
        prevTopUpSeq = topUpSeq
        prevParrySplitSeq = parrySplitSeq
        prevBackstageSeq = backstageSeq
        prevBuildUpFracSeq = buildUpFracSeq
      }
      return { out, outerRounds, outerConverged, outerExit }
    }

    let r = runOuterLoop(false)
    // 轴退化检测（用户口径 2026-08）：轴的资源需求（轴内块/自动补齐交互 × 窗口数）超出战斗时间预算
    // → 轴不可操作（需 boss 秽盾等外界环境才打得成）→ 退化为一般轴重算。
    // 误伤护栏：般岳等角色「配置本身的交互行」（金身20/招架10 等）也会把必要时间推超预算
    // （banyue.test 锁窗注释：2026-08-23 已知现状）——这与轴无关，弃轴解决不了。
    // 故先跑一次非轴对照：仅当**非轴模式可行**（Σ前台净占用 ≤ 预算+容差）时才认定「轴需求是超时主因」并退化。
    // 非轴也超 = 配置本身超预算 → 走下方**非轴降配**（二分缩放交互次数）。
    /**
     * ===== 阶段 S3：可行化决策（`stageResolveFeasibility`，2026-09-11 显式化）=====
     * 「轮结果 ⇒ 时间账能不能接受，不能接受就收拾」的唯一入口（此前这段是内联在 `calcOutput` 里的
     * 匿名代码块，改动要读 60 行上下文）。**契约**：
     *   输入：`r0` = 当前接受的整轮结果（含 resolvedAxes 判定轴/非轴态）；
     *        隐含输入：`runOuterLoop` 闭包（重跑整轮）、`stunEffTime`（预算）、`lockedStunCount`（锁窗）。
     *   输出：`{ r, axisFallback, interactionScale }` —— `r` 可能被换成**非轴态**或**某个降配档**。
     *   判据：① 轴太厚（`overBudgetNet` 或补齐非法）⇒ 退化非轴；② 非轴仍撑不下
     *         （`overBudgetNet` **或** 装配期真截断 `truncatedToo`）⇒ 二分缩放交互次数（6 轮，~1.6%）。
     *   锁窗（`lockedStunCount >= 0`）= 用户明确意图 ⇒ **一律不动**，超时如实上报。
     * 现状两条臂的语义与生效面见下方注释；**下一步**（账本 round 4 工作单）：
     *   ① 给每次试算加快照/还原（试算纯化——实测被拒试算的副作用会留进最终态）；
     *   ② 给轴侧 `r = noAxis` 加「时间账不恶化」闸门（现在是无条件替换，实测能掉 2.9s 净占用）。
     */
    type RoundOut = ReturnType<typeof runOuterLoop>
    const stageResolveFeasibility = (
      r0: RoundOut,
    ): { r: RoundOut; axisFallback: boolean; interactionScale: number | undefined } => {
      let r = r0
      /**
       * **触发判据两条臂**（2026-09-11 用户口径：「交互次数导致的必要招式，通常是达成目标的最少要求；
       * 如果必须溢出才能达成目标，那就不会强行往上加交互次数了」）：
       *  - `overBudgetNet`（原口径，轴退化仍用它）：截断**之后**的净占用超预算。注意它读的是装配期
       *    截断后的量，截断保证净占用恒 ≤ 预算 ⇒ 对「必要行本来就装不下」的队**永不成立**；
       *  - `truncatedToo`（新增，只给**非轴降配**用）：装配期真截断 `overflowSeconds > 1s` ⇒ 手改配置
       *    （应用主流程）里那些"必要行装不下、装配期按比例砍行"的队现在会真正进入降配二分。
       *
       * **生效面（实测，2026-09-11）**：对 119 个预设 **0 delta**（`timeGolden` 全绿）——预设场景本来就被
       * 净占用臂/轴路径覆盖；对**默认配置的手组队**有效（实测 `仪玄+洛克茜+卢西娅`：截断 10.7→1.6s、
       * 超预算 1.0→0.96s、降配 ×0.906）。**仍有 19 个预设结构性截断**（必要行本身超预算，缩交互也装不下），
       * 那要靠轴侧触发 + 逐模块退化，见 `.claude/task-ledger-calc-core.md`。
       *
       * ⚠️ **验收臂决定结果**（2026-09-11 复核，纠正早前「试算不纯」的判断）：把「截断 ≤1s」也当验收
       * 条件会把好试算拒掉，于是 `r` 停在**二分前的基线态**——实测 `yixuan-roxy-lucia` 基线（非轴态）
       * 超预算 3.78s，而接受 scale=0.90625 的试算后是 0.96s（≈棘轮基线 1.0）。**被拒试算没有留下可观测
       * 副作用**（受控实验：显式拒绝全部试算得到的就是基线值；关掉热启动、关掉本触发臂也都复现同一基线）。
       * 所以「+2.8s 回归」= 验收太严 ⇒ 停在基线态，不是污染。**验收目标怎么定**（消截断 / 时间账不恶化 /
       * 伤害不降）是需要设计的口径问题，别再用「收紧验收」当修法。
       * 另：本队两次等价调用的 `axisFallback` 出现过 true/false 分叉 ⇒ 疑与「非实数化队落点随初值漂移」
       * 的既有性质有关（多不动点 + 调用顺序），待专项复现，不要先按"泄漏"去修。
       */
      const overBudgetNet = (x: CalcRoundResult | null) =>
        stunEffTime > 0 && x != null && frontlineTotalOf(x) > stunEffTime + AXIS_FALLBACK_TOLERANCE_SEC
      const truncatedToo = (x: CalcRoundResult | null) =>
        (x?.resourceResult?.overflowSeconds ?? 0) > TIME_BUDGET_TOLERANCE_SECONDS
      const overBudget = overBudgetNet
      let axisFallback = false
      let interactionScale: number | undefined
      let hadAxis = false
      // 锁定失衡次数（命座对比/锁窗测试）= 用户明确意图「操作够就能打 N 次失衡」，同锁定不回填口径：
      // 退化/降配会改变次数与交互结构，锁窗场景一律不触发（超时如实上报）。
      if (lockedStunCount < 0) {
        // 非法补齐（自动填充交互 > 200s，用户口径 2026-09-01）与超预算同等对待：
        // 轴要的资源根本填不出来 ⇒ 轴不可操作 ⇒ 走同一条退化路径（补齐次数已在源头清零）
        const topUpIllegal = (x: CalcRoundResult | null) => x?.banyueTopUp?.illegal === true
        if ((overBudget(r.out) || topUpIllegal(r.out)) && r.out?.resolvedAxes?.length) {
          hadAxis = true
          const noAxis = runOuterLoop(true)
          if (!overBudget(noAxis.out) && !topUpIllegal(noAxis.out)) axisFallback = true
          r = noAxis // 可行与否都进入非轴态：不可行则走下方降配
        }
        // 非轴降配（用户口径 2026-08-30 + 2026-09-11「必须溢出才能达成目标，就不会强行往上加交互次数」）：
        // 金身/招架这类手填交互与轴厚需求本质相同——撑不下都要降配。二分找**最大可行 scale**
        // （6 轮，精度 ~1.6%）；scale→0 仍不行 = 非交互必要时间本身超预算，如实保留报超时。
        //
        // ===== 验收目标（2026-09-11 设计，替换原来的「净占用 ≤ 预算+2s」单臂）=====
        // 单臂的毛病：① 它只看净占用、看不见「还在按比例砍行」（截断）；② 把「截断 ≤1s」并进单臂去收紧
        // 又会把好试算一起拒掉（实测 `yixuan-roxy-lucia`：拒绝全部试算 ⇒ 停在基线态 3.78s 超预算，
        // 而接受 scale=0.90625 ⇒ 0.96s 超预算 + 截断 10.7→1.6s）。所以改成**三条臂、都相对「二分前的基线态」
        // （不是相对绝对阈值）**、各自带 1s 量化容差（与棘轮同源）：
        //   ① `truncation(trial) ≤ truncation(base) + 1s` —— 不许砍得更多；
        //   ② `overBudget(trial) ≤ overBudget(base) + 1s` —— 不许更超预算；
        //   ③ `slack(trial) ≤ slack(base) + 1s` —— 不许把省下的时间变成留白/发呆（用户：「不搞表面工程」）。
        // 这三条一起 = 「**不比改动前更差**，且尽量消掉截断」⇒ 相对棘轮（只拦变差）**构造上不可能变红**，
        // 变红的只可能是 timeGolden 的硬字段（那是有意的改进，按规则 10 归因后重生）。
        if ((overBudget(r.out) || truncatedToo(r.out)) && !r.out?.resolvedAxes?.length) {
          // 搜索策略（2026-09-11 第三版，用户裁决）：**枚举候选 scale + 硬约束「真撑得下」取最大可行**。
          // 前两版教训：① 二分假定"可行域是 scale 的下闭区间"，把「截断 ≤1s」并进验收后会在
          // `yixuan-roxy-lucia` 上把好试算全拒（基线 3.78s 超预算）；② "最小截断优先"会把结构性溢出队压到
          // scale=0.0625（交互几乎清零）只为少几秒截断 —— 与「交互只取达成目标的**最少要求**」相反。
          // 本版：SCALES 由大到小扫，**首个同时满足「三臂不比基线更差」且「截断 ≤1s」**者即采纳
          // （= 最大可行 scale、保留最多交互）；**无人满足 ⇒ 不动**（保基线态、截断如实上报 → 逐模块退化）。
          const SCALES = [0.875, 0.75, 0.625, 0.5, 0.375, 0.25, 0.125, 0.0625]
          let best: { out: CalcRoundResult | null; outerRounds: number; outerConverged: boolean; outerExit: 'stable' | 'cycle' | 'maxIter'; scale: number } | null = null
          const baseNet = frontlineTotalOf(r.out)
          const baseOver = Math.max(0, baseNet - stunEffTime)
          const baseSlack = Math.max(0, stunEffTime - baseNet)
          const baseTruncation = r.out?.resourceResult?.overflowSeconds ?? 0
          const acceptsTrial = (x: CalcRoundResult | null): boolean => {
            if (!x) return false
            const net = frontlineTotalOf(x)
            const truncation = x.resourceResult?.overflowSeconds ?? 0
            return truncation <= baseTruncation + TIME_BUDGET_TOLERANCE_SECONDS
              && Math.max(0, net - stunEffTime) <= baseOver + TIME_BUDGET_TOLERANCE_SECONDS
              && Math.max(0, stunEffTime - net) <= baseSlack + TIME_BUDGET_TOLERANCE_SECONDS
          }
          // 注：曾试过「先用最小候选探一次、失败即跳过扫描」的成本闸门 —— **实测会改结果**
          // （同为"没人满足"的两种路径给出的最终态不同 ⇒ 再次印证试算顺序/次数会影响落点，见账本 round 5/7），
          // 故不采用；结构性溢出队因此要付满 8 次整轮试算（已知成本，见账本 Open）。
          for (const scale of SCALES) {
            const trial = runOuterLoop(true, scale)
            if (!acceptsTrial(trial.out)) continue
            if ((trial.out?.resourceResult?.overflowSeconds ?? 0) > TIME_BUDGET_TOLERANCE_SECONDS) continue
            best = { ...trial, scale }   // SCALES 递减 ⇒ 首个命中即最大可行
            break
          }
          if (best) {
            r = best
            axisFallback = hadAxis
            interactionScale = best.scale
          }
        }
      }
      return { r, axisFallback, interactionScale }
    }

    const { r: rAfterFeasibility, axisFallback, interactionScale } = stageResolveFeasibility(r)
    r = rAfterFeasibility
    const { out: baseOut, outerRounds, outerConverged, outerExit } = r
    const out = baseOut?.resourceResult
      ? {
          ...baseOut,
          resourceResult: {
            ...baseOut.resourceResult,
            convergence: {
              ...baseOut.resourceResult.convergence,
              outerConverged,
              outerRounds,
              outerExit,
              axisFallback,
              interactionScale,
            },
          },
        }
      : baseOut
    return out
  })

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
  const liuyinPromoteCount = computed(() => calcOutput.value?.promote ?? 0)
  /** 琉音好评转大收敛后的 60 抱拳次数（被替换掉的连携数） */

  /** 生效轴：条件轴方案命中后的轴（无方案时回退手动 stunAxes），供下游栈遍历/易伤分配统一消费 */
  const effectiveStunAxes = computed<StunAxis[]>(() => calcOutput.value?.resolvedAxes ?? configStore.stunAxes)

  /**
   * 失衡轴窗口覆盖四桶（般岳明王 / 仪玄凝神 / 佩洛伊斯阳炎 / 可琳扫除帮手）。
   *
   * 2026-09-12 #10 真清偿（棘轮站点 4-7/8）：原本是四个各自
   * `configStore.team.findIndex(...)` 按角色 id 找槽位的 computed——编排层替角色找槽位、
   * 判空、判轴，每加一个轴覆盖角色都要再改本文件。现在统一走注册表派发
   * （`collectAxisWindowOverlays` → 模块自己的 `axisWindowOverlays` 钩子），
   * 本文件不再出现任何角色 id。桶名与 DamagePoolContext 同名，下游零改动。
   */
  const axisOverlays = computed(() => collectAxisWindowOverlays(effectiveStunAxes.value, configStore, catalogStore))

  /** 当前命中的轴方案名（条件轴模式用于 UI 展示；无方案 = null） */
  const matchedPlanName = computed<string | null>(() => calcOutput.value?.matchedPlanName ?? null)

  /** 霜寒暴击加成与风化侵染区按覆盖率折算到伤害结算面板 */
  const damagePanels = computed<PanelValues[]>(() => {
    const frostBonus = 10 * (anomalyPoolResult.value?.coverage?.frostCoverageRate ?? 0)
    const windAutoRate = anomalyPoolResult.value?.coverage?.windCoverageRate ?? 0
    const infectionCoverage = getWindInfectionCoverage(configStore, windAutoRate)
    const hasWindChar = configStore.team.some(char => {
      const agent = char.agentId ? catalogStore.getAgent(char.agentId) : null
      return agent?.damageElement === 'wind'
    })
    const infectionBonus = hasWindChar ? 10 * infectionCoverage : 0
    // windInfectionRate：风化侵染覆盖率原值盖章（队伍无风角色时 0）——角色模块按自身口径消费（如希格莉德浸染增伤 15%×覆盖率）
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
      const skills = catalogStore.getAgentSkills(c.agentId)
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
        // 诺姆赠送连携行（normaGiftChain）不进全局池：赠送次数由膛温自动决定、吃易伤由轴内标记块计数，
        // 混进 globalPool 会把普通连携的轴内配额虚高（普通 8 + 赠送 6 = 14）
        if (exec.normaGiftChain) continue
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
        const basicTime = resRes.characters[c.slot]?.timeAllocation.basicAttackTime ?? 0
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
  const banyueInteractionTopUp = computed<{ slot: number; parry: number; dual: number } | null>(() => {
    // 懒守卫：无声明该能力的角色或非轴模式 → 不触发全量计算（首页交互栏只在选中该角色时读取）。
    // 槽位由模块声明（producesInteractionTopUp）驱动，本文件不含角色 id（2026-09-12 #10 真清偿）。
    const slot = configStore.team.findIndex(c => c.agentId && getAgentMechanic(c.agentId)?.producesInteractionTopUp)
    if (slot < 0 || (!configStore.useStunAxis && !autoActive.value)) return null
    const topUp = calcOutput.value?.banyueTopUp
    if (!topUp || (topUp.parry === 0 && topUp.dual === 0)) return null
    return { slot, ...topUp }
  })

  // ===== runCalcRound 本体在 resourceCalc/convergence.ts（#10 收线刀：1180 行逐字整体搬）=====
  // deps = 函数自由面 19 名（侦察：本函数体内零外层 let 依赖，跨轮态走显式 threads）；
  // 调用点在全部依赖声明之后（装配序不变；下游 computed 以 ref 注入，懒求值语义原样）。
  const runCalcRound = createRunCalcRound({
    configStore, catalogStore, panels, resourceConfig, resourceResult, adjustedResourceResult,
    inStunAnomalyState, bossAnomalyState, stunCoverage, matchedPlanName, banyueInteractionTopUp,
    computeWindowDuration, computeStunCoverage, windowDuration, buildStackAxes, expandExecutedToCounts,
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
    const breakerSlot = configStore.team.findIndex(c => c?.agentId && catalogStore.getAgent(c.agentId)?.specialty === 'stun')
    // 无击破位队伍：弹刀由主C（槽位 0）承担（noBreakerFallback，见 runCalcRound 同款回落）
    if (breakerSlot < 0 && configStore.team.length === 0) return null
    const split = calcOutput.value?.parrySplit
    if (!split) return null
    const effectiveBreakerSlot = breakerSlot >= 0 ? breakerSlot : 0
    return { breakerSlot: effectiveBreakerSlot, topUp: split.topUp, breakerParry: split.breakerParry, mainDpsParry: split.mainDpsParry, breakerNoFollowUp: split.breakerNoFollowUp, mainDpsNoFollowUp: split.mainDpsNoFollowUp, breakerDecibelOnly: parryDecibelOnlyTotal, parryTotal, parryNoFollowUpTotal }
  })

  /** 特殊动作喧响奖励 */
  const specialActionBonus = computed<SpecialActionBonusResult | null>(() => {
    const topUp = banyueInteractionTopUp.value
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
    remielleEntryPanels: remielleEntryPanels.value,
    remielleAnomalyMultiplier: remielleAnomalyMultiplier.value,
    liuyinPromoteCount: liuyinPromoteCount.value,
    agentNames: agentNames.value,
    autoActive: autoActive.value,
    stunAxisResult: stunAxisResult.value,
    banyueMingwangStacks: axisOverlays.value.banyueMingwangStacks,
    yixuanNingshenMap: axisOverlays.value.yixuanNingshenMap,
    peiluoKagerouMap: axisOverlays.value.peiluoKagerouMap,
    corinStunBonusMap: axisOverlays.value.corinStunBonusMap,
    computeWindowDuration,
  }))

  /** 蕾米虚耀池与耀变触发事件 */
  const remielleVoidflareEvents = computed<AnomalyEventRecord[]>(() => {
    const remielleSlot = configStore.team.findIndex(char => {
      const agent = char.agentId ? catalogStore.getAgent(char.agentId) : null
      return agent?.id === '1581' || agent?.teammateBuffId === '1581'
    })
    if (remielleSlot < 0) return []

    const otherSlots = [0, 1, 2].filter(slot => slot !== remielleSlot)
    const perSlotAnomaly = anomalyPoolResult.value?.perSlotAnomalyTriggers ?? []
    const voidflareTotal = otherSlots.reduce((sum, slot) => sum + Math.max(0, Math.floor(perSlotAnomaly[slot] ?? 0)), 0)
    if (voidflareTotal <= 0) return []

    const remiellePanel = panels.value[remielleSlot]
    if (!remiellePanel) return []
    const qBatches = Math.floor(voidflareTotal / 3)
    const c6LuminizeMultiplier = 1 + Math.max(0, remiellePanel.remielleCinema6LuminizeTriggerMultiplier ?? 0)
    const specialCount = remielleSpecialVoidflareCount(remiellePanel)
    const perSlotText = otherSlots
      .map(slot => `${configStore.team[slot]?.agentId ?? slot}:${perSlotAnomaly[slot] ?? 0}`)
      .join(' / ')

    return ([
      {
        id: 'remielle-voidflare-pool',
        type: 'luminize',
        label: '蕾米虚耀池',
        source: '其他队友异常触发',
        count: voidflareTotal,
        formula: 'voidflareTotal = Σ perSlotAnomalyTriggers[非蕾米槽位]',
        fields: ['AnomalyPoolResult.perSlotAnomalyTriggers', '蕾米槽位', perSlotText],
        note: '每个虚耀记录触发队友的攻击/精通/增伤/穿透/抗性区；异化区统一取蕾米面板。',
      },
      {
        id: 'remielle-luminize-assist',
        type: 'luminize',
        label: '支援技花羽轮舞·耀变',
        source: '不消耗虚耀',
        count: voidflareTotal,
        formula: 'count = 虚耀池总数；每个虚耀打一次',
        fields: ['voidflareTotal', '1581015 luminizeMultiplier'],
      },
      {
        id: 'remielle-luminize-ultimate',
        type: 'luminize',
        label: '终结技缭乱终幕·耀变',
        source: '不消耗虚耀，按3个一批',
        count: qBatches * 3,
        formula: 'count = floor(voidflareTotal / 3) × 3；来源由用户选择1号队友0-3、2号队友3-0',
        fields: ['voidflareTotal', 'qBatches', 'remielle.q:{slot}'],
      },
      {
        id: 'remielle-luminize-basic',
        type: 'luminize',
        label: '普通攻击惊鸿·耀变',
        source: '消耗并清空虚耀',
        count: voidflareTotal * c6LuminizeMultiplier,
        formula: `count = voidflareTotal × ${c6LuminizeMultiplier}（6命翻倍）`,
        fields: ['voidflareTotal', 'remielleCinema6LuminizeTriggerMultiplier', '1581008 luminizeMultiplier'],
      },
      {
        id: 'remielle-special-voidflare',
        type: 'special_voidflare',
        label: '普通攻击垂虹·特殊虚耀',
        source: '开局特殊虚曜点，垂虹打出并消耗',
        count: specialCount,
        formula: 'count = (3 + 4命补充3) × 6命翻倍；倍率 = 垂虹耀变倍率 × 2.5',
        fields: ['remielleCinema1SpecialVoidflareCount', 'remielleCinema4SpecialVoidflareRefillCount', 'remielleCinema6SpecialVoidflareTriggerMultiplier'],
      },
    ] as AnomalyEventRecord[]).filter(event => event.count > 0)
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

    const janeSlot = configStore.team.findIndex(char => {
      const agent = char.agentId ? catalogStore.getAgent(char.agentId) : null
      return agent?.id === '1261' || agent?.teammateBuffId === '1261'
    })
    if (janeSlot >= 0 && (configStore.team[janeSlot]?.cinemaLevel ?? 0) >= 6 && panels.value[janeSlot]) {
      const physicalProg = anomalyPoolResult.value?.perElement.find(prog => prog.element === 'physical')
      const assaultCritRate = Math.min(100, Math.max(0, panels.value[janeSlot].assaultCritRate ?? 0))
      const critCount = (physicalProg?.triggerCount ?? 0) * (assaultCritRate / 100)
      if (critCount > 0) {
        events.push({
          id: 'jane-c6-assault-followup-event',
          type: 'anomaly_trigger',
          label: '简6命强击暴击附伤',
          source: '强击暴击次数',
          count: critCount,
          formula: 'count = 物理强击次数 × 强击暴击率；伤害 = 简异常精通 × 1600%',
          fields: ['强击次数', 'assaultCritRate', 'anomalyProficiency'],
        })
      }
    }
    return events
  })


  /** 角色名称映射（agentId → 中文名） */
  const agentNames = computed<Record<string, string>>(() => {
    const map: Record<string, string> = {}
    for (let i = 0; i < 3; i++) {
      const char = configStore.team[i]
      if (!char?.agentId) continue
      const agent = catalogStore.getAgent(char.agentId)
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
    remielleVoidflareEvents,
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
    banyueInteractionTopUp,
    parrySplitResult,
  }
}
