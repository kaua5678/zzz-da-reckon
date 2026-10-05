/**
 * CC-280（第 295 轮）：「非有限值 → 0」的比例钳位 / 非负取整只在 utils/finiteClamp.ts 定义一次。
 * 此前 19 个角色模块各自私抄（jscpd 跨文件克隆主体）。语义不同的近名 helper（不挡 NaN 的 clamp01 等）
 * 见 finiteClamp.ts 头注释，不在本锁范围。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { clampRatio, finiteOr0, positiveWholeCounts, whole } from '@/utils/finiteClamp'

const SRC = resolve(__dirname, '../..')

describe('CC-280 finiteClamp 单一实现', () => {
  it('语义：非有限值 → 0，其余按区间钳 / 向下取整', () => {
    expect([NaN, Infinity, -Infinity, -0.5, 0.25, 3].map(clampRatio)).toEqual([0, 0, 0, 0, 0.25, 1])
    expect([NaN, Infinity, undefined, -2, 2.9].map(whole)).toEqual([0, 0, 0, 0, 2])
  })
  it('CC-461 finiteOr0：非 number / 非有限值 → 0，其余原值（不强转字符串）', () => {
    expect([NaN, Infinity, -Infinity, undefined, null, '3', true, -2, 0.25].map(finiteOr0)).toEqual([0, 0, 0, 0, 0, 0, 0, -2, 0.25])
  })
  it('CC-481 positiveWholeCounts：Number 强转 + 向下取整 + 丢非正项，不改入参', () => {
    const raw = { a: 2.9, b: '3', c: -1, d: NaN, e: null, f: Infinity, g: 0 } as Record<string, unknown>
    // +Infinity 透传是三份私抄的历史语义（`Number(v) || 0` 不挡 Infinity，与 whole() 的 isFinite 口径不同）——如实登记，不借归一改行为
    expect(positiveWholeCounts(raw)).toEqual({ a: 2, b: 3, f: Infinity })
    expect(positiveWholeCounts(undefined)).toEqual({})
    expect(Object.keys(raw)).toHaveLength(7)
  })
  it('CC-481 源码：别处不许再私写「entries 循环 + Math.max(0, Math.floor(Number(v) || 0)) + 丢非正项」的计数表归一体', () => {
    // 只锁整个循环体（三行连在一起），不锁单行 `Math.max(0, Math.floor(Number(x) || 0))`——那是全仓 60+ 处的标量取整习语，
    // 与 `whole()` 的 Number.isFinite 口径不同（字符串可转），r667 判定不收（见 finiteClamp.ts 头注释「故意没有收」一节）。
    const hits: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name)
        if (statSync(p).isDirectory()) { if (name !== '__tests__') walk(p); continue }
        if (!/\.(ts|vue)$/.test(name) || name.endsWith('.test.ts')) continue
        if (/Object\.entries\([^)]*\)\) \{\n\s*const (\w+) = Math\.max\(0, Math\.floor\(Number\(\w+\) \|\| 0\)\)\n\s*if \(\1 > 0\) \w+\[\w+\] = \1/.test(readFileSync(p, 'utf-8'))) hits.push(relative(SRC, p))
      }
    }
    walk(SRC)
    expect(hits).toEqual(['utils/finiteClamp.ts'])
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
