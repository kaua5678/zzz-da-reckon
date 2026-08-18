export type ObjectNature = 'buff' | 'resource' | 'event' | 'formula' | 'custom'

export interface LogicObject {
  id: string
  specId?: string
  name: string
  nature: ObjectNature
  enabled: boolean
  properties: Record<string, string | number | boolean | null>
}

export interface AttributeConversionRule {
  id: string
  specId?: string
  name: string
  sourceStat: string
  sourcePanelPhase: 'outOfCombat' | 'inCombat'
  threshold: number
  stepSize: number
  targetStat: string
  valuePerStep: number
  cap: number | null
  note: string
}

export interface RowFusionRule {
  id: string
  specId?: string
  name: string
  agentId: string
  moveId: string
  rowId: string
  multiplier: number
  enabled: boolean
  note: string
}

export interface LogicEditorState {
  version: 1
  attributeConversions: AttributeConversionRule[]
  objects: LogicObject[]
  rowFusions: RowFusionRule[]
}
