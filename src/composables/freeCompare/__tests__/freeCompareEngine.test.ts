/**
 * 自由对比工作台 · 求值器集成测试（真引擎，独立场景 + 装配正确性；r372 前是快照/恢复）
 *
 * 为什么需要这一层：纯函数测试（`freeCompare.test.ts`）证明不了「装配到 store 上的状态是对的」。
 * 而本工作台最危险的失败模式恰恰是**静默装错**——
 *   ① 无专武（wengine=0）没显式覆盖 ⇒ `setAgent` 自动给角色穿上专武（`config.ts:594-599`），
 *      得到「嘴上无专武、身上穿专武」的偏高数值，零报错；
 *   ② 忘了隔离 ⇒ 污染用户当前的队伍/Boss 配置（跑完对比发现自己队被换了；r372 起求值跑在独立
 *      场景上，这条失败模式从结构上不再可能，用例相应改成「调用方 store 全程逐字不变」）。
 * 这两条都是**读代码看不出来、只有跑真引擎并对账才抓得到**的，所以必须各有一条会红的断言。
 *
 * 判据（AGENTS 规则 9）：每条断言针对一个真实失败模式，不是复读实现。
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mockStaticFetch, setupHarness } from '@/test/harness'
import { useConfigStore, type ConfigModel } from '@/stores/config'
import { useCatalogStore } from '@/stores/catalog'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { withAnalysisScenario } from '@/composables/analysisScenario'
import { computeFreeCompare, downgradeCandidates, signatureWEngineId } from '@/composables/freeCompare/engine'
import { parseSetupCode, type SeriesSpec } from '@/composables/freeCompare/axes'

/**
 * 用户原话里的三个实体（规则 15：已跑 `node scripts/resolve.mjs 角色 <名>` 查证，非名字联想）：
 * 维琳娜 = 1561（异常·风）· 柏妮思 = 1171（异常·火）· 「菲欧尼」= 菲欧妮 = 1641（异常·火）
 */
const VELINA = '1561'
const BURNICE = '1171'
const PHOENIX = '1641'

const code = (s: string) => parseSetupCode(s)!

