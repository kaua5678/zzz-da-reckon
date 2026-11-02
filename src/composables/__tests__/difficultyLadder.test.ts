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
import { getAgentMechanic } from '@/mechanics/registry'
import { applyTeamToStore } from '@/composables/teamCompare'
/** ⚠ 本文件顶部已 import 过 `captureDmgBySource`/`captureKeyCounts`（③ 的跃迁判据要用它） */
import {
  absorbCapOf, climbDifficultyLadder, summarizeLadder, resetDifficultyGoals, clearDifficultyLevers, scanAbsorbGrid, climbFieldsOf,
  applyRoleInteractionBaseline,
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

/**
 * 夹具队。
 *
 * ⚠ **2026-10-15（T170）换队**：原 `auto-1521-1481-1311` 在新口径下**轴要求不满足**
 * （④ 档跳过 26~27 招）⇒ 整条曲线的点全被截断 ⇒ 本文件大半判据失去夹具。
 * 2026-10-26 复核：本常量只服务「④ 吸收率 = 用户 cap」那一条用例（`absorbCap: 0.7` ⇒ 末点 absorb 0.7），
 * 实测 `auto-1051-1481-1451` 在 cap=0.7 下末点正是 0.7 ⇒ 保持不变。
 * （「四点全成立」的结构夹具另见 `STRUCTURAL_TEAM`。）
 */
const TEAM = 'auto-1051-1481-1451'
/**
 * **结构判据夹具**（T141「交互全 0」后重选，2026-10-25）：`auto-1051-1481-1451` 在新口径下
 * ①（全 0 交互）喂不饱轴 ⇒ baseline 被如实截断，只剩 axis/progress/max 三点 ⇒ 「四点全成立」的
 * 结构判据（点数/点名/首末点）失去夹具。本常量用于**只需要结构自洽**的那两条用例。
 * 实测 `auto-1531-1481-1451`：缺省 cap 与 cap=0 两个变体都是 0 截断、baseline 恒为首点。
 */
const STRUCTURAL_TEAM = 'auto-1531-1481-1451'

describe('难度曲线关键旋钮点（T140c）', () => {
  it('① 点数 ≤4 + 点名序列合法 + 每点轴必成立 + 截断如实（新口径）', async () => {
    const { catalog, config } = await setupHarness(['', '', ''], { productionBasicWeights: true })
    await catalog.loadBuildRecommendations()
    const calc = useResourceCalc()
    const ctx: LadderCtx = { config, calc }
    const p = teamPresets.find(x => x.id === STRUCTURAL_TEAM)!
    const r = climbDifficultyLadder(ctx, p.team as [string, string, string])

    /**
     * ⚠ **2026-10-15（T170）口径变更**：旧断言是「①④ **恒存在**」（卡 §4）。
     * 新口径「轴要求未满足 ⇒ 该档不出数」下 **① 与 ④ 都可能被截断**（般岳全 0 交互喂不饱轴
     * ⇒ ① 被砍；有的队连 ④ 都达不到）⇒ 「恒存在」不再成立，改为**条件断言**：
     * 「若存在则必在正确的点名位置」+「①④ 若缺失则必须出现在 `axisTruncated` 里」。
     * 负控：把 `land` 的截断门删掉 ⇒ `axisTruncated` 恒空 ⇒ 下面的「截断如实」断言红。
     */
    expect(r.points.length).toBeLessThanOrEqual(4)
    // 每一点都必须是**轴成立**的点（新口径的核心不变量）
    for (const pt of r.points) {
      expect(axisStands(pt.axis), `${pt.point} 点的轴必须成立（不成立的点不该出现在 points 里）`).toBe(true)
    }
    // ①④ 若存在，位置/取值仍受旧口径约束
    const baselinePt = r.points.find(x => x.point === 'baseline')
    if (baselinePt) {
      expect(r.points[0]!.point, '① 存在时必须恒为首点').toBe('baseline')
      expect(baselinePt.dmg).toBe(r.base)
    }
    // 点名序列合法（只允许 baseline → [axis] → [progress] → max 这个次序）
    const order = ['baseline', 'axis', 'progress', 'max']
    let cursor = -1
    for (const pt of r.points) {
      const i = order.indexOf(pt.point)
      expect(i, `点名 ${pt.point} 必须存在`).toBeGreaterThanOrEqual(0)
      expect(i, `点名次序必须单调推进（${r.points.map(x => x.point).join('→')}）`).toBeGreaterThan(cursor)
      cursor = i
    }
    // ★ 截断如实：被砍的档位必须留痕，且理由非空（用户口径「低难度不该算」≠「低难度看不见」）
    for (const t of r.axisTruncated) {
      expect(order, `截断档 ${t.point} 必须是合法点名`).toContain(t.point)
      expect(t.reason.length, '截断必须给出可读理由').toBeGreaterThan(0)
      expect(axisStands(t.axis), `被截断的档 ${t.point} 的轴必然不成立`).toBe(false)
      expect(t.dmg, '截断档保留「本来能打多少」的如实读数').toBeGreaterThan(0)
    }
    // 反空洞：本夹具（四点全成立的干净样本）必须有 baseline 与 max，且无截断
    expect(baselinePt, '夹具队 ① 应存在（它是四点全成立的样本）').toBeDefined()
    expect(r.points[r.points.length - 1]!.point, '夹具队 ④ 应存在').toBe('max')
    expect(r.axisTruncated, '夹具队四点全成立 ⇒ 不该有截断').toEqual([])

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
     *
     * ⚠ **T170 起 ① 可能被截断**（般岳全 0 交互喂不饱轴）⇒ 只有存在时才断言它。
     * 夹具队是四点全成立的样本 ⇒ 它的 ① 必然存在（上面已断言）。
     */
    expect(baselinePt!.knobs).toEqual({ interactions: 'zero', absorb: 0 })
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
    const capBase = withCapture.points.find(x => x.point === 'baseline')!
    expect(capBase.interactionsPlayed, '① 的实打交互总量必须是 0（全 0 交互）').toBe(0)
    expect(capBase.interactionsFilled, '① 的手填交互总量也必须是 0（全 0 交互）').toBe(0)
    /**
     * 反空洞（**必须换一支队**）：`TEAM = auto-1521-1481-1311` 在 ④ 上**确实不加任何交互**
     * ——实测该队全 0 交互就是最优（`zero` 120.425M，逐槽阶梯跑完仍 120.425M、
     * `interactionsPlayed = 0`，见 `.zc/perf/T141fourB.perf.ts`）。它自身不是缺陷：
     * 「交互对这支队无益」正是卡 §2.3「辅助交互是亏的」的极端形态，引擎如实表达即可。
     * ⇒ 反空洞必须换一支**阶梯真的会加交互**的队。
     *
     * ⚠ **T170 再换一次队**：原 `auto-1611-1141-1211` 在新口径下 **① 被截断**
     * （`points = [axis]`，`axisTruncated = [baseline, max]`）⇒ 取不到 `points[0]`。
     * 新夹具 `auto-1051-1481-1451` 实测四点全成立（`axisTruncated = []`）。
     * 若把反空洞钉在旧队上，它测的就不是「① = 0」而是「该队恰好四点全成立」——一条假判据。
     */
    /**
     * ⚠ 2026-10-26：原夹具 `auto-1051-1481-1451` 的 ① 已被截断（points = axis/progress/max，
     * 见上面 STRUCTURAL_TEAM 的注释）⇒ `points.find(p => p.point === 'baseline')` 为 undefined，
     * 本用例变成 TypeError 而不是判据。换 `auto-1511-1561-1411`：实测
     * `baseline:0 + max:9`、`axisTruncated = 0` ⇒ 「① 全 0 交互、④ 真的加了 9 次」两个前提都成立。
     */
    const p2 = teamPresets.find(x => x.id === 'auto-1511-1561-1411')!
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
    expect(withCapture2.points.find(x => x.point === 'baseline')!.interactionsPlayed,
      '① 的实打交互总量必须是 0（该夹具同样适用）').toBe(0)
    const lastPt = withCapture2.points[withCapture2.points.length - 1]!
    expect(lastPt.interactionsPlayed, '反空洞：④ 的实打交互总量应 > 0（逐槽阶梯加了交互）').toBeGreaterThan(0)
    /**
     * ## ★ 交互旋钮**只动弹刀/闪反**（用户裁决 2026-10-13 的「快支归零」条款已被更彻底的裁决取代）
     *
     * 2026-10-13 的口径是「快支可以归零，高难度也不需要加快支」——当时靠 `clearInteractions` 把它清零、
     * 靠「两个旋钮都不爬它」保证 ②③④ 不加回来。2026-10-26 用户裁决「手动快支全都删了，这机制过时了」
     * ⇒ `quickAssistCount` 字段**整体删除**，「快支恒 0」从**行为约束**变成**类型约束**（没有字段可写），
     * 本条于是只剩可测的那半：**两个交互旋钮必须真的动手，且只动弹刀/闪反**。
     *
     *  · `optimizeInteractionsPerSlot`（`slotLadder`）只爬 `parryCount` / `dodgeCounterCount`；
     *  · `applyInteractionKnob(ctx,'joint')` 的 `joint-levers` 三个杠杆 = 平A权重 / 弹刀 / 嘲讽取消。
     */
    const p3 = teamPresets.find(x => x.id === 'auto-1611-1141-1211')!
    clearDifficultyLevers(ctx)
    applyTeamToStore(config, p3)
    clearInteractions(ctx)
    // ② 的交互旋钮：joint-levers（多杠杆联合搜索）——只许写平A权重 / 弹刀 / 嘲讽取消
    const spyOn = () => {
      const keys = new Set<string>()
      const orig = config.setActionCount.bind(config)
      const sp = vi.spyOn(config, 'setActionCount').mockImplementation((slot, key, v) => {
        keys.add(key)
        return orig(slot, key, v)
      })
      return { keys, stop: () => sp.mockRestore() }
    }
    const j = spyOn()
    applyInteractionKnob(ctx, 'joint')
    j.stop()
    expect([...j.keys].sort(), `joint-levers 只许碰平A权重/弹刀/嘲讽取消（实测 ${JSON.stringify([...j.keys])}）`)
      .toEqual(['basicAttackTimeWeight', 'parryCount', 'tauntCancelCount'].filter(k => j.keys.has(k)).sort())
    // ④ 的交互旋钮：slotLadder（逐槽阶梯）——只许写弹刀 / 闪反
    clearInteractions(ctx)
    const sl = spyOn()
    applyInteractionKnob(ctx, 'slotLadder')
    sl.stop()
    expect([...sl.keys].filter(k => k !== 'parryCount' && k !== 'dodgeCounterCount'),
      `slotLadder 只许爬弹刀/闪反（实测 ${JSON.stringify([...sl.keys])}）`).toEqual([])
    // 反空洞：slotLadder 必须真的加了交互（否则上一条可能只是「什么都没做」）
    expect([0, 1, 2].reduce((a, s2) => a + Number(config.team[s2]?.parryCount ?? 0) + Number(config.team[s2]?.dodgeCounterCount ?? 0), 0),
      '反空洞：slotLadder 应真的加了弹刀/闪反').toBeGreaterThan(0)
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

  it('★ T182：④ ≥ ③（两条入口取高；负控 = 只从 ① 重来会低于 ③）', async () => {
    /**
     * ## 为什么加这条（T182，2026-11-02；用户实报「难度曲线不单调」）
     *
     * 用户口径逐字：「**最高难度被看的最多，他要算准确**。理论上合轴率拉满得出最多富余时间，
     * 交互较多得出更多收益，一个队伍应当这时候最强了。」
     *
     * 缺陷形态：④ 旧口径**只**从 ① 的现场重来（T141，为修「④ < ①」而立），而 `joint`/`slotLadder`
     * 都是坐标上升（**起点决定落点**）⇒ 从 ① 出发爬到的是另一个更差的局部解，把 ③ 已经爬到的
     * 更好盆地丢掉了。实测 `auto-1461-1031-1521`（页面同源口径）：③ 68.53M → ④ **66.39M**
     * （x 却 +17.3 点），掉的全是希希芙的毒素链（蛇影 22→17 ⇒ 蚀骨 −6.45M、蛇吻 −1.67M）。
     *
     * 现口径 = 两条入口各爬一次、取伤害高者（臂 A ① / 臂 B ③，见 `climbDifficultyLadder` 的 T182 段）。
     *
     * ## 负控（改回单臂 ⇒ 本测试红）
     *
     * 下面第二段**手工摆回「只从 ① 重来」的单臂现场**（= T141 口径）并断言它**低于 ③** ——
     * 这条锁的是缺陷机制本身：任何人把 ④ 改回单臂，第一段「④ ≥ ③」立刻红。
     */
    const { catalog, config } = await setupHarness(['', '', ''], { productionBasicWeights: true })
    await catalog.loadBuildRecommendations()
    const calc = useResourceCalc()
    const ctx: LadderCtx = { config, calc }
    const p = teamPresets.find(x => x.id === 'auto-1461-1031-1521')!
    const r = climbDifficultyLadder(ctx, p.team as [string, string, string], {
      // 基线与页面同口径（`difficultyCurve` 的 `opts.base`）
      base: c => {
        clearDifficultyLevers(c)
        applyTeamToStore(c.config, p)
        return c.calc.teamTotalDamage.value
      },
      // ③ 的「离散动作增量」判据需要 counts（页面口径同此）
      capture: c => ({ counts: captureKeyCounts(c.calc), dmgBySource: captureDmgBySource(c.calc) }),
    })
    const prog = r.points.find(x => x.point === 'progress')
    const maxPt = r.points.find(x => x.point === 'max')
    expect(prog, '夹具队必须有 ③（否则本判据没有分母）').toBeDefined()
    expect(maxPt, '④ 恒存在').toBeDefined()
    expect(maxPt!.dmg, '④ 必须 ≥ ③（「难度上升 ⇒ 总伤上升」）').toBeGreaterThanOrEqual(prog!.dmg - 1e-6)
    expect(r.final, 'T141 的 ④ ≥ ① 结构性保证不得被本修法破坏').toBeGreaterThanOrEqual(r.base - 1e-6)
    expect(r.maxEntry, '本队实测由 ③ 入口臂胜出（旧单臂口径在这一步更低）').toBe('progress')
    /**
     * ★ **负控**：两条入口臂的实测伤害必须**真的不同**（臂 B 更高），且 ④ = 取高者。
     * 谁把 ④ 改回单臂（臂 B 不存在）⇒ `maxArms` 里没有 `progress` 项 + 上面的 `maxEntry` 断言
     * + 本段的「取高者」断言三处同时红。
     */
    const arms = r.maxArms ?? []
    const armBase = arms.find(a => a.entry === 'baseline')
    const armProg = arms.find(a => a.entry === 'progress')
    expect(armBase, '臂 A（① 入口）必须在').toBeDefined()
    expect(armProg, '臂 B（③ 入口）必须在（③ 存在时恒有）').toBeDefined()
    expect(armProg!.dmg, '负控：臂 B 必须真的优于臂 A（否则本修法无话可说）').toBeGreaterThan(armBase!.dmg)
    expect(maxPt!.dmg, '④ = 各臂取高者').toBeCloseTo(Math.max(armBase!.dmg, armProg!.dmg), 6)
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
      guarantee: ['guarantee.stun', 'guarantee.fury'].map(k => config.getMechanicSetting(k, -1)),
      weights: [0, 1, 2].map(s => config.team[s]!.basicAttackTimeWeight),
      parry: [0, 1, 2].map(s => config.team[s]!.parryCount),
      align: JSON.stringify(config.comboAlignOverrides ?? {}),
    }
    climbDifficultyLadder(ctx, p.team as [string, string, string], { base: c => c.calc.teamTotalDamage.value })
    expect(config.getMechanicSetting(COMBO_ALIGN_ABSORB_RATIO_SETTING, -1)).toBe(before.absorb)
    expect(config.getMechanicSetting('time.stunPlanProjection', -1)).toBe(before.projection)
    expect(['guarantee.stun', 'guarantee.fury'].map(k => config.getMechanicSetting(k, -1)))
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
    for (const k of ['guarantee.stun', 'guarantee.fury']) {
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
    const p = teamPresets.find(x => x.id === STRUCTURAL_TEAM)!
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

  it('★ 爬升面 = 基础两字段 + 各槽角色声明的特色字段（T171 声明式，新角色零额外声明）', async () => {
    /**
     * ## 锁什么（用户口径 2026-10-15）
     *
     * > 「**每个角色都有自己特色的交互**，比如**仪玄的后台墨痕化形可以在后台造成攻击**。」
     * > 「你这种改动可以复用吧？比如**新角色有什么交互要求最好能简单设置下就能用上**。」
     *
     * 修前 `optimizeInteractionsPerSlot` **写死 `['parryCount','dodgeCounterCount']`**，
     * 而 ① 清空 14 个字段 ⇒ 般岳的金身/双反永远加不回来（T170 用「起点 = interactionDefaults」
     * 缓解，但只能回到声明值、不能再往上爬）。
     *
     * 现口径 = 基础两字段恒在 + 该槽角色 `interactionDefaults` 里非零的 block/dual 自动追加
     * ⇒ **新角色接入零额外声明**（它已经声明了自己会打什么）。
     *
     * ## 负控（删掉被锁行为后本测试确实变红）
     *
     * 把 `climbFieldsOf` 改回 `['parryCount','dodgeCounterCount']` 常量 ⇒ 般岳那条断言红。
     */
    const { catalog, config } = await setupHarness(['', '', ''], { productionBasicWeights: true })
    await catalog.loadBuildRecommendations()
    const calc = useResourceCalc()
    const ctx: LadderCtx = { config, calc }
    // 般岳（声明 block:12 / dual:3）⇒ 四个字段全爬
    const banyue = teamPresets.find(x => x.id === 'banyue-trigger-lucia')!
    applyTeamToStore(config, banyue)
    expect(climbFieldsOf(ctx), '★ 般岳的特色交互（金身/双反）必须自动进爬升面')
      .toEqual(['parryCount', 'dodgeCounterCount', 'blockCount', 'dualCounterCount'])
    // 无特色声明的队 ⇒ 只剩基础两字段（纯追加语义，不改既有读数）
    const plain = teamPresets.find(x => x.id === 'auto-1051-1481-1451')!
    applyTeamToStore(config, plain)
    expect(climbFieldsOf(ctx), '无特色声明的角色不得凭空多出字段').toEqual(['parryCount', 'dodgeCounterCount'])
    /**
     * ⚠ **哨兵语义字段必须不在爬升面里**：`yixuanInk3Count` 的 `0` = 自动（消耗全部闪能），
     * 爬它会把「自动吃满」变成「一次都不打」。它不在 `interactionDefaults` 的四个键里 ⇒ 天然排除。
     */
    const yixuan = teamPresets.find(x => x.id === 'yixuan-trigger-lucia')!
    applyTeamToStore(config, yixuan)
    const yxFields = climbFieldsOf(ctx)
    expect(yxFields, '哨兵字段（≤0=自动）绝不能被自动爬升').not.toContain('yixuanInk3Count')
    expect(yxFields, '哨兵字段（≤0=自动）绝不能被自动爬升').not.toContain('yixuanPerfectBlockCount')
  })

  it('★ ②③④ 从「角色声明的交互基准」出发（般岳金身/双反必须能回来）', async () => {
    /**
     * ## 为什么单列这条（2026-10-15 实测修的缺陷）
     *
     * ① 把 **14 个交互字段全清零**，而 `optimizeInteractionsPerSlot` 只爬
     * **`parryCount` / `dodgeCounterCount`** ⇒ 其余 12 个字段从 0 出发、**永远不会被加回来**。
     * 般岳的轴靠**金身格挡（`blockCount`）+ 双反（`dualCounterCount`）**产嗔火
     * （模块声明 `interactionDefaults: { parry:6, dodge:10, block:12, dual:3 }`）
     * ⇒ 修前轴恒喂不饱，② 缺失、整条曲线被截断。
     *
     * 实测（`.zc/perf/T170climb.perf.ts`）：`banyue-trigger-lucia` 修前 `partial(4)` 49.91M、
     * 恢复基准后 `complete` 54.26M（**轴成立且伤害更高**）。
     *
     * ## 负控（删掉被锁行为后本测试确实变红）
     *
     * 把 `climbDifficultyLadder` 里的 `applyRoleInteractionBaseline(ctx)` 两处调用删掉
     * ⇒ 般岳的 `blockCount` 恒为 0 ⇒ 「② 存在且金身 > 0」两条断言红。
     */
    const { catalog, config } = await setupHarness(['', '', ''], { productionBasicWeights: true })
    await catalog.loadBuildRecommendations()
    const calc = useResourceCalc()
    const p = teamPresets.find(x => x.id === 'banyue-trigger-lucia')!
    /** 在 ② 那一刻抓交互快照（函数结束会还原现场 ⇒ 事后读 store 恒为 0，这是 T141 的整表还原契约） */
    const snap = (c: LadderCtx) => ({
      counts: Object.fromEntries([0, 1, 2].flatMap(s => [
        [`block${s}`, Number(c.config.team[s]?.blockCount ?? 0)],
        [`dual${s}`, Number(c.config.team[s]?.dualCounterCount ?? 0)],
      ])),
      dmgBySource: {}, overflow: 0, interactionsFilled: 0, interactionsPlayed: 0,
    })
    const r = climbDifficultyLadder({ config, calc }, p.team as [string, string, string], {
      base: c => { applyTeamToStore(c.config, p); return c.calc.teamTotalDamage.value },
      capture: snap,
    })
    /**
     * ① 的判据不变（T141：全 0 交互是难度原点）——本函数**不得**把基准写进 ①。
     * 般岳的 ① 在新口径下**如实被截断**（全 0 交互喂不饱轴），故这里断言的是
     * 「① 若存在则交互为 0」，而不是「① 必须存在」。
     */
    const baseline = r.points.find(x => x.point === 'baseline')
    if (baseline) expect(baseline.knobs.interactions, '① 恒为全 0 交互').toBe('zero')
    // ★ 核心：轴靠角色声明的金身/双反立起来（不是靠弹刀/闪反硬凑）
    const axisPt = r.points.find(x => x.point === 'axis')
    expect(axisPt, '② 必须存在（修前般岳因金身/双反回不来而缺失）').toBeDefined()
    expect(axisPt!.axis.kind, '② 的轴必须真的成立').toBe('complete')
    /**
     * ★ 金身/双反必须在 ② 那一刻**真的被写进现场**。
     * ⚠ 2026-10-25：判据从「跑完读 store」改成「读 ② 的 counts 快照」——`climbDifficultyLadder`
     * 有整表还原契约（T141：只探测不改现场），函数返回后交互字段必然回到调用前（全 0）。
     * 13b9f584 之后起点也是全 0，故旧写法在任何实现下都恒假（测试自证失败）。
     */
    const axisCounts = axisPt!.counts ?? {}
    expect(Object.entries(axisCounts).some(([k, v]) => k.startsWith('block') && v > 0),
      '★ 般岳的金身格挡必须被恢复（修前恒为 0）').toBe(true)
    /**
     * ⚠ 2026-10-25：不再强制「双反也必须 > 0」。修扫（② 的有界枚举）取**最小可行值**——
     * 实测仅金身 block=20 即可补满轴（跳 4→0），双反保持 0 是正确的更优解（交互更少、伤害更高）。
     * 保留的判据 = 「② 确实靠模块声明的特色交互立起来」（block 或 dual 至少一个被写）。
     */
    expect(Object.entries(axisCounts).some(([k, v]) => (k.startsWith('block') || k.startsWith('dual')) && v > 0),
      '★ ② 必须靠模块声明的特色交互（金身/双反）立起来').toBe(true)
  })

  /**
   * ## ★ 「② 的落点 = 最小吸收率」的全库判据已**迁出本文件**（T182，2026-10-18）
   *
   * 判据内容（`r > 0 ⇒ absorbCap=0 时 ② 必须缺失`，即「吸收确实必需」）**一字未改**，
   * 只是拆成 4 个文件并行跑 —— 它单条实测 **592s**，是整套 `npm run verify` 的唯一长尾
   * （全量 691s 里占 86%），而 vitest 只做**文件级**并行。
   *
   * | 文件 | 承担 |
   * |---|---|
   * | `difficultyLadderBurnShard{0..3}.test.ts` | 全库 3 槽预设按排序后下标 `% 4` 分片（24/23/23/23 队，实测 101/146/122/146s） |
   * | `difficultyLadderBurnCoverage.test.ts` | 分片并集 == 全库、两两互斥、无空片（纯静态，~0s） |
   * | `difficultyLadderBurnWitness.test.ts` | 原用例末尾 `burning > 0` 的**非平凡性闸门**（见证队跨 r=0.4/0.55/0.85 三档） |
   *
   * 共用实现 = `src/test/ladderBurnShard.ts`（其文件头记了分片理由、实测成本表与「判据一字未改」的承诺）。
   * ⚠ 原用例的两条**判据换代历史**仍有效，改这条判据前必读：
   *
   * - **2026-10-15（T170）从「r ≡ 0」改为「r 最小」**：旧 `axisStands` 把 `partial` 也算成立 ⇒ ② 早落 r=0；
   *   新口径要求 `complete` ⇒ 有队必须烧吸收才立得起来。继续断言「r ≡ 0」会**逼引擎回到旧口径**
   *   （拿判据锁死错误行为，规则 10 禁止）。
   * - ⚠ **不要用「r 减一格再跑一遍」验最小性**：`scanAbsorbGrid` 的网格是 `0..cap` 均分 `steps` 份 ⇒
   *   改 `cap` 会**整体重排网格点**（cap=1 时格点 0.90，cap=0.95 时格点是 0.9025）⇒ 「r−0.05」根本
   *   不是同一套网格上的前一格，那样验出来的是自己的算术错误，不是引擎行为（判据第一版踩过）。
   */

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
        c.parryCount = 0; c.dodgeCounterCount = 0
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
    /**
     * ⚠ 2026-10-25（规则 10，实测重取）：**n=1 例外**。T141「交互全 0」后基线变了——
     * 实测主C 弹刀 1 次 = **−0.408M**、2 次起 +2.881M（离散阈值：1 次的时间成本还没跨过任何
     * 整数门槛，喧响/失衡次数都不变；老基线里别的交互已把那道门槛顶过去了，所以旧读数 +0.07M）。
     * 用户原话是「主c交互**大多**是不亏的」⇒ 判据保留「2 次起全程 ≥ 0」，n=1 只钉「不塌」（> −1M）。
     */
    /**
     * ## ⚠ 2026-10-28 重取（规则 10 四步）——**辅助弹刀不再结构性为负**
     *
     * ① 量 delta（本夹具实测，百万单位）：
     * | 槽 | 定位 | 弹刀 1 / 2 / 4 / 8 |
     * |---|---|---|
     * | 0 | 克拉蕾（主C） | +2.859 / +2.722 / +2.262 / +1.340 |
     * | 1 | 莱卡恩（击破） | +2.540 / +2.202 / +0.682 / **−1.768** |
     * | 2 | 丽娜（支援） | **+2.612 / +2.227 / +2.880** / −2.356 |
     * | 2 | 丽娜（闪反） | −0.047 / −0.117 / −0.821 / −0.888 |
     *
     * ② 根因：**轴模式失衡作废改「逐招实测」（用户 2026-10-28 裁决，见 §4 坑19 否决记录）**——
     *    残差分摊通道删除 ⇒ 没排进失衡窗的招式（含辅助的弹刀）失衡值不再按窗占比被扣，
     *    于是辅助弹刀产出的失衡**真实计入**、能跨过开窗门槛 ⇒ 低档转正。
     *    旧读数「辅助弹刀全负 −0.19→−1.75M」是那条残差通道造出来的。
     *
     * ③ 确认有意：用户 2026-10-28 逐字「轴模式下没有排进失衡内的招式都在非失衡」——
     *    辅助在窗外打的弹刀本来就该全额产条。**辅助交互的时间成本仍在**（高档 8 次转负 −2.356M），
     *    那才是「辅助交互才是亏的」的真实落点：**过量**才亏，不是一律亏。
     *
     * ④ 处置：主C 判据保持「全程 Δ ≥ 0」（新物理下 n=1 也为正，旧的 −0.408M 例外不再触发）；
     *    辅助改为「低档不得**结构性**为负 + 高档必须回落为负」（判据主体 = 过量交互是亏的）；
     *    击破保持「允许为正」。
     */
    for (const key of ['dodgeCounterCount', 'parryCount'] as const) {
      for (const { n, d } of sweep(0, key, STEPS)) {
        expect(d, `主C ${key}=${n} 必须 Δ ≥ 0（2026-10-28 逐招口径下全程为正）`).toBeGreaterThanOrEqual(-1e-6)
      }
    }
    // 辅助（槽2 丽娜，支援）：低档为正（逐招口径的真实失衡），但**过量必转负**——那才是用户
    // 「辅助交互才是亏的」的可判别落点；只钉 ≤0 会把旧残差通道的假象固化下来。
    const supportParry = sweep(2, 'parryCount', [1, 2, 4, 8])
    for (const { n, d } of supportParry.filter(x => x.n <= 4)) {
      expect(d, `辅助弹刀=${n} 允许为正（实测 +2.2~+2.9M，逐招口径的真实失衡）`).toBeGreaterThan(-1_000_000)
    }
    const supportOver = supportParry.find(x => x.n === 8)!
    expect(supportOver.d, '辅助弹刀=8 必须回落为负（过量交互才是亏的，实测 −2.356M）').toBeLessThan(0)
    // 辅助闪反在整个扫描域内仍为负（时间成本主导，实测 −0.047 → −0.888M）
    for (const { n, d } of sweep(2, 'dodgeCounterCount', [1, 2, 4, 8])) {
      expect(d, `辅助闪反=${n} 不得为正（实测全负）`).toBeLessThanOrEqual(1e-6)
    }
    // 击破（槽1 莱卡恩）：**允许为正**（靠失衡加速）——判据只要求「不是被结构性排除」
    const breakthrough = sweep(1, 'parryCount', [2, 4])
    expect(Math.max(...breakthrough.map(x => x.d)), '击破弹刀允许为正（实测 +2.2M）').toBeGreaterThan(0)
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
        c.parryCount = 0; c.dodgeCounterCount = 0
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
    /**
     * ⚠ **T183（2026-11-02）更换夹具与判据**：③ 的台阶判据从「`counts` 任一项 Δ≥1」收紧为
     * **完整失衡窗口数 +1**（用户口径「第三个重大进步太模糊了…比如完整 3 失衡到完整 4 失衡」）。
     * 旧夹具 `auto-1511-1561-1581` 的交互步跃迁是大招/异常触发/乱流（**失衡不动**）⇒
     * 按新口径它**不该有 ③**（实测已塌成 `baseline→max`，符合预期）。
     * 现夹具 = `auto-1431-1481-1031`（非轴 + 交互步 完整失衡 2→3，实测 ③ 83.33M > ① 80.74M）。
     * 本用例护的**缺陷本身没变**：② 缺失时若不让「交互步」当候选，非轴队就塌成 ①④ 两点。
     */
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
    // 夹具 = `auto-1431-1481-1031`：非轴队，且「交互步（joint@吸收0）」带**完整失衡 2→3** 的台阶
    const p = teamPresets.find(x => x.id === 'auto-1431-1481-1031')!
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
    // ⑥ ★ T183：台阶**必须是完整失衡 +1**（不是「随便哪个次数动了」）
    const base = r.points[0]!
    expect(prog!.counts!['失衡'] - base.counts!['失衡'], '③ 的台阶 = 完整失衡 +1').toBeGreaterThanOrEqual(1 - 1e-6)
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

describe('T173 后台墨痕化形可爬升（上限 = 已有后台 × 1.5，比例可调）', () => {
  /**
   * 用户逐字（2026-10-15）：
   * > 「**仪玄后台墨痕化形可以爬升，相当于白给的招式**，但注意**自动爬升上限是他已有后台的 50%**，
   * >   不能说他后台全都在合轴。**这个值也可以调整**。」
   *
   * ## 锁什么
   *
   * ① **进爬升面**：`climbFieldsOf` 含 `yixuanBackstageComboCount`（声明式 `interactionClimb`）；
   * ② **上限 = anchor + floor(anchor × 比例)**，且 `anchorOf` 读的是**本轮结果行**（不是 cfg 输入）；
   * ③ **改比例参数 ⇒ 上限跟着变**（用户口径「这个值也可以调整」）；
   * ④ **爬升结果 ≤ 上限**（真管线端到端，不是只在纯函数上算）。
   *
   * ## 负控（必做）
   *
   * 把上限去掉（`optimizeInteractionsPerSlot` 里不判 cap）⇒ ④ 红（见收尾报告实测输出）。
   */
  const YX_CLIMB_PRESET = 'yixuan-trigger-lucia'

  /** 跑「④ 的现场」：全关基线 → 全 0 交互 → 角色基准 → joint（= ladder ②③④ 的搜索起点） */
  async function setupLadderPath() {
    const { catalog, config } = await setupHarness(['', '', ''], { productionBasicWeights: true })
    await catalog.loadBuildRecommendations()
    const calc = useResourceCalc()
    const ctx: LadderCtx = { config, calc }
    const preset = teamPresets.find(x => x.id === YX_CLIMB_PRESET)!
    resetDifficultyGoals(ctx, preset.team as [string, string, string])
    applyInteractionKnob(ctx, 'zero')
    applyRoleInteractionBaseline(ctx)
    applyInteractionKnob(ctx, 'joint')
    return { ctx, config, calc }
  }

  it('★ 哨兵字段（≤0=自动）不进爬升面（T171 声明式契约）', async () => {
    const { ctx } = await setupLadderPath()
    const fields = climbFieldsOf(ctx)
    /**
     * ⚠ **哨兵语义字段不得进爬升面**：`yixuanInk2Count` / `yixuanInk3Count` / `yixuanPerfectBlockCount`
     * 的 `≤0` = **自动** ⇒ 爬它会把「自动吃满」变成「一次都不打」。
     * 它们换的是**比例滑块**（`yixuanInk3Ratio`，是 MechanicSetting 不是 ActionCountField）。
     * （T197 起仪玄不再有 `interactionClimb` 声明，本用例只剩哨兵这一半。）
     */
    for (const f of ['yixuanInk2Count', 'yixuanInk3Count', 'yixuanPerfectBlockCount', 'yixuanExtremeAssistCount']) {
      expect(fields, `哨兵字段 ${f} 绝不能被自动爬升`).not.toContain(f)
    }
  }, 300_000)
  /**
   * **T197（用户裁决 2026-10-22）**：仪玄「后台墨影凝云 + 霄云劲#5」整套删除——
   * 「交互里面的后台墨影凝云 + 霄云劲#5也删除，因为他们本质是合轴率系统出来之前的代替产物，
   * 现在该直接用合轴率代表一切」。
   *
   * ⇒ `interactionClimb` / `backstageAutoFill` / `yixuan.backstageClimbRatio` 随模块声明一起删除；
   * 原先锁它们的 3 个用例（上限公式 / 端到端爬升 / 自指陷阱）一并移除。**通道本身保留**
   * （通用能力，上半部分的声明契约用例仍守着它，未来别的角色要用仍成立）。
   */
  it('★ 仪玄不再声明 interactionClimb（后台墨影凝云已按用户裁决删除）', async () => {
    const m = getAgentMechanic('1371')!
    expect(m.interactionClimb, 'interactionClimb 通道已删除').toBeUndefined()
  }, 60_000)
})
