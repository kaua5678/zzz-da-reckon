/**
 * 异常面板簇（自 `resourceCalc/helpers.ts` 整段迁出 —— R22 熵批 2 / R22-S2 刀 C，**纯搬迁**）。
 *
 * 职责（一个域：**异常积蓄 → 虚拟面板 → 结算触发者**）：
 *   ① 队伍身份谓词 `teamHasAgent` / `findSlotByIdentity`（按角色身份找槽位，单一事实源）
 *   ② 异常持续时间加成 `getTeamAnomalyDurationBonus`（火 3s / 电 3s / 以太 3s / 物理 5s）
 *   ③ 风化浸染目标选择与覆盖率 `getWindInfectionTargetSlot` / `getWindInfectionElement` /
 *      `getWindInfectionCoverage`
 *   ④ 异常虚拟面板 `buildAnomalyVirtualPanel`（属性加权 + 招式限定增伤按积蓄占比）与
 *      结算触发者分摊 `buildAnomalySettlementEntries`
 *   ⑤ 蕾米埃尔专属：`getRemielleLevelValue` / `remielleSpecialVoidflareCount` / `calcVoidflareDamage`
 *
 * 迁移纪律：逐字节剪切，算式/常量值/条件/求值顺序零改动。
 * 上游单一入口仍是 `./helpers`（该文件保留 re-export 壳）⇒ 目录外既有消费者（`damagePool.ts` 等）
 * 与既有测试的 import 零改动。
 *
 * ⚠ 落点必须是 `resourceCalc/` **目录直属**的 `.ts`：子目录会整类逃出
 * `listAgentBranchFiles()` 的 agentId 棘轮度量面（`scripts/check-guards.mjs`；R22 分诊 §3 闸门 4 实测）。
 * ⚠ 本刀把 `findSlotByIdentity` 一并迁来 ⇒ 它与 `panelPhases.ts` 之间的**双向边解环**
 * （刀 A 头注释里点名的「D 簇后续再拆时把这几个符号一并迁走即可解环」即本刀）：
 * `panelPhases.ts` 与 `./helpers` 都改为从本文件 import 它，本文件对二者**零出边**。
 */
import type { useConfigStore } from '@/stores/config'
import type { useCatalogStore } from '@/stores/catalog'
import { emptyPanel, panelAt } from '@/core/panel'
import { getSkillLevelCoef } from '@/core/skillLevel'
import { getAgentSpec } from '@/specs/registry'
import { evalAdditionalAbility } from '@/specs/teamCondition'
import { isRemielleAgent } from '@/mechanics/agents/remielle'
import { fmt } from '@/utils/format'
import type { AnomalyProgress } from '@/types/resource'
import type { PanelValues, SkillMove } from '@/types/catalog'
// 招式行取值簇（C 簇）已迁 `./skillRows`（R22 熵批 2 / R22-S2 刀 B）——同目录兄弟模块直接指真实现
import { ELEMENT_DMG_KEYS, ELEMENT_DEF_REDUCTION_KEYS, ELEMENT_RES_REDUCTION_KEYS } from './skillRows'
// 面板/机制编排簇（B 簇）已迁 `./panelPhases`（R22 熵批 1 刀 A）——同目录兄弟模块直接指真实现。
// ⚠ 本 import 让 `panelPhases ↔ anomalyPanels` 成环（那边也取本文件的
// `getTeamAnomalyDurationBonus` / `findSlotByIdentity`）：**两边全是函数声明（提升）且模块初始化期
// 零互读**——本文件没有任何顶层 `const`，`panelPhases` 唯一的顶层 const `ADDITIONAL_GATE_BUFFS`
// 是纯字面量表、本文件不引用 ⇒ **无 TDZ 风险**（刀 A 头注释点名的双向边至此解环）。
import { buildMechanicTeamMembers } from './panelPhases'

export function teamHasAgent(
  configStore: ReturnType<typeof useConfigStore>,
  catalogStore: ReturnType<typeof useCatalogStore>,
  agentIds: string[],
): boolean {
  return configStore.team.some(char => {
    const agent = char.agentId ? catalogStore.getAgent(char.agentId) : null
    return agentIds.includes(char.agentId) || agentIds.includes(agent?.teammateBuffId ?? '')
  })
}

