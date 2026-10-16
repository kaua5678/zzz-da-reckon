/**
 * **config 现场差分**（生产级「基线 + 差分」口径，2026-10-16 T181）。
 *
 * ## 为什么要有它
 *
 * 分析器（难度曲线 / 散点 / 位置对比）逐档改写 config 再求值，每档现场与运行基线往往只差
 * **两三个键**（实测：`team` + `mechanicSettings`），但整份 `$state` 是 11–12KB。逐点存整份现场
 * （或逐点存整份引擎结果 **41.5KB/档**）会让「逐点明细」把页面内存顶上去（LRU 24 键 × 10 队 × 6 档
 * ≈ 38MB）；只存差分则 **2.1KB/档**（实测 `.zc/perf/T181payload.perf.ts`），且差分是**可重放的**
 * （`restoreStateDelta`）。
 *
 * ⚠ **差分值不是「patch 压缩」**：单个 delta 里的 `team` 仍是一整份队伍数组（逐档都会变），
 * 所以实测 delta ≈ 2.1KB（不是 200B 量级）。真正省下来的部分来自
 * ① 不带 41.5KB 的引擎结果、② **基线只存一份**（页面把所有道的 `sceneBase` 归一化成同一个对象，
 * 见 `dedupeSceneBases`：实测两份 base 内容相同的 JSON 各 10.9KB，归一化后只留一份）。
 * 换算下来「基线 + 差分」≈ **13.3KB/档**（实测两队 7 档共 93.1KB）⇒ 相对随点带结果省 ~3 倍，
 * 且**点开才算**（50–120ms/次），不点不花。
 *
 * ## 语义（三条，缺一条就静默错值）
 *
 * 1. **差分只记「与基线不同」的键**，且记的是**完整值**（不是 patch / 不是 JSON-Patch）：键值对里
 *    没有的键 = 该键与基线相同。值必须能被结构化克隆（`$state` 里是纯数据；`cloneConfigState` 已
 *    证明这一点，见 `analysisScenario` 头注释的 `RefImpl` 事故）。
 * 2. **基线必须是「这次运行的起点」**：调用方在改写任何配置**之前**采一次
 *    （`captureState(source)`），之后每个档位的差分都以它为准。拿「上一档」当基线会让差分链式累积，
 *    重放要按顺序做——多一个不必要的约束。
 * 3. **重放 = 从基线出发覆盖差分键**：`restoreStateDelta(config, base, delta)` 先整表写回基线
 *    （`$state[key] = value` 经 Vue 的 ref 解包写穿到 state ref），再覆盖差分键。**不允许**在
 *    「当前现场」上直接叠差分——那样会残留上一次重放改过的键（静默错值）。
 *
 * ## 判据
 *
 * `__tests__/configDelta.test.ts`：① 无变化 ⇒ 空差分；② 改 `team`/`mechanicSettings` ⇒ 只记这两个键；
 * ③ **往返**：`restore(base, delta)` 的 `$state` 与采集时的现场**逐字节相同**（这是「重放出来的资源池
 * = 那个点的资源池」的全部依据）；④ 差分体积 < 整份现场（守住「差分确实更省」这条前提）。
 */
import { cloneConfigState } from '@/composables/analysisScenario'

/** 与基线的差分：键 → 完整值（未出现的键 = 与基线相同） */
export type StateDelta = Record<string, unknown>

/**
 * 差分可重放的最小 config 契约（UI store 与独立场景都满足）。
 *
 * `$state` 声明成 `object`（不是 `Record<string, unknown>`）：Pinia store 的 `$state` 是**具名接口**
 * （没有索引签名），写成 Record 会让每个调用点都得强转一次（实测 tsc 报 7 处 TS2345）。
 * 本模块内部只按 `Object.keys` 遍历，不需要索引签名。
 */
export interface DeltaRestorable {
  readonly $state: object
}

/** 内部视图：`$state` 当字符串键表用（只读遍历 / 写穿 ref，见 `restoreStateDelta`） */
function stateRecord(source: DeltaRestorable): Record<string, unknown> {
  return source.$state as Record<string, unknown>
}

