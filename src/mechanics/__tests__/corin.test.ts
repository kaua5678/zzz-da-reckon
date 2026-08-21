import { describe, expect, it } from 'vitest'
import { computePanelPhases } from '@/composables/resourceCalc/helpers'
import { useResourceCalc } from '@/composables/useResourceCalc'
import {
  CORIN_ADDITIONAL_DMG,
  CORIN_C1_DMG,
  CORIN_C2_MAX_STACKS,
  CORIN_C2_RES_PER_STACK,
  CORIN_C4_ENERGY,
  CORIN_C6_DMG_PER_CHARGE,
  CORIN_CORE_SAW_DMG,
  computeCorinC4Triggers,
  computeCorinCycle,
  computeCorinStunBonusMoves,
  corinMechanic,
} from '@/mechanics/agents/corin'
import { setupHarness } from '@/test/harness'

async function setup(mateId = '1021', cinemaLevel = 0, slotOverrides: Record<string, unknown> = {}) {
  const result = await setupHarness([
    { agentId: '1061', cinemaLevel, parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0, ...slotOverrides },
    { agentId: mateId, cinemaLevel: 0, parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
  ])
  for (const buff of result.config.globalBuffs) buff.enabled = false
  return result
}

function cycle(overrides: Partial<Parameters<typeof computeCorinCycle>[0]> = {}) {
  return computeCorinCycle({
    cinemaLevel: 6,
    additionalActive: true,
    coreSawCoverage: 1,
    additionalStunCoverage: 1,
    c1Coverage: 1,
    c2ResCoverage: 1,
    c4EnergyTotal: 0,
    c6DetonationCount: 8,
    c6ChargeStacks: 40,
    ...overrides,
  })
}

describe('可琳（1061）总量', () => {
  it('核心电锯增伤/额外能力失衡增伤/影画1按覆盖率与激活门控', () => {
    expect(cycle({}).coreSawDmg).toBe(CORIN_CORE_SAW_DMG)
    expect(cycle({ coreSawCoverage: 0.5 }).coreSawDmg).toBe(CORIN_CORE_SAW_DMG * 0.5)
    expect(cycle({ additionalActive: true }).additionalDmg).toBe(CORIN_ADDITIONAL_DMG)
    expect(cycle({ additionalActive: false }).additionalDmg).toBe(0)
    expect(cycle({ cinemaLevel: 1 }).c1Dmg).toBe(CORIN_C1_DMG)
    expect(cycle({ cinemaLevel: 0 }).c1Dmg).toBe(0)
  })

  it('影画2物理减抗=0.5%×20层，影画6引爆伤害=层数×3%', () => {
    expect(cycle({ cinemaLevel: 2 }).c2ResReduction).toBe(CORIN_C2_RES_PER_STACK * CORIN_C2_MAX_STACKS)
    expect(cycle({ cinemaLevel: 1 }).c2ResReduction).toBe(0)
    expect(cycle({ cinemaLevel: 6, c6ChargeStacks: 40 }).c6DamagePerDetonation).toBe(CORIN_C6_DMG_PER_CHARGE * 40)
    expect(cycle({ cinemaLevel: 6, c6ChargeStacks: 10 }).c6DamagePerDetonation).toBe(CORIN_C6_DMG_PER_CHARGE * 10)
    expect(cycle({ cinemaLevel: 5 }).c6DamagePerDetonation).toBe(0)
    expect(cycle({ cinemaLevel: 5, c6DetonationCount: 8 }).c6DetonationCount).toBe(0)
  })

  it('影画4回能门控：4命起生效，低命恒0', () => {
    expect(cycle({ cinemaLevel: 4, c4EnergyTotal: 11 * CORIN_C4_ENERGY }).c4EnergyTotal).toBeCloseTo(11 * CORIN_C4_ENERGY, 6)
    expect(cycle({ cinemaLevel: 3, c4EnergyTotal: 11 * CORIN_C4_ENERGY }).c4EnergyTotal).toBe(0)
    expect(cycle({ cinemaLevel: 6, c4EnergyTotal: -5 }).c4EnergyTotal).toBe(0)
  })
})

describe('computeCorinC4Triggers（影画4触发次数：快支+招架支援+连携，CD上限）', () => {
  it('次数之和低于 CD 上限 → 按次数', () => {
    expect(computeCorinC4Triggers({ battleTime: 180, quickAssistCount: 2, parryCount: 1, chainTotal: 3 })).toBe(6)
  })

  it('次数之和超过 CD 上限 → 截到 floor(battleTime/16)', () => {
    // floor(100/16)=6；快支3+招架4+连携8=15 > 6 → 6
    expect(computeCorinC4Triggers({ battleTime: 100, quickAssistCount: 3, parryCount: 4, chainTotal: 8 })).toBe(6)
    expect(computeCorinC4Triggers({ battleTime: 180, quickAssistCount: 20, parryCount: 20, chainTotal: 20 })).toBe(11)
  })

  it('负数钳 0', () => {
    expect(computeCorinC4Triggers({ battleTime: 180, quickAssistCount: -2, parryCount: -1, chainTotal: 5 })).toBe(5)
    expect(computeCorinC4Triggers({ battleTime: 180, quickAssistCount: 0, parryCount: 0, chainTotal: 0 })).toBe(0)
  })
})

describe('computeCorinStunBonusMoves（额外能力 buff 轴：轴内全招式+35%）', () => {
  const BASIC_IDS = new Set(['1061001', '1061002', '1061003', '1061004', '1061006'])

  it('轴内所有招式都 +35%，其他槽位动作不计', () => {
    const m = computeCorinStunBonusMoves(0, [
      { actions: [
        { slot: 0, moveId: '1061011', count: 1, startTime: 0 },
        { slot: 0, moveId: '1061018', count: 1, startTime: 3 },
        { slot: 1, moveId: '1021011', count: 1, startTime: 1 },
      ] },
    ], BASIC_IDS)
    expect(m.get('1061011')).toBe(CORIN_ADDITIONAL_DMG)
    expect(m.get('1061018')).toBe(CORIN_ADDITIONAL_DMG)
    expect(m.has('1021011')).toBe(false)
  })

  it('平A块（basic）与普攻段 id 都归并 basic_attack 聚合行键', () => {
    const m = computeCorinStunBonusMoves(0, [
      { actions: [
        { slot: 0, moveId: 'basic', count: 5, startTime: 0 },
        { slot: 0, moveId: '1061004', count: 2, startTime: 2 },
      ] },
    ], BASIC_IDS)
    expect(m.size).toBe(1)
    expect(m.get('basic_attack')).toBe(CORIN_ADDITIONAL_DMG)
  })

  it('count=0 的块不计', () => {
    const m = computeCorinStunBonusMoves(0, [
      { actions: [{ slot: 0, moveId: '1061011', count: 0, startTime: 0 }] },
    ], BASIC_IDS)
    expect(m.size).toBe(0)
  })
})

describe('可琳执行行与定向结算', () => {
  it('影画6生成物理引爆合成行，低命座不生成', () => {
    const execs: any[] = []
    corinMechanic.buildExecutions!({
      cfg: { corinCinemaLevel: 6, corinCoreSawCoverage: 1, corinAdditionalStunCoverage: 1, corinC1Coverage: 1, corinC2ResCoverage: 1, corinC6DetonationCount: 8, corinC6ChargeStacks: 40, corinAdditionalActive: true },
      state: { exSpecialCount: 0, ultimateCount: 0, chainCountTotal: 0 },
      executions: execs,
    } as any)
    const boom = execs.find(e => e.moveId === '1061_c6_chainsaw_detonation')
    expect(boom.count).toBe(8)
    expect(boom.damageMultiplier).toBe(CORIN_C6_DMG_PER_CHARGE * 40)
    expect(boom.element).toBe('physical')

    const execs0: any[] = []
    corinMechanic.buildExecutions!({
      cfg: { corinCinemaLevel: 5, corinCoreSawCoverage: 1, corinAdditionalStunCoverage: 1, corinC1Coverage: 1, corinC2ResCoverage: 1, corinC6DetonationCount: 8, corinC6ChargeStacks: 40, corinAdditionalActive: true },
      state: { exSpecialCount: 0, ultimateCount: 0, chainCountTotal: 0 },
      executions: execs0,
    } as any)
    expect(execs0.find(e => e.moveId === '1061_c6_chainsaw_detonation')).toBeUndefined()
  })
})

describe('可琳完整计算链', () => {
  it('额外能力由同属性/同阵营队友激活，异属性异阵营队友不激活', async () => {
    for (const mateId of ['1021', '1141']) {
      const { catalog, config } = await setup(mateId)
      expect((computePanelPhases(0, config, catalog)!.inCombat as any).additionalAbilityActive).toBe(1)
    }
    const neg = await setup('1181')
    expect((computePanelPhases(0, neg.config, neg.catalog)!.inCombat as any).additionalAbilityActive ?? 0).toBe(0)
  })

  it('资源池写入可琳循环', async () => {
    await setup('1021', 6)
    const calc = useResourceCalc()
    const corin = calc.resourceResult.value!.characters.find(row => row.agentId === '1061')!
    expect(corin.specResources?.corin_cycle).toBeTruthy()
  })

  it('面板增益进入最终面板（电锯全招式+影画1增伤、影画2物理减抗单通道=10）', async () => {
    await setup('1021', 2)
    const calc = useResourceCalc()
    expect(calc.resourceResult.value!.characters.find(row => row.agentId === '1061')!.specResources?.corin_cycle).toBeTruthy()
    const panel = calc.panels.value[0] as any
    // 电锯 37.5（全招式普通增伤）+ 影画1 12 = 49.5；额外能力不进面板（走伤害行分支）
    expect(panel.dmgBonus).toBeCloseTo(CORIN_CORE_SAW_DMG + CORIN_C1_DMG, 6)
    // 精确 = 10：锁「单通道」。spec teamBuffs 的 corin_c2_enemy_phys_res 已 hidden，
    // 若有人把它重新打开（或模块重复加一遍），这里会变成 20 → 红。
    expect(panel.enemyPhysicalResReduction).toBeCloseTo(CORIN_C2_RES_PER_STACK * CORIN_C2_MAX_STACKS, 6)
  })

  // 生效测试（AGENT_RECORDING_SOP 铁律：命座差分，防"效果没接进计算"）：
  // 影画4 按已有次数计触发（用户口径）：快支2+招架支援1+连携(1×失衡3)=6，CD 上限 floor(180/16)=11 不截断。
  // 断言面用 energySource.initialGift（赠送量不随循环重分配变化，可精确相等）。
  it('影画4差分：C4 开局能量赠送 = (快支+招架支援+连携总数)×7.2，cycle 记录回能总量', async () => {
    const slot = { quickAssistCount: 2, parryCount: 1, chainCountPerStun: 1 }
    // 锁失衡次数=3 → 连携总数 = 1×3 = 3；触发 = 2+1+3 = 6（stunCountLock 在 enemy 配置上，
    // setupHarness 每次新建 pinia → 每次都要设）
    const withLock = async (cinemaLevel: number) => {
      const { config } = await setup('1021', cinemaLevel, slot)
      config.enemy.stunCountLock = 3
      return useResourceCalc()
    }
    const calc0 = await withLock(0)
    const corin0 = calc0.resourceResult.value!.characters.find(row => row.agentId === '1061')!
    expect(corin0.specResources?.corin_cycle?.c4EnergyTotal ?? 0).toBe(0)
    const gift0 = corin0.energySource.initialGift

    const calc4 = await withLock(4)
    const corin4 = calc4.resourceResult.value!.characters.find(row => row.agentId === '1061')!
    const expected = 6 * CORIN_C4_ENERGY
    expect(corin4.specResources?.corin_cycle?.c4EnergyTotal).toBeCloseTo(expected, 6)
    expect(corin4.energySource.initialGift - gift0).toBeCloseTo(expected, 6)
  })
})

describe('可琳滑块生效（防静默失效，SOP §3.5）', () => {
  it('电锯覆盖率滑块：面板 dmgBonus 线性折算（applyPanel 全招式通道）', async () => {
    const { catalog, config } = await setup('1021', 0)
    const sawOf = () => (computePanelPhases(0, config, catalog)!.inCombat as any).dmgBonus ?? 0

    config.setMechanicSetting('corin.coreSawCoverage', 0)
    expect(sawOf()).toBe(0)

    config.setMechanicSetting('corin.coreSawCoverage', 1)
    expect(sawOf()).toBeCloseTo(CORIN_CORE_SAW_DMG, 6)

    // 半覆盖 = 线性折算（滑块真的按比例进面板，不是 0/1 开关）
    config.setMechanicSetting('corin.coreSawCoverage', 0.5)
    expect(sawOf()).toBeCloseTo(CORIN_CORE_SAW_DMG * 0.5, 6)
  })

  it('影画2减抗覆盖率滑块：0 → 面板无减抗；1 → -10%（applyPanel 通道）', async () => {
    const { catalog, config } = await setup('1021', 2)
    // 直接走 computePanelPhases（applyPanel 在此调用，settings 已解析）——
    // 与 banyue rageGainCoverage 生效测试同款锁法。
    const resOf = () => (computePanelPhases(0, config, catalog)!.inCombat as any).enemyPhysicalResReduction ?? 0

    config.setMechanicSetting('corin.c2ResCoverage', 0)
    expect(resOf()).toBe(0)

    config.setMechanicSetting('corin.c2ResCoverage', 1)
    expect(resOf()).toBeCloseTo(CORIN_C2_RES_PER_STACK * CORIN_C2_MAX_STACKS, 6)

    // 半覆盖 = 线性折算
    config.setMechanicSetting('corin.c2ResCoverage', 0.5)
    expect(resOf()).toBeCloseTo(CORIN_C2_RES_PER_STACK * CORIN_C2_MAX_STACKS * 0.5, 6)
  })

  it('非轴模式失衡增伤覆盖率滑块：伤害行按覆盖率折算（默认0.5，note 标注）', async () => {
    const { config } = await setup('1021', 0)
    const calc = useResourceCalc()
    // damagePoolRows 不暴露 dmgBonus 字段（执行级增伤在结算内部合并）→ 断言面用行 note 标注
    const noteOf = () =>
      calc.damagePoolRows.value.find(r => r.slot === 0 && r.agentId === '1061' && r.moveId === 'basic_attack')?.note ?? ''

    config.setMechanicSetting('corin.additionalStunCoverage', 0)
    expect(noteOf()).not.toContain('失衡增伤')

    config.setMechanicSetting('corin.additionalStunCoverage', 1)
    expect(noteOf()).toContain('失衡增伤+35.0%（覆盖率近似）')

    config.setMechanicSetting('corin.additionalStunCoverage', 0.5)
    expect(noteOf()).toContain('失衡增伤+17.5%（覆盖率近似）')
  })

  it('影画6引爆次数/层数滑块：合成行 count 与倍率跟随滑块', async () => {
    const { config } = await setup('1021', 6)
    const calc = useResourceCalc()
    const boomOf = () =>
      calc.resourceResult.value!.characters.find(row => row.agentId === '1061')!
        .executions.find(e => e.moveId === '1061_c6_chainsaw_detonation')

    config.setMechanicSetting('corin.c6DetonationCount', 5)
    config.setMechanicSetting('corin.c6ChargeStacks', 20)
    const boom = boomOf()
    expect(boom).toBeTruthy()
    expect(boom!.count).toBe(5)
    expect(boom!.damageMultiplier).toBeCloseTo(CORIN_C6_DMG_PER_CHARGE * 20, 6)

    config.setMechanicSetting('corin.c6DetonationCount', 0)
    expect(boomOf()).toBeUndefined()
  })
})

describe('可琳额外能力 buff 轴（轴模式：轴内全招式+35%，般岳明王同款装配）', () => {
  async function setupAxis(cinemaLevel = 0) {
    const { catalog, config } = await setup('1021', cinemaLevel)
    config.useStunAxis = true
    config.stunAxes = [{
      name: '可琳轴',
      actions: [
        { slot: 0, moveId: '1061011', count: 1, startTime: 0 }, // 强化特殊技（EX）
        { slot: 0, moveId: 'basic', count: 5, startTime: 2 },   // 平A块（5 秒，编辑器口径）
        { slot: 0, moveId: '1061018', count: 1, startTime: 6 }, // 终结技
      ],
    }]
    return { catalog, config }
  }

  it('轴内招式行吃 +35%（note 标注 buff轴），basic_attack 聚合行经普攻段归并同样生效，轴外行不吃', async () => {
    await setupAxis(0)
    const calc = useResourceCalc()
    await new Promise(r => setTimeout(r, 50))
    expect(calc.stunAxisResult.value).not.toBeNull()
    const rows = calc.damagePoolRows.value.filter(r => r.slot === 0 && r.agentId === '1061')
    expect(rows.length).toBeGreaterThan(0)
    // 轴内 moveId 的行（EX 1061011 / 终结 1061018）：note 带「失衡增伤+35.0%（buff轴）」
    // （同一 moveId 可能拆轴内/轴外两行——只有轴内行带标注）
    for (const moveId of ['1061011', '1061018']) {
      const rowsFor = rows.filter(r => r.moveId === moveId)
      expect(rowsFor.length).toBeGreaterThan(0)
      expect(rowsFor.some(r => (r.note ?? '').includes('失衡增伤+35.0%（buff轴）'))).toBe(true)
    }
    // 普攻聚合行：普攻段 1061001 在轴内 → 归并键 basic_attack 生效（轴内段行带标注）
    const basicRows = rows.filter(r => r.moveId === 'basic_attack')
    expect(basicRows.some(r => (r.note ?? '').includes('失衡增伤+35.0%（buff轴）'))).toBe(true)
    // 轴外行（敌人未失衡）不带失衡增伤标注
    const outAxis = rows.filter(r => (r.note ?? '').includes('轴外'))
    expect(outAxis.length).toBeGreaterThan(0)
    for (const row of outAxis) expect(row.note ?? '').not.toContain('失衡增伤')
  })
})
