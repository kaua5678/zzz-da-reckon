/**
 * 艾莲（1191）—— 急冻充能、冰渊潜袭、急冻修剪法与影画整局总量模型
 *
 * 原文来源：data/raw/nanoka_missing/full/1191.json，采用 catalog 当前导入的潜能强化版核心被动 Lv.7：
 * 冲刺攻击冰渊潜袭（蓄力剪击）与消耗急冻充能的急冻修剪法暴击伤害+100%，强化版并对连携技、终结技、
 * 霜锋、冰刃浪同样生效（与当前倍率目录口径一致）。
 * - 急冻充能获取按原文拆分：冰渊潜袭快速剪击每次+1（影画1→3）、蓄力剪击每次+3（影画1→6），
 *   强化特殊技横扫/鲨卷风命中各+1，影画4冻结/失衡按连携次数近似每次+6。终结技不获取充能（原文无此来源）。
 * - 充能经济（用户口径 2026-08）：每轮 = 急冻修剪法 3 段（3 充能）+ 冰刃浪 1 次（2 充能，自动不可跳过）= 5 充能；
 *   冰刃浪虽每充能倍率低（377.7 vs 急冻 520.6）但耗时短+无敌+自动，凹分必打，故纳入循环。
 * - 霜锋（1191027/1191028）倍率表融合：挥刀 1191027×3（耗时 0.7s）+ 剑气 1191028×N（不耗时，N 按敌方体型 0/3/6）；
 *   总伤害 = 362.7 + N×26.2（小/中/大 = 362.7/441.3/519.9%）。免费自动（急冻#3 每轮 + 鲨卷风每次）。
 * - 强化特殊技：0命 = 横扫(1191011)+鲨卷风(1191012) 各1次；影画2 = 全鲨卷风（鲨卷风 1106.6% 比横扫 754.5% 赚）。
 * - 冰渊潜袭按真实 moveId 1191007/1191008/1191009 轮转生成，计入冲刺伤害与失衡/异常提取。
 * - 核心被动+100%暴伤只定向挂在受益招式行，不再全局加面板暴伤；受益招式范围按潜能门控：
 *   潜能 I = 冰渊潜袭/急冻修剪法；潜能 II+（强化版）= 另含连携技/终结技/霜锋/冰刃浪。
 * - 影画2按发动强化特殊技时平均持有充能折算暴伤（每点+20%，封顶60%）。
 * - 影画1每消耗1点充能暴击率+2%（最多6层）、额外能力风暴潮每层冰伤+3%、影画6穿透率+20%，
 *   均按平均层数/覆盖率近似并在面板层结算；[快蓄]、[盛宴]未建模。
 * - 潜能觉醒·极冰带（按潜能等级 1-6 档位）：风暴潮每层追加暴伤（II..VI = 1.6/2.4/3.2/4.0/4.8%），
 *   叠满 10 层时无视冰抗（3.3/5/6.7/8.3/10%）。潜能 I 无觉醒=0。经 potentialLevel 输入驱动。
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
/** 霜锋：挥刀(1191027) 0.234s×3≈0.7s 耗时；剑气(1191028) 不耗时 */
export const ELLEN_FROST_EDGE_ACTION_TIMES = [0.234, 0] as const
export const ELLEN_ICE_WAVE_MOVE_IDS = ['1191029', '1191030'] as const
export const ELLEN_EX_MOVE_IDS = ['1191011', '1191012'] as const
/** 强化特殊技：横扫（1191011）与鲨卷风（1191012）动作时间；0命 EX = 横扫+鲨卷风、影画2 全鲨卷风 */
export const ELLEN_EX_SWEEP_ACTION_TIME = 1.55
export const ELLEN_EX_SHARK_ACTION_TIME = 1.317
export const ELLEN_CORE_CRIT_DMG = 100
export const ELLEN_C1_CRIT_RATE_PER_STACK = 2
export const ELLEN_C1_MAX_STACKS = 6
export const ELLEN_C2_CRIT_DMG_PER_CHARGE = 20
export const ELLEN_C2_CRIT_DMG_MAX = 60
export const ELLEN_STORM_SURGE_PER_STACK = 3
export const ELLEN_STORM_SURGE_MAX_STACKS = 10
export const ELLEN_C6_PEN_RATIO = 20
/** 潜能觉醒·极冰带：每层风暴潮追加暴伤（index 0 占位，1=I 无觉醒，2..6=II..VI） */
export const ELLEN_POTENTIAL_CRIT_DMG_PER_STACK = [0, 0, 1.6, 2.4, 3.2, 4.0, 4.8] as const
/** 潜能觉醒·极冰带：风暴潮叠满 10 层后无视冰抗（index 同 0..6） */
export const ELLEN_POTENTIAL_ICE_RES_IGNORE = [0, 0, 3.3, 5, 6.7, 8.3, 10] as const

