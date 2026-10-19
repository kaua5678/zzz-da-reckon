/** scripts/test-ring.mjs 的类型声明（供 vitest 消费；先例：scripts/zc-where.d.mts）。
 *
 * ⚠ 判据 14-C 会拿本文件与 .mjs 的运行时导出逐符号对账（多声明/漏声明都红）——
 * 改 test-ring.mjs 的 export 时**必须同步改这里**。
 */

export declare const ROOT: string

/** 每对话那圈必须保留的跨切面不变量（哪怕 > CORE_MAX_SECONDS） */
export declare const CORE_INVARIANTS: { file: string; seconds: number; why: string }[]

/** core 环的时长门槛：单文件实测 ≥ 它且不在 CORE_INVARIANTS 里 ⇒ 出 core */
export declare const CORE_MAX_SECONDS: number

/** core 环排除集（每条带实测秒数 + 为什么排除） */
export declare const CORE_EXCLUDES: { file: string; seconds: number; why: string }[]

/** fast 环的时长门槛：≥ 它的才在 core 之上继续砍 */
export declare const FAST_MAX_SECONDS: number

/** 路径 → 必须升环（advise 用） */
export declare const RING_ADVICE: { ring: 'fast' | 'full'; match: RegExp; why: string }[]

/** 环 → 该环排除的文件名清单 */
export declare function excludesFor(ring: string): string[]

/** 环 → vitest 的 --exclude 参数 */
export declare function vitestArgsFor(ring: string): string[]

/** 按改动路径给出「这次该跑到哪一环」（只提示，不阻断） */
export declare function adviseFor(changedPaths: string[]): {
  ring: 'core' | 'fast' | 'full'
  hits: { path: string; ring: 'fast' | 'full'; why: string }[]
}

/** 三环实测（2026-10-18 全量 run 产物；改清单时同步） */
export declare const RING_MEASURED: Record<string, { seconds: number; files: number }>
