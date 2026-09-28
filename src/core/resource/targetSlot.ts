/**
 * 队友落点槽位解析（CC-44 自 mechanics/agents/liuyin.ts 迁入；CC-180 第 203 轮改为「已上场槽位序列」口径）。
 * 纯函数、无角色判定；使用方：赠大（resourceCalc/ultimatePromote、convergence）、赠连携（chainGift）、
 * 琉音/诺姆模块 `crossAgentSupply.targetSlot`、跨角色供给缺省落点（crossAgentSupply）。
 *
 * 入参与返回值都是**编队槽位**（`cfg.slot` / `configStore.team` 下标），`occupiedSlots` = 已上场槽位（升序，
 * 引擎侧 = `configs.map(c => c.slot)`，编排层 = 资源结果 `characters.map(c => c.slot)`，两边同源）。
 * - 手动（`setting ≥ 0`）：该槽已上场且不是自己 ⇒ 用它；
 * - 自动（-1，或手动指向空槽 / 自己）：已上场序列里自己的**上一位**（环绕）⇒ **跳过空槽**；
 * - 没有队友（只有自己上场）⇒ 返回 **-1**（无落点，不赠送）。旧式在 teamLength=1 时返回自己，会造成自赠
 *   （旧编排层传 team.length=3 从未走到；CC-180 探针在新口径下复现了单琉音自赠 7.2s，故显式排除）。
 *
 * 口径依据（CC-180）：游戏换人顺序只含上场角色，没有「空槽」这一位（两人队的上一位 = 另一人）；
 * 邻位回能（苍角/丽娜/露西）本就在已上场序列上算（「两人队另一位 30」）。
 * 旧式 `resolveUltimateTargetSlot(own, team.length, setting)` 在含空槽的 3 格里环绕：编排层落到空槽 ⇒ 赠送丢失，
 * 引擎侧还把编队槽号当 `configs` 下标用（两个空间混用，CC-179 §24.26 探针）。满编时新旧逐值相同。
 */
export function resolveTeammateTargetSlot(ownSlot: number, occupiedSlots: readonly number[], setting: number): number {
  if (setting >= 0 && setting !== ownSlot && occupiedSlots.includes(setting)) return setting
  const i = occupiedSlots.indexOf(ownSlot)
  const n = occupiedSlots.length
  if (i < 0 || n <= 1) return -1
  return occupiedSlots[(i - 1 + n) % n]
}
