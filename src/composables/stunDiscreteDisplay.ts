import { computed, type ComputedRef } from 'vue'
import type { StunPoolResult } from '@/types/resource'
import { effectiveBattleTime, stunWindowDuration } from '@/core/effectiveTime'

/**
 * 只取本模块需要的三字段（`configStore.enemy` 结构上满足此形状）。
 * 不 import `TimeBasisCfg`：它在 `effectiveTime.ts` 里是**模块私有**的（未 export），
 * 而本模块只需结构化兼容即可通过 `effectiveBattleTime` 的参数检查。
 */
export interface StunDisplayEnemy {
  battleTime: number
  invincibleTime: number
  stunTime: number
}

/**
 * **连续失衡的「残疾失衡」展示映射**（2026-10-21 round 26，用户口径）。
 *
 * 用户原话：
 * > 「之前显示类似已完成完整 4 失衡的地方，如果遇到连续失衡，可以显示
 * >  **已完成 3 失衡 + 1 次残疾失衡，残疾失衡完成率 xx%**」
 * > 「**攒满了后还有残疾失衡，因为一次完整失衡是 18s 左右，假设你积攒完了，
 * >  剩下的时间不够 18s 你的招式就打不完**」
 *
 * ## 语义（用户两次澄清后的最终口径）
 *
 * 残疾失衡 = **窗口已经开启（失衡值攒满），但剩余战斗时间不足以跑完这一窗** ⇒ 招式打不完。
 *
 * 判据 = 最后一窗能不能放下：
 * ```
 * 第 N 窗（index = N−1）起点 = (N−1) × W
 * 剩余 = effTime − (N−1) × W
 * 若 剩余 < W ⇒ 这一窗是残疾窗，完成率 = 剩余 / W
 * ```
 *
 * ## 与「攒条进度」的区别（两者都真实，但只有本模块是用户要的那个）
 *
 * | | 攒条进度 | 残疾失衡（本模块） |
 * |---|---|---|
 * | 语义 | 第 N+1 次攒了 xx% 但没攒满 | 攒满了、开了窗，但时间不够跑完 |
 * | 有无易伤 | **没有**（没开启） | **有**（窗口已开） |
 * | 载体 | `continuousStunCount` 的小数部分 | 排窗数 × 窗长 vs effTime |
 *
 * ⚠ 实测（`auto-1521-1481-1491`，W=18、effTime=180）：锁 K=11 时
 * `slots=11 / Σeff=180/180 / 末窗 eff=0.0 & clipped=true` ⇒ 第 11 窗**开了但零时间**。
 * 自由态 `cont=9.80 < 10` 不触发；机制真实存在，用户描述的场景可达。
 *
 * ⚠ **锁定失衡次数**（`stunCountLock >= 0`）时照常显示：锁 K 只是「要打 K 次」，
 * 第 K 次本身仍可能被时间截断（K=11 实测正是锁定态）。
 */
export interface StunDiscreteDisplay {
  /** 完整失衡次数（装得下的窗口数） */
  full: number
  /** 残疾失衡的完成率 ∈ [0,1)；null = 没有残疾段 */
  frac: number | null
  /** 展示文案：「已完成 N 失衡 + 1 次残疾失衡（完成率 xx%）」；无残疾段时 null */
  label: string | null
}

/**
 * @param pool 失衡池结果（`stunPoolResult`）—— 提供排窗数 `stunCount`
 * @param enemy 敌人配置（提供 `battleTime` / `invincibleTime` / `stunTime`）
 * @param teamStunDurationBonus 全队失衡延时加成（秒；面板合计，缺省 0）
 */
export function useStunDiscreteDisplay(
  pool: ComputedRef<StunPoolResult | null | undefined> | (() => StunPoolResult | null | undefined),
  enemy: ComputedRef<StunDisplayEnemy | null | undefined> | (() => StunDisplayEnemy | null | undefined),
  teamStunDurationBonus: ComputedRef<number> | (() => number) = () => 0,
): ComputedRef<StunDiscreteDisplay | null> {
  const readPool = typeof pool === 'function' ? pool : () => pool.value
  const readEnemy = typeof enemy === 'function' ? enemy : () => enemy.value
  const readBonus = typeof teamStunDurationBonus === 'function' ? teamStunDurationBonus : () => teamStunDurationBonus.value
  return computed<StunDiscreteDisplay | null>(() => {
    const sp = readPool()
    const en = readEnemy()
    if (!sp || !en) return null
    const planned = Math.max(0, Math.floor(sp.stunCount))
    if (planned <= 0) return null
    const W = stunWindowDuration(en.stunTime, readBonus())
    const eff = effectiveBattleTime(en)
    if (!(W > 0) || !(eff > 0)) return null
    /**
     * 最后一窗（第 `planned` 窗，index = planned−1）的可用时间 = `eff − (planned−1) × W`。
     * 若 < W ⇒ 这一窗装不下 ⇒ 残疾，完成率 = 可用 / W。
     */
    const room = eff - (planned - 1) * W
    if (room >= W - 1e-9) {
      return { full: planned, frac: null, label: null }
    }
    const frac = Math.max(0, Math.min(1, room / W))
    const full = planned - 1
    return {
      full,
      frac,
      label: `已完成 ${full} 失衡 + 1 次残疾失衡（完成率 ${(frac * 100).toFixed(1)}%）`,
    }
  })
}
