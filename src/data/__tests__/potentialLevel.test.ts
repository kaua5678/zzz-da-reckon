/**
 * CC-503：潜能等级归一只写一份（`data/potentialLevel.ts#potentialLevelOf`）。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { POTENTIAL_LEVEL_DEFAULT, potentialLevelOf } from '@/data/potentialLevel'

const SRC = join(__dirname, '..', '..')
const stripComments = (s: string) => s.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')

describe('potentialLevelOf（CC-503）', () => {
  it('1..6 整数原样；小数 floor；越界夹；0 ⇒ 1', () => {
    for (let i = 1; i <= 6; i++) expect(potentialLevelOf(i)).toBe(i)
    expect(potentialLevelOf(3.9)).toBe(3)
    expect(potentialLevelOf(99)).toBe(6)
    expect(potentialLevelOf(0)).toBe(1)
    expect(potentialLevelOf(-2)).toBe(1)
  })
  it('空 / 非有限 ⇒ 缺省 6', () => {
    expect(POTENTIAL_LEVEL_DEFAULT).toBe(6)
    expect(potentialLevelOf(undefined)).toBe(6)
    expect(potentialLevelOf(null)).toBe(6)
    expect(potentialLevelOf(NaN)).toBe(6)
    expect(potentialLevelOf('abc')).toBe(6)
    expect(potentialLevelOf('4')).toBe(4)
  })
  it('源码锁：mechanics/agents 与 core/panel.ts 不再手写 Math.min(6, …potential…)', () => {
    const agents = join(SRC, 'mechanics', 'agents')
    const files = readdirSync(agents).filter(f => f.endsWith('.ts')).map(f => join(agents, f))
    files.push(join(SRC, 'core', 'panel.ts'))
    for (const f of files) {
      const code = stripComments(readFileSync(f, 'utf8'))
      const bad = code.split('\n').filter(l => /Math\.min\(6,/.test(l) && /otential/i.test(l))
      expect(bad, f).toEqual([])
    }
  })
})
