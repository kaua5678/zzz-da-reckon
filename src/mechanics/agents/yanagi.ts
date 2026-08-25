import type { AgentMechanicModule, AgentPanelInput } from '../types'

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
 * 未建模（spec notes）：影画2 长按追加突刺耗能与[极性紊乱]倍率机制、影画6 极性紊乱上限4次/耗能减半、
 * [森罗万象]状态逐时序、[洞悉]受击无敌。
 */

const YANAGI_AGENT_ID = '1221'
const YANAGI_ELECTRIC_BUILDUP_BONUS = 45
const YANAGI_CORE_ELECTRIC_DMG = 20
const YANAGI_C1_PROFICIENCY = 80
const YANAGI_C2_BUILDUP_BONUS = 20
const YANAGI_C6_EX_SPECIAL_DMG = 20

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

export const yanagiMechanic: AgentMechanicModule = {
  id: 'agent:tsukishiro_yanagi',
  agentIds: [YANAGI_AGENT_ID],
  name: '月城柳',
  description: '核心被动电伤+20%、额外能力电异常积蓄+45%、影画1异常精通+80、影画2突刺积蓄+20%、影画6强特+20%；紊乱倍率/识破穿透在 teammate-buffs 1221 组。',
  applyPanel: applyYanagiPanel,
}
