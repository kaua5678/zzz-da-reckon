import type { AgentCharConfigInput, AgentEventInput, AgentMechanicModule, AgentPanelInput, AgentResourceInput } from '../types'
import type { AgentSkills, SkillMove } from '@/types/catalog'
import type { AnomalyEventExecution, MechanicSetting } from '@/types/resource'

/**
 * 月城柳（1221，电·异常，对空洞特别行动部第六课）—— 核心被动/额外能力/影画面板区（薄模块）。
 * 机制文本来源：nanoka 3.2.3+18244196 zh character/1221.json。
 *
 * 拐力主体在 teammate-buffs.json 1221 组：核心被动[紊乱]伤害倍率+250%
 * （disorderBaseMultiplierBonus，全队受益）、影画4 [识破]穿透率+16%（penRatio，cinemaLevel≥4 门控）。
 *
 * 本模块承接（均为月城柳自身面板，按整局覆盖近似——状态由招式高频刷新，常驻近似）：
 * - 核心被动·月蚀：强化特殊技命中后，自身电属性伤害+20%（15s 刷新）→ panel.electricDmg += 20。
 * - 额外能力·月相：队伍存在其他[异常]或同属性（电）角色时，架势切换后夜见尊神乐的
 *   电属性异常积蓄值+45% → panel.electricAnomalyBuildUpEfficiency += 45（additionalAbilityActive 门控）。
 * - 影画1 知己知彼：持[洞悉]（属性异常施加叠层，至多3层，15s 刷新）时异常精通+80
 *   → panel.anomalyProficiency += 80。
 * - 影画2 卓越适应性：强化特殊技快速突刺累积电属性异常积蓄值+20% → panel.electricAnomalyBuildUpEfficiency += 20。
 * - 影画6 非人之血：森罗万象状态期间强化特殊技伤害+20% → panel.skillDmgBonus__exSpecial += 20。
 *
 * 未建模（spec notes）：[洞悉]受击无敌（防御向）、[森罗万象]状态逐时序（按强特高频近似常驻）。
 * 注意：影画2 长按追加突刺（含耗能）/极性紊乱倍率、影画6 极性紊乱上限4次/耗能减半均已建模
 * （见下方 buildCharConfig/buildExecutions/buildYanagiAnomalyEvents 与滑块 yanagi.extraThrustCount）；
 * 档案/星座 pending 如有「未建模」字样为过期文案，勿再补做。
 */

const YANAGI_AGENT_ID = '1221'
const YANAGI_ELECTRIC_BUILDUP_BONUS = 45
const YANAGI_CORE_ELECTRIC_DMG = 20
const YANAGI_C1_PROFICIENCY = 80
const YANAGI_C2_BUILDUP_BONUS = 20
const YANAGI_C6_EX_SPECIAL_DMG = 20
/** 强化特殊技·月华流转 突刺段（C2 长按追加突刺的载体 moveId） */
const YANAGI_THRUST_MOVE_ID = '1221022'
/** 极性紊乱倍率：C0 = 原紊乱 15%；C2 = 20% + 每额外突刺 15%（上限 2 次） */
const YANAGI_POLAR_RATIO_C0 = 0.15
const YANAGI_POLAR_RATIO_C2_BASE = 0.20
const YANAGI_POLAR_RATIO_PER_THRUST = 0.15
/** 月华流转基础能量（突刺+下砸）；每次额外突刺 +10 能量（影画2 长按追加突刺） */
const YANAGI_EX_BASE_ENERGY = 40
/** 影画2 额外突刺能量 +10；影画6 前 4 次额外突刺能量减半 → +5 */
const YANAGI_EXTRA_THRUST_ENERGY = 10
const YANAGI_EXTRA_THRUST_ENERGY_C6 = 5
/** 影画2 极性紊乱倍率额外提升触发上限 2 次；影画6 提升至 4 次 */
const YANAGI_EXTRA_THRUST_MAX_C2 = 2
const YANAGI_EXTRA_THRUST_MAX_C6 = 4

function setting(cfg: AgentCharConfigInput['cfg'], id: string, fallback: number): number {
  const value = Number((cfg as unknown as Record<string, unknown>)[`setting:${id}`])
  return Number.isFinite(value) ? value : fallback
}

