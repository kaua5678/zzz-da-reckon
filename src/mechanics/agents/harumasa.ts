/**
 * 悠真（1201）—— 甲乙矢、电壶、电囚、飞弦·斩、锋芒与影画整局总量模型
 *
 * 原文来源：data/raw/nanoka_missing/full/1201.json，采用 catalog 当前导入的扩展版核心被动 Lv.7：
 * 飞弦·斩、逐雷与终结技暴击率+25%，每层锋芒使三者暴伤+12%，上限6层。
 * - 资源循环（用户口径 2026-08-26）：电壶（开局A5场外6 + A5每次2 + 连携6 + 强特地网·巡弋6）→ 落羽激活
 *   发射甲乙矢（C0 每壶1支/C1 每壶2支）→ 每支甲乙矢 1 层电囚 → 飞弦·斩每刀耗 2 层电囚。
 *   飞弦·斩总刀数 = floor(总电囚 / 2)；电囚单次上限 8(C0)/14(C1) 只决定分段分配，不影响总量。
 * - 飞弦·斩循环节奏：第一次打第一段（1201020，秽盾公式 50t → 0.6s），后续第二/三段（1201021/1201022）轮转。
 * - 强特全部打强化过的地网·巡弋（每强特 +6 电壶）；终结技决定残心·散华（1201024）次数。
 * - 影画4：终结技对全场施加满层电囚 → 电囚直接 +14 层（资源总量回复）。
 * - C2 电掣按连携/终结各补满 7 层的总量近似，最多强化实际飞弦·斩次数；C6 每12次甲乙矢生成一次1500%电磁爆炸。
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
/** 飞弦·斩第一段 0.6s（秽盾公式 50t）；第二/三段 0.417/0.45s */
export const HARUMASA_SLASH_ACTION_TIMES = [0.6, 0.417, 0.45] as const
export const HARUMASA_THUNDER_MOVE_ID = '1201025'
export const HARUMASA_CORE_CRIT_RATE = 25
export const HARUMASA_EDGE_CRIT_DMG_PER_STACK = 12
export const HARUMASA_EDGE_MAX = 6
export const HARUMASA_ADDITIONAL_DMG = 40
export const HARUMASA_C2_DMG_BONUS = 50
export const HARUMASA_C4_DECIBEL_PER_SLASH = 30
export const HARUMASA_C6_RES_IGNORE = 15
export const HARUMASA_C6_EXPLOSION_MULTIPLIER = 1500
/** 电壶来源 */
export const HARUMASA_KETTLE_INITIAL = 6 // 开局场外A5 上限电壶
export const HARUMASA_KETTLE_A5_GAIN = 2 // 普通攻击第五段 +2
export const HARUMASA_KETTLE_CHAIN_GAIN = 6 // 连携技 +6
export const HARUMASA_KETTLE_EX_GAIN = 6 // 强化特殊技（地网·巡弋）+6
/** 电囚 */
export const HARUMASA_PRISON_PER_ARROW = 1 // 每支甲乙矢 1 层电囚
export const HARUMASA_PRISON_PER_SLASH = 2 // 每次飞弦·斩耗 2 层电囚
export const HARUMASA_ADDITIONAL_PRISON = 2 // 落羽命中失衡/异常 +2 电囚
export const HARUMASA_C4_ULT_PRISON = 14 // 影画4 终结技满层 14

const SLASH_SET = new Set<string>(HARUMASA_SLASH_MOVE_IDS)
const CORE_TARGETS = new Set<string>([
  ...HARUMASA_SLASH_MOVE_IDS,
  HARUMASA_THUNDER_MOVE_ID,
  HARUMASA_ULT_MOVE_ID,
  HARUMASA_ULT_FOLLOW_MOVE_ID,
])

export interface HarumasaCycle {
  cinemaLevel: number
  kettleTotal: number
  arrowHitCount: number
  prisonTotal: number
  prisonCap: number
  prisonDurationSeconds: number
  slashCount: number
  thunderCount: number
  conditionCoverage: number
  edgeAverageStacks: number
  edgeCritDmg: number
  surgeGain: number
  surgeBuffedSlashCount: number
  surgeCoverage: number
  c4Decibel: number
  c6ResIgnoreCoverage: number
  c6ExplosionCount: number
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
  a5Count: number
  chainCount: number
  ultimateCount: number
  exSpecialCount: number
  conditionCoverage: number
  edgeAverageStacks: number
  thunderCoverage: number
  c6ResIgnoreCoverage: number
}): HarumasaCycle {
  const cinemaLevel = whole(input.cinemaLevel)
  const a5Count = whole(input.a5Count)
  const chainCount = whole(input.chainCount)
  const ultimateCount = whole(input.ultimateCount)
  const exSpecialCount = whole(input.exSpecialCount)
  const conditionCoverage = clampRatio(input.conditionCoverage)
  const edgeAverageStacks = Math.min(HARUMASA_EDGE_MAX, Math.max(0, input.edgeAverageStacks))
  // 电壶 → 甲乙矢 → 电囚 → 飞弦·斩（每刀耗 2 电囚）
  const kettleTotal = HARUMASA_KETTLE_INITIAL
    + a5Count * HARUMASA_KETTLE_A5_GAIN
    + chainCount * HARUMASA_KETTLE_CHAIN_GAIN
    + exSpecialCount * HARUMASA_KETTLE_EX_GAIN
  const arrowHitCount = kettleTotal * (cinemaLevel >= 1 ? 2 : 1)
  const prisonTotal = arrowHitCount * HARUMASA_PRISON_PER_ARROW
    + HARUMASA_ADDITIONAL_PRISON
    + (cinemaLevel >= 4 ? HARUMASA_C4_ULT_PRISON : 0)
  const slashCount = Math.floor(prisonTotal / HARUMASA_PRISON_PER_SLASH)
  const thunderCount = Math.min(slashCount, Math.round(slashCount * clampRatio(input.thunderCoverage)))
  const surgeGain = cinemaLevel >= 2 ? 7 * (chainCount + ultimateCount) : 0
  const surgeBuffedSlashCount = Math.min(slashCount, surgeGain)
  return {
    cinemaLevel,
    kettleTotal,
    arrowHitCount,
    prisonTotal,
    prisonCap: cinemaLevel >= 1 ? 14 : 8,
    prisonDurationSeconds: cinemaLevel >= 4 ? 20 : 10,
    slashCount,
    thunderCount,
    conditionCoverage,
    edgeAverageStacks,
    edgeCritDmg: edgeAverageStacks * HARUMASA_EDGE_CRIT_DMG_PER_STACK,
    surgeGain,
    surgeBuffedSlashCount,
    surgeCoverage: slashCount > 0 ? surgeBuffedSlashCount / slashCount : 0,
    c4Decibel: cinemaLevel >= 4 ? slashCount * HARUMASA_C4_DECIBEL_PER_SLASH : 0,
    c6ResIgnoreCoverage: cinemaLevel >= 6 ? clampRatio(input.c6ResIgnoreCoverage) : 0,
    c6ExplosionCount: cinemaLevel >= 6 ? Math.floor(arrowHitCount / 12) : 0,
    note: '电壶→甲乙矢→电囚→飞弦·斩资源循环；电囚单次上限只决定分段分配，影画4终结技满层14计入总量。',
  }
}

