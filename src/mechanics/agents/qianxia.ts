import type { AgentCharConfigInput, AgentMechanicModule } from '../types'

/**
 * 千夏（1491，物理·支援，妄想天使）—— 支援拐快录（薄模块）。
 * 机制文本来源：nanoka 3.2.3+18244196 zh character/1491.json。
 *
 * 拐力主体在 teammate-buffs.json 1491 组（核心被动攻击公式/帷幕易伤/影画1/2/4），
 * 帷幕失衡易伤+30%（buff_23620b7000）由 computePanelPhases 按 spec.additionalAbility
 * （队伍存在[强攻]或同阵营角色）门控，见 resourceCalc/helpers.ts。
 *
 * 本模块只承接一项：
 * - 额外能力/影画1 进场回能 15（勘域模式 180s 最多 1 次）→ CD 整局近似
 *   floor(180/180)×15 = 15，并入 cfg.initialEnergyGift；按 panel.additionalAbilityActive 门控。
 *
 * 未建模（spec notes）：猫的凝视触发伤害（属触发代理人）、影画2 磨爪器/触发倍率、影画6 潜心创作。
 */

const QIANXIA_AGENT_ID = '1491'
const QIANXIA_FIELD_ENTRY_ENERGY = 15

function buildQianxiaCharConfig({ cfg, panel }: AgentCharConfigInput): void {
  if ((panel?.additionalAbilityActive ?? 0) > 0) {
    cfg.initialEnergyGift = (cfg.initialEnergyGift ?? 0) + QIANXIA_FIELD_ENTRY_ENERGY
  }
}

export const qianxiaMechanic: AgentMechanicModule = {
  id: 'agent:qianxia',
  agentIds: [QIANXIA_AGENT_ID],
  name: '千夏',
  description: '进场回能15（额外能力门控）；拐力主体在 teammate-buffs 1491 组，帷幕易伤按额外能力门控。',
  buildCharConfig: buildQianxiaCharConfig,
}
