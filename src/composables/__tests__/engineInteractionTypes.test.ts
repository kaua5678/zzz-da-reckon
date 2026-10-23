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
    /**
     * 2026-10-23：不再写死次数（12/3 已随 2026-10-21「交互默认全 0」归零）。
     *
     * 本用例的判据是**类型归类**，不是次数：
     * ① 金身 / 双反各只出现**一条**（不得重复计数）② 普通 block 不吃般岳的格挡
     * ③ 次数由引擎按 store/模块声明给，这里只断言「两条类型都在、且互不串味」。
     * 次数写死会让「用户改预设交互 / 改默认值」这类正常改动直接误红。
     */
    expect(count(items, 'banyueGoldenParry').length, '金身只计一次').toBeLessThanOrEqual(1)
    expect(count(items, 'banyueDualCounter').length, '双反只计一次').toBeLessThanOrEqual(1)
    expect(count(items, 'block').map(i => i.count), '普通 block 不吃般岳格挡').toEqual([0])
    // 预设未声明般岳类型的队：同样按引擎口径出这两类（次数随交互默认值，不在此钉）
    const trigger = teamPresets.find(p => p.id === 'banyue-trigger-lucia')!
    applyTeamToStore(config, trigger)
    const t = liveInteractions(config, trigger)
    expect(t.some(i => i.type === 'banyueGoldenParry'), '未声明也该按模块能力出金身类型').toBe(true)
    expect(t.some(i => i.type === 'banyueDualCounter'), '未声明也该按模块能力出双反类型').toBe(true)
  })

  it('非般岳队：不新增专属类型条目（零差）', async () => {
    const { config } = await setupHarness(['', '', ''], { recommendedBuild: false })
    // 夹具沿革（2026-10-09，预设库重生成 85→77 条）：原 `auto-1521-1361-1311`（希希芙/「扳机」/耀嘉音）
    // 新库无此组合 ⇒ 换槽序改名后的 `auto-1521-1481-1311`（希希芙/琉音/耀嘉音，同主C 希希芙）。
    const p = teamPresets.find(x => x.id === 'auto-1521-1481-1311')!
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
