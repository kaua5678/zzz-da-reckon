/**
 * 实战对比部署：把 runArchiveImport 的 DeployConfig 写进 configStore，触发一轮「理论理想」计算。
 *
 * 口径（与 teamTimeline.applyTeamToStore 的交互基准同源）：
 * - 配装缺口 = 计算器默认理想配装：applyTeamPreset → 专属音擎推荐 + 推荐驱动盘 + 最优副词条 + 技能全满。
 * - 交互基准：不预设弹刀——弹刀由「保底4失衡（Boss 预设反推）+ 保底4喧响（四舍五入：缺口≤1500 补弹刀÷215，超过不硬凑）」运行时反推；
 *   闪反按职业基准（roleInteractionBaseline：支援/防护 0，其余 10）、快支固定 3 作为喧响基础供给；连携基准 1（轴模式由轴内连携块反推覆盖）。
 * - Boss：applyBossPreset 应用期相位血量/失衡/防御/三表抗性（分期数决定血量膨胀），并写关卡固有 layer_buff。
 * - 当期可选牌（3 选 1）不自动应用：归档未记录玩家选择，对比时由用户在属性配置页手动选。
 */
import type { BossPreset, BossPresetMonster, BossPresetDefaults, BossPresetPhase, PhaseBuffCard } from '@/types/bossPreset'
import { hasCustomInteractionDefaults, interactionBaselineFor, type ConfigModel } from '@/stores/config'
import { useCatalogStore } from '@/stores/catalog'
import type { BossMatch, DeployConfig } from '@/composables/runArchiveImport'
import { phaseBuffRows } from '@/utils/phaseBuff'
import { applyBossRoom } from '@/composables/bossRoom'
import { applyTeamToStore } from '@/composables/teamTimelineStore'
import type { AnalysisContext } from '@/composables/analysisScenario'

export interface ResolvedBossApply {
  preset: BossPreset
  phase: BossPresetPhase
  monster: BossPresetMonster
  defaults: BossPresetDefaults
}

/** 从 boss-presets 解析出 applyBossPreset 所需的完整参数（预设 + 期相位 + 怪物本体 + 默认值；关卡 buff 在 phase.layerBuffs 上）。 */
export function resolveBossApply(
  boss: BossMatch,
  presets: BossPreset[],
): ResolvedBossApply | null {
  const preset = presets.find((p) => p.id === boss.presetId)
  if (!preset) return null
  const phase = boss.phaseId ? preset.phases.find((p) => p.phaseId === boss.phaseId) : undefined
  if (!phase) return null
  return { preset, phase, monster: preset.monster, defaults: preset.defaults }
}

/**
 * 写当期可选 buff 牌（危局 3 选 1，period-buff: 前缀；先清旧）——实战对比部署页的
 * 快捷按钮用（归档未记录玩家选择，手动点选后写进全局 Buff 表参与计算，与 layer_buff 通道同源）。
 * 传 null 清除当前选择（回到「不用」口径）。返回是否已写入（effects 非空且非测试牌；带条件的行是否对当前队伍生效由管线判）。
 */
export function applyPeriodBuff(
  configStore: ConfigModel,
  phaseId: string,
  card: PhaseBuffCard | null,
): boolean {
  for (let i = configStore.globalBuffs.length - 1; i >= 0; i--) {
    if (String(configStore.globalBuffs[i].id).startsWith('period-buff:')) configStore.globalBuffs.splice(i, 1)
  }
  if (!card || card.testOnly) return false
  // CC-341：同 bossRoom#applyBossLayerBuffs，`cond` 随行写入（修前丢 cond ⇒ 「异常 2/3 名」按满编档、特性限定对任何队都生效）
  const rows = phaseBuffRows(card, e => `period-buff:${phaseId}:${e.stat}:${e.value}`, `当期·${card.title || '(未命名)'}`)
  configStore.globalBuffs.push(...rows)
  return rows.length > 0
}

/**
 * CC-352：当期牌「自动选择」= 在**独立场景**上逐一试「不用」+ 每张可用牌（测试牌 / 无数值效果的牌剔除），返回总伤害最高者
 * （`null` = 不用最好；并列取先出现的，基准「不用」排第一）。调用方 `withAnalysisScenario(s => pickBestPeriodBuff(s, …))`
 * 后再把结果 `applyPeriodBuff` 一次写进 UI store。
 * 修前 RunArchivePage 在 **UI store** 上逐张写牌 → `setTimeout(40)` → 读伤害：试牌期间页面闪、用户的全局 Buff 表被反复改写，
 * 且是 CC-343 / CC-347 宣布清零之后仍留在 view 里的「拿 UI store 当草稿纸」的分析循环（分析器源码锁只扫 composables，漏网）。
 */
