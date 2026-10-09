/**
 * 难度曲线 worker 运行器（主线程侧）+ 主↔worker 协议。
 *
 * ## 为什么有它（实测，2026-10-09）
 *
 * 队伍对比页「难度曲线」页签此前**整条单队阶梯是一个不可切分的同步段**：`climbDifficultyLadder`
 * 的 `while` 里每次试开都读一次 `ctx.calc.teamTotalDamage.value`（全量求值），而 `withAnalysisScenario`
 * 虽然是 async，内部却是纯同步——`await` 只让出微任务，**不还主线程**。实机 CDP 读数（`scripts/perf-curve-longtask.mjs`）：
 * 单队 **最长 task 3145ms**、总阻塞 4890ms；3 队连跑实测 **单条 task 14239ms 覆盖全程**。
 *
 * ## 两条路的实测取舍（选 A = worker 化）
 *
 * **B（分段让出）做不到**：把 `while` 改 async 只能切到「一次 `goal.apply`」这个粒度，
 * 而实测最大同步块 p50=511ms / p90=1545ms / **max=2293ms**（14 队普查），且最大块恒定是
 * **G2 联合搜索的 `apply`**（`timeWeightAllocation#applyTimeWeightAllocation('joint-levers')`
 * 内部对 3 槽 × 多杠杆做有限差分扫描）——它**不在本任务的改动面**里，改它等于把 async 传染进
 * 权重分配模块。即「切碎但切不到 50ms 以下」，UI 仍会顿。
 *
 * **A 实测可行且不亏**：worker 内自建 pinia + catalog（**自己 fetch 静态数据**，不走 postMessage 搬 1.48MB），
 * 逐队回传 `DifficultyCurveRow`。同一页面同一队集（3 队，含 1 支重队）A/B：
 *
 * | | 墙钟 | 主线程最长 task | 总阻塞 |
 * |---|---|---|---|
 * | 主线程 | 14226ms | **14239ms** | 14239ms |
 * | worker | 13911ms | **0ms** | 0ms |
 *
 * ⇒ 不但没变慢（−2.2%），主线程阻塞**归零**；且 3 队 `base`/`final` 与主线程**逐位相同**
 * （85856056.3863818 / 75769070.26204889 / 64320742.757028736）。
 *
 * ## 硬约束
 *
 * - **只搬不改**：worker 调用的就是同一个 `computeDifficultyCurves`，`computeDifficultyCurves`
 *   与 `climbDifficultyLadder` 的签名与实现**零改动** ⇒ 结果逐位不变，两条时间基线零 delta。
 * - **Worker 不可用时回落主线程**（node/vitest 没有 `Worker`；浏览器构造失败或 worker 报错且一行未产出时）——
 *   回落路径 = **worker 化前那条路径**（`withAnalysisScenario` + 逐队 `setTimeout(r, 0)` 让出），
 *   所以「没有 worker 的环境」行为与今天完全一致，单测无需改签名。
 * - **取消语义保持优雅式**（`batchTask.ts` 的唯一口径）：中止 = 停止计算 + **保留已算部分**。
 *   worker 模式下 `terminate()` 是即时硬停（比原先「等这一队爬完」更灵敏），
 *   已回传的行照常由调用方发布。
 * - **worker 内必须自带行融合规则**：`logicEditor/storage.ts` 在 `typeof window === 'undefined'`
 *   时返回 spec 默认规则，worker 里读不到用户改过的规则 ⇒ 规则随请求一起传（`fusionRules`）。
 *   漏传的实测症状 = 数值静默不同（本次实验先踩到过一次同类：漏传 build-recommendations 让
 *   base 从 85.86M 变 37.43M）。
 *
 * 判据：`__tests__/difficultyCurveWorker.test.ts`（① `DifficultyCurveRow` 的 structuredClone 契约
 * ② 无 Worker 环境回落主线程且与直接调用**逐位相同**）。
 *
 * @fact engine:难度曲线/运行线程 口径: 难度曲线整批跑在 Web Worker 里（worker 自建 pinia+catalog、自 fetch 静态数据、逐队回传 `DifficultyCurveRow`）；无 `Worker` 的环境（node/vitest）与 worker 启动失败（一行未产出）**回落主线程原路径**，回落语义 = 改动前逐字相同；中止仍是优雅式（停算 + 保留已算部分），worker 模式下 `terminate()` 即时硬停 | 据 任务@2026-10-09（两条路取舍以实测为准：B 的最大不可切块 p50=511/p90=1545/max=2293ms 且恒定是 G2 联合搜索 apply，切不到 50ms 以下；A 墙钟不亏且阻塞归零） | 验 src/composables/__tests__/difficultyCurveWorker.test.ts | 锚 src/composables/difficultyCurveRunner.ts#runDifficultyCurves | 信 确认
 * ⟳复核: 引擎新增影响 calcOutput 的**实例参数或线程局部状态**时复核——worker 内的 memo / 模块级单例是**另一份**（`useResourceCalc` 的跨实例共享只在同线程成立），若将来有状态不能只靠 postMessage 的输入重建，则本口径的「逐位不变」前提失效 | 到期 2027-01-09
 */