export function getTeamAnomalyDurationBonus(
  configStore: ReturnType<typeof useConfigStore>,
  catalogStore: ReturnType<typeof useCatalogStore>,
  element: string,
): number {
  if (element === 'fire' && teamHasAgent(configStore, catalogStore, ['1171'])) return 3
  if (element === 'electric' && teamHasAgent(configStore, catalogStore, ['1211'])) {
    const team = buildMechanicTeamMembers(configStore, catalogStore)
    // 槽位查找收敛为 `findSlotByIdentity`（单一事实源，规则 11）；`?? -1` 兜底逐位保留
    // ——原式是 `team.find(...)?.slot ?? -1`，`findSlotByIdentity` 未命中同样返回 -1。
    const rinaSlot = findSlotByIdentity(configStore, catalogStore, ['1211']) ?? -1
    const rina = rinaSlot >= 0 ? catalogStore.getAgent('1211') ?? null : null
    if (rinaSlot >= 0 && evalAdditionalAbility(team, rinaSlot, rina, getAgentSpec('1211')?.additionalAbility)) return 3
  }
  if (element === 'ether' && teamHasAgent(configStore, catalogStore, ['aria'])) return 3
  if (element === 'physical' && teamHasAgent(configStore, catalogStore, ['1261'])) return 5
  return 0
}

/**
 * **按角色身份找槽位**（单一事实源，规则 11）。
 *
 * 为什么需要（2026-09-17 round 20 侦察）：`findIndex(char => { const a = …; return a?.id === 'X'
 * || a?.teammateBuffId === 'Y' })` 这一形状在全仓编排层**重复 18 次**（`damagePool.ts` 5 /
 * `helpers.ts` 5 / `useResourceCalc.ts` 3 / `convergence.ts` 3 / `normaHatChain.ts` 1 /
 * `liuyinPromote.ts` 1），且每一处都是角色判定棘轮的计数站点。
 * ⚠ **调用点若同时还要「查表/读该成员的其它字段」，请用本函数拿槽位后再按槽位取**（判据 17：
 * 槽位号 ≠ 下标，`team` 数组索引即槽位号但 `characters`/`panels` 是按位置压缩的）。
 *
 * ⚠ **必须查两个字段**：`agent.id`（角色自己的 id）与 `agent.teammateBuffId`（队友 buff 归属别名，
 * 如蕾米埃尔 `1581` 的别名 `'remielle'`）。漏查后者会让「按 buff 别名引用该角色」的配置找不到人
 * ——旧正则口径漏计这两种形态正是换尺的理由（见 `check-guards.mjs` 的 2026-09-17 换尺沿革）。
 *
 * @param ids 任一匹配即算命中（如 `['1581', 'remielle']`）
 * @returns 槽位号；找不到返回 **-1**（调用方按 `< 0` 判空，勿用 `?? ` 兜底）
 */
export function findSlotByIdentity(
  configStore: ReturnType<typeof useConfigStore>,
  catalogStore: ReturnType<typeof useCatalogStore>,
  ids: readonly string[],
): number {
  return configStore.team.findIndex(char => {
    const a = char.agentId ? catalogStore.getAgent(char.agentId) : null
    if (!a) return false
    return ids.some(id => a.id === id || a.teammateBuffId === id)
  })
}

/**
 * 风化浸染默认选择：优先非支援/防护、非蕾米埃尔的非风队友属性。
 *
 * ⚠ **「是不是蕾米埃尔」的判定已收敛为 `isRemielleAgent`（`remielle.ts` 导出，单一事实源）**：
 * 本函数原先内联 `agent?.id === '1581' || agent?.teammateBuffId === 'remielle'`，2026-09-17 round 21
 * 夜间批 C 改调该谓词（**本次不迁本函数**：它是「为我挑一个队友槽位」的**跨槽决策**，
 * `applyPanel` 只服务当前角色，无落点 ⇒ 迁移需新契约，属分诊 §4 批次 3/4）。
 *
 * ⚠ **与 UI 口径的分裂仍在（未修，如实挂账）**：`ResourceUtilizationPage.vue:417-423` 的
 * `janePassionSlot` 用的是 `agent?.id === '1261' || agent?.teammateBuffId === '1261'`——两臂同值
 * ⇒ **不是分裂**；真正未裁决的是本函数 `isRemielle` 与 UI 之间**没有**对应用户可见开关（分诊 §3.4）。
 */
