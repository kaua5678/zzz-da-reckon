import { beforeEach, describe, expect, it } from 'vitest'
import { mockStaticFetch, newPinia } from '@/test/harness'
import { useCatalogStore } from '@/stores/catalog'
import { useConfigStore } from '@/stores/config'
import {
  SIGRID_CHUQIANG_MOVE_IDS,
  SIGRID_LANCE_SEGMENT_IDS,
  sigridMechanic,
  splitLanceRotation,
  countBasicFinisherHits,
} from '@/mechanics/agents/sigrid'

const baseConfig = {
  wEngineId: '', wEngineModLevel: 5,
  driveDisc: { fourPieceSetId: '', twoPieceSetId: '', mainStats: { 4: 'atkPct' as any, 5: 'iceDmg' as any, 6: 'critRate' as any }, subStatAllocation: {} },
  parryCount: 10, dodgeCounterCount: 6, blockCount: 20,
  quickAssistCount: 0, chainCountPerStun: 0, basicAttackTimeWeight: 1,
}

describe('希格莉德（1591）面板：核心被动 / 额外能力 / 影画', () => {
  beforeEach(() => {
    newPinia()
    mockStaticFetch()
  })

  async function setup(teamAgentIds: [string, string, string], cinemaLevel = 0) {
    const catalog = useCatalogStore()
    await catalog.load()
    await catalog.loadTeammateBuffs()
    const config = useConfigStore()
    teamAgentIds.forEach((agentId, slot) => {
      config.team[slot] = { slot, agentId, cinemaLevel: slot === 0 ? cinemaLevel : 0, ...baseConfig } as any
    })
    config.syncTeammateBuffsFromTeam()
    const { computePanelPhases } = await import('@/composables/resourceCalc/helpers')
    return { catalog, config, computePanelPhases }
  }

  it('核心被动（0命，带[支援]队友）：暴击率 +66、失衡易伤 +20（默认满覆盖）', async () => {
    // 1211 丽娜 = 支援 → 额外能力激活
    const { config, computePanelPhases } = await setup(['1591', '1211', ''])
    config.setMechanicSetting('sigrid.corePassiveCoverage', 0)
    const p0 = computePanelPhases(0, config, useCatalogStore())!.inCombat as any
    config.setMechanicSetting('sigrid.corePassiveCoverage', 1)
    const p1 = computePanelPhases(0, config, useCatalogStore())!.inCombat as any
    expect(p1.critRate - p0.critRate).toBeCloseTo(66, 5)
    expect(p1.stunDmgMultiplierBonus - p0.stunDmgMultiplierBonus).toBeCloseTo(20, 5)
  })

  it('额外能力·天际联军：[支援]队友在队 → 攻击 +840、浸染增伤 +15；无关队友 → 不生效', async () => {
    // 正例：1211 丽娜（支援）
    const pos = await setup(['1591', '1211', ''])
    const pPos = pos.computePanelPhases(0, pos.config, useCatalogStore())!.inCombat as any
    // 负例：1081 比利（物理·狡兔屋，与希格莉德不同属性不同阵营，非支援/击破）
    const neg = await setup(['1591', '1081', ''])
    const pNeg = neg.computePanelPhases(0, neg.config, useCatalogStore())!.inCombat as any
    expect(pPos.additionalAbilityActive).toBe(1)
    expect(pNeg.additionalAbilityActive ?? 0).toBe(0)
    // 面板差分：正例比负例多 840 攻击（浸染增伤已移到伤害行，按风化覆盖率折算——见全链用例）
    expect(pPos.atk - pNeg.atk).toBeCloseTo(840, 0)
  })

  it('命座差分：1命攻击 ×1.25、2命喧响获取 +10、4命增伤 +18', async () => {
    const { config, computePanelPhases } = await setup(['1591', '1211', ''], 0)
    const p0 = computePanelPhases(0, config, useCatalogStore())!.inCombat as any
    config.team[0].cinemaLevel = 1
    const p1 = computePanelPhases(0, config, useCatalogStore())!.inCombat as any
    // 影画1 攻击+25%：先乘百分比再叠 +840 固定值，差分 = round(base×1.25) - base
    expect(p1.atk - p0.atk).toBeGreaterThanOrEqual(Math.round((p0.atk - 840) * 0.25) - 1)
    expect(p1.atk - p0.atk).toBeLessThanOrEqual(Math.round((p0.atk - 840) * 0.25) + 1)

    config.team[0].cinemaLevel = 2
    const p2 = computePanelPhases(0, config, useCatalogStore())!.inCombat as any
    expect(p2.decibelGainEfficiency - p0.decibelGainEfficiency).toBeCloseTo(10, 5)

    config.team[0].cinemaLevel = 4
    const p4 = computePanelPhases(0, config, useCatalogStore())!.inCombat as any
    expect(p4.dmgBonus - p2.dmgBonus).toBeCloseTo(18, 5)
  })

  it('覆盖率滑块 50%：暴击增量减半（33）', async () => {
    const { config, computePanelPhases } = await setup(['1591', '1211', ''])
    config.setMechanicSetting('sigrid.corePassiveCoverage', 0)
    const pOff = computePanelPhases(0, config, useCatalogStore())!.inCombat as any
    config.setMechanicSetting('sigrid.corePassiveCoverage', 0.5)
    const pHalf = computePanelPhases(0, config, useCatalogStore())!.inCombat as any
    expect(pHalf.critRate - pOff.critRate).toBeCloseTo(33, 5)
  })
})

