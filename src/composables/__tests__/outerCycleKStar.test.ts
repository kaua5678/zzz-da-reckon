/**
 * **环退出 ⇒ kStar 结算**的两条判据（T180，用户 2026-11-04 专项第三轮）。
 *
 * 口径全文与实测见 `docs/mcp-cinema-interval-uplift.md` §5.5 / §5.6，坑 `ENGINE_PIPELINE_GUIDE` §4 坑 63。
 *
 * ## 这条判据守的是什么
 *
 * 修完「模块沉默 ⇒ `[表]` 免费接管」（坑 62）之后，`yixuan-roxy-lucia` parry=16 仍是
 * **C0 24.93M / C4 24.66M（−1.09%）**。交接文档把它归因为「外层不动点 2-环 ⇒ `pickOuterCycleMember`
 * 交付了坏成员」，但逐轮实测（`PROBE_TRACE_OUTER`）否定了这个归因：交付走的是 **kStar 结算**，
 * 不是环内选点。
 *
 * 真因在 `solveTeam.ts` 的**搜索上界**：
 *
 * ```ts
 * const necUsed = out.resourceResult.characters.reduce((s, c) => s + c.timeAllocation.necessaryTime, 0)
 * const searchMax = min(floor(eff/W), budgetHasRoom ? ceil((eff − necUsed)/W) : floor(eff/W))
 * ```
 *
 * `necUsed` 取的是**环内选点那一个成员**的必要时间，而它假设「nec 与 K 无关 ⇒ 窗口余地 = (eff−nec)/W」。
 * 实测该假设为假（`nec(K)` 随 K 变化且**非单调**）：
 *
 * | K | 1 | 2 | 3 | 4 | 5 |
 * |---|---|---|---|---|---|
 * | `nec(K)` | 176.0 | 181.8 | 179.9 | 178.1 | 177.6 |
 *
 * W=21、eff=180 ⇒ `ceil((180−176)/21) = 1` ⇒ `searchMax = 1`，而环里**本来就有**
 * `kIn=2 / cont=3.021`（自洽）、`net=180.0`（装得下）的成员 ⇒ kStar 被钉到 1 ⇒ 交付 24.66M。
 *
 * **命座不是负提升，是上界算错了对象。**
 *
 * ## 修法
 *
 * 上界只回答「物理上排得下几个窗」= `floor(eff/W)`；「装不装得下」是**逐候选实测**的事
 * （`net ≤ eff + AXIS_FALLBACK_TOLERANCE_SEC`，与 `stageResolveFeasibility` 的 `overBudgetNet` 同一把尺）。
 * 两条一起进成员扫描**与二分回落**（两处必须同口径，否则回落会绕过筛选）。
 *
 * ## 判据设计（**反空洞**：不能只断「C4 ≥ C0」，那在改动前也可能因别的路径偶然成立）
 *
 * ① 该格必须**真的走了 kStar 结算**（`capacityResolved` 为真）——否则本判据测的不是它声称的路径。
 *    负控实测：旧上界下 `outerExit` 同样是 `stable`（断言 ① 的旧写法恒绿），故必须读专用读数。
 * ② C4 ≥ C0 且池窗 ≥ 2 —— 命座不得造成窗口数下降（与坑 62 判据 ⑤ 同一条）。
 * ③ **锁 K 对照**：把窗口钉到 kStar 选中的那个 K 重算，伤害必须 **≥ 自由收敛的 C4**
 *    （证明「自由收敛选到的 K」不劣于「人手钉的 K」，即结算没有交付坏成员）。
 * ④ **多队多档反空洞**（本文件最后一个 describe）：16 格里的负提升必须为零，
 *    且窗口数不得因命座下降 —— 只守单格等于只守住碰巧被抓到的那一支。
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { withAnalysisScenario } from '@/composables/analysisScenario'
import { applyTeamToStore } from '@/composables/teamCompare'
import { clearDifficultyLevers } from '@/composables/difficultyLadder'
import { teamPresets } from '@/data/teamPresets'

const PRESET = 'yixuan-roxy-lucia'
const PARRY = 16
/** 用户 2026-11-06 点名的那一格（`docs/mcp-cinema-interval-uplift.md` §5.7 的判据①⑤） */
const AUTO1591 = 'auto-1591-1481-1211'
const PARRY_1591 = 16

