/**
 * 普罗米娅（1541）—— 异常掌控转精通、寒蚀值口径与影画整局总量模型
 *
 * 原文来源：data/raw/nanoka_missing/full/1541.json，按核心被动 Lv.7。
 * - 核心被动盗火：初始异常掌控>150时每超1点提升1.5异常精通（等价复现 spec
 *   attributeConversions prometheus_mastery_to_proficiency，模块注册后由其承接）。
 * - 影画2 信念飘摇：异常精通提升40点计入面板。
 * - 额外能力饮冰：其他异常/支援队友激活；发动强化特殊技时冰异常积蓄效率+30%（30秒窗口
 *   按整局常驻近似，计入通用 anomalyBuildUpEfficiency，普罗米娅仅积蓄冰异常）；
 *   有罪推定全队异放无视40%防御按自身 enemyDefReduction+40 近似（沿用旧 guilty 模块口径）。
 *
 * 明确未建模（异常结算区/状态机，calcAnomalyDamage 已内置精通乘区，直接叠加会重复计入精通）：
 * - 核心被动异放：处刑式·绝裁终结一击命中异常敌人触发异放，固定结算635%倍率对应属性异常伤害、
 *   消耗1点霜刑；寒蚀值积累（冻结/紊乱/乱流/强特/队友异放回复）与霜刑转化（50寒蚀→1霜刑）逐时序。
 * - 核心被动「每超1点掌控提升0.35%全队异放伤害」：全队向异放增伤，模块仅作用自身面板。
 * - 额外能力霜寒持续+3秒（全队/敌方状态）；有罪推定为全队异放限定，这里近似为自身全伤害减防。
 * - 影画1 有罪推定额外无视20%防御、影画4 异放回寒蚀值、影画6 特殊异放200%与无视15%全抗。
 */
import type {
  AgentCharConfigInput,
  AgentMechanicModule,
  AgentPanelInput,
  AgentResourceResultInput,
  AgentEventInput,
  AgentResourceSectionsInput,
  AgentSkillTransformInput,
} from '../types'

export const PROMIA_ID = '1541'
export const PROMIA_MASTERY_THRESHOLD = 150
export const PROMIA_PROF_PER_MASTERY = 1.5
export const PROMIA_TEAM_RELEASE_PER_MASTERY = 0.35
export const PROMIA_C2_PROFICIENCY = 40
export const PROMIA_ADDITIONAL_BUILDUP_EFF = 30
export const PROMIA_GUILTY_DEF_IGNORE = 40

export interface PromiaCycle {
  cinemaLevel: number
  anomalyMastery: number
  additionalActive: boolean
  masteryExcess: number
  proficiencyFromMastery: number
  c2Proficiency: number
  totalProficiency: number
  teamReleaseDmg: number
  additionalBuildUpEff: number
  guiltyDefIgnore: number
  note: string
}

function clampRatio(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0))
}

function whole(value: number): number {
  return Math.max(0, Math.floor(Number.isFinite(value) ? value : 0))
}

export function computePromiaCycle(input: {
  cinemaLevel: number
  anomalyMastery: number
  additionalActive: boolean
}): PromiaCycle {
  const cinemaLevel = whole(input.cinemaLevel)
  const anomalyMastery = Math.max(0, Number.isFinite(input.anomalyMastery) ? input.anomalyMastery : 0)
  const masteryExcess = Math.max(0, anomalyMastery - PROMIA_MASTERY_THRESHOLD)
  const proficiencyFromMastery = masteryExcess * PROMIA_PROF_PER_MASTERY
  const c2Proficiency = cinemaLevel >= 2 ? PROMIA_C2_PROFICIENCY : 0
  return {
    cinemaLevel,
    anomalyMastery,
    additionalActive: input.additionalActive,
    masteryExcess,
    proficiencyFromMastery,
    c2Proficiency,
    totalProficiency: proficiencyFromMastery + c2Proficiency,
    teamReleaseDmg: masteryExcess * PROMIA_TEAM_RELEASE_PER_MASTERY,
    additionalBuildUpEff: input.additionalActive ? PROMIA_ADDITIONAL_BUILDUP_EFF : 0,
    guiltyDefIgnore: input.additionalActive ? PROMIA_GUILTY_DEF_IGNORE : 0,
    note: '寒蚀值/霜刑/异放结算与全队异放增伤属异常结算区/全队向，未建模。',
  }
}

