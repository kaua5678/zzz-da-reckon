/**
 * **交付点 = 前沿点**（用户 2026-11-06 口径：「用户可能想要的是当前情况的一个确切值」）。
 *
 * 口径全文与实测见 `docs/mcp-cinema-interval-uplift.md` §5.7；实现见 `composables/cinemaUpliftFrontier.ts`。
 *
 * ## 这条判据守的是什么
 *
 * 引擎的伤害交付点有两级：① **自由收敛的停点**（`outerExit='stable'` 或环退出 ⇒ kStar 结算）；
 * ② **前沿扩展**（本卡新增）。本卡把②的候选集定义为「收敛停点 ∪ **全部自洽可行**的钉 K 点」，
 * 交付 = 候选集里**伤害 argmax**（同伤害取小 K）。
 *
 * 可行 = **自洽**（`floor(连续失衡) ≥ K`）**且** **装得下**（`net + 待装补齐 ≤ 有效时间 + 2s`），
 * 与 kStar 结算 / 轴退化 / 非轴降配**同一把尺**（`solveTeam#netFitsBudget`）。
 *
 * ## 判据（每条都带负控或反空洞）
 *
 * ① **`auto-1591-1481-1211` p16 的 C0→C1 在固定 K 下不为负**（K=0..5 全部，用户完成标准原文）。
 * ② **交付 K == 该预设钉 K 扫描下的伤害 argmax**（同一批次内逐预设核对，用户完成标准原文）。
 * ③ **负控：把交付规则改回 max-K ⇒ 判据②在本批次上必须变红**（实测 witness：
 *    `auto-1591` p16 的 C1 最大可行 K 是 K1（26.66M），而它的收敛停点是 K3（37.01M）
 *    ⇒ max-K 交付造出 **−19.06%** 的假负值；argmax 交付是 **+12.34%**）。
 * ④ **反空洞**：可行集 argmax 必须落在**最大可行 K** 上（实测全库 210 对无例外）；若哪天
 *    argmax 与 max-K 在可行集内分叉，说明「窗越多伤害越高」不再成立，③ 的负控 witness 需要重新标定。
 *
 * ## ⚠ 关于「全库任意固定 K 都非负」——**不成立，且不该成立**
 *
 * 全库 105 预设 × p∈{0,16} × C∈{0,1}（210 对）实测：**argmax 交付下仍有 3 对为负**
 * （`auto-1461-1521-1491` p16 −2.05% / `auto-1091-1511-1311` p16 −0.59% /
 * `auto-1181-1561-1411` p0 −4.04%，探针 `.zc/perf/ruleCmp.probe.perf.ts`）。
 * 那是**真实物理**（C2 一类命座加的动作会挤掉更值钱的行），不是交付点漂移——把判据写成「全库非负」
 * 就变成要求引擎报假数。⇒ ① 只钉用户点名的那个预设；其余预设有 3 对负值如实记在文档 §5.7 里。
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { withAnalysisScenario } from '@/composables/analysisScenario'
import { applyTeamToStore } from '@/composables/teamCompare'
import { clearDifficultyLevers } from '@/composables/difficultyLadder'
import { teamPresets } from '@/data/teamPresets'
import {
  pickDelivery,
  scanKFrontier,
  type KFrontier,
} from '@/composables/cinemaUpliftFrontier'

/**
 * 扫一条前沿：装预设 → 槽 0 给 parry → 扫。
 *
 * `earlyClose: false` = **每个 K 都真求值**（判据①要「K=0..5 全部实测」；
 * 提前封闭的点读数是 NaN，只能表达「不可能」，不能表达「实测也是正的」）。
 */
/**
 * 扫一条前沿。
 *
 * @param clearLevers `true`（缺省）= **难度曲线基线**口径（`clearDifficultyLevers` 会把计数投影设成 0=off）；
 *   `false` = **生产默认**口径（投影 physical，与用户实际看到的数一致）。
 *   两种口径的证据差异很大（见判据⑤ 的适用范围），判据必须分别钉，不能混用。
 */
