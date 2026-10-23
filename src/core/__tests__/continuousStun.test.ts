/**
 * **连续失衡判据**（用户口径 2026-10-23）。
 *
 * 用户原话见 `core/continuousStun.ts` 文件头。本文件钉三件事：
 * ① **形态**：`completeWindows < cont < completeWindows + 1` 时，`lastFraction` 必须是
 *    中间值（不是 0、不是 1）—— 这就是「快速增加段」存在的前提；
 * ② **与二值口径的边界**：没开启（`t_open ≥ effTime`）⇒ `lastFraction = 0`（**不许**把
 *    「条只有 95.8%」折成 95.8% 的窗 —— 2026-10-21 整条回退的错误方向）；
 *    整窗装得下 ⇒ 归入 `completeWindows`（`lastFraction` 严格 < 1）；
 * ③ **三条不变量**：不越界 / 不回退 / 单调。
 */
import { describe, expect, it } from 'vitest'
import { continuousStunCoverage, realizeStunWindows } from '@/core/continuousStun'

const W = 16
const EFF = 180

describe('连续失衡：末窗兑现折算', () => {
  it('★ 快增段的**存在条件**：计划窗数 < 攒出来的窗数（否则 band 为空）', () => {
    /**
     * ⚠ **本用例记录的是本轮最重要的一条实测发现**（2026-10-23）：
     *
     * 只要 `K = floor(cont)`（引擎 kStar 的现行口径），band 在数学上**恒为空**：
     * 第 K+1 窗开启要求 `t_open(K+1) < effTime`
     * ⇒ `(K+1)/ρ + K·W < effTime` ⇒ `cont > K+1` —— 与 `K = floor(cont)` 直接矛盾。
     * 所以「cont = 5.958」这类**差一点点**的时刻，物理上**确实一秒都不兑现**
     * （与用户 2026-10-21 §33 的裁决一致：没攒满 = 没开启 = 没有易伤）。
     *
     * 快增段只在**计划窗数 < 攒出来的窗数**时出现（锁窗 / 时间上界封顶把 surplus 丢掉的那些队）。
     * 实测 `auto-1611-1141-1211` 锁 5 窗、闪反 18 次：`cont = 6.266` ⇒ 池攒出 6 窗、轴只排 5 窗
     * ⇒ 第 6 窗**已攒满且开启**（t_open ≈ 175.7s），实际只能打 27%。
     */
    const empty = realizeStunWindows({ plannedWindows: 5, builtWindows: 5.958, windowDuration: W, effectiveTime: EFF })
    expect(empty.lastFraction, 'K = floor(cont) ⇒ band 必空（数学恒等式，不是实现取舍）').toBe(0)
    expect(empty.realizedWindows).toBe(5)

    // 锁窗场景：池攒出 6 窗（cont 6.266）但轴只排 5 窗 ⇒ 第 6 窗**已开启**且时间不够
    const band = realizeStunWindows({ plannedWindows: 5, builtWindows: 6.266, windowDuration: W, effectiveTime: EFF })
    expect(band.completeWindows, '池攒出 6 窗但只排 5 窗 ⇒ 完整窗仍是 5').toBe(5)
    expect(band.lastFraction, '第 6 窗已攒满且开启 ⇒ 必须兑现一部分（这就是快增段）').toBeGreaterThan(0)
    expect(band.lastFraction, '但不能到整窗（到了就该进 completeWindows）').toBeLessThan(1)
    expect(band.nextOpenAt, '第 6 窗开启时刻必须早于结束').toBeLessThan(EFF)
    expect(band.realizedWindows, '不得越界：兑现 ≤ 攒出来的').toBeLessThanOrEqual(6.266 + 1e-9)
  })

  it('★ 二值口径的边界：cont 95.8% 但**没攒满** ⇒ 一分为零（用户 2026-10-21 §33）', () => {
    /**
     * `cont = 4.958`：第 5 窗还差 4.2% 没攒满。按用户裁决「没开启 = 没有易伤」，
     * 这一窗**一秒都不能兑现**。这条是防「把进度当兑现」的护栏（§42 回退的那个错误方向）。
     */
    const r = realizeStunWindows({ plannedWindows: 4, builtWindows: 4.958, windowDuration: W, effectiveTime: EFF })
    expect(r.completeWindows).toBe(4)
    expect(r.lastFraction, '没攒满 ⇒ 0（不是 0.958）').toBe(0)
    expect(r.realizedWindows).toBe(4)
  })

  it('★ 快增段的**必要前提**：计划窗数 < 池攒出来的整数窗（= 时间上限封顶）', () => {
    /**
     * ⚠ **本轮最重要的数学发现**（2026-10-23）。
     *
     * 引擎的 kStar 口径是「**最大自洽可行整数**」：`K = max{K : cont(K) ≥ K}`。
     * 而 `cont(K) = ρ·(eff − K·W)` 随 K 线性下降 ⇒ 在 K 处自洽意味着 `cont(K) ≈ K`，
     * **于是 band（`cont(K) ∈ (K, K+1)`）在自由收敛下必然很窄甚至为空**。
     *
     * 真正让 band 变宽的是**计划窗数被外部上限压住**——`solveTeam` 的 `searchMax`
     * （时间上界 `ceil((eff − nec)/W)`）或 `physicalMax`。实测 `auto-1611-1141-1211` 锁 5 窗、
     * 闪反 18 次：池攒出 `cont = 6.266` 窗，但轴只排 5 窗 ⇒ 第 6 窗**已攒满且开启**
     * （实测 `t_open ≈ 175.8s`），只剩 4.2s ⇒ 兑现 26%。这就是用户要的「快增段」。
     */
    const capped = realizeStunWindows({ plannedWindows: 5, builtWindows: 6.266, windowDuration: W, effectiveTime: EFF })
    expect(capped.completeWindows, '计划 5 窗 ⇒ 完整窗最多 5').toBe(5)
    expect(capped.lastFraction, '第 6 窗已开启但时间不够 ⇒ 兑现一部分').toBeGreaterThan(0.2)
    expect(capped.lastFraction).toBeLessThan(0.4)
    expect(capped.realizedWindows).toBeCloseTo(5.264, 2)

    /** 同一份 built 若计划也是 6（= 自由收敛），band 收窄到 0：kStar 恰好把 surplus 吃掉 */
    const selfConsistent = realizeStunWindows({ plannedWindows: 6, builtWindows: 6.266, windowDuration: W, effectiveTime: EFF })
    expect(selfConsistent.lastFraction, 'K = floor(cont) ⇒ 第 7 窗没开启 ⇒ 0').toBe(0)
    expect(selfConsistent.realizedWindows).toBe(6)
  })
  it('★ 整窗装得下 ⇒ 归入 completeWindows，lastFraction 严格 < 1', () => {
    const r = realizeStunWindows({ plannedWindows: 6, builtWindows: 6.4, windowDuration: W, effectiveTime: EFF })
    expect(r.completeWindows).toBe(6)
    expect(r.lastFraction).toBeLessThan(1)
  })

  it('★ 三条不变量：不越界 / 不回退 / 单调', () => {
    let prev = -1
    for (let built = 0; built <= 8.001; built += 0.05) {
      const r = realizeStunWindows({ plannedWindows: 8, builtWindows: built, windowDuration: W, effectiveTime: EFF })
      expect(r.completeWindows + r.lastFraction, `built=${built.toFixed(2)} 兑现不得越界`)
        .toBeLessThanOrEqual(built + 1e-9)
      expect(r.realizedWindows, `built=${built.toFixed(2)} 必须单调不减`).toBeGreaterThanOrEqual(prev - 1e-9)
      expect(r.lastFraction, 'lastFraction 必须 < 1').toBeLessThan(1)
      prev = r.realizedWindows
    }
  })

  it('★ 退化输入：W/effTime 非正、built 为 0 ⇒ 不编数据', () => {
    for (const bad of [
      { plannedWindows: 3, builtWindows: 3.5, windowDuration: 0, effectiveTime: EFF },
      { plannedWindows: 3, builtWindows: 3.5, windowDuration: W, effectiveTime: 0 },
      { plannedWindows: 3, builtWindows: 0, windowDuration: W, effectiveTime: EFF },
    ]) {
      const r = realizeStunWindows(bad)
      expect(r.lastFraction).toBe(0)
      expect(Number.isFinite(r.realizedWindows)).toBe(true)
    }
  })
})

