/**
 * 本（1121）—— 整局近似口径
 *
 * 核心·守卫（满级）
 * - 初始攻击随初始防御提升：防御×80% 转入攻击（局外 def → 局内 atkFlat）
 * - 强特追加强力打击 → 全队护盾（30%防+550，30s）—— 吸收量不进伤害
 *
 * 额外能力·协议合同（同属性或同阵营）
 * - 持有守卫护盾时全队暴击 +16%（默认满覆盖；teammate-buffs + helpers 门控）
 *
 * 影画
 * - C1：格挡成功敌人伤害-30% —— 仅作生存说明展示，不计入伤害
 * - C2：格挡反击额外 300% 防御力伤害 → 仅按成功招架的强特连招次数触发
 * - C3/C5：通用技能等级
 * - C4：无敌格挡后反击伤害 +30% → 反击类 moveId dmgBonus+30%（与 C2 同行可叠加）
 * - C6：强特后普攻/冲刺/闪反失衡 +20% → stunBuildUpBonus__basic/dashAttack/dodgeCounter
 *
 * 强特口径
 * - 总连招次数 = floor(可用总能量 / 60)，每组两段各耗 30
 * - 未招架：1121008 + 1121009；招架成功：1121010 + 1121011
 * - 招架成功率由 `ben.exParrySuccessRate` 调节，默认 100%；C2 只跟随成功组次数
 *
 * 旧 benGuardShieldMechanic（仅自身暴击）由本模块 + teammate-buffs 全队暴击替代。
 *
 * @author kaua5678
 */
import type {
  AgentCharConfigInput,
  AgentMechanicModule,
  AgentPanelInput,
  AgentResourceInput,
} from '../types'

export const BEN_ID = '1121'

/** 满级：初始防 → 攻击 80% */
export const BEN_DEF_TO_ATK = 0.8
/** 满级护盾：30% 防 + 550（仅记录，不进伤害） */
export const BEN_SHIELD_DEF_PCT = 30
export const BEN_SHIELD_FLAT = 550
export const BEN_SHIELD_CRIT = 16

export const BEN_C2_DEF_MULT = 300
export const BEN_C4_COUNTER_DMG = 30
export const BEN_C6_STUN_BONUS = 20
export const BEN_EX_COMBO_ENERGY = 60
export const BEN_EX_PART_ENERGY = 30
export const BEN_EX_PARRY_RATE_SETTING = 'ben.exParrySuccessRate'

export const BEN_EX_NORMAL_MOVE_IDS = ['1121008', '1121009'] as const
export const BEN_EX_PARRY_MOVE_IDS = ['1121010', '1121011'] as const

/** 假 id：C2 格挡反击附加（防御力基底） */
export const MOVE_C2_COUNTER = '1121c2_guard_counter'

/** 特殊/成功格挡反击相关段（到期还拳等） */
export const BEN_COUNTER_MOVE_IDS = new Set([
  '1121005', '1121006', // 特殊技
  ...BEN_EX_PARRY_MOVE_IDS, // 强特成功招架
  '1121020', // 支援突击
])

function clamp01(value: unknown, fallback = 1): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : fallback
}

function findMoveActionTime(
  skills: AgentCharConfigInput['skills'],
  moveId: string,
): number {
  for (const category of skills.categories ?? []) {
    const move = category.moves?.find(item => item.id === moveId)
    if (move) return Math.max(0, move.actionTime ?? 0)
  }
  return 0
}

function applyPanel({ cinemaLevel, panel }: AgentPanelInput): void {
  // 初始防转攻：用当前面板 def（局内已含装备）近似「初始防御」；与满级 80% 一致
  const def = Math.max(0, panel.def ?? 0)
  const bonus = def * BEN_DEF_TO_ATK
  if (bonus > 0) panel.atk = (panel.atk ?? 0) + bonus
  ;(panel as any).benDefToAtk = bonus

  const cinema = cinemaLevel ?? 0
  if (cinema >= 6) {
    panel.stunBuildUpBonus__basic = (panel.stunBuildUpBonus__basic ?? 0) + BEN_C6_STUN_BONUS
    panel.stunBuildUpBonus__dashAttack = (panel.stunBuildUpBonus__dashAttack ?? 0) + BEN_C6_STUN_BONUS
    panel.stunBuildUpBonus__dodgeCounter = (panel.stunBuildUpBonus__dodgeCounter ?? 0) + BEN_C6_STUN_BONUS
  }
}

