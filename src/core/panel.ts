/**
 * 面板计算 - 局外面板与局内面板
 */
import type {
  Agent, WEngine, DriveDiscSet, PanelValues, DriveDiscConfig, TeammateBuff, BuffEffect, StatId, BuffEffectOrigin,
} from '@/types/catalog'
import { applyBuffs, applyEffect, applyStat, collectAllBuffs, discSelfBuffNeedsOutOfCombatPanel, finalizeCoreStatBonuses, markBuffPhase, withPhaseMark, type CollectedBuffs, type SourcePanelsByOwner } from './buff'
import { agentPanelStatInitials, calcEnergyRegenTotal } from '@/data/agentPanelStats'
import type { StatRules } from '@/types/catalog'
import { driveDiscStatMode } from './discStatMode'
import { effectivePotentialLevelOf } from '@/data/potentialLevel'

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
    electricDmg: 0, etherDmg: 0, windDmg: 0,
    penDmgBonus: 0,
    sheerForceFlat: 0,
    sheerDmgBonus: 0,
    sharpDmgBonus: 0,
    skillDmgBonus: 0,
    // 最终伤害乘区（独立乘区；直伤专属，见 core/damage.ts 第 9.5 步）
    finalDmgBonus: 0,
    // 失衡相关
    stunBuildUpBonus: 0,
    anomalyBuildUpEfficiencyOnStunBonus: 0,
    anomalyBuildUpEfficiencyOnStunChainBonus: 0,
    stunDmgMultiplierBonus: 0,
    stunDmgMultiplierBonusAlways: 0,
    stunDmgMultiplierBonusCapAlways: 0,
    ...agentPanelStatInitials('stun'),
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
    ...agentPanelStatInitials('anomaly'),
    skillLevelBonus: 0,
  assaultCritRate: 0,
  assaultCritDmg: 0,
  selfAssaultCritDmgBonus: 0,
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
    // 防御三通道：自身直伤无视防御（只进直伤链）
    enemyDefIgnoreDirect: 0,
    enemyPhysicalDefIgnoreDirect: 0,
    enemyFireDefIgnoreDirect: 0,
    enemyIceDefIgnoreDirect: 0,
    enemyElectricDefIgnoreDirect: 0,
    enemyEtherDefIgnoreDirect: 0,
    enemyWindDefIgnoreDirect: 0,
    enemyPhysicalDefReduction: 0,
    enemyFireDefReduction: 0,
    enemyIceDefReduction: 0,
    enemyElectricDefReduction: 0,
    enemyEtherDefReduction: 0,
    enemyWindDefReduction: 0,
    enemyResReduction: 0,
    enemyPhysicalResReduction: 0,
    enemyFireResReduction: 0,
    enemyIceResReduction: 0,
    enemyElectricResReduction: 0,
    enemyEtherResReduction: 0,
    enemyWindResReduction: 0,
    // 抗性两族（自身无视抗性）：直伤族只进 calcDirectDamage，异常族只进异常结算
    enemyResIgnoreDirect: 0,
    enemyPhysicalResIgnoreDirect: 0,
    enemyFireResIgnoreDirect: 0,
    enemyIceResIgnoreDirect: 0,
    enemyElectricResIgnoreDirect: 0,
    enemyEtherResIgnoreDirect: 0,
    enemyWindResIgnoreDirect: 0,
    enemyResIgnoreAnomaly: 0,
    enemyPhysicalResIgnoreAnomaly: 0,
    enemyFireResIgnoreAnomaly: 0,
    enemyIceResIgnoreAnomaly: 0,
    enemyElectricResIgnoreAnomaly: 0,
    enemyEtherResIgnoreAnomaly: 0,
    enemyWindResIgnoreAnomaly: 0,
    enemyStunResReduction: 0,
    enemyPhysicalStunResReduction: 0,
    enemyFireStunResReduction: 0,
    enemyIceStunResReduction: 0,
    enemyElectricStunResReduction: 0,
    enemyEtherStunResReduction: 0,
    enemyWindStunResReduction: 0,
    enemyAnomalyResReduction: 0,
    enemyPhysicalAnomalyResReduction: 0,
    enemyFireAnomalyResReduction: 0,
    enemyIceAnomalyResReduction: 0,
    enemyElectricAnomalyResReduction: 0,
    enemyEtherAnomalyResReduction: 0,
    enemyWindAnomalyResReduction: 0,
    enemyDamageTakenBonus: 0,
    enemyCritDmgTakenBonus: 0,
    enemyStunTakenBonus: 0,
    physicalAnomalyDurationBonusSeconds: 0,
    fireAnomalyDurationBonusSeconds: 0,
    electricAnomalyDurationBonusSeconds: 0,
    etherAnomalyDurationBonusSeconds: 0,
    windAnomalyDurationBonusSeconds: 0,
    infectionZoneBonus: 0,
    additionalAbilityActive: 0,
    stunDurationBonusSeconds: 0,
    disorderDamageBonus: 0,
    disorderBaseMultiplierBonus: 0,
    anomalyDurationBonusSeconds: 0,
    // -1 = **未盖章**（见 `panelAt`）：真实槽位号由 `computePanel(slot, …)` 的调用方盖上。
    // 不写 0——那会让「槽1/槽2 的空面板」冒充槽0，`panelAt` 的身份查找随即失真。
    // r401 S1：原先只靠索引签名、缺省 undefined 的 5 个字段；初值 = 各读者的兜底值（docs/mcp-panel-fields.md §4 S1）
    roaringRideBackstageEnergyRegen: 0,
    potentialLevel: 6,
    turbulenceResIgnore: 0,
    windInfectionRate: 0,
    refringe: 0,
    slot: -1,
  }
}

