import type {
  AgentCharConfigInput,
  AgentMechanicModule,
  AgentPanelInput,
  AgentResourceInput,
  AgentResourceSectionsInput,
} from '../types'
import type { SkillExecution } from '@/types/resource'
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
const A1_MOVE_ID = '1181001'
const A2_MOVE_ID = '1181002'
const A3_MOVE_ID = '1181003'
const A4_MOVE_ID = '1181004'
/** 动作时间取 catalog（A1+A2+A3 = 1.183s ≈ 口供实测 1.1827；A4 = 1.134 ≈ 口供 1.1335） */
const A1_TIME = 0.171
const A2_TIME = 0.33
const A3_TIME = 0.682
const A4_TIME = 1.134
/** 合成载体行（非纯数字过 sweep）：表值 ×2.3 后显式携带 */
export const GRACE_SPECIAL_CHARGE_MOVE_ID = 'grace_special_charge'
export const GRACE_EX_CHARGE_MOVE_ID = 'grace_exspecial_charge'
const SP_DAMAGE = 85
const SP_BUILDUP = 70.03
const SP_TIME = 0.2
const EX_DAMAGE = 334.1
const EX_BUILDUP = 143.34
const EX_TIME = 0.342
export const GRACE_BUILDUP_MULTIPLIER = 2.3 // 电属性异常积蓄 +130%

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
}

/** 永续面板项：潜能电伤（C2-C6 = 10~30%）+ AA 感电强化层数 */
function applyGracePanel(input: AgentPanelInput): void {
  const { panel, cinemaLevel, settings } = input
  // 电能满层消耗 → 电属性异常积蓄 +130%（Lv.7）：异常池无执行行级积蓄 override，
  // 走施加者面板 electricAnomalyBuildUpEfficiency（引擎唯一积蓄缩放区）。口径近似：
  // 面板对所有电属性积蓄生效（含终结/连携），与口供「循环保证每一发特殊技都吃满」对齐。
  panel.electricAnomalyBuildUpEfficiency = (panel.electricAnomalyBuildUpEfficiency ?? 0) + 130
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
}

function buildGraceExecutions({ cfg, state, executions }: AgentResourceInput): void {
  const basicPool = state.basicAttackTime ?? 0
  ;(cfg as unknown as Record<string, unknown>).graceBasicPoolPrev = basicPool // 留给下一轮 estimate（iterate/buildExecutions 分离惯例）
  const plan = planGraceRotation(basicPool, state.exSpecialCount ?? 0)

  // A1-A4 走通用 basic 池行（平A秒均），这里只发两发电能强化特殊技
  if (plan.exUsed > 0) {
    executions.push(graceChargeRow(GRACE_EX_CHARGE_MOVE_ID, '强化特殊技：超规工程清障（电能强化）', plan.exUsed, EX_DAMAGE, EX_BUILDUP, EX_TIME))
  }
  if (plan.normalUsed > 0) {
    executions.push(graceChargeRow(GRACE_SPECIAL_CHARGE_MOVE_ID, '特殊技：工程清障（电能强化）', plan.normalUsed, SP_DAMAGE, SP_BUILDUP, SP_TIME))
  }
}

/** 电能强化载体行（合成 id）：伤害/积蓄 = 倍率表值 ×2.3，显式全字段防 enrich 覆盖 */
function graceChargeRow(moveId: string, name: string, count: number, damage: number, buildup: number, actionTime: number): SkillExecution {
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
    damageMultiplier: damage,
    damageMultiplierOverride: true,
    skillTableNote: `消耗全部电能（8层）→ 电属性异常积蓄 +130%（面板 electricAnomalyBuildUpEfficiency，${buildup.toFixed(2)} × 2.3）`,
  }
}

/** 合成载体行固定电属性（无倍率表行，显式声明避免依赖角色属性回退） */
function resolveGraceExecutionDamage({ exec }: { exec: SkillExecution }): { element: string; source: string } | null {
  if (exec.moveId === GRACE_SPECIAL_CHARGE_MOVE_ID || exec.moveId === GRACE_EX_CHARGE_MOVE_ID) {
    return { element: 'electric', source: exec.moveId }
  }
  return null
}

function buildGraceResourceSections(input: AgentResourceSectionsInput) {
  return [] // 专属资源卡暂无（电能计划体现在执行行 note）
}

export const graceMechanic: AgentMechanicModule = {
  id: 'agent:grace',
  agentIds: [GRACE_AGENT_ID],
  name: '格莉丝',
  applyPanel: applyGracePanel,
  buildCharConfig: buildGraceCharConfig,
  buildExecutions: buildGraceExecutions,
  estimateExSpecialTime: ({ cfg, exSpecialCount }) => {
    const prevPool = Math.max(0, Number((cfg as unknown as Record<string, unknown>).graceBasicPoolPrev ?? 0))
    const plan = planGraceRotation(prevPool, exSpecialCount)
    return {
      necessaryTime: graceRotationSeconds(plan.cycles, plan.exUsed),
      comboAlignTime: 0,
    }
  },
  resolveExecutionDamage: resolveGraceExecutionDamage,
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
