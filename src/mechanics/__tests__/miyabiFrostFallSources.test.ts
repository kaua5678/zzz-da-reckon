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
import { miyabiFrostburnBreakCountOf, miyabiMechanic } from '@/mechanics/agents/miyabi'
import { collectNextRoundFeedback } from '@/composables/resourceCalc/panelPhases'
import { useCatalogStore } from '@/stores/catalog'
import { getAgentSpec } from '@/specs/registry'
import { computeSpecResources } from '@/specs/resources'
import type { CharacterOperationConfig } from '@/types/resource'

/** 队伍夹具：雅 + 两名队友（紊乱/烈霜都得真的发生，否则断言退化成恒 0 假绿） */
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

  it('★ 霜灼·破行与霜月次数解耦：落霜不足 6（打不出霜月）时 1500% 直伤行仍要产出', async () => {
    // 修复前 buildExecutions 在 frostMoonCount <= 0 处早退 ⇒ 霜灼·破行连带消失
    const { config } = await setupHarness([{ agentId: '1091', cinemaLevel: 0 }, '', ''])
    // 入场落霜 3 点已在（2026-10-23 接通）⇒ 要把落霜压到 <6 必须让霜灼·破 gain 一起被压：
    // cap=1 时 落霜 = 3(入场) + 1(霜灼·破) = 4 < 6 ⇒ 打不出霜月
    config.setMechanicSetting('miyabi.frostburnBreakCount', 1)
    const calc = useResourceCalc()
    void calc.damagePoolRows.value
    const ch = calc.resourceResult.value!.characters.find(c => c.agentId === '1091')!
    const frostburn = ch.executions.filter(e => e.moveId === 'miyabi_frostburn_break')
    const moons = ch.executions.find(e => e.moveId === '1091029')
    expect(frostburn.length, '霜灼·破行必须恰好一行').toBe(1)
    expect(frostburn[0]!.count, '次数按上限滑块压到 1').toBe(1)
    expect(moons, '夹具前提：这一档必须真的打不出霜月（否则本判据没测到解耦）').toBeUndefined()
  }, 300000)
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
  it('C0/C1 的落霜总量不含风花#5 项；C2 起该项生效', async () => {
    const C = '1091.miyabi_frost_fall.miyabi_c2_flower_basic_frost_fall_gain.rate'
    const D = '1091.miyabi_frost_fall.miyabi_disorder_frost_fall_gain.rate'
    const F = '1091.miyabi_frost_fall.miyabi_frostburn_break_frost_fall_gain.rate'
    const readAt = async (cinemaLevel: number) => {
      const { config } = await setupHarness([
        { agentId: '1091', cinemaLevel }, { agentId: '1251', cinemaLevel: 6 }, { agentId: '1171', cinemaLevel: 6 },
      ] as never)
      for (const buff of config.globalBuffs) buff.enabled = false
      const calc = useResourceCalc()
      void calc.damagePoolRows.value
      const ch = calc.resourceResult.value!.characters.find(c => c.agentId === '1091')!
      const basicRow = ch.executions.find(e => e.moveId === 'basic_attack')?.totalTime ?? 0
      const withAll = ch.miyabiFrostFallSource!.total
      config.setMechanicSetting(D, 0)
      config.setMechanicSetting(F, 0)
      const onlyC = calc.resourceResult.value!.characters.find(c => c.agentId === '1091')!.miyabiFrostFallSource!.total
      config.setMechanicSetting(C, 0)
      const none = calc.resourceResult.value!.characters.find(c => c.agentId === '1091')!.miyabiFrostFallSource!.total
      return { withAll, onlyC, none, basic: Math.floor(basicRow / 2), entry: cinemaLevel >= 2 ? 6 : 3 }
    }
    const c0 = await readAt(0)
    const c1 = await readAt(1)
    const c2 = await readAt(2)
    expect(c0.basic, '夹具前提：C0 的 ⌊平A/2⌋ 须 > 0').toBeGreaterThan(0)
    expect(c2.basic, '夹具前提：C2 的 ⌊平A/2⌋ 须 > 0').toBeGreaterThan(0)
    // 读数含 spec initialValue（入场落霜）⇒ 判据是「只剩入场值」而不是「= 0」
    expect(c0.onlyC, 'C0 不得拿风花#5 落霜（只剩入场落霜）').toBe(c0.entry)
    expect(c1.onlyC, 'C1 不得拿风花#5 落霜（只剩入场落霜）').toBe(c1.entry)
    expect(c2.onlyC, 'C2 起风花#5 必须真的进总量（入场 + ⌊平A/2⌋）').toBe(c2.entry + c2.basic)
    expect(c0.withAll, '反空洞：C0 总量仍须 > 0（另两条来源在）').toBeGreaterThan(c0.entry)
    expect(c0.onlyC - c0.none, 'C0 的 C 项贡献必须恒 0').toBe(0)
    expect(c2.onlyC - c2.none, 'C2 的 C 项贡献必须 = ⌊平A/2⌋').toBe(c2.basic)
  }, 600000)

  /**
   * ★ 入场落霜（2026-10-23 接通）：基础技「进入战场时立刻获得 3 点[落霜]」，影画二**替换**为 6 点。
   * 修复前 spec 是 initialValue: 0 + 零读者的 properties.cinema2EntryGift ⇒ 这一份收入整块缺失。
   */
  it('入场落霜：基础 3 点 / 影画二 6 点（替换不是叠加）', async () => {
    const readEntry = async (cinemaLevel: number) => {
      const { config } = await setupHarness([
        { agentId: '1091', cinemaLevel }, { agentId: '1251', cinemaLevel: 6 }, { agentId: '1171', cinemaLevel: 6 },
      ] as never)
      for (const buff of config.globalBuffs) buff.enabled = false
      config.setMechanicSetting('1091.miyabi_frost_fall.miyabi_disorder_frost_fall_gain.rate', 0)
      config.setMechanicSetting('1091.miyabi_frost_fall.miyabi_frostburn_break_frost_fall_gain.rate', 0)
      config.setMechanicSetting('1091.miyabi_frost_fall.miyabi_c2_flower_basic_frost_fall_gain.rate', 0)
      const calc = useResourceCalc()
      void calc.damagePoolRows.value
      return calc.resourceResult.value!.characters.find(c => c.agentId === '1091')!.miyabiFrostFallSource!.total
    }
    expect(await readEntry(0), 'C0 入场落霜 = 3').toBe(3)
    expect(await readEntry(1), 'C1 入场落霜 = 3（影画二才改）').toBe(3)
    expect(await readEntry(2), 'C2 入场落霜 = 6（替换基础的 3，不是 3+6）').toBe(6)
    expect(await readEntry(6), 'C6 入场落霜 = 6').toBe(6)
  }, 600000)
})