interface Frame {
  dmg: number
  pool: number
  exit: string | null
  cap: boolean | null
  converged: boolean | null
}

/** 采一帧：C0/C4 × 自由/锁 K，同一建队路径（与页面「命座提升率」同口径）。 */
async function frame(cinema: number, lock = -1, presetId = PRESET, parry = PARRY): Promise<Frame> {
  const preset = teamPresets.find(p => p.id === presetId)!
  let out: Frame | null = null
  await withAnalysisScenario(async s => {
    clearDifficultyLevers({ config: s.config, calc: s.calc })
    applyTeamToStore(s.config, preset)
    s.config.setCinemaLevel(0, cinema)
    s.config.syncTeammateBuffsFromTeam()
    for (let sl = 0; sl < 3; sl++) s.config.setActionCount(sl, 'parryCount', sl === 0 ? parry : 0)
    if (lock >= 0) s.config.enemy.stunCountLock = lock
    const dmg = s.calc.teamTotalDamage.value
    const pool = (s.calc.stunPoolResult.value as unknown as { stunCount?: number } | null)?.stunCount ?? 0
    const conv = (s.calc.resourceResult.value as unknown as {
      convergence?: { outerExit?: string; capacityResolved?: boolean; outerConverged?: boolean }
    } | null)?.convergence
    out = {
      dmg,
      pool,
      exit: conv?.outerExit ?? null,
      cap: conv?.capacityResolved ?? null,
      converged: conv?.outerConverged ?? null,
    }
  })
  return out!
}

describe(`kStar 结算（${PRESET} parry=${PARRY}）`, () => {
  beforeAll(async () => {
    await setupHarness(['', '', ''], { productionBasicWeights: true })
  })

  it('① 该格确实走 kStar 结算路径（否则本判据测不到它声称的路径）', async () => {
    const c4 = await frame(4)
    // ⚠ 断言的是 `capacityResolved`，**不是** `outerExit === 'stable'`：后者在旧上界下同样成立
    //（结算成功与普通收敛都报 stable）⇒ 用它当判据等于没判。
    // 本用例是**路径前置条件**（不是回归判据）：负控实测旧上界下它同样绿——因为旧上界的病灶是
    // "走结算通道却选错 K"，不是"不走结算通道"。它的价值是：若将来 C4 不再走这条通道（例如
    // 结算被别处替换），②③ 就会在测另一条路径，本断言会先红把这件事点出来。
    expect(c4.cap, 'C4 必须报告走过 kStar 结算（capacityResolved）；否则本用例测的是别的路径').toBe(true)
    // C0 是正常 stable 收敛，不走结算通道 ⇒ 同一读数必须为假（否则该读数没有判别力）。
    const c0 = await frame(0)
    expect(c0.cap, 'C0 不该走 kStar 结算（它本来就 stable 收敛）').toBeFalsy()
  })

  it('② 命座不得造成窗口数下降：C4 池窗 ≥ 2（修前 1），且 C4 ≥ C0', async () => {
    const c0 = await frame(0)
    const c4 = await frame(4)
    expect(c0.pool, `C0 应有 3 窗（实测基线），实际 ${c0.pool}`).toBeGreaterThanOrEqual(3)
    /**
     * ⚠ 判据不是「C4 池窗 ≥ C0 池窗」：C4 的窗口更宽（21s vs 18s）、时间账更紧，
     * 池窗 2 是**合法**的物理结果（锁 2 窗实测 28.86M，自洽 cont=3.20）。修前的病灶是池窗被压到 **1**
     * （因为上界把候选 K 砍成 1），故判据取「≥ 2」这条**修前不成立、修后成立**的线。
     * 反空洞：锁 1 窗实测 24.66M < C0 的 24.93M ⇒ 池窗 1 确实对应负提升，这条线不是装饰。
     */
    expect(c4.pool, `C4 池窗不得低于 2（修前被上界压到 1）：C0=${c0.pool} / C4=${c4.pool}`)
      .toBeGreaterThanOrEqual(2)
    // 修前：24.66 vs 24.93（−1.09%）。修后：28.86 vs 24.93（+15.8%）。
    expect(c4.dmg, `C4 伤害必须 ≥ C0（修前 −1.09%）：C0=${(c0.dmg / 1e6).toFixed(2)}M / C4=${(c4.dmg / 1e6).toFixed(2)}M`)
      .toBeGreaterThanOrEqual(c0.dmg)
  })

  it('③ 自由收敛选到的 K 不劣于人手钉的同一 K（结算没交付坏成员）', async () => {
    const free = await frame(4)
    // 修后 kStar = 2（环里自洽且装得下的最大 K）。钉 2 窗重算应与自由收敛**同源**，
    // 不得出现「自由收敛反而比钉 K 差」——那正是坑 62 时代 §5.5 的形态。
    const pinned = await frame(4, 2)
    expect(
      free.dmg,
      `自由收敛不得劣于钉 2 窗：自由=${(free.dmg / 1e6).toFixed(2)}M / 钉2=${(pinned.dmg / 1e6).toFixed(2)}M`,
    ).toBeGreaterThanOrEqual(pinned.dmg)
  })
})

