/**
 * 边际填充搜索（2026-11-10）生效测试。
 *
 * 用户口径：「生产一点点消耗一点点」；并且**即便超时也不触发动作切换**（切换会反向砍一批招式、
 * 失衡次数也掉，宁可留白也不要这种"进步"）；临界填充必须自动停在超时之前。
 *
 * 搜索本体（两条）：
 *  · 有富余的队真的被填：留白下降、代价为零（不截断、不超预算、失衡次数不降）；
 *  · 会掉失衡次数/砍招式的队**一律不填**（护栏生效）。
 *
 * 2026-11-10 追加**跨渲染缓存**（`resourceCalc/fillCache.ts`）六条：
 *  · ① 同配置连续求值 3 次 ⇒ 候选求值次数 2,0,0（含反空洞：基线 1 次、候选真是 2 个）；
 *  · ② 键覆盖：队伍 / 面板 / 命座 / 交互次数 / 敌人数值 / 天赋音擎各改一个值 ⇒ 各一次 miss；
 *  · ②b 登记完整性：`$state` 每个键都进了两张表之一，且每个进键项都真的改变键串；
 *  · ②c 目录 / 行融合规则进键；纯策略项（`timeWeightStrategy`）不进键；
 *  · ③ LRU 有上限、超限淘汰最旧、命中提队尾（LRU 不是 FIFO）；
 *  · ④ 零漂移：命中 vs 未命中逐位相同（slack / 伤害 / 失衡 / 净占用 / refund / overflow）+ ④b 关缓存回到真求值口径。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { getCalcOutputMemoStats, setCalcOutputMemoEnabled, useResourceCalc } from '@/composables/useResourceCalc'
import {
  FILL_CACHE_IRRELEVANT_STATE_KEYS,
  FILL_CACHE_KEYED_STATE_KEYS,
  FILL_CACHE_MAX,
  fillCacheKey,
  resetFillCache,
  setFillCacheEnabled,
} from '@/composables/resourceCalc/fillCache'
import { activeRowFusionRulesSnapshot } from '@/logicEditor/fusion'
import { useConfigStore } from '@/stores/config'
import { useCatalogStore } from '@/stores/catalog'
import { netFrontlineOccupation } from '@/core/resource/timeOccupation'
import { buildTeamTimeSummary } from '@/composables/teamTimeSummary'
import { setPendingFillSeed } from '@/composables/resourceCalc/convergence'

/**
 * **有富余的队**（留白 > 1s 且搜索真的跑了候选）：`auto-1051-1481-1451`。
 * 基线（2026-11-11 修 `computeWithFillUncached` 候选入口后实测）：留白 4.46s → 1.87s，refund 0.69s。
 *
 * ⚠ 这一支曾是「合并后不再被填」的那一支。根因不是护栏误判，而是候选帧算错了：
 * 旧实现给候选另造一份 `{...base, characters: 深拷贝}` 送给 `computeCalcOutput`，而
 * `runCalcRound` 读的是 `resourceConfig.value`（另一个对象）⇒ 候选帧的毛失衡值少算 428 点，
 * 恰好把这支**余量为 0** 的队伍（有效失衡值 = 3×阈值，一分不多）从 3 窗翻成 2 窗，于是被拒。
 * 修好后它与干净求值逐位一致，正常被填。判据见本文件 ⑤（候选 ≡ 冷求值）。
 */
const FILLED_TEAM = ['1051', '1481', '1451']
/**
 * **候选数 = 2 的夹具**：`auto-1521-1461-1311`。
 * 留白 3.47s > 2s ⇒ 走 `{0.6, 1}` 两档 ⇒ 每次冷求值跑 2 个候选（「2,0,0」判据要的正是 2）。
 */
const TWO_CANDIDATE_TEAM = ['1521', '1461', '1311']
/**
 * **键覆盖 / 关缓存判据的夹具**（廉价：单次求值 ~0.1s，且留白 1.41s ⇒ 仍会跑 1 个候选，
 * 所以「改一个输入 ⇒ miss」量到的确实是填充缓存这一层）。
 */
