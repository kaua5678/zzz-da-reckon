import { HUGO_EX_VERDICT_MOVE_ID, HUGO_ULT_MOVE_ID, HUGO_EX_FINAL_ACTION_TIME, isHugoEndsWindowMove, hugoMoveActionTime } from '@/mechanics/agents/hugo'
import { inferSkillDamageTarget } from '@/core/damage'
import { estimateTeamNormalEnergyConsumed } from '@/mechanics/agents/lighter'
import { computeTeamVeilCountTotal } from '@/mechanics/teamVeil'
import { computed } from 'vue'
import { useConfigStore } from '@/stores/config'
import { useCatalogStore } from '@/stores/catalog'
import {
  calcTeamResources,
  ULTIMATE_COST_DEFAULT,
} from '@/core/resource'
import type { StunSkillExecution } from '@/core/stunPool'
import { computeParrySplit } from '@/core/parrySplit'
import type { ParrySplitResult } from '@/core/parrySplit'
import { calcStunAxis } from '@/core/stunAxis'
import { simulateDecibelTrack } from '@/core/resourceTrack'
import type { InStunAnomalySummary } from '@/types/resource'
import type { StunAxis } from '@/types/resource'
import { netFrontlineOccupation } from '@/core/resource/helpers'
import { calcStunAxisStack, allocateAxisWindows } from '@/core/stunAxisStack'
import type { StackActionCost } from '@/core/stunAxisStack'
import { resolveStunAxisPlan, selectAutoStunAxisPreset, cloneStunAxes } from '@/data/stunAxisPresets'
import { calcAnomalyPool, calcSpecialActionBonus, PARRY_DECIBEL_BONUS } from '@/core/anomalyPool'
import { getBaseElement, BUILDUP_THRESHOLD_TABLE } from '@/core/anomalyPool/helpers'
import { computeBossAnomalyStateTimeline, computeInStunAnomalyTimeline, bossEntryAnomalyElement, type BossAnomalyStateResult, type InStunWindowInput } from '@/core/stunAxis/inStunAnomaly'
import type { AnomalySkillExecution } from '@/core/anomalyPool'
import { getAgentMechanic, getRegisteredAgentMechanics } from '@/mechanics'
import { applyLiuyinPromote, buildPromoteParams, promoteFixpoint } from './resourceCalc/liuyinPromote'
import { applyNormaHatChain } from './resourceCalc/normaHatChain'
import { initialCalcRoundThreads, threadsAfterNullRound, type CalcRoundThreads } from './resourceCalc/roundThreads'
import { buildDamagePoolRows } from './resourceCalc/damagePool'
import { computeLuciaHealPctPerUlt } from '@/mechanics/agents/luciaElowen'
import { computeBanyueMingwangStacks, computeBanyueInteractionTopUp } from '@/mechanics/agents/banyue'
import type { BanyueInteractionTopUp } from '@/mechanics/agents/banyue'
import { computeCorinStunBonusMoves } from '@/mechanics/agents/corin'
import { aliceSparkCountOf } from '@/mechanics/agents/alice'
import { SIGRID_LANCE_SEGMENT_IDS } from '@/mechanics/agents/sigrid'
import { computeYixuanNingshenBonus } from '@/mechanics/agents/yixuan'
import { computePeiluoKagerouBonus } from '@/mechanics/agents/specPanelBuffs'
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
/** 保底4喧响的四舍五入阈值（喧响值）：缺口 ≤ 此值补弹刀够下一次大招，超过则放弃（实战打不出） */
export const DECIBEL_ROUND_THRESHOLD = 1500

/**
 * 时间轴喧响轨推演（对轴模块，用户口径 2026-08-31）：
 * 窗口时序按「有效时间均分给 N 次失衡」估位（每窗起点 = 轮转间隔 × 序号），
 * 每槽用 simulateDecibelTrack 推演实际可放大招数（进窗不够 3000 削减）。
 * regenBySlot = 上一轮收敛的每槽喧响产出（首轮 0 → 全部削减？不——首轮回落总量口径，
 * 用 -1 标记未注入）；initialGift 读 cfg.initialDecibelGift（进场赠送）。
 */
function computeAxisUltimateTrack(
  characters: { slot: number; agentId: string; initialDecibelGift?: number }[],
  stunCount: number,
  windowDuration: number,
  effectiveTime: number,
  regenBySlot: Record<number, number> | undefined,
  prevStunCount?: number,
): Record<number, number> {
  const track: Record<number, number> = {}
  if (!regenBySlot) return track // 首轮无收敛数据 → 不注入（回落总量口径）
  // 失衡次数未收敛稳定前不启用轨：早期轮 stunCount 偏小（如轮2=1）→ 窗口估位失真 →
  // 轨把大招砍光 → 外层提前判稳，stunCount 涨不回来（实测比琉队螺旋到 0）。
  // 窗口数取「上一轮收敛且与本轮一致」的 stunCount；首轮后未稳定 → 回落总量口径。
  if (typeof prevStunCount !== 'number' || prevStunCount !== stunCount) return track
  const wins = Math.max(1, Math.floor(stunCount))
  // 窗口间隔 = 有效时间 ÷ 失衡次数（含窗口本身；窗口起点均布）
  const interval = effectiveTime / wins
  const windows = Array.from({ length: wins }, (_, i) => ({
    start: Math.min(effectiveTime - windowDuration, i * interval),
    duration: windowDuration,
  }))
  for (const cfg of characters) {
    const regen = Math.max(0, regenBySlot[cfg.slot] ?? 0)
    // 回复总量口径 = 上一轮整局喧响产出 − 进场赠送（赠送走 initial，t=0 即有）
    const initial = Math.min(3000, Math.max(0, cfg.initialDecibelGift ?? 0))
    const result = simulateDecibelTrack(windows, Math.max(0, regen - initial), effectiveTime, initial)
    // 双保险：轨值 ≤ 总量口径（floor(总喧响/3000)）——轨只削「时间不够攒」的虚高，
    // 不引入新的产出螺旋（regen 单调见 threads 写入处）
    const totalBasis = Math.floor((regen + initial) / 3000)
    track[cfg.slot] = Math.min(result.ultimateCount, totalBasis)
  }
  return track
}

