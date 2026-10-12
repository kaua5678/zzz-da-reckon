/**
 * 难度曲线**关键旋钮点**判据（T140c 卡 §6，取代 2026-09-10 的「贪心阶梯」四条判据）。
 *
 * ## 锁什么（每条对应卡里的一个既定口径）
 *
 * ① **点数 1~4**、`①④` 恒存在（卡 §6.2 / §4）；
 * ② **轴态如实**：每点带 `axis`（唯一事实源 = `difficultyAxis#axisStateOf`），三态 + `none` 可读；
 * ③ **④ = 纯收益拉满**（吸收率 == `absorbCap`，卡 §6.4）；
 * ④ **④ ≥ ①**（「难度上升 ⇒ 总伤上升」，卡 §6.5）；
 * ⑤ **负控**：拆掉 ② 的扫描 ⇒ 有轴队点数掉到 2 ⇒ 红（卡 §6.2 的负控要求）；
 * ⑥ **现场恢复**：跑完不留痕（机制开关 / 权重 / 吸收率）。
 *
 * ## 旧判据去哪了（T140c 有意取代，非静默删除）
 *
 * 旧文件的「单调不减」「负收益目标被丢弃并如实上报」「x 是累积代价」「目标契约」四条**随贪心阶梯一并失效**：
 * - 「单调不减」被卡 §4 明确**推翻**——「某点增益为负 ⇒ 如实画出下降段并标注，**不回退该点**，
 *   下降是引擎的实情，藏起来才是骗人」；
 * - 「丢弃目标」这个概念在卡 §3.4 里被**删除**（`dropped` 字段整体移除）⇒ 无「丢弃」可锁；
 * - 「x 是累积代价」被实测口径取代（x = 绝对操作难度，见 `difficultyCurve.ts` 的 @fact）。
 * 完整否决记录见 `docs/ENGINE_PIPELINE_GUIDE.md` §4。
 */
import { describe, it, expect, vi } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { teamPresets } from '@/data/teamPresets'
import { applyTeamToStore } from '@/composables/teamCompare'
import {
  absorbCapOf, climbDifficultyLadder, summarizeLadder, resetDifficultyGoals, clearDifficultyLevers,
  type LadderCtx,
} from '@/composables/difficultyLadder'
import { axisStands } from '@/composables/difficultyAxis'
import { captureDmgBySource, captureKeyCounts } from '@/composables/difficultyCurve'
import { computeDifficultyCurves } from '@/composables/difficultyCurve'
import { withAnalysisScenario } from '@/composables/analysisScenario'
import type { BossPreset, BossPresetPhase } from '@/types/bossPreset'
import { COMBO_ALIGN_ABSORB_RATIO_SETTING, DEFAULT_COMBO_ALIGN_ABSORB_RATIO } from '@/data/resourceDefaults'

// 本文件每条都要跑完整引擎（每点含一次 joint 联合搜索 ≈1.5s/队 + 扫描网格）⇒ 默认 5s 会超时
vi.setConfig({ testTimeout: 300_000 })

/** 实测提升最大的队之一（对旋钮最敏感），沿用旧夹具沿革（2026-10-09 预设库重生成 85→77 条后换入） */
const TEAM = 'auto-1521-1481-1311'

/**
 * 卡 §6.3 的数字判据必须走**验收面**（套 Boss + `applyGoldSteps`）⇒ 需要一个 Boss 夹具。
 * 用 `catalog.loadBossPresets()` 的真实最新期 Boss（与页面 `TeamComparePage` onMounted 同口径），
 * 而不是自造一个假 Boss —— 卡里的 0.45 就是在真实 Boss 上量的。
 */
let bossFixture: { boss: BossPreset; phase: BossPresetPhase } | null = null
async function loadBossFixture(catalog: Awaited<ReturnType<typeof setupHarness>>['catalog']) {
  if (!bossFixture) {
    const data = await catalog.loadBossPresets()
    const sorted = [...(data.bosses ?? [])].sort((a, b) =>
      String(b.phases[0]?.begin ?? '').localeCompare(String(a.phases[0]?.begin ?? '')))
    const boss = sorted[0]!
    bossFixture = { boss, phase: boss.phases[0]! }
  }
  return bossFixture
}

