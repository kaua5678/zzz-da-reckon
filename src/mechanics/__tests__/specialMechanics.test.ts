import { describe, expect, it } from 'vitest'
import { computeRoxyWindEnergy } from '@/mechanics/agents/roxy'
import { computeClaretSharpResource } from '@/mechanics/agents/claret'
import { computeJaneMechanic } from '@/mechanics/agents/jane'
import { computeBurniceMechanic } from '@/mechanics/agents/burnice'
import { computeYuzuhaMechanic } from '@/mechanics/agents/yuzuha'
import { computeNangongMechanic } from '@/mechanics/agents/nangong'
import { computeRemielleMechanic } from '@/mechanics/agents/remielle'
import { miyabiMechanic } from '@/mechanics/agents/miyabi'
import { calcAnomalyCritExpect } from '@/core/anomalyPool/helpers'
import { emptyPanel } from '@/core/panel'
import { getAgentSpec } from '@/specs/registry'
import { computeSpecResources } from '@/specs/resources'
import {
  pulchraHuntStepMechanic,
  billyHitStacksMechanic,
  nekomataPurrMechanic,
  koledaFurnaceMechanic,
  anbyChargeMechanic,
  corinChargeMechanic,
  graceChargeMechanic,
  zhendouHeartfireMechanic,
  yeshuguangMingxinMechanic,
  peiluoProminenceMechanic,
  sethShieldMechanic,
} from '@/mechanics/agents/specPanelBuffs'
import { computeBillyChain, computeBillyHpModel, starlightBillyMechanic } from '@/mechanics/agents/starlightBilly'

describe('Roxy wind energy / wind eye', () => {
  it('gains 1 wind energy per 30 energy spent and triggers wind cannons', () => {
    const result = computeRoxyWindEnergy({
      exSpecialCount: 4,
      exSpecialEnergyConsume: 20,
    })
    expect(result.energySpentTotal).toBe(80)
    expect(result.windEnergyGain).toBe(2)
    expect(result.windCannonCount).toBe(2)
    expect(result.windEyeGenerated).toBe(2)
  })

  it('does not cap total wind energy at 3 and auto-destroys all eyes with cyclone hammer', () => {
    const result = computeRoxyWindEnergy({
      exSpecialCount: 10,
      exSpecialEnergyConsume: 20,
      miniTornadoSeconds: 5,
    })
    expect(result.windEnergyGain).toBe(6)
    expect(result.windCannonCount).toBe(6)
    expect(result.windEyeDestroyedByCyclone).toBe(6)
    expect(result.windEyeDestroyedOther).toBe(0)
    expect(result.miniTornadoDamageSeconds).toBe(30)
  })

  it('respects a manual cyclone hammer count', () => {
    const result = computeRoxyWindEnergy({
      exSpecialCount: 4,
      exSpecialEnergyConsume: 20,
      cycloneHammerCount: 1,
    })
    expect(result.windEyeDestroyedByCyclone).toBe(1)
    expect(result.windEyeDestroyedOther).toBe(1)
    expect(result.miniTornadoDamageSeconds).toBe(5)
  })
})

