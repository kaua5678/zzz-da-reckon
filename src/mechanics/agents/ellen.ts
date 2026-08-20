/**
 * 艾莲（1191）—— 急冻充能、冰渊潜袭、急冻修剪法与影画整局总量模型
 *
 * 原文来源：data/raw/nanoka_missing/full/1191.json，采用 catalog 当前导入的潜能强化版核心被动 Lv.7：
 * 冲刺攻击冰渊潜袭（蓄力剪击）与消耗急冻充能的急冻修剪法暴击伤害+100%，强化版并对连携技、终结技、
 * 霜锋、冰刃浪同样生效（与当前倍率目录口径一致）。
 * - 急冻充能获取按原文拆分：冰渊潜袭快速剪击每次+1（影画1→3）、蓄力剪击每次+3（影画1→6），
 *   强化特殊技横扫/鲨卷风命中各+1，影画4冻结/失衡按连携次数近似每次+6。终结技不获取充能（原文无此来源）。
 * - 充能消耗全部折算为急冻修剪法段数（真实 moveId 1191004/1191005/1191006），冰刃浪/寒潮消耗并入其中。
 * - 冰渊潜袭按真实 moveId 1191007/1191008/1191009 轮转生成，计入冲刺伤害与失衡/异常提取。
 * - 核心被动+100%暴伤只定向挂在受益招式行，不再全局加面板暴伤。
 * - 影画2按发动强化特殊技时平均持有充能折算暴伤（每点+20%，封顶60%）。
 * - 影画1每消耗1点充能暴击率+2%（最多6层）、额外能力风暴潮每层冰伤+3%、影画6穿透率+20%，
 *   均按平均层数/覆盖率近似并在面板层结算；[快蓄]、[盛宴]、潜能觉醒逐状态未建模。
 */
import type {
  AgentCharConfigInput,
  AgentMechanicModule,
  AgentResourceInput,
  AgentResourceResultInput,
  AgentResourceSectionsInput,
  AgentSkillTransformInput,
} from '../types'

export const ELLEN_ID = '1191'
export const ELLEN_FROST_TRIM_MOVE_IDS = ['1191004', '1191005', '1191006'] as const
export const ELLEN_FROST_TRIM_ACTION_TIMES = [0.444, 0.82, 2.232] as const
export const ELLEN_DASH_MOVE_IDS = ['1191007', '1191008', '1191009'] as const
export const ELLEN_DASH_ACTION_TIMES = [0.566, 0.892, 1.106] as const
export const ELLEN_CHAIN_MOVE_ID = '1191016'
export const ELLEN_ULT_MOVE_ID = '1191017'
export const ELLEN_FROST_EDGE_MOVE_IDS = ['1191027', '1191028'] as const
export const ELLEN_ICE_WAVE_MOVE_IDS = ['1191029', '1191030'] as const
export const ELLEN_EX_MOVE_IDS = ['1191011', '1191012'] as const
export const ELLEN_CORE_CRIT_DMG = 100
export const ELLEN_C1_CRIT_RATE_PER_STACK = 2
export const ELLEN_C1_MAX_STACKS = 6
export const ELLEN_C2_CRIT_DMG_PER_CHARGE = 20
export const ELLEN_C2_CRIT_DMG_MAX = 60
export const ELLEN_STORM_SURGE_PER_STACK = 3
export const ELLEN_STORM_SURGE_MAX_STACKS = 10
export const ELLEN_C6_PEN_RATIO = 20

const CORE_TARGETS = new Set<string>([
  ...ELLEN_FROST_TRIM_MOVE_IDS,
  ...ELLEN_DASH_MOVE_IDS,
  ELLEN_CHAIN_MOVE_ID,
  ELLEN_ULT_MOVE_ID,
  ...ELLEN_FROST_EDGE_MOVE_IDS,
  ...ELLEN_ICE_WAVE_MOVE_IDS,
])
const EX_TARGETS = new Set<string>(ELLEN_EX_MOVE_IDS)

