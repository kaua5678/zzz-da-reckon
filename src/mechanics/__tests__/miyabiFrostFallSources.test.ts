/**
 * 星见雅(1091) 落霜三源计数口径（2026-10-23 修正）：紊乱次数 / 霜灼·破次数 / 影画二门控。
 *
 * ## 修的是什么（三条同族缺陷，都不是「近似得不准」而是**方向会错**）
 *
 * ① `miyabi_disorder_frost_fall_gain` 的 `countSource: exSpecialCount`：用强特次数冒充紊乱次数。
 *    原文「队伍中任意角色触发[紊乱]效果时，星见雅获得 2 点[落霜]」（passive.level.1091507.desc[1]）。
 *    实测（Boss 30007/690441）：雅南柚 强特13 / 紊乱34 ⇒ 现实现 26 点 vs 应得 68 点（少 42 点）；
 *    雅蕾柚 强特12 / 紊乱10 ⇒ 24 vs 20（**反向高估 4 点**）⇒ 方向随队伍变化，没有单一比例能修。
 * ② `frostburnBreakCount` 的 `Math.floor(state.exSpecialCount)`：霜灼·破的触发条件是
 *    「对带[冰焰]的敌人施加[霜寒]」（10s CD），与强特次数无因果关系 ⇒ 改为
 *    min(烈霜异常触发次数, 1+⌊战斗时间/10⌋)，与 1500% 直伤行**同源**（miyabiFrostburnBreakCountOf）。
 * ③ `miyabi_c2_flower_basic_frost_fall_gain` 无命座门控：C0 也在拿「风花#5 +1 落霜」
 *    （实测 C0「雅白」队总 56 点里 +17 点来自这条 ≈ 2.8 次霜月）⇒ C0 上限被抬高、C2 资源收益被低估。
 *
 * ## 判据形态（为什么不是「钉一个绝对值」）
 * 三条都进同一个总量，而总量又反馈驱动时间分配与异常触发次数（落霜 → 霜月次数 → 强特/时间预算 → 积蓄）⇒
 * 绝对值随夹具漂移。本文件一律用**同一份结果内的闭式恒等式 + 门控差分**，并在每条上加反空洞前提。
 */
import { describe, expect, it, vi } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { miyabiFrostburnBreakCountOf, miyabiFrostMoonCountOf, miyabiMechanic } from '@/mechanics/agents/miyabi'
import { collectNextRoundFeedback } from '@/composables/resourceCalc/panelPhases'
import { useCatalogStore } from '@/stores/catalog'
import { getAgentSpec } from '@/specs/registry'
import { computeSpecResources } from '@/specs/resources'
import type { CharacterOperationConfig } from '@/types/resource'

/** 队伍夹具：雅 + 两名队友（紊乱/烈霜都得真的发生，否则断言退化成恒 0 假绿） */
const MIYABI_AGENT_ID_TEST = '1091'
const TEAM = [{ agentId: '1091', cinemaLevel: 2 }, { agentId: '1251', cinemaLevel: 6 }, { agentId: '1171', cinemaLevel: 6 }]

