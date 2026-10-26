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
 * ## 池化（2026-10-16 T181：单 worker 串行 → N worker 动态领队）
 *
 * 池化前只有 1 个 worker、队在它内部 `for` 串行 ⇒ 单队 0.8–9.6s、8 队实测 **34.3s**，
 * 而机器 16 核、单 worker 只占 1 核。同队集 4 进程并行实测 **12.5s（2.7×）**、内存 +31MB/进程
 * ⇒ 池化是**近乎线性的纯提速**（数值路径零改动：worker 调的仍是同一个 `computeDifficultyCurves`）。
 * 池大小 = `min(6, 队数)`（见 `curveWorkerPoolSize`），调度与不变量见 `runWithWorkerPool`。
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
 * - **worker 内必须自带行融合规则**：worker 里没有页面 store / 启动入口，主线程激活的规则
 *   （spec 默认或测试自定义）读不到 ⇒ 规则随请求一起传（`fusionRules`，来源 `currentRowFusionRules()`）。
 *   漏传的实测症状 = 数值静默不同（本次实验先踩到过一次同类：漏传 build-recommendations 让
 *   base 从 85.86M 变 37.43M）。
 *
 * 判据：`__tests__/difficultyCurveWorker.test.ts`（① `DifficultyCurveRow` 的 structuredClone 契约
 * ② 无 Worker 环境回落主线程且与直接调用**逐位相同** ③ **池化调度**：假 worker 下动态派发 / 顺序归位 /
 * 中止保留已算部分 / 单 worker 死亡后重派）。
 *
 * @fact engine:难度曲线/运行线程 口径: 难度曲线整批跑在 **Web Worker 池**里（池大小 `min(6, 队数)`，见 `curveWorkerPoolSize`；worker 自建 pinia+catalog、自 fetch 静态数据、init 一次后逐队领活，逐行回传带 `presetIndex` 的 `DifficultyCurveRow` ⇒ **结果顺序 = 输入顺序**）；无 `Worker` 的环境（node/vitest）与 worker 启动失败（一行未产出）**回落主线程原路径**，回落语义 = 改动前逐字相同；中止仍是优雅式（停算 + 保留已算部分），worker 模式下 `terminate()` 即时硬停；单 worker 崩溃 ⇒ 它未算完的队**重派**给别的 worker（不整批放弃） | 据 任务@2026-10-09（两条路取舍以实测为准：B 的最大不可切块 p50=511/p90=1545/max=2293ms 且恒定是 G2 联合搜索 apply，切不到 50ms 以下；A 墙钟不亏且阻塞归零）+ 实测@2026-10-16（单 worker 串行 8 队 34.3s vs 4 进程并行 12.5s = 2.7×；内存 +31MB/进程） | 验 src/composables/__tests__/difficultyCurveWorker.test.ts | 锚 src/composables/difficultyCurveRunner.ts#runDifficultyCurves | 信 确认
 * ⟳复核: 引擎新增影响 calcOutput 的**实例参数或线程局部状态**时复核——worker 内的 memo / 模块级单例是**另一份**（`useResourceCalc` 的跨实例共享只在同线程成立），若将来有状态不能只靠 postMessage 的输入重建，则本口径的「逐位不变」前提失效 | 到期 2027-01-09
 */
