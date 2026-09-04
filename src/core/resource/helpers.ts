/**
 * 资源池计算引擎
 *
 * 核心循环：平A时间→回能→强特/大招次数→必做动作前台时间→可分配时间→重新分配
 * 资源系统：能量/闪能、喧响、时间、失衡、连携
 *
 * 设计要点：
 * - 不关注资源上限溢出，只算总回复量→可用次数
 * - 喧响伴随获得：先算每人独立获得，最后把可分享部分分给队友
 * - 命破角色用闪能替代能量，逻辑相同
 */
import type {
  ResourceCalcConfig, CharacterOperationConfig,
  EnergySource, CrossAgentEnergy, DecibelSource, TimeAllocation,
  SkillExecution, IterationState, AnomalyEventExecution, TeamResourceResult,
} from '@/types/resource'
import { isFrontlineExecution } from '@/types/resource'
import { getAgentMechanic } from '@/mechanics'
import { computeLuciaCurtainTriggers } from '@/mechanics/agents/luciaElowen'
import { computeBanyueCycleFromCfg, readAxisExCounts } from '@/mechanics/agents/banyue'
import { computeNormaHatToChainCount } from '@/mechanics/agents/norma'
import { countFrontActions, effectiveBackstageTime, effectiveBattleTime, frontBlockSeconds, phaseDelayedCooldown } from '@/core/effectiveTime'
import { resolveExtraExCount } from '@/data/exSpecialPlans'

// ============ 单角色能量计算 ============

/** 丽娜终结技按槽位给当前角色补充的能量。 */
export function calcRinaUltEnergy(
  configs: CharacterOperationConfig[],
  states: IterationState[],
  target: CharacterOperationConfig,
): number {
  const rinaIndex = configs.findIndex(config => config.agentId === '1211')
  if (rinaIndex < 0) return 0
  const ultimateCount = Math.max(0, Math.floor(states[rinaIndex]?.ultimateCount ?? 0))
  return Math.max(0, Number(target.rinaEnergyPerRinaUlt ?? 0)) * ultimateCount
}

/** 苍角终结技按槽位给当前角色补充的能量（邻位 30/10）。 */
export function calcSoukakuUltEnergy(
  configs: CharacterOperationConfig[],
  states: IterationState[],
  target: CharacterOperationConfig,
): number {
  const idx = configs.findIndex(config => config.agentId === '1131')
  if (idx < 0) return 0
  const ultimateCount = Math.max(0, Math.floor(states[idx]?.ultimateCount ?? 0))
  return Math.max(0, Number((target as any).soukakuEnergyPerSoukakuUlt ?? 0)) * ultimateCount
}

/**
 * 队友联动回能（跨角色能量来源的单一事实源）。
 *
 * 全部来源都依赖「其他槽位的次数」，因此必须同时被两处消费：
 * ① `iterate` —— 参与强特次数推导（收敛项）；
 * ② `calcTeamResources` 最终装配 —— 写进 `energySource.crossAgent` 与 `total`，让界面总览
 *    与真正驱动次数的能量同口径。
 *
 * 历史事故：两处各写一份，最终装配只补回 supportUltimateRegen，其余 5 项（仪玄队友终结闪能/
 * 丽娜/苍角/露西/莱特C4）在界面上不可见 —— 仪玄实测 energySource.total 720 而实际驱动 840，
 * 导致测试注释里的手算账本无法与界面对账、并在 f20b2d5 失衡提取语义修正后静默漂移。
 * 新增跨角色回能来源请只改本函数（并在 CrossAgentEnergy 上加字段）。
 */
export function calcCrossAgentEnergy(
  slotIndex: number,
  configs: CharacterOperationConfig[],
  states: IterationState[],
): CrossAgentEnergy {
  const cfg = configs[slotIndex]
  const num = (v: unknown) => {
    const x = Number(v)
    return Number.isFinite(x) ? x : 0
  }

  let supportUltimateRegen = 0
  let teamUltimateFlash = 0
  for (let j = 0; j < configs.length; j++) {
    if (j === slotIndex) continue
    const other = configs[j]
    if (other.supportUltimateEnergyRegen > 0) {
      supportUltimateRegen += states[j].ultimateCount * other.supportUltimateEnergyRegen
    }
    // 模块声明：队友终结技每次回闪能（如仪玄额外能力·队友释放终结技回 2/s×10s=20）
    if ((cfg.teamUltimateFlashBonus ?? 0) > 0) {
      teamUltimateFlash += states[j].ultimateCount * (cfg.teamUltimateFlashBonus ?? 0)
    }
  }

  // 支援角色终结技邻位回能（次数使用传入状态参与收敛）
  const rinaUltEnergy = calcRinaUltEnergy(configs, states, cfg)
  const soukakuUltEnergy = calcSoukakuUltEnergy(configs, states, cfg)

  // 露西：终结邻位回能 + 影画1 回旋全队回能（次数用传入的露西 state）
  let lucyEnergy = 0
  const lucyIdx = configs.findIndex(c => c.agentId === '1151')
  if (lucyIdx >= 0) {
    const lucyPrev = states[lucyIdx]
    const lucyUlt = Math.max(0, Math.floor(lucyPrev?.ultimateCount ?? 0))
    const lucyCfg = configs[lucyIdx]
    const lucyCinema = Math.max(0, Math.floor(num((lucyCfg as any).lucyCinemaLevel)))
    lucyEnergy += Math.max(0, num(cfg.lucyEnergyPerLucyUlt)) * lucyUlt
    if (num(cfg.lucyC1Enabled) > 0) {
      const spinsHint = Math.max(0, num((cfg as any).lucyCheerSpinsEstimate))
      const spinEst = spinsHint > 0
        ? spinsHint
        : Math.max(0, Math.floor(lucyPrev?.exSpecialCount ?? 0))
          + (lucyCinema >= 2
            ? Math.max(0, Math.floor(lucyPrev?.chainCountTotal ?? 0)) + lucyUlt
            : 0)
          + (lucyCinema >= 6 ? Math.max(0, num((lucyCfg as any).lucyTeammateExTotal)) : 0)
      lucyEnergy += spinEst * 2
    }
  }

  // 莱特影画4：进士气喷发时后场角色 +4 能量（18s CD，总额预写入 cfg.lighterC4BurstEnergy）
  const lighterC4Raw = num((cfg as any).lighterC4BurstEnergy)
  const lighterC4Energy = lighterC4Raw > 0 ? lighterC4Raw : 0

  // 席德（1461）额外能力：作为操作角色造成伤害时为正兵回 2 能量/秒（1秒至多1次）。
  // 操作时间 = 前台时间 − 合轴时间（后台与自动追加攻击不计）。
  // 正兵槽位由席德模块 applyTeamConfig（build）写入 cfg.xideVanguardSlot（初始攻击最高的强攻队友）。
  let xideVanguardEnergy = 0
  const xideIdx = configs.findIndex(c => c.agentId === '1461')
  if (xideIdx >= 0) {
    const xideCfg = configs[xideIdx]
    const vanguardSlot = Math.floor(num((xideCfg as any).xideVanguardSlot))
    if (xideIdx !== slotIndex && vanguardSlot === slotIndex) {
      xideVanguardEnergy = Math.max(0, num(states[xideIdx].frontlineTime) - num(states[xideIdx].comboAlignTime)) * 2
    }
    // 正兵实际耗能 → 席德钢能（严格读正兵，非按席德强特耗能近似）：算席德自己能量时写入。
    // 层级关系：席德为正兵回能 → 正兵能量变多 → 正兵强特次数变多 → 正兵耗能 → 席德钢能。
    if (slotIndex === xideIdx) {
      const vanguardEnergySpent = vanguardSlot >= 0 && vanguardSlot < configs.length && vanguardSlot !== xideIdx
        ? Math.max(0, Math.floor(states[vanguardSlot].exSpecialCount ?? 0)) * Math.max(0, configs[vanguardSlot].exSpecialEnergyConsume ?? 0)
        : 0
      ;(xideCfg as any).xideVanguardEnergySpent = vanguardEnergySpent
    }
  }

  return {
    supportUltimateRegen,
    teamUltimateFlash,
    rinaUltEnergy,
    soukakuUltEnergy,
    lucyEnergy,
    lighterC4Energy,
    xideVanguardEnergy,
    total: supportUltimateRegen + teamUltimateFlash + rinaUltEnergy
      + soukakuUltEnergy + lucyEnergy + lighterC4Energy + xideVanguardEnergy,
  }
}

/** 空的队友联动明细（calcEnergySource 单角色阶段用，由调用方按 calcCrossAgentEnergy 回填）。 */
export function emptyCrossAgentEnergy(): CrossAgentEnergy {
  return {
    supportUltimateRegen: 0,
    teamUltimateFlash: 0,
    rinaUltEnergy: 0,
    soukakuUltEnergy: 0,
    lucyEnergy: 0,
    lighterC4Energy: 0,
    xideVanguardEnergy: 0,
    total: 0,
  }
}

