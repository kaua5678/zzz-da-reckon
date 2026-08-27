import type { AgentMechanicModule } from '@/mechanics/types'
import type {
  AgentCharConfigInput,
  AgentResourceInput,
  AgentResourceResultInput,
  AgentResourceSectionsInput,
} from '@/mechanics/types'
import type {
  AnomalyEventExecution,
  CharacterOperationConfig,
  IterationState,
  SkillExecution,
  SpecialResourceSection,
} from '@/types/resource'
import { applySpecAttributeConversions } from './runtime'
import { computeSpecResources, type SpecResourceResult } from './resources'
import type { AgentMechanicSpec, EventSpec, ResourceRuleSpec } from './types'

export interface SpecEventCounts {
  [key: string]: number | undefined
  broadCycloneCount?: number
  aliceSparkCount?: number
}

export interface SpecEventExecutionInput {
  cfg: CharacterOperationConfig
  state: IterationState
  /** 动态 count：key 为 event.id 或 event.countField */
  counts?: Record<string, number>
  /** 动态倍率/次数覆盖：key 为 event.id */
  overrides?: Record<string, { count?: number; multiplier?: number }>
  /** 读取倍率表行值（moveId → rowId） */
  getRowValue?: (moveId: string, rowId: string) => number
}

export function buildSpecResourceSections(spec: AgentMechanicSpec): SpecialResourceSection[] {
  return spec.resources.map(resource => ({
    id: resource.id,
    title: `${spec.name}·${resource.name}`,
    summary: `初始 ${resource.initialValue ?? 0}`,
    rows: [
      ...resource.gainRules.map(rule => ({
        label: '获取',
        value: String(rule.amount ?? ''),
        detail: rule.formula ?? rule.trigger,
      })),
      ...resource.spendRules.map(rule => ({
        label: '消耗',
        value: String(rule.cost ?? ''),
        detail: rule.result ?? rule.trigger,
      })),
    ],
    footer: resource.gainRules
      .map(rule => `${rule.trigger}: ${rule.formula ?? rule.amount ?? ''}`)
      .join('；') || undefined,
  }))
}

export function buildSpecAnomalyEvents(
  spec: AgentMechanicSpec,
  cfg: CharacterOperationConfig,
  state: IterationState,
  counts: SpecEventCounts = {},
): AnomalyEventExecution[] {
  return spec.events.flatMap(event => {
    if (event.executionKind === 'execution') return []
    if (event.enabledField) {
      const record = cfg as unknown as Record<string, unknown>
      if (!record[event.enabledField]) return []
    }
    const count = resolveEventCount(event, state, counts)
    if (count <= 0) return []
    return [{
      eventId: event.id,
      eventName: event.name,
      eventType: event.eventType ?? 'other',
      carrierMoveId: resolveCarrierMoveId(event, cfg),
      carrierMoveName: event.carrierMoveName,
      count,
      formula: event.formula ?? '',
      fields: event.fields ?? [],
      note: event.note,
    }]
  })
}

/**
 * 事件 → 倍率表映射：把 execution 类事件生成实际招式执行。
 * 用于“倍率表行不直接对招式、而是被多个事件按比例复用”的情况（如风炮=起风×0.3+风炮爆炸）。
 */
export function buildSpecEventExecutions(
  spec: AgentMechanicSpec,
  input: SpecEventExecutionInput,
): SkillExecution[] {
  const executions: SkillExecution[] = []
  for (const event of spec.events) {
    if (event.executionKind !== 'execution') continue
    if (event.enabledField) {
      const record = input.cfg as unknown as Record<string, unknown>
      if (!record[event.enabledField]) continue
    }
    const moveId = resolveCarrierMoveId(event, input.cfg)
    if (!moveId) continue

    const override = input.overrides?.[event.id]
    let count = input.counts?.[event.countField ?? event.id] ?? resolveEventCount(event, input.state, input.counts ?? {})
    if (override?.count != null) count = override.count
    count = Math.max(0, Math.floor(count))
    if (count <= 0) continue

    const rowId = event.multiplierRowId ?? 'damage'
    const base = input.getRowValue?.(moveId, rowId) ?? 0
    const ratio = event.multiplierRatio ?? 1
    const multiplier = override?.multiplier ?? base * ratio
    const usesOverride = override?.multiplier != null || ratio !== 1
    if (multiplier <= 0 && !usesOverride) continue

    executions.push({
      moveId,
      moveName: event.carrierMoveName ?? event.name,
      category: 'special',
      count,
      actionTime: event.actionTime ?? 0,
      comboAlignRatio: 0,
      totalTime: (event.actionTime ?? 0) * count,
      totalComboAlignTime: 0,
      energyConsume: 0,
      totalEnergyConsume: 0,
      decibelRecovery: 0,
      totalDecibelRecovery: 0,
      energyRecovery: 0,
      totalEnergyRecovery: 0,
      damageMultiplier: multiplier,
      damageMultiplierOverride: usesOverride,
      skillTableNote: `事件 ${event.id} 调用倍率表 ${moveId}.${rowId}${ratio !== 1 ? ` × ${ratio}` : ''}`,
    })
  }
  return executions
}

