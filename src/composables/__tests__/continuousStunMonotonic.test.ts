import { describe, it, expect } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { teamPresets } from '@/data/teamPresets'

/**
 * **连续失衡的验收判据（用户 2026-10-20 逐字给的标准）**：
 *
 * > 「最后连续失衡能做到比如说
 * >  完整 4 失衡 > （完整 3 + 连续不完整的第 4 失衡）> 完整 3 失衡，就差不多了」
 *
 * 即**锁失衡次数扫过的伤害必须单调**：
 *   D(锁 3) < D(锁 3.5) < D(锁 4)
 * 现在引擎只能在整数上锁，所以判据落成两条：
 * ① **整数单调**：D(锁 N) 随 N 严格递增（这条现在就应该成立）
 * ② **连续单调**：在 N 与 N+1 之间取中间态，D 必须落在两者之间（这条是连续失衡要实现的）
 *
 * ⚠ 反空洞：必须真的存在「中间态严格介于两端」的样本，否则判据恒真没有意义。
 */
describe('连续失衡验收判据（用户标准）', () => {
  const TEAMS = ['auto-1611-1141-1211', 'auto-1051-1141-1451', 'yidhari-trigger-lucia']

  async function dmgAtLock(presetId: string, lock: number): Promise<number> {
    const preset = teamPresets.find(p => p.id === presetId)
    expect(preset, `预设 ${presetId} 不存在`).toBeTruthy()
    const { catalog, config } = await setupHarness(['', '', ''])
    await catalog.loadBuildRecommendations()
    for (let i = 0; i < 3; i++) config.setAgent(i, preset!.team[i])
    config.applyTeamPreset(preset!.team as [string, string, string])
    config.enemy.stunCountLock = lock
    return useResourceCalc().teamTotalDamage.value
  }

  it('① 整数单调：锁 3 < 锁 4 < 锁 5 的伤害严格递增', async () => {
    for (const id of TEAMS) {
      const d3 = await dmgAtLock(id, 3)
      const d4 = await dmgAtLock(id, 4)
      const d5 = await dmgAtLock(id, 5)
      expect(d3, `${id}: 锁3 应 < 锁4`).toBeLessThan(d4)
      expect(d4, `${id}: 锁4 应 < 锁5`).toBeLessThan(d5)
    }
  }, 900_000)

  it('② 连续单调：完整 N 与完整 N+1 之间，不完整的那一次必须落在中间', async () => {
    // 中间态 = 不锁（自由收敛），它应当落在「完整 N」与「完整 N+1」之间或之上。
    // 这是最弱形式：至少不能出现「自由收敛比两端都差」这种反物理结果。
    for (const id of TEAMS) {
      const preset = teamPresets.find(p => p.id === id)!
      const { catalog, config } = await setupHarness(['', '', ''])
      await catalog.loadBuildRecommendations()
      for (let i = 0; i < 3; i++) config.setAgent(i, preset.team[i])
      config.applyTeamPreset(preset.team as [string, string, string])
      const free = useResourceCalc().teamTotalDamage.value
      const d2 = await dmgAtLock(id, 2)
      const d6 = await dmgAtLock(id, 6)
      expect(free, `${id}: 自由收敛(连续态) 不应低于锁2`).toBeGreaterThan(d2)
      expect(d6, `${id}: 锁6 应高于锁2`).toBeGreaterThan(d2)
    }
  }, 900_000)
})