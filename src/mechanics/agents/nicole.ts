/**
 * 妮可（1031）—— 整局近似口径
 *
 * 拐力（teammate-buffs）
 * - 核心：强化子弹/能量场命中 → 目标防御 -40%（默认满覆盖）
 * - 额外能力（同属性或同阵营）：核心减益期间全队以太伤 +25%
 * - 影画6：能量场叠暴击 +1.5%×10 层（默认满层 15%）
 *
 * 模块
 * - 影画1：强特伤害与异常积蓄 +16%（执行级，EX 段）
 * - 影画2：触发核心减益回 5 能量，15s CD → floor(战斗时长/15)×5 并入开局能量赠送（整局总量）
 * - 影画3/5：通用技能等级
 * - 影画4 范围扩大：不建模（无数值乘区）
 *
 * 未建模：能量场 3.5s 逐秒覆盖、蓄力延长能量场、子弹强化普攻循环细节。
 */
import type {
  AgentCharConfigInput,
  AgentMechanicModule,
  AgentResourceInput,
} from '../types'

export const NICOLE_ID = '1031'

/** 强化特殊技：夹心糖衣炮弹 四段 */
export const NICOLE_EX_MOVE_IDS = new Set([
  '1031103', '1031104', '1031105', '1031106',
])

export const NICOLE_C1_EX_BONUS = 16
export const NICOLE_C2_ENERGY = 5
export const NICOLE_C2_CD = 15

function buildCharConfig({ cinemaLevel, cfg }: AgentCharConfigInput): void {
  const cinema = cinemaLevel ?? 0
  const record = cfg as unknown as Record<string, unknown>
  record.nicoleCinemaLevel = cinema

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
  if (cinema < 1) return
  for (const exec of executions) {
    if (!exec.moveId || !NICOLE_EX_MOVE_IDS.has(exec.moveId)) continue
    exec.dmgBonus = (exec.dmgBonus ?? 0) + NICOLE_C1_EX_BONUS
    if ((exec.anomalyBuildUp ?? 0) > 0) {
      exec.anomalyBuildUp = (exec.anomalyBuildUp ?? 0) * (1 + NICOLE_C1_EX_BONUS / 100)
      if (exec.totalAnomalyBuildUp != null) {
        exec.totalAnomalyBuildUp = exec.anomalyBuildUp * (exec.count ?? 0)
      }
    }
    exec.skillTableNote =
      `${exec.skillTableNote ?? ''}；影画1 强特伤害/积蓄 +${NICOLE_C1_EX_BONUS}%`
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
