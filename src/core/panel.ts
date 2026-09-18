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
    anomalyBuildUpEfficiencyOnStunBonus: 0,
    anomalyBuildUpEfficiencyOnStunChainBonus: 0,
    stunDmgMultiplierBonus: 0,
    stunDmgMultiplierBonusAlways: 0,
    stunDmgMultiplierBonusCapAlways: 0,
    yeshuguangStunCapMult: 0,
    yeshuguangVeilStunBase: 0,
    // 异常积蓄相关
    anomalyBuildUpEfficiency: 0,
    electricAnomalyBuildUpEfficiency: 0,
    physicalAnomalyBuildUpEfficiency: 0,
    etherAnomalyBuildUpEfficiency: 0,
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
    // -1 = **未盖章**（见 `panelAt`）：真实槽位号由 `computePanel(slot, …)` 的调用方盖上。
    // 不写 0——那会让「槽1/槽2 的空面板」冒充槽0，`panelAt` 的身份查找随即失真。
    slot: -1,
  }
}

/**
 * 按**槽位号**取面板 —— 数组是**按位置压缩**的（`computePanel` 跳过空槽），故**不能**用
 * `panels[slot]` 下标（槽位号 ≠ 下标）。
 *
 * 为什么需要它（2026-09-16 实测的整类缺陷）：`panels` / `damagePanels` / `remielleEntryPanels`
 * 都由 `for (let i = 0; i < 3; i++) { const p = computeX(i); if (p) result.push(p) }` 产出——
 * 空槽不 push ⇒ 长度 = 有角色的槽数。下游 `panels[slot]` 在**前导/中间空槽**时静默错位：
 * 轻则取到 `undefined`、重则取到**别人那份面板**（跨角色污染），实测 3 个角色直接抛 TypeError。
 * 三个数组的 producer 都盖了 `slot` 章，故这里按身份查。
 *
 * 兼容**未盖章**的入参（单元测试常手工构造密集数组 `[{…}, {…}, {…}]`，下标 == 槽位号）：
 * 仅当整个数组**没有任何一个面板盖过章**时才断定「这是未盖章的密集数组」并回落到下标；
 * 只要数组里出现过章，就认定它是生产侧产出的压缩数组——此时 find 未命中 = 该槽**确实没有角色**
 * （空槽本就不该有面板），返回 `undefined`（调用方沿用既有 `?? emptyPanel()` 等兜底）。
 * 这条判据是防「producer 漏盖章 ⇒ 静默按错下标取值」的关键：宁返回 undefined 也不猜。
 *
 * ⚠ 本函数**不得有副作用**（曾写过「回落到下标时顺手盖章」，实测自伤：第一次查找盖了其中一个
 * 元素的章，数组随即「看起来已盖章」，下一次查别的槽就判成压缩数组而返回 undefined ⇒
 * `anomalyPool.test.ts` 的维琳娜风蚀替换用例变红）。回落分支必须保持只读。
 */
