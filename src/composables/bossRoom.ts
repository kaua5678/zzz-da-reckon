/**
 * Boss 房间上下文的唯一写入口（CC-342：arena-D 第 363 轮立入口，第 364 轮让关卡 buff 随 phase 数据走）。
 *
 * 「房间上下文」= 一次求值所在的那一关：敌人参数（store `applyBossPreset`）+ 敌方体型（CC-350）+ 该 Boss 当期的关卡固有 buff
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

/** 未录入体型的 Boss 按中型（用户口径 2026-09-05；体型表 = scripts/import-nanoka-bosses.mjs `BOSS_BODY_SIZES`） */
export const DEFAULT_BOSS_BODY_SIZE = 'medium' as const

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
  // CC-350：体型是 Boss 的属性，随房间一起写。修前只有 TeamComparePage 的页面 watcher 写（写的还是 UI store），
  // 主计算器选 Boss 不写、其余分析器的场景继承「用户上次在队伍对比页选过的 Boss」的体型 ⇒ 艾莲 / 苍角等体型相关招式随导航史变。
  // 手动改体型照旧在下次进房间前保持（与 HP / 防御等房间参数同口径）。
  configStore.setEnemy({ bodySize: boss.bodySize ?? DEFAULT_BOSS_BODY_SIZE })
  applyBossLayerBuffs(configStore, boss, phase)
}
