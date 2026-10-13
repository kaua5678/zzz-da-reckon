/**
 * 债 2 / A 项「**截断不回灌资源循环**」生效测试（2026-10-14 T151）。
 *
 * 用户裁决（2026-10-13，本卡口径来源）：
 * 「**超时砍掉任何招式都该让其计数和各项数据扣除，因为你根本就打不出这招**。
 *   由于计算顺序有问题，所以你搞出回复次数了又截断次数的矛盾行为，**一开始就不该回复啊**。」
 *
 * 病灶（根因，勿再重新调查）：`iterate` 的团队封顶第③层
 * （`cappedNecessary[i] = absorbedNetNecessary[i] × feasibleScale + credit[i]`，`helpers.ts#iterate`）
 * 只缩**账本**，而 `state.exSpecialCount / ultimateCount / chainCountTotal` 仍是未缩的值 ⇒
 * `buildExecutions` 按未缩次数产出物化行 ⇒ 行 ≫ 账本 ⇒ S4 装配截断砍招式，
 * 而**展示的次数**仍按未缩的资源允许值算 = 「回复了又截断」的矛盾。
 * 实测 `auto-1431-1341-1491` 弹刀 60：账本 79.30s vs 行想打 294.52s、报告强特 5 而物化 1。
 *
 * 修法（**只在装配出口夹展示，不碰收敛**，`assembleSlot.ts`）：新增 `executedExSpecialCount /
 * executedUltimateCount / executedChainCountTotal` = `min(资源允许值, Σ物化行)`。
 *
 * ⚠ 三条**已实测否决**的作用面（数字见 `.zc/reports/T151-DESIGN.md` §9/§10，勿再试）：
 *  ① 覆盖 `state.*` 让模块看到实打值 ⇒ 那三个字段同时是**外层失衡不动点的反馈量**
 *     （`outerCycle.ts#outerFeedbackSignature` 读 `ultimateCount`、`convergence.ts:1122-1132`
 *     读 ex/ult 算下一轮 `teamVeilCountTotal` / `postRoundInput`）⇒ 实测 `outerCycleColdStart`
 *     由 `stable` 退化成 `cycle`、`aire` 滑块差分 / `adjustableEffect` 链式线性共 6~14 条结构性断言红；
 *  ② 在 `buildExecutions` 出口夹行 ⇒ 那是**收入侧**物化入口（`feasibleRows` → `materializeRows`）
 *     ⇒ 行收入同步下降 ⇒「计划削→收入削→次数削」下沉螺旋（`banyue-roxy-lucia` 32.01M→28.52M）；
 *  ③ 夹账本 `necessary`（`capRowSeconds`）⇒ 改 `feasibleScale` 的输入 ⇒ 同上破坏旋钮语义。
 *
 * ⚠ **判据①的原版探针（`.zc/perf/T150impact.perf.ts`）有三处测量缺陷，报「47 分裂槽」是虚高**
 * （2026-10-14 四臂归因实测 **47 → 39 → 27 → 0**；探针已就地修正并加对照臂）：
 *  A. `ultRow` 原用 `category === 'ultimate'` 数终结技行 —— **该值全仓零生产者**
 *     （终结技行是 `category: 'chain'`；合法值见 `src/types/resource/execution.ts:25` 注释
 *     basic/special/dodge/chain/assist）⇒ `ultRow ≡ 0` ⇒ 判据退化成「凡有终结技即分裂」。
 *     单独修此项 47 → 39（−8 全是假阳性）。
 *  B. `exRow` 原用 `energyConsume > 0` 过滤 —— 漏掉免费强特行（如 `soldier11.ts:236` /
 *     `roxy.ts:350` 的 `energyConsume: 0`）⇒ 分母偏小。单独修此项 39 → 27（−12 全是假阳性）。
 *  C. 原探针读 `exSpecialCount / ultimateCount / chainCountTotal`（**资源允许值**），
 *     而用户可见的展示值自 T151 起是 `executed*` ⇒ 量错了对象。修完 27 → **0**（真缺陷被修掉）。
 *  ⇒ **27 才是本债的真实基线**；「47」里 20 个是尺子的错，不是被测对象的性质。
 *
 * 判据：
 *  ① **不超报**（本债的正面判据）：全库预设 × 4 档弹刀，凡有截断的槽，
 *     `executed*` 一律 ≤ 对应物化行 Σ —— 即「展示的次数都是真打得出来的」；
 *  ② **反空洞**：同一批槽若仍展示**旧的**资源允许值则确实会超报 ⇒ 证明本修法不是恒等式；
 *  ③ **收敛零扰动**：`executed*` 之外，无截断队的 `exSpecialCount` / `ultimateCount` /
 *     `chainCountTotal` 与 `executed*` 逐位相等（`state` 未被本修法改动）；
 *  ④ 默认路径零分支由 `timeGolden` / `timeFillRatchet` 逐位钉（本修法不动收敛轨迹 ⇒ 两者零 delta）。
 */