/**
 * 按**槽位号**取面板 —— 数组是**按位置压缩**的（`computePanel` 跳过空槽），故**不能**用
 * `panels[slot]` 下标（槽位号 ≠ 下标）。
 *
 * 为什么需要它（2026-09-16 实测的整类缺陷）：`panels` / `damagePanels` / `entrySnapshotPanels`
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
  if (panels.some(p => p.slot >= 0)) return undefined // 压缩数组：该槽确实无角色
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
  panel.sharpCritDmg = s.sharpCritDmg ?? 50
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
 * 驱动盘主词条/副词条的**结算口径**（`applyStat` 的 `mode` 实参）。实现与依据见 `./discStatMode.ts`：
 * 以 `statRules.driveDisc.statModes` 为准（CC-100，R5 D15）。旧口径按展示字段 `statDisplay.display`
 * 推断，把 6 号位冲击力 / 异常掌控当成固定值（R27-J2，2026-09-18），与源数据百分比口径相反，已推翻。
 */
function inferStatMode(stat: string, statRules: StatRules | null): 'pct' | 'flat' {
  return driveDiscStatMode(stat, statRules)
}

export function applyDriveDiscConfig(
  panel: PanelValues,
  config: DriveDiscConfig,
  statRules: StatRules | null,
  extraStats: { stat: StatId; value: number; mode: string }[] = [],
  extraEffects: BuffEffect[] = [],
  /**
   * 结构化上报（2026-10-20）：把本层写下的**每条加成输入**（大/小词条）报出去，
   * 供属性账逐条列出「这 208% 大防御是谁给的」。
   *
   * 为什么必须在这里报而不是事后用差值反解：差值只有合成结果，分不清 pct 与 flat
   * （用户 2026-10-20：「三号位防御不是接近两千啊。你这个没区分开」——
   *  那是 6 号位 48% + 副词条 96% + 套装 16% 累乘出来的，不是某条固定值）。
   */
  report?: (entry: { stat: string; value: number; mode: 'flat' | 'pct'; label: string; slotKey: string }) => void,
): PanelValues {
  const result = { ...panel }
  /**
   * `slotKey` = **第三维「具体内容」**（用户 2026-10-20）：让每个加成在
   * 「提供者 × 属性 × 内容」三维里唯一落位，从而不重不漏。
   */
  const emit = (stat: string, value: number, mode: 'flat' | 'pct', label: string, slotKey: string) =>
    report?.({ stat, value, mode, label, slotKey })

  for (const stat of extraStats) {
    applyStat(result, stat.stat, stat.value, stat.mode)
    // 音擎高级词条也是一条独立贡献（如「猩红渴望」defPct 48）——
    // 不报它，公式行就少算 48%，看起来像「多出来的来源」（实测克拉蕾防御 208 中就有它一份）。
    emit(stat.stat, stat.value, stat.mode === 'pct' ? 'pct' : 'flat', '音擎高级词条', `音擎高级词条:${stat.stat}`)
  }

  if (!statRules) {
    for (const effect of extraEffects) applyEffect(result, effect)
    return finalizeCoreStatBonuses(result)
  }

  const maxMain = statRules.driveDisc.sRankMaxMainStat
  const subStep = statRules.driveDisc.sRankSubStatBaseStep
  const subStatPool = new Set(statRules.driveDisc.subStatPool)

  // 4、5、6号位主词条
  for (const slot of [4, 5, 6] as const) {
    const stat = config.mainStats[slot]
    if (stat && maxMain[stat] != null) {
      const mode = inferStatMode(stat, statRules)
      applyStat(result, stat, maxMain[stat], mode)
      emit(stat, maxMain[stat], mode === 'pct' ? 'pct' : 'flat', `${slot}号位主词条`, `主词条:${slot}`)
    }
  }

  // 1、2、3 号位固定主词条（S级+15：HP 2200 / ATK 316 / DEF 184，数值唯一来源=statRules.sRankMaxMainStat）。
  // 此前缺 316 ATK 导致全库伤害系统性偏低 12-16%（实战对比远低于最低金击杀）。
  // @fact engine:driveDisc/固定主词条 口径: 1/2/3号位固定主词条对全员无条件建模（S级+15），4/5/6号位走用户配置 | 据 用户@2026-09-05·复核@2026-09-25·锚未变@2026-09-27·复核@2026-10-07 | 验 discSetEffects.test.ts | 锚 src/core/panel.ts#applyDriveDiscConfig | 信 高
  for (const stat of ['hpFlat', 'atkFlat', 'defFlat'] as const) {
    const value = maxMain[stat]
    if (value) {
      applyStat(result, stat, value, 'flat')
      emit(stat, value, 'flat', '1/2/3号位固定主词条', `固定主词条:${stat}`)
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
      const mode = inferStatMode(stat, statRules)
      applyStat(result, stat, value, mode)
      emit(stat, value, mode === 'pct' ? 'pct' : 'flat', `副词条×${count}`, `副词条:${stat}×${count}`)
    }
  }

  for (const effect of extraEffects) {
    applyEffect(result, effect)
  }

  return finalizeCoreStatBonuses(result)
}

