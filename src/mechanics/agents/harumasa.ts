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
 * - 失衡/异常拆分（用户口径 2026-08-26）：逐雷只在失衡内触发（飞弦·斩×失衡覆盖率）；额外能力增伤+40%、
 *   影画6 甲乙矢命中失衡/异常后无视15%电抗，均按「失衡覆盖率 + 异常覆盖率×(1-失衡覆盖率)」并集折算。
 *   2026-09-03 追加「失衡专属 buff 轴内直加」：轴模式下额外能力 +40% 的失衡独有部分
 *   （40×(1−异常覆盖率)）经 damagePool 行级分段直加（轴内段 +、轴外段不 +，可琳扫除帮手同款通道），
 *   非轴仍走并集近似。
 * - 潜能觉醒·贯注（potentialLevel II..VI）：局内攻击力提升 4/6/8/10/12%，飞弦·斩/逐雷无视 5/7.5/10/12.5/15% 电抗。
 * - C2 电掣按连携/终结各补满 7 层的总量近似，最多强化实际飞弦·斩次数；C6 每12次甲乙矢生成一次1500%电磁爆炸。
 * - 锋芒5秒、电囚10/20秒按可调覆盖率处理，不声称逐秒精确。
 */
import { clampRatio, whole } from '@/utils/finiteClamp'
import type {
  AgentCharConfigInput,
  AgentMechanicModule,
  AgentPanelInput,
  AgentResourceInput,
  AgentResourceResultInput,
  AgentResourceSectionsInput,
  AgentTeamConfigInput,
} from '../types'
import { mechanicSettingReader } from '@/utils/mechanicSettingCfg'
import type { CharacterResourceResult } from '@/types/resource'
import { cfgMoveActionTime } from '@/utils/moveActionTimeCfg'
import { moduleExecRow } from '@/mechanics/moduleExecRow'
import { outOfCombatStat } from '@/mechanics/initialStat'
import { forEachSlotAxisAction, stunWindowCoverage } from '@/mechanics/stunWindows'
import { potentialLevelOf } from '@/data/potentialLevel'
import { cinemaLevelOf } from '@/data/cinemaLevel'
import { additionalAbilityActiveOf } from '@/core/additionalAbilityActive'

const setting = mechanicSettingReader(() => harumasaMechanic.settings)
export const HARUMASA_ID = '1201'
export const HARUMASA_ARROW_MOVE_ID = '1201008'
export const HARUMASA_ULT_MOVE_ID = '1201014'
export const HARUMASA_ULT_FOLLOW_MOVE_ID = '1201024'
// 残心·散华 actionTime 读 cfg.moveActionTimes（catalog，CC-409；原常量 1.765 与表相等）
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
export const HARUMASA_C6_EXPLOSION_MULTIPLIER = 1500
export const HARUMASA_C6_ELECTRIC_RES_IGNORE = 15
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
/** 潜能觉醒·贯注（index 0 占位，1=I 无觉醒，2..6=II..VI） */
export const HARUMASA_POTENTIAL_ATK_PCT = [0, 0, 4, 6, 8, 10, 12] as const
export const HARUMASA_POTENTIAL_RES_IGNORE = [0, 0, 5, 7.5, 10, 12.5, 15] as const
/** 失衡窗口时长（默认 12s 失衡 + 4s，未含全队失衡延时加成）——用于从失衡次数反推失衡覆盖率 */
export const HARUMASA_STUN_WINDOW_SECONDS = 16

const SLASH_SET = new Set<string>(HARUMASA_SLASH_MOVE_IDS)
/** 潜能觉醒减抗目标（飞弦·斩 + 逐雷） */
const POTENTIAL_RES_TARGETS = new Set<string>([...HARUMASA_SLASH_MOVE_IDS, HARUMASA_THUNDER_MOVE_ID])
const CORE_TARGETS = new Set<string>([
  ...HARUMASA_SLASH_MOVE_IDS,
  HARUMASA_THUNDER_MOVE_ID,
  HARUMASA_ULT_MOVE_ID,
  HARUMASA_ULT_FOLLOW_MOVE_ID,
])

export interface HarumasaCycle {
  cinemaLevel: number
  potentialLevel: number
  kettleTotal: number
  arrowHitCount: number
  prisonTotal: number
  prisonCap: number
  prisonDurationSeconds: number
  slashCount: number
  thunderCount: number
  stunCoverage: number
  abnormalCoverage: number
  unionCoverage: number
  axisActive: boolean
  c6ResCoverage: number
  edgeAverageStacks: number
  edgeCritDmg: number
  surgeGain: number
  surgeBuffedSlashCount: number
  surgeCoverage: number
  c4Decibel: number
  c6ExplosionCount: number
  note: string
}

