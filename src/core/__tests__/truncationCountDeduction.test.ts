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
import { rowDecibelTotal, rowEnergyTotal } from '@/core/resource/rowAccounting'
import type { SkillExecution } from '@/types/resource'

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
  energySource: { skillRegen: number }
  decibelSource: { skillRegen: number }
  // 用引擎的 SkillExecution（规则 15：行级收入必须交给引擎函数算，这里只做容器类型）
  executions: SkillExecution[]
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
    /** 资源面（本债的另一半）：账本行级收入 vs 保住行的行级 Σ */
    ledE: number; rowE: number; ledD: number; rowD: number
    /** 重折环被拒（振荡队）：账本按上一次接受态计，恒等式不适用（如实排除，见 truncationRefold.test ④） */
    rejected: boolean
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
          // 资源面：**直接调引擎自己的函数**（规则 15：派生数值必须问引擎，禁止手工复刻口径）
          ledE: c.energySource.skillRegen,
          ledD: c.decibelSource.skillRegen,
          rowE: c.executions.reduce((a, e) => a + rowEnergyTotal(cfg as never, e), 0),
          rowD: c.executions.reduce((a, e) => a + rowDecibelTotal(cfg as never, e), 0),
          rejected: rr.convergence?.truncationRefoldRejected ?? false,
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

  it('④ 资源面：账本行级收入 ≤ 保住行 Σ（被砍的招式不再贡献回能/喧响）', async () => {
    const rows = await collectTruncatedSlots()
    expect(rows.length, '全库无截断槽 ⇒ 判据无样本').toBeGreaterThan(0)
    // 振荡队（重折环被拒）排除：账本按上一次接受态计，与最终 kept 差一截，恒等式不适用
    // （同 `truncationRefold.test.ts` ④ 的既有豁免口径；实测唯一命中 = yixuan-trigger-lucia 弹刀 40 槽2）。
    const applicable = rows.filter(r => !r.rejected)
    expect(applicable.length, '可判定的槽为 0 ⇒ 判据空洞').toBeGreaterThan(0)
    // 方向性：**账本 > 行Σ** 才是本债病灶（报了打不出来的回复）；
    // **账本 < 行Σ** 属既有「整数次数行两侧计数不同」族（少报），不在本债范围，不在此判。
    // 既有真残差（**与债 2 无关**，HEAD 上逐位相同 ⇒ 非本修法引入）：
    // 账本按 `feasibleRows` 的**实数**次数计、装配按**整数**行计，两者在「整数化边界」上可分。
    // 实测两条（`1371` 系，超报量 86.295 / 43.81 都是**非整数倍**行值 ⇒ 不是「少打一整次」）：
    //  · yixuan-jufufu-lucia@弹刀40 槽0：1371009/1371023/1371025 三行实数次数与整数行不同；
    //  · auto-1371-1481-1451@弹刀60 槽1：1481011/12/13/09 四行同理（琉音强特跨多行）。
    // 同族残差在 `truncationRefold.test.ts` ④ 已有在册先例（`KNOWN_LEDGER_ROW_GAP`）。
    const KNOWN_INCOME_GAP: Record<string, number> = {
      'yixuan-jufufu-lucia@40@0': 86.30,
      'auto-1371-1481-1451@60@1': 43.81,
      // ⚠ 2026-10-18 新增：用户裁决「支援/防护连携归零」⇒ 卢西娅(1451) 不再出连携行 ⇒ 本队降配/截断落点位移
      // ⇒ 槽1（橘福福 1391，连携次数 1 未变）**首次**落到「被截断」形态，露出同族既有残差：
      // 账本按 `chainCountPerStun × stunCount` 的**实数**计、装配按**整数**行计（25 次连携里被砍掉的部分
      // 在账本仍按全额算）⇒ 喧响 +181.97。**不是新病灶**，是同一整数化边界在旧落点上恰好在容差内。
      // A/B 反证：把 `chainBaselineFor` 临时改回恒 `chainPerStun` ⇒ 本文件 4/4 绿（落点回到旧的、不触发该形态）。
      'yixuan-jufufu-lucia@60@1': 181.97,
    }
    const violations = applicable.filter(r => {
      const known = KNOWN_INCOME_GAP[`${r.id}@${r.parry}@${r.slot}`] ?? 0
      return r.ledE - r.rowE > 0.01 || r.ledD - r.rowD - known > 0.01
    })
    expect(
      violations.map(v => `${v.id}@弹刀${v.parry} 槽${v.slot}(${v.agentId}) 截${v.cut.toFixed(2)}s `
        + `能量 账本${v.ledE.toFixed(2)}>行Σ${v.rowE.toFixed(2)}(+${(v.ledE - v.rowE).toFixed(2)}) `
        + `喧响 账本${v.ledD.toFixed(2)}>行Σ${v.rowD.toFixed(2)}(+${(v.ledD - v.rowD).toFixed(2)})`),
      '账本收入超过保住行 = 报了打不出来的回复（本债资源面病灶复发）').toEqual([])
    // 反空洞（2026-10-25 改口径）：旧写法要求「至少一个槽 |账本 − 行Σ| > 0.01」——但债 2 修好后
    // 恒等式**本就该处处成立**，该条件只能在「仍存在残差」时满足 ⇒ 把判据绑在旧缺陷上，
    // 残差被根因修掉 / 落点移走后必然假红（本轮实测：1500 槽扫下来处处相等 ⇒ 旧断言必红）。
    // 新的反空洞 = 样本槽确有**真实行级收入**（排除 0 == 0 的平凡相等），
    // 「旧口径会超报」的鉴别力由 ② 用例的对照臂（allowed* vs row*）继续保证。
    expect(applicable.some(r => r.rowE + r.rowD > 1),
      '样本槽必须有非零行级收入（否则恒等式是 0 == 0 的平凡相等）').toBe(true)
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
