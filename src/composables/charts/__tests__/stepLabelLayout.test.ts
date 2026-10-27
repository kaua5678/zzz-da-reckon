/**
 * 逐档标注垂直避让（纯函数）——两条判据都是"读图会读错"的形态：
 * ① 同一 x 的标签叠在一起 ⇒ 数字糊成一团；② 靠顶的点标签出画 ⇒ 最高一档看不见。
 */
import { describe, expect, it } from 'vitest'
import { layoutStepLabels } from '@/composables/charts/stepLabelLayout'

const fmt = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`

describe('layoutStepLabels', () => {
  it('★ 同一 x 多条线：按点的 y 从上到下排，相邻至少隔 gap（不叠字）', () => {
    const out = layoutStepLabels([
      { id: 'c', x: 100, y: 108, gain: 5, color: 'blue' },
      { id: 'a', x: 100, y: 100, gain: 10, color: 'red' },
      { id: 'b', x: 100, y: 104, gain: 20, color: 'green' },
    ], { level: 2, topBound: 40, format: fmt })
    expect(out.map(l => l.key)).toEqual(['a-2', 'b-2', 'c-2'])
    expect(out.map(l => l.y)).toEqual([91, 104, 117])
    expect(out[1].y - out[0].y).toBeGreaterThanOrEqual(13)
    expect(out[2].y - out[1].y).toBeGreaterThanOrEqual(13)
    expect(out.map(l => l.text)).toEqual(['+10.0%', '+20.0%', '+5.0%'])
  })

  it('★ 靠顶的点翻到下方，不出画；不修改入参顺序', () => {
    const input = [
      { id: 'b', x: 100, y: 20, gain: 1, color: 'green' },
      { id: 'a', x: 100, y: 10, gain: 2, color: 'red' },
    ]
    const out = layoutStepLabels(input, { level: 1, topBound: 48, format: fmt })
    expect(out.map(l => l.key)).toEqual(['a-1', 'b-1'])
    expect(out[0].y).toBe(26) // 10 + 16（下方）
    expect(out[1].y).toBe(39) // 20 + 16 = 36，被最小间距 13 顶到 39
    expect(out[1].y - out[0].y).toBeGreaterThanOrEqual(13)
    expect(input.map(p => p.id)).toEqual(['b', 'a'])
  })

  it('单点：正常压在点上方 9px；空输入返回空', () => {
    expect(layoutStepLabels([{ id: 'a', x: 10, y: 100, gain: 0, color: 'red' }], { level: 3, topBound: 40, format: fmt }))
      .toEqual([{ key: 'a-3', x: 10, y: 91, text: '+0.0%', color: 'red' }])
    expect(layoutStepLabels([], { level: 0, topBound: 0, format: fmt })).toEqual([])
  })
})
