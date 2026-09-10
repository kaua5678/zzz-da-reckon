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

  it('⑤ 失衡次数不是约束（是分配的结果）：均衡照常应用，次数变化如实上报不拦截', async () => {
    const { catalog } = await setupHarness(['', '', ''])
    await catalog.loadBuildRecommendations()
    const config = useConfigStore()
    const calc = useResourceCalc()
    // auto-1591-1481-1311：实测均衡解会把失衡 4→3 同时 +10.1% 伤害。
    // 用户口径 2026-09-10 修正：「最终目的是总伤提高，失衡四舍五入不一定让总伤提高」→
    // 次数**不是约束**（曾按硬约束回滚，已撤销）；次数变化只做如实上报。
    const p = teamPresets.find(x => x.id === 'auto-1591-1481-1311')!
    for (let i = 0; i < 3; i++) config.setAgent(i, p.team[i])
    config.applyTeamPreset(p.team as [string, string, string])
    const stunBefore = calc.stunPoolResult.value!.stunCount
    const dmgBefore = calc.teamTotalDamage.value
    const r = applyTimeWeightAllocation({ calc, configStore: config }, 'marginal-equalize')
    expect(r.applied).toBe(true)
    expect(r.damage).toBeGreaterThanOrEqual(dmgBefore - 1e-6)
    const stunAfter = calc.stunPoolResult.value!.stunCount
    if (stunAfter !== stunBefore) {
      // 若该队均衡确实改了次数：必须在 note 里如实上报（不静默、不拦截）
      expect(r.note ?? '').toContain('次数是分配的结果')
    }
  })

  it('⑥ 联合策略：弹刀也是伤害杠杆（按总伤爬，且会主动减少低效交互）', async () => {
    const { catalog } = await setupHarness(['', '', ''])
    await catalog.loadBuildRecommendations()
    const config = useConfigStore()
    const calc = useResourceCalc()
    // auto-1521-1361-1311：实测弹刀 12→0 时总伤 83.5M→92.2M（PROBE_STUN_LEVER）——
    // 低效交互（吃必要前台时间）应被搜索**减掉**，这是「弹刀是杠杆」的下半句。
    const p = teamPresets.find(x => x.id === 'auto-1521-1361-1311')!
    for (let i = 0; i < 3; i++) config.setAgent(i, p.team[i])
    config.applyTeamPreset(p.team as [string, string, string])
    const dmgBefore = calc.teamTotalDamage.value
    const parryBefore = [0, 1, 2].map(s => config.team[s]!.parryCount)
    expect(calc.resourceResult.value!.convergence?.timeTruncatedSeconds ?? 0, '该队基线应可行').toBeLessThanOrEqual(1e-6)
    const r = applyTimeWeightAllocation({ calc, configStore: config })
    expect(r.strategyId).toBe('joint-levers')
    expect(r.applied).toBe(true)
    expect(r.damage).toBeGreaterThanOrEqual(dmgBefore - 1e-6)
    expect(calc.resourceResult.value!.convergence?.timeTruncatedSeconds ?? 0).toBeLessThanOrEqual(1e-6)
    const parryAfter = [0, 1, 2].map(s => config.team[s]!.parryCount)
    expect(parryAfter.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(parryBefore.reduce((a, b) => a + b, 0))
  })

  it('⑥b 已经超时的配置（如 1591 轴队）拒绝自动分配并说明原因', async () => {
    const { catalog } = await setupHarness(['', '', ''])
    await catalog.loadBuildRecommendations()
    const config = useConfigStore()
    const calc = useResourceCalc()
    const p = teamPresets.find(x => x.id === 'auto-1591-1481-1311')!
    for (let i = 0; i < 3; i++) config.setAgent(i, p.team[i])
    config.applyTeamPreset(p.team as [string, string, string])
    const truncated = calc.resourceResult.value!.convergence?.timeTruncatedSeconds ?? 0
    expect(truncated, '该队列为「基线本身就超时」的样本').toBeGreaterThan(0)
    const r = applyTimeWeightAllocation({ calc, configStore: config })
    expect(r.applied).toBe(false)
    expect(r.note ?? '').toContain('已超时')
  })

  it('⑦ 用户约束「弹刀多了也不能超过总时间」：越界配置被硬门挡住（不会无限加）', async () => {
    const { catalog } = await setupHarness(['', '', ''])
    await catalog.loadBuildRecommendations()
    const config = useConfigStore()
    const calc = useResourceCalc()
    const p = teamPresets.find(x => x.id === 'auto-1591-1481-1311')!
    for (let i = 0; i < 3; i++) config.setAgent(i, p.team[i])
    config.applyTeamPreset(p.team as [string, string, string])
    config.setParryCount(0, 99)
    const overflow = calc.resourceResult.value!.convergence?.timeTruncatedSeconds ?? 0
    expect(overflow, '弹刀 99 次应当装不下（装配截断 > 0），这正是硬门要挡的越界态').toBeGreaterThan(0)
    const r = applyTimeWeightAllocation({ calc, configStore: config })
    expect(r.applied).toBe(false)
    expect(r.note ?? '').toContain('已超时')
  })

  it('⑧ 弹刀下限 = boss 预设强制次数（parryTotal），搜索不得下调到它以下', async () => {
    const { catalog } = await setupHarness(['', '', ''])
    await catalog.loadBuildRecommendations()
    const config = useConfigStore()
    const calc = useResourceCalc()
    const p = teamPresets.find(x => x.id === 'auto-1521-1361-1311')!
    for (let i = 0; i < 3; i++) config.setAgent(i, p.team[i])
    config.applyTeamPreset(p.team as [string, string, string])
    // 合成一个 boss 预设：13 次正常弹刀（同叶释渊 defaults.parryTotal）
    config.applyBossPreset(
      { id: 'test-boss' },
      {
        phaseId: 'p1', hp: 1e6, stunValue: 15000, defense: 0, level: 60,
        bossAnomalyCoeff: 1, damageResistances: {}, stunResistances: {}, anomalyResistances: {},
      },
      { stunVuln: 1, stunTime: 16 },
      { battleTime: 180, shieldCount: 0, energyShield: 0, parryTotal: 13 },
    )
    expect(config.appliedBoss?.parryTotal).toBe(13)
    // 输入刻意**高于**强制次数（主C 8 + 击破 8 = 16 > 13）→ 搜索可以下调，但不得低于 13。
    // 注：低于下限的部分由 `core/parrySplit.ts` 负责补齐（单一事实源），本策略只承诺「不下调越过它」。
    config.setParryCount(0, 8)
    config.setParryCount(1, 8)
    config.setParryCount(2, 0)
    const r = applyTimeWeightAllocation({ calc, configStore: config })
    const total = [0, 1, 2].reduce((a, s) => a + config.team[s]!.parryCount, 0)
    expect(total, '搜索不得把弹刀总数压到 boss 预设强制次数以下').toBeGreaterThanOrEqual(13)
    if (total < 16) {
      expect(r.note ?? '', '下调到下限时须如实说明是 boss 预设强制次数挡住的').toContain('强制次数')
    }
  })

  it('注册表契约：默认策略在表内、id 唯一（扩展点）', () => {
    expect(TIME_WEIGHT_STRATEGIES.length).toBeGreaterThan(0)
    expect(getTimeWeightStrategy(DEFAULT_TIME_WEIGHT_STRATEGY_ID).id).toBe(DEFAULT_TIME_WEIGHT_STRATEGY_ID)
    expect(new Set(TIME_WEIGHT_STRATEGIES.map(s => s.id)).size).toBe(TIME_WEIGHT_STRATEGIES.length)
    // 未知 id 回落默认策略（不抛错：UI 开关不会因为策略改名而炸）
    expect(getTimeWeightStrategy('not-a-strategy').id).toBe(DEFAULT_TIME_WEIGHT_STRATEGY_ID)
  })
})
