/**
 * 难度曲线 worker 化的判据：**① 序列化契约 ② 回落路径与直接调用逐位相同 ③ 中止保留已算部分**。
 *
 * 为什么必须有它（任务书 §4 判据 5 / 规则 9「没有测试覆盖的改动先补测试」）：
 * `difficultyCurveRunner` 引入了全仓第一个 Web Worker。node/vitest **没有 `Worker`**
 * （实测 `typeof Worker === 'undefined'`）⇒ 单测天然跑的是**回落路径**，而生产跑的是 worker 路径。
 * 这个不对称正是最危险的地方：worker 侧的缺陷（序列化不可传、漏传输入、结果形状不符）
 * 在单测里**永远看不见**。本文件用三条判据把不对称的两侧钉在一起：
 *
 * 1. **`CurveRunRequest` / `DifficultyCurveRow` 必须 structuredClone 可传**——
 *    worker 边界只收结构化克隆。带函数 / Ref / Map / class 实例的字段会让 postMessage 抛
 *    `DataCloneError`（`analysisScenario.ts` 记过同款事故：`toRaw($state)` 把 `RefImpl` 递进
 *    `structuredClone` ⇒ 整页「计算曲线」按钮点了不出图）。这条判据**在 node 里就能跑**，
 *    且它测的正是 worker 侧真正会失败的那一步。
 * 2. **回落路径 = 直接调用 `computeDifficultyCurves`，逐位相同**——回落不是「近似」，
 *    它是 worker 化前那条路径本身。用同一份输入分别走 `runDifficultyCurves`（无 Worker ⇒ 回落）
 *    与手写 `withAnalysisScenario` 逐队，断言 `base`/`final`/`points`/`opened`/`dropped` 全等。
 * 3. **中止语义 = 优雅式**（`batchTask.ts` 的唯一口径）：中止后**保留已算部分**（不是丢弃、
 *    也不是抛错）。worker 模式下这是 `terminate()` 的即时硬停 + 已回传行照常发布。
 *
 * ⚠️ 本文件**不**测 worker 线程本身（node 无 Worker）：那条路径的实测读数在
 * `scripts/perf-curve-longtask.mjs` 的改前/改后对比表里（任务书 §4 判据 3）。
 */
import { describe, expect, it } from 'vitest'
import { reactive } from 'vue'
import { setupHarness } from '@/test/harness'
import { withAnalysisScenario } from '@/composables/analysisScenario'
import { computeDifficultyCurves } from '@/composables/difficultyCurve'
import { runDifficultyCurves, curveWorkerSupported, toCloneable, type CurveRunRequest } from '@/composables/difficultyCurveRunner'
import { cloneConfigState } from '@/composables/analysisScenario'
import { teamPresets } from '@/data/teamPresets'
import type { BossPreset, BossPresetPhase } from '@/types/bossPreset'

// 与 `difficultyCurve.test.ts` 同源的夹具（**不是**残缺字面量断言：字段逐项齐备，见判据 27）
const res20 = { physical: 20, fire: 20, ice: 20, electric: 20, ether: 20, wind: 20 }
const FAKE_BOSS: BossPreset = {
  id: '40009',
  name: '异构·基塔布鲁',
  nameEn: 'Integrated - Girtablullu',
  aliases: [],
  icon: null,
  iconSource: null,
  isCriticalAssault: true,
  monster: { stunVuln: 1.5, stunTime: 12, name: '异构·基塔布鲁' },
  defaults: { battleTime: 180, shieldCount: 0, energyShield: 0 },
  phases: [],
}
const FAKE_PHASE: BossPresetPhase = {
  phaseId: '690461',
  zoneKey: '69046201',
  version: '3.2',
  label: '3.2 · 2026-07-30',
  begin: '2026-07-30 04:00:00',
  modeType: 'critical_assault',
  stageName: '异构·基塔布鲁',
  stageNum: 1,
  level: 70,
  hp: 31_900_305,
  stunValue: 18933.95,
  defense: 953,
  bossAnomalyCoeff: 1.1,
  damageResistances: { ...res20 },
  stunResistances: { ...res20 },
  anomalyResistances: { ...res20 },
  weakness: [],
  resistance: [],
}

/** 一队的轻量夹具：走生产预设（含 altAxes 的那条留在大用例里，这里只要一条真队） */
const TEAM = 'auto-1521-1481-1311'

