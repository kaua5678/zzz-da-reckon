/**
 * 队友 buff 来源上下文：从 config/catalog 两个 store 组装 `buildTeammateBuffSourceContext` 的依赖（CC-49，2026-09-27）。
 *
 * 为什么放编排层：TeamConfigPage.vue 与 ImpactChart.vue 原来各写一份**逐字相同**的依赖组装
 * （catalog 的 buff 组 / 套装表 / 属性规则 / getAgent / getWEngine + config 的 buff 开关 / 敌人弱点），
 * 且直接 import 引擎（判据 7）。收拢后「依赖从哪取」只剩这一处。
 *
 * ⚠ 不适用于 `resourceCalc/panelPhases.ts`：那里用 `agentsMap.get` 与**快照过的** `teammateBuffEnabledOf(buffSelections, …)`，
 *    是热路径上的有意写法；也不适用于 `stores/config.ts`（store 层不反向依赖 composables）。
 */
import { buildTeammateBuffSourceContext } from '@/core/teammateBuffSource'
import type { useConfigStore } from '@/stores/config'
import type { useCatalogStore } from '@/stores/catalog'

export function teammateBuffSourceContextFromStores(
  configStore: ReturnType<typeof useConfigStore>,
  catalogStore: ReturnType<typeof useCatalogStore>,
): ReturnType<typeof buildTeammateBuffSourceContext> {
  return buildTeammateBuffSourceContext(configStore.team, {
    teammateBuffGroups: catalogStore.teammateBuffGroups,
    driveDiscSetsMap: catalogStore.driveDiscSetsMap,
    statRules: catalogStore.statRules,
    getAgent: (id) => catalogStore.getAgent(id),
    getWEngine: (id) => catalogStore.getWEngine(id),
    isTeammateBuffEnabled: (id) => configStore.isTeammateBuffEnabled(id),
    enemyWeakness: configStore.enemy.weakness,
  })
}
