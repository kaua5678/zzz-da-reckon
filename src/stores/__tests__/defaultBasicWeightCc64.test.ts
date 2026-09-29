/**
 * CC-64：configStore.getDefaultBasicAttackTimeWeight 改走模块声明 defaultBasicAttackTimeWeight，
 * 与原 stores/config.ts 写死（1581 / 1331 按 id 或 teammateBuffId → 0；支援/防护 0；其余 1）逐值相等。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import type { Agent } from '@/types/catalog'

function legacy(agent?: Agent | null): number {
  if (!agent) return 1
  if (agent.id === '1581') return 0
  if (agent.id === '1331') return 0
  if (agent.specialty === 'support' || agent.specialty === 'defense') return 0
  return 1
}

describe('CC-64 默认平A权重 → 模块声明', () => {
  it('全 catalog 角色（含 teammateBuffId 别名）与原写死逐值相等', async () => {
    const { config, catalog } = await setupHarness([{ agentId: '1581' }, { agentId: '1331' }, ''])
    const agents = [...catalog.agentsMap.values()] as Agent[]
    expect(agents.length).toBeGreaterThan(30)
    let zeros = 0
    for (const a of agents) {
      const got = config.getDefaultBasicAttackTimeWeight(a)
      expect(got, a.id).toBe(legacy(a))
      if (got === 0 && a.specialty !== 'support' && a.specialty !== 'defense') zeros++
    }
    // 1581 / 1331 至少有一个不是支援/防护（否则本卡的声明不可观测）
    expect(zeros).toBeGreaterThan(0)
    expect(config.getDefaultBasicAttackTimeWeight(null)).toBe(1)
    // 只经 teammateBuffId 命中的别名形态（构造：id 不同、buffId 指向声明者）
    const alias = { ...agents.find(a => a.specialty !== 'support' && a.specialty !== 'defense' && a.id !== '1581' && a.id !== '1331')!, teammateBuffId: '1331' } as Agent
    expect(config.getDefaultBasicAttackTimeWeight(alias)).toBe(legacy(alias))
  }, 60000)
})
