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
  it('低基础暴击（30%）→ 百暴缺口大，暴击顶满 statCap，再爆伤/攻击', () => {
    // floor((100-30)/2.4)=29 → 受 statCap 20 封顶
    const alloc = computeDefaultSubStats(dpsTemplate, 30, 43, 20)
    expect(alloc).toEqual({ critRate: 20, critDmg: 20, atkPct: 3, penFlat: 0 })
  })

  it('高基础暴击（95%）→ 只补 2 条暴击到百暴，剩下给爆伤/攻击（防溢出）', () => {
    // floor((100-95)/2.4)=2
    const alloc = computeDefaultSubStats(dpsTemplate, 95, 43, 20)
    expect(alloc.critRate).toBe(2)
    expect(alloc.critDmg).toBe(20)
    expect(alloc.atkPct).toBe(20)
    expect(alloc.penFlat).toBe(1)
  })

  it('基础暴击已满（100%）→ 暴击 0 条，顺序填爆伤/攻击/穿透', () => {
    const alloc = computeDefaultSubStats(dpsTemplate, 100, 43, 20)
    expect(alloc).toEqual({ critRate: 0, critDmg: 20, atkPct: 20, penFlat: 3 })
  })

  it('异常角色：精通顶满 + 攻击吃剩余', () => {
    const alloc = computeDefaultSubStats(anomalyTemplate, 5, 32, 20)
    expect(alloc).toEqual({ anomalyProficiency: 20, atkPct: 12 })
  })

  it('预算不足：只按优先序填到预算耗尽', () => {
    const alloc = computeDefaultSubStats(dpsTemplate, 30, 25, 20)
    expect(alloc).toEqual({ critRate: 20, critDmg: 5, atkPct: 0, penFlat: 0 })
  })

  it('转模角色模板：卢西娅 hpPct 首位 / 洛克茜 defPct 首位', () => {
    expect(getTemplate(mockAgent('1451', 'support')).stats[0]).toBe('hpPct')
    expect(getTemplate(mockAgent('1621', 'stun')).stats[0]).toBe('defPct')
  })

  it('命破默认模板：暴击→爆伤→生命（贯穿吃暴击、生命是基底加法项）', () => {
    expect(getTemplate(mockAgent('1051', 'rupture')).stats).toEqual(['critRate', 'critDmg', 'hpPct'])
    expect(getTemplate(mockAgent('1531', 'rupture')).stats).toEqual(['critRate', 'critDmg', 'hpPct'])
  })

  it('普通辅助/击破默认模板：辅助攻击优先、击破暴击优先', () => {
    expect(getTemplate(mockAgent('9991', 'support')).stats[0]).toBe('atkPct')
    expect(getTemplate(mockAgent('9992', 'stun')).stats[0]).toBe('critRate')
  })
})
