/**
 * **交互 × 合轴二维面：worker 运行器**（主线程侧）+ 主↔worker 协议（2026-10-19）。
 *
 * ## 为什么需要它（实测依据）
 *
 * 主线程侧已做逐格 `await` 让出 ⇒ 页面不再整段卡死（实测最大帧间隔 647ms）。但
 * **单格内部**是引擎同步代码——降配格要跑满 8 档 `DOWNSCALE_SCALES` 外层循环，
 * 中间插不进 await ⇒ 实测最长单格 **5.4~5.8s**，且**缩小网格不改善**（8×3 也要 5.4s）。
 * 用户口径 2026-10-19：「对开发和应用有利就可以做」⇒ 换线程。
 *
 * ## 取舍：单 worker，不池化
 *
 * 与 `difficultyCurveRunner`（N 个 worker 动态领队）不同：二维面是**一个工作面**
 * （一支队 × 一个 Boss × 一个网格），拆网格给多 worker 会把复杂度全花在结果拼接与对齐上，
 * 而曲面要求网格完整。单 worker 已足够：主线程彻底解放，网格再大也不卡页面。
 *
 * ## 回落（没有 worker 的环境）
 *
 * `new Worker` 在 node/vitest 里必然抛（无 Worker 构造子）⇒ 返回 null ⇒
 * 调用方回落**主线程那条路径**（`runInteractionSurface` 的 async 分片版）。
 * 两条路径**调的是同一个函数**，故数值逐位相同（判据 `interactionSurfaceWorker.test.ts` ②）。
 *
 * ## 失败语义
 *
 * worker 报错 / 崩掉且**一格未产出** ⇒ 回落主线程（与曲线同一条判据）。
 * 若已产出部分进度后崩掉**也回落**——曲面不完整就没有意义，不能发布半张面。
 *
 * ## 中止
 *
 * `terminate()` 是即时硬停（比主线程版「等这一格跑完」更灵敏）。已算部分**丢弃**：
 * 半张面无法解读（这与曲线「保留已算部分」不同——那里每支队是独立结果）。
 *
 * 判据：`__tests__/interactionSurfaceWorker.test.ts`（① 假 worker 下的协议与进度
 * ② 无 Worker 环境回落主线程且与直接调用**逐位相同** ③ worker 报错回落 ④ 中止即 terminate）。
 */
import { reactive, toRaw } from 'vue'
import type { BatchTaskOptions } from '@/composables/batchTask'
import { cloneConfigState, createAnalysisScenario } from '@/composables/analysisScenario'
import { createConfigModel, type EvalConfig } from '@/stores/config'
import { useCatalogStore } from '@/stores/catalog'
import { runInteractionSurface, type SweepSurface } from '@/composables/interactionSurface'
import type { SurfaceRunRequest, SurfaceWorkerMessage, SurfaceWorkerRequest } from '@/composables/interactionSurfaceWorker'
import { useConfigStore } from '@/stores/config'
import { useLogicEditorStore } from '@/stores/logicEditor'
import type { BossPreset, BossPresetPhase } from '@/types/bossPreset'
import type { TeamPreset } from '@/types/teamPreset'
import type { SweepInteractionKey } from '@/composables/interactionSweep'

/** worker 的最小契约（测试可注入假 worker） */
export interface SurfaceWorkerLike {
  postMessage(message: SurfaceWorkerRequest): void
  terminate(): void
  addEventListener(type: 'message', listener: (e: MessageEvent<SurfaceWorkerMessage>) => void): void
  addEventListener(type: 'error', listener: (e: unknown) => void): void
  addEventListener(type: 'messageerror', listener: (e: unknown) => void): void
  removeEventListener(type: 'message', listener: (e: MessageEvent<SurfaceWorkerMessage>) => void): void
  removeEventListener(type: 'error', listener: (e: unknown) => void): void
  removeEventListener(type: 'messageerror', listener: (e: unknown) => void): void
}

/**
 * postMessage 边界的**结构化克隆兜底**：递归 `toRaw` 后再交平台克隆。
 *
 * Vue 的 `ref` / `reactive` 里取出的一切都是 **Proxy**，而 `structuredClone` / `postMessage`
 * **不认 Proxy**（抛 `DataCloneError`）。`difficultyCurveRunner` 记过同款实机事故
 * （页面 `selectedBoss` 是 `ref` 的 computed 产物 ⇒ 原样传必炸 ⇒「点计算不出图」）。
 */
export function surfaceToCloneable<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value
  const raw = toRaw(value)
  if (Array.isArray(raw)) return raw.map(item => surfaceToCloneable(item)) as unknown as T
  const proto = Object.getPrototypeOf(raw)
  if (proto !== Object.prototype && proto !== null) return raw
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(raw)) out[key] = surfaceToCloneable((raw as Record<string, unknown>)[key])
  return out as T
}

