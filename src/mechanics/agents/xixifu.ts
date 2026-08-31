import type { AgentCharConfigInput, AgentMechanicModule, AgentPanelInput, AgentResourceInput, AgentResourceResultInput, AgentResourceSectionsInput, AgentTeamConfigInput } from '../types'
import { getAgentSpec } from '@/specs/registry'
import { computeSpecResources } from '@/specs/resources'
import { specToMechanicModule } from '@/specs/mechanics'

/**
 * 希希芙（1521，电·强攻，新艾利都治安局）—— 额外能力自身暴伤 + 毒素循环模块。
 * 机制文本来源：nanoka 3.2.3+18244196 zh character/1521.json。
 *
 * 拐力主体在 teammate-buffs.json 1521 组：核心被动电系无视防御公式
 * （enemyElectricDefReduction，按初始回能；影画1 buffModifiers ×1.4，上限25→35%）、
 * 额外能力全队暴伤+40%（门控）、影画1 全队电抗无视5%、终结技[以太帷幕：冷血]全队暴伤+5%。
 *
 * 本模块承接：
 * - 额外能力·毒素发酵原文「自身额外提升10%」：队友吃 buff 的 40%，希希芙自己
 *   额外 +10%（合计50%）。按 panel.additionalAbilityActive 门控。
 * - 蚀骨自拐暴击率：每次触发 +6%（15 秒，至多 3 层）→ 常驻 +18%（applyPanel 面板直加）。
 * - 毒素账目（spec resource xixifu_toxin）：初始3上限125（影画1→6）；吐信第四段/毒牙（含长按）/
 *   团伙作案/爬行恐惧获取；影画2 失衡下连携/终结命中额外+3（资源回复端，见 spec + 模块写 cfg）。
 * - 蚀骨伤害（每消耗1点毒素触发1次）：真实 moveId 1521019，**基础倍率 254.4%（随技能等级缩放）
 *   + 核心被动附加 335%（不随技能等级缩放，flatDamageBonus = 攻击力×3.35）**；
 *   失衡倍率由倍率表回填 233.2%，队伍电属性角色 1/2 名时失衡值 +40%/60%（stunBuildUpBonus）；
 *   影画1 蚀骨无视 10% 电抗（resIgnore 招式限定）。
 * - 蛇吻（每6点毒素得1层蛇影，蛇吻耗1层）：moveId 1521006，倍率 1009.1%（随技能等级缩放）；
 *   影画2 蛇吻伤害 +35%（dmgBonus 定向）。
 * - 影画4 [觉悟]（计数器：强特/连携/终结各+1层，至多3层；蛇吻消耗全部，每层1次特殊蚀骨）：
 *   特殊蚀骨 = 强特次数 + 连携次数 + 终结次数（默认全消耗近似），无失衡值。
 * - 影画6 [蚀骨印记]（计数器：每次蚀骨得1层印记；全队命中消耗印记触发特殊蚀骨，3秒至多1层）：
 *   特殊蚀骨 = min(蚀骨总触发数, 战斗时间/3)，无失衡值。
 *
 * 未建模（spec notes）：影画4 觉悟层数状态机（按默认全消耗近似）；影画6 印记 3 秒 ICD
 *   按「战斗时间/3」上限近似（未逐事件模拟全队命中频率）。
 */

const XIXIFU_AGENT_ID = '1521'
const XIXIFU_SELF_CRIT_DMG = 10
const XIXIFU_TOXIN_RESOURCE_ID = 'xixifu_toxin'
/** 蚀骨真实 moveId（1521019：基础倍率 254.4% + 失衡倍率 233.2% 由倍率表回填） */
const XIXIFU_SHIGU_MOVE_ID = '1521019'
/** 蚀骨基础倍率（倍率表 Lv.12，随技能等级缩放） */
const XIXIFU_SHIGU_BASE = 254.4
/** 蚀骨核心被动附加（335%，不随技能等级缩放 → flatDamageBonus = 攻击力 × 3.35） */
const XIXIFU_SHIGU_ADDITION_RATIO = 3.35
/** 影画1：蚀骨伤害无视 10% 电抗（resIgnore 招式限定） */
const XIXIFU_SHIGU_C1_RES_IGNORE = 10
/** 蚀骨自拐暴击率：+6% × 3 层 = +18%（常驻） */
const XIXIFU_SHIGU_CRIT_RATE = 18
/** 队伍 1/2 名电属性角色时，蚀骨失衡值 +40%/60% */
const XIXIFU_SHIGU_STUN_1E = 40
const XIXIFU_SHIGU_STUN_2E = 60
/** 蛇吻真实 moveId（1521006：倍率 1009.1% Lv.12） */
const XIXIFU_SHEKISS_MOVE_ID = '1521006'
const XIXIFU_SHEKISS_RATIO = 1009.1
/** 影画2：蛇吻伤害 +35% */
const XIXIFU_SHEKISS_C2_DMG = 35
const XIXIFU_SHEKISS_TOXIN_COST = 6
const XIXIFU_TOXIN_INITIAL = 3
const XIXIFU_TOXIN_INITIAL_C1 = 6
/** 影画6 蚀骨印记 3 秒 ICD 折算：战斗时间内至多消耗 floor(战斗时间/3) 层 */
const XIXIFU_C6_MARK_ICD_SECONDS = 3

