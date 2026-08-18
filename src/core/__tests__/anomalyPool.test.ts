import { describe, expect, it } from 'vitest'
import { calcAnomalyPool, type AnomalyPoolInput } from '@/core/anomalyPool'
import { velinaMechanic } from '@/mechanics/agents/velina'
import { calcCoverage, getAnomalyDuration } from '@/core/anomalyPool/helpers'

describe('calcCoverage', () => {
  it('adds per-element team duration bonuses into anomaly duration', () => {
    const panel = {
      physicalAnomalyDurationBonusSeconds: 5,
      fireAnomalyDurationBonusSeconds: 3,
      electricAnomalyDurationBonusSeconds: 3,
      etherAnomalyDurationBonusSeconds: 3,
    }
    expect(getAnomalyDuration(panel as any, 'physical')).toBe(15)
    expect(getAnomalyDuration(panel as any, 'fire')).toBe(13)
    expect(getAnomalyDuration(panel as any, 'ice')).toBe(10)
  })

  it('computes frost coverage from ice and frostfire state time', () => {
    const res = calcCoverage(
      { ice: 1, frostfire: 1 },
      100,
      0,
      { ice: 10, frostfire: 20 },
    )
    expect(res.frostCoverageRate).toBeCloseTo(0.3, 6)
  })

  it('scales flinch and frost coverage by the non-wind time window', () => {
    const res = calcCoverage(
      { physical: 1, ice: 1, wind: 1 },
      100,
      0,
      { physical: 10, ice: 10, wind: 30 },
      true,
    )
    // wind occupies 30s/100s, so non-wind effects keep 70% of their time
    expect(res.windCoverageRate).toBeCloseTo(0.3, 6)
    expect(res.physicalCoverageRate).toBeCloseTo(0.0651, 4)
    expect(res.frostCoverageRate).toBeCloseTo(0.07, 4)
  })
})

describe('calcAnomalyPool', () => {
  it('splits non-wind anomalies into disorder window and turbulence window', () => {
    const res = calcAnomalyPool({
      executions: [
        { moveId: 'wind_basic', moveName: 'wind', slot: 0, count: 1, baseBuildUp: 2000, element: 'wind' },
        { moveId: 'fire_basic', moveName: 'fire', slot: 1, count: 10, baseBuildUp: 3000, element: 'fire' },
        { moveId: 'electric_basic', moveName: 'electric', slot: 1, count: 10, baseBuildUp: 3000, element: 'electric' },
      ],
      panels: [
        { anomalyMastery: 100 },
        { anomalyMastery: 100 },
        { anomalyMastery: 100 },
      ],
      totalTime: 180,
      invincibleTime: 0,
      enemyDefense: 0,
      enemyDefReduction: 0,
      enemyResistances: {},
      enemyResReduction: 0,
      enemyAnomalyResistances: {},
      enemyAnomalyDefReduction: 0,
      enemyDefFlatReduction: 0,
      bossCoeff: 1,
      anomalyCoeff: 1.1,
      stunned: false,
      stunMultiplier: 1.5,
      hasWindChar: true,
      windCharSlot: 0,
      velinaCinema2CorrosionRate: 2 / 3,
      globalAnomalyMultiplier: 1,
      agentMechanics: [],
    } as unknown as AnomalyPoolInput)

    expect(res.coverage.windCoverageRate).toBeGreaterThan(0)
    expect(res.coverage.windCoverageRate).toBeLessThan(1)
    expect(res.disorderCount).toBeGreaterThan(0)
    expect(res.turbulenceDamage?.count ?? 0).toBeGreaterThan(0)
  })

  it('injects Velina wind-shear replacement into wind anomaly contributions', () => {
    const res = calcAnomalyPool({
      executions: [
        { moveId: '1561007', moveName: 'Sweeping Cyclone #1', slot: 0, count: 760, baseBuildUp: 45, element: 'wind' },
        { moveId: 'physical_basic', moveName: 'Jane buildup', slot: 1, count: 1, baseBuildUp: 39600, element: 'physical' },
      ],
      panels: [
        { anomalyMastery: 100, velinaCinema2: 1, velinaCinema6: 1 },
        { anomalyMastery: 100 },
        { anomalyMastery: 100 },
      ],
      totalTime: 180,
      invincibleTime: 0,
      enemyDefense: 0,
      enemyDefReduction: 0,
      enemyResistances: { physical: 0, wind: 0 },
      enemyResReduction: 0,
      enemyAnomalyResistances: { physical: 0, wind: 0 },
      enemyAnomalyDefReduction: 0,
      enemyDefFlatReduction: 0,
      bossCoeff: 1,
      anomalyCoeff: 1.1,
      stunned: false,
      stunMultiplier: 1.5,
      hasWindChar: true,
      windCharSlot: 0,
      velinaCinema2CorrosionRate: 2 / 3,
      globalAnomalyMultiplier: 1,
      agentMechanics: [velinaMechanic],
    } as unknown as AnomalyPoolInput)

    const wind = (res.perElement as any[]).find(p => p.element === 'wind')
    expect(wind?.contributions?.some((c: any) => c.moveId === 'velina_corrosion_broad')).toBe(true)

    const injected = wind?.contributions?.find((c: any) => c.moveId === 'velina_corrosion_broad')
    expect(injected?.count).toBe((res as any).velinaCorrosionSource?.broadCycloneCount * 10)
    expect(wind?.triggerCount).toBeGreaterThanOrEqual(2)
    expect((res as any).velinaCorrosionSource?.broadCycloneCount).toBeGreaterThan(0)
  })
})
