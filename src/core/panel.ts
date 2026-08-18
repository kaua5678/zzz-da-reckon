/**
 * 面板计算 - 局外面板与局内面板
 */
import type {
  Agent, WEngine, DriveDiscSet, PanelValues, DriveDiscConfig, TeammateBuff, BuffEffect, StatId,
} from '@/types/catalog'
import { applyBuffs, applyEffect, applyStat, collectAllBuffs, finalizeCoreStatBonuses, type CollectedBuffs } from './buff'
import type { StatRules } from '@/types/catalog'

/** 创建空面板 */
export function emptyPanel(): PanelValues {
  return {
    // 基础属性
    hp: 0, atk: 0, def: 0,
    critRate: 5, critDmg: 50, sharpCritDmg: 50,
    impact: 0, anomalyProficiency: 0, anomalyMastery: 0,
    energyRegen: 1.2, flashEnergyRegen: 0,
    energyRegenOutOfCombat: 1.2,
    energyMax: 120, flashEnergyMax: 0,
    penRatio: 0, penFlat: 0,
    // 增伤区
    dmgBonus: 0,
    physicalDmg: 0, fireDmg: 0, iceDmg: 0,
    electricDmg: 0, etherDmg: 0, windDmg: 0, lumifluxDmg: 0,
    penDmgBonus: 0,
    sheerForceFlat: 0,
    sheerDmgBonus: 0,
    sharpDmgBonus: 0,
    skillDmgBonus: 0,
    // 失衡相关
    stunBuildUpBonus: 0,
    stunDmgMultiplierBonus: 0,
    stunDmgMultiplierBonusAlways: 0,
    stunDmgMultiplierBonusCapAlways: 0,
    yeshuguangStunCapMult: 0,
    // 异常积蓄相关
    anomalyBuildUpEfficiency: 0,
    electricAnomalyBuildUpEfficiency: 0,
    physicalAnomalyBuildUpEfficiency: 0,
    // 异常伤害相关
    anomalyDmgBonus: 0,
    windAnomalyDmgBonus: 0,
    turbulenceDamageBonus: 0,
    anomalyCritRate: 0,
    anomalyCritDmg: 0,
    anomalyReleaseDmgBonus: 0,
    remielleRefringeCoefficient: 0,
    remielleRefringeCoefficientBonusPct: 0,
    remielleLuminizeMultiplierBonus: 0,
    remielleCinema4LuminizeMultiplierBonus: 0,
    remielleCinema1SpecialVoidflareCount: 0,
    remielleCinema1SpecialVoidflareDamage: 0,
    remielleFlowerFeatherDanceDecibelPerUse: 0,
    remielleFlowerFeatherDanceCount: 0,
    remielleCinema4SpecialVoidflareRefillCount: 0,
    remielleCinema6LuminizeTriggerMultiplier: 1,
    remielleCinema6SpecialVoidflareTriggerMultiplier: 1,
    remielleCinema6FleetingGraceVoidflareTriggerMultiplier: 1,
    remielleCinema6SpecialVoidflareCount: 0,
    remielleCinema6SpecialVoidflareDamageRatio: 0,
    skillLevelBonus: 0,
  assaultCritRate: 0,
  assaultCritDmg: 0,
  janeAssaultCritDmgBonus: 0,
    enemyAssaultDefReduction: 0,
    // 能量/资源相关
    energyRegenBonusPct: 0,
    energyRegenBonusFlat: 0,
    energyGainEfficiency: 0,
    backstageEnergyRegenFlat: 0,
    nonOperatingEnergyRegenFlat: 0,
    demaraEnergyGainEfficiency: 0,
    zhenyuanEnergyPerTrigger: 0,
    timeSliceDodgeCounterDecibel: 0,
    timeSliceExSpecialDecibel: 0,
    timeSliceAssistDecibel: 0,
    timeSliceChainDecibel: 0,
    timeSliceEnergyPerTrigger: 0,
    healingAmount: 0,
    flashEnergyRegenBonusPct: 0,
    flashEnergyRegenBonusFlat: 0,
    flashEnergyGainEfficiency: 0,
    decibelGainEfficiency: 0,
    // 敌方减益
    enemyDefReduction: 0,
    enemyDefFlatReduction: 0,
    enemyAnomalyDefReduction: 0,
    enemyLumifluxResReduction: 0,
    enemyPhysicalDefReduction: 0,
    enemyFireDefReduction: 0,
    enemyIceDefReduction: 0,
    enemyElectricDefReduction: 0,
    enemyEtherDefReduction: 0,
    enemyWindDefReduction: 0,
    enemyLumifluxDefReduction: 0,
    enemyResReduction: 0,
    enemyPhysicalResReduction: 0,
    enemyFireResReduction: 0,
    enemyIceResReduction: 0,
    enemyElectricResReduction: 0,
    enemyEtherResReduction: 0,
    enemyWindResReduction: 0,
    enemyStunResReduction: 0,
    enemyPhysicalStunResReduction: 0,
    enemyFireStunResReduction: 0,
    enemyIceStunResReduction: 0,
    enemyElectricStunResReduction: 0,
    enemyEtherStunResReduction: 0,
    enemyWindStunResReduction: 0,
    enemyLumifluxStunResReduction: 0,
    enemyAnomalyResReduction: 0,
    enemyPhysicalAnomalyResReduction: 0,
    enemyFireAnomalyResReduction: 0,
    enemyIceAnomalyResReduction: 0,
    enemyElectricAnomalyResReduction: 0,
    enemyEtherAnomalyResReduction: 0,
    enemyWindAnomalyResReduction: 0,
    enemyLumifluxAnomalyResReduction: 0,
    enemyDamageTakenBonus: 0,
    enemyCritDmgTakenBonus: 0,
    enemyStunTakenBonus: 0,
    physicalAnomalyDurationBonusSeconds: 0,
    fireAnomalyDurationBonusSeconds: 0,
    electricAnomalyDurationBonusSeconds: 0,
    etherAnomalyDurationBonusSeconds: 0,
    infectionZoneBonus: 0,
    additionalAbilityActive: 0,
    stunDurationBonusSeconds: 0,
    disorderDamageBonus: 0,
    disorderBaseMultiplierBonus: 0,
    anomalyDurationBonusSeconds: 0,
  }
}

