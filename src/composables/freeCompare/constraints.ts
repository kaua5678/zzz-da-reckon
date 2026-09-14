/**
 * 自由对比工作台 · 约束（条件）模型
 *
 * 用户原话（2026-09-14 逐字）：「比如我要比较**维琳娜0命1命2命的情况下**，柏妮思21对比菲欧尼21」。
 * ⇒ 「维琳娜 0/1/2 命」是被**锁定的条件**，不是被比的系列；系列是柏妮思 vs 菲欧妮。
 *
 * 所以约束 = **除系列与 x 维度之外的一切**：Boss / 基底队友 / 金数 / 难度 / 版本 / 配装 / 机制开关。
 * 判据：改任何一条约束不影响「系列怎么定义、x 怎么枚举」，只影响求值时的 store 装配。
 */

import type { SetupCode } from './axes'
import type { BossPreset } from '@/types/bossPreset'

/**
 * 约束（条件）：求值前套到 store 上、求值后恢复（快照/恢复口径同 `teamCompare.ts`）。
 * 全部字段可选 = 不约束（沿用用户当前页面配置）。
 */
export interface ConstraintSpec {
  /**
   * Boss（整份预设对象，含 phases/monster/defaults）。
   * 为什么不存 `bossId` 再去 store 反查：`catalog` store **没有 boss 清单**
   * （boss-presets.json 由各页面各自 import 加载），求值器拿不到检索表 ⇒ 直接把对象传进来，
   * 与 `difficultyCurve.ts:120` / `teamTimeline.ts:604`「拿到 boss 对象直接 `applyBossPreset`」同口径。
   */
  boss?: BossPreset
  /** 危局期 id（缺省 = 该 Boss 第一期） */
  phaseId?: string
  /**
   * 基底队友：**单人系列**时必填 —— 引擎没有单角色求值入口，单人 = 固定队友 + 读该槽位分量。
   * 整队系列时忽略。
   */
  baseTeammates?: [string, string]
  /** 目标总限定金（约束而非 x 维度时用） */
  gold?: number
  /** 自动配装（推荐驱动盘 + 副词条优化器）；缺省 false = 轻量速算（快很多） */
  autoBuild?: boolean
  /**
   * 锁定的条件角色及其影画（用户原话「维琳娜 0命1命2命」）。
   * 多项 = 同时锁定（例如同时锁维琳娜 2 命 + 卢西娅 0 命）。
   * 条件角色的配置码**不进系列 id**（它不是被比的东西，是场景）。
   */
  conditions?: Array<{ agentId: string; cinema: number; wengine?: number }>
}

/** 条件展示名：「维琳娜 2命」 */
export function conditionLabel(c: { agentId: string; cinema: number }, nameOf: (id: string) => string): string {
  return `${nameOf(c.agentId)} ${c.cinema}命`
}

/** 整份约束的一行摘要（图表副标题用） */
export function constraintSummary(
  cs: ConstraintSpec,
  nameOf: (id: string) => string,
): string {
  const parts: string[] = []
  if (cs.boss) parts.push(cs.boss.name ?? '')
  if (cs.gold !== undefined) parts.push(`${cs.gold}金`)
  for (const c of cs.conditions ?? []) parts.push(conditionLabel({ ...c, cinema: c.cinema }, nameOf))
  parts.push(cs.autoBuild ? '推荐配装' : '轻量速算')
  return parts.join(' · ')
}

/** 把条件角色也表达成 SetupCode（求值器统一走同一条装配路径） */
export function conditionToCode(c: { cinema: number; wengine?: number }): SetupCode {
  return { cinema: c.cinema, wengine: c.wengine ?? 1 }
}
