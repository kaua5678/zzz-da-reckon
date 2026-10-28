/**
 * 失衡窗口**时间轴**（期 1）的验收锁：`docs/STUN_TIMELINE_PROJECT.md` §3 期 1。
 *
 * ## 本期主张（三条，全部可机检）
 * 1. **恒等式**（零容差）：`Σ slots[].effectiveSeconds + outsideSeconds === effectiveTime`，
 *    且逐窗无缝隙、无重叠（`slots[i].startSeconds === slots[i-1].startSeconds + slots[i-1].effectiveSeconds`）。
 * 2. **与既有聚合口径同源**：无决算截断的队上 `windowSeconds / effectiveTime` **逐位等于**
 *    `calc.stunCoverage`（引擎的 `stunWindowFraction`）——证明时间轴不是第三本账。
 * 3. **末窗残疾如实上报**：窗口放不进剩余战斗时间时 `clippedByClock` 为真且 `effectiveSeconds` 被截短，
 *    **不抹平**（用户口径 2026-10-20「最后一窗口时间残疾」）。
 *
 * ## 覆盖（项目文档指定的验收面）
 * 6 支般岳预设（`banyue-*`）+ 佩洛伊斯决算队（1551 + 1011 + 1191，轴内一块 `1551016` 决算）。
 * 般岳队里 `banyue-qingyi-lucia` 是**非轴队**（轴退化）⇒ 顺带覆盖 `hasTrace === false` 的路径。
 *
 * ## 反空洞
 * 只断言恒等式会「对空集也成立」（0 窗口 ⇒ 0 + 180 = 180 照样绿）。故同时钉：
 * ① 至少 5 支队有非零窗口（`windows > 0`）；② 至少 4 支队拿到轴栈轨迹（`hasTrace`）；
 * ③ 佩洛伊斯队的每窗都必须 `truncated`（决算块按块延长 +3s 且当场结束窗口）——
 *    这正是 `docs/STUN_WINDOW_DURATION.md` §7 的机制在时间轴上的显影。
 *
 * ## 已知差异（**有意留白，别在这里改成相等**）
 * 佩洛伊斯队的 `windowSeconds / effTime`（0.03806）**不等于** `calc.stunCoverage`（0.04463）：
 * 聚合口径按**计划窗数**扣决算损失（2.3909 × 16.7164），时间轴按**物理逐窗**（3 × 2.2836）。
 * 两者差的 1.18s 是「计划值 vs 物理逐窗」的量纲错配，属 `docs/STUN_TIMELINE_PROJECT.md` 期 3。
 * 本条**不**把它写成相等，也不把它写成固定差值（那会把期 3 的修法锁死）。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useConfigStore } from '@/stores/config'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { effectiveBattleTime } from '@/core/effectiveTime'
import { buildStunTimeline, realizeStunWindows, type StunTimeline, type StunWindowTrace } from '@/core/stunTimeline'
import { teamPresets } from '@/data/teamPresets'

/** 项目文档点名的 6 支般岳队（预设 id 漂移时本表随之更新，别静默跳过） */
const BANYUE_PRESETS = [
  'banyue-jufufu-lucia',
  'banyue-liuyin-lucia',
  'banyue-norma-lucia',
  'banyue-qingyi-lucia',
  'banyue-roxy-lucia',
  'banyue-trigger-lucia',
] as const

interface TimelineProbe {
  id: string
  timeline: StunTimeline
  /** 引擎的失衡窗口占比（`stunWindowFraction` 口径，含决算截断损失） */
  engineCoverage: number
  effectiveTime: number
  windowDuration: number
  /** 池的整数次数（= 轴栈排窗依据） */
  poolStunCount: number
  axisActive: boolean
}

