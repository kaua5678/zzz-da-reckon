/**
 * 「限定 S 首次 UP × 版本直伤系数」图几何/标度（评审 #14 从 TimeChartsPage.vue 抽出）。
 *
 * 为什么值得测：这段逻辑此前埋在 3319 行的页面里，只能靠「起服务点开图表」验证；
 * 抽出后用合成输入即可钉住边界——合并卡池 2 格宽、空数据回落 0.7/1.3、跨版本刻度只标首个节点、
 * 测试服节点最小 8px、同节点标签纵向错开。这些正是「改一个数就看不出错」的地方。
 */
import { describe, expect, it } from 'vitest'
import {
  DD_BAND,
  DD_CHART_LAYOUT,
  DD_Y_TICKS,
  buildDirectDamageChart,
  ddBandOf,
  ddColor,
  ddJitter,
  ddLabelSlotsOf,
  ddNeedLabel,
  ddNodeWidthsOf,
  ddShortName,
  ddXTicksOf,
} from '@/composables/directDamageChart'
import type { VersionNode } from '@/data/versionTimeline'
import type { DirectDamagePoint } from '@/composables/multiplierCoefficients'

const vn = (id: string, version: string, phaseLabel = '上半', note?: string): VersionNode =>
  ({ id, version, phaseLabel, label: `${version} ${phaseLabel}`, note } as unknown as VersionNode)
const pt = (agentId: string, nodeIndex: number, value: number | null): DirectDamagePoint =>
  ({ agentId, agentName: agentId, nodeId: `n${nodeIndex}`, nodeLabel: '', nodeIndex, value } as unknown as DirectDamagePoint)

describe('ddNodeWidthsOf（合并卡池占 2 格）', () => {
  it('合并 = 2 格，上半/下半 = 1 格', () => {
    expect(ddNodeWidthsOf([
      vn('a', '1.4', '合并'), vn('b', '2.0', '上半'), vn('c', '2.0', '下半'),
    ])).toEqual([2, 1, 1])
  })
})

describe('ddXTicksOf（每个版本只标首个节点）', () => {
  it('同版本多节点只保留首节点下标', () => {
    expect(ddXTicksOf([
      vn('a', '2.0', '上半'), vn('b', '2.0', '下半'), vn('c', '2.1', '上半'),
    ])).toEqual([{ index: 0, label: '2.0' }, { index: 2, label: '2.1' }])
  })
})

describe('buildDirectDamageChart（几何与标度）', () => {
  const versionNodes = [vn('a', '2.0', '上半'), vn('b', '2.0', '下半'), vn('c', '2.1', '合并', '测试服')]
  const base = { points: [] as DirectDamagePoint[], svgW: 1000, versionNodes }

  it('横向：首节点左缘 = padL；合并节点列宽 = 2 倍单格', () => {
    const g = buildDirectDamageChart(base)
    expect(g.padL).toBe(DD_CHART_LAYOUT.padL)
    expect(g.x(0)).toBeCloseTo(DD_CHART_LAYOUT.padL, 6)
    // 总格数 = 1 + 1 + 2 = 4 → 单格 = plotSpan/4，合并列宽 = plotSpan/2
    expect(g.plotSpan).toBeCloseTo(1000 - DD_CHART_LAYOUT.padL - DD_CHART_LAYOUT.padR, 6)
    expect(g.nodeWidths).toEqual([1, 1, 2])
    expect(g.x(2) - g.x(1)).toBeCloseTo(g.plotSpan / g.totalWidth, 6)   // 前进一步 = 1 格
  })

  it('纵向：空数据回落 0.7/1.3 并外扩 ±0.03；y() 上小下大且端点对齐', () => {
    const g = buildDirectDamageChart(base)
    expect(g.vMin).toBeCloseTo(0.67, 6)
    expect(g.vMax).toBeCloseTo(1.33, 6)
    expect(g.y(g.vMax)).toBeCloseTo(DD_CHART_LAYOUT.padT, 6)
    expect(g.y(g.vMin)).toBeCloseTo(g.plotBottom, 6)
    expect(g.y(1.2)).toBeLessThan(g.y(0.9))   // 值越大越靠上
  })

  it('纵向：数据超出 0.7~1.3 时按数据外扩（不裁剪）', () => {
    const g = buildDirectDamageChart({ ...base, points: [pt('x', 0, 2.0), pt('y', 1, 0.4)] })
    expect(g.vMax).toBeCloseTo(2.03, 6)
    expect(g.vMin).toBeCloseTo(0.37, 6)
  })

  it('null 值点不参与纵向范围', () => {
    const g = buildDirectDamageChart({ ...base, points: [pt('x', 0, null)] })
    expect(g.vMin).toBeCloseTo(0.67, 6)
    expect(g.vMax).toBeCloseTo(1.33, 6)
  })

  // 2026-09-12 修复：原式 `lefts[first] + w/2` 把「比例」（0..1）与「格数」混用，量纲不一致，
  // 真实数据下刻度被推到画布外（首个版本 982 vs 应为 70，偏差 912px ⇒ 刻度文字不可见）。
  // 修复 = 半宽也换算成比例 `(w/2)/totalWidth`。本断言钉住修复后的口径。
  it('版本刻度中心 = 该版本跨度中心（量纲修复：格数须换算成比例）', () => {
    const g = buildDirectDamageChart(base)
    // 2.0 占前两格（各 1 格）→ 中心 = padL + 1 格宽
    expect(g.tickCenterX(0)).toBeCloseTo(g.padL + g.plotSpan / 4, 6)
    // 合并卡池（单节点 2 格）中心 = 该列中心
    expect(g.tickCenterX(2)).toBeCloseTo(g.padL + (g.lefts[2] + (2 / 2) / g.totalWidth) * g.plotSpan, 6)
    // 刻度不得越出绘图区（原缺陷下会到 padL+plotSpan 之外）
    for (let i = 0; i < versionNodes.length; i++) {
      const t = g.tickCenterX(i)
      expect(t).toBeGreaterThanOrEqual(g.padL)
      expect(t).toBeLessThanOrEqual(g.padL + g.plotSpan)
    }
  })

  it('测试服阴影：只覆盖标注节点，且最小 8px 宽', () => {
    const g = buildDirectDamageChart(base)
    expect(g.testServerRects).toHaveLength(1)
    expect(g.testServerRects[0].x).toBeCloseTo(g.x(2), 6)
    expect(g.testServerRects[0].w).toBeGreaterThanOrEqual(8)
    // 极窄画布下仍保证可点/可见
    const narrow = buildDirectDamageChart({ ...base, svgW: 60 })
    expect(narrow.testServerRects[0].w).toBe(8)
  })

  it('yTicks 是模块常量（与自适应范围正交）', () => {
    expect(buildDirectDamageChart(base).yTicks).toBe(DD_Y_TICKS)
  })
})

