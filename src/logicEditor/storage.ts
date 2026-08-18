import { createDefaultLogicEditorState } from './defaults'
import type { LogicEditorState } from './types'

export function loadLogicEditorState(): LogicEditorState {
  const defaults = createDefaultLogicEditorState()
  if (typeof window === 'undefined') return defaults

  try {
    const raw = window.localStorage.getItem('zzz-logic-editor:v1')
    if (!raw) return defaults
    const parsed = JSON.parse(raw) as Partial<LogicEditorState>
    return {
      ...defaults,
      ...parsed,
      attributeConversions: parsed.attributeConversions ?? defaults.attributeConversions,
      objects: parsed.objects ?? defaults.objects,
      rowFusions: parsed.rowFusions ?? defaults.rowFusions,
    }
  } catch {
    return defaults
  }
}

export function saveLogicEditorState(state: LogicEditorState): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem('zzz-logic-editor:v1', JSON.stringify(state))
}
