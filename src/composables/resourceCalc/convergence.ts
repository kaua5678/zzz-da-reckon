/**
 * 单轮计算工厂 `createRunCalcRound`；轮输入 → `./roundInputs`、轮结果类型 → `./roundResult`（CC-11a）；
 * 本体 RoundCtx 拆分见 CC-11b。
 */
import type { ComputedRef } from 'vue'
import type { ConfigModel } from '@/stores/config'
import type { useCatalogStore } from '@/stores/catalog'
import type { AnomalySkillExecution } from '@/core/anomalyPool/helpers'
import type { StunSkillExecution } from '@/core/stunPool'
import { continuousStunCount, relaxAutoFillStep, stunBuildUpForCount } from '@/core/stunPool'
import { probeKey, probePush } from '@/core/probeTrace'
import type { AnomalyPoolResult, StunAxis, ResourceCalcConfig, TeamResourceResult, InStunAnomalySummary, SpecialActionBonusResult, StunPoolResult } from '@/types/resource'
import type { PanelValues } from '@/types/catalog'
import { findInteractionTopUpSlot, getAgentMechanic, interactionBaselineFor } from '@/mechanics'
import { firstGiftedPolarAssaultSlot, sumGiftedPolarAssault } from './giftedPolarAssault'
import { findMoveById } from '@/data/moveTableQueries'

/**
 * 5 个 `compute*NextRoundFeedback` 纯函数已整体迁出（2026-09-16 arch 棘轮第 6 批）。
 *
 * 普罗米娅(1541) / 零号·安比(1381) / 露西(1151) / 薇薇安(1331) / 艾莲(1191) 的「下一轮反馈」
 * 现由各角色模块的 `nextRoundFeedback` 钩子实现（规则 6：编排层不写角色规则），本文件只调一次
 * 通用派发器 `collectNextRoundFeedback`（`./helpers`），把返回值 merge 进 `threadsNext`。
 *
 * ⚠ 首轮守卫语义各不相同，已逐位保留在模块里：普罗米娅/薇薇安/艾莲 = 上一轮线程值 ≤0 才写回
 * cfg；**露西 = 每轮无条件写**（消费端读的就是本轮估计值）。
 * 行为契约见 `src/mechanics/__tests__/nextRoundFeedback.test.ts`；沿革见 `check-guards.mjs` 的
 * `AGENT_BRANCH_BASELINE` 头注释。
 */
import {
  applyUltimatePromote,
  buildPromoteParams,
  promoteFixpoint,
  ultimateGiftProviderSlot,
  promoteHugCountsOf,
  ultimateGiftSourceOf,
  type InAxisFractionProvider,
} from './ultimatePromote'
import { applyChainGift } from './chainGift'
import { DOWNSCALED_INTERACTION_FIELDS, downscaleInteractionCount } from './feasibilitySearch'
import type { CalcRoundThreads, PostRoundInput } from './roundThreads'
import { computeParrySplit, GUARANTEE_STUN_TARGET } from '@/core/parrySplit'
import { projectStunPlanForCounts } from '@/core/stunPlanProjection'
import { calcStunAxisStack, allocateAxisWindows } from '@/core/stunAxisStack'
import {
  computeBossAnomalyStateTimeline,
  computeInStunAnomalyTimeline,
  bossEntryAnomalyElement,
  type BossAnomalyStateResult,
  type InStunWindowInput,
} from '@/core/stunAxis/inStunAnomaly'
import { BUILDUP_THRESHOLD_TABLE } from '@/core/anomalyPool/helpers'
import { getBaseElement } from '@/data/anomalyElement'
import { calcSpecialActionBonus } from '@/core/anomalyPool'
import { PARRY_DECIBEL_BONUS } from '@/data/anomalyDecibelBonuses'
import { calcTeamResources } from '@/core/resource'
import { ULTIMATE_COST_DEFAULT } from '@/data/resourceDefaults'
import { supplyTargetTeamSlot } from '@/core/resource/crossAgentSupply'
import { chainMoveKind } from '@/data/chainMoveKind'
import { applyTeamMechanics, collectNextRoundFeedback, resolveMechanicSettings } from './panelPhases'
import { enrichExecutionPlan, axisMoveEndsStunWindow, axisMoveActionTimeOf, normalizeDisplayTime } from './helpers'

/** 保底 4 喧响的四舍五入阈值（自 useResourceCalc 顶层随迁；那里改为了 import） */
const DECIBEL_ROUND_THRESHOLD = 1500
import { computeTeamVeilCountTotal } from '@/mechanics/teamVeil'

import type { CalcRoundResult } from './roundResult'
import { chainCountTotalOf } from '@/core/chainCount'

/**
 * 单轮计算本体（#10 收线刀，2026-09-12 自 `useResourceCalc.ts` 整体搬入 1180 行）。
 *
 * 侦察前提（ctx 设计两砖，见提交 4521a8c/d83b18b）：函数自由面 22 名**全部是稳定绑定**
 * （store 实例 / computed ref / 函数）——`useResourceCalc()` 内零个外层 let，跨轮可变量
 * 全走显式 `threads` 参数与 `threadsNext` 返回。故 lift 是机械搬：函数体**逐字节未动**
 * （保持 2 空格缩进，diff 可读作纯移动）；工厂形态避免模块级创建 computed 的单例泄漏。
 *
 * 依赖面 = 13 名（store 实例 / 上游 computed / 轮输入工厂成员）。**不注入任何下游 computed**：
 * 本轮产物只经返回值 `CalcRoundResult` 流出（由 `useResourceCalc#calcOutput` 组装），
 * runCalcRound 不读自己的下游 ⇒ 单轮计算 = 「输入 → 输出」的单向函数，可脱离 Vue 响应式单测/搬迁。
 * （2026-09-24 mcp-calc-core 批 0：旧契约声明了 8 个下游 ref〈resourceResult/adjustedResourceResult/
 * inStunAnomalyState/bossAnomalyState/stunCoverage/matchedPlanName/banyueInteractionTopUp/windowDuration〉，
 * 函数体 `.value` 读点实测 0 ⇒ 死依赖，旧注释「在 calcOutput 求值中读它们」与实现不符，已删。）
 */
