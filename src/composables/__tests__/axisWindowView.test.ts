import { describe, expect, it } from 'vitest'
import { axisWindowView } from '@/composables/axisWindowView'
import type { StunWindowSlot, StunWindowTrace } from '@/core/stunTimeline'
import type { StackTraversalResult } from '@/core/stunAxisStack'

/**
 * 逐窗兑现视图（资源池页「逐窗兑现」卡的数据层）——用户口径 2026-10-27：
 * > 「资源池页面如果开了轴模式，能显示 **n 次轴的动作块的丢失填充可视化**吗。
 * >  丢失比如某些情况**跳招**了，填充比如我在末尾**自动填了平a或者强特**…」
 *
 * 本条钉四件事（都是「不编造」的同族）：
 * ① 没轨迹就不画（非轴 / 弃轴 ⇒ 空视图，而不是画一张「0 丢失」的图去骗人）；
 * ② 跳过必须**归到窗**（`skipped[].window`）并按「槽+招+原因」合并次数，不丢次数；
 * ③ 填充必须是**谁/从第几秒/多久**（`fillSegments`），并标出是不是缺省补位；
 * ④ 发呆**没有时间轴快照就记 null**（不是 0：0 会被读成「打满了」）。
 */
const trace = (over: Partial<StunWindowTrace> = {}): StunWindowTrace => ({
  index: 0,
  axisIndex: 0,
  fillerDefaulted: false,
  fillSegments: [],
  idleSegments: [],
  nominalSeconds: 16,
  extendSeconds: 0,
  endSeconds: 16,
  truncated: false,
  actions: [],
  actionSeconds: 0,
  overlapSeconds: 0,
  fillSeconds: 0,
  ...over,
})

const slotSnap = (over: Partial<StunWindowSlot> = {}): StunWindowSlot => ({
  index: 0,
  startSeconds: 0,
  nominalSeconds: 16,
  extendedSeconds: 0,
  effectiveSeconds: 16,
  truncated: false,
  clippedByClock: false,
  actions: [],
  unusedSeconds: 0,
  ...over,
})

const nameOf = (slot: number, moveId: string): string => `${slot}·${moveId}`
const nameOfSlot = (slot: number): string => `槽${slot}`

const skip = (
  slot: number, moveId: string, reason: 'energy' | 'decibel' | 'time' | 'sway', window: number,
): StackTraversalResult['skipped'][number] => ({ slot, moveId, reason, window })

