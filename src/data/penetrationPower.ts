/**
 * 贯穿力（命破 / 贯穿伤害的基础值）= 攻击力 × 0.3 + 生命值 × 0.1 + 固定贯穿力（sheerForceFlat）。
 *
 * 单一来源（CC-228）：引擎（`core/damage.ts` 原名转出 `calcPenetrationPower`，命破 calcBasisValue、琉音 / 般岳 / 诺姆模块）
 * 与展示层（FinalPanel / StatPanel / DebugPage——展示层禁止值 import core，此前各自手写一份）共用。
 * 与 `critMultiplier.ts` / `sharpCritMultiplier.ts` / `anomalyElement.ts` 同属「引擎与展示共用的纯规则」。
 * 源码锁：`src/data/__tests__/penetrationPower.test.ts`。
 */
export interface PenetrationPowerInput {
  atk: number
  hp: number
  sheerForceFlat?: number
}

export function calcPenetrationPower(panel: PenetrationPowerInput): number {
  return panel.atk * 0.3 + panel.hp * 0.1 + (panel.sheerForceFlat ?? 0)
}
