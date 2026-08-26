import { describe, expect, it } from 'vitest'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { simulateVelinaCorrosionState } from '@/mechanics/agents/velina'
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
