import { beforeEach, describe, expect, it } from 'vitest'
import { mockStaticFetch, newPinia } from '@/test/harness'
import { useCatalogStore } from '@/stores/catalog'
import { useConfigStore } from '@/stores/config'
import {
  computeJufufuCycle,
  jufufuTigerRoarMechanic,
  JUFUFU_C6_CHAIN_DMG_BONUS,
  JUFUFU_C6_POPCORN_MULT,
  JUFUFU_C6_POPCORN_PER_SPIN,
  JUFUFU_HUWEI_AWE,
  JUFUFU_SPIN_AWE,
} from '@/mechanics/agents/specPanelBuffs'

const baseConfig = {
  wEngineId: '', wEngineModLevel: 5,
  driveDisc: { fourPieceSetId: '', twoPieceSetId: '', mainStats: { 4: 'atkPct' as any, 5: 'fireDmg' as any, 6: 'critRate' as any }, subStatAllocation: {} },
  parryCount: 10, dodgeCounterCount: 6, defAssistCount: 20,
  quickAssistCount: 0, chainCountPerStun: 0, basicAttackTimeWeight: 1,
}

async function setup(team: Array<{ agentId: string; cinemaLevel: number }>) {
  const catalog = useCatalogStore()
  await catalog.load()
  await catalog.loadTeammateBuffs()
  const config = useConfigStore()
  for (let i = 0; i < 3; i++) {
    const t = team[i]
    config.team[i] = { slot: i, agentId: t?.agentId ?? '', cinemaLevel: t?.cinemaLevel ?? 0, ...baseConfig } as any
  }
  config.syncTeammateBuffsFromTeam()
  return { catalog, config }
}

describe('橘福福次数账本 computeJufufuCycle', () => {
  it('虎威 floor(后场/4)×20；震煞 floor(威风/100)；旋转=威势', () => {
    const c = computeJufufuCycle({
      backstageTime: 40, // 10 次虎威
      exSpecialCount: 2, // 威势+6 威风+160
      ultimateCount: 1, // 威势+6 威风+100
      parryCount: 2, // 威势+2
      cinemaLevel: 0,
      aweInitial: 0,
      c2WeishiPerUlt: 0,
    })
    expect(c.huweiHits).toBe(10)
    expect(c.weishiGain).toBe(2 * 3 + 1 * 6 + 2) // 14
    expect(c.spinCount).toBe(14)
    const awe = 10 * JUFUFU_HUWEI_AWE + 2 * 80 + 1 * 100 + 14 * JUFUFU_SPIN_AWE
    expect(c.aweTotal).toBe(awe)
    expect(c.tigerChainCount).toBe(Math.floor(awe / 100))
    expect(c.popcornHits).toBe(0)
  })

  it('影画1 进场威风 100 计入总量；影画6 爆米花=旋转×3', () => {
    const c = computeJufufuCycle({
      backstageTime: 0,
      exSpecialCount: 0,
      ultimateCount: 0,
      parryCount: 0,
      cinemaLevel: 6,
      aweInitial: 100,
      c2WeishiPerUlt: 3,
      teamUltimateCount: 4,
    })
    // C2 weishi: cinema>=2 → teamUlt*3；weishi=0+0+0+4*3=12
    expect(c.weishiGain).toBe(12)
    expect(c.aweTotal).toBe(100 + 12 * JUFUFU_SPIN_AWE)
    expect(c.tigerChainCount).toBe(Math.floor((100 + 300) / 100))
    expect(c.popcornHits).toBe(12 * JUFUFU_C6_POPCORN_PER_SPIN)
  })

  it('虎威相位延后（2026-08-30）：块长 = 前台时间/(切上频率×前台动作次数)，滑块越低块越长、次数越少', () => {
    const base = { exSpecialCount: 0, ultimateCount: 0, parryCount: 0, cinemaLevel: 0, aweInitial: 0, c2WeishiPerUlt: 0 }
    // 无前台时间 → 旧口径 floor(100/4)=25
    expect(computeJufufuCycle({ backstageTime: 100, frontlineTime: 0, ...base }).huweiHits).toBe(25)
    // 前台 60s、动作 12 次、100% → 块长 5s；W=160, p=0.375 → c' = 4 + 0.375×2.5 = 4.9375 → 20 次
    const full = computeJufufuCycle({
      backstageTime: 100, frontlineTime: 60, effectiveTotalTime: 160, frontActionCount: 12, frontSwitchRatio: 1, ...base,
    })
    expect(full.huweiHits).toBe(Math.floor(100 / (4 + 0.375 * 2.5)))
    // 20% → 切上 2.4 次 → 块长 25s → c' = 4 + 0.375×12.5 = 8.6875 → 11 次
    const rare = computeJufufuCycle({
      backstageTime: 100, frontlineTime: 60, effectiveTotalTime: 160, frontActionCount: 12, frontSwitchRatio: 0.2, ...base,
    })
    expect(rare.huweiHits).toBe(Math.floor(100 / (4 + 0.375 * 12.5)))
    expect(rare.huweiHits).toBeLessThan(full.huweiHits)
    // 动作次数缺省 → 回退块长 ≈ CD：c' = 4×1.1875 → floor(100/4.75) = 21
    expect(computeJufufuCycle({ backstageTime: 100, frontlineTime: 60, effectiveTotalTime: 160, ...base }).huweiHits).toBe(21)
  })
})

