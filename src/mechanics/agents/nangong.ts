import type {
  AgentCharConfigInput,
  AgentEventInput,
  AgentMechanicModule,
  AgentPanelInput,
  AgentResourceInput,
  AgentResourceResultInput,
  AgentResourceSectionsInput,
  AgentSkillTransformInput,
  AgentTeamConfigInput,
} from '../types'
import type { SkillMove } from '@/types/catalog'
import type { CharacterResourceResult, MechanicSetting, NangongMechanicSource } from '@/types/resource'
import { fmt } from '@/utils/format'

/**
 * 南宫羽（1511）战斗逻辑（nanoka 原文满级被动 1511055 自主分析，2026-08）：
 * - 核心被动：异常精通 +120；初始异常掌控 >110 每超 1 点冲击力 +1；
 *   地雷撞/强特命中 → 自身积蓄效率 +35%、失衡值 +20%（30s 刷新，覆盖率滑块）；
 *   同句式的「全队伤害 +25%」pending（拟走 spec teamBuffs，本版未录不声称生效）。
 * - 重拍：进场 30（1命回满 100）、接战每秒 3.8、队友进异常 +12（6s CD 上限近似），上限 100
 *   只限瞬时存量——整局收入累进；可爱地雷飞天撞 #2/#3 各耗 50。
 * - 可爱地雷飞天撞：强特/终结/连携后长按跳过 #1 直发 #2+#3 且必精准蓄力（失衡值+20%）——
 *   默认按「跳段双击」口径全精准，从平A池划时间物化真实 moveId 行（1511005/1511006）。
 * - 颤音异放：失衡中全队异放/紊乱/进异常叠层（≤4），清除且目标处于异常状态时南宫羽结算一次
 *   异放 = 原属性异常伤害 × 元素比例(以太720/电360/火900/物理63/冰90/风36%) × (1+25%/层)。
 *   层数/次数按滑块近似（异常逐事件系统 pending，SOP §3.8）。
 * - 影画：C1 敌全抗-18% + 重拍初始回满；C4 精通+40 + 地雷撞积蓄值×1.35；C6 失衡值+50%（颤音:改 pending）。
 */

const NANGONG_AGENT_ID = '1511'
const MASTERY_BONUS = 120
const C4_MASTERY_BONUS = 40
const CONTROL_THRESHOLD = 110
const BEAT_INITIAL = 30
const BEAT_CAP = 100
const BEAT_PER_SEC = 3.8
const BEAT_PER_ANOMALY = 12
const ANOMALY_PROC_CD = 6
const MINE2_MOVE_ID = '1511005'
const MINE3_MOVE_ID = '1511006'
const PRECISE_DAZE_BONUS = 20
const CORE_BUILD_UP_BONUS = 20
const C6_BUILD_UP_BONUS = 50
const CORE_EFFICIENCY_BONUS = 35
const C1_ALL_RES_REDUCTION = 18
const VIBRATO_MAX = 4
const VIBRATO_STACK_PCT = 25
/** 异放固定倍率：原文以「原属性异常伤害×比例」表达，各元素 DOT 基准(62.5/125/50/713/500/1250)
 *  ×各自比例 全部收敛到 450%（物理 713×63%≈449.2），故按固定倍率建模（用户口径 2026-08） */
const RELEASE_FLAT_MULTIPLIER = 450
/** C6 颤音:改异放：800/400/1000/70/100/40 比例 × 同一套 DOT 基准全部收敛到 500% */
const PRIME_RELEASE_FLAT_MULTIPLIER = 500
/** 异放比例（% 原属性异常单次伤害），key = element */
const RELEASE_RATIOS: Record<string, number> = {
  ether: 720,
  electric: 360,
  fire: 900,
  physical: 63,
  ice: 90,
  wind: 36,
}
const MINE_COST_PER_PAIR = 100 // #2/#3 各耗 50 重拍

function findMoveById(skills: { categories: { moves: SkillMove[] }[] } | undefined, moveId: string): SkillMove | null {
  for (const cat of skills?.categories ?? []) {
    const mv = cat.moves.find(m => String(m.id) === moveId)
    if (mv) return mv
  }
  return null
}

