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
} from '@/types/resource'
import { findMoveById, getRowValue } from '@/data/moveTableQueries'
import { applySpecAttributeConversions } from './runtime'
import { computeSpecResources, type SpecResourceResult } from './resources'
import { readCfgField } from './cfgField'
import { fmt } from '@/utils/format'
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
  /**
   * 读取事件 base 行值（moveId, rowId）。缺省 = `cfg.mechanicRowValues[moveId]`——即 specToMechanicModule.buildCharConfig
   * 按事件自身 `multiplierRowId` 经 data getRowValue（吃行规则）预取的值（CC-250：原 4 处调用方各抄一份只放行 damage 行的
   * lambda，非 damage 行被静默读成 0；现统一为缺省读取器，调用方无需再传）。仅测试注入自定义值。
   */
  getRowValue?: (moveId: string, rowId: string) => number
}

function isSpecEventEnabled(event: EventSpec, cfg: CharacterOperationConfig): boolean {
  if (!event.enabledField) return true
  return Boolean(readCfgField(cfg, event.enabledField))
}

export function buildSpecAnomalyEvents(
  spec: AgentMechanicSpec,
  cfg: CharacterOperationConfig,
  state: IterationState,
  counts: SpecEventCounts = {},
): AnomalyEventExecution[] {
  return spec.events.flatMap(event => {
    if (event.executionKind === 'execution') return []
    if (!isSpecEventEnabled(event, cfg)) return []
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
    if (!isSpecEventEnabled(event, input.cfg)) continue
    const moveId = resolveCarrierMoveId(event, input.cfg)
    if (!moveId) continue

    const override = input.overrides?.[event.id]
    const count = Math.max(
      0,
      Math.floor(override?.count ?? resolveEventCount(event, input.state, input.counts ?? {})),
    )
    if (count <= 0) continue

    const rowId = event.multiplierRowId ?? 'damage'
    const base = input.getRowValue ? input.getRowValue(moveId, rowId) : (input.cfg.mechanicRowValues?.[moveId] ?? 0)
    const ratio = event.multiplierRatio ?? 1
    const multiplier = override?.multiplier ?? base * ratio
    // 非 damage 行必须以 base 作倍率覆盖：否则 damageMultiplierOverride=false，enrichExecutionPlan 按 moveId 回填的是
    // damage 行（helpers.ts enrichExecutionPlan），声明的 multiplierRowId 被静默忽略（CC-250）。damage 行不覆盖 ⇒ 回填含命座技能等级。
    const usesOverride = override?.multiplier != null || ratio !== 1 || rowId !== 'damage'
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
        const moveId = resolveCarrierMoveId(event, cfg)
        if (!moveId) continue
        // CC-241：取值走 data getRowValue（吃逻辑编辑器行规则，作用面见 docs/mcp-stun-dual-source.md §24.85 ④）。
        // mechanicRowValues 即事件 base（无二次乘）。生效面（第 263 轮探针）：下游仅在 usesOverride（ratio≠1 或 cinema override）
        //   时把 base 当倍率；否则 damageMultiplierOverride=false、rowBuild 按 moveId 重读行（本就吃规则），此处只作 >0 闸。
        //   现存 spec 无 multiplierRatio → 当前生产零差；本改动为单一来源归一 + 防将来 ratio 事件绕过规则。
        // 按 moveId 存「该事件 multiplierRowId 行」的值，buildSpecEventExecutions 缺省读取器直接取用（CC-250 去掉了只放行 damage 的闸）。
        //   同一 moveId 被两个事件以不同行引用时会互相覆盖——现存 spec 无此情形，出现时须把键改为 moveId+rowId。
        const move = findMoveById(skills, moveId)
        if (!move) continue
        rowValues[moveId] = getRowValue(move, event.multiplierRowId ?? 'damage')
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
      const map = result?.specResources ?? {}
      return spec.resources.map(resource => {
        const r = map[resource.id]
        return {
          id: resource.id,
          title: `${spec.name}·${resource.name}`,
          summary: r
            ? `初始 ${fmt(r.initialValue)} · 获取 ${fmt(r.totalGain)} · 消耗 ${fmt(Object.values(r.spendCosts).reduce((a, b) => a + b, 0))} · 剩余 ${fmt(r.remaining)}`
            : `初始 ${resource.initialValue ?? 0}`,
          rows: [
            ...resource.gainRules.map(rule => ({
              label: '获取',
              value: r ? fmt(r.gains[rule.id ?? ''] ?? 0) : String(rule.amount ?? ''),
              detail: rule.formula ?? rule.trigger,
            })),
            ...resource.spendRules.map(rule => ({
              label: '消耗',
              value: r ? fmt(r.spendCounts[rule.id ?? ''] ?? 0, 1) : String(rule.cost ?? ''),
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
    return String(readCfgField(cfg, event.carrierField) ?? '')
  }
  return event.carrierMoveId ?? ''
}

function resolveEventCount(
  event: EventSpec,
  state: IterationState,
  counts: SpecEventCounts,
): number {
  const direct = counts[event.countField ?? event.id]
  if (direct != null) {
    return Math.max(0, Math.floor(direct))
  }
  if (event.countField) {
    return 0
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
