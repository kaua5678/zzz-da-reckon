/**
 * **同 K 分布条**（`sameKBand`）的判据——用户 2026-11-07 口径：
 * 「正确的显示不是挑选好看或者不好看的交付点数字展示，而是在整个面板显示完整的提升分布」。
 *
 * 守三件事：
 * ① 分布**逐 K**给出，且「两级都可行」的 K 集合是真实的（不是把不可行点也算进来）；
 * ② 断点如实：高命座攒不出 / 装不下时，`breaksAt` 必须点上那个 K，`afterReject` 给原因；
 * ③ 窗长变化（仪玄 C2 的「失衡持续 +3s」）必须被标出来 —— 那是「少而长的窗」这个副作用的载体。
 *
 * 反空洞：`medianPct` 只由**可行点**算出；若可行点一个都没有必须是 `null`（不是 0）。
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { withAnalysisScenario } from '@/composables/analysisScenario'
import { applyTeamToStore } from '@/composables/teamCompare'
import { teamPresets } from '@/data/teamPresets'
import { sameKBand, scanKFrontier } from '@/composables/cinemaUpliftFrontier'

const FULL_COVER = 'auto-1371-1481-1451'

describe('判据①：分布逐 K 给出，且含窗长变化的断点（仪玄 C1→C2）', () => {
  beforeAll(async () => { await setupHarness(['', '', ''], { productionBasicWeights: true }) })

  it('C1→C2：可行 K 逐点有提升率，K3 起断（窗 18→21s）', async () => {
    const preset = teamPresets.find(p => p.id === FULL_COVER)!
    await withAnalysisScenario(async s => {
      applyTeamToStore(s.config, preset)
      const c1 = await scanKFrontier(s, { cinemaLevel: 1 })
      const c2 = await scanKFrontier(s, { cinemaLevel: 2 })
      expect(c1 && c2, '前沿没扫出来').toBeTruthy()
      const band = sameKBand(c1!, c2!)

      // ② 窗长变化必须被标出（仪玄 C2 = 失衡持续 +3s）
      expect(band.windowChanged, 'C2 的窗长应变长（18s→21s）').toBe(true)
      expect(band.beforeWindow).toBeCloseTo(18, 1)
      expect(band.afterWindow).toBeCloseTo(21, 1)

      // ① 可行集 = 高命座真正站得住的那些 K；C2 攒不出第 3 窗 ⇒ 断在 K3
      expect(band.feasibleKs.length, '两级都可行的 K 太少（反空洞）').toBeGreaterThanOrEqual(2)
      expect(band.breaksAt, 'C2 应在 K3 断掉（cont 2.95 < 3）').toBe(3)

      // 每个可行 K 都有真实提升率，且为正（这一级的同 K 收益是稳定的 +13% 量级）
      const feasiblePts = band.points.filter(p => p.bothFeasible)
      expect(feasiblePts.length).toBe(band.feasibleKs.length)
      for (const p of feasiblePts) {
        expect(p.pct, `K${p.k} 的提升率应为有限数`).not.toBeNull()
        expect(Number.isFinite(p.pct!)).toBe(true)
        expect(p.pct!, `K${p.k} 同 K 提升应为正（实测 +13% 量级）`).toBeGreaterThan(0)
      }
      // ③ 中位数取可行点，量级 +13%（不是交付点那 −0.03%）
      expect(band.medianPct).not.toBeNull()
      expect(band.medianPct!).toBeGreaterThan(10)
      expect(band.medianPct!).toBeLessThan(18)

      // 断点之后的点：`bothFeasible=false` 且带原因（不是静默 NaN）
      const after = band.points.filter(p => p.k > band.breaksAt!)
      expect(after.length).toBeGreaterThan(0)
      for (const p of after) expect(p.bothFeasible, `K${p.k} 断点后不应算可行`).toBe(false)
      expect(band.points.find(p => p.k === band.breaksAt!)!.afterReject, '断点要带原因').toBeTruthy()
    })
  }, 300_000)
})

describe('判据②：反空洞——可行点与不可行点必须能区分', () => {
  beforeAll(async () => { await setupHarness(['', '', ''], { productionBasicWeights: true }) })

  it('把 C1 与 C1 比：提升率恒 0、窗长不变，断点指向该级自己的可行上界 + 1', async () => {
    const preset = teamPresets.find(p => p.id === FULL_COVER)!
    await withAnalysisScenario(async s => {
      applyTeamToStore(s.config, preset)
      const c1 = await scanKFrontier(s, { cinemaLevel: 1 })
      const band = sameKBand(c1!, c1!)
      // 自己比自己：**提升率**恒 0，但断点仍然如实指向「这条前沿自己打不到哪个 K」
      // （`breaksAt` 的语义是「分布从哪里开始不再两级可行」，不是「两级之间的差异」——
      //   自己比自己时它 = 该级自己的可行上界 + 1，所以这里钉的是它与 c1 自己的上界一致）。
      const ownMaxFeasible = Math.max(-1, ...c1!.points.filter(p => p.feasible).map(p => p.k))
      expect(band.breaksAt, '自己比自己的断点应等于该级自己的可行上界 + 1').toBe(ownMaxFeasible + 1)
      expect(band.windowChanged, '自己比自己窗长不变').toBe(false)
      expect(band.medianPct).toBeCloseTo(0, 6)
      for (const p of band.points.filter(x => x.bothFeasible)) expect(p.pct!).toBeCloseTo(0, 6)
      // 反空洞：分布里必须真有可行点，否则上面的「恒 0」是空断言
      expect(band.feasibleKs.length).toBeGreaterThanOrEqual(2)
    })
  }, 300_000)
})