export function createRunCalcRound(deps: {
  configStore: ConfigModel
  catalogStore: ReturnType<typeof useCatalogStore>
  panels: ComputedRef<PanelValues[]>
  resourceConfig: ComputedRef<ResourceCalcConfig | null>
  computeWindowDuration: () => number
  computeStunCoverage: (sp: Pick<StunPoolResult, 'stunCount'> | null | undefined, lostSeconds?: number) => number
  buildStackAxes: (axes: StunAxis[]) => { actions: import('@/core/stunAxisStack').StackActionCost[]; count?: number; basicFillerSlot?: number }[]
  expandExecutedToCounts: (executed: Record<string, { slot: number; moveId: string; count: number }>, basicFillBySlot: Record<number, number>) => Record<string, { slot: number; moveId: string; count: number }>
  resolveAxes: (stunCount: number, goodReview: number, energyBySlot: Record<number, number>) => { axes: StunAxis[]; planName: string | null }
  calcAnomalyPoolInput: (stunCov: number, execs: AnomalySkillExecution[], giftedPolarAssaultOverride?: number, giftedSlotFallback?: number) => AnomalyPoolResult
  extractAnomalyExecsFrom: (res: TeamResourceResult, skipGift?: boolean) => AnomalySkillExecution[]
  extractStunExecsFrom: (res: TeamResourceResult, skipGift?: boolean) => StunSkillExecution[]
  autoActive: { value: boolean }
}) {
  const {
    configStore, catalogStore, panels, resourceConfig,
    computeWindowDuration, computeStunCoverage, buildStackAxes, expandExecutedToCounts,
    resolveAxes, calcAnomalyPoolInput, extractAnomalyExecsFrom, extractStunExecsFrom, autoActive,
  } = deps

  function runCalcRound(stunCount: number, threads: CalcRoundThreads, opts?: { forceNoAxis?: boolean; interactionScale?: number }): CalcRoundResult {
    const {
      goodReview: prevGoodReview,
      energyBySlot: prevEnergyBySlot,
      // 2026-09-16 round 14：仪玄 1371 整条分支已迁进 `yixuan.ts#applyYixuanTeamConfig`（规则 6）；
      // CC-318：玄墨触发次数也改由仪玄 `nextRoundFeedback` 产出（`moduleFeedback.auricInkTriggers`），编排层不再有该线程。
      anomalyDecibelBonus: prevAnomalyDecibelBonus,
      interactionTopUp: prevInteractionTopUp,
      parrySplit: prevParrySplit,
      // `teamUltimateExtra` 同上：读点已迁进 1371 模块；2026-09-17 round 20 C-β 起
      // **产出侧**（`yixuanNextRoundFeedback`）也迁进 1371 模块 ⇒ 本文件对它只剩 merge。
      // 2026-09-15 arch 棘轮第 2 批：teamUltimateForJufufu / yeshuguangGiftUlt / lucyTeammateEx /
      // graceC1Cycles / anbyZeroTeammateWl / vivianAnomalyTriggers / promiaReleaseDecibel 这 7 条
      // 不再在此解构——它们已改由各模块的 applyTeamConfig 从 `threads` 快照直接读（规则 6），
      // 编排层不再逐 agentId 分支写 cfg。
      // ⚠ 其中 `teamUltimateForJufufu` 是**例外**：它的产出侧留在本文件（全队汇总、无角色判定），
      // 归属论证见下方 `teamUltimateBaseNext` 处的注释。
      // 2026-09-16 arch 棘轮第 6 批追加：vivianTeamEx / promiaTriggerHits / promiaTeammateReleases /
      // ellenFreezeCount 这 4 条也不再在此解构——5 个 compute*NextRoundFeedback 已迁为模块
      // `nextRoundFeedback` 钩子，它们只作为 `prevThreads` 整份快照递入（首轮守卫用），
      // 编排层不再逐条取值。
      // 2026-09-17 round 20 C-β 追加：`consumedTeamEnergy` 的产出侧也迁进 `lighter.ts` 的
      // `nextRoundFeedback`（仍在下方解构 = converge 相位要把它递给模块，见 `:901`）。
      // CC-22：`aliceTeamAssaultCount` / `aliceDisorderCount` 也不再在此解构——爱丽丝模块的
      // applyTeamConfig 改从 `threads` 自取，产出侧迁进爱丽丝 `nextRoundFeedback`。
      // 2026-09-16 round 13：`inStunWindowTriggers` 也不再在此解构——它最后一个读点
      // （`:1414` 的 `prevInStunWindowTriggers <= 0` 守卫 + 对 `characters` 局部克隆的死写）
      // 已作为死写删除（判死依据见该处注释）；1511 模块经 `threads` 契约自取（round 12 批次 2）。
      teamVeilCountTotal: prevTeamVeilCountTotal,
      decibelParry: prevDecibelParry,
      decibelParryBasisShort: prevDecibelParryBasisShort,
      decibelRegenBySlot: prevDecibelRegenBySlot,
      // 2026-09-17 round 21 夜D：`prevPoolStunCount` 也不再在此解构——它唯一的读点
      // （雨果轴内决算块数落地，坑36）已整块迁进 `hugo.ts#applyHugoTeamConfig`，
      // 该模块经 `threads.prevPoolStunCount` 契约自取（规则 6：编排层不写角色规则）。
    } = threads
    const base = resourceConfig.value
    // CC-418：`runCalcRound` 不再有 null 出口。唯一调用链 `calcOutput → solveTeam → runCalcRound` 在
    // 同一次同步求值内已前置守卫 `resourceConfig.value && catalogStore.ready`（useResourceCalc#calcOutput），
    // 本条件不可达；CC-417 删掉空失衡池 `return null` 后「null 轮」概念整体退役（solveTeam 的 null 轮
    // 分支 / roundThreads#threadsAfterNullRound 同步删除）。保留为不变量断言而非静默 null：真走到这里
    // 说明调用链被改坏，宁可显式炸。回退点：恢复 `return null` + 调用方 `| null` 类型 + threadsAfterNullRound。
    if (!base || !catalogStore.ready) throw new Error('runCalcRound: resourceConfig/catalog 未就绪（calcOutput 已前置守卫，此处不可达）')
    /**
     * **计数通道**用的失衡次数（C7 实验，见 `core/stunPlanProjection.ts`）。
     * `stunPlanProjection='off'` 时恒等于 `stunCount`（现行口径 0 delta）；打开则把计划值投影成整数，
     * **只影响把它当次数乘的地方**（连携/喧响/能量）。时间账与不动点迭代继续用实数的 `stunCount`。
     */
    const countStun = projectStunPlanForCounts(stunCount, base.stunPlanProjection ?? 'off', threads.prevPoolStunCount)
    // 条件轴：按上一轮收敛出的好评/闪能（首轮缺省 → 条件方案未命中走兜底）解析生效轴
    const { axes: resolvedAxes, planName } = resolveAxes(stunCount, prevGoodReview, prevEnergyBySlot)
    // forceNoAxis（轴退化）：跳过轴注入（轴块/连携覆盖/自动补齐全关），退回 chainCountPerStun 兜底的一般循环
    const axisActive = !opts?.forceNoAxis && (configStore.useStunAxis || autoActive.value) && resolvedAxes.length > 0
    // 雨果槽位查找已删（CC-39a 2026-09-27）：唯一用途「决算失衡值返还」改由模块能力 `stunRefundRatio` 派发（见下方）。
    // 决算截断（结束失衡窗口的招式，由模块能力 endsStunWindow 声明）：轴内决算做完时清空窗口剩余失衡时间 →
    // 有效失衡时长按截断结束时刻计，损失秒数从覆盖率里扣除（失衡时间/比例重算口径）。
    let verdictSecondsLost = 0
    if (axisActive) {
      const windowDur = computeWindowDuration()
      const winAlloc = allocateAxisWindows(resolvedAxes, stunCount)
      resolvedAxes.forEach((axis, ai) => {
        const wins = winAlloc[ai] ?? 0
        if (wins <= 0) return
        let truncEnd = -1
        for (const act of axis.actions) {
          const cinema = configStore.team[act.slot]?.cinemaLevel ?? 0
          // CC-39b：是否截断窗口由本槽角色模块能力 `endsStunWindow` 判定（与 roundInputs 的 endsStunWindow 同源）
          const isEnds = axisMoveEndsStunWindow(configStore.team[act.slot]?.agentId, act.moveId, cinema)
          if (!isEnds) continue
          const skills = catalogStore.agentSkillsByAgentMap.get(configStore.team[act.slot]?.agentId ?? '')
          const move = findMoveById(skills, act.moveId)
          let dur = act.duration ?? move?.actionTime ?? 0
          dur = axisMoveActionTimeOf(configStore.team[act.slot]?.agentId, act.moveId, dur)
          truncEnd = Math.max(truncEnd, Math.max(0, act.startTime ?? 0) + dur)
        }
        if (truncEnd >= 0) verdictSecondsLost += Math.max(0, windowDur - truncEnd) * wins
      })
    }
    // 雨果轴模式剩余失衡时间 + 决算次数（原在此从轴内块反推）已于 2026-09-17 round 21 夜D
    // 整块迁进 `hugo.ts#applyHugoTeamConfig`（converge 相位）——连 `@fact engine:轴内块数落地`
    // 一起搬走（断锚即红：锚符号没了，口径必须跟着实现走，见规则 8）。
    // 当前轮失衡覆盖率（供诺姆火力实验高爆/破甲按失衡时长拆分；与 computeStunCoverage 同口径，含决算截断）
    const provStunCoverage = computeStunCoverage({ stunCount }, verdictSecondsLost)
    // 般岳轴模式自动补齐（保底语义，方案 A）：轴内怒相/终结技对嗔火/喧响有硬性需求，不足时抬双反（补嗔火）与弹刀（补喧响），
    // 有效次数 = 交互栏输入 + 补齐量（不写回 store，不覆盖用户输入）；计算轮间通过 prevInteractionTopUp 线程收敛。
    // CC-23 / CC-293：槽位 = 挂出模块能力 `computeInteractionTopUp` 者（与 useResourceCalc.ts 交互栏的
    // `interactionTopUp` computed 共用 findInteractionTopUpSlot），原为按身份 `findSlotByIdentity(…, ['1471'])`。
    const interactionTopUpSlot = findInteractionTopUpSlot(configStore.team)
    // Boss 预设弹刀反推（用户口径 2026-08）：Boss 声明 parryTotal/parryNoFollowUpTotal（如 叶释渊 13 / 司祭 15；生效值含控制技组折算）且
    // 「保底4失衡」勾选时，击破位（队伍首个 stun 特性槽位）弹刀按保底失衡反推补齐、主C 拿剩余
    // （纯函数 core/parrySplit.ts；本轮注入上一轮拆分，收敛判据含 parrySplitSeq）。
    // 不带支援突击弹刀（parryNoFollowUpTotal）**对半分**（用户口径 2026-09-10：「必须对半分；强制归击破位是错的，
    // 那是把补失衡误解成只有击破弹刀，删掉」）；只给喧响弹刀（parryDecibelOnlyTotal）走保底4喧响通道。
    const { parryTotal, parryNoFollowUpTotal, parryDecibelOnlyTotal } = configStore.bossParryTotals
    const guaranteeStun = configStore.getMechanicSetting('guarantee.stun', 0) !== 0
    const breakerSlot = configStore.team.findIndex(c => c?.agentId && catalogStore.agentsMap.get(c.agentId)?.specialty === 'stun')
    // 无击破位队伍（如 仪玄/琉音/卢西娅：强攻/强攻/支援）：实战弹刀全由主C（槽位 0）承担
    // （归档 72db6dc3 弹刀 8 即此口径）——保底4失衡反推照常，但「剩余给主C」没有第二个角色可分，
    // 有效次数 = max(输入, 反推 T) 封顶 parryTotal（同位语义，2026-09-07）。
    const noBreakerFallback = breakerSlot < 0
    const effectiveBreakerSlot = breakerSlot >= 0 ? breakerSlot : 0
    /**
     * 用户**主动调高**弹刀（相对职业基准）的总量——「保底4失衡反推链」的独立启动依据。
     *
     * 用户口径 2026-10-05：
     * > 「`parryTotal` 只是说他**默认没有强制弹刀**，但**你想弹还是有普通弹刀的**。
     * >  所以四舍五入应该能做到，**做不到就是 bug**，这又不是**禁用**了弹刀。
     * >  我设置的弹刀数值是**机制所必要的最低值，在这之上可以任意增加**。」
     *
     * ⇒ `parryTotal` = 「Boss 预设**强制反推的下限**」，**不是**「是否允许反推」的开关。
     * 旧实现把它当开关：无 Boss（或 Boss 未声明 `parryTotal`——全库 23 个里 **17 个**如此）
     * ⇒ `parryTotal = 0` ⇒ `parrySplitActive = false` ⇒ **即使用户手填弹刀 12/20 次也不启动反推**。
     * 实测（般岳队，`guarantee.stun=1`，无 Boss，手填 `parryCount`）：
     * ```
     * 手填   旧实现          新实现
     *   0   3次/42.51M      3次/42.51M
     *   6   3次/43.63M      3次/44.59M
     *  12   3次/41.66M      4次/48.45M   ← ★（旧实现 12 次比 0 次还低：弹刀占前台却不进反推链）
     *  20   3次/43.34M      4次/51.18M
     * ```
     *
     * ⚠ **判据必须扣掉职业基准**：`stores/config.ts:634` 在换人时把
     * `interactionBaselineFor(...)` 的 `parry`（非支援/防护 = 6）**预填**进 `parryCount`
     * ⇒ 直接判 `parryCount > 0` 会对**几乎所有队**成立。实测过宽版本：
     * **29/104 队变动、失衡 3→5**（`auto-1591-1481-1311` +29.5%）⇒ 已废弃。
     * 扣基准后实测：三支未改队（`banyue-trigger`/`banyue-liuyin`/`auto-1591-1481-1311`）
     * 偏离量**精确为 0**；手动改 12 ⇒ 偏离 12 ⇒ 正确启动。
     *
     * ⚠ **不要**改成「`parryTotal` 无 Boss 时回落为手填总量」：实测**非单调**
     * （20 次 44.02M < 12 次 47.07M——`parryTotal` 变大会让反推把更多弹刀塞给击破位、占前台时间）。
     */
    const parryBaseline = configStore.team.reduce((a, c) => {
      if (!c?.agentId) return a
      const specialty = catalogStore.agentsMap.get(c.agentId)?.specialty
      return a + interactionBaselineFor(c.agentId, specialty).parry
    }, 0)
    const manualParryAboveBaseline = Math.max(0,
      configStore.team.reduce((a, c) => a + Math.max(0, c?.parryCount ?? 0), 0) - parryBaseline)
    const parrySplitActive = (parryTotal + parryNoFollowUpTotal + parryDecibelOnlyTotal > 0
        || manualParryAboveBaseline > 0)
      && guaranteeStun && (breakerSlot >= 0 || configStore.team.length > 0)
    const mainDpsSlot = breakerSlot === 0 ? -1 : 0
    // 保底开关（配装页「保底目标」勾选）：保底4嗔火 → 抬双反补嗔火；保底4喧响 → 抬弹刀补喧响。
    // 是否补齐由产出者模块按 gate 判定（CC-295：轴模式 / 保底开关 / 模块设置，公式只在模块里一份）。
    const guaranteeFury = configStore.getMechanicSetting('guarantee.fury', 0) !== 0
    const guaranteeUltimate = configStore.getMechanicSetting('guarantee.ultimate', 0) !== 0
    // 通用保底4喧响：喧响缺口 → 弹刀（任意队伍；般岳走上面的模块能力 computeInteractionTopUp，此处排除避免双计）。
    // 弹刀注入槽位 0（主C，弹刀喧响经伴随覆盖全队），轮间经 prevDecibelParry 线程收敛。
    const decibelParryActive = guaranteeUltimate && interactionTopUpSlot < 0

    /** 轴内某槽位终结技块总次数（× 窗口数）。判定走 `chainMoveKind`（CC-319：只认 chain 分类，青衣普攻 Penultimate 不算） */
    const axisUltimateNeed = (axes: StunAxis[], stunCountN: number, slot: number): number => {
      const winAlloc = allocateAxisWindows(axes, stunCountN)
      let n = 0
      axes.forEach((axis, ai) => {
        const wins = winAlloc[ai] ?? 0
        for (const act of axis.actions) {
          if (act.slot !== slot || act.sourceTag === 'gift') continue
          const skills = catalogStore.agentSkillsByAgentMap.get(configStore.team[slot]?.agentId ?? '')
          if (chainMoveKind(skills, act.moveId) === 'ultimate') n += act.count * wins
        }
      })
      return n
    }

    // 有轴时：失衡送的连携次数从轴里连携块反推（chainCountPerStun 仅无轴兜底）。
    // 多条轴连携数可能不同（爆发轴 1 连携 / 末尾爆发轴 2 连携），须按各轴分配的窗口数加权求和，不能简单相加。
    const axisChainTotal: Record<number, number> = {}
    if (axisActive) {
      // CC-142：轴内连携次数属计数通道 ⇒ 窗口数读 countStun（off 下 ≡ stunCount）。
      // physical 模式下旧写法按计划值分窗：auto-1531-1481-1451 计划 0 ⇒ 0 窗 ⇒ 轴声明的连携一次也不给，而池物理 3 次。
      const winAlloc = allocateAxisWindows(resolvedAxes, countStun)
      resolvedAxes.forEach((axis, ai) => {
        const wins = winAlloc[ai] ?? 0
        for (const act of axis.actions) {
          // 赠送连携块（怒焰·赠，sourceTag='gift'）= 诺姆膛温换连携的轴内标记：不占目标自身连携次数
          if (act.sourceTag === 'gift') continue
          const skills = catalogStore.agentSkillsByAgentMap.get(configStore.team[act.slot]?.agentId ?? '')
          if (chainMoveKind(skills, act.moveId) === 'chainAttack') { // CC-319
            axisChainTotal[act.slot] = (axisChainTotal[act.slot] ?? 0) + act.count * wins
          }
        }
      })
    }
    /**
     * 轴模式 60/90 转大次数（**用户口径 2026-09-20**）：
     *
     * 「轴模式下显示制定了**部分好评值的用途**（= 轴里的 promoteVariant 块），
     *   剩余好评应该默认 90。毕竟非失衡没有连携窗口替换，只能直接 90 抱拳。」
     *
     * 即：轴声明的是**60 抱拳的计划次数**（吃掉有限个连携窗口），
     * 好评余额里能凑出的部分**默认全部走 90 抱拳**（非失衡期没有连携窗口可替换，只能 90）。
     *
     * 为什么必须补这一步（实测 auto-1591-1481-1311）：该队轴只声明「每窗 60×1」，
     * 旧实现只累加 promoteVariant 块 ⇒ 好评余额（370.5 − 60×窗数 ≈ 190~310）被**整块丢弃**，
     * `axisHug.hug90` 恒 0。而装配侧 `promoteFixpoint` 按好评/连携窗口独立算出 5 次（hug60=3/hug90=2）
     * ⇒ **账本预留（按 axisHug=1~3）与装配赠行（按池=5）不同源**，实测账本越界 0.32s。
     * 补上 90 余额推导后两层都是 5 ⇒ 同源（这正是用户说的「转大次数应该很明确」）。
     *
     * 余额推导与 `computeLiuyinHugCounts` **同一算法**（阈值结转贪心）：
     * 先花 60（受轴声明的 h60 上限约束——那是玩家计划的连携窗口用量），余额每满 90 记一次 90 抱拳。
     */
    let axisHug: { hug60: number; hug90: number } | null = null
    if (axisActive) {
      let h60 = 0; let h90 = 0
      const winAlloc = allocateAxisWindows(resolvedAxes, countStun) // CC-142：转大块次数属计数通道
      resolvedAxes.forEach((axis, ai) => {
        const wins = winAlloc[ai] ?? 0
        for (const act of axis.actions) {
          if (act.promoteVariant === '60') h60 += act.count * wins
          else if (act.promoteVariant === '90') h90 += act.count * wins
        }
      })
      /**
       * 剩余好评 → 默认 90 抱拳（用户口径 2026-09-20「剩余好评应该默认 90，非失衡没有连携窗口
       * 替换，只能直接 90 抱拳」）。
       *
       * ★★ **闸门 = 轴真的声明了 promoteVariant 块**（`declaredBlocks > 0`）——这是用户口径的
       * **前提**，不是附加条件。用户原话把前提写在第①句：「轴模式下**显示制定了部分好评值的用途**
       * （= 轴里的 promoteVariant 块），**剩余**好评应该默认 90」——「制定了部分用途」+「剩余」
       * 都预设了**轴里有声明**。轴一个 promoteVariant 块都没声明（雨果 0 命轴 `hugo-c0-e` 只有
       * 连携块 + 雨果自己的决算块 `1291_ex_verdict_final`；R17c/R18d 的手组轴同理）时，
       * 本规则**没有可补的「剩余」**：默认 90 会凭空发明玩家没计划的转大次数（实测把雨果决算
       * 从 5 砍到 4、并让 R17c 多出一条赠行、R18d 的轴因超出预算被弃）。
       *
       * ⚠ 为什么「轴声明块数」必须是**闸门**而不是「优先级」：交接曾提过「轴声明的 promoteVariant
       * 优先，只在它没声明满时用剩余好评补 90」。**「没声明满」不可判定**——轴声明 60×1 到底是
       * 「计划只转 1 次」还是「只列了 1 次、其余留给 90」，预设里没有任何字段能区分（`count` 就是
       * 全部信息）。硬猜「没满 ⇒ 补」正是 ① 覆盖预设意图 ② 让无声明队凭空多出转大的原因。
       * 可判定的只有「声明了没有」⇒ 闸门落在**存在性**上。
       *
       * ⚠ **复用 `computeLiuyinHugCounts` 而不是自己 floor**（第一次写成 `floor(rest/90)` 是错的）：
       * 轴声明的 `h60` 是**窗口加权后的小数**（实测 1051 队 2.3077），它本身不代表整次抱拳；
       * 直接按 `G − h60×60` 算余额会少扣/多补一次（实测把 1051 的账本残差从 −1.63 翻成 +0.98）。
       * `computeLiuyinHugCounts` 的阈值结转贪心正是这条规则的**唯一实现**：
       * 「每次开窗要求当刻 ≥90，优先用 60 档（受 cap60 = 轴声明的 60 次数上限约束），否则用 90 档」
       * ⇒ 传 `hug60Setting = floor(轴声明的 h60)`、`stunCount` 给足连携窗口即可。
       */
      const declaredBlocks = h60 + h90
      if (declaredBlocks > 0 && prevGoodReview > 0) {
        /**
         * 窗口预算用本轮的**计数通道**失衡次数 `countStun`（CC-155，第 178 轮；off 下 ≡ 计划值 `stunCount` ⇒ 零差）。
         * 核心侧 `promoteFixpoint` 按**池**的 `pool.stunCount` 推导连携窗口（physical 下 = 物理次数），
         * 旧注释「计划值与核心侧同源」在 CC-144 缺省 physical 后已不成立（docs/mcp-stun-dual-source.md §19）。
         * `targetChainCountTotal` 交给函数自己按窗口数推导（不传 = 用它内部的 `floor(窗口数)` 口径）。
         * 回退点：下面实参改回 `stunCount`。
         * ⚠ 别用 `Math.max(h60, stunCount)` 之类自造窗口数：实测把 1051 的账本残差从
         * −1.63 翻成 +0.98（少扣一次 60）再回落到 +0.40，两次都是自造口径的产物。
         */
        // CC-43c：算法经赠大提供者模块能力 `promoteHugCounts` 取用（琉音 = computeLiuyinHugCounts，逐位同一函数）
        const hug = promoteHugCountsOf(configStore)?.(
          prevGoodReview,
          countStun,                 // 连携窗口数（CC-155：计数通道，与核心侧池口径同源）
          Math.floor(h60),           // 60 档上限 = 轴声明的 60 抱拳计划次数（floor 成整数次）
        )
        if (hug) {
          h60 = hug.hug60
          h90 = hug.hug90
        }
      }
      if (h60 > 0 || h90 > 0) axisHug = { hug60: h60, hug90: h90 }
    }
    // 轴模式琉音赠大计数（跨层口径统一，2026-09-10）：轴内 60/90 转大次数由轴预设决定，
    // core 的通用公式（好评/连携窗口推导）会算出另一个数 → 按窗口加权后注入，
    // 使试探测量/账本预留与轴栈窗口口径同源（见 core/resource/helpers.ts 的 `ultGiftTime`，CC-35c-D 前名 liuyinGiftTime）。
    let axisUltimatePromote: { targetSlot: number; count: number } | undefined
    if (axisActive && axisHug) {
      const giftSlot = ultimateGiftProviderSlot(configStore)  // CC-35d-B3：原按身份查找琉音槽位
      if (giftSlot >= 0) {
        axisUltimatePromote = {
          // CC-294：落点与引擎预留 / 非轴赠大同一函数（提供者 cfg 上的模块设置）
          targetSlot: (() => {
            const providerCfg = base.characters.find(c => c.slot === giftSlot)
            return providerCfg ? supplyTargetTeamSlot(providerCfg, base.characters.map(c => c.slot)) : -1
          })(),
          count: axisHug.hug60 + axisHug.hug90,
        }
      }
    }
    // 伊德海莉失衡内强特（`exReservedCount` / `exReservedEnergyCost`）的轴内连段反推已迁进
    // `yidhari.ts#applyYidhariTeamConfig`（round 13 批次 3）——模块自己按 `axis.axes × axis.windows`
    // 数 `yidhari-heavy-single` / `yidhari-heavy-double` 两个连段块，与本文件原先在此处的算法同源
    // （连段块 id 与成本档常量已回收进模块，规则 11 单一事实源）。
    // 轴内总时间（CD 自动动作用：仪玄C1落雷 6s / 卢西娅追击 8s 按轴内时间折算次数）
    const axisInSeconds = axisActive
      ? allocateAxisWindows(resolvedAxes, stunCount).reduce((a, b) => a + b, 0) * computeWindowDuration()
      : 0
    // 轴内**实际执行**集合（资源门控后）= `axisActionCounts` / `axisUltimateTotal` / 合轴节省
    // `axisOverlapByAction` 的**唯一来源**（用户 2026-09-10 裁决「同一物理量只能有一份实现」）。
    // 资源用**上一轮**收敛值（与其它线程同款滞后注入）；首轮无上一轮值 ⇒ 空表 ⇒ 耗资源块被门控掉
    //（只影响首轮：外层迭代下一轮起读上一轮值）。
    let axisExecutedStack: ReturnType<typeof calcStunAxisStack> | null = null
    /**
     * 轴内终结技块实际执行总次数：通用注入 cfg.axisUltimateTotal 供模块消费（希希芙影画2 等）。
     * CC-298：只由执行集合产出。原先另有一份「块数 × countStun 窗口」的预算循环，但 axisActive 时恒被下方覆盖、
     * 非轴时为空 ⇒ 死代码，已删（`axisActionCounts` 的 computeAxisActionCountsFor 同理）。
     */
    const axisUltimateTotal: Record<number, number> = {}
    if (axisActive) {
      axisExecutedStack = calcStunAxisStack({
        axes: buildStackAxes(resolvedAxes),
        // CC-298：执行集合 = axisActionCounts / axisUltimateTotal 的来源，属计数通道（同 CC-142 的 axisChainTotal）
        // ⇒ 窗口数读 countStun。旧读计划实数 stunCount：physical 下 1371 队计划 0.655 ⇒ 1 窗，而物化行 / 池按物理 3 窗。
        // CC-301：窗口数 = 上一轮池整数（`threads.prevPoolStunCount`，首轮缺省回落 countStun）。physical ≡ countStun、
        // 锁定下池已钉 countStun（CC-300）⇒ 两者零差；只有 off / floor / round / ceil 投影下由「计划值」改为「池整数」——
        // 轴块是「块 × 窗」的整数执行，与雨果决算行（坑36，读池）及伤害侧栈（读池）同源。
        stunCount: threads.prevPoolStunCount ?? countStun,
        windowDuration: computeWindowDuration(),
        energyBySlot: prevEnergyBySlot,
        decibelBySlot: prevDecibelRegenBySlot,
      })
      // 终结技总次数（供希希芙影画2 等）：按实际执行集合计（含赠送块）
      const ultMoveOfSlot = new Map<number, string>()
      for (const c of base.characters) ultMoveOfSlot.set(c.slot, c.ultimateMoveId)
      for (const v of Object.values(axisExecutedStack.executed)) {
        if (ultMoveOfSlot.get(v.slot) === v.moveId) {
          axisUltimateTotal[v.slot] = (axisUltimateTotal[v.slot] ?? 0) + v.count
        }
      }
    }
    // 轴内合轴节省（2026-08-30 用户口径）：窗口内跨角色块并行（如般岳强特时琉音抱拳）只计一次前台；
    // 前台净占用 = Σ物化前台行 − overlap，iterate 平A池吃进节省。取执行集合自身的 overlapByAction——
    // 与它扣减的物化行同一次栈遍历（同资源门控、同窗口数）。r709 前另跑一遍不传闪能/喧响的栈：09-08 栈改
    //「超出槽位总量就去掉」（c56bd57d）后耗资源块在那遍里全被跳过 ⇒ 含强特/终结技的合轴节省恒 0。
    const axisOverlapByAction: Record<string, number> = axisExecutedStack?.overlapByAction ?? {}
    // 把当前失衡次数/覆盖率/战斗时间传给角色配置（诺姆火力实验导弹舱、炮塔全程射击依赖）
    // 各槽位轴内捏块总次数：优先取栈的实际执行集合（般岳分支与下方 merged 均取同一来源）
    const axisActionCountsBySlot: Record<number, Record<string, number>> = {}
    if (axisExecutedStack) {
      for (const c of base.characters) axisActionCountsBySlot[c.slot] = {}
      for (const v of Object.values(axisExecutedStack.executed)) {
        const m = axisActionCountsBySlot[v.slot] ?? (axisActionCountsBySlot[v.slot] = {})
        m[v.moveId] = (m[v.moveId] ?? 0) + v.count
      }
    } else {
      // 非轴：无轴内块（原 computeAxisActionCountsFor 在 !axisActive 时恒返回 {}）
      for (const c of base.characters) axisActionCountsBySlot[c.slot] = {}
    }
    const characters = base.characters.map(cfg => {
      // 轴模式：连携总次数完全由轴决定（未列连携块的槽位 = 0 次，轴即最终次数）
      const chainOverride = axisActive
        ? (axisChainTotal[cfg.slot] ?? 0)
        : undefined
      // 全队通用注入（无 agent 分支）：轴内时间 + 失衡时间覆盖率 + 本槽位轴内捏块计数。
      // 供需要「失衡内/外拆分」或「轴内精确次数」的模块自取（猫又 30/40 档穿刺用）；其余角色字段闲置。
      // axisInSeconds 只写克隆不写 base cfg（base 是 computed 缓存对象，脏写会让其内容依赖调用顺序）。
      const merged = {
        ...(chainOverride !== undefined ? { ...cfg, chainCountTotalOverride: chainOverride } : cfg),
        axisInSeconds,
        teamStunCoverage: provStunCoverage,
        axisActionCounts: axisActionCountsBySlot[cfg.slot],
        axisUltimateTotal: axisUltimateTotal[cfg.slot] ?? 0,
        // 全队帷幕次数（上一轮收敛注入）：叶瞬光溯影惊鸿/爱芮合作舞台/千夏磨爪器在此轮 buildExecutions/buildAnomalyEvents 消费
        teamVeilCountTotal: prevTeamVeilCountTotal,
      }
      // 非轴降配（用户口径 2026-08-30）：超预算时缩放用户交互次数（round）。只缩 store 侧输入——
      // 下方 boss 强制弹刀（parrySplit 直读 store 原值）与轴补齐注入在其后叠加，不被缩放。
      const iscale = opts?.interactionScale ?? 1
      if (iscale < 1) {
        // CC-263：字段表与取整口径单一来源（难度 x 同读，见 feasibilitySearch#DOWNSCALED_INTERACTION_FIELDS）
        for (const f of DOWNSCALED_INTERACTION_FIELDS) merged[f] = downscaleInteractionCount(merged[f] ?? 0, iscale)
      }
      // 后台合轴自动填充（模块 backstageAutoFill 声明驱动，上一轮反推值；手动字段 >0 时模块优先用手动）
      {
        const decl = getAgentMechanic(cfg.agentId)?.backstageAutoFill
        if (decl) merged[decl.cfgField] = threads.backstageAuto?.[cfg.agentId] ?? 0
      }
      // Boss 预设弹刀反推注入（上一轮拆分；首轮 prev 为空 → 击破位注入 ≥1 探针保证轻弹刀行存在，
      // 供本轮失衡池读出每次弹刀失衡值，后续轮按真实拆分注入、不强制）
      if (parrySplitActive) {
        const prevSplit = prevParrySplit
        if (cfg.slot === effectiveBreakerSlot) {
          const breakerInput = configStore.team[effectiveBreakerSlot]?.parryCount ?? 0
          if (prevSplit === null) {
            merged.parryCount = Math.max(1, breakerInput)
          } else if (noBreakerFallback) {
            // 无击破位：主C 承担弹刀 = max(输入, 反推 T)——不拿 parryTotal 剩余（没有第二个角色分）
            merged.parryCount = Math.max(0, breakerInput + prevSplit.topUp)
          } else if (mainDpsSlot < 0) {
            // 击破位=主C（同位）：剩余并入同位 = 反推 + 剩余（输入未填时合计 = parryTotal）
            merged.parryCount = breakerInput > 0
              ? prevSplit.breakerParry
              : prevSplit.breakerParry + prevSplit.mainDpsParry
          } else {
            merged.parryCount = Math.max(0, breakerInput + prevSplit.topUp)
          }
          // 不带支援突击弹刀：对半分（击破位拿自己那半）；只给喧响弹刀仍在击破位槽位合并
          merged.parryNoFollowUpCount = prevSplit?.breakerNoFollowUp ?? (parryNoFollowUpTotal - Math.floor(parryNoFollowUpTotal / 2))
          merged.parryDecibelOnlyCount = parryDecibelOnlyTotal
        } else if (cfg.slot === mainDpsSlot && !noBreakerFallback) {
          merged.parryCount = prevSplit?.mainDpsParry ?? Math.max(0, parryTotal - (configStore.team[effectiveBreakerSlot]?.parryCount ?? 0))
          // 不带支援突击弹刀的另一半归主C（对半分，用户口径 2026-09-10）
          merged.parryNoFollowUpCount = prevSplit?.mainDpsNoFollowUp ?? Math.floor(parryNoFollowUpTotal / 2)
        } else if (cfg.slot === mainDpsSlot && noBreakerFallback) {
          // 无击破位队伍：实战弹刀全由主C 承担（含不带支援突击的那类）
          merged.parryNoFollowUpCount = parryNoFollowUpTotal
        }
      }
      // x弹刀（2026-09-02 用户口径，仅基塔布鲁 1 次）：两人同时招架同一攻击——
      // 支援突击/喧响/失衡都算两人的（双方 parryCount 各 +xParryTotal），
      // 前台时间只计一份：非主弹窗位（主C 槽）的 x 次弹刀行时间豁免（cfg.parryTimeFreeCount）。
      const xParryTotal = configStore.appliedBoss?.xParryTotal ?? 0
      if (xParryTotal > 0 && parrySplitActive && (breakerSlot >= 0 || noBreakerFallback)) {
        if (cfg.slot === effectiveBreakerSlot) {
          merged.parryCount = merged.parryCount + xParryTotal
        } else if (!noBreakerFallback && cfg.slot === mainDpsSlot && mainDpsSlot >= 0 && mainDpsSlot !== breakerSlot) {
          merged.parryCount = merged.parryCount + xParryTotal
          merged.parryTimeFreeCount = (merged.parryTimeFreeCount ?? 0) + xParryTotal
        }
      }
      // 通用保底4喧响：注入槽位 0 的「只给喧响」弹刀补齐量（上一轮收敛值；首轮 0）。
      // 走 parryDecibelOnlyCount 而非 parryCount：只计 215 喧响、不产轻弹刀/支援突击行、不贡献失衡值——
      // 保底4失衡的弹刀（含失衡值）由上方 parrySplit 独立反推，二者职责分离，避免弹刀↔失衡池的反馈环振荡。
      if (decibelParryActive && cfg.slot === 0) {
        merged.parryDecibelOnlyCount = merged.parryDecibelOnlyCount + prevDecibelParry
      }
      // 2026-09-15 arch 棘轮：norva(1571)/qingyi(1251) 的失衡次数注入已迁进各自模块的
      // applyTeamConfig（converge 阶段读同一组 hook 入参 stunCount/combatTime，规则 6）。
      // 雨果 1291 的轴内决算反推（`hugoRemainingStunSeconds` / `hugoAxisExVerdictCount` /
      // `hugoAxisUltVerdictCount`，含「非轴不写」与「块内 `?? 0` 但整体 `!== undefined` 门控」
      // 两条条件写形态）已于 2026-09-17 round 21 夜D 迁进 `hugo.ts#applyHugoTeamConfig`
      // （converge 相位）：轴本体/窗口数走 `axis` 契约、上一轮失衡池整数次数走
      // `threads.prevPoolStunCount`（坑36 口径，**不是** `axis.windows`——后者用本轮不动点实数）、
      // 动作时长查表走本轮新增的 `getAgentSkills` 契约 ⇒ 本 map 里不再有 1291 判据。
      // ⚠ 曾在此写 `hugoAxisActive: true`——2026-09-16 T26 批次 0a 判死并删除（全仓零读点，
      // 唯一「反射面」是 `core/resource.ts#sanitizeWarmKeyCfg` 的 JSON 序列化，但该字段是
      // `hugoAxisExVerdictCount` 是否存在的纯函数（只会是 `true`、只在原分支出现）⇒ 删它不改变
      // 热启动 key 的等价类划分，见 `.claude/task-card-round10-axis-context-contract.md` §10.1）。
      // 迁移后同理不再产生该字段（同一纯函数关系在模块内继续成立）。
    // 伊德海莉 1051 的 `yidhariStunCount` / `exReservedCount` / `exReservedEnergyCost`
    // （轴内连段反推：单次碾 1 重碾/50-60 闪能、双次碾 2 重碾/85 闪能）已迁进 `yidhari.ts` 的
    // `applyTeamConfig`（round 13 批次 3）：前者读 `stunCount`（轴无关），后两者读下面 dispatch 的
    // `axis` 契约快照（`axis.axes × axis.windows` 现算，与原先在此处 `:661-681` 的算法逐位等价）。
    // ⚠ 迁移的**关键约束是条件写形态**：`exReservedCount` 只在 `axis.active && 合计>0` 时写
    // ——`core/resource/helpers.ts#resolveExSpecialCount` 用 `!== undefined` 选通路，恒写 0 会改语义
    // （详见模块钩子注释）。core 侧那两条「字段即蕴含角色」的守卫因此仍然成立。
      // 2026-09-15 arch 棘轮：佩洛伊斯(1551) 的 peiluoVerdictCount / extraSelfDecibelReward 注入
      // 已迁进 specPanelBuffs 的 peiluoProminenceMechanic.applyTeamConfig（规则 6）。
      // 般岳 1471 的整块（`banyueAxisEx` / `banyueAxisActive` / `banyueInteractionTopUp`
      // + 弹刀/双反注入）已于 2026-09-17 round 21 夜D 迁进 `banyue.ts#applyBanyueTeamConfig`
      // （converge 相位）：轴内量走 `axis` 契约、补齐量走 `threads.interactionTopUp`、
      // 保底开关走本轮新增的 `guarantee` 契约（`guarantee.*` 刻意不注册 MechanicSetting，
      // 理由见 `AgentTeamConfigInput.guarantee` 头注释）⇒ 本 map 里不再有 1471 判据。
      // 仪玄 1371 的 8 个字段已整条迁进 `yixuan.ts#applyYixuanTeamConfig`（round 14 批次 4）：
      // 轴内量（`yixuanAxisEx`/`yixuanAxisCloudSeconds`/`yixuanAxisActive`/`yixuanC1LightningCount` 的轴臂）
      // 走 `axis` 契约、线程量（`yixuanAnomalyTriggerFlash`/`ultimateEquivalentCount`，CC-312 前为 `extraSelfDecibelReward` 的橘福福项）
      // 走 `threads` 契约、缺口量（`yixuanExtremeAssistCap` + `yixuanC1LightningCount` 非轴臂需要的
      // 有效战斗时间）走本轮新增的 `interactions` 契约（store 口径**未缩放**交互次数）。
      // ⚠ 迁移的地基是 round 13 的受控两臂实验：用 `characters` 上那份合并值（被 `interactionScale`
      // 缩放 / 被 `parrySplit` 改写）⇒ `yixuanSmoke` **9 failed**；按 store 口径递入 ⇒ **13 passed**。
      // 另：本文件原先那处 `if (ch.agentId === '1371')`（读上一轮 `rr.characters` 的执行行统计
      // 符法千重次数）已于 2026-09-17 round 20 C-β 迁进 `yixuan.ts#yixuanNextRoundFeedback`
      // （产出线程值 `teamUltimateExtra`）⇒ 本文件不再有该判据。
      // ⚠ 同批的「全队终结总次数」`teamUltimateForJufufu` **刻意留在本文件**（归属论证见其定义处）。
      // 莱卡恩 1141 的影画2 回能总额（分支的最后一个字段，**收尾批**）已于 2026-09-17
      // round 20 C-γ 迁进 `lycaon.ts#applyTeamConfig`：轴臂读 `axis.chainTotalBySlot`、
      // 非轴臂读本轮新增的 `countStun` 契约（C7 计数投影版失衡次数）+ `interactions` 契约的
      // `chainCountPerStun`（**store 原值**——`characters` 上那份被 `buildCharConfig` 写过
      // `?? (isSupport ? 0 : 1)` 兜底，store 默认 0 ⇒ 读 cfg 是静默改语义）。
      // 2026-09-26 CC-14a：该 cfg 字段已收进模块能力 `bonusEnergy`（core 不再读角色前缀字段）。
      // ⇒ 该分支整段删除、**棘轮 −1**（40 → 39），本文件 `characters.map` 里不再有 1141 判据。
      // 沿革（逐字段迁出的批次）：`lycaonStunCount`/`lycaonTotalTime`/`lycaonInvincibleTime`（后两者 r723 并回 cfg 公共通道）
      // （T26 批次 0c）→ `lycaonWindowDuration`（round 12 批次 2，走 `axis`）→
      // `lycaonBackstageDodgeCount`（round 14 批次 4，走 `interactions`）→ 影画2 回能（本批）。
      return merged
    })
    // 南宫羽 1511 的 `nangongQuickAssistPlaced`（轴内 `1511013` 放置块计数）与
    // `inStunWindowTriggers`（线程值副本）已迁进 nangong.ts 的 `applyTeamConfig`
    // （round 12 批次 2）——前者读下面的 `axis` 契约、后者读 `threads` 契约 ⇒
    // 本 map 里不再有该分支（棘轮 32 → 30 → **29**）。
    // 悠真 1201 / 朱鸢 1241 的轴内块计数（`harumasaAxisSlash`/`harumasaAxisArrow`、
    // `zhuYuanAxisEther`/`zhuYuanAxisActive`）已迁进各自模块的 `applyTeamConfig`（round 11 批次 1）；
    // 星徽·比利 1531（`billyAxisEx` 含 **combo 展开** / `billyAxisActive` / `billyStunCoverage`）、
    // 希格莉德 1591（`sigridAxisPozhenSets` / `sigridAxisActive`）、南宫羽 1511
    // （`nangongQuickAssistPlaced` / `inStunWindowTriggers`）同样已迁进各自模块（round 12 批次 2）
    // ——经下面 dispatch 的 `axis` / `threads` 契约快照读取 ⇒ 本 map 里不再有这些分支
    // （棘轮 34 → 32 → **29**）。1141 的 `lycaonWindowDuration` 也走同一 `axis` 契约
    // （该分支已于 round 20 C-γ 整段迁空，见上方沿革）。
    // CC-194：队伍级机制·postRound 相位——用**上一轮收敛**的次数对本轮新克隆的 cfg 派发
    // （「本轮收敛 → 下一轮注入」的真正落点）。旧实现在轮末对本轮克隆派发，下一轮重新克隆即丢失。
    if (threads.postRoundInput) {
      applyTeamMechanics({
        characters,
        configStore,
        catalogStore,
        phase: 'postRound',
        combatTime: base.totalTime,
        exCounts: threads.postRoundInput.exCounts,
        ultimateCounts: threads.postRoundInput.ultimateCounts,
        // CC-154：计数通道；CC-316：取**本轮** countStun（与 converge 派发同一口径）。原先随 postRoundInput 记录
        // 上一轮的 countStun，比本轮输入滞后一拍，stable 停点上可能仍在变（§24.154），且入签名会破坏长环检测。
        stunCount: countStun,
      })
    }
    // 队伍级机制·converge 阶段：带上一轮收敛量（莱特按上一轮全队能量消耗重算喷发回能；
    // 耀嘉音按失衡次数汇总全队连携入场）。各角色的具体口径在自己的模块里。
    applyTeamMechanics({
      characters,
      configStore,
      catalogStore,
      phase: 'converge',
      combatTime: base.totalTime,
      // CC-154（第 177 轮）：模块拿到的 `stunCount` = **计数通道**失衡次数（= `countStun`；off 下 ≡ 计划值 ⇒ 零差）。
      // 审计（docs/mcp-stun-dual-source.md §18）：applyTeamConfig 的全部读点都是计数或「窗数 × 窗长」一类计数派生量，
      // 读计划值是违约（types.ts 契约：当次数用的必须走计数通道）；physical 下计划 0.71 / 物理 2 这类差会系统性少算。
      // 回退点：改回 `stunCount,`（postRound 派发与 `axis.windows` 同步改回）。
      stunCount: countStun,
      teamEnergyConsumed: Math.max(0, threads.moduleFeedback.consumedTeamEnergy || 0),
      // 上一轮收敛线程快照（2026-09-15 arch 棘轮第 2 批）：跨轮反馈的通用通道。
      // 原先这些量（1381/1391/1431/1151/1541/1331/1161/1181/1191 共 9 处）是在本文件
      // characters.map 里逐 `merged.agentId === '…'` 分支写进 cfg 的；现由各模块自己的
      // applyTeamConfig 按需读取并写进自己那份 cfg（规则 6：编排层不写角色规则）。
      threads,
      // 本轮失衡轴上下文（2026-09-16 round 11，设计卡 §3 方案 A）：**只在 converge 相位传**
      // （dispatch 点唯一）。原先 1201/1241 等角色的「轴内 moveId 计数」是在上面 characters.map
      // 里逐 `merged.agentId === '…'` 分支算的；现在模块自己按 `axis.axes × axis.windows` 数。
      //
      // ⚠ 门控（round 7 实测踩过「门控写错时 timeGolden 照样绿」）：本对象只在 converge 出现是
      // **结构性**的——它写在 converge 这次调用里，`applyTeamMechanics` 对缺省 `params.axis`
      // **不做 `?? {}` 兜底**（helpers.ts）。模块侧另需 `!axis` 字段判据：只判相位不判字段时，
      // 「派发器漏传」会退化成静默零值而不是响亮失败（`axisContext.test.ts` 钉住这两条）。
      axis: {
        active: axisActive,
        // ⚠ 递的是**局部未清空**的 `resolvedAxes`（带 `active` 标志让模块自己判）——与对外返回值
        // `CalcRoundResult.resolvedAxes`（`forceNoAxis` 退化时被清空）语义不同，这是设计卡 §7-E7
        // 的待定点，本批选定「递局部 + active 标志」。
        axes: resolvedAxes,
        windows: allocateAxisWindows(resolvedAxes, countStun), // CC-154：与同快照 actionCounts/chainTotal/ultimateTotal 同源（原为计划值）
        windowSeconds: computeWindowDuration(),
        actionCountsBySlot: axisActionCountsBySlot,
        chainTotalBySlot: axisChainTotal,
      },
      // 全队**未缩放**交互次数快照（round 14 新增的只读通道）。数据源 = `configStore.team`
      // （**store 原值**），**不是**上面的 `characters`——后者已被 `interactionScale` 缩放
      // （`Math.round(x × scale)`，实测 scale=0.125 时 store 10 → cfg 0）且被 `parrySplit`
      // 改写击破位/主C 的 `parryCount`（实测带叶释渊 `parryTotal=13` 时 5/6 队 mergedΣ 变 13/9，
      // 而 storeΣ 恒 6）。形状/理由/两条消费点的**不同过滤口径**见 `AgentInteractionContext`。
      //
      // ⚠ 只有 converge 相位该传（与 `axis` 同款语义）；`applyTeamMechanics` 对缺省
      // `params.interactions` **不做 `?? {}` 兜底**，模块侧用 `!interactions` 判据分辨断路。
      //
      // ⚠ `chainCountPerStun` 是 round 20 C-γ 随本契约补的**第三道「必须 store 原值」量**：
      // `buildCharConfig` 给 cfg 那份写过 `?? (isSupport ? 0 : 1)` 兜底，而 store 默认是 `0`
      // ⇒ 用户没调过滑块时两份不同值（见 `AgentInteractionSnapshot.chainCountPerStun`）。
      interactions: {
        bySlot: Object.fromEntries(configStore.team.map((c, i) => [i, {
          agentId: c.agentId,
          parryCount: c.parryCount,
          blockCount: c.blockCount,
          dodgeCounterCount: c.dodgeCounterCount,
          dualCounterCount: c.dualCounterCount ?? 0,
          quickAssistCount: c.quickAssistCount,
          chainCountPerStun: c.chainCountPerStun,
        }])),
      },
      // **计数投影版**失衡次数（round 20 C-γ 补的 C7 契约）：本函数 `:472` 已算好的
      // `countStun`（= `projectStunPlanForCounts(stunCount, base.stunPlanProjection ?? 'off')`）。
      // ⚠ 与 `stunCount` 在难度阶梯 G4（`round`）打开时**不等价**——原 `agentId === '1141'`
      // 分支的非轴臂用的正是这个投影值，故必须把**算好的结果**递进去，而不是让模块自己再算
      // （`stunPlanProjection` 不在模块可达面上，且注册成 MechanicSetting 会变产品级口径）。
      // 同样只有 converge 相位该传、同样**不做兜底**（模块侧双判据门控）。
      countStun,
      // 保底目标三开关（round 21 夜D 新增的只读契约）：由配装页开关驱动
      // （`TeamConfigPage.vue#setGuarantee`），但**同时**被难度阶梯（`difficultyLadder.ts` 的
      // `GUARANTEE_KEYS`）与归档部署（`runArchiveDeploy.ts`）程序化改写 ⇒ 刻意**不**注册成
      // `MechanicSetting`（注册 = 内部实验旋钮变成资源利用率页可见滑块 = 产品级口径，用户未裁决）。
      // 代价是 `resolveMechanicSettings()` 看不见它 ⇒ 模块侧读不到，故在此递**当时算好的布尔结果**。
      //
      // ⚠ 语义与 `axis`/`interactions`/`countStun` 逐条同款：只有 converge 有值、**缺省即缺省**
      // （不 `?? {}` 兜底）。消费先例：般岳 1471 的 `autoTopUp` 系列（原为本文件
      // `characters.map` 里的 `agentId === '1471'` 分支）。
      guarantee: { stun: guaranteeStun, fury: guaranteeFury, ultimate: guaranteeUltimate },
      // Boss 预设弹刀反推的三项**输入侧**声明值（本轮拆分结果另走 `threads.parrySplit`，
      // 不在这里重复递——那是跨轮量、这是本局静态输入）。
      boss: { parryTotal, parryNoFollowUpTotal, parryDecibelOnlyTotal },
    })
    // 特殊动作喧响奖励（弹刀215/闪反10/连携10/快支20，含伴随50%）：本轮即时结算——
    // 输入只有用户配置的次数与连携数（= chainCountTotalOverride ?? chainCountPerStun × stunCount），无 ultimateCount 反馈环
    const perSlotChainForBonus = [0, 0, 0]
    for (const cfg of characters) {
      perSlotChainForBonus[cfg.slot] = chainCountTotalOf(cfg, countStun)
    }
    // 弹刀喧响（215/次）用注入后的有效次数（含反推拆分 + 不带支援突击 + 只给喧响 + 般岳补齐；不写回 store）
    const parryForBonus = [0, 0, 0]
    for (const cfg of characters) parryForBonus[cfg.slot] = cfg.parryCount + cfg.parryNoFollowUpCount + cfg.parryDecibelOnlyCount
    // CC-227：整份保留并随本轮结果返回（展示层直读——此前 useResourceCalc 用 store 原值另拼一份，Boss 弹刀反推 / 连携口径会漂）
    const specialActionBonusRound = calcSpecialActionBonus(
      parryForBonus,
      perSlotChainForBonus,
      configStore.team.map(c => c.dodgeCounterCount),
      configStore.team.map(c => c.quickAssistCount),
    )
    const specialBonusPerSlot = specialActionBonusRound.perSlotBonus
    // 异常/紊乱/乱流喧响奖励：上一轮异常池结果回填（首轮 0），在外层不动点内收敛
    const anomalyBonusPerSlot = configStore.team.map((_, s) => prevAnomalyDecibelBonus[s] ?? 0)

    const rr = enrichExecutionPlan(calcTeamResources({
      ...base,
      characters,
      stunCount,
      // CC-140：只在 stunPlanProjection='physical' 时被计数通道读（缺省模式下无读者 ⇒ 0 delta）
      ...(threads.prevPoolStunCount != null ? { stunCountPhysical: threads.prevPoolStunCount } : {}),
      axisOverlapByAction,
      ...(axisUltimatePromote ? { axisUltimatePromote } : {}),
      specialActionDecibelBonusPerSlot: specialBonusPerSlot,
      anomalyDecibelBonusPerSlot: anomalyBonusPerSlot,
      // 时间轴喧响轨（对轴模块，用户口径 2026-08-31）：轴模式按窗口时序推演每槽实际可放大招数
      //（180s 分失衡/非失衡段，喧响均匀回复 3000 上限，进窗够 3000 放大清空、不够削减该窗大招）。
      // 非轴模式不注入（回落总量口径）。首轮窗口时序按失衡次数均分（有效时间/N）估位，
      // 与轮内实际窗口节奏的偏差由外层不动点吸收（推演输入 = 上一轮收敛的喧响产出）。
      // 轴态信号（裁决 A 后不再注入次数；大招次数由引擎按槽位喧响总量推导）
      ...(axisActive ? { axisMode: true } : {}),
    }), catalogStore)
    // 橘福福：全队终结总次数（供额外能力 +300 / 影画2 威势）。
    //
    // ⚠ **本条刻意留在编排层**（2026-09-17 round 20 C-β 的归属判断，实测依据）：它是
    // 「全队 `ultimateCount` 之和 + 仪玄符法千重分量」，**与 1371 在不在队无关**，且这个求和
    // **没有任何角色判定**（不属规则 6 的棘轮面）。而 `collectNextRoundFeedback` **按槽位只对
    // 在队模块派发**：把全队汇总挂进 1371 模块 ⇒「有 1391 无 1371」的队里静默变 0；挂进 1391
    // 模块 ⇒「有 1371 无 1391」的队里同样静默变 0。编排层是唯一与队伍组成无关的 owner。
    //
    // 分量拆分（**与原式逐位等价**，原式 = `Σ ultimateCount` 循环内对 1371 那一次 `+= fufa`）：
    // ① 全队 `ultimateCount` 之和（下方那行，无角色判定、读点与原式同一处）；
    // ② 仪玄符法千重分量 = `feedbackNext.teamUltimateExtra`（1371 模块产出）；
    //    1371 不在队 ⇒ 该键缺席 ⇒ `?? 0`，与原式 `fufa` 恒 0 等价。
    // ⚠ 两眼必须**同在 `rr` 上取**（同一次 `enrichExecutionPlan` 结果），且 ② 只能在派发器之后合并。
    let teamUltimateBaseNext = 0
    for (const ch of rr.characters) teamUltimateBaseNext += ch.ultimateCount

    // 轴模式自动补齐下一轮量（保底）：嗔火缺口 → 双反；喧响缺口 → 弹刀。用 store 原始输入 + 本轮实际资源供给计算，
    // 外不动点收敛时 prevInteractionTopUp 稳定（round 0 无补齐 → 本轮算出的下一轮量即最终缺口）。
    let interactionTopUpNext = prevInteractionTopUp
    if (interactionTopUpSlot >= 0) {
      const storeChar = configStore.team[interactionTopUpSlot]
      const ultNeed = axisUltimateNeed(resolvedAxes, countStun, interactionTopUpSlot) // CC-142：计数通道
      // 喧响供给取般岳个人（终结技次数 = 个人喧响 / 终结技消耗，非全队总和；曾用全队总和导致
      // 队友喧响把缺口抹平 → 保底4喧响不补齐、般岳卡在 9000 出头打不满 4 大）
      const decibelHave = rr.characters.find(c => c.slot === interactionTopUpSlot)?.decibelSource?.total ?? 0
      // 槽位即按能力查找（CC-293）⇒ 该槽模块必有 computeInteractionTopUp；返回 null = 模块判定本轮不补齐 ⇒ 保持上一轮值（CC-295）
      const computeTopUp = storeChar?.agentId ? getAgentMechanic(storeChar.agentId)?.computeInteractionTopUp : undefined
      const topUpNext = computeTopUp?.({
        gate: { axisActive, guarantee: { fury: guaranteeFury, ultimate: guaranteeUltimate }, settings: resolveMechanicSettings(configStore) },
        dodgeCount: storeChar?.dodgeCounterCount ?? 0,
        parryCount: storeChar?.parryCount ?? 0,
        blockCount: storeChar?.blockCount ?? 0,
        dualCounterCount: storeChar?.dualCounterCount ?? 0,
        cinemaLevel: storeChar?.cinemaLevel ?? 0,
        axisEx: axisActionCountsBySlot[interactionTopUpSlot] ?? {},
        ultimateCountNeeded: Math.max(ultNeed, guaranteeUltimate ? 4 : 0),
        minRageCount: guaranteeFury ? 4 : 0,
        ultimateCost: base.characters.find(c => c.slot === interactionTopUpSlot)?.ultimateCost ?? ULTIMATE_COST_DEFAULT,
        decibelHave,
        battleTime: base.totalTime,
        // 单次补齐弹刀的原始动作时间 = 招架支援 + 支援突击（未扣合轴）：
        // 用来判「这次补齐是不是根本打不出来」（>200s = 非法，见 banyue.ts#AUTO_TOPUP_TIME_LIMIT_SEC）
        // ⚠ 按身份查（同 :1119；压缩数组下 `base.characters[interactionTopUpSlot]` 在空槽时会取错对象）
        perParrySeconds: (base.characters.find(c => c.slot === interactionTopUpSlot)?.defensiveAssistActionTime ?? 0)
          + (base.characters.find(c => c.slot === interactionTopUpSlot)?.assistFollowUpActionTime ?? 0),
      })
      if (topUpNext) interactionTopUpNext = topUpNext
    }

    // 通用保底4喧响：喧响缺口 → 弹刀（所有非般岳队伍）。目标 = 主C（槽0）保底 4 次终结技（4×3000 喧响），
    // 弹刀 = ceil(缺口 / 215)；与般岳同一口径，轮间经 prevDecibelParry 收敛。
    // 主C个人口径（用户 2026-08-31）：喧响只算主C自己的——队友喧响不能转移给主C开大，
    // 全队总和会把缺口抹平导致漏补（般岳分支同款坑，见上方注释）。
    // 四舍五入口径（用户 2026-08-31）：缺口 > 半次大招（1500）= 实战打不出下一次大 → 不补；
    // 缺口 ≤ 1500 → 补少量弹刀够到下一次（拟合司祭 4 喧响大 / 叶释渊 3 喧响大的实战档位）。
    // 单调不减（max 夹住上一轮）：215 是弹刀个人喧响奖励、实际每刀喧响含伴随/轻弹刀数据行更高，
    // 直接重算会在「缺口÷215」与「0」之间振荡——单调夹住后收敛到首轮估计，稳定且确定。
    let decibelParryNext = prevDecibelParry
    // CC-229：同时记下「使次数取到当前值的缺口」（与 decibelParry 同进退）+ 本轮剩余缺口，随结果交给展示层
    let decibelParryBasisShortNext = prevDecibelParryBasisShort
    let decibelResidualShort = 0
    let decibelRoundable = true
    if (decibelParryActive) {
      const mainDpsDecibel = rr.characters.find(c => c.slot === 0)?.decibelSource?.total ?? 0
      const decibelShort = Math.max(0, 4 * ULTIMATE_COST_DEFAULT - mainDpsDecibel)
      const roundable = decibelShort <= DECIBEL_ROUND_THRESHOLD
      decibelResidualShort = decibelShort
      decibelRoundable = roundable
      if (roundable) {
        // 等价于旧写法 max(prev, ⌈short/215⌉)，只是在「增大」分支顺手记下 basis
        const need = Math.ceil(decibelShort / PARRY_DECIBEL_BONUS)
        if (need > prevDecibelParry) {
          decibelParryNext = need
          decibelParryBasisShortNext = decibelShort
        }
      }
    }
    // 赠行由引擎物化 → rr 里已有赠行；池侧赠送口径单独结算，故基准提取跳过赠行（防双计）
    const baseStun = extractStunExecsFrom(rr, true)
    // CC-422：原 baseAnomaly = extractAnomalyExecsFrom(rr, true) 仅作 adj0/adj2 为 null 的兜底读取，而两者恒非 null ⇒ 死声明已删。
    const p = buildPromoteParams(configStore, catalogStore, rr, base.characters)
    // CC-417（T12）：原 `if (baseStun.length === 0) return null`（初始提交遗留）把「没有任何失衡贡献行」
    // 放大成「整轮无结果」——生产里单人支援/防护默认 weight 0 ⇒ 无平A行 ⇒ 只剩终结技 ⇒ 伤害池/能量账全部消失。
    // 空失衡池是合法状态：下游 promoteFixpoint / 失衡池按空数组算出 stunCount 0，伤害池照常给行（实测无 NaN / 抛错）。
    const goodReview = ultimateGiftSourceOf(configStore, rr)?.goodReviewTotal ?? -1  // CC-35d-B3
    const energyBySlot: Record<number, number> = {}
    for (const c of rr.characters) energyBySlot[c.slot] = c.energySource?.total ?? 0

    // 轴模式：转大完全由轴里的 promoteVariant 块决定（无块=0），不按好评/连携窗口自动推导
    const axisMode = axisActive

    // 失衡窗口内的失衡值不累积下一次失衡条：构建「轴内失效比例」提供者，供转大不动点内层计算有效失衡值。
    // 栈的资源门控（09-08 起超出槽位总量即去掉）⇒ 传本轮 rr 的闪能/喧响总量（不传 = 空表 = 耗资源块全被跳过）。
    let inAxisFractionProvider: InAxisFractionProvider | undefined
    if (axisActive) {
      const stackAxes = buildStackAxes(resolvedAxes)
      const stackEnergyBySlot: Record<number, number> = {}
      const stackDecibelBySlot: Record<number, number> = {}
      const basicTimeBySlot: Record<number, number> = {}
      for (const c of rr.characters) {
        stackEnergyBySlot[c.slot] = c.energySource?.total ?? 0
        stackDecibelBySlot[c.slot] = c.decibelSource?.total ?? 0
        basicTimeBySlot[c.slot] = c.timeAllocation.basicAttackTime
      }
      const windowDur = computeWindowDuration()
      inAxisFractionProvider = (stunCountN, execs) => {
        const stack = calcStunAxisStack({
          axes: stackAxes,
          stunCount: stunCountN,
          windowDuration: windowDur,
          energyBySlot: stackEnergyBySlot,
          decibelBySlot: stackDecibelBySlot,
        })
        const inAxisCounts = expandExecutedToCounts(stack.executed, stack.basicFillBySlot)
        const fraction: Record<string, number> = {}
        /**
         * ⚠ **分母必须按 key 求和，不能逐行取 `e.count`**（2026-10-05 §20.5-3 旁路修复）。
         *
         * `execs` 里**同一 `${slot}:${moveId}` 可以有多行**（实测般岳论道 `1471015` 在轴态有
         * `count=8` 与 `count=5` 两行），而 `calcStunPool` 对**每行**都取同一个 `fraction[key]`：
         *     Σ inAxisStun = perHit × (Σ count) × frac
         * 要让该合计 = `perHit × 轴内次数`，必须 `frac = 轴内次数 / Σcount`。
         * 旧实现逐行用**自己的** `count` 当分母 ⇒ 分母偏小 ⇒ 商被下方 `min(1,·)` **钳到 1.0**
         * （实测 `9/8=1.125→1.0`、`9/5=1.8→1.0`，两行都是 1.0）⇒ **该招整段被判为窗口内**、
         * 有效失衡值归零。用户口径 2026-10-05：「论道/狮吼这类强特**轴内轴外都有**」
         * ⇒ 轴外那部分应当攒条，故 `frac=1.0` 是假值。
         * 实测修正后：`frac` 1.0 → **0.6923**（= 9/13，与手算逐位吻合），轴态 eff +2285（+4.2%）。
         *
         * ⚠ **两行各自是否「窗口内/窗口外」对合计无影响**：`frac` 施加于两行的合计等价于
         * 分摊到任一行（`8k·f + 5k·f ≡ 13k·f`）⇒ 只修分母即可，不需要拆行。
         */
        const countByKey = new Map<string, number>()
        for (const e of execs) {
          const k = `${e.slot}:${e.moveId}`
          countByKey.set(k, (countByKey.get(k) ?? 0) + e.count)
        }
        for (const e of execs) {
          const lookKey = e.moveId === 'basic_attack' ? `${e.slot}:basic` : `${e.slot}:${e.moveId}`
          const inUnits = inAxisCounts[lookKey]?.count ?? 0
          const key = `${e.slot}:${e.moveId}`
          if (e.moveId === 'basic_attack') {
            const totalSec = basicTimeBySlot[e.slot] ?? 0
            fraction[key] = totalSec > 0 ? Math.max(0, Math.min(1, inUnits / totalSec)) : 0
          } else {
            const denom = countByKey.get(key) ?? 0
            fraction[key] = denom > 0 ? Math.max(0, Math.min(1, inUnits / denom)) : 0
          }
        }
        // CC-469′（r651）：窗口里被轴块（含兜底平A填充）占掉的**前台**秒数。池对非轴块行的时间份额兜底只按
        // 「未被覆盖的窗口时间」折算（`stunWindowFraction(N, W, eff, covered)`），不再对已被轴块填满的窗口时间
        // 再按 N·W/eff 扣一次：实测 jufufu N=4.46 时逐招行只扣 11.5k、兜底却再扣 39k（0.396×窗外行）⇒ 双重扣除。
        // 2026-09-10 裁决（栈填不满 N 窗时必须按时间约束负反馈）仍成立：未覆盖部分照扣。
        const coveredWindowSeconds = Math.max(0, stack.timeUsed - stack.overlapSeconds + stack.basicFillSeconds)
        return { fraction, coveredWindowSeconds }
      }
    }

    // 雨果决算失衡值返还：每次失衡结束返还 min(25%, 剩余秒×5%) × bossStunValue 进下一次失衡条。
    // 返还只由「结束失衡」的决算产生（C2 的 Q 不结束不返还），恒为每窗 1 次；剩余秒非轴取滑块（轴模式待接轴反推）。
    // CC-39a 2026-09-27：公式迁入雨果模块能力 `stunRefundRatio`（原内联 hugoSlot / hugoHasVerdict）；在队各模块取最大值。
    const getSetting = (k: string, d: number) => configStore.getMechanicSetting(k, d)
    const stunRefundRatio = Math.max(0, ...configStore.team.map(m =>
      (m.agentId ? getAgentMechanic(m.agentId)?.stunRefundRatio?.({ getMechanicSetting: getSetting }) : 0) ?? 0))

    // debt: 轮换动作覆盖实数化——物化执行行少于实战动作序列（仪玄强特 11 vs 实战 15+、平A填充/
    // 闪反取职业基准），竖向字段（伤害/失衡/异常）已行级进账而横向动作覆盖无逐角色锚点。
    // 升级路径：实数化专项逐角色收口（弹刀反推/合轴自动填充同族手法），以归档对拍定每角色动作锚点。
    // CC-300 / CC-305：锁定失衡（`enemy.stunCountLock ≥ 0`，命座对比「操作够就能打 N 次」）⇒ 两次不动点都按计数通道值
    // countStun（CC-151：锁定时 ≡ 锁定值 / 其投影）单趟求值、池次数钉到它。原 CC-300 只在 sp1 之后钳池，
    // 不动点内部的转大次数仍按自算次数推（命座抬失衡值的假提升从 promote 漏出）⇒ 锁定下沉进 promoteFixpoint。
    const stunLockN = configStore.enemy.stunCountLock
    const lockForPool = stunLockN >= 0 ? countStun : undefined
    // Round 0：无易伤 → 畏缩覆盖率初算
    const sp0 = promoteFixpoint(baseStun, 0, p, axisHug, axisMode, { configStore, panels: panels.value }, inAxisFractionProvider, stunRefundRatio, lockForPool)
    const adj0 = applyUltimatePromote(rr, sp0, catalogStore)
    // 本轮极性强击赠送次数：读本轮 rr 而非异常池 setup（循环依赖，见 calcAnomalyPoolInput）。
    // CC-38b：模块能力 `giftedPolarAssaultCount` 派发求和；CC-75 收进 giftedPolarAssault.ts（口径裁定 = 求和，见该文件头）。
    const giftedPolarAssaultThisRound = sumGiftedPolarAssault(rr.characters)
    // CC-78：无 anomalyPoolSetup 声明者时赠送的归属槽（有 setup 时 roundInputs 仍用 setup.slot）
    const giftedPolarAssaultSlot = firstGiftedPolarAssaultSlot(rr.characters)
    const ap0 = calcAnomalyPoolInput(0, extractAnomalyExecsFrom(adj0), giftedPolarAssaultThisRound, giftedPolarAssaultSlot)

    // Round 1：含易伤 → 畏缩覆盖率修正 → 最终收敛
    const flinch1 = ap0.coverage.physicalCoverageRate
    const sp1 = promoteFixpoint(baseStun, flinch1, p, axisHug, axisMode, { configStore, panels: panels.value }, inAxisFractionProvider, stunRefundRatio, lockForPool)

    // Boss 预设弹刀反推下一轮量（保底4失衡）：本轮失衡池（含注入的击破位弹刀）→ 非弹刀基数 → 缺口 → 补齐。
    // 击破位弹刀行（轻弹刀 + 支援突击，count 随弹刀次数缩放）：行贡献剔出非弹刀基数（防 0↔T 振荡），
    // 正常弹刀每次失衡 = 轻弹刀 + 支援突击；不带支援突击弹刀每次失衡 = 仅轻弹刀。无行 = 无招架失衡来源，不反推。
    let parrySplitNext = prevParrySplit ?? { breakerParry: 0, mainDpsParry: 0, breakerNoFollowUp: 0, mainDpsNoFollowUp: 0, topUp: 0, perParryDaze: 0, perNoFollowUpDaze: 0 }
    let backstageAutoNext: Record<string, number> = threads.backstageAuto ?? {}
    if (parrySplitActive) {
      const breakerCfg = base.characters.find(c => c.slot === effectiveBreakerSlot)
      const breakerDefMoveId = breakerCfg?.defensiveAssistMoveId ?? ''
      const breakerFollowUpMoveId = breakerCfg?.assistFollowUpMoveId ?? ''
      const defRow = sp1.pool.contributions.find(c => c.slot === effectiveBreakerSlot && c.moveId === breakerDefMoveId)
      const fuRow = sp1.pool.contributions.find(c => c.slot === effectiveBreakerSlot && c.moveId === breakerFollowUpMoveId)
      // 每次弹刀失衡值：本轮有击破位弹刀行则实测；否则沿用上一轮实测值（击破位 0 弹刀时无行，
      // 但失衡值/面板不变，沿用即可，防「反推归零 → 无行 → 无法再反推」卡死）
      const hasRows = defRow && defRow.count > 0
      const perNoFollowUpDaze = hasRows ? defRow!.effectiveStun / defRow!.count : (prevParrySplit?.perNoFollowUpDaze ?? 0)
      const assistPerHit = (hasRows && fuRow && fuRow.count > 0) ? fuRow.effectiveStun / fuRow.count : (prevParrySplit ? prevParrySplit.perParryDaze - prevParrySplit.perNoFollowUpDaze : 0)
      const perParryDaze = perNoFollowUpDaze + assistPerHit
      const injectedParryDaze = (defRow?.effectiveStun ?? 0) + (fuRow?.effectiveStun ?? 0)
      // 非弹刀基数 = 全队有效失衡 − **全部弹刀行**（击破位 + 主C 各自注入的弹刀）+ boss 白送失衡。
      // 2026-09-07 修：旧实现只扣击破位行——主C 拿「剩余」弹刀后其行留在基数里，把反推 T 喂成 0
      // → 弹刀永远不再给击破位（实测 琉音 击破位 0 弹刀、8 次全落主C），且「队友弹刀→落雷→闪能」
      // 信道（assistCap = Σ队友弹刀）随之归零 → 仪玄闪能缺口、强特次数保守。T 只依赖无弹刀基数，
      // 与注入量无关 → 轮间单调收敛不振荡（坑18 判据成立）。
      const mainDpsDistinct = !noBreakerFallback && mainDpsSlot >= 0 && mainDpsSlot !== breakerSlot
      const mainDpsCfg = mainDpsDistinct ? base.characters.find(c => c.slot === mainDpsSlot) : undefined
      const mainDpsDefRow = mainDpsDistinct
        ? sp1.pool.contributions.find(c => c.slot === mainDpsSlot && c.moveId === (mainDpsCfg?.defensiveAssistMoveId ?? ''))
        : undefined
      const mainDpsFuRow = mainDpsDistinct
        ? sp1.pool.contributions.find(c => c.slot === mainDpsSlot && c.moveId === (mainDpsCfg?.assistFollowUpMoveId ?? ''))
        : undefined
      const injectedMainDpsParryDaze = (mainDpsDefRow?.effectiveStun ?? 0) + (mainDpsFuRow?.effectiveStun ?? 0)
      const nonParryStun = Math.max(0, sp1.pool.totalStunBuildUp - injectedParryDaze - injectedMainDpsParryDaze + sp1.pool.stunGift)
      parrySplitNext = {
        ...computeParrySplit({
          targetStunCount: GUARANTEE_STUN_TARGET,
          stunCount: sp1.pool.stunCount,
          nonParryStun,
          bossStunValue: configStore.enemy.stunValue,
          stunRefundRatio: sp1.pool.stunRefundRatio,
          perParryDaze,
          perNoFollowUpDaze,
          parryTotal,
          parryNoFollowUpTotal,
          breakerInput: configStore.team[effectiveBreakerSlot]?.parryCount ?? 0,
          mainDpsInput: noBreakerFallback
            ? (configStore.team[effectiveBreakerSlot]?.parryCount ?? 0)
            : (configStore.team[mainDpsSlot >= 0 ? mainDpsSlot : breakerSlot]?.parryCount ?? 0),
        }),
        perParryDaze,
        perNoFollowUpDaze,
      }
    }

    // 后台合轴自动填充反推（模块 backstageAutoFill 声明驱动，通用执行零 agentId 分支；
    // 用户口径 2026-09-07：合轴可自动填充、不占前台不计难度，反推至保底4失衡）：
    // 缺口 = stunBuildUpForCount(池@保底次数, 保底次数) −（该池总失衡 − 其中合轴行）（CC-475：池在目标次数的扣除口径下重算）；每对有效失衡优先实测
    //（声明 moveIds 的池行），首轮回落 perPairBase；供给上限 = floor(非该角色战斗时间 / minPeriodSeconds)。
    {
      /** 用户口径 2026-09-07「反推至保底4失衡」的那个 4 */
      const BACKSTAGE_FLOOR_STUNS = 4
      const backstageNext: Record<string, number> = {}
      for (const cfg of base.characters) {
        const decl = getAgentMechanic(cfg.agentId)?.backstageAutoFill
        if (!decl) continue
        const manual = Math.max(0, Math.floor(Number(cfg[decl.manualField] ?? 0)))
        if (manual > 0) { backstageNext[cfg.agentId] = manual; continue }
        // CC-475（r656）：缺口在**目标次数**的扣除口径下算。N 3→4 时窗口份额 u 变大、全队所有行的净失衡同时下降，
        // 在当前 N 的池上算缺口看不到这部分（r655 探针 `arenaF/zzbs.test.ts`：8 支裸装合成队自动注入 11~30 对后 7 队仍 N=3
        //（外层 2-环被钳到 3），第 8 队欠冲 16 对）。poolAt(4) = 同一组 execs 在 4 次窗口下的池（轴模式含栈遍历）。
        const pool = sp1.poolAt(BACKSTAGE_FLOOR_STUNS)
        const ownRows = pool.contributions.filter(r => decl.moveIds.includes(String(r.moveId)) && r.slot === cfg.slot)
        const ownDaze = ownRows.reduce((sum, r) => sum + r.effectiveStun, 0)
        const pairRows = ownRows.filter(r => decl.moveIds.slice(0, 2).includes(String(r.moveId)))
        const pairCount = pairRows.reduce((sum, r) => sum + r.count, 0)
        // 首轮无合轴行：perPairBase 是毛失衡，按同一 u 折成净值
        const perPair = pairCount > 0 ? ownDaze / pairCount : decl.perPairBase * (1 - sp1.windowFractionAt(BACKSTAGE_FLOOR_STUNS))
        // CC-472（r653）：缺口按池自身计数律的反函数算（首次 b、之后每次 b(1−r)、赠送已抵扣），不再写死 4×bossStunValue。
        const deficit = Math.max(0, stunBuildUpForCount(pool, BACKSTAGE_FLOOR_STUNS) - (pool.totalStunBuildUp - ownDaze))
        const ownField = rr.characters.find(c => c.slot === cfg.slot)
        const ownFieldTime = (ownField?.timeAllocation?.necessaryTime ?? 0) + (ownField?.timeAllocation?.basicAttackTime ?? 0)
        const supplyCap = Math.max(0, Math.floor(Math.max(0, base.totalTime - ownFieldTime) / decl.minPeriodSeconds))
        // 原 ×1.2 冗余（注释「实测 18 对只涨 3.85×」）就是 u 随 N 增大的效应，已由 poolAt(4) 显式算进 ⇒ 删（CC-475）。
        // CC-477（r659）：线性估计只对当前分支成立，回削会跨到 N−1 分支再估回来 ⇒ 外层 2-环 + CC-150 钳 ⇒ 同输入两个 N。
        // 到保底即持住（r660：向上也不动——上限随对数翻转时 +1 再夹回会 24↔25 环），未到保底才阻尼上行；见 core/stunPool.ts#relaxAutoFillStep。
        const prevAuto = threads.backstageAuto?.[cfg.agentId]
        const estPairs = Math.ceil(deficit / Math.max(1, perPair))
        const reached = sp1.pool.stunCount >= BACKSTAGE_FLOOR_STUNS
        const nextPairs = relaxAutoFillStep(prevAuto, estPairs, supplyCap, reached)
        // CC-479：反推块逐轮打表（`PROBE_TRACE_BACKSTAGE=1`）。cont4 = poolAt(保底) 口径、curCont = 本轮实际池；二者差见 arch CC-477 行 r661 量化。
        probePush('PROBE_TRACE_BACKSTAGE', '__backstageSteps', () => ({
          key: probeKey(), agentId: cfg.agentId, prev: prevAuto ?? null, est: estPairs, next: nextPairs, cap: supplyCap, reached,
          perPair, pairCount, ownDaze, deficit, cont4: continuousStunCount(pool), curN: sp1.pool.stunCount, curCont: continuousStunCount(sp1.pool),
        }))
        backstageNext[cfg.agentId] = nextPairs
      }
      backstageAutoNext = backstageNext
    }

    const adj1 = applyUltimatePromote(rr, sp1, catalogStore)
    // 诺姆膛温换连携：帽子把戏触发上一位角色快速支援→替换为连携，连携归属上一位队友；C4 时诺姆+队友各 200 不可分享喧响。
    const adj2 = applyChainGift(adj1, configStore, catalogStore, base.characters)
    // 展示层：resourceResult 也带上诺姆赠送连携与琉音好评转大（与 adj2 同一入参链，CC-336 消除重复求值），
    // 不动点/失衡池仍用原始 rr（baseStun），避免赠送连携失衡反作用于转大收敛。
    // 展示口径归一：赠送行（诺姆赠链 / 琉音赠大，含轴模式 post-hoc carve 路径）在装配后追加，
    // 引擎 timeAllocation 看不到 → 按**最终行**重算前台/后台（单一展示口径，见 normalizeDisplayTime）
    const rrShown = normalizeDisplayTime(adj2)

    const cov1 = computeStunCoverage(sp1.pool, verdictSecondsLost)
    const ap1 = calcAnomalyPoolInput(cov1, extractAnomalyExecsFrom(adj2), giftedPolarAssaultThisRound, giftedPolarAssaultSlot)

    // 「下一轮反馈」统一派发（2026-09-16 arch 棘轮第 6 批）：普罗米娅(1541)/零号·安比(1381)/
    // 露西(1151)/薇薇安(1331)/艾莲(1191) 的算法已迁进各自模块的 `nextRoundFeedback` 钩子
    // （规则 6：编排层不认人）。编排层只调一次通用派发器，模块按需读本轮结果 + 上一轮线程快照，
    // 返回下一轮线程值；下方 merge 进 threadsNext。
    // ⚠ 派发点必须在 ap1 之后（钩子入参含异常池）。迁移前安比那处在 ap1 之前，但两者既不读对方
    // 写的 cfg 字段、也无其它共享可变状态（钩子之间彼此独立）⇒ 合并为一次派发逐位等价。
    // 2026-09-17 C-α 批：叶瞬光(1431)/格莉丝(1181) 也迁入该派发，编排层只 merge。
    // 2026-09-17 round 20 C-β 批：仪玄(1371) 的 `teamUltimateExtra` 与莱特(1161) 的
    // `consumedTeamEnergy` 同样迁入；橘福福的「全队终结总次数」因与队伍组成无关仍留编排层。
    const feedbackNext = collectNextRoundFeedback({
      characters,
      teamResult: rr,
      displayResult: rrShown,
      adjustedResult: adj2,
      anomalyPool: ap1,
      prevThreads: threads,
      catalogStore,
      combatTime: base.totalTime,
    })

    // 队伍级机制·postRound 阶段：本轮次数已收敛 → 为下一轮注入派生量。
    // `consumedTeamEnergy` 的**计算与写 cfg** 都已回到莱特模块自己的 `applyTeamConfig`（postRound）
    // 与 `nextRoundFeedback`（返回值 → threadsNext），编排层只 merge。
    let teamVeilCountTotalNext = 0
    let postRoundInputNext: PostRoundInput | null = null
    {
      const exByAgent = new Map(rr.characters.map(ch => [ch.agentId, ch.exSpecialCount]))
      const ultByAgent = new Map(rr.characters.map(ch => [ch.agentId, ch.ultimateCount]))
      const exCounts = characters.map(c => Math.max(0, exByAgent.get(c.agentId) ?? 0))
      const ultimateCounts = characters.map(c => Math.max(0, ultByAgent.get(c.agentId) ?? 0))
      // 2026-09-17 round 20 C-β：莱特全队能量消耗的 `if (characters.some(c => c.agentId === '1161'))`
      // 守卫 + 估计式已迁进 `lighter.ts#lighterNextRoundFeedback`（派发器只对在队模块派发 ⇒ 守卫
      // 自然满足；估计式同一入参口径，见该钩子注释的逐位等价论证）。
      // 全队帷幕次数（下一轮注入）：照霜寒开帷幕 + 爱芮/叶瞬光终结技 + 千夏强特，按本轮收敛次数算。
      teamVeilCountTotalNext = computeTeamVeilCountTotal(characters, exCounts, ultimateCounts, base.totalTime)
      // CC-194：只记录入参，派发挪到下一轮 converge 之前（见上方 `threads.postRoundInput`）
      postRoundInputNext = { exCounts, ultimateCounts }
    }

    // 薇薇安落羽生花双源 / 普罗米娅·霜刑回复端的「下一轮注入」已迁进各自模块的
    // `nextRoundFeedback` 钩子（2026-09-16 arch 棘轮第 6 批）⇒ 统一由上方 feedbackNext 承载。
    // 失衡内异常系统 v2：轴内逐窗积蓄槽时间线 → 平均每窗触发次数 + 逐元素活跃覆盖。
    // 全部异常角色通用（不限定南宫羽）：消费方=异放/极性紊乱 dominant 归因、南宫羽颤音自动层数、UI「失衡内异常状态」栏
    let inStunAnomalyStateNext: InStunAnomalySummary | null = null
    let inStunWindowTriggersNext = 0
    // Boss 异常状态轴（用户口径 2026-08-24）：v2 触发序列推进状态机——不同属性触发=紊乱并
    // 替换状态（归因取被替换原状态），风化独立层不参与替换；极性紊乱按点时归因消费。
    let bossAnomalyStateNext: BossAnomalyStateResult | null = null
    if (axisActive) {
      const contribMap = new Map<string, { element: string; perHit: number }>()
      for (const prog of ap1.perElement) {
        for (const c of prog.contributions) contribMap.set(c.moveId, { element: prog.element, perHit: c.perHitBuildUp })
      }
      if (contribMap.size > 0) {
        // 单次失衡表达（v3.2 用户裁决）：每条生效轴条目模拟一个代表窗；该段打几次由
        // 「失衡次数」统计表达，不再逐窗展开、也无跨窗继承（窗口外未建模）。
        const winAlloc = allocateAxisWindows(resolvedAxes, Math.round(countStun)) // CC-155：代表窗分配属计数通道（原为计划值）
        const thresholdCoeff = configStore.enemy.anomalyCoeff * configStore.enemy.bossAnomalyCoeff
        const windows: InStunWindowInput[] = []
        const windowEntryIdx: number[] = []
        resolvedAxes.forEach((axis, ai) => {
          const wins = Math.floor(winAlloc[ai] ?? 0)
          if (wins <= 0) return
          const actions = axis.actions
            .map((a, srcIndex) => ({ a, srcIndex }))
            .filter(({ a }) => contribMap.has(a.moveId))
            .map(({ a, srcIndex }) => {
              const cm = contribMap.get(a.moveId)!
              // 动作时长：显式 duration（仪玄蓄力）优先，否则技能表 actionTime——
              // 触发事件附着在动作结束点（用户口径），瞬发块才落在起点
              const skills = catalogStore.agentSkillsByAgentMap.get(configStore.team[a.slot]?.agentId ?? '')
              const move = findMoveById(skills, a.moveId)
              const duration = a.duration ?? move?.actionTime ?? 0
              return { moveId: a.moveId, srcIndex, element: cm.element, perHitBuildUp: cm.perHit, count: Math.max(0, Math.floor(a.count || 1)), startTime: a.startTime ?? 0, duration }
            })
          const entryStates = Object.entries(axis.entryBars ?? {})
            .map(([element, pct]) => {
              const p = Math.max(0, Math.min(100, Number(pct)))
              if (!Number.isFinite(p) || p <= 0) return null
              const firstPipe = (BUILDUP_THRESHOLD_TABLE[element] ?? BUILDUP_THRESHOLD_TABLE.ice)[0]
              return { element, gauge: (p / 100) * firstPipe * thresholdCoeff }
            })
            .filter((x): x is { element: string; gauge: number } => x !== null)
          windows.push({ actions, entryStates: entryStates.length > 0 ? entryStates : undefined })
          windowEntryIdx.push(ai)
        })
        // 边界注入：声明了初始状态的条目在其代表窗开局强制设状态；
        // 抑制 id 以条目序为键（`${ei}:${元素}:${序数}`），无需映射
        const boundaryStates: Array<{ windowIndex: number; element: string }> = []
        const suppressedGlobal: string[] = []
        windows.forEach((_, wi) => {
          const axis = resolvedAxes[windowEntryIdx[wi]]
          const el = bossEntryAnomalyElement(axis.entryAnomaly ?? 0)
          if (el) boundaryStates.push({ windowIndex: wi, element: el })
          for (const sid of axis.suppressedTriggers ?? []) suppressedGlobal.push(sid)
        })
        const tl = computeInStunAnomalyTimeline({ windows, windowDuration: computeWindowDuration(), coeff: thresholdCoeff, suppressedTriggerIds: suppressedGlobal })
        inStunWindowTriggersNext = windows.length > 0
          ? Math.round((tl.triggers.length / windows.length) * 10) / 10
          : 0
        // 摘要（UI「失衡内异常状态」栏）：每元素 触发次数合计 + 各窗覆盖均值
        const agg = new Map<string, { triggerCount: number; covSum: number }>()
        for (const t of tl.triggers) {
          const key = getBaseElement(t.element)
          const cur = agg.get(key) ?? { triggerCount: 0, covSum: 0 }
          cur.triggerCount += 1
          agg.set(key, cur)
        }
        tl.coveragePerWindow.forEach(cov => {
          for (const [el, v] of Object.entries(cov)) {
            const key = getBaseElement(el)
            const cur = agg.get(key) ?? { triggerCount: 0, covSum: 0 }
            cur.covSum += v
            agg.set(key, cur)
          }
        })
        inStunAnomalyStateNext = {
          windows: windows.length,
          elements: [...agg.entries()].map(([element, a]) => ({
            element,
            triggerCount: a.triggerCount,
            avgCoverage: windows.length > 0 ? Math.round((a.covSum / windows.length) * 1000) / 1000 : 0,
          })),
          windowEntryIdx,
          triggerSources: tl.triggers
            .filter(t => t.moveId && t.id)
            .map(t => ({ windowIndex: t.windowIndex, moveId: t.moveId!, element: getBaseElement(t.element), offsetSeconds: t.offsetSeconds, id: t.id!, srcIndex: t.srcIndex })),
          gaugeSnapshots: tl.gaugeSnapshots,
          note: `轴内逐窗积蓄槽模拟（${windows.length} 窗）：进窗继承上一窗余量，积蓄超阈值即触发对应异常；覆盖=异常激活时长占窗口比例。`,
        }
        // ⚠ 2026-09-16 round 12 复核、round 13 删除的死写（规则 16①）：
        //   `if (prevInStunWindowTriggers <= 0) { for (const c of characters) if (c.agentId === '1511')
        //    (c as any).inStunWindowTriggers = inStunWindowTriggersNext }`
        // 判死依据 = **静态**（死写不可能有测试变红，故不能用「短路不红」推断）：
        //   · `characters` 是 `:715` `base.characters.map(...)` 产出的**本轮局部克隆数组**，
        //     既不写回 `base.characters` 也不跨轮留存；
        //   · 该数组在本次写入（原 `:1415`）之后**零引用**（`awk NR>1418` 实测无命中；其后的
        //     `characters` 全是 `rr.characters` / `base.characters`）；
        //   · 其间唯一的闭包 `inAxisFractionProvider`（`:1111`）只捕获 `rr.characters`，
        //     且其调用点（`:1149/:1157`）在此写入**之前**。
        // ⇒ 写入一个此后无人读的对象。真正的消费路是 1511 模块的 `applyTeamConfig` 读 `threads`
        //   契约（round 12 批次 2 已迁），与这里的副本无关。
        const bossWindowDur = computeWindowDuration()
        bossAnomalyStateNext = {
          ...computeBossAnomalyStateTimeline({
            triggers: tl.triggers,
            windowDuration: bossWindowDur,
            windowCount: Math.max(1, windows.length),
            // 条目边界注入：敌方以声明状态进入该段失衡（不记紊乱）
            boundaryStates,
          }),
          windowDuration: bossWindowDur,
          // 代表窗→条目映射：结算端事件次数按条目失衡数加权取样用
          windowEntryIdx: windowEntryIdx,
        }
      }
    }
    // 薇薇安双源 / 艾莲影画4 冻结次数的「下一轮反馈」已迁进各自模块的 `nextRoundFeedback`
    // 钩子（2026-09-16 arch 棘轮第 6 批）；本轮返回值统一在 feedbackNext 里，见上方派发点。

    return {
      resourceResult: rrShown,
      stunPool: sp1.pool,
      anomalyPool: ap1,
      adjustedResourceResult: adj2,
      promote: sp1.promote,
      promoteHug60: sp1.hug60,
      stunCoverage: cov1,
      // 轴退化时生效轴 = 无（诚实反映：轴定义仍解析，但没有注入计算）
      resolvedAxes: opts?.forceNoAxis ? [] : resolvedAxes,
      matchedPlanName: opts?.forceNoAxis ? null : planName,
      interactionTopUp: interactionTopUpNext,
      parrySplit: parrySplitNext,
      specialActionBonus: specialActionBonusRound as SpecialActionBonusResult,
      decibelGuarantee: {
        active: decibelParryActive,
        parry: decibelParryActive ? prevDecibelParry : 0,
        basisShort: decibelParryActive ? prevDecibelParryBasisShort : 0,
        residualShort: decibelResidualShort,
        roundable: decibelRoundable,
        roundThreshold: DECIBEL_ROUND_THRESHOLD,
        perParry: PARRY_DECIBEL_BONUS,
      },
      inStunAnomalyState: inStunAnomalyStateNext,
      bossAnomalyState: bossAnomalyStateNext,
      threadsApplied: threads,
      axisStack: axisExecutedStack,
      axisActive, // CC-302：forceNoAxis 已含在局部 axisActive 内
      parrySplitGate: { active: parrySplitActive, breakerSlot: effectiveBreakerSlot }, // CC-303
      threadsNext: {
        goodReview,
        energyBySlot,
        anomalyDecibelBonus: [],
        interactionTopUp: interactionTopUpNext,
        parrySplit: parrySplitNext,
        backstageAuto: backstageAutoNext,
        // ② 符法千重分量（1371 模块产出）：原式是循环内对 1371 那一次 `teamUlt += fufa`；
        // 1371 不在队 ⇒ 该键缺席 ⇒ `?? 0`（原式 `fufa` 恒 0）。
        teamUltimateForJufufu: teamUltimateBaseNext + (feedbackNext.teamUltimateExtra ?? 0),
        // 「下一轮反馈」线程：由各模块 nextRoundFeedback 钩子算出（缺省 0 = 该角色不在队
        // 或守卫不成立，与迁移前各函数返回 0 逐位等价；露西无守卫恒写）。
        // ⚠ 例外 = `teamUltimateForJufufu`（上一行）：全队汇总、与队伍组成无关，刻意留编排层。
        // 爱丽丝剑仪外部次数源（下一轮注入）：CC-22 起由爱丽丝 `nextRoundFeedback` 产出
        // （口径仍在 aliceExternalCountsOf：只算爱丽丝自己触发的 physical 强击），编排层只 merge。
        // CC-31：各模块下一轮反馈整份存入（原 14 个具名字段逐键 `?? 0` 拆出；缺键 = 0，读侧 `?? 0`）
        moduleFeedback: { ...feedbackNext },
        inStunWindowTriggers: inStunWindowTriggersNext,
        teamVeilCountTotal: teamVeilCountTotalNext,
        postRoundInput: postRoundInputNext,
        decibelParry: decibelParryNext,
        decibelParryBasisShort: decibelParryBasisShortNext,
        // 轴栈喧响预算 = 本轮各槽喧响产出。CC-317 删掉原先的 max(上一轮, 本轮) 棘轮（防「轨削减大招 → 产出下滑 →
        // 螺旋到 0」）：第 332 轮复测 495 例 golden + specs，棘轮在约 20% 的轮次生效，但只改变 7 次中间轮的喧响跳过，
        // 最终结果、退出类型、总轮数逐位不变；而棘轮让预算依赖迭代路径（历史最大值）。若日后复现螺旋，回退 CC-317。
        decibelRegenBySlot: Object.fromEntries(
          rr.characters.map(c => [c.slot, c.decibelSource?.total ?? 0]),
        ),
        // 上一轮失衡池整数次数：轴内块数落地（雨果决算 坑36）与池同源的滞后注入
        prevPoolStunCount: sp1.pool.stunCount,
      },
    }
  }

  return runCalcRound
}
