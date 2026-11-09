/**
 * 防御**三通道**读数入口（单一事实源，2026-11-09 用户裁决）。
 *
 * 与 `core/resistanceChannels.ts` 同构：抗性区的「怪物身上减抗 vs 自身无视抗性」二分，
 * 在防御区同样成立（用户口径「减防是不是也分直伤和异常和通用」）。
 *
 * | 通道 | 读数入口 | 直伤 | 异常 |
 * |---|---|---|---|
 * | **通用**（怪物身上减防） | `enemyDefReductionOf` | ✅ | ✅ |
 * | **直伤无视**（自身） | `selfDefIgnoreOf` | ✅ | ❌ |
 * | **异常专属** | 面板字段 `enemyAnomalyDefReduction`（异常链直读） | ❌ | ✅ |
 * | **强击专属** | 面板字段 `enemyAssaultDefReduction`（异常链仅物理读） | ❌ | ✅ |
 *
 * 异常侧没有做成 `selfDefIgnoreOf(p, 'anomaly', …)`：`enemyAnomalyDefReduction` /
 * `enemyAssaultDefReduction` 是**存量字段**且语义本就正确（修前没有直伤族的对照，
 * 所以异常侧从来没读错过），再包一层只会多一次跳转。
 *
 * ## 判据
 * `src/core/__tests__/defenseChannels.test.ts`（三通道读数 + 引擎行为面：
 * 直伤无视**不进**异常、异常专属不进直伤、怪物减防两边都吃）。
 */
import type { PanelValues } from '@/types/catalog'
import { getTargetedElementStat, getTargetedStat } from './buff'
import {
  GENERIC_DEF_REDUCTION_STAT,
  defIgnoreDirectElementStatId,
  defIgnoreDirectStatId,
} from '@/utils/defenseChannels'

/**
 * 通用减防（**降低怪物身上的防御**，结算区 debuff）：直伤与异常**都吃**。
 *
 * 含定向（`enemyDefReduction__basic`）与元素（`enemyFireDefReduction`）两类加成；
 * 元素键走 `elementStatKey('enemyDef')` 同口径（变种读基础元素、烈霜读冰）。
 */
export function enemyDefReductionOf(
  panel: PanelValues,
  element?: string | null,
  skillDamageTarget?: string,
): number {
  return getTargetedStat(panel, GENERIC_DEF_REDUCTION_STAT, skillDamageTarget)
    + getTargetedElementStat(panel, 'enemyDef', element, skillDamageTarget)
}

/**
 * 自身**直伤**无视防御：**只有直伤链吃**，异常链读不到（异常链只读通用 + 异常专属 + 强击专属）。
 *
 * @param extra 调用方自带的额外量（行级 moveId 限定），与面板值**加算**
 */
export function selfDefIgnoreOf(
  panel: PanelValues,
  element?: string | null,
  skillDamageTarget?: string,
  extra = 0,
): number {
  // 全元素一条 + 元素一条；⚠ 元素未知时必须**只**读全元素（不能回落到全元素再读一次 ⇒ 双计）
  const elementStat = defIgnoreDirectElementStatId(element)
  return extra
    + getTargetedStat(panel, defIgnoreDirectStatId(), skillDamageTarget)
    + (elementStat ? getTargetedStat(panel, elementStat, skillDamageTarget) : 0)
}

/** 一次性取直伤侧两段（调用方直接喂 `defenseMultiplierDetail` 的第 2 参） */
export function directDefReductionOf(
  panel: PanelValues,
  element?: string | null,
  skillDamageTarget?: string,
  extraIgnore = 0,
): number {
  return enemyDefReductionOf(panel, element, skillDamageTarget)
    + selfDefIgnoreOf(panel, element, skillDamageTarget, extraIgnore)
}
