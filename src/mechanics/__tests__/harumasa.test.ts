import { describe, expect, it } from 'vitest'
import { computePanelPhases } from '@/composables/resourceCalc/helpers'
import { useResourceCalc } from '@/composables/useResourceCalc'
import {
  HARUMASA_ADDITIONAL_DMG,
  HARUMASA_ARROW_MOVE_ID,
  HARUMASA_C2_DMG_BONUS,
  HARUMASA_EDGE_CRIT_DMG_PER_STACK,
  HARUMASA_C6_ELECTRIC_RES_IGNORE,
  HARUMASA_C6_EXPLOSION_MULTIPLIER,
  HARUMASA_CORE_CRIT_RATE,
  HARUMASA_KETTLE_A5_GAIN,
  HARUMASA_POTENTIAL_ATK_PCT,
  HARUMASA_POTENTIAL_RES_IGNORE,
  HARUMASA_SLASH_MOVE_IDS,
  HARUMASA_THUNDER_MOVE_ID,
  HARUMASA_ULT_FOLLOW_ACTION_TIME,
  HARUMASA_ULT_FOLLOW_MOVE_ID,
  computeHarumasaCycle,
  harumasaMechanic,
} from '@/mechanics/agents/harumasa'
import { setupHarness } from '@/test/harness'

