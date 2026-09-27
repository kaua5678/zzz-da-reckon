/**
 * CC-57：agentAxisHiddenMoves / agentAxisMoveSuffix 与原 StunAxisPage 写死判断逐值一致。
 * 对照基准（legacy*）照抄原页面写法；枚举全部 catalog 角色 × 相关招式 id（含同形跨角色 id，查误报）。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { agentAxisHiddenMoves, agentAxisMoveSuffix } from '@/composables/agentMechanicView'

const legacyHidden = (agentId: string, moveId: string) => agentId === '1051' && moveId === '1051012'
const legacySuffix = (agentId: string, mid: string) => (agentId === '1371' && (mid === '1371022' || mid === '1371026') ? '·+30%失衡' : '')

describe('CC-57 StunAxisPage 招式级写死 → 模块声明', () => {
  it('全 catalog 角色 × 相关招式：隐藏 / 后缀与原判断逐值相等', async () => {
    const { catalog } = await setupHarness([{ agentId: '1051' }, '', ''])
    const ids = [...catalog.agentsMap.keys()]
    expect(ids.length).toBeGreaterThan(30)
    let hiddenHits = 0
    let suffixHits = 0
    for (const id of ['', ...ids]) {
      const moves = ['1051012', '1371022', '1371026', '1371_c1_lightning', '1051024', 'basic', `${id}012`, `${id}022`, `${id}026`]
      for (const mid of moves) {
        const h = agentAxisHiddenMoves(id).includes(mid)
        expect(h, `${id}/${mid}`).toBe(legacyHidden(id, mid))
        expect(agentAxisMoveSuffix(id, mid), `${id}/${mid}`).toBe(legacySuffix(id, mid))
        if (h) hiddenHits++
        if (agentAxisMoveSuffix(id, mid)) suffixHits++
      }
    }
    expect(hiddenHits).toBeGreaterThan(0)
    expect(suffixHits).toBeGreaterThan(0)
    expect(agentAxisHiddenMoves(null)).toEqual([])
    expect(agentAxisMoveSuffix(undefined, '1371022')).toBe('')
  }, 60000)
})
