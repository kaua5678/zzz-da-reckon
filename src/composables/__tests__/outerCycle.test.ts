import { describe, expect, it } from 'vitest'
import {
  findOuterLongCycleLag,
  isOuterTwoCycle,
  pickOuterCycleMember,
  type OuterTwoCycleInput,
  type OuterCyclePickMember,
} from '@/composables/resourceCalc/outerCycle'

const alternating: OuterTwoCycleInput = {
  previousInput: 3,
  currentInput: 4,
  nextInput: 3,
  currentSignature: 'A',
  signatureHistory: ['A', 'B'],
  tolerance: 0.05,
}

describe('外层二周期：当前快照与同相位历史', () => {
  it.each([
    ['A→B→A', ['A', 'B'], 'A'],
    ['B→A→B', ['A', 'B', 'A'], 'B'],
    ['反馈不变但失衡值振荡', ['A', 'A'], 'A'],
  ] as const)('接受 %s', (_name, signatureHistory, currentSignature) => {
    expect(isOuterTwoCycle({ ...alternating, signatureHistory, currentSignature })).toBe(true)
  })

  it('相邻历史相同而当前已经变化，不是周期（旧 curSig 延迟赋值的反例）', () => {
    expect(isOuterTwoCycle({ ...alternating, signatureHistory: ['A', 'A'], currentSignature: 'B' })).toBe(false)
  })

  it('只与上一轮相同但没有回到同相位，不是二周期', () => {
    expect(isOuterTwoCycle({ ...alternating, currentSignature: 'B' })).toBe(false)
  })

  it.each([{ history: [] as string[] }, { history: ['A'] }])('历史不足时不把冷启动瞬态当环：$history', ({ history }) => {
    expect(isOuterTwoCycle({ ...alternating, signatureHistory: history })).toBe(false)
  })

  it('首轮没有上一轮失衡输入，不判环', () => {
    expect(isOuterTwoCycle({ ...alternating, previousInput: null })).toBe(false)
  })

  it('签名重复但失衡值没有回到同相位，继续迭代', () => {
    expect(isOuterTwoCycle({ ...alternating, nextInput: 3.2 })).toBe(false)
  })

  it('相邻值已接近时交给 stable，不能把收敛中的小数序列当环', () => {
    expect(isOuterTwoCycle({ ...alternating, previousInput: 0.91111, currentInput: 0.91901, nextInput: 0.91831 })).toBe(false)
  })

  it('两个失衡值相等是固定点，不是二周期', () => {
    expect(isOuterTwoCycle({ ...alternating, currentInput: 3 })).toBe(false)
  })

  it('同相位距离必须严格小于容差，邻相位距离可以等于容差', () => {
    expect(isOuterTwoCycle({ ...alternating, previousInput: 0, currentInput: 1, nextInput: 0.05 })).toBe(false)
    expect(isOuterTwoCycle({ ...alternating, previousInput: 0, currentInput: 0.05, nextInput: 0 })).toBe(true)
  })

  it('不修改调用方的历史快照', () => {
    const history = Object.freeze(['A', 'B'])
    expect(isOuterTwoCycle({ ...alternating, signatureHistory: history })).toBe(true)
    expect(history).toEqual(['A', 'B'])
  })
})

/** 选点用例的统一容差（与生产 `pickCanonical` 的 `tol` 同量级）。 */
const TOL = { stun: 0.05, disc: 1, time: 2 }
const m = (stunIn: number, next: number, disc: number, time: number): OuterCyclePickMember => ({ stunIn, next, disc, time })