async function frontierOf(presetId: string, cinema: number, parry: number, clearLevers = true): Promise<KFrontier | null> {
  const preset = teamPresets.find(p => p.id === presetId)
  if (!preset) return null
  let out: KFrontier | null = null
  await withAnalysisScenario(async s => {
    if (clearLevers) clearDifficultyLevers({ config: s.config, calc: s.calc })
    applyTeamToStore(s.config, preset)
    s.config.setCinemaLevel(0, cinema)
    s.config.syncTeammateBuffsFromTeam()
    for (let slot = 0; slot < 3; slot++) s.config.setActionCount(slot, 'parryCount', slot === 0 ? parry : 0)
    out = await scanKFrontier(s, { cinemaLevel: cinema, earlyClose: false })
  })
  return out
}

/** 可行集里的伤害 argmax（同伤害取小 K，与 `pickDelivery` 同判据） */
function feasibleArgmax(f: KFrontier) {
  const feasible = f.points.filter(p => p.feasible)
  if (!feasible.length) return null
  return feasible.reduce((a, b) => (b.dmg > a.dmg + 1e-9 ? b : b.dmg < a.dmg - 1e-9 ? a : (b.k < a.k ? b : a)))
}

const PRESET = 'auto-1591-1481-1211'
const PARRY = 16

describe(`判据①：${PRESET} p${PARRY} 固定 K 下 C0→C1 不得为负（K=0..5 全部）`, () => {
  beforeAll(async () => {
    await setupHarness(['', '', ''], { productionBasicWeights: true })
  })

  it('K=0..5 每个固定窗数上 C1 ≥ C0（每个 K 都真求值，不靠提前封闭）', async () => {
    const c0 = await frontierOf(PRESET, 0, PARRY)
    const c1 = await frontierOf(PRESET, 1, PARRY)
    expect(c0 && c1, 'C0/C1 前沿没扫出来').toBeTruthy()
    const rows: string[] = []
    const negative: string[] = []
    for (const k of [0, 1, 2, 3, 4, 5]) {
      const p = c0!.points.find(x => x.k === k)
      const q = c1!.points.find(x => x.k === k)
      expect(p?.scanned, `C0 的 K${k} 没被求值（判据要求 K=0..5 全部实测）`).toBe(true)
      expect(q?.scanned, `C1 的 K${k} 没被求值`).toBe(true)
      const pct = p!.dmg > 0 ? ((q!.dmg - p!.dmg) / p!.dmg) * 100 : 0
      rows.push(`K${k}: ${(p!.dmg / 1e6).toFixed(2)}M → ${(q!.dmg / 1e6).toFixed(2)}M（${pct.toFixed(2)}%）`)
      if (pct < 0) negative.push(rows[rows.length - 1])
    }
    expect(negative, `固定 K 下出现 C0→C1 负提升：\n${negative.join('\n')}`).toHaveLength(0)
    // 反空洞：K=0..5 至少有 3 个点两级都**可行**（否则「非负」是拿不可行点凑出来的恒真）
    const bothFeasible = [0, 1, 2, 3, 4, 5].filter(k => {
      const p = c0!.points.find(x => x.k === k)
      const q = c1!.points.find(x => x.k === k)
      return p?.feasible && q?.feasible
    })
    expect(bothFeasible.length, `K=0..5 里两级都可行的点太少（${bothFeasible.length}）⇒ 非负判据近恒真`).toBeGreaterThanOrEqual(2)
  }, 240_000)
})

