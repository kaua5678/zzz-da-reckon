/**
 * 丽娜（1211）—— 整局近似口径
 *
 * - 核心被动与影画1由 teammate-buffs 计算：仅队友获得穿透，影画1追加基础值的30%。
 * - 影画2：接战成为当前操作角色后自身伤害+15%，按12s/18s冷却折为2/3覆盖。
 * - 影画4：双邦布均在外时回能+0.5/s，用 rina.c4DoubleBangbooCoverage 调节，默认满覆盖。
 * - 影画6：指定技能命中后全队电伤+15%持续8s，由队友增益覆盖率调节。
 * - 终结技：其他角色+10能量，下一位换入额外+20；三人队按下一位30、上一位10分配。
 * - [一尘不染]：强特/连携/终结各触发13s；期间邦布每2.5s攻击1次（晨间清扫，三段合计，按物理计），
 *   每次攻击+1层[惊吓]，满6层后下一次攻击改为午夜清扫（按电计，消耗全部惊吓），即每7次1个午夜。
 *   后台自动，不占前台时间；buff 总时长按战斗总时长钳制。元素经 resolveExecutionDamage 覆盖。
 *
 * 未建模：邦布逐秒离场状态、感电敌人的逐秒状态；对应效果采用整局覆盖率近似。
 */
import type {
  AgentCharConfigInput,
  AgentDamageResolutionInput,
  AgentMechanicModule,
  AgentResourceInput,
  AgentResourceResultInput,
  AgentResourceSectionsInput,
} from '../types'
import type { AgentSkills, SkillMove } from '@/types/catalog'
import type { CharacterOperationConfig, SkillExecution } from '@/types/resource'
import { fmt } from '@/utils/format'

export const RINA_ID = '1211'
const C2_COVERAGE = 12 / 18

// [一尘不染]邦布攻击：晨间清扫三段（各105.3%）与午夜清扫（420.1%）
const MOVE_SWEEP_1 = '1211023'
const MOVE_SWEEP_2 = '1211024'
const MOVE_SWEEP_3 = '1211025'
const MOVE_MIDNIGHT = '1211027'
/** 单次[一尘不染]持续秒数 */
export const RINA_SPOTLESS_DURATION = 13
/** 邦布攻击间隔（秒） */
const RINA_BANGBOO_INTERVAL = 2.5
/** 惊吓周期：6次普攻攒满 + 第7次消耗为午夜清扫 */
const RINA_FRIGHT_CYCLE = 7

function findMove(skills: AgentSkills | undefined, id: string): SkillMove | null {
  if (!skills) return null
  for (const c of skills.categories) {
    const m = c.moves.find(x => x.id === id)
    if (m) return m
  }
  return null
}

function rowVal(move: SkillMove | null | undefined, rowId: string): number {
  const row = move?.rows?.find(r => r.id === rowId)
  const vals = row?.values ?? []
  if (!vals.length) return 0
  return Number(vals[11] ?? vals[vals.length - 1] ?? 0) || 0
}

/** 满级核心被动穿透增益；影画1在封顶后的结果上提升至130%。 */
export function computeRinaCorePenRatio(sourcePenRatio: number, cinemaLevel = 0): number {
  const base = Math.min(30, Math.max(0, sourcePenRatio) * 0.25 + 12)
  return base * (cinemaLevel >= 1 ? 1.3 : 1)
}

export interface RinaBangbooInput {
  exSpecialCount: number
  chainCountTotal: number
  ultimateCount: number
  /** 战斗总时长（秒），用于钳制 buff 总时长 */
  combatTime: number
}

export interface RinaBangbooResult {
  /** [一尘不染]触发次数（强特+连携+终结） */
  triggers: number
  /** buff 总时长（秒，已按战斗总时长钳制） */
  buffTime: number
  /** 邦布攻击总次数 = floor(buffTime / 2.5) */
  attacks: number
  /** 晨间清扫次数（每次按三段合计倍率） */
  sweepCount: number
  /** 午夜清扫次数（惊吓满6层后下一次攻击转化） */
  midnightCount: number
}

/**
 * [一尘不染]邦布攻击纯函数（用户口径）：
 * 强特/连携/终结每次触发13s，期间每2.5s攻击1次并+1层惊吓；
 * 惊吓满6层后下一次晨间清扫消耗全部惊吓改为午夜清扫（每7次攻击1个午夜）。
 */
