/**
 * 克拉蕾(1611) 录入生效测试：
 * - 影画1 残痕积累 ×1.15 与暴击率满层 +15% 确实改变资源/结果（防「录了没生效」）；
 * - 影画2 的 0.25 锐能/毁伤近似（C2）保持行为；
 * - C6 全管线伤害 > C0（对齐 allAgentsSweep 的命座有效性不变量，定位到本角色）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { computeClaretSharpResource } from '@/mechanics/agents/claret'

beforeEach(() => {
  // setupHarness 内部自建 pinia；这里仅保证 fetch stub 隔离
})

describe('克拉蕾残痕/锐能资源（纯函数）', () => {
  const base = {
    teammateFrontlineSeconds: 20,
    exSpecialCount: 1,
    cleaveSpecialCount: 1,
    bloodBurialCount: 1,
    gashCoverage: 1,
    sharpnessCost: 60,
  }

  it('影画1：残痕积累速率 ×1.15（20s → 60% → 69%）', () => {
    const c0 = computeClaretSharpResource({ ...base, cinemaLevel: 0 })
    const c1 = computeClaretSharpResource({ ...base, cinemaLevel: 1 })
    expect(c0.gashBuildupRateMultiplier).toBe(1)
    expect(c1.gashBuildupRateMultiplier).toBeCloseTo(1.15)
    expect(c0.gashValuePct).toBeCloseTo(60)
    expect(c1.gashValuePct).toBeCloseTo(69)
  })

  it('毁伤消耗与个人资源增伤：1 层残痕 → 1 次毁伤 → +6.5%', () => {
    const r = computeClaretSharpResource({ ...base, cinemaLevel: 0 })
    expect(r.maimCount).toBeGreaterThanOrEqual(1)
    expect(r.personalResourcesConsumed).toBeGreaterThanOrEqual(1)
    expect(r.personalResourceDamageBonusPct).toBeCloseTo(6.5 * r.personalResourcesConsumed)
  })

  it('影画2（C2）：每次毁伤额外回复 0.25 锐能', () => {
    const c0 = computeClaretSharpResource({ ...base, cinemaLevel: 2 })
    const expectedGain = c0.personalResourceGain * (1 + 0.25)
    expect(c0.sharpnessGain).toBeCloseTo(expectedGain)
  })
})

describe('克拉蕾全管线冒烟', () => {
  // 采用 anbyCinema1 的原地改命座模式：同一 harness 内变更 cinemaLevel 触发重算，
  // 避免「二次 setupHarness 后 composable 未重绑」导致的两次结果完全相同。
  async function setup() {
    return setupHarness([{ agentId: '1611', cinemaLevel: 0 }, '', ''])
  }

  it('C6 队伍伤害 > C0（命座有效性，含影画1/3/5 生效）', async () => {
    const { config } = await setup()
    const calc = useResourceCalc()
    const d0 = calc.teamTotalDamage.value
    expect(d0).toBeGreaterThan(0)
    config.team[0].cinemaLevel = 6
    const d6 = calc.teamTotalDamage.value
    expect(d6).toBeGreaterThan(d0)
  })

  it('影画1 暴击率 +15%（满层近似）确实抬高结果', async () => {
    const { config } = await setup()
    const calc = useResourceCalc()
    const d0 = calc.teamTotalDamage.value
    config.team[0].cinemaLevel = 1
    const d1 = calc.teamTotalDamage.value
    expect(d1).toBeGreaterThan(d0)
  })
})
