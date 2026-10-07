/**
 * 贯穿力（命破 / 贯穿伤害的基础值）= 攻击力 × 0.3 + 生命值 × 0.1 + 固定贯穿力（sheerForceFlat）。
 *
 * 单一来源（CC-228）：引擎（命破 calcBasisValue、琉音 / 般岳 / 诺姆模块）
 * 与展示层（FinalPanel / StatPanel / DebugPage——展示层禁止值 import core，此前各自手写一份）共用。
 * 与 `critMultiplier.ts` / `sharpCritMultiplier.ts` / `anomalyElement.ts` 同属「引擎与展示共用的纯规则」。
 * 源码锁：`src/data/__tests__/penetrationPower.test.ts`。
 */
export interface PenetrationPowerInput {
  atk: number
  hp: number
  sheerForceFlat?: number
}

/** 贯穿力系数（CC-430 单源：数值与下面两个文案函数都从这里取；游戏改系数只改这两行） */
export const PENETRATION_POWER_ATK_COEF = 0.3
export const PENETRATION_POWER_HP_COEF = 0.1

export function calcPenetrationPower(panel: PenetrationPowerInput): number {
  return panel.atk * PENETRATION_POWER_ATK_COEF + panel.hp * PENETRATION_POWER_HP_COEF + (panel.sheerForceFlat ?? 0)
}

/**
 * 公式骨架文案：`atk × 0.3 + hp × 0.1 + sheerForceFlat`（标签可换，如「局内 atk」「贯穿力提升」）。
 * CC-430：此前 FinalPanel / DebugPage ×3 / core/damage.ts basisFormula 各自手写系数，改系数会让解释文案与数值分叉。
 */
export function penetrationPowerFormulaLabel(atkLabel = 'atk', hpLabel = 'hp', flatLabel = 'sheerForceFlat'): string {
  return `${atkLabel} × ${PENETRATION_POWER_ATK_COEF} + ${hpLabel} × ${PENETRATION_POWER_HP_COEF} + ${flatLabel}`
}

/** 带数值的展开式：`<atk> × 0.3 + <hp> × 0.1 + <flat>`；格式化函数由调用方传入（data 层不依赖 utils/format） */
export function penetrationPowerFormulaText(panel: PenetrationPowerInput, fmtNum: (n: number) => string): string {
  return `${fmtNum(panel.atk)} × ${PENETRATION_POWER_ATK_COEF} + ${fmtNum(panel.hp)} × ${PENETRATION_POWER_HP_COEF} + ${fmtNum(panel.sheerForceFlat ?? 0)}`
}