export function specToMechanicModule(spec: AgentMechanicSpec): AgentMechanicModule {
  const hasResources = spec.resources.length > 0
  const hasEvents = spec.events.length > 0
  const settings = spec.resources.flatMap(resource => [
    ...resource.gainRules,
    ...resource.spendRules,
    ...(resource.feedbackGainRules ?? []),
  ])
    .filter((rule): rule is ResourceRuleSpec & { adjustable: NonNullable<ResourceRuleSpec['adjustable']> } => Boolean(rule.adjustable))
    .map(rule => ({ ...rule.adjustable }))

  return {
    id: spec.id,
    agentIds: spec.agentIds,
    name: spec.name,
    description: spec.notes.join('；'),
    settings,
    applyPanel: ({ panel }) => {
      applySpecAttributeConversions(panel, spec.attributeConversions)
    },
    buildCharConfig: ({ skills, cfg }: AgentCharConfigInput) => {
      if (!hasEvents) return
      const rowValues: Record<string, number> = {}
      for (const event of spec.events) {
        const moveId = event.carrierField
          ? String((cfg as unknown as Record<string, unknown>)[event.carrierField] ?? '')
          : event.carrierMoveId ?? ''
        if (!moveId) continue
        for (const category of skills?.categories ?? []) {
          const move = category.moves.find(item => item.id === moveId)
          if (!move) continue
          const rowId = event.multiplierRowId ?? 'damage'
          const row = move.rows.find(item => item.id === rowId)
          rowValues[moveId] = row?.values?.[0] ?? 0
          break
        }
      }
      if (Object.keys(rowValues).length) {
        cfg.mechanicRowValues = { ...(cfg.mechanicRowValues ?? {}), ...rowValues }
      }
    },
    buildExecutions: ({ cfg, state, executions }: AgentResourceInput) => {
      if (!hasResources || !hasEvents) return
      const resources = computeSpecResources(spec, cfg, state)
      const counts = resourceEventCounts(resources)
      const generated = buildSpecEventExecutions(spec, {
        cfg,
        state,
        counts,
        getRowValue: (moveId, rowId) => rowId === 'damage' ? (cfg.mechanicRowValues?.[moveId] ?? 0) : 0,
      })
      executions.push(...generated)
    },
    buildAnomalyEvents: ({ cfg, state, events }) => {
      if (!hasEvents) return
      const resources = hasResources ? computeSpecResources(spec, cfg, state) : new Map()
      events.push(...buildSpecAnomalyEvents(spec, cfg, state, resourceEventCounts(resources)))
    },
    buildResourceResult: ({ cfg, state }: AgentResourceResultInput) => {
      if (!hasResources) return {}
      const resources = computeSpecResources(spec, cfg, state)
      return { specResources: Object.fromEntries(resources) }
    },
    resourceSections: ({ result }: AgentResourceSectionsInput) => {
      if (!hasResources) return []
      const map = (result?.specResources ?? {}) as Record<string, SpecResourceResult>
      return spec.resources.map(resource => {
        const r = map[resource.id]
        return {
          id: resource.id,
          title: `${spec.name}·${resource.name}`,
          summary: r
            ? `初始 ${r.initialValue} · 获取 ${r.totalGain} · 消耗 ${Object.values(r.spendCosts).reduce((a, b) => a + b, 0)} · 剩余 ${r.remaining}`
            : `初始 ${resource.initialValue ?? 0}`,
          rows: [
            ...resource.gainRules.map(rule => ({
              label: '获取',
              value: r ? String(r.gains[rule.id ?? ''] ?? 0) : String(rule.amount ?? ''),
              detail: rule.formula ?? rule.trigger,
            })),
            ...resource.spendRules.map(rule => ({
              label: '消耗',
              value: r ? String(r.spendCounts[rule.id ?? ''] ?? 0) : String(rule.cost ?? ''),
              detail: rule.result ?? rule.trigger,
            })),
          ],
          footer: resource.gainRules
            .map(rule => `${rule.trigger}: ${rule.formula ?? rule.amount ?? ''}`)
            .join('；') || undefined,
        }
      })
    },
  }
}

function resourceEventCounts(resources: Map<string, SpecResourceResult>): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const resource of resources.values()) {
    for (const [ruleId, count] of Object.entries(resource.spendCounts)) {
      if (typeof count === 'number' && count > 0) {
        counts[`resource:${resource.id}:${ruleId}`] = count
      }
    }
  }
  return counts
}

function resolveCarrierMoveId(event: EventSpec, cfg: CharacterOperationConfig): string {
  if (event.carrierField) {
    const record = cfg as unknown as Record<string, unknown>
    return String(record[event.carrierField] ?? '')
  }
  return event.carrierMoveId ?? ''
}

function resolveEventCount(
  event: EventSpec,
  state: IterationState,
  counts: SpecEventCounts,
): number {
  if (event.countField) {
    return Math.max(0, Math.floor(counts[event.countField] ?? 0))
  }
  switch (event.countSource) {
    case 'ultimateCount':
      return Math.max(0, Math.floor(state.ultimateCount))
    case 'exSpecialCount':
      return Math.max(0, Math.floor(state.exSpecialCount))
    case 'broadCycloneCount':
      return Math.max(0, Math.floor(counts.broadCycloneCount ?? 0))
    case 'aliceSparkCount':
      return Math.max(0, Math.floor(counts.aliceSparkCount ?? 0))
    case 'fixed':
      return Math.max(0, Math.floor(event.count ?? 1))
    default:
      return 0
  }
}
