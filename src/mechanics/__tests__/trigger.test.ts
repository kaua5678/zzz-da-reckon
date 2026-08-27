import { describe, expect, it } from 'vitest'
import { calcStunPool } from '@/core/stunPool'
import { calcStunMultiplier } from '@/core/anomalyPool/helpers'
import { computePanelPhases } from '@/composables/resourceCalc/helpers'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { setupHarness } from '@/test/harness'
import {
  TRIGGER_ADDITIONAL_MOVE_IDS,
  TRIGGER_C4_DAMAGE_MULTIPLIER,
  TRIGGER_C4_DAZE_MULTIPLIER,
  TRIGGER_COORDINATED_MOVE_ID,
  TRIGGER_DUANLI_MOVE_ID,
  computeTriggerCycle,
  triggerMechanic,
} from '@/mechanics/agents/trigger'

async function setup(mateId = '1081', cinemaLevel = 0) {
  const result = await setupHarness([
    { agentId: '1361', cinemaLevel, parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
    { agentId: mateId, cinemaLevel: 0, parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
    '',
  ])
  for (const buff of result.config.globalBuffs) buff.enabled = false
  return result
}

function cycleInput(overrides: Partial<Parameters<typeof computeTriggerCycle>[0]> = {}) {
  return {
    cinemaLevel: 0,
    battleTime: 180,
    normalCountOverride: 0,
    hellCountOverride: 0,
    sniperHitCountOverride: 0,
    mateExCount: 0,
    mateUltimateCount: 0,
    mateAssistCount: 0,
    ownExSpecialCount: 0,
    ownUltimateCount: 0,
    ...overrides,
  }
}

describe('「扳机」（1361）失衡易伤拐与命座差分', () => {
  it('核心被动失衡易伤+35%；影画1再+20%、影画2全队暴伤+24%', async () => {
    const { catalog, config } = await setup('1081', 0)
    const p0 = computePanelPhases(0, config, catalog)!.inCombat as any
    expect(p0.stunDmgMultiplierBonusAlways).toBeCloseTo(35, 5)

    config.team[0].cinemaLevel = 1
    config.syncTeammateBuffsFromTeam()
    const p1 = computePanelPhases(0, config, catalog)!.inCombat as any
    expect(p1.stunDmgMultiplierBonusAlways - p0.stunDmgMultiplierBonusAlways).toBeCloseTo(20, 5)

    config.team[0].cinemaLevel = 2
    config.syncTeammateBuffsFromTeam()
    const p2 = computePanelPhases(0, config, catalog)!.inCombat as any
    expect(p2.critDmg - p1.critDmg).toBeCloseTo(24, 5)
  })

  it('扳机特色：非失衡时也吃到35%易伤（1.35×），失衡期185%，覆盖率线性插值', () => {
    // 未失衡：无150%基础倍率，但 Always 通道仍提供 1+35%=1.35
    expect(calcStunMultiplier(1.5, 0, 35, 0, false)).toBeCloseTo(1.35, 5)
    // 失衡中：150% + 35% = 185%
    expect(calcStunMultiplier(1.5, 0, 35, 0, true)).toBeCloseTo(1.85, 5)
    // 覆盖率模式：cov=0 全额 1.35；cov=0.4 → 1.35×0.6 + 1.85×0.4 = 1.55；cov=1 全额 1.85
    expect(calcStunMultiplier(1.5, 0, 35, 0, 0)).toBeCloseTo(1.35, 5)
    expect(calcStunMultiplier(1.5, 0, 35, 0, 0.4)).toBeCloseTo(1.55, 5)
    expect(calcStunMultiplier(1.5, 0, 35, 0, 1)).toBeCloseTo(1.85, 5)
    // 影画1后55%：未失衡 1.55、失衡 2.05
    expect(calcStunMultiplier(1.5, 0, 55, 0, false)).toBeCloseTo(1.55, 5)
    expect(calcStunMultiplier(1.5, 0, 55, 0, true)).toBeCloseTo(2.05, 5)
    // 无 Always 通道的普通角色：非失衡仍是 1×（不受影响）
    expect(calcStunMultiplier(1.5, 30, 0, 0, false)).toBe(1)
    expect(calcStunMultiplier(1.5, 30, 0, 0, true)).toBeCloseTo(1.8, 5)
  })
})

describe('「扳机」额外能力·灵目银灯', () => {
  it('公式有阈值和上限，并且只修正三条追加攻击', () => {
    const panel = { critRate: 80, additionalAbilityActive: 1 } as any
    triggerMechanic.applyPanel!({ panel } as any)
    expect(panel.triggerAdditionalStunBuildUp).toBe(60)
    expect(panel.stunBuildUpBonus ?? 0).toBe(0)

    const target = [...TRIGGER_ADDITIONAL_MOVE_IDS].map(moveId => ({ moveId, stunBuildUpBonus: 0 }))
    const other = [{ moveId: '1361010', stunBuildUpBonus: 0 }, { moveId: '1361014', stunBuildUpBonus: 0 }]
    triggerMechanic.patchExecutions!({ cfg: { panel }, executions: [...target, ...other], state: {} } as any)
    for (const exec of target) expect(exec.stunBuildUpBonus).toBe(60)
    for (const exec of other) expect(exec.stunBuildUpBonus).toBe(0)

    const capped = { critRate: 120, additionalAbilityActive: 1 } as any
    triggerMechanic.applyPanel!({ panel: capped } as any)
    expect(capped.triggerAdditionalStunBuildUp).toBe(75)
    const off = { critRate: 120, additionalAbilityActive: 0 } as any
    triggerMechanic.applyPanel!({ panel: off } as any)
    expect(off.triggerAdditionalStunBuildUp ?? 0).toBe(0)
  })

  it('门控：强攻或同属性队友激活，火属性防护队友不激活', async () => {
    const attack = await setup('1081')
    expect((computePanelPhases(0, attack.config, attack.catalog)!.inCombat as any).additionalAbilityActive).toBe(1)
    const electric = await setup('1181')
    expect((computePanelPhases(0, electric.config, electric.catalog)!.inCombat as any).additionalAbilityActive).toBe(1)
    const defense = await setup('1121')
    expect((computePanelPhases(0, defense.config, defense.catalog)!.inCombat as any).additionalAbilityActive ?? 0).toBe(0)
  })
})

describe('「扳机」协奏按CD吃满、冥狱按队友来源（2026-08-25 用户口供）', () => {
  it('180秒下协奏狙杀付费次数由CD反推：C0每3秒一次=60次，影画1后每2秒一次=90次', () => {
    const c0 = computeTriggerCycle(cycleInput())
    expect(c0.normalCdSeconds).toBe(3)
    expect(c0.normalPaidCount).toBe(60)
    const c1 = computeTriggerCycle(cycleInput({ cinemaLevel: 1 }))
    expect(c1.normalCdSeconds).toBe(2)
    expect(c1.normalPaidCount).toBe(90)
  })

  it('冥狱次数=队友强特/终结/支援突击可用次数，并受每类20秒2次限速钳制', () => {
    const cycle = computeTriggerCycle(cycleInput({
      mateExCount: 25, // 超出限速上限，被钳到18
      mateUltimateCount: 8,
      mateAssistCount: 12,
    }))
    expect(cycle.hellRateCapPerType).toBe(18)
    expect(cycle.hellCount).toBe(18 + 8 + 12)
  })

  it('绝意回复端按需：消耗全额支付，狙击命中数由消耗反推；C6补弹随消耗增长且受命中数限制', () => {
    const cycle = computeTriggerCycle(cycleInput({
      cinemaLevel: 6,
      normalCountOverride: 20, // 20×3=60
      hellCountOverride: 10,   // 10×5=50 → 需求110
    }))
    expect(cycle.resolveRequested).toBe(110)
    expect(cycle.resolveSpent).toBe(110)
    // 影画1 单发31.25：ceil(110/31.25)=4 次命中即足够
    expect(cycle.sniperHitCount).toBe(4)
    expect(cycle.c6BulletGainFromSpend).toBe(Math.floor(110 / 25))
    expect(cycle.c6BulletCount).toBe(Math.min(cycle.sniperHitCount, 5 + cycle.c6BulletGainFromSpend))
  })

  it('滑块>0时手动覆盖对应计数；手动狙击命中不足时供给受存量上限封顶', () => {
    const manual = computeTriggerCycle(cycleInput({
      normalCountOverride: 30,
      hellCountOverride: 6,
      sniperHitCountOverride: 2, // 供给 2×25=50 < 需求 30×3+6×5=120
    }))
    expect(manual.normalPaidCount).toBe(30)
    expect(manual.hellCount).toBe(6)
    expect(manual.resolveSupply).toBe(50)
    expect(manual.resolveSpent).toBe(50)
    expect(manual.sniperHitCount).toBe(2)

    const cappedSupply = computeTriggerCycle(cycleInput({ sniperHitCountOverride: 99, cinemaLevel: 1 }))
    expect(cappedSupply.resolveSupply).toBe(125)
  })

  it('协战免费协奏与断离计数：强特送4次、终结送6次，断离≤协战入口数', () => {
    const cycle = computeTriggerCycle(cycleInput({ cinemaLevel: 4, ownExSpecialCount: 1, ownUltimateCount: 1 }))
    expect(cycle.freeCoordinatedCount).toBe(10)
    expect(cycle.coordinatedCount).toBe(90 + 10) // 影画1后CD 2秒：180/2=90
    expect(cycle.c4DuanliCount).toBe(2)

    const starved = computeTriggerCycle(cycleInput({ cinemaLevel: 4, ownExSpecialCount: 0, ownUltimateCount: 3 }))
    expect(starved.c4DuanliCount).toBe(3)
  })

  it('影画1将单发绝意获取提高25%并把存量上限提高到125', () => {
    const c0 = computeTriggerCycle(cycleInput())
    expect(c0.resolveGainPerSniperHit).toBe(25)
    expect(c0.resolveCap).toBe(100)
    const c1 = computeTriggerCycle(cycleInput({ cinemaLevel: 1 }))
    expect(c1.resolveGainPerSniperHit).toBe(31.25)
    expect(c1.resolveCap).toBe(125)
  })
})

describe('「扳机」执行计划与失衡池', () => {
  it('协奏狙杀与冥狱双行以真实moveId进执行计划（后台行、无倍率override走表回填）', () => {
    const cfg: any = {
      triggerCinemaLevel: 4,
      triggerNormalCountOverride: 0,
      triggerHellCountOverride: 0,
      triggerSniperHitOverride: 0,
      triggerMateExCount: 6,
      triggerMateUltimateCount: 2,
      triggerMateAssistCount: 4,
      battleTime: 180,
    }
    const executions: any[] = []
    triggerMechanic.buildExecutions!({
      cfg,
      state: { exSpecialCount: 1, ultimateCount: 1 },
      executions,
    } as any)

    const coordinated = executions.find(e => e.moveId === TRIGGER_COORDINATED_MOVE_ID)
    // 倍率融合：一次协奏狙杀 = 1361008 行×2发 → (90付费+10免费)×2
    expect(coordinated.count).toBe((90 + 10) * 2)
    expect(coordinated.timeBucket).toBe('backstage')
    expect(coordinated.damageMultiplierOverride ?? false).toBe(false)
    expect(coordinated.totalTime).toBe(0)

    // 一次冥狱 = 1361020 连射×3 + 1361022 终结×1 → (6+2+4)次施放
    const hellCasts = 6 + 2 + 4
    const hellBurst = executions.find(e => e.moveId === '1361020')
    expect(hellBurst.count).toBe(hellCasts * 3)
    expect(hellBurst.totalTime).toBe(0)
    const hellFinisher = executions.find(e => e.moveId === '1361022')
    expect(hellFinisher.count).toBe(hellCasts)

    const duanli = executions.find(e => e.moveId === TRIGGER_DUANLI_MOVE_ID)
    expect(duanli.count).toBe(2)
    expect(duanli.damageMultiplier).toBe(TRIGGER_C4_DAMAGE_MULTIPLIER)
    expect(duanli.dazeMultiplier).toBe(TRIGGER_C4_DAZE_MULTIPLIER)
  })

  it('影画4断离的120%冲击力注入失衡池且不吃额外能力加成', () => {
    const cycle = computeTriggerCycle(cycleInput({ cinemaLevel: 4, ownExSpecialCount: 1, ownUltimateCount: 1 }))
    const stunExecs: any[] = []
    triggerMechanic.transformSkillExecutions!({
      slot: 0,
      agent: { damageElement: 'electric' },
      skills: undefined,
      charResult: { specResources: { triggerResolve: cycle } },
      panel: null,
      cinemaLevel: 4,
      team: [],
      dazeCoef: 1,
      stunExecs,
      anomalyExecs: [],
      getRowValue: () => 0,
      normalizeResourceSkillType: (_move: unknown, id: string) => (id === 'basic_attack' ? 'basic' : 'all'),
    } as any)

    const row = stunExecs.find(e => e.moveId === TRIGGER_DUANLI_MOVE_ID)
    expect(row).toBeTruthy()
    expect(row.count).toBe(2)
    expect(row.baseDaze).toBe(TRIGGER_C4_DAZE_MULTIPLIER)
    expect(row.element).toBe('electric')
    expect(row.stunBuildUpBonus ?? 0).toBe(0)

    const pool = calcStunPool({
      executions: stunExecs as never,
      panels: [{ impact: 100 } as never],
      bossStunValue: 10000,
      chainCountPerStun: 3,
    })
    const contribution = pool.contributions.find(c => c.moveId === TRIGGER_DUANLI_MOVE_ID)!
    expect(contribution.totalStun).toBeCloseTo(TRIGGER_C4_DAZE_MULTIPLIER * cycle.c4DuanliCount, 5)
  })
})

describe('「扳机」完整计算链', () => {
  it('协奏狙杀行进资源池并被倍率表回填，失衡池出现其失衡贡献', async () => {
    await setup('1081', 0)
    const calc = useResourceCalc()
    const trigger = calc.resourceResult.value!.characters.find(row => row.agentId === '1361')!
    const coordinated = trigger.executions.find(row => row.moveId === TRIGGER_COORDINATED_MOVE_ID)
    expect(coordinated).toBeTruthy()
    // C0 CD吃满 60 次施放 × 2发
    expect(coordinated!.count).toBeGreaterThanOrEqual(120)
    expect(coordinated!.damageMultiplier ?? 0).toBeGreaterThan(0)
    expect((coordinated as any).skillTableResolved).toBe(true)

    expect(calc.stunPoolResult.value!.contributions.some(row =>
      row.slot === 0 && row.moveId === TRIGGER_COORDINATED_MOVE_ID)).toBe(true)
  })
})
