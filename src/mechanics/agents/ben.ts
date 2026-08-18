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
 * - C1：格挡成功敌人伤害-30% —— 生存向，不建模
 * - C2：格挡反击额外 300% 防御力伤害 → 执行行（按 block/parry 交互次数近似）
 * - C3/C5：通用技能等级
 * - C4：无敌格挡后反击伤害 +30% → 反击类 moveId dmgBonus+30%（与 C2 同行可叠加）
 * - C6：强特后普攻/冲刺/闪反失衡 +20% → stunBuildUpBonus__basic/dashAttack/dodgeCounter
 *
 * 旧 benGuardShieldMechanic（仅自身暴击）由本模块 + teammate-buffs 全队暴击替代。
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

/** 假 id：C2 格挡反击附加（防御力基底） */
export const MOVE_C2_COUNTER = '1121c2_guard_counter'

/** 特殊/强特反击相关段（到期还拳等） */
export const BEN_COUNTER_MOVE_IDS = new Set([
  '1121005', '1121006', // 特殊技
  '1121008', '1121009', '1121010', '1121011', // 强特
  '1121020', // 支援突击
])

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

function buildCharConfig({ cinemaLevel, cfg, panel }: AgentCharConfigInput): void {
  const record = cfg as unknown as Record<string, unknown>
  record.benCinemaLevel = cinemaLevel ?? 0
  record.benDef = panel.def ?? 0
  record.benAtkFromDef = (panel as any).benDefToAtk ?? (panel.def ?? 0) * BEN_DEF_TO_ATK
}

function buildExecutions({ cfg, state, executions }: AgentResourceInput): void {
  const cinema = Math.max(0, Math.floor(Number((cfg as any).benCinemaLevel ?? 0)))
  if (cinema < 2) return
  // 格挡反击次数 ≈ 招架 + 强特（用户可调交互；缺省用 parry + ex）
  const parry = Math.max(0, Math.floor(cfg.parryCount ?? 0))
  const ex = Math.max(0, Math.floor(state.exSpecialCount ?? 0))
  const count = Math.max(parry, ex) // 至少每次强特可打一次反击窗口
  if (count <= 0) return
  const def = Math.max(0, Number((cfg as any).benDef ?? 0))
  executions.push({
    moveId: MOVE_C2_COUNTER,
    moveName: '影画2·格挡反击附加',
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
    damageMultiplier: BEN_C2_DEF_MULT,
    damageMultiplierOverride: true,
    basisValueOverride: def,
    basisLabelOverride: '本的防御力',
    element: 'fire',
    skillTableNote: `C2 格挡反击附加 ×${count}（300% 防御力）`,
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
  description: '防转攻、护盾暴击（全队）、影画2/4/6。',
  applyPanel,
  buildCharConfig,
  buildExecutions,
  patchExecutions,
}

export default benMechanic