/** 用预设真实跑一遍全管线，再按池次数 + 轴栈逐窗轨迹搭时间轴 */
async function probePreset(id: string): Promise<TimelineProbe> {
  const preset = teamPresets.find(p => p.id === id)
  expect(preset, `预设 ${id} 不存在（id 漂移？）`).toBeTruthy()
  const { catalog } = await setupHarness(['', '', ''])
  await catalog.loadBuildRecommendations()
  const config = useConfigStore()
  for (let i = 0; i < 3; i++) config.setAgent(i, preset!.team[i])
  config.applyTeamPreset(preset!.team as [string, string, string])
  const calc = useResourceCalc()
  const pool = calc.stunPoolResult.value
  expect(pool, `${id} 无失衡池结果`).toBeTruthy()
  const stack = calc.stackTraversalResult.value
  const effectiveTime = effectiveBattleTime(config.enemy)
  const windowDuration = calc.windowDuration.value
  // 生产出口（`useResourceCalc#stunTimeline`）= 直接调模块 ⇒ 逐位相同（接线没走偏）
  expect(calc.stunTimeline.value, `${id}：composable 出口与模块直调不一致（接线走偏）`).toEqual(buildStunTimeline({
    stunCount: pool!.stunCount,
    windowDuration,
    effectiveTime,
    windows: stack?.windowTrace,
  }))
  return {
    id,
    timeline: calc.stunTimeline.value,
    engineCoverage: calc.stunCoverage.value,
    effectiveTime,
    windowDuration,
    poolStunCount: pool!.stunCount,
    axisActive: stack != null,
  }
}

/**
 * 显式「关掉轴」的探针（2026-10-21 round 29）。
 *
 * 覆盖 `hasTrace === false` 分支：非轴模式下 `stackTraversalResult` 为 null ⇒
 * `buildStunTimeline` 拿不到 `windowTrace` ⇒ `actions` 恒空、`unusedSeconds` 记 0。
 * 原写法指望「般岳队里有一支被弃轴」，弃轴改「轴态降配」后不再成立 ⇒ 显式构造。
 */
async function probePresetWithAxisOff(id: string): Promise<TimelineProbe> {
  const preset = teamPresets.find(p => p.id === id)
  expect(preset, `预设 ${id} 不存在`).toBeTruthy()
  const { catalog } = await setupHarness(['', '', ''])
  await catalog.loadBuildRecommendations()
  const config = useConfigStore()
  for (let i = 0; i < 3; i++) config.setAgent(i, preset!.team[i])
  config.applyTeamPreset(preset!.team as [string, string, string])
  // 关自动轴 + 清空手捏轴 ⇒ resolvedAxes 为空 ⇒ 非轴模式
  config.autoYidhariAxis = false
  config.stunAxisPlans.splice(0)
  config.stunAxes = []
  const calc = useResourceCalc()
  const pool = calc.stunPoolResult.value
  expect(pool, `${id} 无失衡池结果`).toBeTruthy()
  const stack = calc.stackTraversalResult.value
  const effectiveTime = effectiveBattleTime(config.enemy)
  const windowDuration = calc.windowDuration.value
  return {
    id: `${id}(axis-off)`,
    timeline: calc.stunTimeline.value,
    engineCoverage: calc.stunCoverage.value,
    effectiveTime,
    windowDuration,
    poolStunCount: pool!.stunCount,
    axisActive: stack != null,
  }
}

