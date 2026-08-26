/**
 * 艾莲（1191）—— 急冻充能、冰渊潜袭、急冻修剪法与影画整局总量模型
 *
 * 原文来源：data/raw/nanoka_missing/full/1191.json，采用 catalog 当前导入的潜能强化版核心被动 Lv.7：
 * 冲刺攻击冰渊潜袭（蓄力剪击）与消耗急冻充能的急冻修剪法暴击伤害+100%，强化版并对连携技、终结技、
 * 霜锋、冰刃浪同样生效（与当前倍率目录口径一致）。
 * - 基本循环（用户口径 2026-08）：快速蓄力剪击攒充能 → 冰刃浪 → 急冻修剪法第三段 → 霜锋（触发快蓄）
 *   → 冰刃浪 → 第三段 → 霜锋 → … 有充能就打、没充能回去快速蓄力。急冻修剪法第 1/2 段基本不打。
 * - 蓄力剪击 = 回旋斩击(1191007) + 蓄力剪击(1191009)，各一次（点按快速剪击 1191008 不进主循环）；
 *   [快蓄]条件宽松（极限闪避/快速支援/霜锋等均触发），故 1191009 蓄力时间减半（1.106 → 0.553）恒按快蓄计。
 * - 充能经济（用户口径 2026-08 v3·时间驱动）：循环战场时间由**平A池（basicAttackTime）**驱动——
 *   强特（每 +1 充能）与影画4 冻结/失衡（每 +6 充能）提供「免费 burst」（冰刃浪+第三段+霜锋，不需蓄力），
 *   剩余平A时间按「蓄力剪击(+3/6 充能) → 1 轮 burst」的节奏填满；强特越多 → 必要时间越多 → 平A池越小 →
 *   低 DPS 的蓄力剪击被自然挤掉（用户口径：强特优先把低 DPS 的平A和蓄力挤掉）。
 * - 每轮 burst = 冰刃浪(2 充能) + 第三段(1 充能) = 3 充能；冰刃浪与第三段 1:1，霜锋每次第三段自动派生
 *   （另每次鲨卷风派生）。终结技不获取充能（原文无此来源）。
 * - 霜锋（1191027/1191028）倍率表融合：挥刀 1191027×3（耗时 0.7s）+ 剑气 1191028×N（不耗时，N 按敌方体型 0/3/6）。
 * - 强化特殊技：0命 = 横扫(1191011)+鲨卷风(1191012) 各1次；影画2 = 全鲨卷风。
 * - 核心被动+100%暴伤只定向挂在受益招式行；受益招式范围按潜能门控：
 *   潜能 I = 冰渊潜袭/急冻修剪法；潜能 II+（强化版）= 另含连携技/终结技/霜锋/冰刃浪。
 * - 影画2按发动强化特殊技时平均持有充能折算暴伤（每点+20%，封顶60%）。
 * - 影画1每消耗1点充能暴击率+2%（最多6层）、额外能力风暴潮每层冰伤+3%、影画6穿透率+20%，
 *   均按平均层数/覆盖率近似并在面板层结算。
 * - 影画4：冻结/失衡各 +6 充能，并按（冻结次数+失衡次数）×4 回能（能量 10s CD 用可调调节率近似，默认不卡 CD），
 *   回能经 applyTeamConfig converge 幂等并入 initialEnergyGift。冻结次数读异常池 ice 触发数（useResourceCalc 注入）。
 * - 影画6 盛宴：发动强特/连携/快蓄叠层（最多3层），3层后使蓄力剪击伤害 +250%（增伤区 dmgBonus），
 *   按覆盖率在 patchExecutions 定向挂在蓄力剪击(1191009)行。
 * - 潜能觉醒·极冰带（按潜能等级 1-6 档位）：风暴潮每层追加暴伤（II..VI = 1.6/2.4/3.2/4.0/4.8%），
 *   叠满 10 层时无视冰抗（3.3/5/6.7/8.3/10%）。潜能 I 无觉醒=0。经 potentialLevel 输入驱动。
 */
import type {
  AgentCharConfigInput,
  AgentMechanicModule,
  AgentPanelInput,
  AgentResourceInput,
  AgentResourceResultInput,
  AgentResourceSectionsInput,
  AgentTeamConfigInput,
} from '../types'

