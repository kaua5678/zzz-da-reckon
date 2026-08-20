/**
 * 「扳机」（1361）—— 绝意、协奏狙杀与影画整局总量模型
 *
 * 原文来源：data/raw/nanoka_1361_zh.json（Nanoka zh，抓于 2026-08-19）。
 * - 狙击连续射击/蓄力反击命中获得25绝意（C1 ×1.25），上限100（C1=125）。
 * - 普通协奏消耗3绝意；冥狱消耗5绝意；强特/终结协战分别提供4/6次免费协奏。
 * - 额外能力仅强化协奏狙杀/冥狱三条追加攻击的失衡值，不再误加到全部招式。
 * - C4 每次进入/延长协战，使下一次协奏触发断离：200%攻击力伤害；120%冲击力失衡
 *   暂不进入失衡池（合成假 moveId 无倍率表行），伤害行已建模。
 * - C6 进场5枚破甲凶弹；每消耗25绝意补1枚；狙击姿态命中消耗1枚，造成1200%攻击力
 *   电伤且本行增伤+50%。整局按“消耗与补弹交错、无库存溢出”近似，次数受狙击命中数限制。
 *
 * 可调项：狙击命中、普通协奏、冥狱次数。默认是保守短循环，不从平A秒数臆造动作序列。
 */
import type {
  AgentCharConfigInput,
  AgentMechanicModule,
  AgentPanelInput,
  AgentResourceInput,
  AgentResourceResultInput,
  AgentResourceSectionsInput,
} from '../types'

export const TRIGGER_AGENT_ID = '1361'
export const TRIGGER_ADDITIONAL_MOVE_IDS = new Set(['1361008', '1361020', '1361022'])
export const TRIGGER_CRIT_THRESHOLD = 40
export const TRIGGER_STUN_BUILD_PER_CRIT = 1.5
export const TRIGGER_STUN_BUILD_CAP = 75
export const TRIGGER_C4_DAMAGE_MULTIPLIER = 200
export const TRIGGER_C4_DAZE_MULTIPLIER = 120
export const TRIGGER_C6_DAMAGE_MULTIPLIER = 1200
export const TRIGGER_C6_DMG_BONUS = 50

export interface TriggerCycle {
  cinemaLevel: number
  resolveGainPerSniperHit: number
  resolveCap: number
  sniperHitCount: number
  resolveGain: number
  normalCount: number
  hellCount: number
  resolveRequested: number
  resolveSpent: number
  freeCoordinatedCount: number
  coordinatedCount: number
  c4DuanliCount: number
  c6BulletCount: number
  c6BulletGainFromSpend: number
  note: string
}

