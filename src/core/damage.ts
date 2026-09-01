/**
 * 伤害计算引擎 - 直伤 + 失衡区 + 异常积蓄 + 异常伤害/紊乱
 * 完整乘区公式
 */
import type {
  Agent, WEngine, DriveDiscSet, PanelValues,
  DamageResult, DamageBreakdownItem, SkillDamageResult,
  SkillMove, SkillCategory, AgentSkills, DamageElement,
  CalculatorConfig, SkillDamageTarget,
} from '@/types/catalog'
import { calcPanel } from './panel'
import { calcStunMultiplier } from './anomalyPool/helpers'
import { getSkillDmgBonus, getStunBuildUpBonus, getTargetedStat, getTargetedStatExtra, normalizeSkillDamageTarget } from './buff'
import { fmt } from '@/utils/format'
import { enemyDebuffElementStatId } from '@/utils/enemyDebuffStats'
import { getSkillLevelCoef } from './skillLevel'

/** 获取元素伤害加成 */
function getElementDmgBonus(panel: PanelValues, element: DamageElement | undefined, targetSkillType?: string): number {
  if (!element) return 0
  const map: Record<string, string> = {
    physical: 'physicalDmg',
    fire: 'fireDmg',
    ice: 'iceDmg',
    electric: 'electricDmg',
    ether: 'etherDmg',
    wind: 'windDmg',
    lumiflux: 'lumifluxDmg',
  }
  const stat = map[element]
  return stat ? getTargetedStat(panel, stat, targetSkillType) : 0
}

function getElementEnemyResReduction(panel: PanelValues, element: DamageElement | undefined, targetSkillType?: string): number {
  const stat = enemyDebuffElementStatId('res', element)
  return stat ? getTargetedStat(panel, stat, targetSkillType) : 0
}

function getElementEnemyDefReduction(panel: PanelValues, element: DamageElement | undefined, targetSkillType?: string): number {
  const stat = enemyDebuffElementStatId('def', element)
  return stat ? getTargetedStat(panel, stat, targetSkillType) : 0
}

function getElementEnemyStunResReduction(panel: PanelValues, element: DamageElement | undefined, targetSkillType?: string): number {
  const stat = enemyDebuffElementStatId('stunRes', element)
  return stat ? getTargetedStat(panel, stat, targetSkillType) : 0
}

function getElementEnemyAnomalyResReduction(panel: PanelValues, element: DamageElement | undefined): number {
  const stat = enemyDebuffElementStatId('anomalyRes', element)
  return stat ? panel[stat] ?? 0 : 0
}



export function inferSkillDamageTarget(category: SkillCategory, move: SkillMove): SkillDamageTarget {
  if (move.timeType === 'dodgeCounter') return 'dodgeCounter'
  if (move.skillTags?.includes('dashAttack')) return 'dashAttack'
  // 「视为追加攻击」的招式（如奥菲丝高压火枪/各强化特殊技/连携/终结技，见各角色核心被动原文）
  if (move.skillTags?.includes('additionalAttack')) return 'additionalAttack'

  const categoryId = (category.id ?? '').toLowerCase()
  const moveName = `${move.name?.en ?? ''} ${move.name?.zhCN ?? ''}`.toLowerCase()

  if (moveName.includes('dash attack') || moveName.includes('冲刺攻击')) return 'dashAttack'
  if (categoryId === 'basic') return 'basic'
  if (categoryId === 'assist') return 'assist'
  if (categoryId === 'dodge' || categoryId === 'dodgecounter' || moveName.includes('dodge counter') || moveName.includes('闪避反击')) return 'dodgeCounter'
  if (categoryId === 'special') {
    if (moveName.includes('ex special') || move.energyCost && Object.keys(move.energyCost).length > 0) return 'exSpecial'
    return 'special'
  }
  if (categoryId === 'chain') {
    if (moveName.includes('ultimate') || moveName.includes('终结')) return 'ultimate'
    return 'chain'
  }

  return normalizeSkillDamageTarget(move.skillType ?? category.id)
}

/** 防御乘区
 *
 * 公式（来源：啵啵獭第八期穿透防御学）：
 *   有效防御 = max(0, 怪物防御 × (1 - 穿透率/100) × (1 - 减防/100 - 无视防御/100) - 穿透值)
 *   防御区 = 794 / (有效防御 + 794)
 *
 * 说明：
 * - 794 是60级等级基数（固定常量，不再用 level×10+690）
 * - 减防(enemyDefReduction)和无视防御在游戏代码里是同一字段，加算
 * - 穿透值(penFlat)包含角色自身穿透值 + 敌方固定防御降低(enemyDefFlatReduction)
 *   （enemyDefFlatReduction 本质就是穿透值，游戏里只有穿透值能固定扣除防御）
 * - penFlatEffective = penFlat + enemyDefFlatReduction
 */
const LEVEL_COEFF_60 = 794

function calcDefenseMultiplier(
  enemyDefense: number,
  enemyDefReduction: number,
  enemyDefFlatReduction: number,
  penRatio: number,
  penFlat: number,
): { multiplier: number; effectiveDef: number } {
  // 穿透值 = 角色穿透值 + 敌方固定防御降低（两者本质相同）
  const totalPenFlat = penFlat + enemyDefFlatReduction
  // 有效防御 = 怪物防御 × (1 - 穿透率/100) × (1 - 减防/100) - 穿透值
  const effectiveDef = Math.max(0, enemyDefense * (1 - penRatio / 100) * (1 - enemyDefReduction / 100) - totalPenFlat)
  const multiplier = LEVEL_COEFF_60 / (LEVEL_COEFF_60 + effectiveDef)
  return { multiplier, effectiveDef }
}

/** 抗性乘区 */
function calcResistanceMultiplier(
  baseResistance: number,
  resReduction: number,
  resIgnore: number,
): { multiplier: number; effectiveRes: number } {
  // 抗性区不设上限：抗性降低/无视抗性会线性提高该乘区；后续如出现 Boss 抗性增强字段，再加回 effectiveRes。
  const effectiveRes = baseResistance - resReduction - resIgnore
  const multiplier = 1 - effectiveRes / 100
  return { multiplier, effectiveRes }
}

