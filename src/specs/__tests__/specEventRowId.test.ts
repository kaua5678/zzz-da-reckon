/**
 * CC-250：spec 事件的 `multiplierRowId` 端到端生效（§24.87 ④ 未决项裁决：修，不收窄字段）。
 *
 * 修前两道口子都只认 damage：① 4 处调用方各抄一份 `rowId === 'damage' ? mechanicRowValues[moveId] : 0`，非 damage 行读成 0；
 * ② 无 ratio 时 damageMultiplierOverride=false，enrichExecutionPlan 按 moveId 回填 damage 行，声明的行被忽略。
 * 现：buildSpecEventExecutions 缺省读 cfg.mechanicRowValues（buildCharConfig 按事件行预取），非 damage 行强制作倍率覆盖。
 */
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { buildSpecEventExecutions } from '@/specs/mechanics'
import type { AgentMechanicSpec } from '@/specs/types'
import type { CharacterOperationConfig, IterationState } from '@/types/resource'

function specWith(events: AgentMechanicSpec['events']): AgentMechanicSpec {
  return {
    schemaVersion: 1, id: 'agent:row-id', name: 'RowId', agentIds: ['row-id'], status: 'implemented',
    attributeConversions: [], resources: [], rowFusions: [], events,
    verifications: [], stateMachines: [], notes: [],
  } as AgentMechanicSpec
}
const ev = (id: string, moveId: string, extra: Record<string, unknown> = {}) => ({
  id, name: id, trigger: 'x', eventType: 'direct_damage', executionKind: 'execution',
  countField: `${id}Count`, carrierMoveId: moveId, status: 'implemented', ...extra,
}) as AgentMechanicSpec['events'][number]

const state = {} as IterationState

describe('CC-250 spec 事件 multiplierRowId 端到端', () => {
  it('缺省读取器 = cfg.mechanicRowValues[moveId]（调用方不再各传一份 lambda）', () => {
    const cfg = { mechanicRowValues: { m1: 420 } } as unknown as CharacterOperationConfig
    const [e] = buildSpecEventExecutions(specWith([ev('a', 'm1', { multiplierRatio: 0.5 })]), { cfg, state, counts: { aCount: 1 } })
    expect(e.damageMultiplier).toBe(210)
    expect(e.damageMultiplierOverride).toBe(true)
  })

  it('damage 行、无 ratio：不覆盖（交 enrich 按 moveId 回填，含命座技能等级）——现存 6 处 spec 的口径不变', () => {
    const cfg = { mechanicRowValues: { m1: 420 } } as unknown as CharacterOperationConfig
    const [e] = buildSpecEventExecutions(specWith([ev('a', 'm1', { multiplierRowId: 'damage' })]), { cfg, state, counts: { aCount: 1 } })
    expect(e.damageMultiplier).toBe(420)
    expect(e.damageMultiplierOverride).toBe(false)
  })

  it('非 damage 行：取该行预存值并强制覆盖（修前读成 0 / 被 damage 行回填顶掉）', () => {
    const cfg = { mechanicRowValues: { m2: 88 } } as unknown as CharacterOperationConfig
    const [e] = buildSpecEventExecutions(specWith([ev('b', 'm2', { multiplierRowId: 'attack_data_0' })]), { cfg, state, counts: { bCount: 2 } })
    expect(e.damageMultiplier).toBe(88)
    expect(e.damageMultiplierOverride).toBe(true)
    expect(e.count).toBe(2)
  })

  it('源码：mechanics/agents 不再自带 mechanicRowValues 读取 lambda 传给 buildSpecEventExecutions（唯一读取器在 specs/mechanics）', () => {
    const dir = resolve(__dirname, '../../mechanics/agents')
    const hits: string[] = []
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.ts')) continue
      readFileSync(join(dir, name), 'utf-8').split('\n').forEach((l, i) => {
        if (/getRowValue:\s*\(/.test(l) && /mechanicRowValues/.test(l)) hits.push(`${name}:${i + 1}`)
      })
    }
    expect(hits).toEqual([])
  })
})
