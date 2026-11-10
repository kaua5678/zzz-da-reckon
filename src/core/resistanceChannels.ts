/**
 * 抗性**三通道**读数入口（单一事实源，2026-11-09 用户裁决）。
 *
 * ## 用户口径（原话）
 * > 「减抗的实现分为两种，一个是降低怪物的抗性，这相当于作用在怪物身上的结算区，直伤和异常
 * >   比如乱流灼烧强击之类都能吃。还有一种是加自己的无视抗性，这种抗性只有自己直伤能无视，
 * >   所谓（造成伤害无视抗性），这种抗性没有降低 boss 身上的乘区，所以异常状态吃不到这种减抗。」
 * > 「只有怪物身上属性抗性降低和造成异常伤害时无视抗性，才能给异常吃。
 * >   所以可以分为三种情况，直伤抗性，异常抗性，通用抗性。」
 *
 * ## 三条通道（字段族 + 谁吃）
 *
 * | 通道 | 面板字段 | 直伤 | 异常 |
 * |---|---|---|---|
 * | **通用**（怪物身上的减抗 = 结算区 debuff；也收**主语是角色**的「无视抗性」） | `enemyResReduction` / `enemy{El}ResReduction` | ✅ | ✅ |
 * | **直伤无视**（「**攻击 / 招式 / 造成的伤害**无视抗性」） | `enemyResIgnoreDirect` / `enemy{El}ResIgnoreDirect` | ✅ | ❌ |
 * | **异常无视**（「造成异常伤害时无视抗性」） | `enemyResIgnoreAnomaly` / `enemy{El}ResIgnoreAnomaly` | ❌ | ✅ |
 *
 * **主语判据（用户 2026-11-09 二次裁决）**：`菲欧妮无视目标15%抗性` 的主语是**角色** ⇒ 通用（异常也吃）；
 * `造成的伤害无视目标15%抗性` 的主语是**伤害** ⇒ 直伤专属。判别看主谓，不看有没有「无视」二字
 * （`攻击命中敌人时，猫又无视…` 的主语仍是猫又，攻击只是触发条件）。见 `utils/resistanceChannels.ts` 头注释。
 *
 * ## 为什么必须拆（修前的错误形态）
 *
 * 修前全仓把三种文本**一律**写进 `enemyResReduction`，于是：
 * - 原文「造成伤害无视目标 X% 抗性」（直伤专属）被异常结算也吃掉 ⇒ **异常伤害系统性偏高**；
 * - 原文「造成属性异常/紊乱伤害时无视 X% 抗性」（异常专属）与直伤混写 ⇒ 直伤侧无从区分；
 * - 「怪物抗性降低」与「自身无视」数值上恰好可加，**静默通过全部既有测试**（两者都从有效抗性里线性扣除）。
 *
 * 数值上，三者在 `resistanceMultiplierDetail` 里同形（有效抗性 = 基础 − 降低 − 无视），
 * **区别只在调用方读哪一族字段**——所以本文件只提供「按伤害族读数」的入口，
 * 乘法/钳制仍归 `core/damageMultipliers.ts`（CC-219 单一来源不破）。
 *
 * ## 判据
 * `src/core/__tests__/resistanceChannels.test.ts`（三通道读数 + 引擎行为面：直伤无视不进异常、
 * 异常无视不进直伤、怪物减抗两边都吃）。
 */
import type { PanelValues } from '@/types/catalog'
import { getTargetedElementStat, getTargetedStat } from './buff'
import { RES_IGNORE_SUFFIX, type ResistanceChannel } from '@/utils/resistanceChannels'

/** 伤害族：只有「直伤 / 异常」两族各自拥有独立的自身无视抗性通道 */
export type ResistanceDamageFamily = ResistanceChannel

export const RESISTANCE_DAMAGE_FAMILIES: readonly ResistanceDamageFamily[] = ['direct', 'anomaly']

/** 通用减抗（怪物身上）的全元素 stat 名——直伤与异常都读它 */
export const GENERIC_RES_REDUCTION_STAT = 'enemyResReduction'

/** 该族的「自身无视抗性」全元素 stat 名 */
export function selfResIgnoreStatName(family: ResistanceDamageFamily): string {
  return `enemy${RES_IGNORE_SUFFIX[family]}`
}

/**
 * 通用减抗（**降低怪物身上的抗性**，结算区 debuff）：直伤与异常**都吃**。
 *
 * 含定向（`enemyResReduction__chain`）与元素（`enemyFireResReduction`）两类加成；
 * 元素键走 `elementStatKey('enemyRes')` 同口径（变种读基础元素、烈霜读冰）。
 */
export function enemyResReductionOf(
  panel: PanelValues,
  element?: string | null,
  skillDamageTarget?: string,
): number {
  return getTargetedStat(panel, GENERIC_RES_REDUCTION_STAT, skillDamageTarget)
    + getTargetedElementStat(panel, 'enemyRes', element, skillDamageTarget)
}

/**
 * 自身无视抗性（按伤害族）：**只有本族吃**。
 *
 * - `family = 'direct'` ⇒ 直伤链（`calcDirectDamage`）
 * - `family = 'anomaly'` ⇒ 异常链（`calcAnomalyDamage` / 紊乱 / 乱流 / 异放 / 耀变）
 *
 * @param extra 调用方自带的额外量（行级 moveId 限定 / 异放 releaseModifier），与面板值**加算**
 */
export function selfResIgnoreOf(
  panel: PanelValues,
  family: ResistanceDamageFamily,
  element?: string | null,
  skillDamageTarget?: string,
  extra = 0,
): number {
  const stat = selfResIgnoreStatName(family)
  const elementKind = family === 'direct' ? 'enemyResIgnoreDirect' : 'enemyResIgnoreAnomaly'
  return extra
    + getTargetedStat(panel, stat, skillDamageTarget)
    + getTargetedElementStat(panel, elementKind, element, skillDamageTarget)
}

/** 一次性取两通道（调用方直接喂 `resistanceMultiplierDetail` 的第 2 / 3 参） */
export function resistanceChannelsOf(
  panel: PanelValues,
  family: ResistanceDamageFamily,
  element?: string | null,
  skillDamageTarget?: string,
  extraIgnore = 0,
): { reduction: number; ignore: number } {
  return {
    reduction: enemyResReductionOf(panel, element, skillDamageTarget),
    ignore: selfResIgnoreOf(panel, family, element, skillDamageTarget, extraIgnore),
  }
}