describe('星见雅落霜·紊乱来源（原 exSpecialCount 近似）', () => {
  /**
   * 判据：紊乱贡献 == 2 × **紊乱次数**，且**对强特次数完全不敏感**。
   *
   * ⚠ 为什么不做「管线里关掉 D 滑块 ⇒ 总量差 2×紊乱」的差分：关滑块会改平衡（落霜少 ⇒ 霜月少 ⇒ 强特/平A 分配变 ⇒
   * 异常触发变 ⇒ 紊乱次数本身也移动，实测差 33 而不是 32）。所以这条钉在**解释器层**：同一份 cfg/state 下，
   * 只改 `miyabiDisorderCount` / `exSpecialCount`，看 gain 跟谁走。
   * 这正是本次修正的核心：来源字段从 exSpecialCount 换成 disorderCount。
   */
  const gainOf = (cfgExtra: Record<string, unknown>, stateExtra: Record<string, unknown> = {}) => {
    const spec = getAgentSpec('1091')!
    const cfg = {
      battleTime: 180,
      'setting:miyabi.frostburnBreakCount': 0,
      'setting:miyabi.frostburnBreakRate': 1,
      ...cfgExtra,
    } as unknown as CharacterOperationConfig
    const state = { basicAttackTime: 30, exSpecialCount: 0, ultimateCount: 1, chainCountTotal: 0, ...stateExtra } as never
    const res = computeSpecResources(spec, cfg, state, {
      disorderCount: Number(cfgExtra.miyabiDisorderCount ?? 0),
      frostburnBreakCount: 0,
      basicAttackCount: 0,
    }).get('miyabi_frost_fall')!
    return res.gains['miyabi_disorder_frost_fall_gain'] ?? 0
  }

  it('紊乱 gain = 2 × 紊乱次数，且与强特次数无关（旧口径会跟着强特走）', () => {
    // 紊乱 7 次、强特 0 ⇒ 应有 14 点（旧口径：floor(0)×2 = 0）
    expect(gainOf({ miyabiDisorderCount: 7 }, { exSpecialCount: 0 })).toBe(14)
    // 强特 50 次但紊乱 0 ⇒ 必须 0（旧口径会白送 100 点）
    expect(gainOf({ miyabiDisorderCount: 0 }, { exSpecialCount: 50 })).toBe(0)
    // 两者都给：答案只由紊乱决定，强特次数怎么变都不动
    expect(gainOf({ miyabiDisorderCount: 3 }, { exSpecialCount: 1 })).toBe(6)
    expect(gainOf({ miyabiDisorderCount: 3 }, { exSpecialCount: 99 })).toBe(6)
    // spec 侧口径也钉住（防「解释器对了但 spec 还写着 exSpecialCount」）
    const rule = getAgentSpec('1091')!.resources[0]!.gainRules.find(r => r.id === 'miyabi_disorder_frost_fall_gain')!
    expect(rule.countSource, 'spec 的 countSource 必须是 disorderCount').toBe('disorderCount')
    expect(rule.amountPerCount, '原文：每次紊乱 2 点落霜').toBe(2)
  })

  /**
   * 真管线：注入到 cfg 的紊乱次数必须等于**同一次计算**产出的异常池 disorderCount。
   * 这条防的是「钩子挂着但写错键 / 派发器没递 threads」——那种情况下 cfg 恒 0，而 total 看起来只是偏小。
   */
  it('真管线：buildExecutions 读到的 cfg.miyabiDisorderCount == 本轮异常池 disorderCount', async () => {
    const { config } = await setupHarness(TEAM as never)
    for (const buff of config.globalBuffs) buff.enabled = false
    const spy = vi.spyOn(miyabiMechanic, 'buildExecutions')
    const calc = useResourceCalc()
    void calc.damagePoolRows.value
    const last = spy.mock.calls.at(-1)?.[0]
    spy.mockRestore()
    const ap = calc.anomalyPoolResult.value!
    expect(last, 'buildExecutions 必须被派发过').toBeTruthy()
    expect(ap.disorderCount, '夹具前提：该队须触发过紊乱').toBeGreaterThan(0)
    expect(last!.cfg.miyabiDisorderCount, '跨轮注入的紊乱次数必须等于异常池值（否则通道断路或滞后未收敛）')
      .toBe(ap.disorderCount)
    expect(last!.cfg.miyabiFrostfireTriggerCount, '烈霜触发次数同理')
      .toBe((ap.perElement ?? []).find(p => p.element === 'frostfire')?.triggerCount ?? 0)
  }, 300000)
})
describe('霜灼·破次数（原 floor(exSpecialCount)）', () => {
  const cfgOf = (o: Record<string, unknown> = {}) => ({
    battleTime: 180,
    'setting:miyabi.frostburnBreakCount': 0,
    'setting:miyabi.frostburnBreakRate': 1,
    ...o,
  } as unknown as CharacterOperationConfig)

  it('次数 = min(烈霜触发次数, 1+⌊战斗时间/10⌋) × 利用率（10s CD 生效）', () => {
    // 触发次数充足但 180s 只装得下 18 个 10s 窗口；用 40 触发验 CD 上界
    expect(miyabiFrostburnBreakCountOf(cfgOf({ miyabiFrostfireTriggerCount: 40 }), 180)).toBe(18)
    // 触发次数不足 ⇒ 被触发次数压住（不是被 CD 抬到 18）
    expect(miyabiFrostburnBreakCountOf(cfgOf({ miyabiFrostfireTriggerCount: 3 }), 180)).toBe(3)
    // 战斗时间 60s ⇒ 上界 6 次（60/10）
    expect(miyabiFrostburnBreakCountOf(cfgOf({ miyabiFrostfireTriggerCount: 40 }), 60)).toBe(6)
    // 战斗时间 30s ⇒ 3 次
    expect(miyabiFrostburnBreakCountOf(cfgOf({ miyabiFrostfireTriggerCount: 40 }), 30)).toBe(3)
    // 利用率 0.5 ⇒ 减半（floor）
    expect(miyabiFrostburnBreakCountOf(cfgOf({ miyabiFrostfireTriggerCount: 10, 'setting:miyabi.frostburnBreakRate': 0.5 }), 180)).toBe(5)
    // 上界滑块只压不抬（用户口径 2026-10-19）
    expect(miyabiFrostburnBreakCountOf(cfgOf({ miyabiFrostfireTriggerCount: 3, 'setting:miyabi.frostburnBreakCount': 20 }), 180)).toBe(3)
    expect(miyabiFrostburnBreakCountOf(cfgOf({ miyabiFrostfireTriggerCount: 10, 'setting:miyabi.frostburnBreakCount': 4 }), 180)).toBe(4)
    // 缺省（首轮无跨轮值）= 0，**不是**用强特次数兜底（兜底会把旧缺陷引回来）
    expect(miyabiFrostburnBreakCountOf(cfgOf({}), 180)).toBe(0)
  })

  it('★ 霜灼·破行与霜月次数解耦：落霜不足 6（打不出霜月）时 1500% 直伤行仍要产出', () => {
    // 修复前 buildExecutions 在 frostMoonCount <= 0 处早退 ⇒ 霜灼·破行连带消失。
    // 直接调模块钩子（合成 cfg：入场 3 + 霜灼·破 1 = 4 < 6 ⇒ 霜月 0 次），不经管线：
    // 管线里 E/Q 两条会补足落霜（那句「够不够 6」就不再成立），测不到这个分支。
    const cfg = {
      agentId: MIYABI_AGENT_ID_TEST,
      slot: 0,
      battleTime: 180,
      'setting:miyabi.frostburnBreakCount': 1,
      'setting:miyabi.frostburnBreakRate': 1,
      'setting:miyabi.frostMoonCountCap': 0,
      miyabiCinemaLevel: 0,
      miyabiEntryFrostFall: 3,
      miyabiDisorderCount: 0,
      miyabiFrostfireTriggerCount: 10,
      moveActionTimes: { 1091029: 3.434, 1091027: 0.4, 1091028: 0.567 },
    } as unknown as CharacterOperationConfig
    const state = { basicAttackTime: 0, exSpecialCount: 0, ultimateCount: 0, chainCountTotal: 0 } as never
    const executions: any[] = []
    miyabiMechanic.buildExecutions!({ cfg, state, executions } as never)
    const frostburn = executions.filter(e => e.moveId === 'miyabi_frostburn_break')
    const moons = executions.find(e => e.moveId === '1091029')
    expect(moons, '夹具前提：这一档必须真的打不出霜月（否则本判据没测到解耦）').toBeUndefined()
    expect(frostburn.length, '霜灼·破行必须恰好一行').toBe(1)
    expect(frostburn[0]!.count, '次数按上限滑块压到 1').toBe(1)
  })
})