/**
 * ⑤ **`auto-1591-1481-1211` p16 的 C0→C1 修复（用户 2026-11-06 完整标准）**。
 *
 * 病灶形态（`PROBE_TRACE_OUTER` 与逐 K 钉窗实测）：C0 与 C1 的**可行 K 集不同**
 * ——C0 有 K0..K3（K4+ 净占用 193s 装不下），C1 只有 K0/K1（K2+ 净占用 191s 装不下），
 * 而 C1 的**自由收敛停点**在 K3（净占用 179.54s，plan ≠ pin）。
 * ⇒ 拿「各自可行集里的最大 K」当交付点，C0 落 K3（32.94M）、C1 落 K1（26.66M）= **−19.06%**，
 * 这就是用户说的「命座说提升了，计算器算出来是负的」。
 *
 * 修法（`cinemaUpliftFrontier#pickDelivery`）= 候选集 **∪ 收敛停点**、取伤害 argmax
 * ⇒ C1 交付它的收敛停点 K3（37.01M）= **+12.34%**。
 *
 * 本用例钉的是**用户可观测的两个数**，不是内部实现：
 * ① 交付口径的 C0→C1 为正（+12.34%）；
 * ② 固定 K 下 C0→C1 在 K=0..5 上全不为负（逐 K 真求值）。
 *
 * 逐 K 表的完整判据（含 max-K 负控 −19.06%）在 `cinemaUpliftFrontier.test.ts`——本文件只钉
 * 「这一格不能被交付点漂移弄成负数」这个用户可见结论，避免两个文件各扫一遍全库。
 */