describe('spec resource panel buffs', () => {
  function resources(agentId: string, cfg: any, state: any): Record<string, any> {
    const spec = getAgentSpec(agentId)!
    return Object.fromEntries(computeSpecResources(spec, cfg as any, state as any))
  }

  function transform(module: any, agentId: string, panel: any, resourceMap: Record<string, any>) {
    delete (panel as any).__specPanelBuffApplied
    module.transformSkillExecutions?.({
      slot: 0,
      agent: { id: agentId },
      skills: undefined,
      charResult: { specResources: resourceMap },
      panel,
      cinemaLevel: 0,
      team: [],
      dazeCoef: 1,
      stunExecs: [],
      anomalyExecs: [],
      getRowValue: () => 0,
      normalizeResourceSkillType: () => 'special',
    } as any)
  }

  it('applies Pulchra hunt step stun bonus', () => {
    const map = resources('1351', {}, { exSpecialCount: 1, chainCountTotal: 0 })
    const panel = emptyPanel()
    transform(pulchraHuntStepMechanic, '1351', panel, map)
    expect(panel.stunBuildUpBonus).toBe(30)
  })

  it('applies Billy hit stack damage', () => {
    const billyMap = resources('1081', {}, { frontlineTime: 100 })
    const billyPanel = emptyPanel()
    transform(billyHitStacksMechanic, '1081', billyPanel, billyMap)
    expect(billyPanel.dmgBonus).toBe(30)
    // 本·守卫护盾暴击改由 teammate-buffs + benMechanic 承担，见 ben.test.ts
  })

  it('applies Nekomata and Koleda panel buffs', () => {
    const nekoMap = resources('1021', {}, { frontlineTime: 60, exSpecialCount: 0, ultimateCount: 0, chainCountTotal: 0 })
    expect(nekoMap.nekomata_purr?.total).toBe(100)
    const nekoPanel = emptyPanel()
    transform(nekomataPurrMechanic, '1021', nekoPanel, nekoMap)
    expect(nekoPanel.dmgBonus).toBe(60)

    // 希格莉德（1591）已迁移到 agents/sigrid.ts 模块，面板差分见 __tests__/sigrid.test.ts

    const koledaMap = resources('1101', { parryCount: 0 }, { exSpecialCount: 1, chainCountTotal: 0, ultimateCount: 0 })
    const koledaPanel = emptyPanel()
    transform(koledaFurnaceMechanic, '1101', koledaPanel, koledaMap)
    expect(koledaPanel.dmgBonus).toBe(25)
  })

  it('applies Anby, Corin, Grace, Banyue and Jufufu panel buffs', () => {
    const anbyMap = resources('1011', {}, { exSpecialCount: 1 })
    const anbyPanel = emptyPanel()
    transform(anbyChargeMechanic, '1011', anbyPanel, anbyMap)
    expect(anbyPanel.dmgBonus).toBe(45)

    const corinMap = resources('1061', {}, { frontlineTime: 40 })
    const corinPanel = emptyPanel()
    transform(corinChargeMechanic, '1061', corinPanel, corinMap)
    expect(corinPanel.dmgBonus).toBe(120)

    const graceMap = resources('1181', {}, { basicAttackTime: 8 })
    const gracePanel = emptyPanel()
    transform(graceChargeMechanic, '1181', gracePanel, graceMap)
    expect(gracePanel.electricAnomalyBuildUpEfficiency).toBe(130)
  })

  it('applies Miyabi frost fall defense ignore and Prometheus guilty presumption', () => {
    const spec = getAgentSpec('1091')!
    const miyabiMap = Object.fromEntries(
      computeSpecResources(spec, {} as any, { basicAttackTime: 0, exSpecialCount: 3, ultimateCount: 0, chainCountTotal: 0, totalEnergy: 0, totalDecibel: 0, necessaryTime: 0, frontlineTime: 0, backstageTime: 0, comboAlignTime: 0 } as any)
    )
    const miyabiPanel = emptyPanel()
    miyabiMechanic.transformSkillExecutions?.({
      slot: 0,
      agent: { id: '1091' } as any,
      skills: undefined,
      charResult: { specResources: miyabiMap, executions: [] } as any,
      panel: miyabiPanel,
      cinemaLevel: 1,
      team: [] as any,
      dazeCoef: 1,
      stunExecs: [] as any,
      anomalyExecs: [] as any,
      getRowValue: () => 0,
      normalizeResourceSkillType: () => 'special',
    })
    expect(miyabiPanel.enemyDefReduction).toBe(36)
    // 普罗米娅有罪推定已迁移到 agents/promia.ts 模块，见 __tests__/promia.test.ts
  })

  it('applies Zhendou heartfire, Yeshuguang mingxin and Aire proficiency', () => {
    const zhendouMap = resources('1441', { parryCount: 3 }, { exSpecialCount: 3, ultimateCount: 0, chainCountTotal: 0 })
    const zhendouPanel = emptyPanel()
    const zhendouBase = emptyPanel()
    transform(zhendouHeartfireMechanic, '1441', zhendouPanel, zhendouMap)
    expect(zhendouPanel.critRate - zhendouBase.critRate).toBe(10)
    expect(zhendouPanel.fireDmg).toBe(20)

    // 叶瞬光合道改走 helpers 常驻；模块负责影画1 剑势初始 / 影画4 喧响
    const yeCfg1: any = {}
    yeshuguangMingxinMechanic.buildCharConfig?.({ cfg: yeCfg1, panel: {} as any, cinemaLevel: 1, skills: { categories: [] } as any, team: [], slot: 0, agent: null as any, wEngineId: '', wEngineModLevel: 1, getRowValue: () => 0 } as any)
    expect(yeCfg1.yeshuguangSwordInitial).toBe(6)
    const yeCfg0: any = {}
    yeshuguangMingxinMechanic.buildCharConfig?.({ cfg: yeCfg0, panel: {} as any, cinemaLevel: 0, skills: { categories: [] } as any, team: [], slot: 0, agent: null as any, wEngineId: '', wEngineModLevel: 1, getRowValue: () => 0 } as any)
    expect(yeCfg0.yeshuguangSwordInitial).toBe(0)
    // 爱芮异常精通已迁移到 agents/aire.ts 模块，见 __tests__/aire.test.ts
  })

  it('applies Peiluo flare and Seth shield panel buffs', () => {
    // 佩洛伊斯耀斑（下分支开局必打，全程覆盖）：能量效率+15%、伤害+40%
    const peiluoMap = resources('1551', {}, { frontlineTime: 60, exSpecialCount: 0, ultimateCount: 0 })
    const peiluoPanel = emptyPanel()
    transform(peiluoProminenceMechanic, '1551', peiluoPanel, peiluoMap)
    expect(peiluoPanel.energyGainEfficiency).toBe(15)
    expect(peiluoPanel.dmgBonus).toBe(40)

    const sethMap = resources('1271', {}, { exSpecialCount: 1 })
    const sethPanel = emptyPanel()
    transform(sethShieldMechanic, '1271', sethPanel, sethMap)
    expect(sethPanel.anomalyProficiency).toBe(100)
  })

  it('builds Billy main loop (drive suppression→cool wheelie), HP pool and star glow move-targeted damage', () => {
    // 星辉仅作用于 连携/终结/强化特殊技/最高马力星光（moveId 级 dmgBonus），不作用于普攻/脱缰/动力压制
    // 主循环结构：动力压制+孤轮 = 0 闪能免费衔接；摇曳（120）/抓地（60）为付费单位
    const chain = computeBillyChain(8, 1, 2, undefined, false, 5)
    expect(chain).toEqual({
      paidEx: 8,
      rocking: 4, // floor(8×1) 但 ≤ floor(8/2)
      traction: 4,
      tractionOut: 4,
      chain: 0, // HP 收敛后填充
      galaxy: 5, // min(闪反 5, 动力压制预算前 ex 8)
      fullThrottle: 2,
      axisMode: false,
    })

    // 银河横行：闪避次数 = 动力压制期间漂移触发，衔接孤轮特技（≤ 动力压制数）
    const galaxyClamped = computeBillyChain(8, 0, 0, undefined, false, 10)
    expect(galaxyClamped.galaxy).toBe(8) // min(10, ex 8)

    // 失衡轴模式：轴内动作按捏轴执行（孤轮/动力压制免费，摇曳/抓地各 60 闪能），轴外剩余闪能打抓地
    const axisChain = computeBillyChain(8, 1, 1, { '1531006': 2, '1531008': 2, '1531011': 2, '1531015': 1 }, true)
    expect(axisChain).toEqual({
      paidEx: 8,
      rocking: 2,
      traction: 6, // 轴内 0 + 轴外剩余 6
      tractionOut: 6,
      chain: 2, // 轴内动力压制/孤轮
      galaxy: 0,
      fullThrottle: 1,
      axisMode: true,
    })

    // HP 池：无回血时动力压制 ≤ floor(75/16) = 4
    const noHeal = computeBillyHpModel(8, 0, 0, 0)
    expect(noHeal.chain).toBe(4)
    expect(noHeal.hpCostPct).toBe(64)
    expect(noHeal.hpFloorPct).toBe(36)

    // HP 池：抓地 8 次回血 240% → 动力压制预算 floor((75+240)/16) = 19
    const withTraction = computeBillyHpModel(8, 0, 8, 0)
    expect(withTraction.chain).toBe(19)
    expect(withTraction.hpCostPct).toBe(304)
    expect(withTraction.hpFloorPct).toBe(36)

    // HP 池：摇曳链 4（回血 60）+ 抓地 4（回血 120）→ 预算 floor(255/16) = 15
    const mixed = computeBillyHpModel(8, 4, 4, 0)
    expect(mixed.chain).toBe(15)
    expect(mixed.healPct).toBe(180)

    // HP 池：普攻第四段衔接折扣（耗血减半）→ 平均耗血 8%，预算 floor(315/8) = 39
    const discounted = computeBillyHpModel(8, 0, 8, 0, 1)
    expect(discounted.chain).toBe(39)
    expect(discounted.hpCostPct).toBe(312)

    // HP 池：失衡轴模式轴内动力压制不裁剪，轴外补足剩余预算
    const axisHp = computeBillyHpModel(8, 2, 6, 2, 0)
    expect(axisHp.chain).toBe(17) // max(轴内 2, 预算 floor((75+210)/16) = 17)

    const billyCfg = {
      panel: { additionalAbilityActive: 1 },
      billyCinemaLevel: 0,
    } as any
    const billyState = {
      exSpecialCount: 2,
      chainCountTotal: 2,
      ultimateCount: 2,
      frontlineTime: 60,
      basicAttackTime: 40,
    } as any
    const billyExecs = [
      { moveId: '1531008', dmgBonus: 0 }, // 孤轮特技
      { moveId: '1531011', dmgBonus: 0 }, // 摇曳步伐
      { moveId: '1531009', dmgBonus: 0 }, // 抓地轮毂
      { moveId: '1531015', dmgBonus: 0 }, // 连携
      { moveId: '1531016', dmgBonus: 0 }, // 终结
      { moveId: '1531010', dmgBonus: 0 }, // 最高马力星光
      { moveId: '1531001', dmgBonus: 0 }, // 普攻（不应吃星辉）
    ] as any[]
    starlightBillyMechanic.patchExecutions?.({ cfg: billyCfg, state: billyState, executions: billyExecs } as any)
    for (const exec of billyExecs.slice(0, 6)) {
      expect(exec.dmgBonus).toBe(40) // 2 层 × 20%
    }
    expect(billyExecs[6].dmgBonus).toBe(0)

    // 额外能力未触发（无击破/防护/支援）时星辉不生效
    const inactiveCfg = { ...billyCfg, panel: { additionalAbilityActive: 0 } }
    const inactiveExecs = [{ moveId: '1531010', dmgBonus: 0 }] as any[]
    starlightBillyMechanic.patchExecutions?.({ cfg: inactiveCfg, state: billyState, executions: inactiveExecs } as any)
    expect(inactiveExecs[0].dmgBonus).toBe(0)
  })

  it('splits Peiluo ultimate row into three branches', () => {
    // 3 次大招 + 决算 1 → 下1 右1 上1（细分断言在 peiluo.test.ts）
    const execs: any[] = [{ moveId: '1551015', category: 'chain', count: 3, actionTime: 3, comboAlignRatio: 0, decibelRecovery: 0 }]
    peiluoProminenceMechanic.patchExecutions?.({ cfg: { peiluoVerdictCount: 1 }, state: { ultimateCount: 3 }, executions: execs } as any)
    expect(execs.find((e: any) => e.moveId === '1551015')?.count).toBe(1)
    expect(execs.find((e: any) => e.moveId === '1551014')?.count).toBe(1)
    expect(execs.find((e: any) => e.moveId === '1551016')?.count).toBe(1)
  })

  it('builds Billy radiant star (C6) and Anby zero vortex executions', () => {
    // 煊赫星辉：层数 = 普攻四段(≈平A/2) + 孤轮 + 连携，6 层封顶；
    // 消耗 = min(层数, 2 × (终结技 + 最高马力星光))，每层 100% 贯穿力附伤
    const billyCfg = { billyCinemaLevel: 6 } as any
    const billyState = {
      frontlineTime: 12,
      exSpecialCount: 2,
      chainCountTotal: 1,
      ultimateCount: 1,
      basicAttackTime: 10,
    }
    const billyExecs: any[] = []
    starlightBillyMechanic.buildExecutions?.({ cfg: billyCfg, state: billyState as any, executions: billyExecs })
    const radiant = billyExecs.find(e => e.skillTableNote?.includes('煊赫星辉'))
    expect(radiant?.count).toBe(1)
    // 决意 = 战斗时间×2(360) + attack_data + 额外 → 最高马力星光 4 次；煊赫星辉消耗 = min(6 层, 2×(1 终结 + 4 星光)) = 6 层
    expect(radiant?.damageMultiplier).toBe(600)

    // 载体封顶/无载体：短战斗时间（battleTime 10 → 回能 20，决意总量 <100 → 无最高马力星光）+ 无终结 → 无附伤
    const noCarrierExecs: any[] = []
    starlightBillyMechanic.buildExecutions?.({
      cfg: { ...billyCfg, billyCinemaLevel: 6, battleTime: 10 },
      state: { ...billyState, ultimateCount: 0 } as any,
      executions: noCarrierExecs,
    })
    expect(noCarrierExecs.find(e => e.skillTableNote?.includes('煊赫星辉'))).toBeUndefined()
    // 零号·安比电磁涡流已迁移到 agents/anbyZero.ts 模块，见 __tests__/anbyZero.test.ts
  })
})

