import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useCatalogStore } from '@/stores/catalog'
import { useConfigStore } from '@/stores/config'
import { peiluoProminenceMechanic } from '@/mechanics/agents/specPanelBuffs'

const catalogText = readFileSync(new URL('../../../public/static/catalog.json', import.meta.url), 'utf8')
const buffsText = readFileSync(new URL('../../../public/static/teammate-buffs.json', import.meta.url), 'utf8')
const recsText = readFileSync(new URL('../../../public/static/build-recommendations.json', import.meta.url), 'utf8')

const baseConfig = {
  wEngineId: '', wEngineModLevel: 5,
  driveDisc: { fourPieceSetId: '', twoPieceSetId: '', mainStats: { 4: 'atkPct' as any, 5: 'physicalDmg' as any, 6: 'critRate' as any }, subStatAllocation: {} },
  parryCount: 10, dodgeCounterCount: 6, blockCount: 20,
  quickAssistCount: 0, chainCountPerStun: 0, basicAttackTimeWeight: 1,
}

describe('佩洛伊斯（1551）影画1 黄昏旧章', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.stubGlobal('fetch', vi.fn(async (url: any) => {
      const u = String(url)
      if (u.includes('/static/catalog.json')) return { ok: true, json: async () => JSON.parse(catalogText) }
      if (u.includes('/static/teammate-buffs.json')) return { ok: true, json: async () => JSON.parse(buffsText) }
      if (u.includes('/static/build-recommendations.json')) return { ok: true, json: async () => JSON.parse(recsText) }
      return { ok: false, json: async () => ({}) }
    }))
  })

  it('命座差分：0命 → 1命，暴击率 +8', async () => {
    const catalog = useCatalogStore()
    await catalog.load()
    await catalog.loadTeammateBuffs()
    const config = useConfigStore()
    config.team[0] = { slot: 0, agentId: '1551', cinemaLevel: 0, ...baseConfig } as any
    config.team[1] = { slot: 1, agentId: '', cinemaLevel: 0, ...baseConfig } as any
    config.team[2] = { slot: 2, agentId: '', cinemaLevel: 0, ...baseConfig } as any
    config.syncTeammateBuffsFromTeam()
    const { computePanelPhases } = await import('@/composables/resourceCalc/helpers')
    const p0 = computePanelPhases(0, config, catalog)!.inCombat as any
    config.team[0].cinemaLevel = 1
    const p1 = computePanelPhases(0, config, catalog)!.inCombat as any
    expect(p1.critRate - p0.critRate).toBe(8)
  })

  it('进场喧响：1命 buildCharConfig 注入 initialDecibelGift +1000，0命不注入', () => {
    const cfg1: any = {}
    peiluoProminenceMechanic.buildCharConfig!({ cfg: cfg1, panel: {}, cinemaLevel: 1 } as any)
    expect(cfg1.initialDecibelGift).toBe(1000)

    const cfg0: any = {}
    peiluoProminenceMechanic.buildCharConfig!({ cfg: cfg0, panel: {}, cinemaLevel: 0 } as any)
    expect(cfg0.initialDecibelGift ?? 0).toBe(0)
  })

  it('大招口径：消耗 2000 喧响，通用大招行走上分支 moveId', () => {
    const cfg: any = {}
    peiluoProminenceMechanic.buildCharConfig!({ cfg, panel: {}, cinemaLevel: 0 } as any)
    expect(cfg.ultimateCost).toBe(2000)
    expect(cfg.ultimateMoveId).toBe('1551015')
  })
})

describe('佩洛伊斯大招三分支拆分（patchExecutions）', () => {
  function genericUlt(count: number): any {
    return { moveId: '1551015', category: 'chain', count, actionTime: 3, comboAlignRatio: 0, totalTime: 3 * count, totalComboAlignTime: 0, decibelRecovery: 0, totalDecibelRecovery: 0 }
  }

  it('5 次大招 + 决算 2：下1 右2 上2，上行挂阳炎暴伤 +40', () => {
    const executions = [genericUlt(5)]
    peiluoProminenceMechanic.patchExecutions!({ cfg: { peiluoVerdictCount: 2 }, state: { ultimateCount: 5 }, executions } as any)
    const upper = executions.find((e: any) => e.moveId === '1551015')
    const lower = executions.find((e: any) => e.moveId === '1551014')
    const verdict = executions.find((e: any) => e.moveId === '1551016')
    expect(upper.count).toBe(2)
    expect(upper.critDmgBonus).toBe(40)
    expect(lower.count).toBe(1)
    expect(verdict.count).toBe(2)
    expect(lower.count + verdict.count + upper.count).toBe(5)
  })

  it('决算封顶：失衡 10 次但只有 3 次大招 → 决算 2、上 0（上行删除）', () => {
    const executions = [genericUlt(3)]
    peiluoProminenceMechanic.patchExecutions!({ cfg: { peiluoVerdictCount: 10 }, state: { ultimateCount: 3 }, executions } as any)
    expect(executions.find((e: any) => e.moveId === '1551015')).toBeUndefined()
    expect(executions.find((e: any) => e.moveId === '1551016').count).toBe(2)
    expect(executions.find((e: any) => e.moveId === '1551014').count).toBe(1)
  })

  it('0 次大招：不拆分、不加行', () => {
    const executions: any[] = []
    peiluoProminenceMechanic.patchExecutions!({ cfg: { peiluoVerdictCount: 3 }, state: { ultimateCount: 0 }, executions } as any)
    expect(executions.length).toBe(0)
  })
})