/** 计算单角色能量回复（单次迭代，基于当前时间分配） */
export function calcEnergySource(
  cfg: CharacterOperationConfig,
  state: IterationState,
  teamCfg: CharacterOperationConfig[],
  shieldCount: number,
  energyShieldCount: number,
  chainCountTotal = 0,
  totalTime = 180,
): EnergySource {
  const p = cfg.panel
  const n = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : 0

  // 普通能量/闪能共用同一套公式：
  // (基础 × (1 + 百分比加成) + 固定加成) × (1 + 获得效率)。
  // 命破（闪能）：基础自动回复 = flashEnergyRegen（如 2/s）；固定/百分比回能加成只作用于能量，
  // 闪能自己的固定/百分比走 flashEnergyRegenBonusFlat/flashEnergyRegenBonusPct（目前只有影画2 的 0.5/s 闪能回复）。
  const isFlash = cfg.isFlashUser
  const baseRegen = isFlash ? n(p.flashEnergyRegen) : n(p.energyRegen)
  const pctBonus = (isFlash ? n(p.flashEnergyRegenBonusPct) : n(p.energyRegenBonusPct)) / 100
  const flatBonusRate = isFlash ? n(p.flashEnergyRegenBonusFlat) : n(p.energyRegenBonusFlat)
  const normalGainEfficiency = (isFlash ? n(p.flashEnergyGainEfficiency) : n(p.energyGainEfficiency)) / 100

  // 条件固定回能：灼心摇壶按后台时间，思络成歌按非操作/合轴时间。这些是能量回能，命破（闪能）不吃。
  const backstageFlatRate = isFlash ? 0 : n(cfg.backstageRegenBonus) + n(p.backstageEnergyRegenFlat) + n(p.roaringRideBackstageEnergyRegen)
  const nonOperatingFlatRate = isFlash ? 0 : n(cfg.comboAlignRegenBonus) + n(p.nonOperatingEnergyRegenFlat)

  const autoRegen = baseRegen * totalTime
  const pctRegenBonus = baseRegen * pctBonus * totalTime
  const flatRegenBonus = flatBonusRate * totalTime
  const backstageBonus = state.backstageTime * backstageFlatRate
  const comboAlignBonus = state.comboAlignTime * nonOperatingFlatRate

  const preEfficiencyAuto = autoRegen + pctRegenBonus + flatRegenBonus + backstageBonus + comboAlignBonus
  const demaraTriggerCount = cfg.dodgeCounterCount + cfg.quickAssistCount + cfg.parryCount
  const demaraCoverageSeconds = Math.min(totalTime, Math.max(0, demaraTriggerCount * 8))
  const demaraCoverageRate = totalTime > 0 ? demaraCoverageSeconds / totalTime : 0
  const demaraEfficiency = n(p.demaraEnergyGainEfficiency) / 100
  const averageAutoRate = totalTime > 0 ? preEfficiencyAuto / totalTime : 0
  const gainEfficiencyBonus = preEfficiencyAuto * normalGainEfficiency
    + averageAutoRate * demaraCoverageSeconds * demaraEfficiency

  // 资源轴动作回复：目前按技能数据给出的秒均平A回能计算，暂不叠加自动回复公式的获得效率。
  const basicAttackRegen = state.basicAttackTime * cfg.basicAttackRegenPerSec

  // 辅助大招回复由上层根据其他角色最终终结技次数补入。
  let supportUltimateRegen = 0
  for (const other of teamCfg) {
    if (other.slot === cfg.slot) continue
    if (other.supportUltimateEnergyRegen > 0) {
      // 上层补算，保留循环以便后续接入更细的辅助终结技时间轴。
    }
  }

  const timeSliceTriggers = timeSliceTriggerCounts(cfg, state, chainCountTotal, totalTime)
  const timeSliceEnergy = n(cfg.panel.timeSliceEnergyPerTrigger) * timeSliceTriggers.total
  const zhenyuanEnergy = n(cfg.panel.zhenyuanEnergyPerTrigger) * n(cfg.zhenyuanTriggerCount)

  // 诺姆影画2·帽子把戏：战斗中触发回 25 能量，20 秒冷却；按战斗时间驱动（默认 180s → floor(180/20)=9 次）。
  const hatTrickInterval = n(cfg.normaC2TriggerInterval)
  const hatTrickEnergy = n(cfg.normaC2EnergyPerTrigger) > 0 && hatTrickInterval > 0
    ? Math.max(0, Math.floor(totalTime / hatTrickInterval)) * n(cfg.normaC2EnergyPerTrigger)
    : 0

  // 青衣影画4·稳态电弧屏障：护盾刷新回 5 能量，10 秒冷却；按战斗时间驱动（默认 180s → floor(180/10)=18 次）。
  const qingyiC4Interval = n(cfg.qingyiC4TriggerInterval)
  const qingyiC4Energy = n(cfg.qingyiC4EnergyPerTrigger) > 0 && qingyiC4Interval > 0
    ? Math.max(0, Math.floor(totalTime / qingyiC4Interval)) * n(cfg.qingyiC4EnergyPerTrigger)
    : 0

  // 莱卡恩影画2·能量回馈：使敌人失衡或触发队友[连携技]时回 5 能量；次数 = 失衡次数 + 队伍连携总次数（外层注入总额）
  const lycaonC2Energy = n(cfg.lycaonC2Energy)

  // 比利影画1·闪亮登场：冲刺/闪反原始命中次数合并后按5秒ICD封顶，由模块预计算总额。
  const billyC1Energy = n(cfg.billyC1Energy)

  // 伊德海莉：非失衡（溯寒后）极寒重碾每次回闪能；失衡内 = 轴连段反推（有轴）或 每次失衡次数 × 失衡次数，剩余为非失衡
  const yidhariRefundPer = cfg.yidhariRefundPerOutStunEx !== undefined ? n(cfg.yidhariRefundPerOutStunEx) : 0
  const yidhariInStun = cfg.agentId === '1051' && cfg.yidhariInStunExCount !== undefined
    ? n(cfg.yidhariInStunExCount)
    : Math.min(n(state.exSpecialCount), n(cfg.yidhariExPerStun ?? 2) * n(cfg.yidhariStunCount ?? 0))
  const yidhariOutStun = Math.max(0, n(state.exSpecialCount) - yidhariInStun)
  const yidhariRefund = cfg.agentId === '1051' ? yidhariOutStun * yidhariRefundPer : 0

  // 般岳：怒相内山威强特回闪能（4 山威/怒相 × 10/个，影画2 额外 +5/个）——嗔火循环固定点给出怒相次数与回闪总额
  const banyueSwayRefund = cfg.agentId === '1471'
    ? Math.max(0, computeBanyueCycleFromCfg(cfg).flashIncome - 420) // flashIncome − 进场/秒回 420 = 山威回闪能
    : 0

  // 仪玄：额外闪能总账（模块在 buildCharConfig 汇总：完美格挡+10/次、极限闪避+5/次、影画1落雷+5/次）
  const yixuanFlashBonus = n(cfg.yixuanFlashBonus)
  const antonC1EnergyGift = cfg.agentId === '1111' ? n((cfg as any).antonC1EnergyGift) : 0

  const initialGift = cfg.initialEnergyGift
  const shieldBreakGift = shieldCount * 60
  const energyShieldBreakGift = cfg.isFlashUser ? 0 : energyShieldCount * 30

  const total = preEfficiencyAuto + gainEfficiencyBonus
    + basicAttackRegen + supportUltimateRegen + timeSliceEnergy + zhenyuanEnergy
    + hatTrickEnergy
    + qingyiC4Energy
    + lycaonC2Energy
    + billyC1Energy
    + yidhariRefund
    + banyueSwayRefund
    + yixuanFlashBonus
    + antonC1EnergyGift
    + initialGift + shieldBreakGift + energyShieldBreakGift

  return {
    autoRegen,
    pctRegenBonus,
    flatRegenBonus,
    backstageBonus,
    comboAlignBonus,
    gainEfficiencyBonus,
    demaraCoverageSeconds,
    demaraCoverageRate,
    basicAttackRegen,
    timeSliceEnergy,
    zhenyuanEnergy,
    hatTrickEnergy,
    qingyiC4Energy,
    lycaonC2Energy,
    billyC1Energy,
    yidhariRefund,
    banyueSwayRefund,
    yixuanFlashBonus,
    antonC1EnergyGift,
    supportUltimateRegen,
    // 队友联动明细在此阶段拿不到其他槽位的收敛次数，由调用方用 calcCrossAgentEnergy 回填
    crossAgent: emptyCrossAgentEnergy(),
    initialGift,
    shieldBreakGift,
    energyShieldBreakGift,
    total,
  }
}

