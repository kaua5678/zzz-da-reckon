import type {
  AgentCharConfigInput,
  AgentMechanicModule,
  AgentPanelInput,
  AgentResourceInput,
  AgentResourceSectionsInput,
  AgentTeamConfigInput,
} from '../types'
import type { AnomalyEventExecution, SkillExecution } from '@/types/resource'
import type { AnomalySkillExecution } from '@/core/anomalyPool'
import { getAgentSpec } from '@/specs/registry'
import { specToMechanicModule } from '@/specs/mechanics'

/**
 * 格莉丝（1181）战斗逻辑（用户口供 2026-08-23）：
 * - 常规循环 = [A1+A2+A3 连段] → 特殊技 → [A4] → 特殊技，循环往复。
 *   连段时间：A1 0.171 + A2 0.33 + A3 0.682 = 1.183s ≈ 口供实测 1.1827s；A4 1.134s ≈ 口供 1.1335s。
 *   A 段就是她的平A：由通用 basic 池行表达（秒均伤害/积蓄），模块不重复发 A 行——
 *   否则「必要时间=平A池」会在内外层环形成 2-周期震荡（曾实测冻在 0 池）。
 *   A3/A4 命中把[电能]攒到 8 层上限，每发特殊技/强化特殊技消耗全部电能 →
 *   电属性异常积蓄值 +130%（Lv.7）——循环保证每一发都吃满。
 *   特殊技槽位 = 2 × floor(平A池 / 3.001s 循环预算)。
 * - 没能量就放普通特殊技、有能量就放强特：每循环 2 个特殊技槽，强特数 ≤ 引擎按能量收敛的次数，
 *   其余槽位填普通特殊技（免费）。
 * - 两发电能强化载体用非数字合成 id 显式携带全部字段（enrich 无积蓄 override 旗标，
 *   真实 moveId 会被倍率表覆盖；同猫又爪印/般岳恢复行模式），伤害/积蓄取表值 ×2.3。
 * - 额外能力·技术支持班组：[强化特殊技]命中 → 目标下次感电伤害 +18%/层 ×≤2 层。
 *   运行时「总强特次数/感电次数」比例无法在面板阶段表达（面板不随外层环重算），
 *   以层数滑杆 grace.shockStacks 表达（默认 2 = 满层；实战平均 ≈ min(2, 强特数/感电数)，可手动对齐）。
 *   施加区：格莉丝自身面板 anomalyDmgBonus（唯一异常即感电，dot/紊乱继承施加者面板）。
 * - 潜能觉醒·超频工程引擎（钢械交响曲 II-VI）：消耗电能获得电伤 +10/15/20/25/30%，永续。
 * - 大招脉冲资源/脉冲手雷（1181019/1181020）：待后续口供实现。
 */

