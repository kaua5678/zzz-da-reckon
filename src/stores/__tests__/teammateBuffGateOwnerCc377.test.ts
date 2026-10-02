/**
 * teammateBuffGate 派发口径锁。
 * r403 CC-377 起：每个 buff 组**只问拥有者模块**（组 id = 拥有者 agentId）。CC-76 原锁的是「多模块表态取逻辑与」，
 * 只问拥有者之后一组只有一个表态者，合并问题不复存在，本文件改锁新口径。
 * 手法：临时给**注册表第一个模块**（非拥有者）或拥有者挂 gate（afterEach 还原）。
 * 反证：退回「问全部已注册模块」时，非拥有者的 false 会生效 ⇒ 第二条变红。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { deriveTeammateBuffEnabled } from '@/stores/config'
import { getAgentMechanic, getRegisteredAgentMechanics } from '@/mechanics'
import type { AgentMechanicModule } from '@/mechanics/types'
import type { Agent, TeammateBuff, TeammateBuffGroup } from '@/types/catalog'

const B = 'pulchra_extra_trap_followup'
const mkBuff = (id: string): TeammateBuff =>
  ({ id, sourceLabel: { zhCN: '核心被动' }, source: { zhCN: '核心被动' }, ownerId: '' }) as unknown as TeammateBuff
const mkGroup = (id: string, ids: string[]): TeammateBuffGroup =>
  ({ id, buffs: ids.map(mkBuff), name: { zhCN: id }, attribute: 'atk', specialty: 'attack' }) as unknown as TeammateBuffGroup
const slot = (agentId: string, i: number, cinemaLevel: number) => ({ slot: i, agentId, cinemaLevel, potentialLevel: 6, wEngineId: '', wEngineModLevel: 1 })

type Gate = AgentMechanicModule['teammateBuffGate']
let patched: { m: AgentMechanicModule; orig: Gate } | undefined
afterEach(() => { if (patched) patched.m.teammateBuffGate = patched.orig; patched = undefined })
function patch(m: AgentMechanicModule, gate: NonNullable<Gate>) {
  patched = { m, orig: m.teammateBuffGate }
  m.teammateBuffGate = gate
}

describe('teammateBuffGate 只问组拥有者（r403 CC-377）', () => {
  it('现有声明者：仅蕾米埃尔 1581 与波可娜 1351', () => {
    const owners = getRegisteredAgentMechanics().filter(m => !!m.teammateBuffGate).flatMap(m => m.agentIds).sort()
    expect(owners).toEqual(['1351', '1581'])
  })

  it('非拥有者模块的表态不影响别人组里的 buff', async () => {
    const { catalog } = await setupHarness([{ agentId: '1351' }, '', ''])
    const getAgent = (id: string) => catalog.agentsMap.get(id) as Agent | undefined
    const first = getRegisteredAgentMechanics()[0]!
    expect(first.agentIds).not.toContain('1351')
    const team = [slot('1351', 0, 0)]
    const before = deriveTeammateBuffEnabled(team, [mkGroup('1351', ['ctl', B])], getAgent)
    expect(before).toEqual([{ id: 'ctl', enabled: true }, { id: B, enabled: true }])
    patch(first, () => false)
    expect(deriveTeammateBuffEnabled(team, [mkGroup('1351', ['ctl', B])], getAgent)).toEqual(before)
  })

  it('拥有者表态 false ⇒ 禁用；表态 true 不会启用 base 关闭的条；selfCinema = 本人在队影画', async () => {
    const { catalog } = await setupHarness([{ agentId: '1351' }, '', ''])
    const getAgent = (id: string) => catalog.agentsMap.get(id) as Agent | undefined
    const seen: Array<number | undefined> = []
    patch(getAgentMechanic('1351')!, ({ buffId, selfCinema }) => {
      seen.push(selfCinema)
      return buffId === 'ctl' ? false : buffId === 'c6only' ? true : undefined
    })
    const team = [slot('1351', 0, 2)]
    const out = deriveTeammateBuffEnabled(team, [mkGroup('1351', ['ctl', B, 'c6only'])], getAgent)
    expect(out.find(o => o.id === 'ctl')!.enabled).toBe(false)
    expect(out.find(o => o.id === B)!.enabled).toBe(true)
    expect(new Set(seen)).toEqual(new Set([2]))
  })

  it('波可娜 C6：真实钩子禁用 base 条（selfCinema ≥ 6）', async () => {
    const { catalog } = await setupHarness([{ agentId: '1351' }, '', ''])
    const getAgent = (id: string) => catalog.agentsMap.get(id) as Agent | undefined
    expect(deriveTeammateBuffEnabled([slot('1351', 0, 6)], [mkGroup('1351', [B, 'ctl'])], getAgent))
      .toEqual([{ id: B, enabled: false }, { id: 'ctl', enabled: true }])
  })
})
