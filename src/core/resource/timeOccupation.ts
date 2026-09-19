/**
 * 时间分配 + 队伍前台占用拆解（R43 结构熵切面：自 `core/resource/helpers.ts` 纯搬运）。
 *
 * 为什么这一族是内聚切面：`calcTimeAllocation`（单角色时间账）与
 * `frontlineOccupationBreakdown`（队伍前台占用**唯一拆解函数**）+ 只取 `net` 的薄壳
 * `netFrontlineOccupation`，是同一几何口径（合轴抵扣 = 每槽
 * `max(招式合轴抵扣, 轴内合轴节省)`，两种模型不叠加）的单槽 / 全队两级视图。
 * 对 helpers.ts 其它符号**零内部依赖**（闸门实测出度 0：只读 `TeamResourceResult`
 * 与 `isFrontlineExecution` 谓词）。
 */
import type { CharacterOperationConfig, IterationState, TeamResourceResult, TimeAllocation } from '@/types/resource'
import { isFrontlineExecution } from '@/types/resource'

// ============ 时间计算 ============

/** 计算单角色时间分配 */
export function calcTimeAllocation(
  _cfg: CharacterOperationConfig,
  state: IterationState,
  totalTime: number,
): TimeAllocation {
  // 必做动作前台时间 = 强特 + 终结技 + 连携等动作的 actionTime，未扣除合轴
  const necessaryTime = state.necessaryTime

  // 单角色前台时间 = 必做动作前台时间 + 平A时间
  const frontlineTime = necessaryTime + state.basicAttackTime

  // 后台时间 = 总时间 - 前台时间
  const backstageTime = Math.max(0, totalTime - frontlineTime)

  // 合轴时间 = 终结技等长动作的合轴部分（由 state 传入）
  const comboAlignTime = state.comboAlignTime

  return {
    frontlineTime,
    backstageTime,
    comboAlignTime,
    comboAlignCredit: state.comboAlignCredit,
    dynamicComboAlignSeconds: state.dynamicComboAlignSeconds,
    basicAttackTime: state.basicAttackTime,
    necessaryTime,
  }
}

/** 前台占用拆解（见 `frontlineOccupationBreakdown`） */
export interface FrontlineOccupationBreakdown {
  /** Σ物化前台行（含轴内重叠，未扣任何抵扣） */
  grossFrontline: number
  /** 轴内合轴节省（轴模式 = 栈引擎实际区间；非轴 = 0） */
  axisOverlap: number
  /** 实际生效的**合轴抵扣秒**（招式合轴率口径；max 口径防与轴内节省双扣） */
  creditApplied: number
  /** 净占用（超时判定口径） */
  net: number
  /**
   * **合轴解放出来的前台时间（秒）** = grossFrontline − net。
   * 用户 2026-09-10 口径：「这次新合轴就是把队友的前台时间进行合轴率的优化，再次解放出来部分
   * 可使用的前台时间…合轴节约出来的时间越多，难度越高，总伤越多」⇒ 难度口径拿它当自变量。
   */
  saved: number
}

/**
 * 队伍前台占用的**唯一拆解函数**：Σ物化前台行 / 轴内合轴节省 / 合轴抵扣 / 净占用 / 解放出来的时间。
 * 抵扣 = 每槽 max(招式合轴抵扣 comboAlignCredit, 轴内合轴节省 axisOverlapByAction)——
 * 同一物理并行（轴模式=栈引擎实际区间、非轴=合轴率均值）的两种模型，不叠加。
 * 与 iterate 平A池的 relief 同口径：超时判定（轴退化/降配、队伍对比）必须用 `net`，
 * 否则合轴抵扣放宽后的平A池会被误判超时（2026-09-04 合轴口径）。
 */
export function frontlineOccupationBreakdown(rr: TeamResourceResult): FrontlineOccupationBreakdown {
  const overlap = rr.axisOverlapByAction ?? {}
  const overlapBySlot: Record<number, number> = {}
  for (const [key, sec] of Object.entries(overlap)) {
    const slot = Number(key.slice(0, key.indexOf(':')))
    if (Number.isFinite(slot)) overlapBySlot[slot] = (overlapBySlot[slot] ?? 0) + sec
  }
  let total = 0
  let totalCredit = 0
  let totalRowNet = 0
  let gross = 0
  let axisOverlap = 0
  for (const ch of rr.characters) {
    let rowNet = 0
    for (const exec of ch.executions) {
      if (!isFrontlineExecution(exec)) continue
      const t = exec.totalTime ?? 0
      gross += t
      const cut = overlap[`${ch.slot}:${exec.moveId}`] ?? 0
      axisOverlap += cut
      rowNet += Math.max(0, t - cut)
    }
    // 合轴抵扣只再扣超出轴内节省的增量（max 口径，防双重扣减）
    const extraCredit = Math.max(0, (ch.timeAllocation.comboAlignCredit ?? 0) - (overlapBySlot[ch.slot] ?? 0))
    total += Math.max(0, rowNet - extraCredit)
    totalCredit += ch.timeAllocation.comboAlignCredit ?? 0
    totalRowNet += rowNet
  }
  // 兜底：只有团队级 axisOverlapSeconds、无按块分摊（老注入路径/测试）→ 团队级 max 口径
  const teamLevel = Object.keys(overlap).length === 0 && (rr.axisOverlapSeconds ?? 0) > 0
  const net = teamLevel ? Math.max(0, totalRowNet - Math.max(totalCredit, rr.axisOverlapSeconds ?? 0)) : total
  return {
    grossFrontline: gross,
    axisOverlap: teamLevel ? Math.max(0, gross - totalRowNet) : axisOverlap,
    creditApplied: teamLevel ? Math.max(0, totalRowNet - net) : Math.max(0, totalRowNet - total),
    net,
    saved: Math.max(0, gross - net),
  }
}

/** 队伍前台净占用（秒，单一事实源）：见 `frontlineOccupationBreakdown`，本函数只取 `net`（逐位等价）。 */
export function netFrontlineOccupation(rr: TeamResourceResult): number {
  return frontlineOccupationBreakdown(rr).net
}
