import { describe, expect, it } from 'vitest'
import { computeDefaultSubStats, getTemplate, type SubstatTemplate } from '@/core/substatOptimizer'
import type { Agent } from '@/types/catalog'

const dpsTemplate: SubstatTemplate = {
  stats: ['critRate', 'critDmg', 'atkPct', 'penFlat'],
  dmgBonusRelevant: true,
  anomalyRelevant: false,
  anomalyRatio: 0,
}
const anomalyTemplate: SubstatTemplate = {
  stats: ['anomalyProficiency', 'atkPct'],
  dmgBonusRelevant: true,
  anomalyRelevant: true,
  anomalyRatio: 0.85,
}

function mockAgent(id: string, specialty: string): Agent {
  return { id, specialty } as Agent
}

describe('computeDefaultSubStats · 快速默认词条分配', () => {
  it('暴击 DPS：暴击/爆伤/攻击按序顶满 statCap，剩余给第四词条（暴击不「够了就停」）', () => {
    const alloc = computeDefaultSubStats(dpsTemplate, 43, 20)
    expect(alloc).toEqual({ critRate: 20, critDmg: 20, atkPct: 3, penFlat: 0 })
  })

  it('异常角色：精通顶满 + 攻击吃剩余', () => {
    const alloc = computeDefaultSubStats(anomalyTemplate, 32, 20)
    expect(alloc).toEqual({ anomalyProficiency: 20, atkPct: 12 })
  })

  it('预算不足：只按优先序填到预算耗尽', () => {
    const alloc = computeDefaultSubStats(dpsTemplate, 25, 20)
    expect(alloc).toEqual({ critRate: 20, critDmg: 5, atkPct: 0, penFlat: 0 })
  })

  it('转模角色模板：卢西娅 hpPct 首位 / 洛克茜 defPct 首位 / 伊德海莉 hpPct 首位', () => {
    expect(getTemplate(mockAgent('1451', 'support')).stats[0]).toBe('hpPct')
    expect(getTemplate(mockAgent('1621', 'stun')).stats[0]).toBe('defPct')
    expect(getTemplate(mockAgent('1051', 'rupture')).stats[0]).toBe('hpPct')
  })

  it('普通辅助/击破默认模板：辅助攻击优先、击破暴击优先', () => {
    expect(getTemplate(mockAgent('9991', 'support')).stats[0]).toBe('atkPct')
    expect(getTemplate(mockAgent('9992', 'stun')).stats[0]).toBe('critRate')
  })
})