export const ELLEN_ID = '1191'
export const ELLEN_FROST_TRIM_MOVE_IDS = ['1191006'] as const
export const ELLEN_FROST_TRIM_ACTION_TIMES = [2.232] as const
export const ELLEN_DASH_MOVE_IDS = ['1191007', '1191009'] as const
/** 快蓄（条件宽松恒成立）：蓄力剪击(1191009) 蓄力时间减半 1.106→0.553；回旋斩击(1191007) 0.566 不变 */
export const ELLEN_DASH_ACTION_TIMES = [0.566, 0.553] as const
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
export const ELLEN_C4_CHARGE_PER_TRIGGER = 6
export const ELLEN_C4_ENERGY_PER_TRIGGER = 4
export const ELLEN_C6_FEAST_DMG = 250
export const ELLEN_CHARGE_PER_BURST = 3
/** 潜能觉醒·极冰带：每层风暴潮追加暴伤（index 0 占位，1=I 无觉醒，2..6=II..VI） */
export const ELLEN_POTENTIAL_CRIT_DMG_PER_STACK = [0, 0, 1.6, 2.4, 3.2, 4.0, 4.8] as const
/** 潜能觉醒·极冰带：风暴潮叠满 10 层后无视冰抗（index 同 0..6） */
export const ELLEN_POTENTIAL_ICE_RES_IGNORE = [0, 0, 3.3, 5, 6.7, 8.3, 10] as const