function applyXixifuPanel({ panel }: AgentPanelInput): void {
  // 蚀骨自拐暴击率：每次触发 +6%（15秒，至多3层）→ 常驻 +18%
  panel.critRate = (panel.critRate ?? 0) + XIXIFU_SHIGU_CRIT_RATE
  if ((panel.additionalAbilityActive ?? 0) <= 0) return
  panel.critDmg = (panel.critDmg ?? 0) + XIXIFU_SELF_CRIT_DMG
}

function buildXixifuCharConfig({ cfg, cinemaLevel, team, panel }: AgentCharConfigInput): void {
  cfg.xixifuCinemaLevel = cinemaLevel
  // 蚀骨核心附加 335% 的基数（flatDamageBonus = 攻击力 × 3.35）
  cfg.xixifuAtk = Math.max(0, panel?.atk ?? 0)
  // 蚀骨失衡值 +40%/60% 的门控：队伍电属性角色数（含自身，自身恒为电）
  const electric = team.filter(m => m.agent?.attribute === 'electric').length
  cfg.xixifuElectricCount = Math.max(1, electric)
}

/** 影画2 失衡下连携/终结额外+3毒素：需要失衡次数门控，converge 阶段写入 cfg；轴模式由 cfg.axisUltimateTotal 精确反推 */
function applyXixifuTeamConfig({ characters, phase, stunCount }: AgentTeamConfigInput): void {
  if (phase !== 'converge') return
  for (const c of characters) {
    if (c.agentId === XIXIFU_AGENT_ID) c.xixifuStunCount = Math.max(0, Math.floor(stunCount ?? 0))
  }
}

function computeXixifuToxinTotal(cfg: AgentResourceInput['cfg'], state: AgentResourceInput['state']): number {
  const spec = getAgentSpec(XIXIFU_AGENT_ID)
  if (!spec) return 0
  const cinema = Math.max(0, Math.floor(Number((cfg as any).xixifuCinemaLevel ?? 0)))
  // 影画1：进场毒素 3→6（initialValueSource=cfgField，buildExecutions 先于
  // buildResourceResult 调用，此处写入保证两条路径一致）
  ;(cfg as any).xixifuInitialToxin = cinema >= 1 ? XIXIFU_TOXIN_INITIAL_C1 : XIXIFU_TOXIN_INITIAL
  // 影画2：失衡下连携/终结命中额外+3毒素（资源回复端）。
  // 非轴：连携默认全吃（全在失衡内），终结 = min(终结次数, 失衡次数)。
  // 轴模式（2026-08-31 接入）：连携/终结都由轴内块精确反推——轴内连携 override 进
  // state.chainCountTotal、终结读 cfg.axisUltimateTotal（编排层按窗口数加权注入），
  // 轴内块全在失衡窗口内，不吃 min(ult, stun) 折扣。
  const axisUlt = Math.max(0, Math.floor(Number((cfg as any).axisUltimateTotal ?? 0) || 0))
  const chain = Math.max(0, Math.floor(state.chainCountTotal ?? 0))
  const ult = axisUlt > 0 ? axisUlt : Math.max(0, Math.floor(state.ultimateCount ?? 0))
  const stun = Math.max(0, Math.floor(Number((cfg as any).xixifuStunCount ?? 0)))
  const stunnedUlt = axisUlt > 0 ? ult : Math.min(ult, stun)
  ;(cfg as any).xixifuC2Toxin = cinema >= 2 ? (chain + stunnedUlt) * 3 : 0
  const toxin = computeSpecResources(spec, cfg, state).get(XIXIFU_TOXIN_RESOURCE_ID)
  if (!toxin) return 0
  return Math.max(0, Math.floor(toxin.initialValue + toxin.totalGain))
}

