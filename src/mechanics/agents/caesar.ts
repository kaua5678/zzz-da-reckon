/**
 * 凯撒（1071）—— 整局近似口径
 *
 * 拐力（teammate-buffs）
 * - 核心·荣光之盾：持有者攻击 +1000（默认满覆盖；护盾值本身不进伤害）
 * - 额外能力·战意激昂：精准格挡/防御反击/招架支援/此路不通 → 全队伤害 +25%
 *   触发条件：队中有其他可招架支援角色（有队友即近似满足）或同阵营
 * - 影画1：荣光之盾期间附近敌人全抗 -15%
 * - 影画2：核心攻击拐 ×1.5（buffModifiers → 1500）；凯撒自身能量获得效率 +10%
 *
 * 模块
 * - 影画3/5：通用技能等级
 * - 影画4：支援点数 / 20 能替 1 点 — 不建模
 * - 影画6：超强力盾击 + 支援之锋 必定暴击、伤害 +50%；主要目标再 +50% → 单目标默认合计 +100% dmgBonus；
 *   自身暴击率 +30%、暴伤 +60%（15s，整局按满覆盖近似）
 *
 * 未建模：护盾吸收量、格挡架势逐帧、攻防转换冲击力短窗、C4 支援点数。
 */
import type {
  AgentCharConfigInput,
  AgentMechanicModule,
  AgentPanelInput,
  AgentResourceInput,
} from '../types'

export const CAESAR_ID = '1071'

/** 强化特殊技：超强力盾击 */
export const MOVE_SUPER_SHIELD = '1071013'
/** 支援突击：支援之锋 */
export const MOVE_ASSIST_EDGE = '1071024'

export const CAESAR_C6_MOVE_IDS = new Set([MOVE_SUPER_SHIELD, MOVE_ASSIST_EDGE])
export const CAESAR_C6_DMG_BONUS = 100 // 50% + 主目标额外 50%（单目标默认）
export const CAESAR_C6_CRIT_RATE = 100 // 必定暴击
export const CAESAR_C6_SELF_CRIT_RATE = 30
export const CAESAR_C6_SELF_CRIT_DMG = 60
export const CAESAR_C2_ENERGY_EFF = 10

function applyPanel({ cinemaLevel, panel }: AgentPanelInput): void {
  const cinema = cinemaLevel ?? 0
  if (cinema >= 2) {
    panel.energyGainEfficiency = (panel.energyGainEfficiency ?? 0) + CAESAR_C2_ENERGY_EFF
  }
  if (cinema >= 6) {
    panel.critRate = (panel.critRate ?? 0) + CAESAR_C6_SELF_CRIT_RATE
    panel.critDmg = (panel.critDmg ?? 0) + CAESAR_C6_SELF_CRIT_DMG
  }
}

function buildCharConfig({ cinemaLevel, cfg }: AgentCharConfigInput): void {
  ;(cfg as unknown as Record<string, unknown>).caesarCinemaLevel = cinemaLevel ?? 0
}

function patchExecutions({ cfg, executions }: AgentResourceInput): void {
  const cinema = Math.max(0, Math.floor(Number((cfg as any).caesarCinemaLevel ?? 0)))
  if (cinema < 6) return
  for (const exec of executions) {
    if (!exec.moveId || !CAESAR_C6_MOVE_IDS.has(exec.moveId)) continue
    exec.dmgBonus = (exec.dmgBonus ?? 0) + CAESAR_C6_DMG_BONUS
    exec.critRateBonus = (exec.critRateBonus ?? 0) + CAESAR_C6_CRIT_RATE
    exec.skillTableNote =
      `${exec.skillTableNote ?? ''}；影画6 必定暴击、伤害+50%+主目标+50%（单目标按+100%）`
  }
}

export const caesarMechanic: AgentMechanicModule = {
  id: 'agent:caesar',
  agentIds: [CAESAR_ID],
  name: '凯撒·荣光之盾',
  description: '荣光之盾攻击拐、战意增伤、影画1减抗、影画2效率与攻击×1.5、影画6盾击暴击增伤。',
  applyPanel,
  buildCharConfig,
  patchExecutions,
}

export default caesarMechanic
