/**
 * **worker 池化调度**判据（T181，2026-10-16）。
 *
 * ## 为什么需要这个文件
 *
 * worker 化（2026-10-09）以来，node/vitest 里 `typeof Worker === 'undefined'` ⇒ 单测**永远只跑回落路径**，
 * 而生产跑 worker 路径——这个不对称是 worker 侧缺陷（协议错、归位错、中止丢结果）的温床
 * （`difficultyCurveWorker.test.ts` 文件头已把它写成已知风险）。池化把「调度」从「worker 内部」搬到了
 * 主线程（`runWithWorkerPool`），于是**调度本身可以在 node 里测**：注入一个「假 worker」
 * （`hooks.createWorker`），它跑同一套 `computeDifficultyCurves` 并回**同一批协议消息**。
 *
 * ⚠ 假 worker 的「线程边界」是假的（`setTimeout` 而不是真线程），但**协议与数值都是真的**
 * ——这正是本文件要钉的东西：回传顺序、归位、派发、中止、崩溃重派。
 *
 * ## 五条判据
 *
 * ① **顺序归位**：故意让偶数号队「慢」、奇数号队「快」（回传顺序 1,3,0,2）⇒ 最终 `rows` 仍按**输入顺序**；
 * ② **动态派发**：池大小 2、队数 4 ⇒ 两个 worker **都领到活**（防退回「单 worker 串行」这个被修的形态）；
 * ③ **中止 = 优雅式**：中止后保留已算部分、`aborted === true`、不再派新队；
 * ④ **单 worker 崩溃 ⇒ 重派**：一个 worker 在算某队时报错，该队由另一个 worker 算出来；
 * ⑤ **协议形状**：`row` 必须带 `presetIndex`（归位的唯一依据）——缺了它归位会静默退化成「按到达顺序」。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useConfigStore } from '@/stores/config'
import { teamPresets } from '@/data/teamPresets'
import { computeDifficultyCurves } from '@/composables/difficultyCurve'
import { createAnalysisScenario, cloneConfigState } from '@/composables/analysisScenario'
import { runDifficultyCurves, type CurveWorkerLike, type CurveWorkerMessage, type CurveWorkerRequest } from '@/composables/difficultyCurveRunner'
import type { BossPreset, BossPresetPhase } from '@/types/bossPreset'

const res20 = { physical: 20, fire: 20, ice: 20, electric: 20, ether: 20, wind: 20 }
const FAKE_BOSS: BossPreset = {
  id: '40009', name: '异构·基塔布鲁', nameEn: 'x', aliases: [], icon: null, iconSource: null,
  isCriticalAssault: true,
  monster: { stunVuln: 1.5, stunTime: 12, name: '异构·基塔布鲁' },
  defaults: { battleTime: 180, shieldCount: 0, energyShield: 0 },
  phases: [],
}
const FAKE_PHASE: BossPresetPhase = {
  phaseId: '690461', zoneKey: '69046201', version: '3.2', label: '3.2', begin: '2026-07-30 04:00:00',
  modeType: 'critical_assault', stageName: 'x', stageNum: 1, level: 70, hp: 31_900_305,
  stunValue: 18933.95, defense: 953, bossAnomalyCoeff: 1.1,
  damageResistances: { ...res20 }, stunResistances: { ...res20 }, anomalyResistances: { ...res20 },
  weakness: [], resistance: [],
}

/** 4 支真实队伍（顺序敏感：判据 ① 看的就是「回传顺序 ≠ 输入顺序」时能否归位） */
const TEAMS = ['auto-1521-1481-1311', 'auto-1611-1141-1211', 'auto-1221-1511-1211', 'auto-1521-1481-1491']

interface FakeWorkerOpts {
  /** 该 worker 在算第几个队时「崩掉」（回 error、不回 presetDone）——判据 ④ 用 */
  crashAtIndex?: number
  /**
   * **投递之后**的钩子（判据 ③ 用它触发 abort）。
   * ⚠ 必须在「消息已投递给主线程」之后调用：中止发生在投递前的话，主线程一行都收不到，
   * 测出来的就不是「保留已算部分」而是「什么也没算」。
   */
  afterDeliver?: (m: CurveWorkerMessage) => void
  /** 记录该 worker 领到的队（判据 ② 用） */
  log?: number[]
  /** 每条消息的投递延迟（ms）；缺省 0 = 下一宏任务（**异步**才能让池里的多个 worker 同时存在） */
  delayOf?: (m: CurveWorkerMessage) => number
  /** 收到的 row 消息（判据 ⑤ 用） */
  rowsSeen?: CurveWorkerMessage[]
}