describe('自由对比求值器（真引擎）', () => {
  beforeAll(async () => {
    setActivePinia(createPinia())
    mockStaticFetch()
    const catalog = useCatalogStore()
    await catalog.load()
    await catalog.loadTeammateBuffs()
    await catalog.loadBuildRecommendations()
  })

  it('★ 期数轴真的换期，且血量比按「该期」血量算（CC-189：此前期数覆盖从不被读、env.hp 在装配前就读死）', async () => {
    const res = await fetch('/static/boss-presets.json')
    const boss = (await res.json()).bosses.find((b: { id: string }) => b.id === '30007') // 恶名·死路屠夫：各期血量不同
    expect(boss, 'boss-presets 里应有 30007').toBeTruthy()
    const [p1, p2] = boss.phases as Array<{ phaseId: string; label: string; hp: number }>
    expect(Math.round(p1.hp), '选两期血量不同的，否则本条测不出东西').not.toBe(Math.round(p2.hp))
    const run = (metricId: string) => withAnalysisScenario(scenario => computeFreeCompare(scenario, {
      series: [{ id: 'a', kind: 'agent', members: [BURNICE], code: code('01') }],
      axisId: 'period',
      axisOptions: { periods: [p1, p2].map(p => ({ id: p.phaseId, label: p.label })) },
      metricId,
      constraints: { boss, baseTeammates: [VELINA, ''] },
    }))
    const dmg = (await run('teamTotalDamage')).series[0].values
    const ratio = (await run('dmgBossHpRatio')).series[0].values
    expect(dmg.every(v => typeof v === 'number' && v > 0)).toBe(true)
    // 血量比 × 该期血量 = 总伤：两期各自成立 ⇒ 装配确实换到了该期，且 env 是装配后读的
    expect(ratio[0]! * Math.round(p1.hp)).toBeCloseTo(dmg[0]!, -2)
    expect(ratio[1]! * Math.round(p2.hp)).toBeCloseTo(dmg[1]!, -2)
  })

  it('★ 调用方 store 全程不被改写（r372：求值只在独立场景里发生，不再依赖「跑完还原」）', async () => {
    const config = useConfigStore()
    // 先给一个「用户自己的配置」当现场
    await setupHarness([{ agentId: BURNICE }, { agentId: VELINA }, ''], { recommendedBuild: true })
    const snap = (c: typeof config) => JSON.stringify({
      team: c.team.map(x => ({ id: x.agentId, cine: x.cinemaLevel, mod: x.wEngineModLevel, w: x.wEngineId })),
      hp: c.enemy.hp,
    })
    const before = snap(config)
    let midRunChecks = 0
    let midRunDiffs = 0
    const { run } = makeRunner()
    await run(
      [
        { id: 'a', kind: 'agent', members: [BURNICE], code: code('01') },
        { id: 'b', kind: 'agent', members: [PHOENIX], code: code('21') },
      ],
      'cinema',
      { cinemaMax: 1 },
      { baseTeammates: [VELINA, ''] },
      () => {
        midRunChecks++
        if (snap(config) !== before) midRunDiffs++
      },
    )
    expect(midRunChecks, 'onProgress 至少该触发一次，否则本条没测到东西').toBeGreaterThan(0)
    expect(midRunDiffs, '求值中途 UI store 也不该被改写').toBe(0)
    expect(snap(config), '跑完对比后现场必须与开跑前逐字段相同').toBe(before)
  })

  it('★ 无专武（20）= 穿下位音擎，**不是裸奔**（用户口径 2026-09-15：「用了下位武器，比如 a 级武器」）', async () => {
    const catalog = useCatalogStore()
    const sig = signatureWEngineId(catalog, BURNICE)
    expect(sig, '柏妮思(1171) 应当有专武可查（灼心摇壶 14117）').toBeTruthy()

    // 装配 20（无专武）：求值中途抓 store 状态
    const noSig = await captureSlot0({ id: 's', kind: 'agent', members: [BURNICE], code: code('20') })
    expect(noSig.wEngineId, 'wengine=0 时不该还穿着专武').not.toBe(sig)
    expect(noSig.wEngineId, '★ 也不该是空音擎——裸奔实测比专武本体低 34~41%，那是「没带武器」不是「没抽专武」').not.toBe('')
    // 穿上的必须是「同职业、非专属、非限定」的下位件
    const worn = catalog.getWEngine(noSig.wEngineId)
    expect(worn, `穿上的 ${noSig.wEngineId} 应当能在 catalog 里查到`).toBeTruthy()
    expect(worn!.ownerAgentId, '下位不能是别人的专武').toBeFalsy()
    expect(worn!.specialty).toBe(catalog.getAgent(BURNICE)!.specialty)
    // A 级默认精炼 5（与 computeAutoEnginePicks 的 mods 口径一致）
    expect(noSig.modLevel).toBe(5)

    // 对照：装配 21（有专武本体）应当穿上专武且精炼 1
    const withSig = await captureSlot0({ id: 's', kind: 'agent', members: [BURNICE], code: code('21') })
    expect(withSig.wEngineId).toBe(sig)
    expect(withSig.modLevel).toBe(1)
  })

  it('★★ 无专武档挑的是**伤害最高**的下位，不是 id 顺序第一把（实测三把差 3~8pp）', async () => {
    const catalog = useCatalogStore()
    const calc = useResourceCalc()
    const config = useConfigStore()
    const worn = await captureSlot0({ id: 's', kind: 'agent', members: [BURNICE], code: code('20') })

    // 穷举该角色的全部下位候选，确认工作台挑中的那把确实是最高伤害
    const pool = downgradeCandidates(catalog, BURNICE)
    expect(pool.length, '柏妮思是异常职业，下位池应当有 3 把 A 级').toBeGreaterThan(1)

    const team: [string, string, string] = [BURNICE, VELINA, '']
    config.applyTeamPreset(team)
    config.setCinemaLevel(0, 2) // 20 = 2 命
    let bestId = ''
    let bestDmg = -Infinity
    for (const c of pool) {
      config.setWEngine(0, c.id)
      config.setWEngineModLevel(0, c.mod)
      const d = calc.teamTotalDamage.value
      if (Number.isFinite(d) && d > bestDmg) { bestDmg = d; bestId = c.id }
    }
    expect(worn.wEngineId, `工作台穿的是 ${worn.wEngineId}，但实测最高的是 ${bestId}`).toBe(bestId)
  })

  it('★ 命座维度：同一系列 0 命 → 1 命，伤害不应下降（命座是纯增益的健全性检查）', async () => {
    const { runAxis } = makeRunner()
    const res = await runAxis(
      { id: 's', kind: 'agent', members: [BURNICE], code: code('01') },
      'cinema',
      { cinemaMax: 1 },
    )
    expect(res.levels.map(l => l.label)).toEqual(['0命', '1命'])
    const [d0, d1] = res.series[0].values
    expect(d0).not.toBeNull()
    expect(d1).not.toBeNull()
    expect(d1!, '1 命伤害不应低于 0 命').toBeGreaterThanOrEqual(d0!)
  })

  it('两个系列（柏妮思 vs 菲欧妮）各自出一条曲线，互不为 null', async () => {
    const { runAxis } = makeRunner()
    const res = await runAxis(null, 'setupCode', {})
    expect(res.series).toHaveLength(2)
    for (const s of res.series) {
      expect(s.values.every(v => v !== null)).toBe(true)
    }
    // 两条曲线各属一个角色（用户原话「柏妮思21对比菲欧妮21」）
    const labels = res.series.map(s => s.label)
    expect(labels.some(l => l.includes('柏妮思'))).toBe(true)
    expect(labels.some(l => l.includes('菲欧妮'))).toBe(true)
    expect(res.metricId).toBe('teamTotalDamage')
  })

  it('★ 现场内的「维琳娜条件」真的被套上（用户原话「维琳娜0命1命2命的情况下」）', async () => {
    const seen = await captureSlot1(
      { id: 's', kind: 'agent', members: [BURNICE], code: code('01') },
      { baseTeammates: [VELINA, ''], conditions: [{ agentId: VELINA, cinema: 2 }] },
    )
    // 维琳娜在 1 号槽（基底队友第一位），条件要把它锁到 2 命
    expect(seen.agentId).toBe(VELINA)
    expect(seen.cinemaLevel, '条件里的 2 命必须真的套上（防「约束没进装配」的静默失效）').toBe(2)
  })

  it('★ 空槽清理（CC-338）：默认轻量速算（autoBuild=false）下 2 人队不会残留页面原有 3 号槽角色', async () => {
    const config = useConfigStore()
    const { run } = makeRunner()
    // 模拟用户页面原本 3 号槽有角色（菲欧妮 C2）
    config.setAgent(2, PHOENIX)
    config.setCinemaLevel(2, 2)
    let seenSlot2Agent = 'UNSET'
    await run(
      [{ id: 's', kind: 'agent', members: [BURNICE], code: code('01') }],
      'cinema',
      { cinemaMax: 0 },
      { baseTeammates: [VELINA, ''] },
      c => { seenSlot2Agent = c.team[2].agentId },
    )
    expect(seenSlot2Agent, '求值期间 2 号空槽必须被清空，不能带着页面残留角色算').toBe('')
    // r372：求值只在独立场景里发生 ⇒ UI store 的 3 号槽全程是用户原来的菲欧妮（不再依赖 finally 恢复）
    expect(config.team[2].agentId).toBe(PHOENIX)
    expect(config.team[2].cinemaLevel).toBe(2)
  })

  // ---------- 当期 buff 三态（2026-10-02 用户裁决：可以带也可以不带；本体 vs 吃拐并排呈现）----------

  /** 测试夹具：30007 恶名·死路屠夫最新期（690441，3 张非测试服牌：摧心/冰袭/异变） */
  async function bossWithBuffs() {
    const data = await (await fetch('/static/boss-presets.json')).json()
    const boss = data.bosses.find((b: { id: string }) => b.id === '30007')
    const phase = boss.phases[0] // 最新期
    const view = (data.phaseViews ?? []).find((v: { phaseId: string }) => v.phaseId === phase.phaseId)
    const buffs = (view?.buffs ?? []).filter((b: { testOnly: boolean; effects: unknown[] }) => !b.testOnly && b.effects.length > 0)
    expect(buffs.length, '夹具前提：30007 最新期应有 ≥2 张可用 buff 牌').toBeGreaterThanOrEqual(2)
    return { boss, buffs }
  }

  it('★ buffChoice=\'all\'（全状态对比）：每个主系列拆 本体+每张牌 各一条系列，互不混合', async () => {
    const { boss, buffs } = await bossWithBuffs()
    const res = await withAnalysisScenario(scenario => computeFreeCompare(scenario, {
      series: [{ id: 'a', kind: 'agent', members: [BURNICE], code: code('21') }],
      axisId: 'cinema',
      axisOptions: { cinemaMax: 0 },
      metricId: 'teamTotalDamage',
      constraints: { boss, baseTeammates: [VELINA, ''], buffs, buffChoice: 'all' },
    }))
    // 1 主系列 × (本体 + N 张牌) 条输出系列
    expect(res.series).toHaveLength(1 + buffs.length)
    // 每条系列标了自己的 buff 态：本体 buffTitle=null、牌系列带牌名
    expect(res.series[0].buffTitle).toBeNull()
    expect(res.series[0].label, '本体线标签不带牌名').not.toContain('·')
    for (let i = 1; i < res.series.length; i++) {
      expect(res.series[i].buffTitle).toBe(buffs[i - 1].title)
      expect(res.series[i].label).toContain(buffs[i - 1].title)
      expect(res.series[i].baseId).toBe('a') // 同组归因（图例分组/线型用）
    }
    // 全部档都有读数（buff 装配不该让任何一档 null）
    for (const s of res.series) expect(s.values[0], `${s.label} 应有读数`).not.toBeNull()
    // 环境摘要必须含 buff 模式（用户裁决：不能掐头去尾）
    expect(res.environmentSummary).toContain('全状态对比')
    expect(res.environmentSummary).toContain(boss.name)
  })

  it('★ buffChoice=具体牌：只出一条系列且该牌真的写进全局 Buff 表（防「选了不算」的静默失效）', async () => {
    const { boss, buffs } = await bossWithBuffs()
    const card = buffs[0]
    let seenBuffIds: string[] = []
    await withAnalysisScenario(scenario => computeFreeCompare(scenario, {
      series: [{ id: 'a', kind: 'agent', members: [BURNICE], code: code('21') }],
      axisId: 'cinema',
      axisOptions: { cinemaMax: 0 },
      metricId: 'teamTotalDamage',
      constraints: { boss, baseTeammates: [VELINA, ''], buffs, buffChoice: card },
      onProgress: () => {
        if (seenBuffIds.length === 0) {
          seenBuffIds = scenario.config.globalBuffs.map(r => String(r.id)).filter(id => id.startsWith('phase-buff:'))
        }
      },
    }))
    expect(seenBuffIds.length, `求值期间全局 Buff 表应含「${card.title}」的 phase-buff 行`).toBeGreaterThan(0)
    expect(seenBuffIds.every(id => id.includes(card.title))).toBe(true)
    // 关卡固有 buff（layer-buff）必须保留（CC-342：当期牌替换整表时不清房间 buff）
  })

  it('★ buffChoice 缺省 = 不使用：无 phase-buff 行、只出一条本体系列，且结果与「手动选牌」数值不同（证明牌真的进了计算）', async () => {
    const { boss, buffs } = await bossWithBuffs()
    const base = { boss, baseTeammates: [VELINA, ''] as [string, string], buffs }
    const run = (buffChoice: unknown) => withAnalysisScenario(scenario => computeFreeCompare(scenario, {
      series: [{ id: 'a', kind: 'agent', members: [BURNICE], code: code('21') }],
      axisId: 'cinema',
      axisOptions: { cinemaMax: 0 },
      metricId: 'teamTotalDamage',
      constraints: { ...base, buffChoice } as never,
    }))
    const none = await run('none')
    expect(none.series).toHaveLength(1)
    expect(none.series[0].buffTitle).toBeNull()
    // 至少有一张牌会改变读数（否则「buff 进计算」这条机制根本没生效，测试白搭）
    let anyDiff = false
    for (const card of buffs) {
      const withCard = await run(card)
      const v0 = none.series[0].values[0]!
      const v1 = withCard.series[0].values[0]!
      if (Math.abs(v1 - v0) / Math.max(1, Math.abs(v0)) > 1e-6) { anyDiff = true; break }
    }
    expect(anyDiff, '当期三张牌对柏妮思队全是零影响——要么牌没进计算，要么夹具选错了 Boss').toBe(true)
  })
})

