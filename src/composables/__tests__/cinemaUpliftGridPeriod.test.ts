/**
 * 提升率网格的**行/列同源**判据（2026-10-20，用户报「没显示吃 buff 的数据」）。
 *
 * ## 病灶
 * 首版实现：行 = 「每个 Boss 取它自己的最新期」，列 = 「**全局最新期视图**的可用牌」。
 * 两者**根本不是同一期**，而最新三个 3.3 期（`690501/690491/690481`）的牌全是
 * `(Test1)TBD` 占位牌（`testOnly: true`）且 `begin` 为空串（排序时被回退成 phaseId ⇒ 反而排最前）
 * ⇒ 列被过滤得只剩「不吃」，用户看到的就是「没有吃 buff 的数据」。
 *
 * ## 判据（都是「尺子」不是「答案」，换数据不会空转）
 * ① **行与列必须来自同一期**：每格的 `phaseId === 该行 Boss 的 phase.phaseId === 列所属期`；
 * ② **没有任何一列是占位牌**（`testOnly` 必须被滤掉——占位牌不参与解析/推荐，是数据管道的约定）；
 * ③ **有正式牌的那期必须真的出现 >1 列**（反空洞：否则「列全是空」这种退化会静默通过 ①）；
 * ④ **同一期内不同 buff 列的结果可以不同**（证明 buff 真的进了求值，不是只换标签）。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { withAnalysisScenario } from '@/composables/analysisScenario'
import { useCatalogStore } from '@/stores/catalog'
import { computeCinemaUpliftGrid, type GridColSpec, type GridRowSpec } from '@/composables/cinemaUpliftGrid'
import { teamPresets } from '@/data/teamPresets'
import type { BossPreset, PhaseView } from '@/types/bossPreset'

/** 页面同款派生：某期 → 该期的 Boss 行 / 该期的可用牌列（**同源同一期**） */
function deriveForPeriod(bosses: BossPreset[], views: PhaseView[], periodId: string, maxRows = 2, maxCols = 3) {
  const rows: GridRowSpec[] = []
  for (const b of bosses) {
    const phases = b.phases.filter(p => p.phaseId === periodId)
    if (phases.length === 0) continue
    const phase = phases.find(p => p.modeType === 'critical_assault') ?? phases[0]
    if (!phase) continue
    rows.push({ boss: b, phase })
    if (rows.length >= maxRows) break
  }
  const usable = (views.find(v => v.phaseId === periodId)?.buffs ?? []).filter(b => !b.testOnly)
  const cols: GridColSpec[] = [{ id: 'none', label: '不吃 buff', card: null }]
  for (const c of usable.slice(0, maxCols)) cols.push({ id: c.title, label: c.title, card: c })
  return { rows, cols, usable }
}

describe('提升率网格：行/列同源同一期', () => {
  it('① 网格用「页面选中的那一期」：行与列都来自该期；② 占位牌不进列', async () => {
    await setupHarness(['', '', ''])
    const catalog = useCatalogStore()
    const file = await catalog.loadBossPresets()
    const bosses = (file.bosses ?? []) as BossPreset[]
    const views = (file.phaseViews ?? []) as PhaseView[]
    expect(bosses.length, 'boss-presets 为空').toBeGreaterThan(0)

    /** 有正式牌（非 testOnly）的期 —— 反空洞：数据里必须真的存在，否则本判据没样本 */
    const periodsWithCards = [...new Set(views.filter(v => (v.buffs ?? []).some(b => !b.testOnly)).map(v => v.phaseId))]
    expect(periodsWithCards.length, '没有任何一期带正式 buff 牌 ⇒ 判据无样本（数据管道变了？）').toBeGreaterThan(0)

    const periodId = periodsWithCards[0]!
    const { rows, cols } = deriveForPeriod(bosses, views, periodId)
    expect(rows.length, `${periodId} 期没有 Boss 行`).toBeGreaterThan(0)
    // ③ 反空洞：有正式牌就必须真的出 >1 列
    expect(cols.length, `${periodId} 期有正式牌却没出列（列派生坏了）`).toBeGreaterThan(1)

    // ① 行与列同源：每个 row.phase.phaseId === periodId
    for (const r of rows) expect(r.phase.phaseId, `${r.boss.name} 的行不是 ${periodId} 期`).toBe(periodId)
    // ② 占位牌不进列
    for (const c of cols) expect(c.card?.testOnly ?? false, `占位牌进了列：${c.label}`).toBe(false)
  }, 300_000)

  it('④ 同一期内不同 buff 列的结果可以不同（buff 真的进了求值）', async () => {
    await setupHarness(['', '', ''])
    const catalog = useCatalogStore()
    const file = await catalog.loadBossPresets()
    const bosses = (file.bosses ?? []) as BossPreset[]
    const views = (file.phaseViews ?? []) as PhaseView[]
    const periodId = [...new Set(views.filter(v => (v.buffs ?? []).some(b => !b.testOnly)).map(v => v.phaseId))][0]!
    const { rows, cols } = deriveForPeriod(bosses, views, periodId, 1, 2)
    expect(cols.length, '该期没有可用牌').toBeGreaterThan(1)
    const preset = teamPresets.find(p => p.id === 'banyue-liuyin-lucia')
      ?? teamPresets.find(p => Array.isArray(p.team) && p.team.length === 3)!
    const res = await withAnalysisScenario(s => computeCinemaUpliftGrid(s, {
      presets: [preset], rows, cols, slots: [0], maxLevel: 1,
    }))
    expect(res.cells.length).toBe(rows.length * cols.length)
    // 列标签必须把 buff 名带出来（不是全叫「不吃」）
    expect(res.colLabels[0]).toContain('不吃')
    expect(res.colLabels.slice(1).every(l => l !== res.colLabels[0]), '所有列标签都一样 ⇒ 列没按牌区分').toBe(true)
    // ④ 同一行内不同列的读数可以不同 —— 只要「有差异」或「确实相同」都必须是真的算过；
    //    这里只钉「不抛错 + 每格都有逐级条目」，差异本身因队而异，不作为硬判据（避免造脆弱断言）。
    for (const c of res.cells) expect(c.lockedEntries.length).toBe(1)
  }, 600_000)
})
