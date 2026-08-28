/**
 * 潘引壶（1421）—— 影画2 破劲换能薄模块
 *
 * 主体拐力在 teammate-buffs.json 1421 组（通窍贯穿力转模/额外气绝增伤/影画1/6），
 * 由 spec 1421.json 声明式承载；本模块只承接破劲循环的影画2 回能。
 *
 * - 破劲：强化特殊技·贴山震脉靠 获得 3 点；特殊技·断脉破穴手 每发动一次消耗 1 点（至多 3 连）。
 *   总量口径：破劲消耗 = 3 × 强特次数（默认全部打空）。
 * - 影画2：每消耗 6 点[破劲]回复 4 点能量 → 回能 = 4 × floor(3 × 强特次数 / 6) = 4 × floor(强特次数 / 2)。
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

function buildCharConfig({ cinemaLevel, cfg }: AgentCharConfigInput): void {
  ;(cfg as unknown as Record<string, unknown>).panYinhuCinemaLevel = cinemaLevel ?? 0
}

function buildExecutions({ cfg, state }: AgentResourceInput): void {
  const cinema = Math.max(0, Math.floor(Number((cfg as any).panYinhuCinemaLevel ?? 0)))
  if (cinema < 2) return
  const exCount = Math.max(0, Math.floor(Number(state.exSpecialCount ?? 0)))
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
  name: '潘引壶·破劲换能',
  description: '影画2 每消耗6点破劲回复4点能量（破劲消耗=3×强特）；主体拐力在 teammate-buffs 1421 组。',
  buildCharConfig,
  buildExecutions,
  buildResourceResult,
}

export default panYinhuMechanic
