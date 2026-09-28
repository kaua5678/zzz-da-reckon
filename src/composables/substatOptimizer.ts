/**
 * 副词条优化器（单槽）：从 config/catalog 两个 store 组装 `computeOptimalSubStats` 的全部入参并算出副词条分配（CC-52，2026-09-27）。
 *
 * 为什么放编排层：原先 ImpactChart.vue `runOptimizerForSlot0` 在组件里直接 import 引擎
 * （`computeOptimalSubStats` + `getTemplate`，判据 7），并自己决定「模板 stat 数 → 步数配置键」
 * 「队友 buff 来源」「词条数夹到 0~54」这些计算口径。收拢后组件只负责把结果写回 store。
 *
 * 口径：逐行照搬原组件（2026-09-27 baceb72 版）；**第 194 轮起**队友 buff 输入改为与伤害管线同源（`resolveSlotPanelBuffInputs`），其余不变：
 * - 空槽 / 无角色 / catalog 查不到角色 ⇒ null；
 * - 引擎抛错 ⇒ null（原组件 `catch { skip }`，即不改分配）；
 * - `getTemplate` / 依赖组装在 try 之外（原样：它们抛错会向上冒泡）；
 * - 返回值只含 n>0 的键，且夹到 [0, 54]。调用方应**整体替换** `driveDisc.subStatAllocation`（原组件先置 {} 再逐键写，等价）。
 *
 * ⚠ 与 `stores/config.ts` 里的整队优化（:~800，同样按 totalSteps2/3/4 选键）是**两条独立路径**，本函数不替代它；
 *    store 层不反向依赖 composables。若日后要统一，两处步数口径需一起改。
 *    CC-173（第 198 轮）决定**不统一**：整队贪心只在用户关闭 optimizer.useDefault 时生效，允许与管线不同源，
 *    理由与重开条件见 stores/config.ts 该分支注释、docs/mcp-stun-dual-source.md §24.20。
 */
import { computeOptimalSubStats, getTemplate } from '@/core/substatOptimizer'
import type { DriveDiscConfig } from '@/types/catalog'
import type { useConfigStore } from '@/stores/config'
import type { useCatalogStore } from '@/stores/catalog'
import { resolveSlotPanelBuffInputs } from '@/composables/resourceCalc/panelPhases'

export function computeSubstatAllocationForSlot(
  slot: number,
  configStore: ReturnType<typeof useConfigStore>,
  catalogStore: ReturnType<typeof useCatalogStore>,
): DriveDiscConfig['subStatAllocation'] | null {
  const char = configStore.team[slot]
  if (!char?.agentId) return null
  const agent = catalogStore.getAgent(char.agentId)
  if (!agent) return null
  const wEngine = char.wEngineId ? catalogStore.getWEngine(char.wEngineId) : undefined
  // 第 194 轮：与伤害管线同一份队友 buff 输入（门控 / 接收槽过滤 / 全局 Buff / 覆盖率 / 来源修正），见 resolveSlotPanelBuffInputs
  const setInfo = resolveSlotPanelBuffInputs(slot, configStore, catalogStore)
  const tmpl = getTemplate(agent)
  const sc = tmpl.stats.length
  const tsk = sc <= 2 ? 'optimizer.totalSteps2' : sc === 3 ? 'optimizer.totalSteps3' : 'optimizer.totalSteps4'
  let result: ReturnType<typeof computeOptimalSubStats>
  try {
    result = computeOptimalSubStats({
      agent, wEngine,
      driveDiscConfig: char.driveDisc,
      setsMap: catalogStore.driveDiscSetsMap,
      teammateBuffs: setInfo.teammateBuffs,
      statRules: catalogStore.statRules,
      statCap: configStore.getMechanicSetting('optimizer.substatCap', 20),
      totalSteps: configStore.getMechanicSetting(tsk, 0),
      config: { cinemaLevel: char.cinemaLevel ?? 0, wEngineModLevel: char.wEngineModLevel ?? 1, potentialLevel: char.potentialLevel, sourcePanelsByOwner: setInfo.sourcePanelsByOwner, effectCoverageMap: setInfo.effectCoverageMap, enemyWeakness: configStore.enemy.weakness },
    })
  } catch {
    return null
  }
  const alloc: DriveDiscConfig['subStatAllocation'] = {}
  for (const [s, n] of Object.entries(result.subStatAllocation)) {
    if (n > 0) alloc[s] = Math.max(0, Math.min(54, n))
  }
  return alloc
}
