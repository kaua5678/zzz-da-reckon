/**
 * 热启动缓存（2026-08 复活）生效测试：
 * - 逐位透明：同配置二次调用命中缓存，指纹与冷算完全一致、迭代轮数不增（块注释所述
 *   「从上一收敛末态出发 = 落在不动点上」的直接验证）；
 * - 精确键口径：剔除写回/草稿字段后不同输入不误命中；LRU 容量内可轮转复 hit；
 * - 显式 initialStates（测试种子）优先于缓存，不触发查缓存——次数与冷算一致
 *   （小数位允许随初值微移，见 core/resource.ts 热启动块注释的度量记录）。
 */
import { describe, expect, it, beforeEach } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { calcTeamResources, clearWarmStartCache, getWarmStartStats } from '@/core/resource'
import type { ResourceCalcConfig, IterationState } from '@/types/resource'

function deepCopy(cfg: ResourceCalcConfig): ResourceCalcConfig {
  return JSON.parse(JSON.stringify(cfg))
}

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
    basics: rr.characters.map(c => c.timeAllocation.basicAttackTime.toFixed(6)),
    decibels: rr.characters.map(c => (c.decibelSource?.total ?? 0).toFixed(6)),
    converged: rr.converged,
  }
}

async function capturedConfig(team: Array<{ agentId: string; wEngineId?: string }>): Promise<ResourceCalcConfig> {
  const { config: store } = await setupHarness(team)
  const calc = useResourceCalc()
  const cfg = calc.resourceConfig.value!
  expect(cfg.characters.length).toBeGreaterThan(0)
  return deepCopy(cfg)
}

describe('热启动缓存', () => {
  beforeEach(() => {
    clearWarmStartCache()
  })

  it('伊德海莉+莱卡恩+卢西娅：同配置二次调用命中，结果与冷算逐位一致且迭代更少', async () => {
    const cfg = await capturedConfig([
      { agentId: '1051', wEngineId: '14105' },
      { agentId: '1141' },
      { agentId: '1451', wEngineId: '14145' },
    ])

    const cold = calcTeamResources(deepCopy(cfg))
    expect(cold.converged).toBe(true)
    expect(getWarmStartStats()).toEqual({ stored: 1, seeded: 0 })

    const hot = calcTeamResources(deepCopy(cfg))
    expect(getWarmStartStats().seeded).toBe(1)
    expect(fingerprint(hot)).toEqual(fingerprint(cold))
    expect(hot.iterations).toBeLessThanOrEqual(cold.iterations)
    expect(hot.iterations).toBeLessThan(20)
  })

  it('精确键口径：改输入后首次不误命中，其自身第二次调用才命中；容量内旧条目仍可轮转回hit', async () => {
    const cfgA = await capturedConfig([
      { agentId: '1531', wEngineId: '13019' },
      { agentId: '1481' },
      { agentId: '1451', wEngineId: '14145' },
    ])
    const cfgB = deepCopy(cfgA)
    cfgB.characters[0].parryCount = (cfgB.characters[0].parryCount ?? 0) + 3

    calcTeamResources(deepCopy(cfgA)) // 存 A
    expect(getWarmStartStats().seeded).toBe(0)
    const bFirst = calcTeamResources(deepCopy(cfgB)) // B 首次：不得吃 A 的种子
    expect(getWarmStartStats().seeded).toBe(0)

    const aAgain = calcTeamResources(deepCopy(cfgA)) // A 再次：精确命中，与首个 A 逐位一致
    const aColdRef = calcTeamResources(deepCopy(cfgA)) // 已命中态再跑仍一致
    expect(fingerprint(aAgain)).toEqual(fingerprint(aColdRef))

    const bSecond = calcTeamResources(deepCopy(cfgB)) // B 第二次：命中自己上轮末态
    expect(fingerprint(bSecond)).toEqual(fingerprint(bFirst))
    expect(getWarmStartStats().seeded).toBe(3)
  })

  it('显式 initialStates 优先：注入高种子不查缓存也不回写，次数与零种子一致', async () => {
    const cfg = await capturedConfig([{ agentId: '1051' }, { agentId: '1141' }, { agentId: '1451' }])
    const cold = calcTeamResources(deepCopy(cfg))

    const before = getWarmStartStats()
    const explicit = calcTeamResources({ ...deepCopy(cfg), initialStates: inflatedSeed(cfg) })
    expect(getWarmStartStats()).toEqual(before)
    expect(explicit.converged).toBe(true)
    expect(explicit.characters.map(c => `${c.exSpecialCount}/${c.ultimateCount}`))
      .toEqual(cold.characters.map(c => `${c.exSpecialCount}/${c.ultimateCount}`))
  })
})
