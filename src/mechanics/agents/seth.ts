/**
 * 赛斯（1271）—— 匪石之盾异常精通与影画整局总量模型
 *
 * 原文来源：data/raw/nanoka_missing/full/1271.json，按核心被动 Lv.7。
 * - 核心被动守望者：拥有匪石之盾时持有者异常精通+100，按持盾覆盖率折算面板 anomalyProficiency
 *   （护盾本体为防御向、为队友提供护盾为全队向，均不入伤害模型）。
 * - 额外能力意气风发：同属性/同阵营队友激活；连携最终制裁/雷霆击感电终结一击命中使目标
 *   全属性异常积蓄抗性-20%（20秒），按覆盖率折算面板 enemyAnomalyResReduction。
 * - 影画2 年少轻狂：雷霆击感电电属性异常积蓄值+35% 计入面板 electricAnomalyBuildUpEfficiency。
 * - 影画6 理想主义：雷霆击感电终结一击额外500%攻击力伤害、必定暴击且暴伤+60%，
 *   按终结一击次数滑块生成合成执行行（damageMultiplierOverride，不伪造 catalog moveId）。
 *
 * 明确未建模：
 * - 匪石之盾护盾本体（80%初始攻击、上限3000、25秒）与为队友提供护盾（全队向，防御向）。
 * - 影画1 护盾/上限+30%、异常精通失效后额外维持10秒（护盾值与逐时序）。
 * - 影画4 招架支援迅雷盾失衡值+25%（招架支援不在通用伤害执行模型内）。
 */
import type {
  AgentCharConfigInput,
  AgentMechanicModule,
  AgentResourceInput,
  AgentResourceResultInput,
  AgentResourceSectionsInput,
  AgentSkillTransformInput,
} from '../types'

export const SETH_ID = '1271'
export const SETH_SHIELD_PROFICIENCY = 100
export const SETH_ADDITIONAL_RES_REDUCTION = 20
export const SETH_C2_ELECTRIC_BUILDUP = 35
export const SETH_C6_FINISH_MULT = 500
export const SETH_C6_CRIT_DMG = 60

export interface SethCycle {
  cinemaLevel: number
  additionalActive: boolean
  shieldProficiency: number
  additionalResReduction: number
  c2ElectricBuildup: number
  c6FinishCount: number
  note: string
}

function setting(cfg: AgentCharConfigInput['cfg'], id: string, fallback: number): number {
  const value = Number((cfg as unknown as Record<string, unknown>)[`setting:${id}`])
  return Number.isFinite(value) ? value : fallback
}

function clampRatio(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0))
}

function whole(value: number): number {
  return Math.max(0, Math.floor(Number.isFinite(value) ? value : 0))
}

export function computeSethCycle(input: {
  cinemaLevel: number
  additionalActive: boolean
  shieldCoverage: number
  additionalResCoverage: number
  c6FinishCount: number
}): SethCycle {
  const cinemaLevel = whole(input.cinemaLevel)
  return {
    cinemaLevel,
    additionalActive: input.additionalActive,
    shieldProficiency: SETH_SHIELD_PROFICIENCY * clampRatio(input.shieldCoverage),
    additionalResReduction: input.additionalActive
      ? SETH_ADDITIONAL_RES_REDUCTION * clampRatio(input.additionalResCoverage)
      : 0,
    c2ElectricBuildup: cinemaLevel >= 2 ? SETH_C2_ELECTRIC_BUILDUP : 0,
    c6FinishCount: cinemaLevel >= 6 ? whole(input.c6FinishCount) : 0,
    note: '匪石之盾护盾本体/队友护盾/影画1护盾值与影画4招架支援未建模。',
  }
}

function buildSethCharConfig({ cinemaLevel, cfg, panel }: AgentCharConfigInput): void {
  const record = cfg as unknown as Record<string, unknown>
  record.sethCinemaLevel = cinemaLevel
  record.sethShieldCoverage = clampRatio(setting(cfg, 'seth.shieldCoverage', 1))
  record.sethAdditionalResCoverage = clampRatio(setting(cfg, 'seth.additionalResCoverage', 1))
  record.sethC6FinishCount = whole(setting(cfg, 'seth.c6FinishCount', 6))
  record.sethAdditionalActive = (panel.additionalAbilityActive ?? 0) > 0
}

