/**
 * 命座提升率网格（`cinemaUpliftGrid.ts`）判据 —— 用户 2026-10-20 裁决：
 * 「命座提升率在不同环境下提升不同，在图表类单独给一个，2 维属性分别是 boss 选择不同、环境 buff 选择不同」。
 *
 * 锁三件事：
 * ① **锁值只由该格 C0 基线给出**（`baseStunCount`），不是「当前配置的池」——
 *    后者会让全01 与全65 锁在不同窗数上，提升率差值全部来自锁值而不是命座（实测同队 71.0% vs 68.8%）。
 * ② **逐级提升率 → 累计提升率是复利式拼接**（`Π(1+gᵢ) − 1`），不是把百分比相加。
 * ③ **网格形状与中止语义**：行/列标签按实际产物给；中止时保留已算格、不假装算完。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { withAnalysisScenario } from '@/composables/analysisScenario'
import {
  computeCinemaUpliftGrid, cumulativeUpliftPct, dedupeGridRows, lockSweepOf,
  type GridColSpec, type GridRowSpec, type CinemaUpliftGridCell,
} from '@/composables/cinemaUpliftGrid'
import { applyBossRoom } from '@/composables/bossRoom'
import { applyBuffToStore, applyTeamToStore } from '@/composables/teamCompare'
import { teamPresets } from '@/data/teamPresets'
import type { CinemaUpliftEntry } from '@/composables/cinemaUplift'
import type { BossPreset, BossPresetPhase, PhaseBuffCard, PhaseView } from '@/types/bossPreset'

/** 合成一条提升率记录（只填累计用得上的字段） */
function entry(to: number, gainPct: number): CinemaUpliftEntry {
  return {
    to, gainPct, ultBefore: 0, ultAfter: 0, changedFields: [], warn: 'ok', metrics: [],
    breakdown: { resourcePct: 0, execPct: 0, attrPct: 0, tier: 'NONE', coupled: false, newRowCount: 0, attrFieldsViaResource: [] },
  }
}

describe('cumulativeUpliftPct（复利式拼接）', () => {
  it('逐级 +10% ×2 ⇒ 累计 +21%，不是 +20%', () => {
    expect(cumulativeUpliftPct([entry(1, 10), entry(2, 10)])).toBeCloseTo(21, 9)
  })
  it('含负增长：+20% 后 −10% ⇒ +8%，不是 +10%', () => {
    expect(cumulativeUpliftPct([entry(1, 20), entry(2, -10)])).toBeCloseTo(8, 9)
  })
  it('空列表 ⇒ 0（不能返回 NaN 或 -100）', () => {
    expect(cumulativeUpliftPct([])).toBe(0)
  })
})

describe('dedupeGridRows', () => {
  it('同 Boss 同期只留一条（网格行 = 某 Boss 某期，重复会把行标签画重）', () => {
    const boss = { id: 'b1' } as BossPreset
    const ph = { phaseId: 'p1' } as BossPresetPhase
    expect(dedupeGridRows([{ boss, phase: ph }, { boss, phase: ph }])).toHaveLength(1)
  })
})

