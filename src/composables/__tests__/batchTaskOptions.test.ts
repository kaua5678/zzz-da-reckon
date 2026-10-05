/**
 * CC-490 源码锁：批任务公共选项只在 composables/batchTask.ts 声明一次。
 * - 各任务 Options 不再内联 `onProgress?: (p: { pct: number; text: string }) => void`（CC-490 前 10 处）
 * - `report` 闭包 `(pct, text) => opts.onProgress?.({ pct, text })` 只在 batchReporter 里（CC-490 前 7 处）
 * - 至少 9 个 Options `extends BatchTaskOptions`
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { batchReporter } from '@/composables/batchTask'

const SRC = join(__dirname, '..', '..')
const OWNER = 'composables/batchTask.ts'
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      if (name === '__tests__' || name === 'node_modules') continue
      walk(p, out)
    } else if (/\.(ts|vue)$/.test(name)) out.push(p)
  }
  return out
}
const files = walk(SRC).map(p => relative(SRC, p).replace(/\\/g, '/'))
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8')

describe('批任务公共选项单一声明（CC-490）', () => {
  it('没有内联的 onProgress 形状声明', () => {
    const hits = files.filter(rel => /onProgress\?:\s*\(p:\s*\{\s*pct:\s*number;\s*text:\s*string\s*\}\)\s*=>\s*void/.test(read(rel)))
    expect(hits).toEqual([])
  })
  it('report 闭包只在 batchReporter', () => {
    const hits = files.filter(rel => rel !== OWNER && /=>\s*opts\.onProgress\?\.\(\{\s*pct,\s*text\s*\}\)/.test(read(rel)))
    expect(hits).toEqual([])
    expect(read(OWNER).split('opts.onProgress?.({ pct, text })').length - 1).toBe(1)
  })
  it('至少 9 个 Options 继承 BatchTaskOptions', () => {
    const n = files.reduce((acc, rel) => acc + (read(rel).match(/extends BatchTaskOptions\b/g)?.length ?? 0), 0)
    expect(n).toBeGreaterThanOrEqual(9)
  })
  it('batchReporter：有回调时按 { pct, text } 转发，无回调时静默', () => {
    const got: Array<{ pct: number; text: string }> = []
    batchReporter({ onProgress: p => got.push(p) })(0.5, '一半')
    expect(got).toEqual([{ pct: 0.5, text: '一半' }])
    expect(() => batchReporter({})(1, 'done')).not.toThrow()
  })
})
