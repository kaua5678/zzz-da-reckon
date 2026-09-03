/**
 * 克拉蕾(1611) v12 录入生效测试（2026-09-03，nanoka 3.2.12+18601660）：
 * - 锐能：进场 60 → 秘血铸锋 1 发/局（v12 文本确认旧的「毁伤回锐能」口径废除）；
 * - 残痕值：平A聚合 + 秘血铸锋 234.96% × 积蓄效率（核心 50% + 影画2 20%）→ 满 100 = 1 层；
 * - 毁伤：min(层数, 斩金断铁×1+葬血强袭×3+影画6)×覆盖率 + 影画6 直接毁伤；
 * - C2 毁伤倍率 ×130%（执行行 override）与 C1/C6 全管线抬升。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { computeClaretSharpResource, C2_MAIM_MULT, SHARPNESS_COST_PER_EX } from '@/mechanics/agents/claret'

beforeEach(() => {
  // setupHarness 内部自建 pinia；这里仅保证 fetch stub 隔离
})

describe('克拉蕾锐能（v12：进场 60 → 秘血铸锋 1 发/局）', () => {
  const base = {
    basicGashPerSec: 0,
    basicAttackTime: 0,
    exGashValue: 234.96,
    exCount: 1,
    cleaveSpecialCount: 1,
    bloodBurialCount: 1,
    gashCoverage: 1,
    cinemaLevel: 0,
    chainCountTotal: 0,
    ultimateCount: 0,
  }

  it('锐能唯一来源 = 进场 60：affordableExCount = floor(60/60) = 1，结余 0', () => {
    const r = computeClaretSharpResource({ ...base, cinemaLevel: 0 })
    expect(r.sharpnessGain).toBe(60)
    expect(r.affordableExCount).toBe(1)
    expect(r.sharpnessSpend).toBe(SHARPNESS_COST_PER_EX)
    expect(r.sharpnessRemaining).toBe(0)
  })

  it('残痕值 = (平A聚合 + 秘血铸锋 234.96%) × 积蓄效率；满 100 = 1 层（上限 3）', () => {
    // 仅 EX：234.96 × 1.5（核心 50%） = 352.44 → 3 层
    const r = computeClaretSharpResource({ ...base, cinemaLevel: 0 })
    expect(r.gashBuildupMultiplier).toBeCloseTo(1.5, 5)
    expect(r.gashValuePct).toBeCloseTo(234.96 * 1.5, 5)
    expect(r.gashStacks).toBe(3) // floor(3.5244) 上限 3
    // 影画2：积蓄效率 +20% → 1.7
    const r2 = computeClaretSharpResource({ ...base, cinemaLevel: 2 })
    expect(r2.gashBuildupMultiplier).toBeCloseTo(1.7, 5)
  })

  it('毁伤：min(层数, 需求) 拆分到斩金断铁/葬血强袭；影画6 直接毁伤不消耗残痕', () => {
    // 层数 3（上面）：需求 = 斩金断铁1 + 葬血强袭3 = 4 → 消耗 3 → 毁伤 3（cleave 1 + burial 2）
    const r = computeClaretSharpResource({ ...base, cinemaLevel: 0 })
    expect(r.maimDemand).toBe(4)
    expect(r.gashStackConsumed).toBe(3)
    expect(r.maimFromCleave).toBe(1)
    expect(r.maimFromBurial).toBe(2)
    expect(r.maimCount).toBe(3)
    // C6：连携/终结各 +1 直接毁伤（不占残痕层数）
    const r6 = computeClaretSharpResource({ ...base, cinemaLevel: 6, chainCountTotal: 2, ultimateCount: 1 })
    expect(r6.maimFromC6).toBe(3)
    expect(r6.maimCount).toBe(6) // 消耗 3 + C6 3
  })

  it('残痕覆盖率 50%：消耗层数按比例折算', () => {
    const r = computeClaretSharpResource({ ...base, cinemaLevel: 0, gashCoverage: 0.5 })
    expect(r.gashStackConsumed).toBe(1.5)
    expect(r.maimCount).toBe(1) // floor(1.5)
  })
})

describe('克拉蕾全管线冒烟（v12）', () => {
  async function setup() {
    return setupHarness([{ agentId: '1611', cinemaLevel: 0 }, '', ''])
  }

  it('C6 队伍伤害 > C0（命座有效性，含影画1/3/5 生效；C6 直接毁伤入行）', async () => {
    const { config } = await setup()
    const calc = useResourceCalc()
    const d0 = calc.teamTotalDamage.value
    expect(d0).toBeGreaterThan(0)
    config.team[0].cinemaLevel = 6
    const d6 = calc.teamTotalDamage.value
    expect(d6).toBeGreaterThan(d0)
  })

  it('影画1 电抗无视 16% 确实抬高结果（v12 C1 口径）', async () => {
    const { config } = await setup()
    const calc = useResourceCalc()
    const d0 = calc.teamTotalDamage.value
    config.team[0].cinemaLevel = 1
    const d1 = calc.teamTotalDamage.value
    expect(d1).toBeGreaterThan(d0)
  })

  it('影画2 毁伤倍率 ×130%：执行行 override 生效（表值 1625.6% × 1.3 = 2113.28%）', async () => {
    const { config } = await setup()
    config.team[0].cinemaLevel = 2
    const calc = useResourceCalc()
    const row = calc.resourceResult.value!.characters.find(c => c.agentId === '1611')!
      .executions.find(e => e.moveId === '1611013' && (e.damageMultiplierOverride ?? false))
    expect(row).toBeTruthy()
    expect(row!.damageMultiplier).toBeCloseTo(1625.6 * C2_MAIM_MULT, 1)
  })
})