// ============ 单角色喧响计算 ============

export function decibelEfficiencyMultiplier(cfg: CharacterOperationConfig): number {
  return 1 + ((cfg.panel.decibelGainEfficiency ?? 0) / 100)
}

export function remielleSpecialVoidflareUseCount(cfg: CharacterOperationConfig): number {
  const firstRound = cfg.panel.remielleCinema1SpecialVoidflareCount ?? 0
  if (firstRound <= 0) return 0
  const refillRound = cfg.panel.remielleCinema4SpecialVoidflareRefillCount ?? 0
  const c6Multiplier = 1 + Math.max(0, cfg.panel.remielleCinema6SpecialVoidflareTriggerMultiplier ?? 0)
  return (firstRound + Math.max(0, refillRound)) * c6Multiplier
}

/** 强化特殊技（及模块专属必做动作）前台时间：优先走角色机制模块覆盖（如卢西娅计划内E+A5），否则按通用公式 */
function exSpecialNecessaryTime(cfg: CharacterOperationConfig, exSpecialCount: number, ultimateCount: number): number {
  const estimate = getAgentMechanic(cfg.agentId)?.estimateExSpecialTime?.({ cfg, exSpecialCount, ultimateCount })
  if (estimate) return estimate.necessaryTime
  return exSpecialCount * cfg.exSpecialActionTime
}

/** 强化特殊技（及模块专属必做动作）合轴时间：优先走角色机制模块覆盖，否则按通用公式 */
function exSpecialComboAlignTime(cfg: CharacterOperationConfig, exSpecialCount: number, ultimateCount: number): number {
  const estimate = getAgentMechanic(cfg.agentId)?.estimateExSpecialTime?.({ cfg, exSpecialCount, ultimateCount })
  if (estimate) return estimate.comboAlignTime
  return exSpecialCount * cfg.exSpecialActionTime * cfg.exSpecialComboAlignRatio
}

/**
 * 强化特殊技合轴的**预算抵扣**部分：只有含在 necessaryTime 内的合轴（GROSS 约定，缺省）
 * 才能抵扣团队时间预算；NET 约定模块（照/卢西娅：合轴动作已从 necessaryTime 剔除、
 * 物化行不占前台）返回 0，防止同一重叠双重抵扣。通用公式路径全额可抵扣。
 */
function exSpecialComboAlignCredit(cfg: CharacterOperationConfig, exSpecialCount: number, ultimateCount: number): number {
  const estimate = getAgentMechanic(cfg.agentId)?.estimateExSpecialTime?.({ cfg, exSpecialCount, ultimateCount })
  if (estimate) return estimate.comboAlignIncludedInNecessary === false ? 0 : estimate.comboAlignTime
  return exSpecialCount * cfg.exSpecialActionTime * cfg.exSpecialComboAlignRatio
}

export function cappedCooldownTriggers(rawCount: number, totalTime: number, cooldownSeconds: number): number {
  const raw = Math.max(0, Math.floor(rawCount))
  if (raw <= 0) return 0
  if (cooldownSeconds <= 0 || totalTime <= 0) return raw
  return Math.min(raw, Math.ceil(totalTime / cooldownSeconds))
}

export function getUtilizedCount(cfg: CharacterOperationConfig, actionId: string | undefined, rawCount: number): number {
  if (!actionId || rawCount <= 0) return rawCount
  const rule = cfg.resourceUtilization?.[actionId]
  if (!rule) return rawCount
  const rate = Math.max(0, Math.min(1, Number.isFinite(rule.rate) ? rule.rate : 1))
  let count = rawCount * rate
  if (rule.cap !== undefined && rule.cap !== null && Number.isFinite(Number(rule.cap))) {
    count = Math.min(count, Math.max(0, Number(rule.cap)))
  }
  return count
}

export function applyExecutionUtilization(cfg: CharacterOperationConfig, exec: SkillExecution): SkillExecution {
  if (exec.count <= 0) return exec
  const count = getUtilizedCount(cfg, exec.moveId, exec.count)
  if (count === exec.count) return exec
  const scale = exec.count > 0 ? count / exec.count : 1
  return {
    ...exec,
    count,
    totalTime: exec.totalTime * scale,
    totalComboAlignTime: exec.totalComboAlignTime * scale,
    totalEnergyConsume: exec.totalEnergyConsume * scale,
    totalDecibelRecovery: exec.totalDecibelRecovery * scale,
    totalEnergyRecovery: exec.totalEnergyRecovery * scale,
    totalSpecialResourceRecovery: exec.totalSpecialResourceRecovery !== undefined ? exec.totalSpecialResourceRecovery * scale : undefined,
    totalHealingAmount: exec.totalHealingAmount !== undefined ? exec.totalHealingAmount * scale : undefined,
  }
}

export function applyEventUtilization(cfg: CharacterOperationConfig, event: AnomalyEventExecution): AnomalyEventExecution {
  if (event.count <= 0) return event
  const directRule = cfg.resourceUtilization?.[event.eventId]
  const actionId = directRule ? event.eventId : (event.carrierMoveId ?? event.eventId)
  const count = getUtilizedCount(cfg, actionId, event.count)
  return count === event.count ? event : { ...event, count }
}

export function timeSliceTriggerCounts(
  cfg: CharacterOperationConfig,
  state: IterationState,
  chainCountTotal: number,
  totalTime: number,
  exSpecialCount = state.exSpecialCount,
): { dodgeCounter: number; exSpecial: number; assist: number; chain: number; total: number } {
  const cooldown = 12
  const dodgeCounter = cappedCooldownTriggers(cfg.dodgeCounterCount, totalTime, cooldown)
  const exSpecial = cappedCooldownTriggers(exSpecialCount, totalTime, cooldown)
  const assist = cappedCooldownTriggers(cfg.quickAssistCount + cfg.parryCount, totalTime, cooldown)
  const chain = cappedCooldownTriggers(chainCountTotal, totalTime, cooldown)
  return { dodgeCounter, exSpecial, assist, chain, total: dodgeCounter + exSpecial + assist + chain }
}

export function calcRawDecibelParts(
  cfg: CharacterOperationConfig,
  state: IterationState,
  chainCountTotal = 0,
  exSpecialCount = state.exSpecialCount,
  ultimateCount = state.ultimateCount,
  totalTime = 180,
): { skillRegen: number; bonusRegen: number; timeSliceDecibel: number; shareableTotal: number } {
  // 招式回复：平A、强特、终结技数据行、连携、闪避反击、弹刀/支援突击。
  const basicDecibel = state.basicAttackTime * cfg.basicAttackDecibelPerSec
  const exSpecialDecibel = exSpecialCount * cfg.exSpecialDecibelRecovery
  // 额外强特行（窗口门控的免费强特，2026-09）：与主强特同口径进喧响轨道（次数=窗口 × 单次喧响回复）。
  const extraExDecibel = (cfg.extraExPlans ?? []).reduce((sum, plan) => {
    const c = resolveExtraExCount(plan, {
      battleSeconds: Math.max(0, cfg.battleTime ?? 0),
      exCount: Math.max(0, Math.floor(state.exSpecialCount ?? 0)),
    })
    return sum + c * plan.decibelRecovery
  }, 0)
  const ultimateDecibel = ultimateCount * cfg.ultimateDecibelRecovery
  const chainDecibel = chainCountTotal * cfg.chainDecibelRecovery
  const dodgeCounterDecibel = cfg.dodgeCounterCount * cfg.dodgeCounterDecibelRecovery
  const defensiveAssistDecibel = ((cfg.parryCount ?? 0) + (cfg.parryNoFollowUpCount ?? 0)) * cfg.defensiveAssistDecibelRecovery
  const assistFollowUpDecibel = cfg.parryCount * cfg.assistFollowUpDecibelRecovery
  const remielleRainbowEndDecibel = remielleSpecialVoidflareUseCount(cfg) * cfg.remielleRainbowEndDecibelRecovery
  const skillRegen = basicDecibel + exSpecialDecibel + extraExDecibel + ultimateDecibel + chainDecibel
    + dodgeCounterDecibel + defensiveAssistDecibel + assistFollowUpDecibel + remielleRainbowEndDecibel

  // 奖励回复：池内效果（时光切片）。弹刀/闪反/连携/快支的固定奖励与异常奖励由外部按槽位注入
  // （specialActionDecibelBonusPerSlot / anomalyDecibelBonusPerSlot），避免与展示层双算。
  const timeSliceTriggers = timeSliceTriggerCounts(cfg, state, chainCountTotal, totalTime, exSpecialCount)
  const timeSliceDecibel = (cfg.panel.timeSliceDodgeCounterDecibel ?? 0) * timeSliceTriggers.dodgeCounter
    + (cfg.panel.timeSliceExSpecialDecibel ?? 0) * timeSliceTriggers.exSpecial
    + (cfg.panel.timeSliceAssistDecibel ?? 0) * timeSliceTriggers.assist
    + (cfg.panel.timeSliceChainDecibel ?? 0) * timeSliceTriggers.chain
  const bonusRegen = timeSliceDecibel

  return {
    skillRegen,
    bonusRegen,
    timeSliceDecibel,
    shareableTotal: skillRegen + bonusRegen,
  }
}

