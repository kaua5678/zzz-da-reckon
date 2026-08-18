import { describe, expect, it } from 'vitest'
import { createDefaultLogicEditorState } from '@/logicEditor/defaults'
import { logicEditorStateToSpecs } from '@/logicEditor/toSpec'

describe('logic editor state to specs', () => {
  it('converts defaults back into Velina and Alice specs', () => {
    const specs = logicEditorStateToSpecs(createDefaultLogicEditorState())
    const velina = specs.find(spec => spec.id === 'agent:velina')
    const alice = specs.find(spec => spec.id === 'agent:alice')

    expect(velina?.attributeConversions).toHaveLength(2)
    expect(velina?.resources).toHaveLength(2)
    expect(velina?.rowFusions).toHaveLength(3)
    expect(alice?.attributeConversions).toHaveLength(1)
    expect(alice?.resources).toHaveLength(1)
    expect(alice?.rowFusions).toHaveLength(0)
  })

  it('keeps exported specs valid with non-empty agent ids', () => {
    const specs = logicEditorStateToSpecs(createDefaultLogicEditorState())

    expect(specs.every(spec => spec.agentIds.length > 0)).toBe(true)
    expect(specs.every(spec => spec.schemaVersion === 1)).toBe(true)
  })
})
