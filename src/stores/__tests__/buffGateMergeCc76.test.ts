/**
 * CC-76：teammateBuffGate 多模块表态合并 = 逻辑与（census §5.83），与模块注册顺序无关。
 * 手法：临时给**注册表第一个模块**挂一个 gate（afterEach 还原）——若退回「第一个返回 boolean 的说了算」，它会抢先生效 ⇒ 变红。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { deriveTeammateBuffEnabled } from '@/stores/config'
import { getRegisteredAgentMechanics } from '@/mechanics'
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
function patchFirst(gate: NonNullable<Gate>) {
  const m = getRegisteredAgentMechanics()[0]!
  patched = { m, orig: m.teammateBuffGate }
  m.teammateBuffGate = gate
}

describe('CC-76 teammateBuffGate 合并 = 逻辑与', () => {
  it('现有声明者键不相交：仅蕾米埃尔 1581 与波可娜 1351', () => {
    const owners = getRegisteredAgentMechanics().filter(m => !!m.teammateBuffGate).flatMap(m => m.agentIds).sort()
    expect(owners).toEqual(['1351', '1581'])
  })

  it('先注册的模块表态 true 不能覆盖波可娜 C6 的 false', async () => {
    const { catalog } = await setupHarness([{ agentId: '1351' }, '', ''])
    const getAgent = (id: string) => catalog.agentsMap.get(id) as Agent | undefined
    const team = [slot('1351', 0, 6)]
    const before = deriveTeammateBuffEnabled(team, [mkGroup('1351', [B, 'ctl'])], getAgent)
    expect(before).toEqual([{ id: B, enabled: false }, { id: 'ctl', enabled: true }])
    patchFirst(({ buffId }) => (buffId === B ? true : undefined))
    expect(deriveTeammateBuffEnabled(team, [mkGroup('1351', [B, 'ctl'])], getAgent)).toEqual(before)
  })

  it('任一模块表态 false ⇒ 禁用；表态 true 不会启用 base 关闭的条', async () => {
    const { catalog } = await setupHarness([{ agentId: '1351' }, '', ''])
    const getAgent = (id: string) => catalog.agentsMap.get(id) as Agent | undefined
    patchFirst(({ buffId }) => (buffId === 'ctl' ? false : buffId === 'x' ? true : undefined))
    const out = deriveTeammateBuffEnabled([slot('1351', 0, 0)], [mkGroup('1351', ['ctl', B]), mkGroup('9999', ['x'])], getAgent)
    expect(out).toEqual([{ id: 'ctl', enabled: false }, { id: B, enabled: true }, { id: 'x', enabled: false }])
  })
})
