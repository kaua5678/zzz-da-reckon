/**
 * 时间图表页第一片拆分的行为锁（2026-09-13）。
 *
 * 覆盖从 `src/views/TimeChartsPage.vue` 原样搬迁出的三组纯函数：
 *  - `composables/charts/agentPresentation.ts`：调色板散列 / 换人徽标文案 / 实装未进队文案 / 车道文案
 *  - `composables/charts/hoverCardRows.ts`：四张图的「悬浮信息 → HoverCardRow[]」映射
 * 这些函数此前只被页面模板消费、无任何自动化覆盖（页面 UI 只有 ui-check 的 DOM 体检，不校验文案），
 * 搬迁必须先用断言钉住**行序、文案、强调类**，否则日后重构会静默改文案。
 */
import { describe, expect, it } from 'vitest'
import {
  PALETTE,
  benchText,
  bossCellText,
  bossCellTitle,
  colorOf,
  swapKindLabel,
} from '@/composables/charts/agentPresentation'
import {
  chart3HoverRows,
  filmSimHoverRows,
  slotCompareHoverRows,
  timelineHoverRows,
} from '@/composables/charts/hoverCardRows'
import type { PeriodAxisNode } from '@/composables/bossSchedule'
import type { NewAgentBench } from '@/composables/teamTimeline'

describe('agentPresentation：调色板散列', () => {
  it('返回值必在 16 色调色板内', () => {
    for (const id of ['1371', '1481', '1571', '', '9999999']) {
      expect(PALETTE).toContain(colorOf(id))
    }
  })

  it('同 id 稳定、不同 id 尽量分散（散列不是常量）', () => {
    expect(colorOf('1371')).toBe(colorOf('1371'))
    const distinct = new Set(['1021', '1031', '1041', '1051', '1061', '1071', '1081'].map(colorOf))
    expect(distinct.size).toBeGreaterThan(1)
  })
})

describe('agentPresentation：换人徽标文案', () => {
  it('upgrade → 上位；lateral → 平替', () => {
    expect(swapKindLabel('upgrade')).toBe('上位')
    expect(swapKindLabel('lateral')).toBe('平替')
  })

  it('带涨幅时追加百分比；负值不给「+」；0 也不给「+」（pct > 0 才加号）', () => {
    expect(swapKindLabel('upgrade', 12.4)).toBe('上位 +12.4%')
    expect(swapKindLabel('lateral', -3.2)).toBe('平替 -3.2%')
    expect(swapKindLabel('upgrade', 0)).toBe('上位 0%')
  })

  it('pct 缺省时只给档位名（不出现 undefined/NaN）', () => {
    expect(swapKindLabel('lateral', undefined)).toBe('平替')
  })
})

describe('agentPresentation：实装未进队文案（nameOf 由调用方注入）', () => {
  const nameOf = (id: string) => ({ '1581': '蕾米埃尔', '1591': '希格莉德' })[id] ?? id

  it('lateral → 「平替（差 y%，可不抽）」；多名角色用 / 连接', () => {
    const b: NewAgentBench = { agents: ['1581', '1591'], kind: 'lateral', gapPct: 2.5 }
    expect(benchText(b, nameOf)).toBe('蕾米埃尔/希格莉德 实装未进队 · 平替（差 2.5%，可不抽）')
  })

  it('非 lateral → 「未上位（差 y%）」；gapPct 取绝对值', () => {
    const b: NewAgentBench = { agents: ['1581'], kind: 'worse', gapPct: -4.1 }
    expect(benchText(b, nameOf)).toBe('蕾米埃尔 实装未进队 · 未上位（差 4.1%）')
  })
})

