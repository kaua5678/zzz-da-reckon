/**
 * 比利（1081）—— 稳定据枪、骑士战队与影画整局总量模型
 *
 * 原文来源：data/raw/nanoka_missing/full/1081.json，按核心被动 Lv.7。
 * - 核心被动稳定据枪：实战手法可让除连携技外的招式保持蹲姿，默认全部获得伤害+50%。
 * - 额外能力骑士战队：同属性/同阵营队友激活；总增伤量=连携总次数×50%，平均分配给每次终结技。
 * - 影画1 闪亮登场：不记录冲刺次数，默认按5秒冷却全覆盖自动回复2.7能量。
 * - 影画2 游斗射术：只实现闪避反击伤害+25%，不推导翻滚动作。
 * - 影画4 星徽-惩戒弹药：强特暴击率随距离提升（上限32%），按数值滑块折算强特行 critRateBonus。
 * - 影画6 星徽-英雄时刻：默认满5层，全局伤害+30%。
 *
 * 明确未建模：
 * - 核心被动的移动/待机/被击退结束逐时序；按用户确认的实战手法默认全覆盖。
 * - 影画2 翻滚射击无敌与自动衔接；当前只结算闪避反击限定增伤。
 * - 影画4 距离衰减曲线按上限值滑块近似。
 *
 * @author kaua5678
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
export const BILLY_C1_ENERGY = 2.7
export const BILLY_C1_ICD_SECONDS = 5
export const BILLY_MOVE_IDS = {
  dashSpread: '1081016',
  dashFocused: '1081014',
  dodgeCounter: '1081017',
  exSpecial: '1081013',
  chain: '1081018',
  ultimate: '1081019',
} as const

export interface BillyCycle {
  cinemaLevel: number
  additionalActive: boolean
  coreCrouchDmg: number
  ultimateDmg: number
  c2DodgeDmg: number
  c4ExCritRate: number
  c6Dmg: number
  c1Energy: number
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

export const BILLY_CROUCH_EXCLUDED_MOVE_IDS = new Set<string>([BILLY_MOVE_IDS.chain])

export function resolveBillyC1TriggerCount(battleTime: number): number {
  if (battleTime <= 0) return 0
  return Math.ceil(battleTime / BILLY_C1_ICD_SECONDS)
}

export function computeBillyCycle(input: {
  cinemaLevel: number
  additionalActive: boolean
  coreCrouchCoverage: number
  chainCountTotal: number
  ultimateCount: number
  c4ExCrit: number
  battleTime?: number
}): BillyCycle {
  const cinemaLevel = whole(input.cinemaLevel)
  const battleTime = Math.max(0, Number.isFinite(input.battleTime) ? Number(input.battleTime) : 180)
  const chainCountTotal = Math.max(0, Number(input.chainCountTotal) || 0)
  const ultimateCount = Math.max(0, Number(input.ultimateCount) || 0)
  const totalUltimateBonus = input.additionalActive
    ? chainCountTotal * BILLY_ADDITIONAL_ULT_PER_STACK
    : 0
  return {
    cinemaLevel,
    additionalActive: input.additionalActive,
    coreCrouchDmg: BILLY_CORE_CROUCH_DMG * clampRatio(input.coreCrouchCoverage),
    ultimateDmg: ultimateCount > 0 ? totalUltimateBonus / ultimateCount : 0,
    c2DodgeDmg: cinemaLevel >= 2 ? BILLY_C2_DODGE_DMG : 0,
    c4ExCritRate: cinemaLevel >= 4 ? Math.max(0, Math.min(BILLY_C4_EX_CRIT_MAX, input.c4ExCrit)) : 0,
    c6Dmg: cinemaLevel >= 6 ? BILLY_C6_DMG_PER_STACK * BILLY_C6_MAX_STACKS : 0,
    c1Energy: cinemaLevel >= 1 ? BILLY_C1_ENERGY * resolveBillyC1TriggerCount(battleTime) : 0,
    note: 'C1按5秒冷却自动回能；蹲姿除连携技外默认全覆盖；C6默认满层。',
  }
}

function buildBillyCharConfig({ cinemaLevel, cfg, panel }: AgentCharConfigInput): void {
  const record = cfg as unknown as Record<string, unknown>
  record.billyCinemaLevel = cinemaLevel
  record.billyCoreCrouchCoverage = clampRatio(setting(cfg, 'billy.coreCrouchCoverage', 1))
  record.billyC4ExCrit = Math.max(0, Math.min(BILLY_C4_EX_CRIT_MAX, setting(cfg, 'billy.c4ExCrit', 32)))
  const battleTime = Math.max(0, Number((cfg as unknown as Record<string, unknown>).battleTime ?? 180))
  record.billyBattleTime = battleTime
  record.billyC1Energy = cinemaLevel >= 1
    ? resolveBillyC1TriggerCount(battleTime) * BILLY_C1_ENERGY
    : 0
  record.billyAdditionalActive = (panel.additionalAbilityActive ?? 0) > 0
}

function cycleFromInput({ cfg, state }: Pick<AgentResourceInput, 'cfg' | 'state'>): BillyCycle {
  const record = cfg as unknown as Record<string, unknown>
  return computeBillyCycle({
    cinemaLevel: Number(record.billyCinemaLevel ?? 0),
    additionalActive: record.billyAdditionalActive === true,
    coreCrouchCoverage: Number(record.billyCoreCrouchCoverage ?? 1),
    chainCountTotal: Number(state.chainCountTotal ?? 0),
    ultimateCount: Number(state.ultimateCount ?? 0),
    c4ExCrit: Number(record.billyC4ExCrit ?? 32),
    battleTime: Number(record.billyBattleTime ?? 180),
  })
}

function patchBillyExecutions({ cfg, state, executions }: AgentResourceInput): void {
  const cycle = cycleFromInput({ cfg, state })
  for (const exec of executions) {
    if (exec.moveId === BILLY_MOVE_IDS.ultimate && cycle.ultimateDmg > 0) exec.dmgBonus = (exec.dmgBonus ?? 0) + cycle.ultimateDmg
    if (exec.moveId === BILLY_MOVE_IDS.dodgeCounter && cycle.c2DodgeDmg > 0) exec.dmgBonus = (exec.dmgBonus ?? 0) + cycle.c2DodgeDmg
    if (exec.moveId === BILLY_MOVE_IDS.exSpecial && cycle.c4ExCritRate > 0) exec.critRateBonus = (exec.critRateBonus ?? 0) + cycle.c4ExCritRate
    if (!BILLY_CROUCH_EXCLUDED_MOVE_IDS.has(exec.moveId) && cycle.coreCrouchDmg > 0) {
      exec.dmgBonus = (exec.dmgBonus ?? 0) + cycle.coreCrouchDmg
    }
  }
}

function applyBillyPanel({ charResult, panel }: AgentSkillTransformInput): void {
  if (!panel) return
  if ((panel as Record<string, unknown>).__billyPanelApplied) return
  ;(panel as Record<string, unknown>).__billyPanelApplied = true
  const cycle = charResult.specResources?.billy_cycle as BillyCycle | undefined
  if (!cycle) return
  if (cycle.c6Dmg > 0) panel.dmgBonus = (panel.dmgBonus ?? 0) + cycle.c6Dmg
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
      { label: '核心蹲姿增伤', value: `+${cycle.coreCrouchDmg}%`, detail: '除连携技外默认全覆盖' },
      { label: '额外能力终结增伤', value: `+${cycle.ultimateDmg}%`, detail: cycle.additionalActive ? '连携总次数×50%后均摊到每次终结技' : '未激活' },
      { label: '影画1额外回能', value: `${cycle.c1Energy}`, detail: '每5秒自动触发一次' },
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
  description: '蹲姿除连携技外全覆盖、额外能力按连携次数均摊终结技增伤、影画1/2/4/6。',
  settings: [
    { id: 'billy.coreCrouchCoverage', label: '蹲姿增伤覆盖率', description: '核心被动蹲姿射击伤害+50%的整局覆盖率', default: 1, min: 0, max: 1, step: 0.05, suffix: '%' },
    { id: 'billy.c4ExCrit', label: '影画4强特暴击', description: '影画4强特暴击率随距离提升（上限32%）', default: 32, min: 0, max: 32, step: 1, suffix: '%' },
  ],
  buildCharConfig: buildBillyCharConfig,
  patchExecutions: patchBillyExecutions,
  transformSkillExecutions: applyBillyPanel,
  buildResourceResult: buildBillyResourceResult,
  resourceSections: buildBillyResourceSections,
}

export default billyMechanic
