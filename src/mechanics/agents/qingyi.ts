import type {
  AgentCharConfigInput,
  AgentMechanicModule,
  AgentPanelInput,
  AgentResourceInput,
  AgentResourceResultInput,
  AgentResourceSectionsInput,
} from '../types'
import type { AgentSkills, SkillMove } from '@/types/catalog'
import type { CharacterResourceResult, QingyiMechanicSource } from '@/types/resource'
import { fmt } from '@/utils/format'

const QINGYI_AGENT_ID = '1251'

// 普通攻击：醉花月云转（一轮 = #1 突进 + #2 终结一击）
const ZUIHUA_MOVE_1 = '1251008'
const ZUIHUA_MOVE_2 = '1251009'
// 普通攻击：一煞 #4（1251004）——补电压专用快段：3.3334 电压/击 × 0.133s/击 ≈ 25 电压/秒，
// 30 击 ≈ 4 秒积满一轮（用户口径 2026-08：只打 #4，电压好了接醉花，秒均电压全表最高；
// 曾误用 #5 慢挥 3.23/0.97s ≈ 3.3 电压/秒 × 31 击 ≈ 30s/轮，导致"一煞上百秒"）
const YISHA4_MOVE_ID = '1251004'

// 闪络电压常量（点，100 点 = 100% = 1 轮醉花）
const VOLTAGE_PER_ROUND = 100
const ROUNDS_PER_STUN = 2
const VOLTAGE_PER_STUN = ROUNDS_PER_STUN * VOLTAGE_PER_ROUND // 200
// 醉花月云转：固定 100% 电压释放 → 超出 75% 部分 = 25%，每 1% → 伤害 +1% / 失衡 +0.5%
const ZUIHUA_DMG_BONUS_PCT = 25
const ZUIHUA_DAZE_BONUS_PCT = 12.5
// 影画1·介电击穿：入场闪络电压回复至上限（100 点）
const C1_START_VOLTAGE = 100
// 影画1·介电击穿：后继累积效率 +30%（电压获取 ×1.3，含平A/通用招式攒电压）
const C1_VOLTAGE_EFFICIENCY = 1.3
// 影画2·四两拨千斤：羁服叠满才生效的失衡+15%，默认覆盖率 50%
const C2_STUN_BONUS = 15
const C2_STUN_COVERAGE = 0.5
// 影画4·稳态电弧屏障：护盾刷新回 5 能量，10 秒冷却
const C4_ENERGY_PER_TRIGGER = 5
const C4_TRIGGER_INTERVAL = 10

function findMoveById(skills: AgentSkills | undefined, moveId: string): SkillMove | null {
  if (!skills) return null
  for (const cat of skills.categories) {
    const move = cat.moves.find(m => m.id === moveId)
    if (move) return move
  }
  return null
}

function rowValue(move: SkillMove | null, rowId: string): number {
  if (!move) return 0
  const row = move.rows.find(r => r.id === rowId)
  return row?.values?.[0] ?? 0
}

/** 求和某类招式的 attack_data（电压回复量）。 */
function sumVoltage(moves: SkillMove[]): number {
  let total = 0
  for (const m of moves) total += rowValue(m, 'attack_data_0')
  return total
}

interface LoopRates {
  /** 一煞#4 单击电压（受 1命效率 ×1.3） */
  yisha4Voltage: number
  /** 一煞#4 单击动作时间 */
  yisha4ActionTime: number
  /** 攒满一轮 100 电压需要的击数 */
  hitsPerRound: number
  yisha4TimePerRound: number
  zuiHuaTimePerRound: number
  dmgPerSec: number
  dazePerSec: number
  anomalyPerSec: number
}