describe('跨轮反馈通道（与爱丽丝 1401 剑仪同款）', () => {
  it('nextRoundFeedback 只返回、不写 cfg；applyTeamConfig converge 写回、build 置 0', () => {
    // ① nextRoundFeedback：返回值就是两个次数
    const pool = {
      perElement: [{ element: 'frostfire', triggerCount: 9 }, { element: 'ether', triggerCount: 4 }],
      disorderCount: 6,
    }
    const ret = miyabiMechanic.nextRoundFeedback!({ anomalyPool: pool } as never) as Record<string, number>
    expect(ret.miyabiDisorderCount, '紊乱次数必须透传全队 disorderCount').toBe(6)
    expect(ret.miyabiFrostfireTriggerCount, '烈霜触发次数必须取 frostfire 那一项').toBe(9)
    // ② 三相位：build 置 0 / converge 从 threads.moduleFeedback 写 / postRound 不动
    const cfg = { agentId: '1091', slot: 0 } as CharacterOperationConfig
    miyabiMechanic.applyTeamConfig!({ cfg, phase: 'build', threads: undefined } as never)
    expect(cfg.miyabiDisorderCount).toBe(0)
    expect(cfg.miyabiFrostfireTriggerCount).toBe(0)
    cfg.miyabiDisorderCount = 99
    miyabiMechanic.applyTeamConfig!({ cfg, phase: 'postRound', threads: { moduleFeedback: { miyabiDisorderCount: 5 } } } as never)
    expect(cfg.miyabiDisorderCount, 'postRound 相位不得改写').toBe(99)
    miyabiMechanic.applyTeamConfig!({ cfg, phase: 'converge', threads: { moduleFeedback: { miyabiDisorderCount: 5, miyabiFrostfireTriggerCount: 11 } } } as never)
    expect(cfg.miyabiDisorderCount).toBe(5)
    expect(cfg.miyabiFrostfireTriggerCount).toBe(11)
    // ③ 缺键 = 0（不在队 / 守卫不成立），且**不做别的量兜底**
    miyabiMechanic.applyTeamConfig!({ cfg, phase: 'converge', threads: { moduleFeedback: {} } } as never)
    expect(cfg.miyabiDisorderCount).toBe(0)
    expect(cfg.miyabiFrostfireTriggerCount).toBe(0)
  })

  /**
   * ★ 管线级：钩子真的被派发（防「写了钩子忘了挂」= 本通道静默归零）。
   * 与 nextRoundFeedback.test.ts 的实测背景同型：timeGolden 对这类 cfg 写回完全不敏感，
   * 只能靠「跑一次真管线，再调 collectNextRoundFeedback 看键在不在」这种锚点。
   */
  it('真管线：collectNextRoundFeedback 产出本模块两个键（键名与 applyTeamConfig 读侧一致）', async () => {
    const { config } = await setupHarness(TEAM as never)
    for (const buff of config.globalBuffs) buff.enabled = false
    const calc = useResourceCalc()
    void calc.damagePoolRows.value
    const catalog = useCatalogStore()
    const rr = calc.resourceResult.value!
    const ap = calc.anomalyPoolResult.value!
    const characters = (calc.resourceConfig.value as never as { characters: CharacterOperationConfig[] }).characters
    const feedback = collectNextRoundFeedback({
      characters,
      teamResult: rr as never,
      displayResult: rr as never,
      adjustedResult: rr as never,
      anomalyPool: ap as never,
      prevThreads: { moduleFeedback: {} } as never,
      catalogStore: catalog,
      combatTime: 180,
    })
    expect(feedback.miyabiDisorderCount, '紊乱次数键必须被产出（缺失 ⇒ applyTeamConfig 恒读 0）').toBe(ap.disorderCount)
    expect(feedback.miyabiFrostfireTriggerCount, '烈霜触发次数键必须被产出')
      .toBe((ap.perElement ?? []).find(p => p.element === 'frostfire')?.triggerCount ?? 0)
  }, 300000)
})

