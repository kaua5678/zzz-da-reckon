/** CC-47：展示层门面 agentMechanicView 与注册表直读逐位一致 */
import { describe, expect, it } from 'vitest'
import { getAgentMechanic } from '@/mechanics'
import { agentAxisBlockMarks, agentAxisMoveMeta, agentCombos, agentResourceSections, teamMechanicSettings } from '@/composables/agentMechanicView'
import { BANYUE_AXIS_MOVE_META, computeBanyueMingwangBlocks } from '@/mechanics/agents/banyue'
import { computeYixuanNingshenBlocks } from '@/mechanics/agents/yixuan'

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

  it('agentAxisBlockMarks：般岳/仪玄与原函数逐块一致；未声明 ⇒ 空 Map（CC-48）', () => {
    const axes = [{ actions: [
      { slot: 0, moveId: 'banyue-combo', count: 1, startTime: 0 },
      { slot: 0, moveId: '1471021', count: 1, startTime: 2 },
      { slot: 0, moveId: 'banyue-combo-didong', count: 1, startTime: 5 },
      { slot: 1, moveId: '1371014', count: 1, startTime: 1 },
      { slot: 1, moveId: '1371022', count: 1, startTime: 4 },
      { slot: 0, moveId: '1471021', count: 1, startTime: 30 },
    ] }]
    const by = agentAxisBlockMarks('1471', { axes, slot: 0, cinemaLevel: 0 })
    const byRaw = computeBanyueMingwangBlocks(axes, 0, 0)
    expect(by.size).toBe(byRaw.size)
    expect(by.size).toBeGreaterThan(0)
    for (const [k, v] of byRaw) expect(by.get(k)).toEqual({ trigger: v.trigger, active: v.layers > 0, layers: v.layers })
    expect(agentAxisBlockMarks('1471', { axes, slot: 0, cinemaLevel: 6 }).size).toBe(0)
    const yx = agentAxisBlockMarks('1371', { axes, slot: 1, cinemaLevel: 0 })
    const yxRaw = computeYixuanNingshenBlocks(axes, 1)
    expect(yx.size).toBe(yxRaw.size)
    expect(yx.size).toBeGreaterThan(0)
    for (const [k, v] of yxRaw) expect(yx.get(k)).toEqual({ trigger: v.trigger, active: v.active, layers: 0 })
    expect(agentAxisBlockMarks('1481', { axes, slot: 0, cinemaLevel: 0 }).size).toBe(0)
    expect(agentAxisBlockMarks(undefined, { axes, slot: -1, cinemaLevel: 0 }).size).toBe(0)
  })

  it('agentAxisMoveMeta：般岳 = BANYUE_AXIS_MOVE_META 同一引用；其他角色 undefined（CC-48）', () => {
    expect(agentAxisMoveMeta('1471')).toBe(BANYUE_AXIS_MOVE_META)
    expect(agentAxisMoveMeta('1371')).toBeUndefined()
    expect(agentAxisMoveMeta('')).toBeUndefined()
  })
})