import { describe, it, expect } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { teamPresets } from '@/data/teamPresets'

const fin = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
/** 判据容差：次数是整数装包后的量，浮点尾数不算超报。 */
const COUNT_TOLERANCE = 1e-6

type CharResult = {
  slot: number
  agentId: string
  exSpecialCount: number
  ultimateCount: number
  chainCountTotal: number
  executedExSpecialCount: number
  executedUltimateCount: number
  executedChainCountTotal: number
  executions: { moveId: string; category: string; count: number }[]
}

/**
 * 全库预设（三人队）× 4 档弹刀，收集所有**有截断**的槽。
 * ⚠ 实测一次 ~70s ⇒ 用惰性缓存让 ①/② 共用同一份（同一进程内只跑一遍；vitest 单文件内顺序执行）。
 */
let sweepCache: ReturnType<typeof runSweep> | undefined
function collectTruncatedSlots() {
  sweepCache ??= runSweep()
  return sweepCache
}
async function runSweep() {
  const presets = teamPresets.filter(p => Array.isArray(p.team) && p.team.length === 3)
  const rows: {
    id: string; parry: number; slot: number; agentId: string; cut: number
    allowedEx: number; execEx: number; rowSpecial: number
    allowedCh: number; execCh: number; rowChain: number
    allowedUlt: number; execUlt: number; rowUlt: number
  }[] = []
  for (const preset of presets) {
    const { catalog, config } = await setupHarness(['', '', ''])
    await catalog.loadBuildRecommendations()
    const calc = useResourceCalc()
    for (let i = 0; i < 3; i++) config.setAgent(i, preset.team[i])
    config.applyTeamPreset(preset.team as [string, string, string])
    const cfgs = (calc.resourceConfig.value?.characters ?? []) as unknown as Record<string, unknown>[]
    for (const parry of [0, 20, 40, 60]) {
      for (let sl = 0; sl < 3; sl++) {
        config.setActionCount(sl, 'parryCount', parry)
        config.setActionCount(sl, 'dodgeCounterCount', 0)
      }
      const rr = calc.resourceResult.value!
      for (const c of rr.characters as unknown as CharResult[]) {
        const tb = (rr.convergence?.truncationBySlot ?? []).find(t => t.slot === c.slot)
        const cut = tb?.cutSeconds ?? 0
        if (cut <= 0.05) continue
        const cfg = cfgs.find(x => Number(x.slot) === c.slot) ?? {}
        const rowsOf = (mid: unknown) => c.executions
          .filter(e => String(e.moveId) === String(mid))
          .reduce((a, e) => a + fin(e.count), 0)
        rows.push({
          id: preset.id, parry, slot: c.slot, agentId: c.agentId, cut,
          allowedEx: c.exSpecialCount, execEx: c.executedExSpecialCount,
          // 强特是跨多行总量（模块接管时 `cfg.exSpecialMoveId` 只是其中一行，如琉音四行 / 般岳两行）
          rowSpecial: c.executions.filter(e => e.category === 'special').reduce((a, e) => a + fin(e.count), 0),
          allowedCh: c.chainCountTotal, execCh: c.executedChainCountTotal, rowChain: rowsOf(cfg.chainMoveId),
          allowedUlt: c.ultimateCount, execUlt: c.executedUltimateCount, rowUlt: rowsOf(cfg.ultimateMoveId),
        })
      }
    }
  }
  return rows
}

