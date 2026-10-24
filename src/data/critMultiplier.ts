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

/**
 * 暴击溢出 → 爆伤的转化比（每 1 点溢出暴击率 = 2 点爆伤）。
 *
 * 词条步长依据：S 级驱动盘副词条暴击率 +2.4%/条、暴击伤害 +4.8%/条（`substatOptimizer.ts#CRIT_RATE_STEP`）
 * ⇒ 玩家把 1 条暴击词条换成 1 条爆伤词条 = 局内暴击 −2.4、爆伤 +4.8，恰为 1:2。
 *
 * @fact engine:暴击溢出/转化 口径: 局内暴击率超过 100% 的部分按词条比 1:2 自动转成爆伤（模拟玩家「暴击溢出就换爆伤词条」的配装终态——溢出 E% ⇒ 释放 E/2.4 条暴击词条、换回 2E 点爆伤）；适用于局外词条与局内 buff（游球/影画局内段）叠出的任意溢出来源 | 据 用户@2026-10-24（「希望自动转化为爆伤，这俩词条本来是等价的…玩家玩的时候会自动调整装备，我们也可以这样自动调整」） | 验 src/data/__tests__/critMultiplier.test.ts | 锚 src/data/critMultiplier.ts#CRIT_OVERFLOW_TO_CRIT_DMG_RATIO | 信 确认
 * ⟳复核: 若词条步长改版（暴击/爆伤不再是 2.4/4.8），或出现「溢出不可换装」的 buff 类型需要区分，改本转化比与乘区算式 | 到期 2027-04-30
 */
export const CRIT_OVERFLOW_TO_CRIT_DMG_RATIO = 2

/** 暴击率（百分点）钳到 [0, 100]：普通暴击 100% 封顶，负值按 0。也用作「暴击发生概率」（如简 6 命强击暴击次数）。 */
export function clampCritRatePct(critRateRaw: number): number {
  return Math.min(100, Math.max(0, critRateRaw))
}

/**
 * 期望暴击乘区 = 1 + clamp(暴击率)/100 × (暴击伤害 + 2×溢出暴击)/100。
 *
 * 溢出部分经词条比 1:2 转成爆伤（见 CRIT_OVERFLOW_TO_CRIT_DMG_RATIO）——修前溢出直接钳掉白丢，
 * 局内 buff（如游球 +20%、雅影画二 +15%）把局外「百暴」配装推过 100% 时收益蒸发。
 * 转化后暴击率恒为 100%（rate=1），乘区退化为 1 + (D + 2E)/100。
 */
export function expectedCritMultiplier(critRateRaw: number, critDmgPct: number): number {
  const rate = clampCritRatePct(critRateRaw) / 100
  const overflow = Math.max(0, critRateRaw - 100)
  return 1 + rate * ((critDmgPct + CRIT_OVERFLOW_TO_CRIT_DMG_RATIO * overflow) / 100)
}
