import { describe, expect, it } from 'vitest'
import { createDefaultLogicEditorState } from '@/logicEditor/defaults'
import {
  getRowFusionMultiplier,
  setActiveRowFusionRules,
} from '@/logicEditor/fusion'

describe('row fusion rules', () => {
  it('applies only enabled rules for a matching move and row', () => {
    setActiveRowFusionRules([
      { id: 'a', name: 'A', agentId: 'x', moveId: 'move1', rowId: 'damage', multiplier: 3, enabled: true, note: '' },
      { id: 'b', name: 'B', agentId: 'x', moveId: 'move1', rowId: 'damage', multiplier: 10, enabled: false, note: '' },
    ])

    expect(getRowFusionMultiplier('move1', 'damage')).toBe(3)
    expect(getRowFusionMultiplier('move1', 'daze')).toBe(1)
    expect(getRowFusionMultiplier('move2', 'damage')).toBe(1)
  })

  it('seeds Velina broad cyclone fusion examples disabled by default', () => {
    const state = createDefaultLogicEditorState()
    const velinaDamage = state.rowFusions.find(rule => rule.moveId === '1561007' && rule.rowId === 'damage')

    expect(velinaDamage?.multiplier).toBe(10)
    expect(velinaDamage?.enabled).toBe(false)
    expect(state.attributeConversions.length).toBeGreaterThan(0)
    expect(state.objects.length).toBeGreaterThan(0)
  })
})
