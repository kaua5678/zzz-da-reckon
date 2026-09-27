import { describe, expect, it } from 'vitest'
import { simulateSlotDecibel } from '@/core/timeline/decibelTrack'
import type { TimelineEvent } from '@/core/timeline/types'

const win100: TimelineEvent[] = [{ t: 100, kind: 'stunEnter', window: 0 }, { t: 180, kind: 'end' }]

describe('影子内核 · 喧响轨 simulateSlotDecibel', () => {
  it('进窗放：30/s 被动回复，100s 开窗时正好 3000 ⇒ 放 1 次，剩 80s×30=2400，零浪费', () => {
    const r = simulateSlotDecibel(win100, { battleTime: 180, slots: 1, passiveRate: [30] })
    expect(r.slots[0]).toMatchObject({ ultimates: 1, ultimateTimes: [100], wasted: 0, remaining: 2400 })
  })

  it('进窗放 + 上限截断：40/s 在 75s 就满了，到 100s 浪费 1000；放完再攒 3200 又被截 200', () => {
    const r = simulateSlotDecibel(win100, { battleTime: 180, slots: 1, passiveRate: [40] })
    expect(r.slots[0].ultimates).toBe(1)
    expect(r.slots[0].wasted).toBeCloseTo(1200, 9)
    expect(r.slots[0].remaining).toBe(3000)
    expect(r.slots[0].gained).toBeCloseTo(7200, 9)
  })

  it('满即放：40/s、无窗口 ⇒ 75s、150s 各放一次（越线时刻按线性解析），剩 1200', () => {
    const r = simulateSlotDecibel([{ t: 180, kind: 'end' }], { battleTime: 180, slots: 1, passiveRate: [40], policy: 'whenFull' })
    expect(r.slots[0].ultimates).toBe(2)
    expect(r.slots[0].ultimateTimes[0]).toBeCloseTo(75, 9)
    expect(r.slots[0].ultimateTimes[1]).toBeCloseTo(150, 9)
    expect(r.slots[0].remaining).toBeCloseTo(1200, 9)
    expect(r.slots[0].wasted).toBe(0)
  })

  it('上限 A/B（1391「队伍喧响上限 +1000」的形状）：cap 4000 时放完保留余量 1000，浪费从 1200 降到 200', () => {
    const cap3000 = simulateSlotDecibel(win100, { battleTime: 180, slots: 1, passiveRate: [40] })
    const cap4000 = simulateSlotDecibel(win100, { battleTime: 180, slots: 1, passiveRate: [40], cap: 4000 })
    expect(cap4000.slots[0].ultimates).toBe(1)
    expect(cap4000.slots[0].wasted).toBeCloseTo(200, 9)
    expect(cap4000.slots[0].remaining).toBe(4000)
    expect(cap4000.slots[0].wasted).toBeLessThan(cap3000.slots[0].wasted)
  })

  it('cap 低于消耗时按消耗兜底（否则永远放不出大招）', () => {
    const r = simulateSlotDecibel(win100, { battleTime: 180, slots: 1, passiveRate: [30], cap: 1000 })
    expect(r.slots[0].ultimates).toBe(1)
  })

  it('事件喧响只给本槽；开窗奖励给全部槽；超上限先截断再放；进窗时够消耗才放', () => {
    const events: TimelineEvent[] = [
      { t: 5, kind: 'action', slot: 1, moveId: 'x', decibel: 2990 },
      { t: 10, kind: 'stunEnter', window: 0 },
      { t: 20, kind: 'end' },
    ]
    const r = simulateSlotDecibel(events, { battleTime: 20, slots: 3, onStunEnter: [0, 20, 5] })
    expect(r.slots.map(s => s.ultimates)).toEqual([0, 1, 0])
    // 2990 + 开窗奖励 20 = 3010 > 上限 3000 ⇒ 先截断（浪费 10）再放 ⇒ 剩 0（喧响条不会超过上限）
    expect(r.slots[1].remaining).toBe(0)
    expect(r.slots[1].wasted).toBeCloseTo(10, 9)
    expect(r.slots[2].remaining).toBe(5)
    expect(r.events).toEqual([{ t: 10, kind: 'ultimate', slot: 1 }])
  })

  it('按槽的消耗不同（佩洛伊斯 2000 这类）：各槽独立判定', () => {
    const r = simulateSlotDecibel(win100, { battleTime: 180, slots: 2, passiveRate: [25, 25], ultimateCost: [3000, 2000] })
    expect(r.slots.map(s => s.ultimates)).toEqual([0, 1])
  })
})
