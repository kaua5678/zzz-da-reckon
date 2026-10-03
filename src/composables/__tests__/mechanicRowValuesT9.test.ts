import { describe, expect, it } from 'vitest'
import { getRowValue, findMoveById } from '@/data/moveTableQueries'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { HUGO_VERDICT_BASE_MULTIPLIER, computeHugoVerdictMultiplier } from '@/mechanics/agents/hugo'

/**
 * T9（CC-408 同款）：模块内「= catalog 行值」的倍率常量改读表，零差。
 *
 * 雨果强特终结 1291010 damage 行原由模块常量 `HUGO_EX_FINAL_BASE_MULTIPLIER = 709.8` 结算；
 * 现由 `buildHugoCharConfig` 读 catalog 进 `cfg.mechanicRowValues['1291010']`，执行行从该处取。
 * 反空洞：真引擎跑出的行倍率必须等于 catalog 该行值（而不是任何写死的数字），且行真实出现。
 *
 * 口径适配（卡面未说清，取最小改动）：C6 下 `1291_ex_normal_final` 恒被 `count = 0` 短路
 * （轴外强特转 `1291_c6_out_of_stun_verdict`），该行在 C6 **不会出现**。故：
 * - C0（exVerdictRatio 0.5）→ `1291_ex_normal_final` 出现，断言 === 表值；
 * - C6（exVerdictRatio 0.5）→ `1291_c6_out_of_stun_verdict` 出现，断言 === 表值 + 决算基础倍率（同源表值）；
 * 两级另断言决算行 `1291_ex_verdict_final` === 表值 + 决算额外倍率。
 */
describe('T9 雨果强特终结 1291010 倍率来自 catalog（cfg.mechanicRowValues）', () => {
  const CASES: Array<{ cinema: number; normalMoveId: string }> = [
    { cinema: 0, normalMoveId: '1291_ex_normal_final' },
    { cinema: 6, normalMoveId: '1291_c6_out_of_stun_verdict' },
  ]

  it('真引擎：C0/C6 决算与非决算行倍率 === catalog 1291010 damage 行值（行真实出现）', async () => {
    for (const c of CASES) {
      const { catalog, config } = await setupHarness([
        { agentId: '1291', cinemaLevel: c.cinema, parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
        { agentId: '1141', cinemaLevel: 0 },
        '',
      ])
      // exVerdictRatio < 1 ⇒ 出现「非决算」强特终结行（C6 下走轴外荆棘决算行）
      config.setMechanicSetting('hugo.exVerdictRatio', 0.5)
      const calc = useResourceCalc()
      const ch = calc.resourceResult.value!.characters.find(x => x.agentId === '1291')!
      const tableDamage = getRowValue(findMoveById(catalog.getAgentSkills('1291'), '1291010'), 'damage')
      expect(tableDamage, 'catalog 1291010 damage 行值').toBeGreaterThan(0)

      const normal = ch.executions.find(e => e.moveId === c.normalMoveId)
      expect(normal, `C${c.cinema} ${c.normalMoveId} 行真实出现`).toBeTruthy()
      const expectedNormal = c.cinema >= 6 ? tableDamage + HUGO_VERDICT_BASE_MULTIPLIER : tableDamage
      expect(normal!.damageMultiplier, `C${c.cinema} ${c.normalMoveId}`).toBeCloseTo(expectedNormal, 9)

      // 决算行：表值 + 决算额外倍率（决算倍率 = 1000 + 剩余秒数动态，与表值无关；默认滑块剩余 5 秒）
      const verdict = ch.executions.find(e => e.moveId === '1291_ex_verdict_final')
      expect(verdict, `C${c.cinema} 决算行真实出现`).toBeTruthy()
      const expectedVerdictExtra = computeHugoVerdictMultiplier(5)
      expect(verdict!.damageMultiplier! - tableDamage, `C${c.cinema} 决算额外倍率`)
        .toBeCloseTo(expectedVerdictExtra, 9)
      expect(verdict!.damageMultiplier!).toBeGreaterThan(tableDamage)
    }
  })
})
