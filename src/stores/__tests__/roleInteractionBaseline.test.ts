/**
 * 交互基准（用户口径 2026-09-04 回调）：非支援/防护默认弹刀6/闪反10，支援/防护 0。
 * 基准可被必要时间挤占（超预算时 interactionScale 缩放），不是硬凑——见 useResourceCalc。
 */
import { describe, expect, it } from 'vitest'
import { roleInteractionBaseline } from '@/stores/config'

describe('roleInteractionBaseline', () => {
  it('强攻/异常/击破：弹刀6 + 闪反10（默认会打，不留时间发呆）', () => {
    for (const s of ['attack', 'anomaly', 'stun', undefined]) {
      expect(roleInteractionBaseline(s)).toEqual({ parry: 6, dodge: 10, block: 0, dual: 0 })
    }
  })
  it('支援/防护：0 交互（上场挤占主C，后台时间非发呆）', () => {
    for (const s of ['support', 'defense']) {
      expect(roleInteractionBaseline(s)).toEqual({ parry: 0, dodge: 0, block: 0, dual: 0 })
    }
  })
})
