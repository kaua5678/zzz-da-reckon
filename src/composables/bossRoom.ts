/**
 * Boss 房间上下文的唯一写入口（CC-342：arena-D 第 363 轮立入口，第 364 轮让关卡 buff 随 phase 数据走）。
 *
 * 「房间上下文」= 一次求值所在的那一关：敌人参数（store `applyBossPreset`）+ 该 Boss 当期的关卡固有 buff
 * （`layer_buff`，写进全局 Buff 表、前缀 `layer-buff:`）。分析与调用点普查见 `docs/mcp-boss-room-context.md`。
 *
 * 关卡 buff 的数据源 = `BossPresetPhase.layerBuffs`（`scripts/import-nanoka-bosses.mjs` 生成时把该期该 Boss 的
 * layer_buff 解析结果挂到预设 phase 上；与期视图 brief 的 `bossBuffs` 同一次解析、同一份数据）。
 * 第 363 轮的版本要调用方传 `phaseViews` 再按 `(phaseId, presetId)` 查 brief ⇒ 每个分析器都得把期视图一路传下来，
 * 忘传就静默没有关卡 buff（抽卡规划、角色兑现曲线修前正是这样）。现在「拿到 phase 就拿到了这一关」，不再需要查表。
 *
 * 当期可选牌（`period-buff:` / `phase-buff:`）不归这里管：它是玩家的选择，由各页面自己的口径决定。
 * 源码锁（`__tests__/bossRoom.test.ts`）：`.applyBossPreset(` 只允许出现在本文件。
 */
import type { BossPreset, BossPresetPhase } from '@/types/bossPreset'
import type { ConfigModel } from '@/stores/config'
import { phaseBuffRows } from '@/utils/phaseBuff'

export const LAYER_BUFF_PREFIX = 'layer-buff:'

/**
 * 写关卡固有 buff：先清旧（前缀 `layer-buff:`），再写该 phase 的 `layerBuffs`。phase 没有（缺数据 / 测试桩）⇒ 只清不写。
 * CC-341：牌 → 行走唯一映射 `phaseBuffRows`，`cond`（特性限定 / 人数分档）随行写入、由管线按当前队伍解析。
 */
export function applyBossLayerBuffs(
  configStore: ConfigModel,
  boss: Pick<BossPreset, 'id' | 'name'>,
  phase: Pick<BossPresetPhase, 'phaseId' | 'layerBuffs'>,
): void {
  for (let i = configStore.globalBuffs.length - 1; i >= 0; i--) {
    if (String(configStore.globalBuffs[i].id).startsWith(LAYER_BUFF_PREFIX)) configStore.globalBuffs.splice(i, 1)
  }
  for (const card of phase.layerBuffs ?? []) {
    configStore.globalBuffs.push(...phaseBuffRows(card, e => `${LAYER_BUFF_PREFIX}${boss.id}:${phase.phaseId}:${e.stat}:${e.value}`, `关卡·${boss.name}`))
  }
}

/**
 * 进入一个 Boss 房间：敌人参数 + 该期关卡固有 buff。
 * 所有「切到某期某 Boss 再求值」的地方都走这里，而不是只调 `applyBossPreset`。
 */
export function applyBossRoom(
  configStore: ConfigModel,
  boss: BossPreset,
  phase: BossPresetPhase,
): void {
  configStore.applyBossPreset({ id: boss.id }, phase, boss.monster, boss.defaults)
  applyBossLayerBuffs(configStore, boss, phase)
}
