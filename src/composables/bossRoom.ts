/**
 * Boss 房间上下文的唯一写入口（CC-342，arena-D 第 363 轮）。
 *
 * 「房间上下文」= 一次求值所在的那一关：敌人参数（store `applyBossPreset`）+ 该 Boss 当期的关卡固有 buff
 * （`layer_buff`，写进全局 Buff 表、前缀 `layer-buff:`）。分析与调用点普查见 `docs/mcp-boss-room-context.md` §1.2 / §3。
 *
 * 修前 `applyBossPreset` 的调用方各自决定要不要写关卡 buff：Boss 选择卡、实战部署、菲林模拟写；抽卡规划、
 * 角色兑现曲线收了 `periodViews` 却从不读（只切敌人，用户现场上一个 Boss 的 `layer-buff:` 行泄漏到每一房）。
 * brief 查找也有两套写法（普通 + 困难 / 困难 + 普通，其中一套多一个从未命中的 monsterId 兜底）。
 *
 * 当期可选牌（`period-buff:` / `phase-buff:`）不归这里管：它是玩家的选择，由各页面自己的口径决定。
 * 不要把本函数并进 store 的 `applyBossPreset`：store 拿不到 `phaseViews`，也不该持有展示数据。
 */
import type { BossPreset, BossPresetPhase, PhaseBossBrief, PhaseView } from '@/types/bossPreset'
import type { useConfigStore } from '@/stores/config'
import { phaseBuffRows } from '@/utils/phaseBuff'

/**
 * 某期某 Boss 的关卡简览。`(phaseId, presetId)` 唯一定位一个 brief（数据普查：159 个 brief 全有 presetId，
 * 每个预设内 phaseId 不重复）。期视图缺失或该期没有这个 Boss ⇒ null。
 */
export function findBossBrief(phaseViews: readonly PhaseView[], phaseId: string, presetId: string): PhaseBossBrief | null {
  const view = phaseViews.find(v => v.phaseId === phaseId)
  if (!view) return null
  const briefs = [...(view.criticalAssault ? [view.criticalAssault] : []), ...(view.defense ?? [])]
  return briefs.find(b => b.presetId === presetId) ?? null
}

/**
 * 写关卡固有 buff（layer_buff）：先清旧（前缀 `layer-buff:`），再写给定 brief 的。brief 为 null ⇒ 只清不写。
 * CC-341：牌 → 行走唯一映射 `phaseBuffRows`，`cond`（特性限定 / 人数分档）随行写入、由管线按当前队伍解析。
 */
export function applyBossLayerBuffs(
  configStore: ReturnType<typeof useConfigStore>,
  brief: PhaseBossBrief | null,
): void {
  for (let i = configStore.globalBuffs.length - 1; i >= 0; i--) {
    if (String(configStore.globalBuffs[i].id).startsWith('layer-buff:')) configStore.globalBuffs.splice(i, 1)
  }
  if (!brief) return
  for (const card of brief.bossBuffs ?? []) {
    configStore.globalBuffs.push(...phaseBuffRows(card, e => `layer-buff:${brief.monsterId}:${e.stat}:${e.value}`, `关卡·${brief.name}`))
  }
}

/**
 * 进入一个 Boss 房间：敌人参数 + 该期关卡固有 buff。返回写入所用的 brief（没有则 null，此时旧的 `layer-buff:` 行已清掉）。
 * 所有「切到某期某 Boss 再求值」的地方都应走这里，而不是只调 `applyBossPreset`。
 */
export function applyBossRoom(
  configStore: ReturnType<typeof useConfigStore>,
  boss: BossPreset,
  phase: BossPresetPhase,
  phaseViews: readonly PhaseView[],
): PhaseBossBrief | null {
  configStore.applyBossPreset({ id: boss.id }, phase, boss.monster, boss.defaults)
  const brief = findBossBrief(phaseViews, phase.phaseId, boss.id)
  applyBossLayerBuffs(configStore, brief)
  return brief
}