describe('computeCinemaUpliftGrid（真管线）', () => {
  /** 取两个有期数的 Boss + 一期的 buff 牌（数据缺失时跳过整例而不是假绿） */
  async function fixtures() {
    const { catalog } = await setupHarness(['', '', ''])
    await catalog.loadBuildRecommendations()
    const file = await catalog.loadBossPresets()
    const bosses = (file.bosses ?? []).filter(b => (b.phases ?? []).length > 0)
    expect(bosses.length, 'boss-presets.json 里没有任何带期数的 Boss（数据管道坏了？）').toBeGreaterThan(0)
    const rows = bosses.slice(0, 2).map(b => ({ boss: b, phase: b.phases[b.phases.length - 1]! }))
    const pv = (file.phaseViews ?? []).find(v => v.phaseId === rows[0]!.phase.phaseId)
    const card: PhaseBuffCard | null = (pv?.buffs ?? []).find(b => !b.testOnly) ?? null
    const cols: GridColSpec[] = [{ id: 'none', label: '不吃', card: null }]
    if (card) cols.push({ id: card.title, label: card.title, card })
    return { rows, cols }
  }

  it('每格锁值 = 该格 C0 基线；锁口径与不锁口径分开给；标签按实际产物', async () => {
    const { rows, cols } = await fixtures()
    const preset = teamPresets.find(p => p.id === 'banyue-liuyin-lucia')
      ?? teamPresets.find(p => Array.isArray(p.team) && p.team.length === 3)!
    const res = await withAnalysisScenario(s => computeCinemaUpliftGrid(s, {
      presets: [preset], rows, cols, slots: [0], maxLevel: 2, includeFree: true,
    }))
    expect(res.cells.length, '格数应 = 行 × 列').toBe(rows.length * cols.length)
    expect(res.rowLabels.length).toBe(rows.length)
    expect(res.colLabels.length).toBe(cols.length)
    for (const c of res.cells as CinemaUpliftGridCell[]) {
      // ① 锁值来自 C0 基线（0 = 该格 C0 打不出失衡，属合法，但必须**非负整数**）
      expect(Number.isInteger(c.baseStunCount), `${c.id} 的锁值应是整数`).toBe(true)
      expect(c.baseStunCount).toBeGreaterThanOrEqual(0)
      // ② 两个口径分开存，累计复利
      expect(c.lockedTotalPct).toBeCloseTo(cumulativeUpliftPct(c.lockedEntries), 9)
      expect(c.freeEntries, 'includeFree=true 时必须有 free 口径').not.toBeNull()
      expect(c.freeTotalPct).toBeCloseTo(cumulativeUpliftPct(c.freeEntries!), 9)
      // ③ 失衡通道 = 不锁 − 锁（可以是负的，如实上报）
      expect(c.stunChannelDeltaPct).toBeCloseTo(c.freeTotalPct! - c.lockedTotalPct, 9)
      // 逐级条目数 = maxLevel
      expect(c.lockedEntries.length).toBe(2)
    }
  }, 600_000)

  /**
   * **锁值必须是行的属性，不是格的属性**（2026-10-20，用户报「提升有时候会跳变」）。
   *
   * 病灶：原实现每格各取自己的 C0 基线当锁值 ⇒ 同一行内不同 buff 列的锁值不同
   * （实测「异构·基塔布鲁」：不吃 4 窗、破御/锋刃 5 窗），C1 的基线本身就不一样
   * ⇒ C0→C1 增益 7.04% vs 11.83%，看起来像算错，其实是两个不同场景。
   *
   * 判据：`lockMode: 'row'` 下，**同一行所有列**的 `baseStunCount` 必须逐位相同；
   * `lockMode: 'grid'` 下，**整张表所有格**必须相同。
   */
  /**
   * **锁值必须是行的属性，不是格的属性**（2026-10-20，用户报「提升有时候会跳变」）。
   *
   * 病灶：原实现每格各取自己的 C0 基线当锁值 ⇒ 同一行内不同 buff 列的锁值不同
   * （实测「熔狱行赭」：不吃 3 窗、破御/锋刃 4 窗），C1 的基线本身就不一样
   * ⇒ 逐级增益看起来像跳变，其实是两个不同场景。
   *
   * ⚠ **反空洞的关键**：必须用**真的会改失衡次数**的 buff 牌（`stunBuildUpBonus` 类），
   * 否则「同行锁值相同」这个断言在**每格各取基线**的实现下也照样绿（本条第一版就踩了这个坑，
   * 反向对照没变红 ⇒ 判据测不出病灶）。故本用例自己挑牌并断言「牌确实改变了 N」。
   */
  it('锁值口径：row ⇒ 同行所有列锁值相同；grid ⇒ 整表相同（用真能改失衡次数的牌反证）', async () => {
    const { catalog } = await setupHarness(['', '', ''])
    await catalog.loadBuildRecommendations()
    const file = await catalog.loadBossPresets()
    const bosses = (file.bosses ?? []) as BossPreset[]
    const views = (file.phaseViews ?? []) as PhaseView[]
    /**
     * 找一张**真的会改变失衡次数**的牌。
     *
     * ⚠ 不能只看「牌上写了 stunBuildUpBonus」就假定它改 N——实测踩过：同样的
     * `破御` 在「熔狱行赭@690471」把 N 从 3 抬到 4，但换了队伍/配装就恒不动。
     * 所以这里**直接问引擎**（同一 (Boss, 牌) 组合比自由失衡次数），选中才算样本。
     */
    const preset = teamPresets.find(p => Array.isArray(p.team) && p.team.length === 3)!
    let picked: { boss: BossPreset; phase: BossPresetPhase; stunCard: PhaseBuffCard; plainCard: PhaseBuffCard | null } | null = null
    for (const v of views) {
      const usable = (v.buffs ?? []).filter(b => !b.testOnly)
      const boss = bosses.find(b => b.phases.some(p => p.phaseId === v.phaseId))
      if (!boss) continue
      const phase = boss.phases.find(p => p.phaseId === v.phaseId)!
      /** 该期哪张牌真的改了 N（逐张问引擎，最多试 3 张，够用且不拖慢） */
      for (const card of usable.slice(0, 3)) {
        const changed = await withAnalysisScenario(async s => {
          applyTeamToStore(s.config, preset)
          applyBossRoom(s.config, boss, phase)
          applyBuffToStore(s.config, null)
          const n0 = s.calc.stunPoolResult.value?.stunCount ?? -1
          applyTeamToStore(s.config, preset)
          applyBossRoom(s.config, boss, phase)
          applyBuffToStore(s.config, card)
          const n1 = s.calc.stunPoolResult.value?.stunCount ?? -1
          return n0 !== n1
        })
        if (changed) {
          const plainCard = usable.find(c => c !== card) ?? null
          picked = { boss, phase, stunCard: card, plainCard }
          break
        }
      }
      if (picked) break
    }
    expect(picked, '全库找不到「会让自由失衡次数变化」的正式牌 ⇒ 本判据无样本（数据管道变了？）').not.toBeNull()
    const { boss, phase, stunCard, plainCard } = picked!

    const rows: GridRowSpec[] = [{ boss, phase }]
    const cols: GridColSpec[] = [
      { id: 'none', label: '不吃', card: null },
      { id: stunCard.title, label: stunCard.title, card: stunCard },
    ]
    if (plainCard) cols.push({ id: plainCard.title, label: plainCard.title, card: plainCard })

    const res = await withAnalysisScenario(s => computeCinemaUpliftGrid(s, {
      presets: [preset], rows, cols, slots: [0], maxLevel: 1, lockMode: 'row',
    }))

    // ① 反空洞：这张牌**真的**改变了该格自己的自由失衡次数（否则下面的断言无从测出病灶）
    const noneCell = res.cells.find(c => c.colId === 'none')!
    const stunCell = res.cells.find(c => c.colId === stunCard.title)!
    expect(stunCell.ownFreeStunCount, `${stunCard.title} 没改变自由失衡次数（ownFree ${stunCell.ownFreeStunCount} vs ${noneCell.ownFreeStunCount}）⇒ 本条测不出「锁值该按行」的病灶，换牌`)
      .not.toBe(noneCell.ownFreeStunCount)

    // ② 正题：同一行内所有列的**锁值**必须逐位相同（每格各取基线的实现会在这里红）
    const locks = res.cells.map(c => c.baseStunCount)
    expect(new Set(locks).size, `同行不同列的锁值不一致：${res.cells.map(c => `${c.colLabel}=${c.baseStunCount}`).join(' / ')}`).toBe(1)
    // 锁值取的是「不吃」列的基线（约定 cols[0]）
    expect(res.cells[0]!.baseStunCount).toBe(noneCell.ownFreeStunCount)

    // ③ grid 模式：整表同一把尺子
    const gridRes = await withAnalysisScenario(s => computeCinemaUpliftGrid(s, {
      presets: [preset], rows, cols, slots: [0], maxLevel: 1, lockMode: 'grid',
    }))
    expect(new Set(gridRes.cells.map(c => c.baseStunCount)).size).toBe(1)

    // ④ 用户指定数字生效（0 = 不锁）
    const zeroRes = await withAnalysisScenario(s => computeCinemaUpliftGrid(s, {
      presets: [preset], rows, cols: cols.slice(0, 1), slots: [0], maxLevel: 1, lockMode: 0,
    }))
    expect(zeroRes.cells[0]!.baseStunCount).toBe(0)
  }, 900_000)

  it('includeFree 缺省关闭：free 三件套都是 null（成本翻倍不该是默认）', async () => {
    const { rows, cols } = await fixtures()
    const preset = teamPresets.find(p => Array.isArray(p.team) && p.team.length === 3)!
    const res = await withAnalysisScenario(s => computeCinemaUpliftGrid(s, {
      presets: [preset], rows: rows.slice(0, 1), cols: cols.slice(0, 1), slots: [0], maxLevel: 1,
    }))
    const c = res.cells[0]!
    expect(c.freeEntries).toBeNull()
    expect(c.freeTotalPct).toBeNull()
    expect(c.stunChannelDeltaPct).toBeNull()
    expect(c.freeStunCounts).toBeNull()
  }, 600_000)

  it('中止：已算格照常返回，不抛错、不假装算完（行/列标签只含已算到的）', async () => {
    const { rows, cols } = await fixtures()
    const preset = teamPresets.find(p => Array.isArray(p.team) && p.team.length === 3)!
    const ac = new AbortController()
    ac.abort()
    const res = await withAnalysisScenario(s => computeCinemaUpliftGrid(s, {
      presets: [preset], rows, cols, slots: [0], maxLevel: 1, control: { signal: ac.signal },
    }))
    expect(res.cells).toHaveLength(0)
    expect(res.rowLabels).toHaveLength(0)
    expect(res.colLabels).toHaveLength(0)
  }, 300_000)
})

