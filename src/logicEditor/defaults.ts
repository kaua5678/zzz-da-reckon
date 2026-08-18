import { agentSpecs } from '@/specs/registry'
import type { AgentMechanicSpec, ResourceSpec } from '@/specs/types'
import type { LogicEditorState, ObjectNature } from './types'

export const LOGIC_EDITOR_STORAGE_KEY = 'zzz-logic-editor:v1'

function resourceNature(nature: ResourceSpec['nature']): ObjectNature {
  if (nature === 'buff') return 'buff'
  if (nature === 'event') return 'event'
  if (nature === 'formula') return 'formula'
  return 'resource'
}

function specToLogicObject(spec: AgentMechanicSpec, resource: ResourceSpec): LogicEditorState['objects'][number] {
  return {
    id: resource.id,
    specId: spec.id,
    name: `${spec.name}·${resource.name}`,
    nature: resourceNature(resource.nature),
    enabled: true,
    properties: {
      ...resource.properties,
      initialValue: resource.initialValue ?? null,
    },
  }
}

export function createDefaultLogicEditorState(): LogicEditorState {
  return {
    version: 1,
    attributeConversions: agentSpecs.flatMap(spec =>
      spec.attributeConversions.map(conversion => ({
        id: conversion.id,
        specId: spec.id,
        name: `${spec.name}·${conversion.name}`,
        sourceStat: conversion.sourceStat,
        sourcePanelPhase: conversion.sourcePanelPhase,
        threshold: conversion.threshold,
        stepSize: conversion.stepSize,
        targetStat: conversion.targetStat,
        valuePerStep: conversion.valuePerStep,
        cap: conversion.cap,
        note: conversion.note,
      })),
    ),
    objects: agentSpecs.flatMap(spec =>
      spec.resources.map(resource => specToLogicObject(spec, resource)),
    ),
    rowFusions: agentSpecs.flatMap(spec =>
      spec.rowFusions.map(fusion => ({
        id: fusion.id,
        specId: spec.id,
        name: `${spec.name}·${fusion.name}`,
        agentId: fusion.agentId,
        moveId: fusion.moveId,
        rowId: fusion.rowId,
        multiplier: fusion.multiplier,
        enabled: fusion.enabled,
        note: fusion.note,
      })),
    ),
  }
}