export interface SurfaceRunInput {
  preset: TeamPreset
  boss: BossPreset
  phase: BossPresetPhase
  maxCount: number
  countStep: number
  ratioSteps: number
  absorbCap?: number
  keys?: readonly SweepInteractionKey[]
  /**
   * **已装配好的配置快照**（调用方在临时场景里 applyBossRoom / applyTeamToStore /
   * applyAxisBinding 之后取的 `$state`）。
   *
   * 缺省 = 直接读 UI store 现场（此时**不会**替调用方做 Boss 房 / 队伍装配，
   * 因为那些是页面级语义，runner 不该猜）。页面必须传——否则「现场」与
   * 「一维扫描用的现场」不一致，两条扫描会看到不同的队伍。
   */
  configState?: Record<string, unknown>
  /** 行融合规则；缺省读 logicEditor store（worker 无 window，必须显式带上） */
  fusionRules?: SurfaceRunRequest['fusionRules']
}

/**
 * 运行钩子。
 *
 * 进度形状**复用** `BatchTaskOptions.onProgress`（CC-490：批任务进度载荷只声明一次），
 * 中止信号按 `difficultyCurveRunner` 同款单列 `signal`（那条守卫只拦 onProgress 内联形状；
 * 曲线侧也是这么写的，保持一致比自创第三条通道更重要）。
 */
export interface SurfaceRunOptions extends Pick<BatchTaskOptions, 'onProgress'> {
  /** 中止信号（`batchTask#BatchRun.signal`）：worker 模式下即时 terminate，回落模式下在格边界生效 */
  signal?: AbortSignal
  /** **测试缝**：worker 工厂（缺省 = `new Worker(...)`，环境不支持时返回 null ⇒ 回落主线程） */
  createWorker?: () => SurfaceWorkerLike | null
}

export interface SurfaceRunOutcome {
  surface: SweepSurface
  /** true = 真的走了 worker（诊断/测试用；false = 回落主线程） */
  usedWorker: boolean
  /** true = 被中止（`surface` 不可用，调用方不应发布） */
  aborted: boolean
}

/** 本环境能否起 Web Worker（node/vitest = false ⇒ 一律回落主线程） */
export function surfaceWorkerSupported(): boolean {
  return typeof Worker !== 'undefined'
}

/** 真实 worker 工厂（缺省路径）；构造失败（CSP 禁 worker 等）返回 null ⇒ 回落 */
export function createSurfaceWorker(): SurfaceWorkerLike | null {
  try {
    return new Worker(new URL('./interactionSurfaceWorker.ts', import.meta.url), { type: 'module' }) as unknown as SurfaceWorkerLike
  } catch {
    return null
  }
}

/**
 * 读当前生效的行融合规则。
 *
 * ⚠ `logicEditor` 的 store 是 **setup store**，`$state` 形如 `{ state: { rowFusions: [...] }, … }`
 * ——**不是** `{ rowFusions }`。按后者取会拿到 `undefined`，一路传到 worker 的
 * `setActiveRowFusionRules(undefined)` ⇒ `rules.filter is not a function` ⇒ 整个 worker 崩掉
 * （实测症状：worker 构造成功、控制台无错、但静默回落主线程）。
 * 这里显式兜底成 `[]`（= 不融合），与「用户没改过规则」同义。
 */
function readFusionRules(store: ReturnType<typeof useLogicEditorStore>): SurfaceRunRequest['fusionRules'] {
  const inner = (store.$state as unknown as {
    state?: { rowFusions?: SurfaceRunRequest['fusionRules'] }
  }).state
  return Array.isArray(inner?.rowFusions) ? inner.rowFusions : []
}

/**
 * **本次运行的快照**：从 UI store 读一次，喂给 worker 或主线程回落。
 *
 * ⚠ 必须在这里读（不要在 worker 里读）：worker 没有页面的 store。
 * `cloneConfigState` 是 config store 的深拷贝唯一入口（它按响应式读、能解 ref）。
 */
function captureRequest(input: SurfaceRunInput): SurfaceRunRequest {
  const configStore = useConfigStore()
  const logicStore = useLogicEditorStore()
  return surfaceToCloneable({
    // $state 的具体类型对 worker 无意义（那边只按 key 逐条写回 config model），窄化成纯数据表
    configState: input.configState
      ?? (cloneConfigState(configStore.$state) as unknown as Record<string, unknown>),
    fusionRules: input.fusionRules ?? readFusionRules(logicStore),
    preset: input.preset,
    boss: input.boss,
    phase: input.phase,
    maxCount: input.maxCount,
    countStep: input.countStep,
    ratioSteps: input.ratioSteps,
    ...(input.absorbCap === undefined ? {} : { absorbCap: input.absorbCap }),
    ...(input.keys === undefined ? {} : { keys: input.keys }),
  } satisfies SurfaceRunRequest)
}

/**
 * 主线程回落路径：**调的就是 worker 里那个函数**，故数值逐位相同。
 *
 * ⚠ 场景必须从 `req.configState` 复刻，**不能**用 `withAnalysisScenario()` 的缺省
 * （那是 UI store 现场）——worker 与回落必须看同一份输入，否则两条路径给出不同的队伍
 * （实测症状：回落出的 `series.length === 0`，因为 UI 现场里没有这支队的交互基线，
 * 交互类型过滤把所有类型都滤掉了）。
 */