export function getWindInfectionTargetSlot(
  configStore: ReturnType<typeof useConfigStore>,
  catalogStore: ReturnType<typeof useCatalogStore>,
): number {
  const windSlot = configStore.team.findIndex(char => {
    const agent = char.agentId ? catalogStore.getAgent(char.agentId) : null
    return agent?.damageElement === 'wind'
  })
  if (windSlot < 0) return -1

  const candidates = configStore.team.map((char, slot) => {
    const agent = char.agentId ? catalogStore.getAgent(char.agentId) : null
    return {
      slot,
      agentId: char.agentId ?? '',
      element: agent?.damageElement ?? '',
      specialty: agent?.specialty ?? '',
      isRemielle: isRemielleAgent(agent),
    }
  }).filter(x => !!x.agentId)

  const userSlot = Math.floor(configStore.getMechanicSetting('wind.infectionTargetSlot', -1))
  const userValid = userSlot >= 0 && userSlot !== windSlot && candidates.some(x => x.slot === userSlot)
  if (userValid) return userSlot

  return candidates.find(x =>
    x.slot !== windSlot && x.element && x.element !== 'wind'
    && x.specialty !== 'support' && x.specialty !== 'defense' && !x.isRemielle,
  )?.slot
    ?? candidates.find(x => x.slot !== windSlot && x.element && x.element !== 'wind')?.slot
    ?? windSlot
}

export function getWindInfectionElement(
  configStore: ReturnType<typeof useConfigStore>,
  catalogStore: ReturnType<typeof useCatalogStore>,
): string {
  const slot = getWindInfectionTargetSlot(configStore, catalogStore)
  const char = configStore.team[slot]
  const agent = char?.agentId ? catalogStore.getAgent(char.agentId) : null
  return agent?.damageElement || 'wind'
}

/** 风化浸染覆盖率：默认风化覆盖时间/全局时间，用户可手动覆盖 */
export function getWindInfectionCoverage(
  configStore: ReturnType<typeof useConfigStore>,
  autoRate: number,
): number {
  return Math.max(0, Math.min(1, configStore.getMechanicSetting('wind.infectionCoverage', autoRate)))
}

export interface AnomalyVirtualPanelRow {
  slot: number
  name: string
  buildup: number
  /** 展示权重 = buildup / totalBuildUp（含所有贡献者，异属性赠送也计入） */
  weight: number
  /** 是否可以结算该元素（同属性角色才可结算） */
  settlementEligible: boolean
  atk: number
  anomalyProficiency: number
  dmgBonus: number
  anomalyDmgBonus: number
  anomalyCritRate: number
  anomalyCritDmg: number
  assaultCritRate: number
  assaultCritDmg: number
  enemyAssaultDefReduction: number
  enemyAnomalyDefReduction: number
  enemyDefFlatReduction: number
  enemyResReduction: number
  elementResReduction: number
  penRatio: number
  penFlat: number
  /** 异化度（蕾米异化系数之和，基础区属性） */
  refringe: number
}

export interface AnomalyVirtualPanelBuild {
  element: string
  totalBuildUp: number
  rows: AnomalyVirtualPanelRow[]
  virtual: AnomalyVirtualPanelRow
  panel: PanelValues
}

