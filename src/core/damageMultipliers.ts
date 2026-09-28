/**
 * 伤害公式里与伤害类型无关的通用乘区（单一来源，CC-219）。
 *
 * CC-219 前：`core/damage.ts`（直伤）与 `core/anomalyPool/helpers.ts`（异常 / 紊乱 / 乱流）各有一份
 * 794 常量 + 防御乘区 + 抗性乘区，`mechanics/agents/remielle.ts`（耀变）又手写了第三份，外加写死的等级系数 2。
 * 本文件是叶子模块（无运行时依赖），damage.ts / anomalyPool/helpers.ts / 角色模块都从这里取。
 * 源码锁：`src/core/__tests__/damageMultipliersSingleSource.test.ts`。
 *
 * 公式来源：啵啵獭第八期穿透防御学。
 */

/** 60 级等级基数（固定常量，不再用 level×10+690） */
export const LEVEL_COEFF_60 = 794

/** 60 级等级系数 = 1 + 1/59 × (60 − 1) = 2（异常类伤害的等级乘区） */
export const LEVEL_MULT_60 = 2

/**
 * 防御乘区。
 *   有效防御 = max(0, 怪物防御 × (1 − 穿透率/100) × (1 − 减防/100) − 穿透值)
 *   防御区 = 794 / (794 + 有效防御)
 * 穿透值 = 角色穿透值 + 敌方固定防御降低（两者本质相同，加算；游戏里只有穿透值能固定扣除防御）。
 */
export function defenseMultiplierDetail(
  enemyDefense: number,
  enemyDefReduction: number,
  enemyDefFlatReduction: number,
  penRatio: number,
  penFlat: number,
): { multiplier: number; effectiveDef: number } {
  const totalPenFlat = penFlat + enemyDefFlatReduction
  const effectiveDef = Math.max(0, enemyDefense * (1 - penRatio / 100) * (1 - enemyDefReduction / 100) - totalPenFlat)
  const multiplier = LEVEL_COEFF_60 / (LEVEL_COEFF_60 + effectiveDef)
  return { multiplier, effectiveDef }
}

/**
 * 抗性乘区：multiplier = 1 − 有效抗性/100，不设上限。
 * 抗性降低 / 无视抗性线性提高该乘区；后续如出现 Boss 抗性增强字段，再加回 effectiveRes。
 */
export function resistanceMultiplierDetail(
  baseResistance: number,
  resReduction: number,
  resIgnore = 0,
): { multiplier: number; effectiveRes: number } {
  const effectiveRes = baseResistance - resReduction - resIgnore
  const multiplier = 1 - effectiveRes / 100
  return { multiplier, effectiveRes }
}