/**
 * 采一份现场快照（逐键深拷贝，保留 undefined/NaN；与 `createAnalysisScenario` 的出生态同一口径）。
 *
 * ⚠ 必须**逐键**读 `$state`（经响应式代理自动解包 ref）——整表 `toRaw` 会拿到 `RefImpl`，
 * 结构化克隆直接抛 `DataCloneError`（`analysisScenario` 头注释记着那次实机事故）。
 */
export function captureState(source: DeltaRestorable): Record<string, unknown> {
  const sourceState = stateRecord(source)
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(sourceState)) out[key] = cloneConfigState(sourceState[key])
  return out
}

/**
 * 算 `now` 相对 `base` 的差分（只记变化键）。`base` / `now` 都是**值快照**（`captureState` 的产物）。
 *
 * 比较用 `JSON.stringify`（与 `calcOutput` 记忆化键同一把尺：`$state` 里全是 JSON 可表达的数据）。
 * 键集合以 `now` 为准（`base` 多出的键不该出现——两边同源同键集，见 `createConfigModel` 的出生态键表）。
 */
export function stateDeltaOf(base: Record<string, unknown>, now: Record<string, unknown>): StateDelta {
  const out: StateDelta = {}
  for (const key of Object.keys(now)) {
    const a = JSON.stringify(base[key])
    const b = JSON.stringify(now[key])
    if (a !== b) out[key] = now[key]
  }
  return out
}

/**
 * 把 `config` 的现场重放成「基线 + 差分」。**先整表写回基线**（清掉上一次重放的残留），再覆盖差分键。
 *
 * 写入走 `$state[key] = value`：Vue 对「目标是 ref 的属性」的写会**写穿到 ref.value**
 * （`baseHandlers.set` 的 ref 分支），Pinia 的 setup store `$state` 同理 ⇒ 与直接写 `config.team` 等效，
 * 该触发的 watcher / 记忆化失效一个不少。
 */
export function restoreStateDelta(config: DeltaRestorable, base: Record<string, unknown>, delta: StateDelta): void {
  const target = stateRecord(config)
  for (const key of Object.keys(base)) target[key] = cloneConfigState(base[key])
  for (const key of Object.keys(delta)) target[key] = cloneConfigState(delta[key])
}

/** 差分里变化的键（诊断 / 判据用；UI 想显示「这一点动了什么」直接读它） */
export function deltaKeys(delta: StateDelta | undefined | null): string[] {
  return delta ? Object.keys(delta) : []
}

/**
 * **基线去重**：把 N 份「内容相同但对象不同」的现场基线归一化成**同一个对象**。
 *
 * ## 为什么需要（实测，不是过早优化）
 *
 * 页面口径是**逐队一个新场景**（worker 里每队 `createAnalysisScenario(source)`）⇒ 每队的
 * `sceneBase` 都是**独立拷贝**：实测两份内容相同的 base 各 **10.9KB**（JSON），
 * 8 队就是 87KB 纯重复；而差分本身只有 2.1KB/档。基线去重后「基线 + 差分」≈ 13.3KB/档。
 *
 * ⚠ **只在内容真的相同时复用**（`JSON.stringify` 比对，与 `stateDeltaOf` 同一把尺）：
 * 内容不同却复用会让重放写出**别的队的现场**（静默错值，正是本模块存在的意义要防的事）。
 *
 * ⚠ 复用是**安全的**，因为基线按契约是**只读**的（`restoreStateDelta` 只从它读、`cloneConfigState`
 * 拷贝后才写进现场）。调用方**不得**改写传入的 base。
 *
 * @param bases 按出现顺序给出的基线（`undefined` = 该行没采现场，跳过）
 * @returns 与输入等长的数组，内容相同的项指向同一个对象
 */
export function dedupeSceneBases<T extends Record<string, unknown>>(bases: (T | undefined)[]): (T | undefined)[] {
  const seen = new Map<string, T>()
  return bases.map(b => {
    if (!b) return undefined
    const key = JSON.stringify(b)
    const hit = seen.get(key)
    if (hit) return hit
    seen.set(key, b)
    return b
  })
}
