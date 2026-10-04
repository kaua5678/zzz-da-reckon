/**
 * 终结技邻位回能——模块侧共用数学（CC-462，r581 arena-F）。
 *
 * 露西 / 丽娜 / 苍角三模块原各写一份逐字同形的 `assign<X>UltNeighborEnergy` + 同形的 `perTargetAmounts` 包装
 * （`scripts/census-dup-fn-bodies.py` SHAPE=1 唯一 ≥3 文件命中）。用户口径：三人 ⇒ 下一位 +30/大、上一位 +10/大；
 * 两人 ⇒ 另一位 +30/大；单人无。引擎只按类别 `crossAgentSupply.kind = 'neighbor-ult-energy'` 查询、数量由模块自报
 * （`core/resource/crossAgentSupply.ts#neighborUltEnergyByProvider`），本文件不碰引擎。
 * 新角色口径不同（如 +20/+10）传 `next` / `prev` 即可，不要再抄一份。
 */
export const ULT_NEIGHBOR_NEXT_ENERGY = 30
export const ULT_NEIGHBOR_PREV_ENERGY = 10

/** 邻位分配（按槽位序环绕）：{ 槽位: 每次终结技回能 }，不含提供者自己。 */
export function assignUltNeighborEnergy(
  slots: number[],
  ownSlot: number,
  next: number = ULT_NEIGHBOR_NEXT_ENERGY,
  prev: number = ULT_NEIGHBOR_PREV_ENERGY,
): Record<number, number> {
  const out: Record<number, number> = {}
  const others = slots.filter(s => s !== ownSlot)
  if (others.length === 0) return out
  if (others.length === 1) {
    out[others[0]] = next
    return out
  }
  const ordered = [...slots].sort((a, b) => a - b)
  const idx = ordered.indexOf(ownSlot)
  out[ordered[(idx + 1) % ordered.length]] = next
  out[ordered[(idx - 1 + ordered.length) % ordered.length]] = prev
  return out
}

/** `crossAgentSupply.perTargetAmounts` 共用体：邻位份额 × 终结技次数（floor、非负）。返回可变 Record，调用方可继续叠加（露西 C1 全队回旋）。 */
export function ultNeighborPerTargetAmounts(
  ownSlot: number,
  teamSize: number,
  ultimateCount: number | undefined,
  next: number = ULT_NEIGHBOR_NEXT_ENERGY,
  prev: number = ULT_NEIGHBOR_PREV_ENERGY,
): Record<number, number> {
  const slots = Array.from({ length: teamSize }, (_, i) => i)
  const ults = Math.max(0, Math.floor(ultimateCount ?? 0))
  const out: Record<number, number> = {}
  for (const [slot, amount] of Object.entries(assignUltNeighborEnergy(slots, ownSlot, next, prev))) out[Number(slot)] = amount * ults
  return out
}
