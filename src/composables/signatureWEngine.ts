/**
 * 「专武」的唯一判定（CC-498，r682）：某角色的专属音擎 = 目录里 `ownerAgentId === agentId` 的那一把。
 * 此前 5 处各写一遍「displayWEngines 里 find 出 ownerAgentId 等于角色 id 的音擎」（自动推荐音擎 / 抽卡规划 / 时间线基础档 ×2 /
 * 自由对比专武 id），互相以注释「与 teamCompare 同口径」维持。只依赖 `{ displayWEngines }` 结构，
 * 测试夹具用普通对象即可，不要求 Pinia store。
 */
import type { WEngine } from '@/types/catalog'

export function signatureWEngineOf(
  catalog: { readonly displayWEngines: ReadonlyArray<WEngine> | null | undefined },
  agentId: string,
): WEngine | undefined {
  return (catalog.displayWEngines ?? []).find(w => w.ownerAgentId === agentId)
}
