/**
 * \`core/stunVulnRow\` 纯函数判据（2026-10-28）。
 *
 * 存在理由：行级失衡易伤派生原先只活在展示层（\`composables/stunVulnSummary\`），
 * 现在建池侧（给每行盖章 \`stunAppliedMult\` / \`stunAlwaysMult\`）与「属性区有/无失衡」拆分也要用
 * ⇒ 抽成 core 单一事实源（规则 11）。这里锁两件事：
 *  ① 「加权有效易伤」用的 \`rowStunCoverage\` 口径**逐位不变**（异常行仍 undefined ⇒ 按 1 计）；
 *  ② 拆分用的 \`stunRowWindowCoverageOf\` / \`stunRowWindowAppliedMultOf\` 认窗内占比、**含异常行**；
 *  ③ 反事实比值 = always/applied 在覆盖率 0 时为 1、在满覆盖时 < 1，且**扳机的常驻易伤不被抹掉**。
 */
import { describe, expect, it } from 'vitest'
import { calcStunMultiplier } from '@/core/anomalyPool/helpers'
import {
  coverageFromStunMult, rowAppliedStunMultOf, rowFullStunMultOf, rowStunCoverage,
  stunAlwaysMultOf, stunPanelBonusOf, stunRowWindowAppliedMultOf, stunRowWindowCoverageOf,
} from '@/core/stunVulnRow'

/** 雨果队典型：Boss 失衡易伤 1.5 + 面板失衡增伤 60（无 Always 通道） */
const HUGO = { vuln: 1.5, bonus: 60, always: 0, cap: 0 }
/** 扳机在队：Always 通道 35%（非失衡期也生效） */
const TRIGGER = { vuln: 1.5, bonus: 0, always: 35, cap: 0 }

describe('core/stunVulnRow：覆盖率与生效易伤', () => {
  it('反推覆盖率只在「无 stunCoverage」时生效；异常行（无 stunMult）→ undefined', () => {
    expect(coverageFromStunMult(1.5, 1.5)).toBe(1)
    expect(coverageFromStunMult(1.25, 1.5)).toBeCloseTo(0.5, 9)
    expect(rowStunCoverage({ stunMult: 1.25 }, 1.5)).toBeCloseTo(0.5, 9)
    // 引擎实值优先于反推（叶瞬光帷幕行基数 ≠ stunVuln，反推会被压低）
    expect(rowStunCoverage({ stunMult: 1.1, stunCoverage: 1, stunVulnBase: 1.1 }, 1.5)).toBe(1)
    expect(rowStunCoverage({}, 1.5)).toBeUndefined()
  })

  it('「加权有效易伤」口径不读 stunWindowCoverage：异常行仍按 1 计（既有保守口径不动）', () => {
    // 行只带窗内占比（异放/异常行建池后的形状）
    const row = { stunWindowCoverage: 1 }
    expect(rowStunCoverage(row, 1.5)).toBeUndefined()
    expect(rowAppliedStunMultOf(row, HUGO)).toBe(1)
  })

  it('拆分口径认窗内占比（含异常行）：窗内占比 1 → 满额生效易伤', () => {
    expect(stunRowWindowCoverageOf({ stunWindowCoverage: 0.6 })).toBeCloseTo(0.6, 9)
    expect(stunRowWindowCoverageOf({ stunCoverage: 0.25 })).toBeCloseTo(0.25, 9)
    expect(stunRowWindowCoverageOf({})).toBeUndefined()
    // 雨果队满覆盖 1.5+0.6 = 2.1
    expect(stunRowWindowAppliedMultOf({ stunWindowCoverage: 1 }, HUGO)).toBeCloseTo(2.1, 9)
    // 无覆盖率信息 → 覆盖率 0 ⇒ 只剩常驻易伤（无 Always 通道时 = 1）
    expect(stunRowWindowAppliedMultOf({}, HUGO)).toBe(1)
  })

  it('Always 通道：非失衡期也生效（扳机 35%），且在拆分里**不被抹掉**', () => {
    expect(stunAlwaysMultOf(TRIGGER)).toBeCloseTo(1.35, 9)
    // 满覆盖：1.5 + 0.35 = 1.85；常驻 1.35 ⇒ 比值 1.35/1.85（不是 1/1.85）
    const applied = stunRowWindowAppliedMultOf({ stunWindowCoverage: 1 }, TRIGGER)
    expect(applied).toBeCloseTo(1.85, 9)
    expect(stunAlwaysMultOf(TRIGGER) / applied).toBeCloseTo(1.35 / 1.85, 9)
    // 无失衡窗的行（覆盖率 0）：比值恒 1 —— 该行与 Boss 失衡系统无关，不该被拆分改动
    expect(stunRowWindowAppliedMultOf({ stunWindowCoverage: 0 }, TRIGGER)).toBeCloseTo(1.35, 9)
    expect(stunAlwaysMultOf(TRIGGER) / stunRowWindowAppliedMultOf({ stunWindowCoverage: 0 }, TRIGGER)).toBeCloseTo(1, 12)
  })

  it('满额 / 面板入口：与 calcStunMultiplier 同源（不造第二套算式）', () => {
    expect(rowFullStunMultOf({}, HUGO)).toBeCloseTo(calcStunMultiplier(1.5, 60, 0, 0, true), 12)
    expect(stunPanelBonusOf({ stunDmgMultiplierBonus: 60, stunDmgMultiplierBonusAlways: 35, stunDmgMultiplierBonusCapAlways: 0 }, 1.5))
      .toEqual({ vuln: 1.5, bonus: 60, always: 35, cap: 0 })
    expect(stunPanelBonusOf(undefined, 1.5)).toEqual({ vuln: 1.5, bonus: 0, always: 0, cap: 0 })
  })
})
