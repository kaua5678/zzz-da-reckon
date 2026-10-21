import { computed, type ComputedRef } from 'vue'
import type { StunPoolResult } from '@/types/resource'
import { continuousStunCount } from '@/core/stunPool'

/**
 * **连续失衡的「残疾失衡」展示映射**（2026-10-21 round 25，用户口径）。
 *
 * 用户原话：
 * > 「之前显示类似已完成完整 4 失衡的地方，如果遇到连续失衡，可以显示
 * >  **已完成 3 失衡 + 1 次残疾失衡，残疾失衡完成率 xx%**」
 *
 * ## 语义（实测确认：纯读数，零计算影响）
 *
 * 池的连续读数 `cont = continuousStunCount(pool)`：
 * - **完整失衡** = `floor(cont)` —— 这些窗口真的开启了，**吃易伤**（覆盖率 = floor × W）；
 * - **残疾失衡** = 小数部分 —— 第 N+1 次**攒了 xx% 但没攒满**，**没开启 ⇒ 不吃易伤**
 *   （用户口径「积攒 100% 失衡值前都没失衡易伤」）。
 *
 * ⇒ 本模块**只做展示映射**，不写回任何引擎量：覆盖率 / 伤害 / 迭代全部不知道它的存在。
 * 显示它 = 如实告诉用户「你还差 xx% 就能多打一次失衡」，不是美化。
 *
 * ⚠ **不是**「倒计时被战斗时间截断」——那种状态在本引擎**物理不可达**
 * （窗口内不攒条 ⇒ 负反馈 ⇒ 平衡点恒满足 `K × W ≪ effTime`；实测全库 0 队
 * `cont > floor(effTime/W)`，见 `docs/STUN_CONTINUOUS_LASTWINDOW.md` §42）。
 *
 * ⚠ **层级**：本文件住 `composables/`（编排层），`components/views` 不得直接 import `@/core`
 * （exhibition-layer ratchet）。故 `continuousStunCount` 只在这里出现，组件读 prop。
 */
export interface StunDiscreteDisplay {
  /** 池的连续次数（含未攒满的进度） */
  continuous: number
  /** 完整失衡次数 = floor(continuous) */
  full: number
  /** 残疾失衡的完成率 ∈ [0,1)；0 = 没有残疾段 */
  frac: number
  /** 展示文案：「已完成 N 失衡 + 1 次残疾失衡（完成率 xx%）」；无残疾段时 null */
  label: string | null
}

/**
 * @param pool 失衡池结果（`stunPoolResult`）
 * @param locked 是否锁定失衡次数（`enemy.stunCountLock >= 0`）。锁 K = 用户明确要打 K 次，
 *   池里多攒的进度不兑现成「下次」⇒ 不显示残疾段，显示会误导。
 */
export function useStunDiscreteDisplay(
  pool: ComputedRef<StunPoolResult | null | undefined> | (() => StunPoolResult | null | undefined),
  locked: ComputedRef<boolean> | (() => boolean) = () => false,
): ComputedRef<StunDiscreteDisplay | null> {
  const readPool = typeof pool === 'function' ? pool : () => pool.value
  const readLocked = typeof locked === 'function' ? locked : () => locked.value
  return computed<StunDiscreteDisplay | null>(() => {
    const sp = readPool()
    if (!sp || readLocked()) return null
    const continuous = continuousStunCount(sp)
    const full = Math.floor(continuous + 1e-9)
    const frac = Math.max(0, Math.min(1, continuous - full))
    const label = frac <= 1e-9
      ? null
      : `已完成 ${full} 失衡 + 1 次残疾失衡（完成率 ${(frac * 100).toFixed(1)}%）`
    return { continuous, full, frac, label }
  })
}
