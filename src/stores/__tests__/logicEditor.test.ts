import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { newPinia } from '@/test/harness'
import { useLogicEditorStore } from '@/stores/logicEditor'
import { getRowFusionMultiplier, setActiveRowFusionRules } from '@/logicEditor/fusion'
import { createDefaultLogicEditorState } from '@/logicEditor/defaults'
import type { LogicEditorState } from '@/logicEditor/types'

afterEach(() => {
  vi.unstubAllGlobals()
  setActiveRowFusionRules([])
})

describe('logic editor import boundary', () => {
  it('rejects an invalid rule before replacing the current state', () => {
    newPinia()
    vi.stubGlobal('window', { localStorage: { getItem: () => null, setItem: vi.fn() } })
    const store = useLogicEditorStore()
    const before = store.exportJson()
    try {
      expect(() => store.importJson(JSON.stringify({
        version: 1, attributeConversions: [], objects: [],
        rowFusions: [{ id: 'custom', name: 'Custom', agentId: 'custom', moveId: 'move',
          rowId: 'damage', multiplier: 'wrong', enabled: true, note: '' }],
      }))).toThrow(/rowFusions/)
      expect(store.exportJson()).toBe(before)
    } finally {
      // Also stop the pre-fix watcher so a rejected assertion cannot leak mutations to other tests.
      store.$dispose()
    }
  })
})

function validState(multiplier = 2): LogicEditorState {
  return { version: 1, attributeConversions: [], objects: [], rowFusions: [
    { id: 'custom', name: 'Custom', agentId: 'custom', moveId: 'custom-move',
      rowId: 'damage', multiplier, enabled: true, note: '' },
  ] }
}

describe('logic editor persistence and live rules', () => {
  let store: ReturnType<typeof useLogicEditorStore>
  let raw: string
  const write = (_key: string, value: string) => { raw = value }
  const setItem = vi.fn(write)

  beforeEach(() => {
    newPinia()
    raw = JSON.stringify(validState())
    setItem.mockReset().mockImplementation(write)
    vi.stubGlobal('window', { localStorage: { getItem: () => raw, setItem } })
    store = useLogicEditorStore()
  })
  afterEach(() => store.$dispose())

  it('imports, activates, saves and re-exports valid rules', async () => {
    store.importJson(JSON.stringify(validState(3)))
    await nextTick()
    expect(getRowFusionMultiplier('custom-move', 'damage')).toBe(3)
    expect(getRowFusionMultiplier('custom-move', 'daze')).toBe(1)
    expect(JSON.parse(raw)).toEqual(validState(3))
    expect(JSON.parse(store.exportJson())).toEqual(validState(3))
    expect(store.saveNow()).toBe(true)
    expect(store.persistenceError).toBeNull()
  })

  it.each(['null', '[]', '{}', '{', JSON.stringify({ ...validState(), version: 2 }),
    JSON.stringify({ ...validState(), rowFusions: [null] }),
  ])('does not mutate state, cache or active multipliers after rejected import %s', async json => {
    const before = store.state
    const cached = raw
    expect(() => store.importJson(json)).toThrow()
    await nextTick()
    expect(store.state).toBe(before)
    expect(store.exportJson()).toBe(JSON.stringify(validState(), null, 2))
    expect(raw).toBe(cached)
    expect(setItem).not.toHaveBeenCalled()
    expect(getRowFusionMultiplier('custom-move', 'damage')).toBe(2)
    expect(store.persistenceError).toBeNull()
  })

  it('keeps valid changes live on quota failure, then clears the warning after recovery', async () => {
    setItem.mockImplementation(() => { throw new Error('QuotaExceededError') })
    store.state.rowFusions[0].multiplier = 4
    await nextTick()
    expect(getRowFusionMultiplier('custom-move', 'damage')).toBe(4)
    expect(store.saveNow()).toBe(false)
    expect(store.persistenceError).toContain('导出 JSON')
    expect(JSON.parse(store.exportJson())).toEqual(validState(4))
    expect(JSON.parse(raw)).toEqual(validState())
    setItem.mockImplementation(write)
    expect(store.saveNow()).toBe(true)
    expect(store.persistenceError).toBeNull()
    expect(JSON.parse(raw)).toEqual(validState(4))
  })

  it('handles browser storage denial without an unhandled Vue watcher error', async () => {
    vi.stubGlobal('window', { get localStorage() { throw new Error('SecurityError') } })
    store.state.rowFusions[0].multiplier = 3
    await expect(nextTick()).resolves.toBeUndefined()
    expect(getRowFusionMultiplier('custom-move', 'damage')).toBe(3)
    expect(store.persistenceError).toContain('本次会话')
  })

  it('keeps incomplete drafts separate from the last valid runtime snapshot and cache', async () => {
    store.state.rowFusions[0].multiplier = NaN
    expect(getRowFusionMultiplier('custom-move', 'damage')).toBe(2)
    await nextTick()
    expect(getRowFusionMultiplier('custom-move', 'damage')).toBe(2)
    expect(store.state.rowFusions[0].multiplier).toBeNaN()
    expect(store.saveNow()).toBe(false)
    expect(store.persistenceError).toContain('rowFusions[0].multiplier')
    expect(setItem).not.toHaveBeenCalled()
    expect(JSON.parse(raw)).toEqual(validState())
    store.state.rowFusions[0].multiplier = 0
    await nextTick()
    expect(getRowFusionMultiplier('custom-move', 'damage')).toBe(0)
    expect(store.persistenceError).toBeNull()
    expect(JSON.parse(raw)).toEqual(validState(0))
  })

  it('resets valid custom rules and persists the actual default metadata', async () => {
    store.reset()
    await nextTick()
    expect(getRowFusionMultiplier('custom-move', 'damage')).toBe(1)
    expect(store.state).toEqual(createDefaultLogicEditorState())
    expect(JSON.parse(raw)).toEqual(createDefaultLogicEditorState())
    expect(store.persistenceError).toBeNull()
  })
})
