/**
 * 驱动盘**触发型效果覆盖率的自动折算**（用户 2026-10-29 裁决「可以折算」）。
 *
 * 前情（实测）：摇摆爵士 4pc（发动连携/终结 ⇒ 全队伤害 +15%，12 秒）此前按 **100% uptime** 结算，
 * 于是它在一局只触发几次的场景里读数最高——「2+2+2 反超」要等覆盖率拨到 25% 以下才出现。
 * 用户口径：「2+2+2 是给常规队用的，**代替的是非常弱的四摇摆**」+「可以折算」。
 *
 * 口径（单一事实源 `src/data/discSetCoverage.ts`）：覆盖率 = min(1, Σ触发次数 × 时长 / 战斗有效时长)。
 * 判据四条：
 *   ① 纯函数：登记效果的折算值、0 次触发、战斗时长为 0、未登记效果；
 *   ② 形态：2+2+2 下该套只有 2 件 ⇒ 不算 4pc 装备者（`wearsFourPieceOf`）；
 *   ③ 真管线：带 4pc 摇摆的队，自动值 = 由执行行数算出的那个值，且**与手调同值时的伤害逐位相等**
 *      （证明自动值真的走的是同一条覆盖率通道，不是只挂在表上）；
 *   ④ 手调优先：手调 0 ⇒ 掉到「一次都没触发」的水平，自动值不覆盖用户。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { useConfigStore } from '@/stores/config'
import { discTriggerCoverage, wearsFourPieceOf, DISC_TRIGGER_COVERAGE } from '@/data/discSetCoverage'

const SWING = 'effect_swing_jazz_4pc_team_dmg'
const flush = async () => { await new Promise<void>(r => setTimeout(r, 0)) }

describe('驱动盘触发型效果覆盖率折算', () => {
  it('① 纯函数：次数 × 时长 / 战斗时长，夹 0–100；未登记/无时长 ⇒ null', () => {
    expect(discTriggerCoverage(SWING, { chain: 2, ultimate: 1, battleSeconds: 180 })).toBeCloseTo(20, 9)
    expect(discTriggerCoverage(SWING, { chain: 0, ultimate: 0, battleSeconds: 180 })).toBe(0)
    expect(discTriggerCoverage(SWING, { chain: 99, ultimate: 99, battleSeconds: 10 }), '封顶 100').toBe(100)
    expect(discTriggerCoverage(SWING, { chain: 1, ultimate: 0, battleSeconds: 0 }), '没有战斗时长 ⇒ 不折算').toBeNull()
    expect(discTriggerCoverage('effect_not_registered', { chain: 1, ultimate: 1, battleSeconds: 60 })).toBeNull()
    expect(DISC_TRIGGER_COVERAGE[SWING]?.durationSeconds, '登记值 = 官网 12 秒').toBe(12)
  })

  it('② 2+2+2 下该套只有 2 件 ⇒ 不算 4pc 装备者', () => {
    expect(wearsFourPieceOf({ fourPieceSetId: '31600', twoPieceSetId: '33400', mainStats: {}, subStatAllocation: {} } as never, '31600')).toBe(true)
    expect(wearsFourPieceOf({ fourPieceSetId: '31600', twoPieceSetId: '33400', thirdTwoPieceSetId: '34400v1', mainStats: {}, subStatAllocation: {} } as never, '31600')).toBe(false)
  })

  it('③④ 真管线：露西带 4pc 摇摆 ⇒ 自动值与手调同值时伤害逐位相等，手调优先', async () => {
    const h = await setupHarness([{ agentId: '1151' }, { agentId: '1011' }, { agentId: '1211' }] as never, { recommendedBuild: true } as never)
    const config = useConfigStore()
    expect(config.team[0]!.driveDisc.fourPieceSetId, '露西的推荐盘 = 4pc 摇摆爵士').toBe('31600')
    const calc = useResourceCalc()
    await flush()
    const auto = calc.effectiveDiscEffectCoverages.value[SWING]
    const base = calc.teamTotalDamage.value
    expect(auto, '自动折算值应存在且在 [0,100)').toBeGreaterThanOrEqual(0)
    expect(auto).toBeLessThan(100)
    // 手调 = 自动同值 ⇒ 伤害逐位相等（自动值确实走同一条覆盖率通道）
    config.setDiscEffectCoverage(SWING, auto!)
    await flush()
    expect(calc.teamTotalDamage.value, '自动值 ≠ 手调同值的伤害 ⇒ 自动值没进伤害管线').toBeCloseTo(base, 4)
    // 手调 0 ⇒ 掉到「一次都没触发」的水平（自动值不覆盖用户）
    config.setDiscEffectCoverage(SWING, 0)
    await flush()
    const zero = calc.teamTotalDamage.value
    expect(zero, '手调 0 必须生效（覆盖率属于效果）').toBeLessThan(base)
    // 恢复到 100 ⇒ 明显高于折算值（说明折算真的咬下去了）
    config.setDiscEffectCoverage(SWING, 100)
    await flush()
    expect(calc.teamTotalDamage.value).toBeGreaterThan(base)
  }, 300000)
})
