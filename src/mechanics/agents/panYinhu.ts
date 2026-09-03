/**
 * 潘引壶（1421）—— 破劲连段 + 影画2 破劲换能薄模块
 *
 * 主体拐力在 teammate-buffs.json 1421 组（通窍贯穿力转模/额外气绝增伤/影画1/6），
 * 由 spec 1421.json 声明式承载；本模块承接破劲循环的两件事：
 *
 * 1. EX 自动连段（2026-09-03 补接，原文「贴山震脉靠」desc）：
 *    贴山震脉靠（1421006）发动时获得 3 点[破劲] → 命中触发[快速支援]后潘引壶留在场上
 *    自动释放[特殊技：断脉破穴手]（1421007/8/9）直至[破劲]耗尽后下场 —— 每发 EX 稳定 3 段，
 *    各 195.2% 物理伤害 / 62.6 失衡 / 48.61 积蓄。后台追攻行（奥菲丝燥焰迸射、薇薇安悬落同款
 *    口径）：actionTime=0、timeBucket=backstage 不占前台不计数，倍率/失衡/积蓄/喧响由
 *    enrichExecutionPlan 从倍率表按 moveId 回填（此前该连段完全不在执行计划内）。
 * 2. 影画2·云岿点穴手：每消耗 6 点[破劲]回复 4 点能量
 *    → 回能 = 4 × floor(3 × 强特次数 / 6) = 4 × floor(强特次数 / 2)。
 */
import type {
  AgentCharConfigInput,
  AgentMechanicModule,
  AgentResourceInput,
  AgentResourceResultInput,
} from '../types'

export const PAN_YINHU_ID = '1421'
export const PAN_YINHU_C2_ENERGY_PER_6_POJIN = 4
export const PAN_YINHU_POJIN_PER_EX = 3
/** 断脉破穴手三段（EX 后自动释放，每发 EX 各 1 次） */
export const PAN_YINHU_TOUCH_OF_DEATH_MOVE_IDS = ['1421007', '1421008', '1421009'] as const

function buildCharConfig({ cinemaLevel, cfg }: AgentCharConfigInput): void {
  ;(cfg as unknown as Record<string, unknown>).panYinhuCinemaLevel = cinemaLevel ?? 0
}

function buildExecutions({ cfg, state, executions }: AgentResourceInput): void {
  // 1) EX 自动连段：贴山震脉靠 → 3 点破劲 → 断脉破穴手 ×3（后台追攻行，不占前台）
  const exCount = Math.max(0, Math.floor(Number(state.exSpecialCount ?? 0)))
  if (exCount > 0) {
    PAN_YINHU_TOUCH_OF_DEATH_MOVE_IDS.forEach((moveId, i) => {
      executions.push({
        moveId,
        moveName: `特殊技：断脉破穴手 #${i + 1}（贴山震脉靠后自动释放）`,
        category: 'special',
        count: exCount,
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
        timeBucket: 'backstage',
      })
    })
  }

  // 2) 影画2 破劲换能（仅 C2+；幂等：先扣上一轮本模块写入量再写新值）
  const cinema = Math.max(0, Math.floor(Number((cfg as any).panYinhuCinemaLevel ?? 0)))
  if (cinema < 2) return
  const groups = Math.floor(PAN_YINHU_POJIN_PER_EX * exCount / 6)
  const gift = PAN_YINHU_C2_ENERGY_PER_6_POJIN * groups
  const record = cfg as unknown as Record<string, unknown>
  const prev = Math.max(0, Number(record.panYinhuC2EnergyTotal ?? 0))
  // 幂等（同可琳 C4 口径）：先扣上一轮本模块写入量再写新值，内层迭代收敛后不叠加。
  cfg.initialEnergyGift = Math.max(0, Number(cfg.initialEnergyGift ?? 0) - prev) + gift
  record.panYinhuC2EnergyTotal = gift
}

function buildResourceResult({ state }: AgentResourceResultInput) {
  const exCount = Math.max(0, Math.floor(Number(state.exSpecialCount ?? 0)))
  const groups = Math.floor(PAN_YINHU_POJIN_PER_EX * exCount / 6)
  return { specResources: { pan_yinhu_c2: { energy: PAN_YINHU_C2_ENERGY_PER_6_POJIN * groups } } }
}

export const panYinhuMechanic: AgentMechanicModule = {
  id: 'agent:pan_yinhu',
  agentIds: [PAN_YINHU_ID],
  name: '潘引壶·破劲连段',
  description: 'EX 后自动释放断脉破穴手×3（后台追攻行）+ 影画2 每消耗6点破劲回4能量；主体拐力在 teammate-buffs 1421 组。',
  buildCharConfig,
  buildExecutions,
  buildResourceResult,
}

export default panYinhuMechanic