describe('判据②：交付 K == 钉 K 扫描的伤害 argmax（同批逐预设核对）', () => {
  beforeAll(async () => {
    await setupHarness(['', '', ''], { productionBasicWeights: true })
  })

  /**
   * 批次 = 本专项的环队 4 支 × 4 档 + 用户点名的 auto-1591 × 2 档。
   *
   * 覆盖形态（实测）：
   * - `pinned` 交付（前沿扩展真的改了点）——如 `yixuan-roxy` p16 C0 的 K3 25.31M > 收敛 24.93M；
   * - `converged` 交付（收敛停点已经最优）——如 `auto-1591` p16 C0；
   * - 收敛停点 **高于**任何钉 K 点（plan ≠ pin 的形态）——如 `auto-1591` p16 C1 的 37.01M。
   */
  const BATCH: Array<{ id: string; parry: number[] }> = [
    { id: 'yixuan-jufufu-lucia', parry: [0, 8, 16, 20] },
    { id: 'yixuan-trigger-lucia', parry: [0, 8, 16, 20] },
    { id: 'yixuan-roxy-lucia', parry: [0, 8, 16, 20] },
    { id: 'auto-1371-1481-1451', parry: [0, 8, 16, 20] },
    { id: 'auto-1591-1481-1211', parry: [0, 16] },
  ]

  it('逐预设：交付 K 就是可行集 argmax（或收敛停点领先时代付收敛停点）', async () => {
    const problems: string[] = []
    let pinnedCount = 0
    let convergedCount = 0
    let checked = 0
    for (const team of BATCH) {
      for (const parry of team.parry) {
        for (const cinema of [0, 1]) {
          const f = await frontierOf(team.id, cinema, parry)
          if (!f) continue
          checked++
          const argmax = feasibleArgmax(f)
          if (!argmax) {
            // 没有可行点 ⇒ 前沿扩展无从谈起，交付必须如实回落收敛停点
            if (f.delivery.source !== 'converged') {
              problems.push(`${team.id} p${parry} C${cinema}: 无可行点却报 source=${f.delivery.source}`)
            }
            continue
          }
          const expectedK = f.delivery.convergedDmg >= argmax.dmg - 1e-9 ? f.delivery.convergedK : argmax.k
          if (f.delivery.k !== expectedK) {
            problems.push(`${team.id} p${parry} C${cinema}: 交付 K${f.delivery.k} ≠ argmax K${argmax.k}`)
          }
          // 交付伤害必须与它自己那一行的读数逐位一致（不许交付扫描表里没有的数）
          if (f.delivery.source === 'pinned') {
            pinnedCount++
            const own = f.points.find(p => p.k === f.delivery.k)
            if (Math.abs((own?.dmg ?? Number.NaN) - f.delivery.dmg) > 1e-6) {
              problems.push(`${team.id} p${parry} C${cinema}: 交付伤害与 K${f.delivery.k} 那一行不一致`)
            }
          } else {
            convergedCount++
          }
        }
      }
    }
    expect(checked, '反空洞：一个前沿都没扫出来').toBeGreaterThan(20)
    // 反空洞：两种交付形态都必须出现过，否则本判据只测到了其中一条路径
    expect(pinnedCount, '反空洞：本批次没有一格走「前沿扩展」⇒ 判据②没测到新路径').toBeGreaterThan(0)
    expect(convergedCount, '反空洞：本批次没有一格走「收敛停点已最优」').toBeGreaterThan(0)
    expect(problems, `交付点判据失败：\n${problems.join('\n')}`).toHaveLength(0)
  }, 900_000)
})

