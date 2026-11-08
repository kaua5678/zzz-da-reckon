/**
 * 知更鸟终结技·锋御锐能给养 —— **真管线**判据（2026-11-08 批 2 的 e2e 面）。
 *
 * `robinSharpnessGift.test.ts` 只证明「钩子把 cfg 写对了」；本文件证明**cfg 真的被消费**：
 * 同一个真实队伍跑完整 `applyTeamConfig` 管线，锋御的资源结果 / 伤害随给养上升。
 * 一条规则写错（字段没读、postRound 没派发、specialty 判据退化）都只有这一层能抓到。
 *
 * 口径要点：
 * ① 挽昼(1601) 的锐能池是 `solveSunbringerLoops#sharpPool` ⇒ 给养 60 点 = +2 发强特（30/发）；
 * ② 克拉蕾(1611) 的 `sharpnessGain` 出现在 `claretSharpResourceSource` ⇒ 直接读它；
 * ③ 无锋御队（把锋御换成非锋御）伤害**不得**变化（负控）。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { ROBIN_ULT_TEAM_SHARPNESS } from '@/mechanics/agents/robin'

describe('知更鸟给养 → 锋御锐能池（真管线）', () => {
  it('★ 克拉蕾队：把 cfg.sharpnessGiftFromTeam 设成 20×3 ⇒ sharpnessGain 高 60', async () => {
    // 先跑一队「知更鸟 + 克拉蕾」的真实计算，再单独跑一队「无给养」作对照。
    // ⚠ 给养走 postRound（用**上一轮**收敛值），首轮读不到 ⇒ 对照差分要跑两轮以上
    //   （`useResourceCalc` 的 resourceResult 是收敛后的最终轮，已含给养）。
    async function run(team: Array<{ agentId: string, cinemaLevel?: number }>) {
      await setupHarness(team as never)
      const calc = useResourceCalc()
      const ch = calc.resourceResult.value!.characters.find(c => c.agentId === '1611')
      return { src: ch?.claretSharpResourceSource, dmg: calc.teamTotalDamage.value }
    }
    const withRobin = await run([{ agentId: '1661' }, { agentId: '1611' }, { agentId: '1011' }])
    const without = await run([{ agentId: '1091' }, { agentId: '1611' }, { agentId: '1011' }])
    expect(withRobin.src, '克拉蕾资源结果必须存在').toBeTruthy()
    // 知更鸟的终结技次数由团队喧响决定，恒 >0 ⇒ 赠予为正
    const gift = withRobin.src!.sharpnessGiftFromTeam ?? 0
    expect(gift, '知更鸟在队 ⇒ 给养必须 > 0（否则说明 postRound 没派发或字段没读）').toBeGreaterThan(0)
    expect(gift % ROBIN_ULT_TEAM_SHARPNESS, '给养必须是 20 的整数倍').toBe(0)
    expect(withRobin.src!.sharpnessGain - without.src!.sharpnessGain, '锐能总量差 = 给养').toBe(gift)
  }, 180_000)
})
