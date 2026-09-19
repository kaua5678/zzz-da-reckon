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
