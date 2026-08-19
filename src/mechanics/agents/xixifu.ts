import type { AgentMechanicModule, AgentPanelInput } from '../types'

/**
 * 希希芙（1521，电·强攻，新艾利都治安局）—— 额外能力自身暴伤（薄模块）。
 * 机制文本来源：nanoka 3.2.3+18244196 zh character/1521.json。
 *
 * 拐力主体在 teammate-buffs.json 1521 组：核心被动电系无视防御公式
 * （enemyElectricDefReduction，按初始回能）、额外能力全队暴伤+40%（门控）、
 * 影画1 电抗无视5% + 核心公式×1.4。
 *
 * 本模块只承接一项：
 * - 额外能力·毒素发酵原文「自身额外提升10%」：队友吃 buff 的 40%，希希芙自己
 *   额外 +10%（合计50%）。按 panel.additionalAbilityActive 门控。
 *
 * 未建模（spec notes）：[毒素]资源与[蚀骨]伤害行、影画1/2/4/6 的自身伤害与资源部分。
 */

const XIXIFU_AGENT_ID = '1521'
const XIXIFU_SELF_CRIT_DMG = 10

function applyXixifuPanel({ panel }: AgentPanelInput): void {
  if ((panel.additionalAbilityActive ?? 0) <= 0) return
  panel.critDmg = (panel.critDmg ?? 0) + XIXIFU_SELF_CRIT_DMG
}

export const xixifuMechanic: AgentMechanicModule = {
  id: 'agent:xixifu',
  agentIds: [XIXIFU_AGENT_ID],
  name: '希希芙',
  description: '额外能力自身暴伤+10%（门控）；全队暴伤40%与电系无视防御在 teammate-buffs 1521 组。',
  applyPanel: applyXixifuPanel,
}