/** 冰刃浪两段（1191029 0.913 + 1191030 0.546）合计前台耗时 */
const ELLEN_ICE_WAVE_TOTAL_ACTION_TIME = 0.913 + 0.546
/** 霜锋每次挥刀（1191027 0.234 × 3）前台耗时 */
const ELLEN_FROST_EDGE_TOTAL_ACTION_TIME = 0.234 * 3
/** 每轮 burst（冰刃浪 + 第三段 + 霜锋）前台耗时 */
const ELLEN_BURST_ACTION_TIME = ELLEN_ICE_WAVE_TOTAL_ACTION_TIME + ELLEN_FROST_TRIM_ACTION_TIMES[0] + ELLEN_FROST_EDGE_TOTAL_ACTION_TIME
/** 蓄力剪击（回旋 0.566 + 蓄力 0.553 快蓄减半）前台耗时 */
const ELLEN_DASH_TOTAL_ACTION_TIME = ELLEN_DASH_ACTION_TIMES[0] + ELLEN_DASH_ACTION_TIMES[1]

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
  basicAttackTime: number
  dashChargedCount: number
  dashCount: number
  exChargeGain: number
  freezeCount: number
  stunCount: number
  c4TriggerCount: number
  c4ChargeGain: number
  c4EnergyTotal: number
  extraBursts: number
  totalChargeGain: number
  iceWaveCount: number
  frostTrimSegments: number
  frostEdgeCount: number
  c1CritRate: number
  c2CritDmg: number
  stormSurgeIceDmg: number
  c6PenRatio: number
  c6FeastDmg: number
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
  basicAttackTime: number
  exSpecialCount: number
  freezeCount: number
  stunCount: number
  c4CdRate: number
  additionalActive: boolean
  c1CritStacks: number
  c2AvgCharge: number
  stormSurgeStacks: number
  c6PenCoverage: number
  c6FeastCoverage: number
}): EllenCycle {
  const cinemaLevel = whole(input.cinemaLevel)
  const potentialLevel = clamp(whole(input.potentialLevel), 1, 6)
  const basicAttackTime = Math.max(0, Number.isFinite(input.basicAttackTime) ? input.basicAttackTime : 0)
  const chargedPer = cinemaLevel >= 1 ? 6 : 3
  const exChargeGain = whole(input.exSpecialCount)
  const freezeCount = whole(input.freezeCount)
  const stunCount = whole(input.stunCount)
  const c4TriggerCount = cinemaLevel >= 4 ? freezeCount + stunCount : 0
  const c4ChargeGain = c4TriggerCount * ELLEN_C4_CHARGE_PER_TRIGGER
  const c4EnergyTotal = cinemaLevel >= 4
    ? c4TriggerCount * ELLEN_C4_ENERGY_PER_TRIGGER * clamp(input.c4CdRate, 0, 1)
    : 0
  // 强特/影画4 提供的免费 burst（不需蓄力剪击）：extraCharge / 3（充能有界，展示用）
  const extraCharge = exChargeGain + c4ChargeGain
  const extraBursts = Math.floor(extraCharge / ELLEN_CHARGE_PER_BURST)
  // 鲨卷风（0命1/EX、影画2全鲨卷风2/EX）各派生一次霜锋（挥刀 0.702s）
  const sharkCount = exChargeGain * (cinemaLevel >= 2 ? 2 : 1)
  const sharkTime = sharkCount * ELLEN_FROST_EDGE_TOTAL_ACTION_TIME
  // 时间预算直接求解 burst 数（时间有界）：充能平衡 + 时间约束联立——
  //   dashCount × dashTime + iceWaveCount × burstTime + sharkTime = basicAttackTime（时间）
  //   iceWaveCount × 3 = dashCount × chargedPer + extraCharge（充能）
  //   → iceWaveCount = (basicAttackTime + extraCharge×dashTime/chargedPer − sharkTime) / (3×dashTime/chargedPer + burstTime)
  // 强特/影画4 越多 → 必要时间越多 → 平A池越小 → 低 DPS 蓄力剪击被自然挤掉（用户口径）。
  const timeNumerator = basicAttackTime + extraCharge * ELLEN_DASH_TOTAL_ACTION_TIME / chargedPer - sharkTime
  const timeDenominator = ELLEN_CHARGE_PER_BURST * ELLEN_DASH_TOTAL_ACTION_TIME / chargedPer + ELLEN_BURST_ACTION_TIME
  const iceWaveCount = Math.max(0, Math.floor(timeNumerator / timeDenominator))
  const dashChargedCount = Math.max(0, Math.floor(
    (iceWaveCount * ELLEN_CHARGE_PER_BURST - extraCharge) / chargedPer))
  const dashChargeGain = dashChargedCount * chargedPer
  const totalChargeGain = dashChargeGain + extraCharge
  const frostTrimSegments = iceWaveCount
  const frostEdgeCount = frostTrimSegments + sharkCount
  const stormSurgeStacks = clamp(input.stormSurgeStacks, 0, ELLEN_STORM_SURGE_MAX_STACKS)
  return {
    cinemaLevel,
    potentialLevel,
    basicAttackTime,
    dashChargedCount,
    dashCount: dashChargedCount,
    exChargeGain,
    freezeCount,
    stunCount,
    c4TriggerCount,
    c4ChargeGain,
    c4EnergyTotal,
    extraBursts,
    totalChargeGain,
    iceWaveCount,
    frostTrimSegments,
    frostEdgeCount,
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
    c6FeastDmg: cinemaLevel >= 6 ? ELLEN_C6_FEAST_DMG * clamp(input.c6FeastCoverage, 0, 1) : 0,
    potentialCritDmg: input.additionalActive
      ? stormSurgeStacks * ELLEN_POTENTIAL_CRIT_DMG_PER_STACK[potentialLevel]
      : 0,
    potentialIceResIgnore: input.additionalActive && stormSurgeStacks >= ELLEN_STORM_SURGE_MAX_STACKS
      ? ELLEN_POTENTIAL_ICE_RES_IGNORE[potentialLevel]
      : 0,
    note: '平A池时间驱动：强特/影画4 充能先结算免费 burst，剩余时间按蓄力剪击填满（强特挤掉低DPS蓄力）；急冻修剪法只打第三段；影画4冻结读异常池。',
  }
}

function buildEllenCharConfig({ cinemaLevel, potentialLevel, cfg, panel }: AgentCharConfigInput): void {
  const record = cfg as unknown as Record<string, unknown>
  record.ellenCinemaLevel = cinemaLevel
  record.ellenPotentialLevel = potentialLevel
  // 强化特殊技主招 = 鲨卷风（影画2 全鲨卷风；0命由 buildExecutions 补横扫实现「横扫+鲨卷风」）
  cfg.exSpecialMoveId = ELLEN_EX_MOVE_IDS[1]
  cfg.exSpecialActionTime = ELLEN_EX_SHARK_ACTION_TIME
  record.ellenC1CritStacks = clamp(setting(cfg, 'ellen.c1CritStacks', 6), 0, ELLEN_C1_MAX_STACKS)
  record.ellenC2AvgCharge = clamp(setting(cfg, 'ellen.c2AvgCharge', 3), 0, 3)
  record.ellenStormSurgeStacks = clamp(setting(cfg, 'ellen.stormSurgeStacks', 10), 0, ELLEN_STORM_SURGE_MAX_STACKS)
  record.ellenC6PenCoverage = clamp(setting(cfg, 'ellen.c6PenCoverage', 1), 0, 1)
  record.ellenC4CdRate = clamp(setting(cfg, 'ellen.c4CdRate', 1), 0, 1)
  record.ellenC6FeastCoverage = clamp(setting(cfg, 'ellen.c6FeastCoverage', 1), 0, 1)
  record.ellenFreezeCount = 0 // 由 useResourceCalc 从异常池 ice 触发数注入；失衡次数由 applyTeamConfig converge 写入
  record.ellenStunCount = 0
  record.ellenAdditionalActive = (panel.additionalAbilityActive ?? 0) > 0
}

