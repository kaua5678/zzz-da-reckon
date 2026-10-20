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
  computeCinemaUpliftGrid, cumulativeUpliftPct, dedupeGridRows,
  type GridColSpec, type CinemaUpliftGridCell,
} from '@/composables/cinemaUpliftGrid'
import { teamPresets } from '@/data/teamPresets'
import type { CinemaUpliftEntry } from '@/composables/cinemaUplift'
import type { BossPreset, BossPresetPhase, PhaseBuffCard } from '@/types/bossPreset'

/** 合成一条提升率记录（只填累计用得上的字段） */
function entry(to: number, gainPct: number): CinemaUpliftEntry {
  return { to, gainPct, ultBefore: 0, ultAfter: 0, changedFields: [], warn: 'ok', metrics: [] }
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