describe(`${AUTO1591} p${PARRY_1591}：C0→C1 交付口径为正 + 固定 K 全非负`, () => {
  beforeAll(async () => {
    await setupHarness(['', '', ''], { productionBasicWeights: true })
  })

  it('交付口径 C0→C1 = +12.34%（修前 max-K 口径 −19.06%）', async () => {
    const c0 = await frame(0, -1, AUTO1591, PARRY_1591)
    const c1 = await frame(1, -1, AUTO1591, PARRY_1591)
    const pct = ((c1.dmg - c0.dmg) / c0.dmg) * 100
    expect(pct, `C0→C1 交付口径必须为正（修前 −19.06%）：${(c0.dmg / 1e6).toFixed(2)}M → ${(c1.dmg / 1e6).toFixed(2)}M`)
      .toBeGreaterThan(0)
    // 反空洞：这一格的**指纹**（收敛停点 K3/K3、C1 更高）必须与文档 §5.7 的实测一致；
    // 若哪天引擎把 C1 交付到别处，本条先红，提示负控 witness 需要重新标定
    expect(c0.pool, `C0 收敛停点池窗应为 K3（实测），实际 ${c0.pool}`).toBe(3)
    expect(c1.pool, `C1 收敛停点池窗应为 K3（plan≠pin 形态），实际 ${c1.pool}`).toBe(3)
  })

  it('固定 K 下 C0→C1 在 K=0..5 上全不为负（逐 K 真求值）', async () => {
    const rows: string[] = []
    const negative: string[] = []
    for (const k of [0, 1, 2, 3, 4, 5]) {
      const c0 = await frame(0, k, AUTO1591, PARRY_1591)
      const c1 = await frame(1, k, AUTO1591, PARRY_1591)
      const pct = c0.dmg > 0 ? ((c1.dmg - c0.dmg) / c0.dmg) * 100 : 0
      rows.push(`K${k}: ${(c0.dmg / 1e6).toFixed(2)}M → ${(c1.dmg / 1e6).toFixed(2)}M（${pct.toFixed(2)}%）`)
      if (pct < 0) negative.push(rows[rows.length - 1])
    }
    expect(negative, `固定 K 下出现 C0→C1 负提升：\n${negative.join('\n')}`).toHaveLength(0)
  }, 240_000)
})

/**
 * ④ **多队多档反空洞**：用户 2026-11-04 口径「命座只是提供更多选择，不是强制降低」。
 * 单格判据只守住碰巧被抓到的那一支；这条扫本专项的四支环队 × 四档难度。
 */
const GRID: Array<{ id: string; parry: number[] }> = [
  { id: 'yixuan-jufufu-lucia', parry: [0, 8, 16, 20] },
  { id: 'yixuan-trigger-lucia', parry: [0, 8, 16, 20] },
  { id: 'yixuan-roxy-lucia', parry: [0, 8, 16, 20] },
  { id: 'auto-1371-1481-1451', parry: [0, 8, 16, 20] },
]

describe('命座正提升 × 多队多档（用户 2026-11-04 口径）', () => {
  beforeAll(async () => {
    await setupHarness(['', '', ''], { productionBasicWeights: true })
  })

  it('16 格里 C4 ≥ C0 全成立，且池窗不得因命座下降', async () => {
    const fail: string[] = []
    for (const team of GRID) {
      for (const parry of team.parry) {
        const c0 = await frame(0, -1, team.id, parry)
        const c4 = await frame(4, -1, team.id, parry)
        const pct = ((c4.dmg - c0.dmg) / c0.dmg) * 100
        const tag = `${team.id} p=${parry}`
        if (c4.dmg < c0.dmg) fail.push(`${tag}: C0=${(c0.dmg / 1e6).toFixed(2)}M → C4=${(c4.dmg / 1e6).toFixed(2)}M（${pct.toFixed(2)}%）`)
        // 窗口数判据与坑 62 判据 ⑤ **同一条线**（`axisTableSubsidy.test.ts` 现取 `c4 ≥ c0 − 1`）：
        // 容差 1 窗的物理依据 = 窗口时长本身按命座变（`_roxyWindEyeTiming` 实测 C0 18s / C4 21s，
        // 更宽的窗 × 更紧的时间账 ⇒ 少一个窗是**合法**结果；本格钉 3 窗实测 31.92M 高于自由收敛）。
        if (c4.pool < c0.pool - 1) fail.push(`${tag}: 池窗 ${c0.pool} → ${c4.pool}（命座造成窗口数下降超过 1 窗）`)
      }
    }
    expect(fail, `命座负提升 / 窗口数下降：\n${fail.join('\n')}`).toHaveLength(0)
  }, 900_000)
})
