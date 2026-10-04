/**
 * CC-280（第 295 轮）：「非有限值 → 0」的比例钳位 / 非负取整只在 utils/finiteClamp.ts 定义一次。
 * 此前 19 个角色模块各自私抄（jscpd 跨文件克隆主体）。语义不同的近名 helper（不挡 NaN 的 clamp01 等）
 * 见 finiteClamp.ts 头注释，不在本锁范围。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { clampRatio, finiteOr0, whole } from '@/utils/finiteClamp'

const SRC = resolve(__dirname, '../..')

describe('CC-280 finiteClamp 单一实现', () => {
  it('语义：非有限值 → 0，其余按区间钳 / 向下取整', () => {
    expect([NaN, Infinity, -Infinity, -0.5, 0.25, 3].map(clampRatio)).toEqual([0, 0, 0, 0, 0.25, 1])
    expect([NaN, Infinity, undefined, -2, 2.9].map(whole)).toEqual([0, 0, 0, 0, 2])
  })
  it('CC-461 finiteOr0：非 number / 非有限值 → 0，其余原值（不强转字符串）', () => {
    expect([NaN, Infinity, -Infinity, undefined, null, '3', true, -2, 0.25].map(finiteOr0)).toEqual([0, 0, 0, 0, 0, 0, 0, -2, 0.25])
  })
  it('CC-461 源码：别处不许再私写 `typeof x === \'number\' && Number.isFinite(x) ? x : 0`', () => {
    const hits: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name)
        if (statSync(p).isDirectory()) { if (name !== '__tests__') walk(p); continue }
        if (!/\.(ts|vue)$/.test(name) || name.endsWith('.test.ts')) continue
        readFileSync(p, 'utf-8').split('\n').forEach(l => {
          if (/typeof (\w+) === 'number' && Number\.isFinite\(\1\) \? \1 : 0\b/.test(l)) hits.push(relative(SRC, p))
        })
      }
    }
    walk(SRC)
    expect(hits).toEqual(['utils/finiteClamp.ts'])
  })

  it('源码：别处不许再私写同一函数体（`Math.max(0, Math.min(1, Number.isFinite(x) ? x : 0))` / `Math.max(0, Math.floor(Number.isFinite(x) ? x : 0))`）', () => {
    const hits: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name)
        if (statSync(p).isDirectory()) { if (name !== '__tests__') walk(p); continue }
        if (!/\.(ts|vue)$/.test(name) || name.endsWith('.test.ts')) continue
        readFileSync(p, 'utf-8').split('\n').forEach(l => {
          if (/Math\.max\(0, Math\.(min\(1, |floor\()Number\.isFinite\((\w+)\) \? \2 : 0\)\)/.test(l)) hits.push(relative(SRC, p))
        })
      }
    }
    walk(SRC)
    // 第 323 轮（§24.147）：只登记文件不登记行号——两处命中就是 clampRatio / whole 本体，行号只会让无关增删误报。
    expect(hits).toEqual(['utils/finiteClamp.ts', 'utils/finiteClamp.ts'])
  })
})
