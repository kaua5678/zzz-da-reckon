/**
 * CC-307 不变量锁：维琳娜 1561 / 爱丽丝 1401 的额外能力由 spec `additionalAbility` 声明求值，
 * 与迁移前 velina.ts / alice.ts 手写判断在 catalog 全部角色两两组队下逐位一致。
 * 维琳娜原判断读 `damageElement`，spec 的 `sameAttributeAsSelf` 读 `attribute`——
 * 等价依赖「catalog 中二者全等」，本测试同时锁住这一前提（数据若出现分歧，应新增条件类型而不是硬套）。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import type { Agent } from '@/types/catalog'
import { specAdditionalAbilityActive } from '@/mechanics/additionalAbilityGates'

const cat = JSON.parse(readFileSync(new URL('../../../public/static/catalog.json', import.meta.url), 'utf8')) as { agents: Agent[] }
const agents = cat.agents
const byId = (id: string) => agents.find(a => a.id === id)!

type M = { slot: number; agentId: string; agent: Agent | null }
const legacyVelina = (team: M[], slot: number, agent: Agent) =>
  team.some(m => m.slot !== slot && !!m.agent && (m.agent.specialty === 'anomaly' || m.agent.damageElement === agent.damageElement))
const legacyAlice = (team: M[], slot: number) =>
  team.some(m => m.slot !== slot && !!m.agent && (m.agent.specialty === 'anomaly' || m.agent.specialty === 'support'))

describe('CC-307 额外能力声明与迁移前手写判断等价', () => {
  it('catalog 全部角色 attribute === damageElement（sameAttributeAsSelf 替代 damageElement 比较的前提）', () => {
    expect(agents.filter(a => a.attribute !== a.damageElement).map(a => a.id)).toEqual([])
  })
  for (const [ownerId, legacy] of [['1561', legacyVelina], ['1401', (t: M[], s: number) => legacyAlice(t, s)]] as const) {
    it(`${ownerId}：两两组队（含空位）逐位一致`, () => {
      const owner = byId(ownerId)
      const pool: (Agent | null)[] = [null, ...agents.filter(a => a.id !== ownerId)]
      let n = 0
      for (const a of pool) for (const b of pool) {
        const team: M[] = [
          { slot: 0, agentId: ownerId, agent: owner },
          { slot: 1, agentId: a?.id ?? '', agent: a },
          { slot: 2, agentId: b?.id ?? '', agent: b },
        ]
        expect(specAdditionalAbilityActive(team, 0, owner), `${a?.id}+${b?.id}`).toBe(legacy(team, 0, owner))
        n++
      }
      expect(n).toBe(pool.length ** 2)
    })
  }
})
