/**
 * R14 / T139：无轴易伤集中度估算（`conc_est(N)` + 用户系数 k + 总开关）的判据。
 *
 * 判据来源 = `docs/REQUIREMENTS.md` R14 段「硬约束 5 条」+ `docs/axis-vuln-uplift-reference.md` §12.4。
 * 本文件分两段：
 *
 * - **A. 纯函数**（`estimateConcentration` / `applyConcEstimate`）：靶子 = 手动轴实测 `conc` 的逐档中位
 *   （§10.2 表），报逐档误差；**反空洞**：N=1 与 N=8 的估算值必须不同（防退化成常数）。
 * - **B. 引擎接线**（规则 12 的滑块判据）：改 k ⇒ 覆盖率与伤害跟着变；**关开关 ⇒ 逐位回到旧值**。
 *
 * ⚠ 本仓坑 47：**不钉「估算一定 ≥ 均匀摊」**——用户打得不集中时 `conc < 1` 是合法的。
 * 这里只钉「代码行为」：开关关掉 = 旧口径、N 依赖存在、k 线性生效。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import {
  DEFAULT_NO_AXIS_CONC_K,
  noAxisConcNoticeOf,
  NO_AXIS_CONC_ENABLED_SETTING,
  NO_AXIS_CONC_K_SETTING,
} from '@/composables/resourceCalc/concEstimate'
// 纯函数核心从**最近来源**导入（门面只转出被生产多处消费的符号——判据 16 死通道扫描）
import { applyConcEstimate, damagePerMultiplierBySlot, estimateConcentration } from '@/composables/resourceCalc/concEstimate'
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

describe('B. 引擎接线（滑块 + 开关）', () => {
  it('★ 关开关 ⇒ 与旧口径**逐位相同**（行级 totalDamage 与 stunCoverage 逐行 ===）', async () => {
    // 槽位 1 = 莱卡恩（1141）给全队挂失衡易伤 +35%：让易伤通道真的咬合
    const { config } = await setupHarness([{ agentId: '1011' }, { agentId: '1141' }, { agentId: '1031' }], { recommendedBuild: true })
    const calc = useResourceCalc()
    config.useStunAxis = false

    // ① 旧口径：开关关掉（= 改动前的行为）
    config.setMechanicSetting(NO_AXIS_CONC_ENABLED_SETTING, 0)
    const off = rowSnapshot(calc)
    const offCoverage = directCoverage(calc)
    const offTotal = calc.teamTotalDamage.value

    // ② 开：估算生效（行级覆盖率被抬高）
    config.setMechanicSetting(NO_AXIS_CONC_ENABLED_SETTING, 1)
    config.setMechanicSetting(NO_AXIS_CONC_K_SETTING, DEFAULT_NO_AXIS_CONC_K)
    const on = rowSnapshot(calc)
    const onCoverage = directCoverage(calc)
    const onTotal = calc.teamTotalDamage.value

    // ③ 再关回去：必须逐位回到 ①（不是「接近」，是 ===）
    config.setMechanicSetting(NO_AXIS_CONC_ENABLED_SETTING, 0)
    const back = rowSnapshot(calc)
    expect(back).toEqual(off)
    expect(directCoverage(calc)).toBe(offCoverage)
    expect(calc.teamTotalDamage.value).toBe(offTotal)

    // 开 vs 关必须真的不同（否则「估算」是空的）
    expect(on).not.toEqual(off)
    expect(onCoverage).toBeGreaterThan(offCoverage)
    expect(onTotal).toBeGreaterThan(offTotal)
  }, 600000)

  it('★ 滑块生效：改 k ⇒ 覆盖率与伤害跟着变，且单调（规则 12 的滑块判据）', async () => {
    const { config } = await setupHarness([{ agentId: '1011' }, { agentId: '1141' }, { agentId: '1031' }], { recommendedBuild: true })
    const calc = useResourceCalc()
    config.useStunAxis = false
    config.setMechanicSetting(NO_AXIS_CONC_ENABLED_SETTING, 1)

    const read = (k: number) => {
      config.setMechanicSetting(NO_AXIS_CONC_K_SETTING, k)
      return { cov: directCoverage(calc), total: calc.teamTotalDamage.value }
    }
    const k0 = read(0)
    const k1 = read(1)
    const k2 = read(2)

    // k=0 ⇒ 估算被抵消 ⇒ 覆盖率 0（与「关掉」不同：关掉是回旧口径）
    expect(k0.cov).toBeCloseTo(0, 9)
    // 单调递增
    expect(k1.cov).toBeGreaterThan(k0.cov)
    expect(k2.cov).toBeGreaterThan(k1.cov)
    // 伤害也跟着变（不是只改了展示量）
    expect(k1.total).toBeGreaterThan(k0.total)
    expect(k2.total).toBeGreaterThan(k1.total)
  }, 600000)

  it('★ 轴模式不受影响：覆盖率仍是 1/0 两档，不乘 conc_est（R14 硬约束 1）', async () => {
    const { config } = await setupHarness([{ agentId: '1011' }, { agentId: '1141' }, { agentId: '1031' }], { recommendedBuild: true })
    const calc = useResourceCalc()
    // 一条只放平A的 fixed 轴 ⇒ 引擎判定轴模式成立，直伤行按轴内/轴外拆
    config.setAxisState({
      stunAxes: [{ name: '判据轴', kind: 'fixed', count: 1, basicFillerSlot: 0, actions: [{ slot: 0, moveId: 'basic_attack', count: 1 }] }],
      stunAxisPlans: [],
      useStunAxis: true,
    })
    config.setMechanicSetting(NO_AXIS_CONC_ENABLED_SETTING, 0)
    const off = rowSnapshot(calc)
    config.setMechanicSetting(NO_AXIS_CONC_ENABLED_SETTING, 1)
    config.setMechanicSetting(NO_AXIS_CONC_K_SETTING, 2)
    const on = rowSnapshot(calc)
    // 轴模式：估算开关对结果**逐位无影响**
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
