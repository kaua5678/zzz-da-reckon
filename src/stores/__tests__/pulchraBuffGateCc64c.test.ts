/**
 * CC-64c：波可娜 C6 base 条互斥改走 pulchra.ts 的 teammateBuffGate，与原 store 写死逐值相等（真实 catalog 角色）。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { deriveTeammateBuffEnabled } from '@/stores/config'
import type { Agent, TeammateBuff, TeammateBuffGroup } from '@/types/catalog'

const B = 'pulchra_extra_trap_followup'
const mkBuff = (id: string): TeammateBuff =>
  ({ id, sourceLabel: { zhCN: '核心被动' }, source: { zhCN: '核心被动' }, ownerId: '' }) as unknown as TeammateBuff
const mkGroup = (id: string, ids: string[]): TeammateBuffGroup =>
  ({ id, buffs: ids.map(mkBuff), name: { zhCN: id }, attribute: 'atk', specialty: 'attack' }) as unknown as TeammateBuffGroup
const slot = (agentId: string, i: number, cinemaLevel: number) => ({ slot: i, agentId, cinemaLevel, potentialLevel: 6, wEngineId: '', wEngineModLevel: 1 })

describe('CC-64c 波可娜 C6 互斥 → teammateBuffGate', () => {
  it('波可娜在队 C0..C6 × 放置槽 × 组 id（1351 / 其他在队角色）逐值等于原写死', async () => {
    const { catalog } = await setupHarness([{ agentId: '1351' }, '', ''])
    const getAgent = (id: string) => catalog.agentsMap.get(id) as Agent | undefined
    const others = [...catalog.agentsMap.keys()].filter(id => id !== '1351').slice(0, 12)
    let checked = 0
    let disabled = 0
    for (const other of others) {
      for (let c = 0; c <= 6; c++) {
        for (const team of [[slot('1351', 0, c), slot(other, 1, 3)], [slot(other, 0, 3), slot('1351', 1, c)]]) {
          for (const groupId of ['1351', other]) {
            const teamCinema: Record<string, number> = {}
            for (const t of team) {
              teamCinema[t.agentId] = t.cinemaLevel
            }
            const cl = teamCinema[groupId]
            const base = cl !== undefined
            const out = deriveTeammateBuffEnabled(team, [mkGroup(groupId, [B, 'ctl'])], getAgent)
            for (const o of out) {
              let legacy = base
              if (groupId === '1351' && o.id === B && cl >= 6) legacy = false
              expect(o.enabled, `${other}/c${c}/${groupId}/${o.id}`).toBe(legacy)
              checked++
              if (!o.enabled && base) disabled++
            }
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(500)
    expect(disabled).toBeGreaterThan(0)
  }, 60000)
})
