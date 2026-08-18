import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { createDefaultLogicEditorState } from '@/logicEditor/defaults'
import { setActiveRowFusionRules } from '@/logicEditor/fusion'
import { loadLogicEditorState, saveLogicEditorState } from '@/logicEditor/storage'
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

  setActiveRowFusionRules(state.value.rowFusions)
  watch(state, (value) => {
    saveLogicEditorState(value)
    setActiveRowFusionRules(value.rowFusions)
  }, { deep: true })

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
    const parsed = JSON.parse(json) as Partial<LogicEditorState>
    if (!Array.isArray(parsed.attributeConversions) || !Array.isArray(parsed.objects) || !Array.isArray(parsed.rowFusions)) {
      throw new Error('JSON 缺少 attributeConversions / objects / rowFusions')
    }
    state.value = {
      version: 1,
      attributeConversions: parsed.attributeConversions,
      objects: parsed.objects,
      rowFusions: parsed.rowFusions,
    }
  }

  function reset(): void {
    state.value = createDefaultLogicEditorState()
  }

  function saveNow(): void {
    saveLogicEditorState(state.value)
    setActiveRowFusionRules(state.value.rowFusions)
  }

  return {
    state,
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