/** 计算单角色喧响回复（单次迭代，基于当前招式执行计划） */
export function calcDecibelSource(
  cfg: CharacterOperationConfig,
  state: IterationState,
  teammateShare: number,
  chainCountTotal = 0,
  totalTime = 180,
  /** 额外的不可分享喧响（如卢西娅4命帷幕触发全队每人 +100/次），由调用方按收敛后次数注入 */
  extraUnshareableDecibel = 0,
  /** 特殊动作奖励（弹刀215/闪反10/连携10/快支20，含伴随50%），由全局配置按槽位注入 */
  specialActionBonus = 0,
  /** 异常/紊乱/乱流奖励（含伴随50%），由全局配置按槽位注入（上一轮异常池结果） */
  anomalyBonus = 0,
): DecibelSource {
  const efficiency = decibelEfficiencyMultiplier(cfg)
  const raw = calcRawDecibelParts(cfg, state, chainCountTotal, state.exSpecialCount, state.ultimateCount, totalTime)

  // 喧响获得效率完整作用于所有获得来源：开局、招式、奖励、队友伴随。
  const initialGift = cfg.initialDecibelGift * efficiency
  const skillRegen = raw.skillRegen * efficiency
  const bonusRegen = raw.bonusRegen * efficiency
  const timeSliceDecibel = raw.timeSliceDecibel * efficiency
  const teammateShareWithEfficiency = teammateShare * efficiency
  // 伊德海莉烧血喧响：开局场外烧 75% 至 25% + 战斗中把全部回复量烧掉；固定不可分享
  const yidhariBurnDecibel = (() => {
    if (cfg.agentId !== '1051') return 0
    const missing = Math.max(0, Math.min(1, cfg.yidhariExHealMissingHpPct ?? 0.75))
    const decibelPerHp = cfg.yidhariDecibelPerHpPct ?? 10
    const external = Math.max(0, cfg.yidhariExternalHealPct ?? 0)
    const cycleTime = 1 + (cfg.yidhariChargeSlam?.actionTime ?? 0) + (cfg.yidhariBasicFollow?.actionTime ?? 0)
    const cycles = cycleTime > 0 ? Math.floor((state.basicAttackTime ?? 0) / cycleTime) : 0
    const exHeal = (state.exSpecialCount ?? 0) * 33 * missing
    const followHeal = cycles * 10
    return (75 + exHeal + followHeal + external) * decibelPerHp
  })()
  const unshareableBonus = (
    (cfg.extraSelfDecibelReward ?? 0)
    + (cfg.extraSelfDecibelPerUltimate ?? 0) * state.ultimateCount
    + yidhariBurnDecibel
    + extraUnshareableDecibel
  ) * efficiency
  const specialActionBonusWithEfficiency = specialActionBonus * efficiency
  const anomalyBonusWithEfficiency = anomalyBonus * efficiency
  const shareableTotal = skillRegen + bonusRegen
  const total = initialGift + shareableTotal + teammateShareWithEfficiency + unshareableBonus
    + specialActionBonusWithEfficiency + anomalyBonusWithEfficiency

  return {
    initialGift,
    skillRegen,
    bonusRegen,
    timeSliceDecibel,
    specialActionBonus: specialActionBonusWithEfficiency,
    anomalyBonus: anomalyBonusWithEfficiency,
    teammateShare: teammateShareWithEfficiency,
    unshareableBonus,
    yidhariBurnDecibel,
    shareableTotal,
    total,
  }
}

// ============ 时间计算 ============

/** 计算单角色时间分配 */
export function calcTimeAllocation(
  _cfg: CharacterOperationConfig,
  state: IterationState,
  totalTime: number,
): TimeAllocation {
  // 必做动作前台时间 = 强特 + 终结技 + 连携等动作的 actionTime，未扣除合轴
  const necessaryTime = state.necessaryTime

  // 单角色前台时间 = 必做动作前台时间 + 平A时间
  const frontlineTime = necessaryTime + state.basicAttackTime

  // 后台时间 = 总时间 - 前台时间
  const backstageTime = Math.max(0, totalTime - frontlineTime)

  // 合轴时间 = 终结技等长动作的合轴部分（由 state 传入）
  const comboAlignTime = state.comboAlignTime

  return {
    frontlineTime,
    backstageTime,
    comboAlignTime,
    comboAlignCredit: state.comboAlignCredit,
    basicAttackTime: state.basicAttackTime,
    necessaryTime,
  }
}

/**
 * 队伍前台净占用（秒，单一事实源）：Σ物化前台行 − 合轴抵扣。
 * 抵扣 = 每槽 max(招式合轴抵扣 comboAlignCredit, 轴内合轴节省 axisOverlapByAction)——
 * 同一物理并行（轴模式=栈引擎实际区间、非轴=合轴率均值）的两种模型，不叠加。
 * 与 iterate 平A池的 relief 同口径：超时判定（轴退化/降配/队伍对比）必须用本函数，
 * 否则合轴抵扣放宽后的平A池会被误判超时（2026-09-04 合轴口径）。
 */
export function netFrontlineOccupation(rr: TeamResourceResult): number {
  const overlap = rr.axisOverlapByAction ?? {}
  const overlapBySlot: Record<number, number> = {}
  for (const [key, sec] of Object.entries(overlap)) {
    const slot = Number(key.slice(0, key.indexOf(':')))
    if (Number.isFinite(slot)) overlapBySlot[slot] = (overlapBySlot[slot] ?? 0) + sec
  }
  let total = 0
  let totalCredit = 0
  let totalRowNet = 0
  for (const ch of rr.characters) {
    let rowNet = 0
    for (const exec of ch.executions) {
      if (!isFrontlineExecution(exec)) continue
      rowNet += Math.max(0, (exec.totalTime ?? 0) - (overlap[`${ch.slot}:${exec.moveId}`] ?? 0))
    }
    // 合轴抵扣只再扣超出轴内节省的增量（max 口径，防双重扣减）
    const extraCredit = Math.max(0, (ch.timeAllocation.comboAlignCredit ?? 0) - (overlapBySlot[ch.slot] ?? 0))
    total += Math.max(0, rowNet - extraCredit)
    totalCredit += ch.timeAllocation.comboAlignCredit ?? 0
    totalRowNet += rowNet
  }
  // 兜底：只有团队级 axisOverlapSeconds、无按块分摊（老注入路径/测试）→ 团队级 max 口径
  if (Object.keys(overlap).length === 0 && (rr.axisOverlapSeconds ?? 0) > 0) {
    return Math.max(0, totalRowNet - Math.max(totalCredit, rr.axisOverlapSeconds ?? 0))
  }
  return total
}

// ============ 招式执行计划 ============

