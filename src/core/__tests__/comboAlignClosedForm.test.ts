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
 * 本锁钉四件事：
 *   ① **分支走向**：容量咬合（Δ > r·T）且 r<1 ⇒ `'closed-form'`；容量不咬合 ⇒ `'cap-not-binding'`；
 *      r = 1 且咬合 ⇒ `'r1-linear'`（**必须单独分支**：方程二次项系数为 0）。
 *   ② **迭代轮数**：闭式三个分支恒 `1`（现状 8 轮上限、慢收敛队打满）——`41 → 1`（34 支闸门队合计，r=0.4）。
 *   ③ **落点与旧 8 轮迭代等价但有界差**：`|take_closed − take_legacy| ≤ 1e-6`，且在**生产夹具**上
 *      **严格等于 T117 实测的 7.97e-8s**（浮动则说明参数或公式变了）。
 *   ④ **收敛诊断量 `converged`**（T123b 批 2）：判据走**残差**而不是轮数，且**接到 cfg + 返回值上**
 *      可机检——全库判据「`converged == false` 的队数 == 0」在 ⑥。
 *
 * ## 反证（改回 8 轮迭代 ⇒ 本锁当场红）
 *
 * 把 `solveComboAlignTake` 的 `'closed-form'` 分支换成 `legacyComboAlignTake`，则：
 *   ① 分支断言红（`'legacy-fallback'` ≠ `'closed-form'`）；
 *   ② `iterations` 断言红（主队 8 ≠ 1）；
 *   ③ `converged` 断言红（旧迭代在主队留下 2.43e-9 相对残差 > 1e-12 门 ⇒ false）。
 * 三条都**不依赖数值差**（8e-8 太小，任何数值断言都拦不住）⇒ 锁是有效的。
 * 其中 ③ 是**独立的一条**：把 legacy 结果伪装成闭式解（branch/iterations 都改对）仍会被它拦下。
 */
