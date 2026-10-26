/**
 * 「专武」的唯一判定（CC-498，r682；r7xx 扩到两条权威来源）：某角色的专属音擎 =
 * ① 目录里 `ownerAgentId === agentId` 的那一把，或 ② effect 级 `requirement.wearerAgentIds` 含该角色的那一把。
 * 此前 5 处各写一遍「displayWEngines 里 find 出 ownerAgentId 等于角色 id 的音擎」（自动推荐音擎 / 抽卡规划 / 时间线基础档 ×2 /
 * 自由对比专武 id），互相以注释「与 teamCompare 同口径」维持。只依赖 `{ displayWEngines }` 结构，
 * 测试夹具用普通对象即可，不要求 Pinia store。
 */
import type { WEngine } from '@/types/catalog'

export function signatureWEngineOf(
  catalog: { readonly displayWEngines: ReadonlyArray<WEngine> | null | undefined },
  agentId: string,
): WEngine | undefined {
  const ws = catalog.displayWEngines ?? []
  // 权威来源 ①：ownerAgentId（正式包导入时从 nanoka 的 code_name 推出）
  const byOwner = ws.find(w => w.ownerAgentId === agentId)
  if (byOwner) return byOwner
  // 权威来源 ②：effect 级 requirement.wearerAgentIds（"装备者为佩洛伊斯时…" 这类限定写法）
  // 用户 2026-10-26：「这三人有专武，可能推荐配置暂时没写，但以后会写的」——此前只有 ownerAgentId 一条路径，
  // 于是 1551/1601/1661 被判成「无专武」，加金阶梯转头给他们发**同职业别人的**专武（实测 −5~−14.6%）。
  // wearerAgentIds 是同一事实的另一种写法（数据里本来就有：14155 日冕遗蜕 → ['1551']）。
  // 用 `in` 收窄而不是 `?.`：`WEngine.effect` 在类型上是必填（判 28 禁止死兜底），
  // 但测试夹具 / 未补全的目录条目会缺这个字段（本轮实测：夹具只有 `{id, ownerAgentId}`）。
  return ws.find(w => 'effect' in w && [w.effect.selfBuff, w.effect.teamBuff]
    .flatMap(b => b?.effects ?? [])
    .some(e => e.requirement?.wearerAgentIds?.includes(agentId)))
}