/** 暴击乘区 */
function calcCritMultiplier(panel: PanelValues, mode: 'expect' | 'crit' | 'nonCrit', targetSkillType?: SkillDamageTarget): { multiplier: number; label: string } {
  const enemyCritBonus = panel.enemyCritDmgTakenBonus ?? 0
  const critDmg = getTargetedStat(panel, 'critDmg', targetSkillType) + enemyCritBonus
  const critRateRaw = getTargetedStat(panel, 'critRate', targetSkillType)
  switch (mode) {
    case 'crit':
      return { multiplier: 1 + critDmg / 100, label: `暴击 (暴伤${fmt(critDmg)}%)` }
    case 'nonCrit':
      return { multiplier: 1, label: '不暴击' }
    case 'expect':
    default: {
      const critRate = Math.min(100, Math.max(0, critRateRaw)) / 100
      const mult = 1 + critRate * (critDmg / 100)
      return { multiplier: mult, label: `期望 (暴击率${fmt(critRateRaw)}% × 暴伤${fmt(critDmg)}%)` }
    }
  }
}

function calcSharpCritMultiplier(panel: PanelValues, mode: 'expect' | 'crit' | 'nonCrit', targetSkillType?: SkillDamageTarget): { multiplier: number; label: string } {
  const sharpCritDmg = getTargetedStat(panel, 'sharpCritDmg', targetSkillType) + (panel.enemyCritDmgTakenBonus ?? 0)
  const critRateRaw = getTargetedStat(panel, 'critRate', targetSkillType)
  const baseCritRate = Math.min(100, critRateRaw) / 100
  const overflowRate = Math.min(100, Math.max(0, critRateRaw - 100)) / 100

  switch (mode) {
    case 'crit': {
      const mult = 1 + sharpCritDmg / 100 + overflowRate * (sharpCritDmg / 100)
      return { multiplier: mult, label: `锐暴 (锐暴伤害${fmt(sharpCritDmg)}%${overflowRate > 0 ? ` + 溢出锐爆${fmt(overflowRate * 100)}%` : ''})` }
    }
    case 'nonCrit':
      return { multiplier: 1, label: '不暴击' }
    case 'expect':
    default: {
      const mult = 1 + baseCritRate * (sharpCritDmg / 100) + overflowRate * (sharpCritDmg / 100)
      return { multiplier: mult, label: `期望 (暴击率${fmt(Math.min(100, critRateRaw))}% × 锐暴${fmt(sharpCritDmg)}%${overflowRate > 0 ? ` + 溢出锐爆${fmt(overflowRate * 100)}% × 锐暴${fmt(sharpCritDmg)}%` : ''})` }
    }
  }
}

function getAnomalyCritStats(panel: PanelValues, element: DamageElement | undefined): { rate: number; dmg: number; labelPrefix: string } {
  const isAssault = element === 'physical'
  return {
    rate: (panel.anomalyCritRate ?? 0) + (isAssault ? panel.assaultCritRate ?? 0 : 0),
    dmg: (panel.anomalyCritDmg ?? 0) + (isAssault ? panel.assaultCritDmg ?? 0 : 0),
    labelPrefix: isAssault && ((panel.assaultCritRate ?? 0) !== 0 || (panel.assaultCritDmg ?? 0) !== 0) ? '强击/异常暴击' : '异常暴击',
  }
}

function calcPenetrationPower(panel: PanelValues): number {
  return panel.atk * 0.3 + panel.hp * 0.1 + (panel.sheerForceFlat ?? 0)
}

function getElementSheerDmgBonus(panel: PanelValues, element: DamageElement | undefined, targetSkillType?: string): number {
  if (!element) return 0
  return getTargetedStat(panel, `${element}SheerDmg`, targetSkillType)
}

function getElementSharpDmgBonus(panel: PanelValues, element: DamageElement | undefined, targetSkillType?: string): number {
  if (!element) return 0
  return getTargetedStat(panel, `${element}SharpDmg`, targetSkillType)
}

export type SpecialDamageProfileKind = 'normal' | 'rupture' | 'edgeguard'

/** 特殊职业直伤接口：用于把命破、锐化等职业接入同一条直伤公式链路 */
export interface SpecialDamageProfile {
  /** 公式类型 */
  kind: SpecialDamageProfileKind
  /** 结果页展示名称 */
  label: string
  /** 基底乘区名称 */
  basisLabel: string
  /** 基底公式说明 */
  basisFormula: (panel: PanelValues) => string
  /** 基底值计算 */
  calcBasisValue: (panel: PanelValues) => number
  /** 是否无视防御区 */
  ignoresDefense?: boolean
  /** 是否启用命破贯穿增伤乘区 */
  usesPenDmgBonus?: boolean
  /** 是否启用锋御锐化增伤乘区 */
  usesSharpDmgBonus?: boolean
  /** 暴击模型 */
  critModel: 'normal' | 'sharp'
}

const NORMAL_DAMAGE_PROFILE: SpecialDamageProfile = {
  kind: 'normal',
  label: '普通伤害',
  basisLabel: '攻击力区',
  basisFormula: () => 'atk',
  calcBasisValue: panel => panel.atk,
  critModel: 'normal',
}

const RUPTURE_DAMAGE_PROFILE: SpecialDamageProfile = {
  kind: 'rupture',
  label: '命破伤害',
  basisLabel: '贯穿力区',
  basisFormula: panel => `atk × 0.3 + hp × 0.1 + 贯穿力提升 = ${fmt(panel.atk)} × 0.3 + ${fmt(panel.hp)} × 0.1 + ${fmt(panel.sheerForceFlat ?? 0)}`,
  calcBasisValue: panel => calcPenetrationPower(panel),
  ignoresDefense: true,
  usesPenDmgBonus: true,
  critModel: 'normal',
}