import { toRaw } from 'vue'
import { computeDifficultyCurves, type DifficultyCurveOptions, type DifficultyCurveRow, type EnvLane } from '@/composables/difficultyCurve'
import { withAnalysisScenario } from '@/composables/analysisScenario'
import { dedupeSceneBases } from '@/composables/configDelta'
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
   * 生效的行融合规则（`currentRowFusionRules()` 的拷贝；启动时由 spec 默认规则激活）。
   * worker 内没有页面 store / 启动入口 ⇒ **必须显式传**，否则主线程规则静默丢失。
   */
  fusionRules: RowFusionRule[]
  presets: TeamPreset[]
  boss: BossPreset
  phase: BossPresetPhase
  difficultyWeights?: DifficultyWeights
  /**
   * **环境模式的道表**（用户 2026-10-13）：`presetId → 该队要跑的各期`。
   * 缺省 = 无环境（每队一条道、用 `phase`、不吃 buff），与改动前逐位相同。
   *
   * ⚠ 必须是**纯数据**（`toCloneable` 兜底）：worker 里读不到页面 store，`lanesOf` 这类函数
   * 过不了 postMessage ⇒ 页面在**发请求前**把「该队要跑哪几期 + 每期哪些牌」算好成表传进来
   * （与 `fusionRules` 同一条硬约束，见本文件头）。
   */
  environment?: {
    lanes: Record<string, EnvLane[]>
    buffMode: 'none' | 'auto' | 'manual'
    manualBuffTitle?: string
  }
  /**
   * **采每档现场差分**（用户 2026-10-16「能显示其资源池吗」）：每行带 `sceneBase`、每点带 `scene`，
   * 页面据此**按需重算**该档完整资源池（不随点携带 41.5KB 的整份结果）。
   * 缺省 false ⇒ 载荷与行为与改动前逐字节相同（判据 `difficultyCurve.test.ts::缺省不采`）。
   */
  collectScenes?: boolean
  /**
   * **算「非轴参照曲线」**（用户口径 2026-10-16）：「我本意是想展示**非轴模式**的数据的，
   * 表示**模拟均匀战斗**而不是集中利用失衡易伤」。
   *
   * 缺省 false ⇒ 载荷与行为与改动前逐字节相同；开启后每点多一次完整求值（点 1~4）。
   */
  collectNoAxis?: boolean
  /**
   * **每队配置码覆盖**（用户 2026-10-26：「我从上面勾选的队伍也能写配置码」）。
   * `presetId → SlotOverrides`；纯数据（worker 边界可 clone）。
   * 缺省不传 ⇒ 逐位不变（只有预设自带 `slotCodes` 生效）。
   */
  slotOverridesByPreset?: Record<string, import('@/composables/presetSlotOverrides').SlotOverrides>
}

