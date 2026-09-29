/**
 * 终结技 / 连携技招式判定（CC-319）——**零 import**：core（moveLookup）、mechanics、编排层、展示层共用。
 * 不放进 `moveTableQueries.ts`：那个文件依赖 `logicEditor/fusion`，core 导入会破 CC-247 运行时闭包锁。
 */
/**
 * 终结技 / 连携技的招式判定——**单一事实源**（CC-319）。
 *
 * 口径：英文名含 `ultimate` 且不含 `chain attack` = 终结技；反之 = 连携技。**只在 `chain` 分类内成立**：
 * 青衣 1251 普攻英文名是 `Basic Attack: Penultimate #1…#6`，含子串 `ultimate`。CC-319 之前共有 5 份副本，
 * 其中 3 份不看分类（轴内终结技需求 / 轴内终结技喧响成本 / 轴编辑页转大块与可转大判定），
 * 轴编辑页因此把青衣的「转大·60/90」块挂到了普攻 1251001 上。
 */
export function isUltimateMoveName(en: unknown): boolean {
  const name = String(en ?? '').toLowerCase()
  return name.includes('ultimate') && !name.includes('chain attack')
}

/** 连携技名判定（口径见 {@link isUltimateMoveName}；同样只在 `chain` 分类内成立） */
export function isChainAttackMoveName(en: unknown): boolean {
  const name = String(en ?? '').toLowerCase()
  return name.includes('chain attack') && !name.includes('ultimate')
}

export type ChainMoveKind = 'ultimate' | 'chainAttack' | null

type NamedMove = { readonly id: string; readonly name?: { readonly en?: string } }
type SkillsWithCategories = { readonly categories?: readonly { readonly id?: string; readonly moves?: readonly NamedMove[] }[] } | null | undefined

/** 按 moveId 判定是否终结技 / 连携技：只在 `chain` 分类里找（找不到 = null，含合成块 / 连段块） */
export function chainMoveKind(skills: SkillsWithCategories, moveId: string): ChainMoveKind {
  const chain = (skills?.categories ?? []).find(c => c.id === 'chain')
  const move = (chain?.moves ?? []).find(m => m.id === moveId)
  if (!move) return null
  if (isUltimateMoveName(move.name?.en)) return 'ultimate'
  if (isChainAttackMoveName(move.name?.en)) return 'chainAttack'
  return null
}

/** 本角色（首个）终结技招式；与 `core/resource/moveLookup#findUltimate` 同口径，但只返回招式本身（不算指标） */
export function findUltimateMove<M extends NamedMove>(
  skills: { readonly categories?: readonly { readonly id?: string; readonly moves?: readonly M[] }[] } | null | undefined,
): M | null {
  const chain = (skills?.categories ?? []).find(c => c.id === 'chain')
  return (chain?.moves ?? []).find(m => isUltimateMoveName(m.name?.en)) ?? null
}