const SHARPEN_DAMAGE_PROFILE: SpecialDamageProfile = {
  kind: 'edgeguard',
  label: '锋御伤害',
  basisLabel: '防御力区',
  basisFormula: () => 'def',
  calcBasisValue: panel => panel.def,
  usesSharpDmgBonus: true,
  critModel: 'sharp',
}

export function resolveSpecialDamageProfile(agent: Agent): SpecialDamageProfile {
  if (agent.specialty === 'rupture') return RUPTURE_DAMAGE_PROFILE
  if (['edgeguard', 'sharpen', '锋御'].includes(agent.specialty as string)) return SHARPEN_DAMAGE_PROFILE
  return NORMAL_DAMAGE_PROFILE
}

function pickRemielleLevelValue(row: any, skillLevelBonus: number): number {
  const values = row?.values ?? []
  if (!values.length) return 0
  const skillLevel = getSkillLevelCoef(skillLevelBonus).skillLevel
  const levelValues = row?.levelValues ?? row?.luminizeLevelValues
  if (Array.isArray(levelValues)) {
    const idx = levelValues.indexOf(skillLevel)
    if (idx >= 0) return values[idx] ?? values[0] ?? 0
  }
  if (values.length === 3) {
    return values[skillLevel >= 16 ? 2 : skillLevel >= 14 ? 1 : 0] ?? values[0] ?? 0
  }
  return values[0] ?? 0
}

/** 计算单次直伤 */
export interface DirectDamageInput {
  panel: PanelValues
  skillMultiplier: number
  damageElement: DamageElement | undefined
  damageBasis: 'atk' | 'def' | 'hp' | string
  enemyDefense: number
  enemyDefReduction: number
  enemyDefFlatReduction: number
  enemyLevel: number
  enemyResistance: number
  enemyResReduction: number
  stunMultiplier: number
  stunned: boolean | number
  critMode: 'expect' | 'crit' | 'nonCrit'
  count: number
  /** 旧接口：命破/裂御角色使用贯穿力，且不走防御区 */
  isRupture?: boolean
  /** 特殊职业伤害接口；优先级高于 isRupture */
  specialDamageProfile?: SpecialDamageProfile
  /** 当前直伤对应的招式类型，用于匹配招式类型增伤 */
  skillDamageTarget?: SkillDamageTarget
  /** 本行招式专属暴击率加成（如柏妮思4命），只加给该行 */
  critRateBonus?: number
  /** 本行招式专属暴击伤害加成（如青衣6命醉花月云转暴伤+100%），只加给该行 */
  critDmgBonus?: number
  /** 本行招式专属增伤（%），加进增伤区（如伊德海莉满蓄碎惘沉击 +30%） */
  dmgBonus?: number
  /** 本行招式专属贯穿增伤（%），加进贯穿增伤乘区（如星徽·比利影画6 骑士飞踢/最高马力星光 +18%） */
  sheerDmgBonus?: number
  /** 本行固定附加伤害（基础区：技能倍率后、各乘区前直接相加；如卢西娅[合唱]按最大生命值百分比附加） */
  flatDamageBonus?: number
  /** 风化染色属性：该元素与风属性直伤一起吃侵染区独立乘区 */
  infectionElement?: string
  /** 覆盖基底区数值（如专属直伤读队友攻击/贯穿力作为基底，其余乘区仍用本面板） */
  basisValueOverride?: number
  /** 覆盖基底区展示标签 */
  basisLabelOverride?: string
}