// ---------- 测试用小工具（不进产品代码） ----------

/**
 * 求值器在**独立场景**上装配（r372）⇒ 跑完之后查 UI store 只会看到「没被碰过」的现场。
 * 要断言「装配对了没有」，只能在**求值过程中**抓：借 `onProgress` 回调（它在每次求值之后触发、
 * dispose 之前）读当时**场景**里的槽位状态。这是本文件三个 ★ 用例的共同手法。
 */
function makeRunner() {
  async function run(
    series: SeriesSpec[],
    axisId: 'cinema' | 'setupCode',
    axisOptions: Record<string, unknown>,
    constraints: Record<string, unknown> = {},
    onEval?: (config: ConfigModel) => void,
  ) {
    return withAnalysisScenario(scenario => computeFreeCompare(scenario, {
      series,
      axisId,
      axisOptions: axisOptions as never,
      metricId: 'teamTotalDamage',
      constraints: { baseTeammates: [VELINA, ''], ...constraints } as never,
      onProgress: onEval ? () => onEval(scenario.config) : undefined,
    }))
  }

  return {
    /** 跑单个系列（只要它装配后的场景状态，不看结果数值） */
    async runOne(s: SeriesSpec, constraints: Record<string, unknown> = {}) {
      return run([s], 'cinema', { cinemaMax: 0 }, constraints)
    },
    /** 跑一条轴（series 为 null 时用默认的「柏妮思 vs 菲欧妮」两个系列） */
    async runAxis(s: SeriesSpec | null, axisId: 'cinema' | 'setupCode', axisOptions: Record<string, unknown>) {
      const series = s
        ? [s]
        : [
            { id: 'a', kind: 'agent' as const, members: [BURNICE], code: code('21') },
            { id: 'b', kind: 'agent' as const, members: [PHOENIX], code: code('21') },
          ]
      return run(series, axisId, axisOptions)
    },
    run,
  }
}

