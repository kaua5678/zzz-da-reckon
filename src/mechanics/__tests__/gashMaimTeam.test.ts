/**
 * 残痕 / 毁伤 = **锋御通用池**（2026-10-25 用户裁决）的判据。
 *
 * 用户原话：「残痕/毁伤 = 锋御职业的通用机制，不是克拉蕾/挽昼的专属——多个锋御同队时共用
 * **同一个 Boss 残痕池**（不是各算各的）」。
 *
 * 本文件锁三件事：
 * ① **池合并**：两槽各 480 点 ⇒ 共用池 960 点 = 1 层（各自 floor 会得 0 + 0 ⇒ 假绿反例就在下面）；
 * ② **分配**：按 priority（主C 在前）扣需求，池不够时后者拿不到，总数不翻倍（= 不重复计）；
 * ③ **单锋御逐位不变**：`allocateBossGashPool` 的单槽结果恒等于改造前两个模块各自手写的
 *    `min(floor(points/600), demand)` —— 这条把「重构不动数值」变成可机检的恒等式。
 *
 * ⚠ 双锋御队目前不存在（1601+1611 未进任何预设队），轴内共享池未建模 —— 已记在
 * `src/mechanics/gashMaim.ts` 的 debt 段（含升级路径）。
 */
import { describe, expect, it } from 'vitest'
import {
  GASH_PER_LAYER,
  GASH_MAX_STACKS,
  allocateBossGashPool,
  gashLayersOf,
} from '@/mechanics/gashMaim'

describe('[1661/1601] 残痕共用池（锋御通用机制）', () => {
  it('① 池合并：480 + 480 点 = 1 层（各自 floor 会是 0 + 0）', () => {
    // 反例先行：逐槽 floor 的读法在本例给出 0 层
    expect(gashLayersOf(480) + gashLayersOf(480)).toBe(0)
    const pool = allocateBossGashPool({
      contributions: [{ slot: 0, points: 480 }, { slot: 1, points: 480 }],
      demand: [{ slot: 0, layers: 3 }, { slot: 1, layers: 3 }],
      priority: [0, 1],
    })
    expect(pool.layers).toBe(1)
    // 主C（槽0）先拿，剩下的给槽1 ⇒ 总数 = 池层数（不翻倍）
    expect(pool.bySlot).toEqual({ 0: 1 })
    expect(pool.bySlot[0] + (pool.bySlot[1] ?? 0)).toBe(pool.layers)
    expect(pool.unspent).toBe(0)
  })

  it('② 分配按 priority：主C 拿满后剩余才给第二锋御，总数不超过池', () => {
    const pool = allocateBossGashPool({
      contributions: [{ slot: 0, points: 600 * 4 }, { slot: 2, points: 600 * 2 }],
      demand: [{ slot: 0, layers: 3 }, { slot: 2, layers: 5 }],
      priority: [0, 2],
    })
    expect(pool.layers).toBe(6)
    expect(pool.bySlot).toEqual({ 0: 3, 2: 3 }) // 槽0 要 3 拿 3；槽2 要 5 只剩 3
    expect(pool.unspent).toBe(0)
    // 负控：池不够时总数被池夹住（不是两槽各拿一份）
    const tight = allocateBossGashPool({
      contributions: [{ slot: 0, points: 600 * 2 }],
      demand: [{ slot: 0, layers: 3 }, { slot: 2, layers: 5 }],
      priority: [0, 2],
    })
    expect(tight.bySlot).toEqual({ 0: 2 })
    expect(tight.unspent).toBe(0)
  })

  it('③ 单槽 = 逐位不变：与 min(floor(points/600), demand) 恒等（全域扫描）', () => {
    for (let points = 0; points <= 600 * 8; points += 137) {
      for (let demand = 0; demand <= 9; demand++) {
        const pool = allocateBossGashPool({
          contributions: [{ slot: 0, points }],
          demand: [{ slot: 0, layers: demand }],
          priority: [0],
        })
        const legacy = Math.min(Math.floor(points / GASH_PER_LAYER), demand)
        expect(pool.layers, `points=${points}`).toBe(Math.floor(points / GASH_PER_LAYER))
        expect(pool.bySlot[0] ?? 0, `points=${points} demand=${demand}`).toBe(legacy)
      }
    }
  })

  it('口径常量：600 点/层、同时存量上限 3 层（原样保留）', () => {
    expect(GASH_PER_LAYER).toBe(600)
    expect(GASH_MAX_STACKS).toBe(3)
    // 负控：非数字 / 负数 / 不足一档 一律 0 层
    expect(gashLayersOf(Number.NaN)).toBe(0)
    expect(gashLayersOf(-600)).toBe(0)
    expect(gashLayersOf(599.99)).toBe(0)
    expect(gashLayersOf(600)).toBe(1)
  })
})
