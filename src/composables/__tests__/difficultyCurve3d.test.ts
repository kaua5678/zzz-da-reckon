import { describe, expect, it } from 'vitest'
import { deriveVersionAxis, project3d } from '@/composables/difficultyCurve3d'

const names: Record<string, string> = { '1431': '叶瞬光', '1371': '仪玄', '1481': '琉音', '1491': '柳', '1311': '耀嘉音', '1341': '丽娜' }
const nameOf = (id: string) => names[id] ?? id

describe('难度曲线 3D · 版本轴推导（用户 2026-09-19：在变化的那个角色做默认版本号）', () => {
  it('相同主 C、不同击破手 ⇒ 版本槽 = 击破位（槽 1），道序按 agentId 升序', () => {
    const axis = deriveVersionAxis([
      { presetId: 'a', name: '叶+柳+耀', team: ['1431', '1491', '1311'] },
      { presetId: 'b', name: '叶+琉+耀', team: ['1431', '1481', '1311'] },
    ], {}, nameOf)
    expect(axis.varyingSlots).toEqual([1])
    expect(axis.defaultSlot).toBe(1)
    expect(axis.ambiguous).toBe(false)
    expect(axis.lanes.map(l => [l.presetId, l.label, l.y])).toEqual([['b', '琉音', 0], ['a', '柳', 1]])
  })

  it('相同击破手、不同版本主 C ⇒ 版本槽 = 主 C 位（槽 0）', () => {
    const axis = deriveVersionAxis([
      { presetId: 'x', name: '仪玄队', team: ['1371', '1481', '1311'] },
      { presetId: 'y', name: '叶瞬光队', team: ['1431', '1481', '1311'] },
    ], {}, nameOf)
    expect(axis.defaultSlot).toBe(0)
    expect(axis.lanes.map(l => l.label)).toEqual(['仪玄', '叶瞬光'])
  })

  it('多个槽位在变 ⇒ ambiguous，缺省取变化最多的槽；overrides 逐队改版本角色', () => {
    const teams = [
      { presetId: 'p', name: 'p', team: ['1431', '1481', '1311'] },
      { presetId: 'q', name: 'q', team: ['1431', '1491', '1341'] },
      { presetId: 'r', name: 'r', team: ['1371', '1491', '1311'] },
    ]
    const axis = deriveVersionAxis(teams, {}, nameOf)
    expect(axis.ambiguous).toBe(true)
    expect(axis.varyingSlots).toEqual([0, 1, 2])
    // 槽 0 两种、槽 1 两种、槽 2 两种 ⇒ 并列取靠前的槽 0
    expect(axis.defaultSlot).toBe(0)
    const withOverride = deriveVersionAxis(teams, { r: 2 }, nameOf)
    expect(withOverride.lanes.find(l => l.presetId === 'r')!.label).toBe('耀嘉音')
    // 同一版本角色出现在多支队时标签追加其余成员消歧，且全体唯一
    const labels = withOverride.lanes.map(l => l.label)
    expect(new Set(labels).size).toBe(labels.length)
    expect(labels.some(l => l.startsWith('叶瞬光（'))).toBe(true)
  })

  it('单队 / 全同 ⇒ 无变化槽，缺省槽 0，一条道', () => {
    const axis = deriveVersionAxis([{ presetId: 'only', name: 'only', team: ['1431', '1481', '1311'] }], {}, nameOf)
    expect(axis.varyingSlots).toEqual([])
    expect(axis.defaultSlot).toBe(0)
    expect(axis.lanes).toHaveLength(1)
    expect(axis.lanes[0]!.label).toBe('叶瞬光')
  })

  it('⑤ 道位按首次 UP 版本节点序号留空档（用户 2026-09-19）；未收录/同点回退等距', () => {
    // 模拟版本节点表：1481=8、1491=4、1431=9、9999 未收录（三节点 4/8/9 ⇒ 留空档时的中点 = 4/5 = 0.8 ≠ 等距 0.5）
    const idx: Record<string, number> = { '1481': 8, '1491': 4, '1431': 9 }
    const releaseIndexOf = (id: string) => idx[id] ?? null
    const teams = [
      { presetId: 'a', name: '叶+柳+耀', team: ['1431', '1491', '1311'] },
      { presetId: 'b', name: '叶+琉+耀', team: ['1431', '1481', '1311'] },
    ]
    // 两队道位 = 节点间距归一：柳 4 → 0，琉音 8 → 1（两端；，中间空节点无声但真实在轴上）
    const axis2 = deriveVersionAxis(teams, {}, nameOf, releaseIndexOf)
    expect(axis2.gapped).toBe(true)
    // 道序仍按 agentId 数值升序（1481 < 1491），但道**位置**按节点序号
    expect(axis2.lanes.map(l => [l.agentId, l.versionIndex, l.frac])).toEqual([
      ['1481', 8, 1],
      ['1491', 4, 0],
    ])
    // 三队同版本对面时按真实间距：柳 4 → 0、琉音 8 → 0.8、叶 9 → 1——0.8 ≠ 等距的 0.5，
    // 正是「留空档」与「一前一后贴着」的可观测差
    const axis3 = deriveVersionAxis([
      ...teams,
      { presetId: 'c', name: '仪+琉+耀', team: ['1431', '1481', '1311'] },
      { presetId: 'd', name: '叶主C', team: ['1431', '1311', '1491'] },
    ], { c: 0, d: 0 }, nameOf, releaseIndexOf)
    expect(axis3.gapped).toBe(true)
    const byId = Object.fromEntries(axis3.lanes.map(l => [l.presetId, l.frac]))
    expect(byId['a']).toBe(0)          // 柳 4 = 最小
    expect(byId['b']).toBeCloseTo(0.8) // 琉音 8 = (8−4)/(9−4)；等距是 0.5，0.8 只能来自节点间距
    expect(byId['c']).toBe(1)          // 叶 9 = 最大
    expect(byId['d']).toBe(1)          // 叶 9 = 最大
    // 未收录角色混进 ⇒ 全轴回退等距（不让猜的间距污染真间距）
    const axisU = deriveVersionAxis([
      { presetId: 'a', name: 'A', team: ['9999', '1491', '1311'] },
      { presetId: 'b', name: 'B', team: ['1431', '1481', '1311'] },
    ], { b: 1 }, nameOf, releaseIndexOf)
    expect(axisU.gapped).toBe(false)
    expect(axisU.lanes.map(l => l.frac)).toEqual([0, 1])
    // 不同节点不足 2 个（同版本角色）⇒ 等距回退，不是叠在一条道上
    const axisS = deriveVersionAxis(teams, {}, nameOf, () => 7)
    expect(axisS.gapped).toBe(false)
    expect(axisS.lanes.map(l => l.frac)).toEqual([0, 1])
  })
})

describe('难度曲线 3D · 投影', () => {
  it('俯视 90° 时高度不影响屏幕坐标；平视 0° 时深度不影响屏幕 y；远处深度更大', () => {
    const top = project3d(0.2, 0.3, 0.9, { yaw: 0, pitch: 90, zoom: 1 })
    const top0 = project3d(0.2, 0.3, 0.0, { yaw: 0, pitch: 90, zoom: 1 })
    expect(top.sx).toBeCloseTo(top0.sx, 9)
    expect(top.sy).toBeCloseTo(top0.sy, 9)
    const near = project3d(0.5, 0, 0.5, { yaw: 0, pitch: 30, zoom: 1 })
    const far = project3d(0.5, 1, 0.5, { yaw: 0, pitch: 30, zoom: 1 })
    expect(far.depth).toBeGreaterThan(near.depth)
    expect(far.sy).toBeLessThan(near.sy) // 屏幕 y 向下：远处画得更靠上
    const flat = project3d(0.5, 0, 0.5, { yaw: 0, pitch: 0, zoom: 1 })
    const flatFar = project3d(0.5, 1, 0.5, { yaw: 0, pitch: 0, zoom: 1 })
    expect(flat.sy).toBeCloseTo(flatFar.sy, 9)
  })
})