/** 构建招式执行记录 */
export function buildExecutions(
  cfg: CharacterOperationConfig,
  state: IterationState,
  chainCountTotal: number,
  teamFrontlineSeconds = 0,
): SkillExecution[] {
  const executions: SkillExecution[] = []

  // 平A（用秒均数据汇总，不单独列每段）
  if (state.basicAttackTime > 0) {
    executions.push({
      moveId: 'basic_attack',
      moveName: '普通攻击（平A汇总）',
      category: 'basic',
      count: 0, // 平A用时间，不按次数
      actionTime: 0,
      comboAlignRatio: 0,
      totalTime: state.basicAttackTime,
      totalComboAlignTime: 0,
      energyConsume: 0,
      totalEnergyConsume: 0,
      decibelRecovery: cfg.basicAttackDecibelPerSec,
      totalDecibelRecovery: state.basicAttackTime * cfg.basicAttackDecibelPerSec,
      energyRecovery: cfg.basicAttackRegenPerSec,
      totalEnergyRecovery: state.basicAttackTime * cfg.basicAttackRegenPerSec,
      timeBucket: 'basic',
    })
  }

  // 蕾米一/四命：特殊虚耀跟随「普通攻击：垂虹」触发，需要补入垂虹动作
  const remielleRainbowEndCount = remielleSpecialVoidflareUseCount(cfg)
  if (remielleRainbowEndCount > 0 && cfg.remielleRainbowEndMoveId) {
    const car = cfg.remielleRainbowEndComboAlignRatio
    executions.push({
      moveId: cfg.remielleRainbowEndMoveId,
      moveName: '普通攻击：垂虹（特殊虚耀载体）',
      category: 'basic',
      count: remielleRainbowEndCount,
      actionTime: cfg.remielleRainbowEndActionTime,
      comboAlignRatio: car,
      totalTime: remielleRainbowEndCount * cfg.remielleRainbowEndActionTime,
      totalComboAlignTime: remielleRainbowEndCount * cfg.remielleRainbowEndActionTime * car,
      energyConsume: 0,
      totalEnergyConsume: 0,
      decibelRecovery: cfg.remielleRainbowEndDecibelRecovery,
      totalDecibelRecovery: remielleRainbowEndCount * cfg.remielleRainbowEndDecibelRecovery,
      energyRecovery: 0,
      totalEnergyRecovery: 0,
      timeBucket: 'necessary',
    })
  }

  // 强特
  if (state.exSpecialCount > 0 && !cfg.skipGenericExSpecial) {
    const car = cfg.exSpecialComboAlignRatio
    const freeEx = Math.max(0, Math.floor(cfg.freeExSpecialCount ?? 0))
    const paidEx = Math.max(0, state.exSpecialCount - freeEx)
    executions.push({
      moveId: cfg.exSpecialMoveId,
      moveName: '强化特殊技（EX Special）',
      category: 'special',
      count: state.exSpecialCount,
      actionTime: cfg.exSpecialActionTime,
      comboAlignRatio: car,
      totalTime: state.exSpecialCount * cfg.exSpecialActionTime,
      totalComboAlignTime: state.exSpecialCount * cfg.exSpecialActionTime * car,
      energyConsume: cfg.exSpecialEnergyConsume,
      // 免费强特不扣能量（只对付费部分收费）
      totalEnergyConsume: paidEx * cfg.exSpecialEnergyConsume,
      decibelRecovery: cfg.exSpecialDecibelRecovery,
      totalDecibelRecovery: state.exSpecialCount * cfg.exSpecialDecibelRecovery,
      energyRecovery: 0,
      totalEnergyRecovery: 0,
      timeBucket: 'necessary',
    })
  }

  // 终结技
  if (state.ultimateCount > 0) {
    const car = cfg.ultimateComboAlignRatio
    executions.push({
      moveId: cfg.ultimateMoveId,
      moveName: '终结技（Ultimate）',
      category: 'chain',
      count: state.ultimateCount,
      actionTime: cfg.ultimateActionTime,
      comboAlignRatio: car,
      totalTime: state.ultimateCount * cfg.ultimateActionTime,
      totalComboAlignTime: state.ultimateCount * cfg.ultimateActionTime * car,
      energyConsume: 0,
      totalEnergyConsume: 0,
      decibelRecovery: cfg.ultimateDecibelRecovery,
      totalDecibelRecovery: state.ultimateCount * cfg.ultimateDecibelRecovery,
      energyRecovery: 0,
      totalEnergyRecovery: 0,
      timeBucket: 'necessary',
    })
  }

  // 连携（始终生成，即使次数为 0 也进执行计划，供失衡轴动作池放置）
  {
    const car = cfg.chainComboAlignRatio
    executions.push({
      moveId: cfg.chainMoveId,
      moveName: '连携技（Chain Attack）',
      category: 'chain',
      count: chainCountTotal,
      actionTime: cfg.chainActionTime,
      comboAlignRatio: car,
      totalTime: chainCountTotal * cfg.chainActionTime,
      totalComboAlignTime: chainCountTotal * cfg.chainActionTime * car,
      energyConsume: 0,
      totalEnergyConsume: 0,
      decibelRecovery: cfg.chainDecibelRecovery,
      totalDecibelRecovery: chainCountTotal * cfg.chainDecibelRecovery,
      energyRecovery: 0,
      totalEnergyRecovery: 0,
      source: 'stun',
      timeBucket: 'necessary',
    })
  }

  // 角色机制模块追加专属动作，如维琳娜风华/广域气旋。
  getAgentMechanic(cfg.agentId)?.buildExecutions?.({ cfg, state, executions, teamFrontlineSeconds })

  // 通用「单次释放必打招 + 可持续招」强特（buildCharConfig 已 skipGenericExSpecial + 预存缩放倍率）。
  const sustainedEx = (cfg as unknown as Record<string, unknown>).sustainedEx as
    | {
        opener: { moveId: string; actionTime: number }[]
        sustain: { moveId: string; actionTime: number; damageMultiplier: number; dazeMultiplier: number; anomalyBuildUp: number }
        finisher: { moveId: string; actionTime: number }[]
      }
    | undefined
  if (sustainedEx) {
    const count = Math.max(0, state.exSpecialCount)
    const pushSeg = (moveId: string, actionTime: number) => {
      if (count <= 0) return
      executions.push({
        moveId,
        moveName: moveId,
        category: 'special',
        count,
        actionTime,
        comboAlignRatio: 0,
        totalTime: count * actionTime,
        totalComboAlignTime: 0,
        energyConsume: 0,
        totalEnergyConsume: 0,
        decibelRecovery: 0,
        totalDecibelRecovery: 0,
        energyRecovery: 0,
        totalEnergyRecovery: 0,
        timeBucket: 'necessary',
      })
    }
    for (const o of sustainedEx.opener) pushSeg(o.moveId, o.actionTime)
    if (count > 0) {
      const s = sustainedEx.sustain
      executions.push({
        moveId: s.moveId,
        moveName: s.moveId,
        category: 'special',
        count,
        actionTime: s.actionTime,
        comboAlignRatio: 0,
        totalTime: count * s.actionTime,
        totalComboAlignTime: 0,
        energyConsume: 0,
        totalEnergyConsume: 0,
        decibelRecovery: 0,
        totalDecibelRecovery: 0,
        energyRecovery: 0,
        totalEnergyRecovery: 0,
        damageMultiplier: s.damageMultiplier,
        damageMultiplierOverride: true,
        dazeMultiplier: s.dazeMultiplier,
        dazeMultiplierOverride: true,
        anomalyBuildUp: s.anomalyBuildUp,
        anomalyBuildUpOverride: true,
        timeBucket: 'necessary',
      })
    }
    for (const f of sustainedEx.finisher) pushSeg(f.moveId, f.actionTime)
  }

  // 额外强特行（免费/窗口门控，2026-09 用户裁决「引擎别太窄」）：注册表 src/data/exSpecialPlans.ts，
  // buildCharConfig 预存进 cfg.extraExPlans；行值由 enrichExecutionPlan 按 moveId 回填
  // （多段动作经 moveFusions 融合），能量成本 0（免费/替代资源由模块账本记）。
  for (const plan of cfg.extraExPlans ?? []) {
    const count = resolveExtraExCount(plan, {
      battleSeconds: Math.max(0, cfg.battleTime ?? 0),
      exCount: Math.max(0, Math.floor(state.exSpecialCount ?? 0)),
    })
    if (count <= 0) continue
    executions.push({
      moveId: plan.moveId,
      moveName: plan.label,
      category: 'special',
      count,
      actionTime: plan.actionTime,
      comboAlignRatio: 0,
      totalTime: count * plan.actionTime,
      totalComboAlignTime: 0,
      energyConsume: plan.energyCost,
      totalEnergyConsume: count * plan.energyCost,
      decibelRecovery: plan.decibelRecovery,
      totalDecibelRecovery: count * plan.decibelRecovery,
      energyRecovery: 0,
      totalEnergyRecovery: 0,
      timeBucket: 'necessary',
    })
  }

  // 蕾米后台飞行状态：每5秒自动释放一次 Radiant Turn；合轴100%，不占前台时间。
  // 后台时间含无敌秒（先扣）；CD 被蕾米本人前台时间插进循环造成相位延后 → 等效使用 CD（core/effectiveTime.ts）；
  // 前台块长 = 前台时间 / 切上次数（切上前台频率 × 非平A前台动作次数；蕾米暂无滑块声明，频率缺省 1，
  // 可经 cfg['setting:remielle.frontSwitchRatio'] 覆盖）。
  if (cfg.remielleEnabled && cfg.remielleRadiantTurnMoveId) {
    const block = frontBlockSeconds(
      state.frontlineTime ?? 0,
      countFrontActions(executions, { fusedMoveIds: [cfg.assistFollowUpMoveId] }),
      Number((cfg as unknown as Record<string, unknown>)['setting:remielle.frontSwitchRatio'] ?? 1),
      5,
    )
    const radiantInterval = phaseDelayedCooldown(5, state.frontlineTime, effectiveBattleTime(cfg), block)
    const radiantTurnCount = Math.floor(effectiveBackstageTime(state.backstageTime, cfg) / radiantInterval)
    if (radiantTurnCount > 0) {
      executions.push({
        moveId: cfg.remielleRadiantTurnMoveId,
        moveName: 'Special Attack: Ode to Dawn - Radiant Turn（后台）',
        category: 'special',
        count: radiantTurnCount,
        actionTime: cfg.remielleRadiantTurnActionTime ?? 0,
        comboAlignRatio: 1,
        totalTime: 0,
        totalComboAlignTime: 0,
        energyConsume: 0,
        totalEnergyConsume: 0,
      decibelRecovery: cfg.remielleRadiantTurnDecibelRecovery ?? 0,
      totalDecibelRecovery: radiantTurnCount * (cfg.remielleRadiantTurnDecibelRecovery ?? 0),
      energyRecovery: 0,
      totalEnergyRecovery: 0,
      timeBucket: 'backstage',
    })
    }
  }

  // 闪避反击（Dodge Counter）
  if (cfg.dodgeCounterCount > 0 && cfg.dodgeCounterActionTime > 0) {
    const car = cfg.dodgeCounterComboAlignRatio
    executions.push({
      moveId: cfg.dodgeCounterMoveId,
      moveName: '闪避反击（Dodge Counter）',
      category: 'dodge',
      count: cfg.dodgeCounterCount,
      actionTime: cfg.dodgeCounterActionTime,
      comboAlignRatio: car,
      totalTime: cfg.dodgeCounterCount * cfg.dodgeCounterActionTime,
      totalComboAlignTime: cfg.dodgeCounterCount * cfg.dodgeCounterActionTime * car,
      energyConsume: 0,
      totalEnergyConsume: 0,
      decibelRecovery: cfg.dodgeCounterDecibelRecovery,
      totalDecibelRecovery: cfg.dodgeCounterCount * cfg.dodgeCounterDecibelRecovery,
      energyRecovery: 0,
      totalEnergyRecovery: 0,
      timeBucket: 'necessary',
    })
  }

  // 轻弹刀（Defensive Assist #1）：count = 正常弹刀 + 不带支援突击弹刀
  const totalDefensiveAssist = (cfg.parryCount ?? 0) + (cfg.parryNoFollowUpCount ?? 0)
  if (totalDefensiveAssist > 0 && cfg.defensiveAssistActionTime > 0) {
    const car = cfg.defensiveAssistComboAlignRatio
    // x弹刀时间豁免（2026-09-02 用户口径）：非主弹窗位这 N 次弹刀行不占前台时间（喧响/失衡照计）
    const freeN = Math.min(totalDefensiveAssist, Math.max(0, Math.floor(cfg.parryTimeFreeCount ?? 0)))
    const charged = Math.max(0, totalDefensiveAssist - freeN)
    executions.push({
      moveId: cfg.defensiveAssistMoveId,
      moveName: '轻弹刀（Defensive Assist #1）',
      category: 'assist',
      count: totalDefensiveAssist,
      actionTime: cfg.defensiveAssistActionTime,
      comboAlignRatio: car,
      totalTime: charged * cfg.defensiveAssistActionTime,
      totalComboAlignTime: charged * cfg.defensiveAssistActionTime * car,
      energyConsume: 0,
      totalEnergyConsume: 0,
      decibelRecovery: cfg.defensiveAssistDecibelRecovery,
      totalDecibelRecovery: totalDefensiveAssist * cfg.defensiveAssistDecibelRecovery,
      energyRecovery: 0,
      totalEnergyRecovery: 0,
      timeBucket: 'necessary',
    })
  }

  // 支援突击（Assist Follow-Up）：只随正常弹刀（不带支援突击弹刀无此段）
  if (cfg.parryCount > 0 && cfg.assistFollowUpActionTime > 0) {
    const car = cfg.assistFollowUpComboAlignRatio
    const freeN = Math.min(cfg.parryCount, Math.max(0, Math.floor(cfg.parryTimeFreeCount ?? 0)))
    const charged = Math.max(0, cfg.parryCount - freeN)
    executions.push({
      moveId: cfg.assistFollowUpMoveId,
      moveName: '支援突击（Assist Follow-Up）',
      category: 'assist',
      count: cfg.parryCount,
      actionTime: cfg.assistFollowUpActionTime,
      comboAlignRatio: car,
      totalTime: charged * cfg.assistFollowUpActionTime,
      totalComboAlignTime: charged * cfg.assistFollowUpActionTime * car,
      energyConsume: 0,
      totalEnergyConsume: 0,
      decibelRecovery: cfg.assistFollowUpDecibelRecovery,
      totalDecibelRecovery: cfg.parryCount * cfg.assistFollowUpDecibelRecovery,
      energyRecovery: 0,
      totalEnergyRecovery: 0,
      timeBucket: 'necessary',
    })
  }

  // 招式执行计划完全构建后，模块可做最终修正（如按招式标签补增伤/暴击/固定附加伤害）。
  getAgentMechanic(cfg.agentId)?.patchExecutions?.({ cfg, state, executions, teamFrontlineSeconds })

  return executions.map(exec => applyExecutionUtilization(cfg, exec))
}

