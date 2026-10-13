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
  absorbCapOf, climbDifficultyLadder, summarizeLadder, resetDifficultyGoals, clearDifficultyLevers, scanAbsorbGrid,
  optimizeInteractionsPerSlot, applyInteractionKnob, clearInteractions,
  type LadderCtx,
} from '@/composables/difficultyLadder'
import { axisStands } from '@/composables/difficultyAxis'
import { captureDmgBySource, captureKeyCounts } from '@/composables/difficultyCurve'
import { liveInteractions } from '@/composables/liveInteractions'
import type { ConfigModel } from '@/stores/config'
import type { TeamResourceResult } from '@/types/resource'
import { COMBO_ALIGN_ABSORB_RATIO_SETTING, DEFAULT_COMBO_ALIGN_ABSORB_RATIO } from '@/data/resourceDefaults'

/**
 * 交互总量（Σ 各类型次数）——与 `difficultyCurve#sumInteractions` 同口径（该函数是私有的，
 * 这里用**同一个单一事实源** `liveInteractions` 重算，不复制词表）。
 * `rr` 缺省 = 手填/声明量；给了 = 按装配期截断存活率缩后的**实打量**。
 */
function sumInteractionsOf(config: ConfigModel, rr: TeamResourceResult | null | undefined): number {
  let s = 0
  for (const it of liveInteractions(config, undefined, rr)) s += it.count || 0
  return s
}

// 本文件每条都要跑完整引擎（每点含一次 joint 联合搜索 ≈1.5s/队 + 扫描网格）⇒ 默认 5s 会超时
vi.setConfig({ testTimeout: 300_000 })