function setting(cfg: AgentCharConfigInput['cfg'], id: string, fallback: number): number {
  const value = Number((cfg as unknown as Record<string, unknown>)[`setting:${id}`])
  return Number.isFinite(value) ? value : fallback
}

function clampRatio(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0))
}

export function computeNangongMechanic(input: {
  anomalyMastery: number
  frontlineSeconds: number
  battleTime: number
  beatInitial: number
  minePairs: number
  vibratoStacks: number
  releaseCount: number
}): NangongMechanicSource {
  const impactFromMastery = Math.max(0, input.anomalyMastery - CONTROL_THRESHOLD)
  // 重拍收入累进（持有上限只延迟消耗不吞收入）：初始 + 接战 3.8/s + 队友异常 12/次（CD 上限近似）
  const anomalyProcs = Math.floor(Math.max(0, input.battleTime) / ANOMALY_PROC_CD)
  const beatRegen = Math.max(0, input.frontlineSeconds) * BEAT_PER_SEC + anomalyProcs * BEAT_PER_ANOMALY
  return {
    anomalyProficiencyBonus: MASTERY_BONUS,
    impactFromMastery,
    vibratoStacks: Math.min(VIBRATO_MAX, Math.max(0, Math.floor(input.vibratoStacks))),
    vibratoMax: VIBRATO_MAX,
    releaseCount: Math.max(0, Math.floor(input.releaseCount)),
    releaseRatios: RELEASE_RATIOS,
    beatInitial: input.beatInitial,
    beatRegen,
    beatTotal: input.beatInitial + beatRegen,
    beatCap: BEAT_CAP,
    note: `重拍收入 ${input.beatInitial}+${beatRegen.toFixed(0)} ≈ 地雷撞#2/#3 双击 ${input.minePairs} 套（每套100点）；颤音每层异放比例+25%，层数/次数按滑块近似（异常逐事件系统 pending）。`,
  }
}

function applyNangongPanel({ panel, cinemaLevel, settings }: AgentPanelInput): void {
  const coverage = clampRatio(settings['nangong.coreBuffCoverage'] ?? 1)
  panel.anomalyProficiency = (panel.anomalyProficiency ?? 0) + MASTERY_BONUS + (cinemaLevel >= 4 ? C4_MASTERY_BONUS : 0)
  panel.impact = (panel.impact ?? 0) + Math.max(0, (panel.anomalyMastery ?? 0) - CONTROL_THRESHOLD)
  // 核心被动命中增益（30s 刷新）：自身积蓄效率 / 自身失衡值（C6 追加 +50）
  panel.anomalyBuildUpEfficiency = (panel.anomalyBuildUpEfficiency ?? 0) + CORE_EFFICIENCY_BONUS * coverage
  panel.stunBuildUpBonus = (panel.stunBuildUpBonus ?? 0) + (CORE_BUILD_UP_BONUS + (cinemaLevel >= 6 ? C6_BUILD_UP_BONUS : 0)) * coverage
  // C1：强特/地雷撞命中 → 敌全属性伤害抗性 -18%（40s 刷新 ≈ 常驻）
  if (cinemaLevel >= 1) panel.enemyResReduction = (panel.enemyResReduction ?? 0) + C1_ALL_RES_REDUCTION
}

function buildNangongCharConfig({ skills, cinemaLevel, cfg }: AgentCharConfigInput): void {
  const t2 = findMoveById(skills, MINE2_MOVE_ID)?.actionTime ?? 0
  const t3 = findMoveById(skills, MINE3_MOVE_ID)?.actionTime ?? 0
  const record = cfg as unknown as Record<string, unknown>
  record.nangongCinemaLevel = cinemaLevel
  record.nangongMinePairSeconds = t2 + t3
}

