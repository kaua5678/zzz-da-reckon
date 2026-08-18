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
    expect(upper.critDmgBonus ?? 0).toBe(0) // 阳炎暴伤改走 buff 轴扫描（computePeiluoKagerouBonus），不挂执行行
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
    expect(prom.total).toBe(30 + 60 + 20) // 入场30 + 被动固定60 + 命中回复20
    expect(prom.remaining).toBe(30 + 60 + 20 - 30)
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

describe('佩洛伊斯强特完美格挡回日珥（主页交互栏填写）', () => {
  it('perfectBlockCount × 10 计入日珥获取；未填写为 0', async () => {
    const { computeSpecResources } = await import('@/specs/resources')
    const { getAgentSpec } = await import('@/specs/registry')
    const spec = getAgentSpec('1551')!
    const state = { frontlineTime: 0, exSpecialCount: 2, ultimateCount: 0, chainCountTotal: 0 } as any
    const filled = Object.fromEntries(computeSpecResources(spec, { perfectBlockCount: 3 } as any, state))
    expect(filled['peiluo_prominence'].gains['peiluo_perfect_block_gain']).toBe(30)
    const empty = Object.fromEntries(computeSpecResources(spec, { perfectBlockCount: 0 } as any, state))
    expect(empty['peiluo_prominence'].gains['peiluo_perfect_block_gain'] ?? 0).toBe(0)
  })
})

describe('佩洛伊斯阳炎 buff 轴扫描（仪玄凝神模式）', () => {
  it('上分支触发 21s 窗口：触发块自身与窗口内决算吃暴伤，窗外不吃', async () => {
    const { computePeiluoKagerouBonus } = await import('@/mechanics/agents/specPanelBuffs')
    const axes = [{ actions: [
      { slot: 0, moveId: '1551014', count: 1, startTime: 0 },   // 下分支（不吃）
      { slot: 0, moveId: '1551015', count: 1, startTime: 5 },   // 上分支触发（自身吃）
      { slot: 0, moveId: '1551016', count: 1, startTime: 15 },  // 决算在窗口内（吃）
      { slot: 0, moveId: '1551016', count: 1, startTime: 40 },  // 决算在窗外（不吃）
    ] }]
    const bonus = computePeiluoKagerouBonus(0, axes as any)
    expect(bonus.get('1551015')).toBe(40) // 触发块自身享受（用户口径）
    // 1551016：只对受益实例加权平均（同仪玄凝神口径）→ 窗外那次不进分母
    expect(bonus.get('1551016')).toBe(40)
    expect(bonus.has('1551014')).toBe(false)
  })

  it('喧响不够只打决算（无上分支铺垫）：决算不吃阳炎', async () => {
    const { computePeiluoKagerouBonus } = await import('@/mechanics/agents/specPanelBuffs')
    const axes = [{ actions: [
      { slot: 0, moveId: '1551016', count: 1, startTime: 10 },
      { slot: 0, moveId: '1551016', count: 1, startTime: 40 },
    ] }]
    const bonus = computePeiluoKagerouBonus(0, axes as any)
    expect(bonus.size).toBe(0)
  })

  it('其他槽位动作不参与扫描', async () => {
    const { computePeiluoKagerouBonus } = await import('@/mechanics/agents/specPanelBuffs')
    const axes = [{ actions: [
      { slot: 1, moveId: '1551015', count: 1, startTime: 0 },
    ] }]
    const bonus = computePeiluoKagerouBonus(0, axes as any)
    expect(bonus.size).toBe(0)
  })
})

describe('佩洛伊斯特殊技：强袭训令（主页交互栏次数）', () => {
  it('填写 3 次 → 执行行 1551022 ×3；未填写不出行', () => {
    const execs3: any[] = []
    peiluoProminenceMechanic.buildExecutions!({ cfg: { assaultOrderCount: 3 }, state: {}, executions: execs3 } as any)
    expect(execs3.length).toBe(1)
    expect(execs3[0].moveId).toBe('1551022')
    expect(execs3[0].count).toBe(3)

    const execs0: any[] = []
    peiluoProminenceMechanic.buildExecutions!({ cfg: {}, state: {}, executions: execs0 } as any)
    expect(execs0.length).toBe(0)
  })
})

