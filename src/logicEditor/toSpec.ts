import { agentSpecs } from '@/specs/registry'
import type { AgentMechanicSpec, ResourceNature } from '@/specs/types'
import type { LogicEditorState } from './types'

export function logicEditorStateToSpecs(state: LogicEditorState): AgentMechanicSpec[] {
  const groups = new Map<string, {
    attributeConversions: LogicEditorState['attributeConversions']
    objects: LogicEditorState['objects']
    rowFusions: LogicEditorState['rowFusions']
  }>()

  function groupFor(specId: string) {
    if (!groups.has(specId)) {
      groups.set(specId, {
        attributeConversions: [],
        objects: [],
        rowFusions: [],
      })
    }
    return groups.get(specId)!
  }

  for (const conversion of state.attributeConversions) {
    const specId = conversion.specId ?? 'agent:custom'
    groupFor(specId).attributeConversions.push(conversion)
  }
  for (const object of state.objects) {
    const specId = object.specId ?? 'agent:custom'
    groupFor(specId).objects.push(object)
  }
  for (const fusion of state.rowFusions) {
    const specId = fusion.specId ?? agentSpecs.find(spec => spec.agentIds.includes(fusion.agentId))?.id ?? 'agent:custom'
    groupFor(specId).rowFusions.push(fusion)
  }

  return [...groups.entries()].map(([specId, group]) => {
    const existing = agentSpecs.find(spec => spec.id === specId)
    const agentIds = existing?.agentIds ?? [...new Set(group.rowFusions.map(fusion => fusion.agentId).filter(Boolean))]
    return {
      schemaVersion: 1,
      id: specId,
      name: existing?.name ?? '自定义 Spec',
      agentIds: agentIds.length > 0 ? agentIds : ['custom'],
      status: existing?.status ?? 'partially_implemented',
      attributeConversions: group.attributeConversions.map(conversion => ({
        id: conversion.id,
        name: conversion.name,
        sourceStat: conversion.sourceStat,
        sourcePanelPhase: conversion.sourcePanelPhase,
        threshold: conversion.threshold,
        stepSize: conversion.stepSize,
        targetStat: conversion.targetStat,
        valuePerStep: conversion.valuePerStep,
        cap: conversion.cap,
        status: 'implemented' as const,
        note: conversion.note,
      })),
      resources: group.objects.map(object => ({
        id: object.id,
        name: object.name,
        nature: object.nature as ResourceNature,
        gainRules: [],
        spendRules: [],
        properties: object.properties,
      })),
      rowFusions: group.rowFusions.map(fusion => ({
        id: fusion.id,
        name: fusion.name,
        agentId: fusion.agentId,
        moveId: fusion.moveId,
        rowId: fusion.rowId,
        multiplier: fusion.multiplier,
        enabled: fusion.enabled,
        status: 'implemented' as const,
        note: fusion.note,
      })),
      events: [],
      verifications: [],
      stateMachines: [],
      teamBuffs: existing?.teamBuffs ?? [],
      notes: ['由逻辑编辑页生成'],
    }
  })
}
