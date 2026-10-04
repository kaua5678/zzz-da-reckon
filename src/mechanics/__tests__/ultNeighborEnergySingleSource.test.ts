import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  assignUltNeighborEnergy,
  ultNeighborPerTargetAmounts,
  ULT_NEIGHBOR_NEXT_ENERGY,
  ULT_NEIGHBOR_PREV_ENERGY,
} from '@/mechanics/ultNeighborEnergy'

const AGENTS_DIR = join(__dirname, '..', 'agents')

/**
 * CC-462（r581）：终结技邻位回能三模块共用一份数学。
 * 锁①语义（原 lucy/rina/soukaku 三处用例迁入）；锁②单一来源——`src/mechanics/agents/` 下不得再出现
 * `UltNeighborEnergy(` 的函数定义，且邻位环绕算式只许住在共享文件。
 */
describe('CC-462 终结技邻位回能单一来源', () => {
  it('三人：下一位 +30、上一位 +10；两人：另一位 +30；单人：空', () => {
    expect(ULT_NEIGHBOR_NEXT_ENERGY).toBe(30)
    expect(ULT_NEIGHBOR_PREV_ENERGY).toBe(10)
    expect(assignUltNeighborEnergy([0, 1, 2], 1)).toEqual({ 0: 10, 2: 30 })
    expect(assignUltNeighborEnergy([0, 1, 2], 2)).toEqual({ 0: 30, 1: 10 })
    expect(assignUltNeighborEnergy([0, 1], 1)).toEqual({ 0: 30 })
    expect(assignUltNeighborEnergy([0, 1], 0)).toEqual({ 1: 30 })
    expect(assignUltNeighborEnergy([0], 0)).toEqual({})
    expect(assignUltNeighborEnergy([0, 1, 2], 1, 20, 5)).toEqual({ 0: 5, 2: 20 })
  })
  it('perTargetAmounts 共用体：份额 × floor(终结次数)，非负，缺省 0', () => {
    expect(ultNeighborPerTargetAmounts(1, 3, 2)).toEqual({ 0: 20, 2: 60 })
    expect(ultNeighborPerTargetAmounts(0, 2, 1.9)).toEqual({ 1: 30 })
    expect(ultNeighborPerTargetAmounts(0, 3, undefined)).toEqual({ 1: 0, 2: 0 })
    expect(ultNeighborPerTargetAmounts(0, 3, -4)).toEqual({ 1: 0, 2: 0 })
  })
  it('agents/ 下无同名私有副本；三模块均经共享体接 perTargetAmounts', () => {
    const files = readdirSync(AGENTS_DIR).filter(f => f.endsWith('.ts'))
    const defs: string[] = []
    const users: string[] = []
    for (const f of files) {
      const src = readFileSync(join(AGENTS_DIR, f), 'utf-8')
      if (/function \w*UltNeighborEnergy\(/.test(src)) defs.push(f)
      if (/ordered\.indexOf\(ownSlot\)/.test(src)) defs.push(f + ' (ring math)')
      if (src.includes('ultNeighborPerTargetAmounts(')) users.push(f)
    }
    expect(defs).toEqual([])
    expect(users.sort()).toEqual(['lucy.ts', 'rina.ts', 'soukaku.ts'])
  })
})
