import type { AgentCharConfigInput, AgentMechanicModule, AgentPanelInput, AgentResourceInput, AgentResourceResultInput, AgentResourceSectionsInput } from '../types'
import { getAgentSpec } from '@/specs/registry'
import { computeSpecResources } from '@/specs/resources'
import { specToMechanicModule } from '@/specs/mechanics'

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
 * - 影画6：蓄热充能/终结技激光命中追加 250% 攻击力火伤（0.5秒至多1次）。
 *   口径 [已确认]：不按激光时长建独立行——蓄热充能/终结技招式本身带 additionalAttack
 *   tag，激光附加伤害按招式触发挂到对应行（moveId 限定，flatDamageBonus，希格莉德先例）。
 */

const ORPHIE_AGENT_ID = '1301'
const ORPHIE_CORE_CRIT_RATE = 25
const ORPHIE_CORE_ADDITIONAL_ATTACK_DMG = 85
const ORPHIE_C1_FIRE_RES_IGNORE = 15
const ORPHIE_C2_ATK_PCT = 20
const ORPHIE_C4_ULTIMATE_DMG = 40
/** 影画6 激光附加伤害的载体招式：蓄热充能、与火共舞#1/#2 */
const ORPHIE_C6_LASER_MOVE_IDS = new Set(['1301011', '1301015', '1301016'])
const ORPHIE_C6_LASER_RATIO = 250
/** 影画4 蓄热充能（强化特殊技）伤害 +40% 的载体 moveId */
const ORPHIE_C4_STORAGE_MOVE_ID = '1301011'
const ORPHIE_C4_STORAGE_DMG = 40
/** 影画2 每次追加攻击回 65 喧响（4s 至多一次） */
const ORPHIE_C2_AA_DECIBEL = 65

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

function buildOrphieCharConfig({ cfg, cinemaLevel, panel }: AgentCharConfigInput): void {
  cfg.orphieCinemaLevel = cinemaLevel
  // 影画6 激光附加伤害按「局内最终攻击力 × 百分比」进基础区（flatDamageBonus，希格莉德先例）
  cfg.orphieAtk = Math.max(0, panel?.atk ?? 0)
}

function patchOrphieExecutions({ cfg, state, executions }: AgentResourceInput): void {
  const cinema = Math.max(0, Math.floor(Number((cfg as any).orphieCinemaLevel ?? 0)))
  const atk = Math.max(0, Number((cfg as any).orphieAtk ?? 0))
  // 影画4：蓄热充能（1301011）伤害 +40%——moveId 级（此前标「无通道」已过期，patchExecutions 有 moveId 级）
  if (cinema >= 4) {
    for (const exec of executions) {
      if (exec.moveId === ORPHIE_C4_STORAGE_MOVE_ID) {
        exec.dmgBonus = (exec.dmgBonus ?? 0) + ORPHIE_C4_STORAGE_DMG
      }
    }
  }
  // 影画2：追加攻击回 65 喧响（4s 至多一次）——按 additionalAttack tag 计次数，4s CD 上限近似
  if (cinema >= 2) {
    let aaCount = 0
    for (const exec of executions) {
      if (exec.skillDamageTarget === 'additionalAttack') aaCount += Math.max(0, exec.count)
    }
    const combatTime = Math.max(0, Number((state as any)?.combatTime ?? (state as any)?.totalTime ?? 180))
    const cdCap = Math.floor(combatTime / 4)
    ;(cfg as any).extraSelfDecibelReward =
      Number((cfg as any).extraSelfDecibelReward ?? 0) + ORPHIE_C2_AA_DECIBEL * Math.min(aaCount, cdCap)
  }
  if (cinema < 6 || atk <= 0) return
  for (const exec of executions) {
    if (!exec.moveId || !ORPHIE_C6_LASER_MOVE_IDS.has(exec.moveId)) continue
    // 影画6：激光命中追加 250% 攻击力火伤（0.5秒至多1次）——口径 [已确认]：不按激光
    // 时长建独立行，按招式触发挂在蓄热充能/与火共舞行上；该伤害视为强化特殊技与追加攻击
    exec.flatDamageBonus = (exec.flatDamageBonus ?? 0) + atk * ORPHIE_C6_LASER_RATIO / 100
    exec.skillTableNote = `${exec.skillTableNote ?? ''}；影画6 激光附加 +${ORPHIE_C6_LASER_RATIO}% 攻击力火伤（视为追加攻击）`
  }
}

/** 蓄炎资源：影画6 火刀次数写入 cfg（cinema>=6 才计），spec 解释器按 cfgField 读取 */
function buildOrphieResourceResult({ cfg, state }: AgentResourceResultInput) {
  const cinema = Math.max(0, Math.floor(Number((cfg as any).orphieCinemaLevel ?? 0)))
  ;(cfg as any).orphieBladeHits = cinema >= 6 ? Math.max(0, Math.floor((state.basicAttackTime ?? 0) / 2)) : 0
  const spec = getAgentSpec(ORPHIE_AGENT_ID)
  return {
    specResources: spec ? Object.fromEntries(computeSpecResources(spec, cfg, state)) : {},
  }
}

function buildOrphieResourceSections(input: AgentResourceSectionsInput) {
  const spec = getAgentSpec(ORPHIE_AGENT_ID)
  return spec ? specToMechanicModule(spec).resourceSections?.(input) ?? [] : []
}

export const orphieMechanic: AgentMechanicModule = {
  id: 'agent:orphie_magusa',
  agentIds: [ORPHIE_AGENT_ID],
  name: '奥菲丝&「鬼火」',
  description: '自身暴击率+25%、追加攻击增伤+85%（增伤区，按 additionalAttack tag 定向）、影画1/2/4自身部分；影画6 激光附加伤害在 patchExecutions（moveId 限定）；蓄炎资源循环走 spec resource。',
  applyPanel: applyOrphiePanel,
  buildCharConfig: buildOrphieCharConfig,
  patchExecutions: patchOrphieExecutions,
  buildResourceResult: buildOrphieResourceResult,
  resourceSections: buildOrphieResourceSections,
}
