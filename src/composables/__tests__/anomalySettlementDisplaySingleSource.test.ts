/**
 * CC-428 锁：「异常结算角色占比」卡的份额 / 次数与伤害侧结算同源（`buildAnomalySettlementEntries`）。
 * 修前 ResourceUtilizationPage#settlementRows 按 `row.weight` 自算 `round(share × total)`：
 * 用户覆盖（setAnomalySettlementShare）后输入框显示新值、旁边的「N/M 次 · x%」却不动，且不归一、无余数补正。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { setupHarness } from '@/test/harness'
import { type AnomalyVirtualPanelRow, buildAnomalySettlementEntries, type AnomalyVirtualPanelBuild } from '@/composables/resourceCalc/anomalyPanels'

function row(slot: number, weight: number, eligible = true): AnomalyVirtualPanelRow {
  return {
    slot, name: `槽${slot + 1}`, buildup: weight * 1000, weight, settlementEligible: eligible,
    atk: 0, anomalyProficiency: 0, dmgBonus: 0, anomalyDmgBonus: 0, anomalyCritRate: 0, anomalyCritDmg: 0,
    assaultCritRate: 0, assaultCritDmg: 0, enemyAssaultDefReduction: 0, enemyAnomalyDefReduction: 0,
    enemyDefFlatReduction: 0, enemyResReduction: 0, elementResReduction: 0, penRatio: 0, penFlat: 0, refringe: 0,
  }
}

describe('CC-428 异常结算份额展示单源', () => {
  it('keepZero 保留 0 次行；用户覆盖后份额归一、次数补余、总数守恒', async () => {
    const { config, catalog } = await setupHarness([{ agentId: '1211' }, { agentId: '1181' }, { agentId: '1031' }])
    const rows = [row(0, 0.7), row(1, 0.3), row(2, 0, false)]
    const build = { element: 'electric', totalBuildUp: 1000, rows, virtual: rows[0], panel: {} } as unknown as AnomalyVirtualPanelBuild
    const base = buildAnomalySettlementEntries(build, [], 10, config, catalog, { keepZero: true })
    expect(base.map(e => e.slot)).toEqual([0, 1])          // 异属性行不进结算
    expect(base.map(e => e.triggerCount)).toEqual([7, 3])

    config.setAnomalySettlementShare('electric', 0, 0.1)    // 用户把槽 0 压到 10%（未归一的原始输入）
    const after = buildAnomalySettlementEntries(build, [], 10, config, catalog, { keepZero: true })
    expect(after[0].share).toBeCloseTo(0.1 / 0.4, 9)       // 归一：0.1 / (0.1 + 0.3)
    expect(after.reduce((s, e) => s + e.triggerCount, 0)).toBe(10)
    const dropped = buildAnomalySettlementEntries(build, [], 1, config, catalog)
    const kept = buildAnomalySettlementEntries(build, [], 1, config, catalog, { keepZero: true })
    expect(kept.length).toBe(2)
    expect(dropped.length).toBeLessThan(kept.length)        // 不传 keepZero ⇒ 行为不变（0 次行被过滤）
  })
  it('源码锁：页面不再自算份额 / 次数', () => {
    const src = readFileSync(resolve(__dirname, '../../views/ResourceUtilizationPage.vue'), 'utf-8')
      .split('\n').filter(l => !/^\s*(\/\/|\*|\/\*|<!--)/.test(l)).join('\n')
    expect(src).toMatch(/buildAnomalySettlementEntries\(/)
    expect(src).not.toMatch(/Math\.round\(share \* totalTriggers\)/)
    expect(src).not.toMatch(/isSingle \? 1 : row\.weight/)
  })
})
