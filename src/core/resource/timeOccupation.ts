/**
 * 时间分配 + 队伍前台占用拆解（R43 结构熵切面：自 `core/resource/helpers.ts` 纯搬运）。
 *
 * 为什么这一族是内聚切面：`calcTimeAllocation`（单角色时间账）与
 * `frontlineOccupationBreakdown`（队伍前台占用**唯一拆解函数**）+ 只取 `net` 的薄壳
 * `netFrontlineOccupation`，是同一几何口径（合轴抵扣 = 每槽
 * `max(招式合轴抵扣, 轴内合轴节省)`，两种模型不叠加）的单槽 / 全队两级视图。
 * 对 helpers.ts 其它符号**零内部依赖**（闸门实测出度 0：只读 `TeamResourceResult`
 * 与 `frontlineRowSeconds`）。
 */
import type { CharacterOperationConfig, FrontlineRow, IterationState, TeamResourceResult, TimeAllocation } from '@/types/resource'
import { frontlineRowSeconds } from '@/types/resource'

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
  const overlapBySlot = axisOverlapBySlot(rr.axisOverlapByAction)
  let gross = 0
  let axisOverlap = 0
  let total = 0
  let totalRowNet = 0
  for (const ch of rr.characters) {
    gross = frontlineRowSeconds(ch.executions, gross)
    const r = slotNetFrontline(ch.executions, overlapBySlot[ch.slot] ?? 0, ch.timeAllocation.comboAlignCredit)
    axisOverlap += r.axisCut
    total += r.net
    totalRowNet += r.rowNet
  }
  // CC-178（第 201 轮）：删掉「只有团队级 axisOverlapSeconds、无按块分摊」兜底分支——栈引擎
  // （core/stunAxisStack.ts）逐块同时累加团队总量与按块分摊（Σ 分摊 = 总量），生产中不存在
  // 「总量 > 0 而分摊为空」的状态，该分支只有测试在走；团队总量字段随之删除（按块分摊是唯一表示）。
  const net = total
  return {
    grossFrontline: gross,
    axisOverlap,
    creditApplied: Math.max(0, totalRowNet - total),
    net,
    saved: Math.max(0, gross - net),
  }
}

/** 队伍前台净占用（秒，单一事实源）：见 `frontlineOccupationBreakdown`，本函数只取 `net`（逐位等价）。 */
export function netFrontlineOccupation(rr: TeamResourceResult): number {
  return frontlineOccupationBreakdown(rr).net
}

/**
 * 轴内合轴分摊按槽位合计（CC-495）：`axisOverlapByAction` 键 `slot:moveId` → Σ 秒 / 槽（键或值非有限跳过）。
 * 预算 relief（`helpers.ts` 平A池）/ 占用拆解（本文件）/ 欠打试探（`underfillProbe.ts`）三处同一份——
 * 此前各写一遍，两处按 configs 下标、一处按槽号，读法不同但量相同。
 */
export function axisOverlapBySlot(overlap: Readonly<Record<string, number>> | undefined): Record<number, number> {
  const bySlot: Record<number, number> = {}
  for (const [key, sec] of Object.entries(overlap ?? {})) {
    const slot = Number(key.slice(0, key.indexOf(':')))
    if (Number.isFinite(slot) && Number.isFinite(sec)) bySlot[slot] = (bySlot[slot] ?? 0) + sec
  }
  return bySlot
}

/**
 * 单槽前台净占用（CC-495，超时判定的几何口径，一份）：
 *   rowNet = Σ_{前台行} 行时长（`frontlineRowSeconds`）− min(该和, 该槽轴内合轴分摊合计 slotOverlap) (+ extraSeconds 逐项追加)
 *   net    = max(0, rowNet − max(0, 招式合轴抵扣 comboAlignCredit − slotOverlap))
 * 即每槽抵扣 = max(comboAlignCredit, slotOverlap)，与 iterate 平A池 relief（`helpers.ts`）同一份按槽量。
 * r709：轴内分摊原按 `slot:moveId` 逐行匹配——栈键是**轴块** id（连段块 / 赠块 `:gift`），行是展开后的招式 id，
 * 连段块的分摊匹配不到行 ⇒ 整段漏扣、还反向压低招式合轴增量 ⇒ 净占用高于 relief 口径，轴被误判超时退化
 *（实测 `auto-1461-1521-1361`：席德崩坠连段块）。
 * 装配后的占用拆解（`frontlineOccupationBreakdown`）与欠打试探的门控测量（`underfillProbe#frontlineRowsOf`，
 * 行 = 试探物化行 + 赠送连携/赠大时间作 extraSeconds）都走它——试探注释原文「与 netFrontlineOccupation 完全同口径，
 * 否则试探门控放行、装配后仍超预算（实测差出 164s）」，现在是同一个函数而不是两份手抄。
 * `axisCut` = 本槽实际扣掉的轴内分摊（占用拆解按槽累加成 `axisOverlap`）。r738 前这里另有 `tally` 出参，
 * 逐行累加未钳的毛前台、同时对 rowSum 钳 `max(0, 行时长)`；行时长恒 ≥ 0 之后两者相同，出参删掉，毛前台改由拆解调 `frontlineRowSeconds`。
 */
export function slotNetFrontline(
  rows: ReadonlyArray<FrontlineRow>,
  slotOverlap: number,
  comboAlignCredit: number | undefined,
  extraSeconds: readonly number[] = [],
): { rowNet: number; net: number; axisCut: number } {
  const rowSum = frontlineRowSeconds(rows)
  const axisCut = Math.min(rowSum, slotOverlap)
  let rowNet = rowSum - axisCut
  for (const sec of extraSeconds) rowNet += sec
  const extraCredit = Math.max(0, (comboAlignCredit ?? 0) - slotOverlap)
  return { rowNet, net: Math.max(0, rowNet - extraCredit), axisCut }
}
