/**
 * 交互基准（用户口径 2026-09-04 回调）：非支援/防护默认弹刀6/闪反10，支援/防护 0。
 * 基准可被必要时间挤占（超预算时 interactionScale 缩放），不是硬凑——见 useResourceCalc。
 * 手动队接线（同口径）：setAgent 换人即按 interactionBaselineFor 预填交互次数，
 * 正反馈 refund 模块（伊德海莉 1051）不吃通用基准（玩法口径：蓄力/极寒重碾 carry，弹刀闪反归击破位）。
 */
import { describe, expect, it } from 'vitest'
import { roleInteractionBaseline, interactionBaselineFor } from '@/stores/config'

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

describe('interactionBaselineFor（手动队接线：专属默认 > 正反馈排除 > 职业基准）', () => {
  it('角色专属默认优先（星徽·比利 招架4/格挡5）', () => {
    expect(interactionBaselineFor('1531', 'attack')).toEqual({ parry: 4, dodge: 0, block: 5, dual: 0 })
  })
  it('正反馈 refund 模块（伊德海莉 1051）不吃通用交互基准', () => {
    expect(interactionBaselineFor('1051', 'attack')).toEqual({ parry: 0, dodge: 0, block: 0, dual: 0 })
  })
  it('职业基准兜底：非支援/防护 6/10，支援/防护 0', () => {
    expect(interactionBaselineFor('1141', 'stun')).toEqual({ parry: 6, dodge: 10, block: 0, dual: 0 })
    expect(interactionBaselineFor('1451', 'support')).toEqual({ parry: 0, dodge: 0, block: 0, dual: 0 })
  })
})
