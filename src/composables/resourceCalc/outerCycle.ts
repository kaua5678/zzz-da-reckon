/**
 * 外层收敛的反馈快照与二周期判据。
 *
 * 签名必须从本轮输出即时生成，不能跨轮保存一个待更新的“当前值”。
 * stable 比相邻轮；二周期比 k 与 k-2。签名历史只在本轮判定之后追加。
 * 这是既有监测量的显式投影，不是全部 CalcRoundThreads 的序列化；新增独立反馈需补判据。
 */
import type { CalcRoundResult } from './convergence'

export function outerFeedbackSignature(out: CalcRoundResult): string {
  const chars = out.resourceResult?.characters ?? []
  return [
    // 连续终结次数允许量化收敛，避免小数尾数让 stable 永远不成立。
    chars.map(c => (c.ultimateCount ?? 0).toFixed(3)).join(','),
    (out.anomalyPool?.perSlotBonus ?? []).map(v => Math.round(v)).join(','),
    `${out.interactionTopUp?.parry},${out.interactionTopUp?.dual}`,
    out.parrySplit ? `${out.parrySplit.breakerParry},${out.parrySplit.mainDpsParry}` : '',
    `${out.threadsNext.decibelParry ?? 0}`,
    JSON.stringify(out.threadsNext.backstageAuto ?? {}),
    // 保底填充依赖积蓄分数；只比较 floor 后的失衡次数会提前停止。
    out.stunPool ? (out.stunPool.totalStunBuildUp / out.stunPool.bossStunValue).toFixed(2) : '',
    // 剑仪反馈可能只改变执行行而不改变终结次数，必须独立监测。
    chars.map(c => c.aliceSwordWillSource?.sparkCount ?? 0).join(','),
  ].join('|')
}

export interface OuterTwoCycleInput {
  /** 上一轮的输入 x[k-1]；首轮为 null。 */
  previousInput: number | null
  currentInput: number
  nextInput: number
  currentSignature: string
  /** 只含已经完成的轮次：末项是 k-1，不含当前 k。 */
  signatureHistory: readonly string[]
  tolerance: number
}

/**
 * 失衡值回到上一轮输入附近，且反馈回到同相位（lag=2），才接受二周期。
 * 相邻失衡值已在容差内时留给 stable 判据，不能把趋稳序列误报为 cycle。
 * 不按截断量拒绝周期：结构性超预算与是否成环是两个不同的判断。
 */
export function isOuterTwoCycle(input: OuterTwoCycleInput): boolean {
  const { previousInput, currentInput, nextInput, currentSignature, signatureHistory, tolerance } = input
  return previousInput !== null
    && signatureHistory.length >= 2
    && currentSignature === signatureHistory[signatureHistory.length - 2]
    && Math.abs(nextInput - previousInput) < tolerance
    && Math.abs(nextInput - currentInput) >= tolerance
}

/** 环内停点选点的输入成员：只带选点需要的四个量（失衡输入/输出、离散截断、时间自洽度）。 */
export interface OuterCyclePickMember {
  /** 该轮输入的失衡次数（环内映射的自变量）。 */
  stunIn: number
  /** 该轮输出的失衡次数（= 下一轮输入）。 */
  next: number
  /** 离散自洽度：终局整数化后的装配截断秒数（装不下 = 大）。 */
  disc: number
  /** 时间自洽度：|预算 − Σ物化净占用| + 截断秒数；无结果成员由调用方给 `+Infinity`。 */
  time: number
}

/** 选点容差：`stun` 与判稳/判环同源，`disc`/`time` 分别对应两条同级门槛。 */
export interface OuterCyclePickTolerance {
  stun: number
  disc: number
  time: number
}

export interface OuterCyclePickResult {
  /** 选中成员在**入参数组**中的下标（不是过滤后候选数组的下标）。 */
  index: number
  /** 选中成员不是最后一轮（被过滤或被更优者顶替）时为 true。 */
  pickedEarlier: boolean
}

