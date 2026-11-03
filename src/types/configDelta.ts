/**
 * **config 现场差分**（数据面类型；T189 从 `composables/configDelta.ts` 下沉到 `types/`）。
 *
 * 为什么要下沉（规则 29「具名类型下沉到 types/」的既有先例）：
 * 散点（`types/teamPreset.ts#TeamComparePoint`）与选第三人的候选点也要带**同一份现场差分**——
 * 它们与难度曲线的点是同一种东西（一个档位的现场），不能因为 types/ 不许 import composables/
 * 就再抄一份形状（那正是本仓最怕的静默分叉）。
 */

/** 与基线的差分：键 → 完整值（未出现的键 = 与基线相同） */
export type StateDelta = Record<string, unknown>

/**
 * 一档的**现场差分**（相对本次运行的基线）。
 *
 * `base` = 运行起点的整份 `$state` 值快照（每次分析运行一份，全部档共用；同名对象可去重，
 * 见 `configDelta#dedupeSceneBases`），`delta` = 该档与基线的差分。
 *
 * 重放 = `restoreStateDelta(config, base, delta)` ⇒ 现场与落点那刻**逐字节相同**
 * ⇒ 按需重算出来的资源池**就是那一档的资源池**（判据 `configDelta.test.ts` ③ /
 * `difficultyCurve.test.ts::★ 重放每点现场` / `pointSceneCapture.test.ts`）。
 */
export interface PointScene {
  base: Record<string, unknown>
  delta: StateDelta
}