export function panelAt(panels: readonly PanelValues[], slot: number): PanelValues | undefined {
  const found = panels.find(p => p.slot === slot)
  if (found) return found
  // 「已盖章」= slot >= 0（`emptyPanel()` 的 -1 与手工构造对象的 undefined 都算未盖章）。
  if (panels.some(p => (p.slot ?? -1) >= 0)) return undefined // 压缩数组：该槽确实无角色
  return panels[slot] // 整体未盖章的密集数组（测试手工构造）：下标 == 槽位号
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

/**
 * 驱动盘主词条/副词条的**结算口径**（`applyStat` 的 `mode` 实参）。
 *
 * 驱动盘数值的语义由 **catalog 外部数据** 决定：`statRules.statDisplay[k].display`
 * （`percent` ⇒ 按基础值的百分比、`number`/`integer` ⇒ 固定值加点）。名字后缀启发式**只作未登记字段的兜底**
 * （与 `utils/statMeta.ts#statSettlementMode` 同形），不再对已登记字段生效。
 *
 * **为什么必须读 catalog 而不是猜名字**（2026-09-18 round 28 实测，R27-J2 结案）：
 * 名字启发式对 `anomalyMastery`（`display = "number"`，即 +30 加点）判错成 pct
 * ⇒ 6 号位掌控主词条把 `94` 算成 `94×1.3 = 122.2`，而四处独立来源都说该是 `94 + 30 = 124`：
 * ① `statDisplay.anomalyMastery.display = "number"`；② `buff.ts#collectAllBuffs` 的 `roughStats`
 * （`level60.anomalyMastery + maxMain`，即 4pc 折枝剑歌门槛用的那套）；③ `STAT_META.anomalyMastery.mode = 'flat'`；
 * ④ `discSetEffects.test.ts` 注释「94 + 30 主词条 = 124」。
 * 用户可见后果（修前实测）：低掌控角色（1111/1121/1271/1291，基础 86）带 6 号位掌控 ⇒ 面板 `86×1.3 = 111.8`
 * **< 115**，但 4pc 折枝剑歌门槛按 `roughStats` 的 `86+30 = 116 ≥ 115` 判达标 ⇒ 套装已发放、面板却不到门槛，
 * **两个口径在同一份数据上互相矛盾**。修后两处一致（`116`）。
 *
 * ⚠ **可达面已实测穷举**：驱动盘 4/5/6 号位主词条池 + 副词条池共 **21 个 statId 全部登记**
 * （`statDisplay` 无缺失键）⇒ 兜底分支在**生产数据下不可达**（`mainStats` 由 `REC_MAIN_STAT_MAP`
 * 从 `build-recommendations.json` 映射，而该文件的 `main_stats.name` 全集（16 个）100% 命中该映射表）。
 * 两个池子里**唯一**会翻面的字段就是 `anomalyMastery`（`impact` 因小写 `i` 早已落在启发式的 flat 侧）。
 *
 * ⚠⚠ **本函数仍不是全局 Buff 那条通路的口径，两者不能合并**（2026-09-18 round 27 实测）：
 * 全局 Buff 走 `utils/statMeta.ts#statSettlementMode`（读 `STAT_META.mode`），与 `display` **不同义**。
 * 实测反例：`energyRegen` 的 `display = "percent"`（6 号位 = **+60%** 回能，本函数按 pct 处理 ✅），
 * 而 `STAT_META.energyRegen.mode = 'flat'` 描述的是**基础回能字段本身**（1.2 点/秒）
 * ⇒ 把两者合并会把 `+60%` 变成 `+60 点/秒`（round 27 实测踩到并回退）。
 * 反向同理：本函数**不得**改读 `STAT_META.mode`。两条通路各自的口径与证据见
 * `statSettlementMode` 头注释 + `src/utils/__tests__/statModeParity.test.ts` 判据 ②。
 */
function inferStatMode(stat: string, statRules: StatRules | null): 'pct' | 'flat' {
  const display = statRules?.statDisplay?.[stat]?.display
  if (display === 'percent') return 'pct'
  if (display === 'number' || display === 'integer') return 'flat'
  // 未登记字段（生产数据不可达，见上）兜底：沿用历史名字后缀启发式
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
      applyStat(result, stat, maxMain[stat], inferStatMode(stat, statRules))
    }
  }

  // 1、2、3 号位固定主词条（S级+15：HP 2200 / ATK 316 / DEF 184，数值唯一来源=statRules.sRankMaxMainStat）。
  // 此前缺 316 ATK 导致全库伤害系统性偏低 12-16%（实战对比远低于最低金击杀）。
  // @fact engine:driveDisc/固定主词条 口径: 1/2/3号位固定主词条对全员无条件建模（S级+15），4/5/6号位走用户配置 | 据 用户@2026-09-05 | 验 discSetEffects.test.ts | 锚 src/core/panel.ts#applyDriveDiscConfig | 信 高
  for (const stat of ['hpFlat', 'atkFlat', 'defFlat'] as const) {
    const value = maxMain[stat]
    if (value) applyStat(result, stat, value, 'flat')
  }

  // 副词条
  if (config.subStatAllocation) {
    for (const [stat, count] of Object.entries(config.subStatAllocation)) {
      if (!count) continue
      if (!subStatPool.has(stat)) continue
      const step = subStep[stat] ?? 0
      if (!step) continue
      const value = step * count // count即升级步数，不再乘2.25
      applyStat(result, stat, value, inferStatMode(stat, statRules))
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
  config: { cinemaLevel: number; wEngineModLevel: number; potentialLevel?: number; sourcePanelsByOwner?: import('./buff').SourcePanelsByOwner; effectCoverageMap?: Map<string, number> }
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

  // 3. 收集所有 buff（statRules 传入供套装 requirement 门槛粗算）
  const buffs = collectAllBuffs(agent, wEngine, driveDiscConfig, setsMap, teammateBuffs, {
    cinemaLevel: config.cinemaLevel,
    wEngineModLevel: config.wEngineModLevel,
    sourcePanelsByOwner: config.sourcePanelsByOwner,
    statRules,
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

  // 潜能等级写入源面板（供 teamBuff formula/derived 通道读 potentialLevel）
  const potentialLevel = Math.max(1, Math.min(6, config.potentialLevel ?? 6))
  outOfCombat.potentialLevel = potentialLevel
  inCombat.potentialLevel = potentialLevel

  return { base, withDiscs, outOfCombat, inCombat, buffs }
}