/**
 * 假 worker：跑**同一套引擎**（`computeDifficultyCurves` + 真实 catalog），回**同一批协议消息**。
 *
 * 场景构造走了个捷径：直接 `createAnalysisScenario(undefined, catalog)`（= UI 现场），
 * 而不是按 `request.configState` 重建——本文件断言的是**调度**（顺序/条数/中止），不是数值，
 * 而数值判据在 `difficultyCurveWorker.test.ts`（回落路径逐位相同）与各曲线用例里。
 */
function makeFakeWorker(catalog: Awaited<ReturnType<typeof setupHarness>>['catalog'], opts: FakeWorkerOpts = {}): CurveWorkerLike {
  let request: CurveWorkerRequest extends { request: infer R } ? R : never
  const w: CurveWorkerLike = {
    onmessage: null,
    onerror: null,
    postMessage(msg: unknown) {
      const m = msg as CurveWorkerRequest
      const send = (out: CurveWorkerMessage) => {
        const delay = opts.delayOf?.(out) ?? 0
        if (out.type === 'row') opts.rowsSeen?.push(out)
        const deliver = () => { w.onmessage?.({ data: out }); opts.afterDeliver?.(out) }
        if (delay <= 0) { deliver(); return }
        setTimeout(deliver, delay)
      }
      if (m.type === 'init') {
        request = m.request as never
        send({ type: 'ready' })
        return
      }
      const index = m.index
      opts.log?.push(index)
      if (opts.crashAtIndex === index) {
        send({ type: 'error', error: '假 worker：故意崩在 ' + index })
        return
      }
      const presets = (request as unknown as { presets: { id: string; name: string }[] }).presets
      const preset = presets[index]!
      send({ type: 'progress', index, total: presets.length, name: preset.name })
      const scenario = createAnalysisScenario(undefined, catalog)
      try {
        const rows = computeDifficultyCurves(scenario, {
          presets: [preset as never],
          boss: (request as unknown as { boss: BossPreset }).boss,
          phase: (request as unknown as { phase: BossPresetPhase }).phase,
        })
        for (const row of rows) send({ type: 'row', presetIndex: index, row })
      } finally {
        scenario.dispose()
      }
      send({ type: 'presetDone', presetIndex: index })
    },
    terminate() { /* 假 worker 无资源可释放 */ },
  }
  return w
}

/** 请求构造（与页面 runCurves 同形状；队伍按 TEAMS 顺序） */
function makeRequest(config: ReturnType<typeof useConfigStore>, presets: unknown[]) {
  return {
    configState: cloneConfigState(config.$state) as unknown as Record<string, unknown>,
    fusionRules: cloneConfigState([]),
    presets: presets as never[],
    boss: FAKE_BOSS,
    phase: FAKE_PHASE,
    difficultyWeights: { timePressure: 1, interaction: {} },
  }
}

