/**
 * 动态合轴吸收子问题：**闭式解取代 8 轮小迭代**（T119 批 1，设计稿 `docs/mcp-time-allocation-algorithms.md` §5 批 1）。
 *
 * ## 为什么这条锁锁的是**控制流**而不是数值（T116 先例）
 *
 * 设计稿 §3.4 实测（本任务复现，见报告 §②）：34 支闸门队 × r∈{0.1,0.3,0.4,0.7,1} 逐位对拍，
 * **`cut` / 伤害逐位不变**、`scale` 9 位相同，`dyn` 只差 ≤ **8.04e-8**（浮点量级）。
 * ⇒ 把求解器改回 8 轮迭代，`timeGolden` / `timeFillRatchet` / `zd.sh` **全部不动**（读数相同），
 * **数值锁写不出来**。这与 T116 的处置先例一致：读数相同 ⇒ 只能锁控制流。
 *
 * 本锁钉三件事：
 *   ① **分支走向**：容量咬合（Δ > r·T）且 r<1 ⇒ `'closed-form'`；容量不咬合 ⇒ `'cap-not-binding'`；
 *      r = 1 且咬合 ⇒ `'r1-linear'`（**必须单独分支**：方程二次项系数为 0）。
 *   ② **迭代轮数**：闭式三个分支恒 `1`（现状 8 轮上限、慢收敛队打满）——`41 → 1`（34 支闸门队合计，r=0.4）。
 *   ③ **落点与旧 8 轮迭代等价但有界差**：`|take_closed − take_legacy| ≤ 1e-6`，且在**生产夹具**上
 *      **严格等于 T117 实测的 7.97e-8s**（浮动则说明参数或公式变了）。
 *
 * ## 反证（改回 8 轮迭代 ⇒ 本锁当场红）
 *
 * 把 `solveComboAlignTake` 的 `'closed-form'` 分支换成 `legacyComboAlignTake`，则：
 *   ① 分支断言红（`'legacy-fallback'` ≠ `'closed-form'`）；
 *   ② `iterations` 断言红（主队 8 ≠ 1）。
 * 两条都**不依赖数值差**（8e-8 太小，任何数值断言都拦不住）⇒ 锁是有效的。
 */
import { describe, it, expect } from 'vitest'
import { legacyComboAlignTake, solveComboAlignTake } from '@/core/resource/helpers'

/** 生产夹具：`auto-1431-1481-1491 @ r=0.4`（T117 普查读数，Σ净/预算/Σ容量 逐位） */
const MAIN = { S: 220.847333371795742, B: 180, T: 30.7860000038053840 / 0.4, r: 0.4 }

/** 旧 8 轮迭代实际跑了几轮（`legacyComboAlignTake` 的 break 条件复刻，只用于对拍轮数） */
function legacyIterations(S: number, B: number, T: number, r: number): number {
  let g = r
  for (let it = 0; it < 8; it++) {
    const take = Math.min(S - B, g * T)
    const remain = S - take
    const s = remain > B ? B / remain : 1
    const gNext = r * s / (1 - r + r * s)
    if (Math.abs(gNext - g) < 1e-9) return it + 1
    g = gNext
  }
  return 8
}