/** 实测提升最大的队之一（对旋钮最敏感），沿用旧夹具沿革（2026-10-09 预设库重生成 85→77 条后换入） */
const TEAM = 'auto-1521-1481-1311'

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
      expect(['zero', 'default', 'joint', 'slotLadder']).toContain(pt.knobs.interactions)
      expect(pt.knobs.absorb).toBeGreaterThanOrEqual(0)
      expect(pt.knobs.absorb).toBeLessThanOrEqual(1)
    }
    /**
     * ① 的旋钮 = **全 0 交互 + 吸收 0**（T141 用户口径 4+5：「低难度下就是**全 0 交互**的」/
     * 「不该用预设」）。旧断言是 `interactions: 'default'`（= 交互取预设/职业基准）——那正是本卡要删的。
     */
    expect(r.points[0]!.knobs).toEqual({ interactions: 'zero', absorb: 0 })
    /**
     * 卡 §6.5 判据：**① 是全 0 交互**——`interactionsPlayed`（实打交互总量）必须为 0。
     * ⚠ 它是 `opts.capture` 采出来的（缺省不采 = `undefined`）⇒ 必须显式传 capture 才测得到，
     * 否则断言 `undefined == 0` 会**假红**（本条一度踩过：`land()` 只透传 `snap()` 的字段）。
     * ⚠ 这是本卡「① = 难度天然下限」的直接机器判据，不是靠 `knobs` 标签自证。
     */
    const withCapture = climbDifficultyLadder(ctx, p.team as [string, string, string], {
      capture: c => ({
        counts: {}, dmgBySource: {},
        interactionsFilled: sumInteractionsOf(c.config, undefined),
        interactionsPlayed: sumInteractionsOf(c.config, c.calc.resourceResult.value),
      }),
    })
    expect(withCapture.points[0]!.interactionsPlayed, '① 的实打交互总量必须是 0（全 0 交互）').toBe(0)
    expect(withCapture.points[0]!.interactionsFilled, '① 的手填交互总量也必须是 0（全 0 交互）').toBe(0)
    /**
     * 反空洞（**必须换一支队**）：`TEAM = auto-1521-1481-1311` 在 ④ 上**确实不加任何交互**
     * ——实测该队全 0 交互就是最优（`zero` 120.425M，逐槽阶梯跑完仍 120.425M、
     * `interactionsPlayed = 0`，见 `.zc/perf/T141fourB.perf.ts`）。它自身不是缺陷：
     * 「交互对这支队无益」正是卡 §2.3「辅助交互是亏的」的极端形态，引擎如实表达即可。
     * ⇒ 反空洞必须换一支**阶梯真的会加交互**的队（`auto-1611-1141-1211` 实测 ④ 加 13 弹刀 + 14 闪反）。
     * 若把反空洞钉在 `TEAM` 上，它测的就不是「① = 0」而是「该队恰好不加交互」——一条假判据。
     */
    const p2 = teamPresets.find(x => x.id === 'auto-1611-1141-1211')!
    const withCapture2 = climbDifficultyLadder(ctx, p2.team as [string, string, string], {
      /**
       * ⚠ **走生产路径**（`opts.base` = `applyTeamToStore`）：裸路径（`resetDifficultyGoals`）
       * 只给 agent 默认权重、不套预设平A 权重 ⇒ 同一支队在两条路径上的「加交互有没有用」
       * **结论可以不同**（实测 `auto-1611-1141-1211`：裸路径 0→1 次弹刀 75.592M→70.436M
       * **不增**；预设权重路径 69.023M→77.797M **+8.77M**）。
       * 难度曲线的真实口径就是后者（`difficultyCurve.ts` 明写「展示层必须用 `opts.base` 覆盖」）
       * ⇒ 反空洞必须在**它实际跑的那条路径**上验。
       */
      base: c => { applyTeamToStore(c.config, p2); return c.calc.teamTotalDamage.value },
      capture: c => ({
        counts: {}, dmgBySource: {},
        interactionsFilled: sumInteractionsOf(c.config, undefined),
        interactionsPlayed: sumInteractionsOf(c.config, c.calc.resourceResult.value),
      }),
    })
    expect(withCapture2.points[0]!.interactionsPlayed, '① 的实打交互总量必须是 0（该夹具同样适用）').toBe(0)
    const lastPt = withCapture2.points[withCapture2.points.length - 1]!
    expect(lastPt.interactionsPlayed, '反空洞：④ 的实打交互总量应 > 0（逐槽阶梯加了交互）').toBeGreaterThan(0)
    /**
     * ## ★ 快支**整条曲线恒为 0**（用户裁决 2026-10-13，逐字）
     *
     * > 「**快支可以归零，并且高难度也不需要加快支**，因为这个招式本身就和平 a 差不多，
     * >   你也说了 Δ 很小。」
     *
     * ⇒ ① 归零快支（`clearInteractions` 含 `quickAssistCount`），且 ②③④ **都不得把它加回来**。
     * 机制上由两处保证，本条**直接钉这两个旋钮本体**（而不是钉整条阶梯——那个要 spy
     * `setActionCount`，而 `climbDifficultyLadder` 退出前的 `restore` 会把预设的
     * `quickAssistCount = 3` **原样写回**，全程 spy 会把「还原」误判成「加回快支」）：
     *  · `optimizeInteractionsPerSlot`（`slotLadder`）只爬 `parryCount` / `dodgeCounterCount`；
     *  · `applyInteractionKnob(ctx,'joint')` 的 `joint-levers` 三个杠杆 = 平A权重 / 弹刀 / 嘲讽取消。
     */
    const p3 = teamPresets.find(x => x.id === 'auto-1611-1141-1211')!
    clearDifficultyLevers(ctx)
    applyTeamToStore(config, p3)
    clearInteractions(ctx)
    expect([0, 1, 2].some(s2 => Number(config.team[s2]?.quickAssistCount ?? 0) > 0), '前提：① 已把快支清零').toBe(false)
    const spyOn = () => {
      const writes: number[] = []
      const orig = config.setActionCount.bind(config)
      const sp = vi.spyOn(config, 'setActionCount').mockImplementation((slot, key, v) => {
        if (key === 'quickAssistCount' && Number(v) > 0) writes.push(Number(v))
        return orig(slot, key, v)
      })
      return { writes, stop: () => sp.mockRestore() }
    }
    // ② 的交互旋钮：joint-levers（多杠杆联合搜索）
    const j = spyOn()
    applyInteractionKnob(ctx, 'joint')
    j.stop()
    expect(j.writes, `joint-levers 不得写非零快支（实测 ${JSON.stringify(j.writes)}）`).toEqual([])
    // ④ 的交互旋钮：slotLadder（逐槽阶梯）
    clearInteractions(ctx)
    const sl = spyOn()
    applyInteractionKnob(ctx, 'slotLadder')
    sl.stop()
    expect(sl.writes, `slotLadder 不得写非零快支（实测 ${JSON.stringify(sl.writes)}）`).toEqual([])
    // 反空洞：slotLadder 必须真的加了**别的**交互（否则上一条可能只是「什么都没做」）
    expect([0, 1, 2].reduce((a, s2) => a + Number(config.team[s2]?.parryCount ?? 0) + Number(config.team[s2]?.dodgeCounterCount ?? 0), 0),
      '反空洞：slotLadder 应真的加了弹刀/闪反（证明它动过手，只是不碰快支）').toBeGreaterThan(0)
    expect([0, 1, 2].reduce((a, s2) => a + Number(config.team[s2]?.quickAssistCount ?? 0), 0),
      '跑完两个旋钮后快支仍是 0').toBe(0)
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
    expect(last.knobs.interactions, '④ 的非纯收益取最优分配（T141：逐槽阶梯，见 optimizeInteractionsPerSlot）').toBe('slotLadder')
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

  it('⑤ `scanAbsorbGrid` 确实在找**最小**吸收率（网格分辨率决定找到的值 + 还原纪律）', async () => {
    /**
     * ## 为什么改测 `scanAbsorbGrid` 本体（T141）
     *
     * 旧版通过 ② 的落点间接测「扫描在找最小」（夹具 `banyue-norma-lucia`，r*≈0.45）。
     * ① 改「全 0 交互」后 **`joint` 从全 0 出发有充足加交互空间** ⇒ 全库 93 队
     * （cap=1 全扫，见 `.zc/perf/T141axis2.perf.ts`）**没有任何一队的 ② 需要吸收**
     * （`r ≡ 0`）⇒ 经由 ② 已经测不到网格分辨率（0 vs 0 恒真）。
     *
     * 但 `scanAbsorbGrid` **本身仍是活的**（③「重大进步」还在用它找跃迁点），且它是本模块
     * **唯一**的「求最小旋钮值」实现 ⇒ 判据直接钉它，比经由某支特定队的落点更稳（不随数据漂移失效）。
     *
     * 钉三件事：① 网格越粗、找到的值越大（证明在找**最小**，不是机械取 cap）；
     * ② 命中即停（不在命中后继续扫）；③ **`finally` 还原**（只探测、不改现场）。
     */
    const { catalog, config } = await setupHarness(['', '', ''], { productionBasicWeights: true })
    await catalog.loadBuildRecommendations()
    const calc = useResourceCalc()
    const ctx: LadderCtx = { config, calc }
    const p = teamPresets.find(x => x.id === TEAM)!
    clearDifficultyLevers(ctx)
    applyTeamToStore(config, p)
    config.setMechanicSetting(COMBO_ALIGN_ABSORB_RATIO_SETTING, 0.37) // 进入前的现场值（还原判据用）

    // ① 网格越粗、找到的值越大：探针 = 「r ≥ 0.3 才命中」
    const at = (steps: number) => {
      const seen: number[] = []
      const hit = scanAbsorbGrid(ctx, 1, 0, r => { seen.push(r); return r >= 0.3 - 1e-9 }, steps)
      return { hit, seen }
    }
    const fine = at(20)
    const coarse = at(4)
    expect(fine.hit, '全网格必须命中').not.toBeNull()
    expect(coarse.hit, '粗网格必须命中').not.toBeNull()
    // 20 步 = 5% 网格 ⇒ 首个 ≥0.3 的点是 0.30；4 步 = 25% 网格 ⇒ 首个 ≥0.3 的点是 0.50
    expect(fine.hit, '5% 网格上首个 ≥0.3 的点 = 0.30').toBeCloseTo(0.3, 6)
    expect(coarse.hit, '25% 网格上首个 ≥0.3 的点 = 0.50').toBeCloseTo(0.5, 6)
    expect(fine.hit!, '网格越粗、找到的值越大（证明在找最小）').toBeLessThan(coarse.hit! - 1e-9)
    // ② 命中即停：命中点之后不该再有探测点
    expect(fine.seen[fine.seen.length - 1], '命中即停（最后一个探测点 = 命中点）').toBeCloseTo(fine.hit!, 9)
    expect(fine.seen.length, '不该在命中后继续扫').toBeLessThan(20)
    // ③ 还原纪律：无论命中与否，进入前的吸收率必须原样回来（本函数只探测）
    expect(config.getMechanicSetting(COMBO_ALIGN_ABSORB_RATIO_SETTING, -1), '跑完必须还原到 0.37').toBeCloseTo(0.37, 9)
    // ③′ 扫不中也要还原（cap 太低 ⇒ 扫到 cap 都没命中）
    const miss = scanAbsorbGrid(ctx, 0.2, 0, () => false, 4)
    expect(miss, '扫不中 ⇒ 返回 null').toBeNull()
    expect(config.getMechanicSetting(COMBO_ALIGN_ABSORB_RATIO_SETTING, -1), '扫不中同样必须还原').toBeCloseTo(0.37, 9)
    // ③″ 起点 ≥ cap ⇒ 没有可扫的区间（如实返回 null，不空转）
    expect(scanAbsorbGrid(ctx, 0.2, 0.2, () => true, 4), '起点 ≥ cap ⇒ null').toBeNull()
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

  it('② 的缺失路径（卡 §4）：非轴队 ② 恒缺失，且**与 cap 无关**（它本来就不是轴队）', async () => {
    /**
     * ⚠ **T141 换夹具与口径**（原夹具 `banyue-norma-lucia`）：
     *
     * 旧口径下该队「joint 单独 ⇒ 轴不可行、吸收 0.45 ⇒ 轴成立」，故它是「需靠合轴立轴」的样本。
     * **① 改「全 0 交互」后这个前提消失了**：joint 从全 0 出发有充足的加交互空间 ⇒ 轴靠交互立起来，
     * ② 落在 `absorb = 0`（实测 `.zc/perf/T141axis2.perf.log`：全库 93 队里
     * **②需合轴(r>0) = 0 队**、②不需合轴(r=0) = 35 队、②缺失 = 58 队）。
     *
     * ⇒ 「② 缺失」现在的**唯一成因 = 该队本来就不是轴队**（`axisStateOf` 读到 `none`）。
     * 新夹具取一支实测 `none` 的队，并断言它的缺失**与 cap 无关**（0 和缺省都缺失）——
     * 这才是该判据现在能守住的真命题。
     */
    const { catalog, config } = await setupHarness(['', '', ''], { productionBasicWeights: true })
    await catalog.loadBuildRecommendations()
    const calc = useResourceCalc()
    const p = teamPresets.find(x => x.id === 'auto-1461-1031-1521')!
    for (const cap of [0, DEFAULT_COMBO_ALIGN_ABSORB_RATIO]) {
      const r = climbDifficultyLadder({ config, calc, absorbCap: cap }, p.team as [string, string, string])
      expect(r.axisPointMissing, `cap=${cap}：非轴队 ② 必须如实缺失`).toBe(true)
      // 卡 §4：② 缺失时仍是 ①[③]④（③ 不硬依赖 ②），但**绝不含 axis 点**
      expect(r.points.map(x => x.point)).not.toContain('axis')
      expect(r.points[0]!.point).toBe('baseline')
      expect(r.points[r.points.length - 1]!.point).toBe('max')
    }
  })

  it('② 的落点：交互最优后轴**本就成立** ⇒ ② 不烧吸收（全库 93 队实测 r ≡ 0）', async () => {
    /**
     * 卡 §3.1 的 ② = 「求**最小**（joint 交互, 吸收率）使轴成立」。① 改「全 0 交互」后，
     * `joint` 从全 0 出发能把交互加到够用 ⇒ **交互这一步就把轴立起来了**，不必再烧吸收率。
     * 实测（`.zc/perf/T141axis2.perf.ts`，生产路径 93 队）：
     * **②需合轴(r>0) = 0 队** / ②不需合轴(r=0) = 35 队 / ②缺失 = 58 队（全是非轴队）。
     *
     * ⚠ 这不是缺陷：吸收率是**兜底**手段（先 joint 再扫 r 的顺序见 `climbDifficultyLadder`），
     * 交互够用时就不该动它。本判据同时是**反空洞**的——若哪天 ② 开始烧吸收，本条会点名。
     */
    const { catalog, config } = await setupHarness(['', '', ''], { productionBasicWeights: true })
    await catalog.loadBuildRecommendations()
    const calc = useResourceCalc()
    const presets = teamPresets.filter(x => Array.isArray(x.team) && x.team.length === 3)
    const burning: string[] = []
    let withAxis = 0
    for (const p of presets) {
      const r = climbDifficultyLadder({ config, calc, absorbCap: 1 }, p.team as [string, string, string])
      const a = r.points.find(x => x.point === 'axis')
      if (!a) continue
      withAxis++
      if (a.knobs.absorb > 0) burning.push(`${p.id} r=${a.knobs.absorb}`)
    }
    expect(withAxis, '反空洞：必须有队产出 ②（否则本判据零覆盖）').toBeGreaterThan(0)
    expect(burning, `交互最优后轴本就成立 ⇒ ② 不该烧吸收：\n${burning.join('\n')}`).toEqual([])
  }, 900_000)

  it('★ 卡 §6.3：交互收益**按槽位职业分**——主C 全程 Δ ≥ 0 / 辅助 Δ ≤ 0 / 击破允许为正', async () => {
    /**
     * ⚠ **本条替换了旧的「r*≈0.45」判据**（T141 卡 2026-10-12 二次修订）。
     *
     * 旧 §6.3 钉的是 `banyue-norma-lucia` 的 ② 落在 r*≈0.45。那个数字**建立在旧 ① 语义上**
     * （① 走预设交互 ⇒ 交互已「花掉」，故轴要靠吸收才立得起来）。① 改「全 0 交互」后
     * `joint` 从全 0 出发有充足加交互空间 ⇒ ② 恒落在 `absorb = 0`（全库 93 队实测 r ≡ 0，
     * 见 `T141axis2.perf.ts`）⇒ 旧的 0.45 判据**测的对象已不存在**，继续钉它只会得到一条假判据。
     *
     * 卡修订后的 §6.3 = **交互收益按槽位职业分**（用户 2026-10-12 逐字）：
     * > 「**主c交互大多是不亏的**，我说了闪反比平a厉害，弹刀也不差，失衡和喧响还很赚，所以多半会赚。
     * >   **辅助交互才是亏的**。能考虑的只有击破弹刀让失衡加速，这也不一定赚。」
     *
     * 逐槽隔离实测基线（`.zc/perf/T141perSlot.perf.ts`，`auto-1611-1141-1211`）：
     * | 槽 | 定位 | 弹刀 1→16 | 闪反 1→30 |
     * |---|---|---|---|
     * | 0 | 克拉蕾（主C） | 全程正 +0.07→+5.87M | 全程正、单调升 +0.17→+19.06M |
     * | 1 | 莱卡恩（击破） | 正，峰 +8.16M | 正 +13.995M |
     * | 2 | 丽娜（支援） | **负** −0.19→−1.75M | 前期负、8 次后转正 |
     *
     * ⚠ **不得**再用「先升后降的拐点」当判据（旧 §2.3 已作废：那是三槽混扫的假象）。
     * ⚠ 判据按**槽位职业**（主C = `isCarrySpecialty`），不是硬编码槽号。
     */
    const { catalog, config } = await setupHarness(['', '', ''], { productionBasicWeights: true })
    await catalog.loadBuildRecommendations()
    const calc = useResourceCalc()
    const p = teamPresets.find(x => x.id === 'auto-1611-1141-1211')!
    const zeroAll = () => {
      clearDifficultyLevers({ config, calc })
      applyTeamToStore(config, p)
      for (const c of config.team) {
        c.parryCount = 0; c.dodgeCounterCount = 0; c.quickAssistCount = 0
      }
    }
    zeroAll()
    const base = calc.teamTotalDamage.value
    /** 逐槽 × 逐类型阶梯：返回每一档的 Δ */
    const sweep = (slot: number, key: 'parryCount' | 'dodgeCounterCount', steps: number[]) => {
      const out: { n: number; d: number }[] = []
      for (const n of steps) {
        zeroAll()
        config.setActionCount(slot, key, n)
        out.push({ n, d: calc.teamTotalDamage.value - base })
      }
      return out
    }
    const STEPS = [1, 2, 4, 8, 12, 16]
    // 主C（槽0 克拉蕾，锋御 = 输出定位）：**全程 Δ ≥ 0**（用户「主c交互大多是不亏的」）
    for (const key of ['dodgeCounterCount', 'parryCount'] as const) {
      for (const { n, d } of sweep(0, key, STEPS)) {
        expect(d, `主C ${key}=${n} 必须 Δ ≥ 0（实测基线全程正）`).toBeGreaterThanOrEqual(-1e-6)
      }
    }
    // 辅助（槽2 丽娜，支援）：弹刀**不得为正**（用户「辅助交互才是亏的」）
    // ⚠ 只钉弹刀：支援的闪反在 8 次后转正（失衡台阶），把它钉成 ≤0 会与实测冲突。
    for (const { n, d } of sweep(2, 'parryCount', [1, 2, 4, 8])) {
      expect(d, `辅助弹刀=${n} 不得为正（实测基线全负）`).toBeLessThanOrEqual(1e-6)
    }
    // 击破（槽1 莱卡恩）：**允许为正**（靠失衡加速）——判据只要求「不是被结构性排除」
    const breakthrough = sweep(1, 'parryCount', [2, 4])
    expect(Math.max(...breakthrough.map(x => x.d)), '击破弹刀允许为正（实测峰 +8.16M）').toBeGreaterThan(0)
  }, 900_000)

  it('★ 卡 §6.3b：交互增加时**实际执行的动作数不得下降**（逐槽扫描 + 逐档四信号）', async () => {
    /**
     * 用户两条质疑（卡 §2.3b 逐字）：
     * > 「你击破耗那么多时间，**考虑过主c动作被挤压没有**，你加一次失衡并不是能多那么多伤害，
     * >   如果你**时间不够，超过合轴率上限能包容的时间，你的动作都打不出来**。也许目前失衡写的
     * >   逻辑是**强制触发**，但实际上**时间截断才是强制的**。」
     * > 「而且**主c的时间被挤压后，喧响和能量都不够，轴内估计全是空气了**。」
     *
     * ## 判据的两半（**别把「逐档扫描」当成「全局单调」**）
     *
     * 卡原文：「交互增加时，实际执行的动作数**不得下降**；扫描须同时报 `skipped`(按 reason) /
     * `overflowSeconds` / `interactionScale` / `axisFallback` 四项，**任一恶化即该档不算正收益**」。
     * ⚠ 它是**接受门**（「该档不算正收益」= 不该被采纳），**不是**「任何槽加任何交互都必须单调」——
     * 实测（`.zc/perf/T141guard.perf.ts`）给**辅助**槽加弹刀时 `executed` 39→32（主C 动作被挤掉），
     * 那正是**要拦住**的档。故本判据分两半：
     *   A. **逐档如实报四信号**（本测试打印，供人工核对卡 §2.3 的基线表）；
     *   B. **接受门有效**：`optimizeInteractionsPerSlot` 走过的每一步都必须 `executed`/行数不降
     *      （= 生产门真的在拦，而不是只写在注释里）。
     */
    const { catalog, config } = await setupHarness(['', '', ''], { productionBasicWeights: true })
    await catalog.loadBuildRecommendations()
    const calc = useResourceCalc()
    const p = teamPresets.find(x => x.id === 'auto-1611-1141-1211')!
    const zeroAll = () => {
      clearDifficultyLevers({ config, calc })
      applyTeamToStore(config, p)
      for (const c of config.team) {
        c.parryCount = 0; c.dodgeCounterCount = 0; c.quickAssistCount = 0
      }
    }
    /** 四项健康读数 + 执行数（卡 §6.3b 要求逐档同时报） */
    const health = () => {
      const rr = calc.resourceResult.value
      let executed = 0
      for (const v of Object.values(calc.stackTraversalResult.value?.executed ?? {})) executed += v.count
      const byReason: Record<string, number> = {}
      for (const s of calc.stackTraversalResult.value?.skipped ?? []) byReason[s.reason] = (byReason[s.reason] ?? 0) + 1
      return {
        dmg: calc.teamTotalDamage.value,
        rows: calc.damagePoolRows.value.length,
        executed,
        skippedByReason: byReason,
        overflow: rr?.overflowSeconds ?? 0,
        interactionScale: rr?.convergence.interactionScale ?? 1,
        axisFallback: rr?.convergence.axisFallback === true,
      }
    }
    // ===== A. 逐档如实报（人工核对卡 §2.3 基线表）=====
    zeroAll()
    const base = health()
    const rows: string[] = []
    for (const slot of [0, 1, 2]) {
      for (const n of [2, 4, 8, 12]) {
        zeroAll()
        config.setActionCount(slot, 'parryCount', n)
        const h = health()
        rows.push(`槽${slot} 弹刀=${n}: Δdmg=${((h.dmg - base.dmg) / 1e6).toFixed(3)}M exec=${h.executed} 行=${h.rows} skip=${JSON.stringify(h.skippedByReason)} 溢=${h.overflow.toFixed(2)} 降配=${h.interactionScale.toFixed(3)} 弃轴=${h.axisFallback}`)
      }
    }
    console.log(`T141 卡§6.3b 逐档四信号（基线 exec=${base.executed} 行=${base.rows} dmg=${(base.dmg / 1e6).toFixed(3)}M）:\n${rows.join('\n')}`)

    // ===== B. 接受门有效：生产门走过的每一步都不许让 executed/行数下降 =====
    zeroAll()
    const beforeState = { exec: health().executed, rows: health().rows }
    optimizeInteractionsPerSlot({ config, calc })
    const afterState = { exec: health().executed, rows: health().rows }
    expect(afterState.exec, '接受门：跑完逐槽阶梯后 executed 不得低于起点').toBeGreaterThanOrEqual(beforeState.exec)
    expect(afterState.rows, '接受门：跑完逐槽阶梯后伤害池行数不得低于起点').toBeGreaterThanOrEqual(beforeState.rows)
    // 反空洞：本夹具上该阶梯必须**真的加了交互**（否则「不下降」是恒真式）
    const added = [0, 1, 2].reduce((a, s) => a + Number(config.team[s]?.parryCount ?? 0) + Number(config.team[s]?.dodgeCounterCount ?? 0), 0)
    expect(added, '反空洞：逐槽阶梯必须真的加了交互（否则本条零覆盖）').toBeGreaterThan(0)
  }, 900_000)

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

  it('★ 回归：② 缺失时 ③ 必须把**交互步**算作候选（否则非轴队塌成 2 点）', async () => {
    // ## 修的是什么（2026-10-12 实测定位的真缺陷）
    //
    // ② 的第一步会**无条件**施加 joint（交互取最优）。② 缺失时旧实现把 ③ 的基准点设成
    // 「joint + 吸收 0」⇒ **joint 那一步的跃迁被基准点预先吃掉**，③ 只剩吸收率可动 ⇒ 永远找不到
    // 跃迁 ⇒ 非轴队塌成 2 点（①④）。
    //
    // 实测归因（`.zc/perf/T140cGap.perf.ts`，38 支 2 点队抽 12 支）：
    // **S1 交互步带跃迁 11 队 / S2 吸收步带跃迁 0 队**；而 34/38 队在 ①→④ 之间确实有跃迁
    // （`.zc/perf/T140cWhy2.perf.ts`）⇒ 这些队的 ③ 本该存在。
    //
    // 反证（负控）：把 `preJoint` 那段候选判定删掉 ⇒ 本用例的点位断言红（退回 ①④）。
    const { catalog, config } = await setupHarness(['', '', ''], { productionBasicWeights: true })
    await catalog.loadBuildRecommendations()
    const calc = useResourceCalc()
    // 夹具 = `auto-1511-1561-1581`：实测 2 点队中「S1 交互步」跃迁最丰富的一支
    // （大招 +1 / 异常触发 +3 / 乱流 +2，伤害 +8.81M）
    const p = teamPresets.find(x => x.id === 'auto-1511-1561-1581')!
    const r = climbDifficultyLadder({ config, calc, absorbCap: DEFAULT_COMBO_ALIGN_ABSORB_RATIO }, p.team as [string, string, string], {
      capture: c => ({
        counts: captureKeyCounts(c.calc), dmgBySource: captureDmgBySource(c.calc),
        overflow: c.calc.resourceResult.value?.overflowSeconds ?? 0,
      }),
    })
    // ① 该队非轴（② 如实缺失）
    expect(r.axisPointMissing, '前提：该队非轴 ⇒ ② 缺失').toBe(true)
    expect(r.points.map(x => x.point)).not.toContain('axis')
    // ② ③ **必须存在**（交互步带跃迁）——这是本用例的核心判据
    const prog = r.points.find(x => x.point === 'progress')
    expect(prog, '② 缺失时 ③ 必须由**交互步**候选长出来（不得塌成 2 点）').toBeTruthy()
    // ③ ③ 的交互配置是 joint（它描述的就是「交互取最优」这一步）
    expect(prog!.knobs.interactions).toBe('joint')
    // ④ 点位次序合法 + ①④ 恒存在
    expect(r.points.map(x => x.point)).toEqual(['baseline', 'progress', 'max'])
    // ⑤ ③ 相对 ① 确有增益（否则它不是「重大进步」）
    expect(prog!.dmg).toBeGreaterThan(r.base)
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
