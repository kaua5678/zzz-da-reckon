/**
 * 伤害计算引擎 - 直伤 + 失衡区 + 异常积蓄 + 异常伤害/紊乱
 * 完整乘区公式
 */
import type {
  Agent, PanelValues, DamageBreakdownItem,
  SkillMove, SkillCategory, DamageElement, SkillDamageTarget,
} from '@/types/catalog'
import { calcStunMultiplier, resolveStatElement } from './anomalyPool/helpers'
import { getSkillDmgBonus, getTargetedStat, getTargetedStatExtra, normalizeSkillDamageTarget } from './buff'
import { fmt } from '@/utils/format'
import { enemyDebuffElementStatId } from '@/utils/enemyDebuffStats'

/** 获取元素伤害加成（属性数值口径经 resolveStatElement：frostfire 按冰） */
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
  const stat = map[resolveStatElement(element) ?? '']
  return stat ? getTargetedStat(panel, stat, targetSkillType) : 0
}

function getElementEnemyResReduction(panel: PanelValues, element: DamageElement | undefined, targetSkillType?: string): number {
  const stat = enemyDebuffElementStatId('res', resolveStatElement(element))
  return stat ? getTargetedStat(panel, stat, targetSkillType) : 0
}

function getElementEnemyDefReduction(panel: PanelValues, element: DamageElement | undefined, targetSkillType?: string): number {
  const stat = enemyDebuffElementStatId('def', resolveStatElement(element))
  return stat ? getTargetedStat(panel, stat, targetSkillType) : 0
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

/** 元素暴击伤害加成（属性数值口径经 resolveStatElement：frostfire 按冰读 iceCritDmg）。
 * 消费端=焰心桂冠等音擎的 XCritDmg 团队效果（此前全仓无读取端，纯死数据）。 */
function getElementCritDmgBonus(panel: PanelValues, element: DamageElement | undefined, targetSkillType?: SkillDamageTarget): number {
  if (!element) return 0
  return getTargetedStat(panel, `${resolveStatElement(element)}CritDmg`, targetSkillType)
}

/** 暴击乘区 */
function calcCritMultiplier(panel: PanelValues, mode: 'expect' | 'crit' | 'nonCrit', targetSkillType?: SkillDamageTarget, element?: DamageElement): { multiplier: number; label: string } {
  const enemyCritBonus = panel.enemyCritDmgTakenBonus ?? 0
  const critDmg = getTargetedStat(panel, 'critDmg', targetSkillType)
    + getElementCritDmgBonus(panel, element, targetSkillType) + enemyCritBonus
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

// 下沉（2026-09-13 展示层越层棘轮）：**定义**在 src/data/sharpCritMultiplier.ts，此处 re-export
// 保持引擎侧调用点（本文件 calcSharpCritMultiplier、substatOptimizer）与文档引用零改动；
// 展示层（FinalPanel / StatPanel）改 import `@/data/…`。改公式只改 src/data 那一处。
import { sharpCritMultiplier } from '@/data/sharpCritMultiplier'
export { sharpCritMultiplier }

function calcSharpCritMultiplier(panel: PanelValues, mode: 'expect' | 'crit' | 'nonCrit', targetSkillType?: SkillDamageTarget): { multiplier: number; label: string } {
  const sharpCritDmg = getTargetedStat(panel, 'sharpCritDmg', targetSkillType) + (panel.enemyCritDmgTakenBonus ?? 0)
  const critRateRaw = getTargetedStat(panel, 'critRate', targetSkillType)
  const d = sharpCritDmg / 100
  const overflowRate = Math.min(1, Math.max(0, critRateRaw - 100) / 100)
  const overflowLabel = overflowRate > 0 ? ` + 额外锐暴判定${fmt(overflowRate * 100)}%` : ''

  switch (mode) {
    case 'crit': {
      // 假设首次锐暴必中；溢出段按概率做第二次锐暴（乘算，不是加算）
      const mult = (1 + d) * (1 + overflowRate * d)
      return { multiplier: mult, label: `锐暴 (锐暴伤害${fmt(sharpCritDmg)}%${overflowLabel} 乘算)` }
    }
    case 'nonCrit':
      return { multiplier: 1, label: '不暴击' }
    case 'expect':
    default: {
      const mult = sharpCritMultiplier(critRateRaw, sharpCritDmg)
      return { multiplier: mult, label: `期望 (暴击率${fmt(critRateRaw)}% 锐暴${fmt(sharpCritDmg)}%${overflowLabel})` }
    }
  }
}

/**
 * 物理强击的异常暴击统计（期望口径）。
 *
 * ⚠ `janeAssaultCritDmgBonus` **只给简自身触发的强击**（简潜能觉醒·致命舞步；
 * 乱流不继承 ⇒ `calcAnomalyCritExpect` 的 `includeSelfAssaultBonus:false` 右臂保持不变）。
 * 本函数由 `calcAnomalyDamage` 在**结算者面板**（`settlementPanel`）上调用，
 * 而结算者正是真正触发该次强击的槽位 ⇒ 在此累加等价于「只给简自己的强击」。
 *
 * ★ R59 修复：该字段此前**零消费者**（`PanelValues` 上有声明、`jane.ts` 有写入、
 * `calcAnomalyCritExpect` 会读 —— 但强击行根本不走那条路径，它走本函数）
 * ⇒ 简的潜能暴伤对直伤强击**端到端恒为 0**（四臂实测 pot 1/2/6 的 `perDamage` 完全相同）。
 */
function getAnomalyCritStats(panel: PanelValues, element: DamageElement | undefined): { rate: number; dmg: number; labelPrefix: string } {
  const isAssault = element === 'physical'
  const selfAssaultBonus = isAssault ? (panel.janeAssaultCritDmgBonus ?? 0) : 0
  return {
    rate: (panel.anomalyCritRate ?? 0) + (isAssault ? panel.assaultCritRate ?? 0 : 0),
    dmg: (panel.anomalyCritDmg ?? 0) + (isAssault ? (panel.assaultCritDmg ?? 0) + selfAssaultBonus : 0),
    labelPrefix: isAssault && ((panel.assaultCritRate ?? 0) !== 0 || (panel.assaultCritDmg ?? 0) !== 0) ? '强击/异常暴击' : '异常暴击',
  }
}

function calcPenetrationPower(panel: PanelValues): number {
  return panel.atk * 0.3 + panel.hp * 0.1 + (panel.sheerForceFlat ?? 0)
}

function getElementSheerDmgBonus(panel: PanelValues, element: DamageElement | undefined, targetSkillType?: string): number {
  if (!element) return 0
  return getTargetedStat(panel, `${resolveStatElement(element)}SheerDmg`, targetSkillType)
}

function getElementSharpDmgBonus(panel: PanelValues, element: DamageElement | undefined, targetSkillType?: string): number {
  if (!element) return 0
  return getTargetedStat(panel, `${resolveStatElement(element)}SharpDmg`, targetSkillType)
}

export type SpecialDamageProfileKind = 'normal' | 'rupture' | 'sharpen'

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
  kind: 'sharpen',
  label: '锋御伤害',
  basisLabel: '防御力区',
  basisFormula: () => 'def',
  calcBasisValue: panel => panel.def,
  usesSharpDmgBonus: true,
  critModel: 'sharp',
}

export function resolveSpecialDamageProfile(agent: Agent): SpecialDamageProfile {
  if (agent.specialty === 'rupture') return RUPTURE_DAMAGE_PROFILE
  if (['sharpen', '锋御'].includes(agent.specialty as string)) return SHARPEN_DAMAGE_PROFILE
  return NORMAL_DAMAGE_PROFILE
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

// @fact engine:damage/乘区顺序 口径: 乘区顺序=代码顺序（基底→技能倍率→固定附加→增伤→锐化→贯穿→防御→抗性→易伤→失衡→侵染→暴击/锐暴→次数），调换 breakdown.push 顺序即改口径；两处**非可交换**落点必须保持不变——① 固定附加在**各乘区之前**进基础区（放到最后加 = 少乘增伤…暴击全链）② 抗性在易伤**之前** | 据 实测@2026-09-01复核·复核@2026-09-08·复核@2026-09-09（锐暴 200% 封顶+乘算改动后顺序未变）·复核@2026-09-18（R32 假绿扫描：旧 `驗` 只断言 `result.damage`，纯换序 0 红 ⇒ 已补行为面+形状面成对判据） | 验 src/core/__tests__/damage.test.ts | 锚 src/core/damage.ts#calcDirectDamage | 信 确认
// ⚠ 上面这条口径的 `breakdown` **在本文件内零消费者**——`calcDirectDamage` 只被活管线
//   （`resourceCalc/damagePool.ts`）调用，而它**只读 `result.damage`**、把 `breakdown` 丢弃
//   ⇒ 顺序错误在当前版本**只由下面那条行为面 + 形状面成对判据守护**，不由任何页面暴露。
//   若将来接上 breakdown 展示，那两条判据即为该面板的口径基线（别删）。
//   ★ R33（2026-09-18）已删除旧 `calcDamage` 及其 `pushSkillDamageResult`（曾在此处点名）：
//     该函数全仓零引用（LanguageService 符号级实测：全仓仅 1 处 = 定义本身，无动态 import /
//     字符串引用），而它**看着像主管线**（名字就叫 calcDamage）⇒ 规则 16「命名骗 agent」样本。
//     删除面 = 3 个同样零引用的导出（calcAnomalyBuildUp / calcStunBuildUp / calcDisorderDamage）
//     + calcDamage，共 −343 行（996 → 665）。
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
    : calcCritMultiplier(critPanel, input.critMode, input.skillDamageTarget, input.damageElement)
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