describe('影画二门控（风花#5 +1 落霜）', () => {
  /**
   * C0/C1 不得拿 C 项；C2 起必须拿到 ⌊平A/2⌋ 点。同队同配置只切 cinemaLevel。
   * 反空洞：两次读数的 ⌊平A/2⌋ 都 > 0（否则「恒 0」是夹具失效）。
   */
  it('C0/C1 的落霜总量不含风花#5 项；C2 起该项生效', () => {
    // 判据落点 = 模块的**门控函数**（miyabiFrostFallContext 决定 basicAttackCount 覆盖值），
    // 不是管线总量：五源齐全后关一条会改平衡（霜月→强特/终结→另几条基数），减法不成立。
    const spec = getAgentSpec('1091')!
    const c2GainAt = (cinemaLevel: number) => {
      const cfg = {
        battleTime: 180,
        'setting:miyabi.frostburnBreakCount': 0,
        'setting:miyabi.frostburnBreakRate': 0,
        miyabiCinemaLevel: cinemaLevel,
        miyabiEntryFrostFall: cinemaLevel >= 2 ? 6 : 3,
      } as unknown as CharacterOperationConfig
      // 平A 30s ⇒ ⌊30/2⌋ = 15 次风花#5 命中
      const state = { basicAttackTime: 30, exSpecialCount: 0, ultimateCount: 0, chainCountTotal: 0 } as never
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mod: any = miyabiMechanic
      void mod
      // 门控在模块的 context 构造函数里（非导出）⇒ 用 buildExecutions 的等价路径：
      // 直接按 spec 传 basicAttackCount（模拟 C2 门控「给 15」/ C0 门控「给 0」）
      const withGate = computeSpecResources(spec, cfg, state, {
        disorderCount: 0,
        frostburnBreakCount: 0,
        basicAttackCount: cinemaLevel >= 2 ? Math.floor(30 / 2) : 0,
      }).get('miyabi_frost_fall')!
      return withGate.gains['miyabi_c2_flower_basic_frost_fall_gain'] ?? 0
    }
    expect(c2GainAt(0), 'C0 风花#5 落霜恒 0').toBe(0)
    expect(c2GainAt(1), 'C1 风花#5 落霜恒 0').toBe(0)
    expect(c2GainAt(2), 'C2 起 = ⌊平A/2⌋').toBe(15)
    expect(c2GainAt(6), 'C6 仍按 C2 口径').toBe(15)
  })
  /**
   * ★ 入场落霜（2026-10-23 接通）：基础技「进入战场时立刻获得 3 点[落霜]」，影画二**替换**为 6 点。
   * 修复前 spec 是 initialValue: 0 + 零读者的 properties.cinema2EntryGift ⇒ 这一份收入整块缺失。
   */
  it('入场落霜：基础 3 点 / 影画二 6 点（替换不是叠加）', () => {
    // ⚠ 走解释器层而不是管线：五源齐全后，管线里的落霜总量还含紊乱/强特/终结/霜灼·破，
    // 关滑块会把平衡推走（霜月→强特→终结次数全变），减法判据不成立。
    const spec = getAgentSpec('1091')!
    const initialAt = (cinemaLevel: number) => {
      const cfg = {
        battleTime: 180,
        'setting:miyabi.frostburnBreakCount': 0,
        'setting:miyabi.frostburnBreakRate': 0,
        miyabiCinemaLevel: cinemaLevel,
        // buildCharConfig 的口径：C2 起 6、否则 3（替换不是叠加）
        miyabiEntryFrostFall: cinemaLevel >= 2 ? 6 : 3,
      } as unknown as CharacterOperationConfig
      const state = { basicAttackTime: 0, exSpecialCount: 0, ultimateCount: 0, chainCountTotal: 0 } as never
      return computeSpecResources(spec, cfg, state, {
        disorderCount: 0,
        frostburnBreakCount: 0,
        basicAttackCount: 0,
      }).get('miyabi_frost_fall')!.initialValue
    }
    expect(initialAt(0), 'C0 入场落霜 = 3').toBe(3)
    expect(initialAt(1), 'C1 入场落霜 = 3（影画二才改）').toBe(3)
    expect(initialAt(2), 'C2 入场落霜 = 6（替换基础的 3，不是 3+6）').toBe(6)
    expect(initialAt(6), 'C6 入场落霜 = 6').toBe(6)
  })
})