/** 佩洛伊斯决算队：轴内只放一块右分支决算（`1551016`，`endsStunWindow` + 按块延长 3s） */
async function probePeiluoVerdict(): Promise<TimelineProbe> {
  const { config } = await setupHarness(
    [{ agentId: '1551' }, { agentId: '1011' }, { agentId: '1191' }],
    { recommendedBuild: true },
  )
  config.autoYidhariAxis = false
  config.stunAxisPlans.splice(0)
  config.stunAxes.splice(0)
  config.useStunAxis = false
  config.setCinemaLevel(0, 0)
  config.stunAxes.push({ name: '轴1', actions: [{ slot: 0, moveId: '1551016', count: 1, startTime: 0 }] } as never)
  config.useStunAxis = true
  const calc = useResourceCalc()
  const pool = calc.stunPoolResult.value
  expect(pool, '佩洛伊斯队无失衡池结果').toBeTruthy()
  const stack = calc.stackTraversalResult.value
  expect(stack, '佩洛伊斯队必须进轴（否则本用例失去决算块）').toBeTruthy()
  const effectiveTime = effectiveBattleTime(config.enemy)
  const windowDuration = calc.windowDuration.value
  return {
    id: 'peiluo-verdict',
    timeline: calc.stunTimeline.value,
    engineCoverage: calc.stunCoverage.value,
    effectiveTime,
    windowDuration,
    poolStunCount: pool!.stunCount,
    axisActive: true,
  }
}

/** 恒等式 + 无缝隙无重叠（零容差；浮点下 `a + (T − a) === T` 恒成立，故不需要容差） */
function expectIdentity(p: TimelineProbe): void {
  const { timeline: tl } = p
  const sum = tl.slots.reduce((s, x) => s + x.effectiveSeconds, 0)
  expect(sum + tl.outsideSeconds, `${p.id}：Σ 有效秒 + 窗外 ≠ 有效战斗时间`).toBe(p.effectiveTime)
  expect(tl.windowSeconds, `${p.id}：windowSeconds 与 Σ 有效秒不同源`).toBe(sum)
  expect(tl.outsideSeconds, `${p.id}：窗外时间出现负值`).toBeGreaterThanOrEqual(0)
  expect(tl.windows, `${p.id}：窗口数 ≠ floor(池次数)`).toBe(Math.floor(p.poolStunCount))
  for (let i = 1; i < tl.slots.length; i++) {
    expect(tl.slots[i].startSeconds, `${p.id}：第 ${i} 窗起点与前一窗结束不接续（缝隙/重叠）`)
      .toBe(tl.slots[i - 1].startSeconds + tl.slots[i - 1].effectiveSeconds)
  }
  for (const s of tl.slots) {
    expect(s.effectiveSeconds, `${p.id}：第 ${s.index} 窗有效秒为负`).toBeGreaterThanOrEqual(0)
    expect(s.startSeconds + s.effectiveSeconds, `${p.id}：第 ${s.index} 窗越过战斗时钟`)
      .toBeLessThanOrEqual(p.effectiveTime)
  }
}

