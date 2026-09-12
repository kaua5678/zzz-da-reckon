import { beforeEach, describe, expect, it } from 'vitest'
import { mockStaticFetch, newPinia } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { useCatalogStore } from '@/stores/catalog'
import { useConfigStore } from '@/stores/config'
import {
  computePhoenixWeaknessCrit,
  phoenixMechanic,
  phoenixSkillLevel,
  PHOENIX_RELEASE_BASE,
} from '@/mechanics/agents/phoenix'

const baseConfig = {
  wEngineId: '', wEngineModLevel: 5,
  driveDisc: { fourPieceSetId: '', twoPieceSetId: '', mainStats: { 4: 'anomalyProficiency' as any, 5: 'fireDmg' as any, 6: 'anomalyMastery' as any }, subStatAllocation: {} },
  parryCount: 10, dodgeCounterCount: 6, blockCount: 20,
  quickAssistCount: 0, chainCountPerStun: 0, basicAttackTimeWeight: 1,
}

describe('菲欧妮（1641）⚠️3.3 测试服临时录入', () => {
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

  it('纯函数：脆弱异常暴击档位（15/25/40 按队伍异常数，掌控>145 每点+0.7%率，影画1+20）', () => {
    const base = computePhoenixWeaknessCrit({ anomalyMastery: 145, additionalActive: false, teamAnomalyCount: 1, cinemaLevel: 0 })
    expect(base.rate).toBeCloseTo(30, 5)
    expect(base.dmg).toBe(15)
    const excess = computePhoenixWeaknessCrit({ anomalyMastery: 200, additionalActive: false, teamAnomalyCount: 1, cinemaLevel: 0 })
    expect(excess.rate).toBeCloseTo(30 + 55 * 0.7, 5)
    const tier2 = computePhoenixWeaknessCrit({ anomalyMastery: 145, additionalActive: true, teamAnomalyCount: 2, cinemaLevel: 0 })
    expect(tier2.dmg).toBe(25)
    const tier3 = computePhoenixWeaknessCrit({ anomalyMastery: 145, additionalActive: true, teamAnomalyCount: 3, cinemaLevel: 0 })
    expect(tier3.dmg).toBe(40)
    const c1 = computePhoenixWeaknessCrit({ anomalyMastery: 145, additionalActive: true, teamAnomalyCount: 2, cinemaLevel: 1 })
    expect(c1.dmg).toBe(45)
    // 影画6：额外能力需求-1 → 同编成档位+1（2 名按 3 档）
    const c6 = computePhoenixWeaknessCrit({ anomalyMastery: 145, additionalActive: true, teamAnomalyCount: 2, cinemaLevel: 6 })
    expect(c6.dmg).toBe(40 + 20)
  })

  it('纯函数：异放倍率随技能等级（影画3/5 通用技能等级 +2/+4）', () => {
    expect(phoenixSkillLevel(0)).toBe(12)
    expect(phoenixSkillLevel(3)).toBe(14)
    expect(phoenixSkillLevel(5)).toBe(16)
    expect(PHOENIX_RELEASE_BASE.charged + PHOENIX_RELEASE_BASE.chargedPerLevel * 11).toBe(445)
    expect(PHOENIX_RELEASE_BASE.ult + PHOENIX_RELEASE_BASE.ultPerLevel * 11).toBe(597)
  })

  it('面板差分：核心异常精通+40；脆弱异常暴击走 spec teamBuffs 通用承载（率=公式读源面板掌控/伤=基础15）；影画2 积蓄效率 ×覆盖率', async () => {
    const { config, computePanelPhases } = await setup(['1641', '1211', '']) // 1211 丽娜=支援（额外能力不触发档位）
    const pOut = computePanelPhases(0, config, useCatalogStore())!.outOfCombat as any
    const pIn = computePanelPhases(0, config, useCatalogStore())!.inCombat as any
    expect(pIn.anomalyProficiency - pOut.anomalyProficiency).toBeCloseTo(40, 5)
    // teamBuff 公式 30 + max(0, 掌控-145)×0.7，掌控读源面板（局外）——基础 118 < 145 → 率 = 30
    const mastery = pOut.anomalyMastery ?? 0
    const expectedRate = 30 + Math.max(0, mastery - 145) * 0.7
    expect(pIn.anomalyCritRate).toBeCloseTo(expectedRate, 3)
    // 额外能力未触发（丽娜非异常/同阵营）→ 只吃基础档 15（tier2 被 buff-id 过滤门控）
    expect(pIn.anomalyCritDmg).toBeCloseTo(15, 5)

    // 影画2：焚化积蓄效率 +15×覆盖率
    const c2 = await setup(['1641', '1211', ''], 2)
    const pC2 = c2.computePanelPhases(0, c2.config, useCatalogStore())!.inCombat as any
    expect((pC2.anomalyBuildUpEfficiency ?? 0)).toBeGreaterThanOrEqual(15)
    c2.config.setMechanicSetting('phoenix.c2IncinerationCoverage', 0)
    const pC2z = c2.computePanelPhases(0, c2.config, useCatalogStore())!.inCombat as any
    expect((pC2z.anomalyBuildUpEfficiency ?? 0)).toBeCloseTo(0, 5)
  })

  it('脆弱暴伤档位（spec teamBuffs 通用承载）：额外能力门控 tier2 / 影画一 +20 / 队友同吃', async () => {
    // 额外能力触发（1171 柏妮思=异常队友）：基础 15 + tier2 10 = 25
    const aa = await setup(['1641', '1171', ''])
    const p25 = aa.computePanelPhases(0, aa.config, useCatalogStore())!.inCombat as any
    expect(p25.anomalyCritDmg).toBeCloseTo(25, 5)
    // 额外能力不触发（1081 比利）：tier2 被过滤 → 只有基础 15
    const noAa = await setup(['1641', '1081', ''])
    const p15 = noAa.computePanelPhases(0, noAa.config, useCatalogStore())!.inCombat as any
    expect(p15.anomalyCritDmg).toBeCloseTo(15, 5)
    // 影画一（中文数字 source 自动命座门控）：+20 → 45；0 命不生效（上面已证 25）
    const c1 = await setup(['1641', '1171', ''], 1)
    const p45 = c1.computePanelPhases(0, c1.config, useCatalogStore())!.inCombat as any
    expect(p45.anomalyCritDmg).toBeCloseTo(45, 5)
    // 队友同吃（通用承载的关键收益）：柏妮思 slot1 面板异常暴击率/伤同获脆弱
    const mate = aa.computePanelPhases(1, aa.config, useCatalogStore())!.inCombat as any
    expect(mate.anomalyCritDmg ?? 0).toBeGreaterThanOrEqual(25)
    expect(mate.anomalyCritRate ?? 0).toBeGreaterThanOrEqual(30)
  })

  it('执行行/事件：余火驱动长按普攻（1641005）+ 蓄能附加攻击（1641021）+ 异放事件（445%/597% 固定倍率）', async () => {
    const { config } = await setup(['1641', '1171', ''], 0)
    config.setMechanicSetting('phoenix.chargedAttackCount', 6)
    const calc = useResourceCalc()
    const phoenix = calc.resourceResult.value!.characters.find(c => c.agentId === '1641')!
    const charged = phoenix.executions.find(e => e.moveId === '1641005')!
    expect(charged).toBeTruthy()
    expect(charged.count).toBe(6)
    expect(charged.totalTime).toBeCloseTo(6 * charged.actionTime, 6)
    const energize = phoenix.executions.find(e => e.moveId === '1641021')!
    expect(energize).toBeTruthy()
    expect(energize.count).toBeGreaterThan(0)
    expect(energize.totalTime).toBe(0) // 附加攻击不占前台

    // 异放：长按普攻 445%（s=12，固定 releaseMultiplier）——直调模块事件钩子断言
    const events: any[] = []
    phoenixMechanic.buildAnomalyEvents!({
      cfg: { phoenixCinemaLevel: 0, phoenixChargedCount: 6, 'setting:phoenix.releaseCoverage': 1 } as any,
      state: { exSpecialCount: 4, ultimateCount: 2, chainCountTotal: 3 } as any,
      events,
      totalTime: 180,
    })
    const chargedRelease = events.find(e => e.eventId === 'phoenix_charged_release')
    expect(chargedRelease).toBeTruthy()
    expect(chargedRelease.count).toBe(6)
    expect(chargedRelease.formula).toContain('445')
    const ultRelease = events.find(e => e.eventId === 'phoenix_ultimate_release')
    expect(ultRelease.count).toBe(2)
    expect(ultRelease.formula).toContain('597')
    // 0 命无影画6 强特异放
    expect(events.find(e => e.eventId === 'phoenix_c6_ex_release')).toBeUndefined()
    // 异放进伤害池（type=异放）
    const rows = calc.damagePoolRows.value
    const releaseRows = rows.filter(r => r.type === '异放' && r.agentId === '1641')
    expect(releaseRows.length).toBeGreaterThan(0)
    expect(releaseRows.every(r => r.totalDamage > 0)).toBe(true)
  })

  it('命座差分：影画4 长按普攻+200喧响/次（initialDecibelGift）、影画6 异放无视15%防御（releaseModifier）且整局伤害 C6 > C0', async () => {
    const c4 = await setup(['1641', '1171', ''], 4)
    c4.config.setMechanicSetting('phoenix.chargedAttackCount', 4)
    const calc4 = useResourceCalc()
    const cfgC4 = calc4.resourceConfig.value!.characters.find(c => c.agentId === '1641')!
    expect(cfgC4.initialDecibelGift).toBe(1000 + 200 * 4) // 基础进场喧响 1000 + 影画4
    await setup(['1641', '1171', ''], 0)
    const cfgC0 = useResourceCalc().resourceConfig.value!.characters.find(c => c.agentId === '1641')!
    expect(cfgC0.initialDecibelGift ?? 0).toBe(1000)

    const mod = phoenixMechanic.releaseModifier!({ panels: [{ phoenixCinemaLevel: 6 } as any] })
    expect(mod.enemyDefReduction).toBe(15)
    const mod0 = phoenixMechanic.releaseModifier!({ panels: [{ phoenixCinemaLevel: 0 } as any] })
    expect(mod0.enemyDefReduction).toBeUndefined()

    await setup(['1641', '1171', ''], 0)
    const d0 = useResourceCalc().teamTotalDamage.value
    await setup(['1641', '1171', ''], 6)
    const d6 = useResourceCalc().teamTotalDamage.value
    expect(d6).toBeGreaterThan(d0)
  })

  it('模块注册与滑块：3 个滑块齐全（脆弱暴击已移交 spec teamBuffs，无档位滑块）', () => {
    expect(phoenixMechanic.agentIds).toContain('1641')
    expect((phoenixMechanic.settings ?? []).map(s => s.id).sort()).toEqual([
      'phoenix.c2IncinerationCoverage', 'phoenix.chargedAttackCount', 'phoenix.releaseCoverage',
    ])
  })
})