/** 核心被动·凌牙厉齿暴伤+100% 的受益招式：基础段（潜能 I 就生效） */
const CORE_BASE_TARGETS = new Set<string>([
  ...ELLEN_FROST_TRIM_MOVE_IDS,
  ...ELLEN_DASH_MOVE_IDS,
])
/** 潜能强化版（潜能 II+）额外纳入的受益招式：连携/终结/霜锋/冰刃浪 */
const CORE_ENHANCED_TARGETS = new Set<string>([
  ELLEN_CHAIN_MOVE_ID,
  ELLEN_ULT_MOVE_ID,
  ...ELLEN_FROST_EDGE_MOVE_IDS,
  ...ELLEN_ICE_WAVE_MOVE_IDS,
])
const EX_TARGETS = new Set<string>(ELLEN_EX_MOVE_IDS)

export interface EllenCycle {
  cinemaLevel: number
  potentialLevel: number
  dashQuickCount: number
  dashChargedCount: number
  dashCount: number
  exChargeGain: number
  c4ChargeGain: number
  totalChargeGain: number
  frostTrimSegments: number
  iceWaveCount: number
  c1CritRate: number
  c2CritDmg: number
  stormSurgeIceDmg: number
  c6PenRatio: number
  potentialCritDmg: number
  potentialIceResIgnore: number
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
  potentialLevel: number
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
  const potentialLevel = clamp(whole(input.potentialLevel), 1, 6)
  const dashQuickCount = whole(input.dashQuickCount)
  const dashChargedCount = whole(input.dashChargedCount)
  const quickPer = cinemaLevel >= 1 ? 3 : 1
  const chargedPer = cinemaLevel >= 1 ? 6 : 3
  const dashChargeGain = dashQuickCount * quickPer + dashChargedCount * chargedPer
  const exChargeGain = whole(input.exSpecialCount)
  const c4ChargeGain = cinemaLevel >= 4 ? whole(input.chainCount) * 6 : 0
  const totalChargeGain = dashChargeGain + exChargeGain + c4ChargeGain
  // 充能经济（用户口径 2026-08）：急冻修剪法每段 1 充能、冰刃浪每次 2 充能（自动不可跳过）；
  // 每轮 = 3 段急冻（3 充能）+ 1 次冰刃浪（2 充能）= 5 充能。余量折入急冻段（最多 3 段）。
  const iceWaveCount = Math.floor(totalChargeGain / 5)
  const frostTrimSegments = 3 * iceWaveCount + Math.min(3, totalChargeGain - 5 * iceWaveCount)
  const stormSurgeStacks = clamp(input.stormSurgeStacks, 0, ELLEN_STORM_SURGE_MAX_STACKS)
  return {
    cinemaLevel,
    potentialLevel,
    dashQuickCount,
    dashChargedCount,
    dashCount: dashQuickCount + dashChargedCount,
    exChargeGain,
    c4ChargeGain,
    totalChargeGain,
    frostTrimSegments,
    iceWaveCount,
    c1CritRate: cinemaLevel >= 1
      ? clamp(input.c1CritStacks, 0, ELLEN_C1_MAX_STACKS) * ELLEN_C1_CRIT_RATE_PER_STACK
      : 0,
    c2CritDmg: cinemaLevel >= 2
      ? Math.min(ELLEN_C2_CRIT_DMG_MAX, clamp(input.c2AvgCharge, 0, 3) * ELLEN_C2_CRIT_DMG_PER_CHARGE)
      : 0,
    stormSurgeIceDmg: input.additionalActive
      ? stormSurgeStacks * ELLEN_STORM_SURGE_PER_STACK
      : 0,
    c6PenRatio: cinemaLevel >= 6 ? ELLEN_C6_PEN_RATIO * clamp(input.c6PenCoverage, 0, 1) : 0,
    potentialCritDmg: input.additionalActive
      ? stormSurgeStacks * ELLEN_POTENTIAL_CRIT_DMG_PER_STACK[potentialLevel]
      : 0,
    potentialIceResIgnore: input.additionalActive && stormSurgeStacks >= ELLEN_STORM_SURGE_MAX_STACKS
      ? ELLEN_POTENTIAL_ICE_RES_IGNORE[potentialLevel]
      : 0,
    note: '急冻充能获取按原文拆分，消耗折算为急冻修剪法段数；[快蓄]/[盛宴]未建模。',
  }
}

