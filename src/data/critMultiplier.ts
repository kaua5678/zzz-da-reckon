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
 * 暴击/爆伤副词条步长（S 级 +2.4% / +4.8% 每条）。单一来源在 data 层：
 * 乘区的溢出转化（本文件）与 core/substatOptimizer 的百暴预算（core 可 import data）共用。
 */
export const CRIT_RATE_STEP = 2.4
export const CRIT_DMG_STEP = 4.8

/**
 * 暴击溢出 → 爆伤的整条转化（以**单个词条**为单位，用户口径 2026-10-24 二则）：
 * ① 「转爆伤必须以单个词条为单位，不能直接抹平到 100%」——玩家配平只能整条加减词条，
 *   换出 k = ceil(溢出/2.4) 条暴击词条 ⇒ 爆伤 + 4.8k，暴击回落到 (97.6, 100]（不是恒 100）；
 * ② 「达到 98% 暴，再来一词条变 100.4%，这个词条只价值 2% 暴击，收益够好配平器就带上」——
 *   微溢出（<1 条）是配平器的合法终态；转化按整条交换计（把那条词条从暴击换成爆伤的完整交换），
 *   乘区自比大小：换后更高才值得（D < 235% 时 1 条交换恒赚）。
 *
 * 语义 = 模拟「知道局内 buff 会来的配平器」的终态：局外词条按局内实际百暴配置，
 * 多带的暴击词条整条换成爆伤。适用于局外词条与局内 buff（游球/影画局内段）叠出的任意溢出来源。
 *
 * @fact engine:暴击溢出/转化 口径: 局内暴击溢出按整条词条转化——k=ceil(E/2.4) 条暴击换爆伤(+4.8k)，暴击回落到 (97.6,100]；词条步长 2.4/4.8 为换算基；微溢出(<1条)同样按整条交换计 | 据 用户@2026-10-24（「希望自动转化为爆伤，词条本等价」+「必须以单个词条为单位，不能直接抹平到100%」+「达到98%再来一条变100.4%，只值2%暴击，收益够好配平器就带上」） | 验 src/data/__tests__/critMultiplier.test.ts | 锚 src/data/critMultiplier.ts#CRIT_RATE_STEP | 信 确认
 * ⟳复核: 若词条步长改版（暴击/爆伤不再是 2.4/4.8）或出现「溢出不可换装」的 buff 类型需要区分，改步长常量与转化算式 | 到期 2027-04-30
 */

/** 暴击率（百分点）钳到 [0, 100]：普通暴击 100% 封顶，负值按 0。也用作「暴击发生概率」（如简 6 命强击暴击次数）。 */
export function clampCritRatePct(critRateRaw: number): number {
  return Math.min(100, Math.max(0, critRateRaw))
}

/**
 * 期望暴击乘区（含溢出整条转化）：
 * - 无溢出：1 + clamp(暴击率)/100 × 暴伤/100（与旧口径逐位一致）；
 * - 溢出 E：换出 k = ceil(E/2.4) 条暴击词条 ⇒ 乘区 = 1 + (暴击−2.4k)/100 × (暴伤+4.8k)/100，
 *   暴击回落到 (97.6, 100]。修前溢出直接钳掉白丢——局内 buff（游球 +20%、雅影画二 +15%）
 *   把局外「百暴」配装推过 100% 时收益蒸发。
 */
export function expectedCritMultiplier(critRateRaw: number, critDmgPct: number): number {
  const overflow = Math.max(0, critRateRaw - 100)
  const swappedSteps = overflow > 0 ? Math.ceil(overflow / CRIT_RATE_STEP) : 0
  const rate = clampCritRatePct(critRateRaw - CRIT_RATE_STEP * swappedSteps) / 100
  const critDmg = critDmgPct + CRIT_DMG_STEP * swappedSteps
  return 1 + rate * (critDmg / 100)
}