describe('axisWindowView', () => {
  it('① 没有轨迹（非轴 / 弃轴）⇒ 空视图，不编一张「0 丢失」的图', () => {
    const v = axisWindowView({ trace: null, skipped: [skip(0, 'x', 'energy', 1)], nameOf, nameOfSlot })
    expect(v.hasTrace).toBe(false)
    expect(v.windows).toEqual([])
    expect(v.totals.skippedTimes).toBe(0)
    expect(v.totals.idleSeconds, '没有轨迹 ⇒ 发呆不可推演（null，不是 0）').toBeNull()
  })

  it('② 跳过按窗口归因，并按「槽 + 招 + 原因」合并次数（不丢次数）', () => {
    const v = axisWindowView({
      trace: [trace({ index: 0 }), trace({ index: 1 })],
      skipped: [
        skip(0, 'ex', 'energy', 1),
        skip(0, 'ex', 'energy', 2),
        skip(0, 'ex', 'energy', 2),
        skip(1, 'ult', 'decibel', 2),
        skip(0, 'ghost', 'energy', 9), // 不存在的窗口 ⇒ 丢弃（不许凭空长出一窗）
      ],
      nameOf,
      nameOfSlot,
    })
    expect(v.windows[0]!.skipped).toHaveLength(1)
    expect(v.windows[0]!.skipped[0]).toMatchObject({ name: '0·ex', slotName: '槽0', reason: 'energy', reasonText: '闪能不足', times: 1 })
    expect(v.windows[1]!.skipped.map(s => [s.moveId, s.times])).toEqual([['ex', 2], ['ult', 1]])
    expect(v.totals.skippedTimes, '只统计归到已排窗口的次数').toBe(4)
  })

  it('③ 跨界块标 partial（inAxisCount < count），整段在窗内的不标', () => {
    const v = axisWindowView({
      trace: [trace({
        actions: [
          { slot: 0, moveId: 'full', count: 1, inAxisCount: 1, startTime: 1, actionTime: 2 },
          { slot: 0, moveId: 'cross', count: 1, inAxisCount: 0.4, startTime: 14, actionTime: 3 },
        ],
        actionSeconds: 5,
      })],
      nameOf,
      nameOfSlot,
    })
    expect(v.windows[0]!.actions.map(a => [a.moveId, a.partial])).toEqual([['full', false], ['cross', true]])
    expect(v.windows[0]!.actions[1]!.inAxisCount).toBe(0.4)
    expect(v.totals.actionSeconds).toBe(5)
  })

  it('④ 填充段带槽名/起点/秒数，并区分「缺省补位」与「轴声明」', () => {
    const v = axisWindowView({
      trace: [
        trace({ index: 0, fillSegments: [{ slot: 0, startSeconds: 12, seconds: 2 }], fillSeconds: 2, fillerDefaulted: true }),
        trace({ index: 1, fillSegments: [{ slot: 1, startSeconds: 10, seconds: 4 }], fillSeconds: 4, fillerDefaulted: false }),
      ],
      nameOf,
      nameOfSlot,
    })
    expect(v.windows[0]!.fills[0]).toMatchObject({ name: '槽0', startSeconds: 12, seconds: 2, defaulted: true })
    expect(v.windows[1]!.fills[0]).toMatchObject({ name: '槽1', seconds: 4, defaulted: false })
    expect(v.totals.fillSeconds).toBe(6)
  })

  it('⑤ 发呆取时间轴快照的 unusedSeconds；任一窗没快照 ⇒ 该窗与汇总都记 null', () => {
    const withSnaps = axisWindowView({
      trace: [trace({ index: 0 }), trace({ index: 1 })],
      slots: [slotSnap({ index: 0, unusedSeconds: 1.5 }), slotSnap({ index: 1, unusedSeconds: 0 })],
      nameOf,
      nameOfSlot,
    })
    expect(withSnaps.windows.map(w => w.idleSeconds)).toEqual([1.5, 0])
    expect(withSnaps.totals.idleSeconds).toBeCloseTo(1.5, 9)

    const partialSnaps = axisWindowView({
      trace: [trace({ index: 0 }), trace({ index: 1 })],
      slots: [slotSnap({ index: 0, unusedSeconds: 1.5 })],
      nameOf,
      nameOfSlot,
    })
    expect(partialSnaps.windows.map(w => w.idleSeconds)).toEqual([1.5, null])
    expect(partialSnaps.totals.idleSeconds, '部分求和会被读成全队发呆 ⇒ 记 null').toBeNull()
  })

  it('⑥ 轴名与有效秒数：取生效轴名单与时间轴快照；截断/时钟截短如实透传', () => {
    const v = axisWindowView({
      trace: [trace({ index: 0, axisIndex: 1, nominalSeconds: 16, extendSeconds: 3, truncated: true, endSeconds: 18 })],
      slots: [slotSnap({ index: 0, effectiveSeconds: 14, clippedByClock: true, truncated: true })],
      axes: [{ name: '常规' }, { name: '尾段' }],
      nameOf,
      nameOfSlot,
    })
    const w = v.windows[0]!
    expect(w.axisName).toBe('尾段')
    expect(w.label).toBe('第 1 窗')
    expect(w.spanSeconds, '满宽 = 名义 + 决算延长').toBe(19)
    expect(w.effectiveSeconds, '有效秒数取快照（含时钟截短）').toBe(14)
    expect(w.truncated).toBe(true)
    expect(w.clippedByClock).toBe(true)
  })

  it('⑧ 末窗归零：战斗结束 ⇒ 剩余时间不算发呆、条按归零后长度画（用户口径 2026-10-27）', () => {
    const v = axisWindowView({
      trace: [trace({ index: 0 }), trace({ index: 1 })],
      slots: [slotSnap({ index: 0, unusedSeconds: 2 }), slotSnap({ index: 1, unusedSeconds: 6 })],
      nameOf,
      nameOfSlot,
    })
    // 中间窗打不满仍是真发呆
    expect(v.windows[0]!.idleSeconds).toBeCloseTo(2, 9)
    expect(v.windows[0]!.zeroedSeconds).toBe(0)
    // 末窗：余量归零、不计发呆、有效秒数扣掉 ⇒ 图上的条自然画短
    expect(v.windows[1]!.idleSeconds).toBe(0)
    expect(v.windows[1]!.zeroedSeconds).toBeCloseTo(6, 9)
    expect(v.windows[1]!.effectiveSeconds).toBeCloseTo(10, 9)
    expect(v.totals.zeroedSeconds).toBeCloseTo(6, 9)
    // 决算截断的末窗已经自己归零过 ⇒ 不重复扣
    const decided = axisWindowView({
      trace: [trace({ index: 0, truncated: true, endSeconds: 8 })],
      slots: [slotSnap({ index: 0, effectiveSeconds: 8, truncated: true, unusedSeconds: 1 })],
      nameOf,
      nameOfSlot,
    })
    expect(decided.windows[0]!.zeroedSeconds).toBe(0)
    expect(decided.windows[0]!.idleSeconds).toBeCloseTo(1, 9)
  })

  it('⑦ 空窗不计入 activeWindows（一个动作都没执行也照样有一行，如实展示「这窗没打东西」）', () => {
    const v = axisWindowView({
      trace: [
        trace({ index: 0, actions: [{ slot: 0, moveId: 'a', count: 1, inAxisCount: 1, startTime: 0, actionTime: 1 }] }),
        trace({ index: 1 }),
      ],
      nameOf,
      nameOfSlot,
    })
    expect(v.windows).toHaveLength(2)
    expect(v.totals.activeWindows).toBe(1)
    expect(v.windows[1]!.actions).toEqual([])
  })
})
