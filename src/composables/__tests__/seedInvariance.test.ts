/**
 * 连续松弛的种子不变性（2026-08）：次数实数化迭代、终局统一 floor 后，
 * 收敛态必须是输入的纯函数——零种子与高种子（模拟热启动/任意初值）得到逐位相同的结果。
 * 这是不动点滞回（12/3 vs 12/4）被消除的直接判据，也是热启动安全性的前提。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { mockStaticFetch, newPinia } from '@/test/harness'
import { useCatalogStore } from '@/stores/catalog'
import { useConfigStore } from '@/stores/config'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { calcTeamResources } from '@/core/resource'
import type { ResourceCalcConfig, IterationState } from '@/types/resource'

const captured: ResourceCalcConfig[] = []
vi.mock('@/core/resource', async () => {
  const actual = await vi.importActual<typeof import('@/core/resource')>('@/core/resource')
  return {
    ...actual,
    calcTeamResources: (config: ResourceCalcConfig) => {
      if (captured.length < 4) captured.push(JSON.parse(JSON.stringify(config)))
      return actual.calcTeamResources(config)
    },
  }
})

beforeEach(() => {
  mockStaticFetch()
})

/** 高种子：模拟「从上次收敛态/任意邻域初值出发」的极端情形 */
function inflatedSeed(cfg: ResourceCalcConfig): IterationState[] {
  return cfg.characters.map(c => ({
    basicAttackTime: 5,
    exSpecialCount: 50,
    ultimateCount: 8,
    chainCountTotal: c.chainCountTotalOverride ?? c.chainCountPerStun * 4,
    totalEnergy: 9999,
    totalDecibel: 99999,
    necessaryTime: 50,
    frontlineTime: 60,
    backstageTime: 120,
    comboAlignTime: 10,
  }))
}

function fingerprint(rr: ReturnType<typeof calcTeamResources>) {
  return {
    counts: rr.characters.map(c => `${c.exSpecialCount}/${c.ultimateCount}`),
    basics: rr.characters.map(c => (c.timeAllocation as any).basicAttackTime.toFixed(6)),
    decibels: rr.characters.map(c => ((c as any).decibelSource?.total ?? 0).toFixed(6)),
    converged: rr.converged,
  }
}

async function setupCapture(team: [string, string, string], engines: [string, string, string]) {
  captured.length = 0
  newPinia()
  const catalog = useCatalogStore()
  await catalog.load()
  await catalog.loadTeammateBuffs()
  const config = useConfigStore()
  for (let s = 0; s < 3; s++) {
    config.setAgent(s, team[s])
    if (engines[s]) config.setWEngine(s, engines[s])
  }
  const calc = useResourceCalc()
  void calc.resourceResult.value
  expect(captured.length).toBeGreaterThan(0)
  return JSON.parse(JSON.stringify(captured[0])) as ResourceCalcConfig
}

describe('连续松弛·种子不变性', () => {
  it('伊德海莉+莱卡恩+卢西娅：零种子 vs 高种子 → 同一收敛态', async () => {
    const cfg = await setupCapture(['1051', '1141', '1451'], ['14105', '', '14145'])
    const cold = calcTeamResources(JSON.parse(JSON.stringify(cfg)))
    const hot = calcTeamResources({ ...JSON.parse(JSON.stringify(cfg)), initialStates: inflatedSeed(cfg) })
    const fc = fingerprint(cold), fh = fingerprint(hot)
    console.log('cold', JSON.stringify(fc)); console.log('hot ', JSON.stringify(fh))
    expect(fh).toEqual(fc)
    expect(cold.converged).toBe(true)
  })

  it('星徽·比利+琉音+卢西娅（整数结构模块队）：同样种子无关', async () => {
    const cfg = await setupCapture(['1531', '1481', '1451'], ['13019', '', '14145'])
    const cold = calcTeamResources(JSON.parse(JSON.stringify(cfg)))
    const hot = calcTeamResources({ ...JSON.parse(JSON.stringify(cfg)), initialStates: inflatedSeed(cfg) })
    expect(fingerprint(hot)).toEqual(fingerprint(cold))
  })
})
