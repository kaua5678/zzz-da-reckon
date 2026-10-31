/**
 * 「有/无失衡属性区 + 失衡期贡献率 + 失衡爆发效率」的**引擎接线判据**（用户口径 2026-10-28）。
 *
 * 单测（\`damageSourceBreakdown.test.ts\`）锁的是纯函数口径；本文件锁**建池侧真的把三个字段盖上了**，
 * 且口径三件事成立：
 *  ① 每行都有 \`stunWindowCoverage\` 与 \`stunAppliedMult\`（异常/异放行**也有**——它们内部同样吃易伤）；
 *  ② 轴模式下 \`stunWindowCoverage\` 是 0/1 两档（轴内吃满 / 轴外不吃），非轴模式 = 全局覆盖率；
 *  ③ **扳机（1361）的 Always 通道（非失衡期 +35%）不被抹掉**：无失衡属性区 > 「按 1 反算」的那个值，
 *     且该队的失衡期贡献率**严格小于**「把常驻易伤也一起抹掉」时会得到的值。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { stunAlwaysMultOf, stunPanelBonusOf } from '@/core/stunVulnRow'

/**
 * 扳机队（1361 在槽 1）：面板带 Always 通道 35% ⇒ 非轴/轴下都能验「常驻易伤保留」。
 * ⚠ `setupHarness` 只回 `{ catalog, config }`，`useResourceCalc()` 由用例自己起（与其它用例同款）。
 */
async function setupTriggerTeam() {
  const { catalog, config } = await setupHarness([
    { agentId: '1011', cinemaLevel: 0 },
    { agentId: '1361', cinemaLevel: 0 },
    { agentId: '1031', cinemaLevel: 0 },
  ])
  return { catalog, config, calc: useResourceCalc() }
}

describe('建池盖章：行级失衡易伤（属性区有/无失衡的输入）', () => {
  it('每一行都带 stunWindowCoverage 与 stunAppliedMult（含异常/异放行）', async () => {
    await setupHarness([{ agentId: '1011' }, { agentId: '1361' }, { agentId: '1031' }])
    const calc = useResourceCalc()
    const rows = calc.damagePoolRows.value
    expect(rows.length).toBeGreaterThan(0)
    const missingCov = rows.filter(r => r.stunWindowCoverage === undefined)
    const missingApplied = rows.filter(r => r.stunAppliedMult === undefined)
    expect(missingCov.map(r => r.id)).toEqual([])
    expect(missingApplied.map(r => r.id)).toEqual([])
    // 覆盖率是 0..1 的占比
    for (const r of rows) {
      expect(r.stunWindowCoverage!).toBeGreaterThanOrEqual(0)
      expect(r.stunWindowCoverage!).toBeLessThanOrEqual(1)
      expect(r.stunAppliedMult!).toBeGreaterThanOrEqual(1)
    }
    // 异常族（非直伤）行也在册：它们内部同样吃了失衡易伤，漏掉会把爆发效率系统性压低
    const anomalyRows = rows.filter(r => r.type !== '直伤')
    expect(anomalyRows.length).toBeGreaterThan(0)
    expect(anomalyRows.every(r => typeof r.stunWindowCoverage === 'number')).toBe(true)
  }, 600000)

  it('直伤行的窗内占比与引擎实值逐位一致；轴模式只有 0/1（外加「未进轴回落」的单值）', async () => {
    const { config } = await setupHarness(
      [{ agentId: '1011' }, { agentId: '1141' }, { agentId: '1031' }],
      { recommendedBuild: true },
    )
    // 三槽各放 1 秒平A 的 fixed 轴 ⇒ 引擎判定轴模式成立、且**每槽都有轴内动作**
    // （只放 slot 0 时其余槽会回落全局覆盖率，那档取值会让「0/1 两档」这条判据空转，实测 2026-10-28）
    config.setAxisState({
      stunAxes: [{ name: '盖章判据轴', kind: 'fixed', count: 1, actions: [0, 1, 2].map(slot => ({ slot, moveId: 'basic', count: 1 })) }],
      stunAxisPlans: [],
      useStunAxis: true,
    })
    const calc = useResourceCalc()
    const rows = calc.damagePoolRows.value
    const direct = rows.filter(r => r.type === '直伤')
    expect(direct.length).toBeGreaterThan(0)
    // ★ 盖章不得改写引擎实值：直伤行的 stunWindowCoverage 必须逐位等于 stunCoverage
    for (const r of direct) expect(r.stunWindowCoverage).toBe(r.stunCoverage)
    // 覆盖率取值只许 0（轴外）/ 1（轴内）/ 未进轴槽位的全局覆盖率（单值），**不许**连续中间值
    // （与 axisConcEstimate.test.ts 同款判据口径）
    const covs = [...new Set(direct.map(r => r.stunWindowCoverage as number))]
    for (const c of covs) expect(c === 0 || c === 1 || c === calc.stunCoverage.value).toBe(true)
    const middle = covs.filter(v => v > 0 && v < 1)
    expect(middle.length).toBeLessThanOrEqual(1)
    // 至少有一行在窗内、一行在窗外（否则这条判据空转）
    expect(covs.includes(1)).toBe(true)
    expect(covs.includes(0)).toBe(true)
  }, 600000)

  it('★ 扳机队的常驻易伤不被抹：无失衡属性区严格高于「按 1 反算」', async () => {
    const { calc } = await setupTriggerTeam()
    const rows = calc.damagePoolRows.value
    const totals = calc.damageSourceTotals.value
    const vuln = 1.5
    // 该队面板确实有 Always 通道（扳机 1361 的核心被动 +35%）
    const always = stunAlwaysMultOf(stunPanelBonusOf(undefined, vuln)) // 缺面板 ⇒ 只算兜底
    expect(always).toBeGreaterThanOrEqual(1)
    const anyAlwaysRow = rows.some(r => (r.stunAlwaysMult ?? 1) > 1 + 1e-9)
    expect(anyAlwaysRow).toBe(true)
    // 无失衡属性区 > 0 且 < 有失衡属性区（只抹窗，不抹常驻）
    expect(totals.attrRegionNoStun).toBeGreaterThan(0)
    expect(totals.attrRegionNoStun).toBeLessThan(totals.attrRegion)
    expect(totals.stunContributionRate).toBeGreaterThan(0)
    expect(totals.stunContributionRate).toBeLessThan(1)
    // 若错误地把 Always 通道也一并抹掉（分子按 applied 全额缩回），贡献率会**更高** ⇒ 用严格不等式钉住
    const naiveNoStun = rows.reduce((s, r) => s + (r.totalDamage * (r.stunWindowCoverage === 0 ? 1 : 1 / (r.stunAppliedMult || 1))), 0)
    const naiveRate = 1 - naiveNoStun / totals.damage
    expect(totals.stunContributionRate).toBeLessThan(naiveRate)
    // 爆发效率：伤害加权的窗内占比，必须落在 [0,1]
    expect(totals.burstEfficiency).toBeGreaterThanOrEqual(0)
    expect(totals.burstEfficiency).toBeLessThanOrEqual(1)
  }, 600000)
})