function findMove(skills: AgentSkills | undefined, moveId: string): SkillMove | null {
  if (!skills) return null
  for (const cat of skills.categories) {
    const m = cat.moves.find((x) => x.id === moveId)
    if (m) return m
  }
  return null
}

function rowValue(move: SkillMove | null, rowId: string): number {
  const row = move?.rows.find((r) => r.id === rowId)
  return row?.values[0] ?? 0
}

function buildYanagiCharConfig({ cfg, cinemaLevel, skills }: AgentCharConfigInput): void {
  const record = cfg as unknown as Record<string, unknown>
  const cinema = cinemaLevel ?? 0
  record.yanagiCinemaLevel = cinema
  const thrust = findMove(skills, YANAGI_THRUST_MOVE_ID)
  record.yanagiThrustDamage = rowValue(thrust, 'damage')
  record.yanagiThrustDaze = rowValue(thrust, 'daze')
  record.yanagiThrustAnomaly = rowValue(thrust, 'anomaly_buildup')
  // 影画2 追加突刺次数（滑块可调；0 命恒 0）。上限：2 命 = 2 次、6 命 = 4 次；
  // 能量：2 命每次 +10，6 命前 4 次能量减半（+5）。基础 40 = 突刺 + 下砸。
  const maxThrusts = cinema >= 6 ? YANAGI_EXTRA_THRUST_MAX_C6 : YANAGI_EXTRA_THRUST_MAX_C2
  const energyPerThrust = cinema >= 6 ? YANAGI_EXTRA_THRUST_ENERGY_C6 : YANAGI_EXTRA_THRUST_ENERGY
  const extraThrusts = cinema >= 2
    ? Math.max(0, Math.min(maxThrusts, Math.floor(setting(cfg, 'yanagi.extraThrustCount', 1))))
    : 0
  record.yanagiExtraThrustCount = extraThrusts
  cfg.exSpecialEnergyConsume = YANAGI_EX_BASE_ENERGY + energyPerThrust * extraThrusts
}

/** 影画2：长按可额外消耗 10 能量再发动一次突刺（每次 EX 额外 N 段突刺，N=滑块，倍率与首段突刺一致） */
function buildYanagiExecutions({ cfg, state, executions }: AgentResourceInput): void {
  const record = cfg as unknown as Record<string, unknown>
  const extraThrusts = Math.max(0, Math.floor(Number(record.yanagiExtraThrustCount ?? 0)))
  if (extraThrusts <= 0) return
  const exCount = Math.max(0, Math.floor(state.exSpecialCount))
  if (exCount <= 0) return
  const count = exCount * extraThrusts
  executions.push({
    moveId: YANAGI_THRUST_MOVE_ID,
    moveName: `强化特殊技：月华流转·追加突刺×${extraThrusts}（影画2）`,
    category: 'special',
    count,
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
    damageMultiplier: Number(record.yanagiThrustDamage ?? 0),
    damageMultiplierOverride: true,
    dazeMultiplier: Number(record.yanagiThrustDaze ?? 0),
    dazeMultiplierOverride: true,
    anomalyBuildUp: Number(record.yanagiThrustAnomaly ?? 0),
    anomalyBuildUpOverride: true,
    timeBucket: 'necessary',
  })
}

function applyYanagiPanel({ panel, cinemaLevel }: AgentPanelInput): void {
  if (!panel) return
  // 核心被动·月蚀：强特命中后自身电伤+20%（15s 刷新，整局高频强特近似常驻）
  panel.electricDmg = (panel.electricDmg ?? 0) + YANAGI_CORE_ELECTRIC_DMG
  // 额外能力·月相：其他异常/同属性队友门控，电异常积蓄+45%
  if ((panel.additionalAbilityActive ?? 0) > 0) {
    panel.electricAnomalyBuildUpEfficiency = (panel.electricAnomalyBuildUpEfficiency ?? 0)
      + YANAGI_ELECTRIC_BUILDUP_BONUS
  }
  // 影画1：持[洞悉]异常精通+80（异常施加叠层 15s 刷新，异常队近似常驻）
  if (cinemaLevel >= 1) {
    panel.anomalyProficiency = (panel.anomalyProficiency ?? 0) + YANAGI_C1_PROFICIENCY
  }
  // 影画2：强特快速突刺电异常积蓄+20%（突刺期间近似常驻）
  if (cinemaLevel >= 2) {
    panel.electricAnomalyBuildUpEfficiency = (panel.electricAnomalyBuildUpEfficiency ?? 0)
      + YANAGI_C2_BUILDUP_BONUS
  }
  // 影画6：森罗万象期间强特伤害+20%
  if (cinemaLevel >= 6) {
    panel.skillDmgBonus__exSpecial = (panel.skillDmgBonus__exSpecial ?? 0) + YANAGI_C6_EX_SPECIAL_DMG
  }
}

