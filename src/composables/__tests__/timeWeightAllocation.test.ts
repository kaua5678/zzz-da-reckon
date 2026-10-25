/**
 * 平A池权重·分配策略的生效测试（2026-09-10）。
 *
 * 判据（对应用户口径「不分配足够的平A，总量也不够」+ 「默认快一些的B，做个开关，如果开了就是更慢的C」）：
 *  ① **三态** `timeWeightStrategy`：`'balanced'`（默认，= 边际均衡 B）/ `'joint'`（= 多杠杆联合 C）/
 *     `'static'`（**不跑策略**，静态默认权重或手填值）——映射单源 `timeWeightStrategyIdForMode`；
 *  ② 触发签名**不含权重本身**（否则策略写回权重会自触发成死循环）——策略新增逻辑时这条最容易踩；
 *  ③ 走默认（不点名策略）时：权重确实被改动、`strategyId` = B、**团队总伤不降**（坐标上升单调不劣）；
 *  ④ 主C（槽0）的平A池时间**增加**——即「能量不够就多A」这条约束在当前策略下确实被喂饱
 *     （实测 auto-1521-1481-1311：平A 21.8→42.5s、强特 15→17 次、伤害 +20.78%；
 *      旧样本 auto-1521-1361-1311 为平A 31.8→65.7s、强特 16→18 次、伤害 +23.9%，该预设已消失）。
 *  ⑥~⑧ 测的是 **C 的杠杆**（可行性优先/弹刀阶梯/相对门/能量驱动/角点解/弹刀下限）→ 必须显式点名
 *     `DEEP_TIME_WEIGHT_STRATEGY_ID`（默认已不是 C）。
 */
import { readFileSync } from 'node:fs'
import { describe, it, expect, vi } from 'vitest'
import { effectScope, nextTick } from 'vue'
import { setupHarness } from '@/test/harness'
import { useConfigStore } from '@/stores/config'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { teamPresets } from '@/data/teamPresets'
import { applyTeamToStore } from '@/composables/teamCompare'
import { COMBO_ALIGN_ABSORB_RATIO_SETTING } from '@/data/resourceDefaults'
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