export function computeRinaBangboo(input: RinaBangbooInput): RinaBangbooResult {
  const ex = Math.max(0, Math.floor(input.exSpecialCount || 0))
  const chain = Math.max(0, Math.floor(input.chainCountTotal || 0))
  const ult = Math.max(0, Math.floor(input.ultimateCount || 0))
  const triggers = ex + chain + ult
  const combatTime = Math.max(0, Number(input.combatTime) || 0)
  const buffTime = Math.min(triggers * RINA_SPOTLESS_DURATION, combatTime)
  const attacks = Math.floor(buffTime / RINA_BANGBOO_INTERVAL)
  const midnightCount = Math.floor(attacks / RINA_FRIGHT_CYCLE)
  return {
    triggers,
    buffTime,
    attacks,
    sweepCount: attacks - midnightCount,
    midnightCount,
  }
}

/**
 * 丽娜终结技回能分配：
 * - 三人：下一位30，上一位10
 * - 两人：另一位30
 */
export function assignRinaUltNeighborEnergy(
  slots: number[],
  rinaSlot: number,
): Record<number, number> {
  const out: Record<number, number> = {}
  const others = slots.filter(slot => slot !== rinaSlot)
  if (others.length === 0) return out
  if (others.length === 1) {
    out[others[0]] = 30
    return out
  }
  const ordered = [...slots].sort((a, b) => a - b)
  const index = ordered.indexOf(rinaSlot)
  const next = ordered[(index + 1) % ordered.length]
  const previous = ordered[(index - 1 + ordered.length) % ordered.length]
  out[next] = 30
  out[previous] = 10
  return out
}

export function applyRinaTeamEnergyFlags(characters: CharacterOperationConfig[]): void {
  const rina = characters.find(character => character.agentId === RINA_ID)
  if (!rina) return
  const energy = assignRinaUltNeighborEnergy(characters.map(character => character.slot), rina.slot)
  for (const character of characters) {
    character.rinaEnergyPerRinaUlt = energy[character.slot] ?? 0
  }
}

function pushExec(
  executions: SkillExecution[],
  moveId: string,
  moveName: string,
  count: number,
  dmg: number,
  note: string,
  element: 'physical' | 'electric',
) {
  if (count <= 0 || dmg <= 0) return
  executions.push({
    moveId,
    moveName,
    category: 'basic',
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
    damageMultiplier: dmg,
    damageMultiplierOverride: true,
    element,
    skillTableNote: note,
  } as SkillExecution)
}

function combatTimeOf(state: AgentResourceInput['state']): number {
  return (state.frontlineTime ?? 0) + (state.backstageTime ?? 0)
}

function buildCharConfig({ skills, cinemaLevel, cfg }: AgentCharConfigInput): void {
  const record = cfg as unknown as Record<string, unknown>
  record.rinaCinemaLevel = cinemaLevel ?? 0
  // 晨间清扫：三段倍率之和作为单次发动总倍率
  record.rinaSweepComboDmg =
    rowVal(findMove(skills, MOVE_SWEEP_1), 'damage')
    + rowVal(findMove(skills, MOVE_SWEEP_2), 'damage')
    + rowVal(findMove(skills, MOVE_SWEEP_3), 'damage')
  record.rinaMidnightDmg = rowVal(findMove(skills, MOVE_MIDNIGHT), 'damage')
}

function buildExecutions({ cfg, state, executions }: AgentResourceInput): void {
  const record = cfg as unknown as Record<string, unknown>
  const bangboo = computeRinaBangboo({
    exSpecialCount: state.exSpecialCount ?? 0,
    chainCountTotal: state.chainCountTotal ?? 0,
    ultimateCount: state.ultimateCount ?? 0,
    combatTime: combatTimeOf(state),
  })
  record.rinaBangboo = bangboo

  const sweepDmg = Number(record.rinaSweepComboDmg ?? 0) || 0
  pushExec(
    executions,
    MOVE_SWEEP_1,
    '邦布：晨间清扫',
    bangboo.sweepCount,
    sweepDmg,
    `晨间清扫 ×${bangboo.sweepCount}（一尘不染 ${bangboo.triggers} 次触发·${fmt(bangboo.buffTime)}s，`
      + `每${RINA_BANGBOO_INTERVAL}s 1套，三段合计）`,
    'physical',
  )

  const midnightDmg = Number(record.rinaMidnightDmg ?? 0) || 0
  pushExec(
    executions,
    MOVE_MIDNIGHT,
    '邦布：午夜清扫',
    bangboo.midnightCount,
    midnightDmg,
    `午夜清扫 ×${bangboo.midnightCount}（每 ${RINA_FRIGHT_CYCLE} 次攻击转化 1 次，消耗惊吓 6 层）`,
    'electric',
  )
}