describe('Claret gash / sharpness resource', () => {
  it('consumes gash stacks and converts maim into personal resources', () => {
    const result = computeClaretSharpResource({
      teammateFrontlineSeconds: 100,
      exSpecialCount: 2,
      cleaveSpecialCount: 1,
      bloodBurialCount: 1,
      gashCoverage: 1,
      cinemaLevel: 0,
      sharpnessCost: 60,
    })
    expect(result.gashValuePct).toBeCloseTo(300)
    expect(result.gashStacks).toBeCloseTo(9)
    expect(result.gashStackConsumed).toBe(2)
    expect(result.maimCount).toBe(2)
    expect(result.personalResourceGain).toBe(2)
    expect(result.personalResourcesConsumed).toBe(2)
    expect(result.personalResourceDamageBonusPct).toBe(13)
    expect(result.sharpnessGain).toBe(2)
    expect(result.sharpnessSpend).toBe(0)
    expect(result.sharpnessRemaining).toBe(2)
  })

  it('adds M2 sharpness recovery per maim', () => {
    const result = computeClaretSharpResource({
      teammateFrontlineSeconds: 100,
      exSpecialCount: 2,
      cleaveSpecialCount: 1,
      bloodBurialCount: 1,
      gashCoverage: 1,
      cinemaLevel: 2,
      sharpnessCost: 60,
    })
    expect(result.sharpnessGain).toBe(2.5)
    expect(result.sharpnessRemaining).toBe(2.5)
  })

  it('scales consumed stacks by gash coverage', () => {
    const result = computeClaretSharpResource({
      teammateFrontlineSeconds: 100,
      exSpecialCount: 2,
      cleaveSpecialCount: 1,
      bloodBurialCount: 1,
      gashCoverage: 0.5,
      cinemaLevel: 0,
      sharpnessCost: 60,
    })
    expect(result.gashStackConsumed).toBe(1)
    expect(result.maimCount).toBe(1)
  })

  it('treats one gash stack as 33.33% gash value from teammate frontline time', () => {
    const result = computeClaretSharpResource({
      teammateFrontlineSeconds: 12,
      exSpecialCount: 5,
      cleaveSpecialCount: 1,
      bloodBurialCount: 1,
      gashCoverage: 1,
      cinemaLevel: 0,
      sharpnessCost: 60,
    })
    expect(result.gashValuePct).toBeCloseTo(36, 1)
    expect(result.gashStacks).toBeCloseTo(1.08, 1)
    expect(result.gashStackConsumed).toBe(1)
  })
})

