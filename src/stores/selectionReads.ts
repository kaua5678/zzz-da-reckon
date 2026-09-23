/**
 * config store 选择表的**纯读口径**（单一事实源，2026-09-23 mcp-engine-r2）。
 *
 * 为什么抽出来：pinia 会把 setup store 返回的每个函数包成 `wrappedAction`（每次调用分配
 * after/onError 回调数组、走一遍 `$onAction` 派发），引擎热路径每轮对这些 getter 调用上万次，
 * 实测包装开销占引擎自耗时 ~3%。引擎改为直接对 store state 调用本文件的纯函数；store 方法
 * （UI 侧入口）也委托到这里 ⇒ 两条读路径**同一份口径**，不会漂移（规则：共享口径单一来源）。
 *
 * 响应式：参数传入的是 store 代理上的 state 对象，按键读取照常 track，computed 失效行为不变。
 * 全仓无 `$onAction` 消费者 / pinia 插件（dsh1 审计），绕过包装无副作用。
 */

/** 队友 Buff 选择表（buffId → { enabled, coverage }） */
export type TeammateBuffSelections = Readonly<Record<string, { enabled: boolean; coverage: number } | undefined>>

/** 队友 buff 是否启用：无记录 = 未启用 */
export function teammateBuffEnabledOf(selections: TeammateBuffSelections, buffId: string): boolean {
  return selections[buffId]?.enabled ?? false
}

/** 队友 buff 覆盖率（0–100）：无记录 = 100 */
export function teammateBuffCoverageOf(selections: TeammateBuffSelections, buffId: string): number {
  return selections[buffId]?.coverage ?? 100
}

/** 驱动盘套装效果覆盖率（0–100）：无记录 = 100 */
export function discEffectCoverageOf(coverages: Readonly<Record<string, number>>, effectId: string): number {
  return coverages[effectId] ?? 100
}

/** 音擎效果覆盖率表 → `effectId → 0..1`（夹到 [0,100] 再 /100；只含有记录的效果） */
export function wEngineEffectCoverageMapOf(coverages: Readonly<Record<string, number>>): Map<string, number> {
  const map = new Map<string, number>()
  for (const [id, coverage] of Object.entries(coverages)) {
    map.set(id, Math.max(0, Math.min(100, coverage)) / 100)
  }
  return map
}

/** 机制滑块取值：有限数取用户值，否则回落 fallback */
export function mechanicSettingOf(values: Readonly<Record<string, number>>, id: string, fallback: number): number {
  const value = values[id]
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}
