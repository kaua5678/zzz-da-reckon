import type { AgentMechanicModule, AgentPanelInput } from '../types'

/**
 * 奥菲丝&「鬼火」（1301，火·强攻，新艾利都防卫军）—— 自身机制补录模块。
 * 机制文本来源：nanoka 3.2.3+18244196 zh character/1301.json。
 *
 * 拐力主体在 teammate-buffs.json 1301 组（准星聚焦攻击公式/额外能力减防/影画1增伤）。
 *
 * 本模块承接奥菲丝自身面板部分：
 * - 核心被动·衔风驭火（Lv.12）：自身暴击率+25%；[追加攻击]伤害+85%。
 *   口径 [已确认]：追加攻击增伤是「增伤区」（skillDmgBonus），不是独立乘区；
 *   只作用于带 additionalAttack tag 的招式（inferSkillDamageTarget 按 skillTags 判定）。
 *   tag 范围（原文列举，用户确认高压火枪全6段）：高压火枪#1~#6、小心脚下、灼红旋涡、
 *   蓄热充能、燥焰迸射、枪管过热、与火共舞#1/#2（catalog agentSkills skillTags 打标）。
 * - 影画1：自身招式（蚀光一闪/灼红旋涡/蓄热充能/燥焰迸射）无视15%火属性伤害抗性：
 *   引擎无 moveId 级抗性通道，按面板级 enemyFireResReduction+15 近似
 *   （作用范围略宽于原文4招）。
 * - 影画2：终结技后自身攻击+20%（45秒）→ 按满覆盖近似，panel.atk ×= 1.2
 *   （velina 先例：applyPanel 阶段对面板攻击乘百分比）。
 * - 影画4：终结技伤害+40%（skillDmgBonus__ultimate）；蓄热充能+40% 无 moveId 级
 *   增伤通道，未建模（spec pending）。
 * - 影画6：激光追加250%攻击力火伤（0.5秒至多1次），触发频率静态不可算，未建模。
 */

const ORPHIE_AGENT_ID = '1301'
const ORPHIE_CORE_CRIT_RATE = 25
const ORPHIE_CORE_ADDITIONAL_ATTACK_DMG = 85
const ORPHIE_C1_FIRE_RES_IGNORE = 15
const ORPHIE_C2_ATK_PCT = 20
const ORPHIE_C4_ULTIMATE_DMG = 40

function applyOrphiePanel({ panel, cinemaLevel }: AgentPanelInput): void {
  panel.critRate = (panel.critRate ?? 0) + ORPHIE_CORE_CRIT_RATE
  panel['skillDmgBonus__additionalAttack'] = (panel['skillDmgBonus__additionalAttack'] ?? 0)
    + ORPHIE_CORE_ADDITIONAL_ATTACK_DMG
  if (cinemaLevel >= 1) {
    panel.enemyFireResReduction = (panel.enemyFireResReduction ?? 0) + ORPHIE_C1_FIRE_RES_IGNORE
  }
  if (cinemaLevel >= 2) {
    panel.atk = Math.round((panel.atk ?? 0) * (1 + ORPHIE_C2_ATK_PCT / 100))
  }
  if (cinemaLevel >= 4) {
    panel['skillDmgBonus__ultimate'] = (panel['skillDmgBonus__ultimate'] ?? 0) + ORPHIE_C4_ULTIMATE_DMG
  }
}

export const orphieMechanic: AgentMechanicModule = {
  id: 'agent:orphie_magusa',
  agentIds: [ORPHIE_AGENT_ID],
  name: '奥菲丝&「鬼火」',
  description: '自身暴击率+25%、追加攻击增伤+85%（增伤区，按 additionalAttack tag 定向）与影画1/2/4自身部分。',
  applyPanel: applyOrphiePanel,
}