describe('难度曲线 worker 化', () => {
  it('① 环境探针：node 无 Worker ⇒ 回落路径是本文件的被测面（生产走 worker，两侧判据在此对齐）', () => {
    expect(typeof Worker, 'node/vitest 下没有 Web Worker').toBe('undefined')
    expect(curveWorkerSupported()).toBe(false)
  })

  it('②b ★ 响应式代理必须被 toCloneable 剥掉（实机事故回归锁：ref 取出的 boss/phase 是 Proxy）', () => {
    // 实机症状（2026-10-09 首次接线实测）：页面的 selectedBoss / selectedPhase 来自 `ref<BossPreset[]>`
    // ⇒ 取出的对象是 **Proxy**，`postMessage` 抛 `DataCloneError`，页面表现为「点计算曲线不出图」。
    // 这条判据直接钉住那个失败模式：代理原样传必炸、经 toCloneable 必过。
    const proxy = reactive({ id: '40009', monster: { stunVuln: 1.5 }, phases: [{ phaseId: 'x', hp: 1 }] })
    expect(() => structuredClone(proxy), 'Vue 代理不可结构化克隆（这就是事故本体）').toThrow()
    const safe = toCloneable(proxy)
    expect(() => structuredClone(safe)).not.toThrow()
    expect(safe).toEqual({ id: '40009', monster: { stunVuln: 1.5 }, phases: [{ phaseId: 'x', hp: 1 }] })
    // 数组元素里的代理同样要剥（presets 是 ref 数组）
    const arr = reactive([{ id: 'a' }, { id: 'b' }])
    expect(() => structuredClone(arr)).toThrow()
    expect(structuredClone(toCloneable(arr))).toEqual([{ id: 'a' }, { id: 'b' }])
  })

  it('② 请求载荷与结果都是 structuredClone 可传（worker 边界的唯一硬约束）', async () => {
    const { catalog, config } = await setupHarness(['', '', ''], { recommendedBuild: false })
    await catalog.loadBuildRecommendations()
    const preset = teamPresets.find(p => p.id === TEAM)
    expect(preset, `预设数据里应有 ${TEAM}`).toBeTruthy()

    // 请求：与页面 runCurves 构造的同一形状（configState 走 cloneConfigState，fusionRules 走深拷贝）
    const request: CurveRunRequest = {
      configState: cloneConfigState(config.$state) as unknown as Record<string, unknown>,
      fusionRules: cloneConfigState([]),
      presets: [preset!],
      boss: FAKE_BOSS,
      phase: FAKE_PHASE,
      difficultyWeights: { timePressure: 1, interaction: {} },
    }
    // 若请求里混进 Ref / 函数 / class 实例，这一步就会抛 DataCloneError
    const cloned = structuredClone(request)
    expect(cloned.presets[0]!.id).toBe(TEAM)
    expect(cloned.configState).toEqual(request.configState)

    // 结果：worker 逐队回传的就是 DifficultyCurveRow，必须同样可传
    const outcome = await runDifficultyCurves(request)
    expect(outcome.usedWorker, 'node 下必须回落').toBe(false)
    expect(outcome.rows).toHaveLength(1)
    const roundTripped = structuredClone(outcome.rows)
    expect(roundTripped[0]!.ladder.base).toBe(outcome.rows[0]!.ladder.base)
    expect(roundTripped[0]!.ladder.points).toEqual(outcome.rows[0]!.ladder.points)
  }, 300_000)

  it('③ 回落路径与直接调用逐位相同（回落 = worker 化前那条路径，不是近似）', async () => {
    const { catalog, config } = await setupHarness(['', '', ''], { recommendedBuild: false })
    await catalog.loadBuildRecommendations()
    const preset = teamPresets.find(p => p.id === TEAM)!
    const weights = { timePressure: 1, interaction: {} }

    // 直接调用（= 页面 worker 化前的写法）
    const direct = await withAnalysisScenario(s => computeDifficultyCurves(s, {
      presets: [preset], boss: FAKE_BOSS, phase: FAKE_PHASE, difficultyWeights: weights,
    }))

    const outcome = await runDifficultyCurves({
      configState: cloneConfigState(config.$state) as unknown as Record<string, unknown>,
      fusionRules: cloneConfigState([]),
      presets: [preset],
      boss: FAKE_BOSS,
      phase: FAKE_PHASE,
      difficultyWeights: weights,
    })

    expect(outcome.aborted).toBe(false)
    expect(outcome.rows).toHaveLength(direct.length)
    const a = direct[0]!.ladder
    const b = outcome.rows[0]!.ladder
    // 逐位相同：base/final 是浮点精确相等（不是 toBeCloseTo），points/opened/dropped 全等
    expect(b.base).toBe(a.base)
    expect(b.final).toBe(a.final)
    expect(b.points).toEqual(a.points)
    expect(b.opened).toEqual(a.opened)
    expect(b.dropped).toEqual(a.dropped)
    expect(outcome.rows[0]!.presetId).toBe(preset.id)
    expect(outcome.rows[0]!.name).toBe(preset.name)
  }, 300_000)

  it('④ 中止语义 = 优雅式：保留已算部分（不是丢弃、不抛错）', async () => {
    const { catalog, config } = await setupHarness(['', '', ''], { recommendedBuild: false })
    await catalog.loadBuildRecommendations()
    const preset = teamPresets.find(p => p.id === TEAM)!
    const controller = new AbortController()
    // 开局即中止：一行都不该算（回落路径在队边界检查 signal）
    controller.abort()
    const outcome = await runDifficultyCurves({
      configState: cloneConfigState(config.$state) as unknown as Record<string, unknown>,
      fusionRules: cloneConfigState([]),
      presets: [preset],
      boss: FAKE_BOSS,
      phase: FAKE_PHASE,
    }, { signal: controller.signal })
    expect(outcome.aborted).toBe(true)
    expect(outcome.rows).toEqual([])
  }, 120_000)
})
