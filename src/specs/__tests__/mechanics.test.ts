import { describe, expect, it } from 'vitest'
import { emptyPanel } from '@/core/panel'
import { getAgentSpec } from '@/specs/registry'
import {
  buildSpecAnomalyEvents,
  buildSpecEventExecutions,
  buildSpecResourceSections,
  specToMechanicModule,
} from '@/specs/mechanics'
import { nekomataMechanic } from '@/mechanics/agents/nekomata'
import type { AgentMechanicSpec } from '@/specs/types'
import type { CharacterOperationConfig, IterationState } from '@/types/resource'

describe('spec mechanics interpreter', () => {
  it('builds resource sections from spec resources', () => {
    const spec = getAgentSpec('1561')!
    const sections = buildSpecResourceSections(spec)

    expect(sections.some(section => section.id === 'velina_floria')).toBe(true)
    expect(sections.some(section => section.id === 'velina_corrosion')).toBe(true)
  })

  it('builds anomaly events from count sources', () => {
    const spec: AgentMechanicSpec = {
      schemaVersion: 1,
      id: 'agent:test',
      name: 'Test',
      agentIds: ['test'],
      status: 'implemented',
      attributeConversions: [],
      resources: [],
      rowFusions: [],
      events: [{
        id: 'test_ult',
        name: 'Ult Event',
        trigger: 'ultimate',
        eventType: 'release',
        countSource: 'ultimateCount',
        carrierField: 'ultimateMoveId',
        fields: ['ultimateCount'],
        status: 'implemented',
      }],
      verifications: [],
      stateMachines: [],
      notes: [],
    }
    const cfg = { ultimateMoveId: 'ult_001' } as unknown as CharacterOperationConfig
    const state = { ultimateCount: 2 } as unknown as IterationState

    const events = buildSpecAnomalyEvents(spec, cfg, state)

    expect(events[0].count).toBe(2)
    expect(events[0].carrierMoveId).toBe('ult_001')
  })

  it('converts a spec into an AgentMechanicModule', () => {
    const spec = getAgentSpec('1401')!
    const module = specToMechanicModule(spec)
    const panel = emptyPanel()
    panel.anomalyMastery = 150

    module.applyPanel?.({ slot: 0, agent: null as any, cinemaLevel: 0, team: [], outOfCombatPanel: panel, panel, settings: {} })

    expect(panel.anomalyProficiency).toBeCloseTo(16)
    expect(module.resourceSections?.({ result: null as any })).toHaveLength(1)
  })

  it('generates Nekomata resource spend executions from spec counts（2026-08-23 口供：单载体 1021019，30/40 档预算分配）', () => {
    const spec = getAgentSpec('1021')!
    const cfg = {
      mechanicRowValues: {
        '1021019': 800,
      },
    } as unknown as CharacterOperationConfig
    const state = {
      frontlineTime: 30,
      exSpecialCount: 2,
      ultimateCount: 1,
      chainCountTotal: 5,
    } as unknown as IterationState

    // 1021 是自定义 TS 模块角色：真实消费者是 nekomataMechanic（spec 解释器不单独驱动它）
    const module = nekomataMechanic
    const executions: any[] = []
    module.buildExecutions?.({ cfg, state, executions })

    // 预算 = 白送60 + 初始40 + 30 + 10 + 20 + 50 = 210？——本单测未注入命中回复/接战规则按 spec：
    // 初始40 + 前台白送60 + 终结20 + 连携50 + 强特10 = 180；默认占比 -1 → 自动覆盖率 0 → 全 30 档
    // 门控不建模：floor(180/30) = 6 发，载体只有绒爪穿刺
    const pierce = executions.find(e => e.moveId === '1021019')!
    expect(pierce.count).toBe(6)
    expect(pierce.damageMultiplier).toBe(800)
    expect(pierce.actionTime).toBeCloseTo(1.5666, 4)
    // 旧实现曾把尾巴失踪术错挂终结技 1021012 产出行——解释器层不得再出现
    expect(executions.some(e => e.moveId === '1021012')).toBe(false)
  })

  it('filters events by enabled field and zero count', () => {
    const spec: AgentMechanicSpec = {
      schemaVersion: 1,
      id: 'agent:filter',
      name: 'Filter',
      agentIds: ['filter'],
      status: 'implemented',
      attributeConversions: [],
      resources: [],
      rowFusions: [],
      events: [
        {
          id: 'disabled_event',
          name: 'Disabled',
          trigger: 'none',
          eventType: 'release',
          countSource: 'fixed',
          count: 1,
          enabledField: 'extraEnabled',
          status: 'implemented',
        },
        {
          id: 'zero_event',
          name: 'Zero',
          trigger: 'none',
          eventType: 'release',
          countSource: 'fixed',
          count: 0,
          status: 'implemented',
        },
      ],
      verifications: [],
      stateMachines: [],
      notes: [],
    }
    const cfg = { extraEnabled: false } as unknown as CharacterOperationConfig
    const state = { ultimateCount: 0 } as unknown as IterationState

    expect(buildSpecAnomalyEvents(spec, cfg, state)).toHaveLength(0)

    const enabledCfg = { extraEnabled: true } as unknown as CharacterOperationConfig
    expect(buildSpecAnomalyEvents(spec, enabledCfg, state)).toHaveLength(1)
  })

  it('builds executions from event-to-multiplier mappings', () => {
    const spec: AgentMechanicSpec = {
      schemaVersion: 1,
      id: 'agent:event-exec',
      name: 'EventExec',
      agentIds: ['event-exec'],
      status: 'implemented',
      attributeConversions: [],
      resources: [],
      rowFusions: [],
      events: [
        {
          id: 'scaled_event',
          name: 'Scaled',
          trigger: 'x',
          eventType: 'direct_damage',
          executionKind: 'execution',
          countField: 'scaledCount',
          carrierMoveId: 'm1',
          multiplierRatio: 0.3,
          status: 'implemented',
        },
        {
          id: 'overridden_event',
          name: 'Override',
          trigger: 'y',
          eventType: 'direct_damage',
          executionKind: 'execution',
          countField: 'overrideCount',
          carrierMoveId: 'm2',
          status: 'implemented',
        },
      ],
      verifications: [],
      stateMachines: [],
      notes: [],
    }
    const cfg = {} as CharacterOperationConfig
    const state = {} as IterationState

    const executions = buildSpecEventExecutions(spec, {
      cfg,
      state,
      counts: { scaledCount: 2, overrideCount: 1 },
      overrides: { overridden_event: { multiplier: 555 } },
      getRowValue: moveId => (moveId === 'm1' ? 1000 : 0),
    })

    expect(executions).toHaveLength(2)
    expect(executions[0].moveId).toBe('m1')
    expect(executions[0].count).toBe(2)
    expect(executions[0].damageMultiplier).toBe(300)
    expect(executions[0].damageMultiplierOverride).toBe(true)
    expect(executions[1].damageMultiplier).toBe(555)
    expect(executions[1].damageMultiplierOverride).toBe(true)
  })
})
