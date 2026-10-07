/**
 * spec `teamBuffs`（人工录入，`src/specs/agents/*.json`）→ catalog `TeammateBuff` / `BuffEffect` 的**唯一**转换器。
 *
 * 为什么单独成模块（CC-399，2026-10-03 r425）：原先转换只存在于 `stores/catalog.ts#mergeSpecTeamBuffs` 的闭包里，
 * 而 `mechanics/agents/promia.ts` 的展示值直接把 spec effect `as unknown as BuffEffect` 喂给 `applyEffect`——
 * 同一条数据两种形状（真实通道有 `type / mode / value / coverage` 默认值，promia 走的原件没有）。
 * 现在两边都走这里：转换规则只写一遍，spec 字段加减时 tsc 在这一个文件里报。
 *
 * 调查结论（T6 步骤 1）：转换器**不透传** spec effect 的 `source`（formula 变量 x 的 `defaultValue / min / max`）。
 * `getEffectSourceValue` 的取值顺序是 `dynamicSourceValue ?? 目标面板[sourceStat] ?? source.defaultValue ?? defaultSourceValue ?? 0`；
 * 全部 spec 里只有 1541 promia 的 effect 带 `source`，且 `defaultValue = 0` ⇒ 丢掉它与最终兜底 `0` 等价，
 * 而且 `TeamBuffEffectSpec` 本就没声明 `source`（它是 JSON 里的未声明字段）。所以**不补透传**：补了等于为一个恒 0 的值加字段。
 */
import type { Agent, BuffEffect, TeammateBuff } from '@/types/catalog'
import type { TeamBuffEffectSpec, TeamBuffSpec } from './types'

import { localized } from '@/utils/format'
/** 单条 spec effect → catalog `BuffEffect`（缺省：`fixed` / `flat` / `value 0` / 覆盖率取条级 `coverage`，默认 1） */
export function specEffectToBuffEffect(tb: TeamBuffSpec, e: TeamBuffEffectSpec, i: number): BuffEffect {
  return {
    id: e.id ?? `${tb.id}_effect_${i}`,
    type: e.type ?? 'fixed',
    target: { kind: 'default' as const },
    stat: e.stat,
    mode: e.mode ?? 'flat',
    value: e.value ?? 0,
    coverage: { default: tb.coverage, min: 0, max: 1, step: 0.1 },
    // 公式/转模字段：spec teamBuffs 人工录入时必须透传，否则加油/虎啸等公式增益变死数据
    ...(e.sourceStat ? { sourceStat: e.sourceStat } : {}),
    ...(e.sourcePanelPhase ? { sourcePanelPhase: e.sourcePanelPhase } : {}),
    ...(e.formula ? { formula: e.formula } : {}),
    ...(e.ratio != null ? { ratio: e.ratio } : {}),
    ...(e.cap != null ? { cap: e.cap } : {}),
    ...(e.targetSkillType ? { targetSkillType: e.targetSkillType } : {}),
  }
}

/**
 * spec teamBuffs（人工录入）→ 采集文件同构条目。
 * 教训修复：录入侧双轨（spec vs teammate-buffs.json），消费端只读采集文件 → spec 录的增益成了死数据。
 * 现在加载时合并（`stores/catalog.ts#mergeSpecTeamBuffs`）：spec 条目按 id 去重并优先（人工确认覆盖原始采集），组不存在则新建。
 */
export function specTeamBuffToTeammateBuff(agentId: string, agent: Agent | null, tb: TeamBuffSpec): TeammateBuff {
  const nameZh = tb.name || `${localized(agent?.name, agentId)}｜${tb.source}`
  return {
    id: tb.id,
    source: { zhCN: tb.source },
    description: { zhCN: tb.description },
    scope: 'inCombat',
    effects: tb.effects.map((e, i) => specEffectToBuffEffect(tb, e, i)),
    buffModifiers: [],
    sourceType: 'teammate',
    sourceCategory: 'agent',
    sourceKind: 'teammate',
    sourceLabel: { zhCN: tb.source },
    ownerId: agentId,
    ownerName: { zhCN: localized(agent?.name, agentId) },
    teammateId: agentId,
    teammateName: { zhCN: localized(agent?.name, agentId) },
    conditionLabel: { zhCN: tb.description },
    name: { zhCN: nameZh },
    // SOP §6.4：`singleSourced`（原 `hidden`，R65 改名）条不进 collectInCombatTeamBuffs
    // —— 数值由模块/helpers 单通道接入，防双计（**不是** UI 隐藏，见 src/utils/teammateBuffRows.ts）
    ...(tb.singleSourced ? { singleSourced: true } : {}),
  }
}