/** 请求里的环境表 → `DifficultyCurveOptions.environment`（主线程回落 / worker 两条路径共用，防止口径漂移） */
export function environmentOptions(req: CurveRunRequest): DifficultyCurveOptions['environment'] {
  if (!req.environment) return undefined
  const table = req.environment
  return {
    lanesOf: presetId => table.lanes[presetId] ?? [],
    buffMode: table.buffMode,
    ...(table.manualBuffTitle === undefined ? {} : { manualBuffTitle: table.manualBuffTitle }),
  }
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

/**
 * 主↔worker 消息。
 *
 * ## 协议（池化后）
 *
 * 主 → worker：`{type:'init', request}`（建场景 + 自 fetch 静态数据，完成后回 `ready`）
 * → 之后每条 `{type:'preset', index}` 算**一个**预设（预设表在 `request.presets` 里，索引寻址，
 * 不重复传队伍数据）。
 *
 * worker → 主：`ready` / `progress` / `row`（带 `presetIndex`，主线程按它归位 ⇒ 结果顺序与输入一致）
 * / `presetDone`（主线程据此派下一个队）/ `error`。
 */
export type CurveWorkerMessage =
  /** 场景就绪（catalog 三件套 + 行融合规则 + 源现场都建好了），可以开始派队 */
  | { type: 'ready' }
  | { type: 'progress'; index: number; total: number; name: string }
  | { type: 'row'; presetIndex: number; row: DifficultyCurveRow }
  /** 该预设算完（含 0 行的情形）——主线程据此把下一个队派给这个 worker */
  | { type: 'presetDone'; presetIndex: number }
  /** 中途失败：`error` 是原始 stack，**不吞**——调用方按「一行未产出」判是否回落主线程 */
  | { type: 'error'; error: string }

/** 主 → worker 消息 */
export type CurveWorkerRequest =
  | { type: 'init'; request: CurveRunRequest }
  | { type: 'preset'; index: number }

/**
 * worker 的最小契约。
 *
 * 为什么不用 DOM 的 `Worker` 类型：node/vitest 没有它，而**池化调度本身**（动态派发 / 顺序归位 /
 * 中止 / 单 worker 死亡后重派）正是最容易错、也最值得测的部分。声明这个窄接口后，测试可以注入一个
 * 「假 worker」（同步跑同一套 `computeDifficultyCurves`），在 node 里把池化路径完整跑一遍
 * ——这是 worker 化以来第一次能测 worker 侧调度（此前只能测回落路径）。
 */
export interface CurveWorkerLike {
  postMessage(message: unknown): void
  terminate(): void
  onmessage: ((e: { data: CurveWorkerMessage }) => void) | null
  onerror: ((e: unknown) => void) | null
}

export interface CurveRunHooks {
  /** 中止信号（`batchTask#BatchRun.signal`）：worker 模式下即时 terminate，回落模式下在队边界生效 */
  signal?: AbortSignal
  onProgress?: (index: number, total: number, name: string) => void
  /**
   * **测试缝**：worker 工厂（缺省 = `new Worker(...)`，环境不支持时返回 null）。
   * 生产不传 ⇒ 走真实 worker；测试传假 worker ⇒ 在 node 里跑通池化调度。
   */
  createWorker?: () => CurveWorkerLike | null
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
 * 真实 worker 工厂（缺省路径）。
 *
 * `new Worker` 在 node/vitest 里必然抛（没有 Worker 构造子）⇒ 返回 null，调用方回落主线程。
 * 生产环境构造失败（如 CSP 禁 worker）也返回 null，走同一条回落。
 */
export function createCurveWorker(): CurveWorkerLike | null {
  try {
    return new Worker(new URL('./difficultyCurveWorker.ts', import.meta.url), { type: 'module' }) as unknown as CurveWorkerLike
  } catch {
    return null
  }
}

/** 一个 worker 的运行时状态（池的最小单元） */
interface PoolWorker {
  worker: CurveWorkerLike
  ready: boolean
  /** 正在算的预设下标；null = 空闲 */
  busy: number | null
  /** 该 worker 已死（error / terminate）——不再派活，其已回传的行仍算数 */
  dead: boolean
}

/**
 * **worker 池调度**：N 个 worker 各建一次场景，按「谁空派谁」动态领队，结果按 `presetIndex` 归位。
 *
 * ## 为什么池化（实测 2026-10-16 T181）
 *
 * 此前只有 **1 个** worker、队在它内部 `for` 串行 ⇒ 单队 0.8–9.6s、8 队实测 **34.3s**，
 * 而机器 16 核、单 worker 只占 1 核。同队集 4 进程并行实测 **12.5s（2.7×）**，几乎线性。
 *
 * ## 顺序与中止（两条不变量）
 *
 * 1. **结果顺序 = 输入顺序**：`rows` 预置成与 `presets` 等长的槽位，收到 `row` 时按
 *    `presetIndex` 写进自己的槽 ⇒ 与串行版**逐位同序**（曲线图 / 摘要表都按输入顺序读）。
 *    某个预设 0 行（环境模式下该期无道）时槽位保持空数组 ⇒ 拼接后自然跳过它。
 * 2. **中止 = 优雅式（保留已算部分）**：中止即 `terminate()` 全部 worker，已回传的行照常发布
 *    ——与单 worker 版 `terminate()` 的语义逐字相同（`batchTask` 的唯一口径）。
 *
 * ## 失败语义
 *
 * 某个 worker `error` / 崩掉 ⇒ 只把它标 `dead`，**它没算完的队重新入队**（另一个 worker 接着算），
 * 不整批放弃。全部 worker 都死了且**一行未产出** ⇒ 由调用方回落主线程（与单 worker 版同判据）。
 */
function runWithWorkerPool(
  req: CurveRunRequest,
  hooks: CurveRunHooks,
  factory: () => CurveWorkerLike | null,
): Promise<CurveRunOutcome> {
  const total = req.presets.length
  /** 每个预设的结果行（槽位对齐输入顺序；同一预设多道 = 多行） */
  const rows: DifficultyCurveRow[][] = req.presets.map(() => [])
  /** 待派发的预设下标队列（FIFO；失败的 worker 把没算完的队塞回队首） */
  const pending: number[] = req.presets.map((_, i) => i)
  const pool: PoolWorker[] = []
  const concurrency = Math.min(curveWorkerPoolSize(), Math.max(1, total))
  let aborted = false
  let settled = false
  let anyRow = false
  let doneCount = 0

  return new Promise<CurveRunOutcome>(resolve => {
    const cleanup = () => {
      if (hooks.signal && onAbort) hooks.signal.removeEventListener('abort', onAbort)
      for (const w of pool) { try { w.worker.terminate() } catch { /* 已退出 */ } }
    }
    const finish = (wasAborted: boolean) => {
      if (settled) return
      settled = true
      aborted = wasAborted
      cleanup()
      resolve({ rows: rows.flat(), aborted, usedWorker: true })
    }
    const onAbort = () => finish(true)
    if (hooks.signal?.aborted) { finish(true); return }
    hooks.signal?.addEventListener('abort', onAbort, { once: true })

    /** 派活：给空闲且未死的 worker 各发一个队（没有待派就什么都不做） */
    const dispatch = () => {
      if (settled) return
      for (const w of pool) {
        if (settled) return
        if (w.dead || !w.ready || w.busy !== null) continue
        const next = pending.shift()
        if (next === undefined) return
        w.busy = next
        w.worker.postMessage({ type: 'preset', index: next } satisfies CurveWorkerRequest)
      }
    }

    for (let i = 0; i < concurrency; i++) {
      const worker = factory()
      if (!worker) break
      const entry: PoolWorker = { worker, ready: false, busy: null, dead: false }
      pool.push(entry)
      worker.onmessage = (e: { data: CurveWorkerMessage }) => {
        const m = e.data
        if (settled) return
        if (m.type === 'ready') { entry.ready = true; dispatch(); return }
        if (m.type === 'progress') { hooks.onProgress?.(m.index, m.total, m.name); return }
        if (m.type === 'row') {
          anyRow = true
          rows[m.presetIndex]?.push(m.row)
          return
        }
        if (m.type === 'presetDone') {
          entry.busy = null
          doneCount++
          if (doneCount >= total) { finish(false); return }
          dispatch()
          return
        }
        // error：原文不吞（诊断）；该 worker 未算完的队重派给别的 worker
        console.warn('[难度曲线] worker 计算失败：' + m.error)
        failWorker(entry)
      }
      worker.onerror = () => failWorker(entry)
      // 边界兜底：调用方可能递进响应式代理（页面 selectedBoss/selectedPhase 就是）⇒ 原样传必抛 DataCloneError
      worker.postMessage({ type: 'init', request: toCloneable(req) } satisfies CurveWorkerRequest)
    }

    /** 一个 worker 死了：它手上没算完的队塞回队首，其余 worker 接着算；全死且零产出 ⇒ 交由调用方回落 */
    function failWorker(w: PoolWorker) {
      if (settled || w.dead) return
      w.dead = true
      if (w.busy !== null) { pending.unshift(w.busy); w.busy = null }
      const alive = pool.some(x => !x.dead)
      if (!alive) {
        if (anyRow) finish(false)
        else resolveFallback()
        return
      }
      dispatch()
    }
    /** 零产出且无可用 worker ⇒ 回落主线程（与单 worker 版「一行未产出」同判据） */
    function resolveFallback() {
      if (settled) return
      settled = true
      cleanup()
      resolve({ rows: [], aborted: false, usedWorker: false })
    }

    if (pool.length === 0) resolveFallback()
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
      environment: environmentOptions(req),
      collectScenes: req.collectScenes,
      collectNoAxis: req.collectNoAxis,
      ...(req.slotOverridesByPreset ? { slotOverridesByPreset: req.slotOverridesByPreset } : {}),
    })))
  }
  return { rows, aborted: false, usedWorker: false }
}

