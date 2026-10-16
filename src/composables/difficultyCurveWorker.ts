/**
 * 难度曲线 worker 入口（**全仓第一个 Web Worker**，2026-10-09；2026-10-16 T181 池化）。
 *
 * 职责：在独立线程里跑 `computeDifficultyCurves`，把主线程从「单队 3~4s 不可切分同步段」里解放出来。
 * 主线程侧的协议、池化调度、取舍依据与实测读数见 `./difficultyCurveRunner.ts` 文件头（**先读它**）。
 *
 * ## 协议（池化后：init 一次 + 逐队领活）
 *
 * `{type:'init', request}` → 建场景 + 自 fetch 静态数据 → 回 `ready`；
 * 之后每条 `{type:'preset', index}` 算 `request.presets[index]` 这一个预设，逐行回 `row`
 * （带 `presetIndex`，主线程按它归位），算完回 `presetDone` 等下一个队。
 *
 * 为什么「init 一次 + 索引寻址」而不是每队一条完整请求：队伍数据（preset / boss / phase / 环境道表）
 * 在整批里是同一份，重复传只会让每条消息多几 KB 的克隆；而 `configState` 与 `fusionRules`
 * 在整批里也恒定（曲线只改**场景内**的副本）。
 *
 * ## 为什么 worker 里要自建一套 pinia + catalog
 *
 * 引擎链的输入有两类：① 静态目录数据（catalog / teammate-buffs / build-recommendations）② 用户现场
 * （config store 的 `$state` + 行融合规则）。① **必须 worker 自己 fetch**——它 1.48MB，
 * 走 postMessage 每次运行都要克隆一遍（实测 3 队墙钟 13911ms 里 postMessage 只占 ~3ms，
 * 但那是**首条消息传 JSON 字符串**的口径；让 worker 自己 fetch 更省，且与主线程同源同缓存）；
 * ② 随请求传（纯数据，~12KB）。
 *
 * ⚠️ **`teammateBuffsReady` 是引擎的就绪门**（`useResourceCalc` 的 `resourceConfig` 未就绪返回 null）：
 * 三个静态文件**必须全部 await 完**再算，否则 `resourceConfig` 为 null、伤害静默走空值。
 * 实测症状：漏 `build-recommendations.json` 时同一队 base 从 85.86M 变 37.43M（**不报错**）。
 *
 * ## 行融合规则必须显式传
 *
 * `logicEditor/storage.ts#loadLogicEditorState` 在 `typeof window === 'undefined'` 时**直接返回 spec 默认规则**。
 * worker 里没有 `window` ⇒ 用户改过的融合规则读不到 ⇒ 数值静默漂移。故 `setActiveRowFusionRules(req.fusionRules)`
 * 是**必须**的一步，不是优化。
 *
 * ## 每个 preset 一个新场景
 *
 * 与主线程 `withAnalysisScenario` 逐队一次同形：`computeDifficultyCurves` 会改写 config（applyBossRoom /
 * 轴绑定 / 阶梯试开），跨队共享一个场景会让上一队的残留影响下一队（`difficultyCurve.ts` 记过
 * 「上一队 G5 残留值被下一队当成用户上限」的实测缺陷）。这里每队 `createAnalysisScenario` → `dispose`，
 * 与主线程逐队 `withAnalysisScenario` 逐字同构。
 *
 * ⚠ **场景必须从 `source` 派生、`source` 必须只建一次**：池化后 `source` 的构造（含 `configState` 的
 * 逐键写入）只在 `init` 时做一次，逐队派生只克隆它的现场——这正是「跨队不串味」与「每队场景独立」
 * 两条约束同时成立的方式（与池化前的逐队 `createAnalysisScenario(source)` 逐字相同）。
 */