describe('失衡窗口时间轴（期 1：数据结构 + 恒等式，零 delta）', () => {
  it('6 支般岳队：恒等式零容差 + 与聚合口径同源 + 末窗残疾如实上报', async () => {
    const probes: TimelineProbe[] = []
    for (const id of BANYUE_PRESETS) probes.push(await probePreset(id))

    for (const p of probes) {
      expectIdentity(p)
      // 无决算截断的队：时间轴与引擎覆盖率**逐位相同**（同一个量、同一个窗长、同一个预算）
      const truncatedAny = p.timeline.slots.some(s => s.truncated)
      if (!truncatedAny) {
        expect(p.timeline.windowSeconds / p.effectiveTime, `${p.id}：时间轴占比 ≠ 引擎 stunCoverage（第三本账）`)
          .toBeCloseTo(p.engineCoverage, 12)
      }
      // 每窗名义秒数 = 引擎窗长（单一来源：stunWindowDuration）
      for (const s of p.timeline.slots) expect(s.nominalSeconds, `${p.id}：窗长与引擎不同源`).toBe(p.windowDuration)
    }

    // 反空洞：窗口数与轴栈轨迹都必须真的非空，否则「恒等式成立」是空绿
    expect(probes.filter(p => p.timeline.windows > 0).length, '至少 5 支队应有非零窗口').toBeGreaterThanOrEqual(5)
    expect(probes.filter(p => p.timeline.hasTrace).length, '至少 4 支队应拿到轴栈逐窗轨迹').toBeGreaterThanOrEqual(4)
    /**
     * 非轴队也必须排出窗口：比例近似路径照样要能回答「几窗、每窗多长」。
     *
     * ⚠ **2026-10-21 round 29：改成显式构造非轴场景**（原写法靠「般岳队里有一支被弃轴」）。
     * 弃轴改「轴态降配」后，般岳 6 队全部保住轴 ⇒ `nonAxis` 自然为空 ⇒ 原断言红。
     * 但**这条覆盖仍然必要**（`hasTrace === false` 是真实分支：非轴模式 / 无轴预设的队）。
     * ⇒ 显式造一个「关掉轴」的探针，而不是指望某支队恰好被弃轴。
     */
    const nonAxisProbe = await probePresetWithAxisOff('banyue-qingyi-lucia')
    const nonAxis = [...probes.filter(p => !p.axisActive), nonAxisProbe]
    expect(nonAxis.length, '必须至少有一个非轴场景（显式构造，覆盖 hasTrace=false 路径）').toBeGreaterThanOrEqual(1)
    for (const p of nonAxis) {
      expect(p.timeline.hasTrace, `${p.id}：非轴队不应有轴栈轨迹`).toBe(false)
      for (const s of p.timeline.slots) {
        expect(s.actions, `${p.id}：非轴队窗内动作必须为空`).toEqual([])
        expect(s.unusedSeconds, `${p.id}：非轴队窗内剩余不可推演，记 0`).toBe(0)
      }
    }
  }, 900_000)

  it('佩洛伊斯决算队：每窗都被决算提前结束 + 按块延长 3s + 窗内动作来自轴栈', async () => {
    const p = await probePeiluoVerdict()
    const tl = p.timeline
    expectIdentity(p)

    // 2026-10-28 逐招口径：残差分摊通道删除 ⇒ 非轴行失衡不再被窗占比扣 ⇒ 池 3→4（与新物理同源）。
    expect(tl.windows, '决算队应有 4 个失衡窗口（池次数）').toBe(4)
    expect(tl.hasTrace, '决算队必须有轴栈逐窗轨迹').toBe(true)
    for (const s of tl.slots) {
      expect(s.truncated, `第 ${s.index} 窗必须被决算结束（endsStunWindow）`).toBe(true)
      expect(s.extendedSeconds, '佩洛伊斯决算按块延长 3s（stunWindowExtendOnEnd）').toBe(3)
      // 决算块施放在窗口起点 ⇒ 窗口有效时长 = 决算块时长（截断时刻）
      expect(s.effectiveSeconds, `第 ${s.index} 窗有效秒 = 决算块结束时刻`).toBeLessThanOrEqual(s.nominalSeconds)
      expect(s.actions.length, `第 ${s.index} 窗应记到决算块`).toBeGreaterThanOrEqual(1)
      expect(s.actions.every(a => a.moveId === '1551016'), '窗内动作只有决算块').toBe(true)
      expect(s.unusedSeconds, '决算截断窗没有可填充的富余（栈引擎同口径）').toBe(0)
    }
    // 时间轴口径 vs 聚合口径：**有意不等**（计划窗数 vs 物理逐窗，期 3 的量纲错配）
    const timelineCoverage = tl.windowSeconds / p.effectiveTime
    expect(timelineCoverage, '时间轴按物理逐窗：3 窗 × 决算截断时刻').toBeLessThan(p.engineCoverage)
  }, 900_000)
})