describe('佩洛伊斯影画4 焚昼孽火：失衡值 +10%（默认全覆盖）', () => {
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

  it('命座差分：3命 → 4命，stunBuildUpBonus +10', async () => {
    const catalog = useCatalogStore()
    await catalog.load()
    await catalog.loadTeammateBuffs()
    const config = useConfigStore()
    config.team[0] = { slot: 0, agentId: '1551', cinemaLevel: 3, ...baseConfig } as any
    config.team[1] = { slot: 1, agentId: '', cinemaLevel: 0, ...baseConfig } as any
    config.team[2] = { slot: 2, agentId: '', cinemaLevel: 0, ...baseConfig } as any
    config.syncTeammateBuffsFromTeam()
    const { computePanelPhases } = await import('@/composables/resourceCalc/helpers')
    const p3 = computePanelPhases(0, config, catalog)!.inCombat as any
    config.team[0].cinemaLevel = 4
    const p4 = computePanelPhases(0, config, catalog)!.inCombat as any
    expect((p4.stunBuildUpBonus ?? 0) - (p3.stunBuildUpBonus ?? 0)).toBe(10)
  })
})

describe('佩洛伊斯被动日珥：直接按 60 计', () => {
  it('computeSpecResources：被动回复固定 60（不再按前台时间折算）', async () => {
    const { computeSpecResources } = await import('@/specs/resources')
    const { getAgentSpec } = await import('@/specs/registry')
    const spec = getAgentSpec('1551')!
    const out = Object.fromEntries(computeSpecResources(spec, {} as any, { frontlineTime: 10 } as any))
    expect(out['peiluo_prominence'].gains['peiluo_frontline_gain']).toBe(60)
    const out2 = Object.fromEntries(computeSpecResources(spec, {} as any, { frontlineTime: 500 } as any))
    expect(out2['peiluo_prominence'].gains['peiluo_frontline_gain']).toBe(60)
  })
})

describe('佩洛伊斯阳炎配对比例（非轴模式：无上分支铺垫的决算不吃 buff）', () => {
  function genericUlt(count: number): any {
    return { moveId: '1551015', category: 'chain', count, actionTime: 3, comboAlignRatio: 0, decibelRecovery: 0 }
  }

  it('上2 决算3 → 决算配对比例 2/3（大招6 = 下1 + 决3 + 上2）', () => {
    const executions = [genericUlt(6)]
    peiluoProminenceMechanic.patchExecutions!({ cfg: { peiluoVerdictCount: 3 }, state: { ultimateCount: 6 }, executions } as any)
    const verdict = executions.find((e: any) => e.moveId === '1551016')
    expect(verdict.peiluoKagerouPairRatio).toBeCloseTo(2 / 3, 5)
  })

  it('上0 决算2（喧响不够只打决算）→ 比例 0，全不吃阳炎', () => {
    const executions = [genericUlt(3)]
    peiluoProminenceMechanic.patchExecutions!({ cfg: { peiluoVerdictCount: 2 }, state: { ultimateCount: 3 }, executions } as any)
    const verdict = executions.find((e: any) => e.moveId === '1551016')
    expect(verdict.count).toBe(2)
    expect(verdict.peiluoKagerouPairRatio).toBe(0)
  })

  it('上3 决算2 → 比例封顶 1（每次决算都有铺垫）', () => {
    const executions = [genericUlt(6)]
    peiluoProminenceMechanic.patchExecutions!({ cfg: { peiluoVerdictCount: 2 }, state: { ultimateCount: 6 }, executions } as any)
    const verdict = executions.find((e: any) => e.moveId === '1551016')
    expect(verdict.peiluoKagerouPairRatio).toBe(1)
  })
})
