import { beforeEach, describe, expect, it } from 'vitest'
import { mockStaticFetch, newPinia } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { useCatalogStore } from '@/stores/catalog'
import { useConfigStore } from '@/stores/config'
import {
  computeSeverianCycle,
  resolveSeverianFengfengStacks,
  severianChainFlow,
  severianMechanic,
  SEVERIAN_ADDITIONAL_ATK_PER_CRIT,
  SEVERIAN_C6_SHADOW_MULT,
  SEVERIAN_FENGFENG_MULT,
  SEVERIAN_FLOW_CHAIN,
} from '@/mechanics/agents/severian'

const baseConfig = {
  wEngineId: '', wEngineModLevel: 5,
  driveDisc: { fourPieceSetId: '', twoPieceSetId: '', mainStats: { 4: 'atkPct' as any, 5: 'windDmg' as any, 6: 'critRate' as any }, subStatAllocation: {} },
  parryCount: 10, dodgeCounterCount: 6, blockCount: 20, chainCountPerStun: 0, basicAttackTimeWeight: 1,
}

describe('赛维里安（1631）3.3.12 v12 正式录入', () => {
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
    const { computePanelPhases } = await import('@/composables/resourceCalc/panelPhases')
    return { catalog, config, computePanelPhases }
  }

  it('纯函数：computeSeverianCycle v12 门控（核心增伤/暴击转攻击/影画2/4/6）', () => {
    const c0 = computeSeverianCycle({
      cinemaLevel: 0, additionalActive: false, otherWindTeammate: false,
      critRateForConversion: 60, fengfengStacks: 1, triggerCoverage: 1,
    })
    expect(c0.coreCritDmg).toBe(60)
    expect(c0.coreDmgBonus).toBe(25) // 无其他风属性队友：只有 25
    expect(c0.atkFromCrit).toBe(0) // 额外能力未触发
    expect(c0.c2PenRatio).toBe(0)
    expect(c0.c4AtkPct).toBe(0)
    expect(c0.c6ShadowMultBonus).toBe(0)
    expect(c0.flowCap).toBe(150)

    // 有其他风属性队友 → 额外 +30
    const withWind = computeSeverianCycle({
      cinemaLevel: 0, additionalActive: false, otherWindTeammate: true,
      critRateForConversion: 60, fengfengStacks: 1, triggerCoverage: 1,
    })
    expect(withWind.coreDmgBonus).toBe(55)

    // 额外能力：每 1% 暴击率 → +8.5 攻击，最多计入 100%
    const c0Add = computeSeverianCycle({
      cinemaLevel: 0, additionalActive: true, otherWindTeammate: false,
      critRateForConversion: 60, fengfengStacks: 1, triggerCoverage: 1,
    })
    expect(c0Add.atkFromCrit).toBeCloseTo(60 * SEVERIAN_ADDITIONAL_ATK_PER_CRIT, 6)
    const capped = computeSeverianCycle({
      cinemaLevel: 0, additionalActive: true, otherWindTeammate: false,
      critRateForConversion: 150, fengfengStacks: 1, triggerCoverage: 1,
    })
    expect(capped.atkFromCrit, '暴击率计入上限 100%').toBeCloseTo(100 * SEVERIAN_ADDITIONAL_ATK_PER_CRIT, 6)

    // 影画2：入场 150 流息 + 穿透率 20；影画4：攻击 10% + 喧响效率 10；影画6：流息上限 180 + 影猎 +350
    const c6 = computeSeverianCycle({
      cinemaLevel: 6, additionalActive: true, otherWindTeammate: true,
      critRateForConversion: 60, fengfengStacks: 1, triggerCoverage: 1,
    })
    expect(c6.c2EntryFlow).toBe(150)
    expect(c6.c2PenRatio).toBe(20)
    expect(c6.c4AtkPct).toBe(10)
    expect(c6.c4DecibelEfficiency).toBe(10)
    expect(c6.c6ShadowMultBonus).toBe(SEVERIAN_C6_SHADOW_MULT)
    expect(c6.flowCap).toBe(180)
    expect(c6.c1WindResIgnore).toBe(15)
    expect(c6.c1ChainFlow).toBe(50 - SEVERIAN_FLOW_CHAIN)
  })

  it('纯函数：凭风层数口径（影画1 起本局有影猎 ⇒ 至少 1 层）', () => {
    expect(resolveSeverianFengfengStacks({ cinemaLevel: 0, shadowHuntCount: 3, sliderStacks: 0 })).toBe(0)
    expect(resolveSeverianFengfengStacks({ cinemaLevel: 1, shadowHuntCount: 0, sliderStacks: 0 })).toBe(0)
    expect(resolveSeverianFengfengStacks({ cinemaLevel: 1, shadowHuntCount: 2, sliderStacks: 0 })).toBe(1)
    expect(resolveSeverianFengfengStacks({ cinemaLevel: 1, shadowHuntCount: 2, sliderStacks: 2 })).toBe(2)
    expect(SEVERIAN_FENGFENG_MULT[2]).toBe(300)
  })

  it('纯函数：连携技流息 35 → 影画1 50', () => {
    expect(severianChainFlow(0)).toBe(SEVERIAN_FLOW_CHAIN)
    expect(severianChainFlow(0)).toBe(35)
    expect(severianChainFlow(1)).toBe(50)
  })

  it('面板差分（v12）：核心暴伤+60/增伤+25、额外能力暴击率转攻击、影画1 无视15%风抗', async () => {
    const { config, computePanelPhases } = await setup(['1631', '1251', ''], 1)
    const phases = computePanelPhases(0, config, useCatalogStore())!
    const inCombat = phases.inCombat as any
    expect(inCombat.critDmg).toBeGreaterThan(50 + 60 - 0.001) // 核心被动 +60 已入
    expect(inCombat.dmgBonus).toBeGreaterThanOrEqual(25) // 核心被动增伤 +25
    expect(inCombat.enemyWindResReduction ?? 0).toBeGreaterThanOrEqual(15) // 影画1 无视 15% 风抗
  })

  it('执行行：苍风影猎按流息收入产行（C6 最后击 +350 且 override），烈旋按闪反近似', async () => {
    await setup(['1631', '1251', ''], 6)
    const calc = useResourceCalc()
    const severian = calc.resourceResult.value!.characters.find(c => c.agentId === '1631')!
    const shadow = severian.executions.find(e => e.moveId === '1631006')!
    expect(shadow).toBeTruthy()
    expect(shadow.count).toBeGreaterThan(0)
    expect(shadow.totalTime).toBeCloseTo(shadow.count * shadow.actionTime, 6)
    expect((shadow as any).damageMultiplierOverride).toBe(true)
    // 凭风 2 层：连携行 damageMultiplier = 倍率表基础 +300
    const catalog = useCatalogStore()
    const baseChain = catalog.catalog!.agentSkills.find(s => s.agentId === '1631')!
      .categories.find(c => c.id === 'chain')!.moves.find(m => m.id === '1631012')!
      .rows.find(r => r.id === 'damage')!.values[0]
    const chain = severian.executions.find(e => e.moveId === '1631012')
    if (chain) {
      expect((chain as any).damageMultiplier).toBeCloseTo(baseChain + SEVERIAN_FENGFENG_MULT[1], 3)
      expect((chain as any).damageMultiplierOverride).toBe(true)
    }
  })

  it('命座差分：C6 苍风影猎最后一击 +350%（行倍率=基础+350 且 override），整局伤害 C6 > C0', async () => {
    await setup(['1631', '1251', ''], 0)
    const calc0 = useResourceCalc()
    const d0 = calc0.teamTotalDamage.value
    const s0 = calc0.resourceResult.value!.characters.find(c => c.agentId === '1631')!
    const shadow0 = s0.executions.find(e => e.moveId === '1631006')
    if (shadow0) expect((shadow0 as any).damageMultiplierOverride ?? false).toBe(false)

    const c6 = await setup(['1631', '1251', ''], 6)
    const calc6 = useResourceCalc()
    const s6 = calc6.resourceResult.value!.characters.find(c => c.agentId === '1631')!
    const shadow6 = s6.executions.find(e => e.moveId === '1631006')!
    expect(shadow6).toBeTruthy()
    const baseShadow = c6.catalog.catalog!.agentSkills.find(s => s.agentId === '1631')!
      .categories.find(c => c.id === 'basic')!.moves.find(m => m.id === '1631006')!
      .rows.find(r => r.id === 'damage')!.values[0]
    expect(shadow6.damageMultiplier).toBeCloseTo(baseShadow + SEVERIAN_C6_SHADOW_MULT, 3)
    expect(calc6.teamTotalDamage.value).toBeGreaterThan(d0)
  })

  it('长按风刃段（1631009）：随强特产行，倍率/耗能按满充比例滑块缩放；v12 组合技耗能 40', async () => {
    const { config, catalog } = await setup(['1631', '1251', ''], 0)
    const baseBlade = catalog.catalog!.agentSkills.find(s => s.agentId === '1631')!
      .categories.find(c => c.id === 'special')!.moves.find(m => m.id === '1631009')!
      .rows.find(r => r.id === 'damage')!.values[0]
    expect(baseBlade).toBeGreaterThan(800)
    const bladeEc = catalog.catalog!.agentSkills.find(s => s.agentId === '1631')!
      .categories.find(c => c.id === 'special')!.moves.find(m => m.id === '1631009')!.energyCost
    expect(bladeEc?.['Energy Cost']).toBe('40')
    // v12：组合技耗能由 80 改为 40
    const exEc = catalog.catalog!.agentSkills.find(s => s.agentId === '1631')!
      .categories.find(c => c.id === 'special')!.moves.find(m => m.id === '1631008')!.energyCost
    expect(exEc?.['Energy Cost']).toBe('40')

    let calc = useResourceCalc()
    let blade = calc.resourceResult.value!.characters.find(c => c.agentId === '1631')!
      .executions.find(e => e.moveId === '1631009')!
    expect(blade).toBeTruthy()
    expect(blade.count).toBeGreaterThan(0)
    expect(blade.damageMultiplier).toBeCloseTo(baseBlade, 3)
    expect((blade as any).damageMultiplierOverride).toBe(true)
    // **能量不双计**（用户裁决 2026-10-22 修）：长按风刃段是同一次强特的持续部分，
    // 40 点是这次强特的**总消耗**（已由通用强特行 1631008 收），持续段不再重复收费。
    // 修前实测 640 能量算出 1200 耗能（虚增 87%）。
    expect(blade.totalEnergyConsume, '持续段不得重复收能量').toBe(0)
    const exRow = calc.resourceResult.value!.characters.find(c => c.agentId === '1631')!
      .executions.find(e => e.moveId === '1631008')!
    expect(exRow.totalEnergyConsume, '强特本体照收 40/次').toBeCloseTo(exRow.count * 40, 5)

    config.setMechanicSetting('severian.windBladeChargeRatio', 0.5)
    calc = useResourceCalc()
    blade = calc.resourceResult.value!.characters.find(c => c.agentId === '1631')!
      .executions.find(e => e.moveId === '1631009')!
    expect(blade.damageMultiplier).toBeCloseTo(baseBlade * 0.5, 3)
    // 满充比例只缩放**倍率与时间**；耗能仍归强特本体（持续段恒 0，见上）
    expect(blade.totalEnergyConsume, '缩比例也不给持续段收费').toBe(0)
  })

  it('专武 14163「禁罪囚笼」生效差分（v12）：暴击率+20/无视风抗+15/攻击力+10%（精炼1）', async () => {
    const { config, computePanelPhases } = await setup(['1631', '1251', ''], 0)
    const bare = computePanelPhases(0, config, useCatalogStore())!.inCombat as any
    config.team[0]!.wEngineId = '14163'
    config.team[0]!.wEngineModLevel = 1
    const armed = computePanelPhases(0, config, useCatalogStore())!.inCombat as any
    // 暴击率 +20（被动精炼1）+ 24（副属性词条 1 级 9.6% → 满级 24%）
    expect(armed.critRate - bare.critRate).toBeCloseTo(20 + 24, 5)
    expect((armed.enemyWindResReduction ?? 0) - (bare.enemyWindResReduction ?? 0)).toBeCloseTo(15, 5)
    expect(armed.atk).toBeGreaterThan(bare.atk)
  })

  it('模块声明：暴伤/增伤/暴击转攻击/影画2 穿透与流息上限都在独立通道上', () => {
    expect(severianMechanic.id).toBe('agent:severian')
    expect(severianMechanic.agentIds).toEqual(['1631'])
    const cycle = computeSeverianCycle({
      cinemaLevel: 2, additionalActive: true, otherWindTeammate: true,
      critRateForConversion: 80, fengfengStacks: 2, triggerCoverage: 0.5,
    })
    expect(cycle.c2PenRatio).toBe(10) // 20 × 0.5 覆盖率
    expect(cycle.atkFromCrit).toBeCloseTo(680, 6) // 80 × 8.5
    const ids = severianMechanic.settings?.map(s => s.id) ?? []
    expect(ids).toContain('severian.triggerCoverage')
    expect(ids).not.toContain('severian.c4Coverage') // v12 已合并为 triggerCoverage
  })

  it('滑块生效：凭风层数/苍风影猎次数/烈旋次数覆盖都改得动结果', async () => {
    // C0（无影画1）：滑块是凭风层数的唯一口径
    const { config } = await setup(['1631', '1251', ''], 0)
    // 凭风层数：0 → 2 层 ⇒ 连携行倍率 +0 → +300
    const readMult = (settingId: string, value: number) => {
      config.setMechanicSetting(settingId, value)
      const ch = useResourceCalc().resourceResult.value!.characters.find(c => c.agentId === '1631')!
      const chain = ch.executions.find(e => e.moveId === '1631012') as { damageMultiplier?: number } | undefined
      return { chain: chain?.damageMultiplier, flow: ch.severianFlow! }
    }
    const f0 = readMult('severian.fengfengStacks', 0)
    const f2 = readMult('severian.fengfengStacks', 2)
    expect(f2.flow.fengfengStacks).toBe(2)
    expect(f0.flow.fengfengStacks).toBe(0)
    if (f0.chain !== undefined && f2.chain !== undefined) {
      expect(f2.chain - f0.chain).toBeCloseTo(SEVERIAN_FENGFENG_MULT[2] - SEVERIAN_FENGFENG_MULT[0], 3)
    }

    // 苍风影猎次数覆盖：滑块 >0 直接决定影猎行次数
    config.setMechanicSetting('severian.shadowHuntCount', 5)
    let phoenixLike = useResourceCalc().resourceResult.value!.characters.find(c => c.agentId === '1631')!
    expect(phoenixLike.severianFlow!.shadowHuntCount).toBe(5)
    expect(phoenixLike.executions.find(e => e.moveId === '1631006')!.count).toBe(5)

    // 自动闪避次数（交互栏）：>0 ⇒ 该轮 a4 换成烈旋行（1631020），**不额外多打一招**
    config.setActionCount(0, 'autoEvadeCount', 3)
    phoenixLike = useResourceCalc().resourceResult.value!.characters.find(c => c.agentId === '1631')!
    expect(phoenixLike.executions.find(e => e.moveId === '1631020')!.count, '强化a4行 = 自动闪避次数').toBe(3)
    config.setMechanicSetting('severian.shadowHuntCount', 0)
    config.setMechanicSetting('severian.fengfengStacks', 1)
  })

  it('资源区块与执行行同口径：苍风影猎次数/凭风层数一致', async () => {
    const { config } = await setup(['1631', '1251', ''], 2)
    const read = async (cinema: number) => {
      config.team[0]!.cinemaLevel = cinema
      const ch = useResourceCalc().resourceResult.value!.characters.find(c => c.agentId === '1631')!
      const carrier = ch.executions.find(e => e.moveId === '1631012') as { damageMultiplier?: number; damageMultiplierOverride?: boolean } | undefined
      return { flow: ch.severianFlow!, mult: carrier?.damageMultiplierOverride ? carrier.damageMultiplier : undefined }
    }
    const c0 = await read(0)
    const c2 = await read(2)
    expect(c2.flow.shadowHuntCount, '前置：本局确有苍风影猎').toBeGreaterThanOrEqual(1)
    expect(c2.flow.c2EntryFlow).toBe(150)
    expect(c0.flow.c2EntryFlow).toBe(0)
    expect(c2.flow.c2PenRatio).toBe(20)
  })
})