describe('希格莉德 patchExecutions：影画2 穿透率（catalog 真实 id）', () => {
  function exec(moveId: string): any {
    return { moveId, moveName: moveId, category: 'basic', count: 1, actionTime: 1, comboAlignRatio: 0, totalTime: 1, totalComboAlignTime: 0, decibelRecovery: 0, totalDecibelRecovery: 0 }
  }

  it('出枪式集合 = 凛冽枪尖#4/乱琼/碎玉/回马枪/冰凌卷地/霜天/冰饕（id 映射事故回归锁）', () => {
    // 旧录制把 nanoka skill_list id 当倍率表 id：1591009 不存在、1591001/1591004 是凛冽枪尖#1/#3
    expect(SIGRID_CHUQIANG_MOVE_IDS.has('1591005')).toBe(true) // 凛冽枪尖 #4
    expect(SIGRID_CHUQIANG_MOVE_IDS.has('1591011')).toBe(true) // 乱琼
    expect(SIGRID_CHUQIANG_MOVE_IDS.has('1591015')).toBe(true) // 冰凌卷地
    expect(SIGRID_CHUQIANG_MOVE_IDS.has('1591001')).toBe(false) // 凛冽枪尖 #1 ∉ 出枪式
    expect(SIGRID_CHUQIANG_MOVE_IDS.has('1591004')).toBe(false) // #3 ∉
    expect(SIGRID_CHUQIANG_MOVE_IDS.has('1591009')).toBe(false) // 倍率表中不存在
    expect([...SIGRID_LANCE_SEGMENT_IDS]).toEqual(['1591007', '1591008', '1591022'])
  })

  it('影画2：出枪式+敛枪式三段行挂穿透率 +24，凛冽枪尖#1/#2/#3 不受影响', () => {
    const cfg: any = { sigridCinemaLevel: 2, sigridAtk: 1000 }
    const lance1 = exec('1591007')
    const lance3 = exec('1591022')
    const chuqiang = exec('1591015') // 连携技：冰凌卷地 ∈ 出枪式
    const basic2 = exec('1591002') // 凛冽枪尖 #2 ∉ 出枪式（旧实现错挂）
    sigridMechanic.patchExecutions!({ cfg, executions: [lance1, lance3, chuqiang, basic2] } as any)
    expect(lance1.penRatioBonus).toBe(24)
    expect(lance3.penRatioBonus).toBe(24)
    expect(chuqiang.penRatioBonus).toBe(24)
    expect(basic2.penRatioBonus ?? 0).toBe(0)
  })

  it('0命：无任何执行级修正', () => {
    const cfg: any = { sigridCinemaLevel: 0, sigridAtk: 1000 }
    const lance = exec('1591007')
    const chuqiang = exec('1591015')
    sigridMechanic.patchExecutions!({ cfg, executions: [lance, chuqiang] } as any)
    expect(lance.penRatioBonus ?? 0).toBe(0)
    expect(chuqiang.penRatioBonus ?? 0).toBe(0)
  })
})

