/**
 * 双锋御队（1601 挽昼 + 1611 克拉蕾）共用同一个 Boss 残痕池 —— 判据。
 *
 * 用户裁决 2026-10-25：「残痕/毁伤 = 锋御职业的通用机制，多个锋御同队时共用**同一个** Boss
 * 残痕池（不是各算各的）」；2026-11-08 用户补充：「如果选择了双锋御，他的计算逻辑不能缺失」。
 *
 * 本文件锁五件事：
 * ① **单锋御不启用团队池**（`collectSharpenGashClaims` 返回 null）——这是零回归的构造性保证；
 * ② **池合并**：`floor((a+b)/600) ≥ floor(a/600)+floor(b/600)`，合并只会多不会少；
 * ③ **按贡献比例分配**（不是槽位序抢占）——需求超池时谁都不能独吞；
 * ④ **需求封顶**：申报需求小的槽不会因为比例大就多拿；
 * ⑤ **剩余层由接管者打完**（克拉蕾的自动补足葬血强袭），且总分配 = 池总层数。
 */
import { describe, expect, it } from 'vitest'
import {
  collectSharpenGashClaims,
  resolveTeamGashPool,
  gashLayersOf,
} from '@/mechanics/gashMaim'

describe('[1601/1611] 双锋御共用残痕池', () => {
  it('① 单锋御 ⇒ 不启用团队池（collect 返回 null）', () => {
    // 只有挽昼
    const sunOnly = collectSharpenGashClaims([
      { slot: 0, sunbringerGashSource: { points: 6000, demandLayers: 20 } },
      { slot: 1 },
    ] as any)
    expect(sunOnly).toBeNull()
    // 只有克拉蕾
    const claretOnly = collectSharpenGashClaims([
      { slot: 0, claretSharpResourceSource: { gashValuePct: 9000, gashPoolDeclaredLayers: 4 } },
    ] as any)
    expect(claretOnly).toBeNull()
    // 一个锋御都没有
    expect(collectSharpenGashClaims([{ slot: 0 }, { slot: 1 }] as any)).toBeNull()
  })

  it('①-b 双锋御 ⇒ 收集到两槽申报', () => {
    const claims = collectSharpenGashClaims([
      { slot: 0, sunbringerGashSource: { points: 6000, demandLayers: 20 } },
      { slot: 1, claretSharpResourceSource: { gashValuePct: 9000, gashPoolDeclaredLayers: 4 } },
    ] as any)
    expect(claims).not.toBeNull()
    expect(Object.keys(claims!).map(Number).sort()).toEqual([0, 1])
    expect(claims![0]!.points).toBe(6000)
    expect(claims![1]!.points).toBe(9000)
    // 克拉蕾声明「接管剩余层」；挽昼不接管
    expect(claims![1]!.drainsLeftover).toBe(true)
    expect(claims![0]!.drainsLeftover ?? false).toBe(false)
  })

  it('② 池合并：floor((a+b)/600) ≥ 各自 floor 之和', () => {
    // 各 480 点：分开算 0+0，合并 1
    const claims = {
      0: { points: 480, demandLayers: 99 },
      1: { points: 480, demandLayers: 99, drainsLeftover: true },
    }
    const pool = resolveTeamGashPool(claims)!
    expect(pool.layers).toBe(1)
    expect(gashLayersOf(480) + gashLayersOf(480)).toBe(0) // 反例先行
  })

  it('③ 按贡献比例分配：需求超池时谁都不能独吞', () => {
    // 点数 6000 : 9000 = 2:3，池 25 层 ⇒ 10 : 15
    const pool = resolveTeamGashPool({
      0: { points: 6000, demandLayers: 999 },
      1: { points: 9000, demandLayers: 999, drainsLeftover: true },
    })!
    expect(pool.layers).toBe(25)
    expect(pool.bySlot[0]).toBe(10)
    expect(pool.bySlot[1]).toBe(15)
    // 负控：槽位序抢占的读法会让槽0 独吞 25 —— 断言它没有
    expect(pool.bySlot[0]).toBeLessThan(pool.layers)
  })

  it('③-b 比例分配与槽位序无关（同一组申报换槽号，份额跟着点数走）', () => {
    const a = resolveTeamGashPool({
      0: { points: 6000, demandLayers: 999 },
      1: { points: 9000, demandLayers: 999, drainsLeftover: true },
    })!
    const b = resolveTeamGashPool({
      0: { points: 9000, demandLayers: 999 },
      1: { points: 6000, demandLayers: 999, drainsLeftover: true },
    })!
    expect(a.layers).toBe(b.layers)
    // 点数多的槽拿得多（不论它在哪个槽位）
    expect(a.bySlot[1]).toBeGreaterThan(a.bySlot[0]!)
    expect(b.bySlot[0]!).toBeGreaterThan(b.bySlot[1]!)
  })

  it('④ 需求封顶：申报需求小的槽不会因比例大就多拿', () => {
    // 点数 9000(≈15层份额) 但只申报 3 层 ⇒ 最多拿 3
    const pool = resolveTeamGashPool({
      0: { points: 9000, demandLayers: 3 },
      1: { points: 3000, demandLayers: 999, drainsLeftover: true },
    })!
    expect(pool.bySlot[0]).toBe(3)
    // 被 cap 掉的份额回流给接管者，池不浪费
    expect(pool.bySlot[1]! + 3).toBe(pool.layers)
  })

  it('⑤ 总分配恒等于池层数（有接管者时零浪费）', () => {
    for (const [p0, p1] of [[600, 600], [1234, 5678], [10000, 100], [0, 3000]]) {
      const pool = resolveTeamGashPool({
        0: { points: p0!, demandLayers: 999 },
        1: { points: p1!, demandLayers: 999, drainsLeftover: true },
      })!
      const sum = Object.values(pool.bySlot).reduce((s, v) => s + v, 0)
      expect(sum, `p0=${p0} p1=${p1}`).toBe(pool.layers)
      expect(pool.unspent).toBe(0)
    }
  })

  it('零池：点数不足一层 ⇒ 全 0（不产生负份额）', () => {
    const pool = resolveTeamGashPool({
      0: { points: 100, demandLayers: 5 },
      1: { points: 200, demandLayers: 5, drainsLeftover: true },
    })!
    expect(pool.layers).toBe(0)
    expect(pool.bySlot).toEqual({})
  })
})