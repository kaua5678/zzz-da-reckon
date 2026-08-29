/**
 * 实战对比部署：把 runArchiveImport 的 DeployConfig 写进 configStore，触发一轮「理论理想」计算。
 *
 * 口径（与 teamTimeline.applyTeamToStore 的交互基准同源）：
 * - 配装缺口 = 计算器默认理想配装：applyTeamPreset → 专属音擎推荐 + 推荐驱动盘 + 最优副词条 + 技能全满。
 * - 交互基准：不预设弹刀——弹刀由「保底4失衡（Boss 预设反推）+ 保底4喧响（喧响缺口÷215）」运行时反推；
 *   闪反/快支保留固定基准（闪反10 / 快支3）作为喧响基础供给；连携基准 1（轴模式由轴内连携块反推覆盖）。
 * - Boss：applyBossPreset 应用期相位血量/失衡/防御/三表抗性（分期数决定血量膨胀），并写关卡固有 layer_buff。
 * - 当期可选牌（3 选 1）不自动应用：归档未记录玩家选择，对比时由用户在属性配置页手动选。
 */
import type { BossPreset, BossPresetMonster, BossPresetDefaults, BossPresetPhase, PhaseBossBrief, PhaseView } from '@/types/bossPreset'
import { getInteractionDefaults, useConfigStore } from '@/stores/config'
import type { BossMatch, DeployConfig } from '@/composables/runArchiveImport'

export interface ResolvedBossApply {
  preset: BossPreset
  phase: BossPresetPhase
  monster: BossPresetMonster
  defaults: BossPresetDefaults
  /** 当期关卡简览（含 bossBuffs），用于写关卡固有 layer_buff；无 view 时 null */
  brief: PhaseBossBrief | null
}

/** 从 boss-presets 解析出 applyBossPreset 所需的完整参数（预设 + 期相位 + 怪物本体 + 默认值 + 关卡 brief）。 */
export function resolveBossApply(
  boss: BossMatch,
  presets: BossPreset[],
  phaseViews: PhaseView[],
): ResolvedBossApply | null {
  const preset = presets.find((p) => p.id === boss.presetId)
  if (!preset) return null
  const phase = boss.phaseId ? preset.phases.find((p) => p.phaseId === boss.phaseId) : undefined
  if (!phase) return null
  const view = phaseViews.find((v) => v.phaseId === phase.phaseId)
  const briefs = view ? [...(view.defense ?? []), ...(view.criticalAssault ? [view.criticalAssault] : [])] : []
  const brief = briefs.find((b) => b.presetId === preset.id || String(b.monsterId) === preset.id) ?? null
  return { preset, phase, monster: preset.monster, defaults: preset.defaults, brief }
}

/** 写关卡固有 buff（layer_buff）：先清旧（前缀 layer-buff:），再写当前 Boss 的。debt: 与 BossSelectCard.applyBoss 内联逻辑重复，可未来提取合并。 */
export function applyBossLayerBuffs(
  configStore: ReturnType<typeof useConfigStore>,
  brief: PhaseBossBrief | null,
): void {
  for (let i = configStore.globalBuffs.length - 1; i >= 0; i--) {
    if (String(configStore.globalBuffs[i].id).startsWith('layer-buff:')) configStore.globalBuffs.splice(i, 1)
  }
  if (!brief) return
  for (const card of brief.bossBuffs ?? []) {
    for (const e of card.effects) {
      configStore.globalBuffs.push({
        id: `layer-buff:${brief.monsterId}:${e.stat}:${e.value}`,
        name: `关卡·${brief.name}`,
        stat: e.stat,
        value: e.value,
        enabled: true,
        targetSkillType: (e.targetSkillType ?? 'all') as never,
      })
    }
  }
}

/** 一键部署：队伍（命座/音擎/精炼/交互基准） + Boss（期相位 + layer_buff）。 */
export function applyDeployConfig(
  configStore: ReturnType<typeof useConfigStore>,
  deploy: DeployConfig,
  presets: BossPreset[],
  phaseViews: PhaseView[],
): void {
  configStore.applyTeamPreset(deploy.team.map((s) => s.agentId) as [string, string, string])

  // 交互基准（2026-08 修订）：不预设弹刀——弹刀由「保底4失衡（Boss 预设反推）+ 保底4喧响（喧响缺口÷215）」运行时反推；
  // 闪反/快支保留固定基准（闪反10 / 快支3）作为喧响基础供给；连携基准 1（轴模式由轴内连携块反推覆盖）。
  for (let s = 0; s < 3; s++) {
    const slot = deploy.team[s]
    configStore.setCinemaLevel(s, slot.cinemaLevel)
    configStore.setWEngineModLevel(s, slot.wEngineModLevel)
    if (slot.wEngineId) configStore.setWEngine(s, slot.wEngineId)

    const defs = getInteractionDefaults(slot.agentId)
    const hasCustom = defs.parry > 0 || defs.dodge > 0 || defs.block > 0 || defs.dual > 0
    configStore.setParryCount(s, hasCustom ? defs.parry : 0)
    configStore.setDodgeCounterCount(s, hasCustom ? defs.dodge : 10)
    configStore.setBlockCount(s, hasCustom ? defs.block : 0)
    configStore.setDualCounterCount(s, hasCustom ? defs.dual : 0)
    configStore.setQuickAssistCount(s, 3)
    configStore.setChainCountPerStun(s, 1)
  }

  // 启用自动轴 + 保底4喧响（弹刀反推的两个驱动）；保底4失衡由 applyBossPreset 按 Boss 预设自动勾选。
  configStore.autoYidhariAxis = true
  configStore.stunAxes.splice(0)
  configStore.stunAxisPlans.splice(0)
  configStore.setMechanicSetting('guarantee.ultimate', 1)

  if (deploy.boss) {
    const resolved = resolveBossApply(deploy.boss, presets, phaseViews)
    if (resolved) {
      configStore.applyBossPreset({ id: resolved.preset.id }, resolved.phase, resolved.monster, resolved.defaults)
      applyBossLayerBuffs(configStore, resolved.brief)
    }
  }
}