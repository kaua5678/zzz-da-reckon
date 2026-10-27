/**
 * 轴态视觉编码 + 「这一档的轴」视图的判据（R10）。
 *
 * ## 锁什么
 *
 * 1. **四态形状两两不同**（反空洞：不许两态同形 ⇒ 图上分不出来）；
 * 2. **形状集合 = {solid, hollow, half, cross}**，与既有五种图形（实心圆/空心菱形/空心方框/圆环/灰点）
 *    互斥——尤其 `cross` 不得等于「截断方框」的矩形语义（那是交互被砍，不是轴态）；
 * 3. `partial` 的跳过明细**逐条对得上** `AxisSkipCounts`（本模块不自己再数一遍）；
 * 4. `none` / `infeasible` **不许编造跳过明细**（引擎没执行轴 ⇒ 没有「跳过了哪些招」）；
 * 5. 执行清单**只来自引擎 `executed`**：`stack === null` ⇒ 空清单（不补一行平A凑数）；
 * 6. 对照量缺省一律 `null + nullReason`，**不写 0**（0 是「测到 0」，null 是「没测」）。
 *
 * ## 负控（改这些会红）
 *
 * - 把 `axisMarkerOf` 的 `partial` 改成 `solid`（与 complete 同形）⇒ 用例 ① 红；
 * - 把 `none` 的 shape 改成 `half` ⇒ 用例 ① 红；
 * - 让 `axisDetailOf` 在 `stack === null` 时补一行「平A」⇒ 用例 ⑤ 红；
 * - 把 `axisCompareOf` 的缺省从 null 改成 0 ⇒ 用例 ⑥ 红；
 * - `skipReasonSummary` 漏掉 `sway` ⇒ 用例 ② 红（T169 新增第四原因）。
 */
import { describe, expect, it } from 'vitest'
import {
  AXIS_SKIP_REASON_TEXT, axisCompareOf, axisCutMarkerOf, axisDetailOf, axisMarkerLegend, axisMarkerOf, skipReasonSummary,
  type AxisMarkerShape,
} from '@/composables/axisMarker'
import type { AxisKind, AxisState } from '@/composables/difficultyAxis'
import type { StackTraversalResult } from '@/core/stunAxisStack'

function st(kind: AxisKind, skipped: Partial<AxisState['skipped']> = {}): AxisState {
  const s = { time: 0, decibel: 0, energy: 0, sway: 0, family: 0, ...skipped }
  const total = s.time + s.decibel + s.energy + s.sway
  return { kind, skipped: s, skippedTotal: total, fallback: kind === 'infeasible' }
}

const nameOf = (slot: number, moveId: string) => `${slot}:${moveId}`

describe('axisMarkerOf（轴态 → 图形，唯一映射）', () => {
  it('① 四态两两不同形（反空洞：同形就分不出来）', () => {
    const kinds: AxisKind[] = ['complete', 'partial', 'none', 'infeasible']
    const shapes = kinds.map(k => axisMarkerOf(st(k)).shape)
    expect(new Set(shapes).size, `四态形状必须互不相同，实测 ${JSON.stringify(shapes)}`).toBe(4)
  })

  it('② 形状集合恰为 {solid, hollow, half, cross}，且每个都有中文图例', () => {
    const allowed: AxisMarkerShape[] = ['solid', 'hollow', 'half', 'cross']
    for (const k of ['complete', 'partial', 'none', 'infeasible'] as AxisKind[]) {
      const m = axisMarkerOf(st(k))
      expect(allowed, `${k} 的形状 ${m.shape} 不在允许集合内`).toContain(m.shape)
      expect(m.legend.length, `${k} 缺中文图例`).toBeGreaterThan(0)
      expect(m.detail.length, `${k} 缺解释`).toBeGreaterThan(0)
    }
  })

  it('③ complete / none 的跳过明细为空（不编造）', () => {
    for (const k of ['complete', 'none'] as AxisKind[]) {
      const m = axisMarkerOf(st(k))
      expect(m.detail).not.toContain('跳过 0 招')
      expect(skipReasonSummary(st(k))).toBe('')
    }
  })

  it('④ partial 的文案逐条对得上四条原因（含 T169 的 sway）', () => {
    const a = st('partial', { time: 1, decibel: 2, energy: 3, sway: 4 })
    const text = skipReasonSummary(a)
    for (const r of ['time', 'decibel', 'energy', 'sway'] as const) {
      expect(text, `缺 ${r} 的口径`).toContain(AXIS_SKIP_REASON_TEXT[r])
    }
    expect(text).toContain('1 招')
    expect(axisMarkerOf(a).legend).toContain('跳过 10 招')
  })

  it('⑤ 图例四条、形状不重复、并标注画在哪（曲线 / 曲线下）', () => {
    const legend = axisMarkerLegend()
    expect(legend.length).toBe(4)
    expect(new Set(legend.map(e => e.shape)).size).toBe(4)
    expect(legend.filter(e => e.onCurve === 'below').length).toBe(1)
    expect(legend.find(e => e.shape === 'cross')!.kinds).toEqual(['infeasible'])
  })

  it('⑥ 被砍档图形 = 打叉，且与曲线点形状不同（两个容器不许混）', () => {
    const cut = axisCutMarkerOf(st('partial', { energy: 2 }))
    expect(cut.shape).toBe('cross')
    const onCurve = new Set(axisMarkerLegend().filter(e => e.onCurve === 'curve').map(e => e.shape))
    expect(onCurve.has(cut.shape as AxisMarkerShape)).toBe(false)
    expect(axisCutMarkerOf(st('infeasible')).detail).toContain('弃轴')
  })
})

