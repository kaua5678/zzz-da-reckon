/**
 * 技能等级系数计算
 *
 * ZZZ 中 3命/5命会提升技能等级 +2/+4（共+4），影响伤害倍率和失衡倍率。
 * 成长规则为线性：1级时归一化值为1，12级时伤害×2、失衡×1.5。
 *
 * 归一化公式（L1=1）：
 *   伤害: 1 + (L-1)/11
 *   失衡: 1 + 0.5×(L-1)/11
 *
 * 相对于 12 级表的系数：
 *   伤害系数 = (L + 10) / 22
 *   失衡系数 = (L + 21) / 33
 *
 * 三档结果：
 * | 技能等级 | 伤害系数   | 失衡系数   |
 * |---------|-----------|-----------|
 * | 12（3命以下） | 1.0       | 1.0       |
 * | 14（3-4命）   | 1.090909  | 1.060606  |
 * | 16（5命以上） | 1.181818  | 1.121212  |
 */

export interface SkillLevelCoef {
  /** 实际技能等级（12/14/16） */
  skillLevel: number
  /** 伤害倍率系数，乘到 12 级表的 damage 行 */
  damageCoef: number
  /** 失衡倍率系数，乘到 12 级表的 daze 行 */
  dazeCoef: number
}

/**
 * 根据技能等级提升量计算伤害/失衡系数
 *
 * @param skillLevelBonus 技能等级提升（0=无提升, 2=3命, 4=5命）
 * @returns { skillLevel, damageCoef, dazeCoef }
 */
export function getSkillLevelCoef(skillLevelBonus: number): SkillLevelCoef {
  const skillLevel = 12 + Math.max(0, skillLevelBonus)
  return {
    skillLevel,
    damageCoef: (skillLevel + 10) / 22,
    dazeCoef: (skillLevel + 21) / 33,
  }
}
