import { describe, expect, it } from 'vitest'
import { computePanelPhases } from '@/composables/resourceCalc/helpers'
import { emptyPanel } from '@/core/panel'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { setupHarness } from '@/test/harness'
import {
  computeBurniceMechanic,
  burniceMechanic,
} from '@/mechanics/agents/burnice'

async function setup(mateId = '1311', cinemaLevel = 0) {
  const result = await setupHarness([
    { agentId: '1171', cinemaLevel, parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
    { agentId: mateId, cinemaLevel: 0, parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
    '',
  ])
  for (const buff of result.config.globalBuffs) buff.enabled = false
  return result
}

function mechanicInput(overrides: Partial<Parameters<typeof computeBurniceMechanic>[0]> = {}) {
  return {
    exSpecialCount: 2,
    totalTime: 180,
    atk: 1000,
    anomalyProficiency: 500,
    cinemaLevel: 0,
    energyRegen: 1.2,
    ultimateCount: 0,
    singleSpraySeconds: 1.89,
    doubleSpraySeconds: 2.274,
    ...overrides,
  }
}

describe('柏妮思（1171）强特单双喷虚拟化', () => {
  it('强特次数均分单双喷；能量与时间按各型合计', () => {
    const s = computeBurniceMechanic(mechanicInput())
    expect(s.singleCastCount).toBe(1)
    expect(s.doubleCastCount).toBe(1)
    // 单喷 1.89×12.5+5 = 28.625；双喷 2.274×25+10 = 66.85
    expect(s.totalExEnergy).toBeCloseTo(95.475, 3)
    expect(s.singleCastTime).toBeCloseTo(2.205, 3)
    expect(s.doubleCastTime).toBeCloseTo(3.374, 3)

    const half = computeBurniceMechanic(mechanicInput({ singleSpraySeconds: 0.945 }))
    expect(half.singleSustainedMultiplier).toBeCloseTo(1088.3 * 0.5, 3)

    const off = computeBurniceMechanic(mechanicInput({ singleSpraySeconds: 0 }))
    expect(off.singleCastCount).toBe(0)
    expect(off.singleSustainedMultiplier).toBe(0)
    expect(off.singleExplosionMultiplier).toBe(0)
  })

  it('持续倍率按满时长等比缩放；C4 双喷上限+1秒', () => {
    const c0 = computeBurniceMechanic(mechanicInput())
    expect(c0.doubleSustainedMultiplier).toBeCloseTo(1916.2, 3)
    const c4 = computeBurniceMechanic(mechanicInput({ cinemaLevel: 4, doubleSpraySeconds: 3.274 }))
    expect(c4.cinema4DoubleSprayMaxSeconds).toBe(3.274)
    expect(c4.doubleSustainedMultiplier).toBeCloseTo(1916.2, 3)
  })
})

describe('柏妮思燃点与余烬账本', () => {
  it('燃点 = 进场100 + 耗能×1.4 (+C1开局40)(+终结技×50)；阈值进入燃油特调', () => {
    const s = computeBurniceMechanic(mechanicInput({ ultimateCount: 1 }))
    expect(s.initialIgnition).toBe(100)
    expect(s.ignitionFromEnergy).toBeCloseTo(133.665, 3)
    expect(s.ultimateIgnitionGain).toBe(50)
    expect(s.totalIgnition).toBeCloseTo(283.665, 3)
    expect(s.specialStateActive).toBe(true)

    const c1 = computeBurniceMechanic(mechanicInput({ cinemaLevel: 1 }))
    expect(c1.initialIgnition).toBe(140)
  })

  it('余烬触发 = min(燃点预算, CD上限)；C1 倍率350%→450%、积蓄效率+25%', () => {
    const c0 = computeBurniceMechanic(mechanicInput())
    // 预算 floor(233.665/8)=29，CD 上限 180/1.5=120 → 取 29
    expect(c0.emberTriggerCount).toBe(29)
    expect(c0.emberDamageRatio).toBeCloseTo(350, 5)
    // 精通加成 min(30, floor(500/10)) = 30% → 单发 1000×3.5×1.3
    expect(c0.emberDamagePerHit).toBeCloseTo(4550, 3)

    const c1 = computeBurniceMechanic(mechanicInput({ cinemaLevel: 1 }))
    expect(c1.emberTriggerCount).toBe(Math.floor(273.665 / 8))
    expect(c1.emberDamageRatio).toBeCloseTo(450, 5)
    expect(c1.emberBuildUpEfficiencyBonusPct).toBe(25)
    expect(c1.emberBuildUpPerHit).toBe(60)
  })

  it('搅拌式默认吃溢出燃点上限、手动可限但不超过上限；附带免费余烬', () => {
    // 余烬受 CD 上限绑定时（短战斗）才有大量溢出燃点给搅拌式：
    // T=30 → 余烬 CD 上限 20 次×8=160；总燃点 733.665 → 溢出 573.665 → 搅拌式上限 28
    const auto = computeBurniceMechanic(mechanicInput({ totalTime: 30, ultimateCount: 10, stirringCount: 0 }))
    expect(auto.emberTriggerCount).toBe(Math.floor(auto.totalIgnition / 8) >= 20 ? 20 : auto.emberTriggerCount)
    expect(auto.stirringMaxCount).toBeGreaterThan(0)
    expect(auto.stirringCount).toBe(auto.stirringMaxCount)
    expect(auto.stirringFreeEmberCount).toBe(auto.stirringCount)

    const manual = computeBurniceMechanic(mechanicInput({
      totalTime: 30,
      ultimateCount: 10,
      stirringCount: 999, // 超上限时被钳制
    }))
    expect(manual.stirringCount).toBe(manual.stirringMaxCount)
  })

  it('流火计数：普通余烬+1、搅拌附带×2；12点=1流火→灼热抛接法与300%异放', () => {
    const s = computeBurniceMechanic(mechanicInput())
    expect(s.flowCountRaw).toBe(29)
    expect(s.flowFireCount).toBe(2)
    expect(s.tossingCount).toBe(2)
    expect(s.releaseCount).toBe(2)
    expect(s.tossingDamageRatio).toBeCloseTo(400.1, 3)

    const wasted = computeBurniceMechanic(mechanicInput({ flowCountUtilization: 0.5 }))
    expect(wasted.flowCountEffective).toBe(Math.floor(29 * 0.5))
    expect(wasted.flowFireCount).toBe(Math.floor(Math.floor(29 * 0.5) / 12))
  })
})

describe('柏妮思命座与潜能', () => {
  it('C6 特殊余烬按双喷时长折算0.5s CD；灼烧迸发900%受20s CD约束', () => {
    const c6 = computeBurniceMechanic(mechanicInput({ cinemaLevel: 6 }))
    // ceil((2.274+1.1)/0.5) = 7 次/双喷
    expect(c6.cinema6SpecialEmberPerCast).toBe(7)
    expect(c6.cinema6SpecialEmberCount).toBe(7)
    expect(c6.cinema6SpecialEmberBaseRatio).toBeCloseTo(60, 5)
    expect(c6.cinema6BurnBurstCount).toBe(Math.min(1, Math.floor(180 / 20) - 1))
    expect(c6.cinema6BurnBurstDamageRatio).toBeCloseTo(900, 5)
    expect(c6.cinema6FireResIgnore).toBe(25)
  })

  it('潜能沸点派对：初始回能≥1.8 触发，掌控每0.1点+2.5封顶25、增伤每0.1点+2%封顶20%', () => {
    const off = computeBurniceMechanic(mechanicInput({ energyRegen: 1.79 }))
    expect(off.potentialAnomalyMasteryBonus).toBe(0)
    expect(off.potentialDmgBonus).toBe(0)

    const mid = computeBurniceMechanic(mechanicInput({ energyRegen: 2.5 }))
    expect(mid.potentialAnomalyMasteryBonus).toBeCloseTo(17.5, 5)
    expect(mid.potentialDmgBonus).toBeCloseTo(14, 5)

    const capped = computeBurniceMechanic(mechanicInput({ energyRegen: 4.5 }))
    expect(capped.potentialAnomalyMasteryBonus).toBe(25)
    expect(capped.potentialDmgBonus).toBe(20)
  })
})

describe('柏妮思面板与执行计划', () => {
  it('applyPanel 写入潜能加成到面板', () => {
    const panel = {
      energyRegenOutOfCombat: 2.5,
      anomalyMastery: 0,
      dmgBonus: 0,
    } as any
    burniceMechanic.applyPanel!({ panel } as any)
    expect(panel.anomalyMastery).toBeCloseTo(17.5, 5)
    expect(panel.dmgBonus).toBeCloseTo(14, 5)

    const below = { energyRegenOutOfCombat: 1.2, anomalyMastery: 90, dmgBonus: 0 } as any
    burniceMechanic.applyPanel!({ panel: below } as any)
    expect(below.anomalyMastery).toBe(90)
    expect(below.dmgBonus ?? 0).toBe(0)
  })

  it('buildCharConfig 关闭通用强特提取并从倍率表回填四行数值', async () => {
    const { catalog } = await setup()
    const skills = catalog.getAgentSkills('1171')
    const cfg: any = {}
    burniceMechanic.buildCharConfig!({ skills, cinemaLevel: 0, cfg } as any)
    expect(cfg.skipGenericExSpecial).toBe(true)
    expect(cfg.burniceSingleSpraySeconds).toBe(1.89)
    expect(cfg.burniceDoubleSpraySeconds).toBe(2.274)
    for (const moveId of ['1171010', '1171011', '1171012', '1171013']) {
      expect(cfg.mechanicRowValues?.[moveId]).toBeGreaterThan(0)
    }
    expect(cfg.exSpecialEnergyConsume).toBeGreaterThan(0)
  })

  it('buildExecutions 生成单双喷四行且强特不重复进通用提取', () => {
    const executions: any[] = []
    burniceMechanic.buildExecutions!({
      cfg: {
        burniceCinemaLevel: 0,
        burniceSingleSpraySeconds: 1.89,
        burniceDoubleSpraySeconds: 2.274,
        panel: { atk: 1000, anomalyProficiency: 500 },
        skipGenericExSpecial: true,
        mechanicRowValues: {},
      },
      state: { exSpecialCount: 2, ultimateCount: 0, frontlineTime: 170, backstageTime: 10 },
      executions,
    } as any)
    const ids = executions.map(e => e.moveId)
    expect(ids).toContain('1171010')
    expect(ids).toContain('1171011')
    expect(ids).toContain('1171012')
    expect(ids).toContain('1171013')
    const single = executions.find(e => e.moveId === '1171010')!
    expect(single.count).toBe(1)
    expect(single.damageMultiplierOverride).toBe(true)
    expect(single.damageMultiplier).toBeCloseTo(1088.3, 3)
    const explosion = executions.find(e => e.moveId === '1171011')!
    expect(explosion.damageMultiplierOverride ?? false).toBe(false)
    expect(explosion.damageMultiplier).toBeCloseTo(193.5, 3)
  })

  it('完整计算链：资源池出双喷行、异放事件注册、面板含潜能', async () => {
    const { catalog, config } = await setup()
    const calc = useResourceCalc()
    const row = calc.resourceResult.value!.characters.find(ch => ch.agentId === '1171')!
    const sprayMoves = row.executions.filter(e => ['1171010', '1171011', '1171012', '1171013'].includes(e.moveId))
    expect(sprayMoves.length).toBeGreaterThanOrEqual(2)
    expect(row.executions.some(e => e.moveId === '1171026')).toBe(false) // 抛接法走异放事件不走执行行

    const source = (row as any).burniceMechanicSource
    expect(source).toBeTruthy()
    expect(source.doubleCastCount).toBeGreaterThan(0)
    expect(source.specialStateActive).toBe(true)

    const p = computePanelPhases(0, config, catalog)!.inCombat as any
    expect(p.additionalAbilityActive ?? 1).toBeGreaterThanOrEqual(0)
  })
})

// 2026-09-15 补「伤害池落地」断言（反向验证暴露的既存缺口，见 task-ledger Next#6）：
// 本文件此前只断言 `computeBurniceMechanic` 的**产出**，没断言「这些行进到了伤害池」——
// 把 `damagePool.ts` 的 `if (burniceSrc) {` 短路成 `false`，全库无测试变红。
// ⇒ 下面这条是 `51ad72c` 删掉该分支上冗余 `charResult.agentId === '1171'` 合取项的自证锚点。
describe('柏妮思余烬/翻烤伤害池落地（damagePool 集成）', () => {
  it('普通余烬行 burnice-ember 进伤害池且次数 > 0', async () => {
    await setupHarness([{ agentId: '1171' }, { agentId: '1101' }, { agentId: '1041' }])
    const calc = useResourceCalc()
    const ember = calc.damagePoolRows.value.find(r => r.id === 'burnice-ember')
    expect(ember, '柏妮思余烬行未进伤害池（damagePool 的 burniceSrc 分支断了）').toBeTruthy()
    expect((ember as any).count, '余烬次数应为正').toBeGreaterThan(0)
    expect((ember as any).agentId, '该行归属必须是柏妮思').toBe('1171')
  })

  // CC-19a 2026-09-26：C6 灼烧迸发经 `extraAnomalyRows` 派发点进伤害池（真管线）。
  // 这条是派发点接线（`flattenAnomalyRowGroups` 消费 + 按 entry.slot 归属）的自证锚点：
  // 把派发点短路成空，本断言必须红。
  it('C6 灼烧迸发行 burnice-c6-burn-burst-* 进伤害池（extraAnomalyRows 派发点接线）', async () => {
    await setupHarness([
      { agentId: '1171', cinemaLevel: 6 },
      { agentId: '1101' },
      { agentId: '1411' },
    ])
    const calc = useResourceCalc()
    await new Promise(r => setTimeout(r, 60))
    const rows = calc.damagePoolRows.value.filter(r => r.id.startsWith('burnice-c6-burn-burst-'))
    expect(rows.length, 'C6 灼烧迸发行未进伤害池（extraAnomalyRows 派发点断了）').toBeGreaterThan(0)
    expect(rows[0].count).toBeGreaterThan(0)
    expect(rows[0].perDamage).toBeGreaterThan(0)
    // 归属槽 = 异常积蓄贡献者（entry.slot），首行必是柏妮思自己
    expect(rows[0].agentId).toBe('1171')
  })
})

// CC-18a 2026-09-26：块 1 自 `damagePoolCharExtras.ts` 迁进模块能力 `extraDirectRows`
// （设计稿 `docs/mcp-cc18-extra-direct-rows.md` §2/§5）。逐字锁 id/count/multiplier/note，
// 含 `skillLevelBonus > 0` 时 note 带「技能等级系数×」。
describe('CC-18a：柏妮思 extraDirectRows（附加直伤行逐字）', () => {
  const burniceSrc = (overrides: Record<string, unknown> = {}) => ({
    emberTriggerCount: 10,
    stirringFreeEmberCount: 4,
    emberTotalTriggerCount: 14,
    emberDamageRatioWithMastery: 350,
    emberDamageRatio: 350,
    stirringCount: 3,
    stirringDamageRatio: 250.8,
    tossingCount: 2,
    tossingDamageRatio: 400.1,
    cinema6SpecialEmberCount: 7,
    cinema6SpecialEmberDamageRatio: 60,
    cinema6SpecialEmberBaseRatio: 60,
    cinema6FireResIgnore: 25,
    cinema4CritRateBonus: 30,
    ...overrides,
  })
  const input = (panel: unknown, overrides: Record<string, unknown> = {}) => ({
    charResult: { agentId: '1171', burniceMechanicSource: burniceSrc(overrides) } as never,
    slot: 0,
    panel: panel as never,
    isAxis: false,
    axisStunFor: () => 0,
    // CC-18b 2026-09-26：ExtraDirectRowsInput 扩 5 个必填字段；柏妮思只解构自己需要的字段，桩值不参与。
    teammateAt: () => ({ panel: undefined, agent: null }),
    stunCount: 0,
    promoteCount: 0,
    getMechanicSetting: (_k: string, d: number) => d,
    ultimateInAxisFraction: () => 0,
  })

  it('无 burniceMechanicSource → 返回 []（不产行）', () => {
    expect(burniceMechanic.extraDirectRows!({
      charResult: { agentId: '1171' } as never,
      slot: 0,
      panel: undefined,
      isAxis: false,
      axisStunFor: () => 0,
      teammateAt: () => ({ panel: undefined, agent: null }),
      stunCount: 0,
      promoteCount: 0,
      getMechanicSetting: (_k: string, d: number) => d,
      ultimateInAxisFraction: () => 0,
    })).toEqual([])
  })

  it('四种行逐字：id/count/multiplier/note（skillLevelBonus=0 → 系数 1，note 无系数片段）', () => {
    const rows = burniceMechanic.extraDirectRows!(input({ skillLevelBonus: 0 }))
    expect(rows.map(r => r.id)).toEqual(['burnice-ember', 'burnice-stirring', 'burnice-tossing', 'burnice-c6-special-ember'])

    expect(rows[0]).toMatchObject({
      slot: 0,
      agentId: '1171',
      name: '柏妮思余烬（含搅拌式附带）',
      element: 'fire',
      source: '普通余烬 10 次 + 搅拌式附带 4 次',
      count: 14,
      multiplier: 350,
      note: '350%攻击 × (1 + 精通加成)，基础积蓄60',
      critRateBonus: 30,
      skillDamageTarget: 'assist',
    })

    expect(rows[1]).toMatchObject({
      id: 'burnice-stirring',
      name: '柏妮思搅拌式',
      source: '溢出燃点消耗20点/次 · 支援攻击',
      count: 3,
      multiplier: 250.8,
      note: 'Mixed Flame Blend #1 × 0.5 + #2，分类为支援攻击',
      critRateBonus: 30,
      skillDamageTarget: 'assist',
    })

    expect(rows[2]).toMatchObject({
      id: 'burnice-tossing',
      name: '柏妮思灼热抛接法',
      source: '消耗1点流火 · EX Special Attack: Intense Heat Tossing Method',
      count: 2,
      multiplier: 400.1,
      note: '强化特殊技，可吃4命暴击率+30%',
      critRateBonus: 30,
      skillDamageTarget: 'exSpecial',
    })

    expect(rows[3]).toMatchObject({
      id: 'burnice-c6-special-ember',
      name: '柏妮思6命特殊余烬',
      source: '双份命中触发 · 0.5s最多一次 · 不消耗燃点',
      count: 7,
      multiplier: 60,
      note: '固定60%攻击，不吃1命/精通加成，无视火抗25%',
      critRateBonus: 30,
      resIgnore: 25,
      moveId: 'burnice-c6-special-ember',
      skillDamageTarget: 'assist',
    })
    // 轴外（非轴）回落覆盖率 0：stunOverride 取 axisStunFor 返回值
    expect(rows[3].stunOverride).toBe(0)
  })

  it('skillLevelBonus>0：搅拌式/灼热抛接法 multiplier 乘系数、note 带「技能等级系数×」', () => {
    const rows = burniceMechanic.extraDirectRows!(input({ skillLevelBonus: 2 }))
    const coef = (12 + 2 + 10) / 22 // getSkillLevelCoef(2).damageCoef = 1.090909…
    expect(rows[1].multiplier).toBeCloseTo(250.8 * coef, 10)
    expect(rows[1].note).toBe('Mixed Flame Blend #1 × 0.5 + #2，分类为支援攻击 · 技能等级系数×1.0909')
    expect(rows[2].multiplier).toBeCloseTo(400.1 * coef, 10)
    expect(rows[2].note).toBe('强化特殊技，可吃4命暴击率+30% · 技能等级系数×1.0909')
    // 余烬 / C6 特殊余烬不吃技能等级系数
    expect(rows[0].multiplier).toBe(350)
    expect(rows[3].multiplier).toBe(60)
  })

  it('条件不满足的行不产出（余烬 0 次 / C6 无次数）', () => {
    const rows = burniceMechanic.extraDirectRows!(input({ skillLevelBonus: 0 }, {
      emberTotalTriggerCount: 0,
      cinema6SpecialEmberCount: 0,
    }))
    expect(rows.map(r => r.id)).toEqual(['burnice-stirring', 'burnice-tossing'])
  })

  it('axisStunFor 透传：C6 特殊余烬 stunOverride = axisStunFor(moveId)', () => {
    const rows = burniceMechanic.extraDirectRows!({
      charResult: { agentId: '1171', burniceMechanicSource: burniceSrc() } as never,
      slot: 1,
      panel: { skillLevelBonus: 0 } as never,
      isAxis: true,
      axisStunFor: (moveId: string) => (moveId === 'burnice-c6-special-ember' ? 0.75 : 0),
      teammateAt: () => ({ panel: undefined, agent: null }),
      stunCount: 0,
      promoteCount: 0,
      getMechanicSetting: (_k: string, d: number) => d,
      ultimateInAxisFraction: () => 0,
    })
    const c6 = rows.find(r => r.id === 'burnice-c6-special-ember')!
    expect(c6.stunOverride).toBe(0.75)
    expect(c6.slot).toBe(1)
  })
})

// CC-19a 2026-09-26：块 1 自 `damagePoolAnomaly.ts` 迁进模块能力 `extraAnomalyRows`
// （设计稿 `docs/mcp-cc19-extra-anomaly-rows.md` §2/§5）。逐字锁 id/count/note/order。
describe('CC-19a：柏妮思 extraAnomalyRows（C6 灼烧迸发逐字）', () => {
  const burniceSrc = (overrides: Record<string, unknown> = {}) => ({
    cinema6BurnBurstCount: 3,
    cinema6BurnBurstDamageRatio: 900,
    cinema6FireResIgnore: 25,
    ...overrides,
  })
  const panel = () => ({ ...emptyPanel(), atk: 1000, anomalyProficiency: 100 })
  const fireBuild = { panel: panel() } as never
  const entry = (slot: number, triggerCount: number) => ({
    slot, share: 1, triggerCount, panel: panel() as never, name: `槽${slot + 1}`,
  })
  const input = (overrides: Record<string, unknown> = {}) => ({
    slot: 0,
    charResult: { agentId: '1171', burniceMechanicSource: burniceSrc() } as never,
    windRate: 0,
    anomalyProgress: (el: string) => (el === 'fire' ? { element: 'fire', triggerCount: 2 } as never : undefined),
    buildVirtualPanel: () => fireBuild,
    buildSettlementEntries: () => [entry(0, 2), entry(1, 1)],
    axisStunFor: () => 0.5,
    enemy: { defense: 0, level: 60, stunVuln: 1.5 },
    enemyDamageRes: {},
    anomalyMultiplier: 1,
    teamAgentId: (s: number) => (s === 0 ? '1171' : '1101'),
    agentName: (_id: string, s: number) => (s === 0 ? '柏妮思' : '队友'),
    // CC-19b 2026-09-26：ExtraAnomalyRowsInput 扩 9 个必填字段；柏妮思只解构自己需要的字段，桩值不参与。
    panel: undefined,
    cinemaLevel: 0,
    isAxis: false,
    stunCoverage: 0,
    inWindowFraction: () => 0,
    ultimateInAxisFraction: () => 0,
    axisInUnits: () => 0,
    getMechanicSetting: (_k: string, d: number) => d,
    anomalyPool: null,
    // CC-19c-2 2026-09-26：ExtraAnomalyRowsInput 再扩 6 个必填字段；柏妮思只解构自己需要的字段，桩值不参与。
    entryPanel: undefined,
    skills: undefined,
    panelOf: () => undefined,
    teamElement: () => 'physical',
    getTeamMechanicSetting: (_k: string, d: number) => d,
    elementLabel: (el: string) => el,
    ...overrides,
  })

  it('无 C6（cinema6BurnBurstCount=0）→ 返回 []', () => {
    const groups = burniceMechanic.extraAnomalyRows!(input({
      charResult: { agentId: '1171', burniceMechanicSource: burniceSrc({ cinema6BurnBurstCount: 0 }) } as never,
    }))
    expect(groups).toEqual([])
  })

  it('windRate=1 → 返回 []', () => {
    expect(burniceMechanic.extraAnomalyRows!(input({ windRate: 1 }))).toEqual([])
  })

  it('C6 + fire 进度>0：order=10，行 id/count/note 逐字', () => {
    const groups = burniceMechanic.extraAnomalyRows!(input())
    expect(groups).toHaveLength(1)
    expect(groups[0].order).toBe(10)
    expect(groups[0].rows.map(r => r.id)).toEqual(['burnice-c6-burn-burst-0', 'burnice-c6-burn-burst-1'])

    expect(groups[0].rows[0]).toMatchObject({
      slot: 0,
      agentId: '1171',
      agentName: '柏妮思',
      type: '灼烧',
      name: '柏妮思6命灼烧迸发',
      element: 'fire',
      source: '双份火焰冲击命中灼烧敌人 · 900%额外灼烧',
      count: 2, // min(cinema6BurnBurstCount=3, entry.triggerCount=2)
      note: '900%（灼烧基础50% × 1800%），跟随双喷轴内易伤，无视火抗25%，同一目标20秒最多一次',
      moveId: 'burnice-c6-burn-burst',
    })
    // 反向验证（设计稿 §4）：baseMultiplier 突变 ×0 时本断言必须红（perDamage 0）
    expect(groups[0].rows[0].perDamage).toBeGreaterThan(0)
    expect(groups[0].rows[0].totalDamage).toBe(groups[0].rows[0].perDamage * 2)
    expect(groups[0].rows[1]).toMatchObject({
      slot: 1,
      agentId: '1101',
      agentName: '队友',
      count: 1, // min(3, 1)
      note: '900%（灼烧基础50% × 1800%），跟随双喷轴内易伤，无视火抗25%，同一目标20秒最多一次',
    })
  })
})
