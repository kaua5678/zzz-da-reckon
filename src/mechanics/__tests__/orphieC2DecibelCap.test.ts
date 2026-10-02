/**
 * r406：奥菲丝影画2「追加攻击回 65 喧响（4s 至多一次）」的 CD 上限按**有效战斗时间**折算。
 *
 * 旧实现读 `state.combatTime ?? state.totalTime ?? 180`，但 IterationState 上从无这两个字段
 * （`as any` 掩盖了类型错误）⇒ 上限恒为 floor(180/4)=45 次，与实际战斗时长无关。
 * 现改为同目录 lighter/rina/yaojiayin 共用的 `effectiveCombatTime(state, cfg)`
 * （前台 + 后台 − 无敌时间）。zd 夹具里追加攻击次数 < 上限，故零差异；本测试锁住上限的两个方向。
 */
import { describe, expect, it } from 'vitest'
import { orphieMechanic } from '@/mechanics/agents/orphie'

function giftFor(state: { frontlineTime: number; backstageTime: number }, aaCount: number, invincibleTime?: number): number {
  const cfg: Record<string, unknown> = { orphieCinemaLevel: 2, invincibleTime }
  const executions = [{ moveId: '1301999', skillDamageTarget: 'additionalAttack', count: aaCount }]
  orphieMechanic.patchExecutions!({ cfg, state, executions } as never)
  return Number(cfg.orphieC2DecibelGift)
}

describe('奥菲丝影画2 喧响 CD 上限（r406：按有效战斗时间）', () => {
  it('短战斗：上限 = floor(有效时间/4)，不再恒取 180s', () => {
    // 20s ⇒ 5 次 × 65；旧实现恒 45 次上限 ⇒ 100 次追加攻击会给 2925
    expect(giftFor({ frontlineTime: 20, backstageTime: 0 }, 100)).toBe(5 * 65)
  })

  it('扣除无敌时间', () => {
    // 15 + 5 − 8 = 12s ⇒ 3 次
    expect(giftFor({ frontlineTime: 15, backstageTime: 5 }, 100, 8)).toBe(3 * 65)
  })

  it('长战斗：上限随时长放宽（旧实现被 180s 卡在 45 次）', () => {
    expect(giftFor({ frontlineTime: 300, backstageTime: 100 }, 100)).toBe(100 * 65)
  })
})