describe(`判据③ 负控：把交付规则改回 max-K ⇒ 判据变红（witness ${PRESET} p${PARRY}）`, () => {
  beforeAll(async () => {
    await setupHarness(['', '', ''], { productionBasicWeights: true })
  })

  /**
   * 这条负控是**本卡的存在理由**：用户报的「取两点会造出假负值」在 `auto-1591-1481-1211` p16 上的
   * 精确形态 = C0 交付 K3 / C1 交付 K1（两级落在不同操作点）。
   *
   * 那是什么规则造成的？**不是**「argmax vs max-K」（可行集里两者同一个点，见判据④），
   * 而是**候选集被砍**：C1 的可行点只有 K0/K1，而它的**收敛停点**在 K3（37.01M）——
   * max-K 规则只看钉 K 扫描的可行点、不把「收敛停点」放进候选集 ⇒ C1 交付 26.66M，C0 交付 32.94M
   * ⇒ **−19.06%**。argmax 规则把收敛停点放进候选集 ⇒ C1 交付 37.01M ⇒ **+12.34%**。
   *
   * ⇒ 负控断言 = 「同一批扫描数据上，用 max-K 规则会得出负值，用 argmax 规则得出正值」，
   * 两者都在本用例里**实测**，不是推理。
   */
  it('同一批数据：maxK 规则 −19.06% / argmax 规则 +12.34%（差 31.4pp）', async () => {
    const c0 = await frontierOf(PRESET, 0, PARRY)
    const c1 = await frontierOf(PRESET, 1, PARRY)
    expect(c0 && c1).toBeTruthy()
    const pctOf = (rule: 'argmax' | 'maxK'): number => {
      const a = pickDelivery(c0!.points, c0!.delivery.convergedDmg, c0!.delivery.convergedK, rule)
      const b = pickDelivery(c1!.points, c1!.delivery.convergedDmg, c1!.delivery.convergedK, rule)
      return ((b.dmg - a.dmg) / a.dmg) * 100
    }
    const argmaxPct = pctOf('argmax')
    const maxKPct = pctOf('maxK')
    // 生产规则（argmax）必须为正 —— 这就是用户完成标准的那条
    expect(argmaxPct, `argmax 交付下 C0→C1 = ${argmaxPct.toFixed(2)}%，应为正`).toBeGreaterThan(0)
    expect(argmaxPct).toBeCloseTo(12.34, 1)
    // 负控：改回 max-K 必须变红（负值）
    expect(maxKPct, `负控失效：max-K 交付下 C0→C1 = ${maxKPct.toFixed(2)}%，本应变负`).toBeLessThan(0)
    expect(maxKPct).toBeCloseTo(-19.06, 1)
    // 差值的来源可归因：C1 的两条候选集差别（收敛停点 K3 的 37.01M vs max-K 的 K1 26.66M）
    expect(c1!.delivery.convergedK, 'C1 的收敛停点应落在 K3（plan≠pin 的形态）').toBe(3)
    expect(c1!.delivery.convergedDmg / 1e6).toBeCloseTo(37.01, 1)
  }, 240_000)
})

/**
 * 判据⑤ **外层评估点漂移**（2026-11-06 立，11-07 按实测改正了适用范围）。
 *
 * ## 形态
 *
 * 「同 K 名下的两个计划」：`auto-1431-1481-1491` C2 的收敛停点与「把 K 钉在**同一个 K**（K1）重算」：
 *
 * | | 收敛停点 K1 | 钉 K1（同一个 K） |
 * |---|---|---|
 * | 伤害 | 29.78M | **32.07M（+7.7%）** |
 * | nec(1431) | 119.3 | 130.2 |
 * | 大招(1431) | 4 | 5 |
 * | Σ净占用 | 180.00 | 177.99 |
 *
 * ⇒ **K 单独不能标识评估点**（「按上一轮池排 K 窗」与「按 K 钉住重排」是两条路径）。
 *
 * ## ⚠ 适用范围（11-07 两轮实测纠正，别再把旧结论放大）
 *
 * 该形态**只在计数投影 = off 的口径下复现**（`clearDifficultyLevers` 会把它设成 0，难度曲线用那个基线）。
 * 换成**生产默认**（physical）后同一格 C2 同 K 漂移 = **0.0%**、C1→C2 = **+17.85%**。
 * 全库 315 格（`.zc/perf/gapBoth.probe.perf.ts` 改写版，**已按可行性过滤**）：
 * 投影 off ⇒ 含装不下 50 格 >5% / 只数可行 **39 格 >5%、4 格 >10%、最差 24.0%**；
 * 投影 physical ⇒ 含装不下 7 格 >5%，**只数可行 4 格 >5%、0 格 >10%、最差 8.0%**。
 * ⇒ 漂移与计数投影强相关；**在用户实际看到的配置下它比 off 口径下小一个数量级**。
 *
 * ⚠ **两条必须先说的前提**（否则下面的断言会被误读）：
 * ① 钉 K 那一侧**恒跑 off**——用户锁 `enemy.stunCountLock` 时 `useResourceCalc`（CC-151）与
 *   `solveTeam#evalLocked` 都把投影从 physical 回落 off（physical 读上一轮池、会旁路锁定值）。
 *   ⇒ 本探针量的是「计划分支差 ⊗ 投影口径差」，physical 下差变小**不等于**分支问题被治好。
 * ② 「钉 K 分支才是规范计划」**不成立**：最差那格（`banyue-liuyin-lucia` C0，+22.2%）的钉 K3
 *   净占用 **247.06s vs 有效 180s**（+67s、大招 7/3/2→11/4/4）⇒ 是**时间账装不下的透支**，不是计划；
 *   `scanKFrontier` 已判 `feasible=false` 把它排除出交付候选，错的只是「普查没过滤」。
 *   装得下的钉 K 点则是**真实可达点**（physical 口径 47/315 格高于收敛停点，≤8.0%）。
 *
 * 本用例因此**两种口径都测**：off 口径钉「形态存在 + 被交付点吸收」，physical 口径钉「生产口径下 C1→C2 本就为正」。
 * 只测 off 口径会把一个非生产口径的结论锁成永久判据——那正是本次教训。
 *
 * ## 本卡的处置
 *
 * 交付点 = max(收敛停点, 钉 K 可行点) ⇒ 漂移被**吸收进交付点**而不是留在提升率里：
 * off 口径该格 C1→C2 从**收敛 −2.05%** 变成**交付 +5.15%**。
 */
