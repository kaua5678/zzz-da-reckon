import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDefaultLogicEditorState } from '@/logicEditor/defaults'
import { loadLogicEditorState, saveLogicEditorState } from '@/logicEditor/storage'

afterEach(() => vi.unstubAllGlobals())

describe('logic editor storage boundary', () => {
  it('falls back on malformed cached collections without overwriting the original', () => {
    const setItem = vi.fn()
    vi.stubGlobal('window', { localStorage: {
      getItem: () => '{"version":1,"rowFusions":{}}', setItem,
    } })
    expect(Array.isArray(loadLogicEditorState().rowFusions)).toBe(true)
    expect(setItem).not.toHaveBeenCalled()
  })

  it('reports a failed write instead of throwing', () => {
    vi.stubGlobal('window', { localStorage: {
      setItem: () => { throw new Error('QuotaExceededError') },
    } })
    expect(saveLogicEditorState(createDefaultLogicEditorState())).toBe(false)
  })

  it.each(['{', 'null', '[]', '"state"', '{"version":2}', '{"rowFusions":[null]}'])('recovers from unusable cached JSON: %s', raw => {
    const setItem = vi.fn()
    vi.stubGlobal('window', { localStorage: { getItem: () => raw, setItem } })
    expect(loadLogicEditorState()).toEqual(createDefaultLogicEditorState())
    expect(setItem).not.toHaveBeenCalled()
  })

  it('supports non-browser execution without claiming to have saved', () => {
    vi.stubGlobal('window', undefined)
    expect(loadLogicEditorState()).toEqual(createDefaultLogicEditorState())
    expect(saveLogicEditorState(createDefaultLogicEditorState())).toBe(false)
  })

  it('handles a SecurityError on the localStorage getter itself', () => {
    vi.stubGlobal('window', { get localStorage() { throw new Error('SecurityError') } })
    expect(loadLogicEditorState()).toEqual(createDefaultLogicEditorState())
    expect(saveLogicEditorState(createDefaultLogicEditorState())).toBe(false)
  })

  it('handles a failing getItem method', () => {
    vi.stubGlobal('window', { localStorage: { getItem: () => { throw new Error('SecurityError') } } })
    expect(loadLogicEditorState()).toEqual(createDefaultLogicEditorState())
  })

  it('round-trips a valid saved state using the existing storage key', () => {
    let raw: string | null = null
    const setItem = vi.fn((_key: string, value: string) => { raw = value })
    vi.stubGlobal('window', { localStorage: { getItem: () => raw, setItem } })
    const state = createDefaultLogicEditorState()
    expect(saveLogicEditorState(state)).toBe(true)
    // Object key order is not part of the cache contract; the storage key and all JSON values are.
    expect(setItem).toHaveBeenCalledTimes(1)
    expect(setItem.mock.calls[0][0]).toBe('zzz-logic-editor:v1')
    expect(JSON.parse(setItem.mock.calls[0][1])).toEqual(state)
    expect(loadLogicEditorState()).toEqual(state)
  })

  it('does not serialize an invalid draft into the last good cache', () => {
    const setItem = vi.fn()
    vi.stubGlobal('window', { localStorage: { setItem } })
    const state = createDefaultLogicEditorState()
    state.attributeConversions[0].threshold = Infinity
    expect(saveLogicEditorState(state)).toBe(false)
    expect(setItem).not.toHaveBeenCalled()
  })

  it('fills omitted legacy collections with fresh defaults', () => {
    vi.stubGlobal('window', { localStorage: { getItem: () => '{"rowFusions":[]}' } })
    const first = loadLogicEditorState()
    expect(first).toEqual({ ...createDefaultLogicEditorState(), rowFusions: [] })
    first.attributeConversions.length = 0
    expect(loadLogicEditorState().attributeConversions.length).toBeGreaterThan(0)
  })

  it('preserves explicit empty collections in a legacy cache', () => {
    vi.stubGlobal('window', { localStorage: {
      getItem: () => '{"attributeConversions":[],"objects":[],"rowFusions":[]}',
    } })
    expect(loadLogicEditorState()).toEqual({ version: 1, attributeConversions: [], objects: [], rowFusions: [] })
  })
})
