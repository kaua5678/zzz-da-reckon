import { describe, expect, it } from 'vitest'
import { moduleFeedbackSignature, outerFeedbackSignature, slotRecordSignature } from '@/composables/resourceCalc/outerCycle'

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

/** CC-315：stable = 「本轮输入 = 下一轮输入」——轴栈预算与其余下一轮输入也入签名。 */
describe('CC-315 轴栈预算等下一轮输入入外层签名', () => {
  const round = (threadsNext: Record<string, unknown>) =>
    ({ resourceResult: { characters: [] }, threadsNext: { moduleFeedback: {}, ...threadsNext } }) as never
  it('琉音好评 / 每窗异常触发 / 帷幕总次数 / 上一轮池次数变化 ⇒ 签名变', () => {
    const base = { goodReview: -1, inStunWindowTriggers: 0, teamVeilCountTotal: 0, prevPoolStunCount: 3 }
    const sig = (o: Record<string, unknown>) => outerFeedbackSignature(round({ ...base, ...o }))
    for (const o of [{ goodReview: 2 }, { inStunWindowTriggers: 1.5 }, { teamVeilCountTotal: 4 }, { prevPoolStunCount: 4 }]) {
      expect(sig(o)).not.toBe(sig({}))
    }
  })
  it('能量 / 喧响预算整点变化 ⇒ 签名变；浮点尾数与键序不变', () => {
    expect(outerFeedbackSignature(round({ decibelRegenBySlot: { 0: 13376.26 } })))
      .not.toBe(outerFeedbackSignature(round({ decibelRegenBySlot: { 0: 13461.26 } })))
    expect(outerFeedbackSignature(round({ energyBySlot: { 0: 870 } })))
      .not.toBe(outerFeedbackSignature(round({ energyBySlot: { 0: 860 } })))
    expect(slotRecordSignature({ 1: 773.519762048527, 0: 5 })).toBe(slotRecordSignature({ 0: 5, 1: 773.5197620485271 }))
  })
  it('postRound 失衡次数不入签名（已知例外：入了会破坏长环检测，见 outerCycle.ts 头注释）', () => {
    const pri = (stunCount: number) => ({ postRoundInput: { exCounts: [7], ultimateCounts: [3], stunCount } })
    expect(outerFeedbackSignature(round(pri(0)))).toBe(outerFeedbackSignature(round(pri(3))))
  })
})