export function buildAnomalyEventExecutions(cfg: CharacterOperationConfig, state: IterationState, totalTime = 180): AnomalyEventExecution[] {
  const events: AnomalyEventExecution[] = []
  getAgentMechanic(cfg.agentId)?.buildAnomalyEvents?.({ cfg, state, events, totalTime })

  const remielleRainbowEndCount = remielleSpecialVoidflareUseCount(cfg)
  const cannonRotorMultiplier = cfg.cannonRotorDamageMultiplier ?? 0
  const cannonRotorCooldown = cfg.cannonRotorCooldownSeconds ?? 0
  if (cannonRotorMultiplier > 0 && cannonRotorCooldown > 0) {
    const count = Math.ceil(effectiveBattleTime({ battleTime: totalTime, invincibleTime: cfg.invincibleTime }) / cannonRotorCooldown)
    events.push({
      eventId: 'cannon_rotor_crit_proc',
      eventName: '加农转子额外伤害',
      eventType: 'direct_damage',
      count,
      damageMultiplier: cannonRotorMultiplier,
      formula: `count = ceil(有效战斗时长 / ${cannonRotorCooldown})；damage = 攻击力 × ${cannonRotorMultiplier}% × 装备者直伤乘区`,
      fields: ['cannonRotorDamageMultiplier', 'cannonRotorCooldownSeconds', 'atk', 'crit/directDamageZones'],
      note: '按命中并暴击可稳定触发处理；次数受精修 CD 封顶（战斗时长扣 boss 无敌），伤害应按装备者当前直伤乘区结算。',
    })
  }

  if (remielleRainbowEndCount > 0 && cfg.remielleRainbowEndMoveId) {
    events.push({
      eventId: 'remielle_special_voidflare_event',
      eventName: '特殊虚耀',
      eventType: 'special_voidflare',
      carrierMoveId: cfg.remielleRainbowEndMoveId,
      carrierMoveName: '普通攻击：垂虹',
      count: remielleRainbowEndCount,
      formula: 'count = (remielleCinema1SpecialVoidflareCount + remielleCinema4SpecialVoidflareRefillCount) × remielleCinema6SpecialVoidflareTriggerMultiplier',
      fields: [
        'remielleCinema1SpecialVoidflareCount',
        'remielleCinema4SpecialVoidflareRefillCount',
        'remielleCinema6SpecialVoidflareTriggerMultiplier',
        'remielleRainbowEndMoveId',
      ],
      note: '异常事件只记录次数和载体动作；不进入普通招式执行计划，不读取 damageMultiplier。',
    })
  }
  return events.map(event => applyEventUtilization(cfg, event))
}

// ============ 单次迭代 ============

/**
 * 计算强特次数。
 * 伊德海莉：失衡内强特由失衡轴连段反推（yidhariInStunExCount），
 * 剩下闪能打非失衡强特（每次 50 闪能，回 15，净耗 35 由 refund 循环收敛）。
 */
