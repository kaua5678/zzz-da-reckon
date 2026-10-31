/**
 * 推荐配装 · 队友暴击接线（2026-10-29）。
 *
 * 用户口径：「推荐配装接一下队友暴击……接了更真实。不然给别人溢出了别人看着也奇怪。」——默认配装是
 * 别人第一眼看到的东西，队友给的暴击（本 1121 额外能力 +16%）必须进「百暴」基线，否则推荐分配会把
 * 暴击词条填到溢出（实测般岳 + 本：修前 113.8%）。
 *
 * 实现 = 端口注册（store 侧只留一个不依赖编排层的钩子，见 `stores/config.ts#setRecommendationTeamPanelResolver`）：
 * 本模块把**与伤害管线同源**的 `resolveSlotPanelBuffInputs`（5 步加工）包成解析器装上去。
 * 这样 store 内部的所有调用点（`setAgent` / `applyTeamPreset` / 预算 watcher / 默认队伍初始化）
 * 与编排层的装配链（`applyTeamToStore` / `applyTeamPresetConfig` / `applyDeployConfig`）同时生效，
 * 不需要在 7 个调用点各补一次「装配后重算」。
 *
 * 安装点：`src/main.ts`（应用启动）+ `src/test/harness.ts`（判据与生产同口径）。
 * 不安装 = 旧口径（推荐配装只算角色自身面板），行为逐位不变——这是有意保留的降级路径，
 * 免得「没装」与「装了但解析为空」两种状态在读数上不可分辨。
 */
import { getActivePinia } from 'pinia'
import { useCatalogStore } from '@/stores/catalog'
import { setRecommendationTeamPanelResolver, useConfigStore } from '@/stores/config'
import { buildMechanicTeamMembers, resolveSlotPanelBuffInputs } from '@/composables/resourceCalc/panelPhases'
import { buildSourcePanelsBySlot } from '@/core/sourcePanels'

/** 幂等安装（重复调用只覆盖同一个解析器） */
export function installTeamAwareBuildRecommendation(): void {
  setRecommendationTeamPanelResolver((slot) => {
    // ⚠ 必须先确认有 active pinia：`createConfigModel` 支持**无 pinia**的显式装配
    // （stores/__tests__/configModel.test.ts「没有 active Pinia 时仍能装配」），那种上下文里
    // `useConfigStore()` 会直接抛 "no active Pinia" 并把整套装配打断。无 pinia ⇒ 退回旧口径
    // （推荐配装只算角色自身面板）——那里本来也取不到目录 / 队友 buff 选择。
    if (!getActivePinia()) return undefined
    const config = useConfigStore()
    const catalog = useCatalogStore()
    if (!config.team[slot]?.agentId) return undefined
    const setInfo = resolveSlotPanelBuffInputs(slot, config, catalog)
    return {
      teammateBuffs: setInfo.teammateBuffs,
      sourcePanelsByOwner: setInfo.sourcePanelsByOwner,
      effectCoverageMap: setInfo.effectCoverageMap,
      // panelHooks 要的是**槽位键控**的那份视图，与 `computePanelPhases` 同一份表同一实例
      sourcePanels: buildSourcePanelsBySlot(setInfo.sourcePanelsByOwner, buildMechanicTeamMembers(config, catalog)),
    }
  })
}
