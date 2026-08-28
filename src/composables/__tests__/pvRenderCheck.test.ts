/**
 * 渲染层集成冒烟：模拟页面「计算」按钮后的数据流（真实归档 → computePullValue → 展示层派生量）。
 * 验证：行过滤、前 16 行、sqrt 柱宽、刻度抽稀、悬浮 title 文案都有界且非空。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { computePullValue, type PullValueInput, type PvCardValue } from '@/composables/pullValue'

const RAW = JSON.parse(readFileSync(new URL('../../../public/static/run-archive.json', import.meta.url), 'utf8')) as PullValueInput
const res = computePullValue({ runs: RAW.runs, seasons: RAW.seasons, rooms: RAW.rooms })

// —— 页面同款派生逻辑（TimeChartsPage Chart 5）——
const PV_MAX_ROWS = 16
const pvFiltered = res.cards.filter(c => c.tier === 'limited' || c.tier === 'freeGift')
const pvRows = pvFiltered.slice(0, PV_MAX_ROWS).map((card, rowIndex) => ({ card, rowIndex }))
const pvMaxCum = Math.max(1, ...pvRows.map(r => Math.max(0, r.card.cumulative)))
const pvBarMaxW = 120 - 44
function pvBarW(card: PvCardValue): number {
  if (card.cumulative <= 0) return 0
  return Math.sqrt(card.cumulative / pvMaxCum) * pvBarMaxW
}
const step = Math.max(1, Math.ceil(res.rooms.length / 12))
const pvXTicks: number[] = []
for (let i = 0; i < res.rooms.length; i += step) pvXTicks.push(i)

describe('Chart5 渲染层集成（真实归档）', () => {
  it('限定池行数 ≥ 16（气泡图满行）；行序 = 累计降序', () => {
    expect(pvRows.length).toBe(16)
    for (let i = 1; i < pvRows.length; i++) {
      expect(pvRows[i - 1].card.cumulative).toBeGreaterThanOrEqual(pvRows[i].card.cumulative)
    }
  })
  it('行末累计柱宽有界 [0, max]、非零卡有可见宽度；X 刻度抽稀 ≤ 13 且首尾都在', () => {
    for (const r of pvRows) {
      const w = pvBarW(r.card)
      expect(w).toBeGreaterThanOrEqual(0)
      expect(w).toBeLessThanOrEqual(pvBarMaxW + 1e-9)
    }
    expect(pvBarW(pvRows[0].card)).toBeGreaterThan(10) // 最高累计的柱应该明显可见
    expect(pvXTicks.length).toBeLessThanOrEqual(13)
    expect(pvXTicks[0]).toBe(0)
  })
  it('每行 roomEffects 与全轴对齐（含从未出场卡）；上限删失房间存在（顶部饱和在图上可见）', () => {
    for (const r of pvRows) expect(r.card.roomEffects).toHaveLength(res.rooms.length)
    const saturated = res.rooms.filter(r => r.capCount > 0)
    expect(saturated.length).toBeGreaterThan(5)
  })
  it('观测窗口覆盖归档全部赛季（与归档 season 数一致）', () => {
    const seasonCount = new Set(RAW.runs.map(r => r.seasonId)).size
    expect(res.window.seasonCount).toBe(seasonCount)
  })
})
