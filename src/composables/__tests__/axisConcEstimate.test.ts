/**
 * R14 / T139：无轴易伤集中度估算（`conc_est(N)` + 用户系数 k + 总开关）的判据。
 *
 * 判据来源 = `docs/REQUIREMENTS.md` R14 段「硬约束 5 条」+ `docs/axis-vuln-uplift-reference.md` §12.4。
 * 本文件分两段：
 *
 * - **A. 纯函数**（`estimateConcentration` / `applyConcEstimate`）：靶子 = 手动轴实测 `conc` 的逐档中位
 *   （§10.2 表），报逐档误差；**反空洞**：N=1 与 N=8 的估算值必须不同（防退化成常数）。
 * - **B. 引擎接线**（规则 12 的滑块判据）：改 φ（易伤贡献率）⇒ 覆盖率与伤害跟着变；
 *   φ = 100%（缺省）⇒ **逐位回到旧口径**。
 *
 * ## ⚠ 2026-10-19 用户裁决：**引擎侧不再自动认领非轴易伤**
 *
 * > 「轴模式下已经认定了易伤认领啊，非轴模式下想自动认领也不能仅仅靠连携和大招，
 * >  还有其他很多招式啊，所以非轴就只能不做，让用户自己填易伤贡献率。」
 *
 * ⇒ A 段（conc_est 纯函数）**保留为参考算法**的判据（函数还在、误差表还成立），
 * 但**不再有生产消费者**；B 段已改判 φ。若有人把 conc_est 接回引擎，B 段会红。
 *
 * ⚠ 本仓坑 47：**不钉「估算一定 ≥ 均匀摊」**——用户打得不集中时 `conc < 1` 是合法的。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
// 生产口径符号（引擎仍在用）：易伤贡献率 φ 的设置键
import {
  DEFAULT_NO_AXIS_VULN_SHARE,
  NO_AXIS_VULN_SHARE_SETTING,
} from '@/composables/resourceCalc/concEstimate'
/**
 * ⚠ **2026-10-19：conc_est 参考算法已搬进 `src/test/`**（引擎撤下自动认领后零生产消费者，
 * `deadChannelLs` 判据 ⑫ 会报「只被测试引用 = 生产死代码」）。本文件是它唯一的消费者，
 * 实现与回归测试同处；将来若要恢复自动估算（需用户重新裁决），从这里搬回 `resourceCalc/`。
 */
import { applyConcEstimate, damagePerMultiplierBySlot, estimateConcentration, noAxisConcNoticeOf } from '@/test/concEstimateReference'
import type { DamagePoolRow } from '@/composables/resourceCalc/helpers'

// ============ A. 纯函数 ============

/** 造一组「伤害权重」：n 个同权重行 + 主槽占 mainShare */
function weightsOf(n: number, mainShare: number): { slot: number; weight: number }[] {
  const out: { slot: number; weight: number }[] = []
  const main = mainShare
  const rest = (1 - main) / Math.max(1, n - 1)
  out.push({ slot: 0, weight: main })
  for (let i = 1; i < n; i++) out.push({ slot: 1 + (i % 2), weight: rest })
  return out
}