import { toRaw } from 'vue'
import { computeDifficultyCurves, type DifficultyCurveRow } from '@/composables/difficultyCurve'
import { withAnalysisScenario } from '@/composables/analysisScenario'
import type { DifficultyWeights } from '@/composables/teamCompare'
import type { BossPreset, BossPresetPhase } from '@/types/bossPreset'
import type { TeamPreset } from '@/types/teamPreset'
import type { RowFusionRule } from '@/logicEditor/types'

/**
 * 一次曲线运行的全部输入。**必须全是 structuredClone 可传的纯数据**——
 * 直接把响应式代理 postMessage 会抛 `DataCloneError`（`analysisScenario.ts` 记过同款事故）。
 *
 * ⚠️ **不要依赖调用方自觉**：`postMessage` 边界一律经 `toCloneable()` 兜底（见其注释）——
 * 实机踩到过：`boss` / `phase` 来自页面的 `ref<BossPreset[]>`，经 `.value` 取出的仍是
 * **响应式代理**，`postMessage` 直接抛 `DataCloneError`，页面表现为「点了计算曲线不出图」。
 */
export interface CurveRunRequest {
  /** UI config store 的现场快照（`cloneConfigState(configStore.$state)`） */
  configState: Record<string, unknown>
  /**
   * 生效的行融合规则（logicEditor store 的 `state.rowFusions` 深拷贝）。
   * worker 内 `typeof window === 'undefined'` ⇒ 读盘回落 spec 默认 ⇒ **必须显式传**，否则用户改过的规则静默丢失。
   */
  fusionRules: RowFusionRule[]
  presets: TeamPreset[]
  boss: BossPreset
  phase: BossPresetPhase
  difficultyWeights?: DifficultyWeights
}

/**
 * postMessage 边界的**结构化克隆兜底**：递归 `toRaw` 后再交结构化克隆。
 *
 * 为什么需要（实机事故，2026-10-09）：Vue 的 `ref` / `reactive` 里取出的一切都是 **Proxy**，
 * 而 `structuredClone` / `postMessage` **不认 Proxy**（抛 `DataCloneError`）。页面的
 * `selectedBoss` / `selectedPhase` 正是 `ref<BossPreset[]>` 的 computed 产物 ⇒ 原样传必炸，
 * 症状是「点计算曲线不出图」（与 `analysisScenario.ts` 记录的 `RefImpl` 事故同族）。
 *
 * 为什么不用 `cloneConfigState`：它是 **config store 专用**（逐键解 ref、保留 undefined/NaN），
 * 对任意领域对象（preset / boss / phase）语义不保证。这里只要「能被结构化克隆」这一条，
 * 用 `toRaw` 剥代理后交平台克隆即可——`toRaw` 只剥一层，故递归。
 */
export function toCloneable<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value
  const raw = toRaw(value)
  if (Array.isArray(raw)) return raw.map(item => toCloneable(item)) as unknown as T
  // 非普通对象（Date / Map / Set / 类实例…）交平台克隆，其内部字段由 structuredClone 自己走
  const proto = Object.getPrototypeOf(raw)
  if (proto !== Object.prototype && proto !== null) return raw
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(raw)) out[key] = toCloneable((raw as Record<string, unknown>)[key])
  return out as T
}

/** 主↔worker 消息（worker 逐队回传，便于进度与「中止保留已算部分」） */
export type CurveWorkerMessage =
  | { type: 'progress'; index: number; total: number; name: string }
  | { type: 'row'; row: DifficultyCurveRow }
  /** 全部队跑完（正常收尾） */
  | { type: 'done' }
  /** 中途失败：`error` 是原始 stack，**不吞**——调用方按「一行未产出」判是否回落主线程 */
  | { type: 'error'; error: string }

export interface CurveRunHooks {
  /** 中止信号（`batchTask#BatchRun.signal`）：worker 模式下即时 terminate，回落模式下在队边界生效 */
  signal?: AbortSignal
  onProgress?: (index: number, total: number, name: string) => void
}