function buildNangongTeamConfig(input: AgentTeamConfigInput): void {
  // converge 阶段把收敛的失衡次数写进自己槽位 cfg：
  // - nangongStunCount：颤音异放的窗口数上界
  // - freeExSpecialCount：天使队长「任意角色使敌人失衡 → 下一次强特免能」，用户口径简化为
  //   每次失衡白送一次E（不区分轴内首次/15s CD），轴/非轴通用直接加总E数
  const own = input.characters[input.slot] as unknown as Record<string, unknown> | undefined
  if (own && input.phase === 'converge') {
    const stuns = Math.max(0, Math.floor(input.stunCount))
    own.nangongStunCount = stuns
    own.freeExSpecialCount = stuns
  }
}

/** 重拍账本 → 地雷撞 #2/#3 双击套数（时间从平A池划拨，真实 moveId 行进失衡/伤害池） */
export function computeNangongMinePairs(totalBeat: number, allocTime: number, pairSeconds: number): number {
  if (pairSeconds <= 0) return 0
  return Math.max(0, Math.min(Math.floor(Math.max(0, totalBeat) / MINE_COST_PER_PAIR), Math.floor(Math.max(0, allocTime) / pairSeconds)))
}

export function nangongBeatIncome(cinemaLevel: number, frontlineSeconds: number, battleTime: number): number {
  const beatInitial = cinemaLevel >= 1 ? BEAT_CAP : BEAT_INITIAL
  return beatInitial + Math.max(0, frontlineSeconds) * BEAT_PER_SEC + Math.floor(Math.max(0, battleTime) / ANOMALY_PROC_CD) * BEAT_PER_ANOMALY
}

function buildNangongExecutions({ cfg, state, executions }: AgentResourceInput): void {
  const record = cfg as unknown as Record<string, unknown>
  const cinemaLevel = Math.max(0, Math.floor(Number(record.nangongCinemaLevel ?? 0)))
  const pairSeconds = Number(record.nangongMinePairSeconds ?? 0)
  const basicExec = executions.find(e => e.moveId === 'basic_attack')
  if (!basicExec || pairSeconds <= 0) return
  const battleTime = Math.max(0, Number(record.battleTime ?? 180))
  const totalBeat = nangongBeatIncome(cinemaLevel, Number(state.frontlineTime ?? 0), battleTime)
  const pairs = computeNangongMinePairs(totalBeat, Number(basicExec.totalTime ?? 0), pairSeconds)
  if (pairs <= 0) return
  record.nangongMinePairs = pairs
  record.nangongBeatTotal = totalBeat
  basicExec.totalTime = Math.max(0, Number(basicExec.totalTime ?? 0) - pairs * pairSeconds)
  const halfSeconds = pairSeconds / 2
  executions.push({
    moveId: MINE2_MOVE_ID,
    moveName: '普通攻击：可爱地雷飞天撞 #2',
    category: 'basic',
    count: pairs,
    actionTime: halfSeconds,
    comboAlignRatio: 0,
    totalTime: halfSeconds * pairs,
    totalComboAlignTime: 0,
    energyConsume: 0,
    totalEnergyConsume: 0,
    decibelRecovery: 0,
    totalDecibelRecovery: 0,
    energyRecovery: 0,
    totalEnergyRecovery: 0,
    stunBuildUpBonus: PRECISE_DAZE_BONUS,
    skillTableNote: `地雷撞 #2 ×${pairs}（重拍 ${totalBeat.toFixed(0)} 点 → ${pairs} 套双击；跳段必精准蓄力 失衡值+${PRECISE_DAZE_BONUS}%）`,
  })
  executions.push({
    moveId: MINE3_MOVE_ID,
    moveName: '普通攻击：可爱地雷飞天撞 #3',
    category: 'basic',
    count: pairs,
    actionTime: halfSeconds,
    comboAlignRatio: 0,
    totalTime: halfSeconds * pairs,
    totalComboAlignTime: 0,
    energyConsume: 0,
    totalEnergyConsume: 0,
    decibelRecovery: 0,
    totalDecibelRecovery: 0,
    energyRecovery: 0,
    totalEnergyRecovery: 0,
    stunBuildUpBonus: PRECISE_DAZE_BONUS,
    skillTableNote: `地雷撞 #3 ×${pairs}（踉跄载体：失衡易伤倍率+30%/持续+3s 走 teamBuffs）`,
  })
}

