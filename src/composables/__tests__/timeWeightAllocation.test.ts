/**
 * 平A池权重·分配策略的生效测试（2026-09-10）。
 *
 * 判据（对应用户口径「不分配足够的平A，总量也不够」+ 「默认快一些的B，做个开关，如果开了就是更慢的C」）：
 *  ① **三态** `timeWeightStrategy`：`'balanced'`（默认，= 边际均衡 B）/ `'joint'`（= 多杠杆联合 C）/
 *     `'static'`（**不跑策略**，静态默认权重或手填值）——映射单源 `timeWeightStrategyIdForMode`；
 *  ② 触发签名**不含权重本身**（否则策略写回权重会自触发成死循环）——策略新增逻辑时这条最容易踩；
 *  ③ 走默认（不点名策略）时：权重确实被改动、`strategyId` = B、**团队总伤不降**（坐标上升单调不劣）；
 *  ④ 主C（槽0）的平A池时间**增加**——即「能量不够就多A」这条约束在当前策略下确实被喂饱
 *     （实测 auto-1521-1361-1311：平A 31.8→65.7s、强特 16→18 次、伤害 +23.9%）。
 *  ⑥~⑧ 测的是 **C 的杠杆**（可行性优先/弹刀阶梯/相对门/能量驱动/角点解/弹刀下限）→ 必须显式点名
 *     `DEEP_TIME_WEIGHT_STRATEGY_ID`（默认已不是 C）。
 */
import { describe, it, expect, vi } from 'vitest'
import { effectScope, nextTick } from 'vue'
import { setupHarness } from '@/test/harness'
import { useConfigStore } from '@/stores/config'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { teamPresets } from '@/data/teamPresets'
import {
  TIME_WEIGHT_STRATEGIES,
  DEFAULT_TIME_WEIGHT_STRATEGY_ID,
  DEEP_TIME_WEIGHT_STRATEGY_ID,
  applyTimeWeightAllocation,
  timeWeightAllocationSignature,
  timeWeightStrategyIdForMode,
  useTimeWeightAutoAllocation,
  getTimeWeightStrategy,
} from '@/composables/timeWeightAllocation'

const PRESET_ID = 'auto-1521-1361-1311'

// 本文件每个用例都要跑「联合策略」（≈15~20 次完整引擎求值，单跑 1~5s）；全量并行下会撞 vitest 默认
// 5000ms 上限（2026-09-10 实测 5557/5799ms 假红）→ 文件级显式超时。
vi.setConfig({ testTimeout: 30_000 })