const { computePanel, computeRemielleEntryPanel, getTeamAnomalyDurationBonus, getWindInfectionCoverage, elementLabel, remielleSpecialVoidflareCount, findMoveById, enrichExecutionPlan, buildCharConfig, extractSkillExecutions, applyTeamMechanics, buildAnomalyVirtualPanel } = ResourceCalcHelpers
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
    applyTeamMechanics({ characters, configStore, catalogStore, phase: 'build' })

    // 橘福福额外能力·八面威风：队伍有强攻/命破时，这些角色每次终结技 +300 喧响
    // （仪玄青溟云影走 ultimateCount；符法千重在收敛环用上一轮次数注入，见下方 1371 分支）。
    const jufufuCfg = characters.find(cfg => cfg.agentId === '1391')
    const jufufuAA = Boolean(jufufuCfg && (jufufuCfg.panel?.additionalAbilityActive ?? 0) > 0)
    if (jufufuAA) {
      for (const cfg of characters) {
        const agent = catalogStore.getAgent(cfg.agentId)
        if (agent?.specialty === 'attack' || agent?.specialty === 'rupture') {
          cfg.extraSelfDecibelPerUltimate = 300
        }
      }
    }

    // 卢西娅4命：帷幕开启/延长（含伊德海莉大招开帷幕）→ 全队每人 +100 喧响；触发次数按梦境轴 + 15s CD 封顶 × 利用率滑块
    const luciaCfg = characters.find(cfg => cfg.agentId === '1451')
    if (luciaCfg) {
      const luciaCinema = configStore.team[luciaCfg.slot]?.cinemaLevel ?? 0
      if (luciaCinema >= 4) {
        const coverage = Math.max(0, Math.min(1, configStore.getMechanicSetting('lucia.c4CurtainCoverage', 1)))
        for (const cfg of characters) {
          cfg.luciaC4DecibelPerTrigger = 100
          cfg.luciaC4CurtainCoverage = coverage
        }
      }
      // 星光汇聚之地回血：终结技等级公式（12级 12.8%/大）× 覆盖滑块 → 换算成伊德海莉自身生命%喂给烧血→喧响（仅伊德海莉在队时）
      const yidhariCfg = characters.find(cfg => cfg.agentId === '1051')
      if (yidhariCfg) {
        const healPctPerUlt = computeLuciaHealPctPerUlt(luciaCfg.panel.skillLevelBonus ?? 0)
        const coverage = Math.max(0, Math.min(1, configStore.getMechanicSetting('lucia.healingCoverage', 0.5)))
        const luciaHp = Math.max(1, luciaCfg.panel.hp ?? 0)
        const yidhariHp = Math.max(1, yidhariCfg.panel.hp ?? 0)
        yidhariCfg.yidhariExternalHealPerUltPct = healPctPerUlt * coverage * (luciaHp / yidhariHp)
      }
    }

    if (characters.length === 0) return null

    return {
      totalTime: configStore.enemy.battleTime ?? 180,
      invincibleTime: configStore.enemy.invincibleTime ?? 0,
      bossStunValue: configStore.enemy.stunValue,
      shieldCount: configStore.enemy.shieldCount,
      energyShieldCount: configStore.enemy.energyShield,
      maxIterations: 20,
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

/** 从某个资源池结果提取异常 execs（参数化） */
  function extractAnomalyExecsFrom(res: TeamResourceResult): AnomalySkillExecution[] {
    const execs: AnomalySkillExecution[] = []
    for (let i = 0; i < 3; i++) {
      const char = configStore.team[i]
      if (!char?.agentId) continue
      const skills = catalogStore.getAgentSkills(char.agentId)
      const { anomalyExecs } = extractSkillExecutions(i, char.agentId, skills ?? undefined, res, catalogStore, panels.value[i] ?? null, configStore)
      execs.push(...anomalyExecs)
    }
    return execs
  }

  /** 从某个资源池结果提取失衡 execs（参数化） */
  function extractStunExecsFrom(res: TeamResourceResult): StunSkillExecution[] {
    const execs: StunSkillExecution[] = []
    for (let i = 0; i < 3; i++) {
      const char = configStore.team[i]
      if (!char?.agentId) continue
      const skills = catalogStore.getAgentSkills(char.agentId)
      const { stunExecs } = extractSkillExecutions(i, char.agentId, skills ?? undefined, res, catalogStore, panels.value[i] ?? null, configStore)
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
    const cfg = resourceConfig.value?.characters[slot]
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

  /**
   * 单轮计算：给定失衡次数输入，重算资源池（连携 = 每失衡连携数 × 失衡次数）→ 转大不动点 → 失衡池 → 易伤覆盖率 → 异常池。
   * 抱拳→转大因果链：抱拳（客诉）命中后检查好评≥90 打开大招选择窗口；60 需目标队友有连携窗口（替换连携），90 直接打出大招。
   */
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
          // 佩洛伊斯分支大招 2000 喧响/次（角色口径）；其余终结技 3000
          decibelCost = (move?.name?.en ?? '').toLowerCase().includes('ultimate') ? (agentId === '1551' ? 2000 : 3000) : 0
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

  /**
   * 单轮计算：给定失衡次数输入与上一轮收敛线程，重算资源池（连携 = 每失衡连携数 × 失衡次数）→
   * 转大不动点 → 失衡池 → 易伤覆盖率 → 异常池。跨轮反馈量统一走 threads（见 roundThreads.ts，
   * 含各线程的语义注释）；返回 threadsNext 供外层不动点传入下一轮。
   * opts.forceNoAxis = 轴退化重算（轴资源需求超出时间预算 → 不可操作 → 退化为一般轴，见 calcOutput）。
   * opts.interactionScale < 1 = 非轴降配：超预算时缩放用户交互次数（招架/金身/双反/闪反，round），
   * 只缩放 store 侧输入——后续 boss 强制弹刀（parrySplit 直读 store）与轴补齐注入不被缩放。
   */
  function runCalcRound(stunCount: number, threads: CalcRoundThreads, opts?: { forceNoAxis?: boolean; interactionScale?: number }): CalcRoundResult | null {
    const {
      goodReview: prevGoodReview,
      energyBySlot: prevEnergyBySlot,
      auricInkFlash: prevAuricInkFlash,
      anomalyDecibelBonus: prevAnomalyDecibelBonus,
      banyueTopUp: prevBanyueTopUp,
      parrySplit: prevParrySplit,
      yixuanFuFaForJufufu: prevYixuanFuFaForJufufu,
      teamUltimateForJufufu: prevTeamUltimateForJufufu,
      yeshuguangGiftUlt: prevYeshuguangGiftUlt,
      lucyTeammateEx: prevLucyTeammateEx,
      lighterTeamEnergy: prevLighterTeamEnergy,
      graceC1Cycles: prevGraceC1Cycles,
      anbyZeroTeammateWl: prevAnbyZeroTeammateWl,
      vivianTeamEx: prevVivianTeamEx,
      vivianAnomalyTriggers: prevVivianAnomalyTriggers,
      promiaTriggerHits: prevPromiaTriggerHits,
      promiaTeammateReleases: prevPromiaTeammateReleases,
      promiaReleaseDecibel: prevPromiaReleaseDecibel,
      inStunWindowTriggers: prevInStunWindowTriggers,
      ellenFreezeCount: prevEllenFreezeCount,
      teamVeilCountTotal: prevTeamVeilCountTotal,
      decibelParry: prevDecibelParry,
      decibelRegenBySlot: prevDecibelRegenBySlot,
      trackStunCount: prevTrackStunCount,
    } = threads
    const base = resourceConfig.value
    if (!base || !catalogStore.ready) return null
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
    if (axisActive && configStore.team.some(c => c.agentId === '1291')) {
      const windowDur = computeWindowDuration()
      const winAlloc = allocateAxisWindows(resolvedAxes, stunCount)
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
    // 不带支援突击弹刀（parryNoFollowUpTotal）全部归击破位，非用户可调；只给喧响弹刀（parryDecibelOnlyTotal）同理。
    const parryTotal = configStore.appliedBoss?.parryTotal ?? 0
    const parryNoFollowUpTotal = configStore.appliedBoss?.parryNoFollowUpTotal ?? 0
    const parryDecibelOnlyTotal = configStore.appliedBoss?.parryDecibelOnlyTotal ?? 0
    const guaranteeStun = configStore.getMechanicSetting('guarantee.stun', 0) !== 0
    const breakerSlot = configStore.team.findIndex(c => c?.agentId && catalogStore.getAgent(c.agentId)?.specialty === 'stun')
    const parrySplitActive = (parryTotal + parryNoFollowUpTotal + parryDecibelOnlyTotal) > 0 && guaranteeStun && breakerSlot >= 0
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
    // 伊德海莉失衡内强特：从轴里连段块反推（单次=1重碾/50闪能，双次=2重碾/85闪能），
    // 剩下的闪能在非失衡打 50 闪能强特（回15闪能）。无轴时走资源池 yidhariExPerStun 兜底。
    let yidhariInStunEx = 0
    let yidhariInStunEnergy = 0
    if (axisActive) {
      const cinema0 = configStore.team[0]?.cinemaLevel ?? 0
      const singleCost = cinema0 >= 1 ? 50 : 60
      const winAlloc = allocateAxisWindows(resolvedAxes, stunCount)
      resolvedAxes.forEach((axis, ai) => {
        const wins = winAlloc[ai] ?? 0
        for (const act of axis.actions) {
          if (act.slot !== 0) continue
          const times = act.count * wins
          if (act.moveId === 'yidhari-heavy-single') {
            yidhariInStunEx += 1 * times
            yidhariInStunEnergy += singleCost * times
          } else if (act.moveId === 'yidhari-heavy-double') {
            yidhariInStunEx += 2 * times
            yidhariInStunEnergy += 85 * times
          }
        }
      })
    }
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
    // 把当前失衡次数/覆盖率/战斗时间传给角色配置（诺姆火力实验导弹舱、炮塔全程射击依赖）
    // 各槽位轴内捏块总次数（块数×窗口数）：通用注入用（般岳分支与下方 merged 均取同一来源）
    const axisActionCountsBySlot: Record<number, Record<string, number>> = {}
    for (const c of base.characters) axisActionCountsBySlot[c.slot] = computeBanyueAxisExFor(c.slot)
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
      // Boss 预设弹刀反推注入（上一轮拆分；首轮 prev 为空 → 击破位注入 ≥1 探针保证轻弹刀行存在，
      // 供本轮失衡池读出每次弹刀失衡值，后续轮按真实拆分注入、不强制）
      if (parrySplitActive) {
        const prevSplit = prevParrySplit
        if (cfg.slot === breakerSlot) {
          const breakerInput = configStore.team[breakerSlot]?.parryCount ?? 0
          if (prevSplit === null) {
            merged.parryCount = Math.max(1, breakerInput)
          } else if (mainDpsSlot < 0) {
            // 击破位=主C（同位）：剩余并入同位 = 反推 + 剩余（输入未填时合计 = parryTotal）
            merged.parryCount = breakerInput > 0
              ? prevSplit.breakerParry
              : prevSplit.breakerParry + prevSplit.mainDpsParry
          } else {
            merged.parryCount = Math.max(0, breakerInput + prevSplit.topUp)
          }
          // 不带支援突击弹刀 + 只给喧响弹刀全部归击破位（boss 强制、非用户可调）
          merged.parryNoFollowUpCount = parryNoFollowUpTotal
          merged.parryDecibelOnlyCount = parryDecibelOnlyTotal
        } else if (cfg.slot === mainDpsSlot) {
          merged.parryCount = prevSplit?.mainDpsParry ?? Math.max(0, parryTotal - (configStore.team[breakerSlot]?.parryCount ?? 0))
        }
      }
      // x弹刀（2026-09-02 用户口径，仅基塔布鲁 1 次）：两人同时招架同一攻击——
      // 支援突击/喧响/失衡都算两人的（双方 parryCount 各 +xParryTotal），
      // 前台时间只计一份：非主弹窗位（主C 槽）的 x 次弹刀行时间豁免（cfg.parryTimeFreeCount）。
      const xParryTotal = configStore.appliedBoss?.xParryTotal ?? 0
      if (xParryTotal > 0 && parrySplitActive && breakerSlot >= 0) {
        if (cfg.slot === breakerSlot) {
          merged.parryCount = (merged.parryCount ?? 0) + xParryTotal
        } else if (cfg.slot === mainDpsSlot && mainDpsSlot >= 0 && mainDpsSlot !== breakerSlot) {
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
      if (merged.agentId === '1571') {
        return { ...merged, normaStunCount: stunCount, normaStunCoverage: provStunCoverage, normaBattleTime: base.totalTime }
      }
      if (merged.agentId === '1251') {
        return { ...merged, qingyiStunCount: stunCount }
      }
      if (merged.agentId === '1291' && hugoAxisRemainingStunSeconds !== undefined) {
        // 雨果轴模式：决算剩余失衡时间 + 决算次数由轴内块反推（覆盖滑块）；非轴回落 buildCharConfig 的滑块值。
        // 次数口径：轴内 1291_ex_verdict_final 块 = 强特决算、轴内 1291018 块 = 终结技决算（合法轴 C2=Q→E；E→E 非法不建模）。
        return {
          ...merged,
          hugoRemainingStunSeconds: hugoAxisRemainingStunSeconds,
          hugoAxisExVerdictCount: hugoAxisExVerdictCount ?? 0,
          hugoAxisUltVerdictCount: hugoAxisUltVerdictCount ?? 0,
          hugoAxisActive: true,
        }
      }
      if (merged.agentId === '1051') {
        const exOverride = axisActive && yidhariInStunEx > 0
          ? { yidhariInStunExCount: yidhariInStunEx, yidhariInStunEnergyCost: yidhariInStunEnergy }
          : {}
        return { ...merged, yidhariStunCount: stunCount, ...exOverride }
      }
      if (merged.agentId === '1551') {
        // 佩洛伊斯：额外能力 连携回 300 喧响 × 连携总次数（失衡连携与诺姆赠送连携同算）；
        // 影画2：下分支开局固定一次 → 回 1500 喧响（上限不建模）；
        // 决算（右分支）次数：滑块 >=0 用滑块，缺省 -1 = 一次失衡一次决算。
        const cinema = configStore.team[merged.slot]?.cinemaLevel ?? 0
        const chainTotal = merged.chainCountTotalOverride ?? (merged.chainCountPerStun ?? 0) * stunCount
        return {
          ...merged,
          extraSelfDecibelReward: (merged.extraSelfDecibelReward ?? 0) + chainTotal * 300 + (cinema >= 2 ? 1500 : 0),
          // 决算次数 = 失衡次数（一次失衡只能决算一次，决算后即出失衡）；轴模式按轴内 1551016 块计数
          peiluoVerdictCount: stunCount,
        }
      }
      if (merged.agentId === '1381') {
        // 零号·安比：队友追加攻击命中折算的白雷层数（外层不动点线程回填）
        return { ...merged, anbyZeroTeammateWhiteLightning: prevAnbyZeroTeammateWl }
      }
      if (merged.agentId === '1471') {
        // 般岳：轴内捏的强特/连段块 → 次数反馈给模块（先扣闪能，剩余自动补连段）；轴模式地动滑块归 0
        const banyueAxisEx = computeBanyueAxisExFor(cfg.slot)
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
      if (merged.agentId === '1371') {
        // 仪玄：轴内强特（凝云术块）次数与凝云蓄力时长（轴 action.duration 加权）→ 模块分配；
        // 玄墨异常触发回闪能（外层收敛反馈，10s CD 封顶 18 次）→ 计入闪能总账
        const yixuanAxisEx: Record<string, number> = {}
        let cloudSecTotal = 0
        let cloudSecWeight = 0
        if (axisActive) {
          const winAlloc = allocateAxisWindows(resolvedAxes, stunCount)
          resolvedAxes.forEach((axis, ai) => {
            const wins = winAlloc[ai] ?? 0
            for (const act of axis.actions) {
              if (act.slot !== cfg.slot) continue
              yixuanAxisEx[act.moveId] = (yixuanAxisEx[act.moveId] ?? 0) + act.count * wins
              // 凝云术块：duration 字段覆盖倍率表 actionTime（新机制：轴内凝云可延长缩短）
              if (act.moveId === '1371022') {
                const dur = typeof (act as any).duration === 'number' ? (act as any).duration : 2
                cloudSecTotal += dur * act.count * wins
                cloudSecWeight += act.count * wins
              }
            }
          })
        }
        const auricInkTriggers = Math.min(18, Math.max(0, Math.floor(prevAuricInkFlash)))
        // 极限支援换场落雷（用户口径）：次数上限 = 队友正常弹刀次数求和；默认次数 = 上限（主页可录入）
        const assistCap = configStore.team.reduce((sum, c, ci) => ci !== cfg.slot ? sum + (c.parryCount ?? 0) : sum, 0)
        const assistInput = Math.max(-1, Math.floor(Number((merged as unknown as Record<string, unknown>).yixuanExtremeAssistCount ?? -1)))
        const extremeAssists = (merged.teamUltimateFlashBonus ?? 0) > 0
          ? Math.min(assistInput >= 0 ? assistInput : assistCap, assistCap)
          : 0
        // 影画1·追加落雷（用户口径）：按 CD 自动算次数——轴模式 floor(轴内时间/6)，
        // 非轴 floor(有效战斗时间/6)（战斗时间扣 boss 无敌，落雷不在无敌期间结算）
        const yixuanCinema = Math.max(0, Math.floor(Number((merged as unknown as Record<string, unknown>).yixuanCinemaLevel ?? 0)))
        const battleTime = Math.max(0, (merged.battleTime ?? 180) - (configStore.enemy.invincibleTime ?? 0))
        const c1Lightnings = yixuanCinema >= 1
          ? Math.max(0, Math.floor((axisInSeconds > 0 ? axisInSeconds : battleTime) / 6))
          : 0
        // 橘福福额外能力：仪玄符法千重/调息赠送也算终结技，上一轮次数 ×300 喧响（青溟云影走 extraSelfDecibelPerUltimate）
        const jufufuOn = base.characters.some(c => c.agentId === '1391' && (c.panel?.additionalAbilityActive ?? 0) > 0)
        const fufaDecibel = jufufuOn && prevYixuanFuFaForJufufu > 0 ? prevYixuanFuFaForJufufu * 300 : 0
        const yixuanMerged = {
          ...merged,
          yixuanAxisEx,
          yixuanAxisCloudSeconds: cloudSecWeight > 0 ? cloudSecTotal / cloudSecWeight : 2,
          yixuanAxisActive: axisActive,
          yixuanAnomalyTriggerFlash: auricInkTriggers,
          yixuanExtremeAssistCap: assistCap,
          yixuanC1LightningCount: c1Lightnings,
          // 玄墨异常触发回闪能（10s CD 封顶 18 次）+ 极限支援落雷闪能（5/次）+ C1 落雷闪能（5/次）计入总账（外层收敛）
          yixuanFlashBonus: (merged.yixuanFlashBonus ?? 0) + auricInkTriggers * 10 + extremeAssists * 5 + c1Lightnings * 5,
          extraSelfDecibelReward: (merged.extraSelfDecibelReward ?? 0) + fufaDecibel,
        }
        return yixuanMerged
      }
      if (merged.agentId === '1531') {
        // 星徽·比利：轴内捏的动作（含组合块展开）→ 次数反馈给模块；轴外剩余闪能模块自动打抓地轮毂
        const billyAxisEx: Record<string, number> = {}
        if (axisActive) {
          const winAlloc = allocateAxisWindows(resolvedAxes, stunCount)
          const billyCombos = getAgentMechanic('1531')?.combos ?? {}
          resolvedAxes.forEach((axis, ai) => {
            const wins = winAlloc[ai] ?? 0
            for (const act of axis.actions) {
              if (act.slot !== cfg.slot) continue
              const combo = billyCombos[act.moveId]
              if (combo) {
                for (const mv of combo.moves) {
                  billyAxisEx[mv.moveId] = (billyAxisEx[mv.moveId] ?? 0) + act.count * mv.count * wins
                }
              } else {
                billyAxisEx[act.moveId] = (billyAxisEx[act.moveId] ?? 0) + act.count * wins
              }
            }
          })
        }
        return { ...merged, billyAxisEx, billyAxisActive: axisActive, billyStunCoverage: provStunCoverage }
      }
      if (merged.agentId === '1591') {
        // 希格莉德：轴内「破阵连段」块数（含诺姆赠送连携触发的破阵）→ 模块按套数生成三段行。
        // C6 解锁次数限制后破阵按连携计（每次连携/赠送连携一次）；非 C6 每个失衡窗口一次，由模块自行处理。
        let sigridAxisPozhenSets = 0
        if (axisActive) {
          const pzCinema = configStore.team[cfg.slot]?.cinemaLevel ?? 0
          const winAlloc = allocateAxisWindows(resolvedAxes, stunCount)
          resolvedAxes.forEach((axis, ai) => {
            const wins = winAlloc[ai] ?? 0
            for (const act of axis.actions) {
              if (act.slot !== cfg.slot) continue
              if (act.moveId === 'sigrid-pozhen') sigridAxisPozhenSets += act.count * wins
              // 诺姆赠送的希格连携（gift 块）命中失衡敌人也触发一次破阵（C6 解锁限制后）
              else if (pzCinema >= 6 && act.sourceTag === 'gift' && act.moveId === '1591015') sigridAxisPozhenSets += act.count * wins
            }
          })
          if (pzCinema < 6) sigridAxisPozhenSets = Math.min(sigridAxisPozhenSets, winAlloc.reduce((a, b) => a + b, 0))
        }
        return { ...merged, sigridAxisPozhenSets, sigridAxisActive: axisActive }
      }
      if (merged.agentId === '1141') {
        // 莱卡恩围猎（2.6 潜能激发）：次数 = 失衡次数；后台跟随闪反 = 队伍其他角色闪反次数之和；
        // 围猎平A时间 = 后台时间预算（总-无敌-失衡时长-莱卡恩前台）− 闪反时间（用户口径）
        const backstageDodgeCount = configStore.team.reduce((sum, c, ci) =>
          ci !== cfg.slot && c?.agentId ? sum + (c.dodgeCounterCount ?? 0) : sum, 0)
        // 影画2·能量回馈：次数 = 失衡次数 + 队友连携总次数（用户确认：排除莱卡恩自己，只算队友的连携）；
        // 轴模式用轴内连携块加权和，非轴用 chainCountPerStun × 次数
        const teamChainTotal = axisActive
          ? Object.values(axisChainTotal).reduce((a, b) => a + b, 0) - (axisChainTotal[cfg.slot] ?? 0)
          : configStore.team.reduce((sum, c, ci) =>
              ci !== cfg.slot && c?.agentId ? sum + (c.chainCountPerStun ?? 0) * stunCount : sum, 0)
        const c2Per = merged.lycaonC2EnergyPerTrigger ?? 0
        return {
          ...merged,
          lycaonStunCount: stunCount,
          lycaonWindowDuration: computeWindowDuration(),
          lycaonTotalTime: base.totalTime,
          lycaonInvincibleTime: base.invincibleTime ?? 0,
          lycaonBackstageDodgeCount: backstageDodgeCount,
          lycaonC2Energy: c2Per > 0 ? (stunCount + teamChainTotal) * c2Per : 0,
        }
      }
      if (merged.agentId === '1391') {
        return {
          ...merged,
          jufufuTeamUltimateCount: prevTeamUltimateForJufufu > 0 ? prevTeamUltimateForJufufu : undefined,
        }
      }
      if (merged.agentId === '1431') {
        return {
          ...merged,
          yeshuguangGiftUltCount: prevYeshuguangGiftUlt,
        }
      }
      if (merged.agentId === '1151') {
        // 队友强特合计（不含自己）：用上一轮 resource 结果更好，这里用 prev 注入字段
        return {
          ...merged,
          lucyTeammateExTotal: prevLucyTeammateEx,
        }
      }
      if (merged.agentId === '1511') {
        // 失衡内异常系统 v2（上一轮时间线）：每窗轴内异常触发数 → 颤音自动层数；
        // 轴内「快速支援」放置块数 → 模块按块数生成快支行（极性载体+窗内伤害吃易伤）
        let nangongQuickAssistPlaced = 0
        if (axisActive) {
          const qaWinAlloc = allocateAxisWindows(resolvedAxes, stunCount)
          resolvedAxes.forEach((axis, ai) => {
            const wins = qaWinAlloc[ai] ?? 0
            for (const act of axis.actions) {
              if (act.slot !== cfg.slot || act.moveId !== '1511013') continue
              nangongQuickAssistPlaced += act.count * wins
            }
          })
        }
        return { ...merged, inStunWindowTriggers: Math.max(0, prevInStunWindowTriggers), nangongQuickAssistPlaced }
      }
      if (merged.agentId === '1541') {
        // 普罗米娅·霜刑回复端（上一轮池结果）：触发命中数 + 队友异放次数；
        // 异放回喧响（上一轮绝裁/特殊异放次数 ×100）经 extraSelfDecibelReward 注入终结技次数
        return {
          ...merged,
          promiaTriggerHitCount: Math.max(0, Math.floor(prevPromiaTriggerHits)),
          promiaTeammateReleaseCount: Math.max(0, Math.floor(prevPromiaTeammateReleases)),
          extraSelfDecibelReward: (merged.extraSelfDecibelReward ?? 0) + Math.max(0, Math.floor(prevPromiaReleaseDecibel)),
        }
      }
      if (merged.agentId === '1331') {
        // 薇薇安落羽生花双源（上一轮收敛值）：
        //   源1 = 全队强特命中次数（任意角色强化特殊技命中，同一招式至多一次）
        //   源2 = 全队异常触发次数（队友施加属性异常，0.5s CD 折算在模块内）
        return {
          ...merged,
          vivianTeamExTotal: prevVivianTeamEx,
          vivianAnomalyTriggerTotal: prevVivianAnomalyTriggers,
        }
      }
      if (merged.agentId === '1161') {
        const ratio = Math.max(0, Math.min(1, configStore.getMechanicSetting('lighter.backstageRatio', 2 / 3)))
        return {
          ...merged,
          lighterBackstageRatio: ratio,
          lighterTeamEnergyConsumed: Math.max(0, prevLighterTeamEnergy || 0),
        }
      }
      if (merged.agentId === '1181') {
        // 格莉丝影画1 全队回能：上一轮收敛的轮换数（postRound 线程化），converge 阶段 applyTeamConfig 消费
        return { ...merged, graceC1Cycles: Math.max(0, Math.floor(Number(prevGraceC1Cycles ?? 0))) }
      }
      if (merged.agentId === '1191') {
        // 艾莲影画4 冻结次数：读上一轮异常池 ice 触发数（下一轮 cfg 生效，薇薇安同款反馈）
        return { ...merged, ellenFreezeCount: Math.max(0, Math.floor(prevEllenFreezeCount)) }
      }
      if (merged.agentId === '1201') {
        // 悠真：轴内飞弦·斩/甲乙矢次数（失衡轴块，捏轴精度，仪玄 yixuanAxisEx 同款）→ 模块分轴内/轴外
        let harumasaAxisSlash = 0
        let harumasaAxisArrow = 0
        if (axisActive) {
          const winAlloc = allocateAxisWindows(resolvedAxes, stunCount)
          resolvedAxes.forEach((axis, ai) => {
            const wins = winAlloc[ai] ?? 0
            for (const act of axis.actions) {
              if (act.slot !== cfg.slot) continue
              if (act.moveId === '1201020' || act.moveId === '1201021' || act.moveId === '1201022') harumasaAxisSlash += act.count * wins
              else if (act.moveId === '1201008') harumasaAxisArrow += act.count * wins
            }
          })
        }
        return { ...merged, harumasaAxisActive: axisActive, harumasaAxisSlash, harumasaAxisArrow }
      }
      if (merged.agentId === '1241') {
        // 朱鸢：轴内压制以太次数（失衡轴块）→ 模块分轴内/轴外
        let zhuYuanAxisEther = 0
        if (axisActive) {
          const winAlloc = allocateAxisWindows(resolvedAxes, stunCount)
          resolvedAxes.forEach((axis, ai) => {
            const wins = winAlloc[ai] ?? 0
            for (const act of axis.actions) {
              if (act.slot !== cfg.slot) continue
              if (act.moveId === '1241010' || act.moveId === '1241011' || act.moveId === '1241012') zhuYuanAxisEther += act.count * wins
            }
          })
        }
        return { ...merged, zhuYuanAxisActive: axisActive, zhuYuanAxisEther }
      }
      return merged
    })
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
    })
    // 特殊动作喧响奖励（弹刀215/闪反10/连携10/快支20，含伴随50%）：本轮即时结算——
    // 输入只有用户配置的次数与连携数（= chainCountTotalOverride ?? chainCountPerStun × stunCount），无 ultimateCount 反馈环
    const perSlotChainForBonus = [0, 0, 0]
    for (const cfg of characters) {
      perSlotChainForBonus[cfg.slot] = cfg.chainCountTotalOverride ?? (cfg.chainCountPerStun ?? 0) * stunCount
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
      specialActionDecibelBonusPerSlot: specialBonusPerSlot,
      anomalyDecibelBonusPerSlot: anomalyBonusPerSlot,
      // 时间轴喧响轨（对轴模块，用户口径 2026-08-31）：轴模式按窗口时序推演每槽实际可放大招数
      //（180s 分失衡/非失衡段，喧响均匀回复 3000 上限，进窗够 3000 放大清空、不够削减该窗大招）。
      // 非轴模式不注入（回落总量口径）。首轮窗口时序按失衡次数均分（有效时间/N）估位，
      // 与轮内实际窗口节奏的偏差由外层不动点吸收（推演输入 = 上一轮收敛的喧响产出）。
      ...(axisActive
        ? { axisUltimateTrackBySlot: computeAxisUltimateTrack(
            characters,
            stunCount,
            computeWindowDuration(),
            Math.max(1, (base.totalTime ?? 180) - (configStore.enemy.invincibleTime ?? 0)),
            prevDecibelRegenBySlot,
            prevTrackStunCount,
          ) }
        : {}),
    }), catalogStore)
    // 橘福福：收敛仪玄符法千重类终结次数 + 全队终结总次数（供额外能力 +300 / 影画2 威势）
    let yixuanFuFaForJufufuNext = 0
    let teamUltimateForJufufuNext = 0
    {
      let fufa = 0
      let teamUlt = 0
      for (const ch of rr.characters) {
        teamUlt += ch.ultimateCount ?? 0
        if (ch.agentId === '1371') {
          for (const e of ch.executions ?? []) {
            const mid = e.moveId ?? ''
            const name = e.moveName ?? ''
            if (mid === '1371020' || name.includes('符法千重')) {
              fufa += e.count ?? 0
            }
          }
          teamUlt += fufa // 符法千重不在 ultimateCount 内，补进队伍终结
        }
      }
      yixuanFuFaForJufufuNext = fufa
      teamUltimateForJufufuNext = teamUlt
    }

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
        axisEx: computeBanyueAxisExFor(banyueSlot),
        ultimateCountNeeded: Math.max(ultNeed, guaranteeUltimate ? 4 : 0),
        minRageCount: guaranteeFury ? 4 : 0,
        ultimateCost: base.characters[banyueSlot]?.ultimateCost ?? ULTIMATE_COST_DEFAULT,
        decibelHave,
        // 单次补齐弹刀的原始动作时间 = 招架支援 + 支援突击（未扣合轴）：
        // 用来判「这次补齐是不是根本打不出来」（>200s = 非法，见 banyue.ts#AUTO_TOPUP_TIME_LIMIT_SEC）
        perParrySeconds: (base.characters[banyueSlot]?.defensiveAssistActionTime ?? 0)
          + (base.characters[banyueSlot]?.assistFollowUpActionTime ?? 0),
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
    const baseStun = extractStunExecsFrom(rr)
    const baseAnomaly = extractAnomalyExecsFrom(rr)
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
    if (parrySplitActive && sp1.pool) {
      const breakerCfg = base.characters.find(c => c.slot === breakerSlot)
      const breakerDefMoveId = breakerCfg?.defensiveAssistMoveId ?? ''
      const breakerFollowUpMoveId = breakerCfg?.assistFollowUpMoveId ?? ''
      const defRow = sp1.pool.contributions.find(c => c.slot === breakerSlot && c.moveId === breakerDefMoveId)
      const fuRow = sp1.pool.contributions.find(c => c.slot === breakerSlot && c.moveId === breakerFollowUpMoveId)
      // 每次弹刀失衡值：本轮有击破位弹刀行则实测；否则沿用上一轮实测值（击破位 0 弹刀时无行，
      // 但失衡值/面板不变，沿用即可，防「反推归零 → 无行 → 无法再反推」卡死）
      const hasRows = defRow && defRow.count > 0
      const perNoFollowUpDaze = hasRows ? defRow!.effectiveStun / defRow!.count : (prevParrySplit?.perNoFollowUpDaze ?? 0)
      const assistPerHit = (hasRows && fuRow && fuRow.count > 0) ? fuRow.effectiveStun / fuRow.count : (prevParrySplit ? prevParrySplit.perParryDaze - prevParrySplit.perNoFollowUpDaze : 0)
      const perParryDaze = perNoFollowUpDaze + assistPerHit
      const injectedParryDaze = (defRow?.effectiveStun ?? 0) + (fuRow?.effectiveStun ?? 0)
      // 非弹刀基数：全队有效失衡 − 击破位弹刀行 + boss 白送失衡（stunGift 也减少缺口）
      const nonParryStun = Math.max(0, sp1.pool.totalStunBuildUp - injectedParryDaze + (sp1.pool.stunGift ?? 0))
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
          breakerInput: configStore.team[breakerSlot]?.parryCount ?? 0,
          mainDpsInput: configStore.team[mainDpsSlot >= 0 ? mainDpsSlot : breakerSlot]?.parryCount ?? 0,
        }),
        perParryDaze,
        perNoFollowUpDaze,
      }
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
    const rrShown = applyNormaHatChain(rrShown0, configStore, catalogStore) ?? rrShown0

    // 叶瞬光：琉音转大赠送的逐云次数（adj 后 gift 行）
    let yeshuguangGiftUltNext = 0
    {
      const ye = (adj2 ?? rr).characters.find(c => c.agentId === '1431')
      if (ye) {
        for (const e of ye.executions ?? []) {
          if ((e as any).source === 'gift' || (e.moveName ?? '').includes('好评转大')) {
            yeshuguangGiftUltNext += e.count ?? 0
          }
        }
      }
    }

    // 零号·安比：队友追加攻击命中 → 银星充能（每次 16.667；每满 1/3=33.333 得 1 层白雷）；
    // 5 秒内最多触发一次（ICD 上限 = floor(战斗时长/5)）；默认只计 75%
    let anbyZeroTeammateWlNext = 0
    {
      const az = adj2 ?? rr
      const hits = az.characters
        .filter(c => c.agentId !== '1381')
        .reduce((sum, c) => {
          const skills = catalogStore.getAgentSkills(c.agentId)
          return sum + (c.executions ?? []).reduce((a, e) => {
            if ((e as any).skillDamageTarget === 'additionalAttack') return a + (e.count ?? 0)
            // resourceResult 行上没有现成标记：按 catalog moveId 现场推断（同伤害池 infer 口径）
            for (const cat of skills?.categories ?? []) {
              const mv = (cat.moves ?? []).find(m => String(m.id) === String(e.moveId))
              if (mv && inferSkillDamageTarget(cat, mv) === 'additionalAttack') return a + (e.count ?? 0)
            }
            return a
          }, 0)
        }, 0)
      const icdCap = Math.floor((configStore.enemy.battleTime ?? 180) / 5)
      const triggers = Math.min(hits, icdCap)
      if (az.characters.some(c => c.agentId === '1381')) {
        anbyZeroTeammateWlNext = Math.floor(triggers * (16.667 / 33.333) * 0.75)
      }
    }

    const cov1 = computeStunCoverage(sp1.pool, verdictSecondsLost)
    const ap1 = calcAnomalyPoolInput(cov1, adj2 ? extractAnomalyExecsFrom(adj2) : baseAnomaly, aliceSparkThisRound)

    // 露西 C6：队友强特合计 + 回旋预估（供下一轮 C1 回能）
    let lucyTeammateExNext = 0
    {
      let mateEx = 0
      for (const ch of rr.characters) {
        if (ch.agentId !== '1151') mateEx += ch.exSpecialCount ?? 0
      }
      lucyTeammateExNext = mateEx
      const lucyCh = rr.characters.find(c => c.agentId === '1151')
      if (lucyCh) {
        const cinema = Math.max(0, Math.floor(Number((characters.find(c => c.agentId === '1151') as any)?.lucyCinemaLevel ?? 0)))
        const spins = Math.max(0, Math.floor(lucyCh.exSpecialCount ?? 0))
          + (cinema >= 2 ? Math.max(0, Math.floor(lucyCh.chainCountTotal ?? 0)) + Math.max(0, Math.floor(lucyCh.ultimateCount ?? 0)) : 0)
          + (cinema >= 6 ? mateEx : 0)
        for (const c of characters) {
          ;(c as any).lucyCheerSpinsEstimate = spins
          ;(c as any).lucyTeammateExTotal = mateEx
        }
      }
    }

    // 队伍级机制·postRound 阶段：本轮次数已收敛 → 为下一轮注入派生量。
    // `lighterTeamEnergyNext` 仍需在编排层线程化（作为下一轮 converge 的输入），
    // 但计算与写入 cfg 的责任已经回到莱特模块自己的 applyTeamConfig。
    let lighterTeamEnergyNext = 0
    let graceC1CyclesNext = 0
    let teamVeilCountTotalNext = 0
    {
      const exByAgent = new Map(rr.characters.map(ch => [ch.agentId, ch.exSpecialCount ?? 0]))
      const ultByAgent = new Map(rr.characters.map(ch => [ch.agentId, ch.ultimateCount ?? 0]))
      const exCounts = characters.map(c => Math.max(0, exByAgent.get(c.agentId) ?? 0))
      const ultimateCounts = characters.map(c => Math.max(0, ultByAgent.get(c.agentId) ?? 0))
      if (characters.some(c => c.agentId === '1161')) {
        lighterTeamEnergyNext = estimateTeamNormalEnergyConsumed(characters, exCounts)
      }
      const graceCfg = characters.find(c => c.agentId === '1181')
      if (graceCfg) graceC1CyclesNext = Math.max(0, Math.floor(Number((graceCfg as any).graceC1Cycles ?? 0)))
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

    // 薇薇安落羽生花双源（下一轮注入）：
    //   源1 = 全队强特命中次数（含薇薇安自己；同一招式至多一次）
    //   源2 = 全队异常触发次数（队友施加属性异常；0.5s CD 折算在模块内）
    // 普罗米娅·霜刑回复端（下一轮注入）：触发命中数 + 队友异放次数
    let promiaTriggerHitsNext = 0
    let promiaTeammateReleasesNext = 0
    let promiaReleaseDecibelNext = 0
    if (characters.some(c => c.agentId === '1541')) {
      promiaTriggerHitsNext = ap1?.totalTriggerCount ?? 0
      // 队友异放 = 除普罗米娅自身外的全队 release 事件（原文「队友触发异放」，自身异放回喧响另走 promiaReleaseDecibel）
      promiaTeammateReleasesNext = (rrShown?.characters ?? rr.characters)
        .filter(ch => ch.agentId !== '1541')
        .flatMap(ch => ch.anomalyEventExecutions ?? [])
        .filter(e => e.eventType === 'release' && e.count > 0)
        .reduce((sum, e) => sum + Math.floor(e.count), 0)
      // 普罗米娅自身异放回喧响（绝裁异放 + 影画6特殊异放）各 +100（0.5s CD 但异放次数远低于上限，不钳制）
      const promiaCh = (rrShown?.characters ?? rr.characters).find(c => c.agentId === '1541')
      const promiaReleaseTotal = (promiaCh?.anomalyEventExecutions ?? [])
        .filter(e => e.eventType === 'release' && e.count > 0 && (e.eventId === 'promia_execution_release' || e.eventId === 'promia_c6_special_release'))
        .reduce((sum, e) => sum + Math.floor(e.count), 0)
      promiaReleaseDecibelNext = promiaReleaseTotal * 100
      if (prevPromiaTriggerHits <= 0 && prevPromiaTeammateReleases <= 0) {
        for (const c of characters) {
          if (c.agentId === '1541') {
            ;(c as any).promiaTriggerHitCount = promiaTriggerHitsNext
            ;(c as any).promiaTeammateReleaseCount = promiaTeammateReleasesNext
          }
        }
      }
    }
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
        if (prevInStunWindowTriggers <= 0) {
          for (const c of characters) {
            if (c.agentId === '1511') (c as any).inStunWindowTriggers = inStunWindowTriggersNext
          }
        }
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
    let vivianTeamExNext = 0
    let vivianAnomalyTriggersNext = 0
    if (characters.some(c => c.agentId === '1331')) {
      vivianTeamExNext = rr.characters.reduce((sum, ch) => sum + (ch.exSpecialCount ?? 0), 0)
      vivianAnomalyTriggersNext = (ap1?.perElement ?? []).reduce(
        (sum, prog) => sum + (prog.triggerCount ?? 0),
        0,
      )
      // 首轮无 prev → 用本轮值直接注入（buildExecutions 读 cfg）
      if (prevVivianTeamEx <= 0) {
        for (const c of characters) {
          if (c.agentId === '1331') {
            ;(c as any).vivianTeamExTotal = vivianTeamExNext
            ;(c as any).vivianAnomalyTriggerTotal = vivianAnomalyTriggersNext
          }
        }
      }
    }

    // 艾莲影画4 冻结次数：读异常池 ice 触发数（下一轮 cfg 生效，薇薇安同款反馈）
    let ellenFreezeCountNext = 0
    if (characters.some(c => c.agentId === '1191')) {
      ellenFreezeCountNext = ap1?.perElement?.find(p => p.element === 'ice')?.triggerCount ?? 0
      if (prevEllenFreezeCount <= 0) {
        for (const c of characters) {
          if (c.agentId === '1191') {
            ;(c as any).ellenFreezeCount = ellenFreezeCountNext
          }
        }
      }
    }

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
        yixuanFuFaForJufufu: yixuanFuFaForJufufuNext,
        teamUltimateForJufufu: teamUltimateForJufufuNext,
        yeshuguangGiftUlt: yeshuguangGiftUltNext,
        lucyTeammateEx: lucyTeammateExNext,
        lighterTeamEnergy: lighterTeamEnergyNext,
        graceC1Cycles: graceC1CyclesNext,
        anbyZeroTeammateWl: anbyZeroTeammateWlNext,
        vivianTeamEx: vivianTeamExNext,
        vivianAnomalyTriggers: vivianAnomalyTriggersNext,
        promiaTriggerHits: promiaTriggerHitsNext,
        promiaTeammateReleases: promiaTeammateReleasesNext,
        promiaReleaseDecibel: promiaReleaseDecibelNext,
        inStunWindowTriggers: inStunWindowTriggersNext,
        ellenFreezeCount: ellenFreezeCountNext,
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
      },
    }
  }

  /** 单轮计算输出：下游 computed 消费的计算结果（10 个字段）+ 下一轮收敛线程 */
  interface CalcRoundResult {
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
        const decibelParrySeq = `${t.decibelParry ?? 0}`
        const feedbackStable = ultSeq === prevUltSeq && anomalySeq === prevAnomalySeq && topUpSeq === prevTopUpSeq && parrySplitSeq === prevParrySplitSeq && decibelParrySeq === prevDecibelParrySeq
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
    let axisFallback = false
    let interactionScale: number | undefined
    const overBudget = (x: CalcRoundResult | null) =>
      stunEffTime > 0 && x != null && frontlineTotalOf(x) > stunEffTime + AXIS_FALLBACK_TOLERANCE_SEC
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
      // 非轴降配（用户口径 2026-08-30）：金身/招架这类手填交互与轴厚需求本质相同——超预算都要降配。
      // 轴侧降配 = 退化（需求没了，补齐自动归零）；非轴侧 = 缩放用户交互次数直到净占用回到预算内。
      // 二分找最大可行 scale（6 轮，精度 ~1.6%）；scale→0 仍超 = 非交互必要时间本身超预算，如实保留报超时。
      if (overBudget(r.out) && !r.out?.resolvedAxes?.length) {
        let lo = 0
        let hi = 1
        let best: { out: CalcRoundResult | null; outerRounds: number; outerConverged: boolean; outerExit: 'stable' | 'cycle' | 'maxIter'; scale: number } | null = null
        for (let i = 0; i < 6; i++) {
          const mid = (lo + hi) / 2
          const trial = runOuterLoop(true, mid)
          if (overBudget(trial.out)) {
            hi = mid
          } else {
            lo = mid
            best = { ...trial, scale: mid }
          }
        }
        if (best) {
          r = best
          axisFallback = hadAxis
          interactionScale = best.scale
        }
      }
    }
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

  /** 般岳明王时间轴覆盖（失衡轴内）：怒相二连块触发明王窗口（2层→3层刷新），返回各招式实例加权平均层数 */
  /** 般岳明王时间轴覆盖（非6命，轴内）：怒相二连块触发明王窗口（2层→3层刷新），返回各招式实例加权平均层数；6命满覆盖不扫描 */
  const banyueMingwangStacks = computed(() => {
    const banyueSlot = configStore.team.findIndex(c => c.agentId === '1471')
    if (banyueSlot < 0 || effectiveStunAxes.value.length === 0) return new Map<string, number>()
    const cinema = configStore.team[banyueSlot]?.cinemaLevel ?? 0
    return computeBanyueMingwangStacks(banyueSlot, effectiveStunAxes.value, cinema)
  })
  /** 仪玄凝神时间轴覆盖（失衡轴内，般岳明王模式）：终结技块触发后 15s 窗口内动作暴伤+40%（影画6 附加贯穿+20%） */
  const yixuanNingshenMap = computed(() => {
    const yixuanSlot = configStore.team.findIndex(c => c.agentId === '1371')
    if (yixuanSlot < 0 || effectiveStunAxes.value.length === 0) return new Map<string, { critDmg: number; sheerDmg: number }>()
    const cinema = yixuanSlot >= 0 ? configStore.team[yixuanSlot]?.cinemaLevel ?? 0 : 0
    return computeYixuanNingshenBonus(yixuanSlot, effectiveStunAxes.value, cinema)
  })
  /** 佩洛伊斯阳炎 buff 轴覆盖：上分支发动后 21s 窗口内上分支/决算终结暴伤+40%（触发块自身也享受） */
  const peiluoKagerouMap = computed(() => {
    const peiluoSlot = configStore.team.findIndex(c => c.agentId === '1551')
    if (peiluoSlot < 0 || effectiveStunAxes.value.length === 0) return new Map<string, number>()
    return computePeiluoKagerouBonus(peiluoSlot, effectiveStunAxes.value)
  })
  /** 可琳额外能力扫除帮手 buff 轴（失衡轴内）：轴内所有招式都在失衡窗口内 → 全部 +35%；普攻段归并 basic_attack 聚合行键 */
  const corinStunBonusMap = computed(() => {
    const corinSlot = configStore.team.findIndex(c => c.agentId === '1061')
    if (corinSlot < 0 || effectiveStunAxes.value.length === 0) return new Map<string, number>()
    const basicMoveIds = new Set(
      (catalogStore.getAgentSkills('1061')?.categories ?? [])
        .find(c => c.id === 'basic')?.moves.map(m => m.id) ?? [],
    )
    return computeCorinStunBonusMoves(corinSlot, effectiveStunAxes.value, basicMoveIds)
  })

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
    // 懒守卫：非般岳或非轴模式不触发全量计算（首页交互栏只在 1471 选中时读取）
    const slot = configStore.team.findIndex(c => c.agentId === '1471')
    if (slot < 0 || (!configStore.useStunAxis && !autoActive.value)) return null
    const topUp = calcOutput.value?.banyueTopUp
    if (!topUp || (topUp.parry === 0 && topUp.dual === 0)) return null
    return { slot, ...topUp }
  })

  /** Boss 预设弹刀反推（保底4失衡，最终收敛值）：交互栏显示「击破位弹刀 +N / 主C 剩余」用 */
  const parrySplitResult = computed<{ breakerSlot: number; topUp: number; breakerParry: number; mainDpsParry: number; breakerNoFollowUp: number; breakerDecibelOnly: number; parryTotal: number; parryNoFollowUpTotal: number } | null>(() => {
    // 懒守卫：未应用带 parryTotal/parryNoFollowUpTotal/parryDecibelOnlyTotal 的 Boss、未勾选「保底4失衡」或队伍无击破位时不触发全量计算
    const parryTotal = configStore.appliedBoss?.parryTotal ?? 0
    const parryNoFollowUpTotal = configStore.appliedBoss?.parryNoFollowUpTotal ?? 0
    const parryDecibelOnlyTotal = configStore.appliedBoss?.parryDecibelOnlyTotal ?? 0
    if (parryTotal + parryNoFollowUpTotal + parryDecibelOnlyTotal <= 0) return null
    if (configStore.getMechanicSetting('guarantee.stun', 0) === 0) return null
    const breakerSlot = configStore.team.findIndex(c => c?.agentId && catalogStore.getAgent(c.agentId)?.specialty === 'stun')
    if (breakerSlot < 0) return null
    const split = calcOutput.value?.parrySplit
    if (!split) return null
    return { breakerSlot, topUp: split.topUp, breakerParry: split.breakerParry, mainDpsParry: split.mainDpsParry, breakerNoFollowUp: split.breakerNoFollowUp, breakerDecibelOnly: parryDecibelOnlyTotal, parryTotal, parryNoFollowUpTotal }
  })

  /** 特殊动作喧响奖励 */
  const specialActionBonus = computed<SpecialActionBonusResult | null>(() => {
    const topUp = banyueInteractionTopUp.value
    const split = parrySplitResult.value
    const perSlotParry = configStore.team.map((c, s) => {
      let p = (c.parryCount ?? 0) + (topUp && s === topUp.slot ? topUp.parry : 0)
      if (split) {
        if (s === split.breakerSlot) p = split.breakerParry + split.breakerNoFollowUp + split.breakerDecibelOnly
        else if (s === 0 && (c.parryCount ?? 0) <= 0) p = split.mainDpsParry
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
    banyueMingwangStacks: banyueMingwangStacks.value,
    yixuanNingshenMap: yixuanNingshenMap.value,
    peiluoKagerouMap: peiluoKagerouMap.value,
    corinStunBonusMap: corinStunBonusMap.value,
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
