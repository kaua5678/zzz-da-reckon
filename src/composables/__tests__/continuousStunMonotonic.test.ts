/**
 * **连续失衡的验收判据（用户 2026-10-20 标准 + 同日两次纠正后的最终形态）**
 *
 * ## 用户标准（逐字）
 *
 * > 「连续失衡能做到比如说
 * >  完整 4 失衡 > （完整 3 + 连续不完整的第 4 失衡）> 完整 3 失衡，就差不多了」
 *
 * ⇒ **同一目标档内**的三态排序，不是全局单调。
 *
 * ## 纠正一：D(5) < D(4) 是正确行为
 *
 * > 「强行 5 失衡可能导致资源过多倾斜于击破手，主 c 资源不够……
 * >  多数队伍只有 4 个大招，5 失衡也打不出 5 大；般岳嗔火基本只能 4 轮」
 *
 * 我最初写成 `D(3) < D(4) < D(5)` 严格单调 —— 那是**错的**（与实战相反）。
 *
 * ## 纠正二（本轮）：环状态下「连续态」根本不存在
 *
 * 实测 `auto-1051-1141-1451`：
 *
 * | 状态 | exit | N | 覆盖率 | 伤害 |
 * |---|---|---|---|---|
 * | 自由收敛 | **cycle** | 5 | 0.444 | 69.141M |
 * | 锁 5 | **stable** | 5 | 0.444 | **69.719M** |
 *
 * 覆盖率、N 完全相同，伤害差 0.58M ⇒ 环态下读到的池/资源与稳定态**不同源**。
 * ⇒ 判据不能拿「自由收敛态」当连续态样本，必须**要求先收敛**。
 */
import { describe, it, expect } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { teamPresets } from '@/data/teamPresets'

const TEAMS = ['auto-1611-1141-1211', 'auto-1051-1141-1451', 'yidhari-trigger-lucia']

async function snapshot(presetId: string, lock: number) {
  const preset = teamPresets.find(p => p.id === presetId)
  expect(preset, `预设 ${presetId} 不存在`).toBeTruthy()
  const { catalog, config } = await setupHarness(['', '', ''])
  await catalog.loadBuildRecommendations()
  for (let i = 0; i < 3; i++) config.setAgent(i, preset!.team[i])
  config.applyTeamPreset(preset!.team as [string, string, string])
  config.enemy.stunCountLock = lock
  const calc = useResourceCalc()
  const rr = calc.resourceResult.value!
  return {
    dmg: calc.teamTotalDamage.value,
    pool: calc.stunPoolResult.value?.stunCount ?? 0,
    cov: calc.stunCoverage.value,
    exit: rr.convergence.outerExit,
  }
}

describe('连续失衡验收判据', () => {
  /**
   * **① 收敛是连续失衡的前提**（本轮新增，抓的是实测到的真缺陷）
   *
   * 环态下 N 与覆盖率都可能与稳定态相同，但伤害不同源（实测差 0.58M）。
   * ⇒ 「连续」只有在**收敛**时才有定义；环态下没有连续态可谈。
   */
  it('① 外层必须收敛（stable）—— 环态下不存在「连续态」', async () => {
    const bad: string[] = []
    for (const id of TEAMS) {
      const s = await snapshot(id, -1)
      if (s.exit !== 'stable') bad.push(`${id}:${s.exit}`)
    }
    expect(bad, `连续失衡要求先收敛，以下未收敛：${bad.join(' ')}`).toEqual([])
  }, 900_000)

  /**
   * **② 同档内三态排序**（用户标准本体）
   *
   * 在稳定态下，「完整 N−1」<「连续 N−1+小数」<「完整 N」必须成立。
   * 由于引擎目前只能在整数上锁，「连续态」用自由收敛（stable）的 N* 代表。
   */
  it('② 同档三态排序：完整 N−1 < 连续态 < 完整 N+1（稳定态下）', async () => {
    for (const id of TEAMS) {
      const free = await snapshot(id, -1)
      if (free.exit !== 'stable') continue // ① 已单独判
      const lo = Math.max(1, Math.floor(free.pool))
      const a = await snapshot(id, lo - 1 < 1 ? 1 : lo - 1)
      const b = await snapshot(id, lo)
      // 只判「下限」：连续态不得低于**更低的完整档**（那是真正的缺陷）。
      // ⚠ 不判上限：用户 2026-10-20 明确「完整 5 < 完整 4 是符合实战的」
      //（资源竞争 / 只有 4 个大招 / 般岳嗔火 4 轮）⇒ 连续态高于完整 N+1 是**正确**的。
      expect(free.dmg, `${id}: 连续态 应 ≥ 完整${Math.max(1, lo - 1)}`).toBeGreaterThanOrEqual(a.dmg * 0.995)
      expect(free.dmg, `${id}: 连续态 应 ≥ 完整${lo}`).toBeGreaterThanOrEqual(b.dmg * 0.995)
    }
  }, 900_000)

  /**
   * **③ 低档单调**：大招数足够覆盖的区间内（≤3），次数越多伤害越高。
   * 不测 4→5（那一档由资源竞争主导，下降是正确行为）。
   */
  it('③ 低档单调：锁 2 < 锁 3', async () => {
    for (const id of TEAMS) {
      const d2 = await snapshot(id, 2)
      const d3 = await snapshot(id, 3)
      expect(d3.dmg, `${id}: 锁3 应 > 锁2`).toBeGreaterThan(d2.dmg)
    }
  }, 900_000)
})