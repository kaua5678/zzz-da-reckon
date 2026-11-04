/**
 * 「按实测耗时降序」调度器的判据（2026-11-04）。
 *
 * 它只改**文件交给 worker 的顺序**，不改跑什么。所以判据只管三件事：
 * ① 耗时降序（长文件先跑，LPT 的前提）；
 * ② 未测到的文件排在最后（不能因为没数据就把它们排前面或丢掉）；
 * ③ **一个都不丢**（排序前后集合相同）——这是最坏失效方向（漏跑文件比慢更糟）。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import SlowestFirstSequencer from '../../../scripts/lib/slowest-first-sequencer.mjs'

const ROOT = process.cwd()
const durations: Record<string, number> = JSON.parse(readFileSync(join(ROOT, 'scripts/lib/test-durations.json'), 'utf8')).entries

/** 造一个最小 spec：调度器只读 moduleId（与真实 TestSpecification 同形） */
const spec = (name: string) => ({ moduleId: '/abs/src/__tests__/' + name, taskId: name })

/**
 * ⚠ **每个用例都必须显式清掉逃生口**：`VITEST_SEQUENCER=off` 会让 sort 退回原序，
 * 而这些用例断言的正是「排序生效」。不清就等于让环境变量决定判据（本仓库最忌讳的那种）。
 * 该开关本身由 ⑥ 单独判。
 */
beforeEach(() => { delete process.env.VITEST_SEQUENCER })
afterEach(() => { delete process.env.VITEST_SEQUENCER })

describe('SlowestFirstSequencer：按实测耗时降序', () => {
  it('① 耗时降序：最慢的文件排第一，相邻两两非增', async () => {
    const seq = new SlowestFirstSequencer({} )
    const names = ['difficultyCurve.test.ts', 'a.test.ts', 'allAgentsGuards.test.ts', 'difficultyLadderBurnShard2.test.ts']
    const out = await seq.sort(names.map(spec))
    const secs = out.map((s: { moduleId: string }) => durations[s.moduleId.split('/').pop()!] ?? 0)
    expect(secs[0], '最慢的必须排第一').toBe(Math.max(...secs))
    for (let i = 1; i < secs.length; i++) expect(secs[i]).toBeLessThanOrEqual(secs[i - 1])
  })

  it('② 未测到的文件排最后（不是排最前，也不能丢）', async () => {
    const seq = new SlowestFirstSequencer({})
    const out = await seq.sort([spec('zzz-unknown.test.ts'), spec('difficultyCurve.test.ts'), spec('aaa-unknown.test.ts')])
    expect(out).toHaveLength(3)
    expect(out[0].moduleId).toContain('difficultyCurve.test.ts')
    expect(out.slice(1).every(s => s.moduleId.includes('unknown'))).toBe(true)
  })

  it('③ 一个都不丢：排序后集合与原集合相同（最坏失效方向 = 漏跑）', async () => {
    const seq = new SlowestFirstSequencer({})
    const input = Object.keys(durations).slice(0, 40).map(spec)
    const out = await seq.sort(input)
    expect(out).toHaveLength(input.length)
    expect(new Set(out.map(s => s.moduleId))).toEqual(new Set(input.map(s => s.moduleId)))
  })

  it('④ 稳定：同耗时的相对顺序不变（避免每次跑出不同的长尾）', async () => {
    const seq = new SlowestFirstSequencer({})
    const same = { moduleId: '/x/same.test.ts', taskId: 'same' }
    const out = await seq.sort([same, { ...same, taskId: 'same2' }, { ...same, taskId: 'same3' }])
    expect(out.map(s => s.taskId)).toEqual(['same', 'same2', 'same3'])
  })

  it('⑥ 逃生口：VITEST_SEQUENCER=off ⇒ 原样返回（A/B 对照用，不许偷偷排序）', async () => {
    process.env.VITEST_SEQUENCER = 'off'
    const seq = new SlowestFirstSequencer({})
    const input = [spec('aaa.test.ts'), spec('difficultyCurve.test.ts'), spec('zzz.test.ts')]
    const out = await seq.sort(input)
    expect(out.map((s: { taskId: string }) => s.taskId)).toEqual(['aaa.test.ts', 'difficultyCurve.test.ts', 'zzz.test.ts'])
  })

  it('⑤ 排序键来自 test-durations.json（与三环清单同一份数据，不另起事实源）', () => {
    const listed = Object.keys(durations)
    expect(listed.length, 'test-durations.json 至少要有几百个文件，否则排序等于没做').toBeGreaterThan(300)
    expect(listed).toContain('difficultyCurve.test.ts')
  })
})