/** 可分配循环：一煞#4 连打攒满 100 电压（≈4s）→ 醉花月云转 #1+#2（电压受 1命效率 ×1.3 影响）。 */
function computeLoopRates(skills: AgentSkills | undefined, cinemaLevel: number): LoopRates {
  const yisha4 = findMoveById(skills, YISHA4_MOVE_ID)
  const z1 = findMoveById(skills, ZUIHUA_MOVE_1)
  const z2 = findMoveById(skills, ZUIHUA_MOVE_2)
  const efficiency = cinemaLevel >= 1 ? C1_VOLTAGE_EFFICIENCY : 1
  const yisha4Voltage = rowValue(yisha4, 'attack_data_0') * efficiency
  const yisha4At = yisha4?.actionTime ?? 0
  const z1At = z1?.actionTime ?? 0
  const z2At = z2?.actionTime ?? 0

  const safeVoltage = yisha4Voltage > 0 ? yisha4Voltage : 1
  const hits = VOLTAGE_PER_ROUND / safeVoltage
  const yisha4Time = hits * yisha4At
  const zuiHuaTime = z1At + z2At
  const cycleTime = yisha4Time + zuiHuaTime

  const dmg = hits * rowValue(yisha4, 'damage')
    + rowValue(z1, 'damage') * (1 + ZUIHUA_DMG_BONUS_PCT / 100)
    + rowValue(z2, 'damage') * (1 + ZUIHUA_DMG_BONUS_PCT / 100)
  const daze = hits * rowValue(yisha4, 'daze')
    + rowValue(z1, 'daze') * (1 + ZUIHUA_DAZE_BONUS_PCT / 100)
    + rowValue(z2, 'daze') * (1 + ZUIHUA_DAZE_BONUS_PCT / 100)
  const anomaly = hits * rowValue(yisha4, 'anomaly_buildup')
    + rowValue(z1, 'anomaly_buildup')
    + rowValue(z2, 'anomaly_buildup')

  return {
    yisha4Voltage,
    yisha4ActionTime: yisha4At,
    hitsPerRound: hits,
    yisha4TimePerRound: yisha4Time,
    zuiHuaTimePerRound: zuiHuaTime,
    dmgPerSec: cycleTime > 0 ? dmg / cycleTime : 0,
    dazePerSec: cycleTime > 0 ? daze / cycleTime : 0,
    anomalyPerSec: cycleTime > 0 ? anomaly / cycleTime : 0,
  }
}

function applyQingyiPanel({ panel, cinemaLevel }: AgentPanelInput): void {
  if (!panel) return
  // 核心被动·千秋岁 + 连携技·太平令：目标每层羁服使连携技伤害 +3%（羁服满层 20 层 = +60%）
  panel.skillDmgBonus__chain = (panel.skillDmgBonus__chain ?? 0) + 60
  // 额外能力·阳关三叠（声明式 spec.additionalAbility 判定写入 panel.additionalAbilityActive）
  if ((panel.additionalAbilityActive ?? 0) > 0) {
    // 普通攻击失衡值 +20%（只作用于 basic，含一煞与醉花月云转，两者 skillType 均为 basic）
    panel.stunBuildUpBonus__basic = (panel.stunBuildUpBonus__basic ?? 0) + 20
    // 冲击力 >120 每超 1 点攻击 +6，最多 +600
    const impact = panel.impact ?? 0
    const over = Math.max(0, impact - 120)
    const atkGain = Math.min(600, over * 6)
    if (atkGain > 0) panel.atk = (panel.atk ?? 0) + atkGain
  }
  // 影画2·四两拨千斤：羁服叠满时自身对目标失衡值 +15%（需叠满才生效，默认覆盖率 50%）
  if ((cinemaLevel ?? 0) >= 2) {
    panel.stunBuildUpBonus = (panel.stunBuildUpBonus ?? 0) + C2_STUN_BONUS * C2_STUN_COVERAGE
  }
}

