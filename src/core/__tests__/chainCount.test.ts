/**
 * CC-505：连携总次数读取口只写一份（`core/chainCount.ts#chainCountTotalOf`）。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { chainCountTotalOf } from '@/core/chainCount'

const SRC = join(__dirname, '..', '..')
function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f)
    if (f === '__tests__' || f === 'node_modules') continue
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|vue)$/.test(f) && !/\.test\.ts$/.test(f)) out.push(p)
  }
  return out
}

describe('chainCountTotalOf（CC-505）', () => {
  it('有覆盖值即为准（含 0），否则 perStun × stunCount；perStun 缺省按 0', () => {
    expect(chainCountTotalOf({ chainCountTotalOverride: 7, chainCountPerStun: 2 }, 5)).toBe(7)
    expect(chainCountTotalOf({ chainCountTotalOverride: 0, chainCountPerStun: 2 }, 5)).toBe(0)
    expect(chainCountTotalOf({ chainCountPerStun: 2 }, 5)).toBe(10)
    expect(chainCountTotalOf({ chainCountPerStun: 1.5 }, 3)).toBe(4.5)
    expect(chainCountTotalOf({}, 5)).toBe(0)
  })
  it('源码锁：src 下（测试除外）「override ?? perStun ×」只出现在 owner', () => {
    const owner = join(SRC, 'core', 'chainCount.ts')
    const re = /chainCountTotalOverride\s*\?\?\s*\(?\s*\w+\.chainCountPerStun/g
    for (const f of walk(SRC)) {
      const code = readFileSync(f, 'utf8').split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
      const hits = (code.match(re) ?? []).length
      expect(hits, f).toBe(f === owner ? 1 : 0)
    }
  })
})
