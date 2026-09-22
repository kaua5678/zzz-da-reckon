import { describe, expect, it } from 'vitest'
import { createDefaultLogicEditorState } from '@/logicEditor/defaults'
import { parseLogicEditorState, parseLogicObjectProperties } from '@/logicEditor/validation'
import type { LogicEditorState } from '@/logicEditor/types'

function fixture(): LogicEditorState {
  return {
    version: 1,
    attributeConversions: [{ id: 'conversion', name: '', specId: 'agent:custom',
      sourceStat: 'customStat', sourcePanelPhase: 'inCombat', threshold: -2, stepSize: 0.5,
      targetStat: 'customTarget', valuePerStep: -1, cap: null, note: '' }],
    objects: [{ id: 'object', name: '', nature: 'custom', enabled: true,
      properties: { amount: 0, label: '', enabled: false, missing: null } }],
    rowFusions: [{ id: 'fusion', name: '', agentId: 'custom', moveId: 'custom-move',
      rowId: 'damage', multiplier: 2, enabled: true, note: '' }],
  }
}

describe('logic editor runtime decoding', () => {
  it('round-trips the actual default rules without changing any values', () => {
    const defaults = createDefaultLogicEditorState()
    expect(defaults.attributeConversions.length).toBeGreaterThan(0)
    expect(defaults.objects.length).toBeGreaterThan(0)
    expect(defaults.rowFusions.length).toBeGreaterThan(0)
    expect(parseLogicEditorState(JSON.parse(JSON.stringify(defaults)))).toEqual(defaults)
  })

  it('preserves custom ids, signed conversion values, zero multipliers and null caps', () => {
    const input = fixture()
    input.rowFusions[0].multiplier = 0
    expect(parseLogicEditorState(input)).toEqual(input)
  })

  it('accepts pre-version exports and returns an independent known-field snapshot', () => {
    const input = { ...fixture(), version: undefined, ignored: 'extra' }
    const result = parseLogicEditorState(input)
    expect(result).toEqual(fixture())
    expect(result.rowFusions).not.toBe(input.rowFusions)
    input.rowFusions[0].multiplier = 99
    input.objects[0].properties.amount = 99
    expect(result.rowFusions[0].multiplier).toBe(2)
    expect(result.objects[0].properties.amount).toBe(0)
  })

  it.each([null, undefined, [], 1, true, 'state'].map(value => ({ value })))('rejects non-object roots: $value', ({ value }) => {
    expect(() => parseLogicEditorState(value)).toThrow('配置')
  })

  it.each([2, '1', null])('rejects explicit unsupported versions: %j', version => {
    expect(() => parseLogicEditorState({ ...fixture(), version })).toThrow('version')
  })

  it.each(['attributeConversions', 'objects', 'rowFusions'] as const)('validates collection %s before exposing any rules', key => {
    for (const value of [undefined, null, {}, 'array', [null], [42], new Array(1)]) {
      expect(() => parseLogicEditorState({ ...fixture(), [key]: value })).toThrow(key)
    }
    expect(parseLogicEditorState({ ...fixture(), [key]: [] })[key]).toEqual([])
  })

  const badFields: Array<[string, (state: LogicEditorState) => void]> = [
    ['attributeConversions[0].id', s => Object.assign(s.attributeConversions[0], { id: 1 })],
    ['attributeConversions[0].specId', s => Object.assign(s.attributeConversions[0], { specId: null })],
    ['attributeConversions[0].sourcePanelPhase', s => Object.assign(s.attributeConversions[0], { sourcePanelPhase: 'invalid' })],
    ['attributeConversions[0].threshold', s => { s.attributeConversions[0].threshold = Infinity }],
    ['attributeConversions[0].stepSize', s => { s.attributeConversions[0].stepSize = 0 }],
    ['attributeConversions[0].stepSize', s => { s.attributeConversions[0].stepSize = -1 }],
    ['attributeConversions[0].valuePerStep', s => { s.attributeConversions[0].valuePerStep = NaN }],
    ['attributeConversions[0].cap', s => { s.attributeConversions[0].cap = -1 }],
    ['attributeConversions[0].note', s => Object.assign(s.attributeConversions[0], { note: null })],
    ['objects[0].name', s => Object.assign(s.objects[0], { name: false })],
    ['objects[0].nature', s => Object.assign(s.objects[0], { nature: 'unknown' })],
    ['objects[0].enabled', s => Object.assign(s.objects[0], { enabled: 'false' })],
    ['objects[0].properties', s => Object.assign(s.objects[0], { properties: [] })],
    ['objects[0].properties.amount', s => Object.assign(s.objects[0].properties, { amount: { nested: undefined } })],
    ['rowFusions[0].moveId', s => Object.assign(s.rowFusions[0], { moveId: 123 })],
    ['rowFusions[0].multiplier', s => Object.assign(s.rowFusions[0], { multiplier: '2' })],
    ['rowFusions[0].multiplier', s => { s.rowFusions[0].multiplier = -1 }],
    ['rowFusions[0].multiplier', s => { s.rowFusions[0].multiplier = -Infinity }],
    ['rowFusions[0].enabled', s => Object.assign(s.rowFusions[0], { enabled: 1 })],
  ]
  it.each(badFields)('reports the offending field %s without coercion', (path, mutate) => {
    const input = fixture()
    mutate(input)
    expect(() => parseLogicEditorState(input)).toThrow(path)
  })

  it('rejects a finite-looking JSON number that overflows to Infinity', () => {
    const raw = JSON.stringify(fixture()).replace('"multiplier":2', '"multiplier":1e999')
    expect(() => parseLogicEditorState(JSON.parse(raw))).toThrow('rowFusions[0].multiplier')
  })

  it('fills only missing legacy cache collections; does not mask malformed supplied collections', () => {
    const defaults = fixture()
    expect(parseLogicEditorState({ objects: [], rowFusions: null }, defaults)).toEqual({ ...defaults, objects: [] })
    expect(() => parseLogicEditorState({ objects: {} }, defaults)).toThrow('objects')
    expect(() => parseLogicEditorState({}, undefined)).toThrow('attributeConversions')
  })

  it('uses the same JSON-tree contract for the object editor, including nested stage metadata', () => {
    expect(parseLogicObjectProperties(fixture().objects[0].properties)).toEqual(fixture().objects[0].properties)
    const tree = { stages: [8, 7, 6], nested: { conditions: [true, null, { label: 'custom' }] } }
    expect(parseLogicObjectProperties(tree)).toEqual(tree)
    for (const bad of [[], null, { value: [NaN] }, { value: undefined }, { value: Infinity }]) {
      expect(() => parseLogicObjectProperties(bad)).toThrow('properties')
    }
    const cycle: Record<string, unknown> = {}
    cycle.self = cycle
    expect(() => parseLogicObjectProperties(cycle)).toThrow('循环引用')
    const shared = { valid: 1 }
    expect(parseLogicObjectProperties({ first: shared, second: shared })).toEqual({ first: { valid: 1 }, second: { valid: 1 } })
    const properties = parseLogicObjectProperties(JSON.parse('{"__proto__":"own value"}'))
    expect(Object.getPrototypeOf(properties)).toBe(Object.prototype)
    expect(Object.hasOwn(properties, '__proto__')).toBe(true)
    expect(properties.__proto__).toBe('own value')
  })
})