// @fact engine:damage/乘区顺序 口径: 乘区顺序=代码顺序（基底→技能倍率→固定附加→增伤→锐化→贯穿→防御→抗性→易伤→失衡→侵染→暴击/锐暴→次数），调换 breakdown.push 顺序即改口径 | 据 实测@2026-08-31 | 验 src/core/__tests__/damage.test.ts | 锚 src/core/damage.ts#calcDirectDamage | 信 确认
export function calcDirectDamage(input: DirectDamageInput): { damage: number; breakdown: DamageBreakdownItem[] } {
  const p = input.panel
  const breakdown: DamageBreakdownItem[] = []

  // 1. 攻击力/贯穿力/防御力区
  const profile = input.specialDamageProfile ?? (input.isRupture ? RUPTURE_DAMAGE_PROFILE : NORMAL_DAMAGE_PROFILE)
  const isRupture = profile.kind === 'rupture'
  const basisValue = input.basisValueOverride ?? profile.calcBasisValue(p)
  breakdown.push({
    label: input.basisLabelOverride ?? profile.basisLabel,
    formula: input.basisValueOverride != null
      ? (input.basisLabelOverride ?? '基底区') + '（覆盖）'
      : profile.basisFormula(p),
    value: basisValue, displayValue: fmt(basisValue),
  })

  // 2. 技能倍率区
  const skillMult = input.skillMultiplier / 100
  const basisDamage = basisValue * skillMult
  breakdown.push({
    label: '技能倍率区', formula: `${fmt(input.skillMultiplier)}%`,
    value: basisDamage, displayValue: fmt(basisDamage),
  })

  // 2.5 固定附加伤害（基础区）：技能倍率后、各乘区前直接相加（如卢西娅[合唱]按最大生命值百分比附加）
  const flatBonus = input.flatDamageBonus ?? 0
  const baseDamage = basisDamage + flatBonus
  if (flatBonus !== 0) {
    breakdown.push({
      label: '固定附加伤害', formula: fmt(flatBonus),
      value: flatBonus, displayValue: fmt(flatBonus),
    })
  }

  // 3. 增伤乘区：通用增伤 + 对应元素增伤 + 对应招式增伤
  const elementDmg = getElementDmgBonus(p, input.damageElement, input.skillDamageTarget)
  const dmgBonus = getTargetedStat(p, 'dmgBonus', input.skillDamageTarget)
  const skillDmgBonus = getSkillDmgBonus(p, input.skillDamageTarget)
  const totalDmgBonus = elementDmg + dmgBonus + skillDmgBonus + (input.dmgBonus ?? 0)
  const dmgBonusMult = 1 + totalDmgBonus / 100
  const afterDmgBonus = baseDamage * dmgBonusMult
  breakdown.push({
    label: '增伤乘区',
    formula: `1 + 通用${fmt(dmgBonus)}% + 元素${fmt(elementDmg)}% + 招式${fmt(skillDmgBonus)}%`,
    value: afterDmgBonus, displayValue: fmt(afterDmgBonus),
  })

  // 3.5 锐化增伤乘区：锋御角色额外独立乘区
  const sharpDmgBonus = profile.usesSharpDmgBonus
    ? getTargetedStat(p, 'sharpDmgBonus', input.skillDamageTarget) + getElementSharpDmgBonus(p, input.damageElement, input.skillDamageTarget)
    : 0
  const sharpDmgMult = 1 + sharpDmgBonus / 100
  const afterSharpDmg = afterDmgBonus * sharpDmgMult
  if (sharpDmgBonus !== 0) {
    breakdown.push({
      label: '锐化增伤乘区',
      formula: `1 + ${fmt(sharpDmgBonus)}%`,
      value: afterSharpDmg, displayValue: fmt(afterSharpDmg),
    })
  }

  // 4. 贯穿增伤乘区：命破角色额外乘区（本行招式专属贯穿增伤 input.sheerDmgBonus 叠加，如星徽·比利影画6）
  const penDmgBonus = profile.usesPenDmgBonus
    ? getTargetedStat(p, 'penDmgBonus', input.skillDamageTarget) + getTargetedStat(p, 'sheerDmgBonus', input.skillDamageTarget) + getElementSheerDmgBonus(p, input.damageElement, input.skillDamageTarget) + (input.sheerDmgBonus ?? 0)
    : (input.sheerDmgBonus ?? 0)
  const penDmgMult = 1 + penDmgBonus / 100
  const afterPenDmg = (sharpDmgBonus !== 0 ? afterSharpDmg : afterDmgBonus) * penDmgMult
  if (isRupture || penDmgBonus !== 0) {
    breakdown.push({
      label: '贯穿增伤乘区',
      formula: `1 + ${fmt(penDmgBonus)}%`,
      value: afterPenDmg, displayValue: fmt(afterPenDmg),
    })
  }

  // 5. 防御乘区：部分特殊职业无视防御，固定为1
  let afterDef = afterPenDmg
  if (profile.ignoresDefense) {
    breakdown.push({
      label: '防御乘区',
      formula: `${profile.label}无视防御 → 1`,
      value: afterDef, displayValue: fmt(afterDef),
    })
  } else {
    const defResult = calcDefenseMultiplier(
      input.enemyDefense, input.enemyDefReduction + getTargetedStatExtra(p, 'enemyDefReduction', input.skillDamageTarget) + getElementEnemyDefReduction(p, input.damageElement, input.skillDamageTarget), input.enemyDefFlatReduction,
      p.penRatio, p.penFlat
    )
    afterDef = afterPenDmg * defResult.multiplier
    breakdown.push({
      label: '防御乘区',
      formula: `有效防御 ${fmt(defResult.effectiveDef)} → ${fmt(defResult.multiplier, 4)}`,
      value: afterDef, displayValue: fmt(afterDef),
    })
  }

  // 6. 抗性乘区
  const resReduction = input.enemyResReduction + getTargetedStatExtra(p, 'enemyResReduction', input.skillDamageTarget) + getElementEnemyResReduction(p, input.damageElement, input.skillDamageTarget)
  const resResult = calcResistanceMultiplier(input.enemyResistance, resReduction, 0)
  const afterRes = afterDef * resResult.multiplier
  breakdown.push({
    label: '抗性乘区',
    formula: `1 - ${fmt(resResult.effectiveRes)}% = ${fmt(resResult.multiplier, 4)}`,
    value: afterRes, displayValue: fmt(afterRes),
  })

  // 6. 易伤乘区
  const dmgTaken = p.enemyDamageTakenBonus ?? 0
  const dmgTakenMult = 1 + dmgTaken / 100
  const afterDmgTaken = afterRes * dmgTakenMult
  breakdown.push({
    label: '易伤乘区',
    formula: `1 + ${fmt(dmgTaken)}%`,
    value: afterDmgTaken, displayValue: fmt(afterDmgTaken),
  })

  // 7. 失衡乘区
  const stunMult = calcStunMultiplier(
    input.stunMultiplier,
    p.stunDmgMultiplierBonus,
    p.stunDmgMultiplierBonusAlways,
    p.stunDmgMultiplierBonusCapAlways,
    input.stunned,
  )
  const afterStun = afterDmgTaken * stunMult
  breakdown.push({
    label: '失衡乘区',
    formula: input.stunned ? fmt(stunMult) : '1 (未失衡)',
    value: afterStun, displayValue: fmt(afterStun),
  })

  // 8. 侵染乘区（独立乘区）：仅风属性与其染色属性直伤生效
  const infectionBonus = p.infectionZoneBonus ?? 0
  const infectionActive = infectionBonus > 0 && input.damageElement != null
    && (input.damageElement === 'wind' || input.damageElement === input.infectionElement)
  const afterInfection = afterStun * (infectionActive ? 1 + infectionBonus / 100 : 1)
  if (infectionActive) {
    breakdown.push({
      label: '侵染乘区',
      formula: `1 + ${fmt(infectionBonus)}%（风/染色直伤）`,
      value: afterInfection, displayValue: fmt(afterInfection),
    })
  }

  // 9. 暴击/锐暴乘区
  const critPanel = (input.critRateBonus || input.critDmgBonus)
    ? { ...p, critRate: (p.critRate ?? 0) + (input.critRateBonus ?? 0), critDmg: (p.critDmg ?? 0) + (input.critDmgBonus ?? 0) }
    : p
  const critResult = profile.critModel === 'sharp'
    ? calcSharpCritMultiplier(critPanel, input.critMode, input.skillDamageTarget)
    : calcCritMultiplier(critPanel, input.critMode, input.skillDamageTarget)
  const afterCrit = afterInfection * critResult.multiplier
  breakdown.push({
    label: profile.critModel === 'sharp' ? '锐暴乘区' : '暴击乘区', formula: critResult.label,
    value: afterCrit, displayValue: fmt(afterCrit),
  })

  // 10. 次数
  const finalDamage = afterCrit * input.count
  breakdown.push({
    label: '次数', formula: `× ${input.count}`,
    value: finalDamage, displayValue: fmt(finalDamage),
  })

  return { damage: finalDamage, breakdown }
}