describe('环内选点：pickOuterCycleMember（与数值基线无关的纯函数判据）', () => {
  it('⓪ 有带窗成员时零窗成员不参选，pickedEarlier = true', () => {
    // idx0 零窗且时间最贴预算（0）——若参选会赢；⓪ 必须把它排除
    expect(pickOuterCycleMember([m(0, 0, 0, 0), m(1, 1.2, 0, 5)], TOL)).toEqual({ index: 1, pickedEarlier: true })
  })

  it('⓪ 全员零窗（真 0 失衡队）时全体参选', () => {
    expect(pickOuterCycleMember([m(0, 0, 0, 0), m(0, 0, 0, 0), m(0, 0, 0, 0)], TOL))
      .toEqual({ index: 2, pickedEarlier: false })
  })

  it('⓪ index 指向入参原数组下标（过滤后不重编号）', () => {
    expect(pickOuterCycleMember([m(0, 0, 0, 0), m(0, 0, 0, 0), m(1, 1, 0, 0)], TOL))
      .toEqual({ index: 2, pickedEarlier: true })
  })

  it('① 失衡自洽度优势 > tol.stun 时胜出', () => {
    // idx0 |next−stunIn| = 0，idx1 = 0.75，差 −0.75 < −0.5（用二进制精确值，避免浮点把"恰等"变成"大于"）
    const bound = { stun: 0.5, disc: 1, time: 2 }
    expect(pickOuterCycleMember([m(1, 1, 0, 0), m(1, 1.75, 0, 0)], bound)).toEqual({ index: 0, pickedEarlier: true })
  })

  it('① 失衡自洽度差恰等于 tol.stun 时不胜出（取末轮）', () => {
    const bound = { stun: 0.5, disc: 1, time: 2 }
    expect(pickOuterCycleMember([m(1, 1, 0, 0), m(1, 1.5, 0, 0)], bound)).toEqual({ index: 1, pickedEarlier: false })
  })

  it('⓪′ 失衡同级时截断优势 > tol.disc 时胜出', () => {
    // 两成员失衡自洽度都是 0；idx0 截断 0 vs idx1 截断 1.5，差 −1.5 < −1
    expect(pickOuterCycleMember([m(1, 1, 0, 0), m(1, 1, 1.5, 0)], TOL)).toEqual({ index: 0, pickedEarlier: true })
  })

  it('⓪′ 截断差恰等于 tol.disc 时不胜出（取末轮）', () => {
    expect(pickOuterCycleMember([m(1, 1, 0, 0), m(1, 1, 1, 0)], TOL)).toEqual({ index: 1, pickedEarlier: false })
  })

  it('② 时间优势须 > tol.time 才胜出', () => {
    // idx0 time 0 vs idx1 time 2.0001，差 2.0001 > 2
    expect(pickOuterCycleMember([m(1, 1, 0, 0), m(1, 1, 0, 2.0001)], TOL)).toEqual({ index: 0, pickedEarlier: true })
  })

  it('② 时间差 ≤ tol.time 视为同级（取末轮）', () => {
    expect(pickOuterCycleMember([m(1, 1, 0, 0), m(1, 1, 0, 2)], TOL)).toEqual({ index: 1, pickedEarlier: false })
  })

  it('③ 全同级取末项且 pickedEarlier = false', () => {
    expect(pickOuterCycleMember([m(1, 1, 0, 0), m(1, 1, 0, 0), m(1, 1, 0, 0)], TOL))
      .toEqual({ index: 2, pickedEarlier: false })
  })

  it('time 为 Infinity 的成员永不胜出', () => {
    expect(pickOuterCycleMember([m(1, 1, 0, Number.POSITIVE_INFINITY), m(1, 1, 0, 0)], TOL))
      .toEqual({ index: 1, pickedEarlier: false })
  })

  it('disc / time 同为 Infinity 时 NaN 比较全 false，保持取末轮', () => {
    // Infinity − Infinity = NaN ⇒ better 三项全 false（原实现行为，不许"修"）
    const inf = Number.POSITIVE_INFINITY
    expect(pickOuterCycleMember([m(1, 1, inf, inf), m(1, 1, inf, inf)], TOL))
      .toEqual({ index: 1, pickedEarlier: false })
  })
})

