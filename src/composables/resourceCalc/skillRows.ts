/**
 * 招式行取值簇（自 `resourceCalc/helpers.ts` 整段迁出 —— R22 熵批 2 / R22-S2 刀 B，**纯搬迁**）。
 *
 * 职责（一个域：**从 `AgentSkills` 的倍率表里取值**）：
 *   ① 行值提取 `getRowValue` + 倍率融合 `fusedRowValue`（`data/moveFusions.ts` 单一事实源）
 *      —— ⚠ 2026-09-19 round 37 起**定义已下沉 `data/moveTableQueries.ts`**（连同 `findMoveById` /
 *      `pickThirdNamedBasicSegment`，共 4 个纯查询），本文件只留 import + export 两行壳，见下。
 *   ② 招式查找 `findMoveById`（壳）/ `findMoveByEnglishName` + 平A基准段挑选
 *      `pickThirdNamedBasicSegment`（壳）/ `getBasicComboMoves` / `averageBasicRows`
 *   ③ 行分类与派生量 `isHealingRow` / `getHealingAmount` / `getSpecialResourceRecovery`
 *   ④ 元素 → 面板键映射表 `ELEMENT_DMG_KEYS` / `ELEMENT_DEF_REDUCTION_KEYS` / `ELEMENT_RES_REDUCTION_KEYS`
 *
 * 迁移纪律：逐字节剪切，算式/常量值/条件/求值顺序零改动（搬迁的两段在源文件里不连续，
 * 中间隔着 D 簇「异常虚拟面板」——本刀**只**取 C 簇，不碰 D 簇）。
 * 上游单一入口仍是 `./helpers`（该文件保留 re-export 壳）⇒ 目录外既有消费者与 66 个测试的 import 零改动。
 *
 * ⚠ 落点必须是 `resourceCalc/` **目录直属**的 `.ts`：子目录会整类逃出
 * `listAgentBranchFiles()` 的 agentId 棘轮度量面（`scripts/check-guards.mjs`；R22 分诊 §3 闸门 4 实测）。
 * ⚠ 与 `./helpers` 的关系：`./helpers` 经本文件的 re-export 壳把 `getRowValue` / `fusedRowValue` /
 * `findMoveById` 等 14 个符号给它的下游（`buildCharConfig` 的平A基准段、`extractSkillExecutions`
 * 的招式查表）用。**本文件对 `./helpers` 零出边** ⇒ 无环、无 TDZ 风险。
 *
 * ⚠ 为什么 4 个纯查询要再下沉一层到 `src/data/`（round 37，OPEN-ITEMS R35-J2）：录入层
 * `mechanics/agents/claret.ts` 需要 `pickThirdNamedBasicSegment` / `fusedRowValue`，而录入层
 * **值导入编排层**是全仓唯一一条反向边（8 模块 SCC）。`src/data/` 是三层都可依赖的公共底
 * （先例 `sharpCritMultiplier`），判据 19 `layer-inversion` 盯着录入层不再值导入 `composables`。
 */
import type { useCatalogStore } from '@/stores/catalog'
import type { AgentSkills, SkillMove } from '@/types/catalog'
import type { SkillExecution } from '@/types/resource'

// ---- 4 个纯查询的定义在 `data/moveTableQueries.ts`（2026-09-19 round 37 下沉），这里是壳 ----
// ⚠ 必须写成「import + export」两行——`export { … } from` **不建本地绑定**，而下方
//   `getBasicComboMoves`（调 `pickThirdNamedBasicSegment`）/ `averageBasicRows`（调 `getRowValue`）
//   需要本地绑定（与 `./helpers` 壳同一教训：刀 A 实测 `ReferenceError` / `vue-tsc` TS2304）。
// ⚠ 改这 4 个函数请去 `data/moveTableQueries.ts`，不要在本文件重建同形函数。
import { getRowValue, fusedRowValue, findMoveById, pickThirdNamedBasicSegment } from '@/data/moveTableQueries'
export { getRowValue, fusedRowValue, findMoveById, pickThirdNamedBasicSegment }

export const ELEMENT_DMG_KEYS: Record<string, string> = {
  physical: 'physicalDmg',
  fire: 'fireDmg',
  ice: 'iceDmg',
  electric: 'electricDmg',
  ether: 'etherDmg',
  wind: 'windDmg',
  lumiflux: 'lumifluxDmg',
  physical_polar_assault: 'physicalDmg',  // 物理变种，使用物理增伤
}

export const ELEMENT_DEF_REDUCTION_KEYS: Record<string, string> = {
  physical: 'enemyPhysicalDefReduction',
  fire: 'enemyFireDefReduction',
  ice: 'enemyIceDefReduction',
  electric: 'enemyElectricDefReduction',
  ether: 'enemyEtherDefReduction',
  wind: 'enemyWindDefReduction',
  lumiflux: 'enemyLumifluxDefReduction',
  physical_polar_assault: 'enemyPhysicalDefReduction',  // 物理变种
}

export const ELEMENT_RES_REDUCTION_KEYS: Record<string, string> = {
  physical: 'enemyPhysicalResReduction',
  fire: 'enemyFireResReduction',
  ice: 'enemyIceResReduction',
  electric: 'enemyElectricResReduction',
  ether: 'enemyEtherResReduction',
  wind: 'enemyWindResReduction',
  lumiflux: 'enemyLumifluxResReduction',
  physical_polar_assault: 'enemyPhysicalResReduction',  // 物理变种
}