/** 极性紊乱：每次月华流转下落攻击命中异常状态敌人触发 1 次（≈强特次数）；倍率随命座/突刺数变化。 */
function buildYanagiAnomalyEvents({ cfg, state, events }: AgentEventInput): void {
  const record = cfg as unknown as Record<string, unknown>
  const cinema = Math.max(0, Math.floor(Number(record.yanagiCinemaLevel ?? 0)))
  const count = Math.max(0, Math.floor(state.exSpecialCount))
  if (count <= 0) return
  // C0 = 15%；C2 = 20% + 每额外突刺 15%（额外突刺次数读滑块，上限 2 次）
  const extraThrusts = Math.max(0, Math.floor(Number(record.yanagiExtraThrustCount ?? 0)))
  const maxThrusts = cinema >= 6 ? YANAGI_EXTRA_THRUST_MAX_C6 : YANAGI_EXTRA_THRUST_MAX_C2
  const ratio = cinema >= 2
    ? YANAGI_POLAR_RATIO_C2_BASE + YANAGI_POLAR_RATIO_PER_THRUST * Math.min(maxThrusts, extraThrusts)
    : YANAGI_POLAR_RATIO_C0
  events.push({
    eventId: 'yanagi_polar_disorder',
    eventName: '月城柳·极性紊乱',
    eventType: 'polar_disorder',
    element: 'dominant',
    carrierMoveName: '强化特殊技：月华流转·下落攻击',
    count,
    polarDisorderRatio: ratio,
    formula: `极性紊乱 = 原紊乱 × ${(ratio * 100).toFixed(0)}%（C2 每额外突刺 +15%，上限 2 次）`,
    note: `下落攻击命中异常状态敌人触发（次数≈强特次数）；C0 ${(YANAGI_POLAR_RATIO_C0 * 100).toFixed(0)}%、C2 ${(YANAGI_POLAR_RATIO_C2_BASE * 100).toFixed(0)}%+${(YANAGI_POLAR_RATIO_PER_THRUST * 100).toFixed(0)}%×额外突刺${extraThrusts}（上限 ${maxThrusts} 次：2命 2、6命 4）。`,
  } as AnomalyEventExecution)
}

const settings: MechanicSetting[] = [
  {
    id: 'yanagi.extraThrustCount',
    label: '月城柳·追加突刺次数',
    description: '影画2：长按可额外消耗能量再发动突刺的次数（2命上限2、6命上限4），默认1（每个强特 = 突刺+下砸 + N 次追加突刺；2命能量 40+10×N，6命前4次减半 40+5×N）。',
    default: 1,
    min: 0,
    max: 4,
    step: 1,
    suffix: '次',
  },
]

export const yanagiMechanic: AgentMechanicModule = {
  id: 'agent:tsukishiro_yanagi',
  agentIds: [YANAGI_AGENT_ID],
  name: '月城柳',
  description: '核心被动电伤+20%、额外能力电异常积蓄+45%、影画1异常精通+80、影画2突刺积蓄+20%+追加突刺（滑块）+极性紊乱、影画6强特+20%；紊乱倍率/识破穿透在 teammate-buffs 1221 组。',
  applyPanel: applyYanagiPanel,
  buildCharConfig: buildYanagiCharConfig,
  buildExecutions: buildYanagiExecutions,
  buildAnomalyEvents: buildYanagiAnomalyEvents,
  settings,
  combos: {
    'yanagi-moonlight-flow': {
      label: '月华流转',
      energyCost: YANAGI_EX_BASE_ENERGY,
      moves: [{ moveId: '1221022', count: 1 }, { moveId: '1221023', count: 1 }],
    },
  },
}