function buildPromiaCharConfig({ cinemaLevel, cfg, panel }: AgentCharConfigInput): void {
  const record = cfg as unknown as Record<string, unknown>
  record.promiaCinemaLevel = cinemaLevel
  record.promiaAnomalyMastery = panel.anomalyMastery ?? 0
  record.promiaAdditionalActive = (panel.additionalAbilityActive ?? 0) > 0
}

function cycleFromCfg(cfg: unknown): PromiaCycle {
  const record = cfg as Record<string, unknown>
  return computePromiaCycle({
    cinemaLevel: Number(record.promiaCinemaLevel ?? 0),
    anomalyMastery: Number(record.promiaAnomalyMastery ?? 0),
    additionalActive: record.promiaAdditionalActive === true,
  })
}

/** 面板层：异常掌控转精通（复现 attributeConversions）+ 影画2精通+40。 */
function applyPromiaPanel({ cinemaLevel, outOfCombatPanel, panel }: AgentPanelInput): void {
  const mastery = Math.max(0, outOfCombatPanel?.anomalyMastery ?? 0)
  const excess = Math.max(0, mastery - PROMIA_MASTERY_THRESHOLD)
  panel.anomalyProficiency = (panel.anomalyProficiency ?? 0) + excess * PROMIA_PROF_PER_MASTERY
  if (cinemaLevel >= 2) {
    panel.anomalyProficiency = (panel.anomalyProficiency ?? 0) + PROMIA_C2_PROFICIENCY
  }
}

/** 提取层：额外能力冰异常积蓄效率+30% 与 有罪推定无视防御（需 additionalAbilityActive 门控）。 */
function applyPromiaBuildUp({ charResult, panel }: AgentSkillTransformInput): void {
  if (!panel) return
  if ((panel as Record<string, unknown>).__promiaBuildUpApplied) return
  ;(panel as Record<string, unknown>).__promiaBuildUpApplied = true
  const cycle = charResult.specResources?.promia_cycle as PromiaCycle | undefined
  if (!cycle) return
  if (cycle.additionalBuildUpEff > 0) {
    panel.anomalyBuildUpEfficiency = (panel.anomalyBuildUpEfficiency ?? 0) + cycle.additionalBuildUpEff
  }
  if (cycle.guiltyDefIgnore > 0) {
    panel.enemyDefReduction = (panel.enemyDefReduction ?? 0) + cycle.guiltyDefIgnore
  }
}

function buildPromiaResourceResult({ cfg }: AgentResourceResultInput) {
  return { specResources: { promia_cycle: cycleFromCfg(cfg) } }
}

function buildPromiaResourceSections({ result }: AgentResourceSectionsInput) {
  const cycle = result.specResources?.promia_cycle as PromiaCycle | undefined
  if (!cycle) return []
  return [{
    id: 'promia-cycle',
    title: '普罗米娅·掌控转精通',
    summary: `异常精通 +${cycle.totalProficiency}（掌控${cycle.anomalyMastery}）`,
    rows: [
      { label: '掌控转精通', value: `+${cycle.proficiencyFromMastery}`, detail: `掌控${cycle.anomalyMastery}，超${PROMIA_MASTERY_THRESHOLD}部分×${PROMIA_PROF_PER_MASTERY}` },
      { label: '影画2精通', value: `+${cycle.c2Proficiency}`, detail: '信念飘摇' },
      { label: '全队异放增伤', value: `+${cycle.teamReleaseDmg}%`, detail: '全队向，未接面板（仅展示）' },
      { label: '冰异常积蓄效率', value: `+${cycle.additionalBuildUpEff}%`, detail: cycle.additionalActive ? '额外能力已激活' : '未激活' },
      { label: '有罪推定无视防御', value: `+${cycle.guiltyDefIgnore}%`, detail: '全队异放限定，近似为自身减防' },
    ],
    footer: cycle.note,
  }]
}

/** 绝裁异放固定倍率（原文「固定结算635%倍率的对应属性异常伤害」）；C2 倍率提升120% = 加120个百分点（用户口供 2026-08-24：635→755） */
export const PROMIA_EXECUTION_RELEASE_MULTIPLIER = 635
export const PROMIA_C2_RELEASE_BONUS = 120

