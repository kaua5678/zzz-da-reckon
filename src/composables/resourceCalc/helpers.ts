/**
 * 资源池计算 composable
 *
 * 从 config store 获取队伍配置 → 计算面板 → 构建资源池计算配置 → 调用计算引擎
 *
 * 数据流：
 *   configStore.team (3角色配置)
 *     → calcPanel (面板计算，复用 TeamConfigPage 同逻辑)
 *     → findExSpecial / findUltimate / findChainAttack / calcBasicAttackRegenPerSec (技能数据提取)
 *     → CharacterOperationConfig[] (资源池配置)
 *     → calcTeamResources (迭代计算)
 *     → TeamResourceResult (结果)
 *     → calcStunPool / calcAnomalyPool (失衡池 + 积蓄池)
 */
import { useConfigStore } from '@/stores/config'
import { useCatalogStore } from '@/stores/catalog'
import { emptyPanel, panelAt } from '@/core/panel'
import { inferSkillDamageTarget } from '@/core/damage'
import type { StunSkillExecution } from '@/core/stunPool'
import {
  findExSpecial,
  findUltimate,
  findChainAttack,
  findDefensiveAssist,
  findAssistFollowUp,
  findCounterAssist,
  findDodgeCounter,
  calcBasicAttackRegenPerSec,
  findRemielleRainbowEnd,
  findRemielleRadiantTurn,
  ULTIMATE_COST_DEFAULT,
} from '@/core/resource'
import { counterAssistOf } from '@/data/counterAssists'

import type { AnomalySkillExecution } from '@/core/anomalyPool'
import { getAgentMechanic } from '@/mechanics'
// 蕾米埃尔身份谓词（原 `:996` 内联 `agent?.id === '1581' || agent?.teammateBuffId === 'remielle'`
// 的两臂收敛点）。⚠ 只 import 谓词、不 import 整个模块的其它数学（规则 6 的语义面）。
import { isRemielleAgent } from '@/mechanics/agents/remielle'
import { getAgentSpec } from '@/specs/registry'
import { evalAdditionalAbility } from '@/specs/teamCondition'
import type {
  CharacterOperationConfig,
  TeamResourceResult,
  SkillExecution,
  AnomalyProgress,
} from '@/types/resource'
import { isFrontlineExecution } from '@/types/resource'
import type { PanelValues, AgentSkills, SkillMove } from '@/types/catalog'
import { getSkillLevelCoef } from '@/core/skillLevel'
import { fmt } from '@/utils/format'
import { getRowFusionMultiplier } from '@/logicEditor/fusion'
import { moveFusionByMoveId } from '@/data/moveFusions'
import { SUSTAINED_EX_SPECS, sustainedDamageScale } from '@/data/sustainedEx'
import { EXTRA_EX_PLANS } from '@/data/exSpecialPlans'

// ============================================================================
// 面板 + 机制编排簇（B 簇）已整段迁至 `./panelPhases.ts`（R22 熵批 1 / T67-a1 刀 A，纯搬迁）。
// 本块是 **re-export 壳**：51 个 `computePanelPhases` 消费者与既有测试的 import 路径零改动。
// ⚠ 必须写成「import + export」两行——`export { … } from './panelPhases'` **不建本地绑定**，
//   而本文件下游（`buildCharConfig` → `computePanel`；异常/执行计划簇 → `buildMechanicTeamMembers`）
//   需要本地绑定，实测会 `ReferenceError`。
// ⚠ 私有 helper（`teamDiscs` / `mergeTeamDiscEffectCoverages` / `agentHasCinemaSkillLevelBuff`）
//   **不 re-export**——它们迁移前就不是本文件的导出面，不借搬迁顺手放宽 API。
// ⚠ 改面板/机制编排请改 `./panelPhases.ts`，**不要在本文件重建同形函数**（那会分裂单一事实源）。
// ============================================================================
import {
  buildMechanicTeamMembers,
  computePanel,
  computePanelPhases,
  computeRemielleEntryPanel,
  resolveMechanicSettings,
  applyTeamMechanics,
  collectNextRoundFeedback,
  collectAxisWindowOverlays,
  ADDITIONAL_GATE_BUFFS,
  evalAdditionalAbilityBuffGates,
} from './panelPhases'
export {
  buildMechanicTeamMembers,
  computePanel,
  computePanelPhases,
  computeRemielleEntryPanel,
  resolveMechanicSettings,
  applyTeamMechanics,
  collectNextRoundFeedback,
  collectAxisWindowOverlays,
  ADDITIONAL_GATE_BUFFS,
  evalAdditionalAbilityBuffGates,
}

/** 判断字符串是否为百分比型属性（决定 applyStat 用 pct 还是 flat） */


export type DamagePoolRow = {
  id: string
  slot: number
  agentId: string
  agentName: string
  type: '直伤' | '异放' | '乱流' | '耀变' | '特殊虚耀' | '灼烧' | '感电' | '侵蚀' | '风化' | '强击' | '极性紊乱' | '极性强击' | '碎冰' | '简6命附伤' | '紊乱' | '爱丽丝6命附伤' | '畏缩 DOT'
  name: string
  element: string
  source: string
  count: number
  perDamage: number
  totalDamage: number
  note: string
  /** 来源招式 moveId（直伤行有值，异常行 undefined） */
  moveId?: string
  /** 来源标签：gift=队友赠送（诺姆转连携/琉音转大等）、stun=失衡送连携、self=自身攒 */
  sourceTag?: 'gift' | 'stun' | 'self'
  /** 失衡易伤乘数（轴启用时按轴内位置分配，默认 1） */
  stunMult?: number
  /** 单次倍率（%，直伤=招式倍率、异放=releaseMultiplier、紊乱=disorderMultiplier、
   *  DoT=perTick×tick数 等；秒均行 count 已折算成总秒数 → count×multiplier = 该行总倍率）。
   *  供「伤害来源分解」诊断：总倍率 = Σ(count×multiplier)，属性区 = 总伤害/(总倍率/100)。 */
  multiplier?: number
}

export function parseReleaseMultiplier(event: { formula?: string; fields?: string[] }): number {
  const text = `${event.formula ?? ''} ${(event.fields ?? []).join(' ')}`
  const match = text.match(/releaseMultiplier\s*=\s*(\d+(?:\.\d+)?)/i)
  return match ? Number(match[1]) : 0
}

