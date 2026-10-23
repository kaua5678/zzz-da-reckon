import { computed, type ComputedRef } from 'vue'
import type { StunPoolResult } from '@/types/resource'
import { decomposeStunWindows } from '@/core/effectiveTime'

/**
 * **连续失衡的「残疾失衡」展示映射**（2026-10-21 round 27，用户口径）。
 *
 * 用户原话（两次澄清，逐字）：
 * > 「之前显示类似已完成完整 4 失衡的地方，如果遇到连续失衡，可以显示
 * >  **已完成 3 失衡 + 1 次残疾失衡，残疾失衡完成率 xx%**」
 * > 「**真正难做的就是最后一次达到失衡量但是不完整怎么算，那个不等式的关系**」
 *
 * ## 语义
 *
 * 残疾失衡 = **最后一次已经达到失衡量（窗口开启），但剩余战斗时间不足以跑完整窗** ⇒ 招式打不完。
 *
 * 它**不是** `floor`（那只是离散次数），也**不是**「池里没攒满的进度」：
 * - 池没攒满 ⇒ 第 N+1 次**没开启** ⇒ 无易伤、无残疾窗（纯进度读数，不属本模块）
 * - 池攒满、但 `K × W > effTime` ⇒ 第 N+1 窗**开了但装不下** ⇒ **本模块的残疾窗**
 *
 * ## 不等式关系（用户要的「那个不等式」）
 *
 * ```
 * 需求 K × W 秒，可用 effTime 秒
 * K × W ≤ effTime  ⇒ 全部完整（无残疾）
 * K × W >  effTime  ⇒ 前 n = floor(effTime / W) 窗完整
 *                     第 n+1 窗分到 room = effTime − n × W 秒，完成率 = room / W（可为 0%）
 * ```
 *
 * ⚠ **实测**（`auto-1521-1481-1491`，W=18、effTime=180）：锁 K=11 时 `cov` 仍是 1.0
 * （`stunWindowFraction` 的 `min(1,·)` 抹平了），但本模块报 `full=10 / hasPartial=true / 0%`
 * ⇒ 能区分「刚好装满（K=10）」与「多打一次打不完（K=11）」。
 *
 * ⚠ 覆盖率**不变**（`effectiveSeconds` 与 `stunWindowFraction` 逐位一致，有测试锁）——
 * 本模块只把被 `min` 抹掉的信息还原给展示层。
 *
 * ⚠ **层级**：`@/core` 只许编排层 import ⇒ 本模块只收**数值**（池 / 窗长 / 有效时长），
 * 展示层不读 store、不 import 引擎。这条是 exhibition-layer ratchet 的硬约束。
 *
 * ⚠ **禁止在 setup 顶层读 `.value`（2026-10-22 事故）**：三个页面曾写
 * `const label = useStunDiscreteDisplay(() => stunPoolResult.value).value?.label ?? null` ——
 * ① `stunPoolResult` 在同一模块**声明在后面** ⇒ 立即求值踩 TDZ，`.vue` 切页即抛
 * `Cannot access 'stunPoolResult' before initialization`（setup 直接中断、整页白屏）；
 * ② 即便声明顺序对，`.value` 也把文案冻成首帧快照（部署新 run 后不再更新）。
 * ⇒ 正确用法 = 把 ref 原样交给模板（模板自动解包）。判据 `stunDiscreteDisplay.test.ts`。
 */
/** 一次失衡分解的展示载荷（纯读数，不参与计算） */
export interface StunDiscreteDisplay {
  /** 完整失衡次数 */
  full: number
  /** 残疾失衡的完成率 ∈ [0,1)；null = 没有残疾段 */
  frac: number | null
  /** 展示文案：「已完成 N 失衡 + 1 次残疾失衡（完成率 xx%）」；无残疾段时 null */
  label: string | null
}

/**
 * 输入契约：三个**取值函数**（不是 store、不是数值快照）。
 *
 * ① 取值函数 ⇒ 每次重算都读当下的值（不会锁死成 setup 那一刻的读数）；
 * ② 不读 store ⇒ 调用方不必在 setup 顶层读 `.value`（TDZ 事故的来源，见文件头）。
 *
 * 窗长与有效时长一律取**引擎那一份**：`useResourceCalc#windowDuration`（已含全队失衡延时加成）
 * 与 `useResourceCalc#stunEffectiveTime`；曲线页取 `CurvePointPoolResult` 的同一次求值快照。
 * ⇒ 本模块不再自己套 `stunTime + 4 + 加成` 公式（旧写法漏传加成 ⇒ 琉音/仪玄队按 16s 算、引擎按 18s）。
 */
export interface StunDiscreteInputs {
  /** 失衡池结果（`useResourceCalc#stunPoolResult`；曲线页 = 该档资源池的 `stunPool`） */
  pool: () => StunPoolResult | null | undefined
  /** 名义窗长 W（秒；`useResourceCalc#windowDuration`，已含全队失衡延时） */
  windowDuration: () => number | null | undefined
  /** 有效战斗时间（秒；`useResourceCalc#stunEffectiveTime` = 战斗时间 − 无敌时间） */
  effectiveTime: () => number | null | undefined
}

/**
 * @returns computed 载荷。**调用方把 ref 原样交给模板**（自动解包），不要在 setup 顶层 `.value`。
 */
export function useStunDiscreteDisplay(input: StunDiscreteInputs): ComputedRef<StunDiscreteDisplay | null> {
  return computed<StunDiscreteDisplay | null>(() => {
    const sp = input.pool()
    const W = input.windowDuration()
    const eff = input.effectiveTime()
    if (!sp || W == null || eff == null || !(W > 0)) return null
    const K = Math.max(0, sp.stunCount)
    if (K <= 0) return null
    const d = decomposeStunWindows(K, W, eff)
    if (!d.hasPartial) return { full: d.fullWindows, frac: null, label: null }
    const frac = d.partialFraction
    return {
      full: d.fullWindows,
      frac,
      label: `已完成 ${d.fullWindows} 失衡 + 1 次残疾失衡（完成率 ${(frac * 100).toFixed(1)}%）`,
    }
  })
}
