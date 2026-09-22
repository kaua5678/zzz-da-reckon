import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, nextTick } from 'vue'
import { newPinia } from '@/test/harness'
import { useLogicEditorStore } from '@/stores/logicEditor'
import { createDefaultLogicEditorState } from '@/logicEditor/defaults'
import { getRowFusionMultiplier, setActiveRowFusionRules } from '@/logicEditor/fusion'
import type { LogicEditorState } from '@/logicEditor/types'
import { getRowValue } from '@/data/moveTableQueries'
import type { SkillMove } from '@/types/catalog'

const fixtureMove: SkillMove = { id: 'custom-move', name: { en: 'Custom' }, rows: [
  { id: 'damage', label: { en: 'Damage' }, kind: 'damage', values: [100] },
] }

function rules(multiplier = 2): LogicEditorState {
  return { version: 1, attributeConversions: [], objects: [], rowFusions: [
    { id: 'custom', name: 'Custom', agentId: 'custom', moveId: 'custom-move',
      rowId: 'damage', multiplier, enabled: true, note: '' },
  ] }
}

describe('logic editor reversible trials', () => {
  let store: ReturnType<typeof useLogicEditorStore>
  let raw: string
  const write = (_key: string, value: string) => { raw = value }
  const setItem = vi.fn(write)
  const liveMultiplier = () => getRowFusionMultiplier('custom-move', 'damage')

  beforeEach(() => {
    newPinia()
    raw = JSON.stringify(rules())
    setItem.mockReset().mockImplementation(write)
    vi.stubGlobal('window', { localStorage: { getItem: () => raw, setItem } })
    store = useLogicEditorStore()
  })
  afterEach(() => {
    store.$dispose()
    vi.unstubAllGlobals()
    setActiveRowFusionRules([])
  })

  it('starts without history and no-op navigation does not write storage', () => {
    expect(store.canUndo).toBe(false)
    expect(store.canRedo).toBe(false)
    expect(store.undoCount).toBe(0)
    expect(store.redoCount).toBe(0)
    expect(store.undo()).toBe(false)
    expect(store.redo()).toBe(false)
    expect(setItem).not.toHaveBeenCalled()
  })

  it('undoes/redoes real multipliers and cache without recording save or watcher echoes', async () => {
    store.state.rowFusions[0].multiplier = 3
    await nextTick()
    store.saveNow()
    store.saveNow()
    expect(store.undoCount).toBe(1)
    expect(store.undo()).toBe(true)
    expect(liveMultiplier()).toBe(2)
    expect(JSON.parse(raw)).toEqual(rules())
    await nextTick()
    expect(store.undoCount).toBe(0)
    expect(store.redoCount).toBe(1)
    expect(store.redo()).toBe(true)
    expect(liveMultiplier()).toBe(3)
    expect(JSON.parse(raw)).toEqual(rules(3))
    await nextTick()
    expect(store.undoCount).toBe(1)
    expect(store.redo()).toBe(false)
  })

  it('groups synchronous field edits into one Vue-batch checkpoint', async () => {
    store.state.rowFusions[0].multiplier = 3
    store.state.rowFusions[0].name = 'Edited'
    store.state.rowFusions[0].enabled = false
    await nextTick()
    expect(store.undoCount).toBe(1)
    store.undo()
    expect(store.state).toEqual(rules())
  })

  it('does not lose a pending valid edit when an import replaces the draft', async () => {
    store.state.rowFusions[0].multiplier = 3
    store.importJson(JSON.stringify(rules(4)))
    // No nextTick: undo must capture the accepted import before the watcher runs.
    expect(store.undo()).toBe(true)
    expect(liveMultiplier()).toBe(3)
    expect(store.undo()).toBe(true)
    expect(liveMultiplier()).toBe(2)
    expect(store.redo()).toBe(true)
    expect(liveMultiplier()).toBe(3)
    expect(store.redo()).toBe(true)
    expect(liveMultiplier()).toBe(4)
    await nextTick()
    expect(store.undoCount).toBe(2)
  })

  it('recovers an invalid draft without stepping back twice or destroying redo', async () => {
    store.importJson(JSON.stringify(rules(3)))
    await nextTick()
    store.undo()
    store.state.rowFusions[0].multiplier = NaN
    await nextTick()
    expect(store.hasInvalidDraft).toBe(true)
    expect(store.canUndo).toBe(true)
    expect(store.canRedo).toBe(false)
    expect(store.redo()).toBe(false)
    expect(store.undo()).toBe(true)
    expect(store.state).toEqual(rules())
    expect(store.hasInvalidDraft).toBe(false)
    expect(store.undoCount).toBe(0)
    expect(store.redoCount).toBe(1)
    expect(store.persistenceError).toBeNull()
    store.redo()
    expect(liveMultiplier()).toBe(3)
  })

  it('can discard an initial incomplete number without creating an invalid redo entry', async () => {
    Object.assign(store.state.rowFusions[0], { multiplier: null })
    await nextTick()
    expect(store.undo()).toBe(true)
    expect(store.state).toEqual(rules())
    expect(store.undo()).toBe(false)
    expect(store.canRedo).toBe(false)
    expect(store.redoCount).toBe(0)
  })

  it('truncates redo on a new valid branch, including edits pending a watcher flush', async () => {
    store.importJson(JSON.stringify(rules(3)))
    await nextTick()
    store.importJson(JSON.stringify(rules(4)))
    await nextTick()
    store.undo()
    store.state.rowFusions[0].multiplier = 5
    expect(store.canRedo).toBe(false)
    expect(store.redo()).toBe(false)
    await nextTick()
    expect(store.redoCount).toBe(0)
    store.undo()
    expect(liveMultiplier()).toBe(3)
    store.redo()
    expect(liveMultiplier()).toBe(5)
    expect(store.redo()).toBe(false)
  })

  it('preserves the redo branch after a rejected import or an identical valid import', async () => {
    store.importJson(JSON.stringify(rules(3)))
    await nextTick()
    store.undo()
    const before = raw
    expect(() => store.importJson('{')).toThrow()
    expect(() => store.importJson(JSON.stringify({ ...rules(), version: 2 }))).toThrow()
    expect(raw).toBe(before)
    store.importJson(JSON.stringify(rules()))
    await nextTick()
    expect(store.undoCount).toBe(0)
    expect(store.redoCount).toBe(1)
    store.redo()
    expect(liveMultiplier()).toBe(3)
  })

  it('bounds history to 50 past steps while preserving order in both directions', async () => {
    expect(store.historyLimit).toBe(50)
    for (let i = 1; i <= 57; i++) {
      store.state.rowFusions[0].multiplier = 2 + i
      store.saveNow()
    }
    await nextTick()
    expect(store.undoCount).toBe(50)
    for (let i = 0; i < 50; i++) expect(store.undo()).toBe(true)
    expect(liveMultiplier()).toBe(9)
    expect(store.undo()).toBe(false)
    for (let i = 0; i < 50; i++) expect(store.redo()).toBe(true)
    expect(liveMultiplier()).toBe(59)
    expect(store.redo()).toBe(false)
  })

  it('does not let stale draft references mutate saved history snapshots', async () => {
    const next = rules(3)
    next.objects.push({ id: 'obj', name: 'Object', nature: 'custom', enabled: true, properties: { stages: [1, 2] } })
    store.importJson(JSON.stringify(next))
    await nextTick()
    const stale = store.state
    store.undo()
    stale.rowFusions[0].multiplier = 99
    stale.objects[0].properties.stages = [99]
    await nextTick()
    expect(liveMultiplier()).toBe(2)
    store.redo()
    expect(store.state).toEqual(next)
    expect(liveMultiplier()).toBe(3)
  })

  it('keeps history usable when persistence is blocked and recovers without adding a step', async () => {
    setItem.mockImplementation(() => { throw new Error('QuotaExceededError') })
    store.importJson(JSON.stringify(rules(3)))
    await nextTick()
    expect(store.undo()).toBe(true)
    expect(liveMultiplier()).toBe(2)
    expect(store.redo()).toBe(true)
    expect(liveMultiplier()).toBe(3)
    expect(store.persistenceError).toContain('导出 JSON')
    expect(JSON.parse(raw)).toEqual(rules())
    setItem.mockImplementation(write)
    expect(store.saveNow()).toBe(true)
    expect(store.undoCount).toBe(1)
    expect(store.persistenceError).toBeNull()
    expect(JSON.parse(raw)).toEqual(rules(3))
  })

  it.each([
    ['attributeConversions', 'addAttributeConversion', 'removeAttributeConversion'],
    ['objects', 'addObject', 'removeObject'],
    ['rowFusions', 'addRowFusion', 'removeRowFusion'],
  ] as const)('can undo a deletion from %s with the original id and values', async (key, add, remove) => {
    store[add]()
    await nextTick()
    const added = JSON.parse(store.exportJson()) as LogicEditorState
    store[remove](store.state[key].at(-1)!.id)
    await nextTick()
    expect(store.state).toEqual(rules())
    expect(store.undo()).toBe(true)
    expect(store.state).toEqual(added)
    expect(store.redo()).toBe(true)
    expect(store.state).toEqual(rules())
  })

  it('treats reset as a reversible replacement, preserving a pending valid draft', async () => {
    store.state.rowFusions[0].multiplier = 3
    store.reset()
    await nextTick()
    expect(store.state).toEqual(createDefaultLogicEditorState())
    store.undo()
    expect(store.state).toEqual(rules(3))
    store.redo()
    expect(store.state).toEqual(createDefaultLogicEditorState())
  })

  it('invalidates cached row-value calculations through edit, undo and redo', async () => {
    const cached = computed(() => getRowValue(fixtureMove, 'damage'))
    expect(cached.value).toBe(200)
    store.state.rowFusions[0].multiplier = 3
    await nextTick()
    expect(cached.value).toBe(300)
    Object.assign(store.state.rowFusions[0], { multiplier: null })
    await nextTick()
    expect(cached.value).toBe(300)
    store.undo() // Discard the invalid draft, not the previous valid step.
    expect(cached.value).toBe(300)
    store.undo()
    expect(cached.value).toBe(200)
    store.redo()
    expect(cached.value).toBe(300)
    setItem.mockImplementation(() => { throw new Error('QuotaExceededError') })
    store.state.rowFusions[0].multiplier = 4
    await nextTick()
    expect(cached.value).toBe(400)
    store.undo()
    expect(cached.value).toBe(300)
    store.redo()
    expect(cached.value).toBe(400)
    expect(store.persistenceError).toContain('导出 JSON')
  })

  it('does not invalidate cached calculations for metadata, save retries or disabled rules', async () => {
    const calculate = vi.fn(() => getRowValue(fixtureMove, 'damage'))
    const cached = computed(calculate)
    expect(cached.value).toBe(200)
    store.state.rowFusions[0].name = 'Renamed'
    store.state.rowFusions[0].note = 'Documentation only'
    await nextTick()
    store.saveNow()
    expect(cached.value).toBe(200)
    expect(calculate).toHaveBeenCalledTimes(1)
    store.state.rowFusions[0].enabled = false
    await nextTick()
    expect(cached.value).toBe(100)
    expect(calculate).toHaveBeenCalledTimes(2)
    store.state.rowFusions[0].multiplier = 9
    await nextTick()
    expect(cached.value).toBe(100)
    expect(calculate).toHaveBeenCalledTimes(2)
    store.state.rowFusions[0].enabled = true
    await nextTick()
    expect(cached.value).toBe(900)
    expect(calculate).toHaveBeenCalledTimes(3)
  })

  it('publishes an isolated effective snapshot even for direct callers', () => {
    const incoming = rules(3).rowFusions
    setActiveRowFusionRules(incoming)
    const cached = computed(() => getRowValue(fixtureMove, 'damage'))
    expect(cached.value).toBe(300)
    incoming[0].multiplier = 4
    expect(liveMultiplier()).toBe(3)
    expect(cached.value).toBe(300)
    setActiveRowFusionRules(incoming)
    expect(cached.value).toBe(400)
  })

  it('starts a fresh history after recreating the store from saved state', async () => {
    store.importJson(JSON.stringify(rules(3)))
    await nextTick()
    store.$dispose()
    newPinia()
    store = useLogicEditorStore()
    expect(store.state).toEqual(rules(3))
    expect(store.canUndo).toBe(false)
    expect(store.canRedo).toBe(false)
    expect(store.undoCount).toBe(0)
  })
})