const GRACE_AGENT_ID = '1181'
/** 动作时间取 catalog（A1+A2+A3 = 1.183s ≈ 口供实测 1.1827；A4 = 1.134 ≈ 口供 1.1335） */
const A1_TIME = 0.171
const A2_TIME = 0.33
const A3_TIME = 0.682
const A4_TIME = 1.134
/** A1-A4 每段能量回复（catalog energy_recovery，Lv.12；影画4 按段精确折算） */
const A1_ENERGY = 0.615
const A2_ENERGY = 1.189
const A3_ENERGY = 2.454
const A4_ENERGY = 4.081
/** A 段顺序 = A1,A2,A3(连段) → A4，每轮换各一次 */
const A_SEG_ENERGY = [A1_ENERGY, A2_ENERGY, A3_ENERGY, A4_ENERGY]
const A_CYCLE_ENERGY = A_SEG_ENERGY.reduce((a, b) => a + b, 0) // 8.339
const SP_MOVE_ID = '1181005'
const EX_MOVE_ID = '1181006'
const SP_TIME = 0.2
const EX_TIME = 0.342
/** 强特附带[涡流集束手雷]（电能满层额外投掷）：1181020 表值 175.5，at=0 */
const VORTEX_MOVE_ID = '1181020'
/** [脉冲]兑换附带[脉冲手雷]（8 层换一次额外投掷）：1181019 表值 84.9，at=0；附带异放事件 */
const PULSE_GRENADE_MOVE_ID = '1181019'
export const PULSE_PER_ULT = 25 // 终结技每次获得 25 层[脉冲]（用户口供）
export const PULSE_CAP = 25 // [脉冲]上限 25 层：多大都卡在 25，一次大招只能换 floor(25/8)=3 次
export const PULSE_PER_GRENADE = 8 // 8 层[脉冲] → 下次投掷手雷额外丢一枚脉冲手雷 + 异放事件
export const GRACE_BUILDUP_BONUS_PCT = 130 // 电属性异常积蓄 +130%：加算进积蓄效率区（非独立乘区）
export const GRACE_SPECIAL_MOVE_IDS = [SP_MOVE_ID, EX_MOVE_ID]
/** 影画1 再充能弹膛：一次 A4 命中给全队回复 2 点能量（用户口径 2026-08-27） */
export const GRACE_C1_TEAM_ENERGY_PER_CYCLE = 2
/** 影画4 爆破电容：能量获得效率 +20%（6 层充能覆盖 A4/冲刺消耗段） */
export const GRACE_C4_ENERGY_EFFICIENCY = 20
/** 影画6 起爆扳机：手雷伤害 +100%（进增伤区加算），并额外 +1 手雷（SP 1→2 / EX 2→3） */
export const GRACE_C6_GRENADE_DMG_BONUS = 100

const spec = getAgentSpec(GRACE_AGENT_ID)!
const base = specToMechanicModule(spec) // 垫层：catalog 派生 cfg 字段由它统一填充

/** 轮换计划：平A池能塞几组 [连段+特+A4+特]，能量决定其中几发放强特 */
export interface GraceRotationPlan {
  cycles: number
  exUsed: number
  normalUsed: number
}

export function planGraceRotation(basicPool: number, engineExCount: number): GraceRotationPlan {
  // 每循环 = [A1A2A3 连段 1.183s + A4 1.134s] + 2 特殊技槽；预算按最长强特变体取保守上界
  const cycleBound = A1_TIME + A2_TIME + A3_TIME + A4_TIME + 2 * EX_TIME
  const cycles = Math.max(0, Math.floor(Math.max(0, basicPool) / cycleBound))
  const slots = cycles * 2
  const exUsed = Math.min(Math.max(0, Math.floor(engineExCount)), slots)
  return { cycles, exUsed, normalUsed: slots - exUsed }
}

/** 特殊技前台时间（仅两发特殊技；A 段由通用 basic 池行表达，不计入必要时间） */
export function graceRotationSeconds(cycles: number, exUsed: number): number {
  const normalUsed = cycles * 2 - exUsed
  return exUsed * EX_TIME + normalUsed * SP_TIME
}

function buildGraceCharConfig(input: AgentCharConfigInput): void {
  base.buildCharConfig?.(input)
  const record = input.cfg as unknown as Record<string, unknown>
  record.skipGenericExSpecial = true // 特殊技由本模块按轮换生成（普通档免费填充/强特按能量）
  record.graceCinemaLevel = Math.max(0, Math.floor(Number(input.cinemaLevel ?? 0)))
}