export function isHealingRow(row: any): boolean {
  const id = String(row.id ?? '').toLowerCase()
  const kind = String(row.kind ?? '').toLowerCase()
  const label = `${row.label?.zhCN ?? ''}${row.label?.en ?? ''}`.toLowerCase()
  return id.includes('heal') || id.includes('hp_recover') || id.includes('hp_recovery')
    || kind.includes('heal') || label.includes('治疗') || label.includes('回血') || label.includes('生命回复')
}

export function getHealingAmount(move: SkillMove): number {
  let total = 0
  for (const row of move.rows as any[]) {
    if (!isHealingRow(row)) continue
    total += row.values?.[0] ?? 0
  }
  return total
}

export function getSpecialResourceRecovery(move: SkillMove): number {
  // 专属资源回复：attack_data_0（kind=special 第一行 = 席德钢能/比利决意/青衣电压/普罗米娅寒蚀）。
  // attack_data_1/2… 是其他通道（如回血），不混入本字段；观察：attack_data_0 秒均 ≈ 11（钢能）。
  for (const row of move.rows as any[]) {
    if (String((row as any).kind ?? '') === 'special') {
      return row.values?.[0] ?? 0
    }
  }
  // 兜底：非标准 recovery 行（旧式专属回复）求和
  let total = 0
  for (const row of move.rows as any[]) {
    const id = String(row.id ?? '')
    if (!id.includes('recovery')) continue
    if (id === 'energy_recovery' || id === 'decibel_recovery') continue
    if (isHealingRow(row)) continue
    total += row.values?.[0] ?? 0
  }
  return total
}

export function findMoveByEnglishName(skills: AgentSkills | undefined, englishName: string): SkillMove | null {
  if (!skills) return null
  for (const cat of skills.categories) {
    const move = cat.moves.find(m => m.name?.en === englishName || m.name?.zhCN === englishName)
    if (move) return move
  }
  return null
}

/**
 * 平A基准段硬编码 override。
 * key = agentId（catalog id），value = 使用的 moveId。
 * 不在此映射的角色默认取第 3 段（index 2），不足 3 段取最后一段。
 */
export const BASIC_BENCHMARK_OVERRIDE: Record<string, string> = {
  // 在此填入需要特殊基准段的角色，如 '1401': '1401003'
}

/**
 * 获取平A基准段（单段，秒均化）。
 * 优先：catalog agent.basicBenchmarkMoveId（数据配置）→ 硬编码 override 兜底 → 默认第 3 段（#3）；不足 3 段取最后一段。
 */
export function getBasicComboMoves(
  skills: AgentSkills | undefined,
  agentId?: string,
  catalogStore?: ReturnType<typeof useCatalogStore>,
): SkillMove | null {
  const basic = skills?.categories.find(c => c.id === 'basic')
  if (!basic) return null

  // 1. 收集所有 #N 段（排除 dash/dodge），数组顺序 = 原始顺序（#1,#2,#3...）
  const all: SkillMove[] = []
  for (const move of basic.moves) {
    const name = move.name?.en || ''
    if (!name.match(/#\d+/)) continue
    if (name.toLowerCase().includes('dash') || name.toLowerCase().includes('dodge')) continue
    if (!move.actionTime || move.actionTime <= 0) continue
    all.push(move)
  }
  if (all.length === 0) return null

  // 2. 数据配置优先（catalog agent.basicBenchmarkMoveId）
  if (agentId && catalogStore) {
    const dataId = catalogStore.getAgent(agentId)?.basicBenchmarkMoveId
    if (dataId) {
      const found = all.find(m => m.id === dataId)
      if (found) return found
    }
  }

  // 3. 硬编码 override 兜底
  if (agentId && BASIC_BENCHMARK_OVERRIDE[agentId]) {
    const overrideId = BASIC_BENCHMARK_OVERRIDE[agentId]
    const found = all.find(m => m.id === overrideId)
    if (found) return found
  }

  // 4. 默认第 3 段（index 2），不足取末尾
  return pickThirdNamedBasicSegment(all)
}

export function averageBasicRows(
  skills: AgentSkills | undefined,
  agentId?: string,
  catalogStore?: ReturnType<typeof useCatalogStore>,
): Partial<SkillExecution> {
  const move = getBasicComboMoves(skills, agentId, catalogStore)
  if (!move) return {}
  const at = move.actionTime ?? 1

  const s = (rowId: string) => getRowValue(move, rowId) / at
  return {
    damageMultiplier: s('damage'),
    dazeMultiplier: s('daze'),
    anomalyBuildUp: s('anomaly_buildup'),
    specialResourceRecovery: getSpecialResourceRecovery(move) / at,
    healingAmount: getHealingAmount(move) / at,
    skillTableResolved: true,
    skillTableNote: '平A按基准段（默认#3）秒均 × 平A时间计算（只打该段）。',
  }
}

// ============================================================================
// 本簇 14 个公开符号在 `./helpers.ts` 保留 **re-export 壳**（R22 熵批 2 / R22-S2 刀 B）：
// 目录外的既有消费者（`components` / `views` / 测试）import 路径零改动。
// ⚠ 必须写成「import + export」两行——`export { … } from './skillRows'` **不建本地绑定**，
//   而 `helpers.ts` 下游（`buildCharConfig` / `extractSkillExecutions`）需要本地绑定
//   （刀 A 实测 `ReferenceError: findForbiddenTracked is not defined` / `vue-tsc` TS2304）。
// ⚠ 改招式行取值请改本文件（4 个纯查询改 `data/moveTableQueries.ts`），**不要回 `helpers.ts`
//   重建同形函数**（那会分裂单一事实源）。录入层（`mechanics/agents/*`）**不得**值导入本目录
//   （判据 19 `layer-inversion`），要纯查询去 `@/data/moveTableQueries`。
// ============================================================================