function buildQingyiCharConfig({ cinemaLevel, skills, cfg }: AgentCharConfigInput): void {
  const z1 = findMoveById(skills, ZUIHUA_MOVE_1)
  const z2 = findMoveById(skills, ZUIHUA_MOVE_2)
  const yisha4 = findMoveById(skills, YISHA4_MOVE_ID)

  cfg.qingyiCinemaLevel = cinemaLevel
  cfg.qingyiLoopRates = computeLoopRates(skills, cinemaLevel)
  // 影画4·稳态电弧屏障：护盾刷新回能 5/10s（能量影响强特次数等，需接入）
  cfg.qingyiC4EnergyPerTrigger = cinemaLevel >= 4 ? C4_ENERGY_PER_TRIGGER : 0
  cfg.qingyiC4TriggerInterval = C4_TRIGGER_INTERVAL
  cfg.qingyiZuiHuaMove1 = {
    id: ZUIHUA_MOVE_1,
    damage: rowValue(z1, 'damage') * (1 + ZUIHUA_DMG_BONUS_PCT / 100),
    daze: rowValue(z1, 'daze') * (1 + ZUIHUA_DAZE_BONUS_PCT / 100),
    anomaly: rowValue(z1, 'anomaly_buildup'),
    actionTime: z1?.actionTime ?? 0,
    decibel: rowValue(z1, 'decibel_recovery'),
    energy: rowValue(z1, 'energy_recovery'),
  }
  cfg.qingyiZuiHuaMove2 = {
    id: ZUIHUA_MOVE_2,
    damage: rowValue(z2, 'damage') * (1 + ZUIHUA_DMG_BONUS_PCT / 100),
    daze: rowValue(z2, 'daze') * (1 + ZUIHUA_DAZE_BONUS_PCT / 100),
    anomaly: rowValue(z2, 'anomaly_buildup'),
    actionTime: z2?.actionTime ?? 0,
    decibel: rowValue(z2, 'decibel_recovery'),
    energy: rowValue(z2, 'energy_recovery'),
  }
  cfg.qingyiYisha4 = {
    id: YISHA4_MOVE_ID,
    damage: rowValue(yisha4, 'damage'),
    daze: rowValue(yisha4, 'daze'),
    anomaly: rowValue(yisha4, 'anomaly_buildup'),
    actionTime: yisha4?.actionTime ?? 0,
    decibel: rowValue(yisha4, 'decibel_recovery'),
    energy: rowValue(yisha4, 'energy_recovery'),
  }

  // 通用招式电压回复量（attack_data）
  const special = skills?.categories.find(c => c.id === 'special')
  const exMoves = (special?.moves ?? []).filter(m => (m.name?.en ?? '').toLowerCase().includes('ex special'))
  cfg.qingyiExSpecialVoltage = sumVoltage(exMoves)
  const chain = skills?.categories.find(c => c.id === 'chain')
  cfg.qingyiUltimateVoltage = sumVoltage((chain?.moves ?? []).filter(m => (m.name?.en ?? '').toLowerCase().includes('ultimate')))
  cfg.qingyiChainVoltage = sumVoltage((chain?.moves ?? []).filter(m => (m.name?.en ?? '').toLowerCase().includes('chain attack')))
  const dodge = skills?.categories.find(c => c.id === 'dodge')
  cfg.qingyiDodgeCounterVoltage = sumVoltage((dodge?.moves ?? []).filter(m => (m.name?.en ?? '').toLowerCase().includes('dodge counter')))
  const assist = skills?.categories.find(c => c.id === 'assist')
  cfg.qingyiQuickAssistVoltage = sumVoltage((assist?.moves ?? []).filter(m => (m.name?.en ?? '').toLowerCase().includes('quick assist')))
  cfg.qingyiAssistFollowUpVoltage = sumVoltage((assist?.moves ?? []).filter(m => (m.name?.en ?? '').toLowerCase().includes('assist follow-up')))
}