/** 抓「0 号槽在求值那一刻」的音擎状态（无专武用例用） */
async function captureSlot0(s: SeriesSpec): Promise<{ wEngineId: string; modLevel: number }> {
  const { run } = makeRunner()
  let seen: { wEngineId: string; modLevel: number } | null = null
  await run([s], 'cinema', { cinemaMax: 0 }, {}, config => {
    seen ??= { wEngineId: config.team[0].wEngineId, modLevel: config.team[0].wEngineModLevel }
  })
  if (!seen) throw new Error('[测试] 求值没发生，抓不到槽位状态（onProgress 没被调用）')
  return seen
}

/** 抓「1 号槽在求值那一刻」的角色与命座（维琳娜条件用例用） */
async function captureSlot1(
  s: SeriesSpec,
  constraints: Record<string, unknown>,
): Promise<{ agentId: string; cinemaLevel: number }> {
  const { run } = makeRunner()
  let seen: { agentId: string; cinemaLevel: number } | null = null
  await run([s], 'cinema', { cinemaMax: 0 }, constraints, config => {
    seen ??= { agentId: config.team[1].agentId, cinemaLevel: config.team[1].cinemaLevel }
  })
  if (!seen) throw new Error('[测试] 求值没发生，抓不到槽位状态（onProgress 没被调用）')
  return seen
}