describe('Jane mechanic', () => {
  it('scales assault crit rate with anomaly proficiency', () => {
    const result = computeJaneMechanic({ anomalyProficiency: 100, frenzyActive: true, frontlineSeconds: 60 })
    expect(result.assaultCritRate).toBe(30)
    expect(result.assaultCritBaseRate).toBe(20)
    expect(result.assaultCritDmgBonus).toBe(30)
    expect(result.frenzyBuildUpBonus).toBe(25)
    expect(result.atkFromMastery).toBe(0)
    expect(result.biteSeconds).toBe(60)
  })

  it('converts mastery above 120 into attack in frenzy', () => {
    const result = computeJaneMechanic({ anomalyProficiency: 200, frenzyActive: true, frontlineSeconds: 0 })
    expect(result.atkFromMastery).toBe(160)
  })

  it('limits Jane potential assault crit dmg to Jane-triggered assault only', () => {
    const janePanel = {
      anomalyCritRate: 0,
      anomalyCritDmg: 0,
      assaultCritRate: 30,
      assaultCritDmg: 50,
      janeAssaultCritDmgBonus: 30,
    } as any
    const windPanel = {
      anomalyCritRate: 0,
      anomalyCritDmg: 0,
      assaultCritRate: 0,
      assaultCritDmg: 0,
    } as any

    const directAssault = calcAnomalyCritExpect(janePanel, 'physical', undefined)
    const turbulence = calcAnomalyCritExpect(windPanel, 'physical', janePanel, { includeSelfAssaultBonus: false })

    expect(directAssault).toBeCloseTo(1 + 0.3 * 0.8)
    expect(turbulence).toBeCloseTo(1 + 0.3 * 0.5)
  })
})