export function pickBestPeriodBuff(
  ctx: AnalysisContext,
  phaseId: string,
  cards: readonly PhaseBuffCard[],
): PhaseBuffCard | null {
  const candidates = cards.filter(b => !b.testOnly && (b.effects ?? []).some(e => e.stat))
  if (candidates.length === 0) return null
  const damageWith = (card: PhaseBuffCard | null): number => {
    applyPeriodBuff(ctx.config, phaseId, card)
    return ctx.calc.teamTotalDamage.value
  }
  let best: PhaseBuffCard | null = null
  let bestDamage = damageWith(null)
  for (const card of candidates) {
    const d = damageWith(card)
    if (d > bestDamage) { bestDamage = d; best = card }
  }
  return best
}

/** 一键部署：队伍（命座/音擎/精炼/交互基准） + Boss（期相位 + layer_buff）。 */
export function applyDeployConfig(
  configStore: ConfigModel,
  deploy: DeployConfig,
  presets: BossPreset[],
): void {
  // 复用 teamTimelineStore#applyTeamToStore(autoBuild=true)：先写命座/精炼再调 applyTeamPreset，
  // 防止上一队残留命座/精炼漏入 applyBuildRecommendationForSlot 的百暴副词条分配与队友 buff 门控（CC-340 同源收口）。
  applyTeamToStore(
    configStore,
    deploy.team.map((s) => s.agentId) as [string, string, string],
    {
      cinemas: [deploy.team[0].cinemaLevel, deploy.team[1].cinemaLevel, deploy.team[2].cinemaLevel],
      wengineMods: [deploy.team[0].wEngineModLevel, deploy.team[1].wEngineModLevel, deploy.team[2].wEngineModLevel],
      wEngines: [deploy.team[0].wEngineId ?? '', deploy.team[1].wEngineId ?? '', deploy.team[2].wEngineId ?? ''],
    },
    true,
  )

  // 交互基准（2026-08-30 修订；2026-08-31 喧响改四舍五入）：不预设弹刀——弹刀由
  // 「保底4失衡（Boss 预设反推）+ 保底4喧响（缺口≤1500 才补弹刀，超过=实战打不出不硬凑）」运行时反推；
  // 闪反按职业基准（roleInteractionBaseline：支援/防护 0 交互，其余 10；辅助不上场打闪反），
  // 快支固定 3 作为喧响基础供给；连携基准 1（轴模式由轴内连携块反推覆盖）。
  for (let s = 0; s < 3; s++) {
    const slot = deploy.team[s]
    // CC-255：基准取 interactionBaselineFor（含 noGenericInteraction）；本口径「不预设弹刀」⇒ 非专属角色只取闪反
    const custom = hasCustomInteractionDefaults(slot.agentId)
    const base = interactionBaselineFor(slot.agentId, useCatalogStore().getAgent(slot.agentId)?.specialty)
    // CC-266：闪反 / 快支 / 连携与 setAgent 预填相同（applyTeamPreset 已调 setAgent），这里只写**本口径的偏差**：
    // 非专属角色不预设弹刀 / 格挡 / 双反（运行时反推）。
    configStore.setActionCount(s, 'parryCount', custom ? base.parry : 0)
    configStore.setActionCount(s, 'blockCount', custom ? base.block : 0)
    configStore.setActionCount(s, 'dualCounterCount', custom ? base.dual : 0)
  }

  // 启用自动轴 + 保底4喧响（弹刀反推的两个驱动）；保底4失衡由 applyBossPreset 按 Boss 预设自动勾选。
  configStore.autoYidhariAxis = true
  configStore.stunAxes.splice(0)
  configStore.stunAxisPlans.splice(0)
  configStore.setMechanicSetting('guarantee.ultimate', 1)

  if (deploy.boss) {
    const resolved = resolveBossApply(deploy.boss, presets)
    if (resolved) {
      applyBossRoom(configStore, resolved.preset, resolved.phase) // CC-342：房间上下文唯一写入口
    }
  }
}