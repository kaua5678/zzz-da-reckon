/**
 * 招式目标展示标签的**单一事实源**（2026-10-18）。
 *
 * 背景：`target.skillTargets` / `targetSkillType` 让引擎把效果写进 `<stat>__<招式族>` 定向字段
 * （`core/buff.ts#applyTargetedStat`），展示层必须能说出「这条只作用于哪些招式」。
 * 修前两处各写一份：驱动盘套装行修好了，音擎效果行还在显示「招式类型伤害加成」
 * ——实测 14124 两条（basic / dashAttack）、14146 两条（basic / ultimate）全部丢失招式信息。
 *
 * 本测试钉：① 判定与引擎同表（skillTag 归一）；② 两个展示点都走这个 helper（源码锁）；
 * ③ catalog 里真实存在的定向效果能被正确描述。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { skillTargetsOf, skillTargetSuffix, withSkillTargetLabel } from '@/utils/skillTargetLabel'

const catalog = JSON.parse(
  readFileSync(new URL('../../../public/static/catalog.json', import.meta.url), 'utf8'),
) as { wEngines: { id: string; name?: { zhCN?: string }; effect?: { selfBuff?: { effects?: Record<string, unknown>[] }; teamBuff?: { effects?: Record<string, unknown>[] } } }[]; driveDiscSets: { id: string }[] }

const discRows = readFileSync(new URL('../discEffectRows.ts', import.meta.url), 'utf8')
const teamConfigPage = readFileSync(new URL('../../views/TeamConfigPage.vue', import.meta.url), 'utf8')

describe('招式目标展示标签', () => {
  it('无目标 ⇒ 不标限定；skillType ⇒ 标招式族；skillTag 归一（assistAttack → 支援技）', () => {
    expect(skillTargetSuffix({})).toBe('')
    expect(skillTargetSuffix({ target: { kind: 'skill', skillTargets: [{ kind: 'skillType', skillType: 'basic' }] } })).toBe('（普通攻击限定）')
    expect(skillTargetSuffix({ targetSkillType: 'ultimate' })).toBe('（终结技限定）')
    expect(skillTargetSuffix({ target: { kind: 'skill', skillTargets: [{ kind: 'skillTag', skillTag: 'assistAttack' }] } })).toBe('（支援技限定）')
    // 多目标并列
    expect(skillTargetSuffix({ target: { kind: 'skill', skillTargets: [{ kind: 'skillType', skillType: 'exSpecial' }, { kind: 'skillTag', skillTag: 'assistAttack' }] } }))
      .toBe('（强化特殊技 / 支援技限定）')
    expect(withSkillTargetLabel('通用伤害加成', { target: { kind: 'skill', skillTargets: [{ kind: 'skillType', skillType: 'basic' }] } }))
      .toBe('通用伤害加成（普通攻击限定）')
  })

  it('源码锁：驱动盘行与音擎行都走同一个 helper（不许再各写一份）', () => {
    expect(discRows, 'discEffectRows 应使用 utils/skillTargetLabel').toContain("from './skillTargetLabel'")
    expect(teamConfigPage, '音擎效果行应使用 utils/skillTargetLabel').toContain("from '@/utils/skillTargetLabel'")
  })

  it('catalog 里带招式目标的音擎效果都能被描述（14124 普攻/冲刺、14146 普攻/终结）', () => {
    const targetsOf = (id: string) => {
      const w = catalog.wEngines.find(x => String(x.id) === id)!
      return [w.effect?.selfBuff, w.effect?.teamBuff]
        .flatMap(g => g?.effects ?? [])
        .map(e => skillTargetsOf(e as never))
        .filter(t => t.length > 0)
    }
    expect(targetsOf('14124')).toEqual(expect.arrayContaining([['basic'], ['dashAttack']]))
    expect(targetsOf('14146')).toEqual(expect.arrayContaining([['basic'], ['ultimate']]))
  })
})