describe('Burnice ignition / ember', () => {
  it('computes fixed-count EX cast, ignition gain and ember triggers', () => {
    const result = computeBurniceMechanic({
      exSpecialCount: 4,
      totalTime: 180,
      atk: 1000,
      anomalyProficiency: 100,
      cinemaLevel: 1,
      energyRegen: 2.0,
      ultimateCount: 0,
      singleSpraySeconds: 1.89,
      doubleSpraySeconds: 2.274,
    })
    expect(result.singleCastCount).toBe(2)
    expect(result.doubleCastCount).toBe(2)
    expect(result.singleCastEnergy).toBeCloseTo(28.625)
    expect(result.doubleCastEnergy).toBeCloseTo(66.85)
    expect(result.totalExEnergy).toBeCloseTo(190.95)
    expect(result.ignitionFromEnergy).toBeCloseTo(267.33)
    expect(result.initialIgnition).toBe(140)
    expect(result.totalIgnition).toBeCloseTo(407.33)
    expect(result.specialStateActive).toBe(true)
    expect(result.emberTriggerCount).toBe(50)
    expect(result.emberDamageRatio).toBe(450)
    expect(result.emberDamagePerHit).toBeCloseTo(4950)
    expect(result.emberTotalDamage).toBeCloseTo(247500)
    expect(result.emberBuildUpPerHit).toBe(60)
    expect(result.emberBuildUpEfficiencyBonusPct).toBe(25)
    expect(result.emberTotalBuildUp).toBe(3000)
    expect(result.emberTotalTriggerCount).toBe(50)
    expect(result.stirringMaxCount).toBe(0)
    expect(result.stirringCount).toBe(0)
    expect(result.flowCountRaw).toBe(50)
    expect(result.flowCountEffective).toBe(50)
    expect(result.flowFireCount).toBe(4)
    expect(result.tossingCount).toBe(4)
    expect(result.releaseCount).toBe(4)
    expect(result.releaseMultiplier).toBe(300)
    expect(result.stirringDamageRatio).toBeCloseTo(591.4)
    expect(result.tossingDamageRatio).toBeCloseTo(400.1)
    expect(result.potentialAnomalyMasteryBonus).toBe(5)
    expect(result.potentialDmgBonus).toBe(4)
    expect(result.emberCooldownSeconds).toBe(1.35)
  })

  it('adds 50 ignition per ultimate without a battle-wide cap', () => {
    const result = computeBurniceMechanic({
      exSpecialCount: 0,
      totalTime: 180,
      atk: 1000,
      anomalyProficiency: 0,
      energyRegen: 1.2,
      ultimateCount: 1,
      singleSpraySeconds: 1.89,
      doubleSpraySeconds: 2.274,
    })
    expect(result.ultimateIgnitionGain).toBe(50)
    expect(result.totalIgnition).toBe(150)
    expect(result.emberTriggerCount).toBe(18)
    expect(result.emberDamageRatio).toBe(350)
    expect(result.emberBuildUpPerHit).toBe(60)
    expect(result.emberBuildUpEfficiencyBonusPct).toBe(0)
    expect(result.emberTotalBuildUp).toBe(1080)
  })

  it('applies C2/C4/C6 constellation logic', () => {
    const result = computeBurniceMechanic({
      exSpecialCount: 20,
      totalTime: 180,
      atk: 1000,
      anomalyProficiency: 100,
      cinemaLevel: 6,
      energyRegen: 1.2,
      ultimateCount: 0,
      singleSpraySeconds: 1.89,
      doubleSpraySeconds: 3.274,
    })
    expect(result.initialIgnition).toBe(140)
    expect(result.cinema2TeamPenRatio).toBe(20)
    expect(result.cinema4CritRateBonus).toBe(30)
    expect(result.cinema4DoubleSprayMaxSeconds).toBe(3.274)
    expect(result.doubleSpraySeconds).toBe(3.274)
    expect(result.cinema6FireResIgnore).toBe(25)
    expect(result.cinema6SpecialEmberPerCast).toBe(9)
    expect(result.cinema6SpecialEmberCount).toBe(90)
    expect(result.cinema6SpecialEmberBaseRatio).toBe(60)
    expect(result.cinema6SpecialEmberDamageRatio).toBe(60)
    expect(result.cinema6SpecialEmberDamagePerHit).toBe(600)
    expect(result.cinema6SpecialEmberTotalDamage).toBe(54000)
    expect(result.cinema6BurnBurstCount).toBe(8)
    expect(result.cinema6BurnBurstMultiplier).toBe(1800)
    expect(result.cinema6BurnBurstDamageRatio).toBe(900)
  })

  it('derives stirring overflow and flow fire utilization', () => {
    const result = computeBurniceMechanic({
      exSpecialCount: 20,
      totalTime: 180,
      atk: 1000,
      anomalyProficiency: 0,
      cinemaLevel: 0,
      energyRegen: 1.2,
      ultimateCount: 0,
      singleSpraySeconds: 1.89,
      doubleSpraySeconds: 2.274,
      stirringCount: 10,
      flowCountUtilization: 0.5,
    })
    expect(result.emberTriggerCount).toBe(120)
    expect(result.stirringMaxCount).toBe(23)
    expect(result.stirringCount).toBe(10)
    expect(result.stirringFreeEmberCount).toBe(10)
    expect(result.emberTotalTriggerCount).toBe(130)
    expect(result.flowCountRaw).toBe(140)
    expect(result.flowCountEffective).toBe(70)
    expect(result.flowFireCount).toBe(5)
    expect(result.tossingCount).toBe(5)
    expect(result.releaseCount).toBe(5)
  })

  it('drops the whole cast type when spray seconds is zero', () => {
    const result = computeBurniceMechanic({
      exSpecialCount: 4,
      totalTime: 180,
      atk: 1000,
      anomalyProficiency: 0,
      energyRegen: 1.2,
      ultimateCount: 0,
      singleSpraySeconds: 0,
      doubleSpraySeconds: 2.274,
    })
    expect(result.singleCastCount).toBe(0)
    expect(result.singleExplosionMultiplier).toBe(0)
    expect(result.doubleCastCount).toBe(2)
    expect(result.doubleCastEnergy).toBeCloseTo(66.85)
  })

  it('supports fractional virtual EX counts after averaging', () => {
    const result = computeBurniceMechanic({
      exSpecialCount: 3,
      totalTime: 180,
      atk: 1000,
      anomalyProficiency: 0,
      energyRegen: 1.2,
      ultimateCount: 0,
      singleSpraySeconds: 1.89,
      doubleSpraySeconds: 2.274,
    })
    expect(result.singleCastCount).toBe(1.5)
    expect(result.doubleCastCount).toBe(1.5)
    expect(result.totalExEnergy).toBeCloseTo(143.2125)
    expect(result.singleSustainedMultiplier).toBeCloseTo(1088.3)
    expect(result.doubleSustainedMultiplier).toBeCloseTo(1916.2)
  })

  it('activates potential when total energy regen reaches 1.8 after percentage bonus', () => {
    const result = computeBurniceMechanic({
      exSpecialCount: 2,
      totalTime: 180,
      atk: 1000,
      anomalyProficiency: 0,
      energyRegen: 2.808,
      ultimateCount: 0,
      singleSpraySeconds: 1.89,
      doubleSpraySeconds: 2.274,
    })
    expect(result.potentialAnomalyMasteryBonus).toBe(25)
    expect(result.potentialDmgBonus).toBe(20)
    expect(result.emberCooldownSeconds).toBe(1.35)
  })
})

