import { describe, expect, it } from 'vitest'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { simulateVelinaCorrosionState, velinaMechanic } from '@/mechanics/agents/velina'
import { setupHarness } from '@/test/harness'

/** 维琳娜（风）+ 格莉丝（电异常，触发额外能力 + 提供非风异常触发 → 乱流） */
async function setup(cinemaLevel = 0) {
  const result = await setupHarness([
    { agentId: '1561', cinemaLevel, parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
    { agentId: '1181', cinemaLevel: 0, parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
  ])
  for (const buff of result.config.globalBuffs) buff.enabled = false
  return result
}

describe('维琳娜（1561）风蚀状态机', () => {
  it('2点风蚀消耗→广域气旋 + 强化乱流（boosted=广域），0/1点→微域', () => {
    const c0 = simulateVelinaCorrosionState(6, 3, false, false)
    expect(c0.broadCycloneCount).toBe(2) // 6次乱流：微域、微域、广域、微域、微域、广域
    expect(c0.microCycloneCount).toBe(4)
    expect(c0.boostedTurbulenceCount).toBe(c0.broadCycloneCount)
    expect(c0.cinema6RefundCount).toBe(0)
    expect(c0.finalCorrosion).toBe(0)
  })

  it('影画6：消耗2风蚀返还1点，返还参与后续循环（多换广域）', () => {
    const c0 = simulateVelinaCorrosionState(12, 6, false, false)
    const c6 = simulateVelinaCorrosionState(12, 6, false, true)
    expect(c6.cinema6RefundCount).toBeGreaterThan(0)
    // 6命返还让风蚀更快攒满 → 广域气旋不少于 0 命
    expect(c6.broadCycloneCount).toBeGreaterThanOrEqual(c0.broadCycloneCount)
    expect(c6.boostedTurbulenceCount).toBe(c6.broadCycloneCount)
  })

  it('影画2：风化获得风蚀按期望摊入（2/3 利用率）', () => {
    const c2 = simulateVelinaCorrosionState(6, 6, true, false)
    expect(c2.c2WindGainExpected).toBeCloseTo(6 * (2 / 3), 6)
  })
})

describe('维琳娜风化伤害与命座', () => {
  it('风化本体伤害行存在（1250% 单次）', async () => {
    await setup(0)
    const calc = useResourceCalc()
    const windRows = calc.damagePoolRows.value.filter(r => r.type === '风化')
    expect(windRows.length).toBeGreaterThan(0)
    for (const row of windRows) {
      expect(row.totalDamage).toBeGreaterThan(0)
      expect(row.element).toBe('wind')
    }
  })

  it('影画6：再次施加风化增伤（6命风化伤害 > 0命）', async () => {
    const windTotal = async (cinema: number) => {
      await setup(cinema)
      const calc = useResourceCalc()
      return calc.damagePoolRows.value
        .filter(r => r.type === '风化')
        .reduce((sum, r) => sum + (r.totalDamage ?? 0), 0)
    }
    const d0 = await windTotal(0)
    const d6 = await windTotal(6)
    // 6命：对风化状态敌人再次施加风化按剩余时长增伤（每1s+2.5%，最多40%）
    expect(d6).toBeGreaterThan(d0)
  })

  it('影画1：全队风化伤害无视20%风抗（1命风化伤害 > 0命）', async () => {
    const windTotal = async (cinema: number) => {
      await setup(cinema)
      const calc = useResourceCalc()
      return calc.damagePoolRows.value
        .filter(r => r.element === 'wind' && (r.type === '风化' || r.type === '异放'))
        .reduce((sum, r) => sum + (r.totalDamage ?? 0), 0)
    }
    const d0 = await windTotal(0)
    const d1 = await windTotal(1)
    // 1命：panel.enemyWindResReduction +20 → 风属性伤害提升
    expect(d1).toBeGreaterThan(d0)
  })
})

describe('维琳娜滑块生效差分（防守卫冻结，SOP §3.5）', () => {
  it('velina.cinema2CorrosionRate → 影画2风触侵蚀差分（c2WindGainExpected 随比率线性）', () => {
    const base = { turbulence: 6, windTriggers: 9, cinema6: false } as const
    const full = simulateVelinaCorrosionState(base.turbulence, base.windTriggers, true, base.cinema6, 1)
    const half = simulateVelinaCorrosionState(base.turbulence, base.windTriggers, true, base.cinema6, 0.5)
    const off = simulateVelinaCorrosionState(base.turbulence, base.windTriggers, true, base.cinema6, 0)
    expect(full.c2WindGainExpected).toBeCloseTo(9, 5)
    expect(half.c2WindGainExpected).toBeCloseTo(4.5, 5)
    expect(off.c2WindGainExpected).toBe(0)
    expect(full.c2WindGainExpected).toBeGreaterThan(off.c2WindGainExpected)
  })
})

// CC-36b 2026-09-27：两条命座规则从 core / 编排层迁入模块后，由这里锁住数值（perf 语料里 1 命只在 c6 档与 6 命同时出现，分不开）。
describe('维琳娜 CC-36b：乱流抗性无视面板字段 / 风化事件加成能力', () => {
  const panelAfter = (cinemaLevel: number) => {
    const panel: Record<string, number> = {}
    velinaMechanic.applyPanel!({ slot: 0, agent: { damageElement: 'wind' }, cinemaLevel, team: [], panel } as never)
    return panel
  }
  it('1 命起写 turbulenceResIgnore = 20，0 命为 0', () => {
    expect(panelAfter(0).turbulenceResIgnore).toBe(0)
    expect(panelAfter(1).turbulenceResIgnore).toBe(20)
    expect(panelAfter(6).turbulenceResIgnore).toBe(20)
  })
  it('6 命 windAnomalyBonus：平均剩余时长 × 2.5%/s（上限 40），文案逐字', () => {
    const bonus = velinaMechanic.windAnomalyBonus!({ panel: { velinaCinema6: 1 } as never, triggerCount: 2 })
    // 平均剩余 = 30 × (2−1)/2 / 2 = 7.5s → 18.75%
    expect(bonus?.pct).toBeCloseTo(18.75, 10)
    expect(bonus?.note).toBe(' · 6命风化期望+18.8%（平均剩余7.5s）')
  })
  it('非 6 命 / 触发 ≤1 次 / 无面板 → null', () => {
    expect(velinaMechanic.windAnomalyBonus!({ panel: { velinaCinema6: 0 } as never, triggerCount: 5 })).toBeNull()
    expect(velinaMechanic.windAnomalyBonus!({ panel: { velinaCinema6: 1 } as never, triggerCount: 1 })).toBeNull()
    expect(velinaMechanic.windAnomalyBonus!({ panel: undefined, triggerCount: 5 })).toBeNull()
  })
})
