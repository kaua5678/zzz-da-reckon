/**
 * 倍率表纯查询（招式查找 / 行值 / 融合行值 / 平A 第 3 段挑选）——**定义落点**。
 *
 * ⚠ 本文件是「录入层 → 编排层值倒置」的下沉落点（2026-09-19 round 37，OPEN-ITEMS R35-J2）：
 * `src/mechanics/agents/claret.ts` 曾**值导入** `composables/resourceCalc/helpers` 的
 * `pickThirdNamedBasicSegment` / `fusedRowValue`——全仓**唯一**一条录入层 → 编排层值边
 * （R35 穷尽扫描 9 站点 = 8 `import type` + 1 值），Tarjan SCC 实测造成 8 模块强连通分量，
 * 破坏 ARCHITECTURE §0 单向依赖。修法沿用判据 7 头注释自述的已验先例（`sharpCritMultiplier`：
 * `core/damage.ts` → `data/sharpCritMultiplier.ts`）：纯函数下沉 `src/data/`，原位置
 * `composables/resourceCalc/skillRows.ts` 改 import + export **两行壳** ⇒ 编排层/引擎侧调用点、
 * 既有测试与 `@fact` 锚零改动；录入层改从这里取。机器面 = 判据 19 `layer-inversion`
 * （`scripts/lib/layer-inversion.mjs`：录入层对编排层值导入必须为 0 + 反空洞下限 + claret 形状锁）。
 *
 * 四个符号的传递依赖闭包全纯（R35 实测）：`getRowFusionMultiplier`（`logicEditor/fusion`，零出边）
 * + `moveFusionByMoveId`（`data/moveFusions`，零 import）+ 类型。`core/resource.ts` 早已 import
 * `@/data/moveFusions` ⇒ 「core → data」有先例，无成环风险。
 *
 * 只下沉 claret 闭包这 4 个符号（选项 a，规则 12 最小阶梯）；C 簇其余 10 个符号留在 `skillRows.ts`：
 * `getBasicComboMoves` / `averageBasicRows` 收 `catalogStore`（非纯），且 `skillRows.ts` 在
 * `listAgentBranchFiles()` 的 agentId 棘轮度量面内，整簇下沉会让它整类逃出棘轮（覆盖面永久取舍）。
 *
 * 迁移纪律：逐字节剪切，算式/条件/求值顺序零改动。**改这 4 个函数请改本文件**，
 * 不要回 `skillRows.ts` / `helpers.ts` / 角色模块重建同形函数（那会分裂单一事实源，规则 11）。
 */
import { getRowFusionMultiplier } from '@/logicEditor/fusion'
import { moveFusionByMoveId } from '@/data/moveFusions'
import type { AgentSkills, SkillMove } from '@/types/catalog'

/** 从 SkillMove 的 rows 中提取指定 row 的值 */
export function getRowValue(move: SkillMove | null | undefined, rowId: string): number {
  if (!move) return 0
  const row = move.rows.find(r => r.id === rowId)
  return (row?.values[0] ?? 0) * getRowFusionMultiplier(move.id, rowId)
}

/**
 * 倍率融合（src/data/moveFusions.ts 单一事实源）：moveId 登记了融合组时，
 * 该 row 值 = Σ 组内 term.moveId 的同行值 × term.count。
 * 返回 null = 未登记（走原 getRowValue 单段值）；组内缺段时整组回退 null（保守，防半融合）。
 */
export function fusedRowValue(skills: AgentSkills | undefined, moveId: string, rowId: string): number | null {
  const group = moveFusionByMoveId.get(moveId)
  if (!group) return null
  let sum = 0
  for (const term of group.terms) {
    const member = findMoveById(skills, term.moveId)
    if (!member) return null
    sum += getRowValue(member, rowId) * term.count
  }
  return sum
}

export function findMoveById(skills: AgentSkills | undefined, moveId: string): SkillMove | null {
  if (!skills) return null
  for (const cat of skills.categories) {
    const move = cat.moves.find(m => m.id === moveId)
    if (move) return move
  }
  return null
}

/**
 * 平A「第 3 段」挑选（`#N` 段里取 index 2，不足取末段）——**单一事实源**。
 *
 * 引擎默认基准（`getBasicComboMoves` 第 4 步）与需要**多套基准**的角色模块（如克拉蕾 1611
 * 常态/猩红铭刻两态分支）都调本函数，避免两处各写一遍"第 3 段"而在规则变化时漂移。
 */
export function pickThirdNamedBasicSegment(moves: readonly SkillMove[]): SkillMove | null {
  const named: SkillMove[] = []
  for (const move of moves) {
    const name = move.name?.en || ''
    if (!name.match(/#\d+/)) continue
    if (name.toLowerCase().includes('dash') || name.toLowerCase().includes('dodge')) continue
    if (!move.actionTime || move.actionTime <= 0) continue
    named.push(move)
  }
  if (named.length === 0) return null
  return named[Math.min(2, named.length - 1)]
}