// ═══════════════════════════════════════════════════════════════════════════════
// 多锁值采样（用户 2026-10-28「精密计算可能需要在不同条件下多算几个然后全都展示了」
//                          「这个台阶我认了…然后多次偶然全部展示」）
// ═══════════════════════════════════════════════════════════════════════════════

describe('lockSweepOf（采样清单）', () => {
  it("'spread' = 基准 ±邻域，负数截 0、去重、升序", () => {
    expect(lockSweepOf(3, 'spread')).toEqual([2, 3, 4, 5])
    // 基准 0：base−1 截到 0 后与 base 重复 ⇒ 去重
    expect(lockSweepOf(0, 'spread')).toEqual([0, 1, 2])
    expect(lockSweepOf(1, 'spread')).toEqual([0, 1, 2, 3])
  })

  it('显式数组同样归一（取整、截 0、去重、升序）；缺省 undefined ⇒ 空清单', () => {
    expect(lockSweepOf(3, [5, 3.7, 3, -2, 5])).toEqual([0, 3, 5])
    expect(lockSweepOf(3, undefined)).toEqual([])
    expect(lockSweepOf(Number.NaN, 'spread')).toEqual([0, 1, 2])
  })
})

describe('computeCinemaUpliftGrid · 多锁值采样', () => {
  it('缺省不采样：samples 为空、spread 为 null（零成本承诺，既有调用方逐位不变）', async () => {
    const preset = teamPresets.find(p => Array.isArray(p.team) && p.team.length === 3)!
    const { catalog } = await setupHarness(['', '', ''])
    await catalog.loadBuildRecommendations()
    const file = await catalog.loadBossPresets()
    const boss = (file.bosses ?? []).find((b: BossPreset) => (b.phases ?? []).length > 0)!
    const rows: GridRowSpec[] = [{ boss, phase: boss.phases[boss.phases.length - 1]! }]
    const cols: GridColSpec[] = [{ id: 'none', label: '不吃', card: null }]
    const res = await withAnalysisScenario(s => computeCinemaUpliftGrid(s, {
      presets: [preset], rows, cols, slots: [0], maxLevel: 1,
    }))
    expect(res.cells[0]!.samples).toEqual([])
    expect(res.cells[0]!.sampleSpreadPct).toBeNull()
  }, 600_000)

  it('lockSweep="spread"：样本含基准锁值、按锁值升序、每个样本自洽且有跨度读数', async () => {
    const preset = teamPresets.find(p => Array.isArray(p.team) && p.team.length === 3)!
    const { catalog } = await setupHarness(['', '', ''])
    await catalog.loadBuildRecommendations()
    const file = await catalog.loadBossPresets()
    const boss = (file.bosses ?? []).find((b: BossPreset) => (b.phases ?? []).length > 0)!
    const rows: GridRowSpec[] = [{ boss, phase: boss.phases[boss.phases.length - 1]! }]
    const cols: GridColSpec[] = [{ id: 'none', label: '不吃', card: null }]
    const res = await withAnalysisScenario(s => computeCinemaUpliftGrid(s, {
      presets: [preset], rows, cols, slots: [0], maxLevel: 1, lockSweep: 'spread',
    }))
    const cell = res.cells[0]!
    const expected = lockSweepOf(cell.baseStunCount, 'spread')
    expect(cell.samples.map(x => x.lock), '样本锁值 = 基准 ±邻域').toEqual(expected)
    expect(cell.samples.some(x => x.lock === cell.baseStunCount), '必须含基准锁值那一档').toBe(true)
    for (const sample of cell.samples) {
      expect(sample.entries).toHaveLength(1)
      expect(sample.totalPct, `锁${sample.lock} 的累计应等于复利拼接`).toBeCloseTo(cumulativeUpliftPct(sample.entries), 9)
    }
    // 基准档必须与 lockedEntries 逐位同源（不是重算出来的另一份）
    const baseSample = cell.samples.find(x => x.lock === cell.baseStunCount)!
    expect(baseSample.entries).toEqual(cell.lockedEntries)
    expect(baseSample.totalPct).toBeCloseTo(cell.lockedTotalPct, 9)
    // 跨度 = max − min
    const totals = cell.samples.map(x => x.totalPct)
    expect(cell.sampleSpreadPct!.min).toBeCloseTo(Math.min(...totals), 9)
    expect(cell.sampleSpreadPct!.max).toBeCloseTo(Math.max(...totals), 9)
    expect(cell.sampleSpreadPct!.spread).toBeCloseTo(Math.max(...totals) - Math.min(...totals), 9)
  }, 900_000)
})
