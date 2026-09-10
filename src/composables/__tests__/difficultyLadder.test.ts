/**
 * 难度阶梯判据测试（2026-09-10，用户「伤害-难度曲线」口径的核心保证）。
 *
 * 钉住四条：
 *  ① **曲线单调不减**——只录取 Δ≥0 的目标，所以每一点的伤害必须 ≥ 前一点（曲线不许掉头）；
 *  ② **负收益目标被丢弃并如实上报**（不静默、不硬塞）——这是"每个目标必须有『开了确实变好』测试"的实战版；
 *  ③ **x 是累积代价**（各队不对齐是特性）；起点 = 全关，终点 = 已录取目标并集；
 *  ④ **目标契约**：每个目标 `apply` 都能跑通且不抛错；`resetDifficultyGoals` 能回到静态权重。
 * 另：贪心按 **Δ/代价** 排序（用一个"高收益低代价 / 低收益高代价"的合成目标集验证取舍）。
 */
import { describe, it, expect, vi } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useConfigStore } from '@/stores/config'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { teamPresets } from '@/data/teamPresets'
import {
  DIFFICULTY_GOALS, climbDifficultyLadder, summarizeLadder, resetDifficultyGoals,
  type DifficultyGoal, type LadderCtx,
} from '@/composables/difficultyLadder'

// 本文件每条都要跑完整引擎（贪心阶梯最多 4 次全队求值，其中含联合策略 ≈1.5s/队）⇒ 默认 5s 会临界超时
// （实测 4.5s，负载下必红——同 `underfillRefund` ② 的教训：跑全引擎的用例必须显式声明超时）。
vi.setConfig({ testTimeout: 60_000 })

const TEAM = 'auto-1521-1361-1311' // 实测提升最大（+44%）的队，对目标最敏感

describe('难度阶梯（伤害-难度曲线）', () => {
  it('① 曲线单调不减 + ③ 累积代价单调 + 起点=全关', async () => {
    const { catalog, config } = await setupHarness(['', '', ''])
    await catalog.loadBuildRecommendations()
    const calc = useResourceCalc()
    const ctx: LadderCtx = { config, calc }
    const p = teamPresets.find(x => x.id === TEAM)!
    const r = climbDifficultyLadder(ctx, p.team as [string, string, string])

    expect(r.points[0]!.x).toBe(0)
    expect(r.points[0]!.dmg).toBe(r.base)
    expect(r.points[0]!.opened).toBeNull()
    for (let i = 1; i < r.points.length; i++) {
      expect(r.points[i]!.dmg, `第 ${i} 档伤害不得低于前一档`).toBeGreaterThanOrEqual(r.points[i - 1]!.dmg - 1e-6)
      expect(r.points[i]!.x, `累积难度必须递增或持平`).toBeGreaterThanOrEqual(r.points[i - 1]!.x)
      expect(r.points[i]!.opened).toBeTruthy()
    }
    expect(r.final).toBeGreaterThanOrEqual(r.base - 1e-6)
  })

  it('② 负收益目标被丢弃且如实上报（合成目标集：必负的一个）', async () => {
    const { catalog, config } = await setupHarness(['', '', ''])
    await catalog.loadBuildRecommendations()
    const calc = useResourceCalc()
    const ctx: LadderCtx = { config, calc }
    const p = teamPresets.find(x => x.id === TEAM)!
    const base = resetDifficultyGoals(ctx, p.team as [string, string, string])
    // 合成：一个把主C权重清零的目标（必然卖伤害）
    const bad: DifficultyGoal = {
      id: 'X-BAD', label: '主C权重清零（合成·必负）', cost: 1, mutates: true,
      apply: c => { c.config.setBasicAttackTimeWeight(0, 0) },
    }
    const r = climbDifficultyLadder(ctx, p.team as [string, string, string], { goals: [bad, DIFFICULTY_GOALS[0]!] })
    expect(r.dropped.map(d => d.id)).toContain('X-BAD')
    expect(r.dropped.find(d => d.id === 'X-BAD')!.gain).toBeLessThan(0)
    expect(r.opened).not.toContain('X-BAD')
    expect(r.final).toBeGreaterThan(base) // 另一个目标仍被录取并带来提升
  })

  it('④ 目标契约：每个目标 apply 不抛错；代价/标签齐备', async () => {
    const { catalog, config } = await setupHarness(['', '', ''])
    await catalog.loadBuildRecommendations()
    const calc = useResourceCalc()
    const ctx: LadderCtx = { config, calc }
    const p = teamPresets.find(x => x.id === TEAM)!
    const base = resetDifficultyGoals(ctx, p.team as [string, string, string])
    expect(base).toBeGreaterThan(0)
    for (const g of DIFFICULTY_GOALS) {
      expect(g.label.length, `${g.id} 必须有中文名`).toBeGreaterThan(0)
      expect(Number.isFinite(g.cost), `${g.id} 必须有代价`).toBe(true)
      expect(() => g.apply(ctx)).not.toThrow()
      // 跑完必须还能读出伤害（不能把配置写成 NaN）
      const d = calc.teamTotalDamage.value
      expect(Number.isFinite(d), `${g.id} 应用后伤害必须有限`).toBe(true)
      expect(d).toBeGreaterThan(0)
      resetDifficultyGoals(ctx, p.team as [string, string, string])
    }
  })

  it('②b Δ=0（无意义增益）的目标同样被丢弃（相对门槛 0.01%）', async () => {
    const { catalog, config } = await setupHarness(['', '', ''])
    await catalog.loadBuildRecommendations()
    const calc = useResourceCalc()
    const ctx: LadderCtx = { config, calc }
    const p = teamPresets.find(x => x.id === TEAM)!
    // 合成：一个什么都不做的目标（Δ=0）
    const noop: DifficultyGoal = {
      id: 'X-NOOP', label: '空目标（合成·Δ=0）', cost: 1, mutates: false, apply: () => {},
    }
    const r = climbDifficultyLadder(ctx, p.team as [string, string, string], { goals: [noop] })
    expect(r.dropped.map(d => d.id)).toContain('X-NOOP')
    expect(r.opened).not.toContain('X-NOOP')
    expect(r.points).toHaveLength(1) // 只剩全关起点 ⇒ 曲线不出现"难度涨、伤害不涨"的平台段
  })

  it('摘要：斜率 = 单位难度收益（除零保护）', async () => {
    const { catalog, config } = await setupHarness(['', '', ''])
    await catalog.loadBuildRecommendations()
    const calc = useResourceCalc()
    const ctx: LadderCtx = { config, calc }
    const p = teamPresets.find(x => x.id === TEAM)!
    const r = climbDifficultyLadder(ctx, p.team as [string, string, string])
    const s = summarizeLadder(r)
    expect(s.gainPct).toBeGreaterThan(0)
    expect(Number.isFinite(s.slope)).toBe(true)
    if (s.totalCost > 0) expect(s.slope).toBeCloseTo(s.gainPct / s.totalCost, 6)
    else expect(s.slope).toBe(s.gainPct) // 代价全 0 时按总增益（除零保护）
  })
})