function getElementAnomalyBuildUpEfficiency(panel: PanelValues, element: DamageElement | undefined): number {
  if (element === 'electric') return panel.electricAnomalyBuildUpEfficiency ?? 0
  if (element === 'physical') return panel.physicalAnomalyBuildUpEfficiency ?? 0
  if (element === 'ether') return panel.etherAnomalyBuildUpEfficiency ?? 0
  return 0
}

/** 计算异常积蓄值 */
export interface AnomalyBuildUpInput {
  panel: PanelValues
  buildUpValue: number
  element: DamageElement | undefined
  /** 敌方异常积蓄抗性（百分比，如 10 表示 10%） */
  enemyAnomalyResistance?: number
}

export function calcAnomalyBuildUp(
  input: AnomalyBuildUpInput
): { value: number; breakdown: DamageBreakdownItem[] } {
  const { panel: p, buildUpValue, enemyAnomalyResistance = 0 } = input
  const breakdown: DamageBreakdownItem[] = []

  // 1. 基础积蓄值
  breakdown.push({
    label: '基础积蓄', formula: fmt(buildUpValue),
    value: buildUpValue, displayValue: fmt(buildUpValue),
  })

  // 2. 异常掌控区（floor(anomalyMastery) / 100，无上限）
  const mastery = Math.floor(p.anomalyMastery ?? 0)
  const masteryMult = mastery / 100
  const afterMastery = buildUpValue * masteryMult
  breakdown.push({
    label: '异常掌控', formula: `${mastery} / 100 = ${fmt(masteryMult, 4)}`,
    value: afterMastery, displayValue: fmt(afterMastery),
  })

  // 3. 异常积蓄效率区
  const buildUpEff = (p.anomalyBuildUpEfficiency ?? 0) + getElementAnomalyBuildUpEfficiency(p, input.element)
  const effMult = 1 + buildUpEff / 100
  const afterEff = afterMastery * effMult
  if (buildUpEff !== 0) {
    breakdown.push({
      label: '积蓄效率', formula: `1 + ${fmt(buildUpEff)}%`,
      value: afterEff, displayValue: fmt(afterEff),
    })
  }

  // 4. 异常积蓄抗性区
  const anomalyResRed = (p.enemyAnomalyResReduction ?? 0) + getElementEnemyAnomalyResReduction(p, input.element)
  const effectiveRes = enemyAnomalyResistance - anomalyResRed
  const resMult = 1 - effectiveRes / 100
  const afterRes = afterEff * resMult
  if (enemyAnomalyResistance !== 0 || anomalyResRed !== 0) {
    breakdown.push({
      label: '积蓄抗性', formula: `1 - ${fmt(effectiveRes)}% = ${fmt(resMult, 4)}`,
      value: afterRes, displayValue: fmt(afterRes),
    })
  }

  return { value: afterRes, breakdown }
}

/** 计算失衡积蓄值 */
export interface StunBuildUpInput {
  panel: PanelValues
  buildUpValue: number
  /** 敌方失衡抗性（百分比，如 10 表示 10%） */
  enemyStunResistance?: number
  /** 招式元素，用于读取元素专属失衡减抗 */
  element?: DamageElement
  /** 招式类型，用于读取普攻/强特等定向失衡加成 */
  skillDamageTarget?: string
}

export function calcStunBuildUp(
  input: StunBuildUpInput
): { value: number; breakdown: DamageBreakdownItem[] } {
  const { panel: p, buildUpValue, enemyStunResistance = 0 } = input
  const breakdown: DamageBreakdownItem[] = []

  // 1. 基础失衡值
  breakdown.push({
    label: '基础失衡', formula: fmt(buildUpValue),
    value: buildUpValue, displayValue: fmt(buildUpValue),
  })

  // 2. 冲击力加成
  const impact = p.impact ?? 0
  const impactMult = impact / 100
  const afterImpact = buildUpValue * impactMult
  breakdown.push({
    label: '冲击力', formula: `${fmt(impact)} / 100 = ${fmt(impactMult, 4)}`,
    value: afterImpact, displayValue: fmt(afterImpact),
  })

  // 3. 失衡值提升区
  const stunBuildUpBonus = getStunBuildUpBonus(p, input.skillDamageTarget)
  const buildUpMult = 1 + stunBuildUpBonus / 100
  const afterBuildUp = afterImpact * buildUpMult
  if (stunBuildUpBonus !== 0) {
    breakdown.push({
      label: '失衡值提升', formula: `1 + ${fmt(stunBuildUpBonus)}%`,
      value: afterBuildUp, displayValue: fmt(afterBuildUp),
    })
  }

  // 4. 敌方受到失衡值提升区
  const enemyStunTaken = p.enemyStunTakenBonus ?? 0
  const takenMult = 1 + enemyStunTaken / 100
  const afterTaken = afterBuildUp * takenMult
  if (enemyStunTaken !== 0) {
    breakdown.push({
      label: '受到失衡提升', formula: `1 + ${fmt(enemyStunTaken)}%`,
      value: afterTaken, displayValue: fmt(afterTaken),
    })
  }

  // 5. 失衡抗性区
  const stunResRed = getTargetedStat(p, 'enemyStunResReduction', input.skillDamageTarget) + getElementEnemyStunResReduction(p, input.element, input.skillDamageTarget)
  const effectiveRes = enemyStunResistance - stunResRed
  const resMult = 1 - effectiveRes / 100
  const afterRes = afterTaken * resMult
  if (enemyStunResistance !== 0 || stunResRed !== 0) {
    breakdown.push({
      label: '失衡抗性', formula: `1 - ${fmt(effectiveRes)}% = ${fmt(resMult, 4)}`,
      value: afterRes, displayValue: fmt(afterRes),
    })
  }

  return { value: afterRes, breakdown }
}

