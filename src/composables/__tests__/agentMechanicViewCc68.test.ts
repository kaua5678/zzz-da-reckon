/**
 * CC-68：teamCompare.ts#completeInteractionList 般岳专属交互类型 → 模块声明 compareInteractionTypes。
 *
 * ⚠ 期望值表按「队里有哪些声明了专属交互类型的角色」逐字展开（不是只认 1471）——
 *   新角色声明 `interactionFieldTypes` 时在此加一行。最近一次新增：克拉蕾(1611)
 *   `claretBurialInterruptCount → 'claretBurialInterrupt'`（葬血强袭打断，用户口径 2026-10-09）。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { teamCompareInteractionTypes } from '@/composables/agentMechanicView'

/** agentId → 该角色声明的专属交互类型（顺序 = 模块 interactionFieldTypes 的声明序） */
const SPECIALTY_TYPES: Record<string, string[]> = {
  '1471': ['banyueGoldenParry', 'banyueDualCounter'],
  '1611': ['claretBurialInterrupt'],
}

describe('CC-68 队伍对比专属交互类型 → compareInteractionTypes', () => {
  it('全 catalog 角色 × 槽位：== 声明表并集（按队伍顺序去重）', async () => {
    const { catalog } = await setupHarness([{ agentId: '1471' }, '', ''])
    const ids = [...new Set(['', ...catalog.agentsMap.keys()])]
    let hits = 0
    for (const id of ids) {
      for (const pos of [0, 1, 2]) {
        const team: (string | null)[] = ['1211', null, '']
        team[pos] = id
        const want: string[] = []
        for (const t of team) {
          for (const ty of (t ? SPECIALTY_TYPES[t] : undefined) ?? []) if (!want.includes(ty)) want.push(ty)
        }
        expect(teamCompareInteractionTypes(team), `${id}@${pos}`).toEqual(want)
        if (want.length) hits++
      }
    }
    // 般岳 3 次（三个槽位各一次）+ 克拉蕾 3 次
    expect(hits).toBe(3 * Object.keys(SPECIALTY_TYPES).length)
  }, 60000)

  it('源码锁：teamCompare.ts 不再写死 1471', () => {
    const src = readFileSync(resolve(__dirname, '../teamCompare.ts'), 'utf-8')
    expect(src).not.toContain(`'1471'`)
    expect(src).toContain('teamCompareInteractionTypes(team)')
  })
})
