import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { createDefaultLogicEditorState } from '@/logicEditor/defaults'
import { setActiveRowFusionRules } from '@/logicEditor/fusion'
import { loadLogicEditorState, saveLogicEditorState } from '@/logicEditor/storage'
import { parseLogicEditorState } from '@/logicEditor/validation'
import type {
  AttributeConversionRule,
  LogicEditorState,
  LogicObject,
  ObjectNature,
  RowFusionRule,
} from '@/logicEditor/types'

function nextId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

export const useLogicEditorStore = defineStore('logicEditor', () => {
  const state = ref<LogicEditorState>(loadLogicEditorState())
  const persistenceError = ref<string | null>(null)

  // Runtime rules are a snapshot, not aliases of a potentially incomplete numeric-input draft.
  setActiveRowFusionRules(parseLogicEditorState(state.value).rowFusions)
  watch(state, () => { saveNow() }, { deep: true })

  function addAttributeConversion(): void {
    const rule: AttributeConversionRule = {
      id: nextId('conversion'),
      specId: 'agent:custom',
      name: '新属性转模',
      sourceStat: 'atk',
      sourcePanelPhase: 'inCombat',
      threshold: 0,
      stepSize: 1,
      targetStat: 'atkFlat',
      valuePerStep: 1,
      cap: null,
      note: '',
    }
    state.value.attributeConversions.push(rule)
  }

  function removeAttributeConversion(id: string): void {
    state.value.attributeConversions = state.value.attributeConversions.filter(rule => rule.id !== id)
  }

  function addObject(): void {
    const object: LogicObject = {
      id: nextId('object'),
      specId: 'agent:custom',
      name: '新对象',
      nature: 'custom' as ObjectNature,
      enabled: true,
      properties: {},
    }
    state.value.objects.push(object)
  }

  function removeObject(id: string): void {
    state.value.objects = state.value.objects.filter(object => object.id !== id)
  }

  function addRowFusion(): void {
    const rule: RowFusionRule = {
      id: nextId('fusion'),
      specId: 'agent:custom',
      name: '新倍率融合',
      agentId: '1561',
      moveId: '1561007',
      rowId: 'damage',
      multiplier: 1,
      enabled: false,
      note: '',
    }
    state.value.rowFusions.push(rule)
  }

  function removeRowFusion(id: string): void {
    state.value.rowFusions = state.value.rowFusions.filter(rule => rule.id !== id)
  }

  function exportJson(): string {
    return JSON.stringify(state.value, null, 2)
  }

  function importJson(json: string): void {
    // Decode fully before the only write: rejected imports leave state/runtime/storage untouched.
    state.value = parseLogicEditorState(JSON.parse(json))
  }

  function reset(): void {
    state.value = createDefaultLogicEditorState()
  }

  function saveNow(): boolean {
    let snapshot: LogicEditorState
    try {
      snapshot = parseLogicEditorState(state.value)
    } catch (error) {
      const detail = error instanceof Error ? error.message : '配置无效'
      persistenceError.value = `${detail}；当前草稿未保存，仍使用上一次有效倍率。`
      return false
    }
    // Valid edits stay usable even if the browser denies persistence.
    setActiveRowFusionRules(snapshot.rowFusions)
    const saved = saveLogicEditorState(snapshot)
    persistenceError.value = saved ? null : '浏览器本地存储不可用或空间不足。当前修改仅在本次会话生效，请导出 JSON 备份。'
    return saved
  }

  return {
    state,
    persistenceError,
    addAttributeConversion,
    removeAttributeConversion,
    addObject,
    removeObject,
    addRowFusion,
    removeRowFusion,
    exportJson,
    importJson,
    reset,
    saveNow,
  }
})
