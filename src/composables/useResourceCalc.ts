import { YESHUGUANG_FULL_STUN_MOVES } from '@/mechanics/agents/yeshuguang'
import { inferSkillDamageTarget } from '@/core/damage'
import { estimateTeamNormalEnergyConsumed } from '@/mechanics/agents/lighter'
import { computed } from 'vue'
import { useConfigStore } from '@/stores/config'
import { useCatalogStore } from '@/stores/catalog'
import { calcPanel, emptyPanel } from '@/core/panel'
import { applyTargetedStat } from '@/core/buff'
import { calcDirectDamage, calcAnomalyDamage, resolveSpecialDamageProfile } from '@/core/damage'
import { buildTeammateBuffSourceContext } from '@/core/teammateBuffSource'
import {
  calcTeamResources,
  findExSpecial,
  findUltimate,
  findChainAttack,
  findDefensiveAssist,
  findAssistFollowUp,
  findDodgeCounter,
  calcBasicAttackRegenPerSec,
  findRemielleRainbowEnd,
  findRemielleRadiantTurn,
  ULTIMATE_COST_DEFAULT,
} from '@/core/resource'
import { calcStunPool } from '@/core/stunPool'
import type { StunSkillExecution } from '@/core/stunPool'
import { calcStunAxis } from '@/core/stunAxis'
import type { StunAxis, StunAxisResult } from '@/types/resource'
import { calcStunAxisStack, allocateAxisWindows } from '@/core/stunAxisStack'
import type { StackActionCost } from '@/core/stunAxisStack'
import { resolveStunAxisPlan, selectAutoStunAxisPreset, cloneStunAxes } from '@/data/stunAxisPresets'
import { calcAnomalyPool, calcSpecialActionBonus } from '@/core/anomalyPool'
import { distributeIntegerByWeight, getMainApplierSlot, ANOMALY_SINGLE_HIT_MULTIPLIER } from '@/core/anomalyPool/helpers'
import { computeInStunAnomalyTimeline } from '@/core/stunAxis/inStunAnomaly'
import type { AnomalySkillExecution } from '@/core/anomalyPool'
import { getAgentMechanic, getRegisteredAgentMechanics, type MechanicTeamMember } from '@/mechanics'
import { LIUYIN_EX_MOVE_IDS, computeLiuyinHugCounts, resolveUltimateTargetSlot, CINEMA6_ECHO_MAX, CINEMA6_ECHO_RATIO } from '@/mechanics/agents/liuyin'
import { computeLuciaHealPctPerUlt } from '@/mechanics/agents/luciaElowen'
import { computeBanyueMingwangStacks, computeBanyueInteractionTopUp, C6_ATTACH_RATIO, C6_MINGWANG_EXTRA, MINGWANG_BASE_PER_STACK } from '@/mechanics/agents/banyue'
import type { BanyueInteractionTopUp } from '@/mechanics/agents/banyue'
import { computeCorinStunBonusMoves, CORIN_ADDITIONAL_DMG } from '@/mechanics/agents/corin'
import { SIGRID_LANCE_SEGMENT_IDS, SIGRID_INFECTION_DMG } from '@/mechanics/agents/sigrid'
import { computeYixuanNingshenBonus } from '@/mechanics/agents/yixuan'
import { computePeiluoKagerouBonus, PEILUO_KAGEROU_CRIT } from '@/mechanics/agents/specPanelBuffs'
import type {
  CharacterOperationConfig,
  ResourceCalcConfig,
  TeamResourceResult,
  StunPoolResult,
  AnomalyPoolResult,
  SpecialActionBonusResult,
  SkillExecution,
  AnomalyEventRecord,
  AnomalyEventExecution,
  AnomalyProgress,
} from '@/types/resource'
import type { PanelValues, TeammateBuff, AgentSkills, SkillMove, Agent } from '@/types/catalog'
import { getSkillLevelCoef } from '@/core/skillLevel'
import { fmt } from '@/utils/format'
import * as ResourceCalcHelpers from './resourceCalc/helpers'
import type { DamagePoolRow, AnomalyVirtualPanelBuild } from './resourceCalc/helpers'

/** 琉音好评转大不动点迭代上限（好评≥90 开窗次数有界，正反馈单调收敛，8 轮兜底极端情况） */
const MAX_PROMOTE_ITER = 8
/**
 * 失衡次数 ↔ 资源池（连携=每失衡连携×失衡次数）↔ 失衡池 外不动点迭代上限。
 * 2026-08-24 实证（南宫羽C6+踉跄失衡延长+3s）：窗口延长加强「窗口↑→前台预算↓→失衡值↓→
 * 失衡次数↓」负反馈，整数边界间呈阻尼震荡（振幅≈×0.55/轮），12 轮不够落定 → 提到 20；
 * 收敛后结果不变，只多花极少数非收敛场景的轮次成本。
 */
const MAX_OUTER_ITER = 20

/**
 * 叠加琉音好评转大修正的资源池结果：
 * 60 转大 → 目标队友连携 -1、终结技 +1（替换）；90 转大 → 终结技 +1（白送）。
 * 倍率表 damage/daze/anomaly_buildup 由目标队友执行计划自然调用。
 * adj 来自 promoteFixpoint 的收敛结果（runCalcRound 的 R0/R1 内层不动点）。
 */
function applyLiuyinPromote(
  base: TeamResourceResult | null,
  adj: { promote: number; hug60: number; targetSlot: number; chainMoveId: string; ultimateMoveId: string } | null,
  catalogStore: ReturnType<typeof useCatalogStore>,
): TeamResourceResult | null {
  if (!base || !adj || adj.promote <= 0 || adj.targetSlot < 0) return base
  const { targetSlot, ultimateMoveId, promote } = adj
  return {
    ...base,
    characters: base.characters.map(char => {
      if (char.slot !== targetSlot) return char
      const skills = catalogStore.getAgentSkills(char.agentId)
      const ultMoveDef = findMoveById(skills, ultimateMoveId)
      const ultMult = ultMoveDef?.rows.find(r => r.id === 'damage')?.values[0] ?? 0
      const ultBuildUp = ultMoveDef?.rows.find(r => r.id === 'anomaly_buildup')?.values[0] ?? 0
      // 轴即最终次数：连携次数已从轴直接读出（N），60/90 转大只叠加赠送大招，不再「连携-1 大招+1」改写。
      // 转大白送的终结技独立成行（source='gift'），不并入目标原始终结技行——否则赠送归因（击破手对比的 gift 列）会丢失。
      return {
        ...char,
        ultimateCount: (char.ultimateCount ?? 0) + promote,
        executions: [
          ...char.executions,
          {
            moveId: ultimateMoveId,
            moveName: '好评转大·队友终结技',
            category: 'chain',
            count: promote,
            actionTime: 0,
            source: 'gift',
            comboAlignRatio: 0,
            totalTime: 0,
            totalComboAlignTime: 0,
            energyConsume: 0,
            totalEnergyConsume: 0,
            decibelRecovery: 0,
            totalDecibelRecovery: 0,
            energyRecovery: 0,
            totalEnergyRecovery: 0,
            damageMultiplier: ultMult,
            damageMultiplierOverride: ultMult > 0,
            anomalyBuildUp: ultBuildUp,
            totalAnomalyBuildUp: ultBuildUp * promote,
            skillTableNote: '好评转大：赠送队友终结技（白送，不耗喧响/能量）',
            skillDamageTarget: 'ultimate',
          },
        ],
      }
    }),
  }
}
const { parseReleaseMultiplier, safeElement, elementLabel, buildMechanicTeamMembers, computePanel, computeRemielleEntryPanel, getTeamAnomalyDurationBonus, getWindInfectionElement, getWindInfectionCoverage, buildAnomalyVirtualPanel, buildAnomalySettlementEntries, getRemielleLevelValue, remielleSpecialVoidflareCount, calcVoidflareDamage, findMoveById, enrichExecutionPlan, buildCharConfig, extractSkillExecutions, applyTeamMechanics } = ResourceCalcHelpers
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

  /**
 * 诺姆膛温换连携：帽子把戏触发上一位角色的快速支援→替换为连携技，连携归属上一位队友。
 * C4 时诺姆和对应代理人（上一位队友）各 +200 不可分享喧响（unshareableBonus，无伴随获取）。
 */
