/**
 * 防御**三通道**的字段名生成（单一事实源，2026-11-09 用户裁决）。
 *
 * ## 与抗性三通道同构（见 utils/resistanceChannels.ts）
 *
 * 用户口径「减抗分怪物身上 / 自身无视」同样适用于**减防**——防御区与抗性区都是结算区，
 * 通道归属规则一致：
 *
 * | 通道 | 面板字段族 | 语义 | 直伤 | 异常 |
 * |---|---|---|---|---|
 * | **通用** | `enemyDefReduction` / `enemy{El}DefReduction` | **降低怪物身上的防御**（结算区 debuff） | ✅ | ✅ |
 * | **直伤无视** | `enemyDefIgnoreDirect` / `enemy{El}DefIgnoreDirect` | 自身「造成伤害无视防御」 | ✅ | ❌ |
 * | **异常专属** | `enemyAnomalyDefReduction` | 异常伤害专属无视防御 | ❌ | ✅ |
 * | **强击专属** | `enemyAssaultDefReduction` | 强击伤害无视防御（仅物理强击） | ❌ | ✅ |
 *
 * ## 为什么直伤族必须独立（修前的错误形态）
 *
 * 修前原文「造成伤害无视 N% 防御」一律写进 `enemyDefReduction` 族，而该族被直伤与异常结算
 * **同时**读取 ⇒ 只作用于直伤的自身无视防御被异常也吃掉，异常伤害偏高。
 * 与抗性同理：两族在 `defenseMultiplierDetail` 里同形（有效防御 = 基础 × (1 − 降低/100)），
 * 合并写法**静默通过全部既有测试**。
 *
 * ## 分工
 *
 * - 本文件（utils 层）：**只有字段名与 id 生成**，零运行时依赖（与 `resistanceChannels` 同层同形）。
 * - 读数入口：`core/defenseChannels.ts`（`enemyDefReductionOf` / `selfDefIgnoreOf`）。
 * - 乘法与钳制仍归 `core/damageMultipliers.ts`（CC-219 单一来源不破）。
 *
 * 新增字段一律经本文件生成，**不要手拼** `enemyFireDefIgnoreDirect` 这类字符串。
 */
// ⚠ 从**叶子模块**取元素常量，不要从 `enemyDebuffStats` 取（会形成模块初始化环，见 damageElements.ts 头注释）
import { DAMAGE_ELEMENTS, ELEMENT_FIELD_PREFIX } from '@/utils/damageElements'

/** 通用通道（**降低怪物身上的防御**）全元素字段名：直伤与一切异常都读它 */
export const GENERIC_DEF_REDUCTION_STAT = 'enemyDefReduction'

/** 异常专属通道（存量字段，语义本就正确，只是此前没有直伤族的对照） */
export const ANOMALY_DEF_REDUCTION_STAT = 'enemyAnomalyDefReduction'

/** 强击专属通道（仅物理强击读） */
export const ASSAULT_DEF_REDUCTION_STAT = 'enemyAssaultDefReduction'

/** 自身**直伤**无视防御的字段后缀：全元素 = `enemy` + 本后缀；元素版 = `enemy` + [元素前缀] + 本后缀 */
export const DEF_IGNORE_DIRECT_SUFFIX = 'DefIgnoreDirect'

/** 自身直伤无视防御：全元素字段名 */
export function defIgnoreDirectBaseStatId(): string {
  return `enemy${DEF_IGNORE_DIRECT_SUFFIX}`
}

/**
 * 自身直伤无视防御字段名：全元素 `enemyDefIgnoreDirect` / 元素限定 `enemyFireDefIgnoreDirect`。
 * 未知元素（如已删除的 lumiflux）按全元素字段回落——与 `enemyDebuffStatId` 的兜底同形。
 */
export function defIgnoreDirectStatId(element?: string | null): string {
  const prefix = element && element !== 'all' ? ELEMENT_FIELD_PREFIX[element] : undefined
  return `enemy${prefix ?? ''}${DEF_IGNORE_DIRECT_SUFFIX}`
}

/** 元素限定的自身直伤无视防御字段名；无元素 / all / 未知元素 ⇒ undefined（区别于回落） */
export function defIgnoreDirectElementStatId(element?: string | null): string | undefined {
  if (!element || element === 'all') return undefined
  const prefix = ELEMENT_FIELD_PREFIX[element]
  return prefix ? `enemy${prefix}${DEF_IGNORE_DIRECT_SUFFIX}` : undefined
}

/** 全部自身直伤无视防御 statId：1 全元素 + 6 元素 = 7 条（供 buff TARGETABLE / statMeta / 断言） */
export const GENERATED_DEF_IGNORE_STAT_IDS: string[] = [
  defIgnoreDirectBaseStatId(),
  ...DAMAGE_ELEMENTS.map(element => defIgnoreDirectStatId(element)),
]
