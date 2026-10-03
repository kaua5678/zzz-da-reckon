/**
 * CC-61：agentAxisExtraBlocks 与原 StunAxisPage 写死的诺姆 1571 / 希格莉德 1591 专属块逐字段一致。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { findMoveById } from '@/data/moveTableQueries'
import { agentAxisExtraBlocks } from '@/composables/agentMechanicView'
import type { AgentSkills } from '@/types/catalog'

// 对照基准：照抄原页面两段 if 块（remaining 的 9 = quota）
function legacy(agentId: string, cinemaLevel: number, skills: AgentSkills | undefined) {
  if (agentId === '1571') return [{ moveId: 'norma-hat-chain', label: '诺姆转连携', actionTime: 0, quota: 9 }]
  // CC-433：原页面 `findMove(skills, '1051024')` 分支（伊德海莉寒冰触手，0 时长，remaining 9）
  if (agentId === '1051') return [{ moveId: '1051024', label: '寒冰触手', actionTime: 0, quota: 9 }]
  if (agentId === '1591') {
    const pzSum = ['1591007', '1591008', '1591022'].reduce((sum, mid) => sum + (findMoveById(skills, mid)?.actionTime ?? 0), 0)
    const pzScale = cinemaLevel >= 6 ? 0.75 : 1
    return [{ moveId: 'sigrid-pozhen', label: '破阵连段', actionTime: pzSum * pzScale, quota: 9 }]
  }
  return []
}

describe('CC-61 专属轴块 → 模块声明 axisExtraBlocks', () => {
  it('全 catalog 角色 × 影画 0..6：候选块与原写死逐字段相等', async () => {
    const { catalog } = await setupHarness([{ agentId: '1591' }, { agentId: '1571' }, ''])
    const ids = [...catalog.agentsMap.keys()]
    expect(ids.length).toBeGreaterThan(30)
    let hits = 0
    for (const id of ['', ...ids]) {
      const skills = catalog.getAgentSkills(id)
      for (let cinemaLevel = 0; cinemaLevel <= 6; cinemaLevel++) {
        const got = agentAxisExtraBlocks(id, { cinemaLevel, actionTimeOf: mid => findMoveById(skills, mid)?.actionTime ?? 0 })
        expect([...got], `${id}/c${cinemaLevel}`).toEqual(legacy(id, cinemaLevel, skills))
        hits += got.length
      }
    }
    expect(hits).toBe(21)  // 3 个角色 × 影画 0..6（CC-433 加伊德海莉）
    // 破阵块行动时间非零（技能表三段都查得到），C6 恰为 0.75 倍
    const sk = catalog.getAgentSkills('1591')
    const at = (c: number) => agentAxisExtraBlocks('1591', { cinemaLevel: c, actionTimeOf: mid => findMoveById(sk, mid)?.actionTime ?? 0 })[0]?.actionTime ?? 0
    expect(at(0)).toBeGreaterThan(0)
    expect(at(6)).toBeCloseTo(at(0) * 0.75, 10)
    expect(agentAxisExtraBlocks(null, { cinemaLevel: 0, actionTimeOf: () => 1 })).toEqual([])
  }, 60000)

  it('StunAxisPage 不再按 agentId 写死诺姆 / 希格莉德专属块', () => {
    const src = readFileSync(resolve(__dirname, '../../views/StunAxisPage.vue'), 'utf8')
    expect(src.includes("=== '1571'")).toBe(false)
    expect(src.includes("=== '1591'")).toBe(false)
    expect(src.includes("'1051024'"), 'CC-433：触手块不再写死在页面').toBe(false)
  })
})
