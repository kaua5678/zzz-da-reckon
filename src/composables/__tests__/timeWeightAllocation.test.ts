/**
 * 平A池权重·分配策略的生效测试（2026-09-10）。
 *
 * 判据（对应用户口径「不分配足够的平A，总量也不够」+ 开关默认关）：
 *  ① 开关默认关 → 权重保持静态默认，策略不自动跑；
 *  ② 触发签名**不含权重本身**（否则策略写回权重会自触发成死循环）——策略新增逻辑时这条最容易踩；
 *  ③ 应用策略后：权重确实被改动，且**团队总伤不降**（均衡器是坐标上升，单调不劣）；
 *  ④ 主C（槽0）的平A池时间**增加**——即「能量不够就多A」这条约束在当前策略下确实被喂饱
 *     （实测 auto-1521-1361-1311：平A 31.8→65.7s、强特 16→18 次、伤害 +23.9%）。
 */
import { describe, it, expect } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useConfigStore } from '@/stores/config'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { teamPresets } from '@/data/teamPresets'
import {
  TIME_WEIGHT_STRATEGIES,
  DEFAULT_TIME_WEIGHT_STRATEGY_ID,
  applyTimeWeightAllocation,
  timeWeightAllocationSignature,
  getTimeWeightStrategy,
} from '@/composables/timeWeightAllocation'

const PRESET_ID = 'auto-1521-1361-1311'

describe('平A池权重·分配策略', () => {
  it('① 开关默认关：静态默认权重不受影响', async () => {
    const { catalog } = await setupHarness(['', '', ''])
    await catalog.loadBuildRecommendations()
    const config = useConfigStore()
    expect(config.autoAllocateBasicTime).toBe(false)
    const p = teamPresets.find(x => x.id === PRESET_ID)!
    for (let i = 0; i < 3; i++) config.setAgent(i, p.team[i])
    config.applyTeamPreset(p.team as [string, string, string])
    const before = [0, 1, 2].map(s => config.team[s]!.basicAttackTimeWeight)
    // 只读一次结果（不调用任何策略）→ 权重必须原样
    const calc = useResourceCalc()
    void calc.teamTotalDamage.value
    expect([0, 1, 2].map(s => config.team[s]!.basicAttackTimeWeight)).toEqual(before)
    expect(config.autoAllocateBasicTime).toBe(false)
  })

  it('② 触发签名排除权重本身（否则策略写回权重会自触发）', async () => {
    const { catalog } = await setupHarness(['', '', ''])
    await catalog.loadBuildRecommendations()
    const config = useConfigStore()
    const p = teamPresets.find(x => x.id === PRESET_ID)!
    for (let i = 0; i < 3; i++) config.setAgent(i, p.team[i])
    config.applyTeamPreset(p.team as [string, string, string])
    const sigBefore = timeWeightAllocationSignature(config)
    config.setBasicAttackTimeWeight(0, 7)
    expect(timeWeightAllocationSignature(config)).toBe(sigBefore)
  })

  it('③④ 应用边际均衡：权重被改动、总伤不降、主C 平A池被喂饱', async () => {
    const { catalog } = await setupHarness(['', '', ''])
    await catalog.loadBuildRecommendations()
    const config = useConfigStore()
    const calc = useResourceCalc()
    const p = teamPresets.find(x => x.id === PRESET_ID)!
    for (let i = 0; i < 3; i++) config.setAgent(i, p.team[i])
    config.applyTeamPreset(p.team as [string, string, string])
    const dmgBefore = calc.teamTotalDamage.value
    const bat0Before = calc.resourceResult.value!.characters[0]!.timeAllocation.basicAttackTime
    const r = applyTimeWeightAllocation({ calc, configStore: config })
    expect(r.strategyId).toBe(DEFAULT_TIME_WEIGHT_STRATEGY_ID)
    expect(r.applied).toBe(true)
    expect(r.damage).toBeGreaterThanOrEqual(dmgBefore - 1e-6)
    expect(calc.resourceResult.value!.characters[0]!.timeAllocation.basicAttackTime)
      .toBeGreaterThan(bat0Before)
  })

  it('⑤ 失衡次数是硬约束：均衡解掉次数时回滚权重并如实上报', async () => {
    const { catalog } = await setupHarness(['', '', ''])
    await catalog.loadBuildRecommendations()
    const config = useConfigStore()
    const calc = useResourceCalc()
    // auto-1591-1481-1311：实测均衡解会把失衡 4→3 换 +10.1% 伤害（PROBE_CONV_BALANCE_STUN）
    const p = teamPresets.find(x => x.id === 'auto-1591-1481-1311')!
    for (let i = 0; i < 3; i++) config.setAgent(i, p.team[i])
    config.applyTeamPreset(p.team as [string, string, string])
    const stunBefore = calc.stunPoolResult.value!.stunCount
    const weightsBefore = [0, 1, 2].map(s => config.team[s]!.basicAttackTimeWeight)
    const r = applyTimeWeightAllocation({ calc, configStore: config })
    expect(calc.stunPoolResult.value!.stunCount).toBe(stunBefore)
    expect([0, 1, 2].map(s => config.team[s]!.basicAttackTimeWeight)).toEqual(weightsBefore)
    expect(r.applied).toBe(false)
    expect(r.note).toContain('失衡次数优先')
  })

  it('注册表契约：默认策略在表内、id 唯一（扩展点）', () => {
    expect(TIME_WEIGHT_STRATEGIES.length).toBeGreaterThan(0)
    expect(getTimeWeightStrategy(DEFAULT_TIME_WEIGHT_STRATEGY_ID).id).toBe(DEFAULT_TIME_WEIGHT_STRATEGY_ID)
    expect(new Set(TIME_WEIGHT_STRATEGIES.map(s => s.id)).size).toBe(TIME_WEIGHT_STRATEGIES.length)
    // 未知 id 回落默认策略（不抛错：UI 开关不会因为策略改名而炸）
    expect(getTimeWeightStrategy('not-a-strategy').id).toBe(DEFAULT_TIME_WEIGHT_STRATEGY_ID)
  })
})