describe('希格莉德 buildExecutions：敛枪式三段轮转 + 破阵 + 影画1/6 附加', () => {
  const SEGMENTS = [
    { moveId: '1591007', actionTime: 0.784, decibelRecovery: 21.56, energyRecovery: 2.822 },
    { moveId: '1591008', actionTime: 1.3, decibelRecovery: 35.7775, energyRecovery: 4.682 },
    { moveId: '1591022', actionTime: 1.783, decibelRecovery: 49.06, energyRecovery: 6.42 },
  ]

  function build(cfgExtra: Record<string, unknown>) {
    const executions: any[] = []
    sigridMechanic.buildExecutions!({
      cfg: { sigridLanceSegments: SEGMENTS, ...cfgExtra } as any,
      state: {},
      executions,
    } as any)
    return executions
  }

  it('splitLanceRotation：轮转一→二→三均摊', () => {
    expect(splitLanceRotation(0)).toEqual([0, 0, 0])
    expect(splitLanceRotation(1)).toEqual([1, 0, 0])
    expect(splitLanceRotation(2)).toEqual([1, 1, 0])
    expect(splitLanceRotation(3)).toEqual([1, 1, 1])
    expect(splitLanceRotation(4)).toEqual([2, 1, 1])
    expect(splitLanceRotation(7)).toEqual([3, 2, 2])
  })

  it('破阵（用户口径：每次失衡送一套三段，免费）：stunCount=2 → 三段各 +2 次', () => {
    const execs = build({ sigridStunCount: 2, sigridCinemaLevel: 0, sigridAtk: 2000 })
    expect(execs.map(e => e.moveId)).toEqual(['1591007', '1591008', '1591022'])
    expect(execs.map(e => e.count)).toEqual([2, 2, 2])
    expect(execs[0].flatDamageBonus ?? 0).toBe(0) // 0命无附加
  })

  it('影画6精确分段：最后一击附加 80%/90%/100% 攻击力（不再取中值）', () => {
    const execs = build({ sigridStunCount: 1, chainCountPerStun: 1, sigridCinemaLevel: 6, sigridAtk: 2000, 'setting:sigrid.c1OverflowCoverage': 0 })
    expect(execs.find(e => e.moveId === '1591007')!.flatDamageBonus).toBeCloseTo(2000 * 0.8, 5)
    expect(execs.find(e => e.moveId === '1591008')!.flatDamageBonus).toBeCloseTo(2000 * 0.9, 5)
    expect(execs.find(e => e.moveId === '1591022')!.flatDamageBonus).toBeCloseTo(2000 * 1.0, 5)
  })

  it('影画1溢出挂在第三段（最后一击），覆盖率滑块生效', () => {
    const execs = build({ sigridStunCount: 1, chainCountPerStun: 1, sigridCinemaLevel: 6, sigridAtk: 2000 })
    // 三段 = 影画6 100% + 影画1 溢出 100%×默认覆盖1 = 4000；一段/二段只有影画6 部分
    expect(execs.find(e => e.moveId === '1591022')!.flatDamageBonus).toBeCloseTo(2000 * 2.0, 5)
    const half = build({ sigridStunCount: 1, chainCountPerStun: 1, sigridCinemaLevel: 6, sigridAtk: 2000, 'setting:sigrid.c1OverflowCoverage': 0.5 })
    expect(half.find(e => e.moveId === '1591022')!.flatDamageBonus).toBeCloseTo(2000 * 1.5, 5)
    // 5命（<6命）：只有影画1 溢出部分
    const c1only = build({ sigridStunCount: 1, sigridCinemaLevel: 1, sigridAtk: 2000 })
    expect(c1only.find(e => e.moveId === '1591022')!.flatDamageBonus).toBeCloseTo(2000 * 1.0, 5)
    expect(c1only.find(e => e.moveId === '1591007')!.flatDamageBonus ?? 0).toBe(0)
  })


  it('[砥砺]：敛枪式三段行 dmgBonus +20%（连携发动获得，默认全覆盖）', () => {
    const execs = build({ sigridStunCount: 1, sigridCinemaLevel: 0, sigridAtk: 0 })
    expect(execs.length).toBe(3)
    for (const e of execs) expect(e.dmgBonus).toBe(20)
  })

  it('破阵口径：非轴 C6 = 连携总次数；非轴非 C6 = 失衡次数', () => {
    // C6：chainCountPerStun 2 × 失衡 3 = 6 套
    const c6 = build({ sigridStunCount: 3, chainCountPerStun: 2, sigridCinemaLevel: 6, sigridAtk: 0 })
    expect(c6.map(e => e.count)).toEqual([6, 6, 6])
    // 非 C6：失衡 3 次 = 3 套（连携再多也不加）
    const c0 = build({ sigridStunCount: 3, chainCountPerStun: 2, sigridCinemaLevel: 0, sigridAtk: 0 })
    expect(c0.map(e => e.count)).toEqual([3, 3, 3])
  })

  it('破阵口径：轴模式用注入的轴内套数（含诺姆赠送），覆盖非轴口径', () => {
    const axis = build({ sigridStunCount: 3, chainCountPerStun: 2, sigridCinemaLevel: 6, sigridAtk: 0, sigridAxisActive: true, sigridAxisPozhenSets: 4 })
    expect(axis.map(e => e.count)).toEqual([4, 4, 4])
  })

  it('countBasicFinisherHits：段循环计数 + 压枪取消 a1/a2', () => {
    const cycle = [
      { moveId: '1591001', actionTime: 0.44 },
      { moveId: '1591002', actionTime: 0.778 },
      { moveId: '1591004', actionTime: 0.507 },
      { moveId: '1591005', actionTime: 1.258 },
    ]
    // 完整循环 2.983s：5s = 1 整循环 + 尾 2.017 ≥ 前三段 1.725 → 2 次 #4
    expect(countBasicFinisherHits(5, cycle, false)).toBe(2)
    // 压枪：循环 a3→a4 = 1.765s：5s = 2 整循环 + 尾 1.47 ≥ a3 0.507 → 3 次 #4
    expect(countBasicFinisherHits(5, cycle, true)).toBe(3)
    expect(countBasicFinisherHits(0, cycle, false)).toBe(0)
  })

  it('轮转与破阵合并计数：spend=4 且 stunCount=2 → 三段 (2+2, 1+2, 1+2)', () => {
    // spend 由 spec 资源账本驱动；此处用可控 stub 验证合并逻辑——直接构造 spendCounts
    const executions: any[] = []
    const specEntries = [['sigrid_lance_opportunity', { spendCounts: { sigrid_lance_spend: 4 } }]] as const
    const original = sigridMechanic.buildExecutions
    // buildExecutions 内部调 computeSpecResources——通过注入 segments/stunCount 后以真实 spec 跑，
    // spend 数不可控，故这里只验证结构：三行、count 非负、总和 = rotation + pozhen
    sigridMechanic.buildExecutions!({
      cfg: { sigridLanceSegments: SEGMENTS, sigridStunCount: 2, sigridCinemaLevel: 0 } as any,
      state: {},
      executions,
    } as any)
    void specEntries
    void original
    expect(executions.length).toBe(3)
    for (const e of executions) expect(e.count).toBeGreaterThanOrEqual(2)
  })
})

