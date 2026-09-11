/**
 * 「血量% 纵轴」共享标度（评审 #14 第四刀：发现第 3 份拷贝后抽出）。
 *
 * 为什么值得测：这段公式原本在 Chart 1 / Chart 3 / Chart 4 各有一份拷贝（改口径要改三处、极易漏改）。
 * 本文件既钉公式本身，也钉「三图确实指向同一个实现」（结构断言：委托函数的**引用相等**）——
 * 否则将来有人把某张图的纵轴改回本地实现，公式测试仍会全绿而单一事实源已破。
 */
import { describe, expect, it } from 'vitest'
import {
  hpRatioYGridOf,
  hpRatioYLabelOf,
  hpRatioYMaxOf,
  hpRatioYOf,
  hpRatioYStepOf,
} from '@/composables/hpRatioAxis'
import {
  chart3YGridOf,
  chart3YLabelOf,
  chart3YMaxOf,
  chart3YOf,
  chart3YStepOf,
} from '@/composables/versionChartGeometry'
import { buildTimelineChart } from '@/composables/timelineChart'

const BOX = { padT: 26, plotH: 300 }

describe('hpRatioYMaxOf（至少 100、峰值 ×1.05、取整到 50/100 档）', () => {
  it('空 / 低峰值 → 100', () => {
    expect(hpRatioYMaxOf([])).toBe(100)
    expect(hpRatioYMaxOf([0])).toBe(100)
    expect(hpRatioYMaxOf([42])).toBe(100)
    expect(hpRatioYMaxOf([-5])).toBe(100)
  })

  it('阈值附近的两档取整', () => {
    expect(hpRatioYMaxOf([150])).toBe(200)    // 157.5 → 200
    // ⚠ 口径特征（三图一致，属现状）：步长按 **target** 而非最终上限判定 ——
    // 191×1.05=200.55 刚越 200 ⇒ 直接切到 100 档 ⇒ 上限跳到 300（而不是继续按 50 取到 250）。
    // 即纵轴在峰值 ~191 附近会有一次「跳档」，这是既有行为，不是本次抽取引入的。
    expect(hpRatioYMaxOf([191])).toBe(300)
    expect(hpRatioYMaxOf([300])).toBe(400)    // 315 → 400
  })

  it('取多值中的最大峰值', () => {
    expect(hpRatioYMaxOf([10, 300, 120])).toBe(400)
  })
})

describe('步长与网格/标签同源', () => {
  it('步长两档', () => {
    expect(hpRatioYStepOf(100)).toBe(50)
    expect(hpRatioYStepOf(200)).toBe(50)
    expect(hpRatioYStepOf(250)).toBe(100)
  })

  it('网格线数量与标签值一致（同一起点、同一 step）', () => {
    for (const ratios of [[], [150], [300]]) {
      const yMax = hpRatioYMaxOf(ratios)
      const grid = hpRatioYGridOf(yMax, BOX)
      expect(grid).toHaveLength(yMax / hpRatioYStepOf(yMax) + 1)
      // 第 i 条网格线对应标签 = hpRatioYLabelOf(i)
      grid.forEach((y, i) => {
        expect(y).toBeCloseTo(hpRatioYOf(hpRatioYLabelOf(i, yMax), yMax, BOX), 6)
      })
    }
  })

  it('y 映射：0 贴底、上限贴顶、单调递减', () => {
    expect(hpRatioYOf(0, 200, BOX)).toBeCloseTo(BOX.padT + BOX.plotH, 6)
    expect(hpRatioYOf(200, 200, BOX)).toBeCloseTo(BOX.padT, 6)
    expect(hpRatioYOf(150, 200, BOX)).toBeLessThan(hpRatioYOf(50, 200, BOX))
  })
})

describe('单一事实源（结构断言，防某张图改回本地实现）', () => {
  it('Chart 3 的纵轴函数**就是**共享实现（引用相等，不是"行为相同"）', () => {
    expect(chart3YMaxOf).toBe(hpRatioYMaxOf)
    expect(chart3YStepOf).toBe(hpRatioYStepOf)
    expect(chart3YOf).toBe(hpRatioYOf)
    expect(chart3YGridOf).toBe(hpRatioYGridOf)
    expect(chart3YLabelOf).toBe(hpRatioYLabelOf)
  })

  it('Chart 1（buildTimelineChart）的纵轴读数与共享实现逐位一致', () => {
    const nodes = [
      { hpRatio: 150, team: ['A', 'B', 'C'] },
      { hpRatio: 80, team: ['A', 'B', 'C'] },
    ] as unknown as Parameters<typeof buildTimelineChart>[0]['nodes']
    const g = buildTimelineChart({ nodes, svgW: 1000, nameOf: (id: string) => id })
    const yMax = hpRatioYMaxOf([150, 80])
    expect(g.yMax).toBe(yMax)
    expect(g.yTicks).toEqual(hpRatioYGridOf(yMax, { padT: 26, plotH: 300 }))
    expect(g.yOf(37)).toBeCloseTo(hpRatioYOf(37, yMax, { padT: 26, plotH: 300 }), 6)
  })
})