/**
 * 池大小（实测 2026-10-16 T181）：4 个 worker 已把 8 队的墙钟从 34.3s 压到 12.5s（2.7×）。
 *
 * 为什么不是「核数」（16）：每个 worker 是一整个引擎实例 + 自己的 catalog 副本
 * （实测常驻 ~104MB/个，见 `docs/ARCHITECTURE.md` 的性能表），而本应用还要与
 * `dsh web` / vite dev / 用户浏览器共享内存。上限 6 = 在 16 核机器上仍留足余量，
 * 且预设数少时自动降（`min(6, 队数)`）——3 队的常见场景就是 3 个 worker。
 *
 * 可用 `CURVE_WORKER_POOL` 覆盖（排查/基准对比用；非正整数或 0 ⇒ 回落缺省）。
 */
export const CURVE_WORKER_POOL_MAX = 6
export function curveWorkerPoolSize(): number {
  // 与 `core/probeTrace` / `core/resource/foldLoop` 同款：运行时全局用 `unknown as` 收窄
  // （判据 27 禁「类型字面量 as」——那是让缺字段对象编译通过的那一类断言）
  const raw = Number((globalThis as unknown as { CURVE_WORKER_POOL?: unknown }).CURVE_WORKER_POOL ?? 0)
  const n = Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : CURVE_WORKER_POOL_MAX
  return Math.max(1, n)
}