/**
 * 语料实测（lead 2026-09-24 在 8fc2d3c 对 `pickCanonical` 的入参逐条记录）：
 * `tol = { stun: 0.05, disc: 1, time: 2 }`，成员按 `[stunIn, next, disc, time]` 排列，
 * 期望 = 规范停点在原数组中的下标。这些是**选点判据的判据**——与任何 *_baseline.json 无关。
 */
const CORPUS_TOL = { stun: 0.05, disc: 1, time: 2 }
const CORPUS: Array<[string, number[][], number]> = [
  ['yixuan-jufufu-lucia', [[0.37, 0.5385, 0, 1.1335], [0.5385, 0.6584, 0, 0], [0.6584, 0.37, 0, 1.1335]], 1],
  ['claret-roxy-rina', [[2.0961, 2.2078, 0, 0.0828], [2.2078, 2.0094, 0, 0.1423], [2.0094, 2.0961, 0, 0.0842]], 2],
  ['auto-1431-1341-1311', [[0.2672, 0.888, 0, 13.9173], [0.888, 0.9211, 0, 3.9311], [0.9211, 0.2672, 0, 4.9203]], 1],
  ['般岳 4-环（1471 单人 + 1481）', [[0, 2, 0, 0.766], [2, 1.6, 0, 45.894], [1.6, 0, 0, 79.615], [0, 0, 0, 13.289]], 1],
  ['叶瞬光队轴退化后线程相位环（1431/1481/1341，4 成员）', [[0, 0, 3.717, 5.8128], [0, 0, 5.117, 7.7907], [0, 0, 3.717, 5.8128], [0, 0, 5.117, 7.7907]], 2],
  ['叶瞬光 C1 短轴（1431 c1/1481/1341）', [[0, 0, 0, 1.0962], [0, 0, 11.016, 12.7757], [0, 0, 0, 1.1562]], 2],
]

describe('环内选点：语料实测（lead 2026-09-24 @8fc2d3c）', () => {
  it.each(CORPUS)('%s', (_name, rows, expected) => {
    const members = rows.map(([stunIn, next, disc, time]) => m(stunIn, next, disc, time))
    expect(pickOuterCycleMember(members, CORPUS_TOL).index).toBe(expected)
  })
})

describe('长环识别：findOuterLongCycleLag（lag 从 3 起的双层扫描）', () => {
  const tol = 0.05

  it('周期 3：返回 3', () => {
    expect(findOuterLongCycleLag(['A', 'B', 'C', 'A', 'B', 'C'], [0, 1, 2, 0, 1, 2], tol)).toBe(3)
  })

  it('周期 4：lag=3 不命中，返回 4', () => {
    expect(findOuterLongCycleLag(
      ['A', 'B', 'C', 'D', 'A', 'B', 'C', 'D'],
      [0, 1, 2, 3, 0, 1, 2, 3],
      tol,
    )).toBe(4)
  })

  it('无重复签名：返回 null', () => {
    expect(findOuterLongCycleLag(['A', 'B', 'C', 'D'], [0, 1, 2, 3], tol)).toBeNull()
  })

  it('签名重复但同相位失衡差 ≥ 容差：不算环', () => {
    expect(findOuterLongCycleLag(['A', 'B', 'C', 'A'], [0, 1, 2, 5], tol)).toBeNull()
  })

  it('签名重复且同相位失衡差 < 容差（小数失衡）时命中', () => {
    expect(findOuterLongCycleLag(['A', 'B', 'C', 'A'], [0, 1, 2, 0.02], tol)).toBe(3)
  })

  it('周期 2 的轨迹返回 4（lag 从 3 起的既有行为，记录不改）', () => {
    expect(findOuterLongCycleLag(['A', 'B', 'A', 'B', 'A', 'B'], [0, 1, 0, 1, 0, 1], tol)).toBe(4)
  })

  it('历史不足（长度 ≤ 3）时返回 null', () => {
    expect(findOuterLongCycleLag(['A', 'B', 'C'], [0, 1, 2], tol)).toBeNull()
  })
})
