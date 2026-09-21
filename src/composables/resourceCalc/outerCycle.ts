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
    `${out.banyueTopUp?.parry},${out.banyueTopUp?.dual}`,
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
