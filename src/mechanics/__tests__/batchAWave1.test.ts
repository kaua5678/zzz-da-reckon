import { describe, expect, it } from 'vitest'
import { setupHarness, type HarnessTeamSlot } from '@/test/harness'

// 本文件统一槽位配置（与旧模板 baseConfig 同口径）
function wave1Slot(agentId: string, cinemaLevel = 0): HarnessTeamSlot {
  return {
    agentId,
    cinemaLevel,
    wEngineId: '',
    wEngineModLevel: 5,
    driveDisc: { fourPieceSetId: '', twoPieceSetId: '', mainStats: { 4: 'atkPct', 5: 'physicalDmg', 6: 'critRate' }, subStatAllocation: {} },
    parryCount: 10,
    dodgeCounterCount: 6,
    blockCount: 20,
    quickAssistCount: 0,
    chainCountPerStun: 0,
    basicAttackTimeWeight: 1,
  }
}

async function setup(team: Array<{ agentId: string; cinemaLevel: number }>) {
  return setupHarness(team.map(t => wave1Slot(t.agentId, t.cinemaLevel)))
}

describe('伊芙琳（1321）影画2 赴火之舞：攻击力 +15%', () => {
  it('命座差分：1命 → 2命，攻击力 ×1.15', async () => {
    const { catalog, config } = await setup([{ agentId: '1321', cinemaLevel: 1 }])
    const { computePanelPhases } = await import('@/composables/resourceCalc/helpers')
    const p1 = computePanelPhases(0, config, catalog)!.inCombat as any
    config.team[0].cinemaLevel = 2
    const p2 = computePanelPhases(0, config, catalog)!.inCombat as any
    expect(p2.atk).toBe(Math.round(p1.atk * 1.15))
  })

  it('防死数据：0/1命时无攻击力加成', async () => {
    const { catalog, config } = await setup([{ agentId: '1321', cinemaLevel: 0 }])
    const { computePanelPhases } = await import('@/composables/resourceCalc/helpers')
    const p0 = computePanelPhases(0, config, catalog)!.inCombat as any
    config.team[0].cinemaLevel = 1
    const p1 = computePanelPhases(0, config, catalog)!.inCombat as any
    expect(p1.atk).toBe(p0.atk)
  })
})

describe('薇薇安（1331）影画2《暴风雨夜，暴风雨夜》：以太异常积蓄效率 +25%', () => {
  it('命座差分：1命 → 2命，etherAnomalyBuildUpEfficiency +25', async () => {
    const { catalog, config } = await setup([{ agentId: '1331', cinemaLevel: 1 }])
    const { computePanelPhases } = await import('@/composables/resourceCalc/helpers')
    const p1 = computePanelPhases(0, config, catalog)!.inCombat as any
    config.team[0].cinemaLevel = 2
    const p2 = computePanelPhases(0, config, catalog)!.inCombat as any
    expect((p2.etherAnomalyBuildUpEfficiency ?? 0) - (p1.etherAnomalyBuildUpEfficiency ?? 0)).toBe(25)
  })

  it('防死数据：0命时无积蓄效率加成', async () => {
    const { catalog, config } = await setup([{ agentId: '1331', cinemaLevel: 0 }])
    const { computePanelPhases } = await import('@/composables/resourceCalc/helpers')
    const p0 = computePanelPhases(0, config, catalog)!.inCombat as any
    expect(p0.etherAnomalyBuildUpEfficiency ?? 0).toBe(0)
  })
})

describe('安东（1111）影画4 一起燃烧！：全队暴击率 +10%（影画四门控）', () => {
  it('安东4命在队：队友（安比）暴击率 +10', async () => {
    const { catalog, config } = await setup([
      { agentId: '1111', cinemaLevel: 4 },
      { agentId: '1011', cinemaLevel: 0 },
    ])
    const { computePanelPhases } = await import('@/composables/resourceCalc/helpers')
    const withBuff = computePanelPhases(1, config, catalog)!.inCombat as any
    config.team[0].cinemaLevel = 0
    config.syncTeammateBuffsFromTeam()
    const withoutBuff = computePanelPhases(1, config, catalog)!.inCombat as any
    expect(withBuff.critRate - withoutBuff.critRate).toBe(10)
  })

  it('门控验证：安东3命时全队拐力不生效', async () => {
    const { catalog, config } = await setup([
      { agentId: '1111', cinemaLevel: 3 },
      { agentId: '1011', cinemaLevel: 0 },
    ])
    const { computePanelPhases } = await import('@/composables/resourceCalc/helpers')
    const p = computePanelPhases(1, config, catalog)!.inCombat as any
    config.team[0].agentId = ''
    config.syncTeammateBuffsFromTeam()
    const baseline = computePanelPhases(1, config, catalog)!.inCombat as any
    expect(p.critRate).toBe(baseline.critRate)
  })
})
