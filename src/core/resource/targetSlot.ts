/**
 * 队友落点槽位解析（CC-44 2026-09-27 自 mechanics/agents/liuyin.ts 迁入）。
 * 纯函数、无角色判定；使用方：赠大（resourceCalc/ultimatePromote、convergence）、赠连携（chainGift）、
 * 琉音/诺玛模块、跨角色供给缺省落点（crossAgentSupply）。
 *
 * 解析"下一位出场角色"槽位（好评转大的目标队友）：
 * - 自动（-1）：取队伍顺序中琉音上一个槽位（环绕），排除自己。
 * - 手动：直接使用用户设置。
 */
export function resolveUltimateTargetSlot(ownSlot: number, teamLength: number, setting: number): number {
  if (setting >= 0 && setting < teamLength && setting !== ownSlot) return setting
  const prev = (ownSlot - 1 + teamLength) % teamLength
  return prev === ownSlot ? (ownSlot + 1) % teamLength : prev
}