describe('判据⑤ 外层评估点漂移：同一 K 名下两个计划（叶瞬光 C1→C2）', () => {
  beforeAll(async () => {
    await setupHarness(['', '', ''], { productionBasicWeights: true })
  })

  const YSG = 'auto-1431-1481-1491'

  it('生产默认口径（physical）：C1→C2 本就为正（同 K 漂移 0%）——防「用非生产口径的尺结论」', async () => {
    const c1 = await frontierOf(YSG, 1, 0, false)
    const c2 = await frontierOf(YSG, 2, 0, false)
    expect(c1 && c2).toBeTruthy()
    const convergedPct = ((c2!.delivery.convergedDmg - c1!.delivery.convergedDmg) / c1!.delivery.convergedDmg) * 100
    expect(convergedPct, `生产默认口径下 C1→C2 应本就为正（实测 ${convergedPct.toFixed(2)}%）`).toBeGreaterThan(0)
    expect(convergedPct).toBeCloseTo(17.85, 1)
    // 同 K 漂移为 0 ⇒ 「同一 K 两个计划」不是生产口径下的形态（它是投影 off 的产物）
    const at = c2!.points.find(p => p.k === c2!.delivery.convergedK && p.scanned)
    expect(at, 'C2 收敛 K 那一行必须被扫到').toBeTruthy()
    const gap = ((at!.dmg - c2!.delivery.convergedDmg) / c2!.delivery.convergedDmg) * 100
    expect(Math.abs(gap), `生产口径下同 K 漂移应为 0，实测 ${gap.toFixed(2)}%`).toBeLessThan(1e-6)
  }, 240_000)

  it('投影 off 口径（难度曲线基线）：形态成立，且被交付点吸收', async () => {
    const c1 = await frontierOf(YSG, 1, 0)
    const c2 = await frontierOf(YSG, 2, 0)
    expect(c1 && c2, 'C1/C2 前沿没扫出来').toBeTruthy()
    // 反空洞 ①：两级收敛停点落在**不同的 K**（C1=K2 / C2=K1）——
    // 即这一格的负值**同时**含两种成分，判据必须把两者分开钉住：
    //   ⓐ K 落点漂移（K2 → K1）；
    //   ⓑ **同一个 K 名下的计划分支漂移**（C2 的 K1：收敛 29.78M vs 钉同 K 32.07M）。
    // 下面 ③④ 只关 ⓑ：交付点的漂移必须落在「同一个 K」上也被纠正（否则修法只治了 ⓐ）。
    expect(c1!.delivery.convergedK, 'C1 收敛停点应为 K2').toBe(2)
    expect(c2!.delivery.convergedK, 'C2 收敛停点应为 K1').toBe(1)
    // ② 收敛口径为负（这就是并行会话报的那类症状）
    const convergedPct = ((c2!.delivery.convergedDmg - c1!.delivery.convergedDmg) / c1!.delivery.convergedDmg) * 100
    expect(convergedPct, `收敛口径 C1→C2 应复现负值，实测 ${convergedPct.toFixed(2)}%`).toBeLessThan(0)
    expect(convergedPct).toBeCloseTo(-2.05, 1)
    // ③ C2 的交付点必须**离开**它的收敛停点（ⓑ 被吸收进交付点）——driftPct ≈ +7.7%
    // 注：C2 的交付 K 仍是 K1（= 它自己的收敛 K），变的是**同一个 K 的那个点**
    // ⇒ 这条正是「K 单独不能标识评估点」的机器面
    expect(c2!.delivery.source, 'C2 的交付点应是前沿扩展（收敛停点不是最优）').toBe('pinned')
    expect(c2!.delivery.k, 'C2 的交付 K 仍应是 K1（漂移发生在同一个 K 内）').toBe(1)
    expect(c2!.delivery.driftPct, `C2 交付点相对收敛停点的漂移应为 +7.7%，实测 ${c2!.delivery.driftPct.toFixed(2)}%`)
      .toBeCloseTo(7.7, 0)
    // ④ 交付口径转正
    const deliveredPct = ((c2!.delivery.dmg - c1!.delivery.dmg) / c1!.delivery.dmg) * 100
    expect(deliveredPct, `交付口径 C1→C2 必须为正，实测 ${deliveredPct.toFixed(2)}%`).toBeGreaterThan(0)
    expect(deliveredPct).toBeCloseTo(5.15, 1)
    // ⑤ 交付点本身必须可行（不能靠「装不下的点」把数拉正）
    const pinned = c2!.points.find(p => p.k === c2!.delivery.k)
    expect(pinned?.feasible, 'C2 交付的那个 K 必须可行（自洽且装得下）').toBe(true)
    expect(pinned!.net, 'C2 交付点的净占用必须 ≤ 有效时间 + 2s').toBeLessThanOrEqual(c2!.effectiveTime + 2)
  }, 240_000)
})

