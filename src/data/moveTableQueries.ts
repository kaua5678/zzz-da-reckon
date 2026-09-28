/**
 * 倍率表只读查询（招式查找 / 行值 / 融合行值 / 平A 第 3 段挑选）——**定义落点**。
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
 * 四个符号的传递依赖不进入编排层：`getRowFusionMultiplier`（`logicEditor/fusion`）
 * + `moveFusionByMoveId`（`data/moveFusions`，零 import）+ 类型。fusion 以 Vue shallowRef 发布
 * 有效快照的失效信号，供 computed 消费者更新；不导入 store/编排层，也不读未生效草稿。
 * `core/resource.ts` 早已 import `@/data/moveFusions` ⇒ 「core → data」有先例，无应用层成环风险。
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

/**
 * 从 SkillMove 的 rows 中提取指定 row 的值——**含逻辑编辑器行规则乘数**（`logicEditor/fusion`）。
 *
 * ⚠ 行规则不只是用户覆盖：**spec 可声明默认启用的规则**（`specs/agents/*.json#rowFusions` →
 * `logicEditor/defaults.ts`，生产开箱即生效；测试 harness 不实例化逻辑编辑器 store ⇒ 测试态规则为空）。
 * 取值默认用本函数；模块**自己按分段原始倍率算融合**、而默认规则已为编辑器展示表达了同一融合时，用 `rawRowValue`。
 */
export function getRowValue(move: SkillMove | null | undefined, rowId: string): number {
  if (!move) return 0
  const row = move.rows.find(r => r.id === rowId)
  return (row?.values[0] ?? 0) * getRowFusionMultiplier(move.id, rowId)
}

/**
 * 倍率表**原始**行值（不乘逻辑编辑器行规则）。仅用于「模块内按分段原始倍率自算融合」的场景，防止与默认启用的
 * 同义行规则重复计入。现存用例：焰烈 1171 搅拌式 = Blend#1×0.5 + Blend#2，而 spec 规则 `burnice_stirring_fusion`
 * （1171007/damage ×1.2689，enabled）在编辑器里表达同一融合（CC-238：CC-237 曾把此处误并入 getRowValue，
 * 生产态搅拌式倍率 591.4% → ≈716.7%）。新增用例须在调用点注释写明对应的默认规则 id。
 */
export function rawRowValue(move: SkillMove | null | undefined, rowId: string): number {
  if (!move) return 0
  return move.rows.find(r => r.id === rowId)?.values[0] ?? 0
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

/**
 * 按招式 id 取招式（分类顺序中的第一个）——**单一来源**（CC-236：此前 25 个角色模块各抄一份）。
 * 结构化泛型签名：`AgentSkills`、`{ categories: { moves: SkillMove[] }[] }` 或更窄的招式形状都能传入。
 */
export function findMoveById<M extends { id: string } = SkillMove>(
  skills: { readonly categories: readonly { readonly moves: readonly M[] }[] } | undefined,
  moveId: string,
): M | null {
  // 运行时容错缺 categories / moves（原 nangong / StunAxisPage 副本的语义；夹具与不完整数据返回 null 而非抛错）
  for (const cat of skills?.categories ?? []) {
    const move = (cat.moves ?? []).find(m => m.id === moveId)
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

/**
 * 某普攻段所在「同名 `#N` 连段」打满一整套的动作时长（秒）——CC-195。
 *
 * 为什么需要：引擎把普攻合成**一条**汇总行（`moveId: 'basic_attack'`，count=0、按时长，倍率取基准段秒均），
 * 模块按段 id 数命中（千夏 #4 标记、佩洛伊斯余晖日珥）永远数不到。统一口径：汇总时长里每打满一整套
 * 同名连段出一次该段 ⇒ 命中次数 = floor(`basicSummarySeconds(executions)` / 本值)。
 *
 * 同名 = 去掉 ` #N` 后中文名（缺则英文名）相同；只计 basic 分类里 `actionTime > 0` 的段。
 * 找不到该段或它不带 `#N` 时返回 0（调用方按「无折算」处理）。
 */
export function basicComboCycleSeconds(skills: AgentSkills | undefined, moveId: string): number {
  const basic = skills?.categories.find(c => c.id === 'basic')
  if (!basic) return 0
  const stem = (m: SkillMove): string | null => {
    const name = m.name?.zhCN || m.name?.en || ''
    const hit = name.match(/^(.*?)\s*#\d+\s*$/)
    return hit ? hit[1] : null
  }
  const target = basic.moves.find(m => m.id === moveId)
  const key = target ? stem(target) : null
  if (!key) return 0
  let total = 0
  for (const m of basic.moves) {
    if (stem(m) === key && (m.actionTime ?? 0) > 0) total += m.actionTime ?? 0
  }
  return total
}