/** 计算异常爆发伤害（异放） */
export interface AnomalyDamageInput {
  panel: PanelValues
  /** 结算面板：基础区使用 panel，结算区默认同面板；传入后按结算者面板读取异常增伤/暴击/减防/减抗/易伤/失衡 */
  settlementPanel?: PanelValues
  baseMultiplier: number
  element: DamageElement
  enemyDefense: number
  enemyDefReduction: number
  enemyDefFlatReduction: number
  enemyLevel: number
  enemyResistance: number
  enemyResReduction: number
  /** 敌人是否处于失衡状态 */
  stunned?: boolean | number
  /** 基础失衡易伤倍率 */
  stunMultiplier?: number
  /** 暴击模式 */
  critMode?: 'expect' | 'crit' | 'nonCrit'
  /** 紊乱结算：使用紊乱增伤替代异常增伤；异放额外读取异放专用区 */
  damageKind?: 'anomaly' | 'disorder' | 'release'
  /** 额外全局异常乘区，例如蕾米异化系数 */
  anomalyMultiplier?: number
  /** 异放/异常暴击覆盖（release 等事件专属暴击；传入后替代 getAnomalyCritStats） */
  anomalyCritOverride?: { rate: number; dmg: number; labelPrefix: string }
}

export function calcAnomalyDamage(
  input: AnomalyDamageInput
): { damage: number; breakdown: DamageBreakdownItem[] } {
  const { panel: p, element, stunned = false, stunMultiplier = 1, critMode = 'expect', damageKind = 'anomaly' } = input
  const settle = input.settlementPanel ?? p
  const isDisorder = damageKind === 'disorder'
  const isRelease = damageKind === 'release'
  const breakdown: DamageBreakdownItem[] = []

  // 1. 基础伤害 = 攻击 × 倍率（NGA 2.0 公式：异常伤害基础 = atk × multiplier%）
  const baseDmg = p.atk * (input.baseMultiplier / 100)
  breakdown.push({
    label: '基础伤害', formula: `atk × ${fmt(input.baseMultiplier)}%`,
    value: baseDmg, displayValue: fmt(baseDmg),
  })

  // 2. 增伤区（通用 + 元素伤害）
  const elementDmg = getElementDmgBonus(p, element)
  const dmgBonus = p.dmgBonus ?? 0
  const totalDmgBonus = elementDmg + dmgBonus
  const afterDmgBonus = baseDmg * (1 + totalDmgBonus / 100)
  breakdown.push({
    label: '增伤乘区', formula: `1 + ${fmt(totalDmgBonus)}%`,
    value: afterDmgBonus, displayValue: fmt(afterDmgBonus),
  })

  // 3. 异常精通区（无上限）
  const anomalyProf = p.anomalyProficiency ?? 0
  const profMult = anomalyProf / 100
  const afterProf = afterDmgBonus * profMult
  breakdown.push({
    label: '异常精通', formula: `${fmt(anomalyProf)} / 100 = ${fmt(profMult, 4)}`,
    value: afterProf, displayValue: fmt(afterProf),
  })

  // 4. 防御乘区
  const defResult = calcDefenseMultiplier(
    input.enemyDefense,
    input.enemyDefReduction
      + (settle.enemyAnomalyDefReduction ?? 0)
      + getElementEnemyDefReduction(settle, element)
      + (element === 'physical' ? (settle.enemyAssaultDefReduction ?? 0) : 0),
    input.enemyDefFlatReduction + (settle.enemyDefFlatReduction ?? 0),
    p.penRatio,
    p.penFlat
  )
  const afterDef = afterProf * defResult.multiplier
  breakdown.push({
    label: '防御乘区',
    formula: `${fmt(defResult.multiplier, 4)}`,
    value: afterDef, displayValue: fmt(afterDef),
  })

  // 5. 抗性乘区：异常伤害使用对应元素的伤害抗性表
  const resReduction = input.enemyResReduction
    + (settle.enemyResReduction ?? 0)
    + getElementEnemyResReduction(settle, element)
  const resResult = calcResistanceMultiplier(input.enemyResistance, resReduction, 0)
  const afterRes = afterDef * resResult.multiplier
  breakdown.push({
    label: '抗性乘区 (异放×0.5)',
    formula: `${fmt(resResult.multiplier, 4)}`,
    value: afterRes, displayValue: fmt(afterRes),
  })

  // 6. 易伤乘区
  const dmgTaken = settle.enemyDamageTakenBonus ?? 0
  const dmgTakenMult = 1 + dmgTaken / 100
  const afterDmgTaken = afterRes * dmgTakenMult
  if (dmgTaken !== 0) {
    breakdown.push({
      label: '易伤乘区', formula: `1 + ${fmt(dmgTaken)}%`,
      value: afterDmgTaken, displayValue: fmt(afterDmgTaken),
    })
  }

  // 7. 失衡易伤区
  const stunMult = calcStunMultiplier(
    stunMultiplier,
    settle.stunDmgMultiplierBonus,
    settle.stunDmgMultiplierBonusAlways,
    settle.stunDmgMultiplierBonusCapAlways,
    stunned,
  )
  const afterStun = afterDmgTaken * stunMult
  if (stunned) {
    breakdown.push({
      label: '失衡乘区', formula: fmt(stunMult),
      value: afterStun, displayValue: fmt(afterStun),
    })
  }

  // 8. 伤害等级区 = 1 + 1/59 × (level - 1)，60级为2
  const attackerLevel = 60
  const levelMult = 1 + (1 / 59) * (attackerLevel - 1)
  const afterLevel = afterStun * levelMult
  breakdown.push({
    label: '等级系数', formula: `${attackerLevel}级 → ${fmt(levelMult, 4)}`,
    value: afterLevel, displayValue: fmt(afterLevel),
  })

  // 9. 异常/紊乱增伤区：紊乱使用紊乱增伤替代普通异常增伤
  const anomalyDmgBonus = isDisorder ? (settle.disorderDamageBonus ?? 0) : ((settle.anomalyDmgBonus ?? 0) + (element === 'wind' ? settle.windAnomalyDmgBonus ?? 0 : 0))
  const anomalyDmgMult = 1 + anomalyDmgBonus / 100
  const afterAnomalyDmg = afterLevel * anomalyDmgMult
  if (anomalyDmgBonus !== 0) {
    breakdown.push({
      label: isDisorder ? '紊乱增伤' : '异常增伤', formula: `1 + ${fmt(anomalyDmgBonus)}%`,
      value: afterAnomalyDmg, displayValue: fmt(afterAnomalyDmg),
    })
  }

  const releaseBonus = isRelease ? (settle.anomalyReleaseDmgBonus ?? 0) : 0
  const releaseMult = 1 + releaseBonus / 100
  const afterReleaseBonus = afterAnomalyDmg * releaseMult
  if (releaseBonus !== 0) {
    breakdown.push({
      label: '异放增伤', formula: `1 + ${fmt(releaseBonus)}%`,
      value: afterReleaseBonus, displayValue: fmt(afterReleaseBonus),
    })
  }

  // 10. 异常暴击区：紊乱不继承异常暴击；物理强击额外读取强击暴击字段
  const anomalyCritStats = isDisorder
    ? { rate: 0, dmg: 0, labelPrefix: '异常暴击' }
    : (input.anomalyCritOverride ?? getAnomalyCritStats(settle, element))
  const anomalyCritRate = anomalyCritStats.rate
  const anomalyCritDmg = anomalyCritStats.dmg + (settle.enemyCritDmgTakenBonus ?? 0)
  let critMult = 1
  let critLabel = '无异常暴击'
  if (anomalyCritRate > 0 || anomalyCritDmg > 0) {
    switch (critMode) {
      case 'crit':
        critMult = 1 + anomalyCritDmg / 100
        critLabel = `暴击 (暴伤${fmt(anomalyCritDmg)}%)`
        break
      case 'nonCrit':
        critMult = 1
        critLabel = '不暴击'
        break
      case 'expect':
      default: {
        const rate = Math.min(100, Math.max(0, anomalyCritRate)) / 100
        critMult = 1 + rate * (anomalyCritDmg / 100)
        critLabel = `期望 (暴击率${fmt(anomalyCritRate)}% × 暴伤${fmt(anomalyCritDmg)}%)`
        break
      }
    }
  }
  const afterCrit = afterReleaseBonus * critMult
  if (anomalyCritRate > 0 || anomalyCritDmg > 0) {
    breakdown.push({
      label: anomalyCritStats.labelPrefix, formula: critLabel,
      value: afterCrit, displayValue: fmt(afterCrit),
    })
  }

  return { damage: afterCrit * (input.anomalyMultiplier ?? 1), breakdown }
}

