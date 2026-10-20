/**
 * 喧响贡献账判据（2026-10-20）。
 *
 * 核心不变式：**账本各来源之和 == 引擎 total**。
 * 若某个 `DecibelSource` 字段没登记进 `FIELD_TO_KIND`，差额 `uncovered` 就会非零 ——
 * 这就是「漏源」的机器判据（属性账那次漏了音擎高级词条，正是靠同一类判据抓到的）。
 */
import { describe, expect, it } from 'vitest'
import { buildDecibelLedger, DECIBEL_DERIVED_FIELDS } from '@/core/decibelLedger'
import type { DecibelSource } from '@/types/resource'

function mkSource(overrides: Partial<DecibelSource> = {}): DecibelSource {
  const base: DecibelSource = {
    initialGift: 0,
    skillRegen: 0,
    bonusRegen: 0,
    timeSliceDecibel: 0,
    specialActionBonus: 0,
    stunTriggerBonus: 0,
    anomalyBonus: 0,
    teammateShare: 0,
    unshareableBonus: 0,
    selfBurnDecibel: 0,
    shareableTotal: 0,
    total: 0,
    ...overrides,
  }
  return base
}

describe('喧响账：来源分解', () => {
  it('各来源之和 == total（无未覆盖字段）', () => {
    const s = mkSource({
      initialGift: 1000,
      skillRegen: 4800,
      bonusRegen: 300,
      specialActionBonus: 215,
      teammateShare: 900,
      unshareableBonus: 200,
      total: 7415,
    })
    const r = buildDecibelLedger(s)
    expect(r.sum).toBe(7415)
    expect(r.engineTotal).toBe(7415)
    expect(r.uncovered).toBe(0)
  })

  it('可分享/不可分享分列：开局赠送与不可分享项归右侧', () => {
    const s = mkSource({
      initialGift: 1000,
      skillRegen: 500,
      unshareableBonus: 200,
      total: 1700,
    })
    const r = buildDecibelLedger(s)
    expect(r.table.totals.get('可分享')).toBe(500)
    expect(r.table.totals.get('不可分享')).toBe(1200)
  })

  it('反空洞：空来源 = 空账本（不得编造行）', () => {
    const r = buildDecibelLedger(mkSource())
    expect(r.table.rows.length).toBe(0)
    expect(r.sum).toBe(0)
    expect(r.uncovered).toBe(0)
  })

  it('未登记字段会让 uncovered 非零（漏源可被机器发现）', () => {
    // 构造一个「引擎 total 比已知来源之和更大」的场景：模拟新增了字段但没登记
    const s = mkSource({ skillRegen: 100, total: 250 })
    const r = buildDecibelLedger(s)
    expect(r.uncovered).toBe(150)
  })

  it('派生字段不参与求和（shareableTotal/total 是结果不是来源）', () => {
    expect(DECIBEL_DERIVED_FIELDS.has('shareableTotal')).toBe(true)
    expect(DECIBEL_DERIVED_FIELDS.has('total')).toBe(true)
    expect(DECIBEL_DERIVED_FIELDS.has('skillRegen')).toBe(false)
  })
})
