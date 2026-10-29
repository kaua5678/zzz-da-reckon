/**
 * 时间轴共享原语的判据（2026-10-30 收敛）。
 *
 * 覆盖三件事：
 * ① **单一来源**：常量表自洽（head 必须由刻度行 + 窗口条推出，不许手抄一个 34）；
 * ② **换算口径**：秒 → 百分比三种夹取语义（原样 / 夹到 0..100 / 只夹下界）与条几何（最小宽度、
 *    是否夹进轨道）——这两条正是编辑器与逐窗图**曾经各写一份**的公式；
 * ③ **布局累积**：角色道（含外置标签行）→ 专属窗口道 → 事件道自上而下，容器高度随内容。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  AXIS_TIME_PX, axisBarGeometry, axisInnerPct, axisPct, axisPctClamp, axisPctFromZero,
  buildAxisTimeline, emptyAxisTimeline,
} from '@/composables/axisTimeline'

const readSrc = (rel: string) => readFileSync(resolve(__dirname, rel), 'utf8')

describe('AXIS_TIME_PX（几何像素常量单一来源）', () => {
  it('head = 刻度行 + 窗口条 + 空隙（不许手抄 34）', () => {
    expect(AXIS_TIME_PX.head).toBe(AXIS_TIME_PX.tickH + AXIS_TIME_PX.windowBarH + 4)
    expect(AXIS_TIME_PX.head).toBe(34)
  })

  it('块高 ≤ 道高（块要在道里站得住，否则会压到相邻道）', () => {
    expect(AXIS_TIME_PX.blockH).toBeLessThanOrEqual(AXIS_TIME_PX.laneH)
    // 事件道内：标记高 ≤ 行距（逐行下移 evRowH；标记高 > 行距就会压住下一排标记）
    expect(AXIS_TIME_PX.evMarkH).toBeLessThanOrEqual(AXIS_TIME_PX.evRowH)
    // 账目对得上：单条道占的行数 × 行距 + 留白 = 道高（高度就是「会不会溢出」的判据）
    expect(AXIS_TIME_PX.evRowH * 2 + AXIS_TIME_PX.evPad).toBeGreaterThan(AXIS_TIME_PX.evRowH + AXIS_TIME_PX.evPad)
  })

  it('逐窗图的条高 ≤ 条容器高（否则块会溢出条外）', () => {
    expect(AXIS_TIME_PX.chartBarTop + AXIS_TIME_PX.chartBarH).toBeLessThanOrEqual(AXIS_TIME_PX.chartStripH)
  })
})

describe('秒 → 百分比', () => {
  it('axisPct 原样换算，不夹取（编辑器靠它把拖到窗外的块画出来）', () => {
    expect(axisPct(5, 20)).toBe(25)
    expect(axisPct(-1, 20)).toBe(-5)
    expect(axisPct(25, 20)).toBe(125)
  })

  it('span ≤ 0 ⇒ 0（不许把 NaN% 落进 style：浏览器会静默丢掉整条声明）', () => {
    expect(axisPct(1, 0)).toBe(0)
    expect(axisPct(1, -5)).toBe(0)
    expect(axisPctClamp(1, 0)).toBe(0)
  })

  it('axisPctClamp 夹到 0..100 / axisPctFromZero 只夹下界', () => {
    expect(axisPctClamp(-1, 20)).toBe(0)
    expect(axisPctClamp(25, 20)).toBe(100)
    expect(axisPctFromZero(-1, 20)).toBe(0)
    expect(axisPctFromZero(25, 20)).toBe(125)
  })
})

describe('axisBarGeometry（起点 + 时长 → left/width）', () => {
  it('编辑器口径：不夹进轨道，负起点照画（拖到窗外要看得见）', () => {
    expect(axisBarGeometry({ start: -1, duration: 2, span: 20, minPct: 2 }))
      .toEqual({ leftPct: -5, widthPct: 10 })
    // 越界块宽度照原样（4s / 20s = 20%），不像逐窗图那样截到轨道边
    expect(axisBarGeometry({ start: 19, duration: 4, span: 20, minPct: 2 }))
      .toEqual({ leftPct: 95, widthPct: 20 })
  })

  it('逐窗图口径：夹进轨道，越界段只画到边界', () => {
    expect(axisBarGeometry({ start: 19, duration: 4, span: 20, minPct: 1.2, clampToTrack: true }))
      .toEqual({ leftPct: 95, widthPct: 5 })
    expect(axisBarGeometry({ start: -3, duration: 1, span: 20, clampToTrack: true }))
      .toEqual({ leftPct: 0, widthPct: 5 })
  })

  it('最小宽度：0 时长标记块也要看得见（编辑器 2% / 逐窗图 1.2%）', () => {
    expect(axisBarGeometry({ start: 3, duration: 0, span: 20, minPct: 2 }))
      .toEqual({ leftPct: 15, widthPct: 2 })
    expect(axisBarGeometry({ start: 3, duration: 0.1, span: 20, minPct: 1.2, clampToTrack: true }).widthPct)
      .toBe(1.2)
  })

  it('关窗阴影：从有效秒画到轨道右端（差量为时长）', () => {
    expect(axisBarGeometry({ start: 12, duration: 8, span: 20, clampToTrack: true }))
      .toEqual({ leftPct: 60, widthPct: 40 })
    // 有效秒 ≥ 窗长 ⇒ 宽度 0（不画负宽）
    expect(axisBarGeometry({ start: 20, duration: 0, span: 20, clampToTrack: true }))
      .toEqual({ leftPct: 100, widthPct: 0 })
  })

  it('span ≤ 0 ⇒ 不产 NaN%（退化输入不写进 style；左端归 0，宽度退到最小宽度）', () => {
    const g = axisBarGeometry({ start: 3, duration: 1, span: 0, minPct: 2, clampToTrack: true })
    expect(g.leftPct).toBe(0)
    expect(Number.isFinite(g.widthPct)).toBe(true)
    expect(g.widthPct).toBe(2)
  })
})

describe('axisInnerPct（跨界块里「在窗内」那段）', () => {
  it('按次数比例，越界夹到 0..100', () => {
    expect(axisInnerPct(1, 2)).toBe(50)
    expect(axisInnerPct(3, 2)).toBe(100)
    expect(axisInnerPct(-1, 2)).toBe(0)
  })

  it('count ≤ 0 ⇒ 100（整条实心；与改动前的 AxisWindowChart#inPct 逐位一致）', () => {
    expect(axisInnerPct(0, 0)).toBe(100)
    expect(axisInnerPct(2, 0)).toBe(100)
  })
})

describe('buildAxisTimeline（编辑器时间轴布局）', () => {
  const lane = (name: string, rows: number) => ({ key: name, name, rows, markers: [] as never[] })

  it('空轴：只有三条角色道 + 底边留白', () => {
    const lay = buildAxisTimeline({
      actions: [], durationOf: () => 0, labelOf: () => '', durTextOf: () => '', titleOf: () => '',
      windowSeconds: 20, trackPx: 1000, windowLaneCount: 0, eventLanes: [],
    })
    // 三条道各占 laneH，道间各留 laneGap，底边留白 tail
    const floors = AXIS_TIME_PX.head + (AXIS_TIME_PX.laneH + AXIS_TIME_PX.laneGap) * 3 + AXIS_TIME_PX.tail
    expect(lay.height).toBe(floors)
    // 三条道自上而下等距排开，块在各道内垂直居中（道高相等时块顶也该等距）
    expect(lay.slotTop).toEqual([
      AXIS_TIME_PX.head,
      AXIS_TIME_PX.head + AXIS_TIME_PX.laneH + AXIS_TIME_PX.laneGap,
      AXIS_TIME_PX.head + (AXIS_TIME_PX.laneH + AXIS_TIME_PX.laneGap) * 2,
    ])
    for (let s = 0; s < 3; s += 1) {
      expect(lay.blockTop[s]! - lay.slotTop[s]!).toBe((AXIS_TIME_PX.laneH - AXIS_TIME_PX.blockH) / 2)
    }
    expect(lay.evLanes).toEqual([])
  })

  it('空布局函数的默认道高与之一致（首帧 / 未取到轴时不许塌成 0 高）', () => {
    expect(emptyAxisTimeline().height).toBe(AXIS_TIME_PX.head + AXIS_TIME_PX.laneH * 3 + AXIS_TIME_PX.tail)
  })

  it('★ 放得下写块里、放不下排标签行（两个分母：实测轴宽 + 固定开销）', () => {
    const input = {
      actions: [{ slot: 0, startTime: 0 }, { slot: 0, startTime: 8 }],
      durationOf: (i: number) => (i === 0 ? 10 : 0.5),
      labelOf: (i: number) => (i === 0 ? '短名' : '一个很长很长的招式名字'),
      durTextOf: () => ' 1.0s',
      titleOf: (i: number) => '块' + i,
      windowSeconds: 20,
      trackPx: 1000,
      windowLaneCount: 0,
      eventLanes: [],
    }
    const lay = buildAxisTimeline(input)
    // 10s 的块（半条轴宽）写得下 2 个字；0.5s 的块（2.5% ≈ 25px）写不下 10 个字
    expect(lay.labels[0]).toBeNull()
    expect(lay.labels[1]).not.toBeNull()
    expect(lay.labels[1]!.index).toBe(1)
    expect(lay.labels[1]!.label).toBe('一个很长很长的招式名字')
    // 标签行把所在道撑高：laneH + 2 + 1 行 × labelH
    expect(lay.slotH[0]).toBe(AXIS_TIME_PX.laneH + 2 + AXIS_TIME_PX.labelH)
    expect(lay.slotTop[1]).toBe(AXIS_TIME_PX.head + lay.slotH[0]! + AXIS_TIME_PX.laneGap)
  })

  it('轴宽越窄越容易外置（分母 = 实测轴宽，写死常量会在窄窗口上误判放得下）', () => {
    const mk = (trackPx: number) => buildAxisTimeline({
      actions: [{ slot: 0, startTime: 0 }],
      durationOf: () => 4, labelOf: () => '八个个个个个', durTextOf: () => '', titleOf: () => '',
      windowSeconds: 20, trackPx, windowLaneCount: 0, eventLanes: [],
    })
    expect(mk(1000).labels[0]).toBeNull()
    expect(mk(300).labels[0]).not.toBeNull()
  })

  it('窗口道 / 事件道逐轴累积：道距与道高由布局给，容器高度随内容', () => {
    const lay = buildAxisTimeline({
      actions: [], durationOf: () => 0, labelOf: () => '', durTextOf: () => '', titleOf: () => '',
      windowSeconds: 20, trackPx: 1000, windowLaneCount: 2,
      eventLanes: [lane('异常事件', 1), lane('毁伤事件', 2)],
    })
    // 三条角色道（各带道间距）之后就是第一条专属窗口道
    const afterLanes = AXIS_TIME_PX.head + (AXIS_TIME_PX.laneH + AXIS_TIME_PX.laneGap) * 3
    expect(lay.winTop).toBe(afterLanes)
    // 两条窗口道各占一行，事件道起点顺延
    expect(lay.evTop).toBe(afterLanes + 2 * AXIS_TIME_PX.laneH)
    const h1 = 1 * AXIS_TIME_PX.evRowH + AXIS_TIME_PX.evPad
    const h2 = 2 * AXIS_TIME_PX.evRowH + AXIS_TIME_PX.evPad
    expect(lay.evLanes.map(l => l.height)).toEqual([h1 + 'px', h2 + 'px'])
    expect(lay.evLanes.map(l => l.top)).toEqual([lay.evTop + 'px', (lay.evTop + h1 + 2) + 'px'])
    // 空道也占 1 行（用户能看出「这类事件今天没有」）
    expect(lay.evLanes[0]!.rows).toBe(1)
    expect(lay.height).toBe(lay.evTop + h1 + 2 + h2 + 2 + AXIS_TIME_PX.tail)
  })

  it('道高随事件行数继续长大（写死道距会让下一条道被压住）', () => {
    const one = buildAxisTimeline({
      actions: [], durationOf: () => 0, labelOf: () => '', durTextOf: () => '', titleOf: () => '',
      windowSeconds: 20, trackPx: 1000, windowLaneCount: 0, eventLanes: [lane('异常事件', 1)],
    })
    const three = buildAxisTimeline({
      actions: [], durationOf: () => 0, labelOf: () => '', durTextOf: () => '', titleOf: () => '',
      windowSeconds: 20, trackPx: 1000, windowLaneCount: 0, eventLanes: [lane('异常事件', 3)],
    })
    expect(three.height - one.height).toBe(2 * AXIS_TIME_PX.evRowH)
  })
})

/**
 * **收敛本身**的源码锁（2026-10-30）：两处渲染必须继续共用这一份几何。
 *
 * 为什么锁源码而不是只测函数：本次要修的缺陷恰恰是「函数各自都对、但有两份」——
 * 单测全绿也拦不住下次有人在组件里再写一遍 `pct/blockStyle`。锁的是**没有第二份**这条形状。
 */