function cycleFromInput({ cfg, state }: Pick<AgentResourceInput, 'cfg' | 'state'>): SethCycle {
  const record = cfg as unknown as Record<string, unknown>
  return computeSethCycle({
    cinemaLevel: Number(record.sethCinemaLevel ?? 0),
    additionalActive: record.sethAdditionalActive === true,
    shieldCoverage: Number(record.sethShieldCoverage ?? 1),
    additionalResCoverage: Number(record.sethAdditionalResCoverage ?? 1),
    c6FinishCount: Number(record.sethC6FinishCount ?? 6),
  })
}

function buildSethExecutions({ cfg, state, executions }: AgentResourceInput): void {
  const cycle = cycleFromInput({ cfg, state })
  if (cycle.c6FinishCount <= 0) return
  executions.push({
    moveId: '1271_c6_finish_strike',
    moveName: '雷霆击感电·终结一击（影画6）',
    category: 'basic',
    element: 'electric',
    count: cycle.c6FinishCount,
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
    damageMultiplier: SETH_C6_FINISH_MULT,
    damageMultiplierOverride: true,
    critRateBonus: 100,
    critDmgBonus: SETH_C6_CRIT_DMG,
  })
}

function applySethPanel({ charResult, panel }: AgentSkillTransformInput): void {
  if (!panel) return
  if ((panel as Record<string, unknown>).__sethPanelApplied) return
  ;(panel as Record<string, unknown>).__sethPanelApplied = true
  const cycle = charResult.specResources?.seth_cycle as SethCycle | undefined
  if (!cycle) return
  if (cycle.shieldProficiency > 0) {
    panel.anomalyProficiency = (panel.anomalyProficiency ?? 0) + cycle.shieldProficiency
  }
  if (cycle.additionalResReduction > 0) {
    panel.enemyAnomalyResReduction = (panel.enemyAnomalyResReduction ?? 0) + cycle.additionalResReduction
  }
  if (cycle.c2ElectricBuildup > 0) {
    panel.electricAnomalyBuildUpEfficiency = (panel.electricAnomalyBuildUpEfficiency ?? 0) + cycle.c2ElectricBuildup
  }
}

function buildSethResourceResult({ cfg, state }: AgentResourceResultInput) {
  return { specResources: { seth_cycle: cycleFromInput({ cfg, state }) } }
}

function buildSethResourceSections({ result }: AgentResourceSectionsInput) {
  const cycle = result.specResources?.seth_cycle as SethCycle | undefined
  if (!cycle) return []
  return [{
    id: 'seth-cycle',
    title: '赛斯·匪石之盾',
    summary: `异常精通 +${cycle.shieldProficiency} · 积蓄减抗 +${cycle.additionalResReduction}%`,
    rows: [
      { label: '匪石之盾异常精通', value: `+${cycle.shieldProficiency}`, detail: '持盾时异常精通按覆盖率' },
      { label: '额外能力积蓄减抗', value: `+${cycle.additionalResReduction}%`, detail: cycle.additionalActive ? '全属性异常积蓄抗性-20%' : '未激活' },
      { label: '影画2电积蓄效率', value: `+${cycle.c2ElectricBuildup}%`, detail: '雷霆击感电' },
      { label: '影画6终结一击', value: `${cycle.c6FinishCount} 次`, detail: '500%攻击力必暴+暴伤60%' },
    ],
    footer: cycle.note,
  }]
}

export const sethMechanic: AgentMechanicModule = {
  id: 'agent:seth',
  agentIds: [SETH_ID],
  name: '赛斯·守望者',
  description: '匪石之盾异常精通、额外能力积蓄减抗、影画2/6；护盾本体与影画1/4未建模。',
  settings: [
    { id: 'seth.shieldCoverage', label: '持盾覆盖率', description: '匪石之盾异常精通+100的整局持盾覆盖率', default: 1, min: 0, max: 1, step: 0.05, suffix: '%' },
    { id: 'seth.additionalResCoverage', label: '积蓄减抗覆盖率', description: '额外能力全属性异常积蓄抗性-20%的整局覆盖率', default: 1, min: 0, max: 1, step: 0.05, suffix: '%' },
    { id: 'seth.c6FinishCount', label: '影画6终结一击次数', description: '雷霆击感电终结一击命中次数（每次500%攻击力必暴）', default: 6, min: 0, max: 30, step: 1, suffix: '次' },
  ],
  buildCharConfig: buildSethCharConfig,
  buildExecutions: buildSethExecutions,
  transformSkillExecutions: applySethPanel,
  buildResourceResult: buildSethResourceResult,
  resourceSections: buildSethResourceSections,
}

export default sethMechanic
