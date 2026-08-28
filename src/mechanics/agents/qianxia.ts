import type { AgentCharConfigInput, AgentMechanicModule, AgentPanelInput } from '../types'

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
/** 影画6 潜心创作：必定暴击 + 暴伤 = min(105, 初始攻击 × 0.03%) */
export const QIANXIA_C6_CRIT_RATE = 100
export const QIANXIA_C6_CRIT_DMG_CAP = 105

function buildQianxiaCharConfig({ cfg, panel }: AgentCharConfigInput): void {
  if ((panel?.additionalAbilityActive ?? 0) > 0) {
    cfg.initialEnergyGift = (cfg.initialEnergyGift ?? 0) + QIANXIA_FIELD_ENTRY_ENERGY
  }
}

function applyQianxiaPanel({ cinemaLevel, panel, settings }: AgentPanelInput): void {
  if ((cinemaLevel ?? 0) < 6) return
  // 潜心创作（8s，强特后）按整局覆盖率近似；必定暴击 + 攻击×0.03% 暴伤（封顶105）。
  const coverage = Math.max(0, Math.min(1, Number(settings['qianxia.c6FocusCoverage'] ?? 1)))
  const atk = Number(panel.atk ?? 0)
  panel.critRate = (panel.critRate ?? 0) + QIANXIA_C6_CRIT_RATE * coverage
  panel.critDmg = (panel.critDmg ?? 0) + Math.min(QIANXIA_C6_CRIT_DMG_CAP, atk * 0.03) * coverage
}

export const qianxiaMechanic: AgentMechanicModule = {
  id: 'agent:qianxia',
  agentIds: [QIANXIA_AGENT_ID],
  name: '千夏',
  description: '进场回能15（额外能力门控）；影画6 潜心创作自身必暴/暴伤；拐力主体在 teammate-buffs 1491 组，帷幕易伤按额外能力门控。',
  settings: [
    {
      id: 'qianxia.c6FocusCoverage',
      label: '影画6潜心创作覆盖率',
      description: '强特后[潜心创作中！]8秒状态的整局覆盖率（自身必暴 + 攻击×0.03%暴伤封顶105）',
      default: 1,
      min: 0,
      max: 1,
      step: 0.05,
      suffix: '%',
    },
  ],
  applyPanel: applyQianxiaPanel,
  buildCharConfig: buildQianxiaCharConfig,
}