describe('buildStunTimeline 纯函数（边界与残疾口径）', () => {
  /** 构造一条逐窗轨迹（只填时间轴关心的字段） */
  const trace = (i: number, over: Partial<StunWindowTrace> = {}): StunWindowTrace => ({
    index: i,
    axisIndex: 0,
    fillerDefaulted: false,
    fillSegments: [],
    idleSegments: [],
    nominalSeconds: 16,
    extendSeconds: 0,
    endSeconds: 16,
    truncated: false,
    actions: [],
    actionSeconds: 0,
    overlapSeconds: 0,
    fillSeconds: 0,
    ...over,
  })

  it('窗口放不进剩余战斗时间 ⇒ 末窗被时钟截短并标记（不抹平）', () => {
    // 4 窗 × 16s = 64s，战斗时间只有 50s ⇒ 前三窗整窗、末窗只剩 2s
    const tl = buildStunTimeline({ stunCount: 4, windowDuration: 16, effectiveTime: 50 })
    expect(tl.slots.map(s => s.effectiveSeconds)).toEqual([16, 16, 16, 2])
    expect(tl.slots.map(s => s.clippedByClock)).toEqual([false, false, false, true])
    expect(tl.outsideSeconds).toBe(0)
    expect(tl.windowSeconds + tl.outsideSeconds).toBe(50)
  })

  it('窗口数按 floor(计划值)：小数不产生窗口（与轴栈 for (i < wins) 同口径）', () => {
    const tl = buildStunTimeline({ stunCount: 2.9, windowDuration: 16, effectiveTime: 180 })
    expect(tl.windows).toBe(2)
    expect(tl.plannedWindows, '计划实数如实上报（期 3 才消费）').toBeCloseTo(2.9, 12)
    expect(tl.outsideSeconds).toBe(180 - 32)
  })

  it('决算截断 + 按块延长：有效时长取「延长后窗长」与「截断时刻」的较小者', () => {
    const tl = buildStunTimeline({
      stunCount: 1,
      windowDuration: 16,
      effectiveTime: 180,
      windows: [trace(0, { extendSeconds: 3, truncated: true, endSeconds: 2.2836, actionSeconds: 2.2836 })],
    })
    expect(tl.slots[0].extendedSeconds).toBe(3)
    expect(tl.slots[0].truncated).toBe(true)
    expect(tl.slots[0].effectiveSeconds).toBeCloseTo(2.2836, 12)
    // 决算块占满整窗 ⇒ 无剩余（不填平A 的口径）
    expect(tl.slots[0].unusedSeconds).toBe(0)
  })

  it('窗内剩余 = 有效秒 − (毛占用 − 合轴 + 平A填充)：合轴省下的时间算「剩余」', () => {
    const tl = buildStunTimeline({
      stunCount: 2,
      windowDuration: 16,
      effectiveTime: 180,
      windows: [
        trace(0, { actionSeconds: 16, overlapSeconds: 4, fillSeconds: 0 }),  // 16 − 4 = 12 占用 ⇒ 剩 4
        trace(1, { actionSeconds: 6, overlapSeconds: 0, fillSeconds: 10 }),  // 6 + 10 = 16 占用 ⇒ 剩 0
      ],
    })
    expect(tl.slots[0].unusedSeconds).toBeCloseTo(4, 12)
    expect(tl.slots[1].unusedSeconds).toBe(0)
  })

  it('无轨迹 / 轨迹比窗口数短：不抛错、不编造内容（actions 空、unused 记 0）', () => {
    const noTrace = buildStunTimeline({ stunCount: 3, windowDuration: 16, effectiveTime: 180 })
    expect(noTrace.hasTrace).toBe(false)
    expect(noTrace.slots.every(s => s.actions.length === 0 && s.unusedSeconds === 0)).toBe(true)
    // 轨迹只有 1 条而窗口有 3 个 ⇒ 缺的两窗按无轨迹处理，恒等式仍成立
    const shortTrace = buildStunTimeline({ stunCount: 3, windowDuration: 16, effectiveTime: 180, windows: [trace(0, { actionSeconds: 16 })] })
    expect(shortTrace.hasTrace).toBe(true)
    expect(shortTrace.slots[0].unusedSeconds).toBe(0)
    expect(shortTrace.slots[1].actions).toEqual([])
    expect(shortTrace.windowSeconds + shortTrace.outsideSeconds).toBe(180)
  })

  it('退化输入（0 窗 / 0 时长 / 非有限值）不产出负时间、不产生 NaN', () => {
    for (const bad of [
      { stunCount: 0, windowDuration: 16, effectiveTime: 180 },
      { stunCount: 4, windowDuration: 0, effectiveTime: 180 },
      { stunCount: 4, windowDuration: 16, effectiveTime: 0 },
      { stunCount: Number.NaN, windowDuration: 16, effectiveTime: 180 },
      { stunCount: 4, windowDuration: Number.POSITIVE_INFINITY, effectiveTime: 180 },
      { stunCount: 4, windowDuration: 16, effectiveTime: -5 },
    ]) {
      const tl = buildStunTimeline(bad)
      expect(Number.isFinite(tl.windowSeconds), JSON.stringify(bad)).toBe(true)
      expect(Number.isFinite(tl.outsideSeconds), JSON.stringify(bad)).toBe(true)
      expect(tl.outsideSeconds).toBeGreaterThanOrEqual(0)
      for (const s of tl.slots) {
        expect(Number.isFinite(s.startSeconds) && Number.isFinite(s.effectiveSeconds), JSON.stringify(bad)).toBe(true)
        expect(s.effectiveSeconds).toBeGreaterThanOrEqual(0)
      }
      expect(tl.windowSeconds + tl.outsideSeconds).toBe(Math.max(0, Number.isFinite(bad.effectiveTime) ? bad.effectiveTime : 0))
    }
  })
})

