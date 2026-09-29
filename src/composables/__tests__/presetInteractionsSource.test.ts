/**
 * CC-257：预设交互条目 → 引擎字段的唯一映射 = teamCompare#applyPresetInteractions。
 * 修前主页 onPresetSelect 与 teamCompare#applyTeamToStore 各一份、词表不同（见函数注释）。
 */
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { setupHarness } from '@/test/harness'
import { applyPresetInteractions } from '@/composables/teamCompare'

describe('CC-257 预设交互映射单一来源', () => {
  it('非测试源码里「it.type === 交互类型 → set*Count」只在 teamCompare#applyPresetInteractions', () => {
    const root = resolve(__dirname, '../..')
    const hits: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name)
        if (statSync(p).isDirectory()) { if (name !== '__tests__') walk(p); continue }
        if (!/\.(ts|vue)$/.test(name) || name.endsWith('.test.ts')) continue
        for (const l of readFileSync(p, 'utf-8').split('\n')) {
          if (/it\.type\s*===\s*'(parry|dodge|quickAssist|block|banyueGoldenParry)'\)\s*configStore\.set/.test(l)) hits.push(relative(root, p).replace(/\\/g, '/'))
        }
      }
    }
    walk(root)
    expect(hits).toEqual([])
  })

  it('并集词表：般岳两名同义（金身格挡 = blockCount）、tauntCancel 生效；未知类型不写引擎', async () => {
    const { config: cfg } = await setupHarness([{ agentId: '1471' }, { agentId: '1211' }, { agentId: '1311' }])
    applyPresetInteractions(cfg, [
      { type: 'banyueGoldenParry', count: 7 },
      { type: 'banyueDualCounter', count: 3 },
      { type: 'tauntCancel', count: 2 },
      { type: 'parry', count: 4, slot: 0 },
      { type: 'yixuanPerfectBlock', count: 9 },
    ])
    const c = cfg.team[0]!
    expect([c.blockCount, c.dualCounterCount, c.tauntCancelCount, c.parryCount]).toEqual([7, 3, 2, 4])
    applyPresetInteractions(cfg, [{ type: 'block', count: 11 }])
    expect(cfg.team[0]!.blockCount).toBe(11)
  })
})