describe('债 2 / A 项 · 截断不回灌资源循环（executed* 展示口径）', () => {
  it('① 不超报：凡有截断的槽，展示的实打次数一律 ≤ 物化行 Σ（全库预设 × 4 档弹刀）', async () => {
    const rows = await collectTruncatedSlots()
    // 反空洞：判据必须在**真有截断**的样本上成立（全库预设口径下有 47 个截断槽）
    expect(rows.length, '全库无截断槽 ⇒ 判据无样本（机制或口径已变，须重新勘察）').toBeGreaterThan(0)
    const violations = rows.filter(r =>
      r.execEx - r.rowSpecial > COUNT_TOLERANCE
      || r.execCh - r.rowChain > COUNT_TOLERANCE
      || r.execUlt - r.rowUlt > COUNT_TOLERANCE)
    expect(
      violations.map(v => `${v.id}@弹刀${v.parry} 槽${v.slot}(${v.agentId}) 截${v.cut.toFixed(2)}s `
        + `强特 实打${v.execEx}vs行${v.rowSpecial} 连携 ${v.execCh}vs${v.rowChain} 终结 ${v.execUlt}vs${v.rowUlt}`),
      '展示次数超过物化行 = 报了打不出来的招式（本债病灶复发）').toEqual([])
  }, 1_800_000)

  it('② 反空洞：同一批槽若仍展示**资源允许值**则确实超报 ⇒ 证明 ① 不是恒等式', async () => {
    const rows = await collectTruncatedSlots()
    // 对照臂：把展示值换回旧的 `exSpecialCount / chainCountTotal / ultimateCount`
    const overReported = rows.filter(r =>
      r.allowedEx - r.rowSpecial > COUNT_TOLERANCE
      || r.allowedCh - r.rowChain > COUNT_TOLERANCE
      || r.allowedUlt - r.rowUlt > COUNT_TOLERANCE)
    expect(overReported.length, '旧口径一个都不超报 ⇒ ① 恒真、修法无效（判据失去鉴别力）').toBeGreaterThan(0)
    // 且对照臂确实被本修法覆盖：同一批槽里至少有一条 exec < allowed（真扣掉了次数）
    const actuallyDeducted = rows.filter(r =>
      r.allowedEx - r.execEx > COUNT_TOLERANCE
      || r.allowedCh - r.execCh > COUNT_TOLERANCE
      || r.allowedUlt - r.execUlt > COUNT_TOLERANCE)
    expect(actuallyDeducted.length, '没有任何槽被扣次数 ⇒ 本修法未生效').toBeGreaterThan(0)
  }, 1_800_000)

  it('③ 收敛零扰动：无截断的槽上 executed* 与资源允许值逐位相等（state 未被本修法改动）', async () => {
    // 取一支无截断队：三槽都不该有任何扣减 —— 证明本修法只在「真被砍了」时才动手。
    const preset = teamPresets.find(p => p.id === 'auto-1501-1561-1411')
      ?? teamPresets.find(p => Array.isArray(p.team) && p.team.length === 3)!
    const { catalog, config } = await setupHarness(['', '', ''])
    await catalog.loadBuildRecommendations()
    const calc = useResourceCalc()
    for (let i = 0; i < 3; i++) config.setAgent(i, preset.team[i])
    config.applyTeamPreset(preset.team as [string, string, string])
    const rr = calc.resourceResult.value!
    expect(rr.convergence?.timeTruncatedSeconds ?? 0, `${preset.id} 应为无截断队（本判据的对照面）`).toBeLessThanOrEqual(1)
    for (const c of rr.characters as unknown as CharResult[]) {
      expect(c.executedExSpecialCount, `${preset.id} 槽${c.slot} 无截断队强特不该被扣`).toBeCloseTo(c.exSpecialCount, 9)
      expect(c.executedUltimateCount, `${preset.id} 槽${c.slot} 无截断队终结不该被扣`).toBeCloseTo(c.ultimateCount, 9)
      expect(c.executedChainCountTotal, `${preset.id} 槽${c.slot} 无截断队连携不该被扣`).toBeCloseTo(c.chainCountTotal, 9)
    }
  }, 120_000)
})
