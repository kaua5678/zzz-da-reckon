/**
 * vitest worker 上限的机器判据（2026-10-12）。
 *
 * 为什么需要：上限值直接决定**全量套件跑多久**，而它此前是 `vite.config.ts` 里一个裸的
 * `|| 4`——改它没有任何判据拦着，也没人知道 4 是不是最优（事实：不是，见
 * `scripts/lib/worker-cap.mjs` 头注释的 5 档实测表）。本文件把三件事钉住：
 *
 * ① **算法**：CPU / 内存 / 天花板三者取最小，且内存预算不足时**必须**往下退
 *    （这是防「16 核机器上起 16 个 fork ⇒ 每个载入全部角色模块 ⇒ 内存爆掉拖死 VM」的那道闸，
 *    CC-424 的原始病灶，r385 实测两次）。
 * ② **反空洞**：`workerCap` 不许退化成常量（那样本文件的断言会全部「通过」而毫无意义）。
 * ③ **接线**：`vite.config.ts` 必须真的调用它，且保留 `VITEST_MAX_WORKERS` 覆盖口
 *    （源码文本断言——`vite.config.ts` 不能被 import，实测 `Cannot find module`）。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  BASE_MB, MAX_WORKERS_CEILING, MEMORY_BUDGET_RATIO, PER_WORKER_MB, workerCap,
} from '../../../scripts/lib/worker-cap.mjs'

const MB = 1024

describe('vitest worker 上限（scripts/lib/worker-cap.mjs）', () => {
  it('① 三者取最小：CPU 少 ⇒ 跟 CPU；内存少 ⇒ 跟内存；都多 ⇒ 撞天花板', () => {
    // CPU 是瓶颈（CI 4 核 runner 的形态）：4 核 / 大内存 ⇒ 4
    expect(workerCap(4, 64 * MB)).toBe(4)
    // 内存是瓶颈：16 核 / 只有 4GB ⇒ 内存预算 2.4GB，扣底噪后只够 3 个 fork
    expect(workerCap(16, 4 * MB)).toBe(3)
    // 两者都充裕：撞天花板（实测 10 档已进换页方差区、12 档反而更慢）
    expect(workerCap(64, 128 * MB)).toBe(MAX_WORKERS_CEILING)
  })

  it('② 天花板是硬约束：无论多少核/多少内存都不越过它', () => {
    for (const [cpus, mem] of [[16, 32 * MB], [128, 512 * MB], [1000, 1000 * MB]] as const) {
      expect(workerCap(cpus, mem)).toBeLessThanOrEqual(MAX_WORKERS_CEILING)
    }
  })

  it('③ 内存不足时**必须**往下退，且永不返回 <1（CC-424 的原始病灶：起满 fork 拖死 VM）', () => {
    // 单调不减：内存越多，允许的 fork 数不会变少
    const ladder = [1, 2, 4, 8, 16, 32].map(g => workerCap(64, g * MB))
    for (let i = 1; i < ladder.length; i++) {
      expect(ladder[i], `内存 ${[1, 2, 4, 8, 16, 32][i]}GB 的档位不该比上一档少`).toBeGreaterThanOrEqual(ladder[i - 1]!)
    }
    // 极小内存也返回合法值（宁可 1 个 worker 慢慢跑，也不能返回 0/NaN 让 vitest 报错）
    for (const mem of [0, 1, 100, 512]) {
      const n = workerCap(16, mem)
      expect(Number.isInteger(n) && n >= 1, `totalMb=${mem} 应返回 ≥1 的整数，实测 ${n}`).toBe(true)
    }
  })

  it('④ 反空洞：workerCap 不是常量（否则上面三条断言会「通过」得毫无意义）', () => {
    const seen = new Set([workerCap(4, 64 * MB), workerCap(16, 4 * MB), workerCap(64, 128 * MB)])
    expect(seen.size, 'workerCap 对三组差异极大的输入返回了同一个值 ⇒ 它退化成了常量').toBeGreaterThan(1)
  })

  it('⑤ 接线：vite.config.ts 真的调用它，并保留 VITEST_MAX_WORKERS 覆盖口', () => {
    const cfg = readFileSync(join(process.cwd(), 'vite.config.ts'), 'utf8')
    expect(cfg, 'vite.config.ts 必须 import 单一事实源').toContain("from './scripts/lib/worker-cap.mjs'")
    expect(cfg, 'vite.config.ts 必须真的调用 workerCap').toMatch(/workerCap\(/)
    // 覆盖口：没有它就没法临时提速/降速（CC-424 的既有 API，别在重构里弄丢）
    expect(cfg, 'VITEST_MAX_WORKERS 覆盖口丢了').toContain('VITEST_MAX_WORKERS')
    // 反面：不许再出现硬编码的 worker 数（`|| 4` 与裸 `maxWorkers: 4` 都算）。
    // ⚠ 负控实测过：只写 `Number(...) || \d+` 会漏掉裸字面量形态（改成 `maxWorkers: 4,` 时它照绿）。
    const line = cfg.split('\n').find(l => /^\s*maxWorkers:/.test(l))
    expect(line, 'vite.config.ts 里找不到 maxWorkers 行').toBeTruthy()
    expect(
      line,
      `maxWorkers 又写回了硬编码值（实测这会退化成「16 核机器只用 4 核」）：${line}`,
    ).not.toMatch(/maxWorkers:\s*(\d|Number\([^)]*\)\s*\|\|\s*\d)/)
  })

  it('⑥ 内存模型与实测表自洽（防止有人只改常量、不改注释里的实测依据）', () => {
    // 本机实测（2026-10-12）：16 核 / 9.71GB ⇒ cap 应为 8
    const totalMb = 9.71 * MB
    expect(workerCap(16, totalMb)).toBe(MAX_WORKERS_CEILING)
    // 预算模型：8 个 fork 的预测峰值应落在总内存之内（否则就自相矛盾了）
    const predictedPeak = BASE_MB + PER_WORKER_MB * MAX_WORKERS_CEILING
    expect(
      predictedPeak,
      `8 fork 的预测峰值 ${predictedPeak}MB 超过了预算 ${(totalMb * MEMORY_BUDGET_RATIO).toFixed(0)}MB`,
    ).toBeLessThanOrEqual(totalMb * MEMORY_BUDGET_RATIO)
  })
})