/** 伤害来源分解：某角色一类伤害（直伤/异常）的总伤害、总倍率与属性区（诊断用）。
 *  总倍率 = Σ(count × multiplier)（%，有 multiplier 的行；无 multiplier 的固定/附伤行不计倍率）
 *  属性区 = 有倍率行的伤害 / (总倍率/100) —— 每 100% 倍率对应的「属性区伤害」（atk×增伤×防御×
 *  抗性×易伤×失衡×暴击×等级 等非倍率乘区乘积的加权期望）。总伤害 = 属性区 × 总倍率/100 + 无倍率行伤害。
 *  用途：检查总伤害异常时，看是倍率（招式/事件次数×倍率）错还是属性区（面板/乘区）错。 */
export interface DamageSourceFamily {
  /** 总伤害（含无倍率行） */
  damage: number
  /** 总倍率 Σ(count × multiplier)（%） */
  multiplier: number
  /** 属性区 = 有倍率行伤害 / (总倍率/100)（0 表示无倍率行或倍率为 0） */
  attrRegion: number
  /** 无倍率行（固定/附伤）伤害合计 */
  flatDamage: number
  /** 有倍率行的行数 */
  multiplierRows: number
  /** 有倍率行的伤害合计（属性区反推的分子） */
  multiplierDamage: number
}
export interface DamageSourceBreakdown {
  slot: number
  agentId: string
  agentName: string
  direct: DamageSourceFamily
  anomaly: DamageSourceFamily
}

/** 直伤族类型（其余全归异常族） */
const DIRECT_FAMILY_TYPES = new Set<string>(['直伤'])

export function computeDamageSourceBreakdown(rows: DamagePoolRow[]): DamageSourceBreakdown[] {
  const bySlot = new Map<number, DamageSourceBreakdown>()
  const emptyFamily = (): DamageSourceFamily => ({ damage: 0, multiplier: 0, attrRegion: 0, flatDamage: 0, multiplierRows: 0, multiplierDamage: 0 })
  const add = (fam: DamageSourceFamily, row: DamagePoolRow) => {
    fam.damage += row.totalDamage
    if (row.multiplier && row.multiplier > 0 && row.count > 0) {
      fam.multiplier += row.count * row.multiplier
      fam.multiplierRows += 1
      fam.multiplierDamage += row.totalDamage
    } else {
      fam.flatDamage += row.totalDamage
    }
  }
  for (const row of rows) {
    let b = bySlot.get(row.slot)
    if (!b) {
      b = { slot: row.slot, agentId: row.agentId, agentName: row.agentName, direct: emptyFamily(), anomaly: emptyFamily() }
      bySlot.set(row.slot, b)
    }
    add(DIRECT_FAMILY_TYPES.has(row.type) ? b.direct : b.anomaly, row)
  }
  const finish = (fam: DamageSourceFamily) => {
    fam.attrRegion = fam.multiplier > 0 ? fam.multiplierDamage / (fam.multiplier / 100) : 0
  }
  const out: DamageSourceBreakdown[] = []
  for (const b of bySlot.values()) {
    finish(b.direct)
    finish(b.anomaly)
    out.push(b)
  }
  out.sort((a, b) => a.slot - b.slot)
  return out
}

export function safeElement(element?: string): any {
  return (element || 'physical') as any
}


export const DAMAGE_ELEMENT_LABELS: Record<string, string> = {
  physical: '物理',
  fire: '火',
  ice: '冰',
  electric: '电',
  ether: '以太',
  wind: '风',
  lumiflux: '辉光',
  physical_polar_assault: '极性强击',  // 爱丽丝物理变种
  ether_ink: '玄墨',                  // 仪玄以太变种（独立积蓄槽）
  frostfire: '烈霜',                     // 雅独立元素
}

export function elementLabel(element: string): string {
  return DAMAGE_ELEMENT_LABELS[element] ?? element
}

export function isPctStat(stat: string): boolean {
  return stat.endsWith('Pct') || stat.endsWith('Rate') || stat.endsWith('Dmg') ||
    stat.endsWith('Ratio') || stat.endsWith('Mastery') || stat.endsWith('Regen') ||
    stat.endsWith('Impact') || stat.endsWith('Efficiency') || stat.endsWith('Bonus')
}

/** 从 SkillMove 的 rows 中提取指定 row 的值 */
export function getRowValue(move: SkillMove | null | undefined, rowId: string): number {
  if (!move) return 0
  const row = move.rows.find(r => r.id === rowId)
  return (row?.values[0] ?? 0) * getRowFusionMultiplier(move.id, rowId)
}

/**
 * 倍率融合（src/data/moveFusions.ts 单一事实源）：moveId 登记了融合组时，
 * 该 row 值 = Σ 组内 term.moveId 的同行值 × term.count。
 * 返回 null = 未登记（走原 getRowValue 单段值）；组内缺段时整组回退 null（保守，防半融合）。
 */
export function fusedRowValue(skills: AgentSkills | undefined, moveId: string, rowId: string): number | null {
  const group = moveFusionByMoveId.get(moveId)
  if (!group) return null
  let sum = 0
  for (const term of group.terms) {
    const member = findMoveById(skills, term.moveId)
    if (!member) return null
    sum += getRowValue(member, rowId) * term.count
  }
  return sum
}

export const ELEMENT_DMG_KEYS: Record<string, string> = {
  physical: 'physicalDmg',
  fire: 'fireDmg',
  ice: 'iceDmg',
  electric: 'electricDmg',
  ether: 'etherDmg',
  wind: 'windDmg',
  lumiflux: 'lumifluxDmg',
  physical_polar_assault: 'physicalDmg',  // 物理变种，使用物理增伤
}

export const ELEMENT_DEF_REDUCTION_KEYS: Record<string, string> = {
  physical: 'enemyPhysicalDefReduction',
  fire: 'enemyFireDefReduction',
  ice: 'enemyIceDefReduction',
  electric: 'enemyElectricDefReduction',
  ether: 'enemyEtherDefReduction',
  wind: 'enemyWindDefReduction',
  lumiflux: 'enemyLumifluxDefReduction',
  physical_polar_assault: 'enemyPhysicalDefReduction',  // 物理变种
}

export const ELEMENT_RES_REDUCTION_KEYS: Record<string, string> = {
  physical: 'enemyPhysicalResReduction',
  fire: 'enemyFireResReduction',
  ice: 'enemyIceResReduction',
  electric: 'enemyElectricResReduction',
  ether: 'enemyEtherResReduction',
  wind: 'enemyWindResReduction',
  lumiflux: 'enemyLumifluxResReduction',
  physical_polar_assault: 'enemyPhysicalResReduction',  // 物理变种
}

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