describe('两处渲染共用同一份几何（源码锁）', () => {
  const page = readSrc('../../views/StunAxisPage.vue')
  const chart = readSrc('../../components/AxisWindowChart.vue')

  it('编辑器与逐窗兑现图都从共享原语取几何', () => {
    expect(page, '编辑器必须引共享原语').toContain("from '@/composables/axisTimeline'")
    expect(chart, '逐窗兑现图必须引共享原语').toContain("from '@/composables/axisTimeline'")
    expect(page).toContain('axisBarGeometry(')
    expect(chart).toContain('axisBarGeometry(')
  })

  it('逐窗兑现图不再自持换算函数（pct / inPct 已删；blockStyle 等只剩薄适配）', () => {
    expect(chart).not.toMatch(/function pct\(/)
    expect(chart).not.toMatch(/function inPct\(/)
    // 跨界比例口径不许在组件里再算一遍（只许调 axisInnerPct）
    expect(chart).not.toMatch(/inAxisCount \/ b\.count/)
  })

  it('编辑器不再自持像素表与换算函数（TL / pct / evLeftPct 已删）', () => {
    expect(page).not.toContain('const TL = {')
    expect(page).not.toMatch(/function pct\(/)
    expect(page).not.toMatch(/function evLeftPct\(/)
    // 几何字面量不许回流：最小条宽的百分比换算只许经共享原语
    expect(page).not.toMatch(/Math\.max\(2,\s*\(/)
    expect(chart).not.toMatch(/Math\.max\(1\.2,/)
  })
})
