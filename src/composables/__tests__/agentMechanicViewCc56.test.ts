/**
 * CC-56：teamTeammateSplit / agentExcludedFromWindInfectionPick 与原 ResourceUtilizationPage 写死 1581 的判断逐值一致。
 * 对照基准（legacy*）照抄原页面写法（写死 ID 只允许出现在测试里当基准）。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { agentExcludedFromWindInfectionPick, teamTeammateSplit } from '@/composables/agentMechanicView'

const legacyIsRemielle = (agent: { id: string; teammateBuffId?: string } | null | undefined) =>
  agent?.id === '1581' || agent?.teammateBuffId === '1581'

describe('CC-56 agentMechanicView：蕾米埃尔两处写死 → 模块声明', () => {
  it('agentExcludedFromWindInfectionPick：全 catalog 角色逐个与原判断相等（且至少一个为 true）', async () => {
    const { catalog } = await setupHarness([{ agentId: '1581' }, '', ''])
    const agents = [...catalog.agentsMap.values()]
    expect(agents.length).toBeGreaterThan(30)
    for (const a of agents) expect(agentExcludedFromWindInfectionPick(a), a.id).toBe(legacyIsRemielle(a))
    expect(agents.some(a => agentExcludedFromWindInfectionPick(a))).toBe(true)
    expect(agentExcludedFromWindInfectionPick(null)).toBe(false)
  }, 60000)

  it('teamTeammateSplit：槽位与原 findIndex 相等；声明内容 = 引擎口径（remielle.q / 3 / 默认 1）', async () => {
    for (const team of [
      [{ agentId: '1161' }, { agentId: '1581' }, { agentId: '1211' }],
      [{ agentId: '1581' }, { agentId: '1311' }, { agentId: '1211' }],
      [{ agentId: '1161' }, { agentId: '1311' }, { agentId: '1211' }],
    ]) {
      const { config, catalog } = await setupHarness(team)
      const legacySlot = config.team.findIndex(char => legacyIsRemielle(char.agentId ? catalog.getAgent(char.agentId) : null))
      const got = teamTeammateSplit(config.team, id => catalog.getAgent(id))
      expect(got?.slot ?? -1).toBe(legacySlot)
      if (got) {
        expect(got.split.settingPrefix).toBe('remielle.q')
        expect(got.split.total).toBe(3)
        expect(got.split.defaultFirst).toBe(1)
        expect(got.split.title).toBe('蕾米 Q 耀变分配')
        expect(`${got.split.batchNote}；`).toBe('Q 每次固定打 3 个耀变；')
      }
    }
  }, 60000)
})