export interface EllenCycle {
  cinemaLevel: number
  dashQuickCount: number
  dashChargedCount: number
  dashCount: number
  exChargeGain: number
  c4ChargeGain: number
  totalChargeGain: number
  frostTrimSegments: number
  c1CritRate: number
  c2CritDmg: number
  stormSurgeIceDmg: number
  c6PenRatio: number
  note: string
}

function setting(cfg: AgentCharConfigInput['cfg'], id: string, fallback: number): number {
  const value = Number((cfg as unknown as Record<string, unknown>)[`setting:${id}`])
  return Number.isFinite(value) ? value : fallback
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min))
}

function whole(value: number): number {
  return Math.max(0, Math.floor(Number.isFinite(value) ? value : 0))
}

export function computeEllenCycle(input: {
  cinemaLevel: number
  dashQuickCount: number
  dashChargedCount: number
  exSpecialCount: number
  chainCount: number
  additionalActive: boolean
  c1CritStacks: number
  c2AvgCharge: number
  stormSurgeStacks: number
  c6PenCoverage: number
}): EllenCycle {
  const cinemaLevel = whole(input.cinemaLevel)
  const dashQuickCount = whole(input.dashQuickCount)
  const dashChargedCount = whole(input.dashChargedCount)
  const quickPer = cinemaLevel >= 1 ? 3 : 1
  const chargedPer = cinemaLevel >= 1 ? 6 : 3
  const dashChargeGain = dashQuickCount * quickPer + dashChargedCount * chargedPer
  const exChargeGain = whole(input.exSpecialCount)
  const c4ChargeGain = cinemaLevel >= 4 ? whole(input.chainCount) * 6 : 0
  const totalChargeGain = dashChargeGain + exChargeGain + c4ChargeGain
  return {
    cinemaLevel,
    dashQuickCount,
    dashChargedCount,
    dashCount: dashQuickCount + dashChargedCount,
    exChargeGain,
    c4ChargeGain,
    totalChargeGain,
    frostTrimSegments: totalChargeGain,
    c1CritRate: cinemaLevel >= 1
      ? clamp(input.c1CritStacks, 0, ELLEN_C1_MAX_STACKS) * ELLEN_C1_CRIT_RATE_PER_STACK
      : 0,
    c2CritDmg: cinemaLevel >= 2
      ? Math.min(ELLEN_C2_CRIT_DMG_MAX, clamp(input.c2AvgCharge, 0, 3) * ELLEN_C2_CRIT_DMG_PER_CHARGE)
      : 0,
    stormSurgeIceDmg: input.additionalActive
      ? clamp(input.stormSurgeStacks, 0, ELLEN_STORM_SURGE_MAX_STACKS) * ELLEN_STORM_SURGE_PER_STACK
      : 0,
    c6PenRatio: cinemaLevel >= 6 ? ELLEN_C6_PEN_RATIO * clamp(input.c6PenCoverage, 0, 1) : 0,
    note: '急冻充能获取按原文拆分，消耗折算为急冻修剪法段数；[快蓄]/[盛宴]/潜能觉醒逐状态未建模。',
  }
}

function buildEllenCharConfig({ cinemaLevel, cfg, panel }: AgentCharConfigInput): void {
  const record = cfg as unknown as Record<string, unknown>
  record.ellenCinemaLevel = cinemaLevel
  record.ellenDashQuickCount = whole(setting(cfg, 'ellen.dashQuickCount', 6))
  record.ellenDashChargedCount = whole(setting(cfg, 'ellen.dashChargedCount', 3))
  record.ellenC1CritStacks = clamp(setting(cfg, 'ellen.c1CritStacks', 6), 0, ELLEN_C1_MAX_STACKS)
  record.ellenC2AvgCharge = clamp(setting(cfg, 'ellen.c2AvgCharge', 3), 0, 3)
  record.ellenStormSurgeStacks = clamp(setting(cfg, 'ellen.stormSurgeStacks', 10), 0, ELLEN_STORM_SURGE_MAX_STACKS)
  record.ellenC6PenCoverage = clamp(setting(cfg, 'ellen.c6PenCoverage', 1), 0, 1)
  record.ellenAdditionalActive = (panel.additionalAbilityActive ?? 0) > 0
}

