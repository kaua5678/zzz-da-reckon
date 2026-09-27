/** CC-47：展示层门面 agentMechanicView 与注册表直读逐位一致 */
import { describe, expect, it } from 'vitest'
import { getAgentMechanic } from '@/mechanics'
import { agentCombos, agentResourceSections, teamMechanicSettings } from '@/composables/agentMechanicView'

describe('agentMechanicView', () => {
  it('teamMechanicSettings：按 id 去重、先出现者优先、空槽跳过', () => {
    const team = [{ agentId: '1481' }, { agentId: '' }, null, { agentId: '1481' }, { agentId: '1591' }]
    const got = teamMechanicSettings(team)
    const expected = [...(getAgentMechanic('1481')?.settings ?? []), ...(getAgentMechanic('1591')?.settings ?? [])]
    const seen = new Set<string>()
    const dedup = expected.filter(s => (seen.has(s.id) ? false : (seen.add(s.id), true)))
    expect(got.length).toBeGreaterThan(0)
    expect(got).toEqual(dedup)
    expect(new Set(got.map(s => s.id)).size).toBe(got.length)
  })

  it('agentCombos：与模块声明同一引用；空 id ⇒ undefined', () => {
    expect(agentCombos('1471')).toBe(getAgentMechanic('1471')?.combos)
    expect(agentCombos('1471')).toBeTruthy()
    expect(agentCombos('')).toBeUndefined()
  })

  it('agentResourceSections：未声明或空 id ⇒ []', () => {
    const input = { result: {}, anomalyPoolResult: null, liuyinHug: null, agentNames: {} } as never
    expect(agentResourceSections('', input)).toEqual([])
    expect(agentResourceSections('no-such-agent', input)).toEqual([])
  })
})
