import { createDefaultLogicEditorState } from './defaults'
import type { LogicEditorState } from './types'
import { parseLogicEditorState } from './validation'

const STORAGE_KEY = 'zzz-logic-editor:v1'

export function loadLogicEditorState(): LogicEditorState {
  const defaults = createDefaultLogicEditorState()
  if (typeof window === 'undefined') return defaults

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaults
    return parseLogicEditorState(JSON.parse(raw), defaults)
  } catch {
    // Reading a corrupt/unsupported cache must not erase the user's original JSON.
    return defaults
  }
}

export function saveLogicEditorState(state: LogicEditorState): boolean {
  if (typeof window === 'undefined') return false
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(parseLogicEditorState(state)))
    return true
  } catch {
    // Storage access itself can throw (SecurityError), as can a full quota or invalid draft.
    return false
  }
}
