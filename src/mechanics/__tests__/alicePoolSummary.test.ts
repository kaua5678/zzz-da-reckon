import { describe, expect, it } from 'vitest'
import { aliceMechanic } from '@/mechanics/agents/alice'
import { teamPoolSummaries } from '@/composables/agentMechanicView'
import type { AgentPoolSummaryInput } from '@/mechanics/types'
import type { AnomalyPoolResult } from '@/types/resource'

/** CC-444：ResultPage 爱丽丝伤害汇总专块 → 模块 poolSummary 钩子（锁行为与门面派发） */
const ROWS: AgentPoolSummaryInput['damagePoolRows'] = [
  { agentId: '1401', type: '极性强击', count: 9, totalDamage: 90000 },
  { agentId: '1401', type: '极性强击', count: 2, totalDamage: 20000 },
  { agentId: '1401', type: '爱丽丝6命附伤', count: 30, totalDamage: 45000 },
  { agentId: '1401', type: '直伤', count: 5, totalDamage: 999999 },
  // 其他角色的同名行类型不得被计入
  { agentId: '1221', type: '极性强击', count: 1, totalDamage: 123456 },
]
const DOT = {
  coweringDot: { totalDotDamage: 12000, totalTicks: 40, dotInterval: 0.95 },
} as unknown as AnomalyPoolResult
const settings = (overrides: Record<string, number> = {}) =>
  (id: string, fallback: number) => overrides[id] ?? fallback

describe('alice poolSummary（CC-444）', () => {
  it('按 agentId + 行类型聚合极性强击 / 六命附伤，畏缩 DOT 读异常池', () => {
    const sec = aliceMechanic.poolSummary!({ damagePoolRows: ROWS, anomalyPoolResult: DOT, getMechanicSetting: settings() })
    expect(sec).not.toBeNull()
    expect(sec!.title).toBe('爱丽丝伤害汇总')
    expect(sec!.stats.map(s => s.label)).toEqual(['极性强击', '畏缩 DOT', '六命额外攻击'])
    const [polar, dot, c6] = sec!.stats
    expect(polar!.detail).toBe('11 次')
    expect(polar!.tone).toBe('highlight')
    expect(dot!.detail).toBe('40 tick · 0.95s/次')
    expect(c6!.detail).toContain('30 次 · 每次状态 5 次')
  })
  it('每状态次数读机制设置（非页面常量）', () => {
    const sec = aliceMechanic.poolSummary!({ damagePoolRows: ROWS, anomalyPoolResult: null, getMechanicSetting: settings({ 'alice.cinema6PerStateCount': 3 }) })
    expect(sec!.stats[2]!.detail).toContain('每次状态 3 次')
  })
  it('无极性强击 / 六命 / DOT ⇒ null（不出空段）', () => {
    const rows = ROWS.filter(r => r.agentId !== '1401' || r.type === '直伤')
    expect(aliceMechanic.poolSummary!({ damagePoolRows: rows, anomalyPoolResult: null, getMechanicSetting: settings() })).toBeNull()
    const zeroDot = { coweringDot: { totalDotDamage: 0, totalTicks: 0, dotInterval: 0.95 } } as unknown as AnomalyPoolResult
    expect(aliceMechanic.poolSummary!({ damagePoolRows: rows, anomalyPoolResult: zeroDot, getMechanicSetting: settings() })).toBeNull()
  })
  it('门面 teamPoolSummaries：按槽位收集、同 agentId 去重、未实现模块跳过', () => {
    const input: AgentPoolSummaryInput = { damagePoolRows: ROWS, anomalyPoolResult: DOT, getMechanicSetting: settings() }
    const secs = teamPoolSummaries([{ agentId: '1221' }, null, { agentId: '1401' }, { agentId: '1401' }], input)
    expect(secs.map(s => s.title)).toEqual(['爱丽丝伤害汇总'])
    expect(teamPoolSummaries([{ agentId: '1221' }, null], input)).toEqual([])
  })
})
