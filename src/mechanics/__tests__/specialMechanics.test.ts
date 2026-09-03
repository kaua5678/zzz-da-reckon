import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { computeRoxyWindEnergy } from '@/mechanics/agents/roxy'
import { computeClaretSharpResource } from '@/mechanics/agents/claret'
import { computeJaneMechanic } from '@/mechanics/agents/jane'
import { computeBurniceMechanic } from '@/mechanics/agents/burnice'
import { computeYuzuhaMechanic } from '@/mechanics/agents/yuzuha'
import { computeNangongMechanic } from '@/mechanics/agents/nangong'
import { computeRemielleMechanic } from '@/mechanics/agents/remielle'
import { calcAnomalyCritExpect } from '@/core/anomalyPool/helpers'
import { emptyPanel } from '@/core/panel'
import { getAgentMechanic } from '@/mechanics'
import { getAgentSpec } from '@/specs/registry'
import { computeSpecResources } from '@/specs/resources'
import {
  pulchraHuntStepMechanic,
  nekomataPurrMechanic,
  anbyChargeMechanic,
  zhendouHeartfireMechanic,
  yeshuguangMingxinMechanic,
  peiluoProminenceMechanic,
} from '@/mechanics/agents/specPanelBuffs'
import { computeBillyChain, computeBillyHpModel, starlightBillyMechanic } from '@/mechanics/agents/starlightBilly'