export function isHealingRow(row: any): boolean {
  const id = String(row.id ?? '').toLowerCase()
  const kind = String(row.kind ?? '').toLowerCase()
  const label = `${row.label?.zhCN ?? ''}${row.label?.en ?? ''}`.toLowerCase()
  return id.includes('heal') || id.includes('hp_recover') || id.includes('hp_recovery')
    || kind.includes('heal') || label.includes('治疗') || label.includes('回血') || label.includes('生命回复')
}

export function getHealingAmount(move: SkillMove): number {
  let total = 0
  for (const row of move.rows as any[]) {
    if (!isHealingRow(row)) continue
    total += row.values?.[0] ?? 0
  }
  return total
}

export function getSpecialResourceRecovery(move: SkillMove): number {
  // 专属资源回复：attack_data_0（kind=special 第一行 = 席德钢能/比利决意/青衣电压/普罗米娅寒蚀）。
  // attack_data_1/2… 是其他通道（如回血），不混入本字段；观察：attack_data_0 秒均 ≈ 11（钢能）。
  for (const row of move.rows as any[]) {
    if (String((row as any).kind ?? '') === 'special') {
      return row.values?.[0] ?? 0
    }
  }
  // 兜底：非标准 recovery 行（旧式专属回复）求和
  let total = 0
  for (const row of move.rows as any[]) {
    const id = String(row.id ?? '')
    if (!id.includes('recovery')) continue
    if (id === 'energy_recovery' || id === 'decibel_recovery') continue
    if (isHealingRow(row)) continue
    total += row.values?.[0] ?? 0
  }
  return total
}

export function findMoveById(skills: AgentSkills | undefined, moveId: string): SkillMove | null {
  if (!skills) return null
  for (const cat of skills.categories) {
    const move = cat.moves.find(m => m.id === moveId)
    if (move) return move
  }
  return null
}

export function findMoveByEnglishName(skills: AgentSkills | undefined, englishName: string): SkillMove | null {
  if (!skills) return null
  for (const cat of skills.categories) {
    const move = cat.moves.find(m => m.name?.en === englishName || m.name?.zhCN === englishName)
    if (move) return move
  }
  return null
}

/**
 * 平A基准段硬编码 override。
 * key = agentId（catalog id），value = 使用的 moveId。
 * 不在此映射的角色默认取第 3 段（index 2），不足 3 段取最后一段。
 */
export const BASIC_BENCHMARK_OVERRIDE: Record<string, string> = {
  // 在此填入需要特殊基准段的角色，如 '1401': '1401003'
}

/**
 * 平A「第 3 段」挑选（`#N` 段里取 index 2，不足取末段）——**单一事实源**。
 *
 * 引擎默认基准（`getBasicComboMoves` 第 4 步）与需要**多套基准**的角色模块（如克拉蕾 1611
 * 常态/猩红铭刻两态分支）都调本函数，避免两处各写一遍"第 3 段"而在规则变化时漂移。
 */
