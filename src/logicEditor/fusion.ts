import { shallowRef } from 'vue'
import type { RowFusionRule } from './types'

/**
 * 行融合规则的生效快照（spec 声明 → `defaultRowFusionRules` → 此处）。
 *
 * 原「逻辑编辑」页（用户增删改 + 撤销/重做 + 本地存档）已于 2026-10-26 下线；
 * 本模块保留为**计算输入通道**：启动时激活 spec 默认规则，倍率表取值处
 * （`data/moveTableQueries.ts#getRowValue`）按 moveId + rowId 相乘；worker 请求经
 * `currentRowFusionRules()` 显式携带同一份规则（worker 无页面 store）。
 *
 * `shallowRef` 让 `calcOutput` 记忆化能观察到激活 / 清空（测试会改规则），
 * 但只保存 `enabled` 的三元组——元数据变化不触发昂贵重算。
 */
type EffectiveFusion = Pick<RowFusionRule, 'moveId' | 'rowId' | 'multiplier'>

const activeRowFusions = shallowRef<EffectiveFusion[]>([])
let currentRules: RowFusionRule[] = []

/** 激活行融合规则（启动入口唯一调用点：生产 `useCalculatorStartup`、测试 `setupHarness`）。 */
export function setActiveRowFusionRules(rules: readonly RowFusionRule[]): void {
  currentRules = [...rules]
  const next = rules.filter(rule => rule.enabled).map(({ moveId, rowId, multiplier }) => ({ moveId, rowId, multiplier }))
  const previous = activeRowFusions.value
  // Metadata changes / repeated activations must not invalidate expensive calculation consumers.
  if (next.length === previous.length && next.every((rule, index) => {
    const old = previous[index]
    return old.moveId === rule.moveId && old.rowId === rule.rowId && Object.is(old.multiplier, rule.multiplier)
  })) return
  activeRowFusions.value = next
}

/**
 * 当前配置的规则全集（含未启用，拷贝）：供 worker 请求携带（worker 内再激活）。
 * **计算读数**请用 `activeRowFusionRulesSnapshot()`（只含启用、响应式）。
 */
export function currentRowFusionRules(): RowFusionRule[] {
  return currentRules.map(rule => ({ ...rule }))
}

/** 当前生效的行融合规则（只读快照，**响应式读取**）：供计算结果记忆化做键（`useResourceCalc` calcOutput 记忆化）。 */
export function activeRowFusionRulesSnapshot(): readonly EffectiveFusion[] {
  return activeRowFusions.value
}

export function getRowFusionMultiplier(moveId: string | undefined, rowId: string): number {
  if (!moveId) return 1
  let multiplier = 1
  for (const rule of activeRowFusions.value) {
    if (rule.moveId === moveId && rule.rowId === rowId) {
      multiplier *= rule.multiplier
    }
  }
  return multiplier
}
