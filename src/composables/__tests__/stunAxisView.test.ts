/** CC-50：axisWindowCounts 口径锁（与 core allocateAxisWindows 一致） */
import { describe, expect, it } from 'vitest'
import { axisWindowCounts, layoutBlockLabels } from '@/composables/stunAxisView'
import { allocateAxisWindows } from '@/core/stunAxisStack'

describe('axisWindowCounts', () => {
  it('按顺序分配，count 缺省兜底吃剩余，窗口不足时后面的轴为 0', () => {
    expect(axisWindowCounts([{ count: 2 }, {}], 6)).toEqual([2, 4])
    expect(axisWindowCounts([{ count: 5 }, { count: 3 }, {}], 6)).toEqual([5, 1, 0])
    expect(axisWindowCounts([{}], 0)).toEqual([0])
  })
  it('与 core allocateAxisWindows 逐值一致', () => {
    const axes = [{ count: 1 }, { count: 3 }, {}, { count: 2 }]
    for (const n of [0, 1, 3, 7, 12]) expect(axisWindowCounts(axes, n)).toEqual(allocateAxisWindows(axes, n))
  })
})

/**
 * 动作块标签分行（2026-10-29，用户报「动作块也短小，写字也不清不楚」）：
 * 块内放不下的名字**外置到标签行**，而不是被 overflow 切掉。
 */
describe('layoutBlockLabels（块标签分行）', () => {
  // 窗口 20s + 假定轴宽 1000px ⇒ 50px/秒；每字 12px、固定开销 10px ⇒ 文字秒数 = (字数×12+10)/50
  const DUR = 20

  it('放得下 ⇒ 写在块内（不占标签行）', () => {
    // 「强特×1 2.5s」9 字 ⇒ (9×12+10)/50 = 2.36s ≤ 2.5 ⇒ 块内
    const r = layoutBlockLabels([{ start: 0, dur: 2.5, text: '强特×1 2.5s' }], DUR)
    expect(r.inside).toEqual([true])
    expect(r.rows).toBe(0)
  })

  it('★ 放不下 ⇒ 外置，且同排不重叠（0.3s 的平A 与 0.75s 的快支挤在一排会重叠）', () => {
    // 「平A×3 0.3s」9 字 = 2.36s；「快支：锋芒所向×1」8 字 = 2.12s —— 两颗只差 0.315s
    const r = layoutBlockLabels([
      { start: 0, dur: 0.315, text: '平A×3 0.3s' },
      { start: 0.315, dur: 0.75, text: '快支：锋芒所向×1' },
    ], DUR)
    expect(r.inside).toEqual([false, false])
    expect(r.row).toEqual([0, 1]) // 第二颗必须换排
    expect(r.rows).toBe(2)
  })

  it('相隔够远 ⇒ 同一排（分行只按重叠，不按数量）', () => {
    const r = layoutBlockLabels([
      { start: 0, dur: 0.3, text: '平A×3 0.3s' },
      { start: 8, dur: 0.3, text: '平A×3 0.3s' },
    ], DUR)
    expect(r.row).toEqual([0, 0])
    expect(r.rows).toBe(1)
  })

  it('跨过文字末端的下一颗仍可回到第一排（分行是区间装箱，不是轮流坐庄）', () => {
    const r = layoutBlockLabels([
      { start: 0, dur: 0.3, text: '平A×3 0.3s' },   // 第 1 排：0 → 2.36
      { start: 0.4, dur: 0.3, text: '平A×3 0.3s' }, // 与第 1 颗重叠 ⇒ 第 2 排：0.4 → 2.76
      { start: 3.0, dur: 0.3, text: '平A×3 0.3s' }, // 两排都空出来了 ⇒ 回第 1 排
    ], DUR)
    expect(r.row).toEqual([0, 1, 0])
  })

  it('贴着窗口右端的块：标签左移到「还放得下」处，不捅出轴外', () => {
    // 19.5s 起、文字需 2.36s ⇒ 放不到 20s ⇒ 落点左移到「刚好放得下」处（at + need = 窗口右端）
    const r = layoutBlockLabels([{ start: 19.5, dur: 0.3, text: '平A×3 0.3s' }], DUR)
    expect(r.inside).toEqual([false])
    expect(r.at[0]! + r.need[0]!).toBeCloseTo(DUR, 6)
    expect(r.at[0]!).toBeLessThan(19.5)
    // 块内文字不占标签行 ⇒ 落点原样保留（它本来就在块里）
    const inside = layoutBlockLabels([{ start: 19.5, dur: 3, text: '强特×1' }], DUR)
    expect(inside.inside).toEqual([true])
    expect(inside.at[0]).toBe(19.5)
  })

  it('空轴 ⇒ 零行；窗口时长 0 不炸（除零保护）', () => {
    expect(layoutBlockLabels([], DUR).rows).toBe(0)
    expect(() => layoutBlockLabels([{ start: 0, dur: 1, text: 'x' }], 0)).not.toThrow()
  })
})
