/**
 * 轴内「[表]」技能表直读的**唯一判定**（CC-393）——编辑器候选池（`views/StunAxisPage.vue#allMoves`）
 * 与伤害结算（`resourceCalc/damagePoolDirect.ts` 末段）共用同一个函数。
 *
 * [表] 块的语义 = 「模块没建模的招式，放进轴就按技能表倍率出直伤」。所以只有**真正没被建模**的招式才可直读：
 *   1. moveId 是数字（catalog 招式；`basic` / 连段 id / 模块专属块不是）；
 *   2. 本角色没有该 moveId 的执行行（`backed`；有执行行的招式由执行行结算）；
 *   3. 不是模块声明的隐藏招式（`axisHiddenMovesOf(agentId, backed)` = `axisHiddenMoves` ∪ `attachedEvents` 子行
 *      ∪ `moveBranchGroups` 里「本角色另一分支有执行行」的互斥成员，CC-402）——
 *      模块用别的方式表达了它（如伊德海莉连携固定用 1051025，1051015 永不出手）；
 *   4. 不是倍率融合组的**并入段**（`data/moveFusions.ts`：同一次动作的多段已求和进主段，再直读 = 重复计伤）；
 *   4b. 不是队友在队招式变体的**协同段**（`data/moveVariants.ts`，CC-406）：它是某个已建模招式在队友在队时的替身——
 *       队友在队时倍率已换进执行行，不在队时该段打不出来；两种情况直读都是重复计伤（珂蕾妲 1101106 / 1101402）；
 *   5. 技能分类属于特殊技 / 支援 / 终结 / 连携，且伤害倍率 > 0。
 * 倍率取法与执行行相同：融合主段取整组求和（`fusedRowValue`），否则单段（`getRowValue`，含逻辑编辑器行规则）。
 *
 * 修前两边各写一份且口径不同：编辑器限分类、看 `values[0]`；结算不限分类、不认隐藏与融合
 * ⇒ 编辑器会提供「放了重复计伤」的块（r419 普查：命座 0 共 243 个候选，其中融合并入段 16 个、伊德海莉 1051015 1 个）。
 */
import type { AgentSkills, SkillMove } from '@/types/catalog'
import { MOVE_FUSION_GROUPS } from '@/data/moveFusions'
import { TEAMMATE_MOVE_VARIANTS } from '@/data/moveVariants'
import { fusedRowValue, getRowValue } from '@/data/moveTableQueries'
import { axisHiddenMovesOf } from '@/mechanics'

export const AXIS_TABLE_DIRECT_CATEGORIES: readonly string[] = ['special', 'assist', 'ultimate', 'chain']

/** 融合组里除主段以外的段（倍率已并进主段） */
const FUSED_MEMBERS: ReadonlySet<string> = new Set(
  MOVE_FUSION_GROUPS.flatMap(g => g.terms.map(t => t.moveId).filter(id => id !== g.moveId)),
)

/** 队友在队变体的协同段（CC-406：是已建模招式的替身，不是独立招式） */
export const VARIANT_TARGETS: ReadonlySet<string> = new Set(
  TEAMMATE_MOVE_VARIANTS.flatMap(v => Object.values(v.swaps)),
)

export interface AxisTableDirectMove {
  move: SkillMove
  categoryId: string
  /** 单次倍率（融合主段 = 整组求和） */
  multiplier: number
}

/** 该招式能否作为 [表] 直读；能 ⇒ 返回招式与倍率，不能 ⇒ null */
export function axisTableDirectMove(
  agentId: string,
  skills: AgentSkills | undefined,
  moveId: string,
  backed: ReadonlySet<string>,
): AxisTableDirectMove | null {
  if (!/^\d+$/.test(moveId) || backed.has(moveId) || FUSED_MEMBERS.has(moveId) || VARIANT_TARGETS.has(moveId)) return null
  if (axisHiddenMovesOf(agentId, backed).includes(moveId)) return null
  for (const cat of skills?.categories ?? []) {
    const move = (cat.moves ?? []).find(m => m.id === moveId)
    if (!move) continue
    if (!AXIS_TABLE_DIRECT_CATEGORIES.includes(cat.id ?? '')) return null
    const dmg = (move.rows ?? []).find(r => r.kind === 'damageMultiplier')
    if (!dmg) return null
    const multiplier = fusedRowValue(skills, moveId, dmg.id) ?? getRowValue(move, dmg.id)
    return multiplier > 0 ? { move, categoryId: cat.id, multiplier } : null
  }
  return null
}

/** 本角色全部可直读招式（按技能表分类顺序，moveId 去重）——编辑器候选池用 */
export function axisTableDirectCandidates(
  agentId: string,
  skills: AgentSkills | undefined,
  backed: ReadonlySet<string>,
): AxisTableDirectMove[] {
  const out: AxisTableDirectMove[] = []
  const seen = new Set<string>()
  for (const cat of skills?.categories ?? []) {
    for (const m of cat.moves ?? []) {
      if (seen.has(m.id)) continue
      seen.add(m.id)
      const hit = axisTableDirectMove(agentId, skills, m.id, backed)
      if (hit) out.push(hit)
    }
  }
  return out
}
