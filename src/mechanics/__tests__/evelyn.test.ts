import { describe, expect, it } from 'vitest'
import { computePanelPhases } from '@/composables/resourceCalc/helpers'
import { useResourceCalc } from '@/composables/useResourceCalc'
import {
  EVELYN_ADDITIONAL_DMG,
  EVELYN_C1_DECIBEL_GIFT,
  EVELYN_C4_CRIT_DMG,
  EVELYN_C6_FOLLOWUP_MULTIPLIER,
  EVELYN_CHAIN_MOVE_ID,
  EVELYN_CORE_CRIT_RATE,
  EVELYN_GARROTE_1_MOVE_ID,
  EVELYN_GARROTE_2_MOVE_ID,
  EVELYN_ULT_MOVE_ID,
  computeEvelynCycle,
  evelynMechanic,
} from '@/mechanics/agents/evelyn'
import { setupHarness } from '@/test/harness'

async function setup(mateId = '1141', cinemaLevel = 0) {
  const result = await setupHarness([
    { agentId: '1321', cinemaLevel, parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
    { agentId: mateId, cinemaLevel: 0, parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
  ])
  for (const buff of result.config.globalBuffs) buff.enabled = false
  return result
}

function cycle(overrides: Partial<Parameters<typeof computeEvelynCycle>[0]> = {}) {
  return computeEvelynCycle({
    cinemaLevel: 0,
    garroteCount: 4,
    ultimateCount: 2,
    baseCritRate: 60,
    additionalActive: true,
    restraintCoverage: 1,
    c1DefIgnoreCoverage: 1,
    c4ShieldCoverage: 1,
    c6FollowUpCount: 16,
    ...overrides,
  })
}

describe('伊芙琳（1321）燎索点与总量', () => {
  it('燎索点=绞勒式+终结技各+1，焰舞觉醒后消耗降为净2点', () => {
    const withUlt = cycle({ garroteCount: 4, ultimateCount: 2 })
    expect(withUlt.anchorPoints).toBe(6)
    expect(withUlt.anchorCost).toBe(2)
    expect(withUlt.anchorChainCount).toBe(3)

    const noUlt = cycle({ garroteCount: 4, ultimateCount: 0 })
    expect(noUlt.anchorCost).toBe(3)
    expect(noUlt.anchorChainCount).toBe(1)
  })

  it('绞勒式按I/II型轮转拆分', () => {
    const c = cycle({ garroteCount: 5 })
    expect(c.garroteType1Count).toBe(3)
    expect(c.garroteType2Count).toBe(2)
  })

  it('影画2燎火返还：每25s白嫖一次绞勒式并计入燎索点（差分）', () => {
    const c0 = cycle({ cinemaLevel: 0, garroteCount: 4, ultimateCount: 2, battleTime: 180 })
    expect(c0.c2BonusGarrote).toBe(0)
    expect(c0.garroteCount).toBe(4)
    expect(c0.anchorPoints).toBe(6)
    expect(c0.anchorChainCount).toBe(3)

    // 1命无燎火返还
    expect(cycle({ cinemaLevel: 1, garroteCount: 4, battleTime: 180 }).c2BonusGarrote).toBe(0)

    const c2 = cycle({ cinemaLevel: 2, garroteCount: 4, ultimateCount: 2, battleTime: 180 })
    expect(c2.c2BonusGarrote).toBe(7) // floor(180/25)
    expect(c2.garroteCount).toBe(11) // 4 + 7
    expect(c2.garroteType1Count).toBe(6)
    expect(c2.garroteType2Count).toBe(5)
    expect(c2.anchorPoints).toBe(13) // 11绞勒 + 2终结
    expect(c2.anchorChainCount).toBe(6) // floor(13/2)
  })

  it('核心被动暴击率按覆盖率折算，倍率×1.25需额外能力且暴击≥80%', () => {
    expect(cycle({ restraintCoverage: 0.5 }).coreCritRate).toBe(EVELYN_CORE_CRIT_RATE * 0.5)
    // baseCritRate 语义 = 已含核心被动暴击的总暴击率（applyPanel 已加 coreCritRate，不再叠加）
    expect(cycle({ baseCritRate: 85, restraintCoverage: 1 }).multiplierActive).toBe(true)
    // 总暴击率 65 < 80 → 未生效
    expect(cycle({ baseCritRate: 65, restraintCoverage: 1 }).multiplierActive).toBe(false)
    // 额外能力未激活 → 未生效
    expect(cycle({ baseCritRate: 90, additionalActive: false }).multiplierActive).toBe(false)
  })

  it('影画门控：C1无视防御、C4暴伤、C6追击', () => {
    expect(cycle({ cinemaLevel: 0 }).c1DefIgnore).toBe(0)
    expect(cycle({ cinemaLevel: 1 }).c1DefIgnore).toBe(12)
    expect(cycle({ cinemaLevel: 1, c1DefIgnoreCoverage: 0.5 }).c1DefIgnore).toBe(6)
    expect(cycle({ cinemaLevel: 3 }).c4CritDmg).toBe(0)
    expect(cycle({ cinemaLevel: 4 }).c4CritDmg).toBe(EVELYN_C4_CRIT_DMG)
    expect(cycle({ cinemaLevel: 5 }).c6FollowUpCount).toBe(0)
    expect(cycle({ cinemaLevel: 6, c6FollowUpCount: 10 }).c6FollowUpCount).toBe(10)
  })
})

describe('伊芙琳执行行与定向结算', () => {
  const cfgWith = (cinema: number, extra: Record<string, unknown> = {}) => ({
    panel: { critRate: 60, additionalAbilityActive: 1 },
    battleTime: 0,
    evelynCinemaLevel: cinema,
    evelynGarroteCount: 4,
    evelynRestraintCoverage: 1,
    evelynC1DefIgnoreCoverage: 1,
    evelynC4ShieldCoverage: 1,
    evelynC6FollowUpCount: 16,
    evelynAdditionalActive: true,
    evelynMultiplierActive: false,
    ...extra,
  })

  it('生成真实moveId的绞勒式、追加月辉丝·绊与C6追击行', () => {
    const executions: any[] = []
    evelynMechanic.buildExecutions!({
      cfg: cfgWith(6),
      state: { exSpecialCount: 0, ultimateCount: 2, chainCountTotal: 0 },
      executions,
    } as any)
    expect(executions.find(r => r.moveId === EVELYN_GARROTE_1_MOVE_ID)?.count).toBe(2)
    expect(executions.find(r => r.moveId === EVELYN_GARROTE_2_MOVE_ID)?.count).toBe(2)
    // 燎索点 = 4绞勒 + 2终结 = 6，cost 2 → 3 次追加连携
    expect(executions.find(r => r.moveId === EVELYN_CHAIN_MOVE_ID)?.count).toBe(3)
    const follow = executions.find(r => r.moveId === '1321_c6_moonlight_followup')
    expect(follow.count).toBe(16)
    expect(follow.damageMultiplier).toBe(EVELYN_C6_FOLLOWUP_MULTIPLIER)
    expect(follow.damageMultiplierOverride).toBe(true)
    expect(follow.skillDamageTarget).toBe('chain')
  })

  it('额外能力连携/终结+30%，×1.25按预缩倍率覆盖', () => {
    const chain: any = { moveId: EVELYN_CHAIN_MOVE_ID }
    const ult: any = { moveId: EVELYN_ULT_MOVE_ID }
    const other: any = { moveId: '1321011' }
    evelynMechanic.patchExecutions!({
      cfg: cfgWith(0, { evelynMultiplierActive: true, evelynChainMultScaled: 2073.375, evelynUltMultScaled: 4971.625 }),
      state: { exSpecialCount: 0, ultimateCount: 1, chainCountTotal: 1 },
      executions: [chain, ult, other],
    } as any)
    expect(chain.dmgBonus).toBe(EVELYN_ADDITIONAL_DMG)
    expect(ult.dmgBonus).toBe(EVELYN_ADDITIONAL_DMG)
    expect(other.dmgBonus).toBeUndefined()
    expect(chain.damageMultiplier).toBe(2073.375)
    expect(chain.damageMultiplierOverride).toBe(true)
    expect(ult.damageMultiplier).toBe(4971.625)
    expect(other.damageMultiplierOverride).toBeUndefined()
  })

  it('C6追击吃额外能力连携增伤，非连携招式不吃', () => {
    const follow: any = { moveId: '1321_c6_moonlight_followup' }
    evelynMechanic.patchExecutions!({
      cfg: cfgWith(6),
      state: { exSpecialCount: 0, ultimateCount: 1, chainCountTotal: 0 },
      executions: [follow],
    } as any)
    expect(follow.dmgBonus).toBe(EVELYN_ADDITIONAL_DMG)
  })

  it('执行行差分：影画2额外生成绞勒式并多换月辉丝·绊', () => {
    const mk = (cinema: number, battleTime: number) => {
      const executions: any[] = []
      evelynMechanic.buildExecutions!({
        cfg: cfgWith(cinema, { battleTime }),
        state: { exSpecialCount: 0, ultimateCount: 2, chainCountTotal: 0 },
        executions,
      } as any)
      return executions
    }
    const garrote1 = (rows: any[]) => rows.find(r => r.moveId === EVELYN_GARROTE_1_MOVE_ID)?.count ?? 0
    const garrote2 = (rows: any[]) => rows.find(r => r.moveId === EVELYN_GARROTE_2_MOVE_ID)?.count ?? 0
    const chain = (rows: any[]) => rows.find(r => r.moveId === EVELYN_CHAIN_MOVE_ID)?.count ?? 0
    const c0 = mk(0, 180)
    const c2 = mk(2, 180)
    // 额外7次绞勒式（I型+4、II型+3），燎索点 6→13 使月辉丝·绊 3→6
    expect(garrote1(c2) - garrote1(c0)).toBe(4)
    expect(garrote2(c2) - garrote2(c0)).toBe(3)
    expect(chain(c2) - chain(c0)).toBe(3)
  })
})

describe('伊芙琳完整计算链', () => {
  it('额外能力由击破/支援队友激活，攻击队友不激活', async () => {
    for (const mateId of ['1141', '1151']) {
      const { catalog, config } = await setup(mateId)
      expect((computePanelPhases(0, config, catalog)!.inCombat as any).additionalAbilityActive).toBe(1)
    }
    const neg = await setup('1191')
    expect((computePanelPhases(0, neg.config, neg.catalog)!.inCombat as any).additionalAbilityActive ?? 0).toBe(0)
  })

  it('资源池生成绞勒式/追加连携/C6追击并保留通用失衡提取', async () => {
    await setup('1141', 6)
    const calc = useResourceCalc()
    const evelyn = calc.resourceResult.value!.characters.find(row => row.agentId === '1321')!
    expect(evelyn.executions.some(row => row.moveId === EVELYN_GARROTE_1_MOVE_ID)).toBe(true)
    // 通用连携行 + 燎索点追加连携行（同 moveId 1321015，enrich 后名称归一）
    expect(evelyn.executions.filter(row => row.moveId === EVELYN_CHAIN_MOVE_ID).length).toBeGreaterThanOrEqual(2)
    expect(evelyn.executions.some(row => row.moveId === '1321_c6_moonlight_followup')).toBe(true)
    expect(calc.stunPoolResult.value!.contributions.some(row =>
      row.slot === 0 && row.moveId === EVELYN_CHAIN_MOVE_ID)).toBe(true)
  })

  it('面板增益进入最终面板（核心暴击/影画4暴伤/影画1减防）', async () => {
    await setup('1141', 4)
    const calc = useResourceCalc()
    const evelyn = calc.resourceResult.value!.characters.find(row => row.agentId === '1321')!
    expect(Object.keys(evelyn.specResources ?? {})).toContain('evelyn_cycle')
    const panel = calc.panels.value[0] as any
    // C4：核心暴击+25、影画4暴伤+40、影画1减防+12（C4 已满）；无 C6 追击
    expect(panel.critRate).toBeGreaterThanOrEqual(EVELYN_CORE_CRIT_RATE)
    expect(panel.critDmg).toBeGreaterThanOrEqual(EVELYN_C4_CRIT_DMG)
    expect(panel.enemyDefReduction).toBeGreaterThanOrEqual(12)
  })

  it('覆盖率滑块→面板重算（防守卫冻结，SOP §3.5）', async () => {
    const { catalog, config } = await setup('1141', 4)
    const critOf = () => (computePanelPhases(0, config, catalog)!.inCombat as any).critRate ?? 0
    config.setMechanicSetting('evelyn.restraintCoverage', 1)
    const on = critOf()
    config.setMechanicSetting('evelyn.restraintCoverage', 0)
    const off = critOf()
    expect(on - off).toBeCloseTo(EVELYN_CORE_CRIT_RATE, 1)
  })

  it('影画1进场喧响+1500写入角色配置，未解锁时为1000', async () => {
    await setup('1141', 1)
    const calcC1 = useResourceCalc()
    const cfgC1 = calcC1.resourceConfig.value!.characters.find(c => c.agentId === '1321')!
    expect(cfgC1.initialDecibelGift).toBe(1000 + EVELYN_C1_DECIBEL_GIFT)
  })

  it('无影画1时进场喧响保持1000', async () => {
    await setup('1141', 0)
    const calcC0 = useResourceCalc()
    const cfgC0 = calcC0.resourceConfig.value!.characters.find(c => c.agentId === '1321')!
    expect(cfgC0.initialDecibelGift).toBe(1000)
  })
})
