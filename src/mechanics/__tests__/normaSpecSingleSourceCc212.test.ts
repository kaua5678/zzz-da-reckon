/**
 * CC-212：诺姆 1571 核心被动转模常数与步数口径只在 spec 一处（模块经 specConversionAmount 读取）。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { normaMechanic } from '@/mechanics/agents/norma'
import { getAgentSpec } from '@/specs/registry'

function run(outCrit: number, inPanel: Record<string, number> = {}) {
  const panel: Record<string, number> = { critRate: outCrit, critDmg: 50, atk: 0, hp: 0, ...inPanel }
  normaMechanic.applyPanel!({ slot: 0, team: [], agent: { id: '1571' }, panel, outOfCombatPanel: { critRate: outCrit }, cinemaLevel: 0, settings: {} } as any)
  return panel
}

describe('CC-212 诺姆转模 spec 单一来源', () => {
  it('暴击 67.3：floor(17.3)=17 步（CC-134 统一 floor）⇒ 暴伤 +28.9、三个定向失衡各 +13.6', () => {
    const p = run(67.3)
    expect(p.critDmg - 50).toBeCloseTo(17 * 1.7, 9)
    for (const k of ['stunBuildUpBonus__exSpecial', 'stunBuildUpBonus__special', 'stunBuildUpBonus__ultimate']) expect(p[k]).toBeCloseTo(17 * 0.8, 9)
  })

  it('封顶：暴击 100 ⇒ 暴伤 +85、失衡 +40（上限来自 spec）', () => {
    const p = run(100)
    expect(p.critDmg - 50).toBeCloseTo(85, 9)
    expect(p.stunBuildUpBonus__special).toBeCloseTo(40, 9)
  })

  it('贯穿力→攻击：floor(贯穿力) × 1.25，上限 1200', () => {
    const p = run(0, { atk: 1000, hp: 1003 }) // 贯穿力 = 300 + 100.3 = 400.3 ⇒ 400 步
    expect(p.atk - 1000).toBeCloseTo(400 * 1.25, 9)
  })

  it('spec 记录与模块口径一致：暴击两条声明局外来源', () => {
    const conv = getAgentSpec('1571')!.attributeConversions
    expect(conv.filter(c => c.sourceStat === 'critRate').map(c => c.sourcePanelPhase)).toEqual(['outOfCombat', 'outOfCombat'])
  })

  it('源码锁：模块不再自带转模常数', () => {
    const src = readFileSync(new URL('../agents/norma.ts', import.meta.url), 'utf8')
    expect(/CRIT_TO_|PEN_TO_ATK/.test(src)).toBe(false)
    expect((src.match(/normaConversion\('norma_/g) ?? []).length).toBe(3)
  })
})
