import { beforeEach, describe, expect, it } from 'vitest'
import { mockStaticFetch, newPinia } from '@/test/harness'
import { useCatalogStore } from '@/stores/catalog'
import { useConfigStore } from '@/stores/config'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { computePanel } from '@/composables/resourceCalc/helpers'

const baseConfig = {
  wEngineId: '',
  wEngineModLevel: 5,
  driveDisc: {
    fourPieceSetId: '',
    twoPieceSetId: '',
    mainStats: { 4: 'atkPct' as any, 5: 'fireDmg' as any, 6: 'critRate' as any },
    subStatAllocation: {},
  },
  parryCount: 0,
  dodgeCounterCount: 0,
  quickAssistCount: 0,
  chainCountPerStun: 0,
  basicAttackTimeWeight: 1,
}

beforeEach(() => {
  newPinia()
  mockStaticFetch()
})

async function setupBurniceTeam() {
  const catalog = useCatalogStore()
  await catalog.load()
  const config = useConfigStore()
  config.team[0] = { slot: 0, agentId: '1171', cinemaLevel: 6, ...baseConfig } as any
  config.team[1] = { slot: 1, agentId: '', cinemaLevel: 0, ...baseConfig } as any
  config.team[2] = { slot: 2, agentId: '', cinemaLevel: 0, ...baseConfig } as any
  return config
}

async function setupSoloAgent(agentId: string) {
  const catalog = useCatalogStore()
  await catalog.load()
  const config = useConfigStore()
  config.team[0] = { slot: 0, agentId, cinemaLevel: 0, ...baseConfig } as any
  config.team[1] = { slot: 1, agentId: '', cinemaLevel: 0, ...baseConfig } as any
  config.team[2] = { slot: 2, agentId: '', cinemaLevel: 0, ...baseConfig } as any
  return config
}

describe('resource config reactivity', () => {
  it('recomputes total damage on enemy and mechanic setting changes', async () => {
    const config = await setupBurniceTeam()
    const calc = useResourceCalc()
    await new Promise(r => setTimeout(r, 0))

    const baseDamage = calc.teamTotalDamage.value
    config.setEnemy({ battleTime: 300 })
    await new Promise(r => setTimeout(r, 0))
    expect(calc.teamTotalDamage.value).not.toBe(baseDamage)

    config.setMechanicSetting('burnice.doubleSpraySeconds', 0)
    await new Promise(r => setTimeout(r, 0))
    expect(calc.resourceResult.value?.characters[0]?.executions.some(e => e.moveId === '1171012')).toBe(false)

    config.setMechanicSetting('burnice.doubleSpraySeconds', 2.274)
    await new Promise(r => setTimeout(r, 0))
    expect(calc.resourceResult.value?.characters[0]?.executions.some(e => e.moveId === '1171012')).toBe(true)
  })

  it('applies cinema 3/5 skill level bonuses to Remielle damage', async () => {
    const config = await setupSoloAgent('1581')
    const calc = useResourceCalc()

    config.setCinemaLevel(0, 2)
    await new Promise(r => setTimeout(r, 0))
    const d2 = calc.teamTotalDamage.value
    config.setCinemaLevel(0, 3)
    await new Promise(r => setTimeout(r, 0))
    const d3 = calc.teamTotalDamage.value
    config.setCinemaLevel(0, 4)
    await new Promise(r => setTimeout(r, 0))
    const d4 = calc.teamTotalDamage.value
    config.setCinemaLevel(0, 5)
    await new Promise(r => setTimeout(r, 0))
    const d5 = calc.teamTotalDamage.value

    expect(d2).toBeGreaterThan(0)
    expect(d3 / d2).toBeGreaterThan(1.02)
    expect(d5 / d4).toBeGreaterThan(1.02)
  })

  it('applies Jane cinema 2/4 teammate buffs to her panel', async () => {
    const catalog = useCatalogStore()
    await catalog.load()
    await catalog.loadTeammateBuffs()
    const config = useConfigStore()
    config.team[0] = { slot: 0, agentId: '1261', cinemaLevel: 2, ...baseConfig } as any
    config.team[1] = { slot: 1, agentId: '', cinemaLevel: 0, ...baseConfig } as any
    config.team[2] = { slot: 2, agentId: '', cinemaLevel: 0, ...baseConfig } as any
    config.syncTeammateBuffsFromTeam()

    const c2Panel = computePanel(0, config, catalog)
    expect(c2Panel?.enemyAssaultDefReduction ?? 0).toBeGreaterThanOrEqual(15)

    config.setCinemaLevel(0, 4)
    config.syncTeammateBuffsFromTeam()
    const c4Panel = computePanel(0, config, catalog)
    expect(c4Panel?.anomalyDmgBonus ?? 0).toBeGreaterThanOrEqual(18)
  })
})
