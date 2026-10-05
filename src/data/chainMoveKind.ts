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
type SkillsLike<M extends NamedMove> = { readonly categories?: readonly { readonly id?: string; readonly moves?: readonly M[] }[] } | null | undefined

/** `chain` 分类下的招式（无技能表 / 无该分类 ⇒ 空数组）——终结技 / 连携技查找的唯一入口（CC-499）。 */
export function chainMovesOf<M extends NamedMove>(skills: SkillsLike<M>): readonly M[] {
  return (skills?.categories ?? []).find(c => c.id === 'chain')?.moves ?? []
}

/** 按 moveId 判定是否终结技 / 连携技：只在 `chain` 分类里找（找不到 = null，含合成块 / 连段块） */
export function chainMoveKind(skills: SkillsLike<NamedMove>, moveId: string): ChainMoveKind {
  const move = chainMovesOf(skills).find(m => m.id === moveId)
  if (!move) return null
  if (isUltimateMoveName(move.name?.en)) return 'ultimate'
  if (isChainAttackMoveName(move.name?.en)) return 'chainAttack'
  return null
}

/** 本角色（首个）终结技招式；`core/resource/moveLookup#findUltimate` 在此之上算指标（CC-499 起转调，不再各找一遍） */
export function findUltimateMove<M extends NamedMove>(skills: SkillsLike<M>): M | null {
  return chainMovesOf(skills).find(m => isUltimateMoveName(m.name?.en)) ?? null
}

/** 本角色（首个）连携技招式；`core/resource/moveLookup#findChainAttack` 在此之上算指标 */
export function findChainAttackMove<M extends NamedMove>(skills: SkillsLike<M>): M | null {
  return chainMovesOf(skills).find(m => isChainAttackMoveName(m.name?.en)) ?? null
}
