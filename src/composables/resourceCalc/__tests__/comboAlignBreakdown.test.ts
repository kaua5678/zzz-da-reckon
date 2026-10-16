/**
 * 合轴三项分解 + 「固定」原因判据（用户口径 2026-10-16）。
 *
 * 用户原话：
 * > 「此处有**两个概念没融合**。一个是**综合合轴率默认 40%**，一个是**老的我设置的数值**……
 * >  这个也要**在时间统计里面标注合轴了多少时间**。」
 * > 「但你现在**很多是固定的不让调，我不知道为什么**。」
 *
 * 两条判据：
 *  ① 三项分解**互斥完备**（`absorb + perMove ≡ Σ comboAlignCredit`）且与总抵扣的差 = 被 max 吃掉的重叠；
 *  ② 「固定」分**三种原因**（引擎记账 / 赠送 / 机制），且能对真实执行行判出来。
 *
 * 反证：把 `perMove` 算成 `credit`（不减 absorb）⇒ 用例 ① 的完备性红；
 * 把 `comboAlignFixedReason` 恒返回 null ⇒ 用例 ② 红。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { teamPresets } from '@/data/teamPresets'
import { applyTeamToStore } from '@/composables/teamCompare'
import { buildTeamTimeSummary, type ComboAlignBreakdown } from '@/composables/teamTimeSummary'
import { comboAlignFixedLabel, comboAlignFixedReason, comboAlignEditable } from '@/composables/resourceCalc/comboAlignDisplay'
import { COMBO_ALIGN_ABSORB_RATIO_SETTING } from '@/data/resourceDefaults'

const TEAM = 'banyue-qingyi-lucia'

async function summaryOf(absorb: number) {
  const { catalog, config } = await setupHarness(['', '', ''])
  await catalog.loadBuildRecommendations()
  const calc = useResourceCalc()
  const p = teamPresets.find(x => x.id === TEAM)!
  applyTeamToStore(config, p)
  config.setMechanicSetting(COMBO_ALIGN_ABSORB_RATIO_SETTING, absorb)
  const rr = calc.resourceResult.value
  expect(rr, '资源池未产出').toBeTruthy()
  return {
    summary: buildTeamTimeSummary({ rr, battleTime: config.enemy.battleTime, invincibleTime: config.enemy.invincibleTime, nameOf: () => 'x' }),
    rr: rr!,
  }
}

describe('合轴三项分解', () => {
  it('① 互斥完备：absorb + perMove ≡ Σ comboAlignCredit；与总抵扣的差 = 被取大吃掉的量', async () => {
    for (const absorb of [0, 0.4, 0.8]) {
      const { summary, rr } = await summaryOf(absorb)
      const b: ComboAlignBreakdown = summary.comboAlignBreakdown
      const creditSum = rr.characters.reduce((s, c) => s + Math.max(0, c.timeAllocation.comboAlignCredit ?? 0), 0)
      expect(b.absorb + b.perMove, `absorb=${absorb}：两项之和应 ≡ Σ credit`).toBeCloseTo(creditSum, 6)
      expect(b.axisOverlapOverridden, '重叠量恒 ≥ 0').toBeGreaterThanOrEqual(-1e-9)
      // 三项之和 − 总抵扣 ≡ 被吃掉的重叠
      expect(b.absorb + b.perMove + b.axisOverlap - summary.comboAlignDeduction)
        .toBeCloseTo(b.axisOverlapOverridden, 6)
    }
  }, 600_000)

  it('①b 综合吸收随吸收率单调增（证明这一项确实由那个旋钮驱动）', async () => {
    const a = (await summaryOf(0)).summary.comboAlignBreakdown.absorb
    const b = (await summaryOf(0.4)).summary.comboAlignBreakdown.absorb
    const c = (await summaryOf(0.8)).summary.comboAlignBreakdown.absorb
    expect(a, '吸收率 0 ⇒ 综合吸收为 0').toBeCloseTo(0, 6)
    expect(b).toBeGreaterThan(a)
    expect(c).toBeGreaterThan(b)
  }, 600_000)

  it('② 「固定」行能判出原因，且可调行返回 null', async () => {
    const { rr } = await summaryOf(0.4)
    const rows = rr.characters.flatMap(c => c.executions)
    const fixed = rows.filter(e => !comboAlignEditable(e))
    const editableRows = rows.filter(e => comboAlignEditable(e))
    expect(fixed.length, '反空洞：本队确实有固定行').toBeGreaterThan(0)
    expect(editableRows.length, '反空洞：本队确实有可调行').toBeGreaterThan(0)
    // 可调行 ⇒ null（不显示「固定」标签）
    for (const e of editableRows) expect(comboAlignFixedReason(e)).toBeNull()
    // 固定行 ⇒ 必有原因，且标签非空
    const seen = new Set<string>()
    for (const e of fixed) {
      const r = comboAlignFixedReason(e)
      expect(r, `固定行 ${e.moveId} 应判出原因`).not.toBeNull()
      expect(comboAlignFixedLabel(r!)).not.toBe(undefined)
      seen.add(r!)
    }
    expect(seen.size, '应至少判出两种原因（引擎记账 / 机制）').toBeGreaterThanOrEqual(2)
    // 平A汇总行必是引擎记账口径
    const basic = fixed.find(e => e.moveId === 'basic_attack')
    if (basic) expect(comboAlignFixedReason(basic)).toBe('engine')
  }, 600_000)
})
