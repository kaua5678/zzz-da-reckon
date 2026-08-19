import type { AgentMechanicModule, AgentPanelInput } from '../types'
import type { MechanicSetting } from '@/types/resource'

/**
 * 朱鸢（1241，以太·击破，新艾利都治安局）—— 自身机制模块。
 * 机制文本来源：nanoka 3.2.3+18244196 zh character/1241.json。
 *
 * 朱鸢机制全部自身向，无团队 buff（1241 teammate-buffs 组原为误挂的橘福福旧版
 * 草稿，已删除；橘福福正式版在 1391 组）。
 *
 * 本模块承接：
 * - 额外能力·武装协同：[支援]或同阵营（治安局）队友在队时，强特/连携/终结后
 *   自身暴击率+30%（10秒窗口高频刷新，按常驻近似），applyPanel 按
 *   additionalAbilityActive 门控。
 * - 核心被动·特种弹药（Lv.12）：消耗[强化霰弹]攻击（请勿抵抗/火力压制）伤害+40%。
 *   口径 [已确认]：通用池平A为聚合行无法按 moveId 拆分，近似为
 *   skillDmgBonus__basic + skillDmgBonus__dashAttack 定向（作用范围略宽：
 *   含不许动/火力奇袭）。失衡状态额外+40% 走覆盖率滑块（helpers 面板块，
 *   轴模式参照仪玄凝云术待接入，非轴默认 0 自调兜底）。
 * - 影画2：请勿抵抗/火力压制以太伤害+10%×5层 → 面板级 etherDmg+50 近似
 *   （作用范围扩至全部以太伤害）。
 * - 影画4：请勿抵抗/火力压制无视25%以太抗性 → 面板级 enemyEtherResReduction+25
 *   近似（同影画2 口径）。
 *
 * 未建模（spec notes）：强化霰弹/快速装填/以太余温资源循环、影画2 防御向、
 * 影画6 追加鹿弹与强特耗能-30。
 */

const ZHUYUAN_AGENT_ID = '1241'
const ZHUYUAN_AA_CRIT_RATE = 30
const ZHUYUAN_CORE_SHELL_DMG = 40
const ZHUYUAN_C2_ETHER_DMG = 50
const ZHUYUAN_C4_ETHER_RES_IGNORE = 25

function applyZhuYuanPanel({ panel, cinemaLevel }: AgentPanelInput): void {
  if ((panel.additionalAbilityActive ?? 0) > 0) {
    panel.critRate = (panel.critRate ?? 0) + ZHUYUAN_AA_CRIT_RATE
  }
  panel['skillDmgBonus__basic'] = (panel['skillDmgBonus__basic'] ?? 0) + ZHUYUAN_CORE_SHELL_DMG
  panel['skillDmgBonus__dashAttack'] = (panel['skillDmgBonus__dashAttack'] ?? 0) + ZHUYUAN_CORE_SHELL_DMG
  if (cinemaLevel >= 2) {
    panel.etherDmg = (panel.etherDmg ?? 0) + ZHUYUAN_C2_ETHER_DMG
  }
  if (cinemaLevel >= 4) {
    panel.enemyEtherResReduction = (panel.enemyEtherResReduction ?? 0) + ZHUYUAN_C4_ETHER_RES_IGNORE
  }
}

const settings: MechanicSetting[] = [
  {
    id: 'zhuYuan.coreStunnedCoverage',
    label: '朱鸢核心被动失衡增伤覆盖率',
    description: '核心被动：消耗强化霰弹攻击命中失衡敌人时增伤额外+40% 的覆盖率。轴模式待接入（参照仪玄凝云术轴内行口径）；非轴模式默认 0，按需自调。',
    default: 0,
    min: 0,
    max: 100,
    step: 1,
    suffix: '%',
  },
]

export const zhuYuanMechanic: AgentMechanicModule = {
  id: 'agent:juhufu',
  agentIds: [ZHUYUAN_AGENT_ID],
  name: '朱鸢',
  description: '额外能力暴击率+30%（门控）、核心被动强化霰弹增伤+40%（basic/dashAttack 定向近似，失衡部分走覆盖率滑块）、影画2/4 以太增伤与抗穿。',
  applyPanel: applyZhuYuanPanel,
  settings,
}
