/**
 * CC-56 后继（2026-10-18）：`teamTeammateSplit` 已被 `teamTeammateDrop` 取代——
 * 用户口径「Q 分配只控制大招那 3 个，不贴合实际；改成每个队友可丢弃 N 次，
 * 剩余次数进细致分配算法，轮数/归属/浪费量全部自动跟着算」。
 *
 * 本用例保留原主题（「页面写死 1581 → 模块声明」的等价性），但基准换成新声明：
 * 槽位仍须与原 `findIndex` 一致；声明内容 = `remielle.drop` 前缀 + 文案取自模块。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { teamTeammateDrop } from '@/composables/agentMechanicView'

const legacyIsRemielle = (agent: { id: string } | null | undefined) => agent?.id === '1581'

describe('CC-56 agentMechanicView：蕾米埃尔写死 → 模块声明（2026-10-18 换声明）', () => {
  it('teamTeammateDrop：槽位与原 findIndex 相等；声明内容 = 引擎口径（remielle.drop / 文案）', async () => {
    for (const team of [
      [{ agentId: '1161' }, { agentId: '1581' }, { agentId: '1211' }],
      [{ agentId: '1581' }, { agentId: '1311' }, { agentId: '1211' }],
      [{ agentId: '1161' }, { agentId: '1311' }, { agentId: '1211' }],
    ]) {
      const { config, catalog } = await setupHarness(team)
      const legacySlot = config.team.findIndex(char => legacyIsRemielle(char.agentId ? catalog.getAgent(char.agentId) : null))
      const got = teamTeammateDrop(config.team, (id: string) => catalog.getAgent(id))
      expect(got?.slot ?? -1).toBe(legacySlot)
      if (got) {
        expect(got.drop.settingPrefix).toBe('remielle.drop')
        expect(got.drop.title).toBe('蕾米虚曜子弹来源')
        expect(got.drop.suffix).toBe('次')
        expect(got.drop.note).toContain('丢弃')
      }
    }
  }, 60000)
})