/** 驱动盘/音擎词条的一条结构化贡献（属性账用；与 buff 通道的 origin 同形） */
export interface DiscContribution {
  stat: string
  value: number
  mode: 'flat' | 'pct'
  /** 与 buff 通道同形的来源标签（复用 `BuffEffectOrigin`，别重写一遍形状——判据 29） */
  origin: BuffEffectOrigin & { kind: 'driveDisc' }
  /** 第三维「具体内容」：主词条:6 / 副词条:defPct×20 / 固定主词条:defFlat（唯一落位用） */
  slotKey: string
}

/** 完整面板计算 */
export interface PanelResult {
  base: PanelValues       // 基础面板（角色+音擎）
  withDiscs: PanelValues  // 加上驱动盘词条
  outOfCombat: PanelValues // 局外面板（+局外buff）
  inCombat: PanelValues    // 局内面板（+局内buff）
  buffs: CollectedBuffs    // 收集的 buff
  /** 驱动盘词条的结构化贡献（逐条：主词条 / 副词条 / 固定主词条） */
  discContributions: DiscContribution[]
}

/** calcPanel 的配置（substatOptimizer 的默认分配输入原样透传） */
export interface PanelCalcConfig {
  cinemaLevel: number
  wEngineModLevel: number
  /** 角色潜能档（1..6），透传给起点面板盖章（CC-174：calcPanel 生产调用点须显式给出）。缺省 = 6。 */
  potentialLevel?: number
  /** 潜能开关（缺省 true）；false ⇒ 盖进面板的 potentialLevel 恒 1（见 data/potentialLevel.ts#effectivePotentialLevelOf） */
  potentialEnabled?: boolean
  sourcePanelsByOwner?: SourcePanelsByOwner
  /** 效果覆盖率表（effect id → 0~1），与伤害管线同口径；缺省 = 全部按 100%（第 194 轮） */
  effectCoverageMap?: Map<string, number>
  enemyWeakness?: readonly string[]
}

