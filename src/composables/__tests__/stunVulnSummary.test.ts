/**
 * 失衡易伤可见化（.claude/task-ledger-stun-vuln.md Open #2）：行级生效易伤换算 + 加权汇总。
 *
 * 口径：行级 `stunMult` = Boss 失衡易伤分量（vuln=1.5 满额行 1.5 / 零行 1.0 / 部分行中间值），
 * 生效易伤 = calcStunMultiplier(vuln, 面板加成, frac)；加权信用 = Σ(d×生效)/Σd − 1
 * （与部署 A/B 差分实验同构；异常行按 1，信用偏保守——异常行不逐行暴露易伤）。
 * 集成快照：雨果 0 命轴（hugo-c0-e 预设）冻结值来自 2026-09-10 修复坑36 后的引擎输出。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { stunAxisPresets, cloneStunAxes } from '@/data/stunAxisPresets'
import { calcStunMultiplier } from '@/core/anomalyPool/helpers'
import { computeStunVulnSummary, rowAppliedStunMult } from '@/composables/stunVulnSummary'
import type { DamagePoolRow } from '@/composables/resourceCalc/helpers'

describe('rowAppliedStunMult（行级分量 → 生效易伤）', () => {
  const vuln = 1.5
  const bonus = 60 // 雨果队面板失衡增伤
  it('异常行（无 stunMult）→ 1', () => {
    expect(rowAppliedStunMult(undefined, vuln, bonus, 0, 0)).toBe(1)
  })
  it('满额行分量 1.5 → 2.100（含面板加成）；零行 1.0 → 1.000', () => {
    expect(rowAppliedStunMult(1.5, vuln, bonus, 0, 0)).toBeCloseTo(2.1, 3)
    expect(rowAppliedStunMult(1.0, vuln, bonus, 0, 0)).toBeCloseTo(1.0, 3)
  })
  it('部分行分量反推 frac 后按覆盖率插值（vuln=1.5 时 1.25 → frac 0.5 → 1.55）', () => {
    expect(rowAppliedStunMult(1.25, vuln, bonus, 0, 0)).toBeCloseTo(1.55, 3)
  })
  it('vuln=1（无易伤配置）不除零，按分量是否为满额回落', () => {
    expect(rowAppliedStunMult(1.5, 1.0, 0, 0, 0)).toBe(1)
    expect(rowAppliedStunMult(1.0, 1.0, 0, 0, 0)).toBe(1)
  })
})

describe('computeStunVulnSummary（加权有效易伤）', () => {
  it('全满额 → 信用 = 满额信用、覆盖率 1', () => {
    const s = computeStunVulnSummary(
      [{ totalDamage: 100, appliedStunMult: 2.1 }, { totalDamage: 200, appliedStunMult: 2.1 }],
      2.1,
    )
    expect(s.weightedVuln).toBeCloseTo(2.1, 6)
    expect(s.weightedCredit).toBeCloseTo(1.1, 6)
    expect(s.coverageRate).toBeCloseTo(1, 6)
  })
  it('全零 → 信用 0、覆盖率 0', () => {
    const s = computeStunVulnSummary(
      [{ totalDamage: 100, appliedStunMult: 1 }, { totalDamage: 200, appliedStunMult: 1 }],
      2.1,
    )
    expect(s.weightedVuln).toBeCloseTo(1, 6)
    expect(s.weightedCredit).toBeCloseTo(0, 6)
    expect(s.coverageRate).toBeCloseTo(0, 6)
  })
  it('混合按伤害加权（各 100：2.1 与 1.0 → 1.55 / 信用 0.55 / 覆盖率 0.5）', () => {
    const s = computeStunVulnSummary(
      [{ totalDamage: 100, appliedStunMult: 2.1 }, { totalDamage: 100, appliedStunMult: 1.0 }],
      2.1,
    )
    expect(s.weightedVuln).toBeCloseTo(1.55, 6)
    expect(s.weightedCredit).toBeCloseTo(0.55, 6)
    expect(s.coverageRate).toBeCloseTo(0.5, 6)
  })
  it('空池 → 加权 1 / 信用 0 / 覆盖率 0（满额照常返回）', () => {
    const s = computeStunVulnSummary([], 2.1)
    expect(s.fullMult).toBe(2.1)
    expect(s.weightedVuln).toBe(1)
    expect(s.weightedCredit).toBe(0)
    expect(s.coverageRate).toBe(0)
  })
})

describe('集成快照：雨果 0 命轴（坑36 修复后冻结）', () => {
  async function setupHugoAxis(extraDodge = false) {
    const { config } = await setupHarness(
      [{ agentId: '1291' }, { agentId: '1481' }, { agentId: '1161' }],
      { recommendedBuild: true },
    )
    const preset = stunAxisPresets.find(p => p.id === 'hugo-c0-e')
    const axes = preset?.axes
    if (!axes) throw new Error('预设不存在或无轴：hugo-c0-e')
    config.autoYidhariAxis = false
    config.stunAxisPlans.splice(0)
    config.stunAxes.splice(0)
    config.useStunAxis = false
    config.setCinemaLevel(0, 0)
    config.stunAxes.push(...cloneStunAxes(axes))
    config.useStunAxis = true
    if (extraDodge) config.stunAxes[0].actions.push({ slot: 0, moveId: '1291012', count: 1, startTime: 8 })
    return { config, calc: useResourceCalc() }
  }

  it('案例 B（0 命轴双连携+决算）：决算行生效易伤 2.100、普通终结 1.000；加权快照 1.6860/0.6860/0.6237', async () => {
    const { config, calc } = await setupHugoAxis()
    const vuln = config.enemy.stunVuln
    const p0 = calc.panels.value[0]
    const bonus = p0?.stunDmgMultiplierBonus ?? 0
    const always = p0?.stunDmgMultiplierBonusAlways ?? 0
    const cap = p0?.stunDmgMultiplierBonusCapAlways ?? 0
    const full = calcStunMultiplier(vuln, bonus, always, cap, true)
    expect(full).toBeCloseTo(2.1, 3)
    const rows = (calc.damagePoolRows.value ?? []) as DamagePoolRow[]
    const verdict = rows.find(r => r.moveId === '1291_ex_verdict_final')
    const normal = rows.find(r => r.moveId === '1291_ex_normal_final')
    expect(verdict?.count).toBe(5) // 坑36 修复：轴栈同源
    expect(rowAppliedStunMult(verdict?.stunMult, vuln, bonus, always, cap)).toBeCloseTo(2.1, 3)
    expect(rowAppliedStunMult(normal?.stunMult, vuln, bonus, always, cap)).toBeCloseTo(1.0, 3)
    const s = computeStunVulnSummary(
      rows.map(r => ({ totalDamage: r.totalDamage, appliedStunMult: rowAppliedStunMult(r.stunMult, vuln, bonus, always, cap) })),
      full,
    )
    expect(s.weightedVuln).toBeCloseTo(1.6860, 3)
    expect(s.weightedCredit).toBeCloseTo(0.6860, 3)
    expect(s.coverageRate).toBeCloseTo(0.6237, 3)
  })

  it('案例 D（加闪反块被轴认领一半）：加权快照 1.7165/0.7165/0.6514；闪反切成两行', async () => {
    const { config, calc } = await setupHugoAxis(true)
    const vuln = config.enemy.stunVuln
    const p0 = calc.panels.value[0]
    const bonus = p0?.stunDmgMultiplierBonus ?? 0
    const always = p0?.stunDmgMultiplierBonusAlways ?? 0
    const cap = p0?.stunDmgMultiplierBonusCapAlways ?? 0
    const full = calcStunMultiplier(vuln, bonus, always, cap, true)
    const rows = (calc.damagePoolRows.value ?? []) as DamagePoolRow[]
    const dodgeRows = rows.filter(r => r.moveId === '1291012')
    expect(dodgeRows.length).toBe(2) // 轴内段(满额) + 轴外段(零)
    expect(dodgeRows.some(r => rowAppliedStunMult(r.stunMult, vuln, bonus, always, cap) > 1.99)).toBe(true)
    expect(dodgeRows.some(r => rowAppliedStunMult(r.stunMult, vuln, bonus, always, cap) < 1.01)).toBe(true)
    const s = computeStunVulnSummary(
      rows.map(r => ({ totalDamage: r.totalDamage, appliedStunMult: rowAppliedStunMult(r.stunMult, vuln, bonus, always, cap) })),
      full,
    )
    expect(s.weightedVuln).toBeCloseTo(1.7165, 3)
    expect(s.weightedCredit).toBeCloseTo(0.7165, 3)
    expect(s.coverageRate).toBeCloseTo(0.6514, 3)
  })
})
