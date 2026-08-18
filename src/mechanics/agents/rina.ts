/**
 * 丽娜（1211）—— 整局近似口径
 *
 * - 核心被动与影画1由 teammate-buffs 计算：仅队友获得穿透，影画1追加基础值的30%。
 * - 影画2：接战成为当前操作角色后自身伤害+15%，按12s/18s冷却折为2/3覆盖。
 * - 影画4：双邦布均在外时回能+0.5/s，用 rina.c4DoubleBangbooCoverage 调节，默认满覆盖。
 * - 影画6：指定技能命中后全队电伤+15%持续8s，由队友增益覆盖率调节。
 * - 终结技：其他角色+10能量，下一位换入额外+20；三人队按下一位30、上一位10分配。
 *
 * 未建模：邦布逐秒离场状态、感电敌人的逐秒状态；对应效果采用整局覆盖率近似。
 */
import type { AgentMechanicModule } from '../types'
import type { CharacterOperationConfig } from '@/types/resource'

export const RINA_ID = '1211'
const C2_COVERAGE = 12 / 18

/** 满级核心被动穿透增益；影画1在封顶后的结果上提升至130%。 */
export function computeRinaCorePenRatio(sourcePenRatio: number, cinemaLevel = 0): number {
  const base = Math.min(30, Math.max(0, sourcePenRatio) * 0.25 + 12)
  return base * (cinemaLevel >= 1 ? 1.3 : 1)
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

export const rinaMechanic: AgentMechanicModule = {
  id: 'agent:rina',
  agentIds: [RINA_ID],
  name: '丽娜·邦布支援',
  description: '核心穿透、额外能力、影画增益与终结技邻位回能。',
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
}

export default rinaMechanic
