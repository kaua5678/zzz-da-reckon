/**
 * CC-228：贯穿力单一来源 src/data/penetrationPower.ts（引擎 core/damage.ts 原名转出；展示层 FinalPanel / StatPanel / DebugPage 直接 import）。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { calcPenetrationPower } from '@/data/penetrationPower'
import { calcPenetrationPower as coreCalcPenetrationPower } from '@/core/damage'

describe('贯穿力单一来源（CC-228）', () => {
  it('公式：atk×0.3 + hp×0.1 + 固定；core 转出与 data 同一函数', () => {
    expect(calcPenetrationPower({ atk: 3000, hp: 10000, sheerForceFlat: 200 })).toBeCloseTo(900 + 1000 + 200, 9)
    expect(calcPenetrationPower({ atk: 1000, hp: 0 })).toBeCloseTo(300, 9)
    expect(coreCalcPenetrationPower).toBe(calcPenetrationPower)
  })
  it('源码锁：除 data/penetrationPower.ts 外不许手写 atk * 0.3（注释行除外）', () => {
    const SRC = join(__dirname, '..', '..')
    const RE = /\batk\s*\*\s*0\.3\b/
    const hits: string[] = []
    const walk = (d: string) => {
      for (const n of readdirSync(d)) {
        const f = join(d, n)
        if (statSync(f).isDirectory()) { if (n !== '__tests__') walk(f); continue }
        if (!/\.(ts|vue)$/.test(n)) continue
        const rel = relative(SRC, f).replace(/\\/g, '/')
        if (rel === 'data/penetrationPower.ts') continue
        readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
          const t = line.trim()
          if (t.startsWith('//') || t.startsWith('*')) return
          if (RE.test(line.replace(/\/\/.*$/, ''))) hits.push(`${rel}:${i + 1}`)
        })
      }
    }
    walk(SRC)
    expect(hits).toEqual([])
  })
})
