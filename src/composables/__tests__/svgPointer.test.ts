/**
 * SVG 指针坐标归一化（评审 #14 第六刀：5 处重复实现收敛为一处）。
 *
 * 为什么值得测：这是**悬浮命中的唯一入口**——算错了表现为"点不中/点错点"，而四种图各自
 * 只在实机手点时才会暴露。抽出后可用合成事件钉住：CSS 缩放、视口偏移、非等比宽高、
 * 以及**元素尺寸为 0 时不产生 NaN**（隐藏图的防御路径）。
 */
import { describe, expect, it } from 'vitest'
import { hoverCardPosition, readSvgPointer } from '@/composables/svgPointer'

/** 合成事件：只提供被测代码读取的字段 */
const evt = (clientX: number, clientY: number, rect: { left: number; top: number; width: number; height: number }) =>
  ({ clientX, clientY, currentTarget: { getBoundingClientRect: () => rect } }) as unknown as MouseEvent

describe('readSvgPointer（viewBox 用户坐标换算）', () => {
  it('1:1（元素尺寸 = viewBox 尺寸）时 svg 坐标 = 相对偏移', () => {
    const r = readSvgPointer(
      evt(150, 80, { left: 50, top: 30, width: 1000, height: 400 }),
      { w: 1000, h: 400 },
    )
    expect(r.relX).toBe(100)
    expect(r.relY).toBe(50)
    expect(r.svgX).toBe(100)
    expect(r.svgY).toBe(50)
  })

  it('CSS 放大（元素比 viewBox 大）时缩小回用户坐标', () => {
    // 元素宽 2000（viewBox 1000）→ 缩放 0.5；相对偏移 600 → svgX 300
    const r = readSvgPointer(
      evt(650, 30, { left: 50, top: 0, width: 2000, height: 800 }),
      { w: 1000, h: 400 },
    )
    expect(r.relX).toBe(600)
    expect(r.svgX).toBe(300)
    expect(r.svgY).toBe(15)   // relY=30 × (400/800)
  })

  it('视口偏移（left/top）被正确扣除', () => {
    const r = readSvgPointer(
      evt(1000, 500, { left: 900, top: 480, width: 200, height: 100 }),
      { w: 100, h: 50 },
    )
    expect(r.relX).toBe(100)
    expect(r.relY).toBe(20)
    expect(r.svgX).toBe(50)   // 100 × (100/200)
    expect(r.svgY).toBe(10)   // 20 × (50/100)
  })

  it('宽高独立缩放（不假设等比）', () => {
    const r = readSvgPointer(
      evt(100, 100, { left: 0, top: 0, width: 400, height: 400 }),
      { w: 800, h: 200 },
    )
    expect(r.svgX).toBe(200)  // ×2
    expect(r.svgY).toBe(50)   // ×0.5
  })

  it('元素尺寸为 0（隐藏/未布局）→ 退化为 1:1，不产生 NaN/Infinity', () => {
    const r = readSvgPointer(
      evt(10, 20, { left: 0, top: 0, width: 0, height: 0 }),
      { w: 1000, h: 400 },
    )
    expect(Number.isFinite(r.svgX)).toBe(true)
    expect(Number.isFinite(r.svgY)).toBe(true)
    expect(r.svgX).toBe(10)
    expect(r.svgY).toBe(20)
  })

  it('矩形原样返回（悬浮卡定位与边界钳制仍需它）', () => {
    const rect = { left: 1, top: 2, width: 3, height: 4 }
    expect(readSvgPointer(evt(0, 0, rect), { w: 10, h: 10 }).rect).toEqual(rect)
  })
})

describe('hoverCardPosition（悬浮卡落点：贴右边缘时左移）', () => {
  it('常规：右下偏移 12/8', () => {
    expect(hoverCardPosition({ relX: 100, relY: 50, containerWidth: 1000, cardWidth: 260 }))
      .toEqual({ x: 112, y: 58 })
  })

  it('靠近右边缘：钳到「容器宽 − 卡宽」（不再溢出容器）', () => {
    // relX=900 → 913 会超出 1000-260=740 ⇒ 取 740
    expect(hoverCardPosition({ relX: 900, relY: 10, containerWidth: 1000, cardWidth: 260 }).x).toBe(740)
    // 恰好等于边界时保持原值
    expect(hoverCardPosition({ relX: 728, relY: 10, containerWidth: 1000, cardWidth: 260 }).x).toBe(740)
  })

  it('★ 口径：卡宽 240（Chart 1/3）与 260（Chart 7/4）不同 ⇒ 换位时机不同（逐字保留）', () => {
    const at = (cardWidth: number) => hoverCardPosition({ relX: 700, relY: 0, containerWidth: 1000, cardWidth }).x
    expect(at(240)).toBe(712)   // 1000-240=760 > 712 ⇒ 用 offset
    expect(at(260)).toBe(712)   // 1000-260=740 > 712 ⇒ 同样用 offset
    // 更靠右时才分化
    expect(at(240)).toBe(712)
    expect(hoverCardPosition({ relX: 760, relY: 0, containerWidth: 1000, cardWidth: 240 }).x).toBe(760)
    expect(hoverCardPosition({ relX: 760, relY: 0, containerWidth: 1000, cardWidth: 260 }).x).toBe(740)
  })

  it('offset 可覆盖（默认 12/8）', () => {
    expect(hoverCardPosition({ relX: 0, relY: 0, containerWidth: 500, cardWidth: 100, offsetX: 4, offsetY: 2 }))
      .toEqual({ x: 4, y: 2 })
  })
})
