/**
 * 诊断打表设施（CC-479，r662）：**关着零副作用、零成本**的常驻探针点。
 *
 * 为什么：r657–r661 每轮都在 solveTeam 外环 / convergence 反推块 / ultimatePromote 二分里手工插 `console.log`、跑完再
 * `git checkout` 还原（r659 一次差点连 trace 一起提交）。仓库早有同类先例 `PROBE_TRACE_FOLD`（foldLoop.ts / resource.ts，
 * `typeof process` 守护 + 推进 `globalThis.__foldPasses`，`convergenceProbe.test` 消费）——本文件把这个习语收成一个函数，
 * 三处共用，新探针点照抄即可。
 *
 * 约定：
 * - 开关 = `process.env.<FLAG> === '1'`（vitest / node 下设环境变量；浏览器无 `process` ⇒ 恒关，不会抛）。
 * - 记录用 thunk 传入，关着时不求值、不分配。
 * - 桶 = `globalThis.<bucket>` 数组；消费方（perf 脚本 / 测试）自行 `length = 0` 清空、按 `__probeKey` 分组。
 * - `__probeKey` 由探针脚本在每个场景前设置（见 `calc-arch/arenaF/zz660.perf.ts`），引擎只读不写。
 * 现有旗标：`PROBE_TRACE_FOLD`（折叠环）、`PROBE_TRACE_OUTER`（外层不动点逐轮，solveTeam.ts）、
 * `PROBE_TRACE_BACKSTAGE`（后台合轴自动填充反推块，convergence.ts）。
 */
export function probeOn(flag: string): boolean {
  return typeof process !== 'undefined' && process.env[flag] === '1'
}

export function probePush(flag: string, bucket: string, rec: () => unknown): void {
  if (!probeOn(flag)) return
  const g = globalThis as unknown as Record<string, unknown[] | undefined>
  ;(g[bucket] ??= []).push(rec())
}

/** 探针脚本设置的当前场景名（没有则空串）。 */
export function probeKey(): string {
  return String((globalThis as unknown as { __probeKey?: unknown }).__probeKey ?? '')
}