/**
 * 跑一批难度曲线：**能起 worker 就用 worker 池，否则回落主线程**。
 *
 * 回落判据 = 「worker 一行未产出且未中止」：预设非空时 worker 成功必然逐队产出，故 0 行只可能是
 * 启动/加载失败（如 worker 里 fetch 静态文件失败）。这条比「catch 异常」可靠——worker 的失败
 * 经 `onerror`/`error` 消息到达，不走 Promise rejection。
 *
 * ⚠ `hooks.createWorker` 只作用于 **worker 路径**（测试缝）：传了它就跳过 `curveWorkerSupported()`
 * 的环境探测——测试要验的正是「池化调度」，而 node 里没有 `Worker`。
 */
export async function runDifficultyCurves(req: CurveRunRequest, hooks: CurveRunHooks = {}): Promise<CurveRunOutcome> {
  const factory = hooks.createWorker ?? (curveWorkerSupported() ? createCurveWorker : null)
  if (factory) {
    const outcome = await runWithWorkerPool(req, hooks, factory)
    if (outcome.aborted || outcome.rows.length > 0 || req.presets.length === 0) return dedupeOutcomeBases(outcome)
    console.warn('[难度曲线] worker 未产出任何结果，回落主线程计算')
  }
  return dedupeOutcomeBases(await runOnMainThread(req, hooks))
}

/**
 * **基线去重**（主线程侧统一后处理，两条路径都覆盖）。
 *
 * 页面口径是逐队一个新场景 ⇒ 每行的 `sceneBase` 都是**独立拷贝**（实测 10.9KB/份，8 队 = 87KB 纯重复，
 * 而差分只有 2.1KB/档）。这里把内容相同的基线归一化成同一个对象——**只在内容相同时复用**
 * （见 `configDelta#dedupeSceneBases` 的安全论证）。
 *
 * ⚠ 放这里而不是页面：worker 与回落两条路径都要覆盖，而页面只走其中一条。
 */
function dedupeOutcomeBases(outcome: CurveRunOutcome): CurveRunOutcome {
  const bases = dedupeSceneBases(outcome.rows.map(r => r.sceneBase))
  outcome.rows.forEach((r, i) => {
    const b = bases[i]
    if (b) r.sceneBase = b
  })
  return outcome
}