import { describe, it, expect } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { teamPresets } from '@/data/teamPresets'
import {
  COMBO_ALIGN_CONVERGED_TOLERANCE, comboAlignTakeResidual, legacyComboAlignTake, solveComboAlignTake,
} from '@/core/resource/helpers'

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

  it('⑤ 求解器自报收敛（批 2 字段口径）：闸门全档 `converged == false` 的档数 == 0，且旧迭代同档会红', () => {
    /**
     * 设计稿批 1 的判据⑤ = 「`converged == false` 的队数 == 0」，批 2（T123b）把它做成 `solveComboAlignTake`
     * 自报的 `converged` 字段（再经 cfg/返回值上到全库判据 ⑥）。
     *
     * **判据是残差，不是轮数**（口径见 `comboAlignTakeResidual` 头注释）：`iterations === 1` 只说明
     * 「没打满上限」，而旧迭代在主队第 8 轮 `break` 触发时 `iterations` 也是 8——两者都会漏掉
     * 「声称收敛、实际留残差」这一形态。故这里同时钉**两条**，并断言旧迭代在同一批档上确实被判 false。
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
      expect(sol.converged, `r=${r.toFixed(3)} 闭式解应判收敛`).toBe(true)
      expect(sol.iterations, `r=${r.toFixed(3)} 闭式解恒 1 轮`).toBe(1)
      // 同档的旧迭代读数：按**同一残差口径**判定（不是按「是否打满 8 轮」）
      const legacyTake = legacyComboAlignTake(MAIN.S, MAIN.B, MAIN.T, r)
      if (comboAlignTakeResidual(MAIN.S, MAIN.B, MAIN.T, r, legacyTake) > COMBO_ALIGN_CONVERGED_TOLERANCE) {
        legacyUnconverged++
      }
      n++
    }
    // r = 1 在**本夹具**上落到「不咬合」支（Δ 40.85 ≤ r·T = 76.97）⇒ 用一个小 T 的夹具把它扫进来
    const r1 = solveComboAlignTake(MAIN.S, MAIN.B, 15, 1) // Δ 40.85 > r·T = 15 ⇒ 咬合 + r=1
    expect(r1.branch).toBe('r1-linear')
    expect(r1.converged).toBe(true)
    expect(r1.iterations).toBe(1)
    branches.add(r1.branch)
    n++
    expect(n, '扫描面不许空').toBeGreaterThan(30)
    expect(branches, '三种分支都必须被扫到（反空洞）').toEqual(new Set(['cap-not-binding', 'closed-form', 'r1-linear']))
    // ★ 反证面（活性）：旧迭代在**同一批档**上被判未收敛 ⇒ 本判据不是恒真式。
    // 实测咬合档 20 档里 18 档判 false（r=0.5 那档起旧迭代恰好也压到门内）。
    expect(legacyUnconverged, '旧迭代在同档确实被判未收敛（= 判据⑤ 的存量，本判据非恒真）').toBeGreaterThan(0)
  })

  it('⑥ 全库判据（批 2 主判据）：97 队 `converged == false` 的队数 == 0，且反空洞下限 = 30 支闸门队', async () => {
    /**
     * 设计稿 §5 批 2 的判据原文：「**全库跑一遍，断言『`converged == false` 的队数 == 0』**」。
     *
     * 扫描面 = `timeGolden` / `debt2Census` 同口径（每队新建 harness + `loadBuildRecommendations`
     * + `setAgent` + `applyTeamPreset`），97 个 3 人预设全跑；读数取**生产返回值**上的
     * `TeamResourceResult.dynamicComboAlignConverged`（不是 cfg——见该字段头注释的实测依据）。
     *
     * **反空洞兜底（本仓硬规矩）**：扫描面塌成 0 队 / 闸门全没开时「0 个未收敛」会假绿。
     * 故同时断言 `dynamicComboAlignIterations > 0`（= 真的进了 `solveComboAlignTake`）的队数 ≥ 30。
     * 下限 30 的标定依据（T123b 实测 @ `739ccf85`）：**实测 35 队**（iters 直方图 `0:62 1:35`），
     * 设计稿 §1.3 的闸门普查是 34 队 —— 取 30 = 实测值下方留 5 队余量（够吸收 1~2 队的数据漂移，
     * 又远高于「塌成 0」）。**不要把下限调到 0 或删掉它**：那正是本判据唯一会假绿的口子。
     */
    const presets = teamPresets.filter(p => Array.isArray(p.team) && p.team.length === 3)
    expect(presets.length, '预设库扫描面不许空').toBeGreaterThanOrEqual(90)
    const unconverged: string[] = []
    const incoherent: string[] = []
    let solved = 0
    for (const p of presets) {
      const { catalog, config } = await setupHarness(['', '', ''])
      await catalog.loadBuildRecommendations()
      const calc = useResourceCalc()
      for (let i = 0; i < 3; i++) config.setAgent(i, p.team[i])
      config.applyTeamPreset(p.team as [string, string, string])
      const rr = calc.resourceResult.value
      expect(rr, `${p.id} 无资源结果`).toBeTruthy()
      const iters = rr!.dynamicComboAlignIterations ?? -1
      if (iters > 0) solved++
      if (rr!.dynamicComboAlignConverged === false) {
        unconverged.push(`${p.id} conv=false iters=${iters}`)
      }
      /**
       * **跨字段不变量**（T123b 反证 D 实测补上的洞）：`converged` 与 `iterations` 是同一次求解的两个
       * 读数，必须自洽——「真跑过求解器（`iters > 0`）却判未收敛」是允许的（那就是要抓的存量），
       * 但「**没跑**（`iters === 0`，闸门未开）却判 `false`」是**接线错误**（没有子问题可解 ⇒ 真空收敛）。
       * 这条不变量让「把 `converged` 单独写死 `false`」当场红，也让两个字段不能各写各的。
       * ⚠ 它**不**拦「把两个字段一起写死成常量」——那个洞由 ⑦ 的「取到 0/1 两个值」+ 反证 A 覆盖
       * （见 ⑦ 头注释，这里不重复吹牛）。
       */
      if (iters === 0 && rr!.dynamicComboAlignConverged !== true) {
        incoherent.push(`${p.id} 闸门未开（iters=0）却 conv=${rr!.dynamicComboAlignConverged}`)
      }
    }
    expect(incoherent, `诊断量跨字段不自洽（闸门未开 = 真空收敛，必须为 true）:\n${incoherent.join('\n')}`).toEqual([])
    expect(unconverged, `吸收子问题未收敛的队（设计稿批 2 判据：必须为 0）:\n${unconverged.join('\n')}`).toEqual([])
    expect(solved, '反空洞：真进了求解器（iterations > 0）的队数 ≥ 30（实测 35，下限按实测留 5 队余量）')
      .toBeGreaterThanOrEqual(30)
  }, 600_000)

  it('⑦ 接线判据：诊断量取到**多个不同值**（不是常量），闸门开/关两档读数正确', async () => {
    /**
     * ⑥ 有个结构性盲区，**必须写清楚而不是假装不存在**：闭式解在 97 队上本来就全收敛 ⇒
     * 「`converged` 是真读数」与「`converged` 被写死 `true`」在**绿态下不可区分**。
     * T123b 反证 B 实测：把求解器的 `converged` 写死 `true` ⇒ ⑥ **仍绿**（拦下它的是 ①②④⑤ 的
     * branch/iterations/残差断言，不是 ⑥）。**所以 ⑥ 是「条件判据」**——它的意义建立在本条与
     * ①②④⑤ 之上：那些断言钉住「求解器是闭式解（真收敛的那条路）」，⑥ 才钉住「全库读数都为真」。
     *
     * 本条钉**可机检的那部分**（不吹牛成「已证明字段非恒真」）：
     *   ① `iterations` 在全库取到 **0 与 1 两个不同值** ⇒ 它不是常量，且 0 有明确语义（闸门未开）；
     *   ② 闸门开的队 `converged === true` 且 `iterations > 0`；闸门关的队 `iterations === 0`；
     *   ③ 活性面：同夹具的旧 8 轮迭代读数**超门** ⇒ 若有人把求解器改回旧迭代，`converged` 会翻
     *      `false`（反证 A 已实测：⑥ 当场点名 `auto-1431-1481-1491`）。
     */
    const evalPreset = async (id: string) => {
      const { catalog, config } = await setupHarness(['', '', ''])
      await catalog.loadBuildRecommendations()
      const calc = useResourceCalc()
      const p = teamPresets.find(x => x.id === id)!
      for (let i = 0; i < 3; i++) config.setAgent(i, p.team[i])
      config.applyTeamPreset(p.team as [string, string, string])
      const rr = calc.resourceResult.value!
      return {
        conv: rr.dynamicComboAlignConverged,
        iters: rr.dynamicComboAlignIterations ?? -1,
        dyn: rr.characters.reduce((a, c) => a + (c.timeAllocation.dynamicComboAlignSeconds ?? 0), 0),
      }
    }
    // ② 闸门开（有吸收）的队：真跑过求解器，且判收敛
    const open = await evalPreset('auto-1431-1481-1491')
    expect(open.dyn, '主队必须有可见吸收（否则本条退化成闸门关闭档的自证）').toBeGreaterThan(0)
    expect(open.conv, '生产主队应判收敛').toBe(true)
    expect(open.iters, '闸门开 ⇒ 真跑过求解器（闭式解 1 轮）').toBeGreaterThan(0)
    // ② 闸门关（无吸收）的队：没有子问题可解 ⇒ 0 轮（真空收敛）
    const closed = await evalPreset('auto-1021-1481-1211')
    expect(closed.dyn, '该夹具无吸收（闸门未开）').toBe(0)
    expect(closed.iters, '闸门未开 ⇒ 0 轮').toBe(0)
    expect(closed.conv, '闸门未开 = 没有子问题可解 ⇒ 真空收敛').toBe(true)
    // ① 两个不同值 ⇒ `iterations` 不是常量
    expect(new Set([open.iters, closed.iters]).size, '`iterations` 应取到 0 与 1 两个不同值').toBe(2)

    // ③ 活性面：旧迭代在同夹具上超门 ⇒ 本字段对「换回旧迭代」是敏感的（反证 A 实测 ⑥ 会红）
    const legacyTake = legacyComboAlignTake(MAIN.S, MAIN.B, MAIN.T, MAIN.r)
    expect(comboAlignTakeResidual(MAIN.S, MAIN.B, MAIN.T, MAIN.r, legacyTake),
      '旧迭代在主队夹具上超门（⇒ 换回旧迭代时 converged 会翻 false，本字段非恒真）')
      .toBeGreaterThan(COMBO_ALIGN_CONVERGED_TOLERANCE)
    expect(solveComboAlignTake(MAIN.S, MAIN.B, MAIN.T, MAIN.r).converged).toBe(true)
  }, 300_000)
})