describe('A. conc_est 纯函数', () => {
  it('★ 反空洞：N=1 与 N=8 的估算值**必须不同**（不许退化成常数）', () => {
    // N 通过时间覆盖率进入：N=1 时窗口总长占有效时长 ≈ 1 窗；N=8 时 ≈ 8 窗（实测 tc 中位 0.10 → 0.82）
    const atN1 = estimateConcentration({ timeCoverage: 0.1026, weights: weightsOf(8, 0.45) })
    const atN8 = estimateConcentration({ timeCoverage: 0.8205, weights: weightsOf(8, 0.45) })
    expect(atN1.conc).not.toBeCloseTo(atN8.conc, 3)
    // 实测方向：失衡次数越多，集中度越接近均匀摊（§10.2：N=1 时 2.8×、N=8 时 1.0×）
    expect(atN1.conc).toBeGreaterThan(atN8.conc)
    // 量级：两者相差 ≥ 2×（实测 2.6×）——不是「差一点点」的伪 N 依赖
    expect(atN1.conc / atN8.conc).toBeGreaterThan(2)
  })

  it('★ 逐档误差：以手动轴 §10.2 实测 conc 为靶子，逐档中位 ≤10%（R14 硬约束 4）', () => {
    // 靶子 = §10.2 手动轴（A 臂）逐档中位 concPure（35 队 × 4 Boss 期 × 7 档 = 980 格，见 .zc/perf/T139rows.json）
    const TARGET: Record<number, number> = {
      1: 2.6729, 2: 2.3781, 3: 2.0908, 4: 1.8158, 5: 1.4235, 6: 1.2429, 8: 1.0032,
    }
    // 逐档代表格：tc 取该档实测中位（0.1026 / 0.2051 / 0.3077 / 0.4103 / 0.5128 / 0.6154 / 0.8205）
    const TC: Record<number, number> = {
      1: 0.1026, 2: 0.2051, 3: 0.3077, 4: 0.4103, 5: 0.5128, 6: 0.6154, 8: 0.8205,
    }
    const rows: { n: number; est: number; tgt: number; err: number }[] = []
    for (const n of [1, 2, 3, 4, 5, 6, 8]) {
      const est = estimateConcentration({ timeCoverage: TC[n], weights: weightsOf(10, 0.45) }).conc
      rows.push({ n, est, tgt: TARGET[n], err: Math.abs(est - TARGET[n]) / TARGET[n] })
    }
    // 代表格逐档中位误差 ≤10%（普查实测逐格中位 9.4%、逐档中位 8.8%，见模块头注释）
    const sorted = rows.map(r => r.err).sort((a, b) => a - b)
    const median = sorted[Math.floor(sorted.length / 2)]
    expect(median).toBeLessThan(0.10)
    // 逐档方向单调：N ↑ ⇒ conc ↓（不许出现「N=8 比 N=1 更集中」的反向档）
    for (let i = 1; i < rows.length; i++) expect(rows[i].est).toBeLessThan(rows[i - 1].est)
  })

  it('输入退化 ⇒ conc = 1（= 均匀摊，与旧口径一致），且不产生 NaN', () => {
    expect(estimateConcentration({ timeCoverage: 0.3, weights: [] }).conc).toBe(1)
    expect(estimateConcentration({ timeCoverage: 0.3, weights: [{ slot: 0, weight: 0 }] }).conc).toBe(1)
    // NaN 覆盖率按 0 处理（= 没有失衡窗 ⇒ 时间覆盖率 0），此时 conc 是「N=∞ 档」的外推值：
    // 只要**有限**且 > 0 即可（不是 NaN/Infinity）；「NaN 覆盖率 ⇒ conc=1」不是本模块的语义
    const nanTc = estimateConcentration({ timeCoverage: Number.NaN, weights: weightsOf(4, 0.5) }).conc
    expect(Number.isFinite(nanTc)).toBe(true)
    expect(nanTc).toBeGreaterThan(0)
    const d = applyConcEstimate({ timeCoverage: 0.3, weights: [] }, { enabled: true, k: 1 })
    expect(d.effectiveCoverage).toBeCloseTo(0.3, 12)
  })

  it('★ 开关关掉 ⇒ effectiveCoverage 与传入的 timeCoverage **逐位相同**（===）', () => {
    for (const tc of [0, 0.08888888888888889, 0.17777777777777778, 0.3, 1]) {
      for (const k of [0, 0.5, 1, 2.5]) {
        const d = applyConcEstimate({ timeCoverage: tc, weights: weightsOf(9, 0.4) }, { enabled: false, k })
        // toBe（===）而不是 toBeCloseTo：这是 R14 的硬判据
        expect(d.effectiveCoverage).toBe(tc)
        expect(d.applied).toBe(false)
        expect(d.conc).toBe(1)
      }
    }
  })

  it('★ k 线性生效（滑块判据）：k 翻倍 ⇒ 覆盖率翻倍（未触顶时）', () => {
    const input = { timeCoverage: 0.1, weights: weightsOf(10, 0.45) }
    const base = applyConcEstimate(input, { enabled: true, k: 1 })
    const twice = applyConcEstimate(input, { enabled: true, k: 2 })
    // 未触顶 ⇒ 严格 2×（k 是纯乘数）
    expect(twice.effectiveCoverage).toBeCloseTo(base.effectiveCoverage * 2, 12)
    // k=0 ⇒ 0（与「关掉」区分：关掉是回旧口径，k=0 是估算乘 0）
    expect(applyConcEstimate(input, { enabled: true, k: 0 }).effectiveCoverage).toBe(0)
    // 触顶仍钳在 1
    expect(applyConcEstimate(input, { enabled: true, k: 100 }).effectiveCoverage).toBe(1)
  })


  it('★ 来源可见：标注只在「非轴 + 开关开 + 有时间覆盖率」时出现，且文案不含「集中度」', () => {
    const weights = weightsOf(8, 0.45)
    // 三条判据逐条关掉 ⇒ null
    expect(noAxisConcNoticeOf({ isAxis: true, enabled: true, k: 1, timeCoverage: 0.3, weights })).toBeNull()
    expect(noAxisConcNoticeOf({ isAxis: false, enabled: false, k: 1, timeCoverage: 0.3, weights })).toBeNull()
    expect(noAxisConcNoticeOf({ isAxis: false, enabled: true, k: 1, timeCoverage: 0, weights })).toBeNull()
    // 三条都满足 ⇒ 有文案，且**用游戏场景措辞**（§12.4 明确「别用『集中度』这种词」）
    const text = noAxisConcNoticeOf({ isAxis: false, enabled: true, k: 1, timeCoverage: 0.3, weights })
    expect(text).toBeTruthy()
    expect(text).toContain('大技能留给失衡')
    expect(text).not.toContain('集中度')
    // 标注里的数字与引擎同一实现（不是页面自己算的第二套）
    const d = applyConcEstimate({ timeCoverage: 0.3, weights }, { enabled: true, k: 1 })
    expect(text).toContain(`${(d.effectiveCoverage * 100).toFixed(1)}%`)
  })
  it('damagePerMultiplierBySlot：按槽折算「每点倍率的伤害」，无倍率槽跳过', () => {
    const rows = [
      { slot: 0, totalDamage: 1000, count: 2, multiplier: 100 }, // 5 / 点
      { slot: 0, totalDamage: 500, count: 1, multiplier: 100 },  // +5 / 点 ⇒ 槽0 = 7.5 / 点
      { slot: 1, totalDamage: 900, count: 3, multiplier: 100 },  // 3 / 点
      { slot: 2, totalDamage: 800, count: 4, multiplier: 0 },    // 无倍率 ⇒ 跳过
    ] as Pick<DamagePoolRow, 'slot' | 'totalDamage' | 'count' | 'multiplier'>[]
    const m = damagePerMultiplierBySlot(rows)
    expect(m.get(0)).toBeCloseTo(5, 12)
    expect(m.get(1)).toBeCloseTo(3, 12)
    expect(m.has(2)).toBe(false)
  })
})

