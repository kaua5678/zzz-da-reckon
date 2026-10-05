/**
 * CC-494：Boss 异常状态轴「按触发时刻状态归因」的次数分摊只写一份（`bossAxisStateShares`）。
 * 异放 dominant / 极性紊乱 dominant 两条路径都走它；damagePoolRelease 不再自抄分摊循环。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { bossAxisStateShares, hasBossAxisSegments, type BossAnomalyStateResult } from '@/core/stunAxis/inStunAnomaly'

const mk = (over: Partial<BossAnomalyStateResult> = {}): BossAnomalyStateResult => ({
  stateChainsPerWindow: [[{ start: 0, end: 10, element: 'fire' }], [{ start: 0, end: 5, element: 'ice' }]],
  windOverlayPerWindow: [[], []],
  disorders: [],
  windowDuration: 10,
  note: '',
  ...over,
})

describe('bossAxisStateShares（CC-494）', () => {
  it('hasBossAxisSegments：无窗 / 全空链 → false；风化层有段也算', () => {
    expect(hasBossAxisSegments(null)).toBe(false)
    expect(hasBossAxisSegments(mk({ stateChainsPerWindow: [], windOverlayPerWindow: [] }))).toBe(false)
    expect(hasBossAxisSegments(mk({ stateChainsPerWindow: [[]], windOverlayPerWindow: [[]] }))).toBe(false)
    expect(hasBossAxisSegments(mk({ stateChainsPerWindow: [[]], windOverlayPerWindow: [[{ start: 0, end: 1, element: 'wind' }]] }))).toBe(true)
    expect(hasBossAxisSegments(mk())).toBe(true)
  })
  it('总量守恒、按窗加权、取样查状态、无状态计 fallback、只回正份额', () => {
    const boss = mk()
    // 两窗各占 1 次失衡：10 次 → 5/5；窗 0 全程 fire；窗 1 前半 ice 后半无状态 → fallback
    const r = bossAxisStateShares(boss, 10, [{ count: 1 }, { count: 1 }], 2, () => 999, 'physical')
    expect(r.reduce((s, p) => s + p.count, 0)).toBe(10)
    expect(r.find(p => p.element === 'fire')?.count).toBe(5)
    expect(r.every(p => p.count > 0)).toBe(true)
    expect(new Set(r.map(p => p.element))).toEqual(new Set(['fire', 'ice', 'physical']))
    expect(r.map(p => p.count)).toEqual([...r.map(p => p.count)].sort((a, b) => b - a))
  })
  it('全 0 权重 → 均分；windowDuration 未注入才用 fallback；total 取 floor', () => {
    const boss = mk({ windowDuration: undefined })
    let asked = 0
    const r = bossAxisStateShares(boss, 4.9, [{ count: 1 }], 0, () => { asked++; return 10 }, 'physical')
    expect(asked).toBe(1)
    expect(r.reduce((s, p) => s + p.count, 0)).toBe(4)
    expect(bossAxisStateShares(mk(), 0, [{ count: 1 }], 1, () => 10, 'physical')).toEqual([])
  })
  it('源码锁：damagePoolRelease 不再自抄分摊循环，两处都走 helper', () => {
    const src = readFileSync(join(__dirname, '..', '..', '..', 'composables', 'resourceCalc', 'damagePoolRelease.ts'), 'utf8')
    expect(src.includes('attributeCountByStateChain(')).toBe(false)
    expect(src.includes('allocateAxisWindows(')).toBe(false)
    // 覆盖率权重路径仍单独用一次 distributeIntegerByWeight（不同规则）；状态轴路径不再出现
    expect(src.split('distributeIntegerByWeight(').length - 1).toBe(1)
    expect(src.split('bossAxisStateShares(').length - 1).toBe(2)
    expect(src.split('hasBossAxisSegments(').length - 1).toBe(2)
  })
})
