/**
 * CC-320：普攻「普通 #N 段」判定单一事实源（`data/basicSegment`）+ 无 #N 段角色的秒均回复按基准段兜底。
 * 缺陷：1631 赛维里安 / 1641 菲欧妮新版 catalog 普攻段名不带 `#N` ⇒ 旧写法选不出段 ⇒ 平A秒均能量 / 喧响恒 0。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { isNumberedBasicSegment } from '@/data/basicSegment'
import { calcBasicAttackRegenPerSec } from '@/core/resource/moveLookup'

type Skills = { agentId: string; categories: { id: string; moves: { id: string; name: { en?: string }; actionTime?: number | null; rows: { id: string; values: number[] }[] }[] }[] }
const catalog = JSON.parse(readFileSync(new URL('../../../public/static/catalog.json', import.meta.url), 'utf8')) as { agentSkills: Skills[] }
const skillsOf = (id: string) => catalog.agentSkills.find(a => a.agentId === id)!

describe('CC-320 isNumberedBasicSegment / 秒均回复基准段兜底', () => {
  it('谓词：#N + 非冲刺闪避 + 有时长', () => {
    expect(isNumberedBasicSegment({ name: { en: 'Basic Attack: X #3' }, actionTime: 0.5 })).toBe(true)
    expect(isNumberedBasicSegment({ name: { en: 'Dash Attack: X #1' }, actionTime: 0.5 })).toBe(false)
    expect(isNumberedBasicSegment({ name: { en: 'Basic Attack: X #1' }, actionTime: 0 })).toBe(false)
    expect(isNumberedBasicSegment({ name: { en: 'Basic Attack' }, actionTime: 0.5 })).toBe(false)
  })

  it('只有 1631 / 1641 选不出 #N 段（新增此类角色时本例会提醒检查基准段）', () => {
    const none = catalog.agentSkills
      .filter(a => !(a.categories.find(c => c.id === 'basic')?.moves ?? []).some(isNumberedBasicSegment))
      .map(a => a.agentId).sort()
    expect(none).toEqual(['1631', '1641'])
  })

  it('无 #N 段：给基准段 ⇒ 按基准段秒均；不给 ⇒ 仍 0（旧行为）', () => {
    const s = skillsOf('1631')
    expect(calcBasicAttackRegenPerSec(s).energyPerSec).toBe(0)
    const r = calcBasicAttackRegenPerSec(s, undefined, { fallbackMoveId: '1631003' })
    expect(r.energyPerSec).toBeCloseTo(3.533 / 0.981, 6)
    expect(r.decibelPerSec).toBeCloseTo(26.785 / 0.981, 6)
  })

  it('CC-322：#N 段全被 >200% 启发式排除（1511 南宫羽）⇒ 同样走基准段兜底', () => {
    const s = skillsOf('1511')
    expect(calcBasicAttackRegenPerSec(s).energyPerSec, '无兜底 = 旧行为 0').toBe(0)
    const r = calcBasicAttackRegenPerSec(s, undefined, { fallbackMoveId: '1511003' })
    expect(r.energyPerSec).toBeCloseTo(5.526 / 1.535, 6)
    expect(r.decibelPerSec).toBeCloseTo(38.005 / 1.535, 6)
  })

  it('全部角色：带 #N 段的只有 1511 会被启发式清空（新增此类角色时本例提醒检查）', () => {
    const dmg = (m: Skills['categories'][number]['moves'][number]) => m.rows.find(r => r.id === 'damage')?.values[0] ?? 0
    const wiped = catalog.agentSkills.filter(a => {
      const segs = (a.categories.find(c => c.id === 'basic')?.moves ?? []).filter(isNumberedBasicSegment)
      return segs.length > 0 && segs.every(m => dmg(m) > 200)
    }).map(a => a.agentId)
    expect(wiped).toEqual(['1511'])
  })

  it('有 #N 段：兜底参数不生效（青衣逐位不变）', () => {
    const s = skillsOf('1251')
    expect(calcBasicAttackRegenPerSec(s, undefined, { fallbackMoveId: '1251008' })).toEqual(calcBasicAttackRegenPerSec(s))
  })
})