import { createPinia, setActivePinia } from 'pinia'
import { reactive } from 'vue'
import { useCatalogStore } from '@/stores/catalog'
import { createConfigModel, type EvalConfig } from '@/stores/config'
import { createAnalysisScenario } from '@/composables/analysisScenario'
import { computeDifficultyCurves } from '@/composables/difficultyCurve'
import { setActiveRowFusionRules } from '@/logicEditor/fusion'
import {
  environmentOptions, type CurveRunRequest, type CurveWorkerMessage, type CurveWorkerRequest,
} from '@/composables/difficultyCurveRunner'

/** 类型化的 postMessage（`self` 在 DOM lib 里是 Window & typeof globalThis，需收窄到 worker 侧） */
const ctx = self as unknown as {
  postMessage(message: CurveWorkerMessage): void
  onmessage: ((e: MessageEvent<CurveWorkerRequest>) => void) | null
}

/** init 之后常驻的求值上下文（`null` = 还没 init / init 失败） */
let session: { req: CurveRunRequest; source: EvalConfig; catalog: ReturnType<typeof useCatalogStore> } | null = null

/** 初始化（幂等：重复 init 只重建 source，不重复 fetch） */
async function init(req: CurveRunRequest): Promise<void> {
  // worker 里没有主线程的 pinia 实例：自建一个，只为让 catalog / config model 能构造
  setActivePinia(createPinia())
  const catalog = useCatalogStore()
  // 三个静态文件全部就绪才算「引擎可算」（见文件头：缺一个 ⇒ 静默走空值，不报错）
  await catalog.load()
  await catalog.loadTeammateBuffs()
  await catalog.loadBuildRecommendations()
  // 见文件头：worker 无 window ⇒ 读盘回落 spec 默认，必须由请求显式带入
  setActiveRowFusionRules(req.fusionRules)
  // 复刻 `createAnalysisScenario` 的场景构造（model 带 initialState + `$state` 视图）：
  // 直接用 UI 现场快照建一个「源」，再逐队从它派生场景——与主线程 withAnalysisScenario(逐队) 同构
  const stateKeys = Object.keys(req.configState)
  const model = createConfigModel(catalog, req.configState) as unknown as Record<string, unknown>
  const $state = reactive(Object.fromEntries(stateKeys.map(key => [key, model[key]])))
  const source = reactive({ ...model, $state }) as unknown as EvalConfig
  session = { req, source, catalog }
}

/** 算一个预设（一个 preset 一个新场景；与池化前的循环体逐字相同） */
function runPreset(index: number): void {
  if (!session) throw new Error('worker 未 init 就收到 preset 消息')
  const { req, source, catalog } = session
  const preset = req.presets[index]
  if (!preset) throw new Error(`preset 下标越界：${index}`)
  ctx.postMessage({ type: 'progress', index, total: req.presets.length, name: preset.name })
  const scenario = createAnalysisScenario(source, catalog)
  try {
    const rows = computeDifficultyCurves(scenario, {
      presets: [preset],
      boss: req.boss,
      phase: req.phase,
      difficultyWeights: req.difficultyWeights,
      // 环境模式的道表随请求传入（worker 里读不到页面 store；proto 见 CurveRunRequest）
      environment: environmentOptions(req),
      // 每档现场差分（页面「点曲线上的点 → 看那一档资源池」的数据源；缺省不采）
      collectScenes: req.collectScenes,
    })
    for (const row of rows) ctx.postMessage({ type: 'row', presetIndex: index, row })
  } finally {
    scenario.dispose()
  }
  ctx.postMessage({ type: 'presetDone', presetIndex: index })
}

ctx.onmessage = async (e: MessageEvent<CurveWorkerRequest>) => {
  try {
    const msg = e.data
    if (msg.type === 'init') {
      await init(msg.request)
      ctx.postMessage({ type: 'ready' })
      return
    }
    runPreset(msg.index)
  } catch (err) {
    ctx.postMessage({ type: 'error', error: String((err as Error)?.stack ?? err) })
  }
}
