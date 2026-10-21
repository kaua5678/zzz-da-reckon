import { computed, type ComputedRef } from 'vue'
import type { StunPoolResult } from '@/types/resource'
import { effectiveBattleTime, stunWindowDuration, decomposeStunWindows } from '@/core/effectiveTime'

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
 * ⚠ **层级**：`TimeBasisCfg` 与 `windowDuration` 都在这里算（`@/core` 只许编排层 import），
 * 展示层只传 `enemy` 形状对象。这条是 exhibition-layer ratchet 的硬约束。
 */
export interface StunDiscreteDisplay {
  /** 完整失衡次数 */
  full: number
  /** 残疾失衡的完成率 ∈ [0,1)；null = 没有残疾段 */
  frac: number | null
  /** 展示文案：「已完成 N 失衡 + 1 次残疾失衡（完成率 xx%）」；无残疾段时 null */
  label: string | null
}

/** 只取本模块需要的字段（`configStore.enemy` 结构上满足） */
export interface StunDisplayEnemy {
  battleTime: number
  invincibleTime: number
  stunTime: number
}

/**
 * @param pool 失衡池结果（`stunPoolResult`）—— 提供计划/池次数 K
 * @param enemy 敌人配置（提供 battleTime / invincibleTime / stunTime）
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
    const K = Math.max(0, sp.stunCount)
    if (K <= 0) return null
    const W = stunWindowDuration(en.stunTime, readBonus())
    const eff = effectiveBattleTime(en)
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
