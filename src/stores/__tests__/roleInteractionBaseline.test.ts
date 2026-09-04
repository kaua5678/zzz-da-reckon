/**
 * 交互基准（用户口径 2026-09 修订）：弹刀不预设（喧响四舍五入反推），闪反默认 0。
 */
import { describe, expect, it } from 'vitest'
import { roleInteractionBaseline } from '@/stores/config'

describe('roleInteractionBaseline', () => {
  it('所有职业：弹刀不预设（喧响四舍五入反推）、闪反默认 0', () => {
    for (const s of ['support', 'defense', 'attack', 'anomaly', 'stun', undefined]) {
      expect(roleInteractionBaseline(s)).toEqual({ parry: 0, dodge: 0, block: 0, dual: 0 })
    }
  })
})
