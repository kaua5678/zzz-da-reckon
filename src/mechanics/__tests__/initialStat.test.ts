/**
 * CC-497：「初始 X」= 局外面板 这条规则只写一份（`mechanics/initialStat.ts#initialStat`）。
 * 源码锁：agents 下不再出现 `(outOfCombatPanel ?? panel)` 手写回落（claret 有意不回落、xide 读队友 cfg，不在此列）。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { initialStat } from '@/mechanics/initialStat'

const AGENTS = join(__dirname, '..', 'agents')

describe('initialStat（CC-497）', () => {
  it('局外面板优先；缺省回落局内；再缺省 0；不做 Number 转换以外的加工', () => {
    expect(initialStat({ atk: 1200 }, { atk: 1500 }, 'atk')).toBe(1200)
    expect(initialStat(undefined, { atk: 1500 }, 'atk')).toBe(1500)
    expect(initialStat(null, undefined, 'atk')).toBe(0)
    // 回落是对象级（局外面板对象存在但该字段缺省 → 0），不是字段级——与原各处 `(a ?? b).x ?? 0` 一致
    expect(initialStat({ anomalyMastery: undefined }, { anomalyMastery: 110 }, 'anomalyMastery')).toBe(0)
    expect(initialStat({ critRate: 0 }, { critRate: 80 }, 'critRate')).toBe(0)
  })
  it('源码锁：agents 下无手写回落，≥7 处走 initialStat', () => {
    const files = readdirSync(AGENTS).filter(f => f.endsWith('.ts'))
    let uses = 0
    for (const f of files) {
      const src = readFileSync(join(AGENTS, f), 'utf8')
      expect(src.includes('outOfCombatPanel ?? panel'), f).toBe(false)
      uses += src.split('initialStat(').length - 1
    }
    expect(uses).toBeGreaterThanOrEqual(7)
  })
})