describe('连续失衡覆盖率', () => {
  const base = { windowDuration: W, effectiveTime: EFF }

  it('★ 有无 band 的两种形态：无 band ⇒ 与二值口径逐位相同；有 band ⇒ 覆盖率抬高', () => {
    // 无 band：cont 没攒满第 6 窗（K = floor(cont)）
    const flat = continuousStunCoverage({ ...base, plannedWindows: 5, builtWindows: 5.958 })
    expect(flat.inBand).toBe(false)
    expect(flat.coverage, '无 band ⇒ 与 stunWindowFraction 逐位相同').toBeCloseTo(5 * W / EFF, 9)

    // 有 band：池攒出 6.266 窗、轴只排 5 窗 ⇒ 第 6 窗已开启、时间不够
    const band = continuousStunCoverage({ ...base, plannedWindows: 5, builtWindows: 6.266 })
    expect(band.inBand, '有 band ⇒ 展示层要标注').toBe(true)
    expect(band.coverage).toBeGreaterThan(flat.coverage)
    expect(band.coverage, '覆盖率 = 兑现窗 × W / eff').toBeCloseTo((5 + band.lastFraction) * W / EFF, 9)
  })

  it('★ 覆盖率**只升不降**：池低于计划（异常读数）不得把覆盖率压到旧口径以下', () => {
    const below = continuousStunCoverage({ ...base, plannedWindows: 5, builtWindows: 2.0 })
    expect(below.coverage).toBeCloseTo(5 * W / EFF, 9)
  })

  it('★ 决算截断损失秒照旧从分子扣（与 stunWindowFraction 同口径）', () => {
    const lost = 8
    const r = continuousStunCoverage({ ...base, plannedWindows: 5, builtWindows: 6.266, lostSeconds: lost })
    expect(r.coverage).toBeCloseTo(Math.max(0, (5 + r.lastFraction) * W - lost) / EFF, 9)
  })
})
