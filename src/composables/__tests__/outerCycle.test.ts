import { describe, expect, it } from 'vitest'
import { isOuterTwoCycle, type OuterTwoCycleInput } from '@/composables/resourceCalc/outerCycle'

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