export function buildAnomalyVirtualPanel(
  prog: AnomalyProgress,
  panels: PanelValues[],
  configStore: ReturnType<typeof useConfigStore>,
  catalogStore: ReturnType<typeof useCatalogStore>,
): AnomalyVirtualPanelBuild | null {
  const slotBuildUp = new Map<number, number>()
  for (const contrib of prog.contributions ?? []) {
    slotBuildUp.set(contrib.slot, (slotBuildUp.get(contrib.slot) ?? 0) + contrib.totalBuildUp)
  }
  const totalBuildUp = [...slotBuildUp.values()].reduce((a, b) => a + b, 0)
  if (totalBuildUp <= 0) return null

  const rows: AnomalyVirtualPanelRow[] = [...slotBuildUp.entries()]
    .map(([slot, buildup]) => {
      const panel = panelAt(panels, slot) ?? emptyPanel()
      const agentId = configStore.team[slot]?.agentId ?? ''
      const agent = agentId ? catalogStore.getAgent(agentId) : null
      const dmgBonus = (panel.dmgBonus ?? 0) + (panel[ELEMENT_DMG_KEYS[prog.element]] ?? 0)
      // 同属性角色才可参与结算/面板加权
      const settlementEligible = agent?.damageElement === prog.element
      return {
        slot,
        name: agent?.name?.zhCN || agentId || `槽${slot + 1}`,
        buildup,
        weight: 0,   // 展示权重 = 同属性内积蓄占比，rows 构建后统一修正（赠送积蓄不参与权重）
        settlementEligible,
        atk: panel.atk ?? 0,
        anomalyProficiency: panel.anomalyProficiency ?? 0,
        dmgBonus,
        anomalyDmgBonus: panel.anomalyDmgBonus ?? 0,
        anomalyCritRate: panel.anomalyCritRate ?? 0,
        anomalyCritDmg: panel.anomalyCritDmg ?? 0,
        assaultCritRate: panel.assaultCritRate ?? 0,
        assaultCritDmg: panel.assaultCritDmg ?? 0,
        enemyAssaultDefReduction: panel.enemyAssaultDefReduction ?? 0,
        enemyAnomalyDefReduction: panel.enemyAnomalyDefReduction ?? 0,
        enemyDefFlatReduction: panel.enemyDefFlatReduction ?? 0,
        enemyResReduction: panel.enemyResReduction ?? 0,
        elementResReduction: panel[ELEMENT_RES_REDUCTION_KEYS[prog.element]] ?? 0,
        penRatio: panel.penRatio ?? 0,
        penFlat: panel.penFlat ?? 0,
        refringe: (panel.remielleRefringeCoefficient ?? 0) + (panel.remielleRefringeCoefficientBonusPct ?? 0),
      }
    })
    .sort((a, b) => b.buildup - a.buildup)

  // 属性加权只用同属性行（异属性赠送积蓄只计入总次数，不参与面板加权）
  const eligibleRows = rows.filter(r => r.settlementEligible)
  const blendRows = eligibleRows.length > 0 ? eligibleRows : rows
  const blendTotal = blendRows.reduce((s, r) => s + r.buildup, 0) || totalBuildUp

  const weighted = (key: keyof AnomalyVirtualPanelRow): number =>
    blendRows.reduce((sum, row) => sum + (row[key] as number) * (row.buildup / blendTotal), 0)

  // 修正展示权重：同属性行 = 同属性内积蓄占比（和恒为100%），赠送行 = 0
  for (const row of rows) {
    row.weight = row.settlementEligible && blendTotal > 0 ? row.buildup / blendTotal : 0
  }

  const panel = emptyPanel()
  panel.atk = weighted('atk')
  panel.anomalyProficiency = weighted('anomalyProficiency')
  panel.dmgBonus = weighted('dmgBonus')
  panel.penRatio = weighted('penRatio')
  panel.penFlat = weighted('penFlat')

  // 招式限定增伤按积蓄占比加权进基础区增伤（通用逻辑 2026-08-27）：
  // 一整条异常全由某 100% 增伤招式积攒 → 基础区含那 100%；否则按各招式积蓄占比加权吃一部分。
  let moveDmgBonusWeighted = 0
  for (const contrib of prog.contributions ?? []) {
    const moveDmgBonus = contrib.dmgBonus ?? 0
    if (moveDmgBonus === 0 || contrib.totalBuildUp <= 0) continue
    moveDmgBonusWeighted += moveDmgBonus * (contrib.totalBuildUp / totalBuildUp)
  }
  panel.dmgBonus = (panel.dmgBonus ?? 0) + moveDmgBonusWeighted

  const virtual: AnomalyVirtualPanelRow = {
    slot: -1,
    name: '虚拟面板',
    buildup: totalBuildUp,
    weight: 1,
    settlementEligible: true,
    atk: panel.atk,
    anomalyProficiency: panel.anomalyProficiency,
    dmgBonus: panel.dmgBonus,
    anomalyDmgBonus: 0,
    anomalyCritRate: 0,
    anomalyCritDmg: 0,
    assaultCritRate: 0,
    assaultCritDmg: 0,
    enemyAssaultDefReduction: 0,
    enemyAnomalyDefReduction: 0,
    enemyDefFlatReduction: 0,
    enemyResReduction: 0,
    elementResReduction: 0,
    penRatio: panel.penRatio,
    penFlat: panel.penFlat,
    refringe: weighted('refringe'),
  }

  panel.refringe = (virtual.refringe ?? 0) as any

  return { element: prog.element, totalBuildUp, rows, virtual, panel }
}

