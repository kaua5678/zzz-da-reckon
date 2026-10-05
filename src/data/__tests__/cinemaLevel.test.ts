/**
 * CC-506：影画等级归一只写一份（`data/cinemaLevel.ts#cinemaLevelOf`）。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { CINEMA_LEVEL_MAX, cinemaLevelOf } from '@/data/cinemaLevel'

const SRC = join(__dirname, '..', '..')
const stripComments = (s: string) => s.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')

describe('cinemaLevelOf（CC-506）', () => {
  it('0..6 整数原样；小数 floor；越界夹', () => {
    for (let i = 0; i <= 6; i++) expect(cinemaLevelOf(i)).toBe(i)
    expect(CINEMA_LEVEL_MAX).toBe(6)
    expect(cinemaLevelOf(3.9)).toBe(3)
    expect(cinemaLevelOf(99)).toBe(6)
    expect(cinemaLevelOf(-2)).toBe(0)
  })
  it('空 / 非有限 ⇒ 0；数字串可解析', () => {
    expect(cinemaLevelOf(undefined)).toBe(0)
    expect(cinemaLevelOf(null)).toBe(0)
    expect(cinemaLevelOf(NaN)).toBe(0)
    expect(cinemaLevelOf(Infinity)).toBe(0)
    expect(cinemaLevelOf('abc')).toBe(0)
    expect(cinemaLevelOf('4')).toBe(4)
  })
  it('源码锁：mechanics 下不再手写 floor(…CinemaLevel…) / whole(…CinemaLevel…) / …cinemaLevel ?? 0（r689 收尾：所有影画读法走 cinemaLevelOf）', () => {
    const dir = join(SRC, 'mechanics')
    const walk = (d: string, out: string[] = []): string[] => {
      for (const f of readdirSync(d, { withFileTypes: true })) {
        if (f.name === '__tests__') continue
        const p = join(d, f.name)
        if (f.isDirectory()) walk(p, out)
        else if (f.name.endsWith('.ts')) out.push(p)
      }
      return out
    }
    for (const f of walk(dir)) {
      const code = stripComments(readFileSync(f, 'utf8'))
      const bad = code.split('\n').filter(l => /(Math\.floor\(|whole\()\s*(Number\()?\s*[\w.?]*[cC]inemaLevel|[cC]inemaLevel\s*\?\?\s*0\b/.test(l))
      expect(bad, f).toEqual([])
    }
  })
})
