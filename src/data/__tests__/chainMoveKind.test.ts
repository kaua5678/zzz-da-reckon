/**
 * CC-319：终结技 / 连携技判定单一事实源（`data/chainMoveKind`）。
 * 陷阱：青衣 1251 普攻英文名 `Basic Attack: Penultimate #N` 含子串 `ultimate`——不看分类的判定会把它当终结技
 * （CC-319 前轴编辑页的「转大·60/90」块因此挂在 1251001 上；轴内放普攻块会被扣 3000 喧响、计入终结技需求）。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { chainMoveKind, findUltimateMove, isUltimateMoveName, isChainAttackMoveName } from '@/data/chainMoveKind'
import { findUltimate, findChainAttack } from '@/core/resource/moveLookup'

type Move = { id: string; name: { en?: string }; rows: { id: string; values: number[] }[] }
type Skills = { agentId: string; categories: { id: string; moves: Move[] }[] }
const catalog = JSON.parse(readFileSync(new URL('../../../public/static/catalog.json', import.meta.url), 'utf8')) as { agentSkills: Skills[] }
const skillsOf = (id: string) => catalog.agentSkills.find(a => a.agentId === id)!

describe('CC-319 chainMoveKind / findUltimateMove', () => {
  it('青衣普攻 Penultimate：名字含 ultimate，但不是终结技', () => {
    const qy = skillsOf('1251')
    const basic = qy.categories.find(c => c.id === 'basic')!.moves.find(m => m.id === '1251001')!
    expect((basic.name?.en ?? '').toLowerCase().includes('ultimate'), '陷阱仍在数据里').toBe(true)
    expect(chainMoveKind(qy, '1251001')).toBeNull()
    expect(chainMoveKind(qy, '1251004')).toBeNull()
    expect(findUltimateMove(qy)?.id).toBe('1251015')
    expect(chainMoveKind(qy, '1251015')).toBe('ultimate')
    expect(chainMoveKind(qy, '1251014')).toBe('chainAttack')
  })

  it('全部角色：findUltimateMove 与 core findUltimate 同口径；chainMoveKind 命中的招式都在 chain 分类', () => {
    expect(catalog.agentSkills.length).toBeGreaterThan(50)
    for (const a of catalog.agentSkills) {
      expect(findUltimateMove(a)?.id ?? null, a.agentId).toBe(findUltimate(a)?.moveId ?? null)
      const chainIds = new Set(a.categories.find(c => c.id === 'chain')?.moves.map(m => m.id) ?? [])
      for (const c of a.categories) for (const m of c.moves) {
        const k = chainMoveKind(a, m.id)
        if (k) expect(chainIds.has(m.id), `${a.agentId}:${m.id}`).toBe(true)
      }
      const ca = findChainAttack(a)
      if (ca) expect(chainMoveKind(a, ca.moveId), a.agentId).toBe('chainAttack')
    }
  })

  it('名字谓词互斥', () => {
    expect(isUltimateMoveName('Ultimate: X')).toBe(true)
    expect(isChainAttackMoveName('Ultimate: X')).toBe(false)
    expect(isChainAttackMoveName('Chain Attack: Y')).toBe(true)
    expect(isUltimateMoveName(undefined)).toBe(false)
  })
})