describe('难度曲线关键旋钮点（T140c）', () => {
  it('① 点数 1~4 + ①④ 恒存在 + 点名序列合法 + ② 轴态如实', async () => {
    const { catalog, config } = await setupHarness(['', '', ''], { productionBasicWeights: true })
    await catalog.loadBuildRecommendations()
    const calc = useResourceCalc()
    const ctx: LadderCtx = { config, calc }
    const p = teamPresets.find(x => x.id === TEAM)!
    const r = climbDifficultyLadder(ctx, p.team as [string, string, string])

    // 点数 1~4（卡 §6.2）；①④ 恒存在（卡 §4）
    expect(r.points.length).toBeGreaterThanOrEqual(2)
    expect(r.points.length).toBeLessThanOrEqual(4)
    expect(r.points[0]!.point).toBe('baseline')
    expect(r.points[r.points.length - 1]!.point).toBe('max')
    expect(r.points[0]!.dmg).toBe(r.base)

    // 点名序列合法（只允许 baseline → [axis] → [progress] → max 这个次序）
    const order = ['baseline', 'axis', 'progress', 'max']
    let cursor = -1
    for (const pt of r.points) {
      const i = order.indexOf(pt.point)
      expect(i, `点名 ${pt.point} 必须存在`).toBeGreaterThanOrEqual(0)
      expect(i, `点名次序必须单调推进（${r.points.map(x => x.point).join('→')}）`).toBeGreaterThan(cursor)
      cursor = i
    }

    // ② 点存在 ⇔ 该点轴真的成立（`axisStands`）；否则如实标缺失
    const axisPt = r.points.find(x => x.point === 'axis')
    if (axisPt) expect(axisStands(axisPt.axis), '② 点的轴态必须成立').toBe(true)
    if (!axisPt) expect(r.axisPointMissing, '② 缺失必须如实上报').toBe(true)

    // 每点都带可读轴态（四态之一）+ 旋钮取值
    for (const pt of r.points) {
      expect(['complete', 'partial', 'infeasible', 'none']).toContain(pt.axis.kind)
      expect(pt.axis.skippedTotal).toBeGreaterThanOrEqual(0)
      expect(['default', 'joint']).toContain(pt.knobs.interactions)
      expect(pt.knobs.absorb).toBeGreaterThanOrEqual(0)
      expect(pt.knobs.absorb).toBeLessThanOrEqual(1)
    }
    // ① 的旋钮 = 全关（交互默认 + 吸收 0）——这是「最低」的定义
    expect(r.points[0]!.knobs).toEqual({ interactions: 'default', absorb: 0 })
  })

  it('③ ④ = 纯收益拉满（吸收率 == absorbCap，卡 §6.4）', async () => {
    const { catalog, config } = await setupHarness(['', '', ''], { productionBasicWeights: true })
    await catalog.loadBuildRecommendations()
    const calc = useResourceCalc()
    const ctx: LadderCtx = { config, calc }
    const p = teamPresets.find(x => x.id === TEAM)!
    const cap = absorbCapOf(ctx)
    const r = climbDifficultyLadder(ctx, p.team as [string, string, string])
    const last = r.points[r.points.length - 1]!
    expect(last.point).toBe('max')
    expect(last.knobs.absorb, '④ 必须把合轴吸收拉满到用户上限').toBeCloseTo(cap, 9)
    expect(last.knobs.interactions, '④ 的非纯收益取最优分配').toBe('joint')
  })

  it('④ ④ ≥ ①（「难度上升 ⇒ 总伤上升」的机器判据，卡 §6.5）', async () => {
    const { catalog, config } = await setupHarness(['', '', ''], { productionBasicWeights: true })
    await catalog.loadBuildRecommendations()
    const calc = useResourceCalc()
    const ctx: LadderCtx = { config, calc }
    const p = teamPresets.find(x => x.id === TEAM)!
    const r = climbDifficultyLadder(ctx, p.team as [string, string, string])
    expect(r.final, '④ 伤害必须 ≥ ① 伤害').toBeGreaterThanOrEqual(r.base - 1e-6)
    expect(r.gain).toBeCloseTo(r.final - r.base, 6)
    expect(r.gain).toBeGreaterThan(0) // 这条队实测确有提升
  })

  it('⑤ ② 的扫描确实在找**最小**吸收率（网格分辨率决定找到的值，负控见下条）', async () => {
    // ② 的定义是「求**最小**（交互配置, 吸收率）使轴成立」（卡 §3.1）⇒ 判据必须能证明扫描在**找最小**，
    // 而不只是"随便找一个能成立的值"。
    //
    // 判据 = **网格越粗、找到的值越大**（同一队、同一 cap）：
    //  - 全网格（20 步）找到 5% 网格上的最小可行值；
    //  - 粗网格（1 步 = 只试 cap）只能落在 cap。
    // 若把扫描拆掉（直接取 cap 或直接判「不成立」），下面的严格不等式立刻红。
    //
    // ⚠ 夹具 = `banyue-norma-lucia` + cap = 1：实测 5% 网格上的最小可行值 = **0.20**
    //   （该队 ① 轴不可行、joint 单独也不可行 ⇒ 必须靠吸收；见探针 `T140cPredict6`）。
    const { catalog, config } = await setupHarness(['', '', ''], { productionBasicWeights: true })
    await catalog.loadBuildRecommendations()
    const calc = useResourceCalc()
    const p = teamPresets.find(x => x.id === 'banyue-norma-lucia')!
    const ctx = { config, calc, absorbCap: 1 }
    const at = (steps: number) => climbDifficultyLadder(ctx, p.team as [string, string, string], { axisScanSteps: steps })
    const fine = at(20)
    const coarse = at(1)
    const fineAxis = fine.points.find(x => x.point === 'axis')
    const coarseAxis = coarse.points.find(x => x.point === 'axis')
    expect(fineAxis, '全网格下 ② 必须存在').toBeTruthy()
    expect(coarseAxis, '粗网格下 ② 也必须存在（只是值更粗）').toBeTruthy()
    // ① 全网格找到的是**严格更小**的值（证明扫描在找最小，而不是机械取 cap）
    expect(fineAxis!.knobs.absorb, '全网格应找到比 cap 更小的值').toBeLessThan(coarseAxis!.knobs.absorb - 1e-9)
    // ② 粗网格（1 步）只能落在 cap
    expect(coarseAxis!.knobs.absorb).toBeCloseTo(1, 9)
    // ③ 两点都**真的让轴成立**（否则「最小」是在比较一堆不成立的档）
    expect(axisStands(fineAxis!.axis)).toBe(true)
    expect(axisStands(coarseAxis!.axis)).toBe(true)
    // ④ ①④ 恒存在（两条路径都不许丢）
    for (const r of [fine, coarse]) {
      expect(r.points[0]!.point).toBe('baseline')
      expect(r.points[r.points.length - 1]!.point).toBe('max')
    }
  }, 300_000)

  it('⑥ 现场恢复：跑完机制开关 / 吸收率 / 权重都回到跑前（只探测不落地）', async () => {
    const { catalog, config } = await setupHarness(['', '', ''], { productionBasicWeights: true })
    await catalog.loadBuildRecommendations()
    const calc = useResourceCalc()
    const ctx: LadderCtx = { config, calc }
    const p = teamPresets.find(x => x.id === TEAM)!
    clearDifficultyLevers(ctx)
    applyTeamToStore(config, p)
    const before = {
      absorb: config.getMechanicSetting(COMBO_ALIGN_ABSORB_RATIO_SETTING, -1),
      projection: config.getMechanicSetting('time.stunPlanProjection', -1),
      guarantee: ['guarantee.stun', 'guarantee.fury', 'guarantee.ultimate'].map(k => config.getMechanicSetting(k, -1)),
      weights: [0, 1, 2].map(s => config.team[s]!.basicAttackTimeWeight),
      parry: [0, 1, 2].map(s => config.team[s]!.parryCount),
      align: JSON.stringify(config.comboAlignOverrides ?? {}),
    }
    climbDifficultyLadder(ctx, p.team as [string, string, string], { base: c => c.calc.teamTotalDamage.value })
    expect(config.getMechanicSetting(COMBO_ALIGN_ABSORB_RATIO_SETTING, -1)).toBe(before.absorb)
    expect(config.getMechanicSetting('time.stunPlanProjection', -1)).toBe(before.projection)
    expect(['guarantee.stun', 'guarantee.fury', 'guarantee.ultimate'].map(k => config.getMechanicSetting(k, -1)))
      .toEqual(before.guarantee)
    expect([0, 1, 2].map(s => config.team[s]!.basicAttackTimeWeight)).toEqual(before.weights)
    expect([0, 1, 2].map(s => config.team[s]!.parryCount)).toEqual(before.parry)
    expect(JSON.stringify(config.comboAlignOverrides ?? {})).toBe(before.align)
  })

  it('缺省基线契约：resetDifficultyGoals 能回到「全关 + 0命1精」且伤害有限', async () => {
    const { catalog, config } = await setupHarness(['', '', ''], { productionBasicWeights: true })
    await catalog.loadBuildRecommendations()
    const calc = useResourceCalc()
    const ctx: LadderCtx = { config, calc }
    const p = teamPresets.find(x => x.id === TEAM)!
    const base = resetDifficultyGoals(ctx, p.team as [string, string, string])
    expect(Number.isFinite(base)).toBe(true)
    expect(base).toBeGreaterThan(0)
    // 全关语义：三个保底键归零、投影 off、吸收 0
    for (const k of ['guarantee.stun', 'guarantee.fury', 'guarantee.ultimate']) {
      expect(config.getMechanicSetting(k, -1)).toBe(0)
    }
    expect(config.getMechanicSetting('time.stunPlanProjection', -1)).toBe(0)
    expect(config.getMechanicSetting(COMBO_ALIGN_ABSORB_RATIO_SETTING, -1)).toBe(0)
  })

  it('摘要：斜率 = 单位难度收益（除零保护）', async () => {
    const { catalog, config } = await setupHarness(['', '', ''], { productionBasicWeights: true })
    await catalog.loadBuildRecommendations()
    const calc = useResourceCalc()
    const ctx: LadderCtx = { config, calc }
    const p = teamPresets.find(x => x.id === TEAM)!
    const r = climbDifficultyLadder(ctx, p.team as [string, string, string], {
      costOf: () => 10,
    })
    const s = summarizeLadder(r)
    expect(s.gainPct).toBeGreaterThan(0)
    expect(Number.isFinite(s.slope)).toBe(true)
    expect(s.totalCost).toBe(10)
    expect(s.slope).toBeCloseTo(s.gainPct / s.totalCost, 6)
  })

  it('cap = 0（用户关掉合轴）⇒ ④ 吸收为 0；需靠合轴才立得起的队 ② 如实缺失', async () => {
    const { catalog, config } = await setupHarness(['', '', ''], { productionBasicWeights: true })
    await catalog.loadBuildRecommendations()
    const calc = useResourceCalc()
    const p = teamPresets.find(x => x.id === TEAM)!
    const r = climbDifficultyLadder({ config, calc, absorbCap: 0 }, p.team as [string, string, string])
    expect(r.points[r.points.length - 1]!.knobs.absorb).toBe(0)
    // ①④ 恒存在（卡 §4）；② 是否存在取决于「交互最优后轴是否本就成立」——两条都要自洽
    expect(r.points[0]!.point).toBe('baseline')
    expect(r.points[r.points.length - 1]!.point).toBe('max')
    const axisPt = r.points.find(x => x.point === 'axis')
    expect(axisPt !== undefined, '② 存在 ⇔ 轴在 (joint, 0) 下成立').toBe(!r.axisPointMissing)
    if (axisPt) expect(axisPt.knobs.absorb).toBe(0)
  })

  it('② 的缺失路径（卡 §4）：需靠合轴才立得起的队，cap=0 时 ② 缺失且点数 = 2', async () => {
    // 夹具 = `banyue-norma-lucia`：实测「joint 单独 ⇒ 轴不可行、吸收 0.45 ⇒ 轴成立」
    // （探针 `.zc/perf/T140cPredict6.perf.ts` 的 21 档细扫：r<0.45 恒 infeasible、r=0.45 起 partial）
    // ⇒ cap=0 时没有任何可用的时间旋钮 ⇒ ② 必须如实缺失（而不是硬造一个不成立的 ②）。
    const { catalog, config } = await setupHarness(['', '', ''], { productionBasicWeights: true })
    await catalog.loadBuildRecommendations()
    const calc = useResourceCalc()
    const p = teamPresets.find(x => x.id === 'banyue-norma-lucia')!
    // 前提：全 cap 下这条队的 ② 确实存在，且**要靠合轴**（absorb > 0）——否则本用例测不到「缺失」的对照
    const full = climbDifficultyLadder({ config, calc, absorbCap: DEFAULT_COMBO_ALIGN_ABSORB_RATIO }, p.team as [string, string, string])
    const axisPt = full.points.find(x => x.point === 'axis')
    expect(axisPt, '前提：该队在全 cap 下 ② 存在').toBeTruthy()
    expect(axisPt!.knobs.absorb, '前提：该队的 ② 确实要靠合轴（absorb > 0）').toBeGreaterThan(0)

    const none = climbDifficultyLadder({ config, calc, absorbCap: 0 }, p.team as [string, string, string])
    expect(none.axisPointMissing, 'cap=0 ⇒ 需靠合轴立轴的队 ② 缺失').toBe(true)
    // 卡 §4：② 缺失时仍是 ①[③]④（③ 不硬依赖 ②），但**绝不含 axis 点**
    expect(none.points.map(x => x.point)).not.toContain('axis')
    expect(none.points[0]!.point).toBe('baseline')
    expect(none.points[none.points.length - 1]!.point).toBe('max')
  })

  it('★ 卡 §6.3：`banyue-norma-lucia` 的 ② 落在 r*≈0.45（±0.05）—— 双旋钮扫描的判据', async () => {
    // 这一条是卡里唯一**指名道姓给了数字**的判据。它同时钉住两件事：
    //  ① 「**先 joint 再扫 r**」的顺序——实测「先 setR 再 joint」得 r*=0.75（探针 `T140cPredict6`），
    //     两者不可互换（joint 改变的是**必要**前台占用，吸收是兜底手段）；
    //  ② ② 的吸收率上限 = `absorbCap` ⇒ **必须把 cap 抬到 ≥ r\*** 才测得到这一点。
    //
    // ⚠ **必须走生产路径**（`computeDifficultyCurves` + Boss）：卡 §6.3 的 0.45 是在**验收面**
    //   （套 Boss + `applyGoldSteps`）上量的。裸 `climbDifficultyLadder`（无 Boss、harness 缺省配装）
    //   实测 r*=0.16 —— 同一条队在两套口径下 r* 不同，**这是预期**（卡 §2.4 的「11 队」在套 Boss 时是 14 队，
    //   同一口径差）。用裸夹具断言 0.45 会得到一条**假的**判据（测的是夹具不是引擎）。
    //
    // ⚠ 另一处实测发现：该队 r*=0.45 **大于引擎缺省 cap 0.4** ⇒ 用缺省 cap 跑时 ② **如实缺失**
    //   （`axisPointMissing = true`），曲线只有 ①④。这不是缺陷——「用户把合轴上限定在 40%，
    //   这条队就立不起轴」正是本卡要如实表达的信息。故这里显式把用户上限抬到 1.0。
    const { catalog, config } = await setupHarness(['', '', ''], { productionBasicWeights: true })
    await catalog.loadBuildRecommendations()
    const p = teamPresets.find(x => x.id === 'banyue-norma-lucia')!
    const fx = await loadBossFixture(catalog)
    config.setMechanicSetting(COMBO_ALIGN_ABSORB_RATIO_SETTING, 1)
    const [row] = await withAnalysisScenario(s => computeDifficultyCurves(s, { presets: [p], boss: fx.boss, phase: fx.phase }))
    const axisPt = row!.ladder.points.find(x => x.point === 'axis')
    expect(axisPt, '该队 ② 必须存在（cap = 1 ≥ r*）').toBeTruthy()
    expect(Math.abs(axisPt!.knobs.absorb - 0.45), `② 的吸收率应 ≈0.45，实测 ${axisPt!.knobs.absorb}`)
      .toBeLessThanOrEqual(0.05)
    // 该点轴态如实：0.45 档实测是**残缺轴**（跳过 1 招），不是完整轴 —— 「标注没正常打完就行」
    expect(axisStands(axisPt!.axis)).toBe(true)
  }, 300_000)

  it('★ cap 与 r* 的关系：r* > cap ⇒ ② 如实缺失（`banyue-norma-lucia` 实测 r*=0.45 vs 缺省 cap 0.4）', async () => {
    // 上一条的对照面：同一支队、同一交互配置，只把用户上限压回**引擎缺省 0.4**（< r*）
    // ⇒ 扫描走不到 0.45 ⇒ ② 必须**如实缺失**，而不是硬造一个「没立起来的 ②」。
    const { catalog, config } = await setupHarness(['', '', ''], { productionBasicWeights: true })
    await catalog.loadBuildRecommendations()
    const p = teamPresets.find(x => x.id === 'banyue-norma-lucia')!
    const fx = await loadBossFixture(catalog)
    config.setMechanicSetting(COMBO_ALIGN_ABSORB_RATIO_SETTING, DEFAULT_COMBO_ALIGN_ABSORB_RATIO)
    const [row] = await withAnalysisScenario(s => computeDifficultyCurves(s, { presets: [p], boss: fx.boss, phase: fx.phase }))
    expect(row!.ladder.axisPointMissing, `cap=${DEFAULT_COMBO_ALIGN_ABSORB_RATIO} < r*=0.45 ⇒ ② 缺失`).toBe(true)
    // ⚠ 卡 §4：② 缺失时曲线**不是**只有 ①④ —— ③「重大进步」仍在（它不再硬依赖 ②）：
    // 「② 点缺失 ⇒ 曲线直接跳到 ④，并在 ③ 位置标注『本队轴在任何难度下都不成立』」。
    // 故点位序列 = ①[③]④（③ 是否存在取决于该队在此区间有没有「Δ伤害 ≥ 门槛 且 ≥1 次离散增量」的跃迁）。
    const seq = row!.ladder.points.map(x => x.point)
    expect(seq[0]).toBe('baseline')
    expect(seq[seq.length - 1]).toBe('max')
    expect(seq, '② 缺失时不得出现 axis 点').not.toContain('axis')
    // 缺失时曲线仍如实给 ④ 的天花板（且 ④ 用的是 cap 本身）
    expect(row!.ladder.points[row!.ladder.points.length - 1]!.knobs.absorb).toBeCloseTo(DEFAULT_COMBO_ALIGN_ABSORB_RATIO, 9)
  }, 300_000)

  it('★ 卡 §4：非轴队不产出 ②，曲线仍是 ①[③]④（轴态列显示 —）', async () => {
    // 卡 §4 既定口径原文：
    // > 非轴队（`none`）：不产出 ② 点，曲线只有 **①③④**；轴态列显示 `—`。
    //
    // ⚠ 这条口径要求 ③ **不硬依赖 ②**（否则非轴队会塌成 ①④ 两点）。夹具 =
    // `auto-1431-1491-1311`：全库普查里「每一点轴态都是 none」的 58 队之一（真·非轴队）。
    const { catalog, config } = await setupHarness(['', '', ''], { productionBasicWeights: true })
    await catalog.loadBuildRecommendations()
    const calc = useResourceCalc()
    const p = teamPresets.find(x => x.id === 'auto-1431-1491-1311')!
    const r = climbDifficultyLadder({ config, calc, absorbCap: DEFAULT_COMBO_ALIGN_ABSORB_RATIO }, p.team as [string, string, string], {
      capture: c => ({
        counts: captureKeyCounts(c.calc), dmgBySource: captureDmgBySource(c.calc),
        overflow: c.calc.resourceResult.value?.overflowSeconds ?? 0,
      }),
    })
    // ① 非轴队**必须** ② 缺失
    expect(r.axisPointMissing, '非轴队 ② 必须缺失').toBe(true)
    const seq = r.points.map(x => x.point)
    expect(seq, '非轴队不得出现 axis 点').not.toContain('axis')
    // ② ①④ 恒存在（卡 §4）
    expect(seq[0]).toBe('baseline')
    expect(seq[seq.length - 1]).toBe('max')
    // ③ 每一点轴态都是 none（「轴态列显示 —」的数据面）
    for (const pt of r.points) {
      expect(pt.axis.kind, `${pt.point} 点应是非轴（none）`).toBe('none')
      expect(axisStands(pt.axis)).toBe(false)
    }
    // ④ ③ 不硬依赖 ②：点位序列只允许 baseline / progress / max 三种（progress 视跃迁有无而定）
    for (const name of seq) expect(['baseline', 'progress', 'max']).toContain(name)
  }, 300_000)

  it('④ 的天花板 = 用户设置的上限（absorbCap 契约：队间不串味）', async () => {
    const { catalog, config } = await setupHarness(['', '', ''], { productionBasicWeights: true })
    await catalog.loadBuildRecommendations()
    const calc = useResourceCalc()
    const p = teamPresets.find(x => x.id === TEAM)!
    // 用户把上限设成 0.7 ⇒ ④ 必须推进到 0.7，而不是引擎缺省 0.4
    const ctx: LadderCtx = { config, calc, absorbCap: 0.7 }
    const r = climbDifficultyLadder(ctx, p.team as [string, string, string])
    expect(r.points[r.points.length - 1]!.knobs.absorb).toBeCloseTo(0.7, 9)
    expect(DEFAULT_COMBO_ALIGN_ABSORB_RATIO).toBe(0.4) // 缺省仍是 0.4（对照）
  })
})