/** 汇总毒素→蚀骨/蛇吻次数：毒素总量、蛇吻次数、蚀骨基础次数、蚀骨总次数（含影画4/6） */
function computeXixifuCounts(cfg: AgentResourceInput['cfg'], state: AgentResourceInput['state']) {
  const toxinTotal = computeXixifuToxinTotal(cfg, state)
  const shekissCount = Math.floor(toxinTotal / XIXIFU_SHEKISS_TOXIN_COST)
  const cinema = Math.max(0, Math.floor(Number((cfg as any).xixifuCinemaLevel ?? 0)))
  // 蚀骨基础：每消耗1点毒素触发1次（接战每5秒/蛇吻快速消耗/溢出，总量口径）
  const baseShigu = toxinTotal
  // 影画4 [觉悟]：强特/连携/终结各+1层，默认全消耗 → 特殊蚀骨 = 三者次数之和，无失衡值
  const c4Extra = cinema >= 4
    ? Math.min(
        Math.floor(state.exSpecialCount ?? 0) + Math.floor(state.chainCountTotal ?? 0) + Math.floor(state.ultimateCount ?? 0),
        shekissCount * 3,
      )
    : 0
  // 影画6 [蚀骨印记]：每次蚀骨得1层印记，全队命中消耗，3秒至多1层 → min(印记数, 战斗时间/3)
  const c6Extra = cinema >= 6
    ? Math.min(baseShigu + c4Extra, Math.floor((cfg.battleTime ?? 180) / XIXIFU_C6_MARK_ICD_SECONDS))
    : 0
  return { toxinTotal, shekissCount, baseShigu, shiguTotal: baseShigu + c4Extra + c6Extra, cinema }
}

function buildXixifuExecutions({ cfg, state, executions }: AgentResourceInput): void {
  const { shekissCount, baseShigu, shiguTotal, cinema } = computeXixifuCounts(cfg, state)
  if (shiguTotal <= 0 && shekissCount <= 0) return
  const electric = Math.max(1, Math.floor(Number((cfg as any).xixifuElectricCount ?? 1)))
  const stunBonus = electric >= 2 ? XIXIFU_SHIGU_STUN_2E : XIXIFU_SHIGU_STUN_1E
  const atk = Math.max(0, Number((cfg as any).xixifuAtk ?? 0))
  const flatAddition = atk * XIXIFU_SHIGU_ADDITION_RATIO
  const c1ResIgnore = cinema >= 1 ? XIXIFU_SHIGU_C1_RES_IGNORE : 0

  // 蚀骨（毒素消耗，有失衡值）：真实 moveId 1521019；基础 254.4%（随技能等级）+ 附加 335%（flat 不随等级）
  if (baseShigu > 0) {
    executions.push({
      moveId: XIXIFU_SHIGU_MOVE_ID,
      moveName: '蚀骨（毒素消耗）',
      category: 'basic',
      count: baseShigu,
      actionTime: 0,
      comboAlignRatio: 0,
      totalTime: 0,
      totalComboAlignTime: 0,
      energyConsume: 0,
      totalEnergyConsume: 0,
      decibelRecovery: 0,
      totalDecibelRecovery: 0,
      energyRecovery: 0,
      totalEnergyRecovery: 0,
      damageMultiplier: XIXIFU_SHIGU_BASE,
      damageMultiplierOverride: true,
      flatDamageBonus: flatAddition,
      element: 'electric',
      stunBuildUpBonus: stunBonus,
      resIgnore: c1ResIgnore,
      skillTableNote: `蚀骨 ×${baseShigu}：基础 ${XIXIFU_SHIGU_BASE}%（随技能等级）+ 核心附加 ${Math.round(XIXIFU_SHIGU_ADDITION_RATIO * 100)}%（flat）；队伍 ${electric} 名电属性 → 失衡值 +${stunBonus}%${cinema >= 1 ? '；影画1 无视 10% 电抗' : ''}`,
    })
  }

  // 特殊蚀骨（影画4 觉悟 + 影画6 印记）：无法造成失衡值 → 假 moveId 不进倍率表失衡提取
  const specialShigu = shiguTotal - baseShigu
  if (specialShigu > 0) {
    executions.push({
      moveId: 'xixifu_shigu_special',
      moveName: '特殊蚀骨（觉悟/印记）',
      category: 'basic',
      count: specialShigu,
      actionTime: 0,
      comboAlignRatio: 0,
      totalTime: 0,
      totalComboAlignTime: 0,
      energyConsume: 0,
      totalEnergyConsume: 0,
      decibelRecovery: 0,
      totalDecibelRecovery: 0,
      energyRecovery: 0,
      totalEnergyRecovery: 0,
      damageMultiplier: XIXIFU_SHIGU_BASE,
      damageMultiplierOverride: true,
      flatDamageBonus: flatAddition,
      element: 'electric',
      resIgnore: c1ResIgnore,
      skillTableNote: `特殊蚀骨 ×${specialShigu}：影画4 觉悟 / 影画6 印记（无法造成失衡值）${cinema >= 1 ? '；影画1 无视 10% 电抗' : ''}`,
    })
  }

  // 蛇吻（普通攻击：蛇吻）：真实 moveId 1521006，倍率 1009.1%（Lv.12，随技能等级）；影画2 +35%
  if (shekissCount > 0) {
    executions.push({
      moveId: XIXIFU_SHEKISS_MOVE_ID,
      moveName: '普通攻击：蛇吻',
      category: 'basic',
      count: shekissCount,
      actionTime: 0,
      comboAlignRatio: 0,
      totalTime: 0,
      totalComboAlignTime: 0,
      energyConsume: 0,
      totalEnergyConsume: 0,
      decibelRecovery: 0,
      totalDecibelRecovery: 0,
      energyRecovery: 0,
      totalEnergyRecovery: 0,
      damageMultiplier: XIXIFU_SHEKISS_RATIO,
      damageMultiplierOverride: true,
      element: 'electric',
      dmgBonus: cinema >= 2 ? XIXIFU_SHEKISS_C2_DMG : 0,
      skillTableNote: `蛇吻 ×${shekissCount}（每 ${XIXIFU_SHEKISS_TOXIN_COST} 点毒素得1层蛇影）${cinema >= 2 ? `；影画2 +${XIXIFU_SHEKISS_C2_DMG}%` : ''}`,
    })
  }
}

