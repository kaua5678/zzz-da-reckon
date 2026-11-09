/**
 * 伤害元素常量（**叶子模块**，零运行时依赖）。
 *
 * 为什么单独成文件（2026-11-09 三通道重构）：`enemyDebuffStats` 与 `resistanceChannels` 互相需要
 * 对方的常量——前者要把旧别名 `*ResIgnore` 归一成 `enemy{El}ResIgnoreDirect`（要 `resIgnoreStatId`），
 * 后者要按元素生成字段名（要 `ELEMENT_FIELD_PREFIX`）。两文件直接互相 import 会形成
 * **模块初始化环**，在 ESM 下是 TDZ 崩（`Cannot access before initialization`），不是「能跑但难看」。
 * ⇒ 把共享的元素清单/前缀/标签下沉到本叶子文件，两边都只依赖它，环断开。
 *
 * 元素全集**不含 lumiflux**：2026-10-21 用户裁决
 * > 「流明本身也没有积蓄，因此不会形成异常主人……全游戏没有流明属性进行攻击计算」
 * 官方设定流明是高级属性：流明角色（蕾米埃尔）的伤害跟随**下一位队友的属性**，耀变沿用**原主人的属性**
 * ⇒ 引擎里不存在按流明结算的伤害，也就不需要流明抗性/弱点/增伤。
 */
import type { DamageElement } from '@/types/catalog'

/**
 * 伤害元素全集（6 个标准元素，顺序即 UI 顺序）。
 *
 * 修前这里与 `STANDARD_ENEMY_DEBUFF_ELEMENTS` 是两份清单且不一致（前者含 lumiflux），已合并为一份。
 */
export const DAMAGE_ELEMENTS = ['physical', 'fire', 'ice', 'electric', 'ether', 'wind'] as const

/** 敌人抗性 / 减抗认的标准元素（= `DAMAGE_ELEMENTS`，保留名字供既有调用点） */
export const STANDARD_ENEMY_DEBUFF_ELEMENTS = DAMAGE_ELEMENTS

/** 敌人抗性 / 减抗认的标准元素 */
export type StandardEnemyDebuffElement = typeof STANDARD_ENEMY_DEBUFF_ELEMENTS[number]

/** 元素 → 字段名中缀（`enemy{Physical}ResReduction`） */
export const ELEMENT_FIELD_PREFIX: Record<string, string> = {
  physical: 'Physical',
  fire: 'Fire',
  ice: 'Ice',
  electric: 'Electric',
  ether: 'Ether',
  wind: 'Wind',
}

/** 元素 → 中文标签 */
export const ELEMENT_LABEL: Record<string, string> = {
  physical: '物理',
  fire: '火属性',
  ice: '冰属性',
  electric: '电属性',
  ether: '以太',
  wind: '风属性',
}

/** 元素 → 展示/UI 用的元素名（`DamageElement` 的收窄视图：本文件是元素清单的单一事实源） */
export type StandardDamageElement = DamageElement
