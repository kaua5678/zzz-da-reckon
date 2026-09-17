/**
 * 收敛轮输入 helpers（#10 首批租户，2026-09-12 自 `useResourceCalc.ts` 的 178-247/253-439 嵌套簇**逐字**搬入）。
 *
 * 为什么建：评审 #10 =「把编排巨函数里的收敛域代码搬进 `resourceCalc/convergence.ts`，给 agentId 特判一个落点」。
 * 本文件先收**轮输入簇**（提取器/风与爱丽丝检测/异常池入参/自动轴解析/栈轴构建/次数展开——runCalcRound 的
 * 前置材料，共 ~260 行）；`runCalcRound`/`runOuterLoop` 本体因闭包面 33 个外层名（含可变 let）需 **ctx 设计**
 * 分轮再搬（设计要点见 .claude 账本），不盲搬。
 *
 * 形态：工厂函数（**每组件实例一份**——簇里有 computed，模块级创建会成单例泄漏）；
 * deps 注入的是 store 实例与 computed ref 本体（响应性、求值时机与迁移前一致）；
 * 成员函数名与外层解构名一致 ⇒ 调用方除 import + 一次工厂调用外**零改动**。
 *
 * 行为锚判据：timeGolden / timeFillRatchet delta=0（规则 10）。
 */
import { computed, type ComputedRef } from 'vue'
import type { useConfigStore } from '@/stores/config'
import type { useCatalogStore } from '@/stores/catalog'
import { calcAnomalyPool, type AnomalySkillExecution } from '@/core/anomalyPool'
import type { StunSkillExecution } from '@/core/stunPool'
import type { AnomalyPoolResult, StunAxis, ResourceCalcConfig, TeamResourceResult, StunPoolResult, InStunAnomalySummary } from '@/types/resource'
import type { PanelValues } from '@/types/catalog'
import type { StackActionCost } from '@/core/stunAxisStack'
import { resolveStunAxisPlan, selectAutoStunAxisPreset, cloneStunAxes } from '@/data/stunAxisPresets'
import { getAgentMechanic, getRegisteredAgentMechanics } from '@/mechanics'
import { SIGRID_LANCE_SEGMENT_IDS } from '@/mechanics/agents/sigrid'
import { HUGO_EX_VERDICT_MOVE_ID, HUGO_ULT_MOVE_ID, HUGO_EX_FINAL_ACTION_TIME } from '@/mechanics/agents/hugo'
import { extractSkillExecutions, findMoveById } from './helpers'

