/**
 * CC-68：teamCompare.ts#completeInteractionList 般岳专属交互类型 → 模块声明 compareInteractionTypes。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { teamCompareInteractionTypes } from '@/composables/agentMechanicView'

describe('CC-68 队伍对比专属交互类型 → compareInteractionTypes', () => {
  it('全 catalog 角色 × 槽位：== 原 team.includes(1471) 写死', async () => {
    const { catalog } = await setupHarness([{ agentId: '1471' }, '', ''])
    const ids = [...new Set(['', ...catalog.agentsMap.keys()])]
    let hits = 0
    for (const id of ids) {
      for (const pos of [0, 1, 2]) {
        const team: (string | null)[] = ['1211', null, '']
        team[pos] = id
        const want = team.includes('1471') ? ['banyueGoldenParry', 'banyueDualCounter'] : []
        expect(teamCompareInteractionTypes(team), `${id}@${pos}`).toEqual(want)
        if (want.length) hits++
      }
    }
    expect(hits).toBe(3)
  }, 60000)

  it('源码锁：teamCompare.ts 不再写死 1471', () => {
    const src = readFileSync(resolve(__dirname, '../teamCompare.ts'), 'utf-8')
    expect(src).not.toContain(`'1471'`)
    expect(src).toContain('teamCompareInteractionTypes(team)')
  })
})