export function computeQingyiSource(cfg: Record<string, unknown>, state: { exSpecialCount: number; ultimateCount: number; chainCountTotal: number }): QingyiMechanicSource {
  const stunCount = Math.max(0, Math.floor(Number(cfg.qingyiStunCount ?? 0)))
  const cinemaLevel = Math.max(0, Math.floor(Number(cfg.qingyiCinemaLevel ?? 0)))
  const loop = cfg.qingyiLoopRates as LoopRates | undefined
  const yisha4Voltage = loop?.yisha4Voltage ?? 0
  const battleTime = Math.max(0, Number(cfg.battleTime ?? 180))

  const roundsTarget = ROUNDS_PER_STUN * stunCount
  const totalNeeded = VOLTAGE_PER_STUN * stunCount
  const c1Start = cinemaLevel >= 1 ? C1_START_VOLTAGE : 0
  // 1命·后继累积效率 +30%：通用招式电压也 ×1.3
  const efficiency = cinemaLevel >= 1 ? C1_VOLTAGE_EFFICIENCY : 1
  const genericVoltage =
    (Math.max(0, Math.floor(state.exSpecialCount)) * Number(cfg.qingyiExSpecialVoltage ?? 0)
    + Math.max(0, Math.floor(state.ultimateCount)) * Number(cfg.qingyiUltimateVoltage ?? 0)
    + Math.max(0, Math.floor(state.chainCountTotal)) * Number(cfg.qingyiChainVoltage ?? 0)
    + Math.max(0, Number(cfg.dodgeCounterCount ?? 0)) * Number(cfg.qingyiDodgeCounterVoltage ?? 0)
    + Math.max(0, Number(cfg.quickAssistCount ?? 0)) * Number(cfg.qingyiQuickAssistVoltage ?? 0)
    + Math.max(0, Number(cfg.parryCount ?? 0)) * Number(cfg.qingyiAssistFollowUpVoltage ?? 0)) * efficiency

  // 时间预算（用户口径 2026-08：4 失衡 8 轮醉花，一煞#4 补电压不能无限打）：
  // 通用电压覆盖的轮只花醉花时间；超出部分每轮 = 一煞#4 攒满 100 电压 + 醉花，按整轮时间计。
  // 预算 = 战斗时间 − 通用招式必要时间（强特/大招/连携/闪反/弹刀，那些行引擎另行计时）。
  // 总轮数 = min(2×失衡, 电压可达轮数 + 时间可行的补电压轮数)，自激回路（失衡↑→轮数↑→一煞#4
  // 失衡值↑→失衡↑，曾收敛到 13-15 次失衡/445 次一煞#4/必要时间 518s）就此截断。
  // 通用必要时间：优先用 buildExecutions 实测的通用行总时间（构造保证 通用+循环 ≤ 战斗时间）；
  // 公式估算仅作 resourceResult/sections 展示兜底（无 executions 上下文）。
  const genericNecessaryTime =
    Math.max(0, Math.floor(state.exSpecialCount)) * Number(cfg.exSpecialActionTime ?? 0)
    + Math.max(0, Math.floor(state.ultimateCount)) * Number(cfg.ultimateActionTime ?? 0)
    + Math.max(0, Math.floor(state.chainCountTotal)) * Number(cfg.chainActionTime ?? 0)
    + Math.max(0, Number(cfg.dodgeCounterCount ?? 0)) * Number(cfg.dodgeCounterActionTime ?? 0)
    + Math.max(0, Number(cfg.parryCount ?? 0)) * Number(cfg.assistFollowUpActionTime ?? 0)
  const genericRowsTime = Math.max(0, Number(cfg.qingyiGenericRowsTime ?? 0))
  const effectiveGenericTime = Math.max(genericNecessaryTime, genericRowsTime)
  const roundsFromGeneric = Math.floor((c1Start + genericVoltage) / VOLTAGE_PER_ROUND)
  const zuiHuaAt = loop?.zuiHuaTimePerRound ?? 0
  const fullRoundAt = (loop?.yisha4TimePerRound ?? 0) + zuiHuaAt
  const budgetRounds = Math.min(roundsTarget, roundsFromGeneric)
  const extraBudget = Math.max(0, battleTime - effectiveGenericTime - budgetRounds * zuiHuaAt)
  const extraFeasible = fullRoundAt > 0 ? Math.floor(extraBudget / fullRoundAt) : 0
  const extraWanted = Math.max(0, roundsTarget - roundsFromGeneric)
  const rounds = Math.max(0, budgetRounds + Math.min(extraWanted, extraFeasible))

  // 一煞#4 连打补电压（3.3334 电压/击 × 0.133s/击 ≈ 25 电压/秒，一轮 30 击 ≈ 4s；
  // 大招 80/连携 25/闪反 16/强特 22.5 已在通用电压）
  const remaining = rounds * VOLTAGE_PER_ROUND - c1Start - genericVoltage
  const yisha4Hits = yisha4Voltage > 0 ? Math.max(0, Math.ceil(remaining / yisha4Voltage)) : 0
  const yisha4Time = yisha4Hits * (loop?.yisha4ActionTime ?? 0)
  const zuiHuaTime = rounds * zuiHuaAt
  const necessaryTime = yisha4Time + zuiHuaTime

  return {
    stunCount,
    rounds,
    totalVoltageNeeded: totalNeeded,
    c1StartVoltage: c1Start,
    genericVoltage,
    remainingVoltage: Math.max(0, remaining),
    yisha4Hits,
    yisha4NecessaryTime: yisha4Time,
    zuiHuaTime,
    necessaryTime,
    note:
      '每失衡打 2 轮醉花月云转（1 轮 = 100% 电压）；总电压 200×失衡 − 1命开局 − 通用招式电压，剩余由一煞#4 补齐；' +
      '轮数受时间预算约束（通用电压轮只花醉花时间、补电压轮按整轮计，总时间 ≤ 战斗时间），电压/时间不足则少打——防失衡次数自激。',
  }
}

