/**
 * 下位音擎表（`src/data/downgradeWEngines.ts`）的判据。
 *
 * 用户 2026-10-26 口径：「89 个限定角色带的下位替代，把这些好用的记录成一个表就行了吗，
 * 这样默认就是干净的 01，想找下位也有默认下位表。找不到再启动更重的算法。」
 *
 * 锁三件事：
 *  ① 表里每个 id 都在 catalog、且**不占限定金**（下位的定义就是「不花金的那件」）；
 *  ② 角色表的每一件都与该角色同职业（跨职业穿 = 白板被动）；且不是「该角色自己的专武」
 *     （自己的专武属于基础档 01，不是下位）；
 *  ③ 职业默认表覆盖全部 7 个特化，且与调色板（catalog 里该职业的全部不占金音擎）逐 id 相等——
 *     以后新增/删除音擎时此处会红，提醒同步表（而不是静默漏掉新音擎）。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DOWNGRADE_BY_SPECIALTY, DOWNGRADE_WENGINES, defaultDowngradeFor, downgradePoolFor } from '@/data/downgradeWEngines'
import { isLimitedSWengineId } from '@/composables/limitedGold'
import type { Specialty } from '@/types/catalog'

const cat = JSON.parse(readFileSync(new URL('../../../public/static/catalog.json', import.meta.url), 'utf8')) as {
  agents: { id: string; specialty: Specialty; name: { zhCN: string } }[]
  wEngines: { id: string; specialty: Specialty; rarity: string; ownerAgentId?: string; name: { zhCN: string } }[]
}
const wById = new Map(cat.wEngines.map(w => [w.id, w]))
const agentById = new Map(cat.agents.map(a => [a.id, a]))

describe('下位音擎表', () => {
  it('角色表：id 存在、同职业、不占金、不是该角色自己的专武', () => {
    for (const [agentId, ids] of Object.entries(DOWNGRADE_WENGINES)) {
      const agent = agentById.get(agentId)
      expect(agent, `角色 ${agentId} 不在 catalog`).toBeTruthy()
      expect(ids.length, `${agentId}（${agent!.name.zhCN}）的下位表不能为空`).toBeGreaterThan(0)
      for (const id of ids) {
        const w = wById.get(id)
        expect(w, `${agentId} 的下位音擎 ${id} 不在 catalog`).toBeTruthy()
        expect(isLimitedSWengineId(id), `${agentId} 的下位 ${w!.name.zhCN}(${id}) 是限定音擎——下位不许花金`).toBe(false)
        expect(w!.specialty, `${agentId}（${agent!.specialty}）的下位 ${w!.name.zhCN} 是 ${w!.specialty}，跨职业穿=白板`).toBe(agent!.specialty)
        expect(w!.ownerAgentId, `${agentId} 的下位 ${w!.name.zhCN} 其实是本人的专武（属基础档 01，不是下位）`).not.toBe(agentId)
      }
    }
  })

  it('职业默认表：与 catalog 里该职业「全部不占金音擎」逐 id 相等（新增/删除音擎时此处变红）', () => {
    const specs: Specialty[] = ['attack', 'stun', 'anomaly', 'support', 'defense', 'rupture', 'sharpen']
    for (const spec of specs) {
      const inCatalog = cat.wEngines.filter(w => w.specialty === spec && !isLimitedSWengineId(w.id)).map(w => w.id)
      expect([...DOWNGRADE_BY_SPECIALTY[spec]].sort(), `${spec} 的下位池与 catalog 不一致`).toEqual([...inCatalog].sort())
    }
  })

  it('defaultDowngradeFor：角色表优先 → 职业表兜底 → 都没有 = null', () => {
    expect(defaultDowngradeFor('1411', 'support')).toBe('14121')
    expect(defaultDowngradeFor('9999', 'support')).toBe('14121')
    expect(defaultDowngradeFor(undefined, undefined)).toBeNull()
    expect(downgradePoolFor('1411', 'support')?.source).toBe('agent')
    expect(downgradePoolFor('9999', 'support')?.source).toBe('specialty')
  })
})
