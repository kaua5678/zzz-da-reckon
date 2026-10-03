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

/**
 * T11（2026-10-03）：harness 的平A权重口径开关。默认每槽 1（回归基准不动）；`productionBasicWeights: true`
 * 时与 `configStore.getDefaultBasicAttackTimeWeight` 逐槽一致（支援/防护 = 0、模块声明优先、其余 1），
 * 槽位显式值仍最优先。反空洞：三种口径（声明 0 / 职业 0 / 默认 1）各取一个真角色。
 */
describe('T11 harness productionBasicWeights 开关', () => {
  const TEAM = ['1311', '1581', '1181'] // 耀嘉音（support → 0）/ 蕾米埃尔（模块声明 0）/ 格莉丝（anomaly → 1）

  it('默认：每槽 1；开关开：逐槽 === getDefaultBasicAttackTimeWeight；显式值最优先', async () => {
    const { config } = await setupHarness(TEAM.map(agentId => ({ agentId })))
    expect(config.team.map(c => c.basicAttackTimeWeight)).toEqual([1, 1, 1])

    const prod = await setupHarness(TEAM.map(agentId => ({ agentId })), { productionBasicWeights: true })
    const expected = TEAM.map(id => prod.config.getDefaultBasicAttackTimeWeight(prod.catalog.getAgent(id)))
    expect(expected, '三种口径都在场（反空洞）').toEqual([0, 0, 1])
    expect(prod.config.team.map(c => c.basicAttackTimeWeight)).toEqual(expected)

    const explicit = await setupHarness([{ agentId: '1311', basicAttackTimeWeight: 1 }, '', ''], { productionBasicWeights: true })
    expect(explicit.config.team[0]!.basicAttackTimeWeight).toBe(1)
  })
})
