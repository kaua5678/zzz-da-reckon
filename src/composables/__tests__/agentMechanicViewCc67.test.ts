/**
 * CC-67：额外能力门控的凯撒 / 菲欧妮修正 → 模块能力 adjustAdditionalAbilityGates。
 * 语义等价面由既有 additionalGate.test.ts（凯撒/菲欧妮用例）承担；本文件补：全角色 × 队伍组合对照原写死 + 源码锁。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { getAgentMechanic } from '@/mechanics'
import { evalAdditionalAbilityBuffGates } from '@/mechanics/additionalAbilityGates'
import { additionalGateBuffTable } from '@/specs/additionalGate'
import { getAgentSpec } from '@/specs/registry'
import { evalAdditionalAbility } from '@/specs/teamCondition'

describe('CC-67 额外能力门控修正 → adjustAdditionalAbilityGates', () => {
  it('v12 起只剩凯撒 1071 声明（菲欧妮的 tier2/tier3 分档随 [脆弱]→[灼蚀] 改版删除）', async () => {
    const { catalog } = await setupHarness([{ agentId: '1071' }, '', ''])
    const ids = [...new Set(catalog.agentsMap.keys())]
    const got = ids.filter(id => !!getAgentMechanic(id)?.adjustAdditionalAbilityGates).sort()
    expect(got).toEqual(['1071'])
  }, 60000)

  it('全 catalog 角色 × 凯撒/菲欧妮组队：门控 == 原写死实现', async () => {
    const { catalog } = await setupHarness([{ agentId: '1641' }, '', ''])
    const ids = [...new Set(catalog.agentsMap.keys())]
    const getA = (id: string) => catalog.getAgent(id) ?? null
    // CC-203：门控表改为从 catalog 分组派生；对照实现用同一张表（本测试只锁凯撒/菲欧妮修正的迁移等价）
    const ADDITIONAL_GATE_BUFFS = additionalGateBuffTable(catalog.teammateBuffGroups)
    /** 原实现逐字（写死 1071 / 1641） */
    function legacy(team: Parameters<typeof evalAdditionalAbilityBuffGates>[0]): Map<string, boolean> {
      const slotByAgentId = new Map<string, number>(team.map(m => [m.agentId, m.slot]))
      const activeByAgent = new Map<string, boolean>()
      for (const agentId of Object.keys(ADDITIONAL_GATE_BUFFS)) {
        const slot = slotByAgentId.get(agentId) ?? -1
        activeByAgent.set(agentId, slot >= 0 && evalAdditionalAbility(team, slot, getA(agentId), getAgentSpec(agentId)?.additionalAbility) === true)
      }
      { const slot = slotByAgentId.get('1071') ?? -1
        if (slot >= 0 && team.some(m => m.slot !== slot && !!m.agentId)) activeByAgent.set('1071', true) }
      const gates = new Map<string, boolean>()
      for (const [agentId, buffIds] of Object.entries(ADDITIONAL_GATE_BUFFS)) for (const b of buffIds) gates.set(b, activeByAgent.get(agentId) === true)
      // v12：菲欧妮的 tier2/tier3 分档与 adjustAdditionalAbilityGates 修正一并删除
      //（[脆弱]→[灼蚀]，额外能力改成固定 +15 单档，只由 additionalAbility 声明式门控）
      return gates
    }
    let n = 0
    for (const lead of ['1071']) {
      for (const x of ['', ...ids]) {
        for (const cin of [0, 6]) {
          const agents = [lead, x, x === '1261' ? '1561' : '1261']
          const team = agents.map((agentId, slot) => ({ slot, agentId, cinemaLevel: slot === 0 ? cin : 0, agent: agentId ? getA(agentId) : null }))
          const got = evalAdditionalAbilityBuffGates(team as never, getA, catalog.teammateBuffGroups)
          expect([...got.entries()], `${agents}/${cin}`).toEqual([...legacy(team as never).entries()])
          n++
        }
      }
    }
    expect(n).toBeGreaterThan(100)
  }, 120000)

  it('源码锁：evalAdditionalAbilityBuffGates 函数体不再写死 1071 / 1641', () => {
    // CC-206：函数迁到 mechanics/additionalAbilityGates.ts
    const src = readFileSync(resolve(__dirname, '../../mechanics/additionalAbilityGates.ts'), 'utf-8')
    const k = src.indexOf('export function evalAdditionalAbilityBuffGates')
    const body = src.slice(k, src.indexOf('\n}\n', k))
    for (const id of ['1071']) expect(body).not.toContain(`'${id}'`)
    expect(body).toContain('adjustAdditionalAbilityGates')
  })
})