function cycleFromInput({ cfg, state }: Pick<AgentResourceInput, 'cfg' | 'state'>): EllenCycle {
  const record = cfg as unknown as Record<string, unknown>
  return computeEllenCycle({
    cinemaLevel: Number(record.ellenCinemaLevel ?? 0),
    dashQuickCount: Number(record.ellenDashQuickCount ?? 6),
    dashChargedCount: Number(record.ellenDashChargedCount ?? 3),
    exSpecialCount: state.exSpecialCount,
    chainCount: state.chainCountTotal,
    additionalActive: record.ellenAdditionalActive === true,
    c1CritStacks: Number(record.ellenC1CritStacks ?? 6),
    c2AvgCharge: Number(record.ellenC2AvgCharge ?? 3),
    stormSurgeStacks: Number(record.ellenStormSurgeStacks ?? 10),
    c6PenCoverage: Number(record.ellenC6PenCoverage ?? 1),
  })
}

function pushEllenExecution(executions: AgentResourceInput['executions'], input: {
  moveId: string
  moveName: string
  count: number
  category: string
  actionTime: number
}): void {
  if (input.count <= 0) return
  executions.push({
    moveId: input.moveId,
    moveName: input.moveName,
    category: input.category,
    element: 'ice',
    count: input.count,
    actionTime: input.actionTime,
    comboAlignRatio: 0,
    totalTime: input.count * input.actionTime,
    totalComboAlignTime: 0,
    energyConsume: 0,
    totalEnergyConsume: 0,
    decibelRecovery: 0,
    totalDecibelRecovery: 0,
    energyRecovery: 0,
    totalEnergyRecovery: 0,
  })
}

function spreadAcross(moveIds: readonly string[], total: number): number[] {
  return moveIds.map((_, index) =>
    Math.floor((total + moveIds.length - 1 - index) / moveIds.length))
}

function buildEllenExecutions({ cfg, state, executions }: AgentResourceInput): void {
  const cycle = cycleFromInput({ cfg, state })
  const trimCounts = spreadAcross(ELLEN_FROST_TRIM_MOVE_IDS, cycle.frostTrimSegments)
  for (let index = 0; index < ELLEN_FROST_TRIM_MOVE_IDS.length; index++) {
    pushEllenExecution(executions, {
      moveId: ELLEN_FROST_TRIM_MOVE_IDS[index],
      moveName: `普通攻击：急冻修剪法 #${index + 1}`,
      count: trimCounts[index],
      category: 'basic',
      actionTime: ELLEN_FROST_TRIM_ACTION_TIMES[index],
    })
  }
  const dashCounts = spreadAcross(ELLEN_DASH_MOVE_IDS, cycle.dashCount)
  for (let index = 0; index < ELLEN_DASH_MOVE_IDS.length; index++) {
    pushEllenExecution(executions, {
      moveId: ELLEN_DASH_MOVE_IDS[index],
      moveName: `冲刺攻击：冰渊潜袭 #${index + 1}`,
      count: dashCounts[index],
      category: 'dodge',
      actionTime: ELLEN_DASH_ACTION_TIMES[index],
    })
  }
}

function patchEllenExecutions({ cfg, state, executions }: AgentResourceInput): void {
  const cycle = cycleFromInput({ cfg, state })
  for (const exec of executions) {
    if (CORE_TARGETS.has(exec.moveId)) {
      exec.critDmgBonus = (exec.critDmgBonus ?? 0) + ELLEN_CORE_CRIT_DMG
    }
    if (cycle.c2CritDmg > 0 && EX_TARGETS.has(exec.moveId)) {
      exec.critDmgBonus = (exec.critDmgBonus ?? 0) + cycle.c2CritDmg
    }
  }
}

