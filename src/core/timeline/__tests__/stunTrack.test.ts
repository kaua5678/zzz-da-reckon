import { describe, expect, it } from 'vitest'
import { simulateStunTrack } from '@/core/timeline/stunTrack'
import type { StunTrackResult } from '@/core/timeline/types'

/** 所有结果都必须满足的不变量：整数次数、窗口不重叠、事件时间单调、都在战斗时长内 */
function assertInvariants(r: StunTrackResult, battleTime: number) {
  expect(Number.isInteger(r.stunCount)).toBe(true)
  expect(r.stunCount).toBe(r.windows.length)
  for (let i = 1; i < r.windows.length; i++) expect(r.windows[i].start).toBeGreaterThanOrEqual(r.windows[i - 1].end)
  for (let i = 1; i < r.events.length; i++) expect(r.events[i].t).toBeGreaterThanOrEqual(r.events[i - 1].t)
  for (const e of r.events) expect(e.t).toBeLessThanOrEqual(battleTime + 1e-9)
  expect(r.events[r.events.length - 1].kind).toBe('end')
}

describe('影子内核 · 失衡轨 simulateStunTrack', () => {
  it('均匀动作：每 1s 打 10 点、上限 100、窗口 10s ⇒ 窗口起点 10,30,…,170 共 9 次', () => {
    const r = simulateStunTrack({ battleTime: 180, bossStunValue: 100, windowDuration: 10, offWindowLoop: [{ slot: 0, moveId: 'a', duration: 1, stun: 10 }] })
    assertInvariants(r, 180)
    expect(r.stunCount).toBe(9)
    expect(r.windows.map(w => w.start)).toEqual([10, 30, 50, 70, 90, 110, 130, 150, 170])
    expect(r.completedByMove['0:a']).toBe(90)
    expect(r.truncatedAction).toBe(false)
  })

  it('返还 25%：出窗后失衡条 = 25，之后每轮 8 个动作 ⇒ 周期 18s，第 10 个窗口在 172s 开出并被战斗结束截断', () => {
    const r = simulateStunTrack({ battleTime: 180, bossStunValue: 100, windowDuration: 10, refundRatio: 0.25, offWindowLoop: [{ slot: 0, moveId: 'a', duration: 1, stun: 10 }] })
    assertInvariants(r, 180)
    expect(r.stunCount).toBe(10)
    expect(r.windows[9].start).toBe(172)
    expect(r.windows[9].end).toBe(180)
    expect(r.overflowLost).toBeCloseTo(45, 9) // 第 2–10 窗各溢出 5（25+80=105），默认丢弃；第 10 窗被截断，仍在开窗时计入溢出
  })

  it('截断：会越过战斗结束的动作不完成、不计入', () => {
    const r = simulateStunTrack({ battleTime: 180, bossStunValue: 100, windowDuration: 10, offWindowLoop: [{ slot: 0, moveId: 'slow', duration: 100, stun: 10 }] })
    assertInvariants(r, 180)
    expect(r.truncatedAction).toBe(true)
    expect(r.completedByMove['0:slow']).toBe(1)
    expect(r.stunCount).toBe(0)
    expect(r.residual).toBe(10)
  })

  it('溢出：默认丢弃（记 overflowLost）；carryOverflow=true 结转到下一轮（现引擎闭式公式的口径）', () => {
    const base = { battleTime: 30, bossStunValue: 100, windowDuration: 10, offWindowLoop: [{ slot: 0, moveId: 'a', duration: 1, stun: 60 }] }
    const drop = simulateStunTrack(base)
    assertInvariants(drop, 30)
    expect(drop.windows.map(w => w.start)).toEqual([2, 14, 26])
    expect(drop.overflowLost).toBe(60) // 三窗各溢出 20
    const carry = simulateStunTrack({ ...base, carryOverflow: true })
    assertInvariants(carry, 30)
    expect(carry.windows.map(w => w.start)).toEqual([2, 14, 25])
    expect(carry.overflowLost).toBe(0)
  })

  it('白送失衡：initialStun ≥ 上限 ⇒ t=0 立即开窗；空循环不死循环', () => {
    const r = simulateStunTrack({ battleTime: 180, bossStunValue: 100, windowDuration: 10, initialStun: 150, offWindowLoop: [] })
    assertInvariants(r, 180)
    expect(r.stunCount).toBe(1)
    expect(r.windows[0]).toMatchObject({ start: 0, end: 10, overflow: 50 })
  })

  it('窗口模板：窗口内动作按 offset 落点，超出窗口时长的忽略，超出战斗结束的不产出', () => {
    const r = simulateStunTrack({
      battleTime: 20, bossStunValue: 100, windowDuration: 10,
      offWindowLoop: [{ slot: 0, moveId: 'a', duration: 1, stun: 50 }],
      windowTemplates: [[{ offset: 2, slot: 1, moveId: 'u', decibel: 100 }, { offset: 15, slot: 1, moveId: 'late' }]],
    })
    assertInvariants(r, 20)
    expect(r.windows.map(w => [w.start, w.end])).toEqual([[2, 12], [14, 20]])
    expect(r.events.filter(e => e.kind === 'windowAction').map(e => e.t)).toEqual([4, 16])
    expect(r.completedByMove['1:u']).toBe(2)
    expect(r.completedByMove['1:late']).toBeUndefined()
  })

  it('性能原型（设计稿 D7）：30 个动作的循环、180s，单次推演远小于 5ms', () => {
    const loop = Array.from({ length: 30 }, (_, i) => ({ slot: i % 3, moveId: `m${i}`, duration: 0.5 + (i % 5) * 0.25, stun: 30 + (i % 7) * 5, decibel: 50 }))
    const input = { battleTime: 180, bossStunValue: 1000, windowDuration: 12, refundRatio: 0.1, offWindowLoop: loop }
    simulateStunTrack(input) // 预热
    const N = 2000
    const t0 = performance.now()
    let windows = 0
    for (let i = 0; i < N; i++) windows += simulateStunTrack(input).stunCount
    const perRunMs = (performance.now() - t0) / N
    console.log(`[timeline perf] stunTrack ${perRunMs.toFixed(4)} ms/run（${windows / N} 窗/次，${N} 次）`)
    expect(perRunMs).toBeLessThan(5)
  })
})