/** 计算基础面板（角色 + 音擎基础属性） */
export function calcBasePanel(agent: Agent, wEngine: WEngine | undefined): PanelValues {
  const s = agent.level60
  const panel = emptyPanel()

  panel.hp = s.hpBase
  panel.atk = s.atkBase
  panel.def = s.defBase
  panel.critRate = s.critRate
  panel.critDmg = s.critDmg
  panel.sharpCritDmg = (s as any).sharpCritDmg ?? 50
  panel.impact = s.impact
  panel.anomalyProficiency = s.anomalyProficiency
  panel.anomalyMastery = s.anomalyMastery
  panel.energyRegen = s.energyRegen
  panel.flashEnergyRegen = s.flashEnergyRegen ?? 0
  panel.energyMax = s.energyMax ?? 120
  panel.flashEnergyMax = s.flashEnergyMax ?? 0
  panel.penRatio = s.penRatio

  // 音擎基础属性。音擎进阶属性属于局外加成，在 calcPanel 中与驱动盘/局外 buff 同批汇总。
  if (wEngine) {
    const wBaseStat = wEngine.level60.baseStat ?? 'atk'
    if (wBaseStat === 'def') panel.def += wEngine.level60.atkBase
    else if (wBaseStat === 'hp') panel.hp += wEngine.level60.atkBase
    else panel.atk += wEngine.level60.atkBase
  }

  return finalizeCoreStatBonuses(panel)
}

/** 应用驱动盘主词条和副词条 */
function inferStatMode(stat: string): 'pct' | 'flat' {
  return stat.endsWith('Pct') || stat.endsWith('Rate') || stat.endsWith('Dmg')
    || stat.endsWith('Ratio') || stat.endsWith('Mastery') || stat.endsWith('Regen')
    || stat.endsWith('Impact') || stat.endsWith('Efficiency') || stat.endsWith('Bonus')
    ? 'pct'
    : 'flat'
}

