import { describe, expect, it } from 'vitest'
import { antonMechanic, ANTON_ADDITIONAL_SHOCK_RATIO, ANTON_C6_MOVE_IDS, ANTON_DRILL_MOVE_IDS, ANTON_PILE_MOVE_IDS } from '@/mechanics/agents/anton'
import type { SkillExecution } from '@/types/resource'

function exec(moveId: string, count = 1): SkillExecution {
  return { moveId, moveName: moveId, category: 'basic', count, actionTime: 1, comboAlignRatio: 0, totalTime: count, totalComboAlignTime: 0, energyConsume: 0, totalEnergyConsume: 0, decibelRecovery: 0, totalDecibelRecovery: 0, energyRecovery: 0, totalEnergyRecovery: 0 }
}

describe('安东（1111）简单机制', () => {
  it('依据 catalog 精确 moveId 施加打桩/电钻增伤，且 C6 只命中爆发普攻与爆发闪反', () => {
    const executions = [exec('1111006'), exec('1111010'), exec('1111015'), exec('1111001')]
    antonMechanic.patchExecutions!({ cfg: { agentId: '1111', antonCinemaLevel: 6 } as any, state: {} as any, executions })
    expect(executions[0].dmgBonus).toBe(48)
    expect(executions[1].dmgBonus).toBe(40)
    expect(executions[2].dmgBonus).toBe(64)
    expect(executions[3].dmgBonus).toBeUndefined()
  })

  it('C1 每个实际电钻执行行最多回5能量，不按 hit 放大并写入 cfg 总账', () => {
    const executions = [exec('1111010', 8), exec('1111019', 2)]
    const cfg: any = { agentId: '1111', antonCinemaLevel: 1, battleTime: 180 }
    antonMechanic.patchExecutions!({ cfg, state: { chainCountTotal: 0, ultimateCount: 0 } as any, executions })
    expect(cfg.antonC1EnergyGift).toBe(10)
    expect(cfg.antonC1DrillMoveCount).toBe(10)
  })

  it('精确 moveId 常量覆盖 catalog 的打桩、电钻和 C6 行', () => {
    expect([...ANTON_PILE_MOVE_IDS]).toEqual(['1111006', '1111007', '1111008'])
    expect([...ANTON_DRILL_MOVE_IDS]).toEqual(['1111010', '1111015', '1111019'])
    expect([...ANTON_C6_MOVE_IDS]).toEqual(['1111006', '1111007', '1111008', '1111015'])
  })

  it('额外能力·通力合作：命中数/4 触发感电追加 release（默认满触发，滑块与门控生效）', () => {
    const executions = [exec('1111010', 8), exec('1111019', 4)]
    const events: any[] = []
    // 默认（无 setting → 满触发）：12 次电钻命中 → 3 次
    const cfg: any = { agentId: '1111', antonCinemaLevel: 0, panel: { additionalAbilityActive: 1 } }
    antonMechanic.patchExecutions!({ cfg, state: {} as any, executions })
    antonMechanic.buildAnomalyEvents!({ cfg, state: {} as any, events, totalTime: 180 } as any)
    expect(events).toHaveLength(1)
    expect(events[0].count).toBe(3)
    expect(events[0].eventType).toBe('release')
    expect(events[0].element).toBe('electric')
    expect(events[0].formula).toContain(String(ANTON_ADDITIONAL_SHOCK_RATIO))
    // 滑块 50%：12/4 × 0.5 → 1 次（滑块确实改变结果）
    const eventsHalf: any[] = []
    const cfgHalf: any = { agentId: '1111', antonCinemaLevel: 0, panel: { additionalAbilityActive: 1 }, 'setting:anton.additionalShockRatio': 0.5 }
    antonMechanic.patchExecutions!({ cfg: cfgHalf, state: {} as any, executions: [exec('1111010', 8), exec('1111019', 4)] })
    antonMechanic.buildAnomalyEvents!({ cfg: cfgHalf, state: {} as any, events: eventsHalf, totalTime: 180 } as any)
    expect(eventsHalf[0].count).toBe(1)
    // 门控：同属性/同阵营队友不在队 → 不触发
    const eventsNoAa: any[] = []
    antonMechanic.buildAnomalyEvents!({ cfg: { agentId: '1111', panel: { additionalAbilityActive: 0 } }, state: {} as any, events: eventsNoAa, totalTime: 180 } as any)
    expect(eventsNoAa).toHaveLength(0)
  })
})
