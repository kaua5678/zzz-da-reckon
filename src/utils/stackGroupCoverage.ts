/**
 * 同 `stackGroup` 的效果共享同一个叠层状态（数据语义，R5 D3）⇒ 覆盖率滑块要联动。
 *
 * 引擎仍按 `effect.id` 读覆盖率（`core/buff.ts` coverageMap），这里只决定「拖一个滑块时要写哪些 id」：
 * 有 stackGroup ⇒ 同组全部成员；没有 ⇒ 只写自己。默认覆盖率 100% 不变 ⇒ 计算零差（CC-111）。
 * 回退点：页面改回只写单个 id 即可，本函数无其他消费方。
 */
export interface StackGroupMember {
  id: string
  stackGroup?: string | null
}

export function stackGroupPeerIds(members: readonly StackGroupMember[], id: string): string[] {
  const group = members.find(m => m.id === id)?.stackGroup
  if (!group) return [id]
  const peers = members.filter(m => m.stackGroup === group).map(m => m.id)
  return peers.includes(id) ? [...new Set(peers)] : [id, ...new Set(peers)]
}