function applyEllenPanel({ charResult, panel }: AgentSkillTransformInput): void {
  if (!panel) return
  if ((panel as Record<string, unknown>).__ellenPanelApplied) return
  ;(panel as Record<string, unknown>).__ellenPanelApplied = true
  const cycle = charResult.specResources?.ellen_cycle as EllenCycle | undefined
  if (!cycle) return
  if (cycle.c1CritRate > 0) panel.critRate = (panel.critRate ?? 0) + cycle.c1CritRate
  if (cycle.stormSurgeIceDmg > 0) panel.iceDmg = (panel.iceDmg ?? 0) + cycle.stormSurgeIceDmg
  if (cycle.c6PenRatio > 0) panel.penRatio = (panel.penRatio ?? 0) + cycle.c6PenRatio
}

function buildEllenResourceResult({ cfg, state }: AgentResourceResultInput) {
  return { specResources: { ellen_cycle: cycleFromInput({ cfg, state }) } }
}

function buildEllenResourceSections({ result }: AgentResourceSectionsInput) {
  const cycle = result.specResources?.ellen_cycle as EllenCycle | undefined
  if (!cycle) return []
  return [{
    id: 'ellen-cycle',
    title: '艾莲·急冻充能',
    summary: `充能获取 ${cycle.totalChargeGain} · 急冻修剪法 ${cycle.frostTrimSegments} 段`,
    rows: [
      { label: '冰渊潜袭', value: `${cycle.dashCount} 次`, detail: `快速 ${cycle.dashQuickCount}、蓄力 ${cycle.dashChargedCount}，获取充能主力` },
      { label: '强化特殊技获取', value: `+${cycle.exChargeGain}`, detail: '横扫/鲨卷风每次命中+1' },
      { label: '影画4冻结/失衡', value: `+${cycle.c4ChargeGain}`, detail: '按连携次数近似，每次+6' },
      { label: '影画1暴击率', value: `+${cycle.c1CritRate}%`, detail: '每消耗1点充能+2%，最多6层' },
      { label: '影画2强特暴伤', value: `+${cycle.c2CritDmg}%`, detail: '每点持有充能+20%，封顶60%' },
      { label: '风暴潮冰伤', value: `+${cycle.stormSurgeIceDmg}%`, detail: '每层+3%，最多10层' },
      { label: '影画6穿透率', value: `+${cycle.c6PenRatio}%`, detail: '发动强特/连携/快蓄后6秒' },
    ],
    footer: cycle.note,
  }]
}

export const ellenMechanic: AgentMechanicModule = {
  id: 'agent:ellen',
  agentIds: [ELLEN_ID],
  name: '艾莲·凌牙厉齿',
  description: '急冻充能、冰渊潜袭、急冻修剪法、核心被动定向暴伤与影画1/2/4/6。',
  settings: [
    { id: 'ellen.dashQuickCount', label: '冰渊潜袭快速剪击', description: '整局点按快速剪击命中次数，每次获取急冻充能（影画1提升）', default: 6, min: 0, max: 30, step: 1, suffix: '次' },
    { id: 'ellen.dashChargedCount', label: '冰渊潜袭蓄力剪击', description: '整局长按蓄力剪击命中次数，每次获取急冻充能（影画1提升）', default: 3, min: 0, max: 20, step: 1, suffix: '次' },
    { id: 'ellen.c1CritStacks', label: '影画1暴击层数', description: '消耗急冻充能带来的平均暴击率层数', default: 6, min: 0, max: 6, step: 1, suffix: '层' },
    { id: 'ellen.c2AvgCharge', label: '影画2持有充能', description: '发动强化特殊技时平均持有的急冻充能点数', default: 3, min: 0, max: 3, step: 1, suffix: '点' },
    { id: 'ellen.stormSurgeStacks', label: '风暴潮平均层数', description: '额外能力风暴潮的平均叠加层数', default: 10, min: 0, max: 10, step: 1, suffix: '层' },
    { id: 'ellen.c6PenCoverage', label: '影画6穿透覆盖率', description: '穿透率+20%的整局覆盖率', default: 1, min: 0, max: 1, step: 0.05, suffix: '%' },
  ],
  buildCharConfig: buildEllenCharConfig,
  buildExecutions: buildEllenExecutions,
  patchExecutions: patchEllenExecutions,
  transformSkillExecutions: applyEllenPanel,
  buildResourceResult: buildEllenResourceResult,
  resourceSections: buildEllenResourceSections,
}

export default ellenMechanic
