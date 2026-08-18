/**
 * 失衡池计算引擎
 *
 * 逻辑：
 * 1. 从招式执行计划提取每个招式的 daze（失衡倍率）
 * 2. 用 calcStunBuildUp 计算每招的实际失衡值（经过冲击力/失衡提升/抗性等乘区）
 * 3. 汇总全队总失衡值
 * 4. 失衡次数 = floor(总失衡值 / bossStunValue)
 * 5. 连携次数 = 失衡次数 × 每次连携数（首领默认3）
 * 6. 失衡相关喧响奖励 = 失衡次数 × 20 + 总连携次数 × 10
 *
 * 数据来源：
 * - 招式执行计划：从 resource.ts 的 SkillExecution 扩展，需要 daze 和 element
 * - 面板属性：impact, stunBuildUpBonus, enemyStunTakenBonus 等
 * - Boss 配置：stunValue（失衡值上限）、stunVuln（失衡易伤）
 */
import type { PanelValues } from '@/types/catalog'
import { getStunBuildUpBonus, getTargetedStat } from './buff'
import { enemyDebuffElementStatId } from '@/utils/enemyDebuffStats'
import type {
  StunPoolResult, StunContribution,
} from '@/types/resource'

/** 喧响奖励常量 */
export const STUN_DECIBEL_BONUS = 20    // 进入失衡奖励
export const CHAIN_DECIBEL_BONUS = 10   // 连携一次奖励


function getElementEnemyStunResReduction(panel: PanelValues, element: string, skillType?: string): number {
  const stat = enemyDebuffElementStatId('stunRes', element)
  return stat ? getTargetedStat(panel, stat, skillType) : 0
}

/** 招式执行记录（扩展，含 daze 和 element 信息） */
export interface StunSkillExecution {
  moveId: string
  moveName: string
  slot: number
  count: number
  /** 基础失衡倍率（百分比，如 120 表示 120%） */
  baseDaze: number
  /** 招式元素（用于查找抗性） */
  element?: string
  /** 招式类型（用于读取定向失衡加成） */
  skillType?: string
  /** 行级失衡值提升（%，与面板 stunBuildUpBonus 同乘区加算；如莱卡恩 C1 有限次强特强化） */
  stunBuildUpBonus?: number
}

/** 失衡池计算输入 */
export interface StunPoolInput {
  /** 全队招式执行计划 */
  executions: StunSkillExecution[]
  /** 各角色的面板 */
  panels: PanelValues[]
  /** Boss 失衡值上限 */
  bossStunValue: number
  /** 每次失衡的连携次数（首领默认3） */
  chainCountPerStun: number
  /** 各元素失衡抗性（百分比，如20表示20%） */
  enemyStunResistances?: Record<string, number>
  /** 兼容旧调用：单一失衡抗性 */
  enemyStunResistance?: number
  /** 物理异常（畏缩）覆盖率，0-1之间
   *  畏缩使敌人受到的失衡值 +7.5%，持续10秒
   *  实际增幅 = 7.5% × 覆盖率
   *  来自 anomalyPool 的 coverage.physicalCoverageRate
   */
  physicalFlinchCoverageRate?: number
  /**
   * 轴内失衡值失效比例：key = `${slot}:${moveId}`（moveId 与 executions 中一致，
   * 平A为 'basic_attack'），value = 该招式落在失衡窗口内的单位占比 0-1。
   * 失衡窗口内打出的失衡值不累积下一次失衡条，因此从有效失衡值中扣除。
   */
  inAxisStunFractionByKey?: Record<string, number>
}

/** 计算单次招式的实际失衡值
 *  复用 damage.ts 的 calcStunBuildUp 逻辑，但简化为内联计算
 *
 *  受到失衡值提升区说明：
 *  - panel.enemyStunTakenBonus：来自其他buff的受到失衡提升
 *  - 物理异常[畏缩]：+7.5%，持续10秒，实际增幅 = 7.5% × 物理覆盖率
 *  - 两者加算合并到「受到失衡值提升区」
 */
