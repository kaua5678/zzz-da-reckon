/**
 * CC-58：teamPromoteVariantOwnerSlot / agentOwnsPromoteVariantAxisBlocks 与原 StunAxisPage 写死 1481 判断逐值一致。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { agentOwnsPromoteVariantAxisBlocks, teamPromoteVariantOwnerSlot } from '@/composables/agentMechanicView'

describe('CC-58 转大块拥有者 → 模块声明', () => {
  it('全 catalog 角色：拥有者判定 == (agentId === 1481)', async () => {
    const { catalog } = await setupHarness([{ agentId: '1481' }, '', ''])
    const ids = [...catalog.agentsMap.keys()]
    expect(ids.length).toBeGreaterThan(30)
    for (const id of ['', ...ids]) expect(agentOwnsPromoteVariantAxisBlocks(id), id).toBe(id === '1481')
    expect(agentOwnsPromoteVariantAxisBlocks(null)).toBe(false)
  }, 60000)

  it('槽位 == 原 findIndex（琉音在 0/1/2 或不在队）', () => {
    for (const team of [
      [{ agentId: '1481' }, { agentId: '1311' }, { agentId: '1211' }],
      [{ agentId: '1161' }, { agentId: '1481' }, { agentId: '1211' }],
      [{ agentId: '1161' }, { agentId: '1311' }, { agentId: '1481' }],
      [{ agentId: '1161' }, { agentId: '' }, null],
    ]) {
      expect(teamPromoteVariantOwnerSlot(team)).toBe(team.findIndex(c => c?.agentId === '1481'))
    }
  })
})