export function pickThirdNamedBasicSegment(moves: readonly SkillMove[]): SkillMove | null {
  const named: SkillMove[] = []
  for (const move of moves) {
    const name = move.name?.en || ''
    if (!name.match(/#\d+/)) continue
    if (name.toLowerCase().includes('dash') || name.toLowerCase().includes('dodge')) continue
    if (!move.actionTime || move.actionTime <= 0) continue
    named.push(move)
  }
  if (named.length === 0) return null
  return named[Math.min(2, named.length - 1)]
}

/**
 * 获取平A基准段（单段，秒均化）。
 * 优先：catalog agent.basicBenchmarkMoveId（数据配置）→ 硬编码 override 兜底 → 默认第 3 段（#3）；不足 3 段取最后一段。
 */
export function getBasicComboMoves(
  skills: AgentSkills | undefined,
  agentId?: string,
  catalogStore?: ReturnType<typeof useCatalogStore>,
): SkillMove | null {
  const basic = skills?.categories.find(c => c.id === 'basic')
  if (!basic) return null

  // 1. 收集所有 #N 段（排除 dash/dodge），数组顺序 = 原始顺序（#1,#2,#3...）
  const all: SkillMove[] = []
  for (const move of basic.moves) {
    const name = move.name?.en || ''
    if (!name.match(/#\d+/)) continue
    if (name.toLowerCase().includes('dash') || name.toLowerCase().includes('dodge')) continue
    if (!move.actionTime || move.actionTime <= 0) continue
    all.push(move)
  }
  if (all.length === 0) return null

  // 2. 数据配置优先（catalog agent.basicBenchmarkMoveId）
  if (agentId && catalogStore) {
    const dataId = catalogStore.getAgent(agentId)?.basicBenchmarkMoveId
    if (dataId) {
      const found = all.find(m => m.id === dataId)
      if (found) return found
    }
  }

  // 3. 硬编码 override 兜底
  if (agentId && BASIC_BENCHMARK_OVERRIDE[agentId]) {
    const overrideId = BASIC_BENCHMARK_OVERRIDE[agentId]
    const found = all.find(m => m.id === overrideId)
    if (found) return found
  }

  // 4. 默认第 3 段（index 2），不足取末尾
  return pickThirdNamedBasicSegment(all)
}

export function averageBasicRows(
  skills: AgentSkills | undefined,
  agentId?: string,
  catalogStore?: ReturnType<typeof useCatalogStore>,
): Partial<SkillExecution> {
  const move = getBasicComboMoves(skills, agentId, catalogStore)
  if (!move) return {}
  const at = move.actionTime ?? 1

  const s = (rowId: string) => getRowValue(move, rowId) / at
  return {
    damageMultiplier: s('damage'),
    dazeMultiplier: s('daze'),
    anomalyBuildUp: s('anomaly_buildup'),
    specialResourceRecovery: getSpecialResourceRecovery(move) / at,
    healingAmount: getHealingAmount(move) / at,
    skillTableResolved: true,
    skillTableNote: '平A按基准段（默认#3）秒均 × 平A时间计算（只打该段）。',
  }
}

/**
 * 展示口径归一（2026-09-08 用户实测「诺姆入队后主C时间 = 180s + 诺姆连携秒数」后收口）：
 * 资源卡的「时间分配」按**最终执行行**计算——前台 = Σ前台行 `totalTime`（含装配后追加的赠送行：
 * 诺姆赠链 `normaGiftChain` / 琉音赠大 `source==='gift'`），后台 = 战斗时间 − 前台。
 *
 * 为什么必须在这里统一：赠送行由 `applyNormaHatChain` / `applyLiuyinPromote` 在引擎返回**之后**追加，
 * 引擎的 `timeAllocation` 看不到它们；而赠送时间的**预留**分散在 iterate 必要时间 / 折叠环行测量 /
 * 截断上限三处，各自口径略不同（轴模式琉音赠大走的是 post-hoc carve、预留为 0）——于是展示层
 * 若也各自回扣就会再次漂移（实测轴模式资源卡总计 = 180 + 赠送秒数）。此处以**最终行**为唯一口径重算，
 * 新增赠送机制无需再改展示逻辑。
 */
export function normalizeDisplayTime(rr: TeamResourceResult): TeamResourceResult {
  return {
    ...rr,
    characters: rr.characters.map(c => {
      const front = (c.executions ?? []).reduce(
        (s, e) => s + (isFrontlineExecution(e) ? (e.totalTime ?? 0) : 0), 0)
      return {
        ...c,
        timeAllocation: {
          ...c.timeAllocation,
          frontlineTime: front,
          backstageTime: Math.max(0, rr.totalTime - front),
        },
      }
    }),
  }
}

export function enrichExecutionPlan(result: TeamResourceResult, catalogStore: ReturnType<typeof useCatalogStore>): TeamResourceResult {
  return {
    ...result,
    characters: result.characters.map(char => {
      const skills = catalogStore.getAgentSkills(char.agentId)
      const executions = char.executions.map(exec => {
        // 赠行由引擎物化、倍率由编排层在 enrich 之后补：enrich 必须跳过，否则会补上生产侧
        // 刻意留空的字段（实测：琉音赠行凭空多 daze、诺姆赠行凭空多 skillDamageTarget）。
        if (exec.source === 'gift' || exec.normaGiftChain) return exec
        let patch: Partial<SkillExecution> = {}
        if (exec.moveId === 'basic_attack') {
          if (exec.damageMultiplierOverride || exec.dazeMultiplierOverride) {
            // 机制模块已覆盖秒均倍率（如青衣「一煞#4→醉花」循环），保留自定义值
            const bu = exec.anomalyBuildUp ?? 0
            patch = {
              actionCode: exec.moveId,
              skillTableResolved: true,
              skillDamageTarget: 'basic',
              anomalyBuildUp: bu,
              totalAnomalyBuildUp: bu * Math.max(0, exec.totalTime),
            }
          } else {
            const rows = averageBasicRows(skills, char.agentId, catalogStore)
            const bu = rows.anomalyBuildUp ?? 0
            patch = {
              actionCode: exec.moveId,
              ...rows,
              skillDamageTarget: 'basic',
              anomalyBuildUp: bu,
              totalAnomalyBuildUp: bu * Math.max(0, exec.totalTime),
            }
          }
        } else {
          const move = findMoveById(skills, exec.moveId)
          if (move) {
            // 招式类型定向（伤害路径按此读 X__<target> 定向键，如驱动盘/音擎的普攻/冲刺限定增伤）
            const foundCategory = skills?.categories?.find(cat => (cat.moves ?? []).some(m => String(m.id) === String(exec.moveId)))
            const skillDamageTarget = foundCategory ? inferSkillDamageTarget(foundCategory, move) : undefined
            const specialResourceRecovery = getSpecialResourceRecovery(move)
            const healingAmount = getHealingAmount(move)
            // exec.anomalyBuildUp 显式为 0 = 模块显式禁用异常积蓄（如莱卡恩围猎后台招式"仅伤害+失衡值"）；
            // anomalyBuildUpOverride = 模块显式给定缩放后积蓄（持续段按时长等比），跳过回填。
            const bu = exec.anomalyBuildUpOverride
              ? (exec.anomalyBuildUp ?? 0)
              : exec.anomalyBuildUp === 0
                ? 0
                : (fusedRowValue(skills, exec.moveId, 'anomaly_buildup') ?? getRowValue(move, 'anomaly_buildup'))
            // 同上：decibel/energy 显式 0 = 模块显式禁用回填（围猎后台闪反无喧响/能量）；
            // 未提供（undefined）= 交倍率表回填——能量与喧响同构三态（2026-09-09 能量债务审计）。
            // decibelRecoveryOverride = 模块显式给定口径换算后的行值（如洛克茜自旋：表值为每秒，
            // 行值 = 每秒 × spinSeconds），跳过表值覆盖——与 damage/anomaly override 同构。
            // 登记融合组的主段行：喧响/能量取「一次动作」的整段和（与 damage/daze/anomaly 同一函数
            // 同一口径）；只回头段会把雅一次连携的 230.15 记成 69.05（坑 31）。
            const tableDecibel = fusedRowValue(skills, exec.moveId, 'decibel_recovery')
              ?? getRowValue(move, 'decibel_recovery')
            const decibelValue = exec.decibelRecoveryOverride
              ? (exec.decibelRecovery ?? 0)
              : exec.decibelRecovery === 0 ? 0 : (tableDecibel || (exec.decibelRecovery ?? 0))
            const tableEnergy = fusedRowValue(skills, exec.moveId, 'energy_recovery')
              ?? getRowValue(move, 'energy_recovery')
            const energyValue = exec.energyRecovery === 0 ? 0 : (tableEnergy || (exec.energyRecovery ?? 0))
            patch = {
              actionCode: move.id,
              moveName: move.name?.zhCN || move.name?.en || exec.moveName,
              damageMultiplier: exec.damageMultiplierOverride
                ? exec.damageMultiplier
                : (fusedRowValue(skills, exec.moveId, 'damage') ?? getRowValue(move, 'damage')),
              dazeMultiplier: exec.dazeMultiplierOverride
                ? exec.dazeMultiplier
                : (fusedRowValue(skills, exec.moveId, 'daze') ?? getRowValue(move, 'daze')),
              anomalyBuildUp: bu,
              totalAnomalyBuildUp: bu * Math.max(0, exec.count),
              energyRecovery: energyValue,
              totalEnergyRecovery: energyValue * Math.max(0, exec.count),
              decibelRecovery: decibelValue,
              totalDecibelRecovery: decibelValue * Math.max(0, exec.count),
              specialResourceRecovery,
              totalSpecialResourceRecovery: specialResourceRecovery * Math.max(0, exec.count),
              healingAmount,
              totalHealingAmount: healingAmount * Math.max(0, exec.count),
              skillTableResolved: true,
              skillDamageTarget,
              skillTableNote: '已从倍率表 rows 回填 damage/daze/energy_recovery/decibel_recovery/anomaly_buildup。',
            }
          } else {
            patch = {
              skillTableResolved: false,
              skillTableNote: '未在倍率表中找到对应 moveId；可能是资源池合成行或待补数据。',
            }
          }
        }
        return { ...exec, ...patch }
      })
      return { ...char, executions }
    }),
  }
}

/** 从技能数据提取资源池所需的招式信息，构建单个角色的操作配置 */


export function normalizeResourceSkillType(move: SkillMove | null, execMoveId: string): string {
  if (execMoveId === 'basic_attack') return 'basic'
  // 优先按招式自身信号分类（与伤害路径 inferSkillDamageTarget 同口径——@fact 招式类型/两路径同源 |
  // 据 用户 2026-09-05「字段对应，招式限定要注意」 | 验 discSetEffects.test.ts | 锚 helpers.ts#normalizeResourceSkillType | 信 高）：
  // 实测冲刺招式 catalog skillType 可能误标 'dodge'（如苍角 1131016），名称/tags 先判可纠正。
  if (move?.timeType === 'dodgeCounter') return 'dodgeCounter'
  if (move?.skillTags?.includes('dashAttack')) return 'dashAttack'
  if (move?.skillTags?.includes('additionalAttack')) return 'additionalAttack'
  const name = `${move?.name?.en ?? ''} ${move?.name?.zhCN ?? ''}`.toLowerCase()
  if (name.includes('dash attack') || name.includes('冲刺攻击')) return 'dashAttack'
  const raw = move?.skillType ?? ''
  if (raw === 'dodge') return 'dodgeCounter'
  if (raw === 'special') return move?.energyCost ? 'exSpecial' : 'special'
  if (raw === 'basic' || raw === 'ultimate' || raw === 'chain' || raw === 'assist'
    || raw === 'dashAttack' || raw === 'additionalAttack') return raw
  return 'all'
}

export function buildCharConfig(
  slot: number,
  configStore: ReturnType<typeof useConfigStore>,
  catalogStore: ReturnType<typeof useCatalogStore>,
): CharacterOperationConfig | null {
  const char = configStore.team[slot]
  if (!char?.agentId) return null

  const agent = catalogStore.getAgent(char.agentId)
  const skills = catalogStore.getAgentSkills(char.agentId)
  if (!agent || !skills) return null

  const panel = computePanel(slot, configStore, catalogStore)
  if (!panel) return null

  // 「本槽是不是蕾米埃尔」+ 面板盖章 + cfg 三字段（`remielleEnabled` / `remielleRadiantTurnDazeBonusPct`
  // / 面板同名字段）**已整块迁进** `remielle.ts#buildRemielleCharConfig`（2026-09-17 round 21 夜间批 C，
  // 规则 6）。原实现是 `:1661` 的 `agent.id === '1581' || agent.teammateBuffId === 'remielle'` 判据
  // 加 `:1662-1634` 的**双出口**（panel + cfg 各写一次）；现在**唯一写者 = 该角色模块**，钩子在下文
  // `charModule?.buildCharConfig?.({ … cfg })` 处被派发（它写的就是本函数刚建好的同一个 cfg 对象）。
  // ⇒ cfg 字面量里**不再**出现 `remielleEnabled` / `remielleRadiantTurnDazeBonusPct`（未命中时保持
  // `undefined`，与迁移前 `false`/`0` 在消费端 `if (cfg.remielleEnabled && …)` 下等价）。

  // 判断命破角色
  const isFlash = !!(agent.level60.flashEnergyRegen && agent.level60.flashEnergyRegen > 0)

  // 提取技能数据
  const exSpecial = findExSpecial(skills as AgentSkills)
  const ultimate = findUltimate(skills as AgentSkills)
  const chainAttack = findChainAttack(skills as AgentSkills)
  const defensiveAssist = findDefensiveAssist(skills as AgentSkills)
  const assistFollowUp = findAssistFollowUp(skills as AgentSkills)
  // 反制支援（Counter Assist）：按登记表取行（克拉蕾 = 1611028 寸铁不让 + 1611030 琢形，
  // 融合成「一次动作」），有登记 ≠ 一定发动——次数由 boss 控制技组与替换开关决定。
  const counterAssistDecl = counterAssistOf(char.agentId)
  const counterAssist = counterAssistDecl ? findCounterAssist(skills as AgentSkills, counterAssistDecl.moveId) : null
  const counterAssistCount = counterAssist && configStore.counterAssistSlot === slot
    ? (configStore.appliedBoss?.counterAssistGroups?.length ?? 0)
    : 0
  const dodgeCounter = findDodgeCounter(skills as AgentSkills)
  const basicRegen = calcBasicAttackRegenPerSec(skills as AgentSkills)
  const remielleRainbowEnd = findRemielleRainbowEnd(skills as AgentSkills)
  const remielleRadiantTurn = findRemielleRadiantTurn(skills as AgentSkills)

  // 倍率表 decibel_recovery / energy_recovery 全量预存（喧响+能量收入行级化 Σ 切换的前置）：
  // 核心层 calcRawDecibelParts / calcEnergySource 无 catalog 访问权，按此表复刻 enrichExecutionPlan
  // 回填语义（getRowValue 含行级融合乘子，与展示层同一函数同一时刻取值，杜绝记账/展示两套表值）。
  const decibelRecoveryByMoveId: Record<string, number> = {}
  const energyRecoveryByMoveId: Record<string, number> = {}
  for (const cat of (skills as AgentSkills | undefined)?.categories ?? []) {
    for (const m of cat.moves ?? []) {
      // 登记融合组的主段：喧响取「一次动作」的整段和（一次连携把各段的 fever_recovery 全打了，
      // 只回头段会把雅 230.15 记成 69.05）。兄弟段不单独成行（moveFusions 入表前提），无六计风险。
      decibelRecoveryByMoveId[String(m.id)]
        = fusedRowValue(skills as AgentSkills, String(m.id), 'decibel_recovery') ?? getRowValue(m, 'decibel_recovery')
      energyRecoveryByMoveId[String(m.id)]
        = fusedRowValue(skills as AgentSkills, String(m.id), 'energy_recovery') ?? getRowValue(m, 'energy_recovery')
    }
  }

  // 合轴率覆盖：优先使用用户在结果页设置的值，否则用倍率表默认值
  const ov = (moveId: string, defaultRatio: number) =>
    configStore.getComboAlignOverride(slot, moveId, defaultRatio)

  // 角色类型
  const isSupport = agent.specialty === 'support'

  // 加农转子（14001）：攻击命中并暴击时触发 200% 攻击力直伤事件，按精修 CD 计算本局上限。
  const wEngine = char.wEngineId ? catalogStore.getWEngine(char.wEngineId) : null
  const wEngineMatchesSpecialty = !!wEngine && wEngine.specialty === agent.specialty
  const cannonRotorCooldowns = [8, 7.5, 7, 6.5, 6]
  const cannonRotorModIndex = Math.max(0, Math.min(4, (char.wEngineModLevel ?? 1) - 1))
  // 音擎 id 已统一为数字（旧 zzz_wiki_XXXX 存于 legacyIds，兼容旧 localStorage 配置）
  const hasCannonRotorEvent = wEngineMatchesSpecialty && !!wEngine
    && (wEngine.id === '14001' || (wEngine.legacyIds ?? []).includes('14001'))

  // 平A时间分配权重：优先读取用户配置；旧配置缺字段时按当前默认规则兜底
  const timeWeight = char.basicAttackTimeWeight ?? configStore.getDefaultBasicAttackTimeWeight(agent)

  // 开局赠送能量：普通角色40点
  const initialEnergyGift = 40

  const resourceUtilizationPrefix = `${slot}:`
  const resourceUtilization = Object.fromEntries(
    Object.entries(configStore.resourceUtilization ?? {})
      .filter(([key]) => key.startsWith(resourceUtilizationPrefix))
      .map(([key, value]) => [key.slice(resourceUtilizationPrefix.length), value]),
  )

  const cfg: CharacterOperationConfig = {
    slot,
    agentId: char.agentId,
    isFlashUser: isFlash,
    panel,
    basicAttackRegenPerSec: basicRegen.energyPerSec,
    basicAttackDecibelPerSec: basicRegen.decibelPerSec,
    remielleRainbowEndMoveId: remielleRainbowEnd?.moveId ?? '',
    remielleRainbowEndActionTime: remielleRainbowEnd?.actionTime ?? 0,
    remielleRainbowEndDecibelRecovery: remielleRainbowEnd?.decibelRecovery ?? 0,
    remielleRainbowEndComboAlignRatio: remielleRainbowEnd?.comboAlignRatio ?? 0,
    // `remielleEnabled` / `remielleRadiantTurnDazeBonusPct` 由下方
    // `charModule?.buildCharConfig?.()`（= `remielle.ts#buildRemielleCharConfig`）写入，
    // 不再在此处按身份判定（2026-09-17 round 21 夜间批 C）。
    remielleRadiantTurnMoveId: remielleRadiantTurn?.moveId ?? '',
    remielleRadiantTurnActionTime: remielleRadiantTurn?.actionTime ?? 0,
    remielleRadiantTurnDecibelRecovery: remielleRadiantTurn?.decibelRecovery ?? 0,
    exSpecialMoveId: exSpecial?.moveId ?? '',
    exSpecialEnergyConsume: exSpecial?.energyConsume ?? 0,
    exSpecialCostType: exSpecial?.costType ?? (exSpecial?.energyConsume ? 'energy' : 'free'),
    exSpecialCostAmount: exSpecial?.costAmount ?? 0,
    exSpecialResourceId: exSpecial?.resourceId,
    exSpecialActionTime: exSpecial?.actionTime ?? 0,
    exSpecialDecibelRecovery: exSpecial?.decibelRecovery ?? 0,
    decibelRecoveryByMoveId,
    energyRecoveryByMoveId,
    exSpecialComboAlignRatio: ov(exSpecial?.moveId ?? '', exSpecial?.comboAlignRatio ?? 0),
    ultimateMoveId: ultimate?.moveId ?? '',
    ultimateCost: ULTIMATE_COST_DEFAULT,
    ultimateActionTime: ultimate?.actionTime ?? 0,
    ultimateDecibelRecovery: 0,
    ultimateComboAlignRatio: ov(ultimate?.moveId ?? '', ultimate?.comboAlignRatio ?? 0),
    chainMoveId: chainAttack?.moveId ?? '',
    chainActionTime: chainAttack?.actionTime ?? 0,
    chainDecibelRecovery: chainAttack?.decibelRecovery ?? 0,
    chainComboAlignRatio: ov(chainAttack?.moveId ?? '', chainAttack?.comboAlignRatio ?? 0),
    chainCountPerStun: char.chainCountPerStun ?? (isSupport ? 0 : 1),
    parryCount: char.parryCount ?? 0,
    parryNoFollowUpCount: (char as { parryNoFollowUpCount?: number }).parryNoFollowUpCount ?? 0,
    parryDecibelOnlyCount: (char as { parryDecibelOnlyCount?: number }).parryDecibelOnlyCount ?? 0,
    perfectBlockCount: (char as { perfectBlockCount?: number }).perfectBlockCount ?? 0,
    assaultOrderCount: (char as { assaultOrderCount?: number }).assaultOrderCount ?? 0,
    dodgeCounterCount: char.dodgeCounterCount ?? 0,
    blockCount: char.blockCount ?? 0,
    dualCounterCount: char.dualCounterCount ?? 0,
    tauntCancelCount: char.tauntCancelCount ?? 0,
    quickAssistCount: char.quickAssistCount ?? 0,
    yixuanInk2Count: char.yixuanInk2Count ?? 0,
    promiaNiyingCount: char.promiaNiyingCount ?? 0,
    yixuanInk3Count: char.yixuanInk3Count ?? 0,
    yixuanPerfectBlockCount: char.yixuanPerfectBlockCount ?? 0,
    yixuanExtremeAssistCount: char.yixuanExtremeAssistCount ?? -1,
    yixuanBackstageComboCount: char.yixuanBackstageComboCount ?? 0,
    dodgeCounterMoveId: dodgeCounter?.moveId ?? '',
    dodgeCounterActionTime: dodgeCounter?.actionTime ?? 0,
    dodgeCounterDecibelRecovery: dodgeCounter?.decibelRecovery ?? 0,
    dodgeCounterComboAlignRatio: ov(dodgeCounter?.moveId ?? '', dodgeCounter?.comboAlignRatio ?? 0),
    defensiveAssistMoveId: defensiveAssist?.moveId ?? '',
    defensiveAssistActionTime: defensiveAssist?.actionTime ?? 0,
    defensiveAssistDecibelRecovery: defensiveAssist?.decibelRecovery ?? 0,
    defensiveAssistComboAlignRatio: ov(defensiveAssist?.moveId ?? '', defensiveAssist?.comboAlignRatio ?? 0),
    assistFollowUpMoveId: assistFollowUp?.moveId ?? '',
    assistFollowUpActionTime: assistFollowUp?.actionTime ?? 0,
    assistFollowUpDecibelRecovery: assistFollowUp?.decibelRecovery ?? 0,
    assistFollowUpComboAlignRatio: ov(assistFollowUp?.moveId ?? '', assistFollowUp?.comboAlignRatio ?? 0),
    // 反制支援（控制技整组化解）：时间/喧响 = 融合后「一次动作」的整段量（本体 + 琢形）；
    // 次数 = 该槽位承接的控制技组数（store 折算，非用户手填）。
    counterAssistMoveId: counterAssist?.moveId ?? '',
    counterAssistActionTime: counterAssist?.actionTime ?? 0,
    counterAssistDecibelRecovery: counterAssist?.decibelRecovery ?? 0,
    counterAssistComboAlignRatio: ov(counterAssist?.moveId ?? '', counterAssist?.comboAlignRatio ?? 0),
    counterAssistCount,
    backstageRegenBonus: 0,
    comboAlignRegenBonus: 0,
    zhenyuanTriggerCount: 0,
    cannonRotorDamageMultiplier: hasCannonRotorEvent ? 200 : 0,
    cannonRotorCooldownSeconds: hasCannonRotorEvent ? cannonRotorCooldowns[cannonRotorModIndex] : 0,
    initialEnergyGift,
    initialDecibelGift: 1000 + (configStore.appliedBoss?.decibelGift?.slot === slot ? (configStore.appliedBoss?.decibelGift?.amount ?? 0) : 0),
    battleTime: configStore.enemy.battleTime ?? 180,
    invincibleTime: configStore.enemy.invincibleTime ?? 0,
    bodySize: configStore.enemy.bodySize ?? 'large',
    extraSelfDecibelReward: (panel.remielleFlowerFeatherDanceDecibelPerUse ?? 0) * (panel.remielleFlowerFeatherDanceCount ?? 0),
    decibelShareRatio: 0.5,
    supportUltimateEnergyRegen: 0,
    isSupport,
    timeWeight,
    resourceUtilization,
  }

  // 先把机制模块声明的可调设置写入 cfg，模块的 buildCharConfig 随后才能读到。
  const charModule = getAgentMechanic(agent.id)
  for (const setting of charModule?.settings ?? []) {
    const record = cfg as unknown as Record<string, unknown>
    record[`setting:${setting.id}`] = configStore.getMechanicSetting(setting.id, setting.default)
  }

  charModule?.buildCharConfig?.({
    slot,
    agent,
    skills: skills as AgentSkills,
    cinemaLevel: char.cinemaLevel ?? 0,
    potentialLevel: char.potentialLevel ?? 6,
    wEngineId: char.wEngineId ?? '',
    wEngineModLevel: char.wEngineModLevel ?? 1,
    team: buildMechanicTeamMembers(configStore, catalogStore),
    panel,
    cfg,
    getRowValue,
  })

  // 通用「单次释放必打招 + 可持续招」强特（src/data/sustainedEx.ts）：
  // 模块已接管强特（skipGenericExSpecial）时不重复施加。
  const sustainedSpec = SUSTAINED_EX_SPECS[agent.id]
  if (sustainedSpec && !cfg.skipGenericExSpecial) {
    cfg.skipGenericExSpecial = true
    const susMove = findMoveById(skills as AgentSkills, sustainedSpec.sustain.moveId)
    const scale = sustainedDamageScale(sustainedSpec, susMove)
    const secs = sustainedSpec.sustain.maxSeconds
    cfg.exSpecialEnergyConsume = sustainedSpec.fixedEnergy + sustainedSpec.sustain.energyPerSecond * secs
    // 自动攻击/能力场段（countsTime:false）行时长记 0：倍率照发、角色不站场。
    const segSeconds = (t: { moveId: string; countsTime?: boolean }) =>
      t.countsTime === false ? 0 : findMoveById(skills as AgentSkills, t.moveId)?.actionTime ?? 0
    const opener = sustainedSpec.opener.map((t) => ({ moveId: t.moveId, actionTime: segSeconds(t) }))
    const finisher = sustainedSpec.finisher.map((t) => ({ moveId: t.moveId, actionTime: segSeconds(t) }))
    // 动作总时间（供 estimateExSpecialTime 时间预算）：起手 + 持续满蓄 + 收尾
    cfg.exSpecialActionTime = opener.reduce((s, o) => s + o.actionTime, 0) + secs + finisher.reduce((s, f) => s + f.actionTime, 0)
    ;(cfg as unknown as Record<string, unknown>).sustainedEx = {
      opener,
      sustain: {
        moveId: sustainedSpec.sustain.moveId,
        actionTime: secs,
        damageMultiplier: getRowValue(susMove, 'damage') * scale,
        dazeMultiplier: getRowValue(susMove, 'daze') * scale,
        anomalyBuildUp: getRowValue(susMove, 'anomaly_buildup') * scale,
      },
      finisher,
    }
  }

  // 额外强特计划（免费/窗口门控的次要强特，2026-09 用户裁决「引擎别太窄」）：
  // 注册表 src/data/exSpecialPlans.ts；模块已接管强特（skipGenericExSpecial）时不叠加。
  // 预存执行行数据（actionTime/喧响），次数由 core buildExecutions 按窗口与主强特次数发行。
  const extraPlans = EXTRA_EX_PLANS[agent.id]
  if (extraPlans && !cfg.skipGenericExSpecial) {
    cfg.extraExPlans = extraPlans.map((e) => {
      const move = findMoveById(skills as AgentSkills, e.moveId)
      return {
        moveId: e.moveId,
        label: e.label,
        count: e.count,
        energyCost: e.energyCost ?? 0,
        actionTime: move?.actionTime ?? 0,
        decibelRecovery: getRowValue(move, 'decibel_recovery'),
        note: e.note,
      }
    })
  }

  return cfg
}

/** 从倍率表提取招式的 daze 和 anomaly_buildup 数据
 *  返回用于失衡池和积蓄池计算的招式执行记录
 */
export function extractSkillExecutions(
  slot: number,
  agentId: string,
  skills: AgentSkills | undefined,
  resourceResult: TeamResourceResult | null,
  catalogStore: ReturnType<typeof useCatalogStore>,
  panel: PanelValues | null,
  configStore: ReturnType<typeof useConfigStore>,
  opts?: { skipGift?: boolean },
): { stunExecs: StunSkillExecution[]; anomalyExecs: AnomalySkillExecution[] } {
  if (!skills || !resourceResult) return { stunExecs: [], anomalyExecs: [] }

  const charResult = resourceResult.characters.find(c => c.slot === slot)
  if (!charResult) return { stunExecs: [], anomalyExecs: [] }

  // 命座技能等级系数（3命+2级，5命+4级）
  const skillLevelBonus = panel?.skillLevelBonus ?? 0
  const dazeCoef = skillLevelBonus > 0 ? getSkillLevelCoef(skillLevelBonus).dazeCoef : 1

  const agent = catalogStore.getAgent(agentId)
  const fallbackElement = agent?.damageElement
  const charCfg = configStore.team[slot]
  const mechanic = getAgentMechanic(agentId)
  const usesModuleTransform = !!mechanic?.transformSkillExecutions
  const replacesSkillExecutionExtraction = mechanic?.replaceSkillExecutionExtraction === true
  const team = buildMechanicTeamMembers(configStore, catalogStore)
  const anomalyUtilizationRate = configStore.getAnomalyUtilizationRate(slot)

  const stunExecs: StunSkillExecution[] = []
  const anomalyExecs: AnomalySkillExecution[] = []

  // 从 resourceResult.executions 获取执行次数
  // 然后从倍率表查找对应的 move，提取 daze 和 anomaly_buildup
  for (const exec of charResult.executions) {
    if (exec.count <= 0 && exec.totalTime <= 0) continue
    // 赠行自 2026-09-10 起由引擎物化 → 会出现在 rr 里；池侧的赠送口径仍单独结算
    // （adjustStunExecs 加 count+promote、连携经 chainCountTotal），故读「装配前 rr」时跳过赠行。
    if (opts?.skipGift && (exec.source === 'gift' || exec.normaGiftChain)) continue

    // 在倍率表中查找对应的 move
    let foundMove: SkillMove | null = null
    let foundElement: string | undefined
    for (const cat of skills.categories) {
      for (const move of cat.moves) {
        if (move.id === exec.moveId) {
          foundMove = move
          foundElement = exec.element ?? move.damageElement ?? fallbackElement
          break
        }
      }
      if (foundMove) break
    }

    // 平A汇总行（moveId = 'basic_attack'）：用基准段（第3段）秒均数据 × 时间
    if (exec.moveId === 'basic_attack' && exec.totalTime > 0) {
      let dazePerSec = 0
      let anomalyPerSec = 0
      let basicElement: string | undefined = fallbackElement
      if (exec.dazeMultiplierOverride || exec.damageMultiplierOverride) {
        // 机制模块已覆盖秒均倍率（如青衣「一煞#4→醉花月云转」循环），保留自定义值
        dazePerSec = exec.dazeMultiplier ?? 0
        anomalyPerSec = exec.anomalyBuildUp ?? 0
      } else {
        const move = getBasicComboMoves(skills, agentId, catalogStore)
        if (move && move.actionTime && move.actionTime > 0) {
          const at = move.actionTime
          basicElement = move.damageElement ?? fallbackElement
          dazePerSec = getRowValue(move, 'daze') / at
          anomalyPerSec = getRowValue(move, 'anomaly_buildup') / at
        }
      }

      if (dazePerSec > 0) {
        stunExecs.push({
          moveId: 'basic_attack',
          moveName: '普通攻击',
          slot,
          count: 1,
          baseDaze: dazePerSec * exec.totalTime * dazeCoef,
          element: basicElement,
          skillType: 'basic',
        })
      }
      if (anomalyPerSec > 0 && basicElement) {
        anomalyExecs.push({
          moveId: 'basic_attack',
          moveName: '普通攻击',
          slot,
          count: 1,
          baseBuildUp: anomalyPerSec * exec.totalTime * anomalyUtilizationRate,
          element: basicElement,
          dmgBonus: exec.dmgBonus,
        })
      }
      continue
    }

    // 仅显式声明接管的模块负责处理全部非普攻倍率行；面板后处理钩子仍保留通用提取。
    if (replacesSkillExecutionExtraction) continue

    // 其他招式（强特、终结技、连携等）
    if (foundMove) {
      const count = exec.count
      // 模块可用 dazeMultiplierOverride 覆盖失衡倍率（如诺姆影画6 破甲弹头失衡值+30%），与 damageMultiplierOverride 同机制
      const tableDaze = fusedRowValue(skills, exec.moveId, 'daze') ?? getRowValue(foundMove, 'daze')
      const daze = exec.dazeMultiplierOverride && (exec.dazeMultiplier ?? 0) > 0
        ? exec.dazeMultiplier!
        : tableDaze
      // 假 id/合成执行支持执行级异常积蓄覆盖（如仪玄符法千重-破 226.7，倍率行被隐藏）
      const anomaly = exec.anomalyBuildUp ?? (fusedRowValue(skills, exec.moveId, 'anomaly_buildup') ?? getRowValue(foundMove, 'anomaly_buildup'))
      const moveName = exec.moveName.replace(/（.*）/g, '').trim()
      const radiantTurnDazeMult = foundMove.id === '1581010'
        ? 1 + ((panel?.remielleRadiantTurnDazeBonusPct ?? 0) / 100)
        : 1

      if (daze > 0 && count > 0) {
        stunExecs.push({
          moveId: exec.moveId,
          moveName,
          slot,
          count,
          baseDaze: daze * dazeCoef * radiantTurnDazeMult,
          element: foundElement,
          skillType: normalizeResourceSkillType(foundMove, exec.moveId),
          stunBuildUpBonus: exec.stunBuildUpBonus,
        })
      }
      if (anomaly > 0 && count > 0 && foundElement) {
        anomalyExecs.push({
          moveId: exec.moveId,
          moveName,
          slot,
          count,
          baseBuildUp: anomaly * anomalyUtilizationRate,
          element: foundElement,
          skillType: normalizeResourceSkillType(foundMove, exec.moveId),
          dmgBonus: exec.dmgBonus,
        })
      }
    }
  }

  if (usesModuleTransform) {
    mechanic!.transformSkillExecutions!({
      slot,
      agent: agent ?? null,
      skills,
      charResult,
      panel,
      cinemaLevel: charCfg?.cinemaLevel ?? 0,
      potentialLevel: charCfg?.potentialLevel ?? 6,
      team,
      dazeCoef,
      stunExecs,
      anomalyExecs,
      getRowValue,
      normalizeResourceSkillType,
    })
  }

  return { stunExecs, anomalyExecs }
}

