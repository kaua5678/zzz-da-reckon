import type { AgentCharConfigInput, AgentMechanicModule, AgentPanelInput, AgentResourceInput, AgentResourceResultInput, AgentResourceSectionsInput } from '../types'
import { getAgentSpec } from '@/specs/registry'
import { computeSpecResources } from '@/specs/resources'
import { specToMechanicModule } from '@/specs/mechanics'

/**
 * 希希芙（1521，电·异常，新艾利都治安局）—— 额外能力自身暴伤 + 毒素循环模块。
 * 机制文本来源：nanoka 3.2.3+18244196 zh character/1521.json。
 *
 * 拐力主体在 teammate-buffs.json 1521 组：核心被动电系无视防御公式
 * （enemyElectricDefReduction，按初始回能）、额外能力全队暴伤+40%（门控）、
 * 影画1 电抗无视5% + 核心公式×1.4、终结技[以太帷幕：冷血]全队暴伤+5%（原文团队拐）。
 *
 * 本模块承接：
 * - 额外能力·毒素发酵原文「自身额外提升10%」：队友吃 buff 的 40%，希希芙自己
 *   额外 +10%（合计50%）。按 panel.additionalAbilityActive 门控。
 * - 毒素账目（spec resource xixifu_toxin）：初始3上限125；吐信第四段/毒牙（含长按）/
 *   团伙作案/爬行恐惧获取；整局总量口径，125 上限只限单次存量不截断整局。
 * - 蚀骨次数 = 毒素总获取（每消耗1点触发1次：接战每5秒耗1点/蛇吻快速消耗/溢出）。
 * - 蚀骨伤害行（buildExecutions）：倍率表无蚀骨行，按 Lv.12 附加 335% 攻击力建模，
 *   element='electric'；基础倍率无数据源未建模（spec notes）。
 * - 蛇吻次数 = floor(毒素总量/6)（每6点毒素得1层蛇影，蛇吻耗1层），资源卡输出。
 *
 * 未建模（spec notes）：蚀骨基础倍率（无数据源）、蛇吻本体直伤、影画4 [觉悟]特殊蚀骨、
 * 影画6 [蚀骨印记]全队追加蚀骨。
 */

const XIXIFU_AGENT_ID = '1521'
const XIXIFU_SELF_CRIT_DMG = 10
const XIXIFU_TOXIN_RESOURCE_ID = 'xixifu_toxin'
const XIXIFU_SHIGU_RATIO = 335
const XIXIFU_SHEKISS_TOXIN_COST = 6
const XIXIFU_TOXIN_INITIAL = 3
const XIXIFU_TOXIN_INITIAL_C1 = 6

function applyXixifuPanel({ panel }: AgentPanelInput): void {
  if ((panel.additionalAbilityActive ?? 0) <= 0) return
  panel.critDmg = (panel.critDmg ?? 0) + XIXIFU_SELF_CRIT_DMG
}

function buildXixifuCharConfig({ cfg, cinemaLevel }: AgentCharConfigInput): void {
  cfg.xixifuCinemaLevel = cinemaLevel
}

function computeXixifuToxinTotal(cfg: AgentResourceInput['cfg'], state: AgentResourceInput['state']): number {
  const spec = getAgentSpec(XIXIFU_AGENT_ID)
  if (!spec) return 0
  // 影画1：进场毒素 3→6（initialValueSource=cfgField，buildExecutions 先于
  // buildResourceResult 调用，此处写入保证两条路径一致）
  const cinema = Math.max(0, Math.floor(Number((cfg as any).xixifuCinemaLevel ?? 0)))
  ;(cfg as any).xixifuInitialToxin = cinema >= 1 ? XIXIFU_TOXIN_INITIAL_C1 : XIXIFU_TOXIN_INITIAL
  const toxin = computeSpecResources(spec, cfg, state).get(XIXIFU_TOXIN_RESOURCE_ID)
  if (!toxin) return 0
  return Math.max(0, Math.floor(toxin.initialValue + toxin.totalGain))
}

function buildXixifuExecutions({ cfg, state, executions }: AgentResourceInput): void {
  const toxinTotal = computeXixifuToxinTotal(cfg, state)
  if (toxinTotal <= 0) return
  executions.push({
    moveId: 'xixifu_shigu',
    moveName: '蚀骨（毒素消耗）',
    category: 'special',
    count: toxinTotal,
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
    damageMultiplier: XIXIFU_SHIGU_RATIO,
    damageMultiplierOverride: true,
    element: 'electric',
    skillTableNote: `蚀骨 ×${toxinTotal}：毒素每消耗1点触发1次（倍率表无蚀骨行，按 Lv.12 附加 ${XIXIFU_SHIGU_RATIO}% 攻击力；基础倍率无数据源）`,
  })
}

function buildXixifuResourceResult({ cfg, state }: AgentResourceResultInput) {
  const spec = getAgentSpec(XIXIFU_AGENT_ID)
  if (!spec) return {}
  computeXixifuToxinTotal(cfg, state) // 写入影画门控的 xixifuInitialToxin
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
        detail: `每获得6点毒素得1层蛇影（毒素总量 ${toxinTotal}），蛇吻每次消耗1层；蛇吻自身倍率行未建模`,
      }],
      footer: '蚀骨伤害行见伤害池「蚀骨（毒素消耗）」；蛇吻本体的直伤未建模。',
    })
  }
  return sections
}

export const xixifuMechanic: AgentMechanicModule = {
  id: 'agent:xixifu',
  agentIds: [XIXIFU_AGENT_ID],
  name: '希希芙',
  description: '额外能力自身暴伤+10%（门控）；毒素资源账目（spec resource，影画1 进场3→6）+ 蚀骨伤害行（335% 攻击力）+ 蛇吻次数卡；全队暴伤40%与电系无视防御在 teammate-buffs 1521 组。',
  applyPanel: applyXixifuPanel,
  buildCharConfig: buildXixifuCharConfig,
  buildExecutions: buildXixifuExecutions,
  buildResourceResult: buildXixifuResourceResult,
  resourceSections: buildXixifuResourceSections,
}