describe('ddLabelSlotsOf / labelY（同节点标签纵向错开）', () => {
  it('只给偏离 1 超过 5% 的点分配槽位，按输入顺序递增', () => {
    const slots = ddLabelSlotsOf([
      pt('a', 0, 1.10), pt('b', 0, 1.20), pt('c', 0, 1.0), pt('d', 1, 0.5),
    ])
    expect(slots.get('a')).toBe(0)
    expect(slots.get('b')).toBe(1)
    expect(slots.has('c')).toBe(false)   // 1.0 不需要标签
    expect(slots.get('d')).toBe(0)       // 另一个节点重新从 0 起
  })

  it('labelY：≥1 标在点上方、<1 标在下方，槽位越大越远', () => {
    const points = [pt('a', 0, 1.10), pt('b', 0, 1.20), pt('c', 1, 0.5)]
    const g = buildDirectDamageChart({ points, svgW: 1000, versionNodes: [vn('n', '2.0')] })
    const yA = g.labelY(points[0])
    const yB = g.labelY(points[1])
    const yC = g.labelY(points[2])
    expect(yA).toBeLessThan(g.y(1.10))    // 上方
    expect(yB).toBeLessThan(yA)           // 槽位 1 更靠上
    expect(yC).toBeGreaterThan(g.y(0.5))  // 下方
  })
})

describe('分档 / 颜色 / 抖动 / 截断（阈值一族）', () => {
  it('三档阈值：>1.05 加强 / <0.95 削弱 / 其余持平，颜色与大档同源', () => {
    expect(ddBandOf(1.06)).toBe(DD_BAND.boost)
    expect(ddBandOf(1.05)).toBe(DD_BAND.flat)   // 边界不属于加强
    expect(ddBandOf(0.95)).toBe(DD_BAND.flat)   // 边界不属于削弱
    expect(ddBandOf(0.94)).toBe(DD_BAND.weak)
    expect(ddColor(1.06)).toBe('#7dd3fc')
    expect(ddColor(0.94)).toBe('#fdba74')
    expect(ddColor(1.0)).toBe('var(--wa-550)')
  })

  it('ddNeedLabel：|v-1| > 0.05 才标', () => {
    expect(ddNeedLabel(1.051)).toBe(true)
    expect(ddNeedLabel(0.949)).toBe(true)
    expect(ddNeedLabel(1.049)).toBe(false)   // 边界用 1.049 避开浮点（1.05-1 实际略 > 0.05）
    expect(ddNeedLabel(1)).toBe(false)
  })

  it('ddJitter：确定性、落在 ±12 且为 4 的倍数、不同 id 可区分', () => {
    const a = ddJitter('1021')
    expect(ddJitter('1021')).toBe(a)          // 稳定
    expect(Math.abs(a)).toBeLessThanOrEqual(12)
    expect(Math.abs(a % 4)).toBe(0)   // 注意 JS 取模可产 -0
    expect(new Set(['1021', '1041', '1101', '1141', '1181']).size).toBe(5)
    expect(new Set(['1021', '1041', '1101', '1141', '1181'].map(ddJitter)).size).toBeGreaterThan(1)
  })

  it('ddShortName：去书名号；超 6 字截断加省略号', () => {
    expect(ddShortName('「11号」')).toBe('11号')
    expect(ddShortName('123456')).toBe('123456')
    expect(ddShortName('1234567')).toBe('123456…')
  })
})
