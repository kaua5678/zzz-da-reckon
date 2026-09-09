/**
 * 热启动缓存（2026-08 复活）生效测试：
 * - 逐位透明：同配置二次调用命中缓存，指纹与冷算完全一致、迭代轮数不增。**注意口径（2026-09-08 修）**：
 *   缓存存的是**规范种子**（本轮 states 初值），不是收敛末态——折叠 pass0 的 refund 冻结与内层落点
 *   随初值变（非实数化队落点本就漂移），存末态会让同配置第二次计算换结果（1431 系实测 slack
 *   9.20 vs 4.86 等）。加速是未来实数化专项的事，当下先保「同配置连续计算不许变」。
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
  await setupHarness(team)
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
    // 界按 1051 的**正确职业口径**重标定（2026-09-07）：harness 交互默认改走
    // interactionBaselineFor 后，她按 NO_GENERIC_INTERACTION_AGENTS 拿 0 弹刀/0 闪反
    // （旧 TEST_BASE_CHAR 硬发 6/10 与她「蓄力→极寒重碾 carry、弹刀闪反归击破位」的口径失真）。
    // 去掉那 16 次交互后能量/喧响输入变少，内层合法地多跑几轮：实测 41（上限 100、
    // converged=true、冷热指纹逐位一致、上一行仍锁热启动不多于冷启动）。
    // 本断言的意图是「远不到 1051 抬起来的 100 轮上限」，不是「<20」这个旧输入标定值。
    expect(hot.iterations).toBeLessThan(60)
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

  it('1431 系（落点随初值漂移的非实数化队）：同配置二次调用逐位一致', async () => {
    // 2026-09-08 修（用户实测「同一队算两次结果不一样」）：缓存曾存「试探前末态」→ 折叠 pass0 的
    // refund 冻结与内层落点随初值变，注入收敛态等于把本轮落点带进下一轮 → 冷/热分叉
    // （实测该系 4 队 slack 9.20 vs 4.86、7.57 vs 1.03、3.06 vs 6.26、0.68 vs 0.45）。
    // 修法：缓存只存规范种子（本轮 states 初值）。本用例是这条不变量的机器判据——
    // 叶瞬光无实数化，逐位一致只能靠「注入种子与冷算同源」，不能靠落点唯一。
    const cfg = await capturedConfig([{ agentId: '1431' }, { agentId: '1341' }, { agentId: '1031' }])
    const cold = calcTeamResources(deepCopy(cfg))
    const hot = calcTeamResources(deepCopy(cfg))
    expect(fingerprint(hot)).toEqual(fingerprint(cold))
    expect(hot.converged).toBe(true)
  })
})