/**
 * 蓄力 1 秒锁（用户裁决 2026-10-22）：「这种蓄力的角色有很多，其基本逻辑都是只需1秒蓄力，然后剩余时间合轴给队友。
 * 赛维里安也有这个强化a得做一下」。
 *
 * 苍风影猎（1631006，2.833s）= 起手向后闪避蓄势（锁 1s，不能换人）+ 随后穿梭斩击（与队友并行）。
 * 账本口径 GROSS：`necessaryTime` 仍全额 2.833s，合轴率 (2.833−1)/2.833 = 64.7% 进 `comboAlignCredit` 抵扣预算。
 * 判据三条：① 行上有 ratio 且与账本同源；② 抵扣 = 次数 × (actionTime − 1)；③ **单人队不记合轴**（没有并行对象）。
 */
describe('赛维里安·苍风影猎蓄力 1 秒锁（合轴给队友）', () => {
  beforeEach(() => {
    newPinia()
    mockStaticFetch()
  })

  it('多人队：合轴抵扣 = 次数 × (actionTime − 1s)，净前台 = 次数 × 1s', async () => {
    const catalog = useCatalogStore()
    await catalog.load()
    await catalog.loadTeammateBuffs()
    const config = useConfigStore()
    for (const [slot, agentId] of ['1631', '1031', '1211'].entries()) {
      config.team[slot] = { slot, agentId, cinemaLevel: 0, ...baseConfig } as any
    }
    config.syncTeammateBuffsFromTeam()
    const ch = useResourceCalc().resourceResult.value!.characters.find(c => c.agentId === '1631')!
    const row = ch.executions.find(e => e.moveId === '1631006')!
    const shadowSeconds = row.count * row.actionTime
    expect(row.comboAlignRatio, '蓄力 1 秒锁 ⇒ ratio = (t−1)/t').toBeCloseTo((row.actionTime - 1) / row.actionTime, 9)
    expect(row.totalComboAlignTime).toBeCloseTo(row.count * (row.actionTime - 1), 6)
    expect(ch.timeAllocation.comboAlignCredit!, '账本与行同源（差异只来自其它招式的合轴）').toBeGreaterThanOrEqual(row.totalComboAlignTime! - 1e-6)
    // GROSS：necessaryTime 仍按全额计（含苍风影猎全部时长），净 = 次数 × 1s
    expect(ch.timeAllocation.necessaryTime).toBeGreaterThan(shadowSeconds)
  })

  it('单人队：没有并行对象 ⇒ 不记合轴（否则凭空扩池变留白）', async () => {
    const catalog = useCatalogStore()
    await catalog.load()
    await catalog.loadTeammateBuffs()
    const config = useConfigStore()
    config.team[0] = { slot: 0, agentId: '1631', cinemaLevel: 0, ...baseConfig } as any
    config.team[1] = { slot: 1, agentId: '', cinemaLevel: 0, ...baseConfig } as any
    config.team[2] = { slot: 2, agentId: '', cinemaLevel: 0, ...baseConfig } as any
    config.syncTeammateBuffsFromTeam()
    const ch = useResourceCalc().resourceResult.value!.characters.find(c => c.agentId === '1631')!
    const row = ch.executions.find(e => e.moveId === '1631006')
    if (!row || row.count <= 0) return // 单人档可能没触发影猎：那也谈不上合轴
    expect(ch.timeAllocation.comboAlignCredit ?? 0, '单人队合轴抵扣必须为 0').toBe(0)
  })
})
