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
import type { BossPreset, PhaseBuffCard } from '@/types/bossPreset'

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
  /** 自动配装（推荐驱动盘 + 副词条优化器）；缺省 false = 轻量速算（快很多） */
  autoBuild?: boolean
  /**
   * 锁定的条件角色及其影画（用户原话「维琳娜 0命1命2命」）。
   * 多项 = 同时锁定（例如同时锁维琳娜 2 命 + 卢西娅 0 命）。
   * 条件角色的配置码**不进系列 id**（它不是被比的东西，是场景）。
   */
  conditions?: Array<{ agentId: string; cinema: number; wengine?: number }>
  /**
   * 当期危局 buff 牌清单（= 所选 Boss 期的 `phaseViews[].buffs`，页面从 boss-presets.json 取来传入）。
   * 为什么不从 boss 对象反查：期视图（含 buff 牌）挂在 boss-presets.json **顶层**，不在单个 Boss 预设里
   * （`PhaseView.buffs`，CC-341 数据管道）；求值器不加载 JSON，由页面注入——与 `boss` 字段同口径。
   */
  buffs?: PhaseBuffCard[]
  /**
   * 当期 buff 应用模式（用户裁决 2026-10-02：「对比计算可以带 buff 也可以不带」+「要算角色吃到的
   * buff 强度和本体强度」⇒ 三态，且每态结果单独成系列，绝不混合成一条线）：
   * - `'none'`（缺省）：不使用（沿用修前行为，不遍历算得快）；
   * - `'all'`：**全状态对比**——每个系列拆成「本体（无 buff）+ 每张可用牌」N+1 条系列并排，
   *   本体强度 vs 吃拐强度一目了然（牌间不择优、不混合）；
   * - `PhaseBuffCard`：手动指定一张牌（所有系列都用它）。
   * ⚠ 哨兵别用 `null`：调用方传 `{ buffChoice: null }` 会被 `?? 'none'` 折叠（null/undefined 同兜底），
   *   「全状态」静默退成「不使用」零报错（实测踩中）⇒ 用字符串 `'all'`。
   */
  buffChoice?: 'none' | 'all' | PhaseBuffCard
}

/** 条件展示名：「维琳娜 2命」 */
export function conditionLabel(c: { agentId: string; cinema: number }, nameOf: (id: string) => string): string {
  return `${nameOf(c.agentId)} ${c.cinema}命`
}

/**
 * 整份约束的一行摘要（图表副标题用）。
 * 用户裁决 2026-10-02：「比较的环境 buff 期数 boss 条件等是决定数据质量的关键，不同情况结论不同，
 * 不能掐头去尾给结论」⇒ 摘要必须含 Boss/期数/buff 状态/锁定条件/配装模式/交互与失衡轴声明；
 * 实际用了哪张 buff 牌由求值器填进 `appliedBuffLabel`（全状态模式下这里是模式名，不是牌名）。
 */
export function constraintSummary(
  cs: ConstraintSpec,
  nameOf: (id: string) => string,
  appliedBuffLabel?: string,
): string {
  const parts: string[] = []
  if (cs.boss) {
    const phase = cs.boss.phases.find(p => p.phaseId === cs.phaseId) ?? cs.boss.phases[0]
    parts.push(phase ? `${cs.boss.name}（${phase.label}）` : (cs.boss.name ?? ''))
  }
  for (const c of cs.conditions ?? []) parts.push(conditionLabel({ ...c, cinema: c.cinema }, nameOf))
  parts.push(cs.autoBuild ? '推荐配装' : '轻量速算')
  // buff 状态：全状态对比 = 逐系列多张牌（摘要说模式）；手动/缺省 = 一张牌或不使用
  if (appliedBuffLabel) parts.push(`当期 buff：${appliedBuffLabel}`)
  else parts.push('当期 buff：不使用')
  // 交互量与失衡轴不在本页控制内——显式声明，防静默沿用被误读为「无交互口径」（用户裁决：环境必须随图露出）
  parts.push('交互量/失衡轴：沿用当前页面配置')
  return parts.join(' · ')
}

/** 把条件角色也表达成 SetupCode（求值器统一走同一条装配路径） */
export function conditionToCode(c: { cinema: number; wengine?: number }): SetupCode {
  return { cinema: c.cinema, wengine: c.wengine ?? 1 }
}
