/**
 * 自由对比工作台 · 求值器集成测试（真引擎，快照/恢复 + 装配正确性）
 *
 * 为什么需要这一层：纯函数测试（`freeCompare.test.ts`）证明不了「装配到 store 上的状态是对的」。
 * 而本工作台最危险的失败模式恰恰是**静默装错**——
 *   ① 无专武（wengine=0）没显式覆盖 ⇒ `setAgent` 自动给角色穿上专武（`config.ts:594-599`），
 *      得到「嘴上无专武、身上穿专武」的偏高数值，零报错；
 *   ② 忘了恢复现场 ⇒ 污染用户当前的队伍/Boss 配置（跑完对比发现自己队被换了）。
 * 这两条都是**读代码看不出来、只有跑真引擎并对账才抓得到**的，所以必须各有一条会红的断言。
 *
 * 判据（AGENTS 规则 9）：每条断言针对一个真实失败模式，不是复读实现。
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mockStaticFetch, setupHarness } from '@/test/harness'
import { useConfigStore } from '@/stores/config'
import { useCatalogStore } from '@/stores/catalog'
import { useResourceCalc } from '@/composables/useResourceCalc'
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

  it('★ 跑完不留痕：队伍/Boss/命座全部还原（防污染用户当前配置）', async () => {
    const config = useConfigStore()
    const calc = useResourceCalc()
    // 先给一个「用户自己的配置」当现场
    await setupHarness([{ agentId: BURNICE }, { agentId: VELINA }, ''], { recommendedBuild: true })
    const before = JSON.stringify({
      team: config.team.map(c => ({ id: c.agentId, cine: c.cinemaLevel, mod: c.wEngineModLevel, w: c.wEngineId })),
      hp: config.enemy.hp,
    })

    await computeFreeCompare(calc, {
      series: [
        { id: 'a', kind: 'agent', members: [BURNICE], code: code('01') },
        { id: 'b', kind: 'agent', members: [PHOENIX], code: code('21') },
      ],
      axisId: 'cinema',
      axisOptions: { cinemaMax: 1 },
      metricId: 'teamTotalDamage',
      constraints: { baseTeammates: [VELINA, ''] },
    })

    const after = JSON.stringify({
      team: config.team.map(c => ({ id: c.agentId, cine: c.cinemaLevel, mod: c.wEngineModLevel, w: c.wEngineId })),
      hp: config.enemy.hp,
    })
    expect(after, '跑完对比后现场必须逐字段还原').toBe(before)
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
})

// ---------- 测试用小工具（不进产品代码） ----------

/**
 * 求值器在 `finally` 里恢复现场（这是产品行为，必须保持）⇒ **跑完之后查 store 只会看到还原态**。
 * 要断言「装配对了没有」，只能在**求值过程中**抓：借 `onProgress` 回调（它在每次求值之后触发、
 * 恢复之前）读当时的槽位状态。这是本文件三个 ★ 用例的共同手法。
 */
function makeRunner() {
  const calc = useResourceCalc()
  const config = useConfigStore()

  async function run(
    series: SeriesSpec[],
    axisId: 'cinema' | 'setupCode',
    axisOptions: Record<string, unknown>,
    constraints: Record<string, unknown> = {},
    onEval?: () => void,
  ) {
    return computeFreeCompare(calc, {
      series,
      axisId,
      axisOptions: axisOptions as never,
      metricId: 'teamTotalDamage',
      constraints: { baseTeammates: [VELINA, ''], ...constraints } as never,
      onProgress: onEval,
    })
  }

  return {
    calc,
    config,
    /** 跑单个系列（只要它装配后的 store 状态，不看结果数值） */
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
  const config = useConfigStore()
  const { run } = makeRunner()
  let seen: { wEngineId: string; modLevel: number } | null = null
  await run([s], 'cinema', { cinemaMax: 0 }, {}, () => {
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
  const config = useConfigStore()
  const { run } = makeRunner()
  let seen: { agentId: string; cinemaLevel: number } | null = null
  await run([s], 'cinema', { cinemaMax: 0 }, constraints, () => {
    seen ??= { agentId: config.team[1].agentId, cinemaLevel: config.team[1].cinemaLevel }
  })
  if (!seen) throw new Error('[测试] 求值没发生，抓不到槽位状态（onProgress 没被调用）')
  return seen
}
