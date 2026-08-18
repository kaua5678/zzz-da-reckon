import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { calcPanel } from '@/core/panel'
import { emptyPanel } from '@/core/panel'
import { applyEffect } from '@/core/buff'
import { buildTeammateBuffSourceContext } from '@/core/teammateBuffSource'

function loadCatalog() {
  return JSON.parse(readFileSync(new URL('../../../public/static/catalog.json', import.meta.url), 'utf8'))
}

const teammateBuffsText = readFileSync(new URL('../../../public/static/teammate-buffs.json', import.meta.url), 'utf8')

describe('w-engine buff application', () => {
  it('applies wengine anomaly proficiency to in-combat panel', () => {
    const cat = loadCatalog() as any
    const agent = cat.agents.find((a: any) => a.id === '1561')
    const wEngine = cat.wEngines.find((w: any) => w.id === '14156')
    const setsMap = new Map()
    const disc = {
      fourPieceSetId: '',
      twoPieceSetId: '',
      mainStats: { 4: 'atkPct', 5: 'windDmg', 6: 'anomalyMastery' },
      subStatAllocation: {},
    }
    const noWeapon = calcPanel(agent, undefined, disc, setsMap, [], cat.statRules, { cinemaLevel: 0, wEngineModLevel: 5 })
    const withWeapon = calcPanel(agent, wEngine, disc, setsMap, [], cat.statRules, { cinemaLevel: 0, wEngineModLevel: 5 })
    // R5: self +110, team-wide +96 (owner also receives the team effect)
    expect(withWeapon.inCombat.anomalyProficiency).toBeCloseTo(noWeapon.inCombat.anomalyProficiency + 206, 6)
  })

  it('propagates wengine team buff to teammates', () => {
    const cat = loadCatalog() as any
    const velina = cat.agents.find((a: any) => a.id === '1561')
    const jane = cat.agents.find((a: any) => a.id === '1261')
    const wEngine = cat.wEngines.find((w: any) => w.id === '14156')
    const setsMap = new Map()
    const disc = {
      fourPieceSetId: '',
      twoPieceSetId: '',
      mainStats: { 4: 'atkPct', 5: 'windDmg', 6: 'anomalyMastery' },
      subStatAllocation: {},
    }
    const team = [
      { agentId: '1561', wEngineId: '14156', driveDisc: disc, cinemaLevel: 0, wEngineModLevel: 5 },
      { agentId: '1261', wEngineId: '', driveDisc: disc, cinemaLevel: 0, wEngineModLevel: 1 },
    ]
    const ctx = buildTeammateBuffSourceContext(team, {
      teammateBuffGroups: [],
      driveDiscSetsMap: setsMap,
      statRules: cat.statRules,
      getAgent: (id: string) => cat.agents.find((a: any) => a.id === id || a.teammateBuffId === id),
      getWEngine: (id: string) => cat.wEngines.find((w: any) => w.id === id),
      isTeammateBuffEnabled: () => false,
    })
    const withoutTeam = calcPanel(jane, undefined, disc, setsMap, [], cat.statRules, { cinemaLevel: 0, wEngineModLevel: 1 })
    const withTeam = calcPanel(jane, undefined, disc, setsMap, ctx.enabledTeammateBuffs, cat.statRules, {
      cinemaLevel: 0,
      wEngineModLevel: 1,
      sourcePanelsByOwner: ctx.sourcePanelsByOwner,
    })
    expect(withTeam.inCombat.anomalyProficiency).toBeCloseTo(withoutTeam.inCombat.anomalyProficiency + 96, 6)
    // owner is excluded from the synthetic team buff to avoid double counting
    const velinaNoWeapon = calcPanel(velina, undefined, disc, setsMap, ctx.enabledTeammateBuffs, cat.statRules, {
      cinemaLevel: 0,
      wEngineModLevel: 1,
      sourcePanelsByOwner: ctx.sourcePanelsByOwner,
    })
    const velinaWithWeapon = calcPanel(velina, wEngine, disc, setsMap, ctx.enabledTeammateBuffs, cat.statRules, {
      cinemaLevel: 0,
      wEngineModLevel: 5,
      sourcePanelsByOwner: ctx.sourcePanelsByOwner,
    })
    expect(velinaWithWeapon.inCombat.anomalyProficiency).toBeCloseTo(velinaNoWeapon.inCombat.anomalyProficiency + 206, 6)
  })

  it('applies Jufufu tiger roar derived crit dmg and targeted damage', () => {
    const base = emptyPanel()
    const panel = emptyPanel()
    applyEffect(panel, {
      type: 'formula',
      stat: 'critDmg',
      mode: 'flat',
      sourceStat: 'atk',
      formula: { expression: '20 + min(30, floor(max(0, x - 2800) / 100) * 5)' },
      dynamicSourceValue: 3400,
    } as any)
    expect(panel.critDmg - base.critDmg).toBe(50)

    applyEffect(panel, {
      type: 'fixed',
      stat: 'skillDmgBonus',
      mode: 'flat',
      value: 20,
      targetSkillType: 'chain',
    } as any)
    applyEffect(panel, {
      type: 'fixed',
      stat: 'skillDmgBonus',
      mode: 'flat',
      value: 40,
      targetSkillType: 'ultimate',
    } as any)
    expect(panel.skillDmgBonus__chain).toBe(20)
    expect(panel.skillDmgBonus__ultimate).toBe(40)
  })

  it('applies formula with skill level variable s (Lucia Darkbreaker Sheer Force)', () => {
    const panel = emptyPanel()
    applyEffect(panel, {
      type: 'formula',
      stat: 'sheerForceFlat',
      mode: 'flat',
      sourceStat: 'hp',
      formula: { expression: 'clamp(12 + floor(x / 200) * (5 + s * 0.2), 12, 612 + s * 24)' },
      dynamicSourceValue: 24000,
      dynamicSkillLevel: 12,
    } as any)
    expect(panel.sheerForceFlat).toBeCloseTo(900, 6)

    const panelLv14 = emptyPanel()
    applyEffect(panelLv14, {
      type: 'formula',
      stat: 'sheerForceFlat',
      mode: 'flat',
      sourceStat: 'hp',
      formula: { expression: 'clamp(12 + floor(x / 200) * (5 + s * 0.2), 12, 612 + s * 24)' },
      dynamicSourceValue: 24000,
      dynamicSkillLevel: 14,
    } as any)
    expect(panelLv14.sheerForceFlat).toBeCloseTo(948, 6)
  })

  it('applies Jufufu tiger roar teammate buff from source panel', () => {
    const cat = loadCatalog() as any
    const jufufu = cat.agents.find((a: any) => a.id === '1391')
    const group = JSON.parse(teammateBuffsText).find((g: any) => g.id === '1391')
    const setsMap = new Map()
    const disc = {
      fourPieceSetId: '',
      twoPieceSetId: '',
      mainStats: { 4: 'atkPct', 5: 'fireDmg', 6: 'critRate' },
      subStatAllocation: {},
    }
    const team = [
      { agentId: '1391', wEngineId: '', driveDisc: disc, cinemaLevel: 0, wEngineModLevel: 1 },
    ]
    const ctx = buildTeammateBuffSourceContext(team, {
      teammateBuffGroups: [group],
      driveDiscSetsMap: setsMap,
      statRules: cat.statRules,
      getAgent: (id: string) => cat.agents.find((a: any) => a.id === id || a.teammateBuffId === id),
      getWEngine: (id: string) => cat.wEngines.find((w: any) => w.id === id),
      isTeammateBuffEnabled: () => true,
    })
    const without = calcPanel(jufufu, undefined, disc, setsMap, [], cat.statRules, { cinemaLevel: 0, wEngineModLevel: 1 })
    const withBuff = calcPanel(jufufu, undefined, disc, setsMap, ctx.enabledTeammateBuffs, cat.statRules, {
      cinemaLevel: 0,
      wEngineModLevel: 1,
      sourcePanelsByOwner: ctx.sourcePanelsByOwner,
    })
    expect(withBuff.inCombat.critDmg - without.inCombat.critDmg).toBe(20)
    expect(withBuff.inCombat.skillDmgBonus__chain).toBe(20)
    expect(withBuff.inCombat.skillDmgBonus__ultimate).toBe(40)
  })
})