/** 计算紊乱伤害 */
export function calcDisorderDamage(
  panel: PanelValues,
  fixedMultiplier: number,
  tickMultiplier: number,
  tickCount: number,
  element: DamageElement,
  input: {
    enemyDefense: number
    enemyDefReduction: number
    enemyDefFlatReduction: number
    enemyLevel: number
    enemyResistance: number
    enemyResReduction: number
    stunned?: boolean | number | number
    stunMultiplier?: number
    critMode?: 'expect' | 'crit' | 'nonCrit'
  },
): { damage: number; breakdown: DamageBreakdownItem[] } {
  const totalMult = fixedMultiplier + tickCount * tickMultiplier
  return calcAnomalyDamage({
    panel,
    baseMultiplier: totalMult,
    element,
    enemyDefense: input.enemyDefense,
    enemyDefReduction: input.enemyDefReduction,
    enemyDefFlatReduction: input.enemyDefFlatReduction,
    enemyLevel: input.enemyLevel,
    enemyResistance: input.enemyResistance,
    enemyResReduction: input.enemyResReduction,
    stunned: input.stunned,
    stunMultiplier: input.stunMultiplier,
    critMode: input.critMode,
    damageKind: 'disorder',
  })
}

/** 主计算函数：计算伤害结果 */
export function calcDamage(
  agent: Agent,
  wEngine: WEngine | undefined,
  driveDiscConfig: any,
  setsMap: Map<string, DriveDiscSet>,
  teammateBuffs: any[],
  statRules: any,
  config: CalculatorConfig,
  agentSkills: AgentSkills | undefined,
): DamageResult {
  // 1. 计算面板
  const panelResult = calcPanel(agent, wEngine, driveDiscConfig, setsMap, teammateBuffs, statRules, {
    cinemaLevel: config.mainCinemaLevel,
    wEngineModLevel: config.mainWEngineModLevel,
  })
  const p = panelResult.inCombat

  // 2. 如果没有技能数据，返回面板
  if (!agentSkills) {
    return {
      totalDamage: 0,
      skillResults: [],
      panelValues: panelResult.outOfCombat,
      inCombatPanelValues: panelResult.inCombat,
      breakdown: [],
    }
  }

  // 3. 计算各技能结果
  const skillResults: SkillDamageResult[] = []
  let totalDamage = 0
  const allBreakdown: DamageBreakdownItem[] = []

  const pushSkillDamageResult = (
    moveId: string,
    moveName: string,
    categoryName: string,
    damage: number,
    breakdown: DamageBreakdownItem[],
  ) => {
    totalDamage += damage
    skillResults.push({
      moveId,
      moveName,
      category: categoryName,
      directDamage: damage,
      stunBuildUp: 0,
      anomalyBuildUp: 0,
      energyRegen: 0,
      breakdown,
    })
  }

  // 默认计算所有类别的第一个技能（展示用）
  for (const category of agentSkills.categories) {
    if (!category.moves?.length) continue
    const move = category.moves[0]
    const dmgRow = move.rows.find(r => r.kind === 'damageMultiplier')
    if (!dmgRow) continue

    // 获取技能等级
    const levelRange = category.levelRange
    const skillLevel = Array.isArray((levelRange as any).levels)
      ? (levelRange as any).default
      : (levelRange as any).default ?? 12

    const values = dmgRow.values
    const levelIdx = Array.isArray((levelRange as any).levels)
      ? ((levelRange as any).levels as string[]).indexOf(String(skillLevel))
      : skillLevel - ((levelRange as any).min ?? 1)
    const skillMultiplier = values[Math.max(0, Math.min(values.length - 1, levelIdx))] ?? 0

    // 命座技能等级系数（3命+2级，5命+4级，线性成长，乘到12级倍率表上）
    const skillLevelBonus = p.skillLevelBonus ?? 0
    const { damageCoef } = getSkillLevelCoef(skillLevelBonus)
    const adjustedSkillMultiplier = skillMultiplier * damageCoef

    const skillDamageTarget = inferSkillDamageTarget(category, move)

    // 计算直伤
    const result = calcDirectDamage({
      panel: p,
      skillMultiplier: adjustedSkillMultiplier,
      damageElement: move.damageElement ?? agent.damageElement,
      damageBasis: (dmgRow as any).damageBasis ?? 'atk',
      enemyDefense: config.enemyDefense,
      enemyDefReduction: p.enemyDefReduction,
      enemyDefFlatReduction: p.enemyDefFlatReduction,
      enemyLevel: config.enemyLevel,
      enemyResistance: config.enemyResistance[move.damageElement ?? agent.damageElement ?? 'physical'] ?? 0,
      enemyResReduction: p.enemyResReduction,
      stunMultiplier: config.stunMultiplier,
      stunned: config.stunned,
      critMode: config.critMode,
      count: 1,
      specialDamageProfile: resolveSpecialDamageProfile(agent),
      skillDamageTarget,
    })

    allBreakdown.push({
      label: `${category.name?.zhCN ?? category.id} · ${move.name?.zhCN ?? move.id}`,
      formula: `倍率 ${fmt(adjustedSkillMultiplier)}%${skillLevelBonus > 0 ? ` (12级${fmt(skillMultiplier)}% × 命座系数${fmt(damageCoef, 4)})` : ''} · ${skillDamageTarget}`, 
      value: result.damage, displayValue: fmt(result.damage),
    })
    pushSkillDamageResult(
      move.id,
      move.name?.zhCN ?? move.id,
      category.name?.zhCN ?? category.id,
      result.damage,
      result.breakdown,
    )

    const luminizeRow = move.rows.find(r => r.kind === 'luminizeMultiplier' || r.id === 'luminize_multiplier')
    if (luminizeRow) {
      const baseLuminizeMultiplier = pickRemielleLevelValue(luminizeRow, skillLevelBonus)
      const passiveMultiplier = 1 + ((p.remielleLuminizeMultiplierBonus ?? 0) / 100)
      const cinema4Multiplier = 1 + ((p.remielleCinema4LuminizeMultiplierBonus ?? 0) / 100)
      const triggerMultiplier = 1 + Math.max(0, p.remielleCinema6LuminizeTriggerMultiplier ?? 0)
      const finalLuminizeMultiplier = baseLuminizeMultiplier * passiveMultiplier * cinema4Multiplier
      const luminizeResult = calcDirectDamage({
        panel: p,
        skillMultiplier: finalLuminizeMultiplier,
        damageElement: 'lumiflux',
        damageBasis: (luminizeRow as any).damageBasis ?? 'atk',
        enemyDefense: config.enemyDefense,
        enemyDefReduction: p.enemyDefReduction,
        enemyDefFlatReduction: p.enemyDefFlatReduction,
        enemyLevel: config.enemyLevel,
        enemyResistance: config.enemyResistance.lumiflux ?? config.enemyResistance[move.damageElement ?? agent.damageElement ?? 'physical'] ?? 0,
        enemyResReduction: p.enemyResReduction,
        stunMultiplier: config.stunMultiplier,
        stunned: config.stunned,
        critMode: config.critMode,
        count: triggerMultiplier,
        specialDamageProfile: resolveSpecialDamageProfile(agent),
        skillDamageTarget,
      })
      const luminizeLabel = `${category.name?.zhCN ?? category.id} · ${move.name?.zhCN ?? move.id} · 耀变`
      allBreakdown.push({
        label: luminizeLabel,
        formula: `基础${fmt(baseLuminizeMultiplier)}% × 被动${fmt(passiveMultiplier * 100)}% × 四命${fmt(cinema4Multiplier * 100)}%${triggerMultiplier > 1 ? ` × 触发${fmt(triggerMultiplier)}次` : ''}`,
        value: luminizeResult.damage,
        displayValue: fmt(luminizeResult.damage),
      })
      pushSkillDamageResult(
        `${move.id}_luminize`,
        `${move.name?.zhCN ?? move.id} · 耀变`,
        category.name?.zhCN ?? category.id,
        luminizeResult.damage,
        luminizeResult.breakdown,
      )
    }
  }

  // 特殊虚耀属于异常事件，不走直伤公式；这里只保留资源池中的事件次数记录。

  return {
    totalDamage,
    skillResults,
    panelValues: panelResult.outOfCombat,
    inCombatPanelValues: panelResult.inCombat,
    breakdown: allBreakdown,
  }
}