function buildEllenCharConfig({ cinemaLevel, potentialLevel, cfg, panel }: AgentCharConfigInput): void {
  const record = cfg as unknown as Record<string, unknown>
  record.ellenCinemaLevel = cinemaLevel
  record.ellenPotentialLevel = potentialLevel
  // 强化特殊技主招 = 鲨卷风（影画2 全鲨卷风；0命由 buildExecutions 补横扫实现「横扫+鲨卷风」）
  cfg.exSpecialMoveId = ELLEN_EX_MOVE_IDS[1]
  cfg.exSpecialActionTime = ELLEN_EX_SHARK_ACTION_TIME
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
    potentialLevel: Number(record.ellenPotentialLevel ?? 6),
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

  // 强化特殊技：0命 = 横扫+鲨卷风（横扫补在通用鲨卷风之外）；影画2 = 全鲨卷风（再补一次鲨卷风）
  const exCount = whole(state.exSpecialCount)
  const c2AllShark = cycle.cinemaLevel >= 2
  const sweepCount = c2AllShark ? 0 : exCount
  const extraSharkCount = c2AllShark ? exCount : 0
  pushEllenExecution(executions, {
    moveId: ELLEN_EX_MOVE_IDS[0],
    moveName: '强化特殊技：横扫',
    count: sweepCount,
    category: 'special',
    actionTime: ELLEN_EX_SWEEP_ACTION_TIME,
  })
  pushEllenExecution(executions, {
    moveId: ELLEN_EX_MOVE_IDS[1],
    moveName: '强化特殊技：鲨卷风（影画2全鲨卷风追加）',
    count: extraSharkCount,
    category: 'special',
    actionTime: ELLEN_EX_SHARK_ACTION_TIME,
  })

  // 霜锋（免费自动，倍率表融合）：挥刀(1191027)×3 耗时 + 剑气(1191028)×N 不耗时（N 按敌方体型 0/3/6）
  // 触发：急冻修剪法#3 每轮1次 + 鲨卷风每次1次
  const frostEdgeCount = Math.floor(cycle.frostTrimSegments / 3) + exCount * (c2AllShark ? 2 : 1)
  const bodySize = String((cfg as unknown as Record<string, unknown>).bodySize ?? 'large')
  const qiPerEdge = bodySize === 'small' ? 0 : bodySize === 'medium' ? 3 : 6
  pushEllenExecution(executions, {
    moveId: ELLEN_FROST_EDGE_MOVE_IDS[0],
    moveName: '普通攻击：霜锋（挥刀）',
    count: frostEdgeCount * 3,
    category: 'basic',
    actionTime: ELLEN_FROST_EDGE_ACTION_TIMES[0],
  })
  pushEllenExecution(executions, {
    moveId: ELLEN_FROST_EDGE_MOVE_IDS[1],
    moveName: '普通攻击：霜锋（剑气，不耗时）',
    count: frostEdgeCount * qiPerEdge,
    category: 'basic',
    actionTime: ELLEN_FROST_EDGE_ACTION_TIMES[1],
  })

  // 冰刃浪（自动不可跳过，每次耗 2 充能）：急冻修剪法#3 后自动触发
  const iceWaveCounts = spreadAcross(ELLEN_ICE_WAVE_MOVE_IDS, cycle.iceWaveCount)
  for (let index = 0; index < ELLEN_ICE_WAVE_MOVE_IDS.length; index++) {
    pushEllenExecution(executions, {
      moveId: ELLEN_ICE_WAVE_MOVE_IDS[index],
      moveName: `普通攻击：冰刃浪 #${index + 1}`,
      count: iceWaveCounts[index],
      category: 'basic',
      actionTime: index === 0 ? 0.913 : 0.546,
    })
  }
}

function patchEllenExecutions({ cfg, state, executions }: AgentResourceInput): void {
  const cycle = cycleFromInput({ cfg, state })
  const coreEnhanced = cycle.potentialLevel >= 2
  for (const exec of executions) {
    if (CORE_BASE_TARGETS.has(exec.moveId) || (coreEnhanced && CORE_ENHANCED_TARGETS.has(exec.moveId))) {
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
  if (cycle.potentialCritDmg > 0) panel.critDmg = (panel.critDmg ?? 0) + cycle.potentialCritDmg
  if (cycle.potentialIceResIgnore > 0) panel.enemyIceResReduction = (panel.enemyIceResReduction ?? 0) + cycle.potentialIceResIgnore
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
      { label: '潜能极冰带暴伤', value: `+${cycle.potentialCritDmg}%`, detail: `潜能${cycle.potentialLevel}：每层+${ELLEN_POTENTIAL_CRIT_DMG_PER_STACK[cycle.potentialLevel]}%` },
      { label: '潜能极冰带无视冰抗', value: `+${cycle.potentialIceResIgnore}%`, detail: '风暴潮叠满10层时' },
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