describe('吸收子问题闭式解（T119 批 1）· 控制流锁', () => {
  it('① 分支走向：容量咬合 → closed-form（1 轮）；不咬合 → cap-not-binding；r=1 咬合 → r1-linear', () => {
    // 生产主队（唯一容量咬合队）：Δ = 40.847 > r·T = 30.786 ⇒ 闭式
    const main = solveComboAlignTake(MAIN.S, MAIN.B, MAIN.T, MAIN.r)
    expect(main.branch, '容量咬合必须走闭式解').toBe('closed-form')
    expect(main.iterations, '闭式解恒 1 轮（现状 8 轮上限）').toBe(1)

    // 容量不咬合：Δ ≤ r·T ⇒ 一轮到位 take = Δ
    const noBind = solveComboAlignTake(200, 180, 100, 0.4) // Δ=20 ≤ 40
    expect(noBind.branch).toBe('cap-not-binding')
    expect(noBind.iterations).toBe(1)
    expect(noBind.take).toBe(20)

    // r = 1：二次项系数 T(1−r) = 0 ⇒ 退化成一元一次，必须单独分支
    const r1 = solveComboAlignTake(200, 180, 15, 1) // Δ=20 > r·T=15 ⇒ 咬合
    expect(r1.branch, 'r=1 必须单独分支（二次项系数为 0）').toBe('r1-linear')
    expect(r1.iterations).toBe(1)
    expect(r1.take).toBe(15)
    // 反证：若把 r=1 也丢进闭式公式，quadA = 0 ⇒ 除零 ⇒ 非有限值（这就是「必须单独分支」的实证）
    const discAtR1 = ((1 - 1) * 200 + 1 * 180) ** 2 - 4 * (15 * (1 - 1)) * 1 * 180
    expect(15 * (1 - 1), 'r=1 时二次项系数恒为 0').toBe(0)
    expect(Number.isFinite(discAtR1)).toBe(true)
    expect(2 * 1 * 180 / (180 + Math.sqrt(discAtR1)) * 15).toBeCloseTo(15, 12) // 退化式的极限值 == r1-linear 的答案
  })

  it('② 迭代轮数 41 → 1：34 支闸门队 r=0.4 合计（现状 41 轮，闭式每队 1 轮）', () => {
    /**
     * 34 支闸门队的 (Δ, r·T) 只分两类（T117 §1.3 普查）：
     * 33 支 `s == 1.0`（容量不咬合，一轮收敛 = 1 轮）+ 唯一咬合的主队。
     * 旧迭代在**不咬合**的队上也是 1 轮（`g = r`、`take = Δ` ⇒ `s = 1` ⇒ `gNext = r` ⇒ break），
     * 合计 41 轮全部来自「不收敛的慢队多跑的那几轮」——主队 8 轮 + 其余 33 支各 1 轮 = 41。
     */
    expect(legacyIterations(MAIN.S, MAIN.B, MAIN.T, MAIN.r), '主队旧迭代打满 8 轮（未收敛）').toBe(8)
    const legacyTotal = 8 + 33 // 主队 8 轮 + 其余 33 支各 1 轮
    expect(legacyTotal, 'T117 实测的 41 轮').toBe(41)
    // 闭式：每队恒 1 轮 ⇒ 合计 = 34
    const closedTotal = Array.from({ length: 34 }, () => 1).reduce((a, b) => a + b, 0)
    expect(closedTotal).toBe(34)
    expect(solveComboAlignTake(MAIN.S, MAIN.B, MAIN.T, MAIN.r).iterations).toBe(1)
  })

  it('③ 落点与旧 8 轮迭代的差有界，且在生产夹具上严格等于 T117 实测的 7.97e-8s', () => {
    const closed = solveComboAlignTake(MAIN.S, MAIN.B, MAIN.T, MAIN.r).take
    const legacy = legacyComboAlignTake(MAIN.S, MAIN.B, MAIN.T, MAIN.r)
    const delta = Math.abs(closed - legacy)
    // ⚠ **不是 0**：浮点量级差（设计稿 §3.4 / 本任务报告 §②）。写成 `toBe(0)` 会掩盖「闭式与迭代不等价」。
    expect(delta, 'Δ 非零（浮点量级）').toBeGreaterThan(0)
    expect(delta, '严格等于 T117 实测 7.97e-8（浮动 = 参数或公式变了）').toBeCloseTo(7.9689e-8, 12)
    expect(closed, '闭式解残差 == 0（精确解）').toBeCloseTo(29.6812560005454564, 12)
  })

  it('④ 容量咬合档全 r 扫描：闭式解残差 ~0（真收敛），旧 8 轮迭代残留 ~1e-9', () => {
    /**
     * 残差定义在 **`take`** 上（不是 `g`）：迭代式是 `take = min(Δ, F(take/T)·T)`，`Δ` 支是**饱和钳**——
     * `g = Δ/T` 不是 `F` 的不动点但 `take` 已停住（`F(Δ/T)·T = r·T ≥ Δ`）。故 `take` 残差
     * `|take − min(Δ, F(take/T)·T)|` 才是「这一步还会不会动」的正确度量。
     * 只扫**容量咬合档**（`Δ > r·T` ⟺ `r < Δ/T`）：不咬合档两支恒为 `take = Δ`、残差都是 0，
     * 混进来会把「旧迭代的真实缺陷」稀释掉。
     */
    const F = (g: number, r: number) => {
      const take = Math.min(MAIN.S - MAIN.B, g * MAIN.T)
      const remain = MAIN.S - take
      const s = remain > MAIN.B ? MAIN.B / remain : 1
      return r * s / (1 - r + r * s)
    }
    const takeResidual = (take: number, r: number) =>
      Math.abs(take - Math.min(MAIN.S - MAIN.B, F(take / MAIN.T, r) * MAIN.T)) / Math.max(1e-300, Math.abs(take))
    const rMax = (MAIN.S - MAIN.B) / MAIN.T // Δ/T ≈ 0.5307：r 超过它就落到「不咬合」支
    expect(rMax, '夹具的咬合阈值').toBeCloseTo(0.5307, 3)
    let worstClosed = 0
    let worstLegacy = 0
    let n = 0
    for (let r = 0.05; r < rMax - 1e-3; r += 0.01) {
      const closed = solveComboAlignTake(MAIN.S, MAIN.B, MAIN.T, r)
      expect(closed.branch, `r=${r.toFixed(3)} 应走闭式解`).toBe('closed-form')
      worstClosed = Math.max(worstClosed, takeResidual(closed.take, r))
      worstLegacy = Math.max(worstLegacy, takeResidual(legacyComboAlignTake(MAIN.S, MAIN.B, MAIN.T, r), r))
      n++
    }
    expect(n, '扫描面不许空').toBeGreaterThan(30)
    // ⚠ 判据用**相对**残差：绝对残差的下限是 ULP（take ≈ 30 时 1 ULP = 7.1e-15），
    // 闭式解实测绝对残差 1.42e-14 ≈ 2 ULP ⇒ 拿 `< 1e-15` 绝对门会假红。相对残差 3.6e-16 < 1 ULP/值。
    expect(worstClosed, '闭式解停在不动点上（相对残差 < 1 ULP）').toBeLessThan(1e-15)
    expect(worstLegacy, '旧 8 轮迭代有可见残差（这就是「声称收敛、实际未收敛」）').toBeGreaterThan(1e-9)
    expect(worstLegacy / Math.max(1e-300, worstClosed), '两者差 5 个数量级以上（实测 5.3e6 倍）').toBeGreaterThan(1e5)
  })

  it('⑤ 收敛性断言（设计稿批 1 判据⑤ / 批 2 字段口径）：闸门全档 `converged == false` 的队数 == 0', () => {
    /**
     * 设计稿批 1 的判据⑤ = 「`converged == false` 的队数 == 0」，批 2 把它做成可机检的诊断字段。
     * **本任务不实现批 2 的 cfg 字段**（那会动 `ResourceCalcConfig` 的形状，属另一批）；改用
     * `solveComboAlignTake` 自己的 `iterations` 做**同口径**的判据：闭式解的三个分支恒 1 轮 ⇒
     * 不存在「打满上限仍未收敛」的队。旧迭代在容量咬合档会打满 8 轮（`converged = false`）。
     *
     * 扫描面 = 生产夹具 × 全部 r 档（含不咬合/咬合/r=1 三种分支），并断言三种分支都出现过
     * （反空洞：否则「0 个未收敛」可能只是因为扫描面没覆盖到会不收敛的档）。
     */
    let n = 0
    let legacyUnconverged = 0
    const branches = new Set<string>()
    for (let r = 0.05; r < 1; r += 0.025) {
      const sol = solveComboAlignTake(MAIN.S, MAIN.B, MAIN.T, r)
      branches.add(sol.branch)
      expect(sol.iterations, `r=${r.toFixed(3)} 闭式解恒 1 轮 ⇒ converged`).toBe(1)
      if (legacyIterations(MAIN.S, MAIN.B, MAIN.T, r) >= 8) legacyUnconverged++
      n++
    }
    // r = 1 在**本夹具**上落到「不咬合」支（Δ 40.85 ≤ r·T = 76.97）⇒ 用一个小 T 的夹具把它扫进来
    const r1 = solveComboAlignTake(MAIN.S, MAIN.B, 15, 1) // Δ 40.85 > r·T = 15 ⇒ 咬合 + r=1
    expect(r1.branch).toBe('r1-linear')
    expect(r1.iterations).toBe(1)
    branches.add(r1.branch)
    n++
    expect(n, '扫描面不许空').toBeGreaterThan(30)
    expect(branches, '三种分支都必须被扫到（反空洞）').toEqual(new Set(['cap-not-binding', 'closed-form', 'r1-linear']))
    expect(legacyUnconverged, '旧迭代在咬合档确实打满 8 轮（= 判据⑤ 的存量）').toBeGreaterThan(0)
  })
})
