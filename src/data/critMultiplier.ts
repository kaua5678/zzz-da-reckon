/**
 * 普通暴击：暴击率钳制 + 期望暴击乘区（单一来源，CC-222）。
 *
 * 放在 `src/data/`（与 `sharpCritMultiplier.ts` 同理）：展示层（StatPanel / FinalPanel）不得 import `@/core`，
 * 引擎（core/damage.ts、core/anomalyPool/helpers.ts）与角色模块（jane）也从这里取。
 * CC-222 前：core/damage.ts 两份（直伤 expect、异常暴击覆盖 expect）、anomalyPool/helpers#calcAnomalyCritExpect、
 * StatPanel、FinalPanel（两份，且只钳上限）各写一份；jane 另两处手写暴击率钳制。
 * 源码锁：`src/core/__tests__/damageMultipliersSingleSource.test.ts`「暴击期望单一来源」。
 * 锋御锐暴另走 `sharpCritMultiplier`（200% 封顶 + 乘算），不在此处。
 */

/** 暴击率（百分点）钳到 [0, 100]：普通暴击 100% 封顶，负值按 0。也用作「暴击发生概率」（如简 6 命强击暴击次数）。 */
export function clampCritRatePct(critRateRaw: number): number {
  return Math.min(100, Math.max(0, critRateRaw))
}

/** 期望暴击乘区 = 1 + clamp(暴击率)/100 × 暴击伤害/100 */
export function expectedCritMultiplier(critRateRaw: number, critDmgPct: number): number {
  const rate = clampCritRatePct(critRateRaw) / 100
  return 1 + rate * (critDmgPct / 100)
}
