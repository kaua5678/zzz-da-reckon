/**
 * SVG 最近点命中测试（评审 #14 第九刀）。
 *
 * 覆盖：空点集、精确命中、最近者取胜、**并列取先出现**（与原始 forEach + `<` 语义一致）、
 * 距离定义；以及容差公式与「点数 0 防除零」。
 * 另含一条口径断言：Chart 1 用 factor 1、Chart 3/4/7 用 factor 2 —— 差异是**有意保留**的现状，
 * 改它等于改各图的命中手感，必须有意识地进行。
 */
import { describe, expect, it } from 'vitest'
import { nearestIndexByX, xHitTolerance } from '@/composables/svgHitTest'

const pts = (...xs: number[]) => xs.map(x => ({ x }))

describe('nearestIndexByX（按 x 找最近点）', () => {
  it('空点集 → index -1 / distance Infinity（不抛错）', () => {
    expect(nearestIndexByX([], 100)).toEqual({ index: -1, distance: Infinity })
  })

  it('单点：距离 = |x - svgX|', () => {
    expect(nearestIndexByX(pts(50), 80)).toEqual({ index: 0, distance: 30 })
    expect(nearestIndexByX(pts(50), 20)).toEqual({ index: 0, distance: 30 })
  })

  it('精确命中 → 距离 0', () => {
    expect(nearestIndexByX(pts(10, 50, 90), 50)).toEqual({ index: 1, distance: 0 })
  })

  it('最近者取胜（左右两侧）', () => {
    expect(nearestIndexByX(pts(10, 50, 90), 60).index).toBe(1)
    expect(nearestIndexByX(pts(10, 50, 90), 80).index).toBe(2)
  })

  it('并列时取**先出现**的下标（与 forEach + `<` 的原始语义一致）', () => {
    expect(nearestIndexByX(pts(10, 30), 20).index).toBe(0)
    expect(nearestIndexByX(pts(30, 10), 20).index).toBe(0)
  })

  it('非等距点集也取真正最近者', () => {
    expect(nearestIndexByX(pts(0, 5, 6, 100), 5.4).index).toBe(1)
  })
})

describe('xHitTolerance（容差 = 列宽 × 系数）', () => {
  it('公式：plotW / max(1, 点数) × factor', () => {
    expect(xHitTolerance(900, 9, 2)).toBe(200)     // 列宽 100 × 2
    expect(xHitTolerance(900, 9, 1)).toBe(100)
    expect(xHitTolerance(450, 9, 2)).toBe(100)
  })

  it('点数 0 → 用 1 兜底（防除零）', () => {
    expect(xHitTolerance(900, 0, 2)).toBe(1800)
    expect(Number.isFinite(xHitTolerance(900, 0, 1))).toBe(true)
  })

  it('★ 口径：Chart 1 用 factor 1、Chart 3/4/7 用 factor 2 —— 同列宽下前者严一倍', () => {
    const tight = xHitTolerance(900, 9, 1)
    const loose = xHitTolerance(900, 9, 2)
    expect(loose).toBe(tight * 2)
  })
})
