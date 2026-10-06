import { describe, expect, it } from 'vitest'
import { calcAnomalyPool, calcAnomalyPoolDamage, type AnomalyPoolInput } from '@/core/anomalyPool'
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
  /** r701 起 calcAnomalyPool 只出次数与 damageInputs；三项伤害由结算侧补齐，这里用池自己的面板（= 原池内口径） */
  const poolWithDamage = (input: AnomalyPoolInput) => {
    const pool = calcAnomalyPool(input)
    return { ...pool, ...calcAnomalyPoolDamage(pool.damageInputs, input.panels, { globalAnomalyMultiplier: 1, teamMechanics: input.teamMechanics }) }
  }

  it('splits non-wind anomalies into disorder window and turbulence window', () => {
    const res = poolWithDamage({
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
      teamMechanics: [],
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
        // 风蚀归属 = 派发方给的 `self`（r399 CC-373）⇒ 维琳娜在 teamMechanics 里登记为槽 0
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
      teamMechanics: [{ module: velinaMechanic, slot: 0 }],
    } as unknown as AnomalyPoolInput)

    const wind = (res.perElement as any[]).find(p => p.element === 'wind')
    expect(wind?.contributions?.some((c: any) => c.moveId === 'velina_corrosion_broad')).toBe(true)

    const injected = wind?.contributions?.find((c: any) => c.moveId === 'velina_corrosion_broad')
    expect(injected?.count).toBe((res as any).corrosionSource?.broadCycloneCount * 10)
    expect(wind?.triggerCount).toBeGreaterThanOrEqual(2)
    expect((res as any).corrosionSource?.broadCycloneCount).toBeGreaterThan(0)
  })

  /**
   * CC-D3（2026-09-25）：风蚀是**维琳娜专属资源**，判据必须是「维琳娜在队」（r399 起 = teamMechanics 里有她），
   * 不能是「队里第一个风属性角色」。旧实现按 `windCharSlot` 取面板 ⇒ 洛克茜(1621) /
   * 赛维里安(1631) 这类**别的风属性角色**在队时也会跑维琳娜风蚀状态机，并把
   * 「维琳娜微域/广域气旋」的异放行挂在他们名下（实测 1621 队 2 条行共 1.5w 伤害）。
   *
   * 本用例是**反向验证**：teamMechanics 里没有维琳娜（队里是别的风角色），
   * 风蚀整套必须消失——不只是「次数变 0」，`corrosionSource` 本身必须为 undefined
   * （否则下游仍会推事件行）。
   */
  it('CC-D3：无维琳娜（只有别的风属性角色）⇒ 风蚀整套不结算', () => {
    const base = {
      executions: [
        { moveId: '1561007', moveName: 'Sweeping Cyclone #1', slot: 0, count: 760, baseBuildUp: 45, element: 'wind' },
        { moveId: 'physical_basic', moveName: 'Jane buildup', slot: 1, count: 1, baseBuildUp: 39600, element: 'physical' },
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
      hasWindChar: true,          // 队伍**有**风角色（1621 洛克茜这类），但**不是**维琳娜
      windCharSlot: 0,
    }
    // ① 有维琳娜（对照）：正常产出
    const withVelina = poolWithDamage({
      ...base,
      teamMechanics: [{ module: velinaMechanic, slot: 0 }],
      panels: [
        { anomalyMastery: 100, velinaCinema2: 1, velinaCinema6: 1 },
        { anomalyMastery: 100 },
        { anomalyMastery: 100 },
      ],
    } as unknown as AnomalyPoolInput)
    expect(withVelina.corrosionSource).toBeTruthy()
    expect(withVelina.corrosionSource!.broadCycloneCount).toBeGreaterThan(0)
    expect((withVelina.anomalyEvents ?? []).some(e => e.id === 'velina-corrosion-broad-cyclone' && e.count > 0)).toBe(true)

    // ② 无维琳娜：整套消失（乱流本身仍在——它是风化状态的通用机制，不是维琳娜专属）
    const withoutVelina = poolWithDamage({
      ...base,
      teamMechanics: [],           // 维琳娜不在队（r399：不在队的模块不派发）
      panels: [
        { anomalyMastery: 100 },   // 风槽是别的风角色
        { anomalyMastery: 100 },
        { anomalyMastery: 100 },
      ],
    } as unknown as AnomalyPoolInput)
    expect(withoutVelina.corrosionSource, '无维琳娜时风蚀状态机不得结算（CC-D3）').toBeUndefined()
    expect((withoutVelina.anomalyEvents ?? []).some(e => e.id.includes('velina-corrosion') && e.count > 0),
      '无维琳娜时不得产出气旋异放事件行').toBe(false)
    expect((withoutVelina.perElement as any[]).find(p => p.element === 'wind')?.contributions
      ?.some((c: any) => c.moveId === 'velina_corrosion_broad'),
      '无维琳娜时不得注入广域气旋积蓄').toBe(false)
    // 乱流仍在（回归锁：别把 CC-D3 修成「无维琳娜就没有乱流」）
    expect(withoutVelina.turbulenceDamage?.count ?? 0).toBeGreaterThan(0)
    // 强化乱流（+150% 倍率）也必须归零
    expect(withoutVelina.turbulenceDamage?.boostedCount ?? 0, '无维琳娜时乱流不得吃 +150% 强化').toBe(0)
    expect(withVelina.turbulenceDamage?.boostedCount ?? 0).toBeGreaterThan(0)
  })
})
