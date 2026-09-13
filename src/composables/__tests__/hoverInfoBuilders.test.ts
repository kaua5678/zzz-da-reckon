/**
 * 时间图表页第二片拆分的行为锁（2026-09-14）。
 *
 * 覆盖从 `src/views/TimeChartsPage.vue` 原样搬迁出的三组**悬浮信息对象构造**：
 *  - `buildTimelineHoverInfo`（Chart 1：节点 → 悬浮信息）
 *  - `buildSlotCompareHoverInfo`（Chart 7：对比点 → 悬浮信息，含 diff 取整与「谁高」文案）
 *  - `buildFilmSimHoverInfo`（Chart 4：菲林模拟点 → 悬浮信息）
 *
 * 为什么要锁：这三段此前只被页面模板消费（`<ChartHoverCard :title=…>`），
 * UI 侧只有 ui-check 的 DOM 体检（查重叠/溢出，**不校验文案**）⇒ 搬迁/重构改错文案不会红。
 * 断言重点是**与页面 computed 逐字一致的语义**：换人文案的括号与全角标点、
 * `periodOf` 缺失时的空串、`diff` 的 `round(x*1000)/10` 取整、diffText 的三分支（含 0 走「持平」）。
 */
import { describe, expect, it } from 'vitest'
import { fmt } from '@/utils/format'
import {
  buildFilmSimHoverInfo,
  buildSlotCompareHoverInfo,
  buildTimelineHoverInfo,
} from '@/composables/charts/hoverInfoBuilders'
import type { FilmSimPoint, SlotComparePoint, TimelineNodeResult } from '@/composables/teamTimeline'

/** 名字注入：与页面 `agentName` 同签名，测试里用可预测的假名 */
const nameOf = (id: string) => `名${id}`

describe('buildTimelineHoverInfo（Chart 1 悬浮信息）', () => {
  const node = (over: Partial<TimelineNodeResult> = {}): TimelineNodeResult => ({
    nodeId: 'n1',
    nodeLabel: '2.1',
    team: ['1371', '1251', '1271'],
    state: {} as TimelineNodeResult['state'],
    totalGold: 6,
    goldLabel: '6金：仪玄 1命',
    damage: 1234567,
    hpRatio: 42.5,
    ...over,
  })

  it('null 节点 → null（模板 `v-if="hoverNode >= 0 && hoverInfo"` 依赖这个边界）', () => {
    expect(buildTimelineHoverInfo(null, { agentName: nameOf, periodOf: () => undefined })).toBeNull()
    expect(buildTimelineHoverInfo(undefined, { agentName: nameOf, periodOf: () => undefined })).toBeNull()
  })

  it('基础字段逐字映射（伤害/血量/金数标签/队伍名）', () => {
    const h = buildTimelineHoverInfo(node(), { agentName: nameOf, periodOf: () => undefined })!
    expect(h.nodeLabel).toBe('2.1')
    expect(h.teamNames).toEqual(['名1371', '名1251', '名1271'])
    expect(h.damage).toBe(1234567)
    expect(h.hpRatio).toBe(42.5)
    expect(h.goldLabel).toBe('6金：仪玄 1命')
  })

  it('无换人 → swap 为空串（不是 null/undefined：模板直接插值）', () => {
    const h = buildTimelineHoverInfo(node(), { agentName: nameOf, periodOf: () => undefined })!
    expect(h.swap).toBe('')
  })

  it('★ 换人文案：全角逗号 + 全角括号；无 swapKind 时不带括号', () => {
    const a = buildTimelineHoverInfo(node({ swappedIn: '1481', swappedOut: '1251' }), { agentName: nameOf, periodOf: () => undefined })!
    expect(a.swap).toBe('换上 名1481，换下 名1251')
    const b = buildTimelineHoverInfo(
      node({ swappedIn: '1481', swappedOut: '1251', swapKind: 'upgrade', swapUpliftPct: 12.5 }),
      { agentName: nameOf, periodOf: () => undefined },
    )!
    expect(b.swap).toBe('换上 名1481，换下 名1251（上位 +12.5%）')
  })

  it('★ periodOf 缺失 → schedule 空串（不是 undefined）', () => {
    const h = buildTimelineHoverInfo(node(), { agentName: nameOf, periodOf: () => undefined })!
    expect(h.schedule).toBe('')
  })

  it('★ 排期文案：普通/困难两段，用 ` · ` 连接；只有一段时不带分隔符', () => {
    const both = buildTimelineHoverInfo(node(), {
      agentName: nameOf,
      periodOf: () => ({ normalBosses: [{ bossName: 'A' }, { bossName: 'B' }], criticalBosses: [{ bossName: 'C' }] }),
    })!
    expect(both.schedule).toBe('危局·普通：A/B · 危局·困难：C')
    const onlyNormal = buildTimelineHoverInfo(node(), {
      agentName: nameOf,
      periodOf: () => ({ normalBosses: [{ bossName: 'A' }], criticalBosses: [] }),
    })!
    expect(onlyNormal.schedule).toBe('危局·普通：A')
    const empty = buildTimelineHoverInfo(node(), {
      agentName: nameOf,
      periodOf: () => ({ normalBosses: [], criticalBosses: [] }),
    })!
    expect(empty.schedule).toBe('')
  })

  it('无 bench → bench 空串；有 bench → 与 benchText 同源文案（lateral 加「可不抽」）', () => {
    const none = buildTimelineHoverInfo(node(), { agentName: nameOf, periodOf: () => undefined })!
    expect(none.bench).toBe('')
    const lat = buildTimelineHoverInfo(
      node({ newAgentBench: { kind: 'lateral', agents: ['1501'], gapPct: -3.2 } as TimelineNodeResult['newAgentBench'] }),
      { agentName: nameOf, periodOf: () => undefined },
    )!
    expect(lat.bench).toBe('名1501 实装未进队 · 平替（差 3.2%，可不抽）')
  })
})