/**
 * 处刑式·绝裁终结一击异放（核心被动）：命中异常状态敌人触发，固定结算 635%（C2=755%）倍率
 * 的对应属性异常伤害，发动时消耗 1 点[霜刑]。
 * 次数完全由回复端驱动（用户口径：总量计算器不管单条持有上限，霜刑来多少打多少，
 * 实战约20次；A5+绝裁连发耗时极小不构成约束）：
 *   寒蚀收入 = 冻结/紊乱触发×5 + 乱流×5（池口径近似：totalTriggerCount×5）
 *            + 自身强特×10 + 队友异放×15（收敛注入 cfg.promiaTeammateReleaseCount）
 *   次数 = 进场2 + C1终结技1 + floor(寒蚀收入 / 50)
 * 结算语义与全角色一致：基础者=该元素异常主施加者、结算者=普罗米娅（dominant 分支自动）。
 */
function buildPromiaAnomalyEvents({ cfg, state, events }: AgentEventInput): void {
  const record = cfg as unknown as Record<string, unknown>
  const cinemaLevel = Math.max(0, Math.floor(Number(record.promiaCinemaLevel ?? 0)))
  const override = Math.max(0, Math.floor(setting(cfg, 'promia.releaseCountOverride', 0)))
  const triggerHits = Math.max(0, Math.floor(Number(record.promiaTriggerHitCount ?? 0)))
  const teammateReleases = Math.max(0, Math.floor(Number(record.promiaTeammateReleaseCount ?? 0)))
  const exCasts = Math.max(0, Math.floor(Number(state.exSpecialCount ?? 0)))
  const frostGain = triggerHits * 5 + exCasts * 10 + teammateReleases * 15
  const initial = 2 + (cinemaLevel >= 1 ? 1 : 0)
  const count = override > 0 ? override : initial + Math.floor(frostGain / 50)
  if (count <= 0) return
  const mult = PROMIA_EXECUTION_RELEASE_MULTIPLIER + (cinemaLevel >= 2 ? PROMIA_C2_RELEASE_BONUS : 0)
  events.push({
    eventId: 'promia_execution_release',
    eventName: '处刑式·绝裁终结一击·异放',
    eventType: 'release',
    element: 'dominant',
    carrierMoveName: '强化特殊技：处刑式·绝裁（终结一击）',
    count,
    formula: `releaseMultiplier=${mult}（固定倍率${cinemaLevel >= 2 ? '，C2=635+120' : ''}）`,
    fields: [`releaseMultiplier=${mult}`, `frostGain=${frostGain}`, `casts=${count}`],
    note: `回复端：初始${initial} + 寒蚀${frostGain}/50 → ${count} 次（不受持有上限钳制）；元素按目标当前异常分配。`,
  })
}

function setting(cfg: AgentCharConfigInput['cfg'], id: string, fallback: number): number {
  const v = Number((cfg as unknown as Record<string, unknown>)[`setting:${id}`])
  return Number.isFinite(v) ? v : fallback
}

export const promiaMechanic: AgentMechanicModule = {
  id: 'agent:promia',
  agentIds: [PROMIA_ID],
  name: '普罗米娅·盗火',
  description: '异常掌控转精通、影画2精通、额外能力冰异常积蓄效率；绝裁异放已接（霜刑上限钳制），全队异放增伤 0.35%/点未接面板。',
  applyPanel: applyPromiaPanel,
  buildCharConfig: buildPromiaCharConfig,
  transformSkillExecutions: applyPromiaBuildUp,
  buildAnomalyEvents: buildPromiaAnomalyEvents,
  buildResourceResult: buildPromiaResourceResult,
  resourceSections: buildPromiaResourceSections,
  settings: [
    {
      id: 'promia.releaseCountOverride',
      label: '普罗米娅·绝裁异放次数覆盖',
      description: '手动指定整局绝裁异放次数；0=自动（回复端计数：初始霜刑+寒蚀收入/50，实战约20次）。',
      default: 0,
      min: 0,
      max: 60,
      step: 1,
      suffix: '次',
    },
  ],
}

export default promiaMechanic