describe('橘福福影画1/2/4 面板', () => {
  beforeEach(() => { newPinia(); mockStaticFetch() })

  it('0→1 命暴击 +12', async () => {
    const { catalog, config } = await setup([{ agentId: '1391', cinemaLevel: 0 }])
    const { computePanelPhases } = await import('@/composables/resourceCalc/helpers')
    const p0 = computePanelPhases(0, config, catalog)!.inCombat as any
    config.team[0].cinemaLevel = 1
    const p1 = computePanelPhases(0, config, catalog)!.inCombat as any
    expect(p1.critRate - p0.critRate).toBe(12)
  })

  it('3→4 命自身暴伤 +35', async () => {
    const { catalog, config } = await setup([{ agentId: '1391', cinemaLevel: 3 }])
    const { computePanelPhases } = await import('@/composables/resourceCalc/helpers')
    const p3 = computePanelPhases(0, config, catalog)!.inCombat as any
    config.team[0].cinemaLevel = 4
    const p4 = computePanelPhases(0, config, catalog)!.inCombat as any
    expect(p4.critDmg - p3.critDmg).toBe(35)
  })

  it('影画2 全队虎啸暴伤 +22', async () => {
    const { catalog, config } = await setup([
      { agentId: '1391', cinemaLevel: 1 },
      { agentId: '1041', cinemaLevel: 0 },
    ])
    const { computePanelPhases } = await import('@/composables/resourceCalc/helpers')
    config.syncTeammateBuffsFromTeam()
    const p1 = computePanelPhases(1, config, catalog)!.inCombat as any
    config.team[0].cinemaLevel = 2
    config.syncTeammateBuffsFromTeam()
    const p2 = computePanelPhases(1, config, catalog)!.inCombat as any
    expect(p2.critDmg - p1.critDmg).toBe(22)
  })

  it('进场威风：1命 jufufuAweInitial=100', () => {
    const cfg: any = {}
    jufufuTigerRoarMechanic.buildCharConfig!({
      cfg, panel: {}, cinemaLevel: 1, skills: { categories: [] },
    } as any)
    expect(cfg.jufufuAweInitial).toBe(100)
    expect(cfg.jufufuC2WeishiPerUlt).toBe(0)
  })
})

describe('橘福福虎啸冲击满覆盖', () => {
  it('无条件冲击 +50', () => {
    const panel: any = { impact: 120 }
    jufufuTigerRoarMechanic.transformSkillExecutions!({
      panel,
      charResult: { specResources: {} },
    } as any)
    expect(panel.impact).toBe(170)
  })
})

describe('橘福福 buildExecutions / 影画6', () => {
  it('生成虎威/震煞/旋转行；6命爆米花与连携+30', () => {
    const cfg: any = {
      jufufuCinemaLevel: 6,
      jufufuAweInitial: 100,
      jufufuC2WeishiPerUlt: 3,
      jufufuTeamUltimateCount: 2,
      parryCount: 0,
      jufufuMoveDmg: {
        '1391005': 184.8,
        '1391010': 39,
        '1391013': 709.8,
      },
    }
    const state: any = {
      backstageTime: 20, // 5 虎威
      exSpecialCount: 1,
      ultimateCount: 1,
    }
    const executions: any[] = []
    jufufuTigerRoarMechanic.buildExecutions!({ cfg, state, executions } as any)

    const huwei = executions.find(e => e.moveId === '1391005')
    const chain = executions.find(e => e.moveId === '1391013')
    const spin = executions.find(e => e.moveId === '1391010')
    const popcorn = executions.find(e => e.moveId === '1391_c6_popcorn')

    expect(huwei.count).toBe(5)
    expect(spin.count).toBe(1 * 3 + 1 * 6 + 2 * 3) // ex+ult+c2 team ult
    expect(chain.count).toBeGreaterThan(0)
    expect(chain.dmgBonus).toBe(JUFUFU_C6_CHAIN_DMG_BONUS)
    expect(popcorn.count).toBe(spin.count * JUFUFU_C6_POPCORN_PER_SPIN)
    expect(popcorn.damageMultiplier).toBe(JUFUFU_C6_POPCORN_MULT)
    expect(popcorn.dmgBonus).toBe(JUFUFU_C6_CHAIN_DMG_BONUS)
    expect(popcorn.skillDamageTarget).toBe('chain')
  })

  it('buildResourceResult 账本与 spend 一致', () => {
    const cfg: any = {
      jufufuCinemaLevel: 0,
      jufufuAweInitial: 0,
      jufufuC2WeishiPerUlt: 0,
      parryCount: 0,
    }
    const state: any = { backstageTime: 40, exSpecialCount: 2, ultimateCount: 1 }
    // first build executions to fill cycle
    const executions: any[] = []
    cfg.jufufuMoveDmg = { '1391005': 1, '1391010': 1, '1391013': 1 }
    jufufuTigerRoarMechanic.buildExecutions!({ cfg, state, executions } as any)
    const out: any = jufufuTigerRoarMechanic.buildResourceResult!({ cfg, state } as any)
    const cycle = out.jufufuCycle
    expect(out.specResources.jufufu_awe.spendCounts.jufufu_tiger_chain_spend).toBe(cycle.tigerChainCount)
    expect(out.specResources.jufufu_weishi.spendCounts.jufufu_spin_spend).toBe(cycle.spinCount)
    expect(out.specResources.jufufu_awe.gains.jufufu_tiger_awe_gain).toBe(cycle.huweiHits * 20)
  })
})

describe('橘福福额外能力门控（面板 additionalAbilityActive）', () => {
  beforeEach(() => { newPinia(); mockStaticFetch() })

  it('有强攻队友时 additionalAbilityActive=1', async () => {
    const { catalog, config } = await setup([
      { agentId: '1391', cinemaLevel: 0 },
      { agentId: '1041', cinemaLevel: 0 }, // 11号 强攻
    ])
    const { computePanelPhases } = await import('@/composables/resourceCalc/helpers')
    const p = computePanelPhases(0, config, catalog)!.inCombat as any
    expect(p.additionalAbilityActive).toBe(1)
  })
})