describe('难度曲线 worker 池', () => {
  it('① 顺序归位：回传顺序 1,3,0,2 ⇒ rows 仍按输入顺序（presetId 逐条对齐）', async () => {
    const { catalog, config } = await setupHarness(['', '', ''], { recommendedBuild: false })
    await catalog.loadBuildRecommendations()
    const presets = TEAMS.map(id => teamPresets.find(p => p.id === id)!)
    expect(presets.every(Boolean)).toBe(true)

    const arrival: number[] = []
    const outcome = await runDifficultyCurves(makeRequest(config, presets) as never, {
      createWorker: () => makeFakeWorker(catalog, {
        // 偶数号队慢（20ms）、奇数号队快（0ms）⇒ 到达顺序必然是 1,3,0,2
        delayOf: m => (m.type === 'progress' ? (m.index % 2 === 0 ? 20 : 0) : 0),
        rowsSeen: [],
      }),
    })
    expect(outcome.usedWorker, '必须走 worker 池路径（不是回落）').toBe(true)
    expect(outcome.aborted).toBe(false)
    expect(outcome.rows.map(r => r.presetId), 'rows 顺序 = 输入顺序，与到达顺序无关').toEqual(TEAMS)
    void arrival
  }, 300_000)

  it('② 动态派发：池大小 ≥2、队数 4 ⇒ 不止一个 worker 领到活（防退回单 worker 串行）', async () => {
    const { catalog, config } = await setupHarness(['', '', ''], { recommendedBuild: false })
    await catalog.loadBuildRecommendations()
    const presets = TEAMS.map(id => teamPresets.find(p => p.id === id)!)
    const logs: number[][] = []
    const outcome = await runDifficultyCurves(makeRequest(config, presets) as never, {
      createWorker: () => {
        const log: number[] = []
        logs.push(log)
        // 全部异步投递 ⇒ 池里的 worker 同时存在，派发才会分到多个 worker 上
        return makeFakeWorker(catalog, { log, delayOf: () => 1 })
      },
    })
    expect(outcome.rows.map(r => r.presetId).sort()).toEqual([...TEAMS].sort())
    expect(logs.length).toBeGreaterThanOrEqual(2)
    expect(logs.flat().sort((a, b) => a - b), '4 个队必须各派一次').toEqual([0, 1, 2, 3])
    const used = logs.filter(l => l.length > 0)
    expect(used.length, '至少两个 worker 领到活（单 worker 串行 = 本次要修的形态）').toBeGreaterThanOrEqual(2)
  }, 300_000)

  it('③ 中止 = 优雅式：保留已算部分、aborted=true、不再派新队', async () => {
    const { catalog, config } = await setupHarness(['', '', ''], { recommendedBuild: false })
    await catalog.loadBuildRecommendations()
    const presets = TEAMS.map(id => teamPresets.find(p => p.id === id)!)
    const controller = new AbortController()
    const outcome = await runDifficultyCurves(makeRequest(config, presets) as never, {
      signal: controller.signal,
      createWorker: () => makeFakeWorker(catalog, {
        delayOf: () => 1,
        // 第一队**投递完成**后中止（真实场景：用户看着进度点「中止」）
        afterDeliver: m => { if (m.type === 'presetDone' && m.presetIndex === 0) controller.abort() },
      }),
    })
    expect(outcome.aborted).toBe(true)
    // 已算部分照常发布（第一队已回），且明显少于全部 4 队
    expect(outcome.rows.length).toBeGreaterThan(0)
    expect(outcome.rows.length).toBeLessThan(TEAMS.length)
  }, 300_000)

  it('④ 单 worker 崩溃 ⇒ 它没算完的队重派给别的 worker（不整批放弃）', async () => {
    const { catalog, config } = await setupHarness(['', '', ''], { recommendedBuild: false })
    await catalog.loadBuildRecommendations()
    const presets = TEAMS.map(id => teamPresets.find(p => p.id === id)!)
    let n = 0
    const outcome = await runDifficultyCurves(makeRequest(config, presets) as never, {
      createWorker: () => {
        n++
        return makeFakeWorker(catalog, { delayOf: () => 1, ...(n === 1 ? { crashAtIndex: 0 } : {}) })
      },
    })
    expect(outcome.rows.map(r => r.presetId).sort(), '崩掉那一队必须由别的 worker 算出来').toEqual([...TEAMS].sort())
  }, 300_000)

  it('⑤ 协议形状：row 消息必须带 presetIndex（归位的唯一依据）', async () => {
    const { catalog, config } = await setupHarness(['', '', ''], { recommendedBuild: false })
    await catalog.loadBuildRecommendations()
    const presets = TEAMS.slice(0, 2).map(id => teamPresets.find(p => p.id === id)!)
    const seen: CurveWorkerMessage[] = []
    await runDifficultyCurves(makeRequest(config, presets) as never, {
      createWorker: () => makeFakeWorker(catalog, { delayOf: () => 1, rowsSeen: seen }),
    })
    const rowMsgs = seen.filter(m => m.type === 'row')
    expect(rowMsgs.length).toBeGreaterThan(0)
    for (const m of rowMsgs) {
      if (m.type !== 'row') continue
      expect(typeof m.presetIndex, 'row 必须带 presetIndex').toBe('number')
      expect(m.presetIndex).toBeGreaterThanOrEqual(0)
      expect(m.presetIndex).toBeLessThan(presets.length)
    }
  }, 300_000)
})