export function applyDriveDiscConfig(
  panel: PanelValues,
  config: DriveDiscConfig,
  statRules: StatRules | null,
  extraStats: { stat: StatId; value: number; mode: string }[] = [],
  extraEffects: BuffEffect[] = [],
): PanelValues {
  const result = { ...panel }

  for (const stat of extraStats) {
    applyStat(result, stat.stat, stat.value, stat.mode)
  }

  if (!statRules) {
    for (const effect of extraEffects) applyEffect(result, effect)
    return finalizeCoreStatBonuses(result)
  }

  const maxMain = statRules.driveDisc.sRankMaxMainStat
  const subStep = statRules.driveDisc.sRankSubStatBaseStep
  const subStatPool = new Set(statRules.driveDisc.subStatPool ?? Object.keys(subStep))

  // 4、5、6号位主词条
  for (const slot of [4, 5, 6] as const) {
    const stat = config.mainStats?.[slot]
    if (stat && maxMain[stat] != null) {
      applyStat(result, stat, maxMain[stat], inferStatMode(stat))
    }
  }

  // 副词条
  if (config.subStatAllocation) {
    for (const [stat, count] of Object.entries(config.subStatAllocation)) {
      if (!count) continue
      if (!subStatPool.has(stat)) continue
      const step = subStep[stat] ?? 0
      if (!step) continue
      const value = step * count // count即升级步数，不再乘2.25
      applyStat(result, stat, value, inferStatMode(stat))
    }
  }

  for (const effect of extraEffects) {
    applyEffect(result, effect)
  }

  return finalizeCoreStatBonuses(result)
}

/** 完整面板计算 */
export interface PanelResult {
  base: PanelValues       // 基础面板（角色+音擎）
  withDiscs: PanelValues  // 加上驱动盘词条
  outOfCombat: PanelValues // 局外面板（+局外buff）
  inCombat: PanelValues    // 局内面板（+局内buff）
  buffs: CollectedBuffs    // 收集的 buff
}

export function calcPanel(
  agent: Agent,
  wEngine: WEngine | undefined,
  driveDiscConfig: DriveDiscConfig,
  setsMap: Map<string, DriveDiscSet>,
  teammateBuffs: TeammateBuff[],
  statRules: StatRules | null,
  config: { cinemaLevel: number; wEngineModLevel: number; sourcePanelsByOwner?: import('./buff').SourcePanelsByOwner; effectCoverageMap?: Map<string, number> }
): PanelResult {
  // 1. 基础面板
  const base = calcBasePanel(agent, wEngine)

  const wEngineAdvancedStats = wEngine?.level60.advancedStat
    ? [{
        stat: wEngine.level60.advancedStat.stat,
        value: wEngine.level60.advancedStat.value,
        mode: wEngine.level60.advancedStat.mode,
      }]
    : []

  // 2. 应用音擎进阶属性 + 驱动盘词条
  const withDiscs = applyDriveDiscConfig(base, driveDiscConfig, statRules, wEngineAdvancedStats)

  // 3. 收集所有 buff
  const buffs = collectAllBuffs(agent, wEngine, driveDiscConfig, setsMap, teammateBuffs, {
    cinemaLevel: config.cinemaLevel,
    wEngineModLevel: config.wEngineModLevel,
    sourcePanelsByOwner: config.sourcePanelsByOwner,
  })

  // 4. 局外面板 = 基础白值 + 音擎高级词条 + 驱动盘主副词条 + 局外 buff。
  // 攻击/生命/防御局外段：基础数据 × (1 + Σ局外百分比加成) + Σ局外固定值。
  const outOfCombat = applyBuffs(
    applyDriveDiscConfig(base, driveDiscConfig, statRules, wEngineAdvancedStats, buffs.outOfCombat),
    [],
    config.effectCoverageMap,
  )

  // 5. 局内面板 = 局外总属性 × (1 + Σ局内百分比加成) + Σ局内固定值加成。
  // 音擎被动、驱动4件套、队友战斗 buff 等触发型效果默认属于局内。
  const inCombat = applyBuffs(outOfCombat, buffs.inCombat, config.effectCoverageMap)

  return { base, withDiscs, outOfCombat, inCombat, buffs }
}
