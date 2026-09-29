/**
 * CC-258：难度轴读引擎实打交互次数的唯一实现 = difficultyCurve#engineInteractionItems，
 * 类型名按槽位解析（模块 interactionFieldTypes 覆盖全局名）。
 * 修前：般岳 blockCount（金身格挡）按普通 block 1.0 计；banyue-liuyin-lucia 又从预设声明补 banyueGoldenParry 1.5 = 双计；
 * 双反（dualCounterCount）不进难度轴；difficultyDescent 另有一份同样的字段循环。
 */
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { setupHarness } from '@/test/harness'
import { teamPresets } from '@/data/teamPresets'
import { applyTeamToStore } from '@/composables/teamCompare'
import { liveInteractions } from '@/composables/liveInteractions'

const count = (items: { type: string; count: number }[], t: string) => items.filter(i => i.type === t)

describe('CC-258 引擎交互类型名按角色解析', () => {
  it('般岳队：金身 / 双反只计一次、按专属类型名；普通 block 不再吃般岳的格挡', async () => {
    const { config } = await setupHarness(['', '', ''], { recommendedBuild: false })
    const liuyin = teamPresets.find(p => p.id === 'banyue-liuyin-lucia')!
    applyTeamToStore(config, liuyin)
    const items = liveInteractions(config, liuyin)
    expect(count(items, 'banyueGoldenParry').map(i => i.count)).toEqual([20])
    expect(count(items, 'banyueDualCounter').map(i => i.count)).toEqual([5])
    expect(count(items, 'block').map(i => i.count)).toEqual([0])
    // 预设未声明般岳类型的队也按引擎实打次数计
    const trigger = teamPresets.find(p => p.id === 'banyue-trigger-lucia')!
    applyTeamToStore(config, trigger)
    const t = liveInteractions(config, trigger)
    expect([count(t, 'banyueGoldenParry')[0]?.count, count(t, 'banyueDualCounter')[0]?.count]).toEqual([20, 5])
  })

  it('非般岳队：不新增专属类型条目（零差）', async () => {
    const { config } = await setupHarness(['', '', ''], { recommendedBuild: false })
    const p = teamPresets.find(x => x.id === 'auto-1521-1361-1311')!
    applyTeamToStore(config, p)
    const types = liveInteractions(config, p).map(i => i.type)
    expect(types.some(t => t.startsWith('banyue'))).toBe(false)
  })

  it('源码锁：ENGINE_INTERACTION_FIELDS 只在 liveInteractions.ts（CC-259 迁入）；compareInteractionTypes 已并入 interactionFieldTypes', () => {
    const root = resolve(__dirname, '../..')
    const engineHits: string[] = []
    const oldHits: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name)
        if (statSync(p).isDirectory()) { if (name !== '__tests__') walk(p); continue }
        if (!/\.(ts|vue)$/.test(name) || name.endsWith('.test.ts')) continue
        const src = readFileSync(p, 'utf-8')
        const rel = relative(root, p).replace(/\\/g, '/')
        if (src.includes('ENGINE_INTERACTION_FIELDS')) engineHits.push(rel)
        if (/compareInteractionTypes\s*[:?]/.test(src)) oldHits.push(rel)
      }
    }
    walk(root)
    expect(engineHits).toEqual(['composables/liveInteractions.ts'])
    expect(oldHits).toEqual([])
  })
})
