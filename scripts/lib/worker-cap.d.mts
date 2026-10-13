/** scripts/lib/worker-cap.mjs 的类型声明（供 vite.config.ts 与 vitest 消费，先例：docs-reading-tests.d.mts） */

/** 硬天花板：实测 10 档已进入换页方差区、12 档反而更慢 ⇒ 不再往上放 */
export declare const MAX_WORKERS_CEILING: number
/** 每个 fork 的常驻增量（MB）——由 2026-10-12 五档实测峰值线性拟合 */
export declare const PER_WORKER_MB: number
/** 固定底噪（MB）——同上拟合 */
export declare const BASE_MB: number
/** 可用内存预算占总内存的比例（留 40% 给 OS 与并行会话） */
export declare const MEMORY_BUDGET_RATIO: number

/**
 * 计算 worker 上限。
 *
 * @param cpus 可用并行度（应传 `os.availableParallelism()`，它尊重 cgroup / taskset 亲和性）
 * @param totalMb 总内存（MB）
 */
export declare function workerCap(cpus: number, totalMb: number): number