export interface CurveRunOutcome {
  rows: DifficultyCurveRow[]
  /** true = 被中止（`rows` 是已算部分，调用方决定发布还是丢弃） */
  aborted: boolean
  /** true = 真的走了 worker（诊断/测试用；false = 回落主线程） */
  usedWorker: boolean
}

/** 本环境能否起 Web Worker（node/vitest = false ⇒ 一律回落主线程） */
export function curveWorkerSupported(): boolean {
  return typeof Worker !== 'undefined'
}

/**
 * 起一个 worker 跑完整批。**构造失败返回 null**（调用方回落主线程）；
 * 已起但中途报错则 resolve 出**已回传的行**（不吞异常：`error` 消息带原文，调用方自行判断是否回落）。
 */
function startCurveWorker(req: CurveRunRequest, hooks: CurveRunHooks): Promise<CurveRunOutcome> | null {
  let worker: Worker
  try {
    worker = new Worker(new URL('./difficultyCurveWorker.ts', import.meta.url), { type: 'module' })
  } catch {
    return null
  }
  const rows: DifficultyCurveRow[] = []
  return new Promise<CurveRunOutcome>(resolve => {
    let settled = false
    let onAbort: (() => void) | null = null
    const finish = (aborted: boolean) => {
      if (settled) return
      settled = true
      if (onAbort) hooks.signal?.removeEventListener('abort', onAbort)
      try { worker.terminate() } catch { /* 已退出 */ }
      resolve({ rows, aborted, usedWorker: true })
    }
    worker.onmessage = (e: MessageEvent<CurveWorkerMessage>) => {
      const m = e.data
      if (m.type === 'progress') hooks.onProgress?.(m.index, m.total, m.name)
      else if (m.type === 'row') rows.push(m.row)
      else if (m.type === 'error') {
        // 失败原文不吞：一行未产出的失败由调用方回落主线程，已产出部分照常发布
        console.warn('[难度曲线] worker 计算失败：' + m.error)
        finish(false)
      } else finish(false)
    }
    worker.onerror = () => finish(false)
    if (hooks.signal?.aborted) { finish(true); return }
    onAbort = () => finish(true)
    hooks.signal?.addEventListener('abort', onAbort, { once: true })
    // 边界兜底：调用方可能递进响应式代理（页面 selectedBoss/selectedPhase 就是）⇒ 原样传必抛 DataCloneError
    worker.postMessage(toCloneable(req))
  })
}

/**
 * 回落路径 = **worker 化前那条路径**（逐队 `withAnalysisScenario` + 队边界让出主线程）。
 * 刻意不按 `req.configState` 自建场景：直接用 UI 现场与今天逐字节同源，回落语义因此是「行为不变」而非「近似」。
 */
async function runOnMainThread(req: CurveRunRequest, hooks: CurveRunHooks): Promise<CurveRunOutcome> {
  const rows: DifficultyCurveRow[] = []
  for (let i = 0; i < req.presets.length; i++) {
    if (hooks.signal?.aborted) return { rows, aborted: true, usedWorker: false }
    const p = req.presets[i]!
    hooks.onProgress?.(i, req.presets.length, p.name)
    // 队边界让出主线程（worker 化前页面上**唯一**的让出点，回落到这里时逐字保留）
    await new Promise(r => setTimeout(r, 0))
    rows.push(...await withAnalysisScenario(scenario => computeDifficultyCurves(scenario, {
      presets: [p],
      boss: req.boss,
      phase: req.phase,
      difficultyWeights: req.difficultyWeights,
    })))
  }
  return { rows, aborted: false, usedWorker: false }
}

/**
 * 跑一批难度曲线：**能起 worker 就用 worker，否则回落主线程**。
 *
 * 回落判据 = 「worker 一行未产出且未中止」：预设非空时 worker 成功必然逐队产出，故 0 行只可能是
 * 启动/加载失败（如 worker 里 fetch 静态文件失败）。这条比「catch 异常」可靠——worker 的失败
 * 经 `onerror`/`error` 消息到达，不走 Promise rejection。
 */
export async function runDifficultyCurves(req: CurveRunRequest, hooks: CurveRunHooks = {}): Promise<CurveRunOutcome> {
  if (curveWorkerSupported()) {
    const pending = startCurveWorker(req, hooks)
    if (pending) {
      const outcome = await pending
      if (outcome.aborted || outcome.rows.length > 0 || req.presets.length === 0) return outcome
      console.warn('[难度曲线] worker 未产出任何结果，回落主线程计算')
    }
  }
  return runOnMainThread(req, hooks)
}