/** 永续面板项：潜能电伤（C2-C6 = 10~30%）+ AA 感电强化层数 */
function applyGracePanel(input: AgentPanelInput): void {
  const { panel, cinemaLevel, settings } = input
  // 积蓄 +130% 不走面板（会波及终结/连携）：行级引擎字段 buildUpEfficiencyBonusPct 仅挂
  // 特殊技/强特两行（transform 钩子），进积蓄效率区与面板/元素效率加算（非独立乘区）
  if (cinemaLevel >= 2) {
    const bonus = [10, 15, 20, 25, 30][Math.min(cinemaLevel, 6) - 2]
    if (bonus != null) {
      // 潜能觉醒·超频工程引擎：消耗电能获得电伤提升——循环持续消耗 → 永续
      panel.electricDmg = (panel.electricDmg ?? 0) + bonus
    }
  }
  // 额外能力·技术支持班组：感电伤害 +18%/层 ×≤2（AA 门控见 spec additionalAbility；
  // 异常伤害提升乘区——格莉丝唯一异常为感电，走施加者面板 anomalyDmgBonus）
  if ((panel.additionalAbilityActive ?? 0) > 0) {
    const stacks = Math.max(0, Math.min(2, Number(settings?.['grace.shockStacks'] ?? 2)))
    panel.anomalyDmgBonus = (panel.anomalyDmgBonus ?? 0) + 18 * stacks
  }
  // 影画2 电致击穿（电伤抗+电积蓄抗 −8.5%）已由 spec teamBuffs `grace_c2_enemy_electric_debuff` 承载（满覆盖）
  // 影画4 爆破电容：能量获得效率 +20% 是招式特定（A1-A4 平A），非面板满覆盖——
  // 在 buildExecutions 按「强特×6 充能 → min(充能, 平A段数)」折算成单独回能项，不走 panel.energyGainEfficiency。
}

/** 影画1 全队每人回能：converge 阶段读上一轮 buildExecutions 存的 graceC1Cycles，分发给三槽 */
function applyGraceTeamConfig({ slot, phase, characters }: AgentTeamConfigInput): void {
  if (phase !== 'converge') return
  const cycles = Math.max(0, Math.floor(Number((characters[slot] as any)?.graceC1Cycles ?? 0)))
  if (cycles <= 0) return
  const energy = GRACE_C1_TEAM_ENERGY_PER_CYCLE * cycles
  for (const c of characters) {
    if (!c) continue
    c.initialEnergyGift = Number(c.initialEnergyGift ?? 0) + energy
  }
}

