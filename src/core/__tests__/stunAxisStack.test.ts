import { describe, expect, it } from 'vitest'
import { calcStunAxisStack, allocateAxisWindows } from '@/core/stunAxisStack'

// 伊琉 0命爆发轴：连携(0) → 终结技(喧响3000)×2 → 溯寒追碾(0)×2 → 极寒重碾(60闪能)×2 → 下砸(0) → 平A(0)
const stack = [
  { slot: 0, moveId: '1051025', count: 1, actionTime: 2.517, energyCost: 0, decibelCost: 0 },
  { slot: 0, moveId: '1051016', count: 2, actionTime: 1.766, energyCost: 0, decibelCost: 3000 },
  { slot: 0, moveId: '1051011', count: 2, actionTime: 0.95, energyCost: 0, decibelCost: 0 },
  { slot: 0, moveId: '1051012', count: 2, actionTime: 2.6, energyCost: 60, decibelCost: 0 },
  { slot: 0, moveId: '1051007', count: 1, actionTime: 1.2917, energyCost: 0, decibelCost: 0 },
  { slot: 0, moveId: '1051003', count: 1, actionTime: 1.55, energyCost: 0, decibelCost: 0 },
]

describe('allocateAxisWindows', () => {
  it('allocates exact counts then 兜底 eats the remainder', () => {
    // 爆发轴 count=4 → 4 窗口，经济轴无 count → 兜底吃剩余
    const axes = [{ count: 4 }, { count: undefined }]
    expect(allocateAxisWindows(axes, 6)).toEqual([4, 2])
    expect(allocateAxisWindows(axes, 4)).toEqual([4, 0])
    expect(allocateAxisWindows(axes, 2)).toEqual([2, 0])
  })

  it('weighted 连携/转大 across heterogeneous axes (爆发1连携/末尾爆发2连携)', () => {
    // 复刻 0章-琉：爆发轴 1 连携 ×4 窗口，经济轴 2 连携 ×(stunCount-4) 窗口
    const winAlloc = allocateAxisWindows([{ count: 4 }, {}], 6)
    expect(winAlloc).toEqual([4, 2])
    const chainTotal = 1 * winAlloc[0] + 2 * winAlloc[1]
    expect(chainTotal).toBe(8) // 4×1 + 2×2，而非简单相加 (1+2)×6=18
  })
})

describe('calcStunAxisStack', () => {
  it('full resources = burst axis (whole stack executes per window)', () => {
    const r = calcStunAxisStack({
      axes: [{ actions: stack }],
      stunCount: 3,
      windowDuration: 16,
      energyBySlot: { 0: 360 },
      decibelBySlot: { 0: 18000 },
    })
    expect(r.executed['0:1051012'].count).toBe(6)
    expect(r.executed['0:1051016'].count).toBe(6)
    expect(r.executed['0:1051025'].count).toBe(3)
    expect(r.skipped).toHaveLength(0)
    expect(r.windowsUsed).toBe(3)
  })

  it('low energy warns but still executes EX (固定轴：资源不足只提示，不自动变轴)', () => {
    const r = calcStunAxisStack({
      axes: [{ actions: stack }],
      stunCount: 3,
      windowDuration: 16,
      energyBySlot: { 0: 180 },
      decibelBySlot: { 0: 18000 },
    })
    expect(r.executed['0:1051012'].count).toBe(6)
    expect(r.skipped.some(s => s.moveId === '1051012' && s.reason === 'energy')).toBe(true)
    expect(r.energyUsed).toBe(360)
  })

  it('insufficient decibel warns but still executes ultimate (喧响不够 → 只提示不跳过)', () => {
    const r = calcStunAxisStack({
      axes: [{ actions: stack }],
      stunCount: 3,
      windowDuration: 16,
      energyBySlot: { 0: 360 },
      decibelBySlot: { 0: 3000 },
    })
    expect(r.executed['0:1051016']?.count ?? 0).toBe(6)
    expect(r.skipped.some(s => s.moveId === '1051016' && s.reason === 'decibel')).toBe(true)
    expect(r.decibelUsed).toBe(18000)
  })

  it('short window stops at overflow (超窗口停，后面动作舍弃)', () => {
    const r = calcStunAxisStack({
      axes: [{ actions: stack }],
      stunCount: 1,
      windowDuration: 8,
      energyBySlot: { 0: 360 },
      decibelBySlot: { 0: 18000 },
    })
    expect(r.executed['0:1051012']?.count ?? 0).toBe(0)
    expect(r.skipped.some(s => s.reason === 'time')).toBe(true)
  })

  it('合轴：各槽位时间独立，互不挤占（琉音并行）', () => {
    const twoSlot = [
      ...stack,
      { slot: 1, moveId: '1481011', count: 1, actionTime: 0.617, energyCost: 0, decibelCost: 0 },
      { slot: 1, moveId: '1481009', count: 1, actionTime: 0.9, energyCost: 0, decibelCost: 0 },
    ]
    const r = calcStunAxisStack({
      axes: [{ actions: twoSlot }],
      stunCount: 1,
      windowDuration: 16,
      energyBySlot: { 0: 360, 1: 100 },
      decibelBySlot: { 0: 18000, 1: 0 },
    })
    // 伊德海莉槽位堆到≈16s仍打满，琉音槽位(1.5s)并行也打满，互不影响
    expect(r.executed['0:1051012'].count).toBe(2)
    expect(r.executed['1:1481011'].count).toBe(1)
    expect(r.executed['1:1481009'].count).toBe(1)
  })

  it('每轴可指定不同兜底平A槽位（basicFillBySlot 按槽位汇总）', () => {
    const r = calcStunAxisStack({
      axes: [
        { actions: [{ slot: 0, moveId: 'm0', count: 1, actionTime: 2, energyCost: 0, decibelCost: 0 }], count: 1, basicFillerSlot: 0 },
        { actions: [{ slot: 1, moveId: 'm1', count: 1, actionTime: 2, energyCost: 0, decibelCost: 0 }], count: 1, basicFillerSlot: 1 },
      ],
      stunCount: 2,
      windowDuration: 10,
      energyBySlot: {},
      decibelBySlot: {},
    })
    expect(r.basicFillSeconds).toBe(16) // 每窗口 8s × 2
    expect(r.basicFillBySlot[0]).toBe(8)
    expect(r.basicFillBySlot[1]).toBe(8)
  })
})