/** C4：地雷撞命中积蓄值 ×1.35（transform 在 enrich 回填之后跑，直接放大不被倍率表覆盖） */
function transformNangongSkillExecutions({ charResult, cinemaLevel }: AgentSkillTransformInput): void {
  if (cinemaLevel < 4) return
  for (const exec of charResult.executions ?? []) {
    if (exec.moveId !== MINE2_MOVE_ID && exec.moveId !== MINE3_MOVE_ID) continue
    if ((exec.anomalyBuildUp ?? 0) > 0) exec.anomalyBuildUp = Number(exec.anomalyBuildUp) * 1.35
    if ((exec.totalAnomalyBuildUp ?? 0) > 0) exec.totalAnomalyBuildUp = Number(exec.totalAnomalyBuildUp) * 1.35
  }
}

function buildNangongAnomalyEvents({ cfg, state, events }: AgentEventInput): void {
  const record = cfg as unknown as Record<string, unknown>
  const cinemaLevel = Math.max(0, Math.floor(Number(record.nangongCinemaLevel ?? 0)))
  const stunCount = Math.max(0, Math.floor(Number(record.nangongStunCount ?? 0)))
  // 颤音层数：滑块 >0 = 手动覆盖；0 = 自动 = 满层 4（用户口径 2026-08：失衡中全队
  // 异放/紊乱/进异常频密，达到 4 层很容易，每次失衡都按满层颤音）
  const sliderStacks = Math.floor(setting(cfg, 'nangong.vibratoStacksPerRelease', 0))
  const stacks = sliderStacks > 0 ? Math.min(VIBRATO_MAX, sliderStacks) : VIBRATO_MAX
  // C2：每层[颤音]使[核心被动]异放比例额外 +10%（25% → 35%/层）
  const stackPct = VIBRATO_STACK_PCT + (cinemaLevel >= 2 ? 10 : 0)
  const coverage = clampRatio(setting(cfg, 'nangong.releaseCoverage', 1))
  const releaseCount = Math.round(stunCount * coverage)
  if (releaseCount > 0 && stacks > 0) {
    // 固定倍率表达：450% × 层数系数（满层4 = 900%；C2 满层 = 1080%）
    const flat = Math.round(RELEASE_FLAT_MULTIPLIER * (1 + (stackPct / 100) * stacks))
    events.push({
      eventId: 'nangong_vibrato_release',
      eventName: '南宫羽·颤音异放',
      eventType: 'release',
      element: 'dominant',
      carrierMoveName: '核心被动：天才偶像（颤音清除）',
      count: releaseCount,
      formula: `releaseMultiplier = ${flat}（DOT基准×比例≈450%统一倍率 × 层数系数(1+${stackPct}%×${stacks})）`,
      fields: ['RELEASE_RATIOS', `vibratoStacks=${stacks}`, `releaseMultiplier=${flat}`],
      note: `失衡窗口清除颤音结算 ≈ 失衡次数×覆盖 = ${releaseCount} 次；层数=${stacks}${sliderStacks > 0 ? '（手动）' : '（自动=满层4）'}；次数按目标异常覆盖分配元素。`,
    })
  }
  // 极性紊乱（用户口径 2026-08：文本明确——每次失衡入场获 2 层舞力全开，强特/地雷撞/快速支援
  // 重击命中异常+失衡敌消耗 1 层触发一次极性紊乱，2 层必在失衡内消耗完；C2 连携重击路径独立，
  // 每失衡期间一次）：极性紊乱次数 = 失衡次数 × (2 + C2?1)
  if (stunCount > 0 && cinemaLevel >= 2) {
    const polarPerWindow = 2 + 1 // 舞力全开 2 层 + C2 连携 1 次
    events.push({
      eventId: 'nangong_polar_disorder',
      eventName: '南宫羽·极性紊乱',
      eventType: 'polar_disorder',
      element: 'dominant',
      carrierMoveName: '强特/地雷撞/快速支援重击（舞力全开）+ 连携重击（影画2）',
      count: stunCount * polarPerWindow,
      formula: 'polarDisorderDamage = 原紊乱伤害 × 25%（不清除异常状态）',
      fields: ['danceFullStacks=2/window', 'cinema2Chain=1/window', 'disorder.avgDamage×0.25'],
      note: `每次失衡 2 层舞力全开必消耗完${cinemaLevel >= 2 ? ' + C2 连携 1 次' : ''} = 每窗 ${polarPerWindow} 次 × ${stunCount} 窗。`,
    } as never)
  }
  // C6 颤音:改：非失衡期叠层（强特/地雷撞重击 +1、终结技重击 +2，上限4），进入失衡清除结算
  // 异放（固定倍率 500%，每层+25%）——回复端按执行计数器近似（用户指令：需要计数器做回复端）
  if (cinemaLevel >= 6 && stunCount > 0) {
    const gained = Math.max(0, Math.floor(Number(state.exSpecialCount ?? 0)))
      + Math.max(0, Math.floor(Number(record.nangongMinePairs ?? 0))) * 2
      + Math.max(0, Math.floor(Number(state.ultimateCount ?? 0))) * 2
    const stacks6 = Math.min(VIBRATO_MAX, Math.floor(gained / Math.max(1, stunCount)))
    if (stacks6 > 0) {
      const flat6 = Math.round(PRIME_RELEASE_FLAT_MULTIPLIER * (1 + (VIBRATO_STACK_PCT / 100) * stacks6))
      events.push({
        eventId: 'nangong_vibrato_prime_release',
        eventName: '南宫羽·颤音:改异放（影画6）',
        eventType: 'release',
        element: 'dominant',
        carrierMoveName: '影画6（进失衡清除颤音:改）',
        count: stunCount,
        formula: `releaseMultiplier = ${flat6}（500%统一倍率 × 层数系数(1+25%×${stacks6})）`,
        fields: [`primeStacks=${stacks6}`, `gained=${gained}`, `releaseMultiplier=${flat6}`],
        note: `非失衡期获取计数 强特${Math.floor(Number(state.exSpecialCount ?? 0))} + 地雷撞段${Math.floor(Number(record.nangongMinePairs ?? 0)) * 2} + 终结×2 ${Math.floor(Number(state.ultimateCount ?? 0)) * 2} = ${gained}，均摊每窗 ${stacks6} 层。`,
      } as never)
    }
  }
}

