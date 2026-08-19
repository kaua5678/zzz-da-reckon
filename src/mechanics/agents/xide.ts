import type { AgentCharConfigInput, AgentMechanicModule, AgentPanelInput, AgentResourceInput } from '../types'

/**
 * 「席德」（1461，电·强攻，新艾利都防卫军）—— 正兵拐 + 自身机制模块。
 * 机制文本来源：nanoka 3.2.3+18244196 zh character/1461.json。
 *
 * 正兵拐主体在 teammate-buffs.json 1461 组（明攻攻击/暴伤、围杀增伤、影画2 无视防御，
 * 按 spec.additionalAbility「其他强攻」门控，见 computePanelPhases 过滤链）。
 *
 * 本模块承接席德自身面板部分：
 * - 额外能力·奇兵轰临（additionalAbilityActive 门控）：落华·重戮/落华·崩坠/终结技
 *   伤害+30% → skillDmgBonus__basic + skillDmgBonus__ultimate 定向近似（basic 范围
 *   略宽，含霜蕊轮舞）；无视25%电抗 → 面板级 enemyElectricResReduction（范围略宽）。
 * - 影画4·芳香调（围杀条件门控）：终结技伤害+20%（skillDmgBonus__ultimate）、
 *   喧响值获取效率+10%（decibelGainEfficiency）。
 * - 影画6·有心论：自身暴伤+50%（面板直加）；落华·重戮额外3道165%攻击力激光
 *   （3秒至多1次 → 近似每次重戮触发1次），patchExecutions moveId 限定
 *   flatDamageBonus（奥菲丝先例）。
 *
 * 未建模（spec notes）：钢能资源循环（含影画1）、影画1 崩坠暴伤+30%、
 * 影画2 铁萼雨幕机制、额外能力为正兵回能。
 */

const XIDE_AGENT_ID = '1461'
const XIDE_AA_SKILL_DMG = 30
const XIDE_AA_ELECTRIC_RES_IGNORE = 25
const XIDE_C4_ULTIMATE_DMG = 20
const XIDE_C4_DECIBEL_EFFICIENCY = 10
const XIDE_C6_CRIT_DMG = 50
/** 影画6 激光载体：普通攻击：落华·重戮 */
const XIDE_C6_LASER_MOVE_ID = '1461006'
const XIDE_C6_LASER_RATIO = 3 * 165

function applyXidePanel({ panel, cinemaLevel }: AgentPanelInput): void {
  if ((panel.additionalAbilityActive ?? 0) > 0) {
    panel['skillDmgBonus__basic'] = (panel['skillDmgBonus__basic'] ?? 0) + XIDE_AA_SKILL_DMG
    panel['skillDmgBonus__ultimate'] = (panel['skillDmgBonus__ultimate'] ?? 0) + XIDE_AA_SKILL_DMG
    panel.enemyElectricResReduction = (panel.enemyElectricResReduction ?? 0) + XIDE_AA_ELECTRIC_RES_IGNORE
    if (cinemaLevel >= 4) {
      panel['skillDmgBonus__ultimate'] = (panel['skillDmgBonus__ultimate'] ?? 0) + XIDE_C4_ULTIMATE_DMG
      panel.decibelGainEfficiency = (panel.decibelGainEfficiency ?? 0) + XIDE_C4_DECIBEL_EFFICIENCY
    }
  }
  if (cinemaLevel >= 6) {
    panel.critDmg = (panel.critDmg ?? 0) + XIDE_C6_CRIT_DMG
  }
}

function buildXideCharConfig({ cfg, cinemaLevel, panel }: AgentCharConfigInput): void {
  cfg.xideCinemaLevel = cinemaLevel
  // 影画6 激光附加伤害按「局内最终攻击力 × 百分比」进基础区（flatDamageBonus，奥菲丝先例）
  cfg.xideAtk = Math.max(0, panel?.atk ?? 0)
}

function patchXideExecutions({ cfg, executions }: AgentResourceInput): void {
  const cinema = Math.max(0, Math.floor(Number((cfg as any).xideCinemaLevel ?? 0)))
  const atk = Math.max(0, Number((cfg as any).xideAtk ?? 0))
  if (cinema < 6 || atk <= 0) return
  for (const exec of executions) {
    if (exec.moveId !== XIDE_C6_LASER_MOVE_ID) continue
    // 影画6：落华·重戮额外3道激光 ×165% 攻击力（3秒至多1次，近似每次重戮触发1次）
    exec.flatDamageBonus = (exec.flatDamageBonus ?? 0) + atk * XIDE_C6_LASER_RATIO / 100
    exec.skillTableNote = `${exec.skillTableNote ?? ''}；影画6 附加 3 道激光 +${XIDE_C6_LASER_RATIO}% 攻击力`
  }
}

export const xideMechanic: AgentMechanicModule = {
  id: 'agent:seed',
  agentIds: [XIDE_AGENT_ID],
  name: '「席德」',
  description: '正兵拐在 teammate-buffs（明攻/围杀，按其他强攻门控）；自身额外能力增伤与电抗无视、影画4/6 在 applyPanel，影画6 激光在 patchExecutions。',
  applyPanel: applyXidePanel,
  buildCharConfig: buildXideCharConfig,
  patchExecutions: patchXideExecutions,
}