export function calcPanel(
  agent: Agent,
  wEngine: WEngine | undefined,
  driveDiscConfig: DriveDiscConfig,
  setsMap: Map<string, DriveDiscSet>,
  teammateBuffs: TeammateBuff[],
  statRules: StatRules | null,
  config: PanelCalcConfig
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

  /**
   * 2. 词条层（**纯对账面**）：基础 + 音擎进阶 + 驱动盘主副词条，**不含**局外 buff。
   *
   * ⚠ 它只用来给属性账提供「词条层」快照（`withDiscs − base`），**不参与面板合成**。
   * 合成走下面的 `outOfCombatOf`（那才是唯一写面板的路径）。
   * 两处都调 `applyDriveDiscConfig` 是必要的（两个不同用途的面板），
   * 但**上报/记账只能发生在合成路径**，否则同一份主词条会在账本里出现两次
   * （实测：6号位 defPct 48% 被记两遍 ⇒ 防御 160% 变 208%）。
   */
  const withDiscs = applyDriveDiscConfig(withPhaseMark(base, 'outOfCombat'), driveDiscConfig, statRules, wEngineAdvancedStats)

  // 3. 收集所有 buff。
  const collect = (outOfCombatStats?: Readonly<Record<string, number>>) => collectAllBuffs(agent, wEngine, driveDiscConfig, setsMap, teammateBuffs, {
    cinemaLevel: config.cinemaLevel,
    wEngineModLevel: config.wEngineModLevel,
    sourcePanelsByOwner: config.sourcePanelsByOwner,
    statRules,
    enemyWeakness: config.enemyWeakness,
    outOfCombatStats,
  })

  /**
   * 驱动盘词条的结构化上报（2026-10-20）：逐条记「几号位主词条 / 副词条×N / 固定主词条」，
   * 供属性账把「这 208% 大防御是谁给的」拆开显示（差值反解分不清 pct 与 flat）。
   */
  const discContributions: DiscContribution[] = []

  // 4. 局外面板 = 基础白值 + 音擎高级词条 + 驱动盘主副词条 + 局外 buff。
  // 攻击/生命/防御局外段：基础数据 × (1 + Σ局外百分比加成) + Σ局外固定值。
  const outOfCombatOf = (b: CollectedBuffs) => {
    // ⚠ 相位必须在**进入 `applyDriveDiscConfig` 之前**盖到起点面板上：
    // 主词条 / 副词条 / 局外 buff 全在那个函数里应用，迟一步就会把局外大/小词条记成局内
    // （实测：`inCombatDefPct` 出现在局外面板上，而 `outOfCombatDefPct` 恒 0）。
    // ⚠ 必须从 `base` 重新算**词条 + 局外 buff**，但**只这一次**：
    // 上面第 2 步的 `withDiscs`（不含局外 buff）只是给返回值/对账用的旁支，**不参与**面板合成。
    // 曾出过的 bug：两次都从 base 起算却共享累加器记录 ⇒ 主词条被算两遍（防御 160% 变 208%）。
    const withDiscsAndOutBuffs = applyDriveDiscConfig(
      withPhaseMark(base, 'outOfCombat'),
      driveDiscConfig, statRules, wEngineAdvancedStats, b.outOfCombat,
      (entry) => {
        discContributions.push({
          stat: entry.stat, value: entry.value, mode: entry.mode,
          origin: { kind: 'driveDisc', provider: '驱动盘词条', slot: -1, source: entry.label },
          slotKey: entry.slotKey,
        })
      },
    )
    markBuffPhase(withDiscsAndOutBuffs, 'outOfCombat')
    const p = applyBuffs(
      withDiscsAndOutBuffs,
      [],
      config.effectCoverageMap,
      'outOfCombat',
    )
    // CC-337：局外总回能在 calcPanel 唯一出口盖章，保证 computePanelPhases / computeEntrySnapshotPanel /
    // teammateBuffSource / substatOptimizer 等所有调用方的 outOfCombat 与 inCombat（applyBuffs 浅拷贝继承）同源一致。
    p.energyRegenOutOfCombat = calcEnergyRegenTotal(p)
    return p
  }
  let buffs = collect()
  let outOfCombat = outOfCombatOf(buffs)
  // 4b. 两段式（CC-108，R5 D26）：4 件套「装备者初始防御力 ≥1000」这类门槛按第一段的**精确局外面板**判定
  // （第一段不发放任何带属性门槛的效果，所以它就是「门槛效果之前」的局外面板），再重新收集。
  // 数据里门槛效果都在局内组；若日后出现局外组门槛效果，门槛仍按第一段面板判定，不会自指。
  if (discSelfBuffNeedsOutOfCombatPanel(driveDiscConfig, setsMap)) {
    buffs = collect(outOfCombat as unknown as Readonly<Record<string, number>>)
    // 第二段会重跑 applyDriveDiscConfig ⇒ 词条贡献会重复上报一次；清空后重收，
    // 保证「逐条来源」与最终面板一一对应（否则公式行里每条词条都出现两次）。
    discContributions.length = 0
    outOfCombat = outOfCombatOf(buffs)
  }

  // 5. 局内面板 = 局外总属性 × (1 + Σ局内百分比加成) + Σ局内固定值加成。
  // 音擎被动、驱动4件套、队友战斗 buff 等触发型效果默认属于局内。
  markBuffPhase(outOfCombat, 'inCombat')
  const inCombat = applyBuffs(outOfCombat, buffs.inCombat, config.effectCoverageMap, 'inCombat')

  // 潜能等级写入源面板（供 teamBuff formula/derived 通道读 potentialLevel）
  // 潜能开关（2026-11-01）：关掉 ⇒ 恒 I 档，formula/derived 通道（如 1381 潜能电脉冲）一并归零
  const potentialLevel = effectivePotentialLevelOf(config.potentialLevel, config.potentialEnabled) // CC-503：与各机制模块同一归一口
  outOfCombat.potentialLevel = potentialLevel
  inCombat.potentialLevel = potentialLevel

  return { base, withDiscs, outOfCombat, inCombat, buffs, discContributions }
}