const CHEAP_TEAM = ['1591', '1161', '1211']
/**
 * **会掉失衡次数的队**：`auto-1531-1481-1451`（留白 5.13s > 1s ⇒ 搜索真的跑候选）。
 *
 * 2026-11-11 换夹具：原 `1601/1621/1661`（sunbringer-roxy-robin）在候选入口修好后**不再掉窗** ——
 * 实测两档候选都保持 3 窗（slack 6.25 / 7.34，零截断），只是「留白没变小」⇒ 被 idle 门拒。
 * 那已经不属于本条判据要表达的「砍招式换留白」，故换到仍被 stun 门拒的那一支：
 * 实测两档候选都把失衡压到 2 窗（seed 3.08 / 5.13 各报一次）⇒ 护栏按「宁可留白也不退步」拒。
 */
const REJECTED_TEAM = ['1531', '1481', '1451']

async function measure(team: string[]) {
  await setupHarness(['', '', ''])
  const config = useConfigStore()
  for (let i = 0; i < 3; i++) config.setAgent(i, team[i])
  setCalcOutputMemoEnabled(false)
  const calc = useResourceCalc()
  const rr = calc.resourceResult.value!
  setCalcOutputMemoEnabled(true)
  const t = buildTeamTimeSummary({
    rr, battleTime: rr.totalTime,
    invincibleTime: config.enemy.invincibleTime ?? 0,
    nameOf: (_a, slot) => '槽' + slot,
  })
  return { rr, calc, slack: t.slack, refund: t.refund ?? 0, stun: calc.stunPoolResult.value?.stunCount ?? 0 }
}

/** 当前填充缓存计数快照（判据一律读「差」；与 `calcOutputMemo` 同一套用法） */
function fillSnap() {
  const f = getCalcOutputMemoStats().fill
  return { hits: f.hits, misses: f.misses, bypass: f.bypass, candidates: f.candidates, baselines: f.baselines, evictions: f.evictions, size: f.size }
}

/**
 * 夹具装配：`setAgent` 逐槽（与生产预设同一通道），**外层记忆化关、本层缓存开**——
 * 这样「同一配置再读一次」不会命中外层（那是既有测试覆盖的另一层），量到的就是本层。
 */
async function setupCached(team: string[]) {
  await setupHarness(['', '', ''])
  const config = useConfigStore()
  for (let i = 0; i < 3; i++) config.setAgent(i, team[i])
  setCalcOutputMemoEnabled(false) // 外层旁路（这一步同时会关掉本层）
  setFillCacheEnabled(true) // 只开本层
  resetFillCache()
  return config
}

beforeEach(() => {
  // 计数是模块级、跨用例累计 ⇒ 每条用例自己 reset，读计数一律用快照差
  setCalcOutputMemoEnabled(true)
  resetFillCache()
})
afterEach(() => {
  setCalcOutputMemoEnabled(true)
})