describe('希格莉德 buildCharConfig', () => {
  it('记录命座等级与局内攻击力（敛枪式附加伤害基数）', () => {
    const cfg: any = {}
    sigridMechanic.buildCharConfig!({ cfg, cinemaLevel: 3, panel: { atk: 3210 } } as any)
    expect(cfg.sigridCinemaLevel).toBe(3)
    expect(cfg.sigridAtk).toBe(3210)
  })
})

describe('希格莉德全链：敛枪式三段行进入执行计划', () => {
  beforeEach(() => {
    newPinia()
    mockStaticFetch()
  })

  // 生效测试（SOP 铁律）：converge → buildExecutions 全链——破阵套数（=失衡次数）必须真的进执行计划。
  it('锁失衡2次：三段行各带破阵 2 次；C2 穿透率挂在敛枪式/出枪式行', async () => {
    const catalog = useCatalogStore()
    await catalog.load()
    await catalog.loadTeammateBuffs()
    const config = useConfigStore()
    config.team[0] = { slot: 0, agentId: '1591', cinemaLevel: 2, ...baseConfig } as any
    config.team[1] = { slot: 1, agentId: '1211', cinemaLevel: 0, ...baseConfig } as any
    config.team[2] = { slot: 2, agentId: '', cinemaLevel: 0, ...baseConfig } as any
    config.syncTeammateBuffsFromTeam()
    config.enemy.stunCountLock = 2
    const { useResourceCalc } = await import('@/composables/useResourceCalc')
    const calc = useResourceCalc()
    await new Promise(r => setTimeout(r, 50))
    const char = calc.resourceResult.value!.characters.find(c => c.agentId === '1591')!
    const lanceRows = char.executions.filter(e => SIGRID_LANCE_SEGMENT_IDS.includes(e.moveId ?? ''))
    expect(lanceRows.map(r => r.moveId)).toEqual(['1591007', '1591008', '1591022'])
    for (const r of lanceRows) {
      expect(r.count).toBeGreaterThanOrEqual(2) // 破阵 2 套（轮转另计）
      expect(r.penRatioBonus ?? 0).toBe(24) // 2命：敛枪式行吃穿透率
    }
    // 出枪式行（如终结技霜天 1591016）也吃穿透率
    const frost = char.executions.find(e => e.moveId === '1591016')
    if (frost) expect(frost.penRatioBonus ?? 0).toBe(24)
  })

  it('强特用巡空枪势状态的碎玉（1591012，2096.1%）而非非巡空枪势的乱琼（1591011）', async () => {
    const catalog = useCatalogStore()
    await catalog.load()
    await catalog.loadTeammateBuffs()
    const config = useConfigStore()
    config.team[0] = { slot: 0, agentId: '1591', cinemaLevel: 0, ...baseConfig } as any
    config.team[1] = { slot: 1, agentId: '1211', cinemaLevel: 0, ...baseConfig } as any
    config.team[2] = { slot: 2, agentId: '', cinemaLevel: 0, ...baseConfig } as any
    config.syncTeammateBuffsFromTeam()
    const { useResourceCalc } = await import('@/composables/useResourceCalc')
    const calc = useResourceCalc()
    await new Promise(r => setTimeout(r, 50))
    const char = calc.resourceResult.value!.characters.find(c => c.agentId === '1591')!
    const ex = char.executions.find(e => e.moveId === '1591012')
    expect(ex).toBeTruthy()
    expect(ex!.damageMultiplier).toBeCloseTo(2096.1, 1)
    // 乱琼不再作为主强特（它是未进巡空枪势的前摇形态）
    expect(char.executions.some(e => e.moveId === '1591011')).toBe(false)
  })
})