function buildHarumasaCharConfig({ cinemaLevel, cfg }: AgentCharConfigInput): void {
  const record = cfg as unknown as Record<string, unknown>
  record.harumasaCinemaLevel = cinemaLevel
  record.harumasaA5Count = whole(setting(cfg, 'harumasa.a5Count', 2))
  record.harumasaConditionCoverage = clampRatio(setting(cfg, 'harumasa.conditionCoverage', 1))
  record.harumasaEdgeAverageStacks = Math.min(HARUMASA_EDGE_MAX,
    Math.max(0, setting(cfg, 'harumasa.edgeAverageStacks', 6)))
  record.harumasaThunderCoverage = clampRatio(setting(cfg, 'harumasa.thunderCoverage', 1))
  record.harumasaC6ResIgnoreCoverage = cinemaLevel >= 6
    ? clampRatio(setting(cfg, 'harumasa.c6ResIgnoreCoverage', 1))
    : 0
}

function cycleFromInput({ cfg, state }: Pick<AgentResourceInput, 'cfg' | 'state'>): HarumasaCycle {
  const record = cfg as unknown as Record<string, unknown>
  return computeHarumasaCycle({
    cinemaLevel: Number(record.harumasaCinemaLevel ?? 0),
    a5Count: Number(record.harumasaA5Count ?? 2),
    chainCount: state.chainCountTotal,
    ultimateCount: state.ultimateCount,
    exSpecialCount: state.exSpecialCount,
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
  // 飞弦·斩循环：第一段只打一次，后续第二/三段轮转
  const slashTotal = cycle.slashCount
  const slashCounts = [
    Math.min(slashTotal, 1),
    Math.ceil(Math.max(0, slashTotal - 1) / 2),
    Math.floor(Math.max(0, slashTotal - 1) / 2),
  ]
  for (let index = 0; index < HARUMASA_SLASH_MOVE_IDS.length; index++) {
    pushHarumasaExecution(executions, {
      moveId: HARUMASA_SLASH_MOVE_IDS[index],
      moveName: `冲刺攻击：飞弦·斩 #${index + 1}`,
      count: slashCounts[index],
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
    summary: `飞弦·斩 ${cycle.slashCount} 次 · 甲乙矢 ${cycle.arrowHitCount} 次 · 电囚 ${cycle.prisonTotal} 层`,
    rows: [
      { label: '电壶', value: `${cycle.kettleTotal} 枚`, detail: `开局${HARUMASA_KETTLE_INITIAL} + A5 + 连携 + 强特 → 甲乙矢 ${cycle.arrowHitCount} 支` },
      { label: '电囚', value: `${cycle.prisonTotal} 层`, detail: `甲乙矢 + 落羽${HARUMASA_ADDITIONAL_PRISON}${cycle.cinemaLevel >= 4 ? ` + 影画4终结满层${HARUMASA_C4_ULT_PRISON}` : ''}；单次上限 ${cycle.prisonCap}，持续 ${cycle.prisonDurationSeconds} 秒` },
      { label: '飞弦·斩', value: `${cycle.slashCount} 刀`, detail: '每刀耗2电囚；第一段一次，后续二/三段轮转' },
      { label: '锋芒', value: `${cycle.edgeAverageStacks} / ${HARUMASA_EDGE_MAX} 层`, detail: `目标招式暴伤 +${cycle.edgeCritDmg}%` },
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
  description: '电壶→甲乙矢→电囚→飞弦·斩资源循环、逐雷、锋芒、额外能力及影画1/2/4/6。',
  settings: [
    { id: 'harumasa.a5Count', label: '普通攻击第五段次数', description: '整局发动普通攻击第五段（穿云）的次数，每次 +2 电壶', default: 2, min: 0, max: 30, step: 1, suffix: '次' },
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