describe('边际填充搜索', () => {
  it('① 有富余的队被填：留白下降且不砍招式/不超预算/失衡次数不降', async () => {
    const a = await measure(FILLED_TEAM)
    expect(a.slack, '留白应收窄（基线 4.5s）').toBeLessThan(3.0)
    expect(a.refund, '必须真的注入了填充量').toBeGreaterThan(0)
    expect(a.stun, '失衡次数不许掉').toBeGreaterThanOrEqual(3)
    expect(Math.max(0, -a.slack), '不许超预算').toBeLessThan(1e-3)
    expect(a.rr.overflowSeconds ?? 0, '不许靠截断换留白').toBeLessThan(1e-3)
  }, 120_000)

  it('② 会掉失衡次数的队一律不填（护栏生效）', async () => {
    const b = await measure(REJECTED_TEAM)
    expect(b.stun, '失衡次数必须保持 3（填充会把池压到 2）').toBe(3)
    // 阈值随夹具：原夹具 slack 11.93，现夹具基线 5.1（timeFillRatchet 同源）⇒ 断言「留白原样保留」。
    expect(b.slack, '体检不过就必须原样留白（宁可留白，不退步）').toBeGreaterThan(5)
    expect(b.refund, '被拒时不许留下填充量').toBe(0)
  }, 120_000)

  /**
   * ⑤ **候选帧 ≡ 干净求值**（2026-11-11，本卡回归护栏）。
   *
   * 用户口径「任何队伍都不留白」的实现前提是：填充搜索拿到的候选帧必须**就是**玩家真打出来的那一帧。
   * 旧实现给候选另造一份 `{...base, characters: 深拷贝}`，而引擎读的是 `resourceConfig.value` ⇒
   * 两份对象分叉，实测同一 seed 的毛失衡值差 428 点（62060 vs 62488），把一支余量为 0 的队从 3 窗翻成 2 窗。
   *
   * 判据：把「搜索最终采用的 seed」直接喂给一次**全新求值**，读数必须与搜索交付的帧逐位相同。
   */
  it('⑤ 候选帧 ≡ 干净求值（同一 seed 逐位相同）', async () => {
    const filled = await measure(FILLED_TEAM)
    expect(filled.refund, '前置：这支队伍必须真的被填过（否则本条退化成比两次基线）').toBeGreaterThan(0)
    // 由交付帧反推搜索采用的 seed：refund 就是注入量。
    await setupHarness(['', '', ''])
    const config = useConfigStore()
    for (let i = 0; i < 3; i++) config.setAgent(i, FILLED_TEAM[i])
    setCalcOutputMemoEnabled(false)
    setPendingFillSeed(filled.refund)
    let clean: { slack: number; stun: number; dmg: number; gross: number }
    try {
      const calc = useResourceCalc()
      const rr = calc.resourceResult.value!
      const p = calc.stunPoolResult.value!
      const t = buildTeamTimeSummary({
        rr, battleTime: rr.totalTime,
        invincibleTime: config.enemy.invincibleTime ?? 0,
        nameOf: (_a, slot) => '槽' + slot,
      })
      clean = { slack: t.slack, stun: p.stunCount, dmg: calc.teamTotalDamage.value, gross: p.grossStunBuildUp }
    } finally {
      setPendingFillSeed(null)
    }
    const basePool = filled.calc.stunPoolResult.value!
    expect(clean.stun, '失衡次数必须与候选帧一致').toBe(basePool.stunCount)
    expect(clean.gross, '毛失衡值必须逐位一致（本条就是 428 点假分歧的护栏）').toBe(basePool.grossStunBuildUp)
    expect(clean.slack, '留白必须逐位一致').toBe(filled.slack)
    expect(clean.dmg, '伤害必须逐位一致').toBe(filled.calc.teamTotalDamage.value)
  }, 300_000)
})