export function createConvergenceRoundInputs(deps: {
  configStore: ReturnType<typeof useConfigStore>
  catalogStore: ReturnType<typeof useCatalogStore>
  panels: ComputedRef<PanelValues[]>
  resourceConfig: ComputedRef<ResourceCalcConfig | null>
  remielleAnomalyMultiplier: ComputedRef<number>
}) {
  const { configStore, catalogStore, panels, resourceConfig, remielleAnomalyMultiplier } = deps

/** 从某个资源池结果提取异常 execs（参数化）；`skipGift` = 只取「装配前」口径（赠行单独结算） */
  function extractAnomalyExecsFrom(res: TeamResourceResult, skipGift = false): AnomalySkillExecution[] {
    const execs: AnomalySkillExecution[] = []
    for (let i = 0; i < 3; i++) {
      const char = configStore.team[i]
      if (!char?.agentId) continue
      const skills = catalogStore.getAgentSkills(char.agentId)
      const { anomalyExecs } = extractSkillExecutions(i, char.agentId, skills ?? undefined, res, catalogStore, panels.value[i] ?? null, configStore, { skipGift })
      execs.push(...anomalyExecs)
    }
    return execs
  }

  /** 从某个资源池结果提取失衡 execs（参数化）；`skipGift` 同上 */
  function extractStunExecsFrom(res: TeamResourceResult, skipGift = false): StunSkillExecution[] {
    const execs: StunSkillExecution[] = []
    for (let i = 0; i < 3; i++) {
      const char = configStore.team[i]
      if (!char?.agentId) continue
      const skills = catalogStore.getAgentSkills(char.agentId)
      const { stunExecs } = extractSkillExecutions(i, char.agentId, skills ?? undefined, res, catalogStore, panels.value[i] ?? null, configStore, { skipGift })
      execs.push(...stunExecs)
    }
    return execs
  }

  /** 风属性检测（复用） */
  const windInfo = computed(() => {
    let hasWind = false; let slot = -1
    for (let i = 0; i < 3; i++) {
      const a = configStore.team[i]?.agentId ? catalogStore.getAgent(configStore.team[i].agentId) : null
      if (a?.damageElement === 'wind') { hasWind = true; slot = i; break }
    }
    return { hasWindChar: hasWind, windCharSlot: slot }
  })

  /** 爱丽丝配置（复用）：仅承载与 resourceResult 无关的畏缩结算配置。
   *  极性强击赠送计数不在此读——aliceInfo 读 resourceResult（= calcOutput.value.resourceResult）
   *  会在 calcOutput 自身求值内构成循环依赖（首算恒读空，曾致极性强击行整行缺失），
   *  由 calcAnomalyPoolInput 的 aliceSparkOverride 注入本轮资源结果。 */
  const aliceInfo = computed(() => {
    const slot = configStore.team.findIndex(c => c.agentId && (catalogStore.getAgent(c.agentId)?.id === '1401' || catalogStore.getAgent(c.agentId)?.teammateBuffId === '1401'))
    if (slot < 0) return null
    // ⚠ 按**身份**查（`.find(c => c.slot === …)`），不用 `characters[slot]` 下标：该数组按位置
    // 压缩（`buildCharConfig` 跳过空槽），前导/中间空槽时 `characters[slot]` 取到 undefined
    // ⇒ `aliceEnabled` 读不到 ⇒ 整个 aliceInfo 静默返回 null（畏缩 DOT 配置整块丢失）。
    const cfg = resourceConfig.value?.characters.find(c => c.slot === slot)
    if (!cfg?.aliceEnabled) return null
    return { slot, coweringConfig: { dotRatio: cfg.aliceCoweringDotRatio ?? 2.5, dotInterval: cfg.aliceCoweringDotInterval ?? 0.95, disorderBonusPerSec: cfg.aliceCoweringDisorderBonusPerSec ?? 18, disorderBonusMax: cfg.aliceCoweringDisorderBonusMax ?? 180, assaultBaseMultiplier: 853 } }
  })

  /** 构建积蓄池（参数化 stunCoverage + 异常 execs） */
  function calcAnomalyPoolInput(stunCov: number, execs: AnomalySkillExecution[], aliceSparkOverride?: number) {
    if (execs.length === 0) return null
    const wind = windInfo.value; const alice = aliceInfo.value
    const aliceSpark = aliceSparkOverride ?? 0
    return calcAnomalyPool({
      executions: execs, panels: panels.value,
      bossCoeff: configStore.enemy.anomalyCoeff, anomalyCoeff: configStore.enemy.bossAnomalyCoeff,
      enemyAnomalyResistances: configStore.enemy.anomalyResistances ?? configStore.enemy.resistances ?? {},
      totalTime: configStore.enemy.battleTime ?? 180, invincibleTime: configStore.enemy.invincibleTime,
      enemyDefense: configStore.enemy.defense, enemyDefReduction: 0,
      enemyResistances: configStore.enemy.damageResistances ?? configStore.enemy.resistances ?? {}, enemyResReduction: 0,
      stunned: stunCov, stunMultiplier: configStore.enemy.stunVuln,
      hasWindChar: wind.hasWindChar, windCharSlot: wind.windCharSlot,
      velinaCinema2CorrosionRate: configStore.getMechanicSetting('velina.cinema2CorrosionRate', 2 / 3),
      globalAnomalyMultiplier: remielleAnomalyMultiplier.value,
      aliceCoweringConfig: alice?.coweringConfig,
      giftedTriggerCounts: alice && aliceSpark > 0 ? { 'physical_polar_assault': aliceSpark } : undefined,
      giftedTriggerSlot: alice?.slot,
      agentMechanics: getRegisteredAgentMechanics(),
    })
  }

  /** 通用自动轴（用户口径：所有预设队伍都对应预设失衡轴，捏了轴就自动启用）：
   * 按槽位通配匹配 stunAxisPresets 命中即自动选用（章鱼体系按 命座 chapter × 有琉 选档）；
   * 手动配置过轴（条件方案或手动轴）时手动优先，自动让路。 */
  const autoPreset = computed(() => {
    if (!configStore.autoYidhariAxis) return null
    const ids = configStore.team.map(c => c.agentId)
    const cinemaBySlot: Record<number, number> = {}
    configStore.team.forEach((c, i) => { cinemaBySlot[i] = c.cinemaLevel ?? 0 })
    return selectAutoStunAxisPreset(ids, cinemaBySlot)
  })
  const autoActive = computed(() => {
    if (!autoPreset.value) return false
    return configStore.stunAxisPlans.length === 0 && configStore.stunAxes.length === 0
  })

  /** 解析当前轮生效的轴：手动条件轴方案 → 手动 stunAxes → 通用自动预设（按资源量自选） */
  function resolveAxes(stunCount: number, goodReview: number, energyBySlot: Record<number, number>): { axes: StunAxis[]; planName: string | null } {
    const cinemaBySlot: Record<number, number> = {}
    configStore.team.forEach((c, i) => { cinemaBySlot[i] = c.cinemaLevel ?? 0 })
    if (configStore.stunAxisPlans.length > 0) {
      const r = resolveStunAxisPlan(configStore.stunAxisPlans, { stunCount, goodReview, energyBySlot, cinemaBySlot })
      if (r) return { axes: r.axes, planName: r.plan.name }
    }
    if (configStore.stunAxes.length > 0) {
      return { axes: configStore.stunAxes, planName: null }
    }
    const auto = autoPreset.value
    if (auto) {
      if (auto.plans && auto.plans.length > 0) {
        const r = resolveStunAxisPlan(auto.plans, { stunCount, goodReview, energyBySlot, cinemaBySlot })
        if (r) return { axes: r.axes, planName: `${auto.name}·${r.plan.name}` }
      }
      if (auto.axes && auto.axes.length > 0) {
        return { axes: cloneStunAxes(auto.axes), planName: auto.name }
      }
    }
    return { axes: [], planName: null }
  }

  /** 把用户轴定义转换成栈遍历引擎的动作成本（含连段打包、转大不扣喧响、伊德海莉1命 60→50） */
  function buildStackAxes(axes: StunAxis[]): { actions: StackActionCost[]; count?: number; basicFillerSlot?: number }[] {
    return axes.map(axis => {
      const axisActions: StackActionCost[] = []
      // 60/90 转大块是琉音（1481）好评赠送终结技的专属机制：队伍无琉音时跳过（不当作普通轴动作执行，
      // 否则无琉音队伍也会打出 promoteVariant 块的终结技——2026-08 修复）
      const hasLiuyin = configStore.team.some(char => {
        const a = char.agentId ? catalogStore.getAgent(char.agentId) : null
        return a?.id === '1481' || a?.teammateBuffId === '1481'
      })
      for (const act of axis.actions) {
        if (act.promoteVariant && !hasLiuyin) continue
        // 诺姆转连携块（norma-hat-chain）与赠品连携块（怒焰·赠 sourceTag='gift'）：
        // 都标记「赠送连携吃失衡易伤」的轴内单位，不占目标自身连携次数/喧响。
        if (act.moveId === 'norma-hat-chain' || act.sourceTag === 'gift') {
          if (act.sourceTag === 'gift') {
            // 赠块 = 真实连携块：占失衡窗口时间（参与时间门控，超窗被跳过=不吃易伤），
            // 但不耗闪能/喧响；moveId 加 ':gift' 后缀独立计数，避免与普通连携块合并。
            const gSkills = catalogStore.getAgentSkills(configStore.team[act.slot]?.agentId ?? '')
            const gMove = findMoveById(gSkills, act.moveId)
            axisActions.push({ slot: act.slot, moveId: `${act.moveId}:gift`, count: act.count, actionTime: gMove?.actionTime ?? 0, energyCost: 0, decibelCost: 0, startTime: act.startTime ?? 0 })
          } else {
            // norma-hat-chain：纯标记块（0 时长，旧预设表达，无条件标记吃易伤次数）
            axisActions.push({ slot: act.slot, moveId: 'norma-hat-chain', count: act.count, actionTime: 0, energyCost: 0, decibelCost: 0, startTime: act.startTime ?? 0 })
          }
          continue
        }
        // 希格莉德破阵连段（连携命中失衡敌人后长按连放敛枪式一至三段）：
        // 展开成真实三段 id 进时间门控——窗内放得下几套就几套（超窗段被跳过=不吃易伤）；
        // C6 加快 25% → 块时长 ×0.75。免费（不耗闪能/喧响）。
        if (act.moveId === 'sigrid-pozhen') {
          const pzSkills = catalogStore.getAgentSkills(configStore.team[act.slot]?.agentId ?? '')
          const pzScale = (configStore.team[act.slot]?.cinemaLevel ?? 0) >= 6 ? 0.75 : 1
          for (const segId of SIGRID_LANCE_SEGMENT_IDS) {
            const segMove = findMoveById(pzSkills, segId)
            axisActions.push({ slot: act.slot, moveId: segId, count: act.count, actionTime: (segMove?.actionTime ?? 0) * pzScale, energyCost: 0, decibelCost: 0, startTime: act.startTime ?? 0 })
          }
          continue
        }
        const agentId = configStore.team[act.slot]?.agentId ?? ''
        const skills = catalogStore.getAgentSkills(agentId)
        const cinema = configStore.team[act.slot]?.cinemaLevel ?? 0
        const combo = getAgentMechanic(agentId)?.combos?.[act.moveId]
        let energyCost = 0
        let actionTime = 0
        let decibelCost = 0
        if (combo) {
          // 连段：能量按打包口径；1命单次 60→50
          energyCost = act.moveId === 'yidhari-heavy-single' && cinema >= 1 ? 50 : combo.energyCost
          for (const mv of combo.moves) {
            const m = findMoveById(skills, mv.moveId)
            actionTime += (m?.actionTime ?? 0) * mv.count
          }
        } else {
          const move = findMoveById(skills, act.moveId)
          const raw = move?.energyCost as Record<string, string> | undefined
          if (raw) {
            for (const k of Object.keys(raw)) {
              const n = parseFloat(raw[k])
              if (!Number.isNaN(n) && n > 0) { energyCost = n; break }
            }
          }
          // 轴块 duration 覆盖倍率表 actionTime（新机制：仪玄轴内凝云术可延长/缩短蓄力 0-2s）
          actionTime = typeof (act as { duration?: number }).duration === 'number'
            ? (act as { duration: number }).duration
            : (move?.actionTime ?? 0)
          // 终结技喧响消耗：读**本槽 cfg 的 ultimateCost**（角色口径，模块在 buildCharConfig
          // 里写自己那份，如佩洛伊斯 1551 = 2000），缺省回落全局默认 3000。
          // 2026-09-15 arch 棘轮：原为 `agentId === '1551' ? 2000 : 3000` 硬编码特判——
          // 而 `specPanelBuffs.ts:174` 早已写 `cfg.ultimateCost = PEILUO_ULT_COST`（2000），
          // 故该 agentId 判断**冗余**（判据同 T6：字段唯一写入方 = 该角色模块 ⇒ 不需要再认人）。
          decibelCost = resolveAxisUltimateDecibelCost(move?.name?.en, resourceConfig.value?.characters, act.slot)
          // 60/90 转大块是琉音好评赠送的终结技（白送，不耗目标喧响），只占窗口时间不扣喧响
          if (act.promoteVariant) decibelCost = 0
        }
        // 雨果强特终结一击（合成行 1291_ex_verdict_final）无倍率表条目：动作时长用模块常量兜底，
        // 保证窗口截断按「块结束时刻」而非「块起点」算剩余失衡时间。
        if (actionTime <= 0 && act.moveId === HUGO_EX_VERDICT_MOVE_ID) actionTime = HUGO_EX_FINAL_ACTION_TIME
        // 窗口终结（决算）：佩洛伊斯右分支 1551016；雨果强特终结一击(1291_ex_verdict_final) 永远结束失衡；
        // 雨果终结技本体(1291018) 仅 C0/C1 结束失衡——影画2「终结技决算不结束失衡」不截断窗口（0命2命区分）。
        const hugoCinema = configStore.team[act.slot]?.cinemaLevel ?? 0
        const endsWindow = act.moveId === '1551016'
          || act.moveId === HUGO_EX_VERDICT_MOVE_ID
          || (act.moveId === HUGO_ULT_MOVE_ID && hugoCinema < 2)
        axisActions.push({
          slot: act.slot,
          moveId: act.moveId,
          count: act.count,
          actionTime,
          energyCost,
          decibelCost,
          startTime: act.startTime ?? 0,
          // 佩洛伊斯右分支·永陷幽囚 / 雨果决算 = 决算：做完时清空窗口剩余失衡时间（填充归零+窗口截断）
          ...(endsWindow ? { endsStunWindow: true } : {}),
        })
      }
      return { actions: axisActions, count: axis.count, basicFillerSlot: axis.basicFillerSlot }
    })
  }

  /**
   * 把栈遍历 executed（轴动作块）展开成具体招式轴内单位数：
   * - 连段展开成内部招式（如 连段·双次 → 2×极寒重碾 + …）；
   * - 兜底平A填充按槽位映射（伊德海莉映射到蓄力循环的下砸+平A，其余映射到 basic 秒数）。
   */
  function expandExecutedToCounts(
    executed: Record<string, { slot: number; moveId: string; count: number }>,
    basicFillBySlot: Record<number, number>,
  ): Record<string, { slot: number; moveId: string; count: number }> {
    const out: Record<string, { slot: number; moveId: string; count: number }> = {}
    const add = (slot: number, moveId: string, count: number) => {
      if (count <= 0) return
      const key = `${slot}:${moveId}`
      const cur = out[key]
      if (cur) cur.count += count
      else out[key] = { slot, moveId, count }
    }
    for (const v of Object.values(executed)) {
      const agentId = configStore.team[v.slot]?.agentId ?? ''
      const combo = getAgentMechanic(agentId)?.combos?.[v.moveId]
      if (combo) {
        for (const mv of combo.moves) add(v.slot, mv.moveId, mv.count * v.count)
      } else {
        add(v.slot, v.moveId, v.count)
      }
    }
    for (const [slotStr, fillSec] of Object.entries(basicFillBySlot)) {
      const slot = Number(slotStr)
      const fillerAgentId = configStore.team[slot]?.agentId ?? ''
      if (fillerAgentId === '1051') {
        // 伊德海莉：basic_attack 已被改写为「蓄力烧血」（无伤害/失衡），兜底平A映射到蓄力循环的 下砸(1051007)+平A(1051003)
        const skills = catalogStore.getAgentSkills(fillerAgentId)
        const slam = findMoveById(skills, '1051007')
        const follow = findMoveById(skills, '1051003')
        const loopTime = 1 + (slam?.actionTime ?? 0) + (follow?.actionTime ?? 0)
        const loops = loopTime > 0 ? fillSec / loopTime : 0
        add(slot, '1051007', loops)
        add(slot, '1051003', loops)
      } else if (fillerAgentId === '1041') {
        // 「11号」可分配平A时间：普通火力镇压连打填充（全额时间；A45 快速循环已计入必要时间）。
        // 以 #4 为代表行按「火力镇压均值 × 时间」口径折算。
        const skills = catalogStore.getAgentSkills(fillerAgentId)
        const rep = findMoveById(skills, '1041008')
        const repT = rep?.actionTime ?? 1.828
        const reps = repT > 0 ? fillSec / repT : 0
        add(slot, '1041008', reps)
      } else {
        add(slot, 'basic', fillSec)
      }
    }
    return out
  }

  return {
    extractAnomalyExecsFrom, extractStunExecsFrom, autoPreset, autoActive,
    resolveAxes, buildStackAxes, expandExecutedToCounts, calcAnomalyPoolInput,
  }
}

