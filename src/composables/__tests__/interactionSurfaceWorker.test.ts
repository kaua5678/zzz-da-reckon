/**
 * **二维面 worker 通道**判据（2026-10-19，用户批准「对开发和应用有利就可以做」）。
 *
 * ## 锁什么
 *
 * ① **协议**：假 worker 下 `run → ready → progress… → done` 走通，进度透传，结果原样返回；
 * ② **回落逐位相同**：无 Worker 环境（node/vitest）走主线程 ≈ 直接调 `runInteractionSurface`
 *    ——两条路径调的是同一个函数，数值必须一字不差（这是「回落不改变口径」的机器面）；
 * ③ **失败回落**：worker 报 error ⇒ 自动回落主线程，绝不发布半张面；
 * ④ **中止**：`AbortSignal` 一响即 terminate，且结果标记 aborted（半张面不可解读 ⇒ 丢弃）。
 *
 * ⚠ 为什么 ② 用「相对误差」而不是严格相等：两次运行各自建场景，
 * 引擎内可能有依赖遍历顺序的浮点累加；实测差值在 1e-9 相对量级。
 * 若将来真的出现更大偏差，说明回落路径口径漂了，判据会红——这正是它该做的事。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { cloneConfigState, withAnalysisScenario } from '@/composables/analysisScenario'
import { applyAxisBinding, applyTeamToStore } from '@/composables/teamCompare'
import { applyBossRoom } from '@/composables/bossRoom'
import { runInteractionSurface } from '@/composables/interactionSurface'
import {
  runSurfaceInWorker, surfaceWorkerSupported, type SurfaceWorkerLike,
} from '@/composables/interactionSurfaceRunner'
import type { SurfaceWorkerMessage, SurfaceWorkerRequest } from '@/composables/interactionSurfaceWorker'
import { teamPresets } from '@/data/teamPresets'
import type { BossPreset, BossPresetPhase } from '@/types/bossPreset'

const TEAM_ID = 'banyue-liuyin-lucia'

async function fixture() {
  const { catalog } = await setupHarness(['', '', ''], { productionBasicWeights: true })
  await catalog.loadBuildRecommendations()
  const data = await catalog.loadBossPresets()
  const boss = (data.bosses ?? []).find((b: BossPreset) => b.id === '30041')!
  const phase = (boss.phases.find(p => p.modeType === 'critical_assault') ?? boss.phases[0]!) as BossPresetPhase
  const preset = teamPresets.find(p => p.id === TEAM_ID)!
  /** 装配后的现场快照（与页面同一条装配序列） */
  const { configState, direct } = await withAnalysisScenario(async s => {
    applyBossRoom(s.config, boss, phase)
    applyTeamToStore(s.config, preset)
    applyAxisBinding(s.config, s.config.getAxisState(), preset)
    // ⚠ 必须用 cloneConfigState（不是 JSON 往返）：它是 config store 深拷贝的唯一入口，
    // 按响应式读、解 ref；JSON 往返会丢 undefined/NaN，且把嵌套结构拍平成别的东西
    const state = cloneConfigState(s.config.$state) as unknown as Record<string, unknown>
    const surface = await runInteractionSurface(s, {
      preset, boss, phase, maxCount: 6, countStep: 3, ratioSteps: 2,
    })
    return { configState: state, direct: surface }
  }) as { configState: Record<string, unknown>; direct: Awaited<ReturnType<typeof runInteractionSurface>> }
  return { preset, boss, phase, configState, direct }
}

/** 假 worker：收到 run 后按协议回 ready → progress → done */
function fakeWorker(produce: () => SurfaceWorkerMessage[]): SurfaceWorkerLike {
  const msgListeners: ((e: MessageEvent<SurfaceWorkerMessage>) => void)[] = []
  const errListeners: ((e: unknown) => void)[] = []
  let terminated = false
  return {
    postMessage(_req: SurfaceWorkerRequest) {
      setTimeout(() => {
        if (terminated) return
        for (const m of produce()) for (const l of msgListeners) l({ data: m } as MessageEvent<SurfaceWorkerMessage>)
      }, 0)
    },
    terminate() { terminated = true },
    addEventListener(type: string, listener: never) {
      if (type === 'message') msgListeners.push(listener)
      else errListeners.push(listener)
    },
    removeEventListener(type: string, listener: never) {
      if (type === 'message') {
        const i = msgListeners.indexOf(listener)
        if (i >= 0) msgListeners.splice(i, 1)
      } else {
        const i = errListeners.indexOf(listener)
        if (i >= 0) errListeners.splice(i, 1)
      }
    },
  } as SurfaceWorkerLike
}

