/**
 * **交互 × 合轴二维面 worker**（2026-10-19，全仓第二个 Web Worker）。
 *
 * 职责：在独立线程里跑 `runInteractionSurface`，把主线程从「单格最长 5.8s 不可切分同步段」
 * 里解放出来（降配格内部要跑满 8 档 `DOWNSCALE_SCALES` 外层循环，中间插不进 await）。
 *
 * ## 为什么必须 worker（实测依据）
 *
 * 主线程侧已做了逐格 `await` 让出（`interactionSurface.ts`），页面不再整段卡死
 * （实测最大帧间隔 647ms）。但**单格内部**是引擎的同步代码，缩小网格也不改善
 * （实测 8×3 网格最长单格仍 5.4s）⇒ 只能换线程。
 *
 * ## 协议（单工作面，不池化）
 *
 * 主 → worker：`{type:'run', request}`（一次性把场景现场 + 网格参数传齐）
 * worker → 主：`ready`（场景建好）→ 多个 `progress`（每格一次）→ `done`（整份结果）
 *          或 `error`。
 *
 * 与 `difficultyCurveWorker` 的差别：那张面是**一个工作面**（一支队 × 一个 Boss × 一个网格），
 * 不像曲线那样有 N 支队可池化 ⇒ 单 worker 足够；多 worker 反而要拆网格、结果拼接，
 * 复杂度全花在拼接上（且曲面要求网格完整，拆了还得对齐）。
 *
 * ## worker 里为什么要自建 pinia + catalog
 *
 * 与 `difficultyCurveWorker` 同因：引擎链的输入分两类——① 静态目录数据（catalog /
 * teammate-buffs / build-recommendations）worker **自己 fetch**（1.48MB，走 postMessage 每次都要克隆）；
 * ② 用户现场（configState + 融合规则）随请求传（纯数据）。
 *
 * ⚠ `teammateBuffsReady` 是引擎的就绪门：三个静态文件**必须全部 await 完**再算，
 * 否则 `resourceConfig` 为 null、伤害静默走空值（实测症状：85.86M 变 37.43M，不报错）。
 *
 * ⚠ 行融合规则必须显式传：worker 里没有页面 store / 启动入口，主线程激活的规则（spec 默认或测试自定义）
 * 读不到 ⇒ 规则随请求传（`currentRowFusionRules()`）；漏传则数值静默漂移。
 */
import { createPinia, setActivePinia } from 'pinia'
import { reactive } from 'vue'
import { useCatalogStore } from '@/stores/catalog'
import { createConfigModel, type EvalConfig } from '@/stores/config'
import { createAnalysisScenario } from '@/composables/analysisScenario'
import { runInteractionSurface, type SurfaceOptions, type SweepSurface } from '@/composables/interactionSurface'
import { setActiveRowFusionRules } from '@/logicEditor/fusion'
import type { BossPreset, BossPresetPhase } from '@/types/bossPreset'
import type { TeamPreset } from '@/types/teamPreset'
import type { RowFusionRule } from '@/logicEditor/types'
import type { SweepInteractionKey } from '@/composables/interactionSweep'

/** 一次二维面运行的全部输入（**必须全是 structuredClone 可传的纯数据**） */
export interface SurfaceRunRequest {
  /** UI config store 的现场快照（`cloneConfigState(configStore.$state)`） */
  configState: Record<string, unknown>
  /** 生效的行融合规则（worker 无 window ⇒ 不传就读不到，见文件头） */
  fusionRules: RowFusionRule[]
  preset: TeamPreset
  boss: BossPreset
  phase: BossPresetPhase
  maxCount: number
  countStep: number
  ratioSteps: number
  absorbCap?: number
  keys?: readonly SweepInteractionKey[]
}

export type SurfaceWorkerMessage =
  /** 场景就绪（catalog 三件套 + 融合规则 + 源现场都建好了） */
  | { type: 'ready' }
  /** 已算格数 / 总格数（驱动页面进度条） */
  | { type: 'progress'; done: number; total: number }
  /** 整份结果（曲面必须完整，故不逐格回传） */
  | { type: 'done'; surface: SweepSurface }
  /** 失败：`error` 是原始 stack，**不吞**——调用方据此回落主线程 */
  | { type: 'error'; error: string }

export type SurfaceWorkerRequest = { type: 'run'; request: SurfaceRunRequest }

/** 类型化的 postMessage（`self` 在 DOM lib 里是 Window & typeof globalThis，需收窄到 worker 侧） */
const ctx = self as unknown as {
  postMessage(message: SurfaceWorkerMessage): void
  onmessage: ((e: MessageEvent<SurfaceWorkerRequest>) => void) | null
}

async function run(req: SurfaceRunRequest): Promise<void> {
  // worker 里没有主线程的 pinia 实例：自建一个，只为让 catalog / config model 能构造
  setActivePinia(createPinia())
  const catalog = useCatalogStore()
  // 三个静态文件全部就绪才算「引擎可算」（见文件头：缺一个 ⇒ 静默走空值，不报错）
  await catalog.load()
  await catalog.loadTeammateBuffs()
  await catalog.loadBuildRecommendations()
  setActiveRowFusionRules(req.fusionRules)

  // 复刻 `createAnalysisScenario` 的场景构造：用 UI 现场快照建源，再从它派生场景
  const stateKeys = Object.keys(req.configState)
  const model = createConfigModel(catalog, req.configState) as unknown as Record<string, unknown>
  const $state = reactive(Object.fromEntries(stateKeys.map(key => [key, model[key]])))
  const source = reactive({ ...model, $state }) as unknown as EvalConfig

  const scenario = createAnalysisScenario(source, catalog)
  ctx.postMessage({ type: 'ready' })
  try {
    const options: SurfaceOptions = {
      preset: req.preset,
      boss: req.boss,
      phase: req.phase,
      maxCount: req.maxCount,
      countStep: req.countStep,
      ratioSteps: req.ratioSteps,
      ...(req.absorbCap === undefined ? {} : { absorbCap: req.absorbCap }),
      ...(req.keys === undefined ? {} : { keys: req.keys }),
      onProgress: p => ctx.postMessage({
        type: 'progress',
        done: Math.round(p.pct * 100),
        total: 100,
      }),
    }
    const surface = await runInteractionSurface(scenario, options)
    ctx.postMessage({ type: 'done', surface })
  } finally {
    scenario.dispose()
  }
}

ctx.onmessage = async (e: MessageEvent<SurfaceWorkerRequest>) => {
  try {
    await run(e.data.request)
  } catch (err) {
    ctx.postMessage({ type: 'error', error: String((err as Error)?.stack ?? err) })
  }
}
