/**
 * 比利（1081）—— 稳定据枪、骑士战队与影画整局总量模型
 *
 * 原文来源：data/raw/nanoka_missing/full/1081.json，按核心被动 Lv.7。
 * - 核心被动稳定据枪：蹲姿射击自身伤害+50%，按整局覆盖率折算面板 dmgBonus
 *   （移动/待机/被击退结束增益的逐时序按覆盖率近似）。
 * - 额外能力骑士战队：同属性/同阵营队友激活；连携后下次终结技伤害+50%×2层，按层数滑块
 *   折算终结技行 dmgBonus。
 * - 影画2 游斗射术：闪避反击伤害+25% 挂闪避反击行 dmgBonus（翻滚射击视为闪避/触发极限闪避未建模）。
 * - 影画4 星徽-惩戒弹药：强特暴击率随距离提升（上限32%），按数值滑块折算强特行 critRateBonus。
 * - 影画6 星徽-英雄时刻：命中10次/极限闪避叠层，每层伤害+6%上限5层，按层数滑块折算面板 dmgBonus。
 *
 * 明确未建模：
 * - 影画1 闪亮登场：冲刺/闪避反击命中回2.7能量（5秒一次）无干净回能通道，未接入能量结算。
 * - 核心被动蹲姿增益的移动/待机/被击退结束逐时序；影画2 翻滚射击无敌/触发极限闪避自动衔接闪避反击。
 * - 影画4 距离衰减曲线按上限值滑块近似。
 */
import type {
  AgentCharConfigInput,
  AgentMechanicModule,
  AgentResourceInput,
  AgentResourceResultInput,
  AgentResourceSectionsInput,
  AgentSkillTransformInput,
} from '../types'

export const BILLY_ID = '1081'
export const BILLY_CORE_CROUCH_DMG = 50
export const BILLY_ADDITIONAL_ULT_PER_STACK = 50
export const BILLY_ADDITIONAL_ULT_MAX_STACKS = 2
export const BILLY_C2_DODGE_DMG = 25
export const BILLY_C4_EX_CRIT_MAX = 32
export const BILLY_C6_DMG_PER_STACK = 6
export const BILLY_C6_MAX_STACKS = 5

export interface BillyCycle {
  cinemaLevel: number
  additionalActive: boolean
  coreCrouchDmg: number
  ultimateDmg: number
  c2DodgeDmg: number
  c4ExCritRate: number
  c6Dmg: number
  note: string
}

function setting(cfg: AgentCharConfigInput['cfg'], id: string, fallback: number): number {
  const value = Number((cfg as unknown as Record<string, unknown>)[`setting:${id}`])
  return Number.isFinite(value) ? value : fallback
}

function clampRatio(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0))
}

function whole(value: number): number {
  return Math.max(0, Math.floor(Number.isFinite(value) ? value : 0))
}

export function computeBillyCycle(input: {
  cinemaLevel: number
  additionalActive: boolean
  coreCrouchCoverage: number
  ultimateStacks: number
  c4ExCrit: number
  c6HitStacks: number
}): BillyCycle {
  const cinemaLevel = whole(input.cinemaLevel)
  return {
    cinemaLevel,
    additionalActive: input.additionalActive,
    coreCrouchDmg: BILLY_CORE_CROUCH_DMG * clampRatio(input.coreCrouchCoverage),
    ultimateDmg: input.additionalActive
      ? BILLY_ADDITIONAL_ULT_PER_STACK * Math.max(0, Math.min(BILLY_ADDITIONAL_ULT_MAX_STACKS, input.ultimateStacks))
      : 0,
    c2DodgeDmg: cinemaLevel >= 2 ? BILLY_C2_DODGE_DMG : 0,
    c4ExCritRate: cinemaLevel >= 4 ? Math.max(0, Math.min(BILLY_C4_EX_CRIT_MAX, input.c4ExCrit)) : 0,
    c6Dmg: cinemaLevel >= 6 ? BILLY_C6_DMG_PER_STACK * Math.max(0, Math.min(BILLY_C6_MAX_STACKS, input.c6HitStacks)) : 0,
    note: '影画1回能未建模；蹲姿/翻滚射击逐时序与影画4距离衰减按覆盖率/滑块近似。',
  }
}

function buildBillyCharConfig({ cinemaLevel, cfg, panel }: AgentCharConfigInput): void {
  const record = cfg as unknown as Record<string, unknown>
  record.billyCinemaLevel = cinemaLevel
  record.billyCoreCrouchCoverage = clampRatio(setting(cfg, 'billy.coreCrouchCoverage', 1))
  record.billyUltimateStacks = Math.max(0, Math.min(BILLY_ADDITIONAL_ULT_MAX_STACKS, setting(cfg, 'billy.ultimateStacks', 2)))
  record.billyC4ExCrit = Math.max(0, Math.min(BILLY_C4_EX_CRIT_MAX, setting(cfg, 'billy.c4ExCrit', 32)))
  record.billyC6HitStacks = Math.max(0, Math.min(BILLY_C6_MAX_STACKS, setting(cfg, 'billy.c6HitStacks', 5)))
  record.billyAdditionalActive = (panel.additionalAbilityActive ?? 0) > 0
}