function buildQingyiExecutions({ cfg, state, executions }: AgentResourceInput): void {
  // 实测通用行总时间（强特/大招/连携/闪反/弹刀/快支等已生成行），供电压计划预算扣减
  const genericRowsTime = executions
    .filter(e => e.moveId !== 'basic_attack')
    .reduce((s, e) => s + (e.totalTime ?? 0), 0)
  ;(cfg as unknown as Record<string, unknown>).qingyiGenericRowsTime = genericRowsTime
  const source = computeQingyiSource(cfg as unknown as Record<string, unknown>, state)
  const loop = cfg.qingyiLoopRates
  const cinemaLevel = Math.max(0, Math.floor(cfg.qingyiCinemaLevel ?? 0))

  // 可分配时间：剩余平A时间按「一煞#4→醉花」循环拆成整轮数 + 余量
  const basicExec = executions.find(e => e.moveId === 'basic_attack')
  const cycleTime = (loop?.yisha4TimePerRound ?? 0) + (loop?.zuiHuaTimePerRound ?? 0)
  let allocCycles = 0
  let allocYisha4Hits = 0
  if (basicExec && loop && cycleTime > 0) {
    const allocTime = Math.max(0, basicExec.totalTime - source.necessaryTime)
    allocCycles = Math.floor(allocTime / cycleTime)
    const remainderTime = allocTime - allocCycles * cycleTime
    const remainderHits = loop.yisha4ActionTime > 0 ? Math.floor(remainderTime / loop.yisha4ActionTime) : 0
    allocYisha4Hits = Math.round(allocCycles * loop.hitsPerRound + remainderHits)
    // 平A时间全部折算成显式招式，basic_attack 汇总行清零
    basicExec.totalTime = 0
    basicExec.totalDecibelRecovery = 0
    basicExec.totalEnergyRecovery = 0
  }

  const totalRounds = source.rounds + allocCycles
  const totalYisha4Hits = source.yisha4Hits + allocYisha4Hits

  // 醉花月云转：单独结算（不跟一煞平均），固定 +25% 伤害 / +12.5% 失衡；
  // 1命满电压→自身暴击率+20%；6命→醉花暴伤+100%
  if (totalRounds > 0) {
    const critRateBonus = cinemaLevel >= 1 ? 20 : 0
    const critDmgBonus = cinemaLevel >= 6 ? 100 : 0
    for (const z of [cfg.qingyiZuiHuaMove1, cfg.qingyiZuiHuaMove2]) {
      if (!z || z.actionTime <= 0) continue
      executions.push({
        moveId: z.id,
        moveName: z.id === ZUIHUA_MOVE_1 ? '普通攻击：醉花月云转 #1（突进）' : '普通攻击：醉花月云转 #2（终结一击）',
        category: 'basic',
        count: totalRounds,
        actionTime: z.actionTime,
        comboAlignRatio: 0,
        totalTime: totalRounds * z.actionTime,
        totalComboAlignTime: 0,
        energyConsume: 0,
        totalEnergyConsume: 0,
        decibelRecovery: z.decibel,
        totalDecibelRecovery: totalRounds * z.decibel,
        energyRecovery: z.energy,
        totalEnergyRecovery: totalRounds * z.energy,
        damageMultiplier: z.damage,
        damageMultiplierOverride: true,
        dazeMultiplier: z.daze,
        dazeMultiplierOverride: true,
        anomalyBuildUp: z.anomaly,
        totalAnomalyBuildUp: z.anomaly * totalRounds,
        critRateBonus,
        critDmgBonus,
        skillTableNote: `醉花月云转：100% 电压释放（伤害+25%/失衡+12.5%）${cinemaLevel >= 1 ? '·1命暴击率+20%' : ''}${cinemaLevel >= 6 ? '·6命暴伤+100%' : ''}`,
      })
    }
  }

  // 一煞#4 连打：补电压 + 可分配循环的一煞部分（1251004，3.3334 电压/击 × 0.133s ≈ 25 电压/秒）
  if (totalYisha4Hits > 0 && cfg.qingyiYisha4) {
    const y = cfg.qingyiYisha4 as { id: string; damage: number; daze: number; anomaly: number; actionTime: number; decibel: number; energy: number }
    executions.push({
      moveId: y.id,
      moveName: '普通攻击：一煞 #4（补电压）',
      category: 'basic',
      count: totalYisha4Hits,
      actionTime: y.actionTime,
      comboAlignRatio: 0,
      totalTime: totalYisha4Hits * y.actionTime,
      totalComboAlignTime: 0,
      energyConsume: 0,
      totalEnergyConsume: 0,
      decibelRecovery: y.decibel,
      totalDecibelRecovery: totalYisha4Hits * y.decibel,
      energyRecovery: y.energy,
      totalEnergyRecovery: totalYisha4Hits * y.energy,
      damageMultiplier: y.damage,
      damageMultiplierOverride: true,
      dazeMultiplier: y.daze,
      dazeMultiplierOverride: true,
      anomalyBuildUp: y.anomaly,
      totalAnomalyBuildUp: y.anomaly * totalYisha4Hits,
      skillTableNote: `一煞#4 共 ${totalYisha4Hits} 击（补电压 ${source.yisha4Hits} + 可分配循环 ${allocYisha4Hits}）；3.33 电压/击 × 0.133s ≈ 25 电压/秒`,
    })
  }
}

