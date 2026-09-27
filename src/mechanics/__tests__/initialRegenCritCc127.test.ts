/**
 * CC-127（洛克茜 1621）/ CC-128（诺姆 1571），第 153 轮：原文「初始 X」读局外口径。
 * - 洛克茜：「初始能量自动回复>1.2 时每超过 0.01 攻击+5（上限960）、冲击+0.4（上限76.8）」。
 *   旧实现读 panel.energyRegen（基础回能，恒 1.2）⇒ 转模从未触发；改读 energyRegenOutOfCombat。
 * - 诺姆：「初始暴击率超过50%」。旧实现读局内 critRate；改读 outOfCombatPanel。
 */
import { describe, expect, it } from 'vitest'
import { roxyMechanic } from '@/mechanics/agents/roxy'
import { normaMechanic } from '@/mechanics/agents/norma'

describe('CC-127 洛克茜回能转模读局外总回能', () => {
  it('基础 1.2、局外总回能 1.5 → 攻击 +150、冲击 +12', () => {
    const panel: any = { atk: 1000, impact: 100, energyRegen: 1.2, energyRegenOutOfCombat: 1.5 }
    roxyMechanic.applyPanel!({ cinemaLevel: 0, panel, settings: {} } as any)
    expect(panel.atk).toBeCloseTo(1150)
    expect(panel.impact).toBeCloseTo(112)
  })
  it('封顶：局外总回能 3.12 → 攻击 +960、冲击 +76.8', () => {
    const panel: any = { atk: 1000, impact: 100, energyRegen: 1.2, energyRegenOutOfCombat: 3.12 }
    roxyMechanic.applyPanel!({ cinemaLevel: 0, panel, settings: {} } as any)
    expect(panel.atk).toBeCloseTo(1960)
    expect(panel.impact).toBeCloseTo(176.8)
  })
})

describe('CC-128 诺姆初始暴击读局外', () => {
  it('局内 90% / 局外 60% → 暴伤按超出 10% 计', () => {
    const panel: any = { critRate: 90, critDmg: 50 }
    const outOfCombatPanel: any = { critRate: 60 }
    normaMechanic.applyPanel!({ slot: 0, team: [], agent: { id: '1571' }, panel, outOfCombatPanel, cinemaLevel: 0, settings: {} } as any)
    const panelIn: any = { critRate: 90, critDmg: 50 }
    normaMechanic.applyPanel!({ slot: 0, team: [], agent: { id: '1571' }, panel: panelIn, outOfCombatPanel: { critRate: 90 }, cinemaLevel: 0, settings: {} } as any)
    expect(panel.critDmg - 50).toBeCloseTo((panelIn.critDmg - 50) / 4)
  })
})