async function setup(mateId = '1141', cinemaLevel = 0, potentialLevel = 6) {
  const result = await setupHarness([
    { agentId: '1201', cinemaLevel, potentialLevel, parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
    { agentId: mateId, cinemaLevel: 0, potentialLevel: 6, parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
  ])
  for (const buff of result.config.globalBuffs) buff.enabled = false
  return result
}

function cycle(overrides: Partial<Parameters<typeof computeHarumasaCycle>[0]> = {}) {
  return computeHarumasaCycle({
    cinemaLevel: 0,
    potentialLevel: 6,
    a5Count: 2,
    chainCount: 1,
    ultimateCount: 1,
    exSpecialCount: 1,
    stunCoverage: 0.5,
    abnormalCoverage: 1,
    edgeAverageStacks: 6,
    ...overrides,
  })
}

describe('悠真（1201）电壶→电囚→飞弦·斩资源循环', () => {
  it('电壶(开局6+A5+连携+强特)→甲乙矢→电囚→飞弦·斩(每刀耗2电囚)', () => {
    const c0 = cycle({ cinemaLevel: 0, ultimateCount: 0 })
    expect(c0.kettleTotal).toBe(22)
    expect(c0.arrowHitCount).toBe(22)
    expect(c0.prisonTotal).toBe(24)
    expect(c0.slashCount).toBe(12)
    expect(c0.prisonCap).toBe(8)

    const c1 = cycle({ cinemaLevel: 1, ultimateCount: 0 })
    expect(c1.arrowHitCount).toBe(44)
    expect(c1.prisonTotal).toBe(46)
    expect(c1.slashCount).toBe(23)
    expect(c1.prisonCap).toBe(14)
  })

  it('影画4终结技满层电囚（+14计入资源总量）', () => {
    const c4 = cycle({ cinemaLevel: 4, ultimateCount: 1 })
    expect(c4.prisonTotal).toBe(60)
    expect(c4.slashCount).toBe(30)
    expect(c4.prisonDurationSeconds).toBe(20)
  })

  it('逐雷只在失衡内触发（飞弦·斩×失衡覆盖率）', () => {
    const full = cycle({ stunCoverage: 1, abnormalCoverage: 0 })
    expect(full.thunderCount).toBe(full.slashCount)
    const half = cycle({ stunCoverage: 0.5, abnormalCoverage: 0 })
    expect(half.thunderCount).toBe(Math.round(half.slashCount * 0.5))
    const none = cycle({ stunCoverage: 0, abnormalCoverage: 0 })
    expect(none.thunderCount).toBe(0)
  })

  it('失衡/异常并集覆盖率', () => {
    expect(cycle({ stunCoverage: 0.5, abnormalCoverage: 1 }).unionCoverage).toBe(1)
    expect(cycle({ stunCoverage: 0.3, abnormalCoverage: 0.5 }).unionCoverage).toBeCloseTo(0.3 + 0.5 * 0.7, 5)
  })

  it('C2电掣最多强化实际飞弦·斩次数', () => {
    const c0 = cycle({ cinemaLevel: 0 })
    expect(c0.surgeGain).toBe(0)
    const c2 = cycle({ cinemaLevel: 2, chainCount: 1, ultimateCount: 1 })
    expect(c2.surgeGain).toBe(14)
    expect(c2.surgeBuffedSlashCount).toBe(Math.min(c2.slashCount, 14))
  })

  it('C6每12次甲乙矢触发一次1500%电磁爆炸（计数器）', () => {
    const big = cycle({ cinemaLevel: 6, a5Count: 4, chainCount: 1, ultimateCount: 0, exSpecialCount: 1 })
    expect(big.c6ExplosionCount).toBe(Math.floor(big.arrowHitCount / 12))
  })

  it('潜能觉醒按潜能等级：攻击提升与飞弦/逐雷减抗', () => {
    expect(cycle({ potentialLevel: 1 }).potentialLevel).toBe(1)
    expect(cycle({ potentialLevel: 6 }).potentialLevel).toBe(6)
    expect(HARUMASA_POTENTIAL_ATK_PCT[6]).toBe(12)
    expect(HARUMASA_POTENTIAL_RES_IGNORE[6]).toBe(15)
  })

  it('轴模式（捏轴）：逐雷按轴内飞弦·斩、影画6电抗按轴内甲乙矢占比', () => {
    const axis = cycle({ cinemaLevel: 6, axisActive: true, axisSlash: 5, axisArrow: 10, abnormalCoverage: 0 })
    expect(axis.axisActive).toBe(true)
    expect(axis.thunderCount).toBe(Math.min(axis.slashCount, 5))
    expect(axis.c6ResCoverage).toBeCloseTo(10 / axis.arrowHitCount, 5)
    // 非轴回退到并集覆盖率
    const nonAxis = cycle({ cinemaLevel: 6, axisActive: false, stunCoverage: 0.3, abnormalCoverage: 0.5 })
    expect(nonAxis.c6ResCoverage).toBeCloseTo(0.3 + 0.5 * 0.7, 5)
  })

  it('失衡覆盖率由失衡次数反推（applyTeamConfig converge，轴内行直加同源）', () => {
    const characters: any[] = [{ slot: 0, agentId: '1201', harumasaStunCoverage: 0.5 }]
    harumasaMechanic.applyTeamConfig!({ slot: 0, characters, phase: 'converge', stunCount: 3, combatTime: 180 } as any)
    expect(characters[0].harumasaStunCoverage).toBeCloseTo(3 * 16 / 180, 5)
    // 非 converge 阶段不动作
    harumasaMechanic.applyTeamConfig!({ slot: 0, characters, phase: 'build', stunCount: 3, combatTime: 180 } as any)
    expect(characters[0].harumasaStunCoverage).toBeCloseTo(3 * 16 / 180, 5)
  })

  it('轴模式额外能力 +40%：公共异常部分全部行，失衡独有部分行级直加标记（可琳同款通道）', () => {
    const cfg: any = {
      harumasaCinemaLevel: 0, harumasaPotentialLevel: 6, harumasaStunCoverage: 0.5, harumasaAbnormalCoverage: 0.2,
      harumasaAxisActive: true, harumasaAxisSlash: 5, harumasaAxisArrow: 10,
      'setting:harumasa.a5Count': 2, 'setting:harumasa.edgeAverageStacks': 6,
      panel: { additionalAbilityActive: 1 },
    }
    const executions: any[] = [{ moveId: '1201020', category: 'special' }, { moveId: '1201008', category: 'basic' }]
    harumasaMechanic.patchExecutions!({ cfg, state: { exSpecialCount: 1, chainCountTotal: 1, ultimateCount: 1 }, executions } as any)
    // 公共异常部分 = 40 × 0.2 = 8 摊入全部行
    expect(executions[0].dmgBonus).toBeCloseTo(8, 5)
    expect(executions[1].dmgBonus).toBeCloseTo(8, 5)
    // 失衡独有部分 = 40 × 0.8 = 32 留给 damagePool 按段直加
    expect(executions[0].harumasaStunOnly).toBeCloseTo(32, 5)

    // 非轴：并集口径（0.5 + 0.2×0.5 = 0.6 → +24），无行级标记
    const cfgOff: any = { ...cfg, harumasaAxisActive: false }
    const rows2: any[] = [{ moveId: '1201020', category: 'special' }]
    harumasaMechanic.patchExecutions!({ cfg: cfgOff, state: { exSpecialCount: 1, chainCountTotal: 1, ultimateCount: 1 }, executions: rows2 } as any)
    expect(rows2[0].dmgBonus).toBeCloseTo(24, 5)
    expect(rows2[0].harumasaStunOnly).toBeUndefined()
  })

  it('未激活额外能力：轴模式不标记、不增伤', () => {
    const cfg: any = {
      harumasaCinemaLevel: 0, harumasaPotentialLevel: 6, harumasaStunCoverage: 0.5, harumasaAbnormalCoverage: 0.2,
      harumasaAxisActive: true, 'setting:harumasa.a5Count': 2, 'setting:harumasa.edgeAverageStacks': 6,
      panel: { additionalAbilityActive: 0 },
    }
    const executions: any[] = [{ moveId: '1201020', category: 'special' }]
    harumasaMechanic.patchExecutions!({ cfg, state: { exSpecialCount: 1, chainCountTotal: 1, ultimateCount: 1 }, executions } as any)
    expect(executions[0].dmgBonus ?? 0).toBe(0)
    expect(executions[0].harumasaStunOnly).toBeUndefined()
  })
})

describe('悠真招式定向机制', () => {
  it('飞弦·斩第一段只打一次(0.6s)，后续二/三段轮转', () => {
    const executions: any[] = []
    harumasaMechanic.buildExecutions!({
      cfg: {
        panel: { additionalAbilityActive: 0 },
        harumasaCinemaLevel: 0,
        harumasaPotentialLevel: 6,
        harumasaA5Count: 2,
        harumasaStunCoverage: 0.5,
        harumasaAbnormalCoverage: 1,
        harumasaEdgeAverageStacks: 6,
      },
      state: { exSpecialCount: 1, ultimateCount: 0, chainCountTotal: 1 },
      executions,
    } as any)
    expect(executions.find(r => r.moveId === '1201020')!.count).toBe(1)
    expect(executions.find(r => r.moveId === '1201020')!.actionTime).toBe(0.6)
    expect(executions.find(r => r.moveId === '1201021')!.count).toBe(6)
    expect(executions.find(r => r.moveId === '1201022')!.count).toBe(5)
  })

  it('核心暴击/电掣/额外能力增伤/潜能减抗/影画6电抗按范围与覆盖率作用', () => {
    const slash: any = { moveId: HARUMASA_SLASH_MOVE_IDS[0], element: 'electric', dmgBonus: 0, resIgnore: 0 }
    const thunder: any = { moveId: HARUMASA_THUNDER_MOVE_ID, element: 'electric', dmgBonus: 0, resIgnore: 0 }
    const arrow: any = { moveId: HARUMASA_ARROW_MOVE_ID, element: 'electric', dmgBonus: 0, resIgnore: 0 }
    const cfg: any = {
      panel: { additionalAbilityActive: 1 },
      harumasaCinemaLevel: 6,
      harumasaPotentialLevel: 6,
      harumasaA5Count: 2,
      harumasaStunCoverage: 0.5,
      harumasaAbnormalCoverage: 1,
      harumasaEdgeAverageStacks: 6,
    }
    const state: any = { exSpecialCount: 0, ultimateCount: 1, chainCountTotal: 1 }
    harumasaMechanic.patchExecutions!({ cfg, state, executions: [slash, thunder, arrow] } as any)
    const cycleRes = computeHarumasaCycle({ cinemaLevel: 6, potentialLevel: 6, a5Count: 2, chainCount: 1, ultimateCount: 1, exSpecialCount: 0, stunCoverage: 0.5, abnormalCoverage: 1, edgeAverageStacks: 6 })
    // 核心暴击（飞弦/逐雷/终结）
    expect(slash.critRateBonus).toBe(HARUMASA_CORE_CRIT_RATE)
    expect(thunder.critRateBonus).toBe(HARUMASA_CORE_CRIT_RATE)
    expect(arrow.critRateBonus).toBeUndefined()
    // 电掣增伤 + 额外能力并集增伤（飞弦）
    expect(slash.dmgBonus).toBe(HARUMASA_C2_DMG_BONUS * cycleRes.surgeCoverage + HARUMASA_ADDITIONAL_DMG * cycleRes.unionCoverage)
    // 潜能减抗（飞弦/逐雷限定招式）
    expect(slash.resIgnore).toBe(HARUMASA_POTENTIAL_RES_IGNORE[6] + HARUMASA_C6_ELECTRIC_RES_IGNORE * cycleRes.unionCoverage)
    expect(thunder.resIgnore).toBe(HARUMASA_POTENTIAL_RES_IGNORE[6] + HARUMASA_C6_ELECTRIC_RES_IGNORE * cycleRes.unionCoverage)
    // 甲乙矢只有影画6电抗（无潜能减抗，因为不是飞弦/逐雷）
    expect(arrow.resIgnore).toBe(HARUMASA_C6_ELECTRIC_RES_IGNORE * cycleRes.unionCoverage)
  })

  it('潜能觉醒攻击提升走 applyPanel', () => {
    const panel: any = { atk: 1000 }
    harumasaMechanic.applyPanel!({ potentialLevel: 6, outOfCombatPanel: { atk: 1000 }, panel } as any)
    expect(panel.atk).toBe(1000 + 1000 * HARUMASA_POTENTIAL_ATK_PCT[6] / 100)
    // 潜能 I 无觉醒
    const p1: any = { atk: 1000 }
    harumasaMechanic.applyPanel!({ potentialLevel: 1, outOfCombatPanel: { atk: 1000 }, panel: p1 } as any)
    expect(p1.atk).toBe(1000)
  })

  it('补齐终结技自动派生的残心·散华倍率行与动作时间', () => {
    const executions: any[] = []
    harumasaMechanic.buildExecutions!({
      cfg: {
        panel: { additionalAbilityActive: 0 },
        harumasaCinemaLevel: 0,
        harumasaPotentialLevel: 6,
        harumasaA5Count: 0,
        harumasaStunCoverage: 0,
        harumasaAbnormalCoverage: 0,
        harumasaEdgeAverageStacks: 6,
      },
      state: { exSpecialCount: 0, ultimateCount: 2, chainCountTotal: 0 },
      executions,
    } as any)
    const follow = executions.find(row => row.moveId === HARUMASA_ULT_FOLLOW_MOVE_ID)
    expect(follow.count).toBe(2)
    expect(follow.actionTime).toBe(HARUMASA_ULT_FOLLOW_ACTION_TIME)
    expect(follow.damageMultiplierOverride).toBeUndefined()
  })

  it('C6减抗与电磁爆炸', () => {
    const executions: any[] = []
    const cfg: any = {
      panel: { additionalAbilityActive: 0 },
      harumasaCinemaLevel: 6,
      harumasaPotentialLevel: 6,
      harumasaA5Count: 4,
      harumasaStunCoverage: 0.5,
      harumasaAbnormalCoverage: 1,
      harumasaEdgeAverageStacks: 0,
    }
    const state: any = { exSpecialCount: 0, ultimateCount: 0, chainCountTotal: 0 }
    harumasaMechanic.buildExecutions!({ cfg, state, executions } as any)
    const explosion = executions.find(row => row.moveId === '1201_c6_electromagnetic_explosion')
    expect(explosion).toBeTruthy()
    expect(explosion.damageMultiplier).toBe(HARUMASA_C6_EXPLOSION_MULTIPLIER)
    expect(explosion.damageMultiplierOverride).toBe(true)
    expect(explosion.actionTime).toBe(0)
  })
})

describe('悠真完整计算链', () => {
  it('额外能力由击破或异常队友激活，普通队友不激活', async () => {
    for (const mateId of ['1141', '1281']) {
      const { catalog, config } = await setup(mateId)
      expect((computePanelPhases(0, config, catalog)!.inCombat as any).additionalAbilityActive).toBe(1)
    }
    const neg = await setup('1271')
    expect((computePanelPhases(0, neg.config, neg.catalog)!.inCombat as any).additionalAbilityActive ?? 0).toBe(0)
  })

  it('资源池生成飞弦·斩/甲乙矢行并保留通用失衡提取', async () => {
    await setup('1141', 6)
    const calc = useResourceCalc()
    const harumasa = calc.resourceResult.value!.characters.find(row => row.agentId === '1201')!
    expect(HARUMASA_SLASH_MOVE_IDS.some(id => harumasa.executions.some(row => row.moveId === id))).toBe(true)
    expect(harumasa.executions.some(row => row.moveId === HARUMASA_ARROW_MOVE_ID)).toBe(true)
  })

  it('轴模式失衡专属 buff 行级直加：轴内段 note 标注、轴外段不标注', async () => {
    const { config } = await setup('1141', 0)
    config.useStunAxis = true
    config.stunAxes = [{
      name: '悠真轴内直加',
      count: 2,
      // 轴内只放 飞弦·斩第一段（一次）——它在窗口内吃易伤 + 失衡专属增伤
      actions: [{ slot: 0, moveId: '1201020', count: 1 }],
      basicFillerSlot: 0,
    }]
    // 异常覆盖率 20% → 失衡独有部分 = 40 × 0.8 = 32（可琳同款分段通道）
    config.setMechanicSetting('harumasa.abnormalCoverage', 0.2)
    const calc = useResourceCalc()
    const rows = calc.damagePoolRows.value.filter(r => r.agentId === '1201' && r.moveId === '1201020')
    expect(rows.length).toBeGreaterThan(0)
    const inRow = rows.find(r => !(r.note ?? '').includes('轴外'))
    const outRow = rows.find(r => (r.note ?? '').includes('轴外'))
    expect(inRow, '轴内段必须存在').toBeTruthy()
    expect(inRow!.note).toContain('失衡增伤+32.0%（轴内直加）')
    if (outRow) expect(outRow.note).not.toContain('轴内直加')
  })
})

describe('悠真滑块生效差分（防守卫冻结，SOP §3.5：改滑块→结果确实变）', () => {
  const base = {
    cinemaLevel: 0, potentialLevel: 6, a5Count: 4, chainCount: 2, ultimateCount: 1,
    exSpecialCount: 3, stunCoverage: 0, abnormalCoverage: 1, edgeAverageStacks: 3,
  }

  it('harumasa.a5Count → 电壶总量差分（A5 每段 +2 电壶 → 甲乙矢命中数）', () => {
    const on = computeHarumasaCycle({ ...base, a5Count: 8 })
    const off = computeHarumasaCycle({ ...base, a5Count: 2 })
    expect(on.kettleTotal - off.kettleTotal).toBe(6 * HARUMASA_KETTLE_A5_GAIN)
    expect(on.arrowHitCount).toBeGreaterThan(off.arrowHitCount)
  })

  it('harumasa.abnormalCoverage → 逐雷并集覆盖率差分（stun∪abnormal 补全）', () => {
    const on = computeHarumasaCycle({ ...base, stunCoverage: 0.5, abnormalCoverage: 1 })
    const off = computeHarumasaCycle({ ...base, stunCoverage: 0.5, abnormalCoverage: 0 })
    expect(on.unionCoverage).toBeCloseTo(1, 5)
    expect(off.unionCoverage).toBeCloseTo(0.5, 5)
    expect(on.unionCoverage).toBeGreaterThan(off.unionCoverage)
  })

  it('harumasa.edgeAverageStacks → 锋芒暴伤差分（每层 +12%，封顶 6 层）', () => {
    const on = computeHarumasaCycle({ ...base, edgeAverageStacks: 6 })
    const half = computeHarumasaCycle({ ...base, edgeAverageStacks: 3 })
    const off = computeHarumasaCycle({ ...base, edgeAverageStacks: 0 })
    expect(on.edgeCritDmg).toBeCloseTo(6 * HARUMASA_EDGE_CRIT_DMG_PER_STACK, 5)
    expect(half.edgeCritDmg).toBeCloseTo(3 * HARUMASA_EDGE_CRIT_DMG_PER_STACK, 5)
    expect(off.edgeCritDmg).toBe(0)
  })
})
