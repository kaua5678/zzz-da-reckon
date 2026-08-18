import { describe, expect, it } from 'vitest'
import { createDefaultLogicEditorState } from '@/logicEditor/defaults'
import { emptyPanel } from '@/core/panel'
import { agentSpecs, getAgentSpec } from '@/specs/registry'
import { applySpecAttributeConversions } from '@/specs/runtime'

describe('agent mechanic specs', () => {
  it('registers structured specs for known agent mechanics', () => {
    expect(agentSpecs.length).toBeGreaterThanOrEqual(2)
    expect(getAgentSpec('1561')?.id).toBe('agent:velina')
    expect(getAgentSpec('1401')?.id).toBe('agent:alice')
  })

  it('keeps agent ids unique across the registry', () => {
    const ids = agentSpecs.flatMap(spec => spec.agentIds)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('drives logic editor defaults from spec data', () => {
    const state = createDefaultLogicEditorState()
    const velinaFusion = state.rowFusions.find(rule => rule.id === 'velina_broad_damage')

    expect(velinaFusion?.moveId).toBe('1561007')
    expect(velinaFusion?.multiplier).toBe(10)
    expect(velinaFusion?.enabled).toBe(false)
    expect(state.objects.some(object => object.id === 'velina_corrosion')).toBe(true)
    expect(state.attributeConversions.some(rule => rule.id === 'alice_mastery_to_proficiency')).toBe(true)
  })

  it('executes Velina regen conversion from spec data', () => {
    const panel = emptyPanel()
    panel.energyRegenOutOfCombat = 1.5

    applySpecAttributeConversions(panel, getAgentSpec('1561')?.attributeConversions ?? [])

    expect(panel.dmgBonus).toBeCloseTo(6.3)
    expect(panel.anomalyMastery).toBeCloseTo(15)
  })

  it('caps attribute conversion values', () => {
    const panel = emptyPanel()
    panel.energyRegenOutOfCombat = 10

    applySpecAttributeConversions(panel, getAgentSpec('1561')?.attributeConversions ?? [])

    expect(panel.dmgBonus).toBe(35)
    expect(panel.anomalyMastery).toBe(84)
  })

  it('executes Alice mastery conversion from spec data', () => {
    const panel = emptyPanel()
    panel.anomalyMastery = 150

    applySpecAttributeConversions(panel, getAgentSpec('1401')?.attributeConversions ?? [])

    expect(panel.anomalyProficiency).toBeCloseTo(16)
  })

  it('records comprehensive mechanic notes for newly onboarded characters', () => {
    const ids = ['1261', '1581', '1411', '1171', '1511']
    for (const id of ids) {
      const spec = getAgentSpec(id)
      expect(spec?.notes.length ?? 0, `${id} notes`).toBeGreaterThanOrEqual(10)
      expect(spec?.resources.length ?? 0, `${id} resources`).toBeGreaterThanOrEqual(1)
    }
  })

  it('keeps spec team buffs at full coverage by default', () => {
    const specs = ['1561', '1401', '1181', '1501']
      .map(id => getAgentSpec(id))
      .filter((spec): spec is NonNullable<typeof spec> => Boolean(spec))

    expect(specs.length).toBe(4)
    for (const spec of specs) {
      expect(spec.teamBuffs?.length ?? 0, `${spec.id} team buffs`).toBeGreaterThan(0)
      for (const buff of spec.teamBuffs ?? []) {
        expect(buff.coverage, `${buff.id} coverage`).toBe(1)
      }
    }
  })
})