/**
 * 轴内某动作的**终结技喧响消耗**（纯函数，导出供单测直接钉住）。
 *
 * 口径：只对「英文名含 `ultimate`」的招式收费（其余 0）；消耗取**本槽 cfg 的 `ultimateCost`**
 * （角色模块在 `buildCharConfig` 写自己那份，如佩洛伊斯 1551 = 2000），未设则回落全局默认 3000。
 *
 * 为什么抽出来（2026-09-15 arch 棘轮）：原实现是硬编码 `agentId === '1551' ? 2000 : 3000`，
 * 而 `specPanelBuffs.ts:174` 早已写 `cfg.ultimateCost = PEILUO_ULT_COST` ⇒ 该 agentId 判断**冗余**
 * （判据同 T6：字段唯一写入方 = 该角色模块）。抽纯函数是为了让「按**槽位**读、不是按 agentId 认人」
 * 这条口径**可被单测直接证伪**——只断言「配置里有 2000」是不够的（那是输入，不是被改的那行），
 * 必须断言解析结果**随槽位变化**（实测教训：第一版测试断言在输入上，反向验证时照样绿）。
 */
export function resolveAxisUltimateDecibelCost(
  moveEnName: unknown,
  chars: ReadonlyArray<{ ultimateCost?: number }> | undefined,
  slot: number,
): number {
  if (!String(moveEnName ?? '').toLowerCase().includes('ultimate')) return 0
  return chars?.[slot]?.ultimateCost ?? ULTIMATE_COST_DEFAULT
}

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
  applyLiuyinPromote,
  buildPromoteParams,
  promoteFixpoint,
} from './liuyinPromote'
import { applyNormaHatChain } from './normaHatChain'
import type { CalcRoundThreads } from './roundThreads'
import * as ResourceCalcHelpers from './helpers'
import { computeParrySplit } from '@/core/parrySplit'
import type { ParrySplitResult } from '@/core/parrySplit'
import { projectStunPlanForCounts } from '@/core/stunPlanProjection'
import { calcStunAxisStack, allocateAxisWindows } from '@/core/stunAxisStack'
import {
  computeBossAnomalyStateTimeline,
  computeInStunAnomalyTimeline,
  bossEntryAnomalyElement,
  type BossAnomalyStateResult,
  type InStunWindowInput,
} from '@/core/stunAxis/inStunAnomaly'
import { getBaseElement, BUILDUP_THRESHOLD_TABLE } from '@/core/anomalyPool/helpers'
import { calcSpecialActionBonus, PARRY_DECIBEL_BONUS } from '@/core/anomalyPool'
import { ULTIMATE_COST_DEFAULT, calcTeamResources } from '@/core/resource'
import { resolveUltimateTargetSlot } from '@/mechanics/agents/liuyin'
import { computeBanyueInteractionTopUp } from '@/mechanics/agents/banyue'
import type { BanyueInteractionTopUp } from '@/mechanics/agents/banyue'
import { isHugoEndsWindowMove, hugoMoveActionTime } from '@/mechanics/agents/hugo'
import { applyTeamMechanics, collectNextRoundFeedback, enrichExecutionPlan } from './helpers'

/** 保底 4 喧响的四舍五入阈值（自 useResourceCalc 顶层随迁；那里改为了 import） */
export const DECIBEL_ROUND_THRESHOLD = 1500
import { aliceExternalCountsOf, aliceSlotOf, aliceSparkCountOf } from '@/mechanics/agents/alice'
import { computeTeamVeilCountTotal } from '@/mechanics/teamVeil'


/** 单轮计算输出：下游 computed 消费的 13 字段 + 下一轮收敛线程 */
export interface CalcRoundResult {
    resourceResult: TeamResourceResult
    stunPool: StunPoolResult | null
    anomalyPool: AnomalyPoolResult | null
    adjustedResourceResult: TeamResourceResult | null
    promote: number
    stunCoverage: number
    resolvedAxes: StunAxis[]
    matchedPlanName: string | null
    banyueTopUp: BanyueInteractionTopUp
    parrySplit: ParrySplitResult
    inStunAnomalyState: InStunAnomalySummary | null
    bossAnomalyState: BossAnomalyStateResult | null
    threadsNext: CalcRoundThreads
  }

/**
 * 单轮计算本体（#10 收线刀，2026-09-12 自 `useResourceCalc.ts` 整体搬入 1180 行）。
 *
 * 侦察前提（ctx 设计两砖，见提交 4521a8c/d83b18b）：函数自由面 22 名**全部是稳定绑定**
 * （store 实例 / computed ref / 函数）——`useResourceCalc()` 内零个外层 let，跨轮可变量
 * 全走显式 `threads` 参数与 `threadsNext` 返回。故 lift 是机械搬：函数体**逐字节未动**
 * （保持 2 空格缩进，diff 可读作纯移动）；工厂形态避免模块级创建 computed 的单例泄漏。
 *
 * ⚠ 10 个下游 computed（resourceResult/adjustedResourceResult/...）作为 ref 注入：
 * runCalcRound 在 calcOutput 求值**中**读它们（懒求值，首读前都已初始化——调用点在
 * 最后一个依赖声明之后，装配序不变）。
 */