describe('影画四：霜灼·破 +30%（原为死口径）', () => {
  /**
   * 判据：同一队伍只切 c3 → c4，霜灼·破行的 `damageMultiplier` 必须 ×1.30（且不是靠 note 文字）。
   * 修复前 C4_FROSTBURN_DMG 只出现在 resolveExecutionDamage 的说明里，实测两档 perDamage 逐位相同（10411）。
   */
  it('c4 的霜灼·破倍率 = 1500 × 1.30 = 1950，c3 为 1500', async () => {
    const readMultiplier = async (cinemaLevel: number) => {
      const { config } = await setupHarness([{ agentId: '1091', cinemaLevel }, '', ''] as never)
      for (const buff of config.globalBuffs) buff.enabled = false
      const calc = useResourceCalc()
      void calc.damagePoolRows.value
      const row = calc.resourceResult.value!.characters.find(c => c.agentId === '1091')!
        .executions.find(e => e.moveId === 'miyabi_frostburn_break')
      return row?.damageMultiplier ?? 0
    }
    expect(await readMultiplier(3), 'C3 霜灼·破 = 1500%（无 C4 加成）').toBeCloseTo(1500, 6)
    expect(await readMultiplier(4), 'C4 霜灼·破 = 1500% × 1.30').toBeCloseTo(1950, 6)
  }, 300000)
})

describe('霜月次数上限（时间约束 19 次/局）', () => {
  /**
   * 用户口径 2026-10-24：落霜改真口径后，C2 队的资源够打 17~20 次霜月，但**一局打不出那么多**
   * （资源回复会溢出，瓶颈是时间：每次霜月独占 1s 锁定 + 收招）。默认上限 19 次/局 = 顶尖玩家实测。
   *
   * 判据形态：同一队只改上限滑块，看「行数 = min(资源可打, 上限)」，且资源侧读数不被上限污染
   * （`frostMoonByResource` 是纯资源次数，`frostMoonCount` 才是实际产行次数）。
   */
  it('cap 压到 5 ⇒ 行数 5；cap=0 ⇒ 回到资源次数；资源侧读数两种档位不变', async () => {
    const read = async (cap: number) => {
      const { config } = await setupHarness([
        { agentId: '1091', cinemaLevel: 2 }, { agentId: '1511' }, { agentId: '1411' },
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
    const capped19 = await read(19)
    expect(uncapped.src.frostMoonByResource, '夹具前提：资源要够打 > 5 次（否则本判据测不到截断）').toBeGreaterThan(5)
    expect(uncapped.rowCount, 'cap=0（不设上限）⇒ 行数 = 资源次数').toBe(uncapped.src.frostMoonByResource)
    expect(capped5.rowCount, 'cap=5 ⇒ 行数被压到 5').toBe(5)
    expect(capped5.src.frostMoonCount, '结果字段与执行行同源').toBe(5)
    expect(capped5.src.frostMoonByResource, '资源侧读数不被上限污染').toBe(uncapped.src.frostMoonByResource)
    // 默认 19：不小于资源次数时不该截断（实测这支队资源 18~19 次）
    expect(capped19.rowCount, 'cap=19 ≥ 资源次数 ⇒ 行数不受影响').toBe(Math.min(uncapped.src.frostMoonByResource, 19))
  }, 600000)
})
