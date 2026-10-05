/**
 * 队伍结构规则（CC-483，r669）：**一支队至多 1 名击破（stun）**。
 *
 * 依据（原写在 teamTimeline.ts 的注释里，现为唯一出处）：真实 meta 无双击破阵容（失衡窗口重叠浪费），
 * 且引擎失衡循环对双击破组合严重高估（实测 仪玄+莱卡恩+青衣 8金 ≈ 437% 血量，远高于单击破 meta 队 105-127%）；
 * 用户确认的演变路径（橘福福/卢西娅/琉音/诺姆）均为 ≤1 击破。
 *
 * 此前 teamTimeline / teamTimelineFilm / pullPlannerEngine 各自内联一份
 * `isStun = id => (catalog.getAgent(id)?.specialty ?? '') === 'stun'` + 「主C是击破则预算 0 否则 1」的双循环；
 * ≥3 模块同一规则 ⇒ 收成一份。要放宽/收紧口径只改 `MAX_STUN_PER_TEAM`。
 */
import type { useCatalogStore } from '@/stores/catalog'

type CatalogLike = Pick<ReturnType<typeof useCatalogStore>, 'getAgent'>

/** 一支队允许的击破人数上限（用户口径：单击破 meta 队） */
export const MAX_STUN_PER_TEAM = 1

/** 这些成员里有几名击破（未知 id 按非击破计） */
export function stunCountOf(ids: readonly string[], catalog: CatalogLike): number {
  let n = 0
  for (const id of ids) if ((catalog.getAgent(id)?.specialty ?? '') === 'stun') n++
  return n
}

/** 这组成员（主C + 队友，任意人数）是否满足击破上限 */
export function teamStunOk(ids: readonly string[], catalog: CatalogLike): boolean {
  return stunCountOf(ids, catalog) <= MAX_STUN_PER_TEAM
}

/**
 * 主C 固定时，候选池里所有满足击破上限的双队友组合（i < j，保持候选池顺序）。
 * 调用方自己先把主C与无效 id 从 `candidates` 里滤掉——这里只管击破规则。
 */
export function teammatePairsFor(mainAgentId: string, candidates: readonly string[], catalog: CatalogLike): [string, string][] {
  const pairs: [string, string][] = []
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const a = candidates[i]!
      const b = candidates[j]!
      if (!teamStunOk([mainAgentId, a, b], catalog)) continue
      pairs.push([a, b])
    }
  }
  return pairs
}
