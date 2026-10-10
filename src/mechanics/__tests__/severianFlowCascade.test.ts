/**
 * 债 1a 批 1′：**1631 赛维里安流息方程的「有序级联」锁**（T122）。
 *
 * ## 本文件为什么存在
 *
 * T118 曾把 1631 推荐为「可松弛」（报告 §④：`floor(flow/100)×30` 是**累加触发**，松弛与有序级联 12/12 档同解）。
 * **T122 实测证伪该结论**：1631 与 1591 同属 **(a) 有序级联**——第 N 次苍风影猎的 `+30` 流息
 * 只在第 N 次**消耗之后**到账，付不了第 N 次自己的 100 点成本。
 * ⇒ 松弛解 `f = base/0.7`（迭代期不 floor）兑现的是**不可达的余数**，在 `base mod 70 < 30` 的档位恒 **+1** 次影猎。
 *
 * T118 §④ 表把 `base=150` 一行写成「有序级联 `210/2`」——`210` 是**最大不动点**（另一个根），
 * 代码实际输出（= 有序级联 = 最小不动点）是 `180/1`；四行全部如此。详见报告 §②。
 *
 * ## 判据（每条都带反证形态）
 *
 * | # | 判据 | 反证（还原/注入 ⇒ 红） |
 * |---|---|---|
 * | A | **物理可达性不变量**：C6 下 `flowIncome ≥ 100×影猎 + 30`（第 N 次影猎必须付得起） | `severian.ts` 去掉迭代期 `Math.floor` ⇒ 松弛解在 40%+ 档位违约 ⇒ 红 |
 * | B | **闭式解锁定**：`影猎 = max(0, floor((base−30)/70))`，`base` 由模块自身输出反推 | 同上 ⇒ 影猎多 1 ⇒ 红 |
 * | C | **源码锁**（规则 16①）：迭代式必须含 `Math.floor(flow / SEVERIAN_SHADOW_FLOW_COST)` | 改成 `flow / COST`（不 floor）⇒ 红 |
 * | D | **反空洞**：扫描面必须真的覆盖「松弛 ≠ 级联」的档位，否则 A/B 是空断言 | 若夹具全落在单不动点档 ⇒ D 先红 |
 * | E | **全管线**：手组队 `sev+liuyin+rina` 的 c0/c6 读数（T118 验收面）与解析可达值一致 | 同 A |
 *
 * ## 为什么 A 是「物理」判据而不是「照抄代码」
 *
 * 设第 N 次影猎发动前的库存 = `base + 30(N−1)`（前 N−1 次的退款已到账，第 N 次的还没）。
 * 付得起 ⇔ `base + 30(N−1) ≥ 100N`。而 `base = flowIncome − 30N`
 * ⇒ `flowIncome − 30N + 30N − 30 ≥ 100N` ⇒ **`flowIncome ≥ 100N + 30`**。
 * 这条不等式**只依赖「退款在消耗之后到账」这一条游戏事实**，不依赖任何实现细节
 * ⇒ 松弛解 `f = base/0.7` 必然违约（`base=150`：`214.29 < 230`）。
 *
 * ## 本锁**不**拦什么（合法改法的出口）
 *
 * 本锁钉的是「**当前消耗模型**（攒够 100 立即发动、退款在消耗后到账）」下的可达性。
 * 若将来要改成**批处理模型**（一次结算整局、允许余数结转/批量兑现，即 T118 §⑩.4 说的
 * 「兑现余数机会」），那是**换物理口径**、需用户裁决——那时**应当**同步改写本锁的 A/B/C 三条，
 * 并在提交说明写明「消耗模型已换」。锁的语义是「改模型要显式改锁」，不是「永远不许改」。
 *
 * ⚠ **附带实测**：现网 `for (let i = 0; i < 8; i++)` 的 8 轮上限对**整数**级联**够用**
 * （base 0..20000 全扫，最长 6 轮收敛，与不设上限逐位一致）；但若改成松弛式，
 * 8 轮**不够**（需 17 轮才到 1e-9，且 `base=70/1050` 这类档位 8 轮与真解差 1 次影猎）。
 * ⇒ 松弛不只是「解错根」，还会与既有的迭代上限**耦合出第三个数**。
 *
 * ## 夹具口径
 *
 * 一律**手组队**（`teamPresets` 里 **0 支** 1631 预设 ⇒ 预设面对本模块是空的）。
 * 纯函数面（A–D）直接调 `severianMechanic.buildResourceResult`——模块**自己**的代码路径，
 * 不复制收入公式（规则 11）。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { mockStaticFetch, newPinia, setupHarness } from '@/test/harness'
import { useResourceCalc, setCalcOutputMemoEnabled } from '@/composables/useResourceCalc'
import { useConfigStore } from '@/stores/config'
import {
  severianMechanic,
  SEVERIAN_C6_WINDRISE_FLOW,
  SEVERIAN_SHADOW_FLOW_COST,
} from '@/mechanics/agents/severian'

const COST = SEVERIAN_SHADOW_FLOW_COST
const WIND = SEVERIAN_C6_WINDRISE_FLOW

/** 读模块**自己**的流息输出（`buildResourceResult` 是 `severianFlowState` 的唯一公开入口） */
function flowOf(input: { ult: number; chain: number; dodge: number; cinema?: number }): {
  base: number
  flowIncome: number
  shadowHuntCount: number
} {
  // 残缺夹具（只给本判据读的字段）：与本仓既有模块测试同款（orphieSelf.test.ts:150 / jufufu.test.ts:213）
  const res = severianMechanic.buildResourceResult!({
    cfg: { severianCinemaLevel: input.cinema ?? 6, dodgeCounterCount: input.dodge },
    state: {
      ultimateCount: input.ult,
      chainCountTotal: input.chain,
      basicAttackTime: 0,
    },
    preModuleExecutions: [],
    prePatchExecutions: [],
  } as any)
  const flow = res.severianFlow!
  // base = 影画6 反馈项扣掉之后的「基础收入」（模块输出里唯一可反推 base 的量）：
  // C6 下 flowIncome = base + 30×影猎 ⇒ base = flowIncome − 30×影猎；非 C6 无反馈项。
  const c6 = (input.cinema ?? 6) >= 6
  return {
    base: c6 ? flow.flowIncome - WIND * flow.shadowHuntCount : flow.flowIncome,
    flowIncome: flow.flowIncome,
    shadowHuntCount: flow.shadowHuntCount,
  }
}

