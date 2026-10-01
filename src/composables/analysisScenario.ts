/**
 * 分析器独立场景（数据隔离；2026-10-01 arena-C r369 第 1 阶段，设计与迁移进度见 docs/mcp-analyzer-scenario-isolation.md）。
 *
 * 为什么要有它：分析器（队伍对比、难度曲线、抽卡规划、角色兑现曲线……）要逐队改写配置再求值。过去它们直接改写
 * 页面正在用的 UI config store，跑完靠 configSnapshot 的快照 / 恢复（该模块已随 CC-343 S3 删除）：
 * - 快照只覆盖部分字段，漏一个就是泄漏（CC-251 / 278 / 338 / 339 / 340 修的都是这一类）；
 * - 异步分析器 yield 时 UI 看得见中间态，页面上的计算也会为每个中间态重算；
 * - 调用方传进来的 calc 必须恰好绑在 useConfigStore() 上，否则静默错配。
 *
 * 现在：分析器在调用方现场的**深拷贝**上跑——独立的 config model（`createConfigModel` 的出生态 initialState）
 * + 绑在它上面的资源计算（`createResourceCalc`）。UI store 只被读一次（拷贝出生态），跑完 dispose，不需要恢复。
 *
 * 用法：页面 `await withAnalysisScenario(s => computeX({ scenario: s, ... }))`；分析器只认 `AnalysisContext`
 * （在 `config` 上随意改写、读 `calc` 的结果），不调 useConfigStore()、不做快照恢复。
 */
import { effectScope, reactive, toRaw } from 'vue'
import { createConfigModel, useConfigStore } from '@/stores/config'
import { useCatalogStore } from '@/stores/catalog'
import { createResourceCalc, type ResourceCalc } from '@/composables/useResourceCalc'

type ConfigStore = ReturnType<typeof useConfigStore>
type CatalogStore = ReturnType<typeof useCatalogStore>

/** 分析器的求值上下文：在 `config` 上随意改写，读 `calc` 的结果。 */
export interface AnalysisContext {
  readonly config: ConfigStore
  readonly calc: ResourceCalc
}

export interface AnalysisScenario extends AnalysisContext {
  /** 停掉场景内的全部 watcher / computed（effectScope）；可重复调用。 */
  dispose(): void
}

/**
 * state 值的深拷贝：逐层 toRaw（state 里是响应式代理，structuredClone 不收代理），
 * 保留 undefined / Infinity / NaN（JSON 往返会把后两者变成 null）；非普通对象交给 structuredClone。
 */
export function cloneConfigState<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value
  const raw = toRaw(value) as unknown
  if (Array.isArray(raw)) return raw.map(item => cloneConfigState(item)) as T
  const proto = Object.getPrototypeOf(raw)
  if (proto !== Object.prototype && proto !== null) return structuredClone(raw) as T
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(raw as object)) out[key] = cloneConfigState((raw as Record<string, unknown>)[key])
  return out as T
}

/**
 * 以 `source` 的当前现场为出生态建一个独立场景。`source` 缺省 = UI config store，也可以是另一个场景的 `config`。
 *
 * 返回的 `config` 类型标成 config store：有 model 的全部 state / getter / action，外加 `$state`（memo 键读它，
 * 键集合与源一致）。没有 Pinia 的 `$patch` / `$subscribe` / `$reset` / `$onAction`——分析器与求值管线都不调它们
 * （全仓只有 ImpactChart.vue 对 UI store 用 `$patch`）。
 */
export function createAnalysisScenario(
  source: ConfigStore = useConfigStore(),
  catalog: CatalogStore = useCatalogStore(),
): AnalysisScenario {
  const sourceState = source.$state as unknown as Record<string, unknown>
  const stateKeys = Object.keys(sourceState)
  const initialState: Record<string, unknown> = {}
  for (const key of stateKeys) initialState[key] = cloneConfigState(sourceState[key])
  const scope = effectScope(true)
  const built = scope.run(() => {
    const model = createConfigModel(catalog, initialState) as unknown as Record<string, unknown>
    // `$state` 视图：同一批 ref，经 reactive 读取即解包并建立依赖（与 Pinia 的 $state 同语义）
    const $state = reactive(Object.fromEntries(stateKeys.map(key => [key, model[key]])))
    const config = reactive({ ...model, $state }) as unknown as ConfigStore
    return { config, calc: createResourceCalc(config, catalog) }
  })!
  let disposed = false
  return {
    config: built.config,
    calc: built.calc,
    dispose() {
      if (disposed) return
      disposed = true
      scope.stop()
    },
  }
}

/** 建场景 → 跑 fn → 无论成败都 dispose（页面入口用它，免得漏 dispose）。 */
export async function withAnalysisScenario<T>(
  fn: (scenario: AnalysisScenario) => T | Promise<T>,
  source?: ConfigStore,
): Promise<T> {
  const scenario = createAnalysisScenario(source)
  try {
    return await fn(scenario)
  } finally {
    scenario.dispose()
  }
}
