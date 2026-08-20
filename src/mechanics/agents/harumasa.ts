/**
 * 悠真（1201）—— 甲乙矢、电囚、飞弦·斩、锋芒与影画整局总量模型
 *
 * 原文来源：data/raw/nanoka_missing/full/1201.json，采用 catalog 当前导入的扩展版核心被动 Lv.7：
 * 飞弦·斩、逐雷与终结技暴击率+25%，每层锋芒使三者暴伤+12%，上限6层。
 * - 飞弦·斩、甲乙矢命中数显式可调，不用闪避反击或平A时间伪造。
 * - 飞弦·斩三段按 1201020/21/22 轮转生成；逐雷按失衡覆盖率生成，动作时间为0。
 * - 甲乙矢使用真实 moveId 1201008；C1每个电壶由1支变2支，用命中总数体现。
 * - C2电掣按连携/终结各补满7层的总量近似，最多强化实际飞弦·斩次数。
 * - C4每次飞弦·斩回30喧响；C6每12次甲乙矢生成一次1500%电磁爆炸。
 * - 锋芒5秒、电囚10/20秒与C6减抗12秒按可调覆盖率处理，不声称逐秒精确。
 */
import type {
  AgentCharConfigInput,
  AgentMechanicModule,
  AgentResourceInput,
  AgentResourceResultInput,
  AgentResourceSectionsInput,
} from '../types'

export const HARUMASA_ID = '1201'
export const HARUMASA_ARROW_MOVE_ID = '1201008'
export const HARUMASA_ULT_MOVE_ID = '1201014'
export const HARUMASA_ULT_FOLLOW_MOVE_ID = '1201024'
export const HARUMASA_ULT_FOLLOW_ACTION_TIME = 1.765
export const HARUMASA_SLASH_MOVE_IDS = ['1201020', '1201021', '1201022'] as const
export const HARUMASA_SLASH_ACTION_TIMES = [0.3, 0.417, 0.45] as const
export const HARUMASA_THUNDER_MOVE_ID = '1201025'
export const HARUMASA_CORE_CRIT_RATE = 25
export const HARUMASA_EDGE_CRIT_DMG_PER_STACK = 12
export const HARUMASA_EDGE_MAX = 6
export const HARUMASA_ADDITIONAL_DMG = 40
export const HARUMASA_C2_DMG_BONUS = 50
export const HARUMASA_C4_DECIBEL_PER_SLASH = 30
export const HARUMASA_C6_RES_IGNORE = 15
export const HARUMASA_C6_EXPLOSION_MULTIPLIER = 1500

const SLASH_SET = new Set<string>(HARUMASA_SLASH_MOVE_IDS)
const CORE_TARGETS = new Set<string>([
  ...HARUMASA_SLASH_MOVE_IDS,
  HARUMASA_THUNDER_MOVE_ID,
  HARUMASA_ULT_MOVE_ID,
  HARUMASA_ULT_FOLLOW_MOVE_ID,
])