export function createRunCalcRound(deps: {
  configStore: ReturnType<typeof useConfigStore>
  catalogStore: ReturnType<typeof useCatalogStore>
  panels: ComputedRef<PanelValues[]>
  resourceConfig: ComputedRef<ResourceCalcConfig | null>
  resourceResult: { value: TeamResourceResult | null }
  adjustedResourceResult: { value: TeamResourceResult | null }
  inStunAnomalyState: { value: InStunAnomalySummary | null }
  bossAnomalyState: { value: BossAnomalyStateResult | null }
  stunCoverage: { value: number }
  matchedPlanName: { value: string | null }
  banyueInteractionTopUp: { value: { slot: number; parry: number; dual: number } | null }
  computeWindowDuration: () => number
  computeStunCoverage: (sp: unknown, lostSeconds?: number) => number
  windowDuration: { value: number }
  buildStackAxes: (axes: StunAxis[]) => { actions: import('@/core/stunAxisStack').StackActionCost[]; count?: number; basicFillerSlot?: number }[]
  expandExecutedToCounts: (executed: Record<string, { slot: number; moveId: string; count: number }>, basicFillBySlot: Record<number, number>) => Record<string, { slot: number; moveId: string; count: number }>
  resolveAxes: (stunCount: number, goodReview: number, energyBySlot: Record<number, number>) => { axes: StunAxis[]; planName: string | null }
  calcAnomalyPoolInput: (stunCov: number, execs: AnomalySkillExecution[], aliceSparkOverride?: number) => AnomalyPoolResult | null
  extractAnomalyExecsFrom: (res: TeamResourceResult, skipGift?: boolean) => AnomalySkillExecution[]
  extractStunExecsFrom: (res: TeamResourceResult, skipGift?: boolean) => StunSkillExecution[]
  autoActive: { value: boolean }
}) {
  const {
    configStore, catalogStore, panels, resourceConfig,
    computeWindowDuration, computeStunCoverage, buildStackAxes, expandExecutedToCounts,
    resolveAxes, calcAnomalyPoolInput, extractAnomalyExecsFrom, extractStunExecsFrom, autoActive,
  } = deps

  function runCalcRound(stunCount: number, threads: CalcRoundThreads, opts?: { forceNoAxis?: boolean; interactionScale?: number }): CalcRoundResult | null {
    const {
      goodReview: prevGoodReview,
      energyBySlot: prevEnergyBySlot,
      // 2026-09-16 round 14：`auricInkFlash` 也不再在此解构——仪玄 1371 整条分支已迁进
      // `yixuan.ts#applyYixuanTeamConfig`（该模块经 `threads` 契约自取，规则 6）。
      anomalyDecibelBonus: prevAnomalyDecibelBonus,
      banyueTopUp: prevBanyueTopUp,
      parrySplit: prevParrySplit,
      // `yixuanFuFaForJufufu` 同上：读点已迁进 1371 模块；2026-09-17 round 20 C-β 起
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
      // 2026-09-17 round 20 C-β 追加：`lighterTeamEnergy` 的产出侧也迁进 `lighter.ts` 的
      // `nextRoundFeedback`（仍在下方解构 = converge 相位要把它递给模块，见 `:901`）。
      lighterTeamEnergy: prevLighterTeamEnergy,
      aliceTeamAssaultCount: prevAliceTeamAssaultCount,
      aliceDisorderCount: prevAliceDisorderCount,
      // 2026-09-16 round 13：`inStunWindowTriggers` 也不再在此解构——它最后一个读点
      // （`:1414` 的 `prevInStunWindowTriggers <= 0` 守卫 + 对 `characters` 局部克隆的死写）
      // 已作为死写删除（判死依据见该处注释）；1511 模块经 `threads` 契约自取（round 12 批次 2）。
      teamVeilCountTotal: prevTeamVeilCountTotal,
      decibelParry: prevDecibelParry,
      decibelRegenBySlot: prevDecibelRegenBySlot,
      prevPoolStunCount,
    } = threads
    const base = resourceConfig.value
    if (!base || !catalogStore.ready) return null
    /**
     * **计数通道**用的失衡次数（C7 实验，见 `core/stunPlanProjection.ts`）。
     * `stunPlanProjection='off'` 时恒等于 `stunCount`（现行口径 0 delta）；打开则把计划值投影成整数，
     * **只影响把它当次数乘的地方**（连携/喧响/能量）。时间账与不动点迭代继续用实数的 `stunCount`。
     */
    const countStun = projectStunPlanForCounts(stunCount, base.stunPlanProjection ?? 'off')
    // 条件轴：按上一轮收敛出的好评/闪能（首轮缺省 → 条件方案未命中走兜底）解析生效轴
    const { axes: resolvedAxes, planName } = resolveAxes(stunCount, prevGoodReview, prevEnergyBySlot)
    // forceNoAxis（轴退化）：跳过轴注入（轴块/连携覆盖/自动补齐全关），退回 chainCountPerStun 兜底的一般循环
    const axisActive = !opts?.forceNoAxis && (configStore.useStunAxis || autoActive.value) && resolvedAxes.length > 0
    // 决算截断（佩洛伊斯右分支 1551016）：轴内决算做完时清空窗口剩余失衡时间 →
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
          // 佩洛伊斯右分支决算 + 雨果决算（强特终结永远 / 终结技仅 C0/C1）才截断窗口
          const isEnds = act.moveId === '1551016' || isHugoEndsWindowMove(act.moveId, cinema)
          if (!isEnds) continue
          const skills = catalogStore.getAgentSkills(configStore.team[act.slot]?.agentId ?? '')
          const move = findMoveById(skills, act.moveId)
          let dur = typeof (act as { duration?: number }).duration === 'number'
            ? (act as { duration: number }).duration
            : (move?.actionTime ?? 0)
          dur = hugoMoveActionTime(act.moveId, dur)
          truncEnd = Math.max(truncEnd, Math.max(0, act.startTime ?? 0) + dur)
        }
        if (truncEnd >= 0) verdictSecondsLost += Math.max(0, windowDur - truncEnd) * wins
      })
    }
    // 雨果轴模式剩余失衡时间 + 决算次数：从轴内块反推（合法轴：C2 = Q决算→E决算；E决算后再接 E 为非法轴，不建模）。
    // 剩余失衡时间覆盖滑块 hugo.remainingStunSeconds；决算次数覆盖滑块 exVerdictRatio/ultimateVerdictRatio。
    let hugoAxisRemainingStunSeconds: number | undefined
    let hugoAxisExVerdictCount: number | undefined
    let hugoAxisUltVerdictCount: number | undefined
    // @fact engine:轴内块数落地 口径: 雨果轴内决算次数 = 轴内决算块数 × **上一轮失衡池整数次数**（prevPoolStunCount 线程，与池/轴栈同源）；外层不动点的连续小数计划次数只作收敛输入，不得用于轴内块数（曾致 0.82 窗被 Math.floor 归零、轴栈说 5 池只落地 1，坑36） | 据 用户@2026-09-10「失衡易伤为什么静默不算」查证 + 引擎日志实测 0.824 | 验 src/composables/__tests__/hugoVerdictLanding.test.ts | 锚 src/composables/resourceCalc/convergence.ts#hugoAxisExVerdictCount | 信 确认
    if (axisActive && configStore.team.some(c => c.agentId === '1291')) {
      const windowDur = computeWindowDuration()
      // 坑36（2026-09-10 修复）：轴内块数落地必须与失衡池**同源**——外层不动点的计划次数是连续小数
      // （实测 0.824），池同轮算整数（floor）；对小数块数 Math.floor 后决算次数静默 0/1（轴栈 executed
      // 说 5、资源池只落地 1）。改读上一轮失衡池的整数次数（与其它线程同款滞后注入；首轮无池 → 0，
      // 收敛期稳定后与最终池一致；锁定次数路径池 = 锁定值不受影响）。
      const axisStunCount = prevPoolStunCount ?? 0
      const winAlloc = allocateAxisWindows(resolvedAxes, axisStunCount)
      let maxEnd = -1
      let exVerdictBlocks = 0
      let ultVerdictBlocks = 0
      resolvedAxes.forEach((axis, ai) => {
        const wins = winAlloc[ai] ?? 0
        if (wins <= 0) return
        for (const act of axis.actions) {
          const cinema = configStore.team[act.slot]?.cinemaLevel ?? 0
          if (act.moveId === HUGO_EX_VERDICT_MOVE_ID) exVerdictBlocks += (act.count ?? 1) * wins
          if (act.moveId === HUGO_ULT_MOVE_ID) ultVerdictBlocks += (act.count ?? 1) * wins
          if (!isHugoEndsWindowMove(act.moveId, cinema)) continue
          const skills = catalogStore.getAgentSkills(configStore.team[act.slot]?.agentId ?? '')
          const move = findMoveById(skills, act.moveId)
          let dur = typeof (act as { duration?: number }).duration === 'number'
            ? (act as { duration: number }).duration
            : (move?.actionTime ?? 0)
          dur = hugoMoveActionTime(act.moveId, dur)
          maxEnd = Math.max(maxEnd, Math.max(0, act.startTime ?? 0) + dur)
        }
      })
      if (maxEnd >= 0) hugoAxisRemainingStunSeconds = Math.max(0, Math.min(15, windowDur - maxEnd))
      hugoAxisExVerdictCount = exVerdictBlocks
      hugoAxisUltVerdictCount = ultVerdictBlocks
    }
    // 当前轮失衡覆盖率（供诺姆火力实验高爆/破甲按失衡时长拆分；与 computeStunCoverage 同口径，含决算截断）
    const provStunCoverage = computeStunCoverage({ stunCount }, verdictSecondsLost)
    // 般岳轴模式自动补齐（保底语义，方案 A）：轴内怒相/终结技对嗔火/喧响有硬性需求，不足时抬双反（补嗔火）与弹刀（补喧响），
    // 有效次数 = 交互栏输入 + 补齐量（不写回 store，不覆盖用户输入）；计算轮间通过 prevBanyueTopUp 线程收敛。
    const banyueSlot = configStore.team.findIndex(c => c.agentId === '1471')
    // Boss 预设弹刀反推（用户口径 2026-08）：appliedBoss 声明 parryTotal/parryNoFollowUpTotal（如 叶释渊 13 / 司祭 15）且
    // 「保底4失衡」勾选时，击破位（队伍首个 stun 特性槽位）弹刀按保底失衡反推补齐、主C 拿剩余
    // （纯函数 core/parrySplit.ts；本轮注入上一轮拆分，收敛判据含 parrySplitSeq）。
    // 不带支援突击弹刀（parryNoFollowUpTotal）**对半分**（用户口径 2026-09-10：「必须对半分；强制归击破位是错的，
    // 那是把补失衡误解成只有击破弹刀，删掉」）；只给喧响弹刀（parryDecibelOnlyTotal）走保底4喧响通道。
    const parryTotal = configStore.appliedBoss?.parryTotal ?? 0
    const parryNoFollowUpTotal = configStore.appliedBoss?.parryNoFollowUpTotal ?? 0
    const parryDecibelOnlyTotal = configStore.appliedBoss?.parryDecibelOnlyTotal ?? 0
    const guaranteeStun = configStore.getMechanicSetting('guarantee.stun', 0) !== 0
    const breakerSlot = configStore.team.findIndex(c => c?.agentId && catalogStore.getAgent(c.agentId)?.specialty === 'stun')
    // 无击破位队伍（如 仪玄/琉音/卢西娅：强攻/强攻/支援）：实战弹刀全由主C（槽位 0）承担
    // （归档 72db6dc3 弹刀 8 即此口径）——保底4失衡反推照常，但「剩余给主C」没有第二个角色可分，
    // 有效次数 = max(输入, 反推 T) 封顶 parryTotal（同位语义，2026-09-07）。
    const noBreakerFallback = breakerSlot < 0
    const effectiveBreakerSlot = breakerSlot >= 0 ? breakerSlot : 0
    const parrySplitActive = (parryTotal + parryNoFollowUpTotal + parryDecibelOnlyTotal) > 0 && guaranteeStun && (breakerSlot >= 0 || configStore.team.length > 0)
    const mainDpsSlot = breakerSlot === 0 ? -1 : 0
    // 保底开关（配装页「保底目标」勾选）：保底4嗔火 → 抬双反补嗔火；保底4喧响 → 抬弹刀补喧响。
    // 轴模式自动补齐（axisActive）之外，保底开关也可独立驱动（非轴亦生效）。
    const guaranteeFury = configStore.getMechanicSetting('guarantee.fury', 0) !== 0
    const guaranteeUltimate = configStore.getMechanicSetting('guarantee.ultimate', 0) !== 0
    const autoTopUp = (axisActive || guaranteeFury || guaranteeUltimate) && banyueSlot >= 0
      && configStore.getMechanicSetting('banyue.autoTopUpInteractions', 1) !== 0
    // 通用保底4喧响：喧响缺口 → 弹刀（任意队伍；般岳走上面的 computeBanyueInteractionTopUp，此处排除避免双计）。
    // 弹刀注入槽位 0（主C，弹刀喧响经伴随覆盖全队），轮间经 prevDecibelParry 线程收敛。
    const decibelParryActive = guaranteeUltimate && banyueSlot < 0

    /** 轴内某槽位捏的块次数（moveId → 总次数 = 块数 × 窗口数；赠品连携块不计） */
    const computeBanyueAxisExFor = (slot: number): Record<string, number> => {
      const out: Record<string, number> = {}
      if (!axisActive) return out
      const winAlloc = allocateAxisWindows(resolvedAxes, stunCount)
      resolvedAxes.forEach((axis, ai) => {
        const wins = winAlloc[ai] ?? 0
        for (const act of axis.actions) {
          if (act.slot !== slot) continue
          if (act.sourceTag === 'gift') continue // 赠品连携块是标记（不耗闪能/不占次数），不计入轴内强特
          out[act.moveId] = (out[act.moveId] ?? 0) + act.count * wins
        }
      })
      return out
    }

    /** 轴内某槽位终结技块总次数（× 窗口数），与 buildStackAxes 的终结技判定同口径（英文名含 ultimate 且非 chain attack） */
    const axisUltimateNeed = (axes: StunAxis[], stunCountN: number, slot: number): number => {
      const winAlloc = allocateAxisWindows(axes, stunCountN)
      let n = 0
      axes.forEach((axis, ai) => {
        const wins = winAlloc[ai] ?? 0
        for (const act of axis.actions) {
          if (act.slot !== slot || act.sourceTag === 'gift') continue
          const skills = catalogStore.getAgentSkills(configStore.team[slot]?.agentId ?? '')
          const mv = findMoveById(skills, act.moveId)
          const en = (mv?.name?.en ?? '').toLowerCase()
          if (en.includes('ultimate') && !en.includes('chain attack')) n += act.count * wins
        }
      })
      return n
    }

    // 有轴时：失衡送的连携次数从轴里连携块反推（chainCountPerStun 仅无轴兜底）。
    // 多条轴连携数可能不同（爆发轴 1 连携 / 末尾爆发轴 2 连携），须按各轴分配的窗口数加权求和，不能简单相加。
    const axisChainTotal: Record<number, number> = {}
    /** 轴内终结技块总次数（× 窗口数，与 axisUltimateNeed 同口径）：通用注入 cfg.axisUltimateTotal 供模块消费（希希芙影画2 等） */
    const axisUltimateTotal: Record<number, number> = {}
    if (axisActive) {
      const winAlloc = allocateAxisWindows(resolvedAxes, stunCount)
      resolvedAxes.forEach((axis, ai) => {
        const wins = winAlloc[ai] ?? 0
        for (const act of axis.actions) {
          // 赠送连携块（怒焰·赠，sourceTag='gift'）= 诺姆膛温换连携的轴内标记：不占目标自身连携次数
          if (act.sourceTag === 'gift') continue
          const skills = catalogStore.getAgentSkills(configStore.team[act.slot]?.agentId ?? '')
          const en = (findMoveById(skills, act.moveId)?.name?.en ?? '').toLowerCase()
          if (en.includes('chain attack') && !en.includes('ultimate')) {
            axisChainTotal[act.slot] = (axisChainTotal[act.slot] ?? 0) + act.count * wins
          }
          if (en.includes('ultimate') && !en.includes('chain attack')) {
            axisUltimateTotal[act.slot] = (axisUltimateTotal[act.slot] ?? 0) + act.count * wins
          }
        }
      })
    }
    // 有轴时：60/90 转大次数直接读轴里 promoteVariant 块（轴即最终次数），同样按窗口数加权
    let axisHug: { hug60: number; hug90: number } | null = null
    if (axisActive) {
      let h60 = 0; let h90 = 0
      const winAlloc = allocateAxisWindows(resolvedAxes, stunCount)
      resolvedAxes.forEach((axis, ai) => {
        const wins = winAlloc[ai] ?? 0
        for (const act of axis.actions) {
          if (act.promoteVariant === '60') h60 += act.count * wins
          else if (act.promoteVariant === '90') h90 += act.count * wins
        }
      })
      if (h60 > 0 || h90 > 0) axisHug = { hug60: h60, hug90: h90 }
    }
    // 轴模式琉音赠大计数（跨层口径统一，2026-09-10）：轴内 60/90 转大次数由轴预设决定，
    // core 的通用公式（好评/连携窗口推导）会算出另一个数 → 按窗口加权后注入，
    // 使试探测量/账本预留与轴栈窗口口径同源（见 core/resource.ts#liuyinGiftTime）。
    let axisLiuyinPromote: { targetSlot: number; count: number } | undefined
    if (axisActive && axisHug) {
      const liuyinIdx = configStore.team.findIndex(char => {
        const a = char.agentId ? catalogStore.getAgent(char.agentId) : null
        return a?.id === '1481' || a?.teammateBuffId === '1481'
      })
      if (liuyinIdx >= 0) {
        axisLiuyinPromote = {
          targetSlot: resolveUltimateTargetSlot(
            liuyinIdx, configStore.team.length,
            configStore.getMechanicSetting('liuyin.ultimateTargetSlot', -1),
          ),
          count: axisHug.hug60 + axisHug.hug90,
        }
      }
    }
    // 伊德海莉失衡内强特（`yidhariInStunEx` / `yidhariInStunEnergy`）的轴内连段反推已迁进
    // `yidhari.ts#applyYidhariTeamConfig`（round 13 批次 3）——模块自己按 `axis.axes × axis.windows`
    // 数 `yidhari-heavy-single` / `yidhari-heavy-double` 两个连段块，与本文件原先在此处的算法同源
    // （连段块 id 与成本档常量已回收进模块，规则 11 单一事实源）。
    // 轴内总时间（CD 自动动作用：仪玄C1落雷 6s / 卢西娅追击 8s 按轴内时间折算次数）
    const axisInSeconds = axisActive
      ? allocateAxisWindows(resolvedAxes, stunCount).reduce((a, b) => a + b, 0) * computeWindowDuration()
      : 0
    // 轴内合轴检测（2026-08-30，用户口径）：窗口内跨角色块并行（如般岳强特时琉音抱拳）只计一次前台。
    // 栈引擎按执行块区间并集算 overlap；前台净占用 = Σ物化前台行 − overlap，iterate 平A池吃进节省。
    // 固定轴的执行只取决于窗口数 + 时间门控（资源不足照样执行只记警告）→ 无需能量/喧响输入。
    let axisOverlapSeconds = 0
    let axisOverlapByAction: Record<string, number> = {}
    if (axisActive) {
      const overlapStack = calcStunAxisStack({
        axes: buildStackAxes(resolvedAxes),
        stunCount,
        windowDuration: computeWindowDuration(),
      })
      axisOverlapSeconds = overlapStack.overlapSeconds
      axisOverlapByAction = overlapStack.overlapByAction
    }
    // 轴内**实际执行**集合（资源门控后）= `axisActionCounts` / `axisUltimateTotal` 的**唯一来源**
    // （用户 2026-09-10 裁决「同一物理量只能有一份实现」）。资源用**上一轮**收敛值（与其它线程
    // 同款滞后注入）；首轮为空 = 门控放行全部，等价旧的「块数 × 窗口数」口径。
    let axisExecutedStack: ReturnType<typeof calcStunAxisStack> | null = null
    if (axisActive) {
      axisExecutedStack = calcStunAxisStack({
        axes: buildStackAxes(resolvedAxes),
        stunCount,
        windowDuration: computeWindowDuration(),
        energyBySlot: prevEnergyBySlot ?? {},
        decibelBySlot: prevDecibelRegenBySlot ?? {},
      })
      // 终结技总次数（供希希芙影画2 等）：按实际执行集合重算（含赠送块，与旧口径一致）
      for (const k of Object.keys(axisUltimateTotal)) delete axisUltimateTotal[Number(k)]
      const ultMoveOfSlot = new Map<number, string>()
      for (const c of base.characters) ultMoveOfSlot.set(c.slot, c.ultimateMoveId ?? '')
      for (const v of Object.values(axisExecutedStack.executed)) {
        if (ultMoveOfSlot.get(v.slot) === v.moveId) {
          axisUltimateTotal[v.slot] = (axisUltimateTotal[v.slot] ?? 0) + v.count
        }
      }
    }
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
      for (const c of base.characters) axisActionCountsBySlot[c.slot] = computeBanyueAxisExFor(c.slot)
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
        merged.parryCount = Math.round((merged.parryCount ?? 0) * iscale)
        merged.blockCount = Math.round((merged.blockCount ?? 0) * iscale)
        merged.dualCounterCount = Math.round((merged.dualCounterCount ?? 0) * iscale)
        merged.dodgeCounterCount = Math.round((merged.dodgeCounterCount ?? 0) * iscale)
      }
      // 后台合轴自动填充（模块 backstageAutoFill 声明驱动，上一轮反推值；手动字段 >0 时模块优先用手动）
      {
        const decl = getAgentMechanic(cfg.agentId)?.backstageAutoFill
        if (decl) (merged as any)[decl.cfgField] = threads.backstageAuto?.[cfg.agentId] ?? 0
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
          merged.parryCount = (merged.parryCount ?? 0) + xParryTotal
        } else if (!noBreakerFallback && cfg.slot === mainDpsSlot && mainDpsSlot >= 0 && mainDpsSlot !== breakerSlot) {
          merged.parryCount = (merged.parryCount ?? 0) + xParryTotal
          merged.parryTimeFreeCount = (merged.parryTimeFreeCount ?? 0) + xParryTotal
        }
      }
      // 通用保底4喧响：注入槽位 0 的「只给喧响」弹刀补齐量（上一轮收敛值；首轮 0）。
      // 走 parryDecibelOnlyCount 而非 parryCount：只计 215 喧响、不产轻弹刀/支援突击行、不贡献失衡值——
      // 保底4失衡的弹刀（含失衡值）由上方 parrySplit 独立反推，二者职责分离，避免弹刀↔失衡池的反馈环振荡。
      if (decibelParryActive && cfg.slot === 0) {
        merged.parryDecibelOnlyCount = (merged.parryDecibelOnlyCount ?? 0) + prevDecibelParry
      }
      // 2026-09-15 arch 棘轮：norva(1571)/qingyi(1251) 的失衡次数注入已迁进各自模块的
      // applyTeamConfig（converge 阶段读同一组 hook 入参 stunCount/combatTime，规则 6）。
      if (merged.agentId === '1291' && hugoAxisRemainingStunSeconds !== undefined) {
        // 雨果轴模式：决算剩余失衡时间 + 决算次数由轴内块反推（覆盖滑块）；非轴回落 buildCharConfig 的滑块值。
        // 次数口径：轴内 1291_ex_verdict_final 块 = 强特决算、轴内 1291018 块 = 终结技决算（合法轴 C2=Q→E；E→E 非法不建模）。
        // ⚠ 曾在此写 `hugoAxisActive: true`——2026-09-16 T26 批次 0a 判死并删除（全仓零读点，
        // 唯一「反射面」是 `core/resource.ts#sanitizeWarmKeyCfg` 的 JSON 序列化，但该字段是
        // `hugoAxisExVerdictCount` 是否存在的纯函数（只会是 `true`、只在本分支出现）⇒ 删它不改变
        // 热启动 key 的等价类划分，见 `.claude/task-card-round10-axis-context-contract.md` §10.1）。
        return {
          ...merged,
          hugoRemainingStunSeconds: hugoAxisRemainingStunSeconds,
          hugoAxisExVerdictCount: hugoAxisExVerdictCount ?? 0,
          hugoAxisUltVerdictCount: hugoAxisUltVerdictCount ?? 0,
        }
      }
    // 伊德海莉 1051 的 `yidhariStunCount` / `yidhariInStunExCount` / `yidhariInStunEnergyCost`
    // （轴内连段反推：单次碾 1 重碾/50-60 闪能、双次碾 2 重碾/85 闪能）已迁进 `yidhari.ts` 的
    // `applyTeamConfig`（round 13 批次 3）：前者读 `stunCount`（轴无关），后两者读下面 dispatch 的
    // `axis` 契约快照（`axis.axes × axis.windows` 现算，与原先在此处 `:661-681` 的算法逐位等价）。
    // ⚠ 迁移的**关键约束是条件写形态**：`yidhariInStunExCount` 只在 `axis.active && 合计>0` 时写
    // ——`core/resource/helpers.ts#resolveExSpecialCount` 用 `!== undefined` 选通路，恒写 0 会改语义
    // （详见模块钩子注释）。core 侧那两条「字段即蕴含角色」的守卫因此仍然成立。
      // 2026-09-15 arch 棘轮：佩洛伊斯(1551) 的 peiluoVerdictCount / extraSelfDecibelReward 注入
      // 已迁进 specPanelBuffs 的 peiluoProminenceMechanic.applyTeamConfig（规则 6）。
      if (merged.agentId === '1471') {
        // 般岳：轴内捏的强特/连段块 → 次数反馈给模块（先扣闪能，剩余自动补连段）；轴模式地动滑块归 0
        const banyueAxisEx = axisActionCountsBySlot[cfg.slot] ?? {}
        // 轴模式自动补齐（保底）：在用户输入之上补弹刀/双反，确保轴内怒相/终结技资源足够；
        // 只注入本轮 cfg（不写回 store），模块嗔火循环/执行计划用有效次数，资源卡片可展示补齐量
        const topUp = autoTopUp && cfg.slot === banyueSlot ? prevBanyueTopUp : { parry: 0, dual: 0 }
        // 轴模式：地动由轴内块决定 → 滑块归 0（不 shadow 非轴模式的滑块值）；
        // banyueAxisActive：轴内/轴外拆分（强特连段后摇：失衡外 = 闪能连段 + 轴内未覆盖怒相组≤2）用
        const banyueMerged = {
          ...merged,
          banyueAxisEx,
          banyueAxisActive: axisActive,
          ...(topUp.parry > 0 || topUp.dual > 0
            ? {
              parryCount: (merged.parryCount ?? 0) + topUp.parry,
              dualCounterCount: (merged.dualCounterCount ?? 0) + topUp.dual,
            }
            : {}),
          banyueInteractionTopUp: topUp,
        }
        return banyueMerged
      }
      // 仪玄 1371 的 8 个字段已整条迁进 `yixuan.ts#applyYixuanTeamConfig`（round 14 批次 4）：
      // 轴内量（`yixuanAxisEx`/`yixuanAxisCloudSeconds`/`yixuanAxisActive`/`yixuanC1LightningCount` 的轴臂）
      // 走 `axis` 契约、线程量（`yixuanAnomalyTriggerFlash`/`extraSelfDecibelReward` 的橘福福项）
      // 走 `threads` 契约、缺口量（`yixuanExtremeAssistCap` + `yixuanC1LightningCount` 非轴臂需要的
      // 有效战斗时间）走本轮新增的 `interactions` 契约（store 口径**未缩放**交互次数）。
      // ⚠ 迁移的地基是 round 13 的受控两臂实验：用 `characters` 上那份合并值（被 `interactionScale`
      // 缩放 / 被 `parrySplit` 改写）⇒ `yixuanSmoke` **9 failed**；按 store 口径递入 ⇒ **13 passed**。
      // 另：本文件原先那处 `if (ch.agentId === '1371')`（读上一轮 `rr.characters` 的执行行统计
      // 符法千重次数）已于 2026-09-17 round 20 C-β 迁进 `yixuan.ts#yixuanNextRoundFeedback`
      // （产出线程值 `yixuanFuFaForJufufu`）⇒ 本文件不再有该判据。
      // ⚠ 同批的「全队终结总次数」`teamUltimateForJufufu` **刻意留在本文件**（归属论证见其定义处）。
      // 莱卡恩 1141 的 `lycaonC2Energy`（分支的最后一个字段，**收尾批**）已于 2026-09-17
      // round 20 C-γ 迁进 `lycaon.ts#applyTeamConfig`：轴臂读 `axis.chainTotalBySlot`、
      // 非轴臂读本轮新增的 `countStun` 契约（C7 计数投影版失衡次数）+ `interactions` 契约的
      // `chainCountPerStun`（**store 原值**——`characters` 上那份被 `buildCharConfig` 写过
      // `?? (isSupport ? 0 : 1)` 兜底，store 默认 0 ⇒ 读 cfg 是静默改语义）。
      // ⇒ 该分支整段删除、**棘轮 −1**（40 → 39），本文件 `characters.map` 里不再有 1141 判据。
      // 沿革（逐字段迁出的批次）：`lycaonStunCount`/`lycaonTotalTime`/`lycaonInvincibleTime`
      // （T26 批次 0c）→ `lycaonWindowDuration`（round 12 批次 2，走 `axis`）→
      // `lycaonBackstageDodgeCount`（round 14 批次 4，走 `interactions`）→ `lycaonC2Energy`（本批）。
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
    // 队伍级机制·converge 阶段：带上一轮收敛量（莱特按上一轮全队能量消耗重算喷发回能；
    // 耀嘉音按失衡次数汇总全队连携入场）。各角色的具体口径在自己的模块里。
    applyTeamMechanics({
      characters,
      configStore,
      catalogStore,
      phase: 'converge',
      combatTime: base.totalTime ?? 180,
      stunCount,
      teamEnergyConsumed: Math.max(0, prevLighterTeamEnergy || 0),
      // 爱丽丝剑仪的两条外部次数源（上一轮异常池收敛值）：全队强击 = physical +
      // physical_polar_assault 两键之和；紊乱 = disorderCount。本模块的 applyTeamConfig
      // 在 converge 阶段把它们写进 cfg，供本轮 buildExecutions 产星芒圆舞曲行时消费。
      aliceTeamAssaultCount: prevAliceTeamAssaultCount,
      aliceDisorderCount: prevAliceDisorderCount,
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
        windows: allocateAxisWindows(resolvedAxes, stunCount),
        windowSeconds: computeWindowDuration(),
        actionCountsBySlot: axisActionCountsBySlot,
        ultimateTotalBySlot: axisUltimateTotal,
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
          parryCount: c.parryCount ?? 0,
          blockCount: c.blockCount ?? 0,
          dodgeCounterCount: c.dodgeCounterCount ?? 0,
          dualCounterCount: c.dualCounterCount ?? 0,
          quickAssistCount: c.quickAssistCount ?? 0,
          chainCountPerStun: c.chainCountPerStun ?? 0,
        }])),
      },
      // **计数投影版**失衡次数（round 20 C-γ 补的 C7 契约）：本函数 `:472` 已算好的
      // `countStun`（= `projectStunPlanForCounts(stunCount, base.stunPlanProjection ?? 'off')`）。
      // ⚠ 与 `stunCount` 在难度阶梯 G4（`round`）打开时**不等价**——原 `agentId === '1141'`
      // 分支的非轴臂用的正是这个投影值，故必须把**算好的结果**递进去，而不是让模块自己再算
      // （`stunPlanProjection` 不在模块可达面上，且注册成 MechanicSetting 会变产品级口径）。
      // 同样只有 converge 相位该传、同样**不做兜底**（模块侧双判据门控）。
      countStun,
    })
    // 特殊动作喧响奖励（弹刀215/闪反10/连携10/快支20，含伴随50%）：本轮即时结算——
    // 输入只有用户配置的次数与连携数（= chainCountTotalOverride ?? chainCountPerStun × stunCount），无 ultimateCount 反馈环
    const perSlotChainForBonus = [0, 0, 0]
    for (const cfg of characters) {
      perSlotChainForBonus[cfg.slot] = cfg.chainCountTotalOverride ?? (cfg.chainCountPerStun ?? 0) * countStun
    }
    // 弹刀喧响（215/次）用注入后的有效次数（含反推拆分 + 不带支援突击 + 只给喧响 + 般岳补齐；不写回 store）
    const parryForBonus = [0, 0, 0]
    for (const cfg of characters) parryForBonus[cfg.slot] = (cfg.parryCount ?? 0) + (cfg.parryNoFollowUpCount ?? 0) + (cfg.parryDecibelOnlyCount ?? 0)
    const { perSlotBonus: specialBonusPerSlot } = calcSpecialActionBonus(
      parryForBonus,
      perSlotChainForBonus,
      configStore.team.map(c => c.dodgeCounterCount ?? 0),
      configStore.team.map(c => c.quickAssistCount ?? 0),
    )
    // 异常/紊乱/乱流喧响奖励：上一轮异常池结果回填（首轮 0），在外层不动点内收敛
    const anomalyBonusPerSlot = configStore.team.map((_, s) => prevAnomalyDecibelBonus[s] ?? 0)

    const rr = enrichExecutionPlan(calcTeamResources({
      ...base,
      characters,
      stunCount,
      axisOverlapSeconds,
      axisOverlapByAction,
      ...(axisLiuyinPromote ? { axisLiuyinPromote } : {}),
      teamSize: configStore.team.length,
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
    // ② 仪玄符法千重分量 = `feedbackNext.yixuanFuFaForJufufu`（1371 模块产出）；
    //    1371 不在队 ⇒ 该键缺席 ⇒ `?? 0`，与原式 `fufa` 恒 0 等价。
    // ⚠ 两眼必须**同在 `rr` 上取**（同一次 `enrichExecutionPlan` 结果），且 ② 只能在派发器之后合并。
    let teamUltimateBaseNext = 0
    for (const ch of rr.characters) teamUltimateBaseNext += ch.ultimateCount ?? 0

    // 轴模式自动补齐下一轮量（保底）：嗔火缺口 → 双反；喧响缺口 → 弹刀。用 store 原始输入 + 本轮实际资源供给计算，
    // 外不动点收敛时 prevBanyueTopUp 稳定（round 0 无补齐 → 本轮算出的下一轮量即最终缺口）。
    let banyueTopUpNext = prevBanyueTopUp
    if (autoTopUp) {
      const storeChar = configStore.team[banyueSlot]
      const ultNeed = axisUltimateNeed(resolvedAxes, stunCount, banyueSlot)
      // 喧响供给取般岳个人（终结技次数 = 个人喧响 / 终结技消耗，非全队总和；曾用全队总和导致
      // 队友喧响把缺口抹平 → 保底4喧响不补齐、般岳卡在 9000 出头打不满 4 大）
      const decibelHave = rr.characters.find(c => c.slot === banyueSlot)?.decibelSource?.total ?? 0
      banyueTopUpNext = computeBanyueInteractionTopUp({
        dodgeCount: storeChar?.dodgeCounterCount ?? 0,
        parryCount: storeChar?.parryCount ?? 0,
        blockCount: storeChar?.blockCount ?? 0,
        dualCounterCount: storeChar?.dualCounterCount ?? 0,
        cinemaLevel: storeChar?.cinemaLevel ?? 0,
        axisEx: axisActionCountsBySlot[banyueSlot] ?? {},
        ultimateCountNeeded: Math.max(ultNeed, guaranteeUltimate ? 4 : 0),
        minRageCount: guaranteeFury ? 4 : 0,
        ultimateCost: base.characters.find(c => c.slot === banyueSlot)?.ultimateCost ?? ULTIMATE_COST_DEFAULT,
        decibelHave,
        // 单次补齐弹刀的原始动作时间 = 招架支援 + 支援突击（未扣合轴）：
        // 用来判「这次补齐是不是根本打不出来」（>200s = 非法，见 banyue.ts#AUTO_TOPUP_TIME_LIMIT_SEC）
        // ⚠ 按身份查（同 :1119；压缩数组下 `base.characters[banyueSlot]` 在空槽时会取错对象）
        perParrySeconds: (base.characters.find(c => c.slot === banyueSlot)?.defensiveAssistActionTime ?? 0)
          + (base.characters.find(c => c.slot === banyueSlot)?.assistFollowUpActionTime ?? 0),
      })
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
    if (decibelParryActive) {
      const mainDpsDecibel = rr.characters.find(c => c.slot === 0)?.decibelSource?.total ?? 0
      const decibelShort = Math.max(0, 4 * ULTIMATE_COST_DEFAULT - mainDpsDecibel)
      const roundable = decibelShort <= DECIBEL_ROUND_THRESHOLD
      if (roundable) {
        decibelParryNext = Math.max(prevDecibelParry, Math.ceil(decibelShort / PARRY_DECIBEL_BONUS))
      }
    }
    // 赠行由引擎物化 → rr 里已有赠行；池侧赠送口径单独结算，故基准提取跳过赠行（防双计）
    const baseStun = extractStunExecsFrom(rr, true)
    const baseAnomaly = extractAnomalyExecsFrom(rr, true)
    const p = buildPromoteParams(configStore, catalogStore, rr)
    if (baseStun.length === 0) return null
    const goodReview = rr.characters.find(c => c.liuyinMechanicSource)?.liuyinMechanicSource?.goodReviewTotal ?? -1
    const energyBySlot: Record<number, number> = {}
    for (const c of rr.characters) energyBySlot[c.slot] = c.energySource?.total ?? 0

    // 轴模式：转大完全由轴里的 promoteVariant 块决定（无块=0），不按好评/连携窗口自动推导
    const axisMode = axisActive

    // 失衡窗口内的失衡值不累积下一次失衡条：构建「轴内失效比例」提供者，供转大不动点内层计算有效失衡值。
    // 固定轴口径：资源不足只提示不跳过，因此 executed 只取决于窗口数 + 时间门控，与能量/喧响总量无关。
    let inAxisFractionProvider: ((stunCountN: number, execs: StunSkillExecution[]) => Record<string, number>) | undefined
    if (axisActive) {
      const stackAxes = buildStackAxes(resolvedAxes)
      const stackEnergyBySlot: Record<number, number> = {}
      const stackDecibelBySlot: Record<number, number> = {}
      const basicTimeBySlot: Record<number, number> = {}
      for (const c of rr.characters) {
        stackEnergyBySlot[c.slot] = c.energySource?.total ?? 0
        stackDecibelBySlot[c.slot] = c.decibelSource?.total ?? 0
        basicTimeBySlot[c.slot] = c.timeAllocation.basicAttackTime ?? 0
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
        for (const e of execs) {
          const lookKey = e.moveId === 'basic_attack' ? `${e.slot}:basic` : `${e.slot}:${e.moveId}`
          const inUnits = inAxisCounts[lookKey]?.count ?? 0
          const key = `${e.slot}:${e.moveId}`
          if (e.moveId === 'basic_attack') {
            const totalSec = basicTimeBySlot[e.slot] ?? 0
            fraction[key] = totalSec > 0 ? Math.max(0, Math.min(1, inUnits / totalSec)) : 0
          } else {
            fraction[key] = e.count > 0 ? Math.max(0, Math.min(1, inUnits / e.count)) : 0
          }
        }
        return fraction
      }
    }

    // 雨果决算失衡值返还：每次失衡结束返还 min(25%, 剩余秒×5%) × bossStunValue 进下一次失衡条。
    // 返还只由「结束失衡」的决算产生（C2 的 Q 不结束不返还），恒为每窗 1 次；剩余秒非轴取滑块（轴模式待接轴反推）。
    const hugoSlot = configStore.team.findIndex(c => c.agentId === '1291')
    const hugoHasVerdict = configStore.getMechanicSetting('hugo.exVerdictRatio', 1) > 0
      || configStore.getMechanicSetting('hugo.ultimateVerdictRatio', 1) > 0
    const hugoRefundRatio = hugoSlot >= 0 && hugoHasVerdict
      ? Math.min(0.25, Math.max(0, configStore.getMechanicSetting('hugo.remainingStunSeconds', 5)) * 0.05)
      : 0

    // debt: 轮换动作覆盖实数化——物化执行行少于实战动作序列（仪玄强特 11 vs 实战 15+、平A填充/
    // 闪反取职业基准），竖向字段（伤害/失衡/异常）已行级进账而横向动作覆盖无逐角色锚点。
    // 升级路径：实数化专项逐角色收口（弹刀反推/合轴自动填充同族手法），以归档对拍定每角色动作锚点。
    // Round 0：无易伤 → 畏缩覆盖率初算
    const sp0 = promoteFixpoint(baseStun, 0, p, axisHug, axisMode, { configStore, panels: panels.value }, inAxisFractionProvider, hugoRefundRatio)
    const adj0 = applyLiuyinPromote(rr, sp0, catalogStore)
    // 爱丽丝本轮剑意触发次数（极性强击赠送计数）：读本轮 rr 而非 aliceInfo（循环依赖，见 calcAnomalyPoolInput）
    const aliceSparkThisRound = aliceSparkCountOf(rr)
    const ap0 = calcAnomalyPoolInput(0, adj0 ? extractAnomalyExecsFrom(adj0) : baseAnomaly, aliceSparkThisRound)

    // Round 1：含易伤 → 畏缩覆盖率修正 → 最终收敛
    const flinch1 = ap0?.coverage?.physicalCoverageRate ?? 0
    const sp1 = promoteFixpoint(baseStun, flinch1, p, axisHug, axisMode, { configStore, panels: panels.value }, inAxisFractionProvider, hugoRefundRatio)

    // Boss 预设弹刀反推下一轮量（保底4失衡）：本轮失衡池（含注入的击破位弹刀）→ 非弹刀基数 → 缺口 → 补齐。
    // 击破位弹刀行（轻弹刀 + 支援突击，count 随弹刀次数缩放）：行贡献剔出非弹刀基数（防 0↔T 振荡），
    // 正常弹刀每次失衡 = 轻弹刀 + 支援突击；不带支援突击弹刀每次失衡 = 仅轻弹刀。无行 = 无招架失衡来源，不反推。
    let parrySplitNext = prevParrySplit ?? { breakerParry: 0, mainDpsParry: 0, breakerNoFollowUp: 0, mainDpsNoFollowUp: 0, topUp: 0, reached: false, perParryDaze: 0, perNoFollowUpDaze: 0 }
    let backstageAutoNext: Record<string, number> = threads.backstageAuto ?? {}
    if (parrySplitActive && sp1.pool) {
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
      const nonParryStun = Math.max(0, sp1.pool.totalStunBuildUp - injectedParryDaze - injectedMainDpsParryDaze + (sp1.pool.stunGift ?? 0))
      parrySplitNext = {
        ...computeParrySplit({
          targetStunCount: 4,
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
    // 缺口 = targetStunCount×bossStunValue −（总失衡 − 本轮已注入合轴行）；每对有效失衡优先实测
    //（声明 moveIds 的池行），首轮回落 perPairBase；供给上限 = floor(非该角色战斗时间 / minPeriodSeconds)。
    {
      const backstageNext: Record<string, number> = {}
      for (const cfg of base.characters) {
        const decl = getAgentMechanic(cfg.agentId)?.backstageAutoFill
        if (!decl) continue
        const manual = Math.max(0, Math.floor(Number((cfg as any)[decl.manualField] ?? 0)))
        if (manual > 0) { backstageNext[cfg.agentId] = manual; continue }
        const ownRows = (sp1.pool?.contributions ?? []).filter(r => decl.moveIds.includes(String(r.moveId)) && r.slot === cfg.slot)
        const ownDaze = ownRows.reduce((sum, r) => sum + r.effectiveStun, 0)
        const pairRows = ownRows.filter(r => decl.moveIds.slice(0, 2).includes(String(r.moveId)))
        const pairCount = pairRows.reduce((sum, r) => sum + (r.count ?? 0), 0)
        const perPair = pairCount > 0 ? ownDaze / pairCount : decl.perPairBase
        const pool = sp1.pool
        const deficit = pool
          ? Math.max(0, 4 * pool.bossStunValue - (pool.totalStunBuildUp - ownDaze))
          : 0
        const ownField = rr.characters.find(c => c.slot === cfg.slot)
        const ownFieldTime = (ownField?.timeAllocation?.necessaryTime ?? 0) + (ownField?.timeAllocation?.basicAttackTime ?? 0)
        const supplyCap = Math.max(0, Math.floor(Math.max(0, (base.totalTime ?? 180) - ownFieldTime) / decl.minPeriodSeconds))
        // ×1.2 冗余：池的净失衡缩放 + 一轮滞后会吃掉部分注入（实测 18 对只涨 3.85×），
        // 保底语义 = 至少打满，允许轻微过冲
        backstageNext[cfg.agentId] = Math.min(supplyCap, Math.ceil((deficit / Math.max(1, perPair)) * 1.2))
      }
      backstageAutoNext = backstageNext
    }

    const adj1 = applyLiuyinPromote(rr, sp1, catalogStore)
    // 诺姆膛温换连携：帽子把戏触发上一位角色快速支援→替换为连携，连携归属上一位队友；C4 时诺姆+队友各 200 不可分享喧响。
    const adj2 = applyNormaHatChain(adj1 ?? rr, configStore, catalogStore)
    // 展示层：resourceResult 也带上诺姆赠送连携（执行计划/次数在资源利用率页可见），
    // 不动点/失衡池仍用原始 rr（baseStun），避免赠送连携失衡反作用于转大收敛。
    // 琉音好评转大同样并入展示层（转大=目标队友真实打一次终结技，时间表/资源页应能看见耗时——
    // 曾只进 adjustedResourceResult（伤害池）导致时间表看不到转大耗时，用户 2026-09 般琉卢排查；
    // 时间从目标平A池挤出，总前台守恒，不撑破预算）。
    const rrShown0 = applyLiuyinPromote(rr, sp1, catalogStore) ?? rr
    // 展示口径归一：赠送行（诺姆赠链 / 琉音赠大，含轴模式 post-hoc carve 路径）在装配后追加，
    // 引擎 timeAllocation 看不到 → 按**最终行**重算前台/后台（单一展示口径，见 normalizeDisplayTime）
    const rrShown = ResourceCalcHelpers.normalizeDisplayTime(
      applyNormaHatChain(rrShown0, configStore, catalogStore) ?? rrShown0)

    const cov1 = computeStunCoverage(sp1.pool, verdictSecondsLost)
    const ap1 = calcAnomalyPoolInput(cov1, adj2 ? extractAnomalyExecsFrom(adj2) : baseAnomaly, aliceSparkThisRound)

    // 「下一轮反馈」统一派发（2026-09-16 arch 棘轮第 6 批）：普罗米娅(1541)/零号·安比(1381)/
    // 露西(1151)/薇薇安(1331)/艾莲(1191) 的算法已迁进各自模块的 `nextRoundFeedback` 钩子
    // （规则 6：编排层不认人）。编排层只调一次通用派发器，模块按需读本轮结果 + 上一轮线程快照，
    // 返回下一轮线程值；下方 merge 进 threadsNext。
    // ⚠ 派发点必须在 ap1 之后（钩子入参含异常池）。迁移前安比那处在 ap1 之前，但两者既不读对方
    // 写的 cfg 字段、也无其它共享可变状态（钩子之间彼此独立）⇒ 合并为一次派发逐位等价。
    // 2026-09-17 C-α 批：叶瞬光(1431)/格莉丝(1181) 也迁入该派发，编排层只 merge。
    // 2026-09-17 round 20 C-β 批：仪玄(1371) 的 `yixuanFuFaForJufufu` 与莱特(1161) 的
    // `lighterTeamEnergy` 同样迁入；橘福福的「全队终结总次数」因与队伍组成无关仍留编排层。
    const feedbackNext = collectNextRoundFeedback({
      characters,
      teamResult: rr,
      displayResult: rrShown,
      adjustedResult: adj2,
      anomalyPool: ap1,
      prevThreads: threads,
      catalogStore,
      combatTime: base.totalTime ?? 180,
    })

    // 队伍级机制·postRound 阶段：本轮次数已收敛 → 为下一轮注入派生量。
    // `lighterTeamEnergy` 的**计算与写 cfg** 都已回到莱特模块自己的 `applyTeamConfig`（postRound）
    // 与 `nextRoundFeedback`（返回值 → threadsNext），编排层只 merge。
    let teamVeilCountTotalNext = 0
    {
      const exByAgent = new Map(rr.characters.map(ch => [ch.agentId, ch.exSpecialCount ?? 0]))
      const ultByAgent = new Map(rr.characters.map(ch => [ch.agentId, ch.ultimateCount ?? 0]))
      const exCounts = characters.map(c => Math.max(0, exByAgent.get(c.agentId) ?? 0))
      const ultimateCounts = characters.map(c => Math.max(0, ultByAgent.get(c.agentId) ?? 0))
      // 2026-09-17 round 20 C-β：莱特全队能量消耗的 `if (characters.some(c => c.agentId === '1161'))`
      // 守卫 + 估计式已迁进 `lighter.ts#lighterNextRoundFeedback`（派发器只对在队模块派发 ⇒ 守卫
      // 自然满足；估计式同一入参口径，见该钩子注释的逐位等价论证）。
      // 全队帷幕次数（下一轮注入）：照霜寒开帷幕 + 爱芮/叶瞬光终结技 + 千夏强特，按本轮收敛次数算。
      teamVeilCountTotalNext = computeTeamVeilCountTotal(characters, exCounts, ultimateCounts, base.totalTime ?? 180)
      applyTeamMechanics({
        characters,
        configStore,
        catalogStore,
        phase: 'postRound',
        combatTime: base.totalTime ?? 180,
        exCounts,
        ultimateCounts,
        stunCount,
      })
    }

    // 爱丽丝剑仪外部次数源（下一轮注入）：口径在模块里（规则 6：编排层不写角色规则）
    const aliceExternalCounts = aliceExternalCountsOf(ap1, aliceSlotOf(rr))
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
      for (const prog of ap1?.perElement ?? []) {
        for (const c of prog.contributions ?? []) contribMap.set(c.moveId, { element: prog.element, perHit: c.perHitBuildUp })
      }
      if (contribMap.size > 0) {
        // 单次失衡表达（v3.2 用户裁决）：每条生效轴条目模拟一个代表窗；该段打几次由
        // 「失衡次数」统计表达，不再逐窗展开、也无跨窗继承（窗口外未建模）。
        const winAlloc = allocateAxisWindows(resolvedAxes, Math.round(stunCount))
        const thresholdCoeff = (configStore.enemy.anomalyCoeff ?? 1) * (configStore.enemy.bossAnomalyCoeff ?? 1)
        const windows: InStunWindowInput[] = []
        const windowEntryIdx: number[] = []
        resolvedAxes.forEach((axis, ai) => {
          const wins = Math.floor(winAlloc[ai] ?? 0)
          if (wins <= 0) return
          const actions = (axis.actions ?? [])
            .map((a, srcIndex) => ({ a, srcIndex }))
            .filter(({ a }) => contribMap.has(a.moveId))
            .map(({ a, srcIndex }) => {
              const cm = contribMap.get(a.moveId)!
              // 动作时长：显式 duration（仪玄蓄力）优先，否则技能表 actionTime——
              // 触发事件附着在动作结束点（用户口径），瞬发块才落在起点
              const skills = catalogStore.getAgentSkills(configStore.team[a.slot]?.agentId ?? '')
              const move = findMoveById(skills, a.moveId)
              const duration = typeof (a as { duration?: number }).duration === 'number'
                ? (a as { duration: number }).duration
                : (move?.actionTime ?? 0)
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
          stunsTotal: Math.max(1, Math.round(stunCount)),
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
      stunCoverage: cov1,
      // 轴退化时生效轴 = 无（诚实反映：轴定义仍解析，但没有注入计算）
      resolvedAxes: opts?.forceNoAxis ? [] : resolvedAxes,
      matchedPlanName: opts?.forceNoAxis ? null : planName,
      banyueTopUp: banyueTopUpNext,
      parrySplit: parrySplitNext,
      inStunAnomalyState: inStunAnomalyStateNext,
      bossAnomalyState: bossAnomalyStateNext,
      threadsNext: {
        goodReview,
        energyBySlot,
        auricInkFlash: ap1?.perElement?.find(p => p.element === 'ether_ink')?.triggerCount ?? 0,
        anomalyDecibelBonus: [],
        banyueTopUp: banyueTopUpNext,
        parrySplit: parrySplitNext,
        backstageAuto: backstageAutoNext,
        yixuanFuFaForJufufu: feedbackNext.yixuanFuFaForJufufu ?? 0,
        // ② 符法千重分量（1371 模块产出）：原式是循环内对 1371 那一次 `teamUlt += fufa`；
        // 1371 不在队 ⇒ 该键缺席 ⇒ `?? 0`（原式 `fufa` 恒 0）。
        teamUltimateForJufufu: teamUltimateBaseNext + (feedbackNext.yixuanFuFaForJufufu ?? 0),
        yeshuguangGiftUlt: feedbackNext.yeshuguangGiftUlt ?? 0,
        // 「下一轮反馈」线程：由各模块 nextRoundFeedback 钩子算出（缺省 0 = 该角色不在队
        // 或守卫不成立，与迁移前各函数返回 0 逐位等价；露西无守卫恒写）。
        // ⚠ 例外 = `teamUltimateForJufufu`（上一行）：全队汇总、与队伍组成无关，刻意留编排层。
        lucyTeammateEx: feedbackNext.lucyTeammateEx ?? 0,
        lighterTeamEnergy: feedbackNext.lighterTeamEnergy ?? 0,
        graceC1Cycles: feedbackNext.graceC1Cycles ?? 0,
        anbyZeroTeammateWl: feedbackNext.anbyZeroTeammateWl ?? 0,
        vivianTeamEx: feedbackNext.vivianTeamEx ?? 0,
        vivianAnomalyTriggers: feedbackNext.vivianAnomalyTriggers ?? 0,
        promiaTriggerHits: feedbackNext.promiaTriggerHits ?? 0,
        promiaTeammateReleases: feedbackNext.promiaTeammateReleases ?? 0,
        promiaReleaseDecibel: feedbackNext.promiaReleaseDecibel ?? 0,
        // 爱丽丝剑仪外部次数源（下一轮注入）：口径全部收敛在 aliceExternalCountsOf 里
        // （只算 physical 且只算爱丽丝自己触发的部分、紊乱带额外能力门控），此处不重写规则。
        aliceTeamAssaultCount: aliceExternalCounts?.assaultCount ?? 0,
        aliceDisorderCount: aliceExternalCounts?.disorderCount ?? 0,
        inStunWindowTriggers: inStunWindowTriggersNext,
        ellenFreezeCount: feedbackNext.ellenFreezeCount ?? 0,
        teamVeilCountTotal: teamVeilCountTotalNext,
        decibelParry: decibelParryNext,
        // 轨推演输入（喧响产出）单调不减：轨削减大招 → 大招回响数据行减少 → 产出下滑
        // → 下一轮轨更紧 → 恶性循环（实测可螺旋到 0）。取 max(上一轮, 本轮) 锁定基准。
        decibelRegenBySlot: Object.fromEntries(
          rr.characters.map(c => [c.slot, Math.max(
            prevDecibelRegenBySlot?.[c.slot] ?? 0,
            c.decibelSource?.total ?? 0,
          )]),
        ),
        // 轨的失衡次数收敛线程：与本轮 stunCount 相等才启用轨（防早期轮窗口失真螺旋）
        trackStunCount: sp1.pool?.stunCount ?? 0,
        // 上一轮失衡池整数次数：轴内块数落地（雨果决算 坑36）与池同源的滞后注入
        prevPoolStunCount: sp1.pool?.stunCount ?? 0,
      },
    }
  }

  return runCalcRound
}