describe('Yuzuha sweetness / Liwang Wish', () => {
  it('caps sweetness and team atk bonus', () => {
    const result = computeYuzuhaMechanic({ initialAtk: 1500, chainEntryCount: 5, chargedCannonCount: 0 })
    expect(result.sweetnessTotal).toBe(6)
    expect(result.teamAtkBonus).toBe(600)
    expect(result.teamDmgBonus).toBe(15)
  })
})

describe('Nangong beat / vibrato', () => {
  it('converts mastery to impact and caps beat regen', () => {
    const result = computeNangongMechanic({
      anomalyMastery: 150,
      totalTime: 180,
      anomalyProcCount: 5,
      vibratoStacks: 4,
      releaseCount: 1,
    })
    expect(result.impactFromMastery).toBe(40)
    expect(result.beatTotal).toBe(100)
    expect(result.vibratoStacks).toBe(4)
    expect(result.releaseRatios.ether).toBe(720)
  })
})

describe('Remielle voidflare / luminize', () => {
  it('derives refringe coefficient and luminize multiplier from proficiency', () => {
    const result = computeRemielleMechanic({ anomalyProficiency: 170 })
    expect(result.refringeCoefficient).toBeCloseTo(3.4)
    expect(result.luminizeMultiplierBonus).toBeCloseTo(17)
  })
})
