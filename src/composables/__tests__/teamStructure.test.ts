/**
 * CC-483（r669）：「一支队至多 1 名击破」只在 composables/teamStructure.ts 里写一次。
 * 1) 行为：主C 是击破 ⇒ 双队友都不能是击破；主C 非击破 ⇒ 双队友至多 1 名击破；未知 id 按非击破计；候选池顺序保持。
 * 2) 源码锁：composables 下不再内联 `isStun = (id` / `stunBudget`；三处调用方都导入 teamStructure。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { MAX_STUN_PER_TEAM, stunCountOf, teamStunOk, teammatePairsFor } from '@/composables/teamStructure'

const SPEC: Record<string, string> = { m: 'attack', s1: 'stun', s2: 'stun', a: 'anomaly', b: 'support' }
const catalog = { getAgent: (id: string) => (id in SPEC ? ({ specialty: SPEC[id] } as never) : undefined) } as Parameters<typeof stunCountOf>[1]

describe('teamStructure（CC-483）', () => {
  it('上限 1；stunCountOf 只数 specialty === stun，未知 id 计 0', () => {
    expect(MAX_STUN_PER_TEAM).toBe(1)
    expect(stunCountOf(['m', 's1', 's2', 'zz'], catalog)).toBe(2)
    expect(teamStunOk(['m', 's1', 'a'], catalog)).toBe(true)
    expect(teamStunOk(['m', 's1', 's2'], catalog)).toBe(false)
    expect(teamStunOk(['s1', 'a', 'zz'], catalog)).toBe(true)
  })

  it('主C 非击破：双队友至多 1 名击破；顺序 = 候选池顺序 i<j', () => {
    expect(teammatePairsFor('m', ['s1', 'a', 's2', 'b'], catalog)).toEqual([
      ['s1', 'a'], ['s1', 'b'], ['a', 's2'], ['a', 'b'], ['s2', 'b'],
    ])
  })

  it('主C 是击破：双队友里一个击破都不能有', () => {
    expect(teammatePairsFor('s1', ['s2', 'a', 'b'], catalog)).toEqual([['a', 'b']])
    expect(teammatePairsFor('s1', ['s2'], catalog)).toEqual([])
  })

  it('源码锁：composables 下击破规则不再内联；三处调用方走 teamStructure', () => {
    const root = join(process.cwd(), 'src/composables')
    const files: string[] = []
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = join(d, f)
        if (statSync(p).isDirectory()) { if (f !== '__tests__') walk(p) } else if (p.endsWith('.ts') || p.endsWith('.vue')) files.push(p)
      }
    }
    walk(root)
    const inline = files.filter(p => !p.endsWith('teamStructure.ts') && /\bisStun = \(|\bstunBudget\b|specialty \?\? ''\) === 'stun'/.test(readFileSync(p, 'utf8')))
    expect(inline.map(p => p.slice(root.length + 1))).toEqual([])
    for (const f of ['teamTimeline.ts', 'teamTimelineFilm.ts', 'pullPlannerEngine.ts']) {
      expect(readFileSync(join(root, f), 'utf8')).toMatch(/from '@\/composables\/teamStructure'/)
    }
  })
})
