/**
 * 失衡轴（捏轴）计算引擎
 *
 * 模型：
 * 1. 全局资源池（calcTeamResources）已经决定每个招式/平A的总次数与总秒数，
 *    失衡池据此收敛出固定失衡次数 stunCount = floor(总失衡值 / bossStunValue)。
 * 2. 失衡轴（捏轴）不改变失衡次数，也不改变总动作次数——它只「挑选」其中一部分动作
 *    放进失衡窗口（吃失衡易伤），其余动作留在窗口外（无易伤）。
 * 3. 因此每个动作被切成两段：轴内单位数（易伤=1）与轴外单位数（易伤=0）。
 *    跨边界动作按 (窗口内时长 / 动作时长) 折算轴内比例，得到分数单位（期望值模型）。
 * 4. 校验三件事并给出警告（不硬拒绝）：
 *    a. 资源约束：同一 (slot, moveId) 轴内总取用 ≤ 全局可用次数/秒，超额按轮截断。
 *    b. 窗口数约束：Σ axis.count ≤ stunCount（多出的轮次没有对应失衡窗口）。
 *    c. 窗口时长约束：单轮动作块总时长 ≤ 窗口时长（stunTime + 连携窗口 + 队伍延长）。
 *
 * key = `${slot}:${moveId}`（basic 的 moveId 为 'basic'，单位=秒；其余为单位=次）。
 */

import type { StunAxis, StunAxisResult } from '@/types/resource'
import { allocateAxisWindows } from './stunAxisStack'

/** 全局资源池：`${slot}:${moveId}` → 全局可用次数/秒（basic='basic'→秒，其他→次数） */
export interface GlobalActionPool {
  [key: string]: number
}

/** 每动作单位失衡值：`${slot}:${moveId}` → 单次/每秒失衡值 */
export type PerActionStun = Record<string, number>

/** 每动作单位时长：`${slot}:${moveId}` → 单次动作前台秒数（basic=1s） */
export type PerActionDuration = Record<string, number>

export interface CalcStunAxisInput {
  axes: StunAxis[]
  globalPool: GlobalActionPool
  perActionStun: PerActionStun
  perActionDuration: PerActionDuration
  /** 失衡次数（固定，来自失衡池收敛结果；捏轴不改变它） */
  stunCount: number
  /** 单次失衡窗口时长（秒）= stunTime + 连携窗口(4) + 队伍失衡持续时间延长 */
  windowDuration: number
  bossStunValue: number
  battleTime?: number
  invincibleTime?: number
}

/**
 * 计算一个动作块在失衡窗口内的覆盖比例（0-1）。
 * startTime 相对窗口起点，可为负（窗口外提前起手）或超过窗口终点。
 */
export function computeInAxisRatio(startTime: number, duration: number, windowDuration: number): number {
  if (duration <= 0) return 0
  const start = startTime ?? 0
  const end = start + duration
  const inStart = Math.max(0, start)
  const inEnd = Math.min(windowDuration, end)
  const intersection = Math.max(0, inEnd - inStart)
  return Math.max(0, Math.min(1, intersection / duration))
}

