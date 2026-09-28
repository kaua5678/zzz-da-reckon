/**
 * 喧响「队友伴随」规则（纯规则，CC-230 单一来源）：某角色获得的奖励喧响，其余队友各按 50% 同时获得。
 *
 * 此前写了 3 份：`core/anomalyPool/helpers.ts#calcPerSlotAnomalyDecibelBonus`（异常/紊乱/乱流；CC-230 删除，改为 core/anomalyPool.ts 内 own → withCompanionShare）、
 * `core/anomalyPool.ts#calcSpecialActionBonus`（弹刀/连携/闪反/快支），以及 `components/ResourceResultCard.vue`
 * 的「自己 + 队友伴随」拆解（slotCount 取法还与引擎不同）。放 data 层是为了展示层也能合法引用（视图禁止值导入 core）。
 */
/** 队友伴随比例 */
export const DECIBEL_COMPANION_RATIO = 0.5

/** 各槽「自己获得」 → 各槽「自己 + 其余队友 × 50%」（含伴随的最终个人喧响） */
export function withCompanionShare(perSlotOwn: readonly number[]): number[] {
  return perSlotOwn.map((_, i) => {
    let companion = 0
    for (let j = 0; j < perSlotOwn.length; j++) {
      if (j !== i) companion += (perSlotOwn[j] ?? 0) * DECIBEL_COMPANION_RATIO
    }
    return (perSlotOwn[i] ?? 0) + companion
  })
}