describe('二维面 worker 通道', () => {
  it('② 无 Worker 环境回落主线程，且与直接调用逐位相同', async () => {
    expect(surfaceWorkerSupported(), 'vitest/node 环境没有 Worker ⇒ 必须走回落').toBe(false)
    const { preset, boss, phase, configState, direct } = await fixture()
    const out = await runSurfaceInWorker({
      preset, boss, phase, maxCount: 6, countStep: 3, ratioSteps: 2, configState,
    })
    expect(out.usedWorker, '本环境必须回落主线程').toBe(false)
    expect(out.aborted).toBe(false)
    // 结构一致
    expect(out.surface.series.length).toBe(direct.series.length)
    for (let si = 0; si < direct.series.length; si++) {
      const a = direct.series[si]!
      const b = out.surface.series[si]!
      expect(b.counts).toEqual(a.counts)
      expect(b.ratios).toEqual(a.ratios)
      for (let ri = 0; ri < a.cells.length; ri++) {
        for (let ci = 0; ci < a.cells[ri]!.length; ci++) {
          const ca = a.cells[ri]![ci]!
          const cb = b.cells[ri]![ci]!
          // 相对误差 1e-9：两次独立建场景，只允许浮点累加顺序差异
          expect(Math.abs(cb.dmg - ca.dmg) / Math.max(1, Math.abs(ca.dmg)), 'dmg 必须逐位相同（相对 1e-9）')
            .toBeLessThan(1e-9)
          expect(cb.clean).toBe(ca.clean)
          expect(cb.count).toBe(ca.count)
        }
      }
    }
  }, 900_000)

  it('① 假 worker：协议走通、进度透传、结果原样返回', async () => {
    const { preset, boss, phase, configState, direct } = await fixture()
    const seen: number[] = []
    const out = await runSurfaceInWorker(
      { preset, boss, phase, maxCount: 6, countStep: 3, ratioSteps: 2, configState },
      {
        createWorker: () => fakeWorker(() => [
          { type: 'ready' },
          { type: 'progress', done: 30, total: 100 },
          { type: 'progress', done: 90, total: 100 },
          { type: 'done', surface: direct },
        ]),
        onProgress: p => seen.push(p.pct),
      },
    )
    expect(out.usedWorker, '假 worker 可用 ⇒ 必须走 worker 路径').toBe(true)
    expect(out.aborted).toBe(false)
    expect(out.surface).toBe(direct)
    expect(seen.length, '进度必须透传（ready + 两次 progress）').toBeGreaterThanOrEqual(3)
    expect(seen[seen.length - 1], '最后一次进度 = 90/100').toBeCloseTo(0.9, 6)
  }, 900_000)

  it('③ 失败回落：worker 报 error ⇒ 自动回落主线程，不发布半张面', async () => {
    const { preset, boss, phase, configState, direct } = await fixture()
    const out = await runSurfaceInWorker(
      { preset, boss, phase, maxCount: 6, countStep: 3, ratioSteps: 2, configState },
      { createWorker: () => fakeWorker(() => [{ type: 'error', error: 'boom' }]) },
    )
    expect(out.usedWorker, 'worker 失败 ⇒ 走回落').toBe(false)
    expect(out.aborted).toBe(false)
    // 回落出的面必须是真的整张（不是半张）
    expect(out.surface.complete).toBe(true)
    expect(out.surface.series.length).toBe(direct.series.length)
  }, 900_000)

  it('★ ⑤ logicEditor 的 $state 是 { state: { rowFusions } } 形状（按 rowFusions 取会拿到 undefined）', async () => {
    /**
     * 2026-10-19 实机踩到：`logicEditor` 是 **setup store**，`$state` 形如
     * `{ state: { rowFusions: [...] } }` 而**不是** `{ rowFusions }`。
     * 按后者取值 ⇒ `undefined` ⇒ worker 里 `setActiveRowFusionRules(undefined)` 抛
     * `rules.filter is not a function` ⇒ **worker 崩掉并静默回落主线程**（控制台无错，
     * 只是进度文案变回主线程版「二维面 65/112 格」）。
     *
     * 这条锁的是「形状」本身，与 store 内部实现解耦：将来若改成 `$state.rowFusions`，
     * 判据会红，逼着改 `readFusionRules`（而不是让 worker 静默降级）。
     */
    const { useLogicEditorStore } = await import('@/stores/logicEditor')
    const store = useLogicEditorStore()
    const state = store.$state as unknown as Record<string, unknown>
    expect(state.rowFusions, '顶层不得直接有 rowFusions（否则 readFusionRules 取不到）').toBeUndefined()
    const inner = state.state as { rowFusions?: unknown } | undefined
    expect(Array.isArray(inner?.rowFusions), '规则必须住在 $state.state.rowFusions').toBe(true)
  })

  it('④ 中止：信号一响即停，aborted = true', async () => {
    const { preset, boss, phase, configState } = await fixture()
    const controller = new AbortController()
    controller.abort()
    const out = await runSurfaceInWorker(
      { preset, boss, phase, maxCount: 6, countStep: 3, ratioSteps: 2, configState },
      { signal: controller.signal },
    )
    expect(out.aborted, '已中止 ⇒ aborted = true（半张面不可解读，调用方不得发布）').toBe(true)
  }, 900_000)
})