function buildNangongResourceResult({ cfg, state }: AgentResourceResultInput): Partial<CharacterResourceResult> {
  const record = cfg as unknown as Record<string, unknown>
  const cinemaLevel = Math.max(0, Math.floor(Number(record.nangongCinemaLevel ?? 0)))
  const battleTime = Math.max(0, Number(record.battleTime ?? 180))
  const frontline = Math.max(0, Number(state.frontlineTime ?? 0))
  const beatInitial = cinemaLevel >= 1 ? BEAT_CAP : BEAT_INITIAL
  const totalBeat = nangongBeatIncome(cinemaLevel, frontline, battleTime)
  const sliderStacks = Math.floor(setting(cfg, 'nangong.vibratoStacksPerRelease', 0))
  const stacks = sliderStacks > 0 ? Math.min(VIBRATO_MAX, sliderStacks) : VIBRATO_MAX
  const releaseCoverage = clampRatio(setting(cfg, 'nangong.releaseCoverage', 1))
  const stunCount = Math.max(0, Math.floor(Number(record.nangongStunCount ?? 0)))
  const source = computeNangongMechanic({
    anomalyMastery: cfg.panel.anomalyMastery ?? 0,
    frontlineSeconds: frontline,
    battleTime,
    beatInitial,
    minePairs: Math.floor(totalBeat / MINE_COST_PER_PAIR),
    vibratoStacks: stacks,
    releaseCount: Math.round(stunCount * releaseCoverage),
  })
  return { nangongMechanicSource: source }
}