function buildXixifuResourceResult({ cfg, state }: AgentResourceResultInput) {
  const spec = getAgentSpec(XIXIFU_AGENT_ID)
  if (!spec) return {}
  computeXixifuToxinTotal(cfg, state) // 写入影画门控的 xixifuInitialToxin / xixifuC2Toxin
  return { specResources: Object.fromEntries(computeSpecResources(spec, cfg, state)) }
}

function buildXixifuResourceSections(input: AgentResourceSectionsInput) {
  const spec = getAgentSpec(XIXIFU_AGENT_ID)
  const sections = spec ? specToMechanicModule(spec).resourceSections?.(input) ?? [] : []
  const toxin = (input.result?.specResources ?? {})[XIXIFU_TOXIN_RESOURCE_ID] as
    { initialValue: number; totalGain: number } | undefined
  if (toxin) {
    const toxinTotal = Math.max(0, Math.floor(toxin.initialValue + toxin.totalGain))
    sections.push({
      id: 'xixifu-shekiss',
      title: '希希芙·蛇吻',
      summary: `蛇吻次数 ≈ ${Math.floor(toxinTotal / XIXIFU_SHEKISS_TOXIN_COST)}`,
      rows: [{
        label: '蛇影层数来源',
        value: `${Math.floor(toxinTotal / XIXIFU_SHEKISS_TOXIN_COST)} 次`,
        detail: `每获得 ${XIXIFU_SHEKISS_TOXIN_COST} 点毒素得1层蛇影（毒素总量 ${toxinTotal}），蛇吻每次消耗1层；蛇吻伤害行见伤害池「普通攻击：蛇吻」。`,
      }],
      footer: '蚀骨伤害行见伤害池「蚀骨（毒素消耗）」与「特殊蚀骨（觉悟/印记）」。',
    })
  }
  return sections
}

export const xixifuMechanic: AgentMechanicModule = {
  id: 'agent:xixifu',
  agentIds: [XIXIFU_AGENT_ID],
  name: '希希芙',
  description: '额外能力自身暴伤+10%（门控）+ 蚀骨自拐暴击率+18%；毒素资源账目（spec resource，影画1 进场3→6、影画2 失衡连携/终结+3）+ 蚀骨伤害行（基础254.4%随等级 + 附加335% flat，影画1 无视10%电抗）、特殊蚀骨（影画4/6 计数器）、蛇吻伤害行（影画2 +35%）；全队暴伤40%与电系无视防御在 teammate-buffs 1521 组。',
  applyPanel: applyXixifuPanel,
  buildCharConfig: buildXixifuCharConfig,
  applyTeamConfig: applyXixifuTeamConfig,
  buildExecutions: buildXixifuExecutions,
  buildResourceResult: buildXixifuResourceResult,
  resourceSections: buildXixifuResourceSections,
}