describe('Roxy wind energy / wind eye（v12 + 手法）', () => {
  it('手法：每轮强特 3 风能（自旋 2.5s）→ 敬请安息消耗 3 → 恕不远送 1 次巨旋风（1s）', () => {
    const result = computeRoxyWindEnergy({
      exSpecialCount: 4,
      spinSeconds: 2.5,
    })
    expect(result.windEnergyGain).toBe(12)
    expect(result.windEnergyConsumed).toBe(12)
    expect(result.windEyeGenerated).toBe(12)
    expect(result.sendOffCount).toBe(4)
    expect(result.megaTornadoCount).toBe(4)
    expect(result.miniTornadoCount).toBe(0)
  })

  it('终结技 +1 风能（结余 1 不超存量上限 3）', () => {
    const result = computeRoxyWindEnergy({
      exSpecialCount: 2,
      ultimateCount: 2,
      spinSeconds: 2.5,
    })
    expect(result.windEnergyGain).toBe(8)
    expect(result.windEnergyConsumed).toBe(6)
    expect(result.sendOffCount).toBe(2)
  })

  it('兜底：单轮风能不足 3 → 小旋风（1s/个）', () => {
    const result = computeRoxyWindEnergy({
      exSpecialCount: 2,
      spinSeconds: 1,
    })
    expect(result.windEnergyGain).toBe(2)
    expect(result.windEnergyConsumed).toBe(2)
    expect(result.sendOffCount).toBe(0)
    expect(result.miniTornadoCount).toBe(2)
    expect(result.miniTornadoSeconds).toBe(2)
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

  it('applies Ben guard shield via teammate-buffs', () => {
    // 本·守卫护盾暴击改由 teammate-buffs + benMechanic 承担，见 ben.test.ts
    // 比利命中层数已迁移到 agents/billy.ts 模块，见 __tests__/billy.test.ts
    expect(true).toBe(true)
  })

  it('applies Nekomata panel buffs', () => {
    const nekoMap = resources('1021', {}, { frontlineTime: 60, exSpecialCount: 0, ultimateCount: 0, chainCountTotal: 0 })
    expect(nekoMap.nekomata_purr?.total).toBe(100)
    const nekoPanel = emptyPanel()
    transform(nekomataPurrMechanic, '1021', nekoPanel, nekoMap)
    expect(nekoPanel.dmgBonus).toBe(60)

    // 希格莉德（1591）已迁移到 agents/sigrid.ts 模块，面板差分见 __tests__/sigrid.test.ts
    // 珂蕾妲爆破锤已迁移到 agents/koleda.ts 模块，见 __tests__/koleda.test.ts
  })

  it('applies Anby, Grace, Banyue and Jufufu panel buffs', () => {
    const anbyMap = resources('1011', {}, { exSpecialCount: 1 })
    const anbyPanel = emptyPanel()
    transform(anbyChargeMechanic, '1011', anbyPanel, anbyMap)
    expect(anbyPanel.dmgBonus).toBe(45)

    // 可琳专注电锯已迁移到 agents/corin.ts 模块，见 __tests__/corin.test.ts

    // 格莉丝电能（旧面板模块）已迁移到 agents/grace.ts 完整模块：积蓄 +130% 走 applyPanel 的
    // electricAnomalyBuildUpEfficiency（面板差分见 __tests__/grace.test.ts）
    expect(getAgentMechanic('1181')?.id).toBe('agent:grace')
  })

  it('applies Miyabi frost fall defense ignore (影画1 招式限定：霜月#1/#2/#3 = 12/24/36 执行级)', async () => {
    // 旧实现：面板级堆叠（min(6,层)×6%，会泄漏到非霜月招式）——已改为招式限定执行级字段。
    const { config } = await setupHarness([{ agentId: '1091', cinemaLevel: 6 }, '', ''])
    const calc = useResourceCalc()
    const execs = calc.resourceResult.value!.characters[0].executions ?? []
    expect(execs.find(e => e.moveId === '1091029')?.defIgnore).toBe(36)
    expect(execs.find(e => e.moveId === '1091027')?.defIgnore).toBe(12)
    expect(execs.find(e => e.moveId === '1091028')?.defIgnore).toBe(24)
    void config
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
    // 赛斯匪石之盾已迁移到 agents/seth.ts 模块，见 __tests__/seth.test.ts
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

describe('Claret gash / sharpness resource（v12 口径 2026-09-03）', () => {
  const base = {
    basicGashPerSec: 0,
    basicAttackTime: 0,
    exGashValue: 234.96,
    exCount: 1,
    cleaveSpecialCount: 1,
    bloodBurialCount: 1,
    gashCoverage: 1,
    cinemaLevel: 0,
    chainCountTotal: 0,
    ultimateCount: 0,
  }

  it('残痕值 = 表值 × 积蓄效率（核心 50%）→ 每 600 点 = 1 层（上限 3），毁伤 = min(层数, 需求)', () => {
    // (1200 平A + 234.96 EX) × 1.5 = 2152.44 → 3 层；需求 = 1 + 3 = 4 → 消耗 3 → 毁伤 3（cleave 1 + burial 2）
    const result = computeClaretSharpResource({ ...base, basicGashPerSec: 20, basicAttackTime: 60 })
    expect(result.gashValuePct).toBeCloseTo(2152.44, 2)
    expect(result.gashStacks).toBe(3)
    expect(result.gashStackConsumed).toBe(3)
    expect(result.maimCount).toBe(3)
    expect(result.maimFromCleave).toBe(1)
    expect(result.maimFromBurial).toBe(2)
    // 锐能：进场 60 / 秘血铸锋 60 → 1 发、结余 0（旧「毁伤回锐能」口径已废除）
    expect(result.sharpnessGain).toBe(60)
    expect(result.affordableExCount).toBe(1)
    expect(result.sharpnessSpend).toBe(60)
    expect(result.sharpnessRemaining).toBe(0)
  })

  it('影画2：积蓄效率 +20%（1.5→1.7）且不改变锐能（60 恒定）', () => {
    const result = computeClaretSharpResource({ ...base, cinemaLevel: 2 })
    expect(result.gashBuildupMultiplier).toBeCloseTo(1.7, 5)
    expect(result.sharpnessGain).toBe(60)
  })

  it('残痕覆盖率 50%：消耗层数按比例折算', () => {
    const result = computeClaretSharpResource({ ...base, basicGashPerSec: 20, basicAttackTime: 30, gashCoverage: 0.5 })
    // (600+234.96)×1.5=1252.44 → 2 层 × 0.5 = 1 层消耗
    expect(result.gashStackConsumed).toBe(1)
    expect(result.maimCount).toBe(1)
  })

  it('残痕值不足需求时：层数即消耗（不虚构毁伤）', () => {
    // 平A 聚合 40% × 1.5 = 60% → 0 层 → 无毁伤
    const result = computeClaretSharpResource({ ...base, basicGashPerSec: 4, basicAttackTime: 10, exGashValue: 0, exCount: 0 })
    expect(result.gashValuePct).toBeCloseTo(60, 1)
    expect(result.gashStacks).toBe(0)
    expect(result.maimCount).toBe(0)
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
    const result = computeYuzuhaMechanic({ initialAtk: 1500, chainEntryCount: 5 })
    expect(result.sweetnessTotal).toBe(6)
    expect(result.teamAtkBonus).toBe(600)
    expect(result.teamDmgBonus).toBe(15)
  })
})

describe('Nangong beat / vibrato', () => {
  it('converts mastery to impact and accumulates beat income (cap delays, not swallows)', () => {
    const result = computeNangongMechanic({
      anomalyMastery: 150,
      frontlineSeconds: 180,
      battleTime: 180,
      beatInitial: 30,
      minePairs: 10,
      vibratoStacks: 4,
      releaseCount: 1,
    })
    expect(result.impactFromMastery).toBe(40)
    // 收入累进：30 + 180×3.8 + floor(180/6)×12 = 1074（上限100只限瞬时存量）
    expect(result.beatTotal).toBe(1074)
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

describe('加农转子（音擎 14001）直伤事件', () => {
  it('direct_damage 事件进入伤害池（type=直伤）', async () => {
    await setupHarness([
      { agentId: '1041', cinemaLevel: 0, parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0, wEngineId: '14001', wEngineModLevel: 5 },
      { agentId: '1181', cinemaLevel: 0, parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
    ])
    const calc = useResourceCalc()
    // 事件确实被构建并带倍率
    const events = calc.resourceResult.value!.characters.find(c => c.agentId === '1041')!.anomalyEventExecutions
    const ev = events.find(e => e.eventId === 'cannon_rotor_crit_proc')
    expect(ev?.eventType).toBe('direct_damage')
    expect(ev?.damageMultiplier).toBe(200)
    // 事件转成直伤行进池（曾遗漏：加农转子额外伤害从未结算）
    const rows = calc.damagePoolRows.value.filter(r => r.name.includes('加农') && r.type === '直伤')
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect(row.totalDamage).toBeGreaterThan(0)
      expect(row.count).toBeGreaterThan(0)
    }
  })
})
