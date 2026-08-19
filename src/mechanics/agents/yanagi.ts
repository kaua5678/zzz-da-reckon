import type { AgentMechanicModule, AgentPanelInput } from '../types'

/**
 * 月城柳（1221，电·异常，对空洞特别行动部第六课）—— 额外能力异常积蓄（薄模块）。
 * 机制文本来源：nanoka 3.2.3+18244196 zh character/1221.json。
 *
 * 拐力主体在 teammate-buffs.json 1221 组：核心被动[紊乱]伤害倍率+250%
 * （disorderBaseMultiplierBonus，全队受益）、影画4 [识破]穿透率+16%（penRatio）。
 *
 * 本模块只承接一项：
 * - 额外能力·月相：队伍存在其他[异常]或同属性（电）角色时，架势切换后
 *   夜见尊神乐的电属性异常积蓄值+45%。属月城柳自身面板：
 *   panel.electricAnomalyBuildUpEfficiency += 45，按 additionalAbilityActive 门控。
 *   口径：架势切换与8秒窗口按静态面板满覆盖近似。
 *
 * 未建模（spec notes）：核心被动自身电伤+20%、影画1 洞悉/异常精通、影画2/6 突刺机制。
 */

const YANAGI_AGENT_ID = '1221'
const YANAGI_ELECTRIC_BUILDUP_BONUS = 45

function applyYanagiPanel({ panel }: AgentPanelInput): void {
  if ((panel.additionalAbilityActive ?? 0) <= 0) return
  panel.electricAnomalyBuildUpEfficiency = (panel.electricAnomalyBuildUpEfficiency ?? 0)
    + YANAGI_ELECTRIC_BUILDUP_BONUS
}

export const yanagiMechanic: AgentMechanicModule = {
  id: 'agent:tsukishiro_yanagi',
  agentIds: [YANAGI_AGENT_ID],
  name: '月城柳',
  description: '额外能力：电属性异常积蓄值+45%（门控）；紊乱倍率与识破穿透在 teammate-buffs 1221 组。',
  applyPanel: applyYanagiPanel,
}