describe('axisDetailOf（「这一档的轴」视图）', () => {
  const stack = {
    executed: {
      '0:1011003': { slot: 0, moveId: '1011003', count: 12, inAxisCount: 12 },
      '1:1011011': { slot: 1, moveId: '1011011', count: 3, inAxisCount: 2.5 },
      '0:1011017': { slot: 0, moveId: '1011017', count: 4, inAxisCount: 4 },
    },
    skipped: [
      { slot: 2, moveId: '1011016', reason: 'decibel' as const },
      { slot: 0, moveId: '1011111', reason: 'time' as const },
    ],
  } as unknown as Pick<StackTraversalResult, 'executed' | 'skipped'>

  it('① 执行清单按槽位→次数降序，且 inAxisCount 原样透传（不四舍五入）', () => {
    const v = axisDetailOf(st('partial', { decibel: 1, time: 1 }), stack, nameOf)
    expect(v.executed.map(e => e.moveId)).toEqual(['1011003', '1011017', '1011011'])
    expect(v.executed.find(e => e.moveId === '1011011')!.inAxisCount).toBe(2.5)
    expect(v.executed[0]!.name).toBe('0:1011003')
  })

  it('② 跳过明细带原因中文，且 skipTotals 只列非零项', () => {
    const v = axisDetailOf(st('partial', { decibel: 1, time: 1 }), stack, nameOf)
    expect(v.skipped.length).toBe(2)
    expect(v.skipped.map(s => s.reasonText)).toEqual(['窗口时间装不下', '喧响不足'])
    expect(v.skipTotals.map(t => t.reason)).toEqual(['time', 'decibel'])
  })

  it('③ stack 为 null（非轴 / 弃轴）⇒ 执行与跳过清单都为空，且 note 说清「不是没打完」', () => {
    const none = axisDetailOf(st('none'), null, nameOf)
    expect(none.executed).toEqual([])
    expect(none.skipped).toEqual([])
    expect(none.note).toContain('不是')
    const infeasible = axisDetailOf(st('infeasible'), null, nameOf)
    expect(infeasible.executed).toEqual([])
    expect(infeasible.note).toContain('如实')
  })

  it('④ 标题三态各不相同（面板标题不许都叫「轴」）', () => {
    const titles = (['complete', 'partial', 'infeasible', 'none'] as AxisKind[])
      .map(k => axisDetailOf(st(k), null, nameOf).title)
    expect(new Set(titles).size).toBe(4)
  })

  it('⑤ 反空洞：partial 但引擎 skipped 为空 ⇒ 清单为空（本模块不自己造跳过项）', () => {
    const empty = { executed: {}, skipped: [] } as unknown as Pick<StackTraversalResult, 'executed' | 'skipped'>
    const v = axisDetailOf(st('partial'), empty, nameOf)
    expect(v.skipped).toEqual([])
    expect(v.skipTotals).toEqual([])
  })
})

describe('axisCompareOf（交互 / 合轴并排）', () => {
  it('① 有值时原样透传，三项各自独立', () => {
    const v = axisCompareOf({
      interactions: { filled: 12, played: 9 },
      absorb: 0.4,
      stack: { overlapSeconds: 7.5 },
    })
    expect(v.interactionsFilled).toBe(12)
    expect(v.interactionsPlayed).toBe(9)
    expect(v.absorb).toBe(0.4)
    expect(v.overlapSeconds).toBe(7.5)
    expect(v.nullReason).toEqual({})
  })

  it('② 缺省一律 null + 原因，**不写 0**（0 是测到 0，null 是没测）', () => {
    const v = axisCompareOf({})
    expect(v.interactionsFilled).toBeNull()
    expect(v.interactionsPlayed).toBeNull()
    expect(v.absorb).toBeNull()
    expect(v.overlapSeconds).toBeNull()
    expect(Object.keys(v.nullReason).sort()).toEqual(['absorb', 'interactionsFilled', 'interactionsPlayed', 'overlapSeconds'])
    for (const text of Object.values(v.nullReason)) expect((text ?? '').length).toBeGreaterThan(0)
  })

  it('③ 非轴队（stack null）但仍采到交互与吸收 ⇒ 只有合轴节省为 null', () => {
    const v = axisCompareOf({ interactions: { filled: 5, played: 5 }, absorb: 0.2, stack: null })
    expect(v.interactionsFilled).toBe(5)
    expect(v.absorb).toBe(0.2)
    expect(v.overlapSeconds).toBeNull()
    expect(Object.keys(v.nullReason)).toEqual(['overlapSeconds'])
  })
})