describe('霜月刀数：总量口径（min(⌊落霜总量/6⌋, 19)）', () => {
  /**
   * 用户口径 2026-10-24：
   *   「就算 0 次紊乱，他也有回复豆子的能力，凑齐 6 豆他也可以拔刀啊」
   *   「如果你不是快循环，有大把时间平a但是没办法紊乱了，这时候就该把多余的e用来补豆子」
   * ⇒ 刀数由**豆子总回复量**给出（⌊总量/6⌋），与紊乱次数无直接耦合；19 刀上限（顶尖玩家
   * 时间极限）吸收快循环的溢出。慢循环队靠强化特殊技补豆，旧「紊乱配比轮」口径会把它
   * 系统性低估（雅耀妮 C0 实测 4 刀 vs 豆子够 13 刀）。
   */
  it('三点闭式：攒满 6 点即一刀，19 上限即溢出机制', () => {
    // 用户口径 2026-10-24：「就算 0 次紊乱，他也有回复豆子的能力，凑齐 6 豆他也可以拔刀啊」
    // ⇒ 刀数 = ⌊落霜总量/6⌋，与来源构成无关；19 上限即快循环的溢出机制。
    const count = (total: number, cap = 19) => miyabiFrostMoonCountOf({ frostFallTotal: total, countCap: cap })
    expect(count(6), '6 点 = 1 刀').toBe(1)
    expect(count(0), '没有落霜 ⇒ 0 刀').toBe(0)
    expect(count(35), '35 点 ⇒ ⌊35/6⌋ = 5 刀（余 5 点留着，不够一刀）').toBe(5)
    expect(count(114), '114 点 ⇒ 19 刀（正好吃满上限）').toBe(19)
    expect(count(200), '200 点仍只有 19 刀 —— 快循环多出的豆子全部溢出').toBe(19)
    expect(count(200, 0), 'cap=0 ⇒ 不设上限（纯豆子口径 33 刀）').toBe(33)
    expect(count(114, 10), '滑块只压不抬：cap=10 ⇒ 10 刀').toBe(10)
    expect(count(114, 30), 'cap=30 高于豆子能打的 19 ⇒ 仍 19 刀（不能凭空多打）').toBe(19)
  })

  /**
   * 关键回归：**慢循环队不能按紊乱配比算刀数**。
   * 雅耀妮（1091/1031/1311）队友积蓄跟不上，一局上百秒打不出紊乱 ⇒ 平A 多 ⇒ 强特多 ⇒
   * **多余的 E 补豆子**。旧「配比轮」模型只给 4 刀（紊乱 8 次 / 2），实测豆子够 13 刀。
   */
  it('慢循环：雅耀妮 c0 的刀数由豆子总量给出，明显高于紊乱配比轮', async () => {
    const { config } = await setupHarness([
      { agentId: '1091', cinemaLevel: 0 }, { agentId: '1031' }, { agentId: '1311' },
    ] as never, { recommendedBuild: true } as never)
    for (const buff of config.globalBuffs) buff.enabled = false
    const calc = useResourceCalc()
    void calc.damagePoolRows.value
    const mi = calc.resourceResult.value!.characters.find(c => c.agentId === '1091')!
    const src = mi.miyabiFrostFallSource!
    const ap = calc.anomalyPoolResult.value
    const disorder = ap?.disorderCount ?? 0
    const byDisorderPair = Math.floor(disorder / 2)
    expect(src.frostMoonByResource, '刀数 = ⌊落霜总量/6⌋（与资源卡同源）').toBe(Math.floor(src.total / 6))
    expect(src.frostMoonByResource, '慢循环必须高于「紊乱配比轮」——否则多余的 E 又被浪费了').toBeGreaterThan(byDisorderPair)
    expect(src.frostMoonCount, '刀数与执行行同源（规则 11）').toBe(Math.min(src.frostMoonByResource, 19))
  }, 600000)
  it('真管线：雅南柚队 c0 的刀数 = 总量口径值，受 19 上限截断', async () => {
    const { config } = await setupHarness([
      { agentId: '1091', cinemaLevel: 0 }, { agentId: '1511' }, { agentId: '1411' },
    ] as never, { recommendedBuild: true } as never)
    for (const buff of config.globalBuffs) buff.enabled = false
    const calc = useResourceCalc()
    void calc.damagePoolRows.value
    const mi = calc.resourceResult.value!.characters.find(c => c.agentId === '1091')!
    const src = mi.miyabiFrostFallSource!
    const ap = calc.anomalyPoolResult.value
    const disorder = ap?.disorderCount ?? 0
    const expected = Math.min(Math.floor(src.total / 6), 19)
    void disorder
    expect(src.frostMoonCount, 'cap 默认 19 且总量口径值不超过它 ⇒ 不再二次截断').toBe(expected)
    expect(src.frostMoonByResource, '线性口径必须 ≥ 刀数（总量够打才谈得上配比）').toBeGreaterThanOrEqual(expected)
  }, 600000)

  it('上限滑块压在刀数上：cap=5 ⇒ 5，cap=0 ⇒ 回到豆子总量值', async () => {
    const read = async (cap: number) => {
      const { config } = await setupHarness([
        { agentId: '1091', cinemaLevel: 0 }, { agentId: '1511' }, { agentId: '1411' },
      ] as never, { recommendedBuild: true } as never)
      for (const buff of config.globalBuffs) buff.enabled = false
      config.setMechanicSetting('miyabi.frostMoonCountCap', cap)
      const calc = useResourceCalc()
      void calc.damagePoolRows.value
      const ch = calc.resourceResult.value!.characters.find(c => c.agentId === '1091')!
      const src = ch.miyabiFrostFallSource!
      const row = ch.executions.find(e => e.moveId === '1091029')
      return { src, rowCount: row?.count ?? 0 }
    }
    const uncapped = await read(0)
    const capped5 = await read(5)
    expect(uncapped.src.frostMoonCount, '夹具前提：cap=0 的豆子总量刀数须 > 5（否则测不到截断）').toBeGreaterThan(5)
    expect(uncapped.rowCount, 'cap=0（不设上限）⇒ 行数 = 豆子总量刀数').toBe(uncapped.src.frostMoonCount)
    expect(capped5.rowCount, 'cap=5 ⇒ 行数被压到 5').toBe(5)
    expect(capped5.src.frostMoonCount, '结果字段与执行行同源').toBe(5)
  }, 900000)
})
