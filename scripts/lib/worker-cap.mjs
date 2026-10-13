/**
 * vitest worker 上限（单一事实源）。
 *
 * 为什么单独成文件（2026-10-12）：口径原先只写在 `vite.config.ts` 里，而 `vite.config.ts`
 * **不能被测试 import**（实测 `import cfg from '../../vite.config'` 报
 * `Cannot find module` —— vitest 不把 config 当模块解析）。没有可 import 的符号就只能写
 * 源码文本断言，那既脆又测不到算法。抽到 lib 层后 `vite.config.ts` 与
 * `src/scripts/__tests__/workerCap.test.ts` 引用**同一个函数**（规则 11）。
 *
 * 背景：CC-424（2026-10-03 r450）把上限钉成 4 是**止血**——vitest 默认按 CPU 数起 16 个 fork，
 * 每个 fork 载入全部角色模块，16 × ~1.8GB 峰值超过物理内存 ⇒ 整个 WSL VM 被拖死
 * （r385 两次、r450 另一会话 load 20+）。但 4 把 16 核机器用成了 4 核。
 *
 * 2026-10-12 实测（干净 worktree @02c0d486，`npx vitest run --maxWorkers=N`，逐档 EXIT=0，
 * 且 5 档 passed/failed/skipped **逐位相同** = 4700/0/26 ⇒ 纯提速、零强度损失）：
 *
 * | workers | 墙钟（多次） | 峰值 RSS |
 * |---|---|---|
 * | 4（旧固定值） | 308s | 2832MB |
 * | 6 | 247s | 4286MB |
 * | **8（新默认）** | 220 / 195 / 216s | 4818MB |
 * | 10 | 180 / 178 / **248**s | 5878MB |
 * | 12 | **258s** | 7415MB |
 *
 * 拐点归因：再往上不是被 CPU 限制（10 档实测平均并发只有 7.56、8 档 6.18，机器没喂饱），
 * 是被**内存**限制 —— 12 档 7415MB + 常态其它进程（dsh web ~1GB / vite dev / mysqld）
 * ≈ 9.7GB 物理上限，于是开始 swap、**反而更慢**。
 *
 * @fact engine:vitest/worker上限 口径: `maxWorkers = min(availableParallelism(), 内存预算可容纳的 fork 数, 8)`；内存预算 = 总内存 × 0.6、峰值模型 ≈ `540MB + 573MB × workers`；优先级 `--maxWorkers=N` > `VITEST_MAX_WORKERS=N` > 本函数 | 据 实测@2026-10-12（5 档 passed 逐位相同 4700/0/26） | 验 src/scripts/__tests__/workerCap.test.ts | 锚 scripts/lib/worker-cap.mjs#workerCap + scripts/lib/worker-cap.mjs#MAX_WORKERS_CEILING | 信 高
 * ⟳复核: 机器规格变化（核数/内存）或 vitest 换 major 后，重跑 4/6/8/10/12 档墙钟与峰值 RSS，确认天花板 8 仍是最优 | 到期 2027-01-12
 */

/** 硬天花板：实测 10 档已进入换页方差区、12 档反而更慢 ⇒ 不再往上放 */
export const MAX_WORKERS_CEILING = 8

/** 每个 fork 的常驻增量（MB）与固定底噪（MB）——由 2026-10-12 五档实测峰值线性拟合 */
export const PER_WORKER_MB = 573
export const BASE_MB = 540

/** 可用内存预算占总内存的比例；留 40% 给 OS 与并行会话 */
export const MEMORY_BUDGET_RATIO = 0.6

/**
 * 计算 worker 上限。
 *
 * @param {number} cpus 可用并行度（应传 `os.availableParallelism()`——它尊重 cgroup / taskset
 *   亲和性，CI 的 4 核 runner 上自动降到 4，与固定 4 时代行为一致；**不要**传 `os.cpus().length`，
 *   那在容器里会报宿主核数）
 * @param {number} totalMb 总内存（MB）
 * @returns {number} ≥1 的整数上限
 */
export function workerCap(cpus, totalMb) {
  const byMem = Math.floor((totalMb * MEMORY_BUDGET_RATIO - BASE_MB) / PER_WORKER_MB)
  return Math.max(1, Math.min(cpus, byMem, MAX_WORKERS_CEILING))
}