export interface HarumasaCycle {
  cinemaLevel: number
  slashCount: number
  arrowHitCount: number
  thunderCount: number
  conditionCoverage: number
  edgeAverageStacks: number
  edgeCritDmg: number
  prisonCap: number
  prisonDurationSeconds: number
  prisonFromArrows: number
  prisonFromAdditional: number
  slashPrisonCost: number
  surgeGain: number
  surgeBuffedSlashCount: number
  surgeCoverage: number
  c4Decibel: number
  c6ResIgnoreCoverage: number
  c6ExplosionCount: number
  activatedKettleCount: number
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

export function computeHarumasaCycle(input: {
  cinemaLevel: number
  slashCount: number
  activatedKettleCount?: number
  arrowHitCount: number
  chainCount: number
  ultimateCount: number
  conditionCoverage: number
  edgeAverageStacks: number
  thunderCoverage: number
  c6ResIgnoreCoverage: number
}): HarumasaCycle {
  const cinemaLevel = whole(input.cinemaLevel)
  const slashCount = whole(input.slashCount)
  const arrowHitCount = whole(input.arrowHitCount)
  const conditionCoverage = clampRatio(input.conditionCoverage)
  const edgeAverageStacks = Math.min(HARUMASA_EDGE_MAX, Math.max(0, input.edgeAverageStacks))
  const thunderCount = Math.min(slashCount, Math.round(slashCount * clampRatio(input.thunderCoverage)))
  const surgeGain = cinemaLevel >= 2
    ? 7 * (whole(input.chainCount) + whole(input.ultimateCount))
    : 0
  const surgeBuffedSlashCount = Math.min(slashCount, surgeGain)
  const prisonFromArrows = arrowHitCount
  const prisonFromAdditional = Math.round(2 * conditionCoverage)
  return {
    cinemaLevel,
    slashCount,
    arrowHitCount,
    activatedKettleCount: whole(input.activatedKettleCount ?? arrowHitCount),
    thunderCount,
    conditionCoverage,
    edgeAverageStacks,
    edgeCritDmg: edgeAverageStacks * HARUMASA_EDGE_CRIT_DMG_PER_STACK,
    prisonCap: cinemaLevel >= 1 ? 14 : 8,
    prisonDurationSeconds: cinemaLevel >= 4 ? 20 : 10,
    prisonFromArrows,
    prisonFromAdditional,
    slashPrisonCost: slashCount * 2,
    surgeGain,
    surgeBuffedSlashCount,
    surgeCoverage: slashCount > 0 ? surgeBuffedSlashCount / slashCount : 0,
    c4Decibel: cinemaLevel >= 4 ? slashCount * HARUMASA_C4_DECIBEL_PER_SLASH : 0,
    c6ResIgnoreCoverage: cinemaLevel >= 6 ? clampRatio(input.c6ResIgnoreCoverage) : 0,
    c6ExplosionCount: cinemaLevel >= 6 ? Math.floor(arrowHitCount / 12) : 0,
    note: '飞弦·斩与甲乙矢采用显式整局次数；持续状态按覆盖率近似，电囚累计与瞬时上限分开展示。',
  }
}

function buildHarumasaCharConfig({ cinemaLevel, cfg }: AgentCharConfigInput): void {
  const record = cfg as unknown as Record<string, unknown>
  record.harumasaCinemaLevel = cinemaLevel
  record.harumasaSlashCount = whole(setting(cfg, 'harumasa.slashCount', 6))
  record.harumasaActivatedKettleCount = whole(setting(cfg, 'harumasa.activatedKettleCount', 12))
  record.harumasaArrowHitCount = Number(record.harumasaActivatedKettleCount) * (cinemaLevel >= 1 ? 2 : 1)
  record.harumasaConditionCoverage = clampRatio(setting(cfg, 'harumasa.conditionCoverage', 1))
  record.harumasaEdgeAverageStacks = Math.min(HARUMASA_EDGE_MAX,
    Math.max(0, setting(cfg, 'harumasa.edgeAverageStacks', 6)))
  record.harumasaThunderCoverage = clampRatio(setting(cfg, 'harumasa.thunderCoverage', 1))
  record.harumasaC6ResIgnoreCoverage = cinemaLevel >= 6
    ? clampRatio(setting(cfg, 'harumasa.c6ResIgnoreCoverage', 1))
    : 0
  cfg.extraSelfDecibelReward = (cfg.extraSelfDecibelReward ?? 0)
    + (cinemaLevel >= 4
      ? Number(record.harumasaSlashCount) * HARUMASA_C4_DECIBEL_PER_SLASH
      : 0)
}

function cycleFromInput({ cfg, state }: Pick<AgentResourceInput, 'cfg' | 'state'>): HarumasaCycle {
  const record = cfg as unknown as Record<string, unknown>
  return computeHarumasaCycle({
    cinemaLevel: Number(record.harumasaCinemaLevel ?? 0),
    slashCount: Number(record.harumasaSlashCount ?? 6),
    activatedKettleCount: Number(record.harumasaActivatedKettleCount ?? 12),
    arrowHitCount: Number(record.harumasaArrowHitCount ?? 12),
    chainCount: state.chainCountTotal,
    ultimateCount: state.ultimateCount,
    conditionCoverage: Number(record.harumasaConditionCoverage ?? 1),
    edgeAverageStacks: Number(record.harumasaEdgeAverageStacks ?? 6),
    thunderCoverage: Number(record.harumasaThunderCoverage ?? 1),
    c6ResIgnoreCoverage: Number(record.harumasaC6ResIgnoreCoverage ?? 0),
  })
}

function pushHarumasaExecution(executions: AgentResourceInput['executions'], input: {
  moveId: string
  moveName: string
  count: number
  category: string
  actionTime?: number
  damageMultiplier?: number
}): void {
  if (input.count <= 0) return
  executions.push({
    moveId: input.moveId,
    moveName: input.moveName,
    category: input.category,
    element: 'electric',
    count: input.count,
    actionTime: input.actionTime ?? 0,
    comboAlignRatio: 0,
    totalTime: input.count * (input.actionTime ?? 0),
    totalComboAlignTime: 0,
    energyConsume: 0,
    totalEnergyConsume: 0,
    decibelRecovery: 0,
    totalDecibelRecovery: 0,
    energyRecovery: 0,
    totalEnergyRecovery: 0,
    ...(input.damageMultiplier == null
      ? {}
      : { damageMultiplier: input.damageMultiplier, damageMultiplierOverride: true }),
  })
}

function buildHarumasaExecutions({ cfg, state, executions }: AgentResourceInput): void {
  const cycle = cycleFromInput({ cfg, state })
  for (let index = 0; index < HARUMASA_SLASH_MOVE_IDS.length; index++) {
    const count = Math.floor((cycle.slashCount + HARUMASA_SLASH_MOVE_IDS.length - 1 - index)
      / HARUMASA_SLASH_MOVE_IDS.length)
    pushHarumasaExecution(executions, {
      moveId: HARUMASA_SLASH_MOVE_IDS[index],
      moveName: `冲刺攻击：飞弦·斩 #${index + 1}`,
      count,
      category: 'dodge',
      actionTime: HARUMASA_SLASH_ACTION_TIMES[index],
    })
  }
  pushHarumasaExecution(executions, {
    moveId: HARUMASA_ULT_FOLLOW_MOVE_ID,
    moveName: '残心·散华',
    count: whole(state.ultimateCount),
    category: 'chain',
    actionTime: HARUMASA_ULT_FOLLOW_ACTION_TIME,
  })
  pushHarumasaExecution(executions, {
    moveId: HARUMASA_ARROW_MOVE_ID,
    moveName: '普通攻击：甲乙矢',
    count: cycle.arrowHitCount,
    category: 'basic',
  })
  pushHarumasaExecution(executions, {
    moveId: HARUMASA_THUNDER_MOVE_ID,
    moveName: '逐雷',
    count: cycle.thunderCount,
    category: 'dodge',
  })
  pushHarumasaExecution(executions, {
    moveId: '1201_c6_electromagnetic_explosion',
    moveName: '电磁爆炸（影画6）',
    count: cycle.c6ExplosionCount,
    category: 'special',
    damageMultiplier: HARUMASA_C6_EXPLOSION_MULTIPLIER,
  })
}

function patchHarumasaExecutions({ cfg, state, executions }: AgentResourceInput): void {
  const cycle = cycleFromInput({ cfg, state })
  const additionalActive = (cfg.panel.additionalAbilityActive ?? 0) > 0
  for (const exec of executions) {
    if (CORE_TARGETS.has(exec.moveId)) {
      exec.critRateBonus = (exec.critRateBonus ?? 0) + HARUMASA_CORE_CRIT_RATE
      exec.critDmgBonus = (exec.critDmgBonus ?? 0) + cycle.edgeCritDmg
    }
    if (SLASH_SET.has(exec.moveId) && cycle.surgeCoverage > 0) {
      exec.dmgBonus = (exec.dmgBonus ?? 0) + HARUMASA_C2_DMG_BONUS * cycle.surgeCoverage
    }
    if (additionalActive && cycle.conditionCoverage > 0) {
      exec.dmgBonus = (exec.dmgBonus ?? 0) + HARUMASA_ADDITIONAL_DMG * cycle.conditionCoverage
    }
    if (cycle.c6ResIgnoreCoverage > 0) {
      exec.resIgnore = (exec.resIgnore ?? 0)
        + HARUMASA_C6_RES_IGNORE * cycle.c6ResIgnoreCoverage
    }
  }
}

function buildHarumasaResourceResult({ cfg, state }: AgentResourceResultInput) {
  return { specResources: { harumasa_cycle: cycleFromInput({ cfg, state }) } }
}

function buildHarumasaResourceSections({ result }: AgentResourceSectionsInput) {
  const cycle = result.specResources?.harumasa_cycle as HarumasaCycle | undefined
  if (!cycle) return []
  return [{
    id: 'harumasa-cycle',
    title: '悠真·电囚与锋芒',
    summary: `飞弦·斩 ${cycle.slashCount} 次 · 甲乙矢 ${cycle.arrowHitCount} 次`,
    rows: [
      { label: '锋芒', value: `${cycle.edgeAverageStacks} / ${HARUMASA_EDGE_MAX} 层`, detail: `目标招式暴伤 +${cycle.edgeCritDmg}%` },
      { label: '电壶与甲乙矢', value: `${cycle.activatedKettleCount} 枚 / ${cycle.arrowHitCount} 支`, detail: `电囚累计 ${cycle.prisonFromArrows + cycle.prisonFromAdditional} 层，瞬时上限 ${cycle.prisonCap}，持续 ${cycle.prisonDurationSeconds} 秒；飞弦消耗 ${cycle.slashPrisonCost}` },
      { label: '逐雷', value: `${cycle.thunderCount} 次`, detail: '按飞弦·斩命中失衡敌人的覆盖率折算' },
      { label: '电掣强化', value: `${cycle.surgeBuffedSlashCount} 次`, detail: `累计取得 ${cycle.surgeGain} 层，飞弦·斩增伤 +50%` },
      { label: '影画4喧响', value: `+${cycle.c4Decibel}`, detail: '每次飞弦·斩仅触发一次 +30' },
      { label: '影画6爆炸', value: `${cycle.c6ExplosionCount} 次`, detail: '同一目标每12次甲乙矢触发1500%攻击力电伤' },
    ],
    footer: cycle.note,
  }]
}

export const harumasaMechanic: AgentMechanicModule = {
  id: 'agent:harumasa',
  agentIds: [HARUMASA_ID],
  name: '悠真·破晓',
  description: '甲乙矢、电囚、飞弦·斩、逐雷、锋芒、额外能力及影画1/2/4/6。',
  settings: [
    { id: 'harumasa.slashCount', label: '飞弦·斩次数', description: '整局实际发动飞弦·斩的次数', default: 6, min: 0, max: 60, step: 1, suffix: '次' },
    { id: 'harumasa.activatedKettleCount', label: '激活电壶数', description: '整局实际激活并命中同一主要目标的电壶数；影画1每壶发射两支甲乙矢', default: 12, min: 0, max: 120, step: 1, suffix: '枚' },
    { id: 'harumasa.conditionCoverage', label: '失衡或异常覆盖率', description: '额外能力对失衡或属性异常目标的整局覆盖率', default: 1, min: 0, max: 1, step: 0.05, suffix: '%' },
    { id: 'harumasa.edgeAverageStacks', label: '锋芒平均层数', description: '飞弦·斩、逐雷和终结技命中时的平均有效锋芒层数', default: 6, min: 0, max: 6, step: 0.5, suffix: '层' },
    { id: 'harumasa.thunderCoverage', label: '逐雷触发比例', description: '飞弦·斩命中失衡敌人并触发逐雷的比例', default: 1, min: 0, max: 1, step: 0.05, suffix: '%' },
    { id: 'harumasa.c6ResIgnoreCoverage', label: '影画6减抗覆盖率', description: '甲乙矢触发12秒电抗无视的整局覆盖率', default: 1, min: 0, max: 1, step: 0.05, suffix: '%' },
  ],
  buildCharConfig: buildHarumasaCharConfig,
  buildExecutions: buildHarumasaExecutions,
  patchExecutions: patchHarumasaExecutions,
  buildResourceResult: buildHarumasaResourceResult,
  resourceSections: buildHarumasaResourceSections,
}

export default harumasaMechanic
