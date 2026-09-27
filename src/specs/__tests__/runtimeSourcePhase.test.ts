/**
 * R6 C7 §2.5-①（第 143 轮）：`applySpecAttributeConversions` 的可选 `sources.outOfCombat`。
 * - opt-in：调用方不传 sources 时，行为与迁移前完全一致（只读传入面板，`sourcePanelPhase` 仅作文档）。
 * - 传了 sources.outOfCombat 时，只有声明 `sourcePanelPhase: 'outOfCombat'` 的条目改读局外面板；inCombat 条目仍读传入面板。
 * - sourceValue（回能类特殊来源）不受 sources 影响。
 */
import { describe, expect, it } from 'vitest'
import { emptyPanel } from '@/core/panel'
import { applySpecAttributeConversions } from '@/specs/runtime'
import type { AttributeConversionSpec } from '@/specs/types'

const conv = (over: Partial<AttributeConversionSpec>): AttributeConversionSpec => ({
  id: 'x', name: 'x', sourceStat: 'anomalyMastery', sourcePanelPhase: 'outOfCombat',
  threshold: 100, stepSize: 1, targetStat: 'anomalyProficiency', valuePerStep: 2, cap: null,
  status: 'implemented', note: '', ...over,
})

function panels() {
  const inCombat = emptyPanel()
  inCombat.anomalyMastery = 150
  const outOfCombat = emptyPanel()
  outOfCombat.anomalyMastery = 120
  return { inCombat, outOfCombat }
}

describe('spec runtime：sourcePanelPhase 按调用方提供的局外面板取源（opt-in）', () => {
  it('不传 sources：outOfCombat 条目仍读传入面板（与迁移前一致）', () => {
    const { inCombat } = panels()
    applySpecAttributeConversions(inCombat, [conv({})])
    expect(inCombat.anomalyProficiency).toBe(100) // (150-100)×2
  })

  it('传 sources.outOfCombat：outOfCombat 条目读局外面板', () => {
    const { inCombat, outOfCombat } = panels()
    applySpecAttributeConversions(inCombat, [conv({})], 1, { outOfCombat })
    expect(inCombat.anomalyProficiency).toBe(40) // (120-100)×2
    expect(outOfCombat.anomalyProficiency).toBe(0) // 局外面板只读不写
  })

  it('传 sources.outOfCombat：inCombat 条目仍读传入面板', () => {
    const { inCombat, outOfCombat } = panels()
    applySpecAttributeConversions(inCombat, [conv({ sourcePanelPhase: 'inCombat' })], 1, { outOfCombat })
    expect(inCombat.anomalyProficiency).toBe(100)
  })

  it('sourceValue 特殊来源不受 sources 影响', () => {
    const { inCombat, outOfCombat } = panels()
    inCombat.energyRegen = 3
    outOfCombat.energyRegen = 1
    const c = conv({ sourceValue: 'energyRegenTotal', sourceStat: 'energyRegen', threshold: 2, targetStat: 'dmgBonus', valuePerStep: 10 })
    applySpecAttributeConversions(inCombat, [c], 1, { outOfCombat })
    expect(inCombat.dmgBonus).toBe(10) // 读的是传入面板的 energyRegen 3
  })
})
