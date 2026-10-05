/**
 * CC-500：「招式自身信号优先」分类段只写一份（`core/damage.ts#moveSignalDamageTarget`），
 * 伤害路径 `inferSkillDamageTarget` 与资源路径 `normalizeResourceSkillType` 共用。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { inferSkillDamageTarget, moveSignalDamageTarget } from '@/core/damage'
import { normalizeResourceSkillType } from '@/composables/resourceCalc/helpers'
import type { SkillCategory, SkillMove } from '@/types/catalog'

const mv = (o: Partial<SkillMove>) => ({ id: 'm', ...o } as unknown as SkillMove)

describe('moveSignalDamageTarget（CC-500）', () => {
  it('优先级 timeType > skillTags(dash > additional) > 名称；无信号 null', () => {
    expect(moveSignalDamageTarget(mv({ timeType: 'dodgeCounter', skillTags: ['dashAttack'] }))).toBe('dodgeCounter')
    expect(moveSignalDamageTarget(mv({ skillTags: ['dashAttack', 'additionalAttack'] }))).toBe('dashAttack')
    expect(moveSignalDamageTarget(mv({ skillTags: ['additionalAttack'], name: { en: 'Dash Attack: X' } }))).toBe('additionalAttack')
    expect(moveSignalDamageTarget(mv({ name: { zhCN: '冲刺攻击：怒涛' } }))).toBe('dashAttack')
    expect(moveSignalDamageTarget(mv({ name: { en: 'Basic Attack: A' } }))).toBeNull()
    expect(moveSignalDamageTarget(null)).toBeNull()
  })
  it('两条路径对同一招式给同一结果（信号命中时不看分类 / skillType）', () => {
    const move = mv({ name: { en: 'Dash Attack: Z' }, skillType: 'dodge' })
    const category = { id: 'dodge', moves: [move] } as unknown as SkillCategory
    expect(inferSkillDamageTarget(category, move)).toBe('dashAttack')
    expect(normalizeResourceSkillType(move, 'x')).toBe('dashAttack')
  })
  it('源码锁：信号判定字面量只在 owner 出现', () => {
    for (const f of ['src/core/damage.ts', 'src/composables/resourceCalc/helpers.ts']) {
      const code = readFileSync(f, 'utf8').split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
      const hits = (code.match(/skillTags\?\.includes\('dashAttack'\)|includes\('冲刺攻击'\)/g) ?? []).length
      expect(hits, f).toBe(f.endsWith('damage.ts') ? 2 : 0)
    }
  })
})