/**
 * 影画4 无休寒潮（applyTeamConfig · converge 阶段）：
 * 队伍任意角色冻结/失衡时自身 +6 充能 + 快蓄 + 4 能量（能量 10s CD 用可调调节率近似，默认不卡 CD）。
 * 失衡次数 = 收敛后的 stunCount；冻结次数由 useResourceCalc 从异常池 ice 触发数注入 cfg。回能幂等并入
 * initialEnergyGift（可琳影画4 同款）。
 */
function applyEllenTeamConfig({ slot, cinemaLevel, characters, phase, stunCount }: AgentTeamConfigInput): void {
  if (phase !== 'converge') return
  const cfg = characters[slot]
  if (!cfg || cinemaLevel < 4) return
  const record = cfg as unknown as Record<string, unknown>
  const resolvedStun = Math.max(0, Math.floor(Number(stunCount) || 0))
  record.ellenStunCount = resolvedStun
  const freezeCount = Math.max(0, Math.floor(Number(record.ellenFreezeCount) || 0))
  const cdRate = clamp(Number(record.ellenC4CdRate ?? 1), 0, 1)
  const gift = (freezeCount + resolvedStun) * ELLEN_C4_ENERGY_PER_TRIGGER * cdRate
  const prev = Math.max(0, Number(record.ellenC4EnergyTotal ?? 0))
  cfg.initialEnergyGift = Math.max(0, (cfg.initialEnergyGift ?? 0) - prev) + gift
  record.ellenC4EnergyTotal = gift
}