export function computeHarumasaCycle(input: {
  cinemaLevel: number
  potentialLevel: number
  a5Count: number
  chainCount: number
  ultimateCount: number
  exSpecialCount: number
  stunCoverage: number
  abnormalCoverage: number
  edgeAverageStacks: number
  axisActive?: boolean
  axisSlash?: number
  axisArrow?: number
}): HarumasaCycle {
  const cinemaLevel = cinemaLevelOf(input.cinemaLevel)
  const potentialLevel = potentialLevelOf(input.potentialLevel)
  const a5Count = whole(input.a5Count)
  const chainCount = whole(input.chainCount)
  const ultimateCount = whole(input.ultimateCount)
  const exSpecialCount = whole(input.exSpecialCount)
  const stunCoverage = clampRatio(input.stunCoverage)
  const abnormalCoverage = clampRatio(input.abnormalCoverage)
  const unionCoverage = Math.min(1, stunCoverage + abnormalCoverage * (1 - stunCoverage))
  const axisActive = input.axisActive === true
  const axisSlash = Math.max(0, Math.floor(input.axisSlash ?? 0))
  const axisArrow = Math.max(0, Math.floor(input.axisArrow ?? 0))
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
  // 逐雷只在失衡内触发：轴模式按轴内飞弦·斩次数（捏轴精度），非轴按失衡覆盖率
  const thunderCount = axisActive
    ? Math.min(slashCount, axisSlash)
    : Math.min(slashCount, Math.round(slashCount * stunCoverage))
  // 影画6电抗覆盖率：轴模式按轴内甲乙矢占比，非轴按并集
  const axisArrowRatio = arrowHitCount > 0 ? Math.min(1, axisArrow / arrowHitCount) : 0
  const c6ResCoverage = axisActive
    ? Math.min(1, axisArrowRatio + abnormalCoverage * (1 - axisArrowRatio))
    : unionCoverage
  const surgeGain = cinemaLevel >= 2 ? 7 * (chainCount + ultimateCount) : 0
  const surgeBuffedSlashCount = Math.min(slashCount, surgeGain)
  return {
    cinemaLevel,
    potentialLevel,
    kettleTotal,
    arrowHitCount,
    prisonTotal,
    prisonCap: cinemaLevel >= 1 ? 14 : 8,
    prisonDurationSeconds: cinemaLevel >= 4 ? 20 : 10,
    slashCount,
    thunderCount,
    stunCoverage,
    abnormalCoverage,
    unionCoverage,
    axisActive,
    c6ResCoverage,
    edgeAverageStacks,
    edgeCritDmg: edgeAverageStacks * HARUMASA_EDGE_CRIT_DMG_PER_STACK,
    surgeGain,
    surgeBuffedSlashCount,
    surgeCoverage: slashCount > 0 ? surgeBuffedSlashCount / slashCount : 0,
    c4Decibel: cinemaLevel >= 4 ? slashCount * HARUMASA_C4_DECIBEL_PER_SLASH : 0,
    c6ExplosionCount: cinemaLevel >= 6 ? Math.floor(arrowHitCount / 12) : 0,
    note: '电壶→甲乙矢→电囚→飞弦·斩资源循环；逐雷/影画6电抗轴模式按轴内块（捏轴），非轴按并集覆盖率；潜能觉醒已接入。',
  }
}

function applyPanel({ potentialLevel, outOfCombatPanel, panel }: AgentPanelInput): void {
  const lv = potentialLevelOf(potentialLevel)
  const atkPct = HARUMASA_POTENTIAL_ATK_PCT[lv]
  if (atkPct > 0) {
    const atkBonus = outOfCombatStat(outOfCombatPanel, 'atk') * atkPct / 100
    panel.atk = (panel.atk ?? 0) + atkBonus
    panel.harumasaPotentialAtk = atkBonus
  }
}

