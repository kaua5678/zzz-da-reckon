/**
 * 抗性**三通道**的字段名生成（单一事实源，2026-11-09 用户裁决）。
 *
 * ## 用户口径（原话）
 * > 「减抗的实现分为两种，一个是降低怪物的抗性，这相当于作用在怪物身上的结算区，直伤和异常
 * >   比如乱流灼烧强击之类都能吃。还有一种是加自己的无视抗性，这种抗性只有自己直伤能无视，
 * >   所谓（造成伤害无视抗性），这种抗性没有降低 boss 身上的乘区，所以异常状态吃不到这种减抗。」
 * > 「只有怪物身上属性抗性降低和造成异常伤害时无视抗性，才能给异常吃。
 * >   所以可以分为三种情况：直伤抗性，异常抗性，通用抗性。」
 *
 * ## 三条通道
 *
 * | 通道 | 面板字段族 | 语义 | 直伤 | 异常 |
 * |---|---|---|---|---|
 * | **通用** | `enemyResReduction` / `enemy{El}ResReduction` | **降低怪物身上的抗性**（结算区 debuff） | ✅ | ✅ |
 * | **直伤无视** | `enemyResIgnoreDirect` / `enemy{El}ResIgnoreDirect` | 自身「造成伤害无视抗性」 | ✅ | ❌ |
 * | **异常无视** | `enemyResIgnoreAnomaly` / `enemy{El}ResIgnoreAnomaly` | 自身「造成异常伤害时无视抗性」 | ❌ | ✅ |
 *
 * ## 为什么必须拆（修前的错误形态）
 *
 * 修前三类文本**一律**写进 `enemyResReduction`，而该字段被直伤与异常结算**同时**读取 ⇒
 * 原文「造成伤害无视目标 X% 抗性」（游戏里只作用于直伤）被异常结算也吃掉，**异常伤害系统性偏高**；
 * 又因为两族在 `resistanceMultiplierDetail` 里同形（有效抗性 = 基础 − 降低 − 无视，线性加算），
 * 合并写法**静默通过全部既有测试**。
 *
 * ## 分工
 *
 * - 本文件（utils 层）：**只有字段名与 id 生成**，零运行时依赖（与 `enemyDebuffStats` 同层同形）。
 * - 读数入口：`core/resistanceChannels.ts`（`enemyResReductionOf` / `selfResIgnoreOf`）。
 * - 乘法与钳制仍归 `core/damageMultipliers.ts`（CC-219 单一来源不破）。
 *
 * 新增字段一律经本文件生成，**不要手拼** `enemyFireResIgnoreDirect` 这类字符串。
 */
// ⚠ 从**叶子模块**取元素常量，不要从 `enemyDebuffStats` 取：后者要用 `resIgnoreStatId` 归一旧别名，
// 两边互相 import 会形成模块初始化环（ESM 下 TDZ 崩）。见 utils/damageElements.ts 头注释。
import { DAMAGE_ELEMENTS, ELEMENT_FIELD_PREFIX } from '@/utils/damageElements'

/** 抗性通道：直伤 / 异常。（「通用」= 怪物侧减抗，不是通道；它由 `GENERIC_RES_REDUCTION_STAT` 表示） */
export type ResistanceChannel = 'direct' | 'anomaly'

export const RESISTANCE_CHANNELS: readonly ResistanceChannel[] = ['direct', 'anomaly'] as const

export const RESISTANCE_CHANNEL_LABEL: Record<ResistanceChannel, string> = {
  direct: '直伤',
  anomaly: '异常',
}

/**
 * 通用通道（**降低怪物身上的抗性** = 结算区 debuff）的全元素字段名：直伤与一切异常都读它。
 *
 * 历史名保留（`enemyResReduction` 在 2026-11-09 前同时被当「减抗」与「无视抗性」用，现只剩「减抗」语义）。
 */
export const GENERIC_RES_REDUCTION_STAT = 'enemyResReduction'

/** 自身无视抗性字段的**基础名**（`enemy` + 本后缀）；元素版 = `enemy` + [元素前缀] + 本后缀 */
export const RES_IGNORE_SUFFIX: Record<ResistanceChannel, string> = {
  direct: 'ResIgnoreDirect',
  anomaly: 'ResIgnoreAnomaly',
}

/** 该通道的全元素字段名 */
export function resIgnoreBaseStatId(channel: ResistanceChannel): string {
  return `enemy${RES_IGNORE_SUFFIX[channel]}`
}

/**
 * 自身无视抗性字段名：全元素 `enemyResIgnoreDirect` / 元素限定 `enemyFireResIgnoreDirect`。
 * 未知元素（如已删除的 lumiflux）按全元素字段回落——与 `enemyDebuffStatId` 的兜底同形。
 */
export function resIgnoreStatId(channel: ResistanceChannel, element?: string | null): string {
  const prefix = element && element !== 'all' ? ELEMENT_FIELD_PREFIX[element] : undefined
  return `enemy${prefix ?? ''}${RES_IGNORE_SUFFIX[channel]}`
}

/** 元素限定的自身无视抗性字段名；无元素 / all / 未知元素 ⇒ undefined（区别于回落） */
export function resIgnoreElementStatId(channel: ResistanceChannel, element?: string | null): string | undefined {
  if (!element || element === 'all') return undefined
  const prefix = ELEMENT_FIELD_PREFIX[element]
  return prefix ? `enemy${prefix}${RES_IGNORE_SUFFIX[channel]}` : undefined
}

/** 全部自身无视抗性 statId：2 通道 ×（1 全元素 + 6 元素）= 14 条（供 buff TARGETABLE / statMeta / 断言） */
export const GENERATED_RES_IGNORE_STAT_IDS: string[] = RESISTANCE_CHANNELS.flatMap(channel => [
  resIgnoreBaseStatId(channel),
  ...DAMAGE_ELEMENTS.map(element => resIgnoreStatId(channel, element)),
])

/** 两通道的全元素字段名（面板声明 / 初始化用） */
export const ALL_ELEMENT_RES_IGNORE_STAT_IDS: string[] = RESISTANCE_CHANNELS.map(resIgnoreBaseStatId)