function buildQingyiResourceResult({ cfg, state }: AgentResourceResultInput): Partial<CharacterResourceResult> {
  return { qingyiMechanicSource: computeQingyiSource(cfg as unknown as Record<string, unknown>, state) }
}

function buildQingyiResourceSections({ result }: AgentResourceSectionsInput) {
  const src = result.qingyiMechanicSource
  if (!src) return []
  return [{
    id: 'qingyi-voltage',
    title: '青衣·闪络电压/醉花月云转',
    summary: `醉花 ${fmt(src.rounds)} 轮（${fmt(src.stunCount)} 失衡 × 2）· 必要 ${fmt(src.necessaryTime)}s`,
    rows: [
      { label: '总电压需求', value: `${fmt(src.totalVoltageNeeded)}`, detail: '200 × 失衡次数' },
      { label: '1命开局', value: `-${fmt(src.c1StartVoltage)}`, detail: '介电击穿：入场电压回满' },
      { label: '通用招式', value: `-${fmt(src.genericVoltage)}`, detail: '强特/大招/连携/闪反/快支/支援突击' },
      { label: '一煞#4 补电压', value: `${fmt(src.yisha4Hits)} 击`, detail: `电压缺口 ${fmt(src.remainingVoltage)}（一煞#4 ≈ 3.33 电压/击 × 0.133s ≈ 25 电压/秒；大招 80/连携 25/闪反 16/强特 22.5 已在通用电压）` },
    ],
    footer: '醉花月云转固定 +25% 伤害 / +12.5% 失衡；剩余平A时间按「一煞#4→醉花」循环秒均结算。',
  }]
}

export const qingyiMechanic: AgentMechanicModule = {
  id: 'agent:qingyi',
  agentIds: [QINGYI_AGENT_ID],
  name: '青衣',
  description: '闪络电压/醉花月云转/羁服满层：每失衡 2 轮醉花，电压大头来自大招/强特/连携（通用电压），缺口由一煞#4 连打（≈25 电压/秒）补齐，剩余平A按循环秒均。',
  applyPanel: applyQingyiPanel,
  buildCharConfig: buildQingyiCharConfig,
  buildExecutions: buildQingyiExecutions,
  buildResourceResult: buildQingyiResourceResult,
  resourceSections: buildQingyiResourceSections,
}