/** 结算触发者条目：每人用自己的面板独立结算，触发次数按积蓄占比分摊 */
export interface AnomalySettlementEntry {
  slot: number
  /** 积蓄占比（0-1），含用户覆盖 */
  share: number
  /** 该触发者的触发次数（整数） */
  triggerCount: number
  /** 触发者自己的完整面板（结算区） */
  panel: PanelValues
  /** 显示用名称 */
  name: string
}

/**
 * 构建异常结算触发者列表。
 *
 * 改为「按触发次数分摊」：每个触发者用自己的面板独立结算，
 * 不再加权合成为一个面板。
 *
 * - 同属性角色（同色共享积蓄池）才有资格触发
 * - 触发次数 = round(share × totalTriggers)，末端补余保证总数一致
 */
export function buildAnomalySettlementEntries(
  build: AnomalyVirtualPanelBuild,
  panels: PanelValues[],
  totalTriggers: number,
  configStore: ReturnType<typeof useConfigStore>,
  catalogStore: ReturnType<typeof useCatalogStore>,
): AnomalySettlementEntry[] {
  // 同属性角色筛选（用 virtual panel row 的 settlementEligible 字段）
  const settlementRows = build.rows.filter(row => row.settlementEligible)
  const rows = settlementRows.length > 0 ? settlementRows : build.rows

  // 份额（含用户覆盖）。单人结算时强制 100%，不受异属性赋彩贡献稀释。
  const isSingle = rows.length === 1
  const shares = rows.map(row => {
    if (isSingle) return 1
    const override = configStore.getAnomalySettlementShare(build.element, row.slot)
    return override ?? row.weight
  })
  const shareTotal = isSingle ? 1 : (shares.reduce((a, b) => a + b, 0) || 1)

  // 触发次数分摊
  const rawCounts = shares.map(s => Math.round((s / shareTotal) * totalTriggers))
  const sumRaw = rawCounts.reduce((a, b) => a + b, 0)
  const diff = totalTriggers - sumRaw
  // 余数（正或负）加到第一个参与结算的角色上
  if (diff !== 0 && rawCounts.length > 0) {
    rawCounts[0] += diff
  }

  return rows.map((row, i) => {
    const agent = catalogStore.getAgent(configStore.team[row.slot]?.agentId ?? '')
    return {
      slot: row.slot,
      share: shares[i] / shareTotal,
      triggerCount: Math.max(0, rawCounts[i] ?? 0),
      panel: panelAt(panels, row.slot) ?? emptyPanel(),
      name: agent?.name?.zhCN || `槽${row.slot + 1}`,
    }
  }).filter(e => e.triggerCount > 0)
}

export function getRemielleLevelValue(row: SkillMove['rows'][number] | undefined, skillLevelBonus: number): number {
  if (!row) return 0
  const values = row.values ?? []
  if (!values.length) return 0
  const skillLevel = getSkillLevelCoef(skillLevelBonus).skillLevel
  const levelValues = (row as any).levelValues ?? (row as any).luminizeLevelValues
  if (Array.isArray(levelValues)) {
    const idx = levelValues.indexOf(skillLevel)
    if (idx >= 0) return values[idx] ?? values[0] ?? 0
  }
  if (values.length === 3) {
    return values[skillLevel >= 16 ? 2 : skillLevel >= 14 ? 1 : 0] ?? values[0] ?? 0
  }
  return values[0] ?? 0
}

export function remielleSpecialVoidflareCount(panel: PanelValues): number {
  const firstRound = panel.remielleCinema1SpecialVoidflareCount ?? 0
  if (firstRound <= 0) return 0
  const refillRound = panel.remielleCinema4SpecialVoidflareRefillCount ?? 0
  const c6Multiplier = 1 + Math.max(0, panel.remielleCinema6SpecialVoidflareTriggerMultiplier ?? 0)
  return (firstRound + Math.max(0, refillRound)) * c6Multiplier
}

export interface VoidflareDamageInput {
  sourcePanel: PanelValues
  remiellePanel: PanelValues
  multiplier: number
  element: string
  enemyDefense: number
  enemyResistances: Record<string, number>
  stunMultiplier: number
  /** 是否失衡或失衡易伤覆盖率（0-1） */
  stunned: boolean | number
  cinema1ResIgnore: number
}