function buildHarumasaCharConfig({ cinemaLevel, potentialLevel, cfg }: AgentCharConfigInput): void {
  cfg.harumasaCinemaLevel = cinemaLevel
  cfg.harumasaPotentialLevel = potentialLevelOf(potentialLevel)
  cfg.harumasaA5Count = whole(setting(cfg, 'harumasa.a5Count'))
  cfg.harumasaStunCoverage = 0.5 // 由 applyTeamConfig converge 从失衡次数反推，此处仅兜底
  cfg.harumasaAbnormalCoverage = clampRatio(setting(cfg, 'harumasa.abnormalCoverage'))
  cfg.harumasaEdgeAverageStacks = Math.min(HARUMASA_EDGE_MAX,
    Math.max(0, setting(cfg, 'harumasa.edgeAverageStacks')))
}

/**
 * 失衡覆盖率由收敛后的失衡次数反推（轴内行直加同源：失衡窗口 = 失衡次数 × 窗口时长 / 战斗时间）；
 * 轴内飞弦·斩/甲乙矢块计数（round 11 批次 1，原 `convergence.ts` 的 `agentId === '1201'` 分支）：
 * 轴内 moveId 白名单 × 窗口数，白名单来源 = 本模块的 `HARUMASA_SLASH_MOVE_IDS` / `HARUMASA_ARROW_MOVE_ID`
 * （单一事实源，此前编排层硬编码同一组字面量 —— 两处各写一份，改一处就静默脱钩）。
 *
 * ⚠ **双判据门控**（`phase !== 'converge' || !axis`）：只判相位不判 `axis` 时，「派发器忘传 axis」
 * 会退化成「轴内计数恒 0」的**静默错值**（轴内段少了逐雷/电抗无视），而 `timeGolden` 对轴模式大面积
 * 盲（实测 105 预设里 1201 轴覆盖 = 0 队）⇒ 必须靠 `axisContext.test.ts` 的可红锁。
 * 原实现取 `axisActive ? count : 0`：轴内计数只在轴模式累加，非轴时 `active === false` ⇒ `axisSlash`
 * 与 `axisArrow` 恒 0、`harumasaAxisActive` 恒 false，逐位等价（见 `zhuYuan.ts` 同款注释）。
 */
function applyHarumasaTeamConfig({ cfg, phase, stunCount, combatTime, axis }: AgentTeamConfigInput): void {
  if (phase !== 'converge') return
  cfg.harumasaStunCoverage = stunWindowCoverage(stunCount, HARUMASA_STUN_WINDOW_SECONDS, combatTime)
  if (!axis) return
  const slot = Number(cfg.slot)
  let axisSlash = 0
  let axisArrow = 0
  forEachSlotAxisAction(axis, slot, (act, wins) => {
    if (SLASH_SET.has(act.moveId)) axisSlash += act.count * wins
    else if (act.moveId === HARUMASA_ARROW_MOVE_ID) axisArrow += act.count * wins
  })
  cfg.harumasaAxisActive = axis.active
  cfg.harumasaAxisSlash = axisSlash
  cfg.harumasaAxisArrow = axisArrow
}