function buildGraceExecutions({ cfg, state, executions }: AgentResourceInput): void {
  const basicPool = state.basicAttackTime ?? 0
  const cinema = Math.max(0, Math.floor(Number((cfg as unknown as Record<string, unknown>).graceCinemaLevel ?? 0)))
  ;(cfg as unknown as Record<string, unknown>).graceBasicPoolPrev = basicPool // 留给下一轮 estimate（iterate/buildExecutions 分离惯例）
  const plan = planGraceRotation(basicPool, state.exSpecialCount ?? 0)
  const slots = plan.cycles * 2

  // A1-A4 走通用 basic 池行（平A秒均），这里发两发电能强化特殊技（真实 id，enrich 回填伤害/积蓄，
  // 积蓄 ×2.3 由 transformSkillExecutions 只对这两行限定）
  if (plan.exUsed > 0) {
    const exRow = graceRow(EX_MOVE_ID, '强化特殊技：超规工程清障（电能强化）', plan.exUsed, EX_TIME)
    // 电能满层时强特额外投掷一枚[涡流集束手雷]（1181020，表值 175.5）
    const vortexRow = graceRow(VORTEX_MOVE_ID, '涡流集束手雷（电能满层·强特附带）', plan.exUsed, 0)
    if (cinema >= 6) {
      // 影画6：强特 2 手雷 → 3 手雷——额外手雷所有数据按段数 ×1.5（倍率/秽盾）；伤害另 ×2（增伤 +100）
      exRow.damageMultiplier = 501.15 // catalog 334.1 × (3/2)
      exRow.damageMultiplierOverride = true
      exRow.dazeMultiplier = 301.95 // catalog 201.3 × 1.5
      exRow.dazeMultiplierOverride = true
      exRow.dmgBonus = GRACE_C6_GRENADE_DMG_BONUS
      vortexRow.dmgBonus = GRACE_C6_GRENADE_DMG_BONUS
    }
    executions.push(exRow, vortexRow)
  }
  if (plan.normalUsed > 0) {
    const spRow = graceRow(SP_MOVE_ID, '特殊技：工程清障（电能强化）', plan.normalUsed, SP_TIME)
    if (cinema >= 6) {
      // 影画6：特殊技 1 手雷 → 2 手雷——额外手雷所有数据 ×2；伤害另 ×2（增伤 +100）
      spRow.damageMultiplier = 170 // catalog 85 × 2
      spRow.damageMultiplierOverride = true
      spRow.dazeMultiplier = 128.2 // catalog 64.1 × 2
      spRow.dazeMultiplierOverride = true
      spRow.dmgBonus = GRACE_C6_GRENADE_DMG_BONUS
    }
    executions.push(spRow)
  }

  // 影画1 再充能弹膛：一次 A4（每轮换一格）给全队每人回 2 能量——存 cycles，由 applyGraceTeamConfig 分发给三槽
  ;(cfg as unknown as Record<string, unknown>).graceC1Cycles =
    cinema >= 1 ? plan.cycles : 0

  // 影画4 爆破电容：强特×6 充能 → 给 A1-A4 平A 回能 +20%（单独回能项，按段精确）
  // 充能顺序覆盖前 min(强特×6, 4×轮换) 段平A；每段回能取 catalog energy_recovery
  if (cinema >= 4 && plan.cycles > 0 && plan.exUsed > 0) {
    const totalBasicHits = 4 * plan.cycles
    const boosted = Math.min(plan.exUsed * 6, totalBasicHits)
    const fullCycles = Math.floor(boosted / 4)
    const rem = boosted % 4
    const boostedEnergy = fullCycles * A_CYCLE_ENERGY + A_SEG_ENERGY.slice(0, rem).reduce((a, b) => a + b, 0)
    const c4Energy = (GRACE_C4_ENERGY_EFFICIENCY / 100) * boostedEnergy
    ;(cfg as unknown as Record<string, unknown>).graceC4Energy = c4Energy
    ;(cfg as unknown as Record<string, unknown>).initialEnergyGift =
      Number((cfg as unknown as Record<string, unknown>).initialEnergyGift ?? 0) + c4Energy
  } else {
    ;(cfg as unknown as Record<string, unknown>).graceC4Energy = 0
  }

  // [脉冲]：终结技 ×25 层、**上限 25**（用户口供：留 1 层，多大都卡在 25）→
  // 一次大招恒 3 次兑换（floor(25/8)=3），每 8 层兑换一枚[脉冲手雷]（1181019）
  const pulseTotal = Math.max(0, Math.floor(state.ultimateCount ?? 0)) * PULSE_PER_ULT
  const pulseGrenades = Math.min(Math.floor(Math.min(pulseTotal, PULSE_CAP) / PULSE_PER_GRENADE), Math.max(0, slots))
  ;(cfg as unknown as Record<string, unknown>).gracePulseGrenadeCount = pulseGrenades
  if (pulseGrenades > 0) {
    executions.push(graceRow(PULSE_GRENADE_MOVE_ID, '脉冲手雷（脉冲兑换·附带）', pulseGrenades, 0))
  }
}

/** 手雷附带异放事件（用户口供：脉冲手雷「还有附带异放事件」）：以脉冲手雷倍率 84.9 结算电异放 */
/** 招式限定（引擎级，非近似）：只对特殊技/强特两行的异常行加行级积蓄效率 +130%，
 *  进积蓄效率区与其他来源加算（用户口供：文字明确只有这两招吃，一视同仁是马虎）。
 *  影画6：额外手雷段数——SP 1→2 手雷（baseBuildUp ×2）、EX 2→3 手雷（×1.5） */
