/**
 * CC-69：① roundInputs 伊德海莉单次碾 1 命能耗 → combo.energyCostAtCinema；② damagePoolAnomaly 风蚀气旋异放子串 → core 单一事实源。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getRegisteredAgentMechanics } from '@/mechanics'
import { CORROSION_CYCLONE_RELEASE_ID_PREFIX, isCorrosionCycloneRelease } from '@/core/anomalyPool/helpers'

describe('CC-69 combo 影画能耗覆盖 / 风蚀气旋事件标记', () => {
  it('全模块 combos × 影画 0..6：新表达式 == 原写死（单次碾 1 命 50）', () => {
    let n = 0, overridden = 0
    for (const mod of getRegisteredAgentMechanics()) {
      for (const [moveId, combo] of Object.entries(mod.combos ?? {})) {
        for (let cinema = 0; cinema <= 6; cinema++) {
          const legacy = moveId === 'yidhari-heavy-single' && cinema >= 1 ? 50 : combo.energyCost
          const got = combo.energyCostAtCinema && cinema >= combo.energyCostAtCinema.minCinema ? combo.energyCostAtCinema.energyCost : combo.energyCost
          expect(got, `${mod.id}/${moveId}/${cinema}`).toBe(legacy)
          if (got !== combo.energyCost) overridden++
          n++
        }
      }
    }
    expect(n).toBeGreaterThan(7)
    expect(overridden).toBe(6)
  })

  it('风蚀气旋事件判定 == 原子串写死', () => {
    expect(CORROSION_CYCLONE_RELEASE_ID_PREFIX).toBe('velina-corrosion')
    const cases = [
      { type: 'release', id: 'velina-corrosion-condensed-cyclone' },
      { type: 'release', id: 'velina-corrosion-broad-cyclone' },
      { type: 'release', id: 'other-release' },
      { type: 'dot', id: 'velina-corrosion-broad-cyclone' },
    ]
    for (const e of cases) expect(isCorrosionCycloneRelease(e), e.id + e.type).toBe(e.type === 'release' && e.id.includes('velina-corrosion'))
  })

  it('源码锁', () => {
    const ri = readFileSync(resolve(__dirname, '../resourceCalc/roundInputs.ts'), 'utf-8')
    expect(ri).not.toContain("'yidhari-heavy-single'")
    const dpa = readFileSync(resolve(__dirname, '../resourceCalc/damagePoolAnomaly.ts'), 'utf-8')
    expect(dpa).not.toContain('velina-corrosion')
    expect(dpa).toContain('isCorrosionCycloneRelease(event)')
  })
})