function cycleFromInput({ cfg, state }: Pick<AgentResourceInput, 'cfg' | 'state'>): HarumasaCycle {
  return computeHarumasaCycle({
    cinemaLevel: cinemaLevelOf(cfg.harumasaCinemaLevel),
    potentialLevel: Number(cfg.harumasaPotentialLevel ?? 6),
    a5Count: Number(cfg.harumasaA5Count ?? 2),
    chainCount: state.chainCountTotal,
    ultimateCount: state.ultimateCount,
    exSpecialCount: state.exSpecialCount,
    stunCoverage: Number(cfg.harumasaStunCoverage ?? 0.5),
    abnormalCoverage: Number(cfg.harumasaAbnormalCoverage ?? 1),
    edgeAverageStacks: Number(cfg.harumasaEdgeAverageStacks ?? 6),
    axisActive: cfg.harumasaAxisActive === true,
    axisSlash: Number(cfg.harumasaAxisSlash ?? 0),
    axisArrow: Number(cfg.harumasaAxisArrow ?? 0),
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
  executions.push(moduleExecRow({
    moveId: input.moveId,
    moveName: input.moveName,
    category: input.category,
    element: 'electric',
    count: input.count,
    actionTime: input.actionTime ?? 0,
    totalTime: input.count * (input.actionTime ?? 0),
    ...(input.damageMultiplier == null
      ? {}
      : { damageMultiplier: input.damageMultiplier, damageMultiplierOverride: true }),
  }))
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
    actionTime: cfgMoveActionTime(cfg, HARUMASA_ULT_FOLLOW_MOVE_ID),
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
  const additionalActive = additionalAbilityActiveOf(cfg.panel)
  const potentialRes = HARUMASA_POTENTIAL_RES_IGNORE[cycle.potentialLevel]
  for (const exec of executions) {
    if (CORE_TARGETS.has(exec.moveId)) {
      exec.critRateBonus = (exec.critRateBonus ?? 0) + HARUMASA_CORE_CRIT_RATE
      exec.critDmgBonus = (exec.critDmgBonus ?? 0) + cycle.edgeCritDmg
    }
    if (SLASH_SET.has(exec.moveId) && cycle.surgeCoverage > 0) {
      exec.dmgBonus = (exec.dmgBonus ?? 0) + HARUMASA_C2_DMG_BONUS * cycle.surgeCoverage
    }
    // 额外能力增伤：失衡/异常并集。
    // 轴模式「失衡专属 buff 轴内直加」（2026-09-03，可琳扫除帮手同款通道）：公共异常部分
    // （40×异常覆盖率）摊入全部行；失衡独有部分（40×(1−异常覆盖率)）经 exec.stunOnlyDmgBonus
    // 由 damagePool 按段直加（轴内段 +、轴外段不 +）。非轴并集口径不变。
    if (additionalActive && cycle.unionCoverage > 0) {
      if (cycle.axisActive) {
        const abnormalPart = HARUMASA_ADDITIONAL_DMG * cycle.abnormalCoverage
        if (abnormalPart > 0) exec.dmgBonus = (exec.dmgBonus ?? 0) + abnormalPart
        exec.stunOnlyDmgBonus = HARUMASA_ADDITIONAL_DMG * (1 - cycle.abnormalCoverage)
      } else {
        exec.dmgBonus = (exec.dmgBonus ?? 0) + HARUMASA_ADDITIONAL_DMG * cycle.unionCoverage
      }
    }
    // 潜能觉醒减抗：飞弦·斩/逐雷 限定招式
    if (potentialRes > 0 && POTENTIAL_RES_TARGETS.has(exec.moveId)) {
      exec.resIgnore = (exec.resIgnore ?? 0) + potentialRes
    }
    // 影画6 电抗无视15%：甲乙矢命中失衡/异常后悠真无视（轴模式按轴内甲乙矢占比，非轴并集覆盖率）
    if (cycle.cinemaLevel >= 6 && cycle.c6ResCoverage > 0) {
      exec.resIgnore = (exec.resIgnore ?? 0) + HARUMASA_C6_ELECTRIC_RES_IGNORE * cycle.c6ResCoverage
    }
  }
}

function buildHarumasaResourceResult({ cfg, state }: AgentResourceResultInput): Partial<CharacterResourceResult> {
  return { harumasaCycle: cycleFromInput({ cfg, state }) }
}

function buildHarumasaResourceSections({ result }: AgentResourceSectionsInput) {
  const cycle = result.harumasaCycle
  if (!cycle) return []
  return [{
    id: 'harumasa-cycle',
    title: '悠真·电囚与锋芒',
    summary: `飞弦·斩 ${cycle.slashCount} 次 · 甲乙矢 ${cycle.arrowHitCount} 次 · 电囚 ${cycle.prisonTotal} 层`,
    rows: [
      { label: '电壶', value: `${cycle.kettleTotal} 枚`, detail: `开局${HARUMASA_KETTLE_INITIAL} + A5 + 连携 + 强特 → 甲乙矢 ${cycle.arrowHitCount} 支` },
      { label: '电囚', value: `${cycle.prisonTotal} 层`, detail: `甲乙矢 + 落羽${HARUMASA_ADDITIONAL_PRISON}${cycle.cinemaLevel >= 4 ? ` + 影画4终结满层${HARUMASA_C4_ULT_PRISON}` : ''}；单次上限 ${cycle.prisonCap}，持续 ${cycle.prisonDurationSeconds} 秒` },
      { label: '飞弦·斩', value: `${cycle.slashCount} 刀`, detail: '每刀耗2电囚；第一段一次，后续二/三段轮转' },
      { label: '逐雷', value: `${cycle.thunderCount} 次`, detail: `只在失衡内触发（飞弦·斩×失衡覆盖率 ${(cycle.stunCoverage * 100).toFixed(0)}%）` },
      { label: '失衡/异常并集', value: `${(cycle.unionCoverage * 100).toFixed(0)}%`, detail: `失衡${(cycle.stunCoverage * 100).toFixed(0)}% + 异常${(cycle.abnormalCoverage * 100).toFixed(0)}%×(1-失衡)` },
      { label: '锋芒', value: `${cycle.edgeAverageStacks} / ${HARUMASA_EDGE_MAX} 层`, detail: `目标招式暴伤 +${cycle.edgeCritDmg}%` },
      { label: '电掣强化', value: `${cycle.surgeBuffedSlashCount} 次`, detail: `累计取得 ${cycle.surgeGain} 层，飞弦·斩增伤 +50%` },
      { label: '潜能觉醒', value: `攻击+${HARUMASA_POTENTIAL_ATK_PCT[cycle.potentialLevel]}% · 飞弦/逐雷减抗${HARUMASA_POTENTIAL_RES_IGNORE[cycle.potentialLevel]}%`, detail: `潜能 ${cycle.potentialLevel}` },
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
  description: '电壶→甲乙矢→电囚→飞弦·斩资源循环、逐雷失衡触发、锋芒、额外能力失衡/异常并集增伤、潜能觉醒、影画1/2/4/6。',
  settings: [
    { id: 'harumasa.a5Count', label: '普通攻击第五段次数', description: '整局发动普通攻击第五段（穿云）的次数，每次 +2 电壶', default: 2, min: 0, max: 30, step: 1, suffix: '次' },
    { id: 'harumasa.abnormalCoverage', label: '异常状态覆盖率', description: '敌人处于属性异常状态的时间占比（非失衡时的额外能力增伤与影画6电抗）；失衡覆盖率由失衡次数自动反推', default: 1, min: 0, max: 1, step: 0.05, suffix: '%' },
    { id: 'harumasa.edgeAverageStacks', label: '锋芒平均层数', description: '飞弦·斩、逐雷和终结技命中时的平均有效锋芒层数', default: 6, min: 0, max: 6, step: 0.5, suffix: '层' },
  ],
  applyPanel,
  buildCharConfig: buildHarumasaCharConfig,
  applyTeamConfig: applyHarumasaTeamConfig,
  buildExecutions: buildHarumasaExecutions,
  patchExecutions: patchHarumasaExecutions,
  buildResourceResult: buildHarumasaResourceResult,
  resourceSections: buildHarumasaResourceSections,
}

export default harumasaMechanic

/**
 * D2（r402 CC-376，`docs/mcp-panel-fields.md` §4 S2+S4）：本模块私有的面板字段——只有本文件读写（测试读不算引用者），声明随模块走。
 * 仍是 `PanelValues` 的成员（模块扩充，纯类型、零运行时）；出现第二个**生产**引用者时迁回 `types/catalog.ts`。
 */
declare module '@/types/catalog' {
  interface PanelValues {
    /** 潜能攻击加成的留痕：与 `panel.atk` 增量同块写入，便于 DebugPage / 命座自检看到来源 */
    harumasaPotentialAtk?: number
  }
}

/**
 * D2（CC-359/362）：本模块私有的 cfg 字段——只有本文件读写，声明随模块走，不堆在 `types/resource/config.ts`。
 * 仍是 `CharacterOperationConfig` 的成员（模块扩充，纯类型、零运行时）；被第二处引用时请迁回公共接口。
 */
declare module '@/types/resource/config' {
  interface CharacterOperationConfig {
    /** 写入：whole(setting(cfg, 'harumasa.a5Count')) */
    harumasaA5Count?: number
    /** 写入：clampRatio(setting(cfg, 'harumasa.abnormalCoverage')) */
    harumasaAbnormalCoverage?: number
    /** 写入：axis.active */
    harumasaAxisActive?: boolean
    /** 写入：axisArrow */
    harumasaAxisArrow?: number
    /** 写入：axisSlash；specs/agents/1201.json 按字段名读 */
    harumasaAxisSlash?: number
    /** 写入：cinemaLevel */
    harumasaCinemaLevel?: number
    /** 写入：Math.min(HARUMASA_EDGE_MAX, */
    harumasaEdgeAverageStacks?: number
    /** 写入：potentialLevelOf(potentialLevel)（CC-503） */
    harumasaPotentialLevel?: number
    /** 写入：0.5；Math.min(1, resolvedStun * HARUMASA_STUN_WINDOW_SECONDS / battle) */
    harumasaStunCoverage?: number
  }
}

/** r407：本模块私有结果键（原塞在 `specResources['harumasa_cycle']`，与 spec 账本混用同一无类型通道） */
declare module '@/types/resource/agentResources' {
  interface CharacterResourceResult {
    /** 浅羽悠真循环明细 */
    harumasaCycle?: HarumasaCycle
  }
}
