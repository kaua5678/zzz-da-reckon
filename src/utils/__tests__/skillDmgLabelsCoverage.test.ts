/**
 * 面板「招式类型增伤」必须覆盖**全部**招式族（2026-10-18）。
 *
 * 修前 `StatPanel` 手写 8 个 `skillDmgBonus__*` 键，漏了 `dashAttack` / `additionalAttack`
 * ——这两个招式族的定向招式增伤在页面上不显示（与 `dmgBonus__*` 的可见性缺口同形）。
 * 现在标签表由 `data/skillDamageTargets#SKILL_DMG_TARGETS` 生成 ⇒ 新增招式族自动跟上。
 *
 * 本测试是源码锁：`StatPanel.vue` 不得再手写 `skillDmgBonus__` 键（生成式单一来源）。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { SKILL_DMG_TARGETS } from '@/data/skillDamageTargets'

const statPanel = readFileSync(new URL('../../components/StatPanel.vue', import.meta.url), 'utf8')

describe('面板招式类型增伤覆盖全部招式族', () => {
  it('标签表由 SKILL_DMG_TARGETS 生成，不再手写 skillDmgBonus__ 键', () => {
    const literalKeys = statPanel.match(/skillDmgBonus__[a-zA-Z]+:/g) ?? []
    expect(literalKeys, `StatPanel 又手写了定向键（${literalKeys.join(',')}）—— 改回由 SKILL_DMG_TARGETS 生成`).toEqual([])
    expect(statPanel).toContain('SKILL_DMG_TARGETS')
  })

  it('招式族清单里两个易漏项（dashAttack / additionalAttack）确实在枚举内', () => {
    expect(SKILL_DMG_TARGETS).toContain('dashAttack')
    expect(SKILL_DMG_TARGETS).toContain('additionalAttack')
  })
})