export function resolveExSpecialCount(cfg: CharacterOperationConfig, totalEnergy: number): number {
  // 替代资源型强特（如克拉蕾锐能 60/发）：次数由模块资源账本给出（不动点，上一轮写入），
  // 不由能量预算推导、不扣能量——2026-09 成本类型化（findExSpecial costType=resource）。
  if (cfg.exSpecialCostType === 'resource') {
    return Math.max(0, Math.floor(cfg.exSpecialResourcePaidCount ?? 0))
      + Math.max(0, Math.floor(cfg.freeExSpecialCount ?? 0))
  }
  if (cfg.exSpecialEnergyConsume <= 0) return 0
  if (cfg.agentId === '1471') {
    // 般岳：强特总次数由嗔火/怒相循环决定（怒相内山威免费 + 怒相外付费连段 + 地动滑块 + 轴内捏的普通强特），
    // 不能用 闪能/20 —— 免费强特不耗闪能；轴内连段块不重复计（认领怒相内/外行，池守恒）
    const c = computeBanyueCycleFromCfg(cfg)
    const axisEx = readAxisExCounts(cfg)
    let axisNormal = 0
    for (const [k, v] of Object.entries(axisEx)) if (k !== 'banyue-combo' && k !== 'banyue-combo-didong') axisNormal += v
    return c.lunDaoRageCount + c.shiZiHouNuCount + c.shanYaoRageCount
      + c.diDongRageCount + c.shanYaoNuRageCount
      + c.lunDaoOutCount + c.shiZiHouNuOutCount
      + c.diDongOutCount + c.shanYaoNuOutCount
      + axisNormal
  }
  if (cfg.agentId === '1051' && cfg.yidhariInStunExCount !== undefined) {
    const inStun = cfg.yidhariInStunExCount
    const inStunCost = cfg.yidhariInStunEnergyCost ?? inStun * cfg.exSpecialEnergyConsume
    const remaining = totalEnergy - inStunCost
    const outStun = remaining > 0 ? Math.floor(remaining / cfg.exSpecialEnergyConsume) : 0
    return inStun + outStun
  }
  const paid = cfg.exSpecialCountFloor || !cfg.skipGenericExSpecial
    ? Math.floor(totalEnergy / cfg.exSpecialEnergyConsume)
    : totalEnergy / cfg.exSpecialEnergyConsume
  // 免费强特（如南宫羽每次失衡一次免能E）：不占闪能预算，照常计次/计时/喧响
  return paid + Math.max(0, Math.floor(cfg.freeExSpecialCount ?? 0))
}

