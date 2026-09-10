/**
 * 失衡计划值 → **计数** 的投影（C7「计数投影统一」的实验内核，2026-09-10）。
 *
 * **为什么需要**：外层不动点的失衡次数是**实数**（为稳定性 + 时间可行性：非失衡占比缩放、超窗口残失衡
 * 按残差时间系数折、非失衡时间不足时反解——见 `useResourceCalc.ts` 外层环）。但下游有一批地方把
 * 它**当次数用**（`chainCountTotal = chainCountPerStun × 失衡计划值`、喧响/能量奖励同理），于是
 * **终局出现"半次连携"**：实测 127 预设里 **23.5% 的计数槽非整数、其中 91% 是连携**。
 *
 * **口径（用户 2026-09-10）**：离散动作（连携/强特/轮数/链数）的次数应当**整数化**，
 * 时间上的缺口用**合轴率/预算宽容**吸收，而不是靠折半次去"缝合"。连续释放型动作（如柏妮思可调时长的
 * 喷火式强特）实数才是它的物理量，**不参与本投影**（那些由模块自己决定，不走这个通道）。
 *
 * **语义边界（重要）**：本函数只服务「计数通道」。时间账（窗口分配 / 覆盖率 / `stunSeconds`）
 * 与不动点迭代**继续用实数**——那里实数是对的，投影不得回灌到求解器，否则会把坑25 已经解决的
 * 整数阶梯 2-循环请回来。
 *
 * 判据：`__tests__/countFractionProbe.test.ts`（`PROBE_COUNT_FRAC=1` 扫小数次数；
 * `PROBE_STUN_PROJ=floor|round|ceil` 做四态 A/B）。
 */
import type { StunPlanProjection } from '@/types/resource'

/** 投影方式全集（顺序 = `configStore` 机制参数 `time.stunPlanProjection` 的编码 0..3） */
export const STUN_PLAN_PROJECTION_MODES: readonly StunPlanProjection[] = ['off', 'floor', 'round', 'ceil'] as const

/** 机制参数（整数编码）→ 投影方式；越界回落 `'off'`（现行口径，安全降级） */
export function stunPlanProjectionFromCode(code: number): StunPlanProjection {
  const i = Math.trunc(code)
  return STUN_PLAN_PROJECTION_MODES[i] ?? 'off'
}

/**
 * 把失衡**计划值**投影成「次数」用的值。
 * · `'off'`：原样返回（现行口径，0 delta）
 * · `'floor'`：只算**打完整**的失衡窗（保守；末窗被战斗时间切断时不给连携）
 * · `'round'`：半窗以上算一次
 * · `'ceil'`：只要进了失衡就给一次（乐观；时间缺口靠合轴率/预算宽容吸收）
 */
export function projectStunPlanForCounts(plan: number, mode: StunPlanProjection = 'off'): number {
  if (!Number.isFinite(plan)) return plan
  switch (mode) {
    case 'floor': return Math.floor(plan)
    case 'round': return Math.round(plan)
    case 'ceil': return Math.ceil(plan)
    default: return plan
  }
}