describe('agentPresentation：车道文案', () => {
  const node = (normal: string[], critical: string[]): PeriodAxisNode => ({
    id: 'p1', seq: 1, begin: '2026-01-01',
    normalBosses: normal.map(bossName => ({ bossName })),
    criticalBosses: critical.map(bossName => ({ bossName })),
  }) as unknown as PeriodAxisNode

  it('无排期 → 空串（模板侧兜底显示 —）', () => {
    expect(bossCellText(undefined)).toBe('')
  })

  it('单个普通 Boss → 直接给名；多个 → 「X 等n」', () => {
    expect(bossCellText(node(['塔纳托斯'], []))).toBe('塔纳托斯')
    expect(bossCellText(node(['塔纳托斯', '雅'], []))).toBe('塔纳托斯 等2')
  })

  it('只有困难 Boss 时车道文案为空（只列普通）', () => {
    expect(bossCellText(node([], ['雅']))).toBe('')
  })

  it('title：普通/困难都列，分号连接；无排期给统一兜底', () => {
    expect(bossCellTitle(undefined)).toBe('当期无排期数据')
    expect(bossCellTitle(node([], []))).toBe('当期无排期数据')
    expect(bossCellTitle(node(['塔纳托斯'], ['雅']))).toBe('危局·普通：塔纳托斯\n危局·困难：雅')
  })
})

describe('hoverCardRows：悬浮信息 → 行（行序与强调类是契约）', () => {
  it('空/null 信息 → 空数组（四张图同口径）', () => {
    expect(timelineHoverRows(null)).toEqual([])
    expect(chart3HoverRows(null)).toEqual([])
    expect(slotCompareHoverRows(null)).toEqual([])
    expect(filmSimHoverRows(null)).toEqual([])
  })

  it('Chart 1：固定三行 + 可选排期/换人/实装行，强调类 hc-swap / hc-bench', () => {
    const rows = timelineHoverRows({
      nodeLabel: '45', teamNames: ['仪玄', '雅'], damage: 5216367, hpRatio: 96.4,
      goldLabel: '6 金', swap: '换上 雅，换下 苏芙', bench: '蕾米埃尔 实装未进队 · 未上位（差 3.0%）',
      schedule: '危局·普通：塔纳托斯',
    })
    expect(rows.map(r => r.text)).toEqual([
      '队伍：仪玄 + 雅',
      '伤害 521.64万（96.4%）',
      '6 金',
      '危局·普通：塔纳托斯',
      '换上 雅，换下 苏芙',
      '蕾米埃尔 实装未进队 · 未上位（差 3.0%）',
    ])
    expect(rows[4].cls).toBe('hc-swap')
    expect(rows[5].cls).toBe('hc-bench')
  })

  it('Chart 1：无排期/换人/实装时只出固定三行', () => {
    const rows = timelineHoverRows({
      nodeLabel: '1', teamNames: ['仪玄'], damage: 100, hpRatio: 10,
      goldLabel: '0 金', swap: '', bench: '', schedule: '',
    })
    expect(rows).toHaveLength(3)
    expect(rows.every(r => r.cls === undefined)).toBe(true)
  })

  it('Chart 7：diff 正/负/0 分别给 sc-diff-a / sc-diff-b / 无强调', () => {
    const base = { teamANames: ['琉音'], teamBNames: ['诺姆'], damageA: 100, damageB: 90, diffText: 'x' }
    expect(slotCompareHoverRows({ ...base, diff: 5 })[2].cls).toBe('sc-diff-a')
    expect(slotCompareHoverRows({ ...base, diff: -5 })[2].cls).toBe('sc-diff-b')
    expect(slotCompareHoverRows({ ...base, diff: 0 })[2].cls).toBe('')
  })

  it('Chart 4：菲林行含存/本期投/累计三个数', () => {
    const rows = filmSimHoverRows({
      date: '2026-07-08', teamNames: ['仪玄', '雅'], damage: 1000, hpRatio: 50,
      totalGold: 6, goldLabel: '6 金', filmBank: 12000, filmSpent: 3000, filmInvestedTotal: 9000,
    })
    expect(rows[3].text).toBe('菲林：存 12000 · 本期投 3000 · 累计 9000')
  })
})
