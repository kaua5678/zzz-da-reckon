/**
 * CC-466 锁：可选回能键三态解析只有一份实现（resolveRecoveryPerCount）。
 * ① 语义表：override / 显式 0 / 表值回填 / 表值 0 落行值 / 全缺省 0；
 * ② 源码锁：src 非测试代码不得再手写 `.decibelRecovery === 0` / `.energyRecovery === 0` 分支
 *    （行为级 parity 见 decibelRowParity / energyRowParity）。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { resolveRecoveryPerCount } from '@/core/resource/rowAccounting'

describe('CC-466 resolveRecoveryPerCount', () => {
  it('三态语义', () => {
    expect(resolveRecoveryPerCount(12, true, 99)).toBe(12)
    expect(resolveRecoveryPerCount(undefined, true, 99)).toBe(0)
    expect(resolveRecoveryPerCount(0, undefined, 99)).toBe(0)
    expect(resolveRecoveryPerCount(undefined, undefined, 99)).toBe(99)
    expect(resolveRecoveryPerCount(5, undefined, 99)).toBe(99)
    expect(resolveRecoveryPerCount(5, undefined, 0)).toBe(5)
    expect(resolveRecoveryPerCount(undefined, undefined, undefined)).toBe(0)
    expect(resolveRecoveryPerCount(Number.NaN, undefined, 7)).toBe(7)
  })
  it('src 非测试代码无手写三态分支', () => {
    const root = join(__dirname, '..', '..')
    const hits: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name)
        if (statSync(p).isDirectory()) { if (name !== '__tests__' && name !== 'test') walk(p); continue }
        if (!/\.(ts|vue)$/.test(name) || /\.test\.ts$/.test(name)) continue
        const src = readFileSync(p, 'utf8')
        const m = src.match(/\.(decibel|energy)Recovery === 0/g)
        if (m) hits.push(`${p.slice(root.length + 1)}:${m.length}`)
      }
    }
    walk(root)
    expect(hits).toEqual([])
  })
})
