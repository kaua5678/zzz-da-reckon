/**
 * 妮可（1031）—— 整局近似口径
 *
 * 拐力（teammate-buffs）
 * - 核心：强化子弹/能量场命中 → 目标防御 -40%（默认满覆盖）
 * - 额外能力（同属性或同阵营）：核心减益期间全队以太伤 +25%
 * - 影画6：能量场叠暴击 +1.5%×10 层（默认满层 15%）
 *
 * 模块
 * - 影画1：强特伤害与异常积蓄 +16%（执行级，EX 段）；每多蓄力 0.1s → 能量场持续 +0.15s
 *   （等比延长能量场 1031106 的倍率行：scale = 1 + 1.5×蓄力秒 / 能量场基准秒）
 * - 影画2：触发核心减益回 5 能量，15s CD → floor(战斗时长/15)×5 并入开局能量赠送（整局总量）
 * - 影画3/5：通用技能等级
 * - 影画4 范围扩大：不建模（无数值乘区）
 *
 * 未建模：能量场 3.5s 逐秒覆盖、子弹强化普攻循环细节。
 */
import type {
  AgentCharConfigInput,
  AgentMechanicModule,
  AgentResourceInput,
} from '../types'
import type { AgentSkills, SkillMove } from '@/types/catalog'

export const NICOLE_ID = '1031'

/** 强化特殊技：夹心糖衣炮弹 四段 */
export const NICOLE_EX_MOVE_IDS = new Set([
  '1031103', '1031104', '1031105', '1031106',
])

export const NICOLE_C1_EX_BONUS = 16
export const NICOLE_C2_ENERGY = 5
export const NICOLE_C2_CD = 15
/** 蓄力（持续段）moveId */
export const NICOLE_CHARGE_MOVE = '1031103'
/** 能量场（必放）moveId */
export const NICOLE_ENERGY_FIELD_MOVE = '1031106'
/** 影画1：每蓄力 1 秒 → 能量场持续时间 +1.5 秒（0.1s→0.15s） */
export const NICOLE_C1_FIELD_SECONDS_PER_CHARGE_SECOND = 1.5

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

// @fact agent:1031/影画1能量场 口径: 影画1「每多蓄力0.1秒→能量场持续+0.15秒」=能量场(1031106)倍率行等比延长，scale=1+1.5×蓄力秒/能量场基准秒(actionTime) | 据 nanoka full/1031.json + 用户@2026-09 | 验 src/mechanics/__tests__/nicole.test.ts | 锚 src/mechanics/agents/nicole.ts#NICOLE_C1_FIELD_SECONDS_PER_CHARGE_SECOND | 信 确认

function buildCharConfig({ cinemaLevel, cfg, skills }: AgentCharConfigInput): void {
  const cinema = cinemaLevel ?? 0
  const record = cfg as unknown as Record<string, unknown>
  record.nicoleCinemaLevel = cinema

  // 影画1：能量场倍率行等比延长（蓄力秒/能量场基准秒）。蓄力秒取持续段 1 段 = 1031103.actionTime。
  const chargeMove = findMove(skills, NICOLE_CHARGE_MOVE)
  const fieldMove = findMove(skills, NICOLE_ENERGY_FIELD_MOVE)
  const chargeSeconds = chargeMove?.actionTime ?? 0
  const fieldBaseSeconds = fieldMove?.actionTime ?? 0
  const scale = cinema >= 1 && chargeSeconds > 0 && fieldBaseSeconds > 0
    ? 1 + NICOLE_C1_FIELD_SECONDS_PER_CHARGE_SECOND * chargeSeconds / fieldBaseSeconds
    : 1
  record.nicoleC1EnergyFieldScale = scale
  record.nicoleC1EnergyFieldDamage = rowValue(fieldMove, 'damage') * scale
  record.nicoleC1EnergyFieldDaze = rowValue(fieldMove, 'daze') * scale
  record.nicoleC1EnergyFieldAnomaly = rowValue(fieldMove, 'anomaly_buildup') * scale

  // 影画2：核心减益触发回 5 能量 / 15s → 整局 floor(t/15)×5
  if (cinema >= 2) {
    const battleTime = cfg.battleTime ?? 180
    const triggers = Math.max(0, Math.floor(battleTime / NICOLE_C2_CD))
    cfg.initialEnergyGift = (cfg.initialEnergyGift ?? 0) + triggers * NICOLE_C2_ENERGY
    record.nicoleC2EnergyTotal = triggers * NICOLE_C2_ENERGY
  }
}

function patchExecutions({ cfg, executions }: AgentResourceInput): void {
  const cinema = Math.max(0, Math.floor(Number((cfg as any).nicoleCinemaLevel ?? 0)))
  const record = cfg as unknown as Record<string, unknown>
  const fieldScale = Number(record.nicoleC1EnergyFieldScale ?? 1)
  if (cinema < 1) return
  for (const exec of executions) {
    if (!exec.moveId || !NICOLE_EX_MOVE_IDS.has(exec.moveId)) continue
    exec.dmgBonus = (exec.dmgBonus ?? 0) + NICOLE_C1_EX_BONUS
    if (exec.moveId === NICOLE_ENERGY_FIELD_MOVE && fieldScale > 1) {
      // 影画1：能量场持续时间等比延长 → 倍率行等比放大（增伤区 +16% 另计）
      exec.damageMultiplier = Number(record.nicoleC1EnergyFieldDamage ?? 0)
      exec.damageMultiplierOverride = true
      exec.dazeMultiplier = Number(record.nicoleC1EnergyFieldDaze ?? 0)
      exec.dazeMultiplierOverride = true
      exec.anomalyBuildUp = Number(record.nicoleC1EnergyFieldAnomaly ?? 0)
      exec.anomalyBuildUpOverride = true
      exec.totalAnomalyBuildUp = Number(record.nicoleC1EnergyFieldAnomaly ?? 0) * (exec.count ?? 0)
    }
    if ((exec.anomalyBuildUp ?? 0) > 0) {
      exec.anomalyBuildUp = (exec.anomalyBuildUp ?? 0) * (1 + NICOLE_C1_EX_BONUS / 100)
      if (exec.totalAnomalyBuildUp != null) {
        exec.totalAnomalyBuildUp = exec.anomalyBuildUp * (exec.count ?? 0)
      }
    }
    exec.skillTableNote =
      `${exec.skillTableNote ?? ''}；影画1 强特伤害/积蓄 +${NICOLE_C1_EX_BONUS}%${exec.moveId === NICOLE_ENERGY_FIELD_MOVE && fieldScale > 1 ? `，能量场持续×${fieldScale.toFixed(2)}` : ''}`
  }
}

export const nicoleMechanic: AgentMechanicModule = {
  id: 'agent:nicole',
  agentIds: [NICOLE_ID],
  name: '妮可·机关箱',
  description: '核心减防、额外以太伤、影画1强特增伤积蓄、影画2回能、影画6暴击。',
  buildCharConfig,
  patchExecutions,
}

export default nicoleMechanic