/**
 * **已兑现窗口读数**（`realizeStunWindows`）——用户口径 2026-10-26（逐字）：
 * > 「平a兜底也得从全局预算里面拿……可以把平a兜底改为你说的换个角色打平a，
 * >  再没有就空着，**写明发呆时间**。」
 *
 * 本条钉三件事：
 * ① **计划 K 窗与兑现 X 窗必须同时可读**（只报兑现数会被读成「队伍只打了 X 窗」）；
 * ② 非轴队 `hasTrace=false` 时**不编造**（兑现退化为整数窗、发呆记 0，而不是假装打满）；
 * ③ 填充率按**本窗有效时长**归一（决算截断/时钟截短的窗天生更短，按名义窗长摊会低估兑现）。
 */
describe('realizeStunWindows（计划 K 窗 / 兑现 X 窗 / 窗内发呆 Y 秒）', () => {
  const trace = (i: number, over: Partial<StunWindowTrace> = {}): StunWindowTrace => ({
    index: i, axisIndex: 0, fillerDefaulted: false, fillSegments: [],
    idleSegments: [],
    nominalSeconds: 16, extendSeconds: 0, endSeconds: 16,
    truncated: false, actions: [], actionSeconds: 0, overlapSeconds: 0, fillSeconds: 0, ...over,
  })

  it('★ 计划窗数与兑现窗数并列上报（不是只报兑现）', () => {
    const tl = buildStunTimeline({
      stunCount: 5, windowDuration: 16, effectiveTime: 180,
      windows: [trace(0, { actionSeconds: 16 }), trace(1, { actionSeconds: 16 }), trace(2, { actionSeconds: 8, fillSeconds: 0 })],
    })
    const r = realizeStunWindows(tl)
    expect(r.plannedWindows, '计划 K 窗 = 池的整数次数').toBe(5)
    // 窗0/窗1 打满 = 2；窗2 只打了 8/16 = 0.5；窗3/窗4 轨迹缺失 ⇒ `unusedSeconds` 记 0
    // ⇒ 按既有口径（「无轨迹不编造」= 不当成空转）计为已填 ⇒ 合计 4.5。
    // ⚠ 这条口径意味着「轨迹比窗口数短」时兑现会被**高估**——真发生要靠上层保证轨迹条数 = 窗口数
    //   （`buildStunTimeline` 只对 `hasTrace=false` 整体降级，不做逐窗补齐）。本断言把它钉成已知行为，
    //   不是背书：若将来改成逐窗标记不可推演，这条会红并提醒同步下游展示。
    expect(r.realizedWindows).toBeCloseTo(4.5, 10)
    expect(r.plannedWindows).toBe(5)
  })

  it('★ 发呆秒数如实上报（窗口开着、没人打）——末窗的余量改记「归零」', () => {
    const tl = buildStunTimeline({
      stunCount: 2, windowDuration: 16, effectiveTime: 180,
      windows: [trace(0, { actionSeconds: 10 }), trace(1, { actionSeconds: 4 })],
    })
    const r = realizeStunWindows(tl)
    /**
     * 用户口径 2026-10-27：「决算本来就是直接把剩余时间归零的机制，连续失衡类似，
     * 因为游戏结束相当于你后面都无意义了，计算量只有前半部分。」
     * ⇒ 窗0（中间窗）空 6s 仍是**发呆**；窗1（末窗）空 12s 是**归零**（之后无事发生），单独报。
     */
    expect(r.idleSeconds, '只有中间窗算发呆').toBeCloseTo(6, 6)
    expect(r.zeroedSeconds, '末窗 16−4 = 12s 归零').toBeCloseTo(12, 6)
    expect(r.occupiedSeconds).toBeCloseTo(14, 6)
    // 兑现窗数不受归零影响（仍是按填充率算的等效窗数）
    expect(r.realizedWindows).toBeCloseTo(10 / 16 + 4 / 16, 6)
  })

  it('非轴队（hasTrace=false）不编造：兑现退化为整数窗、发呆记 0、计划数照报', () => {
    const tl = buildStunTimeline({ stunCount: 3, windowDuration: 16, effectiveTime: 180 })
    const r = realizeStunWindows(tl)
    expect(r.hasTrace).toBe(false)
    expect(r.plannedWindows).toBe(3)
    expect(r.realizedWindows).toBe(3)
    expect(r.idleSeconds).toBe(0)
  })

  it('★ 末窗按**时间截断**折算窗数（配可视化：画面短一截 ⇒ 数值也只值那几秒）', () => {
    // 12 × 16s = 192s > 180s ⇒ 末窗只剩 4s（画面上面那根短条就是这个）
    const windows = Array.from({ length: 12 }, (_, i) => trace(i, { actionSeconds: 16 }))
    const tl = buildStunTimeline({ stunCount: 12, windowDuration: 16, effectiveTime: 180, windows })
    expect(tl.slots[11].clippedByClock).toBe(true)
    expect(tl.slots[11].effectiveSeconds).toBeCloseTo(4, 6)
    // 有轨迹：11 窗打满 + 末窗 4/16
    expect(realizeStunWindows(tl).realizedWindows).toBeCloseTo(11 + 4 / 16, 6)
    // 无轨迹：不编造填充（每窗按 1），但时钟截短照样折算
    const noTrace = buildStunTimeline({ stunCount: 12, windowDuration: 16, effectiveTime: 180 })
    expect(realizeStunWindows(noTrace).realizedWindows).toBeCloseTo(11 + 4 / 16, 6)
  })

  it('决算截断窗按**有效时长**归一（不按名义窗长摊 ⇒ 不低估兑现）', () => {
    // 窗 0 被决算截断成 8s 且打满 8s ⇒ 填充率 1.0（按名义 16s 摊会得 0.5）
    const tl = buildStunTimeline({
      stunCount: 1, windowDuration: 16, effectiveTime: 180,
      windows: [trace(0, { truncated: true, endSeconds: 8, actionSeconds: 8 })],
    })
    const r = realizeStunWindows(tl)
    expect(r.realizedWindows).toBeCloseTo(1, 10)
    expect(r.idleSeconds).toBeCloseTo(0, 10)
  })
})