async function runOnMainThread(req: SurfaceRunRequest, opts: SurfaceRunOptions): Promise<SurfaceRunOutcome> {
  const catalog = useCatalogStore()
  const scenario = createAnalysisScenario(createPreparedConfig(catalog, req.configState), catalog)
  try {
    const surface = await runInteractionSurface(scenario, {
      preset: req.preset,
      boss: req.boss,
      phase: req.phase,
      maxCount: req.maxCount,
      countStep: req.countStep,
      ratioSteps: req.ratioSteps,
      ...(req.absorbCap === undefined ? {} : { absorbCap: req.absorbCap }),
      ...(req.keys === undefined ? {} : { keys: req.keys }),
      ...(opts.onProgress ? { onProgress: opts.onProgress } : {}),
      ...(opts.signal ? { control: { signal: opts.signal } } : {}),
    })
    return { surface, usedWorker: false, aborted: opts.signal?.aborted === true }
  } finally {
    scenario.dispose()
  }
}

/**
 * 用 `configState` 建一个装配好的配置模型（worker 内与主线程回落共用同一构造）。
 *
 * 与 `interactionSurfaceWorker#init` 里那段逐字同构：`createConfigModel(catalog, state)`
 * + 把 state 的每个键做成 `$state` 视图（memo 键读它，键集合必须与源一致）。
 */
function createPreparedConfig(
  catalog: ReturnType<typeof useCatalogStore>,
  configState: Record<string, unknown>,
): EvalConfig {
  const stateKeys = Object.keys(configState)
  const model = createConfigModel(catalog, configState) as unknown as Record<string, unknown>
  const $state = reactive(Object.fromEntries(stateKeys.map(key => [key, model[key]])))
  return reactive({ ...model, $state }) as unknown as EvalConfig
}

/** worker 路径：一次 run → ready/progress…/done；任何失败 ⇒ 抛，由调用方回落 */
function runOnWorker(
  worker: SurfaceWorkerLike,
  req: SurfaceRunRequest,
  opts: SurfaceRunOptions,
): Promise<SweepSurface> {
  return new Promise<SweepSurface>((resolve, reject) => {
    let settled = false
    const cleanup = () => {
      worker.removeEventListener('message', onMessage)
      worker.removeEventListener('error', onError)
      worker.removeEventListener('messageerror', onError)
      try { worker.terminate() } catch { /* 已退出 */ }
    }
    const fail = (e: unknown) => {
      if (settled) return
      settled = true
      cleanup()
      reject(e instanceof Error ? e : new Error(String(e)))
    }
    const onMessage = (e: MessageEvent<SurfaceWorkerMessage>) => {
      const msg = e.data
      if (msg.type === 'ready') {
        opts.onProgress?.({ pct: 0, text: 'worker 就绪…' })
        return
      }
      if (msg.type === 'progress') {
        opts.onProgress?.({ pct: msg.done / 100, text: '二维面（worker）' })
        return
      }
      if (msg.type === 'error') { fail(new Error(msg.error)); return }
      if (msg.type === 'done') {
        if (settled) return
        settled = true
        cleanup()
        resolve(msg.surface)
      }
    }
    const onError = (e: unknown) => fail(e)
    worker.addEventListener('message', onMessage)
    worker.addEventListener('error', onError)
    worker.addEventListener('messageerror', onError)
    if (opts.signal?.aborted) { fail(new DOMException('已中止', 'AbortError')); return }
    opts.signal?.addEventListener('abort', () => fail(new DOMException('已中止', 'AbortError')), { once: true })
    try {
      worker.postMessage({ type: 'run', request: req })
    } catch (e) {
      fail(e)
    }
  })
}

/**
 * 跑一次二维面：**优先 worker，失败回落主线程**。
 *
 * 两条路径的数值口径完全相同（调同一个 `runInteractionSurface`），差别只在哪个线程跑。
 */
export async function runSurfaceInWorker(
  input: SurfaceRunInput,
  opts: SurfaceRunOptions = {},
): Promise<SurfaceRunOutcome> {
  const req = captureRequest(input)
  const factory = opts.createWorker ?? createSurfaceWorker
  const worker = factory()
  if (!worker) return runOnMainThread(req, opts)
  try {
    const surface = await runOnWorker(worker, req, opts)
    return { surface, usedWorker: true, aborted: false }
  } catch (err) {
    /**
     * worker 失败 ⇒ 回落主线程，绝不把半张面交出去。
     *
     * ⚠ **不静默**：这条回落是「有 worker 但用不了」的信号（CSP / 模块解析 / 结果不可克隆…）。
     * 静默回落会让「以为在跑 worker」的判断一直错下去（实测踩过：主线程版进度文案
     * 「二维面 65/112 格」出现在本该走 worker 的路径上，却没有任何报错）。
     * 用 `console.warn` 留痕（不进 error：用户不该为内部回退看到红色报错）。
     */
    console.warn('[interactionSurfaceRunner] worker 通道失败，已回落主线程：', err)
    return runOnMainThread(req, opts)
  }
}