export function calcVoidflareDamage(input: VoidflareDamageInput): { damage: number; formula: string } {
  const { sourcePanel: source, remiellePanel: remielle, multiplier, element, enemyDefense, enemyResistances, stunMultiplier, stunned, cinema1ResIgnore } = input

  const baseDmg = source.atk * (multiplier / 100)
  const elementDmg = source[ELEMENT_DMG_KEYS[element]] ?? 0
  const dmgMult = 1 + ((source.dmgBonus ?? 0) + elementDmg) / 100
  const profMult = (source.anomalyProficiency ?? 0) / 100

  const remielleDefReduction = (remielle.enemyDefReduction ?? 0)
    + (remielle.enemyAnomalyDefReduction ?? 0)
    + (remielle[ELEMENT_DEF_REDUCTION_KEYS[element]] ?? 0)
  const effectiveDef = Math.max(0,
    enemyDefense * (1 - (source.penRatio ?? 0) / 100) * (1 - remielleDefReduction / 100)
    - ((source.penFlat ?? 0) + (remielle.enemyDefFlatReduction ?? 0)),
  )
  const defMult = 794 / (794 + effectiveDef)
  const levelMult = 2
  const mass = baseDmg * dmgMult * profMult * defMult * levelMult

  const baseRes = enemyResistances[element] ?? 0
  const sourceResReduction = (source.enemyResReduction ?? 0)
    + (source[ELEMENT_RES_REDUCTION_KEYS[element]] ?? 0)
    + cinema1ResIgnore
  const resMult = 1 - (baseRes - sourceResReduction) / 100

  const anomalyDmgMult = 1 + (remielle.anomalyDmgBonus ?? 0) / 100
  const passiveLuminizeMult = 1 + (remielle.remielleLuminizeMultiplierBonus ?? 0) / 100
  const cinema4LuminizeMult = 1 + (remielle.remielleCinema4LuminizeMultiplierBonus ?? 0) / 100
  const luminizeMult = passiveLuminizeMult * cinema4LuminizeMult
  const refringeMult = 1 + ((remielle.remielleRefringeCoefficient ?? 0) + (remielle.remielleRefringeCoefficientBonusPct ?? 0)) / 100

  const dmgTakenMult = 1 + (remielle.enemyDamageTakenBonus ?? 0) / 100
  let stunBonus = (remielle.stunDmgMultiplierBonus ?? 0) + (remielle.stunDmgMultiplierBonusAlways ?? 0)
  const stunCap = remielle.stunDmgMultiplierBonusCapAlways ?? 0
  if (stunCap > 0) stunBonus = Math.min(stunBonus, stunCap)
  const stunMult = stunned ? Math.max(0, stunMultiplier + stunBonus / 100) : 1

  const damage = mass * resMult * anomalyDmgMult * luminizeMult * refringeMult * stunMult * dmgTakenMult
  const formula = `基础 ${fmt(source.atk)}×${fmt(multiplier)}% × 增伤(1+${fmt((source.dmgBonus ?? 0) + elementDmg)}%) × 精通(${fmt(source.anomalyProficiency ?? 0)}/100) × 防御(${fmt(defMult, 4)}) × 等级(${levelMult}) × 抗性(${fmt(resMult, 4)}) × 异化(${fmt(refringeMult, 4)}) × 异常增伤(1+${fmt(remielle.anomalyDmgBonus ?? 0)}%) × 耀变被动(${fmt(passiveLuminizeMult, 4)}) × 4命(${fmt(cinema4LuminizeMult, 4)}) × 失衡(${fmt(stunMult, 4)}) × 易伤(${fmt(dmgTakenMult, 4)})`

  return { damage, formula }
}

// ============================================================================
// 本簇 12 个公开符号（10 函数 + 4 interface 里的 2 个类型在本簇内联）在 `./helpers.ts` 保留
// **re-export 壳**（R22 熵批 2 / R22-S2 刀 C）：目录外既有消费者（`damagePool.ts` 取其中 7 个 /
// `cinemaUplift.ts` / `difficultyLadder.ts` / `views` / 测试）import 路径零改动。
// ⚠ 必须写成「import + export」两行——`export { … } from './anomalyPanels'` **不建本地绑定**。
// ⚠ 改异常面板/结算口径请改本文件，**不要回 `helpers.ts` 重建同形函数**（那会分裂单一事实源）。
// ============================================================================