/** 松弛解（迭代期不 floor）：`f = base + 0.3f ⇒ f = base/0.7`，终局 floor 一次 */
function relaxedHunt(base: number): number {
  return Math.floor(base / (1 - WIND / COST) / COST)
}

/** 有序级联的可达上界：`base + 30(N−1) ≥ 100N ⇒ N ≤ floor((base−30)/70)` */
function reachableMaxHunt(base: number): number {
  return Math.max(0, Math.floor((base - WIND) / (COST - WIND)))
}

const STRIP = (p: URL) => readFileSync(p, 'utf8')
  .split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n')

/** 扫描面：整数驱动的 base 网格（`ult×100 + chain×50 + dodge×15`，覆盖 0..3415） */
const GRID: Array<{ ult: number; chain: number; dodge: number }> = []
for (let ult = 0; ult <= 20; ult++) {
  for (let chain = 0; chain <= 6; chain++) {
    for (let dodge = 0; dodge <= 10; dodge++) GRID.push({ ult, chain, dodge })
  }
}

describe('债 1a · 1631 赛维里安流息方程 = (a) 有序级联（不可松弛）', () => {
  /**
   * A：**物理可达性不变量**。这是本文件的核心判据——
   * 它只编码「第 N 次影猎的 +30 在第 N 次消耗之后才到账」这一条游戏事实。
   * 松弛解在此必然违约（实测 `base=150`：松弛 `flowIncome=214.29`，而 `100×2+30=230`）。
   */
  it('A 物理可达性：C6 下 flowIncome ≥ 100×影猎 + 30（松弛解在此违约）', () => {
    const violations: string[] = []
    let checked = 0
    for (const g of GRID) {
      const { flowIncome, shadowHuntCount } = flowOf(g)
      if (shadowHuntCount <= 0) continue
      checked++
      const need = COST * shadowHuntCount + WIND
      if (flowIncome < need - 1e-9) {
        violations.push(`ult=${g.ult},chain=${g.chain},dodge=${g.dodge}: flowIncome=${flowIncome} < ${need}`)
      }
    }
    expect(checked, '反空洞：扫描面必须真的产出 ≥1 次影猎的档位').toBeGreaterThan(50)
    expect(violations, `可达性违约（= 兑现了不可达的余数）：\n${violations.slice(0, 10).join('\n')}`).toEqual([])
  })

  /**
   * B：**闭式解锁定**。`影猎 = max(0, floor((base−30)/70))`——这条式子是「有序级联 = 最小不动点」的解析形式。
   * `base` 由模块自身输出反推（`base = flowIncome − 30×影猎`），故不是照抄收入公式。
   */
  it('B 闭式解：影猎 = max(0, floor((base−30)/70))（松弛会给 floor(base/70)）', () => {
    const wrong: string[] = []
    let multi = 0
    for (const g of GRID) {
      const { base, shadowHuntCount } = flowOf(g)
      const expectHunt = reachableMaxHunt(base)
      if (expectHunt !== shadowHuntCount) {
        wrong.push(`base=${base}: 模块=${shadowHuntCount} 解析可达=${expectHunt} 松弛=${relaxedHunt(base)}`)
      }
      if (relaxedHunt(base) !== reachableMaxHunt(base)) multi++
    }
    expect(multi, '反空洞：扫描面必须覆盖「松弛 ≠ 级联」的档位').toBeGreaterThan(100)
    expect(wrong, `闭式解不符：\n${wrong.slice(0, 10).join('\n')}`).toEqual([])
  })

  /**
   * D：**反空洞 + 定量**。判据 A/B 只有在扫描面真的覆盖「松弛 ≠ 级联」时才有效。
   * 这里同时把「松弛会错多少」钉成数字：`base mod 70 < 30` 的档位恒 **+1**。
   */
  it('D 反空洞：松弛在 base mod 70 < 30 的档位恒 +1（否则 A/B 是空断言）', () => {
    const rows: Array<{ base: number; mod: number; reachable: number; relaxed: number }> = []
    for (const g of GRID) {
      const { base } = flowOf(g)
      rows.push({ base, mod: base % 70, reachable: reachableMaxHunt(base), relaxed: relaxedHunt(base) })
    }
    const over = rows.filter(r => r.relaxed > r.reachable)
    expect(over.length, '反空洞：必须存在松弛超出的档位').toBeGreaterThan(0)
    // 超出条件充要：base mod 70 < 30
    expect(over.every(r => r.mod < WIND), `超出档位必须全部满足 base mod 70 < 30；反例=${JSON.stringify(over.find(r => r.mod >= WIND))}`).toBe(true)
    // 超出量恒为 +1（不是「多很多」——正是「余数机会兑现一次」的形状）
    expect(over.every(r => r.relaxed === r.reachable + 1), '松弛超出量必须恒为 +1').toBe(true)
    // 两档都要有采样（否则判据只在单边成立）
    expect(rows.some(r => r.mod < WIND), '必须有 base mod 70 < 30 的档位').toBe(true)
    expect(rows.some(r => r.mod >= WIND), '必须有 base mod 70 ≥ 30 的档位').toBe(true)
  })

  /**
   * C：**源码锁**（规则 16①：口径必须挂在活代码上）。
   * 反证形态：把 `Math.floor(flow / SEVERIAN_SHADOW_FLOW_COST)` 改成 `flow / SEVERIAN_SHADOW_FLOW_COST`
   * ⇒ A/B 当场红（这正是本文件要拦的「实数化」误改）。
   */
  it('C 源码锁：迭代式必须对 flow 取整（floor 不得被移出迭代期）', () => {
    const src = STRIP(new URL('../agents/severian.ts', import.meta.url))
    expect(src, '迭代期必须 floor（有序级联 ⇒ 退款不能用于支付本次成本）')
      .toMatch(/base \+ Math\.floor\(flow \/ SEVERIAN_SHADOW_FLOW_COST\) \* SEVERIAN_C6_WINDRISE_FLOW/)
    expect(src, '不得改成松弛式（迭代期不 floor）——1631 是 (a) 有序级联，松弛 = 兑现不可达余数')
      .not.toMatch(/base \+ \(flow \/ SEVERIAN_SHADOW_FLOW_COST\)/)
    expect(src, '终局次数必须仍由 floor(flow/100) 给出').toMatch(/shadowHuntCount: Math\.floor\(flow \/ SEVERIAN_SHADOW_FLOW_COST\)/)
  })

  /**
   * E：**全管线**（T118 验收面）。`teamPresets` 里 0 支 1631 ⇒ 预设面对本模块全盲，
   * 只能手组队。读数与 T118 §④ 现场一致（`nec` 已复现），但**影猎次数**按可达值解释。
   *
   * ⚠ **夹具必须落在「判别档」**（`base mod 70 < 30`）：初版用的 `sev+1481+1311/c6`（base=1100）
   * 与 `sev+1211+1311/c6`（base=1240）**都在非判别档** ⇒ 注入松弛的反证下 E **仍然全绿**（实测）。
   * 现用两支经 `sevdist.perf.ts` 实测确认在判别档（干净树 base=1050 / 1200）——这才是 E 的牙。
   *
   * ⚠ **注入松弛后 `base` 自己会漂**（实测 `sev+1481+1211/c6`：1050 → 1080、`hunt` 14）——
   * 因为 `hunt` 经外层收敛环反过来改 `ult`/`chain` ⇒ 改 `severianFlowIncome` 的输入。
   * 所以注入态下 `discriminatingSeen` 这条**反空洞**断言也可能先红（它读的是**观测到的** base）。
   * 两条断言**任一红都算 E 有牙**；反证实测 = 4 failed（A/B/C/E），D 绿（D 是反空洞尺子，不是缺陷探测器）。
   */
  it('E 全管线：手组队判别档的 flowIncome 满足可达性不变量', async () => {
    newPinia(); mockStaticFetch()
    const { catalog } = await setupHarness(['', '', ''], { recommendedBuild: false })
    await catalog.loadBuildRecommendations()
    const config = useConfigStore()
    const calc = useResourceCalc()
    setCalcOutputMemoEnabled(false)
    const rows: string[] = []
    const violations: string[] = []
    let discriminatingSeen = 0
    // 判别档夹具（sevdist.perf.ts 实测 base）：sev+1481+1211/c6 = 1050；sev+1211+1141/c6 = 1200
    for (const [team, tag, cin] of [
      [['1631', '1481', '1211'], 'sev+1481+1211', 6],
      [['1631', '1211', '1141'], 'sev+1211+1141', 6],
    ] as Array<[string[], string, number]>) {
      for (let i = 0; i < 3; i++) config.setAgent(i, team[i]!)
      config.setCinemaLevel(0, cin)
      const rr = calc.resourceResult.value!
      const ch = rr.characters.find(c => c.slot === 0)!
      const flow = (ch as unknown as { severianFlow?: { flowIncome: number; shadowHuntCount: number } }).severianFlow!
      const base = flow.flowIncome - WIND * flow.shadowHuntCount
      if (relaxedHunt(base) > reachableMaxHunt(base)) discriminatingSeen++
      rows.push(`${tag}/c${cin}: base=${base} mod70=${base % 70} 影猎=${flow.shadowHuntCount} 松弛=${relaxedHunt(base)} nec=${ch.timeAllocation.necessaryTime.toFixed(3)}`)
      if (flow.shadowHuntCount > 0) {
        const need = COST * flow.shadowHuntCount + WIND
        if (flow.flowIncome < need - 1e-9) violations.push(`${tag}/c${cin}: ${flow.flowIncome} < ${need}`)
      }
    }
    expect(rows.length, '反空洞：全管线必须采到 2 条读数').toBe(2)
    expect(discriminatingSeen, `反空洞：全管线夹具必须落在判别档（否则 E 在松弛下仍绿）；实测=${rows.join(' | ')}`).toBe(2)
    expect(violations, `全管线可达性违约：\n${violations.join('\n')}`).toEqual([])
  }, 900_000)
})