function applyNormaHatChain(
  base: TeamResourceResult | null,
  configStore: ReturnType<typeof useConfigStore>,
  catalogStore: ReturnType<typeof useCatalogStore>,
): TeamResourceResult | null {
  if (!base) return null
  const normaIdx = configStore.team.findIndex(char => {
    const a = char.agentId ? catalogStore.getAgent(char.agentId) : null
    return a?.id === '1571' || a?.teammateBuffId === '1571'
  })
  if (normaIdx < 0) return base
  const normaResult = base.characters.find(c => c.slot === normaIdx)
  const normaSrc = normaResult?.normaMechanicSource
  if (!normaSrc) return base
  const hatCount = Math.max(0, Math.floor(normaSrc.hatToChainCount))
  if (hatCount <= 0) return base

  // 上一位队友（环绕，排除自己）
  const targetSetting = configStore.getMechanicSetting('liuyin.ultimateTargetSlot', -1)
  const targetSlot = resolveUltimateTargetSlot(normaIdx, configStore.team.length, targetSetting)
  // 帽子把戏替换的是「上一位队友的快速支援→该队友本人的连携技」（用户口径：赠送连携给上一位队友打，
  // 不是诺姆替打自己的 1571018）——连携招式 id/倍率/时长全部取目标队友技能表。
  // C4 喧响（诺姆+队友各 200×次数）已由资源池 calcDecibelSource 计入（buildResourceResult 回写
  // cfg.normaHatToChainCount → 下一轮迭代注入 extraUnshareableDecibel，真实影响终结技次数），
  // applyNormaHatChain 只做连携赠送，不再重复注入喧响。
  // 赠送连携行需自带倍率表值（applyNormaHatChain 在 enrich 之后执行，不走 enrich 回填；
  // 缺倍率则伤害池按 damageMultiplier≤0 跳过、失衡池无 baseDaze——带上后伤害/失衡才进池）
  const targetAgentId = configStore.team[targetSlot]?.agentId ?? ''
  const targetSkills = catalogStore.getAgentSkills(targetAgentId)
  const chainInfo = targetSkills ? findChainAttack(targetSkills) : null
  if (!chainInfo) return base
  const giftedMove = findMoveById(targetSkills, chainInfo.moveId)
  const giftedDamage = giftedMove?.rows?.find(r => r.id === 'damage')?.values?.[0] ?? 0
  const giftedDaze = giftedMove?.rows?.find(r => r.id === 'daze')?.values?.[0] ?? 0
  const giftedAnomaly = giftedMove?.rows?.find(r => r.id === 'anomaly_buildup')?.values?.[0] ?? 0

  return {
    ...base,
    characters: base.characters.map(char => {
      if (char.slot !== targetSlot) return char
      // 上一位队友：连携次数 +hatCount、执行计划补其本人连携技执行（C4 喧响在资源池）
      return {
        ...char,
        chainCountTotal: (char.chainCountTotal ?? 0) + hatCount,
        executions: [...(char.executions ?? []), {
          moveId: chainInfo.moveId,
          moveName: `${giftedMove?.name?.zhCN || '连携技'}（诺姆膛温替换）`,
          category: 'chain',
          count: hatCount,
          actionTime: chainInfo.actionTime,
          comboAlignRatio: chainInfo.comboAlignRatio,
          totalTime: hatCount * chainInfo.actionTime,
          totalComboAlignTime: hatCount * chainInfo.actionTime * chainInfo.comboAlignRatio,
          energyConsume: 0,
          totalEnergyConsume: 0,
          decibelRecovery: chainInfo.decibelRecovery,
          totalDecibelRecovery: chainInfo.decibelRecovery * hatCount,
          energyRecovery: 0,
          totalEnergyRecovery: 0,
          damageMultiplier: giftedDamage,
          damageMultiplierOverride: giftedDamage > 0,
          dazeMultiplier: giftedDaze,
          dazeMultiplierOverride: giftedDaze > 0,
          anomalyBuildUp: giftedAnomaly,
          source: 'gift',
          skillTableNote: '诺姆预热膛温≥80%帽子把戏：上一位队友的快速支援替换为其本人连携技（招式与倍率取该队友技能表）',
          normaGiftChain: true,
        }],
      }
    }),
  }
}

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

  /** 爱丽丝配置（复用） */
  const aliceInfo = computed(() => {
    const slot = configStore.team.findIndex(c => c.agentId && (catalogStore.getAgent(c.agentId)?.id === '1401' || catalogStore.getAgent(c.agentId)?.teammateBuffId === '1401'))
    if (slot < 0) return null
    const cfg = resourceConfig.value?.characters[slot]
    if (!cfg?.aliceEnabled) return null
    const sparkCount = resourceResult.value?.characters.find(c => c.slot === slot)?.aliceSwordWillSource?.sparkCount ?? 0
    return { slot, coweringConfig: { dotRatio: cfg.aliceCoweringDotRatio ?? 2.5, dotInterval: cfg.aliceCoweringDotInterval ?? 0.95, disorderBonusPerSec: cfg.aliceCoweringDisorderBonusPerSec ?? 18, disorderBonusMax: cfg.aliceCoweringDisorderBonusMax ?? 180, assaultBaseMultiplier: 853 }, sparkCount }
  })

  /** 构建积蓄池（参数化 stunCoverage + 异常 execs） */
  function calcAnomalyPoolInput(stunCov: number, execs: AnomalySkillExecution[]) {
    if (execs.length === 0) return null
    const wind = windInfo.value; const alice = aliceInfo.value
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
      giftedTriggerCounts: alice && alice.sparkCount > 0 ? { 'physical_polar_assault': alice.sparkCount } : undefined,
      giftedTriggerSlot: alice?.slot,
      agentMechanics: getRegisteredAgentMechanics(),
    })
  }

  /** 琉音好评转大参数（从某轮资源池结果构建：目标队友、连携/终结技 moveId、好评总量、客诉抱拳数） */
  interface LiuyinPromoteParams {
    goodReviewTotal: number
    hug60Setting: number
    targetSlot: number
    chainMoveId: string
    ultimateMoveId: string
    chainCountPerStun: number
    ultDaze: number
    ultElement: string
  }
  function buildPromoteParams(rr: TeamResourceResult): LiuyinPromoteParams | null {
    const liuyinIdx = configStore.team.findIndex(char => {
      const a = char.agentId ? catalogStore.getAgent(char.agentId) : null
      return a?.id === '1481' || a?.teammateBuffId === '1481'
    })
    if (liuyinIdx < 0) return null
    const liuyinSrc = rr.characters.find(c => c.slot === liuyinIdx)?.liuyinMechanicSource
    if (!liuyinSrc) return null
    const hug60Setting = configStore.getMechanicSetting('liuyin.hug60Count', -1)
    const targetSetting = configStore.getMechanicSetting('liuyin.ultimateTargetSlot', -1)
    const targetSlot = resolveUltimateTargetSlot(liuyinIdx, configStore.team.length, targetSetting)
    const targetAgentId = configStore.team[targetSlot]?.agentId ?? ''
    const targetChar = rr.characters.find(c => c.slot === targetSlot)
    const targetSkills = targetAgentId ? catalogStore.getAgentSkills(targetAgentId) : undefined
    const ult = targetSkills ? findUltimate(targetSkills) : null
    const ultMove = ult?.moveId ? findMoveById(targetSkills, ult.moveId) : null
    const ultDaze = ultMove?.rows.find(r => r.id === 'daze')?.values[0] ?? 0
    const chain = targetSkills ? findChainAttack(targetSkills) : null
    const ultElement = (targetAgentId && catalogStore.getAgent(targetAgentId)?.damageElement) || 'physical'
    return {
      goodReviewTotal: liuyinSrc.goodReviewTotal,
      hug60Setting,
      targetSlot,
      chainMoveId: chain?.moveId ?? '',
      ultimateMoveId: ult?.moveId ?? '',
      chainCountPerStun: targetChar?.chainCountPerStun ?? 0,
      ultDaze,
      ultElement,
    }
  }

  /**
   * 转大不动点：抱拳命中→检查好评≥90 打开大招选择窗口→60 转大（有连携窗口：目标队友连携 -1、终结技 +1）
   * 或 90 转大（无连携窗口：终结技 +1）。倍率表全走目标队友执行计划自然调用。
   * 正反馈：转大终结技 daze 进失衡池 → 失衡次数变 → 60 抱拳默认按失衡次数 → 转大次数变；
   * 好评≥90 开窗次数（floor(好评/90)）是硬上限，正反馈单调有界必收敛（MAX_PROMOTE_ITER 轮兜底）。
   */
  function adjustStunExecs(
    execs: StunSkillExecution[],
    p: LiuyinPromoteParams,
    hug60: number,
    promote: number,
    subtractChain = true,
  ): StunSkillExecution[] {
    if (hug60 <= 0 && promote <= 0) return execs
    const out: StunSkillExecution[] = []
    let ultPushed = false
    for (const e of execs) {
      if (e.slot === p.targetSlot && e.moveId === p.ultimateMoveId) {
        if (promote > 0) { out.push({ ...e, count: e.count + promote }); ultPushed = true }
        else out.push(e)
      } else if (e.slot === p.targetSlot && e.moveId === p.chainMoveId) {
        // 无轴兜底：60转大消耗连携窗口 → 连携 daze 减 hug60；有轴：连携与60转大独立列出，不互相改写
        if (subtractChain && hug60 > 0) out.push({ ...e, count: Math.max(0, e.count - hug60) })
        else out.push(e)
      } else out.push(e)
    }
    if (promote > 0 && !ultPushed && p.ultDaze > 0) {
      out.push({
        moveId: p.ultimateMoveId,
        moveName: '好评转大·队友终结技',
        slot: p.targetSlot,
        count: promote,
        baseDaze: p.ultDaze,
        element: p.ultElement,
        skillType: 'ultimate',
      })
    }
    return out
  }

  /** 转大不动点：给定基础失衡 execs 与畏缩覆盖率，迭代（失衡次数 ↔ 好评转大次数）至收敛 */
  function promoteFixpoint(
    baseExecs: StunSkillExecution[],
    flinchRate: number,
    p: LiuyinPromoteParams | null,
    axisHug: { hug60: number; hug90: number } | null,
    axisMode: boolean,
    inAxisFractionProvider?: (stunCount: number, execs: StunSkillExecution[]) => Record<string, number>,
  ): { pool: StunPoolResult | null; hug60: number; promote: number; targetSlot: number; chainMoveId: string; ultimateMoveId: string } {
    const chainCountPerStun = configStore.team.reduce((sum, c) => sum + (c.chainCountPerStun ?? 0), 0)
    const runPool = (execs: StunSkillExecution[], inAxisFraction?: Record<string, number>) => calcStunPool({
      executions: execs, panels: panels.value, bossStunValue: configStore.enemy.stunValue,
      chainCountPerStun, enemyStunResistances: configStore.enemy.stunResistances ?? configStore.enemy.resistances ?? {},
      physicalFlinchCoverageRate: flinchRate,
      inAxisStunFractionByKey: inAxisFraction,
    })

    let stunCount = 0
    let hug60 = 0
    let promote = 0
    let pool: StunPoolResult | null = null
    const seenStunCounts = new Set<number>()
    for (let k = 0; k < MAX_PROMOTE_ITER; k++) {
      // 有轴时：60/90 转大次数直接读轴（轴即最终次数，无连携↔大招改写），否则按好评/连携窗口推导
      let hug90 = 0
      if (p && axisMode) {
        hug60 = axisHug?.hug60 ?? 0
        hug90 = axisHug?.hug90 ?? 0
      } else if (p) {
        const chainExecCount = baseExecs.find(e => e.slot === p.targetSlot && e.moveId === p.chainMoveId)?.count ?? 0
        const targetChainTotal = Math.min(p.chainCountPerStun * stunCount, chainExecCount)
        const hug = computeLiuyinHugCounts(p.goodReviewTotal, stunCount, p.hug60Setting, targetChainTotal)
        hug60 = hug.hug60
        hug90 = hug.hug90
      }
      promote = hug60 + hug90
      const execs = p && promote > 0 ? adjustStunExecs(baseExecs, p, hug60, promote, !axisMode) : baseExecs
      const inAxisFraction = inAxisFractionProvider ? inAxisFractionProvider(stunCount, execs) : undefined
      pool = runPool(execs, inAxisFraction)
      const next = pool?.stunCount ?? 0
      if (next === stunCount) break
      // 离散 floor 可能产生 2-循环（如 5→4→5），检测到重复即停，保留最后计算结果
      if (seenStunCounts.has(next)) break
      seenStunCounts.add(stunCount)
      stunCount = next
    }
    return {
      pool,
      hug60,
      promote,
      targetSlot: p?.targetSlot ?? -1,
      chainMoveId: p?.chainMoveId ?? '',
      ultimateMoveId: p?.ultimateMoveId ?? '',
    }
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
        axisActions.push({
          slot: act.slot,
          moveId: act.moveId,
          count: act.count,
          actionTime,
          energyCost,
          decibelCost,
          startTime: act.startTime ?? 0,
          // 佩洛伊斯右分支·永陷幽囚 = 决算：做完时清空窗口剩余失衡时间（填充归零+窗口截断）
          ...(act.moveId === '1551016' ? { endsStunWindow: true } : {}),
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

  function runCalcRound(stunCount: number, prevGoodReview: number, prevEnergyBySlot: Record<number, number>, prevAuricInkFlash = 0, prevAnomalyDecibelBonus: number[] = [], prevBanyueTopUp: BanyueInteractionTopUp = { parry: 0, dual: 0 }, prevYixuanFuFaForJufufu = 0, prevTeamUltimateForJufufu = 0, prevYeshuguangGiftUlt = 0, prevLucyTeammateEx = 0, prevLighterTeamEnergy = 0, prevAnbyZeroTeammateWl = 0, prevVivianTeamEx = 0, prevVivianAnomalyTriggers = 0, prevPromiaTriggerHits = 0, prevPromiaTeammateReleases = 0, prevInStunWindowTriggers = 0): {
    resourceResult: TeamResourceResult
    stunPool: StunPoolResult | null
    anomalyPool: AnomalyPoolResult | null
    adjustedResourceResult: TeamResourceResult | null
    promote: number
    hug60: number
    stunCoverage: number
    resolvedAxes: StunAxis[]
    matchedPlanName: string | null
    goodReview: number
    energyBySlot: Record<number, number>
    auricInkTriggerCount: number
    banyueTopUp: BanyueInteractionTopUp
    yixuanFuFaForJufufu: number
    teamUltimateForJufufu: number
    yeshuguangGiftUlt: number
    anbyZeroTeammateWl: number
    lucyTeammateEx: number
    lighterTeamEnergy: number
    vivianTeamEx: number
    vivianAnomalyTriggers: number
    promiaTriggerHits: number
    promiaTeammateReleases: number
    inStunWindowTriggers: number
  } | null {
    const base = resourceConfig.value
    if (!base || !catalogStore.ready) return null
    // 条件轴：按上一轮收敛出的好评/闪能（首轮缺省 → 条件方案未命中走兜底）解析生效轴
    const { axes: resolvedAxes, planName } = resolveAxes(stunCount, prevGoodReview, prevEnergyBySlot)
    const axisActive = (configStore.useStunAxis || autoActive.value) && resolvedAxes.length > 0
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
          if (act.moveId !== '1551016') continue
          const skills = catalogStore.getAgentSkills(configStore.team[act.slot]?.agentId ?? '')
          const move = findMoveById(skills, act.moveId)
          const dur = typeof (act as { duration?: number }).duration === 'number'
            ? (act as { duration: number }).duration
            : (move?.actionTime ?? 0)
          truncEnd = Math.max(truncEnd, Math.max(0, act.startTime ?? 0) + dur)
        }
        if (truncEnd >= 0) verdictSecondsLost += Math.max(0, windowDur - truncEnd) * wins
      })
    }
    // 当前轮失衡覆盖率（供诺姆火力实验高爆/破甲按失衡时长拆分；与 computeStunCoverage 同口径，含决算截断）
    const provStunCoverage = computeStunCoverage({ stunCount }, verdictSecondsLost)
    // 般岳轴模式自动补齐（保底语义，方案 A）：轴内怒相/终结技对嗔火/喧响有硬性需求，不足时抬双反（补嗔火）与弹刀（补喧响），
    // 有效次数 = 交互栏输入 + 补齐量（不写回 store，不覆盖用户输入）；计算轮间通过 prevBanyueTopUp 线程收敛。
    const banyueSlot = configStore.team.findIndex(c => c.agentId === '1471')
    // 保底开关（配装页「保底目标」勾选）：保底4嗔火 → 抬双反补嗔火；保底4喧响 → 抬弹刀补喧响。
    // 轴模式自动补齐（axisActive）之外，保底开关也可独立驱动（非轴亦生效）。
    const guaranteeFury = configStore.getMechanicSetting('guarantee.fury', 0) !== 0
    const guaranteeUltimate = configStore.getMechanicSetting('guarantee.ultimate', 0) !== 0
    const autoTopUp = (axisActive || guaranteeFury || guaranteeUltimate) && banyueSlot >= 0
      && configStore.getMechanicSetting('banyue.autoTopUpInteractions', 1) !== 0

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
    // 把当前失衡次数/覆盖率/战斗时间传给角色配置（诺姆火力实验导弹舱、炮塔全程射击依赖）
    // 各槽位轴内捏块总次数（块数×窗口数）：通用注入用（般岳分支与下方 merged 均取同一来源）
    const axisActionCountsBySlot: Record<number, Record<string, number>> = {}
    for (const c of base.characters) axisActionCountsBySlot[c.slot] = computeBanyueAxisExFor(c.slot)
    const characters = base.characters.map(cfg => {
      cfg.axisInSeconds = axisInSeconds
      // 轴模式：连携总次数完全由轴决定（未列连携块的槽位 = 0 次，轴即最终次数）
      const chainOverride = axisActive
        ? (axisChainTotal[cfg.slot] ?? 0)
        : undefined
      // 全队通用注入（无 agent 分支）：失衡时间覆盖率 + 本槽位轴内捏块计数。
      // 供需要「失衡内/外拆分」或「轴内精确次数」的模块自取（猫又 30/40 档穿刺用）；其余角色字段闲置。
      const merged = {
        ...(chainOverride !== undefined ? { ...cfg, chainCountTotalOverride: chainOverride } : cfg),
        teamStunCoverage: provStunCoverage,
        axisActionCounts: axisActionCountsBySlot[cfg.slot],
      }
      if (merged.agentId === '1571') {
        return { ...merged, normaStunCount: stunCount, normaStunCoverage: provStunCoverage, normaBattleTime: base.totalTime }
      }
      if (merged.agentId === '1251') {
        return { ...merged, qingyiStunCount: stunCount }
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
        // 影画1·追加落雷（用户口径）：按 CD 自动算次数——轴模式 floor(轴内时间/6)，非轴 floor(战斗时间/6)
        const yixuanCinema = Math.max(0, Math.floor(Number((merged as unknown as Record<string, unknown>).yixuanCinemaLevel ?? 0)))
        const battleTime = merged.battleTime ?? 180
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
        // 失衡内异常系统 v2（上一轮时间线）：每窗轴内异常触发数 → 颤音自动层数
        return { ...merged, inStunWindowTriggers: Math.max(0, prevInStunWindowTriggers) }
      }
      if (merged.agentId === '1541') {
        // 普罗米娅·霜刑回复端（上一轮池结果）：触发命中数 + 队友异放次数
        return {
          ...merged,
          promiaTriggerHitCount: Math.max(0, Math.floor(prevPromiaTriggerHits)),
          promiaTeammateReleaseCount: Math.max(0, Math.floor(prevPromiaTeammateReleases)),
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
    // 弹刀补齐量计入喧响奖励（保底语义，不写回 store；与般岳 cfg 注入同一口径）
    const parryForBonus = configStore.team.map((c, s) => (c.parryCount ?? 0) + (autoTopUp && s === banyueSlot ? prevBanyueTopUp.parry : 0))
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
      specialActionDecibelBonusPerSlot: specialBonusPerSlot,
      anomalyDecibelBonusPerSlot: anomalyBonusPerSlot,
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
      const decibelHave = rr.characters.reduce((s, c) => s + (c.decibelSource?.total ?? 0), 0)
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
      })
    }
    const baseStun = extractStunExecsFrom(rr)
    const baseAnomaly = extractAnomalyExecsFrom(rr)
    const p = buildPromoteParams(rr)
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

    // Round 0：无易伤 → 畏缩覆盖率初算
    const sp0 = promoteFixpoint(baseStun, 0, p, axisHug, axisMode, inAxisFractionProvider)
    const adj0 = applyLiuyinPromote(rr, sp0, catalogStore)
    const ap0 = calcAnomalyPoolInput(0, adj0 ? extractAnomalyExecsFrom(adj0) : baseAnomaly)

    // Round 1：含易伤 → 畏缩覆盖率修正 → 最终收敛
    const flinch1 = ap0?.coverage?.physicalCoverageRate ?? 0
    const sp1 = promoteFixpoint(baseStun, flinch1, p, axisHug, axisMode, inAxisFractionProvider)
    const adj1 = applyLiuyinPromote(rr, sp1, catalogStore)
    // 诺姆膛温换连携：帽子把戏触发上一位角色快速支援→替换为连携，连携归属上一位队友；C4 时诺姆+队友各 200 不可分享喧响。
    const adj2 = applyNormaHatChain(adj1 ?? rr, configStore, catalogStore)
    // 展示层：resourceResult 也带上诺姆赠送连携（执行计划/次数在资源利用率页可见），
    // 不动点/失衡池仍用原始 rr（baseStun），避免赠送连携失衡反作用于转大收敛
    const rrShown = applyNormaHatChain(rr, configStore, catalogStore) ?? rr

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
    const ap1 = calcAnomalyPoolInput(cov1, adj2 ? extractAnomalyExecsFrom(adj2) : baseAnomaly)

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
    {
      const exByAgent = new Map(rr.characters.map(ch => [ch.agentId, ch.exSpecialCount ?? 0]))
      const exCounts = characters.map(c => Math.max(0, exByAgent.get(c.agentId) ?? 0))
      if (characters.some(c => c.agentId === '1161')) {
        lighterTeamEnergyNext = estimateTeamNormalEnergyConsumed(characters, exCounts)
      }
      applyTeamMechanics({
        characters,
        configStore,
        catalogStore,
        phase: 'postRound',
        combatTime: base.totalTime ?? 180,
        exCounts,
        stunCount,
      })
    }

    // 薇薇安落羽生花双源（下一轮注入）：
    //   源1 = 全队强特命中次数（含薇薇安自己；同一招式至多一次）
    //   源2 = 全队异常触发次数（队友施加属性异常；0.5s CD 折算在模块内）
    // 普罗米娅·霜刑回复端（下一轮注入）：触发命中数 + 队友异放次数
    let promiaTriggerHitsNext = 0
    let promiaTeammateReleasesNext = 0
    if (characters.some(c => c.agentId === '1541')) {
      promiaTriggerHitsNext = ap1?.totalTriggerCount ?? 0
      promiaTeammateReleasesNext = (rrShown?.characters ?? rr.characters)
        .flatMap(ch => ch.anomalyEventExecutions ?? [])
        .filter(e => e.eventType === 'release' && e.count > 0)
        .reduce((sum, e) => sum + Math.floor(e.count), 0)
      if (prevPromiaTriggerHits <= 0 && prevPromiaTeammateReleases <= 0) {
        for (const c of characters) {
          if (c.agentId === '1541') {
            ;(c as any).promiaTriggerHitCount = promiaTriggerHitsNext
            ;(c as any).promiaTeammateReleaseCount = promiaTeammateReleasesNext
          }
        }
      }
    }
    // 失衡内异常系统 v2（下一轮注入）：轴内逐窗积蓄槽时间线 → 平均每窗触发次数
    let inStunWindowTriggersNext = 0
    if (axisActive && characters.some(c => c.agentId === '1511')) {
      const contribMap = new Map<string, { element: string; perHit: number }>()
      for (const prog of ap1?.perElement ?? []) {
        for (const c of prog.contributions ?? []) contribMap.set(c.moveId, { element: prog.element, perHit: c.perHitBuildUp })
      }
      const windows = resolvedAxes.map(axis => ({
        actions: (axis.actions ?? [])
          .filter(a => contribMap.has(a.moveId))
          .map(a => {
            const cm = contribMap.get(a.moveId)!
            return { element: cm.element, perHitBuildUp: cm.perHit, count: Math.max(0, Math.floor(a.count || 1)), startTime: a.startTime ?? 0 }
          }),
      }))
      const tl = computeInStunAnomalyTimeline({ windows, windowDuration: computeWindowDuration() })
      inStunWindowTriggersNext = windows.length > 0
        ? Math.round((tl.triggers.length / windows.length) * 10) / 10
        : 0
      if (prevInStunWindowTriggers <= 0) {
        for (const c of characters) {
          if (c.agentId === '1511') (c as any).inStunWindowTriggers = inStunWindowTriggersNext
        }
      }
    }
    let vivianTeamExNext = 0
    let vivianAnomalyTriggersNext = 0
    if (characters.some(c => c.agentId === '1331')) {
      const exByAgent = new Map(rr.characters.map(ch => [ch.agentId, ch.exSpecialCount ?? 0]))
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


    return {
      resourceResult: rrShown,
      stunPool: sp1.pool,
      anomalyPool: ap1,
      adjustedResourceResult: adj2,
      promote: sp1.promote,
      auricInkTriggerCount: ap1?.perElement?.find(p => p.element === 'ether_ink')?.triggerCount ?? 0,
      hug60: sp1.hug60,
      stunCoverage: cov1,
      resolvedAxes,
      matchedPlanName: planName,
      goodReview,
      energyBySlot,
      promiaTriggerHits: promiaTriggerHitsNext,
      promiaTeammateReleases: promiaTeammateReleasesNext,
      inStunWindowTriggers: inStunWindowTriggersNext,
      banyueTopUp: banyueTopUpNext,
      yixuanFuFaForJufufu: yixuanFuFaForJufufuNext,
      teamUltimateForJufufu: teamUltimateForJufufuNext,
      yeshuguangGiftUlt: yeshuguangGiftUltNext,
      anbyZeroTeammateWl: anbyZeroTeammateWlNext,
      lucyTeammateEx: lucyTeammateExNext,
      lighterTeamEnergy: lighterTeamEnergyNext,
      vivianTeamEx: vivianTeamExNext,
      vivianAnomalyTriggers: vivianAnomalyTriggersNext,
    }
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
    let stunCount = lockedStunCount >= 0 ? lockedStunCount : 0
    let out: ReturnType<typeof runCalcRound> = null
    let prevGoodReview = -1
    let prevEnergyBySlot: Record<number, number> = {}
    let prevAuricInkFlash = 0
    let prevYixuanFuFaForJufufu = 0
    let prevTeamUltimateForJufufu = 0
    let prevYeshuguangGiftUlt = 0
    let prevAnbyZeroTeammateWl = 0
    let prevLucyTeammateEx = 0
    let prevLighterTeamEnergy = 0
    let prevVivianTeamEx = 0
    let prevVivianAnomalyTriggers = 0
    let prevPromiaTriggerHits = 0
    let prevPromiaTeammateReleases = 0
    let prevInStunWindowTriggers = 0
    let prevAnomalyDecibelBonus: number[] = []
    let prevBanyueTopUp: BanyueInteractionTopUp = { parry: 0, dual: 0 }
    let prevUltSeq = ''
    let prevAnomalySeq = ''
    let prevTopUpSeq = ''
    const seenStunCounts = new Set<number>()
    // 收敛诊断（三层不动点第 ③ 层）：原先耗尽 MAX_OUTER_ITER 就静默 return 末轮结果——
    // 失衡次数/异常喧响奖励可能停在错误值而无任何信号。这里记录落地方式，拼进结果供界面与测试断言。
    let outerRounds = 0
    let outerConverged = false
    let outerExit: 'stable' | 'cycle' | 'maxIter' = 'maxIter'
    // 净失衡迭代（用户 Excel 口径）：覆盖率由上一轮失衡次数得出，非失衡占比缩放全来源净失衡，
    // 时间预算把超出的残失衡折成小数——正反馈被全局负反馈对抗，收敛到静止
    const stunWindowDur = computeWindowDuration()
    const stunEffTime = Math.max(0, (configStore.enemy.battleTime ?? 180) - (configStore.enemy.invincibleTime ?? 0))
    for (let k = 0; k < MAX_OUTER_ITER; k++) {
      outerRounds = k + 1
      // 锁定次数（用户明确意图）不走净失衡缩放与小数截断，仍用原始池计数
      const locked = lockedStunCount >= 0
      out = runCalcRound(stunCount, prevGoodReview, prevEnergyBySlot, prevAuricInkFlash, prevAnomalyDecibelBonus, prevBanyueTopUp, prevYixuanFuFaForJufufu, prevTeamUltimateForJufufu, prevYeshuguangGiftUlt, prevLucyTeammateEx, prevLighterTeamEnergy, prevAnbyZeroTeammateWl, prevVivianTeamEx, prevVivianAnomalyTriggers, prevPromiaTriggerHits, prevPromiaTeammateReleases, prevInStunWindowTriggers)
      const ait = out?.auricInkTriggerCount ?? 0
      const gr = out?.goodReview
      if (gr !== undefined && gr >= 0) prevGoodReview = gr
      const eb = out?.energyBySlot
      if (eb) prevEnergyBySlot = eb
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
      const feedbackStable = ultSeq === prevUltSeq && anomalySeq === prevAnomalySeq && topUpSeq === prevTopUpSeq
      if (lockedStunCount >= 0) {
        if (feedbackStable) { outerConverged = true; outerExit = 'stable'; break }
      } else {
        // 失衡次数与玄墨异常触发次数双稳定才收敛（异常触发 → 回闪能 → 强特 → 积蓄 → 触发）
        // 小数失衡时代：浮点比较改 0.05 容差；2-循环去重键取 0.1 粒度
        if (Math.abs(next - stunCount) < 0.05 && ait === prevAuricInkFlash && feedbackStable) { outerConverged = true; outerExit = 'stable'; break }
        if (seenStunCounts.has(Math.round(next * 10))) { outerExit = 'cycle'; break }
        seenStunCounts.add(Math.round(stunCount * 10))
        stunCount = next
      }
      prevAnomalyDecibelBonus = out?.anomalyPool?.perSlotBonus ?? []
      prevAuricInkFlash = ait
      prevBanyueTopUp = out?.banyueTopUp ?? prevBanyueTopUp
      prevYixuanFuFaForJufufu = out?.yixuanFuFaForJufufu ?? 0
      prevTeamUltimateForJufufu = out?.teamUltimateForJufufu ?? 0
      prevYeshuguangGiftUlt = out?.yeshuguangGiftUlt ?? 0
      prevAnbyZeroTeammateWl = out?.anbyZeroTeammateWl ?? 0
      prevLucyTeammateEx = out?.lucyTeammateEx ?? 0
      prevLighterTeamEnergy = out?.lighterTeamEnergy ?? 0
      prevVivianTeamEx = out?.vivianTeamEx ?? 0
      prevVivianAnomalyTriggers = out?.vivianAnomalyTriggers ?? 0
      prevPromiaTriggerHits = out?.promiaTriggerHits ?? 0
      prevPromiaTeammateReleases = out?.promiaTeammateReleases ?? 0
      prevInStunWindowTriggers = out?.inStunWindowTriggers ?? 0
      prevUltSeq = ultSeq
      prevAnomalySeq = anomalySeq
      prevTopUpSeq = topUpSeq
    }
    if (out?.resourceResult) {
      out = {
        ...out,
        resourceResult: {
          ...out.resourceResult,
          convergence: {
            ...out.resourceResult.convergence,
            outerConverged,
            outerRounds,
            outerExit,
          },
        },
      }
    }
    return out
  })

  // 下游统一从 calcOutput 取（名称保持，伤害池/结果页等无需改动）
  const resourceResult = computed<TeamResourceResult | null>(() => calcOutput.value?.resourceResult ?? null)
  const stunPoolResult = computed<StunPoolResult | null>(() => calcOutput.value?.stunPool ?? null)
  const anomalyPoolResult = computed<AnomalyPoolResult | null>(() => calcOutput.value?.anomalyPool ?? null)
  const adjustedResourceResult = computed<TeamResourceResult | null>(() => calcOutput.value?.adjustedResourceResult ?? null)
  /** 琉音好评转大收敛后的转大次数（60+90 抱拳之和），供伤害池/影画6/倍率表消费 */
  const liuyinPromoteCount = computed(() => calcOutput.value?.promote ?? 0)
  /** 琉音好评转大收敛后的 60 抱拳次数（被替换掉的连携数） */
  const liuyinHug60Count = computed(() => calcOutput.value?.hug60 ?? 0)

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

  /** 特殊动作喧响奖励 */
  const specialActionBonus = computed<SpecialActionBonusResult | null>(() => {
    const topUp = banyueInteractionTopUp.value
    const perSlotParry = configStore.team.map((c, s) => (c.parryCount ?? 0) + (topUp && s === topUp.slot ? topUp.parry : 0))
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

  /** 伴随事件（父动作完全落在窗口内 → 子事件吃易伤）：child moveId → 0/1 */
  const attachedInAxisMap = computed<Record<string, number>>(() => {
    const out: Record<string, number> = {}
    if (!stunAxisResult.value) return out
    const parentsInWindow: Record<string, boolean> = {}
    for (const detail of stunAxisResult.value.axisDetails) {
      for (const a of detail.actions) {
        // actionKey = `${slot}:${moveId}`；moveId 可能是 'basic'（无伴随事件，跳过）
        const moveId = a.actionKey.split(':').slice(1).join(':')
        if (a.inAxisRatio === 1) parentsInWindow[moveId] = true
      }
    }
    for (const char of configStore.team) {
      if (!char.agentId) continue
      const mod = getAgentMechanic(char.agentId)
      if (!mod?.attachedEvents) continue
      for (const [parent, children] of Object.entries(mod.attachedEvents)) {
        const inWindow = parentsInWindow[parent] ? 1 : 0
        for (const child of children) out[child] = inWindow
      }
    }
    return out
  })

  /** 伤害池：按角色/事件拆分直伤、异放、乱流（消费转大修正后的执行计划） */
  const damagePoolRows = computed<DamagePoolRow[]>(() => {
    if (!adjustedResourceResult.value || damagePanels.value.length === 0) return []
    const rows: DamagePoolRow[] = []
    const enemyDamageRes = configStore.enemy.damageResistances ?? configStore.enemy.resistances ?? {}
    const isAxis = (configStore.useStunAxis || autoActive.value) && stunAxisResult.value
    const allocMap = axisAllocation.value
    const attachedInAxis = attachedInAxisMap.value
    // 轴内涉及的槽位（有轴内动作的槽位）；其余槽位（如换了辅助、没进轴）走全局覆盖率「单独算」
    const axisSlots = new Set<number>()
    for (const a of Object.values(allocMap)) axisSlots.add(a.slot)
    // 记录已认领的轴内单位数，避免同 moveId 多行（如诺姆膛温换连携）重复认领
    const claimedInAxis: Record<string, number> = {}

    function agentName(agentId: string, slot: number) {
      return agentNames.value[agentId] || catalogStore.getAgent(agentId)?.name?.zhCN || `槽${slot + 1}`
    }
    const infectionElement = getWindInfectionElement(configStore, catalogStore)
    const windSlot = configStore.team.findIndex(c => {
      const agent = c.agentId ? catalogStore.getAgent(c.agentId) : null
      return agent?.damageElement === 'wind'
    })

    /** 把一个 (slot, moveId) 的总单位数切成轴内/轴外两段（轴外段无易伤） */
    function axisSplitFor(slot: number, moveId: string, totalUnits: number): { inUnits: number; outUnits: number } {
      if (!isAxis) return { inUnits: 0, outUnits: totalUnits }
      const key = `${slot}:${moveId === 'basic_attack' ? 'basic' : moveId}`
      const alloc = allocMap[key]
      if (!alloc || alloc.inAxisUnits <= 0) return { inUnits: 0, outUnits: totalUnits }
      const already = claimedInAxis[key] ?? 0
      const remainingIn = Math.max(0, alloc.inAxisUnits - already)
      const inUnits = Math.min(remainingIn, totalUnits)
      claimedInAxis[key] = already + inUnits
      return { inUnits, outUnits: totalUnits - inUnits }
    }

    /** 伴随事件易伤：非轴模式用全局覆盖率；轴模式跟随父动作是否完全落在窗口内（0/1） */
    function axisStunFor(moveId: string): number {
      if (!isAxis) return stunCoverage.value
      return attachedInAxis[moveId] ?? 0
    }

    function pushDirect(row: {
      id: string; slot: number; agentId: string; name: string; element: string; source: string; count: number; multiplier: number; note?: string; skillDamageTarget?: any; moveId?: string; critRateBonus?: number; critDmgBonus?: number; dmgBonus?: number; sheerDmgBonus?: number; flatDamageBonus?: number; resIgnore?: number; basisValueOverride?: number; basisLabelOverride?: string; stunOverride?: number; defIgnore?: number; penRatioBonus?: number; sourceTag?: 'gift' | 'stun' | 'self'
    }) {
      if (row.count <= 0 || row.multiplier <= 0) return
      const basePanel = damagePanels.value[row.slot]
      if (!basePanel) return
      // 行级穿透率（如希格莉德影画2 出枪式/敛枪式 +24%）：浅克隆面板叠加 penRatio，其余字段不变
      const panel = row.penRatioBonus
        ? { ...basePanel, penRatio: (basePanel.penRatio ?? 0) + row.penRatioBonus }
        : basePanel
      const stunForThis = row.stunOverride !== undefined
        ? row.stunOverride
        : stunCoverage.value
      // 叶瞬光帷幕易伤：满易伤时倍率 = min(boss.stunVuln, panel.yeshuguangStunCapMult ?? 2.1)
      let stunBase = configStore.enemy.stunVuln
      if (row.agentId === '1431' && (panel as any).yeshuguangStunCapMult && stunForThis > 0) {
        stunBase = Math.min(stunBase, Number((panel as any).yeshuguangStunCapMult) || 2.1)
      }
      const stunMultVal = stunForThis > 0
        ? 1 + (stunBase - 1) * stunForThis
        : 1
      const rowAgent = catalogStore.getAgent(row.agentId)
      const result = calcDirectDamage({
        panel,
        skillMultiplier: row.multiplier,
        damageElement: safeElement(row.element),
        damageBasis: 'atk',
        enemyDefense: configStore.enemy.defense,
        enemyDefReduction: row.defIgnore ?? 0,
        enemyDefFlatReduction: 0,
        enemyLevel: configStore.enemy.level,
        enemyResistance: enemyDamageRes[row.element] ?? 0,
        enemyResReduction: (panel.enemyResReduction ?? 0) + (row.resIgnore ?? 0),
        stunMultiplier: stunBase,
        stunned: stunForThis,
        critMode: 'expect',
        count: row.count,
        skillDamageTarget: row.skillDamageTarget,
        critRateBonus: row.critRateBonus,
        critDmgBonus: row.critDmgBonus,
        dmgBonus: row.dmgBonus,
        sheerDmgBonus: row.sheerDmgBonus,
        flatDamageBonus: row.flatDamageBonus,
        infectionElement,
        basisValueOverride: row.basisValueOverride,
        basisLabelOverride: row.basisLabelOverride,
        specialDamageProfile: rowAgent ? resolveSpecialDamageProfile(rowAgent) : undefined,
      })
      rows.push({
        id: row.id,
        slot: row.slot,
        agentId: row.agentId,
        agentName: agentName(row.agentId, row.slot),
        type: '直伤',
        name: row.name,
        element: row.element,
        source: row.source,
        count: row.count,
        perDamage: row.count > 0 ? result.damage / row.count : 0,
        totalDamage: result.damage,
        note: row.note ?? '',
        stunMult: stunMultVal,
        moveId: row.moveId,
        sourceTag: row.sourceTag,
      })
    }

    function pushRelease(row: { id: string; slot: number; agentId: string; name: string; count: number; multiplier: number; source: string; note?: string; element?: string; panel?: PanelValues; settlementPanel?: PanelValues; releaseCrit?: AnomalyEventExecution['releaseCrit'] }) {
      if (row.count <= 0 || row.multiplier <= 0) return
      const basePanel = row.panel ?? damagePanels.value[row.slot]
      const settlementPanel = row.settlementPanel ?? basePanel
      if (!basePanel) return
      const element = row.element ?? 'wind'
      const releaseMod = getAgentMechanic(row.agentId)?.releaseModifier?.({ panels: damagePanels.value })
        ?? { enemyResReduction: 0, note: '' }
      // 异放专属暴击（如爱芮影画1）：掌控超过阈值后每点额外加暴击率
      const critOverride = row.releaseCrit
        ? {
            rate: row.releaseCrit.ratePct
              + Math.max(0, (settlementPanel?.anomalyMastery ?? 0) - (row.releaseCrit.masteryThreshold ?? 0))
                * (row.releaseCrit.masteryPerPointRatePct ?? 0),
            dmg: row.releaseCrit.dmgPct,
            labelPrefix: '异放暴击',
          }
        : undefined
      const result = calcAnomalyDamage({
        panel: basePanel,
        settlementPanel,
        baseMultiplier: row.multiplier,
        element: element as any,
        enemyDefense: configStore.enemy.defense,
        enemyDefReduction: 0,
        enemyDefFlatReduction: 0,
        enemyLevel: configStore.enemy.level,
        enemyResistance: enemyDamageRes[element] ?? 0,
        enemyResReduction: (settlementPanel?.enemyResReduction ?? 0) + releaseMod.enemyResReduction,
        stunned: stunCoverage.value,
        stunMultiplier: configStore.enemy.stunVuln,
        critMode: 'expect',
        damageKind: 'release',
        anomalyMultiplier: remielleAnomalyMultiplier.value,
        anomalyCritOverride: critOverride,
      })
      rows.push({
        id: row.id,
        slot: row.slot,
        agentId: row.agentId,
        agentName: agentName(row.agentId, row.slot),
        type: '异放',
        name: row.name,
        element,
        source: row.source,
        count: row.count,
        perDamage: result.damage,
        totalDamage: result.damage * row.count,
        note: `${row.note ?? ''}${releaseMod.note}`,
      })
    }

    /** 解析异放倍率：固定 releaseMultiplier（Type A）或「原异常单次倍率 × 比例」（Type B） */
    function releaseMultiplierFor(event: AnomalyEventExecution, element: string, triggerPanel: PanelValues, stunCov: number): number {
      if (event.releaseRatio) {
        const rr = event.releaseRatio
        const perTenPct = rr.perTenByElement[element] ?? 0
        const stunMult = (rr.stunBonusPct ?? 0) > 0 ? 1 + ((rr.stunBonusPct ?? 0) / 100) * stunCov : 1
        // 「相对于原属性异常伤害的比例」句式（南宫羽颤音异放）：倍率 = 原异常单次倍率 × 元素比例%
        if (rr.basis === 'anomalyDamageRatio') return (ANOMALY_SINGLE_HIT_MULTIPLIER[element] ?? 0) * (perTenPct / 100) * stunMult
        const basisValue = Number(triggerPanel[rr.basis] ?? 0)
        return (ANOMALY_SINGLE_HIT_MULTIPLIER[element] ?? 0) * (basisValue / 10) * (perTenPct / 100) * stunMult
      }
      return parseReleaseMultiplier(event)
    }

    const seenDirectIds = new Map<string, number>()
    for (const charResult of adjustedResourceResult.value.characters) {
      const slot = charResult.slot
      const agent = catalogStore.getAgent(charResult.agentId)
      const skills = catalogStore.getAgentSkills(charResult.agentId)

      for (const exec of charResult.executions) {
        if ((exec.damageMultiplier ?? 0) <= 0) continue
        // 秒均行（普通平A basic_attack 等）：count=0、totalTime=秒数、damageMultiplier=秒均倍率%。
        // 伤害 = 秒均倍率 × 时间，按 1 次、总倍率结算（通用逻辑：所有角色平A都是秒均倍率算的）。
        const isPerSecondRow = exec.count <= 0 && (exec.totalTime ?? 0) > 0
        if (!isPerSecondRow && exec.count <= 0) continue
        // 琉音三个强特（石头/剪刀/布）在非失衡轴模式下由下方专用块按“失衡次数”拆分易伤，跳过通用直伤。
        if (charResult.agentId === '1481' && !isAxis && LIUYIN_EX_MOVE_IDS.has(exec.moveId)) continue
        const move = findMoveById(skills, exec.moveId)
        const mechanic = getAgentMechanic(charResult.agentId)
        const burniceCinema = charResult.agentId === '1171' ? configStore.team[slot]?.cinemaLevel ?? 0 : 0
        const critRateBonus = (burniceCinema >= 4 && (exec.category === 'special' || exec.category === 'assist') ? 30 : 0) + (exec.critRateBonus ?? 0)
        const critDmgBonus = exec.critDmgBonus ?? 0
        // 招式限定抗性无视：执行字段（模块 patchExecutions 写入，如仪玄影画2 终/强特 15% 以太减抗）+ 柏妮思 C6 特判
        const resIgnore = (exec.resIgnore ?? 0) + (burniceCinema >= 6 && (exec.moveId === '1171012' || exec.moveId === '1171013') ? 25 : 0)
        const resolved = mechanic?.resolveExecutionDamage?.({
          slot,
          agent: agent ?? null,
          skills,
          move,
          exec,
          team: buildMechanicTeamMembers(configStore, catalogStore),
          cinemaLevel: configStore.team[slot]?.cinemaLevel ?? 0,
        })
        const element = resolved?.element ?? move?.damageElement ?? agent?.damageElement ?? 'physical'
        const execPanel = damagePanels.value[slot]
        const execSkillLevelBonus = execPanel?.skillLevelBonus ?? 0
        const execDamageCoef = execSkillLevelBonus > 0 ? getSkillLevelCoef(execSkillLevelBonus).damageCoef : 1
        // 同 slot 同 moveId 多行（如诺姆膛温替换连携 vs 通用连携）id 加序号去重
        const baseId = `direct-${slot}-${exec.moveId}`
        const dup = seenDirectIds.get(baseId) ?? 0
        seenDirectIds.set(baseId, dup + 1)
        const rowId = dup > 0 ? `${baseId}-${dup}` : baseId
        const unitMultiplier = (exec.damageMultiplier ?? 0) * execDamageCoef
        const totalUnits = isPerSecondRow ? (exec.totalTime ?? 0) : exec.count
        const baseNote = `${resolved?.note ?? exec.skillTableNote ?? ''}${isPerSecondRow ? '（平A：秒均倍率 × 时间）' : ''}${execSkillLevelBonus > 0 ? ` · 技能等级系数×${execDamageCoef.toFixed(4)}` : ''}`
        const emitExecDirect = (units: number, stunOverride: number, idSuffix: string, extraNote: string, sourceTag?: 'gift' | 'stun' | 'self') => {
          if (units <= 0 || unitMultiplier <= 0) return
          // 般岳明王：6命满覆盖（applyPanel 全局 +39%）；非6命轴模式按时间轴扫描层数（8s 窗口，怒相二连触发）；
          // 非6命非轴模式按覆盖率滑块近似（满层3×5%×覆盖率）
          let mingwangDmgBonus = 0
          const banyueCinema = configStore.team[slot]?.cinemaLevel ?? 0
          if (charResult.agentId === '1471' && (execPanel?.additionalAbilityActive ?? 0) > 0 && banyueCinema < 6) {
            if (isAxis) {
              const stacks = banyueMingwangStacks.value.get(exec.moveId ?? '') ?? 0
              if (stacks > 0) mingwangDmgBonus = stacks * MINGWANG_BASE_PER_STACK
            } else {
              const cov = Math.max(0, Math.min(1, configStore.getMechanicSetting('banyue.mingwangCoverage', 0.5)))
              mingwangDmgBonus = MINGWANG_BASE_PER_STACK * 3 * cov
            }
          }
          // 可琳额外能力扫除帮手：命中失衡敌人自身伤害+35%。
          // 轴模式按 buff 轴扫描（轴内所有招式都在失衡窗口内，普攻段归并 basic_attack 聚合行键），
          // 且只吃轴内段（stunOverride=0 的轴外段敌人未失衡，不符合「命中失衡敌人」条件）；
          // 非轴模式按覆盖率滑块近似（默认 0.5，用户口径）
          let corinStunBonus = 0
          if (charResult.agentId === '1061' && (execPanel?.additionalAbilityActive ?? 0) > 0) {
            if (isAxis) {
              corinStunBonus = stunOverride > 0 ? (corinStunBonusMap.value.get(exec.moveId ?? '') ?? 0) : 0
            } else {
              const cov = Math.max(0, Math.min(1, configStore.getMechanicSetting('corin.additionalStunCoverage', 0.5)))
              corinStunBonus = CORIN_ADDITIONAL_DMG * cov
            }
          }
          // 希格莉德额外能力·天际联军：命中[浸染]敌人伤害+15% × 风化侵染覆盖率
          // （用户口径 2026-02：直接读风化覆盖率；damagePanels 已盖章 windInfectionRate，无风角色=0）
          let sigridInfectionBonus = 0
          if (charResult.agentId === '1591' && (execPanel?.additionalAbilityActive ?? 0) > 0) {
            const rate = Math.max(0, Math.min(1, Number(execPanel?.windInfectionRate ?? 0)))
            sigridInfectionBonus = SIGRID_INFECTION_DMG * rate
          }
          // 仪玄凝神：6 命默认满覆盖（调息送大量符法千重，用户口径：暴伤+40% + 贯穿+20%，不走轴扫描），
          // yixuan.c6NingshenCoverage 滑块可调；非 6 命轴模式按 buff 轴扫描（大招后 15s 窗口），非轴模式按滑块近似（仅暴伤）
          const yixuanCinema = configStore.team[slot]?.cinemaLevel ?? 0
          const yixuanNingshen = charResult.agentId === '1371' && (execPanel?.additionalAbilityActive ?? 0) > 0
            ? (yixuanCinema >= 6
              ? {
                  critDmg: Math.round(40 * Math.max(0, Math.min(1, configStore.getMechanicSetting('yixuan.c6NingshenCoverage', 1)))),
                  sheerDmg: Math.round(20 * Math.max(0, Math.min(1, configStore.getMechanicSetting('yixuan.c6NingshenCoverage', 1)))),
                }
              : isAxis
                ? (yixuanNingshenMap.value.get(exec.moveId ?? '') ?? { critDmg: 0, sheerDmg: 0 })
                : { critDmg: Math.round(40 * Math.max(0, Math.min(1, configStore.getMechanicSetting('yixuan.ningshenCoverage', 0.5)))), sheerDmg: 0 })
            : { critDmg: 0, sheerDmg: 0 }
          // 佩洛伊斯阳炎：轴模式按 buff 轴扫描（上分支后 21s 窗口，仅上分支/决算终结吃），非轴按覆盖率滑块（默认满）
          const peiluoKagerouCoverage = Math.max(0, Math.min(1, configStore.getMechanicSetting('peiluo.kagerouCoverage', 1)))
          // 非轴模式配对折算：上分支全吃；决算按 min(上分支,决算)/决算 的比例吃（无上分支铺垫的决算不吃）
          const peiluoPairRatio = exec.moveId === '1551016' ? ((exec as any).peiluoKagerouPairRatio ?? 0) : 1
          const peiluoKagerouCrit = charResult.agentId === '1551'
            ? (isAxis
              ? (peiluoKagerouMap.value.get(exec.moveId ?? '') ?? 0)
              : PEILUO_KAGEROU_CRIT * peiluoKagerouCoverage * peiluoPairRatio)
            : 0
          pushDirect({
            id: `${rowId}${idSuffix}`,
            slot,
            agentId: charResult.agentId,
            name: exec.moveName,
            element,
            source: resolved?.source ?? exec.moveId,
            count: isPerSecondRow ? 1 : units,
            multiplier: unitMultiplier * (isPerSecondRow ? units : 1),
            note: `${baseNote}${extraNote}${mingwangDmgBonus > 0 ? ` · 明王+${mingwangDmgBonus.toFixed(1)}%${isAxis ? '（轴内覆盖）' : '（覆盖率近似）'}` : ''}${corinStunBonus > 0 ? ` · 失衡增伤+${corinStunBonus.toFixed(1)}%${isAxis ? '（buff轴）' : '（覆盖率近似）'}` : ''}${sigridInfectionBonus > 0 ? ` · 浸染增伤+${sigridInfectionBonus.toFixed(1)}%（风化覆盖率×15%）` : ''}${yixuanNingshen.critDmg > 0 ? ` · 凝神暴伤+${yixuanNingshen.critDmg.toFixed(0)}%${isAxis ? '（buff轴）' : '（覆盖率近似）'}` : ''}${yixuanNingshen.sheerDmg > 0 ? ` · 凝神贯穿+${yixuanNingshen.sheerDmg.toFixed(0)}%` : ''}`,
            moveId: exec.moveId,
            critRateBonus,
            critDmgBonus: critDmgBonus + yixuanNingshen.critDmg + peiluoKagerouCrit,
            dmgBonus: (exec.dmgBonus ?? 0) + mingwangDmgBonus + corinStunBonus + sigridInfectionBonus,
            sheerDmgBonus: (exec.sheerDmgBonus ?? 0) + yixuanNingshen.sheerDmg,
            flatDamageBonus: exec.flatDamageBonus,
            basisValueOverride: exec.basisValueOverride,
            basisLabelOverride: exec.basisLabelOverride,
            resIgnore,
            defIgnore: exec.defIgnore ?? 0,
            penRatioBonus: exec.penRatioBonus,
            skillDamageTarget: exec.skillDamageTarget,
            stunOverride,
            sourceTag: sourceTag ?? exec.source,
          })
        }
        if (isAxis && exec.normaGiftChain) {
          // 诺姆膛温换连携（赠送连携招式=上一位队友本人的连携技，注入时带 normaGiftChain 标记）：
          // 吃失衡易伤的次数 = 轴内实际执行的赠块数（':gift' 后缀 key，受窗口时间门控：占时间、超窗跳过）
          // 或旧表达 norma-hat-chain 标记块；其余赠送在失衡外触发、不吃易伤。
          let giftInUnits = 0
          for (const [key, alloc] of Object.entries(allocMap)) {
            if (key.endsWith(':norma-hat-chain') || key.endsWith(':gift')) giftInUnits += alloc.inAxisUnits
          }
          const inUnits = Math.min(totalUnits, Math.max(0, giftInUnits))
          emitExecDirect(inUnits, 1, '', '', exec.source)
          emitExecDirect(totalUnits - inUnits, 0, '-out', ' · 轴外（无失衡易伤）')
        } else if (isAxis && exec.autoSplitByStun) {
          // CD 驱动的后台自动行（通用机制，如猫又超凶爪印每秒 dot）：不按捏轴认领、无放置语义，
          // 轴模式改按失衡时间占比拆「占比内吃满易伤 / 其余无易伤」（非轴模式本就走全局覆盖率）。
          // 附加在特定招式上的事件不走此路——它们经 attachedEvents 跟随父动作判断是否在轴内。
          const inUnits = Math.min(totalUnits, Math.round(totalUnits * Math.max(0, Math.min(1, stunCoverage.value))))
          emitExecDirect(inUnits, 1, '', ' · 失衡内（CD自动行按占比）')
          emitExecDirect(totalUnits - inUnits, 0, '-out', ' · 轴外（CD自动行按占比，无易伤）')
        } else if (isAxis && axisSlots.has(slot)) {
          // 捏轴：把总单位切成轴内（易伤=1）/轴外（易伤=0）两段
          const split = axisSplitFor(slot, exec.moveId, totalUnits)
          emitExecDirect(split.inUnits, 1, '', '', exec.source)
          emitExecDirect(split.outUnits, 0, '-out', ' · 轴外（无失衡易伤）')
        } else if (charResult.agentId === '1431' && YESHUGUANG_FULL_STUN_MOVES.has(exec.moveId)) {
          // 叶瞬光白毛：关键伤害一律满易伤（帷幕易伤），真失衡只送连携；上限 210%/300% 在 pushDirect 处理
          emitExecDirect(totalUnits, 1, '', ' · 明心境满易伤', exec.source)
        } else {
          // 未进轴的槽位（如换的辅助、没捏进轴）按全局覆盖率单独算
          emitExecDirect(totalUnits, stunCoverage.value, '', '', exec.source)
        }
      }

      for (const event of charResult.anomalyEventExecutions ?? []) {
        if (event.count <= 0) continue
        if (event.eventType === 'release') {
          const triggerPanel = damagePanels.value[slot]
          if (event.element === 'dominant') {
            // 异放元素 = 目标当前异常状态，按异常覆盖率占比分配次数（柏妮思/爱芮同款）
            const totalRelease = Math.max(0, Math.floor(event.count))
            const coverageRates = anomalyPoolResult.value?.coverage?.perElementCoverageRate ?? {}
            let candidates = Object.entries(coverageRates)
              .filter(([, rate]) => rate > 0)
              .map(([element, rate]) => ({ element, autoRatio: rate }))
            if (candidates.length === 0) candidates = [{ element: agent?.damageElement ?? 'physical', autoRatio: 1 }]
            const settingNs = event.eventId.split('_')[0] ?? 'release'
            const userWeights = candidates.map(({ element, autoRatio }) => ({
              element,
              weight: Math.max(0, configStore.getMechanicSetting(`${settingNs}.releaseShare:${element}`, autoRatio)),
            }))
            const totalWeight = userWeights.reduce((sum, item) => sum + item.weight, 0)
            const effectiveWeights = totalWeight > 0
              ? userWeights
              : candidates.map(({ element, autoRatio }) => ({ element, weight: autoRatio }))
            const effectiveTotal = effectiveWeights.reduce((sum, item) => sum + item.weight, 0) || 1
            const counts = distributeIntegerByWeight(
              totalRelease,
              effectiveWeights.map(item => item.weight / effectiveTotal),
            )
            for (let i = 0; i < effectiveWeights.length; i++) {
              const count = counts[i] ?? 0
              if (count <= 0) continue
              const element = effectiveWeights[i].element
              const prog = anomalyPoolResult.value?.perElement.find(p => p.element === element)
              const baseSlot = prog ? getMainApplierSlot(prog.contributions) : slot
              pushRelease({
                id: `release-${slot}-${event.eventId}-${element}`,
                slot,
                agentId: charResult.agentId,
                name: event.eventName,
                count,
                multiplier: releaseMultiplierFor(event, element, triggerPanel, stunCoverage.value),
                source: event.carrierMoveName || event.carrierMoveId || event.eventId,
                note: `${event.note ?? ''}；${element}异常覆盖占比分配`,
                element,
                panel: damagePanels.value[baseSlot] ?? triggerPanel,
                settlementPanel: triggerPanel,
                releaseCrit: event.releaseCrit,
              })
            }
            continue
          }
          pushRelease({
            id: `release-${slot}-${event.eventId}`,
            slot: slot,
            agentId: charResult.agentId,
            name: event.eventName,
            count: event.count,
            multiplier: releaseMultiplierFor(event, event.element ?? 'wind', triggerPanel, stunCoverage.value),
            source: event.carrierMoveName || event.carrierMoveId || event.eventId,
            note: event.note,
            element: event.element ?? 'wind',
            settlementPanel: triggerPanel,
            releaseCrit: event.releaseCrit,
          })
        } else if (event.eventType === 'polar_disorder') {
          // 极性紊乱 = 原本[紊乱]效果的25%伤害（池收敛后取紊乱均伤），不清除目标异常状态；
          // C2 门控在模块侧。状态判定（用户口径：极性紊乱触发需依据目标当前异常状态）：
          // dominant 时元素取当前活跃异常的主元素（覆盖率最高者）——完整逐事件状态机见 SOP §3.8 待建系统
          const dd = anomalyPoolResult.value?.disorderDamage
          const perEvent = (dd?.avgDamage ?? 0) * 0.25
          let polarElement = event.element
          if (polarElement === 'dominant') {
            const rates = anomalyPoolResult.value?.coverage?.perElementCoverageRate ?? {}
            const best = Object.entries(rates).filter(([, r]) => r > 0).sort((a, b) => b[1] - a[1])[0]?.[0]
            polarElement = best ?? agent?.damageElement ?? 'ether'
          }
          if (perEvent > 0 && event.count > 0) {
            rows.push({
              id: `polar-${slot}-${event.eventId}`,
              slot,
              agentId: charResult.agentId,
              agentName: agentName(charResult.agentId, slot),
              type: '极性紊乱',
              name: event.eventName,
              element: safeElement(polarElement),
              source: event.carrierMoveName || event.carrierMoveId || event.eventId,
              count: event.count,
              perDamage: perEvent,
              totalDamage: perEvent * event.count,
              note: event.note ?? '',
            })
          }
        }
      }

      const burniceSrc = charResult.burniceMechanicSource
      if (charResult.agentId === '1171' && burniceSrc) {
        const burniceSkillCoef = (() => {
          const bonus = damagePanels.value[slot]?.skillLevelBonus ?? 0
          return bonus > 0 ? getSkillLevelCoef(bonus).damageCoef : 1
        })()
        if (burniceSrc.emberTotalTriggerCount > 0 && burniceSrc.emberDamageRatioWithMastery > 0) {
          pushDirect({
            id: 'burnice-ember',
            slot,
            agentId: charResult.agentId,
            name: '柏妮思余烬（含搅拌式附带）',
            element: 'fire',
            source: `普通余烬 ${burniceSrc.emberTriggerCount} 次 + 搅拌式附带 ${burniceSrc.stirringFreeEmberCount} 次`,
            count: burniceSrc.emberTotalTriggerCount,
            multiplier: burniceSrc.emberDamageRatioWithMastery,
            note: `${burniceSrc.emberDamageRatio}%攻击 × (1 + 精通加成)，基础积蓄60`,
            critRateBonus: burniceSrc.cinema4CritRateBonus,
            skillDamageTarget: 'assist',
          })
        }
        if (burniceSrc.stirringCount > 0 && burniceSrc.stirringDamageRatio > 0) {
          pushDirect({
            id: 'burnice-stirring',
            slot,
            agentId: charResult.agentId,
            name: '柏妮思搅拌式',
            element: 'fire',
            source: '溢出燃点消耗20点/次 · 支援攻击',
            count: burniceSrc.stirringCount,
            multiplier: burniceSrc.stirringDamageRatio * burniceSkillCoef,
            note: `Mixed Flame Blend #1 × 0.5 + #2，分类为支援攻击${burniceSkillCoef !== 1 ? ` · 技能等级系数×${burniceSkillCoef.toFixed(4)}` : ''}`,
            critRateBonus: burniceSrc.cinema4CritRateBonus,
            skillDamageTarget: 'assist',
          })
        }
        if (burniceSrc.tossingCount > 0 && burniceSrc.tossingDamageRatio > 0) {
          pushDirect({
            id: 'burnice-tossing',
            slot,
            agentId: charResult.agentId,
            name: '柏妮思灼热抛接法',
            element: 'fire',
            source: '消耗1点流火 · EX Special Attack: Intense Heat Tossing Method',
            count: burniceSrc.tossingCount,
            multiplier: burniceSrc.tossingDamageRatio * burniceSkillCoef,
            note: `强化特殊技，可吃4命暴击率+30%${burniceSkillCoef !== 1 ? ` · 技能等级系数×${burniceSkillCoef.toFixed(4)}` : ''}`,
            critRateBonus: burniceSrc.cinema4CritRateBonus,
            skillDamageTarget: 'exSpecial',
          })
        }
        if (burniceSrc.cinema6SpecialEmberCount > 0 && burniceSrc.cinema6SpecialEmberDamageRatio > 0) {
          pushDirect({
            id: 'burnice-c6-special-ember',
            slot,
            agentId: charResult.agentId,
            name: '柏妮思6命特殊余烬',
            element: 'fire',
            source: '双份命中触发 · 0.5s最多一次 · 不消耗燃点',
            count: burniceSrc.cinema6SpecialEmberCount,
            multiplier: burniceSrc.cinema6SpecialEmberDamageRatio,
            note: `固定${burniceSrc.cinema6SpecialEmberBaseRatio}%攻击，不吃1命/精通加成，无视火抗${burniceSrc.cinema6FireResIgnore}%`,
            critRateBonus: burniceSrc.cinema4CritRateBonus,
            resIgnore: burniceSrc.cinema6FireResIgnore,
            moveId: 'burnice-c6-special-ember',
            stunOverride: axisStunFor('burnice-c6-special-ember'),
            skillDamageTarget: 'assist',
          })
        }
      }

      // 琉音专属直伤（额外能力）：石头/剪刀/布重击命中时，按上一位队友特性追加伤害。
      const liuyinSrc = charResult.liuyinMechanicSource
      if (charResult.agentId === '1481' && liuyinSrc && liuyinSrc.extraAbilityActive && liuyinSrc.exHeavyCount > 0) {
        const prevSlot = liuyinSrc.previousTeammateSlot
        const prevPanel = damagePanels.value[prevSlot]
        const prevAgent = prevSlot >= 0 ? (configStore.team[prevSlot]?.agentId ? catalogStore.getAgent(configStore.team[prevSlot].agentId) : null) : null
        const isRupture = prevAgent?.specialty === 'rupture'
        const basisValue = prevPanel ? (isRupture ? prevPanel.atk * 0.3 + prevPanel.hp * 0.1 : prevPanel.atk) : 0
        const ratio = isRupture ? 400 : 320
        const basisLabel = isRupture ? '上一位队友贯穿力' : '上一位队友攻击力'
        if (basisValue > 0) {
          pushDirect({
            id: `liuyin-ex-direct-${prevSlot}`,
            slot,
            agentId: charResult.agentId,
            name: '琉音额外能力·重击附加伤害',
            element: 'physical',
            source: `上一位队友（${prevAgent?.name?.zhCN ?? `槽${prevSlot + 1}`}）${isRupture ? '贯穿力' : '攻击力'} × ${ratio}%`,
            count: liuyinSrc.exHeavyCount,
            multiplier: ratio,
            note: `额外能力专属直伤：${isRupture ? '命破队友 400% 贯穿力' : '强攻队友 320% 攻击力'}`,
            skillDamageTarget: 'exSpecial',
            basisValueOverride: basisValue,
            basisLabelOverride: basisLabel,
          })
        }
      }

      // 琉音三个强特（石头→剪刀→布）按“失衡次数×25 能量留给失衡内第一个强特，剩余非失衡按 1→3 连打”拆分易伤。
      // 非失衡轴模式下通用强特行已跳过，这里重放并拆失衡/非失衡；失衡轴模式仍走轴内易伤归属。
      // 般岳影画6：600% 贯穿力火伤附伤是倾山的自动触发事件，次数 = 倾山次数（不可调，不产生资源利用率行）
      if (charResult.agentId === '1471' && (configStore.team[slot]?.cinemaLevel ?? 0) >= 6) {
        const qingShanExec = charResult.executions.find(e => e.moveId === '1471009')
        const attachCount = Math.max(0, Math.floor(qingShanExec?.count ?? 0))
        if (attachCount > 0) {
          const panel = damagePanels.value[slot]
          pushDirect({
            id: 'banyue-c6-crush-attach',
            slot,
            agentId: charResult.agentId,
            name: '影画6·摧岳附伤（倾山自动触发）',
            element: 'fire',
            source: '倾山自动触发',
            count: attachCount,
            multiplier: C6_ATTACH_RATIO,
            note: `影画6：倾山命中时对周身造成 600% 贯穿力火伤；次数=倾山次数 ×${attachCount}（自动，不可调）`,
            basisValueOverride: panel.atk * 0.3 + (panel.hp ?? 0) * 0.1 + (panel.sheerForceFlat ?? 0),
            basisLabelOverride: '贯穿力（600%附伤）',
            moveId: 'banyue_c6_crush_attach',
            stunOverride: axisStunFor('banyue_c6_crush_attach'),
          })
        }
      }

      if (charResult.agentId === '1481' && liuyinSrc && !isAxis) {
        const stunCount = stunPoolResult.value?.stunCount ?? 0
        const exTotal = Math.max(0, Math.floor(liuyinSrc.exHeavyCount))
        const exMult = new Map<string, number>()
        for (const e of charResult.executions) {
          if (LIUYIN_EX_MOVE_IDS.has(e.moveId) && (e.damageMultiplier ?? 0) > 0) exMult.set(e.moveId, e.damageMultiplier!)
        }
        const mult = (id: string) => exMult.get(id) ?? 0
        const inStunCount = Math.min(stunCount, exTotal)
        const nonStunCount = Math.max(0, exTotal - inStunCount)
        // 非失衡按 1(石头)→2(剪刀)→3(布) 顺序连打
        const nsRock = Math.floor((nonStunCount + 2) / 3)
        const nsScissors = Math.floor((nonStunCount + 1) / 3)
        const nsPaper = Math.floor(nonStunCount / 3)
        const pushLiuyinEx = (moveId: string, name: string, count: number, stunOverride: number, tag: string) => {
          if (count <= 0 || mult(moveId) <= 0) return
          pushDirect({
            id: `liuyin-ex-${moveId}-${tag}`,
            slot,
            agentId: charResult.agentId,
            name,
            element: 'physical',
            source: tag === 'stun' ? '失衡内首个强特' : '非失衡 1→3 连打',
            count,
            multiplier: mult(moveId),
            note: tag === 'stun' ? '失衡内释放，吃满失衡易伤' : '非失衡释放，无易伤',
            skillDamageTarget: 'exSpecial',
            stunOverride,
          })
        }
        pushLiuyinEx('1481011', '强化特殊技：石头', inStunCount, 1, 'stun')
        pushLiuyinEx('1481011', '强化特殊技：石头', nsRock, 0, 'nonstun')
        pushLiuyinEx('1481012', '强化特殊技：剪刀', nsScissors, 0, 'nonstun')
        pushLiuyinEx('1481013', '强化特殊技：布！', nsPaper, 0, 'nonstun')
      }

      // 琉音影画6·余音：独立直伤，轴模式同样生效（非失衡轴模式下与强特拆分无关，不能包在 !isAxis 内）
      if (charResult.agentId === '1481' && liuyinSrc && liuyinSrc.cinemaLevel >= 6) {
        const promoteCount = liuyinPromoteCount.value
        const c6EchoMax = Math.max(0, Math.floor(configStore.getMechanicSetting('liuyin.c6EchoMax', CINEMA6_ECHO_MAX)))
        if (promoteCount > 0 && c6EchoMax > 0) {
          const echoCount = promoteCount * c6EchoMax
          pushDirect({
            id: 'liuyin-c6-echo',
            slot,
            agentId: charResult.agentId,
            name: '琉音影画6·余音',
            element: 'physical',
            source: `转大 ${promoteCount} 次 × ${c6EchoMax} 次 × 480%`,
            count: echoCount,
            multiplier: CINEMA6_ECHO_RATIO,
            note: `影画6余音：队友经核心被动以终结技入场后，其攻击命中时琉音追加 480% 攻击力物理伤害（视为强特）；每转大最多 ${c6EchoMax} 次（可在资源利用率页调整）。`,
            skillDamageTarget: 'exSpecial',
          })
        }
      }
    }

    const windChar = windSlot >= 0 ? configStore.team[windSlot] : null
    const windAgentId = windChar?.agentId ?? ''
    const windRate = anomalyPoolResult.value?.coverage?.windCoverageRate ?? 0

    for (const event of anomalyPoolResult.value?.anomalyEvents ?? []) {
      if (event.count <= 0 || windSlot < 0 || !windAgentId) continue
      if (event.type === 'release' && event.id.includes('velina-corrosion')) {
        pushRelease({
          id: `pool-release-${event.id}`,
          slot: windSlot,
          agentId: windAgentId,
          name: event.label,
          count: event.count,
          multiplier: parseReleaseMultiplier(event),
          source: event.source,
          note: event.note,
        })
      }
    }

    for (const detail of anomalyPoolResult.value?.turbulenceDamage?.details ?? []) {
      const applierAgentId = configStore.team[detail.applierSlot]?.agentId ?? ''
      rows.push({
        id: `turbulence-${detail.element}-${detail.applierSlot}`,
        slot: windSlot >= 0 ? windSlot : 0,
        agentId: windAgentId,
        agentName: windAgentId ? agentName(windAgentId, windSlot) : '风属性角色',
        type: '乱流',
        name: `${elementLabel(detail.element)}乱流`,
        element: detail.element,
        source: `${agentName(applierAgentId, detail.applierSlot)} 的${elementLabel(detail.element)}异常基础区`,
        count: detail.count ?? 0,
        perDamage: (detail.count ?? 0) > 0 ? detail.damage / (detail.count ?? 1) : detail.damage,
        totalDamage: detail.damage,
        note: `T=${detail.remainingTime}s，倍率=${detail.turbulenceMultiplier}%${detail.boostedCount ? `，其中${detail.boostedCount}次吃风蚀+150%倍率` : ''}`,
      })
    }

    // ---- 紊乱伤害（入池，不再单独从 totalDamageWithDisorder 累加） ----
    for (const detail of anomalyPoolResult.value?.disorderDamage?.details ?? []) {
      if (detail.damage <= 0 || detail.events <= 0) continue
      const triggerAgentId = configStore.team[detail.triggerSlot]?.agentId ?? ''
      const applierAgentId = configStore.team[detail.applierSlot]?.agentId ?? ''
      rows.push({
        id: `disorder-${detail.element}-${detail.applierSlot}-${detail.triggerSlot}`,
        slot: detail.triggerSlot,
        agentId: triggerAgentId,
        agentName: agentName(triggerAgentId, detail.triggerSlot),
        type: '紊乱',
        name: `紊乱（覆盖${elementLabel(detail.element)}）`,
        element: detail.element,
        source: `${agentName(applierAgentId, detail.applierSlot)} 的${elementLabel(detail.element)}异常被${agentName(triggerAgentId, detail.triggerSlot)}覆盖`,
        count: detail.events,
        perDamage: detail.perEventDamage,
        totalDamage: detail.damage,
        note: `T=${detail.remainingTime}s，倍率=${detail.disorderMultiplier}%，anomalyMass=${detail.anomalyMass}，settlement=${detail.settlementMultiplier}`,
      })
    }

    const anomalyDamageSpecs: Record<string, {
      label: string
      perTick?: number
      tickInterval?: number
      baseTicks?: number
      single?: number
      baseFormula: string
    }> = {
      fire: { label: '灼烧', perTick: 50, tickInterval: 0.5, baseTicks: 20, baseFormula: '灼烧基础 50% × 20 tick（10秒/0.5秒）' },
      electric: { label: '感电', perTick: 125, tickInterval: 1, baseTicks: 10, baseFormula: '感电基础 125% × 10 tick' },
      ether: { label: '侵蚀', perTick: 62.5, tickInterval: 0.5, baseTicks: 20, baseFormula: '侵蚀基础 62.5% × 20 tick（10秒/0.5秒）' },
      physical: { label: '强击', single: 713, baseFormula: '强击 713% 单次' },
      ice: { label: '碎冰', single: 500, baseFormula: '碎冰 500% 单次（冻结次数=碎冰次数）' },
      wind: { label: '风化', single: 1250, baseFormula: '风化 1250% 单次' },
    }
    // 风化窗口内的火/电/以太 DoT 与冰冻结类不生效，按 (1 - windRate) 折算；
    // 强击、极性强击这类事件伤害仍可触发，因此保留 physical/physical_polar_assault/wind 全额次数。
    const windBlockedAnomalyElements = new Set(['fire', 'electric', 'ether', 'ice'])
    for (const prog of anomalyPoolResult.value?.perElement ?? []) {
      const spec = anomalyDamageSpecs[prog.element]
      if (!spec || prog.triggerCount <= 0) continue
      const effectiveTriggerCount = windBlockedAnomalyElements.has(prog.element)
        ? prog.triggerCount * (1 - windRate)
        : prog.triggerCount
      if (effectiveTriggerCount <= 0) continue
      const build = buildAnomalyVirtualPanel(prog, damagePanels.value, configStore, catalogStore)
      if (!build) continue

      const durationBonus = getTeamAnomalyDurationBonus(configStore, catalogStore, prog.element)
      let multiplier = spec.single ?? 0
      let formula = spec.baseFormula
      if (!spec.single && spec.perTick && spec.tickInterval && spec.baseTicks) {
        const ticks = spec.baseTicks + (spec.tickInterval > 0 ? Math.round(durationBonus / spec.tickInterval) : 0)
        multiplier = spec.perTick * ticks
        formula = `${spec.perTick}% × ${ticks} tick${durationBonus > 0 ? `（含${durationBonus}秒延长）` : ''}`
      }

      // 维琳娜6命：对风化状态敌人再次施加风化，按平均剩余时长给风化事件增伤（每1s +2.5%，上限40%）
      if (prog.element === 'wind') {
        const windPanel = damagePanels.value[windSlot]
        const velinaC6 = (windPanel as any)?.velinaCinema6 ?? 0
        const windCount = prog.triggerCount
        if (velinaC6 && windCount > 1) {
          const avgRemaining = (30 * (windCount - 1) / windCount) / 2
          const c6BonusPct = Math.min(40, 2.5 * avgRemaining)
          multiplier *= (1 + c6BonusPct / 100)
          formula += ` · 6命风化期望+${c6BonusPct.toFixed(1)}%（平均剩余${avgRemaining.toFixed(1)}s）`
        }
      }

      // 按触发者分摊结算：每人用自己的面板独立结算
      const settlementEntries = buildAnomalySettlementEntries(build, damagePanels.value, effectiveTriggerCount, configStore, catalogStore)

      for (const entry of settlementEntries) {
        if (entry.triggerCount <= 0) continue
        const result = calcAnomalyDamage({
          panel: build.panel,
          settlementPanel: entry.panel,
          baseMultiplier: multiplier,
          element: prog.element as any,
          enemyDefense: configStore.enemy.defense,
          enemyDefReduction: 0,
          enemyDefFlatReduction: 0,
          enemyLevel: configStore.enemy.level,
          enemyResistance: enemyDamageRes[prog.element] ?? 0,
          enemyResReduction: entry.panel?.enemyResReduction ?? 0,
          stunned: stunCoverage.value,
          stunMultiplier: configStore.enemy.stunVuln,
          critMode: 'expect',
          damageKind: 'anomaly',
          anomalyMultiplier: remielleAnomalyMultiplier.value,
        })

        const perDamage = result.damage
        const totalDamage = perDamage * entry.triggerCount
        const noteParts = [`${formula}`]
        if (settlementEntries.length > 1) {
          noteParts.push(`${entry.name}结算 · 积蓄占比${(entry.share*100).toFixed(0)}% · ${entry.triggerCount}次`)
        }
        rows.push({
          id: `anomaly-damage-${prog.element}-${entry.slot}`,
          slot: entry.slot,
          agentId: configStore.team[entry.slot]?.agentId ?? '',
          agentName: agentName(configStore.team[entry.slot]?.agentId ?? '', entry.slot),
          type: spec.label as DamagePoolRow['type'],
          name: settlementEntries.length > 1
            ? `${spec.label}（${elementLabel(prog.element)}·${entry.name}结算）`
            : `${spec.label}（${elementLabel(prog.element)}虚拟面板）`,
          element: prog.element,
          source: `属性异常${settlementEntries.length > 1 ? '按积蓄占比分摊' : '虚拟面板'}结算`,
          count: entry.triggerCount,
          perDamage,
          totalDamage,
          note: noteParts.join(' · '),
        })
      }
    }

    // ---- 柏妮思6命：双份火焰冲击命中灼烧敌人时，额外结算一次1800%灼烧伤害 ----
    const burniceSlot = configStore.team.findIndex(char => {
      const a = char.agentId ? catalogStore.getAgent(char.agentId) : null
      return a?.id === '1171' || a?.teammateBuffId === '1171'
    })
    const burniceSrc = burniceSlot >= 0
      ? adjustedResourceResult.value?.characters.find(c => c.slot === burniceSlot)?.burniceMechanicSource
      : undefined
    const fireProg = anomalyPoolResult.value?.perElement.find(prog => prog.element === 'fire')
    if (windRate < 1 && burniceSrc && burniceSrc.cinema6BurnBurstCount > 0 && fireProg && fireProg.triggerCount > 0) {
      const fireBuild = buildAnomalyVirtualPanel(fireProg, damagePanels.value, configStore, catalogStore)
      if (fireBuild) {
        const fireEffectiveCount = fireProg.triggerCount * (1 - windRate)
        const settlementEntries = buildAnomalySettlementEntries(fireBuild, damagePanels.value, fireEffectiveCount, configStore, catalogStore)
        const burnBurstStun = axisStunFor('burnice-c6-burn-burst')
        for (const entry of settlementEntries) {
          if (entry.triggerCount <= 0) continue
          const burstCount = Math.min(burniceSrc.cinema6BurnBurstCount, entry.triggerCount)
          if (burstCount <= 0) continue
          const burstResult = calcAnomalyDamage({
            panel: fireBuild.panel,
            settlementPanel: entry.panel,
            baseMultiplier: burniceSrc.cinema6BurnBurstDamageRatio,
            element: 'fire' as any,
            enemyDefense: configStore.enemy.defense,
            enemyDefReduction: 0,
            enemyDefFlatReduction: 0,
            enemyLevel: configStore.enemy.level,
            enemyResistance: enemyDamageRes.fire ?? 0,
            enemyResReduction: (entry.panel?.enemyResReduction ?? 0) + burniceSrc.cinema6FireResIgnore,
            stunned: burnBurstStun,
            stunMultiplier: configStore.enemy.stunVuln,
            critMode: 'expect',
            damageKind: 'anomaly',
            anomalyMultiplier: remielleAnomalyMultiplier.value,
          })
          rows.push({
            id: `burnice-c6-burn-burst-${entry.slot}`,
            slot: entry.slot,
            agentId: configStore.team[entry.slot]?.agentId ?? '',
            agentName: agentName(configStore.team[entry.slot]?.agentId ?? '', entry.slot),
            type: '灼烧',
            name: '柏妮思6命灼烧迸发',
            element: 'fire',
            source: '双份火焰冲击命中灼烧敌人 · 900%额外灼烧',
            count: burstCount,
            perDamage: burstResult.damage,
            totalDamage: burstResult.damage * burstCount,
            note: `${burniceSrc.cinema6BurnBurstDamageRatio}%（灼烧基础50% × 1800%），跟随双喷轴内易伤，无视火抗${burniceSrc.cinema6FireResIgnore}%，同一目标20秒最多一次`,
            moveId: 'burnice-c6-burn-burst',
          })
        }
      }
    }

    // ---- 极性强击伤害（赠送触发，不走虚拟面板） ----
    const polarAssaultProg = anomalyPoolResult.value?.perElement.find(prog => prog.element === 'physical_polar_assault')
    const polarAssaultSlot = configStore.team.findIndex(char => {
      const a = char.agentId ? catalogStore.getAgent(char.agentId) : null
      return a?.id === '1401' || a?.teammateBuffId === '1401'
    })
    if (polarAssaultProg && polarAssaultProg.triggerCount > 0 && polarAssaultSlot >= 0 && damagePanels.value[polarAssaultSlot]) {
      const alicePanel = damagePanels.value[polarAssaultSlot]
      // 轴模式：极性强击易伤跟随父动作 SW3(1401012) 的 inAxisRatio
      const polarStunFor = axisStunFor('polar_assault')
      const result = calcAnomalyDamage({
        panel: alicePanel,
        settlementPanel: alicePanel,
        baseMultiplier: 713,
        element: 'physical' as any,
        enemyDefense: configStore.enemy.defense,
        enemyDefReduction: 0,
        enemyDefFlatReduction: 0,
        enemyLevel: configStore.enemy.level,
        enemyResistance: enemyDamageRes.physical ?? 0,
        enemyResReduction: alicePanel?.enemyResReduction ?? 0,
        stunned: polarStunFor,
        stunMultiplier: configStore.enemy.stunVuln,
        critMode: 'expect',
        damageKind: 'anomaly',
        anomalyMultiplier: remielleAnomalyMultiplier.value,
      })
      const perDamage = result.damage
      rows.push({
        id: 'polar-assault-damage',
        slot: polarAssaultSlot,
        agentId: configStore.team[polarAssaultSlot]?.agentId ?? '',
        agentName: agentName(configStore.team[polarAssaultSlot]?.agentId ?? '', polarAssaultSlot),
        type: '极性强击',
        name: `极性强击（三蓄赠送）`,
        element: 'physical_polar_assault',
        source: `三蓄赠送触发 · 无视积蓄进度 · 爱丽丝面板`,
        count: polarAssaultProg.triggerCount,
        perDamage,
        totalDamage: perDamage * polarAssaultProg.triggerCount,
        note: `713% 单次 × 爱丽丝面板 · 赠送触发不耗异常条`,
      })
    }

    const janeSlot = configStore.team.findIndex(char => {
      const agent = char.agentId ? catalogStore.getAgent(char.agentId) : null
      return agent?.id === '1261' || agent?.teammateBuffId === '1261'
    })
    const janeCinema = configStore.team[janeSlot]?.cinemaLevel ?? 0
    if (janeSlot >= 0 && janeCinema >= 6 && damagePanels.value[janeSlot]) {
      const janePanel = damagePanels.value[janeSlot]
      const physicalProg = anomalyPoolResult.value?.perElement.find(prog => prog.element === 'physical')
      const assaultCritRate = Math.min(100, Math.max(0, janePanel.assaultCritRate ?? 0))
      const critCount = (physicalProg?.triggerCount ?? 0) * (assaultCritRate / 100)
      if (critCount > 0) {
        const perDamage = (janePanel.anomalyProficiency ?? 0) * 16
        rows.push({
          id: 'jane-c6-assault-followup',
          slot: janeSlot,
          agentId: configStore.team[janeSlot]?.agentId ?? '',
          agentName: agentName(configStore.team[janeSlot]?.agentId ?? '', janeSlot),
          type: '简6命附伤',
          name: '简6命强击暴击附伤',
          element: 'physical',
          source: '强击暴击后触发',
          count: critCount,
          perDamage,
          totalDamage: perDamage * critCount,
          note: `异常精通 ${fmt(janePanel.anomalyProficiency ?? 0)} × 1600%；按强击期望暴击次数 ${fmt(critCount, 2)} 次`,
        })
      }
    }

    // ---- 爱丽丝六命决胜状态额外攻击 ----
    const aliceSlot = configStore.team.findIndex(char => {
      const agent = char.agentId ? catalogStore.getAgent(char.agentId) : null
      return agent?.id === '1401' || agent?.teammateBuffId === '1401'
    })
    const aliceCinema = configStore.team[aliceSlot]?.cinemaLevel ?? 0
    if (aliceSlot >= 0 && aliceCinema >= 6 && damagePanels.value[aliceSlot]) {
      const alicePanel = damagePanels.value[aliceSlot]
      const aliceResult = adjustedResourceResult.value?.characters.find(c => c.slot === aliceSlot)
      const smSrc = aliceResult?.aliceSwordWillSource

      if (smSrc && smSrc.sparkCount > 0) {
        // 状态进入次数 = sparkCount + ultimateCount（每次星芒圆舞曲#3 或终结技进入/刷新决胜状态）
        const ultimateCount = aliceResult.ultimateCount
        const stateEntries = smSrc.sparkCount + ultimateCount

        // 每状态额外攻击次数（默认5次；单轮最多6次，1秒CD）
        const perStateCount = configStore.getMechanicSetting('alice.cinema6PerStateCount', 5)

        // 总触发次数 = 状态进入次数 × 每次攻击次数
        const totalTriggers = stateEntries * perStateCount

        if (totalTriggers > 0) {
          // 必定暴击：damage = anomalyProficiency × 33 × (1 + critDmg/100)
          const proficiency = alicePanel.anomalyProficiency ?? 0
          const critDmg = alicePanel.critDmg ?? 50
          const perDamage = proficiency * 33 * (1 + critDmg / 100)

          rows.push({
            id: 'alice-c6-decisive-extra-attack',
            slot: aliceSlot,
            agentId: configStore.team[aliceSlot]?.agentId ?? '',
            agentName: agentName(configStore.team[aliceSlot]?.agentId ?? '', aliceSlot),
            type: '爱丽丝6命附伤',
            name: '爱丽丝6命决胜状态额外攻击',
            element: 'physical',
            source: '三蓄/终结技进入决胜状态 → 全队攻击额外命中',
            count: totalTriggers,
            perDamage,
            totalDamage: perDamage * totalTriggers,
            note: `异常精通 ${fmt(proficiency)} × 3300% × 必定暴击(1+${fmt(critDmg)}%) → 单次 ${fmt(perDamage)} · 状态进入 ${stateEntries} 次 × 每次 ${perStateCount} 次 = ${totalTriggers} 次`,
          })
        }
      }
    }

    const remielleSlot = configStore.team.findIndex(char => {
      const agent = char.agentId ? catalogStore.getAgent(char.agentId) : null
      return agent?.id === '1581' || agent?.teammateBuffId === '1581'
    })
    if (remielleSlot >= 0 && damagePanels.value[remielleSlot] && remielleEntryPanels.value[remielleSlot]) {
      const remiellePanel = damagePanels.value[remielleSlot]
      const remielleEntryPanel = remielleEntryPanels.value[remielleSlot]
      const remielleSkills = catalogStore.getAgentSkills(configStore.team[remielleSlot]?.agentId ?? '')
      const otherSlots = [0, 1, 2].filter(slot => slot !== remielleSlot)
      const perSlotAnomaly = anomalyPoolResult.value?.perSlotAnomalyTriggers ?? []
      const voidflareBySlot = otherSlots
        .map(slot => ({
          slot,
          count: Math.max(0, Math.floor(perSlotAnomaly[slot] ?? 0)),
          element: catalogStore.getAgent(configStore.team[slot]?.agentId ?? '')?.damageElement ?? 'physical',
          panel: damagePanels.value[slot],
        }))
        .filter(item => item.count > 0 && item.panel)
      const voidflareTotal = voidflareBySlot.reduce((sum, item) => sum + item.count, 0)

      if (voidflareTotal > 0 && remielleSkills) {
        const skillLevelBonus = remiellePanel.skillLevelBonus ?? 0
        const c1ResIgnore = (remiellePanel.remielleCinema1SpecialVoidflareCount ?? 0) > 0 ? 50 : 0
        const c6LuminizeMultiplier = 1 + Math.max(0, remiellePanel.remielleCinema6LuminizeTriggerMultiplier ?? 0)
        const qBatches = Math.floor(voidflareTotal / 3)
        const firstOtherSlot = otherSlots[0]
        const secondOtherSlot = otherSlots[1]
        const firstPerBatch = otherSlots.length === 1
          ? 3
          : Math.max(0, Math.min(3, Math.floor(configStore.getTeamMechanicSetting(`remielle.q:${remielleSlot}`, 1))))
        const secondPerBatch = Math.max(0, 3 - firstPerBatch)
        const qCountBySlot: Record<string, number> = {}
        if (otherSlots.length === 1) {
          qCountBySlot[String(firstOtherSlot)] = qBatches * 3
        } else {
          qCountBySlot[String(firstOtherSlot)] = qBatches * firstPerBatch
          qCountBySlot[String(secondOtherSlot)] = qBatches * secondPerBatch
        }
        const qCount = qBatches * 3
        const basicCount = voidflareTotal * c6LuminizeMultiplier

        const actionRows = [
          {
            id: 'remielle-luminize-assist',
            name: '支援技花羽轮舞·耀变',
            moveId: '1581015',
            countsBySlot: Object.fromEntries(voidflareBySlot.map(item => [item.slot, item.count])),
          },
          {
            id: 'remielle-luminize-ultimate',
            name: '终结技缭乱终幕·耀变',
            moveId: '1581016',
            countsBySlot: qCountBySlot,
          },
          {
            id: 'remielle-luminize-basic',
            name: '普通攻击惊鸿·耀变',
            moveId: '1581008',
            countsBySlot: Object.fromEntries(voidflareBySlot.map(item => [item.slot, item.count * c6LuminizeMultiplier])),
          },
        ]

        for (const action of actionRows) {
          const move = findMoveById(remielleSkills, action.moveId)
          const luminizeRow = move?.rows.find(row => row.kind === 'luminizeMultiplier' || row.id === 'luminize_multiplier')
          const multiplier = getRemielleLevelValue(luminizeRow, skillLevelBonus)
          if (multiplier <= 0) continue
          const actionCount = Object.values(action.countsBySlot).reduce((a, b) => a + b, 0)
          if (actionCount <= 0) continue

          for (const item of voidflareBySlot) {
            const count = action.countsBySlot[String(item.slot)] ?? 0
            if (count <= 0 || !item.panel) continue
            const result = calcVoidflareDamage({
              sourcePanel: item.panel,
              remiellePanel,
              multiplier,
              element: item.element,
              enemyDefense: configStore.enemy.defense,
              enemyResistances: enemyDamageRes,
              stunMultiplier: configStore.enemy.stunVuln,
              stunned: stunCoverage.value,
              cinema1ResIgnore: c1ResIgnore,
            })
            rows.push({
              id: `${action.id}-${item.slot}`,
              slot: remielleSlot,
              agentId: configStore.team[remielleSlot]?.agentId ?? '',
              agentName: agentName(configStore.team[remielleSlot]?.agentId ?? '', remielleSlot),
              type: '耀变',
              name: action.name,
              element: item.element,
              source: `${agentName(configStore.team[item.slot]?.agentId ?? '', item.slot)} 的${elementLabel(item.element)}异常虚耀`,
              count,
              perDamage: result.damage,
              totalDamage: result.damage * count,
              note: `来源虚耀 ${count} 次 · ${result.formula}`,
            })
          }
        }

        const specialCount = remielleSpecialVoidflareCount(remiellePanel)
        if (specialCount > 0) {
          const rainbowMove = findMoveById(remielleSkills, '1581007')
          const rainbowLuminizeRow = rainbowMove?.rows.find(row => row.kind === 'luminizeMultiplier' || row.id === 'luminize_multiplier')
          const rainbowMultiplier = getRemielleLevelValue(rainbowLuminizeRow, skillLevelBonus)
          const specialMultiplier = rainbowMultiplier * 2.5
          if (specialMultiplier > 0) {
            const result = calcVoidflareDamage({
              sourcePanel: remielleEntryPanel,
              remiellePanel: remielleEntryPanel,
              multiplier: specialMultiplier,
              element: 'lumiflux',
              enemyDefense: configStore.enemy.defense,
              enemyResistances: enemyDamageRes,
              stunMultiplier: configStore.enemy.stunVuln,
              stunned: stunCoverage.value,
              cinema1ResIgnore: c1ResIgnore,
            })
            rows.push({
              id: 'remielle-special-voidflare',
              slot: remielleSlot,
              agentId: configStore.team[remielleSlot]?.agentId ?? '',
              agentName: agentName(configStore.team[remielleSlot]?.agentId ?? '', remielleSlot),
              type: '特殊虚耀',
              name: '普通攻击垂虹·特殊虚耀',
              element: 'lumiflux',
              source: '蕾米进场记录面板 × 2.5 特殊独立乘区',
              count: specialCount,
              perDamage: result.damage,
              totalDamage: result.damage * specialCount,
              note: `垂虹倍率 ${fmt(rainbowMultiplier)}% × 2.5 · ${result.formula}`,
            })
          }
        }
      }
    }

    return rows.filter(row => row.totalDamage > 0)
  })

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

  return {
    resourceConfig,
    resourceResult,
    stunPoolResult,
    anomalyPoolResult,
    specialActionBonus,
    damagePoolRows,
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
  }
}