function buildResourceResult({ cfg, state }: AgentResourceResultInput) {
  const record = cfg as unknown as Record<string, unknown>
  const ex = Math.max(0, Math.floor(state.exSpecialCount ?? 0))
  const chain = Math.max(0, Math.floor(state.chainCountTotal ?? 0))
  const ult = Math.max(0, Math.floor(state.ultimateCount ?? 0))
  const bangboo = computeRinaBangboo({
    exSpecialCount: ex,
    chainCountTotal: chain,
    ultimateCount: ult,
    combatTime: combatTimeOf(state),
  })
  record.rinaBangboo = bangboo
  return {
    rinaBangboo: bangboo,
    specResources: {
      rina_spotless: {
        id: 'rina_spotless',
        name: '一尘不染',
        initialValue: 0,
        maxValue: null,
        totalGain: bangboo.triggers,
        gains: { ex, chain, ult },
        bonusCount: 0,
        total: bangboo.triggers,
        remaining: 0,
        spendCounts: { midnight: bangboo.midnightCount },
        spendCosts: {},
      },
    },
  }
}

function resourceSections({ result }: AgentResourceSectionsInput) {
  const bangboo = (result as any)?.rinaBangboo as RinaBangbooResult | undefined
  if (!bangboo || bangboo.triggers <= 0) return []
  return [{
    id: 'rina-bangboo',
    title: '丽娜·邦布攻击',
    summary: `一尘不染 ${bangboo.triggers} · 晨间 ${bangboo.sweepCount} · 午夜 ${bangboo.midnightCount}`,
    rows: [
      { label: '一尘不染触发', value: String(bangboo.triggers), detail: '强特/连携/终结各1次，每次13s' },
      { label: 'buff 时长', value: `${fmt(bangboo.buffTime)}s`, detail: '触发次数×13s，按战斗总时长钳制' },
      { label: '晨间清扫', value: String(bangboo.sweepCount), detail: `每${RINA_BANGBOO_INTERVAL}s 1套，三段合计315.9%（物理）` },
      { label: '午夜清扫', value: String(bangboo.midnightCount), detail: `惊吓满6层后下一次攻击转化（每${RINA_FRIGHT_CYCLE}次1个），420.1%（电）` },
    ],
  }]
}

/**
 * 直伤行元素覆盖（用户口径：晨间算物理，午夜算电）。
 * 晨间清扫 moveId 在倍率表中 damageElement 为电，必须经此钩子改为物理；
 * 午夜清扫倍率表即电，此处显式返回以固定口径。
 */
function resolveExecutionDamage({ exec }: AgentDamageResolutionInput): { element: string; source?: string; note?: string } | null {
  if (exec.moveId === MOVE_SWEEP_1) {
    return { element: 'physical', note: `${exec.skillTableNote ?? ''}；晨间清扫按物理伤害计（用户口径）。` }
  }
  if (exec.moveId === MOVE_MIDNIGHT) {
    return { element: 'electric', note: `${exec.skillTableNote ?? ''}；午夜清扫按电属性伤害计（用户口径）。` }
  }
  return null
}

export const rinaMechanic: AgentMechanicModule = {
  id: 'agent:rina',
  agentIds: [RINA_ID],
  name: '丽娜·邦布支援',
  description: '核心穿透、额外能力、影画增益、终结技邻位回能与[一尘不染]邦布攻击。',
  settings: [{
    id: 'rina.c4DoubleBangbooCoverage',
    label: '影画4·双邦布在外覆盖率',
    description: '两只邦布同时被指派在外的整局时间占比。',
    default: 1,
    min: 0,
    max: 1,
    step: 0.1,
  }],
  applyPanel: ({ cinemaLevel, panel }) => {
    if (cinemaLevel >= 2) {
      panel.dmgBonus = (panel.dmgBonus ?? 0) + 15 * C2_COVERAGE
    }
  },
  buildCharConfig,
  buildExecutions,
  buildResourceResult,
  resolveExecutionDamage,
  resourceSections,
}

export default rinaMechanic
