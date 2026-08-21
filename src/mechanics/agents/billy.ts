/**
 * 比利（1081）—— 稳定据枪、骑士战队与影画整局总量模型
 *
 * 原文来源：data/raw/nanoka_missing/full/1081.json，按核心被动 Lv.7。
 * - 核心被动稳定据枪：蹲姿普通攻击伤害+50%，按覆盖率只修正普通攻击执行行。
 * - 额外能力骑士战队：同属性/同阵营队友激活；连携后下次终结技伤害+50%×2层，按层数滑块
 *   折算终结技行 dmgBonus。
 * - 影画1 闪亮登场：冲刺/闪避反击命中回2.7能量，分开录入原始次数后按战斗时间与5秒ICD统一封顶。
 * - 影画2 游斗射术：闪避反击伤害+25%；成功翻滚次数显式录入并增加闪避反击次数。
 * - 影画4 星徽-惩戒弹药：强特暴击率随距离提升（上限32%），按数值滑块折算强特行 critRateBonus。
 * - 影画6 星徽-英雄时刻：命中10次/极限闪避叠层，每层伤害+6%上限5层，按层数滑块折算面板 dmgBonus。
 *
 * 明确未建模：
 * - 核心被动蹲姿增益的移动/待机/被击退结束逐时序。
 * - 影画2 翻滚射击无敌窗口；成功次数由用户输入，不自动推断动作时序。
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
  dashAttackCount: number
  dodgeEnergyTriggerCount: number
  c2SuccessfulRolls: number
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

export const BILLY_BASIC_MOVE_IDS = new Set(['1081002', '1081003', '1081004', '1081007', '1081008'])

export function resolveBillyC1TriggerCount(rawCount: number, battleTime: number): number {
  const count = whole(rawCount)
  if (count <= 0 || battleTime <= 0) return 0
  return Math.min(count, Math.ceil(battleTime / BILLY_C1_ICD_SECONDS))
}

export function computeBillyCycle(input: {
  cinemaLevel: number
  additionalActive: boolean
  coreCrouchCoverage: number
  ultimateStacks: number
  c4ExCrit: number
  c6HitStacks: number
  dashAttackCount?: number
  dodgeEnergyTriggerCount?: number
  c2SuccessfulRolls?: number
  battleTime?: number
}): BillyCycle {
  const cinemaLevel = whole(input.cinemaLevel)
  const battleTime = Math.max(0, Number.isFinite(input.battleTime) ? Number(input.battleTime) : 180)
  const rawDashAttackCount = whole(input.dashAttackCount ?? 0)
  const rawDodgeEnergyTriggerCount = whole(input.dodgeEnergyTriggerCount ?? 0)
  const c1TriggerCount = resolveBillyC1TriggerCount(rawDashAttackCount + rawDodgeEnergyTriggerCount, battleTime)
  const c2SuccessfulRolls = whole(input.c2SuccessfulRolls ?? 0)
  const c6Stacks = Math.max(0, Math.min(BILLY_C6_MAX_STACKS, input.c6HitStacks + (cinemaLevel >= 2 ? c2SuccessfulRolls : 0)))
  return {
    cinemaLevel,
    additionalActive: input.additionalActive,
    coreCrouchDmg: BILLY_CORE_CROUCH_DMG * clampRatio(input.coreCrouchCoverage),
    ultimateDmg: input.additionalActive
      ? BILLY_ADDITIONAL_ULT_PER_STACK * Math.max(0, Math.min(BILLY_ADDITIONAL_ULT_MAX_STACKS, input.ultimateStacks))
      : 0,
    c2DodgeDmg: cinemaLevel >= 2 ? BILLY_C2_DODGE_DMG : 0,
    c4ExCritRate: cinemaLevel >= 4 ? Math.max(0, Math.min(BILLY_C4_EX_CRIT_MAX, input.c4ExCrit)) : 0,
    c6Dmg: cinemaLevel >= 6 ? BILLY_C6_DMG_PER_STACK * c6Stacks : 0,
    c1Energy: cinemaLevel >= 1 ? BILLY_C1_ENERGY * c1TriggerCount : 0,
    dashAttackCount: rawDashAttackCount,
    dodgeEnergyTriggerCount: rawDodgeEnergyTriggerCount,
    c2SuccessfulRolls,
    note: 'C1合并冲刺与闪反原始次数后按5秒ICD封顶；核心增伤仅作用普通攻击，C2翻滚成功次数不自动高估。',
  }
}

function buildBillyCharConfig({ cinemaLevel, cfg, panel }: AgentCharConfigInput): void {
  const record = cfg as unknown as Record<string, unknown>
  record.billyCinemaLevel = cinemaLevel
  record.billyCoreCrouchCoverage = clampRatio(setting(cfg, 'billy.coreCrouchCoverage', 1))
  record.billyUltimateStacks = Math.max(0, Math.min(BILLY_ADDITIONAL_ULT_MAX_STACKS, setting(cfg, 'billy.ultimateStacks', 2)))
  record.billyC4ExCrit = Math.max(0, Math.min(BILLY_C4_EX_CRIT_MAX, setting(cfg, 'billy.c4ExCrit', 32)))
  record.billyC6HitStacks = Math.max(0, Math.min(BILLY_C6_MAX_STACKS, setting(cfg, 'billy.c6HitStacks', 0)))
  const dashAttackCount = whole(setting(cfg, 'billy.dashAttackCount', 0))
  const dodgeEnergyTriggerCount = whole(setting(cfg, 'billy.dodgeEnergyTriggerCount', 0))
  const battleTime = Math.max(0, Number((cfg as unknown as Record<string, unknown>).battleTime ?? 180))
  record.billyDashAttackCount = dashAttackCount
  record.billyDodgeEnergyTriggerCount = dodgeEnergyTriggerCount
  record.billyC2SuccessfulRolls = whole(setting(cfg, 'billy.c2SuccessfulRolls', 0))
  record.billyBattleTime = battleTime
  record.billyC1Energy = cinemaLevel >= 1
    ? resolveBillyC1TriggerCount(dashAttackCount + dodgeEnergyTriggerCount, battleTime) * BILLY_C1_ENERGY
    : 0
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
    c6HitStacks: Number(record.billyC6HitStacks ?? 0),
    dashAttackCount: Number(record.billyDashAttackCount ?? 0),
    dodgeEnergyTriggerCount: Number(record.billyDodgeEnergyTriggerCount ?? 0),
    c2SuccessfulRolls: Number(record.billyC2SuccessfulRolls ?? 0),
    battleTime: Number(record.billyBattleTime ?? 180),
  })
}

function patchBillyExecutions({ cfg, executions }: AgentResourceInput): void {
  const cycle = cycleFromInput({ cfg, state: {} as any })
  for (const exec of executions) {
    if (exec.moveId === BILLY_MOVE_IDS.ultimate && cycle.ultimateDmg > 0) exec.dmgBonus = (exec.dmgBonus ?? 0) + cycle.ultimateDmg
    if (exec.moveId === BILLY_MOVE_IDS.dodgeCounter && cycle.c2DodgeDmg > 0) exec.dmgBonus = (exec.dmgBonus ?? 0) + cycle.c2DodgeDmg
    if (exec.moveId === BILLY_MOVE_IDS.dodgeCounter && cycle.c2SuccessfulRolls > 0) {
      exec.count = (exec.count ?? 0) + cycle.c2SuccessfulRolls
      exec.totalTime = exec.count * exec.actionTime
      exec.totalComboAlignTime = exec.totalTime * exec.comboAlignRatio
      exec.totalDecibelRecovery = exec.count * exec.decibelRecovery
    }
    if (exec.moveId === BILLY_MOVE_IDS.exSpecial && cycle.c4ExCritRate > 0) exec.critRateBonus = (exec.critRateBonus ?? 0) + cycle.c4ExCritRate
    if (BILLY_BASIC_MOVE_IDS.has(exec.moveId) && cycle.coreCrouchDmg > 0) exec.dmgBonus = (exec.dmgBonus ?? 0) + cycle.coreCrouchDmg
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
      { label: '核心蹲姿增伤', value: `+${cycle.coreCrouchDmg}%`, detail: '蹲姿射击伤害按覆盖率' },
      { label: '额外能力终结增伤', value: `+${cycle.ultimateDmg}%`, detail: cycle.additionalActive ? '连携后终结50%×2层' : '未激活' },
      { label: '影画1额外回能', value: `${cycle.c1Energy}`, detail: '冲刺/闪反合并后按5秒冷却封顶' },
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
  description: '蹲姿普通攻击增伤、额外能力终结增伤、影画1/2/4/6；逐时序结束条件仍保留为覆盖率近似。',
  settings: [
    { id: 'billy.coreCrouchCoverage', label: '蹲姿增伤覆盖率', description: '核心被动蹲姿射击伤害+50%的整局覆盖率', default: 1, min: 0, max: 1, step: 0.05, suffix: '%' },
    { id: 'billy.ultimateStacks', label: '终结增伤层数', description: '额外能力连携后终结技+50%的叠加层数（上限2）', default: 2, min: 0, max: 2, step: 1, suffix: '层' },
    { id: 'billy.c4ExCrit', label: '影画4强特暴击', description: '影画4强特暴击率随距离提升（上限32%）', default: 32, min: 0, max: 32, step: 1, suffix: '%' },
    { id: 'billy.c6HitStacks', label: '影画6命中层数', description: '已确认的影画6命中/极限闪避叠层（每层+6%，上限5层）', default: 0, min: 0, max: 5, step: 1, suffix: '层' },
    { id: 'billy.dashAttackCount', label: 'C1冲刺攻击次数', description: '冲刺攻击原始命中次数；与闪避反击合并后按5秒冷却封顶', default: 0, min: 0, max: 20, step: 1, suffix: '次' },
    { id: 'billy.dodgeEnergyTriggerCount', label: 'C1闪避反击次数', description: '闪避反击原始命中次数；与冲刺攻击合并后按5秒冷却封顶', default: 0, min: 0, max: 20, step: 1, suffix: '次' },
    { id: 'billy.c2SuccessfulRolls', label: 'C2成功翻滚次数', description: '成功触发极限闪避并衔接闪避反击的次数', default: 0, min: 0, max: 20, step: 1, suffix: '次' },
  ],
  buildCharConfig: buildBillyCharConfig,
  patchExecutions: patchBillyExecutions,
  transformSkillExecutions: applyBillyPanel,
  buildResourceResult: buildBillyResourceResult,
  resourceSections: buildBillyResourceSections,
}

export default billyMechanic