describe('佩洛伊斯耀斑 buff（下分支开局必打，全程覆盖）', () => {
  it('transform：能量获得效率 +15%、伤害 +40%', () => {
    const panel: any = {}
    peiluoProminenceMechanic.transformSkillExecutions!({ panel, charResult: {} } as any)
    expect(panel.energyGainEfficiency).toBe(15)
    expect(panel.dmgBonus).toBe(40)
  })
})

describe('佩洛伊斯额外能力：击破/支援队友门控暴伤 +40', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.stubGlobal('fetch', vi.fn(async (url: any) => {
      const u = String(url)
      if (u.includes('/static/catalog.json')) return { ok: true, json: async () => JSON.parse(catalogText) }
      if (u.includes('/static/teammate-buffs.json')) return { ok: true, json: async () => JSON.parse(buffsText) }
      if (u.includes('/static/build-recommendations.json')) return { ok: true, json: async () => JSON.parse(recsText) }
      return { ok: false, json: async () => ({}) }
    }))
  })

  it('安比（stun 击破）在队：暴伤 +40；换出后回落', async () => {
    const catalog = useCatalogStore()
    await catalog.load()
    await catalog.loadTeammateBuffs()
    const config = useConfigStore()
    config.team[0] = { slot: 0, agentId: '1551', cinemaLevel: 0, ...baseConfig } as any
    config.team[1] = { slot: 1, agentId: '1011', cinemaLevel: 0, ...baseConfig } as any // 安比：击破
    config.team[2] = { slot: 2, agentId: '', cinemaLevel: 0, ...baseConfig } as any
    config.syncTeammateBuffsFromTeam()
    const { computePanelPhases } = await import('@/composables/resourceCalc/helpers')
    const withMate = computePanelPhases(0, config, catalog)!.inCombat as any
    expect(withMate.additionalAbilityActive).toBe(1)
    config.team[1] = { slot: 1, agentId: '', cinemaLevel: 0, ...baseConfig } as any
    config.syncTeammateBuffsFromTeam()
    const withoutMate = computePanelPhases(0, config, catalog)!.inCombat as any
    expect(withMate.critDmg - withoutMate.critDmg).toBe(40)
  })
})

describe('佩洛伊斯日珥账本（命中回复/天光消耗）', () => {
  it('patchExecutions 汇总：余晖回复 + 天光 a3/a4 消耗与连段计数', () => {
    const executions: any[] = [
      { moveId: '1551003', count: 2 }, // 余晖#3 回复 6.2014×2
      { moveId: '1551010', count: 1 }, // 旭日 回复 1.4661
      { moveId: '1551006', count: 3 }, // 天光a3 消耗 14.6107×3
      { moveId: '1551007', count: 2 }, // 天光a4 消耗 11.8234×2
      { moveId: '1551004', count: 4 }, // 天光a1 消耗 1.5007×4
    ]
    const cfg: any = {}
    peiluoProminenceMechanic.patchExecutions!({ cfg, state: { ultimateCount: 0 }, executions } as any)
    const ledger = cfg.peiluoProminenceLedger
    expect(ledger.hitGain).toBeCloseTo(6.2014 * 2 + 1.4661, 4)
    expect(ledger.spend).toBeCloseTo(14.6107 * 3 + 11.8234 * 2 + 1.5007 * 4, 4)
    expect(ledger.lowSpend).toBeCloseTo(1.5007 * 4, 4)
    expect(ledger.a3).toBe(3)
    expect(ledger.a4).toBe(2)
  })

  it('buildResourceResult：命中回复并入日珥总账、天光消耗计入剩余', () => {
    const cfg: any = { peiluoProminenceLedger: { hitGain: 20, spend: 30, lowSpend: 5, a3: 1, a4: 1 } }
    const out: any = peiluoProminenceMechanic.buildResourceResult!({ cfg, state: { frontlineTime: 0, exSpecialCount: 0, ultimateCount: 0 } } as any)
    const prom = out.specResources['peiluo_prominence']
    expect(prom.gains['peiluo_hit_gain']).toBe(20)
    expect(prom.total).toBe(30 + 20) // 入场30 + 命中回复20（其他来源此 state 下为 0）
    expect(prom.remaining).toBe(30 + 20 - 30)
    expect(prom.spendCosts['peiluo_tianguang_spend']).toBe(30)
  })

  it('resourceSections：日珥账本卡输出核对结论', () => {
    const result: any = {
      specResources: {
        peiluo_prominence: {
          initialValue: 30, gains: { peiluo_frontline_gain: 60 }, total: 90, remaining: 10, totalGain: 60,
          spendCounts: {}, spendCosts: {}, maxValue: 60, bonusCount: 0, id: 'peiluo_prominence', name: '日珥',
        },
      },
      peiluoProminenceLedger: { hitGain: 25, spend: 80, lowSpend: 6, a3: 3, a4: 2 },
    }
    const sections: any[] = peiluoProminenceMechanic.resourceSections!({ result } as any)
    const card = sections.find(s => s.id === 'peiluo-prominence-ledger')
    expect(card).toBeTruthy()
    expect(card.summary).toContain('结余') // 回复 30+60+25=115 > 消耗 80
    expect(card.rows.find((r: any) => r.label === '核对结论').value).toBe('日珥足够')
  })
})
