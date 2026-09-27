/** CC-50：axisWindowCounts 口径锁（与 core allocateAxisWindows 一致） */
import { describe, expect, it } from 'vitest'
import { axisWindowCounts } from '@/composables/stunAxisView'
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