describe('buildSlotCompareHoverInfo（Chart 7 悬浮信息）', () => {
  const pt = (over: Partial<SlotComparePoint> = {}): SlotComparePoint => ({
    nodeId: 'n1',
    nodeLabel: '2.1',
    mainName: '仪玄',
    supportId: '1251',
    teamA: ['1371', '1251', '1271'],
    teamB: ['1371', '1481', '1271'],
    damageA: 1000,
    damageB: 900,
    ...over,
  } as SlotComparePoint)

  it('null 点 → null', () => {
    expect(buildSlotCompareHoverInfo(null, { agentName: nameOf, scAgentA: '1371', scAgentB: '1371' })).toBeNull()
  })

  it('★ diff 取整口径 = round(x*1000)/10（与表格行同源，不是 toFixed 也不是 ×100）', () => {
    // (1000−900)/900 = 11.111…% → round(111.11)/10 = 11.1
    const h = buildSlotCompareHoverInfo(pt(), { agentName: nameOf, scAgentA: '1371', scAgentB: '1371' })!
    expect(h.diff).toBe(11.1)
    // 0.05% 级差异：round(0.5)/10 = 0.1（证明是「千分位取整再除 10」）
    const tiny = buildSlotCompareHoverInfo(pt({ damageA: 1000.5, damageB: 1000 }), { agentName: nameOf, scAgentA: '1371', scAgentB: '1371' })!
    expect(tiny.diff).toBe(0.1)
  })

  it('damageB = 0 → diff 取 0（不做除零，不是 NaN/Infinity）', () => {
    const h = buildSlotCompareHoverInfo(pt({ damageB: 0 }), { agentName: nameOf, scAgentA: '1371', scAgentB: '1371' })!
    expect(h.diff).toBe(0)
    expect(h.diffText).toBe('两队持平')
  })

  it('★ diffText 三分支：A 高 / B 高 / 持平（0 走持平，且 B 高时取绝对值）', () => {
    const A = buildSlotCompareHoverInfo(pt(), { agentName: nameOf, scAgentA: '1111', scAgentB: '2222' })!
    expect(A.diffText).toBe(`名1111 高 ${fmt(11.1, 1)}%`)
    const B = buildSlotCompareHoverInfo(pt({ damageA: 900, damageB: 1000 }), { agentName: nameOf, scAgentA: '1111', scAgentB: '2222' })!
    // diff = round(-100)/10 = -10 → B 高 10.0%（用 -diff 取正）
    expect(B.diffText).toBe(`名2222 高 ${fmt(10, 1)}%`)
    const tie = buildSlotCompareHoverInfo(pt({ damageA: 1000, damageB: 1000 }), { agentName: nameOf, scAgentA: '1111', scAgentB: '2222' })!
    expect(tie.diffText).toBe('两队持平')
  })

  it('队伍名与支援名逐字注入（teamA/teamB 是 id 数组，经 agentName 映射）', () => {
    const h = buildSlotCompareHoverInfo(pt(), { agentName: nameOf, scAgentA: '1371', scAgentB: '1371' })!
    expect(h.supportName).toBe('名1251')
    expect(h.teamANames).toEqual(['名1371', '名1251', '名1271'])
    expect(h.teamBNames).toEqual(['名1371', '名1481', '名1271'])
  })
})

describe('buildFilmSimHoverInfo（Chart 4 悬浮信息）', () => {
  const p = (over: Partial<FilmSimPoint> = {}): FilmSimPoint => ({
    periodId: 'p1',
    seq: 1,
    label: '45',
    date: '2026-01-01',
    team: ['1371', '1251', '1271'],
    totalGold: 8,
    goldLabel: '8金',
    filmBank: 12000,
    filmSpent: 25000,
    filmInvestedTotal: 50000,
    damage: 999,
    hpRatio: 88.8,
    ...over,
  } as FilmSimPoint)

  it('null 点 → null', () => {
    expect(buildFilmSimHoverInfo(null, { agentName: nameOf })).toBeNull()
  })

  it('★ 菲林三数逐字映射（bank/spent/investedTotal 各自独立，别混）', () => {
    const h = buildFilmSimHoverInfo(p(), { agentName: nameOf })!
    expect(h.label).toBe('45')
    expect(h.date).toBe('2026-01-01')
    expect(h.teamNames).toEqual(['名1371', '名1251', '名1271'])
    expect(h.totalGold).toBe(8)
    expect(h.goldLabel).toBe('8金')
    expect(h.filmBank).toBe(12000)
    expect(h.filmSpent).toBe(25000)
    expect(h.filmInvestedTotal).toBe(50000)
  })
})
