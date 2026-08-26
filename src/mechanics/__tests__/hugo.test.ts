import { describe, expect, it } from 'vitest'
import { computePanelPhases } from '@/composables/resourceCalc/helpers'
import { useResourceCalc } from '@/composables/useResourceCalc'
import {
  HUGO_ADDITIONAL_CHAIN_DMG,
  HUGO_ADDITIONAL_VERDICT_DMG,
  HUGO_C1_CRIT_DMG,
  HUGO_C1_CRIT_RATE,
  HUGO_C2_DEF_IGNORE,
  HUGO_C4_ICE_RES_IGNORE,
  HUGO_C6_DMG_BONUS,
  HUGO_EX_FINAL_ACTION_TIME,
  HUGO_EX_OPEN_MOVE_ID,
  HUGO_ULT_MOVE_ID,
  computeHugoCycle,
  computeHugoVerdictMultiplier,
  hugoMechanic,
  isHugoEndsWindowMove,
} from '@/mechanics/agents/hugo'
import { setupHarness } from '@/test/harness'

async function setup(mateId = '1141', cinemaLevel = 0, thirdId = '') {
  const result = await setupHarness([
    { agentId: '1291', cinemaLevel, parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
    { agentId: mateId, cinemaLevel: 0, parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
    thirdId ? { agentId: thirdId, cinemaLevel: 0 } : '',
  ])
  for (const buff of result.config.globalBuffs) buff.enabled = false
  return result
}

describe('雨果（1291）核心与决算', () => {
  it('决算倍率按剩余失衡时间分段增长并封顶3400%', () => {
    expect(computeHugoVerdictMultiplier(0)).toBe(1000)
    expect(computeHugoVerdictMultiplier(1)).toBe(1280)
    expect(computeHugoVerdictMultiplier(5)).toBe(2400)
    expect(computeHugoVerdictMultiplier(6)).toBe(2500)
    expect(computeHugoVerdictMultiplier(15)).toBe(3400)
    expect(computeHugoVerdictMultiplier(99)).toBe(3400)
  })

  it('按强特/终结决算比例生成总量，C6将轴外强特转为固定决算', () => {
    const c0 = computeHugoCycle({
      cinemaLevel: 0,
      exSpecialCount: 4,
      ultimateCount: 2,
      exVerdictRatio: 0.5,
      ultimateVerdictRatio: 1,
      remainingStunSeconds: 5,
      echoCoverage: 0.5,
    })
    expect(c0.exVerdictCount).toBe(2)
    expect(c0.exNormalCount).toBe(2)
    expect(c0.ultimateVerdictCount).toBe(2)
    expect(c0.c6OutOfStunVerdictCount).toBe(0)
    expect(c0.echoCoverage).toBe(0.5)

    const c6 = computeHugoCycle({
      cinemaLevel: 6,
      exSpecialCount: 4,
      ultimateCount: 0,
      exVerdictRatio: 0.5,
      ultimateVerdictRatio: 0,
      remainingStunSeconds: 5,
      echoCoverage: 0,
    })
    expect(c6.c6OutOfStunVerdictCount).toBe(2)
    expect(c6.echoCoverage).toBe(1)
  })

  it('补齐强特终结段时间且终结技决算只追加额外倍率', () => {
    const executions: any[] = []
    hugoMechanic.buildExecutions!({
      cfg: {
        hugoCinemaLevel: 0,
        hugoAdditionalActive: false,
        hugoExVerdictRatio: 1,
        hugoUltimateVerdictRatio: 1,
        hugoRemainingStunSeconds: 5,
        hugoEchoCoverage: 1,
      },
      state: { exSpecialCount: 2, ultimateCount: 1 },
      executions,
    } as any)
    const exFinal = executions.find(row => row.moveId === '1291_ex_verdict_final')
    expect(exFinal.actionTime).toBe(HUGO_EX_FINAL_ACTION_TIME)
    expect(exFinal.totalTime).toBe(2 * HUGO_EX_FINAL_ACTION_TIME)
    expect(exFinal.energyConsume).toBe(0)

    const ultimateBonus = executions.find(row => row.moveId === '1291_ultimate_verdict_bonus')
    expect(ultimateBonus.actionTime).toBe(0)
    expect(ultimateBonus.damageMultiplier).toBe(computeHugoVerdictMultiplier(5))
  })

  it('其他击破队友按1/2名分别提供300/900固定攻击', async () => {
    const one = await setup('1141')
    const p1 = computePanelPhases(0, one.config, one.catalog)!.inCombat as any
    expect(p1.hugoStunTeammateAtkBonus).toBe(300)

    const two = await setup('1141', 0, '1251')
    const p2 = computePanelPhases(0, two.config, two.catalog)!.inCombat as any
    expect(p2.hugoStunTeammateAtkBonus).toBe(900)
  })
})

describe('雨果额外能力与影画执行字段', () => {
  it('额外能力由击破或同属性队友激活，普通异属性队友不激活', async () => {
    for (const mateId of ['1141', '1191']) {
      const { catalog, config } = await setup(mateId)
      expect((computePanelPhases(0, config, catalog)!.inCombat as any).additionalAbilityActive).toBe(1)
    }
    const { catalog, config } = await setup('1271')
    expect((computePanelPhases(0, config, catalog)!.inCombat as any).additionalAbilityActive ?? 0).toBe(0)
  })

  it('连携获得15%增伤；非失衡强特获得20%失衡值提升', () => {
    const executions: any[] = [
      { moveId: '1291015', dmgBonus: 0, element: 'ice' },
      { moveId: HUGO_EX_OPEN_MOVE_ID, stunBuildUpBonus: 0, element: 'ice' },
    ]
    hugoMechanic.patchExecutions!({
      cfg: {
        hugoCinemaLevel: 0,
        hugoAdditionalActive: true,
        hugoExVerdictRatio: 0,
        hugoUltimateVerdictRatio: 0,
        hugoC4Coverage: 0,
      },
      executions,
      state: { exSpecialCount: 1, ultimateCount: 0 },
    } as any)
    expect(executions[0].dmgBonus).toBe(HUGO_ADDITIONAL_CHAIN_DMG)
    expect(executions[1].stunBuildUpBonus).toBe(20)
  })

  it('终结技决算比例同时折算本体行的定向增益', () => {
    const ult: any = { moveId: HUGO_ULT_MOVE_ID, dmgBonus: 0, element: 'ice' }
    hugoMechanic.patchExecutions!({
      cfg: {
        hugoCinemaLevel: 6,
        hugoAdditionalActive: true,
        hugoExVerdictRatio: 1,
        hugoUltimateVerdictRatio: 0.5,
        hugoC4Coverage: 0,
      },
      executions: [ult],
      state: { exSpecialCount: 0, ultimateCount: 2 },
    } as any)
    expect(ult.dmgBonus).toBe((HUGO_ADDITIONAL_VERDICT_DMG + HUGO_C6_DMG_BONUS) * 0.5)
    expect(ult.critRateBonus).toBe(HUGO_C1_CRIT_RATE * 0.5)
    expect(ult.critDmgBonus).toBe(HUGO_C1_CRIT_DMG * 0.5)
    expect(ult.defIgnore).toBe(HUGO_C2_DEF_IGNORE * 0.5)
  })

  it('C1/C2/C4/C6正确写入决算原行，且额外能力与C6增伤加算', () => {
    const ult: any = { moveId: HUGO_ULT_MOVE_ID, dmgBonus: 0, element: 'ice' }
    hugoMechanic.patchExecutions!({
      cfg: {
        hugoCinemaLevel: 6,
        hugoAdditionalActive: true,
        hugoExVerdictRatio: 1,
        hugoUltimateVerdictRatio: 1,
        hugoC4Coverage: 1,
      },
      executions: [ult],
      state: { exSpecialCount: 0, ultimateCount: 1 },
    } as any)
    expect(ult.dmgBonus).toBe(HUGO_ADDITIONAL_VERDICT_DMG + HUGO_C6_DMG_BONUS)
    expect(ult.critRateBonus).toBe(HUGO_C1_CRIT_RATE)
    expect(ult.critDmgBonus).toBe(HUGO_C1_CRIT_DMG)
    expect(ult.defIgnore).toBe(HUGO_C2_DEF_IGNORE)
    expect(ult.resIgnore).toBe(HUGO_C4_ICE_RES_IGNORE)
  })
})

describe('雨果完整计算链', () => {
  it('资源池生成强特决算合成行，暗渊回响面板生效且不屏蔽通用提取', async () => {
    const { catalog, config } = await setup('1141', 6)
    const calc = useResourceCalc()
    const hugo = calc.resourceResult.value!.characters.find(row => row.agentId === '1291')!
    const verdict = hugo.executions.find(row => row.moveId === '1291_ex_verdict_final')
    expect(verdict).toBeTruthy()
    expect(verdict!.damageMultiplier).toBeGreaterThan(3000)
    expect((calc.panels.value[0] as any).hugoEchoCoverage).toBe(1)
    expect(calc.stunPoolResult.value!.contributions.some(row =>
      row.slot === 0 && row.moveId === HUGO_EX_OPEN_MOVE_ID)).toBe(true)
    expect(catalog.getAgentSkills('1291')).toBeTruthy()
    expect((computePanelPhases(0, config, catalog)!.inCombat as any).additionalAbilityActive).toBe(1)
  })
})

describe('雨果决算返还与易伤精度（非轴）', () => {
  it('决算返还失衡值：剩余5秒返还25%使失衡次数高于剩余0秒', async () => {
    const withRefund = await setup('1141', 0)
    withRefund.config.setMechanicSetting('hugo.remainingStunSeconds', 5)
    const calc5 = useResourceCalc()
    expect(calc5.stunPoolResult.value?.stunRefundRatio).toBeCloseTo(0.25)
    const stun5 = calc5.stunPoolResult.value?.stunCount ?? 0
    expect(stun5).toBeGreaterThan(0)

    const noRefund = await setup('1141', 0)
    noRefund.config.setMechanicSetting('hugo.remainingStunSeconds', 0)
    const calc0 = useResourceCalc()
    expect(calc0.stunPoolResult.value?.stunRefundRatio).toBe(0)
    const stun0 = calc0.stunPoolResult.value?.stunCount ?? 0
    expect(stun0).toBeLessThan(stun5)
  })

  it('易伤只给连携+决算招式：决算行满易伤、强特起手无易伤', async () => {
    await setup('1141', 0)
    const calc = useResourceCalc()
    const rows = calc.damagePoolRows.value
    const verdict = rows.find(r => r.moveId === '1291_ex_verdict_final')
    const chain = rows.find(r => r.moveId === '1291015')
    const open = rows.find(r => r.moveId === '1291009')
    expect(verdict).toBeTruthy()
    expect(verdict!.stunMult).toBeGreaterThan(1)
    expect(chain).toBeTruthy()
    expect(chain!.stunMult).toBeGreaterThan(1)
    expect(open).toBeTruthy()
    expect(open!.stunMult).toBe(1)
  })
})

describe('雨果轴模式（决算可视化 + 0命2命区分）', () => {
  it('isHugoEndsWindowMove：强特终结永远结束，终结技仅 C0/C1 结束', () => {
    expect(isHugoEndsWindowMove('1291_ex_verdict_final', 0)).toBe(true)
    expect(isHugoEndsWindowMove('1291_ex_verdict_final', 6)).toBe(true)
    expect(isHugoEndsWindowMove('1291018', 0)).toBe(true)
    expect(isHugoEndsWindowMove('1291018', 1)).toBe(true)
    expect(isHugoEndsWindowMove('1291018', 2)).toBe(false) // C2 终结技不结束失衡
    expect(isHugoEndsWindowMove('1291018', 6)).toBe(false)
    expect(isHugoEndsWindowMove('1291015', 0)).toBe(false) // 连携不结束
  })

  it('轴模式：决算倍率由轴内块位置反推（覆盖滑块默认5s），C2 的 E 殿后倍率更低', async () => {
    // 0命 E 殿后：2连携(各2.383s) + E终结(1.805s) → E 结束于 6.571s，窗口16s → 剩余≈9.43s
    const c0 = await setup('1141', 0)
    c0.config.useStunAxis = true
    c0.config.stunAxes = [{ name: '轴1', actions: [
      { slot: 0, moveId: '1291015', count: 1, startTime: 0 },
      { slot: 0, moveId: '1291015', count: 1, startTime: 2.383 },
      { slot: 0, moveId: '1291_ex_verdict_final', count: 1, startTime: 4.766 },
    ] }]
    const calc0 = useResourceCalc()
    await new Promise(r => setTimeout(r, 50))
    const v0 = calc0.resourceResult.value!.characters.find(r => r.agentId === '1291')!
      .executions.find(r => r.moveId === '1291_ex_verdict_final')
    expect(v0).toBeTruthy()
    // 轴反推剩余≈9.43s → 倍率≈2843%；滑块默认5s → 2400%。应明显更高。
    expect(v0!.damageMultiplier!).toBeGreaterThan(HUGO_EX_FINAL_ACTION_TIME + computeHugoVerdictMultiplier(5) + 100)

    // 2命 Q+E：Q(2.183s) 不结束，E 殿后于 6.949+1.805=8.754s → 剩余≈7.25s → 倍率≈2625%（低于 0命）
    const c2 = await setup('1141', 2)
    c2.config.useStunAxis = true
    c2.config.stunAxes = [{ name: '轴1', actions: [
      { slot: 0, moveId: '1291015', count: 1, startTime: 0 },
      { slot: 0, moveId: '1291015', count: 1, startTime: 2.383 },
      { slot: 0, moveId: '1291018', count: 1, startTime: 4.766 },
      { slot: 0, moveId: '1291_ex_verdict_final', count: 1, startTime: 6.949 },
    ] }]
    const calc2 = useResourceCalc()
    await new Promise(r => setTimeout(r, 50))
    const v2 = calc2.resourceResult.value!.characters.find(r => r.agentId === '1291')!
      .executions.find(r => r.moveId === '1291_ex_verdict_final')
    expect(v2).toBeTruthy()
    // C2 的 E 殿后更晚 → 剩余更短 → 倍率低于 0命
    expect(v2!.damageMultiplier!).toBeLessThan(v0!.damageMultiplier!)
  })
})
