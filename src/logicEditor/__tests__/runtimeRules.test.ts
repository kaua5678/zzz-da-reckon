import { afterEach, describe, expect, it } from 'vitest'
import { defaultRowFusionRules } from '@/logicEditor/defaults'
import {
  activeRowFusionRulesSnapshot,
  currentRowFusionRules,
  getRowFusionMultiplier,
  setActiveRowFusionRules,
} from '@/logicEditor/fusion'
import type { RowFusionRule } from '@/logicEditor/types'

/**
 * 行融合规则的运行时通道（原「逻辑编辑」页 2026-10-26 下线后保留的计算输入）。
 *
 * 契约：spec 声明 → `defaultRowFusionRules()` → 启动入口 `setActiveRowFusionRules` →
 * ① 计算只读启用规则（`activeRowFusionRulesSnapshot` 响应式，作 calcOutput 记忆化键）；
 * ② worker 请求带全集（`currentRowFusionRules` 拷贝，未启用规则进 worker 后再被过滤）。
 */
afterEach(() => setActiveRowFusionRules([]))

const RULES: RowFusionRule[] = [
  { id: 'on', specId: 'spec', name: 'on', agentId: '1561', moveId: '1561007', rowId: 'damage', multiplier: 2, enabled: true, note: '' },
  { id: 'off', specId: 'spec', name: 'off', agentId: '1561', moveId: '1561020', rowId: 'damage', multiplier: 10, enabled: false, note: '' },
]

describe('行融合规则运行时通道', () => {
  it('全集保留未启用规则，计算快照只含启用规则', () => {
    setActiveRowFusionRules(RULES)
    expect(currentRowFusionRules().map(rule => rule.id)).toEqual(['on', 'off'])
    expect(activeRowFusionRulesSnapshot().map(rule => `${rule.moveId}/${rule.rowId}×${rule.multiplier}`)).toEqual(['1561007/damage×2'])
    expect(getRowFusionMultiplier('1561007', 'damage')).toBe(2)
    expect(getRowFusionMultiplier('1561020', 'damage')).toBe(1)
    expect(getRowFusionMultiplier(undefined, 'damage')).toBe(1)
  })

  it('currentRowFusionRules 返回拷贝：调用方改动不影响已激活快照', () => {
    setActiveRowFusionRules(RULES)
    const copy = currentRowFusionRules()
    copy[0].multiplier = 99
    copy.pop()
    expect(currentRowFusionRules().map(rule => rule.multiplier)).toEqual([2, 10])
    expect(getRowFusionMultiplier('1561007', 'damage')).toBe(2)
  })

  it('清空后快照与乘数都回到恒等', () => {
    setActiveRowFusionRules(RULES)
    setActiveRowFusionRules([])
    expect(activeRowFusionRulesSnapshot()).toEqual([])
    expect(currentRowFusionRules()).toEqual([])
    expect(getRowFusionMultiplier('1561007', 'damage')).toBe(1)
  })

  it('默认规则来自 spec 声明（非空、带 specId、beta 不混入）', () => {
    const rules = defaultRowFusionRules()
    expect(rules.length).toBeGreaterThan(0)
    expect(rules.every(rule => typeof rule.specId === 'string' && rule.specId.length > 0)).toBe(true)
    expect(rules.filter(rule => rule.enabled).length).toBeGreaterThan(0)
  })
})