/** 单次迭代：根据当前 state 计算新的 state */
export function iterate(
  configs: CharacterOperationConfig[],
  prevStates: IterationState[],
  globalCfg: ResourceCalcConfig,
): IterationState[] {
  const totalTime = globalCfg.totalTime
  const newStates: IterationState[] = []

  // Step 1: 计算每个角色的能量和喧响（基于上一轮的时间分配）
  const energies: number[] = []
  const energySnapshots: EnergySource[] = []
  const decibels: number[] = []
  const shareableDecibels: number[] = []

  for (let i = 0; i < configs.length; i++) {
    const cfg = configs[i]
    const prev = prevStates[i]

    // 能量。连携次数与展示口径一致（chainCountTotalOverride ?? chainCountPerStun × stunCount）：
    // 时光切片（音擎 13002）连携触发的回能随此进循环、驱动强特次数。曾传 0 造成
    // 「展示明细含连携回能、次数推导不含」的口径分裂（derivedEnergy < energySource.total），
    // 见 CharacterResourceResult.derivedEnergy 注释。
    const chainCountInput = cfg.chainCountTotalOverride ?? cfg.chainCountPerStun * (globalCfg.stunCount ?? 0)
    const energySrc = calcEnergySource(cfg, prev, configs, globalCfg.shieldCount, globalCfg.energyShieldCount, chainCountInput, globalCfg.totalTime)
    // 队友联动回能（单一事实源，与最终装配同函数）
    const crossAgent = calcCrossAgentEnergy(i, configs, prevStates)
    const totalEnergy = energySrc.total + crossAgent.total
    energies.push(totalEnergy)
    // 快照（2026-09-03）：驱动次数的能量源原样存进 state——装配展示复用同一对象，
    // 杜绝「展示重算（当前态）≠ 驱动（上轮态）Δ≠0」的分裂（实测雅/莱卡恩 Δ=+55.5）。
    energySnapshots.push({
      ...energySrc,
      crossAgent,
      supportUltimateRegen: crossAgent.supportUltimateRegen,
      total: totalEnergy,
    })

    // 强特次数 = 总能量 ÷ 强特消耗（伊德海莉失衡内由轴连段反推，剩余打非失衡强特）
    const exSpecialCount = resolveExSpecialCount(cfg, totalEnergy)

    // 喧响（先算独立可分享部分，效率在接收者获得时统一乘入）。
    // 连携数据行回复参与次数推导且被队友伴随，避免推导与展示差 1 次
    const rawDecibel = calcRawDecibelParts(cfg, prev, chainCountInput, exSpecialCount, prev.ultimateCount, totalTime)
    shareableDecibels.push(rawDecibel.shareableTotal)
  }

  // Step 2: 计算队友伴随喧响
  const teammateShares: number[] = []
  for (let i = 0; i < configs.length; i++) {
    let share = 0
    for (let j = 0; j < configs.length; j++) {
      if (j === i) continue
      // 队友 j 的可分享喧响 × 队友 j 的分享比例
      share += shareableDecibels[j] * configs[j].decibelShareRatio
    }
    teammateShares.push(share)
  }

  // 卢西娅4命：帷幕开启/延长（含队友如伊德海莉大招开帷幕）→ 全队每人喧响；15s CD 封顶 × 利用率滑块
  const luciaSlot = configs.findIndex(c => c.agentId === '1451')
  const yidhariSlot = configs.findIndex(c => c.agentId === '1051')
  const curtainCoverage = configs.find(c => c.luciaC4CurtainCoverage !== undefined)?.luciaC4CurtainCoverage ?? 1
  const curtainTriggers = luciaSlot >= 0
    ? computeLuciaCurtainTriggers(
        prevStates[luciaSlot]?.exSpecialCount ?? 0,
        prevStates[luciaSlot]?.ultimateCount ?? 0,
        yidhariSlot >= 0 ? (prevStates[yidhariSlot]?.ultimateCount ?? 0) : 0,
        curtainCoverage,
        totalTime,
      )
    : 0

  // Step 3: 计算总喧响和终结技次数
  for (let i = 0; i < configs.length; i++) {
    const cfg = configs[i]
    const prev = prevStates[i]
    // 伊德海莉烧血喧响：开局场外烧 75% + 战斗中把全部回复量烧掉（固定不可分享，参与终结技次数）
    const yidhariBurn = (() => {
      if (cfg.agentId !== '1051') return 0
      const missing = Math.max(0, Math.min(1, cfg.yidhariExHealMissingHpPct ?? 0.75))
      const decibelPerHp = cfg.yidhariDecibelPerHpPct ?? 10
      // 外部回血（卢西娅星光汇聚之地）：固定部分 + 按卢西娅终结技次数结算部分（%自身最大生命值）
      const external = Math.max(0, (cfg.yidhariExternalHealPct ?? 0)
        + (cfg.yidhariExternalHealPerUltPct ?? 0) * (luciaSlot >= 0 ? (prevStates[luciaSlot]?.ultimateCount ?? 0) : 0))
      const cycleTime = 1 + (cfg.yidhariChargeSlam?.actionTime ?? 0) + (cfg.yidhariBasicFollow?.actionTime ?? 0)
      const cycles = cycleTime > 0 ? Math.floor((prev.basicAttackTime ?? 0) / cycleTime) : 0
      const exHeal = (prev.exSpecialCount ?? 0) * 33 * missing
      const followHeal = cycles * 10
      return (75 + exHeal + followHeal + external) * decibelPerHp
    })()
    const extraSelfDecibel = (cfg.extraSelfDecibelReward ?? 0)
      + (cfg.extraSelfDecibelPerUltimate ?? 0) * prev.ultimateCount
      + (cfg.luciaC4DecibelPerTrigger ?? 0) * curtainTriggers
      // 诺姆影画4·膛温换连携：诺姆+上一位队友各 +200 不可分享喧响（次数 = floor(膛温/80)，
      // buildResourceResult 上一轮写入 cfg.normaHatToChainCount；计入终结技次数）
      // 诺姆影画4·膛温换连携：诺姆+上一位队友各 +200 不可分享喧响（次数 = floor(膛温/80)，
      // 直接调模块纯函数（iterate 内可用 prev 状态），计入终结技次数）
      + ((cfg.normaCinemaLevel ?? 0) >= 4 && cfg.agentId === '1571'
        ? computeNormaHatToChainCount(cfg, {
            exSpecialCount: prev.exSpecialCount,
            ultimateCount: prev.ultimateCount,
            frontlineTime: prev.frontlineTime,
            battleTime: totalTime,
          }, Number((cfg as unknown as Record<string, unknown>)['setting:norma.holdSeconds'] ?? 2)) * 200 * 2
        : 0)
      + yidhariBurn
    // 特殊动作奖励（本轮即时按连携/弹刀/闪反/快支次数结算）+ 异常奖励（上一轮异常池回填），均含队友伴随
    const externalDecibelBonus = (globalCfg.specialActionDecibelBonusPerSlot?.[i] ?? 0)
      + (globalCfg.anomalyDecibelBonusPerSlot?.[i] ?? 0)
    const totalDecibel = (cfg.initialDecibelGift + shareableDecibels[i] + teammateShares[i] + extraSelfDecibel
      + externalDecibelBonus) * decibelEfficiencyMultiplier(cfg)
    decibels.push(totalDecibel)
  }

  // Step 4: 计算必做动作前台时间、合轴抵扣与单角色前台时间
  // 先算总必做动作前台时间与每角色合轴（全额 + 可抵扣部分），再分配平A时间
  const totalNecessary: number[] = []
  const comboAlignTimes: number[] = []
  const comboAlignCredits: number[] = []
  for (let i = 0; i < configs.length; i++) {
    const cfg = configs[i]
    const exSpecialCount = resolveExSpecialCount(cfg, energies[i])
    // 时间轴喧响轨（轴模式注入 axisUltimateTrackBySlot）：窗口时序推演的实际可放大招数
    //（进窗不够 3000 的窗大招被削减）；缺省回落总量口径 floor(喧响/消耗)
    const trackedUltimate1 = globalCfg.axisUltimateTrackBySlot?.[cfg.slot]
    const ultimateCount = typeof trackedUltimate1 === 'number' && trackedUltimate1 >= 0
      ? trackedUltimate1
      : Math.floor(decibels[i] / cfg.ultimateCost)

    // 连携次数 = 每次失衡连携次数 × 失衡次数（失衡次数由外部失衡池不动点收敛后传入 globalCfg.stunCount）
    // 失衡轴模式用 chainCountTotalOverride（各轴按窗口数加权后的最终连携次数）
    const chainCount = cfg.chainCountTotalOverride ?? cfg.chainCountPerStun * (globalCfg.stunCount ?? 0)

    const necessary = exSpecialNecessaryTime(cfg, exSpecialCount, ultimateCount)
      + ultimateCount * cfg.ultimateActionTime
      + chainCount * cfg.chainActionTime
      + cfg.dodgeCounterCount * cfg.dodgeCounterActionTime
      + (cfg.parryCount ?? 0) * cfg.assistFollowUpActionTime
      + ((cfg.parryCount ?? 0) + (cfg.parryNoFollowUpCount ?? 0)) * cfg.defensiveAssistActionTime
      + remielleSpecialVoidflareUseCount(cfg) * cfg.remielleRainbowEndActionTime
      // 时间预算收敛：执行计划中模块专属动作行（如雅霜月架势、叶瞬光飞光）占用前台但未计入
      // estimateExSpecialTime → Σ执行行时间超战斗时间；外层循环把超出部分折入必要时间，压缩平A池。
      + (cfg.timeBudgetExcess ?? 0)
    totalNecessary.push(necessary)

    // 合轴时间 = 各招式合轴部分之和（展示/非操作回能通道用全额）
    const comboAlignGeneric =
      ultimateCount * cfg.ultimateActionTime * cfg.ultimateComboAlignRatio
      + chainCount * cfg.chainActionTime * cfg.chainComboAlignRatio
      + cfg.dodgeCounterCount * cfg.dodgeCounterActionTime * cfg.dodgeCounterComboAlignRatio
      + (cfg.parryCount ?? 0) * cfg.assistFollowUpActionTime * cfg.assistFollowUpComboAlignRatio
      + ((cfg.parryCount ?? 0) + (cfg.parryNoFollowUpCount ?? 0)) * cfg.defensiveAssistActionTime * cfg.defensiveAssistComboAlignRatio
      + remielleSpecialVoidflareUseCount(cfg) * cfg.remielleRainbowEndActionTime * cfg.remielleRainbowEndComboAlignRatio
    comboAlignTimes.push(exSpecialComboAlignTime(cfg, exSpecialCount, ultimateCount) + comboAlignGeneric)
    // 预算抵扣部分：通用项全额可抵扣（necessary 按全额计），强特项按 GROSS/NET 约定
    comboAlignCredits.push(exSpecialComboAlignCredit(cfg, exSpecialCount, ultimateCount) + comboAlignGeneric)
  }

  // 总必做动作前台时间
  const sumNecessary = totalNecessary.reduce((a, b) => a + b, 0)
  // 合轴抵扣（团队级）：必做动作的合轴段与其他角色的动作并行，不占共享时间预算——
  // Σnecessary 允许 > 战斗时间（Σ>180），只要合轴抵扣后的净占用装得下。
  // 轴模式下栈引擎节省（axisOverlapByAction）与招式合轴率是同一物理并行的两种模型，
  // 按槽位取 max 不叠加（防同时设置时超扣；缺省合轴率全 0，退化为原口径）。
  // @fact engine:合轴预算抵扣 口径: 必做动作合轴段与其他角色动作并行、抵扣团队时间预算（Σnecessary 允许>战斗时间）；轴模式与栈引擎节省按槽取 max 不叠加；只抵扣含在 necessary 内的部分（GROSS 缺省，NET 模块照/卢西娅不重复抵） | 据 用户@2026-09-04 | 验 src/composables/__tests__/comboAlignBudget.test.ts | 锚 src/core/resource/helpers.ts#netFrontlineOccupation | 信 确认
  // @fact engine:单角色前线上限 口径: 单角色前台（必要+平A）≤ 战斗总时间——合轴抵扣放宽团队预算不放宽单人物理时间轴；截断份额留池不重分配 | 据 用户@2026-09-04 | 验 src/composables/__tests__/comboAlignBudget.test.ts | 锚 src/core/resource/helpers.ts#iterate | 信 确认
  const overlapBySlot: number[] = configs.map(() => 0)
  let hasByAction = false
  for (const [key, sec] of Object.entries(globalCfg.axisOverlapByAction ?? {})) {
    const slot = Number(key.slice(0, key.indexOf(':')))
    const idx = configs.findIndex(c => c.slot === slot)
    if (idx >= 0 && Number.isFinite(sec)) {
      overlapBySlot[idx] += sec
      hasByAction = true
    }
  }
  const axisOverlapTotal = globalCfg.axisOverlapSeconds ?? 0
  const reliefSeconds = hasByAction
    ? comboAlignCredits.reduce((sum, credit, i) => sum + Math.max(credit, overlapBySlot[i]), 0)
    : Math.max(comboAlignCredits.reduce((a, b) => a + b, 0), axisOverlapTotal)
  // 可分配平A时间 = 总时间 − 无敌时间 − 必做净占用（合轴抵扣后）+ 欠打回填（timeBudgetRefund，团队级）。
  // 无敌时间不扣能量/喧响回能，但扣平A池。
  const invTime = globalCfg.invincibleTime ?? 0
  const budget = totalTime - invTime
  globalCfg.overflowSeconds = Math.max(0, sumNecessary - reliefSeconds - budget)
  const availableBasicTime = Math.max(0, budget - sumNecessary + reliefSeconds
    + (globalCfg.timeBudgetRefund ?? 0))

  // 按权重分配平A时间
  const totalWeight = configs.reduce((a, c) => a + c.timeWeight, 0)

  for (let i = 0; i < configs.length; i++) {
    const cfg = configs[i]
    const exSpecialCount = resolveExSpecialCount(cfg, energies[i])
    // 时间轴喧响轨（与 Step4 同口径）：窗口时序推演的实际可放大招数
    const trackedUltimate2 = globalCfg.axisUltimateTrackBySlot?.[cfg.slot]
    const ultimateCount = typeof trackedUltimate2 === 'number' && trackedUltimate2 >= 0
      ? trackedUltimate2
      : Math.floor(decibels[i] / cfg.ultimateCost)

    const necessary = totalNecessary[i]
    // 单角色前台硬顶：合轴抵扣放宽的是团队预算，单个角色自身时间轴仍受战斗总时长约束
    // （前台 = 必要 + 平A ≤ totalTime）；截断的份额留在池里，不重分配给其他角色。
    const basicAttackTime = Math.min(
      totalWeight > 0 ? availableBasicTime * (cfg.timeWeight / totalWeight) : 0,
      Math.max(0, totalTime - necessary))

    // 连携次数（与第一个循环保持一致）：每次失衡连携次数 × 失衡次数
    // 失衡轴模式用 chainCountTotalOverride（各轴按窗口数加权后的最终连携次数）
    const chainCount = cfg.chainCountTotalOverride ?? cfg.chainCountPerStun * (globalCfg.stunCount ?? 0)

    const frontlineTime = necessary + basicAttackTime
    const backstageTime = Math.max(0, totalTime - frontlineTime)

    newStates.push({
      basicAttackTime,
      exSpecialCount,
      ultimateCount,
      chainCountTotal: chainCount,
      totalEnergy: energies[i],
      energySource: energySnapshots[i],
      totalDecibel: decibels[i],
      necessaryTime: necessary,
      frontlineTime,
      backstageTime,
      comboAlignTime: comboAlignTimes[i],
      comboAlignCredit: comboAlignCredits[i],
    })
  }

  return newStates
}

// ============ 主计算函数 ============

/** 资源池主计算入口 */