function buildCharConfig({ cinemaLevel, cfg, panel, skills }: AgentCharConfigInput): void {
  const record = cfg as unknown as Record<string, unknown>
  record.benCinemaLevel = cinemaLevel ?? 0
  record.benDef = panel.def ?? 0
  record.benAtkFromDef = (panel as any).benDefToAtk ?? (panel.def ?? 0) * BEN_DEF_TO_ATK
  record.benExParrySuccessRate = clamp01(record[`setting:${BEN_EX_PARRY_RATE_SETTING}`], 1)
  record.benExActionTimes = Object.fromEntries(
    [...BEN_EX_NORMAL_MOVE_IDS, ...BEN_EX_PARRY_MOVE_IDS]
      .map(moveId => [moveId, findMoveActionTime(skills, moveId)]),
  )

  // 一组强特固定消耗 30+30；让资源池用可用总能量 / 60 推导总组数，模块接管真实两段执行。
  cfg.exSpecialEnergyConsume = BEN_EX_COMBO_ENERGY
  cfg.exSpecialCountFloor = true
  cfg.skipGenericExSpecial = true
}

function pushExPart(
  executions: AgentResourceInput['executions'],
  moveId: string,
  count: number,
  actionTime: number,
  label: string,
): void {
  if (count <= 0) return
  executions.push({
    moveId,
    moveName: label,
    category: 'special',
    count,
    actionTime,
    comboAlignRatio: 0,
    totalTime: count * actionTime,
    totalComboAlignTime: 0,
    energyConsume: BEN_EX_PART_ENERGY,
    totalEnergyConsume: count * BEN_EX_PART_ENERGY,
    decibelRecovery: 0,
    totalDecibelRecovery: 0,
    energyRecovery: 0,
    totalEnergyRecovery: 0,
    skillTableNote: `${label} ×${count}；每段耗能 ${BEN_EX_PART_ENERGY}`,
  })
}

function buildExecutions({ cfg, state, executions }: AgentResourceInput): void {
  const cinema = Math.max(0, Math.floor(Number((cfg as any).benCinemaLevel ?? 0)))
  const comboCount = Math.max(0, Math.floor(state.exSpecialCount ?? 0))
  if (comboCount <= 0) return

  const successRate = clamp01((cfg as any).benExParrySuccessRate, 1)
  const successCount = comboCount * successRate
  const normalCount = comboCount - successCount
  const actionTimes = ((cfg as any).benExActionTimes ?? {}) as Record<string, number>

  for (const moveId of BEN_EX_NORMAL_MOVE_IDS) {
    pushExPart(executions, moveId, normalCount, actionTimes[moveId] ?? 0, '强化特殊技·未招架')
  }
  for (const moveId of BEN_EX_PARRY_MOVE_IDS) {
    pushExPart(executions, moveId, successCount, actionTimes[moveId] ?? 0, '强化特殊技·招架成功')
  }

  // C2 只由成功触发格挡反击的强特组触发；成功率允许期望值小数。
  if (cinema < 2 || successCount <= 0) return
  const def = Math.max(0, Number((cfg as any).benDef ?? 0))
  executions.push({
    moveId: MOVE_C2_COUNTER,
    moveName: '影画2·格挡反击附加',
    category: 'special',
    count: successCount,
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
    damageMultiplier: BEN_C2_DEF_MULT,
    damageMultiplierOverride: true,
    basisValueOverride: def,
    basisLabelOverride: '本的防御力',
    element: 'fire',
    skillTableNote: `C2 格挡反击附加 ×${successCount}（仅成功招架；300% 防御力）`,
    ...(cinema >= 4 ? { dmgBonus: BEN_C4_COUNTER_DMG } : {}),
  } as any)
}

function patchExecutions({ cfg, executions }: AgentResourceInput): void {
  const cinema = Math.max(0, Math.floor(Number((cfg as any).benCinemaLevel ?? 0)))
  if (cinema < 4) return
  for (const exec of executions) {
    if (!exec.moveId || !BEN_COUNTER_MOVE_IDS.has(exec.moveId)) continue
    // C2 假行已在 build 加过；真实反击段再 +30%
    if (exec.moveId === MOVE_C2_COUNTER) continue
    exec.dmgBonus = (exec.dmgBonus ?? 0) + BEN_C4_COUNTER_DMG
    exec.skillTableNote = `${exec.skillTableNote ?? ''}；影画4 反击伤害 +${BEN_C4_COUNTER_DMG}%`
  }
}

export const benMechanic: AgentMechanicModule = {
  id: 'agent:ben',
  agentIds: [BEN_ID],
  name: '本·守卫',
  description: '防转攻、护盾暴击（全队）、强特招架分流与影画2/4/6。',
  settings: [{
    id: BEN_EX_PARRY_RATE_SETTING,
    label: '强特招架成功率',
    description: '强化特殊技连招中成功招架的比例；决定招式分支与影画2反击次数。',
    default: 1,
    min: 0,
    max: 1,
    step: 0.1,
  }],
  applyPanel,
  buildCharConfig,
  buildExecutions,
  patchExecutions,
}

export default benMechanic