/**
 * 环内停点选点（从 `useResourceCalc#pickCanonical` 抽出的纯函数，逐位零 delta）。
 *
 * 判据按序（规则来历与实测反例见 `useResourceCalc` 内 `pickCanonical` 的长注释）：
 *   ⓪ **零窗成员不参选**：`stunIn >= tol.stun` 的为带窗成员；有带窗成员时只在带窗成员里选
 *      （过滤掉任何成员即 `pickedEarlier = true`），全员零窗（真 0 失衡队）则全体参选。
 *   ① **失衡自洽度** `|next − stunIn|` 最小：差 < −tol.stun 时胜出（容差与判稳/判环同源）。
 *   ⓪′ **离散自洽度**：失衡同级时，截断秒数差 < −tol.disc 的成员胜出。
 *   ② **时间自洽度**：前两条同级时，时间差须 > tol.time 才分高下（≤ 视为同级）。
 *   ③ 同级取最后一轮（与旧行为一致）。
 *
 * ⚠ `disc`/`time` 允许为 `+Infinity`（无结果成员）：差值为 `Infinity − Infinity = NaN` 时所有比较
 * 为 false ⇒ 保持「无结果成员永不因该维度胜出」的既有行为。不要改写比较式来"修" NaN。
 */
export function pickOuterCycleMember(
  members: readonly OuterCyclePickMember[],
  tol: OuterCyclePickTolerance,
): OuterCyclePickResult {
  const candidateIdx: number[] = []
  for (let i = 0; i < members.length; i++) {
    if (members[i].stunIn >= tol.stun) candidateIdx.push(i)
  }
  const idx = candidateIdx.length > 0 ? candidateIdx : members.map((_, i) => i)
  let pickedEarlier = idx.length < members.length
  let bestIdx = idx[idx.length - 1]
  for (let j = idx.length - 2; j >= 0; j--) {
    const c = members[idx[j]]
    const best = members[bestIdx]
    const dStun = Math.abs(c.next - c.stunIn) - Math.abs(best.next - best.stunIn)
    const dDisc = c.disc - best.disc
    const better = dStun < -tol.stun
      || (dStun <= tol.stun && dDisc < -tol.disc)
      || (dStun <= tol.stun && dDisc <= tol.disc && c.time < best.time - tol.time)
    if (better) { bestIdx = idx[j]; pickedEarlier = true }
  }
  return { index: bestIdx, pickedEarlier }
}

/**
 * 周期 ≥3 的长环识别（从 `runOuterLoop` 耗尽后的 lag 双层循环抽出，逐位零 delta）。
 *
 * 判据 = 签名相等（同相位反馈）且同相位失衡输入在容差内；`lag` 从 3 起、命中第一个即返回。
 * 返回命中周期；无命中返回 `null`。周期 2 的轨迹会在 lag=4 命中（lag 从 3 起的既有行为）：
 * 失衡值振荡的 2-循环由 `isOuterTwoCycle` 在迭代中先行接住；**失衡值恒定、只有反馈签名在两态间
 * 交替**的 2-周期它不接（要求相邻失衡值差 ≥ 容差），会耗尽迭代后走到这里——实测样本：叶瞬光 +
 * 琉音 + 照 轴退化后 interactionScale 0.25 档的 4 成员环（2026-09-24 探针，见 outerCycle.test.ts 语料表）。
 */
export function findOuterLongCycleLag(
  sigHistory: readonly string[],
  stunHistory: readonly number[],
  tolerance: number,
): number | null {
  for (let lag = 3; lag < sigHistory.length; lag++) {
    for (let k = lag; k < sigHistory.length; k++) {
      if (sigHistory[k] !== sigHistory[k - lag]) continue
      if (Math.abs(stunHistory[k] - stunHistory[k - lag]) >= tolerance) continue
      return lag
    }
  }
  return null
}