function buildNangongResourceSections({ result }: AgentResourceSectionsInput) {
  const source = result.nangongMechanicSource
  if (!source) return []
  return [
    {
      id: 'nangong-beat',
      title: '南宫羽重拍',
      summary: `收入 ${fmt(source.beatTotal)} 点 → 地雷撞双击 ≈${Math.floor(source.beatTotal / MINE_COST_PER_PAIR)} 套`,
      rows: [
        { label: '进场', value: `+${source.beatInitial}`, detail: source.beatInitial >= BEAT_CAP ? '影画1 入场回满' : '上限 100' },
        { label: '接战回复', value: `+${fmt(source.beatRegen)}`, detail: `每秒 ${BEAT_PER_SEC} × 接战时长 + 队友异常 ${BEAT_PER_ANOMALY}/${ANOMALY_PROC_CD}s` },
        { label: '消耗', value: `${MINE_COST_PER_PAIR}/套`, detail: '#2/#3 各耗 50；强特/终结/连携后跳段直发双击' },
      ],
      footer: source.note,
    },
    {
      id: 'nangong-vibrato',
      title: '南宫羽颤音·异放',
      summary: `${source.releaseCount} 次 × ${source.vibratoStacks} 层`,
      rows: [
        { label: '属性比例', value: Object.entries(source.releaseRatios).map(([k, v]) => `${k} ${v}%`).join(' / ') },
        { label: '每层加成', value: `+${VIBRATO_STACK_PCT}%`, detail: `当前按 ${source.vibratoStacks} 层近似（滑块可调 0-4）` },
        { label: '结算次数', value: `${source.releaseCount}`, detail: '≈ 失衡次数 × 清除时有异常覆盖（滑块）' },
      ],
      footer: '失衡中全队异放/紊乱/进异常各 +1 层（≤4），清除时若目标处于属性异常状态则结算一次异放；逐事件建模 pending。',
    },
  ]
}

const settings: MechanicSetting[] = [
  {
    id: 'nangong.coreBuffCoverage',
    label: '南宫羽·核心被动命中覆盖率',
    description: '地雷撞/强特命中触发的三增益（自身积蓄效率+35%/失衡值+20%/全队伤害+25%）整局覆盖率；30s 刷新实战近常驻，默认 100%。',
    default: 1,
    min: 0,
    max: 1,
    step: 0.05,
    suffix: '%',
  },
  {
    id: 'nangong.vibratoStacksPerRelease',
    label: '南宫羽·颤音层数（每次异放）',
    description: '颤音清除时的层数（0-4），决定异放比例加成（每层+25%）；0=自动=满层 4（叠满很容易，每次失衡都按满层）。',
    default: 0,
    min: 0,
    max: 4,
    step: 1,
    suffix: '层',
  },
  {
    id: 'nangong.releaseCoverage',
    label: '南宫羽·颤音异放覆盖率',
    description: '失衡窗口中「颤音被清除且目标处于属性异常」的比例；异常队近 100%，纯直伤队调低。',
    default: 1,
    min: 0,
    max: 1,
    step: 0.05,
    suffix: '%',
  },
]

export const nangongMechanic: AgentMechanicModule = {
  id: 'agent:nangong',
  agentIds: [NANGONG_AGENT_ID],
  name: '南宫羽',
  description: '重拍/地雷撞双击/颤音异放：重拍买地雷撞#2#3跳段双击（必精准蓄力），失衡中颤音叠层清除时按原异常伤害比例结算异放；精通+120、掌控>110转冲击。',
  applyPanel: applyNangongPanel,
  buildCharConfig: buildNangongCharConfig,
  applyTeamConfig: buildNangongTeamConfig,
  buildExecutions: buildNangongExecutions,
  transformSkillExecutions: transformNangongSkillExecutions,
  buildAnomalyEvents: buildNangongAnomalyEvents,
  buildResourceResult: buildNangongResourceResult,
  resourceSections: buildNangongResourceSections,
  settings,
}