describe('平A池权重·分配策略', () => {
  it('① 三态默认 = 均衡（B）；static 映射为「不跑」；只读结果不触发任何分配', async () => {
    const { catalog } = await setupHarness(['', '', ''])
    await catalog.loadBuildRecommendations()
    const config = useConfigStore()
    // 三态映射单源：default = B；joint = C；static = **不跑**（返回 null）
    expect(DEFAULT_TIME_WEIGHT_STRATEGY_ID).toBe('marginal-equalize')
    expect(DEEP_TIME_WEIGHT_STRATEGY_ID).toBe('joint-levers')
    expect(timeWeightStrategyIdForMode('balanced')).toBe(DEFAULT_TIME_WEIGHT_STRATEGY_ID)
    expect(timeWeightStrategyIdForMode('joint')).toBe(DEEP_TIME_WEIGHT_STRATEGY_ID)
    expect(timeWeightStrategyIdForMode('static')).toBeNull()
    expect(config.timeWeightStrategy).toBe('balanced')
    const p = teamPresets.find(x => x.id === PRESET_ID)!
    for (let i = 0; i < 3; i++) config.setAgent(i, p.team[i])
    config.applyTeamPreset(p.team as [string, string, string])
    const before = [0, 1, 2].map(s => config.team[s]!.basicAttackTimeWeight)
    // 只读一次结果（不调用任何策略、也不挂 `useTimeWeightAutoAllocation`）→ 权重必须原样：
    // 分配求解刻意放在「计算外侧」显式调用（策略要读伤害做有限差分，进 computed 会递归）。
    const calc = useResourceCalc()
    void calc.teamTotalDamage.value
    expect([0, 1, 2].map(s => config.team[s]!.basicAttackTimeWeight)).toEqual(before)
    expect(config.timeWeightStrategy).toBe('balanced')
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
    // **不点名策略 = 走默认（B 边际均衡）**（用户 2026-09-10：「默认快一些的B」）
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
    const r = applyTimeWeightAllocation({ calc, configStore: config }, DEEP_TIME_WEIGHT_STRATEGY_ID)
    expect(r.strategyId).toBe('joint-levers')
    expect(r.applied).toBe(true)
    expect(r.damage).toBeGreaterThanOrEqual(dmgBefore - 1e-6)
    expect(calc.resourceResult.value!.convergence?.timeTruncatedSeconds ?? 0).toBeLessThanOrEqual(1e-6)
    const parryAfter = [0, 1, 2].map(s => config.team[s]!.parryCount)
    expect(parryAfter.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(parryBefore.reduce((a, b) => a + b, 0))
  })

  it('⑥b 基线已超时的队也照常优化（相对门：只保证不更差，不再拒绝）', async () => {
    const { catalog } = await setupHarness(['', '', ''])
    await catalog.loadBuildRecommendations()
    const config = useConfigStore()
    const calc = useResourceCalc()
    const p = teamPresets.find(x => x.id === 'auto-1591-1481-1311')!
    for (let i = 0; i < 3; i++) config.setAgent(i, p.team[i])
    config.applyTeamPreset(p.team as [string, string, string])
    const truncated = calc.resourceResult.value!.convergence?.timeTruncatedSeconds ?? 0
    expect(truncated, '该队列为「基线本身就超时」的样本').toBeGreaterThan(0)
    const dmgBefore = calc.teamTotalDamage.value
    const r = applyTimeWeightAllocation({ calc, configStore: config }, DEEP_TIME_WEIGHT_STRATEGY_ID)
    // 相对门：允许优化，但**不得新增截断**（原来的「截断必须为 0 否则拒绝」已按用户口径删除）
    const after = calc.resourceResult.value!.convergence?.timeTruncatedSeconds ?? 0
    expect(after).toBeLessThanOrEqual(truncated + 1e-6)
    expect(r.note ?? '').toContain('相对门')
    // 可行性优先（A1）：总伤不得低于基线
    expect(calc.teamTotalDamage.value).toBeGreaterThanOrEqual(dmgBefore - 1e-6)
  })

  it('⑥c 可行性优先（A1）：基线超时队先拉回可行——截断只降不升、总伤不降；拉回即 0，拉不回如实上报', async () => {
    const { catalog } = await setupHarness(['', '', ''])
    await catalog.loadBuildRecommendations()
    const config = useConfigStore()
    const calc = useResourceCalc()
    const p = teamPresets.find(x => x.id === 'auto-1591-1481-1311')!
    for (let i = 0; i < 3; i++) config.setAgent(i, p.team[i])
    config.applyTeamPreset(p.team as [string, string, string])
    const truncated = calc.resourceResult.value!.convergence?.timeTruncatedSeconds ?? 0
    expect(truncated).toBeGreaterThan(0)
    const dmgBefore = calc.teamTotalDamage.value
    const r = applyTimeWeightAllocation({ calc, configStore: config }, DEEP_TIME_WEIGHT_STRATEGY_ID)
    const after = calc.resourceResult.value!.convergence?.timeTruncatedSeconds ?? 0
    const dmgAfter = calc.teamTotalDamage.value
    // 硬不变量：截断不升、总伤不降
    expect(after).toBeLessThanOrEqual(truncated + 1e-6)
    expect(dmgAfter).toBeGreaterThanOrEqual(dmgBefore - 1e-6)
    // 状态如实上报：拉回可行 → 断言归零；拉不回 → 断言「拉不回来」说明
    if (after <= 1e-6) {
      expect(r.note ?? '').toContain('已拉回可行')
    } else {
      expect(r.note ?? '').toContain('拉不回来')
    }
  }, 120_000)   // 重负载用例：满套件并发下实测 ~36s（降配枚举给结构性溢出队加了整轮试算），显式给足超时

  it('⑥d 能量驱动（A2）：主C 强特次数不降 + 总伤不降（多A 喂能或整体还原基线）', async () => {
    const { catalog } = await setupHarness(['', '', ''])
    await catalog.loadBuildRecommendations()
    const config = useConfigStore()
    const calc = useResourceCalc()
    // auto-1521-1361-1311：实测主C 平A 池 31.8→65.7s、强特 16→18 次（用户点名「能量不够就多A」的样本）
    const p = teamPresets.find(x => x.id === 'auto-1521-1361-1311')!
    for (let i = 0; i < 3; i++) config.setAgent(i, p.team[i])
    config.applyTeamPreset(p.team as [string, string, string])
    const exBase = calc.resourceResult.value!.characters[0]!.exSpecialCount
    const dmgBase = calc.teamTotalDamage.value
    const r = applyTimeWeightAllocation({ calc, configStore: config }, DEEP_TIME_WEIGHT_STRATEGY_ID)
    const exAfter = calc.resourceResult.value!.characters[0]!.exSpecialCount
    const dmgAfter = calc.teamTotalDamage.value
    // 判据：主C exSpecialCount 不降 + 总伤不降（ex 提升可能来自均衡/弹刀杠杆，能量杠杆只在
    // 均衡后仍能量紧张时出手；守卫兜底整体还原基线）
    expect(exAfter).toBeGreaterThanOrEqual(exBase)
    expect(dmgAfter).toBeGreaterThanOrEqual(dmgBase - 1e-6)
    // 能量杠杆真的出手过 → 次数必须实打实上升（不接受「名义喂能」）
    if ((r.note ?? '').includes('能量驱动')) {
      expect(exAfter).toBeGreaterThan(exBase)
    }
  })

  it('⑥e 角点解（A3）：非主C 平A 只留「打满失衡」的最小够用，主C 享剩余（失衡不降 + 总伤不降）', async () => {
    const { catalog } = await setupHarness(['', '', ''])
    await catalog.loadBuildRecommendations()
    const config = useConfigStore()
    const calc = useResourceCalc()
    const p = teamPresets.find(x => x.id === 'auto-1521-1361-1311')!
    for (let i = 0; i < 3; i++) config.setAgent(i, p.team[i])
    config.applyTeamPreset(p.team as [string, string, string])
    const stunBase = calc.stunPoolResult.value!.stunCount
    const dmgBase = calc.teamTotalDamage.value
    const r = applyTimeWeightAllocation({ calc, configStore: config }, DEEP_TIME_WEIGHT_STRATEGY_ID)
    // 判据（用户口径「失衡次数先定、总伤为目标」）：失衡不降 + 总伤不降
    expect(calc.stunPoolResult.value!.stunCount).toBeGreaterThanOrEqual(stunBase)
    expect(calc.teamTotalDamage.value).toBeGreaterThanOrEqual(dmgBase - 1e-6)
    // 角点解出手过 → note 如实上报权重转移
    if ((r.note ?? '').includes('角点解')) {
      expect(r.note).toContain('失衡')
      expect(r.note).toContain('主C 享剩余时间')
    }
  })

  it('⑥f 双主C（A4）：两个输出核心都算主C——逐核心强特不降 + 总伤不降，角点解不压输出槽', async () => {
    const { catalog } = await setupHarness(['', '', ''])
    await catalog.loadBuildRecommendations()
    const config = useConfigStore()
    const calc = useResourceCalc()
    // 柏妮思(异常)+维琳娜(异常)+柚叶(支援)：双异常核心队（预设库 28 支双 C 队同款结构）
    const p = teamPresets.find(x => x.id === 'auto-1171-1561-1411')!
    for (let i = 0; i < 3; i++) config.setAgent(i, p.team[i])
    config.applyTeamPreset(p.team as [string, string, string])
    const chars = () => calc.resourceResult.value!.characters
    const exA = chars()[0]!.exSpecialCount
    const exB = chars()[1]!.exSpecialCount
    const dmgBase = calc.teamTotalDamage.value
    const r = applyTimeWeightAllocation({ calc, configStore: config }, DEEP_TIME_WEIGHT_STRATEGY_ID)
    const exA2 = chars()[0]!.exSpecialCount
    const exB2 = chars()[1]!.exSpecialCount
    // 判据（逐核心）：两个主C 的强特次数都不许低于策略入口
    expect(exA2, '主C#1（柏妮思）强特次数不降').toBeGreaterThanOrEqual(exA)
    expect(exB2, '主C#2（维琳娜）强特次数不降（A4 前该槽被角点解当辅助压过）').toBeGreaterThanOrEqual(exB)
    expect(calc.teamTotalDamage.value).toBeGreaterThanOrEqual(dmgBase - 1e-6)
    // 角点解若出手，被压的只能是柚叶（支援位 slot3）——输出槽权重不降
    const m = (r.note ?? '').match(/角点解：非主C 权重 ([\d./]+)→([\d./]+)/)
    if (m) {
      const [, b, a] = m
      const bw = b.split('/').map(Number)
      const aw = a.split('/').map(Number)
      expect(aw[0]).toBeGreaterThanOrEqual(bw[0] - 1e-9)
      expect(aw[1]).toBeGreaterThanOrEqual(bw[1] - 1e-9)
    }
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
    expect(overflow, '弹刀 99 次应当装不下（装配截断 > 0）——搜索不得在此基础上再增加弹刀').toBeGreaterThan(0)
    const before = [0, 1, 2].map(s => config.team[s]!.parryCount)
    applyTimeWeightAllocation({ calc, configStore: config })
    const after = [0, 1, 2].map(s => config.team[s]!.parryCount)
    const truncAfter = calc.resourceResult.value!.convergence?.timeTruncatedSeconds ?? 0
    expect(truncAfter, '相对门：截断不得变差').toBeLessThanOrEqual(overflow + 1e-6)
    expect(after.reduce((a, b) => a + b, 0), '不得靠加弹刀换伤害').toBeLessThanOrEqual(before.reduce((a, b) => a + b, 0))
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
    const r = applyTimeWeightAllocation({ calc, configStore: config }, DEEP_TIME_WEIGHT_STRATEGY_ID)
    const total = [0, 1, 2].reduce((a, s) => a + config.team[s]!.parryCount, 0)
    expect(total, '搜索不得把弹刀总数压到 boss 预设强制次数以下').toBeGreaterThanOrEqual(13)
    if (total < 16) {
      expect(r.note ?? '', '下调到下限时须如实说明是 boss 预设强制次数挡住的').toContain('强制次数')
    }
  })

  it('⑨ 三态在真实入口生效：默认 B → joint 即 C → static 不跑；watcher 跑完即稳定（不自激）', async () => {
    const { catalog } = await setupHarness(['', '', ''])
    await catalog.loadBuildRecommendations()
    const config = useConfigStore()
    const p = teamPresets.find(x => x.id === PRESET_ID)!
    for (let i = 0; i < 3; i++) config.setAgent(i, p.team[i])
    config.applyTeamPreset(p.team as [string, string, string])
    const scope = effectScope()
    let api: ReturnType<typeof useTimeWeightAutoAllocation> | undefined
    scope.run(() => { api = useTimeWeightAutoAllocation() })
    await nextTick()
    // 默认档 = B 边际均衡
    expect(api!.applyNow()!.strategyId).toBe('marginal-equalize')
    // watcher 真的在跑默认策略：改一个签名内输入（命座）→ post-flush 后权重落定
    config.setCinemaLevel(0, 1)
    await nextTick()
    await nextTick()
    const weights = () => [0, 1, 2].map(s => config.team[s]!.basicAttackTimeWeight)
    const settled = weights()
    // **防自激**（实测踩坑）：策略写回的权重/弹刀不变更「原始值签名」⇒ 再等若干 tick 必须零变化；
    // 若源写成数组（引用恒不等）则会 `Maximum recursive updates exceeded`，这条就是那个 bug 的护栏。
    await nextTick()
    await nextTick()
    expect(weights(), '跑完即稳定：策略自身写回不得再次触发 watcher').toEqual(settled)
    // 切到 'joint' → 同一入口升级为 C（更慢的联合搜索）；watcher 以同一映射重跑
    config.setTimeWeightStrategy('joint')
    await nextTick()
    expect(api!.applyNow()!.strategyId).toBe('joint-levers')
    // 切到 'static' → **不跑策略**：applyNow 返回 null，且换输入后权重必须原样（watcher 不动手）
    config.setTimeWeightStrategy('static')
    await nextTick()
    expect(api!.applyNow(), "static 档不跑策略").toBeNull()
    const staticWeights = weights()
    config.setCinemaLevel(0, 0)
    await nextTick()
    await nextTick()
    expect(weights(), 'static 档下 watcher 不得改写权重').toEqual(staticWeights)
    scope.stop()
  })

  it('注册表契约：默认策略在表内、深度策略在表内、id 唯一（扩展点）', () => {
    expect(TIME_WEIGHT_STRATEGIES.length).toBeGreaterThan(0)
    expect(getTimeWeightStrategy(DEFAULT_TIME_WEIGHT_STRATEGY_ID).id).toBe(DEFAULT_TIME_WEIGHT_STRATEGY_ID)
    expect(getTimeWeightStrategy(DEEP_TIME_WEIGHT_STRATEGY_ID).id).toBe(DEEP_TIME_WEIGHT_STRATEGY_ID)
    expect(new Set(TIME_WEIGHT_STRATEGIES.map(s => s.id)).size).toBe(TIME_WEIGHT_STRATEGIES.length)
    // 未知 id 回落默认策略（不抛错：UI 开关不会因为策略改名而炸）
    expect(getTimeWeightStrategy('not-a-strategy').id).toBe(DEFAULT_TIME_WEIGHT_STRATEGY_ID)
  })
})