describe('判据④ 反空洞：可行集里 argmax 必须落在最大可行 K 上', () => {
  beforeAll(async () => {
    await setupHarness(['', '', ''], { productionBasicWeights: true })
  })

  /**
   * 实测（全库 105 预设 × p∈{0,16} × C∈{0,1} = 210 对，`.zc/perf/ruleCmp.probe.perf.ts`）：
   * **可行集内零例外**——K 越大伤害越高。所以「argmax」与「max-K」在**可行集内部**是同一个点，
   * 两套口径的分歧**全部来自可行集的边界**（哪些 K 算可行 / 收敛停点算不算候选）。
   *
   * 这条反空洞的作用：若未来某个改动让「窗越多伤害越高」在可行集内失效，
   * 本判据会先红——那时判据③ 的负控 witness（−19.06%）需要重新标定，而不是继续沿用。
   */
  it(`${PRESET} p${PARRY} C0/C1：可行集 argmax == 最大可行 K，且强单调`, async () => {
    for (const cinema of [0, 1]) {
      const f = await frontierOf(PRESET, cinema, PARRY)
      expect(f, `C${cinema} 前沿没扫出来`).toBeTruthy()
      const feasible = f!.points.filter(p => p.feasible)
      expect(feasible.length, `C${cinema} 可行点太少（${feasible.length}）`).toBeGreaterThan(1)
      const argmax = feasible.reduce((a, b) => (b.dmg > a.dmg + 1e-9 ? b : a))
      const maxK = feasible.reduce((a, b) => (b.k > a.k ? b : a))
      expect(argmax.k, `C${cinema} 可行集里 argmax 与最大可行 K 分叉`).toBe(maxK.k)
      for (let i = 1; i < feasible.length; i++) {
        expect(feasible[i].dmg, `C${cinema} 可行点非单调（K${feasible[i - 1].k}→K${feasible[i].k}）`)
          .toBeGreaterThan(feasible[i - 1].dmg)
      }
    }
  }, 240_000)
})