function transformGraceExecutions({ anomalyExecs, cinemaLevel }: { anomalyExecs: AnomalySkillExecution[]; cinemaLevel: number }): void {
  for (const exec of anomalyExecs) {
    if (exec.moveId === SP_MOVE_ID || exec.moveId === EX_MOVE_ID) {
      exec.buildUpEfficiencyBonusPct = (exec.buildUpEfficiencyBonusPct ?? 0) + GRACE_BUILDUP_BONUS_PCT
      if (cinemaLevel >= 6) {
        const ratio = exec.moveId === SP_MOVE_ID ? 2 : 1.5
        exec.baseBuildUp *= ratio
      }
    }
  }
}

function buildGraceAnomalyEvents({ cfg, events }: { cfg: AgentResourceInput['cfg']; events: AnomalyEventExecution[] }): void {
  const count = Math.max(0, Math.floor(Number((cfg as unknown as Record<string, unknown>).gracePulseGrenadeCount ?? 0)))
  if (count <= 0) return
  events.push({
    eventId: 'grace_pulse_grenade_release',
    eventName: '脉冲手雷·异放',
    eventType: 'release',
    // 手雷本体是直伤；触发的异放按目标当前异常状态结算（基础者=该元素主施加者，dominant 分支）
    element: 'dominant',
    count,
    // 比例组 560/280/700/50/70/28 × DOT基准(62.5/125/50/713/500/1250) 收敛 ≈350% 固定倍率
    formula: 'releaseMultiplier=350（原属性异常比例×DOT基准收敛值）；命中异常目标触发',
    fields: ['releaseMultiplier=350'],
    note: '消耗8层脉冲 → 下次投掷手雷额外丢一枚脉冲手雷，命中异常状态目标触发一次异放（用户口供 2026-08-23；倍率口径 2026-08-24 审计修正）',
  })
}

/** 特殊技/手雷行（真实 id）：enrich 回填伤害/积蓄；动作时间不覆盖；积蓄缩放走 transform 钩子 */
function graceRow(moveId: string, name: string, count: number, actionTime: number): SkillExecution {
  return {
    moveId,
    moveName: name,
    category: 'special',
    count,
    actionTime,
    comboAlignRatio: 0,
    totalTime: actionTime * count,
    totalComboAlignTime: 0,
    energyConsume: 0,
    totalEnergyConsume: 0,
    decibelRecovery: 0,
    totalDecibelRecovery: 0,
    energyRecovery: 0,
    totalEnergyRecovery: 0,
    skillTableNote: `消耗全部电能（8层）→ 电属性异常积蓄 +130%（积蓄效率区加算）`,
  }
}



function buildGraceResourceSections(_input: AgentResourceSectionsInput) {
  return [] // 专属资源卡暂无（电能计划体现在执行行 note）
}

export const graceMechanic: AgentMechanicModule = {
  id: 'agent:grace',
  agentIds: [GRACE_AGENT_ID],
  name: '格莉丝',
  applyPanel: applyGracePanel,
  buildCharConfig: buildGraceCharConfig,
  applyTeamConfig: applyGraceTeamConfig,
  buildExecutions: buildGraceExecutions,
  transformSkillExecutions: transformGraceExecutions,
  buildAnomalyEvents: buildGraceAnomalyEvents,
  estimateExSpecialTime: ({ cfg, exSpecialCount }) => {
    const prevPool = Math.max(0, Number((cfg as unknown as Record<string, unknown>).graceBasicPoolPrev ?? 0))
    const plan = planGraceRotation(prevPool, exSpecialCount)
    return {
      necessaryTime: graceRotationSeconds(plan.cycles, plan.exUsed),
      comboAlignTime: 0,
    }
  },
  resourceSections: buildGraceResourceSections,
  settings: [
    {
      id: 'grace.shockStacks',
      label: '格莉丝·感电强化层数',
      description: '额外能力·技术支持班组：目标下次感电伤害 +18%/层 ×≤2。默认 2 层（满层）；实战平均层数 ≈ min(2, 总强特次数/感电次数)，可按对局手动下调。',
      default: 2,
      min: 0,
      max: 2,
      step: 1,
      suffix: '层',
    },
  ],
}
