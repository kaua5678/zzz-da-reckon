import type { AgentMechanicModule, AgentPanelInput } from '../types'

/**
 * 「扳机」（1361，电·击破，新艾利都防卫军）—— 额外能力失衡值拐（薄模块）。
 * 机制文本来源：nanoka 3.2.3+18244196 zh character/1361.json。
 *
 * 拐力主体在 teammate-buffs.json 1361 组：核心被动失衡易伤+35%、影画1 额外+20%
 * （均 stunDmgMultiplierBonusAlways，原文「目标未失衡时亦可生效」走 Always 通道）、
 * 影画2 猎眸4层全队暴伤+6%/层。
 *
 * 本模块只承接一项：
 * - 额外能力·灵目银灯：队伍存在[强攻]或同属性（电）角色时，暴击率高于40%的部分
 *   每1%使追加攻击失衡值+1.5%，上限75%。公式 min(75, max(0, (critRate-40)×1.5))
 *   施加到 panel.stunBuildUpBonus；按 panel.additionalAbilityActive 门控。
 *   口径：critRate 取叠加 buff 后的面板值；原文限定「追加攻击」按面板级近似
 *   （扳机失衡贡献集中于追加攻击）。
 *
 * 未建模（spec notes）：影画1 冷却/绝意资源、影画4 断离（触发者为其他角色）、
 * 影画6 破甲凶弹伤害行。
 */

const TRIGGER_AGENT_ID = '1361'
const TRIGGER_CRIT_THRESHOLD = 40
const TRIGGER_STUN_BUILD_PER_CRIT = 1.5
const TRIGGER_STUN_BUILD_CAP = 75

function applyTriggerPanel({ panel }: AgentPanelInput): void {
  if ((panel.additionalAbilityActive ?? 0) <= 0) return
  const overCrit = (panel.critRate ?? 0) - TRIGGER_CRIT_THRESHOLD
  if (overCrit <= 0) return
  panel.stunBuildUpBonus = (panel.stunBuildUpBonus ?? 0)
    + Math.min(TRIGGER_STUN_BUILD_CAP, overCrit * TRIGGER_STUN_BUILD_PER_CRIT)
}

export const triggerMechanic: AgentMechanicModule = {
  id: 'agent:trigger',
  agentIds: [TRIGGER_AGENT_ID],
  name: '「扳机」',
  description: '额外能力：暴击率超40%部分转追加攻击失衡值提升（门控）；失衡易伤拐在 teammate-buffs 1361 组。',
  applyPanel: applyTriggerPanel,
}