describe('边际填充搜索 · 跨渲染缓存', () => {
  /**
   * 用户判据①：**同一配置连续求值 3 次 ⇒ 候选求值次数 = 2,0,0**。
   * 用 `auto-1521-1461-1311`（留白 3.47s > 2s ⇒ 两档候选）：第一次冷求值 2 个候选，后两次全命中。
   *
   * ⚠ 三次都新建 `useResourceCalc()`：缓存是**模块级**（跨实例共享，与 `calcOutputMemo` 同款），
   * 这正是「不同渲染 / 不同页面实例读同一份状态」的真实形态。
   */
  it('① 同一配置连续求值 3 次：候选求值次数 = 2,0,0', async () => {
    await setupCached(TWO_CANDIDATE_TEAM)
    const s0 = fillSnap()
    const trail: number[] = []
    for (let i = 0; i < 3; i++) {
      const before = fillSnap().candidates
      const calc = useResourceCalc()
      const rr = calc.resourceResult.value
      expect(rr, '第 ' + (i + 1) + ' 次求值必须产出结果').toBeTruthy()
      trail.push(fillSnap().candidates - before)
    }
    expect(trail, '冷 2 个候选；后两次必须整段命中（不重跑候选）').toEqual([2, 0, 0])
    const s = fillSnap()
    expect({ hits: s.hits - s0.hits, misses: s.misses - s0.misses }, '后两次是命中、第一次是未命中').toEqual({ hits: 2, misses: 1 })
    // 反空洞：那个「2」必须是候选真的跑了两次（1 次基线 + 2 个候选 = 留白 > 2s 走 {0.6, 1} 两档），
    // 而不是夹具压根没进搜索。
    expect({ baselines: s.baselines - s0.baselines, candidates: s.candidates - s0.candidates })
      .toEqual({ baselines: 1, candidates: 2 })
  }, 300_000)

  /**
   * 用户判据②：**缓存键覆盖全部影响结果的输入**——对每一项各改一个值，断言各产生一次 miss。
   *
   * 覆盖面 = 「会影响结果的输入」的五类：
   *  ① 队伍（换人）；
   *  ② 面板（驱动盘副词条 → 面板属性；另含音擎 / 驱动盘套装 / 全局 buff 等面板输入）；
   *  ③ 命座；
   *  ④ 交互次数；
   *  ⑤ 敌人数值（失衡值 / 无敌时间 / 锁定失衡次数）+ 天赋音擎（潜能档 / 音擎 id / 精炼）。
   * 每条都断言「改完立刻 miss 一次」且「再读一次命中」（说明 miss 是那次改动造成的，不是每次都 miss）。
   */
  it('② 键覆盖：逐项各改一个值 ⇒ 各一次 miss（且改回后再读不 miss）', async () => {
    const config = await setupCached(CHEAP_TEAM)
    const calc = useResourceCalc()
    void calc.resourceResult.value // 冷启动：未命中一次
    const missDelta = (fn: () => void) => {
      const before = fillSnap().misses
      fn()
      void calc.resourceResult.value
      const after = fillSnap().misses
      // 再读一次必须命中（证明上面那次 miss 是这次改动引起的，而不是「每次都 miss」）
      const again = fillSnap().misses
      void calc.resourceResult.value
      expect(fillSnap().misses, '改完后第二次读必须命中').toBe(again)
      return after - before
    }

    const cases: Array<{ name: string; mutate: () => void; restore: () => void }> = [
      {
        name: '队伍（换人）',
        mutate: () => config.setAgent(2, '1481'),
        restore: () => config.setAgent(2, '1451'),
      },
      {
        name: '面板（副词条 → 面板属性）',
        mutate: () => config.setSubStatCount(0, 'atkPct', 6),
        restore: () => config.setSubStatCount(0, 'atkPct', 0),
      },
      {
        name: '命座',
        mutate: () => config.setCinemaLevel(0, 3),
        restore: () => config.setCinemaLevel(0, 0),
      },
      {
        name: '交互次数（闪避反击）',
        mutate: () => config.setActionCount(0, 'dodgeCounterCount', 12),
        restore: () => config.setActionCount(0, 'dodgeCounterCount', 10),
      },
      {
        name: '敌人 · 失衡值',
        mutate: () => config.setEnemy({ stunValue: config.enemy.stunValue * 1.01 }),
        restore: () => config.setEnemy({ stunValue: config.enemy.stunValue / 1.01 }),
      },
      {
        name: '敌人 · 无敌时间',
        mutate: () => config.setEnemy({ invincibleTime: (config.enemy.invincibleTime ?? 0) + 1 }),
        restore: () => config.setEnemy({ invincibleTime: (config.enemy.invincibleTime ?? 0) - 1 }),
      },
      {
        name: '敌人 · 锁定失衡次数',
        mutate: () => config.setEnemy({ stunCountLock: 3 }),
        restore: () => config.setEnemy({ stunCountLock: -1 }),
      },
      {
        name: '天赋（潜能档）',
        mutate: () => config.setPotentialLevel(0, 3),
        restore: () => config.setPotentialLevel(0, 6),
      },
      {
        name: '音擎',
        mutate: () => config.setWEngine(0, '14118'),
        restore: () => config.setWEngine(0, ''),
      },
      {
        name: '音擎精炼',
        mutate: () => config.setWEngineModLevel(0, 2),
        restore: () => config.setWEngineModLevel(0, 1),
      },
    ]
    for (const c of cases) {
      expect(missDelta(c.mutate), c.name + ' 必须让缓存 miss 一次').toBe(1)
      // 还原（本身又是一次 miss，下一轮用例从同一个已缓存状态出发）
      void calc.resourceResult.value; c.restore(); void calc.resourceResult.value
    }
  }, 300_000)

  /**
   * 用户判据②b：**登记完整性**——`$state` 的每个键都必须在「进键表」或「不读表」里。
   * 漏登记 = 新 state ref 影响引擎但键里没有它 ⇒ 换值仍命中旧结果（静默错值）。
   * 两张表的并集必须**恰好**等于 `Object.keys($state)`（多登记 / 少登记都红）。
   */
  it('②b 登记完整性：两张 state 表并集 == config.$state 的键，且每个进键项都真的进了键串', async () => {
    await setupHarness(['', '', ''])
    const config = useConfigStore()
    const registered = [...FILL_CACHE_KEYED_STATE_KEYS, ...Object.keys(FILL_CACHE_IRRELEVANT_STATE_KEYS)].sort()
    expect(registered, '新增 state ref 必须登记进 fillCache 的其中一张表').toEqual(Object.keys(config.$state).sort())
    // 反空洞：登记表确实非空、且「不读表」的每条都带判据（不是空壳）
    expect(FILL_CACHE_KEYED_STATE_KEYS.length).toBeGreaterThan(10)
    for (const [k, why] of Object.entries(FILL_CACHE_IRRELEVANT_STATE_KEYS)) {
      expect(why.length, k + ' 的「不读」判据必须写清').toBeGreaterThan(10)
    }

    // **每个进键项必须真的改变键串**（登记了却没进键 = 最隐蔽的静默错值：表看着全，键里没有）
    // 用**普通对象快照**做，不往响应式 store 里写哨兵（那会触发 store 的 watcher）
    const live = config.$state as unknown as Record<string, unknown>
    const state: Record<string, unknown> = {}
    for (const k of Object.keys(live)) state[k] = live[k]
    const base = {
      state,
      catalogIdentity: 1, teammateBuffGroupsIdentity: 2, buildRecommendationsIdentity: 3,
      teammateBuffsReady: true, rowFusionRules: [] as unknown[],
      panels: [['p', null]] as readonly unknown[], engineScalars: [1, 2, 3],
    }
    const original = fillCacheKey(base)
    for (const k of FILL_CACHE_KEYED_STATE_KEYS) {
      const prev = state[k]
      // 用哨兵换值：只要它进键，串必变（不论原值是什么类型）
      state[k] = { sentinel: k } as unknown
      expect(fillCacheKey(base), k + ' 登记的进键项必须真的进键').not.toBe(original)
      state[k] = prev
    }
    // 引擎入参派生面同理：面板 / 预算标量各改一格，键必须变
    expect(fillCacheKey({ ...base, panels: [['p2', null]] }), '面板必须进键').not.toBe(original)
    expect(fillCacheKey({ ...base, engineScalars: [1, 2, 4] }), '预算标量必须进键').not.toBe(original)
    expect(fillCacheKey({ ...base, catalogIdentity: 9 }), '目录身份必须进键').not.toBe(original)
    expect(fillCacheKey({ ...base, rowFusionRules: [{ x: 1 }] }), '行融合规则必须进键').not.toBe(original)
    expect(fillCacheKey({ ...base, teammateBuffsReady: false }), '队友 buff 就绪位必须进键').not.toBe(original)
    // 同入参 ⇒ 同串（纯函数；否则命中率会莫名归零）
    expect(fillCacheKey(base)).toBe(original)
    // 反空洞的收尾：还原后 state 与初始一致（上面的哨兵写入必须都回滚了）
    expect(Object.keys(state).sort()).toEqual([...FILL_CACHE_KEYED_STATE_KEYS, ...Object.keys(FILL_CACHE_IRRELEVANT_STATE_KEYS)].sort())
  }, 300_000)

  /**
   * 用户判据②c：**目录与行融合规则也进键**（store 之外的全局输入）；
   * 同时反向钉住「纯策略项不进键」（`timeWeightStrategy` 引擎零读点）——这一条防的是
   * 「为了消红把所有 state 都塞进键」的偷懒，也防键被加宽到无意义。
   */
  it('②c 目录整体替换 / 行融合规则变化 ⇒ miss；纯策略项（timeWeightStrategy）⇒ 不 miss', async () => {
    const config = await setupCached(CHEAP_TEAM)
    const catalog = useCatalogStore()
    const calc = useResourceCalc()
    void calc.resourceResult.value

    // 策略项（引擎零读点）：只换它不该重算填充搜索
    const m0 = fillSnap().misses
    config.timeWeightStrategy = 'static'
    void calc.resourceResult.value
    expect(fillSnap().misses, 'timeWeightStrategy 是纯策略项，不该让填充缓存失效').toBe(m0)

    // 目录整体替换（值相同、身份不同）⇒ 必须 miss
    const m1 = fillSnap().misses
    catalog.catalog = { ...catalog.catalog! }
    void calc.resourceResult.value
    expect(fillSnap().misses, '目录整体替换必须让缓存失效').toBe(m1 + 1)

    // 行融合规则（store 之外的全局响应式输入）⇒ 必须 miss
    const keyBefore = fillCacheKey({
      state: config.$state as unknown as Record<string, unknown>,
      catalogIdentity: 1, teammateBuffGroupsIdentity: 2, buildRecommendationsIdentity: 3,
      teammateBuffsReady: true, rowFusionRules: activeRowFusionRulesSnapshot(),
      panels: [], engineScalars: [],
    })
    const keyAfter = fillCacheKey({
      state: config.$state as unknown as Record<string, unknown>,
      catalogIdentity: 1, teammateBuffGroupsIdentity: 2, buildRecommendationsIdentity: 3,
      teammateBuffsReady: true, rowFusionRules: [{ id: 'x', moveId: 'x', rowId: 'damage', multiplier: 2, enabled: true }],
      panels: [], engineScalars: [],
    })
    expect(keyAfter, '行融合规则必须进键').not.toBe(keyBefore)
  }, 300_000)

  /**
   * 用户判据③：**LRU 有上限常量，超限淘汰最旧**。
   * 直接对键/存取面做（不必起引擎——容量语义与引擎无关）：写 `FILL_CACHE_MAX + 5` 条不同的键，
   * 断言 `size` 不超上限、淘汰计数 = 5、**最旧的那 5 条真的不在了**、最新的还在；
   * 再断言「命中会把条目提到队尾」（LRU 而非 FIFO）。
   */
  it('③ LRU：容量常量 + 超限淘汰最旧 + 命中提队尾', async () => {
    const { fillCacheLookup, fillCacheStore } = await import('@/composables/resourceCalc/fillCache')
    resetFillCache()
    expect(FILL_CACHE_MAX, '容量必须是有上限的常量').toBeGreaterThan(0)
    expect(FILL_CACHE_MAX, '容量必须有界（防止 CalcRoundResult 无限堆积）').toBeLessThanOrEqual(256)
    // 塞满 + 溢出
    const overflow = 5
    for (let i = 0; i < FILL_CACHE_MAX + overflow; i++) fillCacheStore('k' + i, { marker: i } as never)
    const s = fillSnap()
    expect(s.size, 'size 不许超上限').toBe(FILL_CACHE_MAX)
    expect(s.size).toBeLessThanOrEqual(FILL_CACHE_MAX)
    expect(s.evictions, '溢出 5 条 ⇒ 淘汰 5 条').toBe(overflow)
    // 最旧的 5 条被淘汰、最新的还在
    for (let i = 0; i < overflow; i++) expect(fillCacheLookup('k' + i), 'k' + i + ' 应被淘汰').toBeUndefined()
    expect(fillCacheLookup('k' + (FILL_CACHE_MAX + overflow - 1)), '最新条目必须还在').toBeTruthy()
    // 命中提队尾：把最旧的一条读活，再塞一条新的 ⇒ 被淘汰的是「次旧」那条，不是它
    resetFillCache()
    for (let i = 0; i < FILL_CACHE_MAX; i++) fillCacheStore('k' + i, { marker: i } as never)
    expect(fillCacheLookup('k0'), 'k0 在（读完会被提到队尾）').toBeTruthy()
    fillCacheStore('kNew', { marker: -1 } as never)
    expect(fillCacheLookup('k0'), 'k0 刚命中过 ⇒ 不该被淘汰（LRU 不是 FIFO）').toBeTruthy()
    expect(fillCacheLookup('k1'), 'k1 才是现在最旧的 ⇒ 被淘汰').toBeUndefined()
    expect(fillSnap().size, 'size 仍不超上限').toBe(FILL_CACHE_MAX)
  }, 120_000)

  /**
   * 用户判据④：**数值零漂移**——命中与未命中两条路径产出**逐位相同**的 slack / 伤害 / 失衡 / 净占用。
   *
   * 做法：清空缓存跑一次（= 冷 / 未命中），不清空再跑一次（= 热 / 命中），逐字段 `toBe`。
   * 逐位比较的意义：引擎对同一输入是确定性纯函数，任何「命中路径走了不同代码」的改动都会在这里露出来。
   * 同时断言这一对确实是「1 次 miss + 1 次 hit」（否则比的是两次冷跑，判据退化）。
   */
  it('④ 零漂移：命中与未命中两条路径逐位相同（slack / 伤害 / 失衡 / 净占用）', async () => {
    const config = await setupCached(FILLED_TEAM)
    const readOf = (calc: ReturnType<typeof useResourceCalc>) => {
      const rr = calc.resourceResult.value!
      const t = buildTeamTimeSummary({
        rr, battleTime: rr.totalTime,
        invincibleTime: config.enemy.invincibleTime ?? 0,
        nameOf: (_a, slot) => '槽' + slot,
      })
      return {
        slack: t.slack,
        damage: calc.teamTotalDamage.value,
        stun: calc.stunPoolResult.value?.stunCount ?? 0,
        net: netFrontlineOccupation(rr),
        refund: t.refund ?? 0,
        overflow: rr.overflowSeconds ?? 0,
      }
    }
    // 冷：全新实例 ⇒ 未命中（key 不在缓存里）
    const s0 = fillSnap()
    const cold = readOf(useResourceCalc())
    const s1 = fillSnap()
    // 热：**另一个全新实例**读同一份状态 ⇒ 命中（与「不同渲染各建一份 computed 图」同形）
    const warm = readOf(useResourceCalc())
    const s2 = fillSnap()
    expect(
      { misses: s1.misses - s0.misses, hits: s2.hits - s1.hits },
      '必须是「冷跑一次 + 热跑一次」',
    ).toEqual({ misses: 1, hits: 1 })
    // 逐字段 toBe（Object.is）——浮点末位也必须相同
    for (const k of ['slack', 'damage', 'stun', 'net', 'refund', 'overflow'] as const) {
      expect(warm[k], k + ' 命中与未命中必须逐位相同').toBe(cold[k])
    }
    // 反空洞：这些量本身有信息量（不是一串 0 / NaN 比对了也没意义）
    expect(Number.isFinite(cold.slack)).toBe(true)
    expect(cold.damage).toBeGreaterThan(0)
    expect(cold.stun).toBeGreaterThan(0)
    expect(cold.net).toBeGreaterThan(0)
  }, 300_000)

  it('④b 关缓存 = 真求值口径：连读 3 次每次都跑，读数逐位相同', async () => {
    const { rr: rr0 } = await measure(CHEAP_TEAM)
    setCalcOutputMemoEnabled(false)
    const s0 = fillSnap()
    const runs: string[] = []
    for (let i = 0; i < 3; i++) {
      // 每次新实例（外层已旁路）⇒ Vue computed 不参与，量到的就是引擎真跑
      const calc = useResourceCalc()
      const rr = calc.resourceResult.value!
      runs.push(JSON.stringify([rr.convergence.timeBudgetIdleSeconds, rr.convergence.timeBudgetRefundedSeconds, rr.overflowSeconds ?? 0, calc.teamTotalDamage.value]))
    }
    const s = fillSnap()
    expect(s.bypass - s0.bypass, '关缓存 ⇒ 每次求值都走 bypass').toBeGreaterThanOrEqual(3)
    expect(s.baselines - s0.baselines, '关缓存 ⇒ 每次都真跑基线').toBe(3)
    expect(s.hits - s0.hits, '关缓存 ⇒ 不许命中').toBe(0)
    expect(new Set(runs).size, '三次读数必须逐位相同（缓存不影响数值）').toBe(1)
    expect(JSON.parse(runs[0]!)[0]).toBe(rr0.convergence.timeBudgetIdleSeconds)
    setCalcOutputMemoEnabled(true)
  }, 300_000)
})
