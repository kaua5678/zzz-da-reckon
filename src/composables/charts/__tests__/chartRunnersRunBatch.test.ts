/**
 * CC-485（r670）：chartRunners 四个跑批函数共用的生命周期只在 `runBatch` 里写一次。
 * 1) 行为：发车置忙 / 进度经 commit 回写 / 结果经 publish / finally 收尾；被新运行顶掉的旧运行一个字都写不进去；
 *    compute 抛错时 finally 仍收尾且错误向上抛。
 * 2) 源码锁：chartRunners.ts 里 `owner.start()` / `withAnalysisScenario(` 各只出现一次（都在 runBatch 里）。
 */
import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createBatchOwner } from '@/composables/batchTask'

vi.mock('@/composables/analysisScenario', () => ({
  withAnalysisScenario: async (fn: (s: unknown) => unknown) => fn({ fake: true }),
}))

import { runBatch } from '@/composables/charts/chartRunners'

function io() {
  return { owner: createBatchOwner(), computing: ref(false), progress: ref<{ pct: number; text: string } | null>(null) }
}

describe('chartRunners.runBatch（CC-485）', () => {
  it('置忙 → 进度经 commit 回写 → publish 结果 → finally 收尾', async () => {
    const x = io()
    const seen: Array<boolean | string> = []
    let published: number | null = null
    await runBatch(x, {}, async (scenario, batch) => {
      seen.push(x.computing.value, x.progress.value?.text ?? '')
      expect(scenario).toEqual({ fake: true })
      expect(batch.control.signal.aborted).toBe(false)
      batch.onProgress({ pct: 50, text: '一半' })
      seen.push(x.progress.value?.text ?? '')
      return 42
    }, res => { published = res })
    expect(seen).toEqual([true, '准备…', '一半'])
    expect(published).toBe(42)
    expect(x.computing.value).toBe(false)
    expect(x.progress.value).toBeNull()
  })

  it('被新运行顶掉：旧运行的进度 / publish / finally 都写不进去，signal 已 abort', async () => {
    const x = io()
    let release!: () => void
    const gate = new Promise<void>(r => { release = r })
    let oldPublished = false
    let oldSignalAborted = false
    const oldRun = runBatch(x, {}, async (_s, batch) => {
      await gate
      oldSignalAborted = batch.control.signal.aborted
      batch.onProgress({ pct: 99, text: '旧进度' })
      return 'old'
    }, () => { oldPublished = true })
    let newPublished = ''
    const newRun = runBatch(x, { yieldFirst: true }, async () => 'new', res => { newPublished = res })
    release()
    await Promise.all([oldRun, newRun])
    expect(oldSignalAborted).toBe(true)
    expect(oldPublished).toBe(false)
    expect(newPublished).toBe('new')
    // 新运行自己的 finally 已收尾；旧运行的 finally 没有权限再碰
    expect(x.computing.value).toBe(false)
    expect(x.progress.value).toBeNull()
  })

  it('compute 抛错：错误向上抛，finally 仍收尾', async () => {
    const x = io()
    await expect(runBatch(x, {}, async () => { throw new Error('boom') }, () => {})).rejects.toThrow('boom')
    expect(x.computing.value).toBe(false)
    expect(x.progress.value).toBeNull()
  })

  it('源码锁：发车与分析场景只在 runBatch 里出现一次', () => {
    const src = readFileSync(join(process.cwd(), 'src/composables/charts/chartRunners.ts'), 'utf8')
    expect(src.match(/= io\.owner\.start\(\)/g)?.length).toBe(1)
    expect(src.match(/await withAnalysisScenario\(/g)?.length).toBe(1)
    expect(src.match(/return runBatch\(/g)?.length).toBe(4)
  })
})