export function calcStunAxis(input: CalcStunAxisInput): StunAxisResult {
  const { axes, globalPool, perActionStun, perActionDuration, stunCount, windowDuration } = input
  const battleTime = input.battleTime ?? 180
  const invTime = input.invincibleTime ?? 0

  const axisDetails: StunAxisResult['axisDetails'] = []
  const globalWarnings: string[] = []
  const allocation: StunAxisResult['allocation'] = {}
  const consumed: Record<string, number> = {}
  let totalInAxisStun = 0

  // 窗口分配与栈引擎同口径：count 有值 = 精确次数，缺省 = 兜底吃剩余
  const winAlloc = allocateAxisWindows(axes, stunCount)
  const totalAxisRounds = winAlloc.reduce((a, b) => a + b, 0)
  const exactRoundsRequested = axes.reduce((sum, a) => sum + (a.count ?? 0), 0)
  if (exactRoundsRequested > stunCount) {
    globalWarnings.push(`轴固定轮数合计 ${exactRoundsRequested} 超过失衡次数 ${stunCount}（尾部轴窗口被截断）`)
  }

  axes.forEach((axis, ai) => {
    const warnings: string[] = []
    const axisTimes = winAlloc[ai] ?? 0
    let axisStun = 0
    const slotDurations: Record<number, number> = {}
    const actionDetails: StunAxisResult['axisDetails'][number]['actions'] = []

    for (const action of axis.actions) {
      // 赠送连携块（sourceTag='gift'）：真实连携块，占窗口时长（借普通连携 perDur 参与时间折算），
      // 但不产失衡、不占全局池配额（独立 ':gift' key 计数）；norma-hat-chain 为纯标记块（0 时长）。
      const isGiftBlock = action.sourceTag === 'gift'
      const isHatMarker = action.moveId === 'norma-hat-chain'
      const key = isGiftBlock
        ? `${action.slot}:${action.moveId}:gift`
        : isHatMarker
          ? `${action.slot}:norma-hat-chain`
          : `${action.slot}:${action.moveId}`
      const perStun = isGiftBlock || isHatMarker ? 0 : (perActionStun[key] ?? 0)
      const perDur = isGiftBlock
        ? (perActionDuration[`${action.slot}:${action.moveId}`] ?? 0)
        : isHatMarker ? 0 : (perActionDuration[key] ?? 0)
      const available = globalPool[key] ?? 0
      const alreadyConsumed = consumed[key] ?? 0
      // 轴专属块（combo/触手/诺姆转连携等不在全局执行计划池的动作，如 yidhari-heavy-*/1051024）：
      // 次数由模块在轴内反推/自动全打，不受全局池约束——跳过"超额"警告（此前每次都会误报剩0）
      const isAxisSpecial = !(key in globalPool)
      const remaining = isAxisSpecial ? Infinity : Math.max(0, available - alreadyConsumed)

      const totalNeeded = action.count * axisTimes
      const effective = totalNeeded
      const overuse = isAxisSpecial ? 0 : Math.max(0, totalNeeded - remaining)
      if (overuse > 0) {
        warnings.push(`槽${action.slot + 1} ${action.moveId}: 超额 ${overuse}（需${totalNeeded}，剩${remaining}），固定轴仍按 ${totalNeeded} 计入`)
      }

      consumed[key] = alreadyConsumed + effective

      // 单轮动作块时长 = 单轮次数 × 单位时长；跨边界比例按窗口内时长折算
      const perRoundCount = axisTimes > 0 ? Math.round(effective / axisTimes) : 0
      const blockDuration = perRoundCount * perDur
      const ratio = computeInAxisRatio(action.startTime ?? 0, blockDuration, windowDuration)
      const inAxisUnits = effective * ratio
      const outAxisUnits = effective * (1 - ratio)

      const alloc = allocation[key] ?? (allocation[key] = { slot: action.slot, moveId: action.moveId, inAxisUnits: 0, outAxisUnits: 0 })
      alloc.inAxisUnits += inAxisUnits
      alloc.outAxisUnits += outAxisUnits

      const actionTotalStun = effective * perStun
      axisStun += actionTotalStun
      slotDurations[action.slot] = (slotDurations[action.slot] ?? 0) + blockDuration

      actionDetails.push({
        actionKey: key,
        count: action.count,
        inAxisRatio: ratio,
        perStun,
        totalStun: actionTotalStun,
        overuse,
      })
    }

    // 合轴：三槽并行，单轮时长取各槽位最大值（不是相加）
    const axisDuration = Math.max(0, ...Object.values(slotDurations))
    if (axisDuration > windowDuration) {
      warnings.push(`单轮动作时长 ${axisDuration.toFixed(1)}s 超过失衡窗口 ${windowDuration.toFixed(1)}s（超出部分按比例折算轴内易伤）`)
    }
    totalInAxisStun += axisStun
    axisDetails.push({ name: axis.name, times: axisTimes, axisStun, axisDuration, actions: actionDetails, warnings })
    globalWarnings.push(...warnings.map(w => `${axis.name}: ${w}`))
  })

  const effectiveTime = Math.max(0, battleTime - invTime)
  const coverage = effectiveTime > 0 ? Math.min(1, (stunCount * windowDuration) / effectiveTime) : 0

  return { totalInAxisStun, stunCount, totalAxisRounds, stunCoverage: coverage, allocation, axisDetails, globalWarnings }
}