// ============ B. 引擎接线 ============

type Calc = ReturnType<typeof useResourceCalc>

/** 逐行快照：id + 9 位总伤 + 行级覆盖率（判「逐位相同」用，不用 toBeCloseTo） */
function rowSnapshot(calc: Calc): string[] {
  return (calc.damagePoolRows.value ?? []).map(r =>
    `${r.id}|${r.totalDamage.toFixed(9)}|${(r.stunCoverage ?? 0).toFixed(12)}`)
}

function directCoverage(calc: Calc): number {
  const direct = (calc.damagePoolRows.value ?? []).filter(r => r.type === '直伤')
  const dmg = direct.reduce((a, r) => a + r.totalDamage, 0)
  return dmg > 0 ? direct.reduce((a, r) => a + r.totalDamage * (r.stunCoverage ?? 0), 0) / dmg : 0
}

describe('B. 引擎接线（易伤贡献率 φ）', () => {
  it('★ φ = 100%（缺省）⇒ 与旧口径**逐位相同**（行级 totalDamage 与 stunCoverage 逐行 ===）', async () => {
    // 槽位 1 = 莱卡恩（1141）给全队挂失衡易伤 +35%：让易伤通道真的咬合
    const { config } = await setupHarness([{ agentId: '1011' }, { agentId: '1141' }, { agentId: '1031' }], { recommendedBuild: true })
    const calc = useResourceCalc()
    config.useStunAxis = false

    // ① 缺省（不碰滑块）= 旧口径「每招均匀摊」
    const off = rowSnapshot(calc)
    const offCoverage = directCoverage(calc)
    const offTotal = calc.teamTotalDamage.value
    expect(config.getMechanicSetting(NO_AXIS_VULN_SHARE_SETTING, DEFAULT_NO_AXIS_VULN_SHARE)).toBe(1)

    // ② 填 50%：非轴覆盖率整体打对折
    config.setMechanicSetting(NO_AXIS_VULN_SHARE_SETTING, 0.5)
    const half = rowSnapshot(calc)
    expect(directCoverage(calc)).toBeCloseTo(offCoverage * 0.5, 9)
    expect(calc.teamTotalDamage.value).toBeLessThan(offTotal)

    // ③ 再填回 100%：必须逐位回到 ①（不是「接近」，是 ===）
    config.setMechanicSetting(NO_AXIS_VULN_SHARE_SETTING, 1)
    expect(rowSnapshot(calc)).toEqual(off)
    expect(directCoverage(calc)).toBe(offCoverage)
    expect(calc.teamTotalDamage.value).toBe(offTotal)
    expect(half).not.toEqual(off)
  }, 600000)

  it('★ 滑块生效：改 φ ⇒ 覆盖率与伤害跟着变，且单调（规则 12 的滑块判据）', async () => {
    const { config } = await setupHarness([{ agentId: '1011' }, { agentId: '1141' }, { agentId: '1031' }], { recommendedBuild: true })
    const calc = useResourceCalc()
    config.useStunAxis = false

    const read = (share: number) => {
      config.setMechanicSetting(NO_AXIS_VULN_SHARE_SETTING, share)
      return { cov: directCoverage(calc), total: calc.teamTotalDamage.value }
    }
    const s0 = read(0)
    const s5 = read(0.5)
    const s10 = read(1)

    // φ = 0 ⇒ 非轴完全不吃失衡易伤（覆盖率 0）
    expect(s0.cov).toBeCloseTo(0, 9)
    // 单调递增
    expect(s5.cov).toBeGreaterThan(s0.cov)
    expect(s10.cov).toBeGreaterThan(s5.cov)
    // 伤害也跟着变（不是只改了展示量）
    expect(s5.total).toBeGreaterThan(s0.total)
    expect(s10.total).toBeGreaterThan(s5.total)
  }, 600000)

  it('★ 轴模式不受影响：覆盖率仍是 1/0 两档，不乘 φ（R14 硬约束 1）', async () => {
    const { config } = await setupHarness([{ agentId: '1011' }, { agentId: '1141' }, { agentId: '1031' }], { recommendedBuild: true })
    const calc = useResourceCalc()
    // 一条只放平A的 fixed 轴 ⇒ 引擎判定轴模式成立，直伤行按轴内/轴外拆
    config.setAxisState({
      stunAxes: [{ name: '判据轴', kind: 'fixed', count: 1, basicFillerSlot: 0, actions: [{ slot: 0, moveId: 'basic_attack', count: 1 }] }],
      stunAxisPlans: [],
      useStunAxis: true,
    })
    config.setMechanicSetting(NO_AXIS_VULN_SHARE_SETTING, 1)
    const off = rowSnapshot(calc)
    config.setMechanicSetting(NO_AXIS_VULN_SHARE_SETTING, 0.3)
    const on = rowSnapshot(calc)
    // 轴模式：易伤贡献率滑块对结果**逐位无影响**
    expect(on).toEqual(off)
    // 且行级覆盖率仍只有 0 / 1 两档（轴内吃满 / 轴外不吃；未进轴槽位回落全局覆盖率的行不计）
    const axisSlots = new Set((calc.damagePoolRows.value ?? []).filter(r => r.type === '直伤').map(r => r.slot))
    expect(axisSlots.size).toBeGreaterThan(0)
    const covs = new Set((calc.damagePoolRows.value ?? [])
      .filter(r => r.type === '直伤' && r.stunCoverage !== undefined)
      .map(r => (r.stunCoverage as number).toFixed(6)))
    // 允许 0 / 1 / 未进轴槽位的全局覆盖率（单值）三种取值，但**不许**出现 conc_est 那种连续中间值
    const numeric = [...covs].map(Number).filter(v => v > 0 && v < 1)
    expect(numeric.length).toBeLessThanOrEqual(1)
  }, 600000)
})