const PRESET_ID = 'auto-1521-1481-1311'

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
    config.setActionCount(0, 'basicAttackTimeWeight', 7)
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
    // CC-152 逐用例钉：依赖「均衡改变失衡次数」这一 off 场景（旧样本 4→3；换库后 6→4）
    config.setMechanicSetting('time.stunPlanProjection', 0)
    const calc = useResourceCalc()
    // 2026-10-08 自动预设库重生成：原 `auto-1591-1481-1311`（希格莉德+琉音+耀嘉音）真消失
    // （希格莉德 1591 仍在库，但该三人的同槽序预设不再产出）。换成 `auto-1041-1161-1311`
    // （11号+莱特+耀嘉音）——它同样有「均衡解改失衡次数」这条活分支（实测 6→4 次、总伤 +8.07%，
    // 与旧队 4→3 次同型），note 仍如实上报「次数是分配的结果」。旧值 4→3 次 / +10.1%。
    /**
     * ⚠ 2026-10-26 换队：预设改「只带 team」后 `auto-1041-1161-1311` 的基础档由 catalog 派生
     * （11号带自己专武 14104、莱特带 14116…）⇒ 它的平A权重本来就是均衡解（`applied=false`、
     * `note='已是均衡解，权重未变'`），本条「均衡**照常应用**」的前提消失。
     * 改用实测 `applied=true` 且失衡次数确实变了的 `auto-1461-1521-1491`（实测 4→5 次）。
     * 判据语义不变：只要该队均衡确实改了次数，note 就必须如实上报、不得静默。
     */
    const p = teamPresets.find(x => x.id === 'auto-1461-1521-1491')!
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
    // auto-1521-1481-1311：联合策略把弹刀 12→0（`弹刀 6/6/0→0/0/0`，受「不发生截断」硬门约束），
    // 同期总伤 78.65M→112.03M——低效交互（吃必要前台时间）应被搜索**减掉**，这是「弹刀是杠杆」的下半句。
    // （旧样本 auto-1521-1361-1311 为 83.5M→92.2M / PROBE_STUN_LEVER，该预设已消失。）
    const p = teamPresets.find(x => x.id === 'auto-1521-1481-1311')!
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

  // ⑥b/⑥c 的样本队（2026-09-19 接管落地刀 1 后换样）：原样本 auto-1591-1481-1311 的 0.906s「截断」是两级容差不一致
  // 制造的假截断（毫秒残差被整数装包放大），刀 1（截断入口容差与折叠环同源 1e-3）后归零 ⇒ 不再是「基线本身就超时」
  // 的样本。换成 1431 簇的结构性溢出队 auto-1431-1481-1491（预设配置下基线截断 ~108.8s、降配 8 档全不可行、scale=1），
  // 它才是「真装不下」的形态——本用例要锁的相对门 / 可行性优先语义正是为这类队写的。
  // ⚠ 2026-09-19 R37-J5 v2（动态合轴）后再补一刀：非轴多人队的溢出先由队友前台按溢出量被合轴吸收，该队自由口径下
  // 琉音/柳的前台被整段吸收 + 降配 0.875 ⇒ 装配截断归零，不再是超时样本。v2 下唯一装不下的是**操作角色自己的前台 > 180s**，
  // 而降配/弃轴机制会把它收进可行域——只有**锁窗**（用户明确意图「操作够就能打 N 次失衡」，编排层一律不动、超时如实上报）
  // 能保留这条结构性溢出：锁在该队自身的失衡次数 3（golden 同值）时基线截断（旧 run ≈23.4s；
  // 2026-10-08 换 run 后实测 89.68s，仍 > 0 ⇒ 用例前提「基线本身就超时」照旧成立）。
  const OVERTIME_SAMPLE_ID = 'auto-1431-1481-1491'
  /** 锁窗次数 = 该队自由口径的失衡次数（timeGolden preset:auto-1431-1481-1491.stun），不是抬高需求 */
  const OVERTIME_SAMPLE_STUN_LOCK = 3

  it('⑥b 基线已超时的队也照常优化（相对门：只保证不更差，不再拒绝）', async () => {
    const { catalog } = await setupHarness(['', '', ''])
    await catalog.loadBuildRecommendations()
    const config = useConfigStore()
    const calc = useResourceCalc()
    const p = teamPresets.find(x => x.id === OVERTIME_SAMPLE_ID)!
    for (let i = 0; i < 3; i++) config.setAgent(i, p.team[i])
    config.applyTeamPreset(p.team as [string, string, string])
    config.setEnemy({ stunCountLock: OVERTIME_SAMPLE_STUN_LOCK })
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
  }, 120_000)   // 重负载用例：结构性溢出队每次求值都走截断外环重折（≤3 轮全管线，2026-09-19 批 2-1），满套件并发下 30s 不够，与 ⑥c 同款给足

  it('⑥c 可行性优先（A1）：基线超时队先拉回可行——截断只降不升、总伤不降；拉回即 0，拉不回如实上报', async () => {
    const { catalog } = await setupHarness(['', '', ''])
    await catalog.loadBuildRecommendations()
    const config = useConfigStore()
    const calc = useResourceCalc()
    const p = teamPresets.find(x => x.id === OVERTIME_SAMPLE_ID)!
    for (let i = 0; i < 3; i++) config.setAgent(i, p.team[i])
    config.applyTeamPreset(p.team as [string, string, string])
    config.setEnemy({ stunCountLock: OVERTIME_SAMPLE_STUN_LOCK })
    const truncated = calc.resourceResult.value!.convergence?.timeTruncatedSeconds ?? 0
    expect(truncated).toBeGreaterThan(0)
    const dmgBefore = calc.teamTotalDamage.value
    const r = applyTimeWeightAllocation({ calc, configStore: config }, DEEP_TIME_WEIGHT_STRATEGY_ID)
    const after = calc.resourceResult.value!.convergence?.timeTruncatedSeconds ?? 0
    const dmgAfter = calc.teamTotalDamage.value
    // 硬不变量：截断不升、总伤不降
    expect(after).toBeLessThanOrEqual(truncated + 1e-6)
    expect(dmgAfter).toBeGreaterThanOrEqual(dmgBefore - 1e-6)
    // 状态如实上报三态（与 timeWeightAllocation.ts 阶段 -1 的三个出口一一对应）：
    //   归零 → 「已拉回可行」；部分拉回（结构性溢出队的常态，旧 run 实测 108.79→87.41s；
    //   2026-10-08 换 run 后为「拉不回来」分支：89.68→89.68s，note 报「拉不回来」）→
    //   「可行性优先：截断 a→b」且**不得**同时报「拉不回来」；零进展 → 「拉不回来」。
    if (after <= 1e-6) {
      expect(r.note ?? '').toContain('已拉回可行')
    } else if (after < truncated - 1e-6) {
      expect(r.note ?? '').toContain('可行性优先：截断')
      expect(r.note ?? '').not.toContain('拉不回来')
    } else {
      expect(r.note ?? '').toContain('拉不回来')
    }
  }, 120_000)   // 重负载用例：满套件并发下实测 ~36s（降配枚举给结构性溢出队加了整轮试算），显式给足超时

  /**
   * ⑥c′ **吸收量门（第二臂）的源码锁**（§19.4-2 裁决，2026-09-25）。
   *
   * 口径：`jointLeverStrategy` 的 `feasible()` 除「截断 ≤ 地板」外还有第二臂「本轮吸收量 ≤ 上轮」——
   * 动态合轴 v2 下溢出由队友前台背走，只看截断的可行门几乎恒真，搜索能把操作角色的计划推过预算
   * 再让队友无限背吸收（§19.4-2 实测：`comboAlignRelief` 诚实面那队即靠这条路换到 +15% 总伤）。
   *
   * ⚠ **为什么是源码锁而不是行为锁**（实测记录，别改成行为断言）：2026-10-04 在 12 支吸收活跃队
   * × ratio ∈ {0.4, 0.8, 1} 上逐队测「策略入口吸收量 → 策略出口吸收量」，**全部 Δ ≤ 0**
   * （无一支队出现吸收增长）⇒ 第二臂在**当前数据面上不咬合**，任何行为断言都恒真、反证也拉不红
   * （实测：删掉该臂后行为锁仍绿）。故本锁只钉**结构**（臂存在 + 语义未被改写），
   * 并留「何时升级为行为锁」的触发条件。
   *
   * 升级触发条件（任一满足即改成行为断言 + 反证）：
   *   ① 出现某支队的 joint 出口吸收量 > 入口（= 搜索真的开始靠加深吸收换越界）；
   *   ② `comboAlignAbsorbRatio` 缺省上调或改为逐角色/逐招式（容量变大 ⇒ 搜索有空间加深吸收）；
   *   ③ `pendingTopUpSeconds` / 环内选点口径改动导致 feasibleFloor 收紧（截断臂变严 ⇒ 搜索转向吸收臂）。
   */
  it('⑥c′ 吸收量门（§19.4-2）：feasible() 含「吸收量不增」第二臂（源码锁；当前数据面不咬合，见注释触发条件）', () => {
    const src = readFileSync(new URL('../timeWeightAllocation.ts', import.meta.url), 'utf8')
    // 臂存在：吸收量读取器 + 门槛比较（两者都要，缺一即「声明了却没接」）
    expect(src, '吸收量读取器缺失').toMatch(/const absorbed = \(\) =>/)
    expect(src, '第二臂缺失（feasible 只剩截断臂）').toMatch(/const feasible = \(\) =>[\s\S]{0,200}absorbed\(\) <= absorbedFloor \+ 1e-6/)
    // 地板来源：策略入口初值 + 可行性优先阶段后同步（少了后者，阶段 -1 合法减少的吸收会把地板留高）
    expect(src, 'absorbedFloor 初值缺失').toMatch(/let absorbedFloor = absorbed\(\)/)
    expect(src, '阶段 -1 后未同步 absorbedFloor').toMatch(/feasibleFloor = bestTrunc\n\s+absorbedFloor = absorbed\(\)/)
  }, 120_000)

  it('⑥d 能量驱动（A2）：主C 强特次数不降 + 总伤不降（多A 喂能或整体还原基线）', async () => {
    const { catalog } = await setupHarness(['', '', ''])
    await catalog.loadBuildRecommendations()
    const config = useConfigStore()
    const calc = useResourceCalc()
    // auto-1521-1481-1311：实测联合策略主C 强特 15→19 次、总伤 78.65M→112.03M
    // （用户点名「能量不够就多A」的样本；旧样本 auto-1521-1361-1311 为 16→18 次，该预设已消失）
    const p = teamPresets.find(x => x.id === 'auto-1521-1481-1311')!
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
    const p = teamPresets.find(x => x.id === 'auto-1521-1481-1311')!
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
    // 维琳娜(异常)+柏妮思(异常)+柚叶(支援)：双异常核心队（预设库多支双 C 队同款结构）。
    // 2026-10-08 自动预设库重生成：同 3 人槽序变为 `auto-1171-1561-1411`
    // （柏妮思 1171 / 维琳娜 1561 / 柚叶 1411）——⚠ 不是纯改名，来自另一条实战 run
    // （旧 run-1783870299159-khqbcz 金数 2 / 音擎 14156·14118·14141 →
    //  新 run-1783080266142-ucgbfs 金数 5 / 音擎 14118·13009·14121）。
    // 语义等价：仍是「两个异常核心（柏妮思+维琳娜）+ 一个支援（柚叶）」的同型双 C 队。
    // 实测逐核心强特不降（slot0 13.72→14.36、slot1 13→13）、总伤 43.24M→45.01M（不降）。
    //
    // ⚠ **T141 实测补充**：吸收常开后本队入口落点变了（slot0 强特 ~15.95、总伤 ~74.5M），
    // 而弹刀阶梯的**只按伤害接受**一度放行「总伤 +1.16M、主C#1 强特 15.948→15.758」的档
    // （`.zc/perf/T141tw2.perf.ts` 实测），本条判据当场红。
    // 修法 = 给弹刀阶梯加**执行数门**（`timeWeightAllocation` 弹刀段：逐核心强特**合计**不得下降，
    // 依据 = 用户口径 2026-10-12 / 卡 §2.3b「时间截断才是强制的」）。
    // ⇒ 本条现在守护的正是那道门：把该门删掉，这里立刻红。
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
    // 角点解若出手，被压的只能是柚叶（支援位 slot2）——输出槽权重不降
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
    // 2026-10-08 自动预设库重生成：原 `auto-1591-1481-1311` 真消失。换成 `auto-1041-1161-1311`
    // （11号+莱特+耀嘉音）——99 弹刀同样装不下（实测被编排层降配到 0.375 档、截断归零），
    // 判据「越界被挡住」仍然咬合；实测搜索后弹刀总数不增（105→105）。
    const p = teamPresets.find(x => x.id === 'auto-1041-1161-1311')!
    for (let i = 0; i < 3; i++) config.setAgent(i, p.team[i])
    config.applyTeamPreset(p.team as [string, string, string])
    config.setActionCount(0, 'parryCount', 99)
    const conv0 = calc.resourceResult.value!.convergence
    const overflow = conv0?.timeTruncatedSeconds ?? 0
    // 越界信号两种形态都算「硬门已挡」：装配截断 > 0（v2 前的形态），或被编排层降配收进可行域（interactionScale < 1）。
    // R37-J5 v2（动态合轴，2026-09-19）后本队 99 弹刀被降配到 0.25 档（25 次）装进 180s、截断归零——越界仍被挡住，
    // 只是挡法从「砍行」变成「降配」；搜索不得在此基础上再增加弹刀。
    expect(overflow > 0 || (conv0?.interactionScale ?? 1) < 1, '弹刀 99 次应当装不下（装配截断 > 0 或已被降配）——搜索不得在此基础上再增加弹刀').toBe(true)
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
    const p = teamPresets.find(x => x.id === 'auto-1521-1481-1311')!
    for (let i = 0; i < 3; i++) config.setAgent(i, p.team[i])
    config.applyTeamPreset(p.team as [string, string, string])
    // 合成一个 boss 预设：13 次正常弹刀（同叶释渊 defaults.parryTotal）
    const zeroRes = { physical: 0, fire: 0, ice: 0, electric: 0, ether: 0, wind: 0 }
    config.applyBossPreset(
      { id: 'test-boss' },
      {
        phaseId: 'p1', hp: 1e6, stunValue: 15000, defense: 0, level: 60,
        bossAnomalyCoeff: 1, damageResistances: zeroRes, stunResistances: zeroRes, anomalyResistances: zeroRes,
      },
      { stunVuln: 1, stunTime: 16 },
      { battleTime: 180, shieldCount: 0, energyShield: 0, parryTotal: 13 },
    )
    expect(config.bossParryTotals.parryTotal).toBe(13)
    // 输入刻意**高于**强制次数（主C 8 + 击破 8 = 16 > 13）→ 搜索可以下调，但不得低于 13。
    // 注：低于下限的部分由 `core/parrySplit.ts` 负责补齐（单一事实源），本策略只承诺「不下调越过它」。
    config.setActionCount(0, 'parryCount', 8)
    config.setActionCount(1, 'parryCount', 8)
    config.setActionCount(2, 'parryCount', 0)
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

  it('⑨ 嘲讽取消自动抬（T135）：轴队跑 joint 后 tauntCancelCount 被自动抬高、必要前台下降', async () => {
    // 用户口径 2026-10-11：「默认值是给非轴模式的，你使用轴模式那么就对资源和时间有高要求，
    // 会自动提高交互和合轴率去达成轴」。嘲讽取消是**零成本时间杠杆**（每取消一次抹掉一次失衡外
    // 连段末尾后摇的战场占用，不耗闪能/嗔火/喧响）⇒ 进 joint 搜索，只抬不降。
    const { catalog, config } = await setupHarness(['', '', ''] as never, { recommendedBuild: false } as never)
    await catalog.loadBuildRecommendations()
    const calc = useResourceCalc()
    const p = teamPresets.find(x => x.id === 'banyue-trigger-lucia')
    expect(p, '预设 banyue-trigger-lucia 存在').toBeTruthy()
    applyTeamToStore(config, p as never)
    /**
     * ⚠ **T167 换档（0.4 → 0.6，规则 10 四步）—— 判据逐条保留、未放宽**。
     * ① 量 delta：`r=0.4` 下入口 `comboOutRecoveryCount` 由 >0 变为 **0** ⇒ 反空洞断言红。
     * ② 根因：**轴内连段块的闪能账修正**（`banyue.ts` 的 `combos[].energyCost` 60 → 0）。
     *    修后轴内块真的进轴执行 ⇒ 闪能被轴内吃掉 ⇒ 怒相外自动连段被挤压到 0
     *    ⇒ 没有「失衡外连段后摇」可取消 ⇒ 该档测不到本杠杆。
     *    实测（`.zc/perf/T167s_chk.perf.ts` + `T167s_verify.perf.ts` 的 V5 段）：
     *    `r=0.4` ⇒ `recBefore=**0**`（本条入口前提「确有未取消后摇」直接不成立 ⇒ 测不到任何东西）；
     *    `r=0.5/0.6/0.8` ⇒ `recBefore=2`、`tauntAfter=2`、`recAfter=0`、恢复行=0、伤害不降
     *    ⇒ 取 **`r=0.6`**（三档里居中，且实测伤害 +0.084M）。
     * ③ 确认有意：轴活着 + 轴内块免费是用户口径（「挤不下就不要多打」+「[怒] 连段不耗闪能」）。
     * ④ 判据全部保留：入口后摇 >0、joint 抬高 taunt、抬满后后摇归零、停在有效上限、
     *    恢复行清零、总伤不降 —— 只换吸收比档位。
     */
    config.setMechanicSetting(COMBO_ALIGN_ABSORB_RATIO_SETTING, 0.6)
    await nextTick()
    // 前提：入口 taunt=0（默认档）且确有待取消的后摇
    expect(Number(config.team[0]?.tauntCancelCount ?? 0), '入口默认档').toBe(0)
    const recBefore = calc.resourceResult.value!.characters.find(c => c.slot === 0)!.banyueRageCycle!.comboOutRecoveryCount
    expect(recBefore, '入口确有未取消后摇（否则本用例测不到东西）').toBeGreaterThan(0)
    const dmgBefore = calc.teamTotalDamage.value
    applyTimeWeightAllocation({ calc, configStore: config as never }, DEEP_TIME_WEIGHT_STRATEGY_ID)
    await nextTick()
    // ① 杠杆真的被抬（不是恒零的摆设）
    const tauntAfter = Number(config.team[0]?.tauntCancelCount ?? 0)
    expect(tauntAfter, 'joint 应自动抬高 tauntCancelCount').toBeGreaterThan(0)
    /**
     * ② **后摇确实被取消掉一部分**（本杠杆的价值就在这）——但**不再要求「归零」**。
     *
     * ## 2026-10-19 改判据（规则 10 四步，用户裁决「修正本身是对的……这是必要性开发内容」）
     *
     * ① **量 delta**：`5021d549` 把冲霄 `1471029` 的 `actionTime` 由 2.667s 修正为 **1.167s**
     *    （导入脚本按英文名匹配类型加成表得 0 ⇒ (秽骨 266.7 − 0)/100 = 2.667；真值 = 秽骨 266.7 − 支援突击加成 150
     *    = 116.7 ⇒ 1.167s，`catalog.json` 实测已为 1.167）。修正后本队 `outStunComboCount` 1 → **2**。
     * ② **根因不是 joint 坏了，是「抬满」不再划算**：逐档实测（r=0.6）
     *    ```
     *    taunt | 后摇 | outStunCombo | 必要前台 | 伤害
     *      0   |  2   |      2       | 220.00s | 58.645M
     *      1   |  1   |      2       | 219.48s | 58.684M   ← joint 停在这里（伤害最高）
     *      2   |  0   |      2       | 215.87s | 58.081M   ← 后摇归零，但伤害 -0.603M
     *    ```
     *    ⇒ `taunt=2` 确实让后摇归零、必要前台省 3.6s，**但总伤掉 0.603M** ⇒ joint 的接受条件
     *    （`dmg > best` 或「伤害不变且必要前台下降」）**正确地拒绝了它**，停在 1。
     *    旧断言「抬满后后摇归零」与「总伤不降」在本队上**互相矛盾**——冲霄变短后，取消第二次后摇
     *    换来的 3.6s 已经不值 0.603M 的伤害损失。
     * ③ **确认有意**：冲霄时间修正是用户点名的必要性开发（「倍率演算页使用，资源引擎没接……不蒙骗用户」）。
     * ④ **判据处置**：只删「归零」这一条**与总伤判据冲突**的断言，其余全部保留并**加强**：
     *    - 后摇**必须严格减少**（`recAfter < recBefore`）——比「归零」更本质：杠杆生效了；
     *    - 后摇恢复行数**必须等于** `recAfter`（行与读数同源，这才是原来那条断言真正想锁的）；
     *    - 停在有效上限而非 99（原样保留）；
     *    - 总伤不降（原样保留）。
     */
    /**
     * ⚠ **T172 恢复「归零」判据**（规则 10 四步；本条曾被 5021d549 临时删掉）。
     *
     * ① **量 delta**：删掉时 taunt 1/2 的伤害是 **58.684M → 58.081M（−0.603M）**，于是「抬满」与
     *    「总伤不降」互相矛盾 ⇒ 当时只能删断言。修后 taunt 0/1/2 = **60.914 / 60.956 / 60.998M**
     *    （`.zc/perf/tauntFinal.perf.ts`），「抬满」既省钱又涨伤害 ⇒ **矛盾消失，判据可恢复**。
     * ② **根因**：不是后摇、也不是时间账，是**交互补齐的 2-环**——补齐缺口把「已装那 N 刀自己产的喧响」
     *    当成既有收入 ⇒ 装得越多算出的缺口越小（taunt=1 实测环成员 = 已装1→算出4 / 已装4→算出1）。
     *    外层环内选点在四级判据上判成同级 ⇒ 取「最后一轮」⇒ **选中谁取决于环在第几轮被检出**，
     *    taunt 一改就换相位 ⇒ 选中不同的补齐全额，伤害跟着乱跳。
     *    修法 = 缺口按「需求 + 已装×单刀收益 − 已读喧响」算（同量纲），不动点处 `decibelHave = 需求`
     *    ⇒ 环消失（本队从 `cycle/20` 变 `stable/7`）。
     * ③ **确认有意**：用户 2026-10-19「取消后摇纯给你送前台可利用时间也会降低吗？肯定是其他因素引起的吧」
     *    —— 用户判断正确，这就是那个「其他因素」。
     * ④ **判据处置**：恢复「抬满后后摇归零」（`recAfter === 0`），其余断言全部保留。
     */
    /**
     * ⚠ **2026-10-19 撤回「归零」判据（改回 T172 之前的形态；规则 10 四步）**。
     *
     * ① 量 delta：`recAfter` **0 → 3**（`taunt` 2、`parry` 6 → 8、`outStun` 2 → 5、`combo` 2 → 3），
     *    伤害 **60.998M → 63.767M（+2.77M）**。
     * ② 根因：「归零」这条断言的前提是「joint 只抬 taunt」——实测**不成立**：joint 同轮还把
     *    `parryCount` 6 → 8（弹刀阶梯），而那会**真的多打出连段**（`outStun 2 → 5`）⇒ 后摇**基数**
     *    从 2 涨到 5，taunt 抬到 2 只抹掉 2 个 ⇒ 剩 3。断言拿「基数不变的绝对 0」当判据，
     *    等于要求「抬 taunt 的同时不许动别的杠杆」，那不是本用例要锁的东西。
     *    逐档实测（`.zc/perf/jointTaunt.perf.ts`，固定其余输入只动 taunt）：
     *    ```
     *    taunt | rec | dmg      | 必要前台
     *      0   |  2  | 61.3552M | 225.350s
     *      1   |  1  | 61.3972M | 224.833s
     *      2   |  0  | 61.4393M | 224.316s   ← 杠杆本身仍然单调、仍然能归零
     *    ```
     *    ⇒ 杠杆没坏，坏的是「在 joint 组合里断言绝对 0」这个写法。
     * ③ 确认有意：`rec=3` 的那份计划**伤害更高**（63.767 vs 61.439），joint 选它是对的。
     * ④ 判据处置：改成**引擎自己的恒等式**（与「基数」无关，因而与 joint 动了哪些杠杆无关）：
     *    `后摇 = 失衡外连段数 − 嘲讽取消数`（`comboOutRecovery = outStun − taunt`，见
     *    `computeBanyueRageCycle` 末尾那段），外加「取消数被夹到失衡外连段数」。
     *    「后摇归零」这条只在「其余输入不动」的纯函数层面成立（上面的逐档表已覆盖），
     *    不再在 joint 组合断言里表达。
     */
    const cycleAfter = calc.resourceResult.value!.characters.find(c => c.slot === 0)!.banyueRageCycle!
    const recAfter = cycleAfter.comboOutRecoveryCount
    expect(recAfter, '后摇 = 失衡外连段 − 嘲讽取消（引擎恒等式）')
      .toBe(cycleAfter.outStunComboCount - cycleAfter.tauntCancelCount)
    expect(cycleAfter.tauntCancelCount, '取消数被夹到失衡外连段数（不虚高）')
      .toBeLessThanOrEqual(cycleAfter.outStunComboCount)
    expect(cycleAfter.tauntCancelCount, '杠杆真的抬了（>入口 0）').toBeGreaterThan(0)
    // ③ 时间面确实回收：后摇恢复行**计入的秒数** == 剩余后摇次数 × 末尾强特时长（行与读数同源）。
    // ⚠ 不拿「必要前台总量下降」当判据：joint 里 ② 弹刀阶梯同时在加交互时间，两者叠加后总量可能反升
    // （实测 202.665→205.818s），拿总量比会把弹刀的账算到嘲讽取消头上。
    // ⚠ 也**不拿「行条数」当判据**（2026-10-19）：`buildBanyueExecutions` 按**连段类型**出行
    // （论道后摇 / 地动山摇后摇各至多一行、行上带 `count`），所以行数 ∈ {0,1,2} 与 recAfter 无关；
    // 旧断言在 `recAfter === 1` 时恰好成立（单类型单行），本批 joint 组合变成 3 才暴露。
    // 判据改为「Σ 行秒数 == recAfter × 对应末尾强特时长」——这才是「行与读数同源」的真正表达。
    const execsAfter = calc.resourceResult.value!.characters.find(c => c.slot === 0)!.executions ?? []
    const recRows = execsAfter.filter(e => e.moveId?.startsWith('banyue-recovery'))
    const recSeconds = recRows.reduce((s, e) => s + (e.totalTime ?? 0), 0)
    const perRecovery = recRows.reduce((s, e) => s + (e.actionTime ?? 0) * (e.count ?? 0), 0)
    expect(recSeconds, '恢复行计入的秒数 == 各自的 次数×时长（行内自洽）').toBeCloseTo(perRecovery, 6)
    expect(recRows.reduce((s, e) => s + (e.count ?? 0), 0), '恢复行**次数合计** == 剩余后摇次数（行与读数同源）')
      .toBe(recAfter)
    expect(calc.teamTotalDamage.value, '总伤不降（联合搜索单调不劣）').toBeGreaterThanOrEqual(dmgBefore - 1e-6)
    // ④ 非般岳队零影响：能力声明驱动（不认 agentId），无该声明的队杠杆槽位为空
    const { catalog: c2, config: cfg2 } = await setupHarness(['', '', ''] as never, { recommendedBuild: false } as never)
    await c2.loadBuildRecommendations()
    const calc2 = useResourceCalc()
    const p2 = teamPresets.find(x => x.id === 'auto-1521-1481-1311')
    applyTeamToStore(cfg2, p2 as never)
    await nextTick()
    const taunt2Before = [0, 1, 2].map(s => Number(cfg2.team[s]?.tauntCancelCount ?? 0))
    applyTimeWeightAllocation({ calc: calc2, configStore: cfg2 as never }, DEEP_TIME_WEIGHT_STRATEGY_ID)
    await nextTick()
    expect([0, 1, 2].map(s => Number(cfg2.team[s]?.tauntCancelCount ?? 0)), '无嘲讽取消声明的队零改动').toEqual(taunt2Before)
  })
})
