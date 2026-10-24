import { agentSpecs } from '@/specs/registry'
import type { AgentMechanicSpec, ResourceSpec } from '@/specs/types'
import type { LogicEditorState, ObjectNature } from './types'

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
  // beta 冻结 spec（`beta: true`）不进默认逻辑编辑器清单：编辑器面向活体逻辑，
  // 冻结旧版是只读历史；其 resource/conversion id 与正主同名，混入会造成同 id 双对象。
  const liveSpecs = agentSpecs.filter(spec => !spec.beta)
  return {
    version: 1,
    attributeConversions: liveSpecs.flatMap(spec =>
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
    objects: liveSpecs.flatMap(spec =>
      spec.resources.map(resource => specToLogicObject(spec, resource)),
    ),
    rowFusions: liveSpecs.flatMap(spec =>
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