function calcPerHitStun(
  baseDaze: number,
  panel: PanelValues,
  enemyStunResistance: number,
  physicalFlinchCoverageRate: number,
  element: string,
  skillType?: string,
  execStunBonus = 0,
): number {
  const baseStun = baseDaze

  // 冲击力区
  const impact = panel.impact ?? 0
  const afterImpact = baseStun * (impact / 100)

  // 失衡值提升区（面板定向 + 行级提升同乘区加算）
  const stunBuildUpBonus = getStunBuildUpBonus(panel, skillType) + execStunBonus
  const afterBuildUp = afterImpact * (1 + stunBuildUpBonus / 100)

  // 受到失衡值提升区
  // = panel自带的受到失衡提升 + 物理异常[畏缩]覆盖率 × 7.5%
  const enemyStunTaken = panel.enemyStunTakenBonus ?? 0
  const flinchBonus = 7.5 * physicalFlinchCoverageRate
  const totalStunTaken = enemyStunTaken + flinchBonus
  const afterTaken = afterBuildUp * (1 + totalStunTaken / 100)

  // 失衡抗性区
  const stunResRed = getTargetedStat(panel, 'enemyStunResReduction', skillType) + getElementEnemyStunResReduction(panel, element, skillType)
  const effectiveRes = enemyStunResistance - stunResRed
  const afterRes = afterTaken * (1 - effectiveRes / 100)

  return afterRes
}

/** 失衡池主计算 */
export function calcStunPool(input: StunPoolInput): StunPoolResult {
  const { executions, bossStunValue, chainCountPerStun, enemyStunResistance = 0, enemyStunResistances = {}, physicalFlinchCoverageRate = 0 } = input
  const inAxisFractions = input.inAxisStunFractionByKey ?? {}

  const contributions: StunContribution[] = []
  const perSlotStun = [0, 0, 0]
  let totalStunBuildUp = 0
  let grossStunBuildUp = 0
  let inAxisStunTotal = 0

  for (const exec of executions) {
    if (exec.count <= 0 || exec.baseDaze <= 0) continue

    const panel = input.panels[exec.slot] ?? input.panels[0]
    const element = exec.element ?? 'physical'
    const baseStunRes = enemyStunResistances[element] ?? enemyStunResistance
    const perHit = calcPerHitStun(exec.baseDaze, panel, baseStunRes, physicalFlinchCoverageRate, element, exec.skillType, exec.stunBuildUpBonus)
    const total = perHit * exec.count
    const inAxisFraction = Math.max(0, Math.min(1, inAxisFractions[`${exec.slot}:${exec.moveId}`] ?? 0))
    const inAxisStun = total * inAxisFraction
    const effectiveStun = total - inAxisStun

    contributions.push({
      moveId: exec.moveId,
      moveName: exec.moveName,
      slot: exec.slot,
      count: exec.count,
      baseDaze: exec.baseDaze,
      perHitStun: perHit,
      totalStun: total,
      inAxisFraction,
      inAxisStun,
      effectiveStun,
    })

    perSlotStun[exec.slot] = (perSlotStun[exec.slot] ?? 0) + effectiveStun
    totalStunBuildUp += effectiveStun
    grossStunBuildUp += total
    inAxisStunTotal += inAxisStun
  }

  // 失衡次数 = floor(有效总失衡值 / bossStunValue)；失衡窗口内打出的失衡值无效
  const stunCount = bossStunValue > 0
    ? Math.floor(totalStunBuildUp / bossStunValue)
    : 0

  // 总连携次数
  const chainCountTotal = stunCount * chainCountPerStun

  // 喧响奖励
  const decibelBonus = stunCount * STUN_DECIBEL_BONUS + chainCountTotal * CHAIN_DECIBEL_BONUS

  return {
    contributions,
    totalStunBuildUp,
    grossStunBuildUp,
    inAxisStunTotal,
    bossStunValue,
    stunCount,
    chainCountPerStun,
    chainCountTotal,
    decibelBonus,
    perSlotStun,
  }
}
