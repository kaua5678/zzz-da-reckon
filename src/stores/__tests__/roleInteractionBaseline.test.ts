/**
 * 交互基准·职业分权（用户口径 2026-08-29）：支援/防护 0 交互，其余保留弹刀6+闪反10。
 */
import { describe, expect, it } from 'vitest'
import { roleInteractionBaseline } from '@/stores/config'

describe('roleInteractionBaseline', () => {
  it('支援/防护 = 0 交互（时间越少越好）', () => {
    expect(roleInteractionBaseline('support')).toEqual({ parry: 0, dodge: 0, block: 0, dual: 0 })
    expect(roleInteractionBaseline('defense')).toEqual({ parry: 0, dodge: 0, block: 0, dual: 0 })
  })

  it('强攻/异常/击破保留弹刀6+闪反10（主C回喧响、击破加速失衡）', () => {
    for (const s of ['attack', 'anomaly', 'stun']) {
      expect(roleInteractionBaseline(s)).toEqual({ parry: 6, dodge: 10, block: 0, dual: 0 })
    }
  })

  it('未知职业（缺省）按非支援处理', () => {
    expect(roleInteractionBaseline(undefined)).toEqual({ parry: 6, dodge: 10, block: 0, dual: 0 })
  })
})
