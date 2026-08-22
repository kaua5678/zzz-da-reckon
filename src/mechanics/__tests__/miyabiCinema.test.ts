/**
 * 星见雅(1091) 命座生效测试：对齐 character-constellations.json 的定案口径。
 * - M1 落霜无视防御 / M2 暴击与风花闪反增伤+入场6落霜 / M4 霜灼·破+30% / M6 极意+30%；
 * - 各命座逐级抬高全管线伤害（C0 < C2 < C4 < C6），防「录了没生效」。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'

describe('星见雅命座生效（全管线）', () => {
  async function damageAt(cinemaLevel: number): Promise<number> {
    const { config } = await setupHarness([{ agentId: '1091', cinemaLevel }, '', ''])
    const calc = useResourceCalc()
    const dmg = calc.teamTotalDamage.value
    // 还原现场，避免影响同文件后续用例的 store 状态
    config.team[0].cinemaLevel = 0
    return dmg
  }

  it('C0 > 0 且各命座逐级有效：C2 > C0、C4 ≥ C2、C6 > C4', async () => {
    const d0 = await damageAt(0)
    expect(d0).toBeGreaterThan(0)
    const d2 = await damageAt(2)
    expect(d2).toBeGreaterThan(d0)
    const d4 = await damageAt(4)
    expect(d4).toBeGreaterThanOrEqual(d2)
    const d6 = await damageAt(6)
    expect(d6).toBeGreaterThan(d4)
  })
})
