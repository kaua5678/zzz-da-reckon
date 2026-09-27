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
export const STUN_PLAN_PROJECTION_MODES: readonly StunPlanProjection[] = ['off', 'floor', 'round', 'ceil', 'physical'] as const

/**
 * 机制参数 `time.stunPlanProjection` 未设置时的**缺省编码**（单一来源；0 = `'off'`）。
 * CC-144（第 168 轮）试切 4 = `'physical'` 未落地：全量 33 条红，其中两条是不变量破缺
 * （seedInvariance 种子路径依赖、timeLedgerInvariants 叶瞬光队赠行单一口径），见 docs/mcp-stun-dual-source.md §9。
 * 以后要切只改这里；测试需要「回到缺省」时也读这里，别写死 0。
 */
export const DEFAULT_STUN_PLAN_PROJECTION_CODE: number = 0

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
 * · `'physical'`（CC-140，第 164 轮）：改用上一外层轮失衡池的**物理次数**（`physical` 参数 = floor(N*)）；
 *   缺省（首轮）回落计划值。为什么：外层计划值被必要时间约束压低（78/104 队），21/104 队出现「失衡 N 次、
 *   失衡连携 0 次」；本模式把计数通道对齐到伤害侧读的物理次数。实测与未决项见 docs/mcp-stun-dual-source.md §5。
 */
/**
 * **计数通道失衡次数的单一入口**（CC-141，第 165 轮）：按 `config` 的投影模式取计数用的失衡次数。
 * 所有「把失衡次数当次数乘」的消费点（连携数、赠送供给 `crossAgentSupplyAt` / `ultimateGiftOf`、
 * 赠行规格 `ultimateGiftRowSpec`）必须走这里，否则 `'physical'` 模式下账本预留与物化行口径分裂
 * （实测 auto-1321-1481-1491：账本按计划值 0.69 预留 4 次琉音赠大，物化按物理 4 次失衡给 5 次 ⇒ 净占用超预算 2.37s，
 * 与交互降配档无关，S3 无杠杆）。`'off'` 下恒等 ⇒ 0 delta。
 */
export function stunCountForCountChannel(config: {
  stunCount?: number
  stunPlanProjection?: StunPlanProjection
  stunCountPhysical?: number
}): number {
  return projectStunPlanForCounts(config.stunCount ?? 0, config.stunPlanProjection ?? 'off', config.stunCountPhysical)
}

export function projectStunPlanForCounts(plan: number, mode: StunPlanProjection = 'off', physical?: number): number {
  if (!Number.isFinite(plan)) return plan
  switch (mode) {
    case 'physical': return physical != null && Number.isFinite(physical) ? physical : plan
    case 'floor': return Math.floor(plan)
    case 'round': return Math.round(plan)
    case 'ceil': return Math.ceil(plan)
    default: return plan
  }
}
