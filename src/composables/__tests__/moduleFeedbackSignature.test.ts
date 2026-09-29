import { describe, expect, it } from 'vitest'
import { moduleFeedbackSignature, outerFeedbackSignature } from '@/composables/resourceCalc/outerCycle'

/**
 * CC-314：模块下一轮反馈字典（ModuleFeedback）整体入外层反馈签名。
 * 模块新增反馈键「编排层零改动」（CC-31）的承诺也覆盖收敛判据：只改字典也必须让签名变化。
 */
const roundWith = (moduleFeedback: Record<string, number>) =>
  ({ resourceResult: { characters: [] }, threadsNext: { moduleFeedback } }) as never

describe('CC-314 moduleFeedback 入外层签名', () => {
  it('只有字典变化 ⇒ outerFeedbackSignature 变化', () => {
    expect(outerFeedbackSignature(roundWith({ teamUltimateExtra: 2 })))
      .not.toBe(outerFeedbackSignature(roundWith({ teamUltimateExtra: 3 })))
    expect(outerFeedbackSignature(roundWith({})))
      .not.toBe(outerFeedbackSignature(roundWith({ promiaReleaseDecibel: 50 })))
  })
  it('键的写入顺序不影响签名', () => {
    expect(moduleFeedbackSignature({ a: 1, b: 2 })).toBe(moduleFeedbackSignature({ b: 2, a: 1 }))
  })
  it('缺键 = 0（读侧 `?? 0`）⇒ 显式 0 / 非有限值与缺键同签名', () => {
    expect(moduleFeedbackSignature({ a: 1, z: 0 })).toBe(moduleFeedbackSignature({ a: 1 }))
    expect(moduleFeedbackSignature({ a: 1, z: Number.NaN })).toBe(moduleFeedbackSignature({ a: 1 }))
    expect(moduleFeedbackSignature(undefined)).toBe('')
  })
})