function cycleFromInput({ cfg, state }: Pick<AgentResourceInput, 'cfg' | 'state'>): EllenCycle {
  const record = cfg as unknown as Record<string, unknown>
  return computeEllenCycle({
    cinemaLevel: Number(record.ellenCinemaLevel ?? 0),
    potentialLevel: Number(record.ellenPotentialLevel ?? 6),
    basicAttackTime: Number(state.basicAttackTime ?? 0),
    exSpecialCount: state.exSpecialCount,
    freezeCount: Number(record.ellenFreezeCount ?? 0),
    stunCount: Number(record.ellenStunCount ?? 0),
    c4CdRate: Number(record.ellenC4CdRate ?? 1),
    additionalActive: record.ellenAdditionalActive === true,
    c1CritStacks: Number(record.ellenC1CritStacks ?? 6),
    c2AvgCharge: Number(record.ellenC2AvgCharge ?? 3),
    stormSurgeStacks: Number(record.ellenStormSurgeStacks ?? 10),
    c6PenCoverage: Number(record.ellenC6PenCoverage ?? 1),
    c6FeastCoverage: Number(record.ellenC6FeastCoverage ?? 1),
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

function buildEllenExecutions({ cfg, state, executions }: AgentResourceInput): void {
  const cycle = cycleFromInput({ cfg, state })

  // 急冻修剪法只打第三段（第1/2段基本不打，用户口径）
  pushEllenExecution(executions, {
    moveId: ELLEN_FROST_TRIM_MOVE_IDS[0],
    moveName: '普通攻击：急冻修剪法 #3',
    count: cycle.frostTrimSegments,
    category: 'basic',
    actionTime: ELLEN_FROST_TRIM_ACTION_TIMES[0],
  })

  // 冰渊潜袭 = 回旋斩击(1191007) + 蓄力剪击(1191009)，每次蓄力剪击各执行一次（点按快速剪击不进主循环）
  pushEllenExecution(executions, {
    moveId: ELLEN_DASH_MOVE_IDS[0],
    moveName: '冲刺攻击：冰渊潜袭·回旋斩击',
    count: cycle.dashChargedCount,
    category: 'dodge',
    actionTime: ELLEN_DASH_ACTION_TIMES[0],
  })
  pushEllenExecution(executions, {
    moveId: ELLEN_DASH_MOVE_IDS[1],
    moveName: '冲刺攻击：冰渊潜袭·蓄力剪击（快蓄）',
    count: cycle.dashChargedCount,
    category: 'dodge',
    actionTime: ELLEN_DASH_ACTION_TIMES[1],
  })

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
  const bodySize = String((cfg as unknown as Record<string, unknown>).bodySize ?? 'large')
  const qiPerEdge = bodySize === 'small' ? 0 : bodySize === 'medium' ? 3 : 6
  pushEllenExecution(executions, {
    moveId: ELLEN_FROST_EDGE_MOVE_IDS[0],
    moveName: '普通攻击：霜锋（挥刀）',
    count: cycle.frostEdgeCount * 3,
    category: 'basic',
    actionTime: ELLEN_FROST_EDGE_ACTION_TIMES[0],
  })
  pushEllenExecution(executions, {
    moveId: ELLEN_FROST_EDGE_MOVE_IDS[1],
    moveName: '普通攻击：霜锋（剑气，不耗时）',
    count: cycle.frostEdgeCount * qiPerEdge,
    category: 'basic',
    actionTime: ELLEN_FROST_EDGE_ACTION_TIMES[1],
  })

  // 冰刃浪（每次耗 2 充能，自动不可跳过）：每轮 burst 与急冻修剪法第三段 1:1，两段各一次
  pushEllenExecution(executions, {
    moveId: ELLEN_ICE_WAVE_MOVE_IDS[0],
    moveName: '普通攻击：冰刃浪 #1',
    count: cycle.iceWaveCount,
    category: 'basic',
    actionTime: 0.913,
  })
  pushEllenExecution(executions, {
    moveId: ELLEN_ICE_WAVE_MOVE_IDS[1],
    moveName: '普通攻击：冰刃浪 #2',
    count: cycle.iceWaveCount,
    category: 'basic',
    actionTime: 0.546,
  })
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
    // 影画6 盛宴：3层后蓄力剪击(1191009) 伤害 +250%（增伤区 dmgBonus）
    if (cycle.c6FeastDmg > 0 && exec.moveId === ELLEN_DASH_MOVE_IDS[1]) {
      exec.dmgBonus = (exec.dmgBonus ?? 0) + cycle.c6FeastDmg
    }
  }
}

function applyEllenPanel({ cinemaLevel, potentialLevel, panel, settings }: AgentPanelInput): void {
  // 面板字段与 computeEllenCycle 同源（c1CritRate / stormSurgeIceDmg / c6PenRatio / potentialCritDmg / potentialIceResIgnore）。
  const c1CritStacks = clamp(settings['ellen.c1CritStacks'] ?? 6, 0, ELLEN_C1_MAX_STACKS)
  const stormSurgeStacks = clamp(settings['ellen.stormSurgeStacks'] ?? 10, 0, ELLEN_STORM_SURGE_MAX_STACKS)
  const c6PenCoverage = clamp(settings['ellen.c6PenCoverage'] ?? 1, 0, 1)
  const potentialLevelClamped = clamp(whole(potentialLevel), 1, 6)
  const additionalActive = (panel.additionalAbilityActive ?? 0) > 0
  if (cinemaLevel >= 1) {
    panel.critRate = (panel.critRate ?? 0) + c1CritStacks * ELLEN_C1_CRIT_RATE_PER_STACK
  }
  if (additionalActive) {
    panel.iceDmg = (panel.iceDmg ?? 0) + stormSurgeStacks * ELLEN_STORM_SURGE_PER_STACK
    panel.critDmg = (panel.critDmg ?? 0)
      + stormSurgeStacks * ELLEN_POTENTIAL_CRIT_DMG_PER_STACK[potentialLevelClamped]
    if (stormSurgeStacks >= ELLEN_STORM_SURGE_MAX_STACKS) {
      panel.enemyIceResReduction = (panel.enemyIceResReduction ?? 0)
        + ELLEN_POTENTIAL_ICE_RES_IGNORE[potentialLevelClamped]
    }
  }
  if (cinemaLevel >= 6) {
    panel.penRatio = (panel.penRatio ?? 0) + ELLEN_C6_PEN_RATIO * c6PenCoverage
  }
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
    summary: `充能获取 ${cycle.totalChargeGain} · 冰刃浪 ${cycle.iceWaveCount} 次 · 急冻修剪法第三段 ${cycle.frostTrimSegments} 段`,
    rows: [
      { label: '平A池时间', value: `${cycle.basicAttackTime.toFixed(1)}s`, detail: '循环战场时间由平A池驱动（强特挤掉低DPS蓄力）' },
      { label: '冰渊潜袭蓄力剪击', value: `${cycle.dashChargedCount} 次`, detail: '回旋斩击+蓄力剪击各一次（快蓄，1191009 蓄力时间减半）' },
      { label: '冰刃浪', value: `${cycle.iceWaveCount} 次`, detail: '每轮 burst 与第三段 1:1，每次耗 2 充能' },
      { label: '急冻修剪法第三段', value: `${cycle.frostTrimSegments} 段`, detail: '第1/2段基本不打' },
      { label: '霜锋', value: `${cycle.frostEdgeCount} 次`, detail: '第三段每次自动派生 + 鲨卷风每次派生' },
      { label: '强化特殊技获取', value: `+${cycle.exChargeGain}`, detail: '横扫/鲨卷风每次命中+1，折算免费 burst' },
      { label: '影画4冻结/失衡', value: `充能 +${cycle.c4ChargeGain} · 回能 +${cycle.c4EnergyTotal.toFixed(1)}`, detail: `${cycle.c4TriggerCount} 次触发（冻结${cycle.freezeCount}+失衡${cycle.stunCount}）×6充能 / ×4回能×CD率` },
      { label: '影画1暴击率', value: `+${cycle.c1CritRate}%`, detail: '每消耗1点充能+2%，最多6层' },
      { label: '影画2强特暴伤', value: `+${cycle.c2CritDmg}%`, detail: '每点持有充能+20%，封顶60%' },
      { label: '风暴潮冰伤', value: `+${cycle.stormSurgeIceDmg}%`, detail: '每层+3%，最多10层' },
      { label: '潜能极冰带暴伤', value: `+${cycle.potentialCritDmg}%`, detail: `潜能${cycle.potentialLevel}：每层+${ELLEN_POTENTIAL_CRIT_DMG_PER_STACK[cycle.potentialLevel]}%` },
      { label: '潜能极冰带无视冰抗', value: `+${cycle.potentialIceResIgnore}%`, detail: '风暴潮叠满10层时' },
      { label: '影画6穿透率', value: `+${cycle.c6PenRatio}%`, detail: '发动强特/连携/快蓄后6秒' },
      { label: '影画6盛宴', value: `+${cycle.c6FeastDmg}%`, detail: '3层后蓄力剪击伤害+250%（增伤区，按覆盖率）' },
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
    { id: 'ellen.c1CritStacks', label: '影画1暴击层数', description: '消耗急冻充能带来的平均暴击率层数', default: 6, min: 0, max: 6, step: 1, suffix: '层' },
    { id: 'ellen.c2AvgCharge', label: '影画2持有充能', description: '发动强化特殊技时平均持有的急冻充能点数', default: 3, min: 0, max: 3, step: 1, suffix: '点' },
    { id: 'ellen.stormSurgeStacks', label: '风暴潮平均层数', description: '额外能力风暴潮的平均叠加层数', default: 10, min: 0, max: 10, step: 1, suffix: '层' },
    { id: 'ellen.c4CdRate', label: '影画4回能CD率', description: '能量回复10秒CD的触发调节率（默认1=不卡CD）', default: 1, min: 0, max: 1, step: 0.05, suffix: '%' },
    { id: 'ellen.c6PenCoverage', label: '影画6穿透覆盖率', description: '穿透率+20%的整局覆盖率', default: 1, min: 0, max: 1, step: 0.05, suffix: '%' },
    { id: 'ellen.c6FeastCoverage', label: '影画6盛宴覆盖率', description: '3层盛宴后蓄力剪击伤害+250%的覆盖率（每3层强化一次蓄力剪击）', default: 1, min: 0, max: 1, step: 0.05, suffix: '%' },
  ],
  applyPanel: applyEllenPanel,
  buildCharConfig: buildEllenCharConfig,
  applyTeamConfig: applyEllenTeamConfig,
  buildExecutions: buildEllenExecutions,
  patchExecutions: patchEllenExecutions,
  buildResourceResult: buildEllenResourceResult,
  resourceSections: buildEllenResourceSections,
}

export default ellenMechanic