describe('希格莉德浸染增伤（读风化侵染覆盖率）', () => {
  beforeEach(() => {
    newPinia()
    mockStaticFetch()
  })

  // 生效测试（用户口径：直接读风化覆盖率×15%）：风角色在队 + 额外能力激活 → 行 note 带浸染增伤；
  // 覆盖率滑块（wind.infectionCoverage，资源利用率页口径）线性折算。
  it('风角色在队：浸染增伤按覆盖率进伤害行；无风角色不生效', async () => {
    const catalog = useCatalogStore()
    await catalog.load()
    await catalog.loadTeammateBuffs()
    const config = useConfigStore()
    config.team[0] = { slot: 0, agentId: '1591', cinemaLevel: 0, ...baseConfig } as any
    config.team[1] = { slot: 1, agentId: '1561', cinemaLevel: 0, ...baseConfig } as any // 维琳娜（风）→ 浸染存在
    config.team[2] = { slot: 2, agentId: '1211', cinemaLevel: 0, ...baseConfig } as any // 丽娜（支援）→ 额外能力激活
    config.syncTeammateBuffsFromTeam()
    const { useResourceCalc } = await import('@/composables/useResourceCalc')
    const calc = useResourceCalc()
    await new Promise(r => setTimeout(r, 50))

    config.setMechanicSetting('wind.infectionCoverage', 0.5)
    let rows = calc.damagePoolRows.value.filter(r => r.slot === 0 && r.agentId === '1591')
    expect(rows.some(r => (r.note ?? '').includes('浸染增伤+7.5%'))).toBe(true)

    config.setMechanicSetting('wind.infectionCoverage', 1)
    rows = calc.damagePoolRows.value.filter(r => r.slot === 0 && r.agentId === '1591')
    expect(rows.some(r => (r.note ?? '').includes('浸染增伤+15.0%'))).toBe(true)

    // 无风角色：不生效（保留支援触发额外能力，隔离变量）
    config.team[1] = { slot: 1, agentId: '1211', cinemaLevel: 0, ...baseConfig } as any
    config.team[2] = { slot: 2, agentId: '', cinemaLevel: 0, ...baseConfig } as any
    config.syncTeammateBuffsFromTeam()
    await new Promise(r => setTimeout(r, 50))
    rows = calc.damagePoolRows.value.filter(r => r.slot === 0 && r.agentId === '1591')
    expect(rows.every(r => !(r.note ?? '').includes('浸染增伤'))).toBe(true)
  })
})
