/**
 * r399 CC-373：`teamMechanicSlots` / `findModuleSlot` —— 按模块派发、钩子要知道「我是谁」的派发点共用的定位器。
 * 锁两条语义：① 只含**在队**模块（不在队 ⇒ 钩子根本不派发）；② 按**注册顺序**排列，不按槽位顺序
 * （同类钩子按注册顺序执行，与原「遍历全部已注册模块」一致 ⇒ zd 0/0）。
 */
import { describe, it, expect } from 'vitest'
import { findModuleSlot, teamMechanicSlots } from '@/mechanics/registry'
import type { AgentMechanicModule } from '@/mechanics/types'

const mod = (id: string, agentIds: string[]) => ({ id, agentIds }) as unknown as AgentMechanicModule

describe('teamMechanicSlots（r399 CC-373）', () => {
  const a = mod('a', ['1001'])
  const b = mod('b', ['2001', '2002'])
  const c = mod('c', ['3001'])

  it('只含在队模块，槽位 = 队伍下标', () => {
    const r = teamMechanicSlots([{ agentId: '3001' }, { agentId: '9999' }, { agentId: '2002' }], [a, b, c])
    expect(r.map(x => [x.module.id, x.slot])).toEqual([['b', 2], ['c', 0]])
  })

  it('按注册顺序，不按槽位顺序', () => {
    const r = teamMechanicSlots([{ agentId: '3001' }, { agentId: '1001' }], [c, a])
    expect(r.map(x => x.module.id)).toEqual(['c', 'a'])
    expect(teamMechanicSlots([{ agentId: '3001' }, { agentId: '1001' }], [a, c]).map(x => x.module.id)).toEqual(['a', 'c'])
  })

  it('空槽 / null / 未知角色不匹配；findModuleSlot 不在队 ⇒ -1', () => {
    expect(teamMechanicSlots([null, undefined, { agentId: null }, {}], [a, b, c])).toEqual([])
    expect(findModuleSlot(a, [null, { agentId: '1001' }])).toBe(1)
    expect(findModuleSlot(a, [{ agentId: '2001' }])).toBe(-1)
  })
})