function cfgSetting(cfg: AgentCharConfigInput['cfg'], id: string, fallback: number): number {
  const value = (cfg as unknown as Record<string, unknown>)[`setting:${id}`]
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

export function computeTriggerCycle(input: {
  cinemaLevel: number
  sniperHitCount: number
  normalCount: number
  hellCount: number
  exSpecialCount: number
  ultimateCount: number
}): TriggerCycle {
  const cinema = Math.max(0, Math.floor(input.cinemaLevel))
  const sniperHitCount = Math.max(0, Math.floor(input.sniperHitCount))
  const normalCount = Math.max(0, Math.floor(input.normalCount))
  const hellCount = Math.max(0, Math.floor(input.hellCount))
  const resolveGainPerSniperHit = cinema >= 1 ? 31.25 : 25
  const resolveCap = cinema >= 1 ? 125 : 100
  const resolveGain = Math.min(resolveCap, sniperHitCount * resolveGainPerSniperHit)
  const freeCoordinatedCount = Math.max(0,
    Math.floor(input.exSpecialCount) * 4 + Math.floor(input.ultimateCount) * 6)
  const resolveRequested = normalCount * 3 + hellCount * 5
  const resolveSpent = Math.min(resolveGain, resolveRequested)
  const paidCount = resolveRequested <= resolveGain
    ? normalCount + hellCount
    : Math.floor(resolveSpent / 3)
  const coordinatedCount = paidCount + freeCoordinatedCount
  const coopEntries = Math.max(0, Math.floor(input.exSpecialCount) + Math.floor(input.ultimateCount))
  const c4DuanliCount = cinema >= 4 ? Math.min(coopEntries, coordinatedCount) : 0
  const c6BulletGainFromSpend = cinema >= 6 ? Math.floor(resolveSpent / 25) : 0
  const c6BulletCount = cinema >= 6
    ? Math.min(sniperHitCount, 5 + c6BulletGainFromSpend)
    : 0
  return {
    cinemaLevel: cinema,
    resolveGainPerSniperHit,
    resolveCap,
    sniperHitCount,
    resolveGain,
    normalCount,
    hellCount,
    resolveRequested,
    resolveSpent,
    freeCoordinatedCount,
    coordinatedCount,
    c4DuanliCount,
    c6BulletCount,
    c6BulletGainFromSpend,
    note: '整局总量：协奏次数由可调动作数与协战免费次数合计；C6按消耗与补弹交错、无库存溢出近似。',
  }
}

function applyTriggerPanel({ panel }: AgentPanelInput): void {
  if ((panel.additionalAbilityActive ?? 0) <= 0) return
  const overCrit = Math.max(0, (panel.critRate ?? 0) - TRIGGER_CRIT_THRESHOLD)
  panel.triggerAdditionalStunBuildUp = Math.min(
    TRIGGER_STUN_BUILD_CAP,
    overCrit * TRIGGER_STUN_BUILD_PER_CRIT,
  )
}

function buildTriggerCharConfig({ cinemaLevel, cfg }: AgentCharConfigInput): void {
  const record = cfg as unknown as Record<string, unknown>
  record.triggerCinemaLevel = cinemaLevel
  record.triggerSniperHitCount = Math.max(0, Math.floor(cfgSetting(cfg, 'trigger.sniperHitCount', 4)))
  record.triggerNormalCount = Math.max(0, Math.floor(cfgSetting(cfg, 'trigger.normalCoordinatedCount', 4)))
  record.triggerHellCount = Math.max(0, Math.floor(cfgSetting(cfg, 'trigger.hellCoordinatedCount', 2)))
}

function cycleFromInput({ cfg, state }: Pick<AgentResourceInput, 'cfg' | 'state'>): TriggerCycle {
  const record = cfg as unknown as Record<string, unknown>
  return computeTriggerCycle({
    cinemaLevel: Number(record.triggerCinemaLevel ?? 0),
    sniperHitCount: Number(record.triggerSniperHitCount ?? 4),
    normalCount: Number(record.triggerNormalCount ?? 4),
    hellCount: Number(record.triggerHellCount ?? 2),
    exSpecialCount: state.exSpecialCount,
    ultimateCount: state.ultimateCount,
  })
}

function pushSyntheticExecution(executions: AgentResourceInput['executions'], input: {
  moveId: string
  moveName: string
  count: number
  damageMultiplier: number
  dmgBonus?: number
  element?: string
  dazeMultiplier?: number
}): void {
  if (input.count <= 0) return
  executions.push({
    moveId: input.moveId,
    moveName: input.moveName,
    category: 'special',
    count: input.count,
    actionTime: 0,
    comboAlignRatio: 0,
    totalTime: 0,
    totalComboAlignTime: 0,
    energyConsume: 0,
    totalEnergyConsume: 0,
    decibelRecovery: 0,
    totalDecibelRecovery: 0,
    energyRecovery: 0,
    totalEnergyRecovery: 0,
    damageMultiplier: input.damageMultiplier,
    damageMultiplierOverride: true,
    ...(input.dmgBonus != null ? { dmgBonus: input.dmgBonus } : {}),
    ...(input.element ? { element: input.element } : {}),
    ...(input.dazeMultiplier != null
      ? { dazeMultiplier: input.dazeMultiplier, dazeMultiplierOverride: true }
      : {}),
  })
}

function buildTriggerExecutions({ cfg, state, executions }: AgentResourceInput): void {
  const cycle = cycleFromInput({ cfg, state })
  pushSyntheticExecution(executions, {
    moveId: '1361_c4_duanli',
    moveName: '断离（影画4）',
    count: cycle.c4DuanliCount,
    damageMultiplier: TRIGGER_C4_DAMAGE_MULTIPLIER,
    dazeMultiplier: TRIGGER_C4_DAZE_MULTIPLIER,
  })
  pushSyntheticExecution(executions, {
    moveId: '1361_c6_armor_piercing',
    moveName: '破甲凶弹（影画6）',
    count: cycle.c6BulletCount,
    damageMultiplier: TRIGGER_C6_DAMAGE_MULTIPLIER,
    dmgBonus: TRIGGER_C6_DMG_BONUS,
    element: 'electric',
  })
}

function patchTriggerExecutions({ cfg, executions }: AgentResourceInput): void {
  const bonus = Math.max(0, Number(cfg.panel.triggerAdditionalStunBuildUp ?? 0))
  if (bonus <= 0) return
  for (const exec of executions) {
    if (!exec.moveId || !TRIGGER_ADDITIONAL_MOVE_IDS.has(exec.moveId)) continue
    exec.stunBuildUpBonus = (exec.stunBuildUpBonus ?? 0) + bonus
  }
}

function buildTriggerResourceResult({ cfg, state }: AgentResourceResultInput) {
  return { specResources: { triggerResolve: cycleFromInput({ cfg, state }) } }
}

function buildTriggerResourceSections({ result }: AgentResourceSectionsInput) {
  const cycle = result.specResources?.triggerResolve as TriggerCycle | undefined
  if (!cycle) return []
  return [{
    id: 'trigger-resolve',
    title: '扳机·绝意与协奏',
    summary: `绝意 ${cycle.resolveGain} / ${cycle.resolveCap} · 协奏 ${cycle.coordinatedCount} 次`,
    rows: [
      { label: '狙击命中', value: `${cycle.sniperHitCount} 次`, detail: `每次 +${cycle.resolveGainPerSniperHit} 绝意` },
      { label: '协奏消耗', value: `-${cycle.resolveSpent}`, detail: `普通 ${cycle.normalCount}×3，冥狱 ${cycle.hellCount}×5` },
      { label: '协战免费协奏', value: `${cycle.freeCoordinatedCount} 次`, detail: '强特每次4，终结技每次6' },
      { label: '破甲凶弹', value: `${cycle.c6BulletCount} 次`, detail: `进场5枚，消耗绝意补充 ${cycle.c6BulletGainFromSpend} 枚` },
    ],
    footer: cycle.note,
  }]
}

export const triggerMechanic: AgentMechanicModule = {
  id: 'agent:trigger',
  agentIds: [TRIGGER_AGENT_ID],
  name: '「扳机」',
  description: '失衡易伤拐、追加攻击定向失衡、绝意与协奏总量、影画4断离、影画6破甲凶弹。',
  settings: [
    { id: 'trigger.sniperHitCount', label: '狙击姿态命中', description: '连续射击或蓄力反击的有效命中次数', default: 4, min: 0, max: 30, step: 1, suffix: '次' },
    { id: 'trigger.normalCoordinatedCount', label: '普通协奏次数', description: '计划由绝意支付的协奏狙杀次数', default: 4, min: 0, max: 60, step: 1, suffix: '次' },
    { id: 'trigger.hellCoordinatedCount', label: '冥狱次数', description: '计划由绝意支付的协奏狙杀·冥狱次数', default: 2, min: 0, max: 30, step: 1, suffix: '次' },
  ],
  applyPanel: applyTriggerPanel,
  buildCharConfig: buildTriggerCharConfig,
  buildExecutions: buildTriggerExecutions,
  patchExecutions: patchTriggerExecutions,
  buildResourceResult: buildTriggerResourceResult,
  resourceSections: buildTriggerResourceSections,
}