function cycleFromInput({ cfg, state }: Pick<AgentResourceInput, 'cfg' | 'state'>): BillyCycle {
  const record = cfg as unknown as Record<string, unknown>
  return computeBillyCycle({
    cinemaLevel: Number(record.billyCinemaLevel ?? 0),
    additionalActive: record.billyAdditionalActive === true,
    coreCrouchCoverage: Number(record.billyCoreCrouchCoverage ?? 1),
    ultimateStacks: Number(record.billyUltimateStacks ?? 2),
    c4ExCrit: Number(record.billyC4ExCrit ?? 32),
    c6HitStacks: Number(record.billyC6HitStacks ?? 5),
  })
}

function patchBillyExecutions({ cfg, state, executions }: AgentResourceInput): void {
  const cycle = cycleFromInput({ cfg, state })
  const ultMoveId = cfg.ultimateMoveId
  const dodgeMoveId = cfg.dodgeCounterMoveId
  const exMoveId = cfg.exSpecialMoveId
  for (const exec of executions) {
    if (exec.moveId === ultMoveId && cycle.ultimateDmg > 0) {
      exec.dmgBonus = (exec.dmgBonus ?? 0) + cycle.ultimateDmg
    }
    if (exec.moveId === dodgeMoveId && cycle.c2DodgeDmg > 0) {
      exec.dmgBonus = (exec.dmgBonus ?? 0) + cycle.c2DodgeDmg
    }
    if (exec.moveId === exMoveId && cycle.c4ExCritRate > 0) {
      exec.critRateBonus = (exec.critRateBonus ?? 0) + cycle.c4ExCritRate
    }
  }
}

function applyBillyPanel({ charResult, panel }: AgentSkillTransformInput): void {
  if (!panel) return
  if ((panel as Record<string, unknown>).__billyPanelApplied) return
  ;(panel as Record<string, unknown>).__billyPanelApplied = true
  const cycle = charResult.specResources?.billy_cycle as BillyCycle | undefined
  if (!cycle) return
  const dmgBonus = cycle.coreCrouchDmg + cycle.c6Dmg
  if (dmgBonus > 0) panel.dmgBonus = (panel.dmgBonus ?? 0) + dmgBonus
}

function buildBillyResourceResult({ cfg, state }: AgentResourceResultInput) {
  return { specResources: { billy_cycle: cycleFromInput({ cfg, state }) } }
}

function buildBillyResourceSections({ result }: AgentResourceSectionsInput) {
  const cycle = result.specResources?.billy_cycle as BillyCycle | undefined
  if (!cycle) return []
  return [{
    id: 'billy-cycle',
    title: '比利·稳定据枪',
    summary: `蹲姿增伤 +${cycle.coreCrouchDmg}% · 终结增伤 +${cycle.ultimateDmg}%`,
    rows: [
      { label: '核心蹲姿增伤', value: `+${cycle.coreCrouchDmg}%`, detail: '蹲姿射击伤害按覆盖率' },
      { label: '额外能力终结增伤', value: `+${cycle.ultimateDmg}%`, detail: cycle.additionalActive ? '连携后终结50%×2层' : '未激活' },
      { label: '影画2闪避反击增伤', value: `+${cycle.c2DodgeDmg}%`, detail: '游斗射术' },
      { label: '影画4强特暴击', value: `+${cycle.c4ExCritRate}%`, detail: '随距离上限32%' },
      { label: '影画6命中增伤', value: `+${cycle.c6Dmg}%`, detail: '每层6%上限5层' },
    ],
    footer: cycle.note,
  }]
}

export const billyMechanic: AgentMechanicModule = {
  id: 'agent:billy',
  agentIds: [BILLY_ID],
  name: '比利·稳定据枪',
  description: '蹲姿增伤50%、额外能力终结增伤、影画2/4/6；影画1回能与逐时序未建模。',
  settings: [
    { id: 'billy.coreCrouchCoverage', label: '蹲姿增伤覆盖率', description: '核心被动蹲姿射击伤害+50%的整局覆盖率', default: 1, min: 0, max: 1, step: 0.05, suffix: '%' },
    { id: 'billy.ultimateStacks', label: '终结增伤层数', description: '额外能力连携后终结技+50%的叠加层数（上限2）', default: 2, min: 0, max: 2, step: 1, suffix: '层' },
    { id: 'billy.c4ExCrit', label: '影画4强特暴击', description: '影画4强特暴击率随距离提升（上限32%）', default: 32, min: 0, max: 32, step: 1, suffix: '%' },
    { id: 'billy.c6HitStacks', label: '影画6命中层数', description: '影画6命中叠层（每层+6%，上限5层）', default: 5, min: 0, max: 5, step: 1, suffix: '层' },
  ],
  buildCharConfig: buildBillyCharConfig,
  patchExecutions: patchBillyExecutions,
  transformSkillExecutions: applyBillyPanel,
  buildResourceResult: buildBillyResourceResult,
  resourceSections: buildBillyResourceSections,
}

export default billyMechanic
