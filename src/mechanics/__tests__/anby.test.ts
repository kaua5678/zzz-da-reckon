import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import {
  computeAnbyParallelCircuitEnergy,
  computeAnbyC4ChargeEnergy,
  ANBY_CORE_STUN_BONUS,
} from '../agents/anby'

describe('安比（1011）并联电路/电荷传导 纯函数', () => {
  it('并联电路：min(闪反次数, floor(t/5)) × 7.2', () => {
    // 180s → floor(180/5)=36 上限；闪反 10 次 → 10×7.2=72
    expect(computeAnbyParallelCircuitEnergy(10, 180)).toBeCloseTo(72)
    // 闪反 40 次 → 被 36 上限钳制
    expect(computeAnbyParallelCircuitEnergy(40, 180)).toBeCloseTo(36 * 7.2)
  })

  it('电荷传导：3 + min(6, floor(能量效率/12)×2)', () => {
    expect(computeAnbyC4ChargeEnergy(0)).toBe(3)
    expect(computeAnbyC4ChargeEnergy(12)).toBe(5)
    expect(computeAnbyC4ChargeEnergy(36)).toBe(9) // 3 + min(6, 6) = 9
    expect(computeAnbyC4ChargeEnergy(100)).toBe(9) // 封顶 +6
  })
})

describe('安比（1011）波动电压/影画2 招式限定（patchExecutions）', () => {
  it('核心被动波动电压：强特 + 落雷所在 basic 聚合行 失衡值 +64（招式限定全覆盖）', async () => {
    await setupHarness([
      { agentId: '1011', cinemaLevel: 0, dodgeCounterCount: 6, parryCount: 10 },
      { agentId: '1381' }, // 零号·安比（电，同属性 → 触发并联电路）
      { agentId: '1211' }, // 丽娜（电，同属性）
    ])
    const calc = useResourceCalc()
    const anby = calc.resourceResult.value!.characters.find(c => c.agentId === '1011')!
    const ex = anby.executions.find(e => e.moveId === '1011007')
    const basic = anby.executions.find(e => e.moveId === 'basic_attack')
    expect(ex).toBeTruthy()
    expect(basic).toBeTruthy()
    expect(ex!.stunBuildUpBonus ?? 0).toBe(ANBY_CORE_STUN_BONUS)
    expect(basic!.stunBuildUpBonus ?? 0).toBe(ANBY_CORE_STUN_BONUS)
  })

  it('影画2：0 命无增伤，2 命落雷伤害 +30×覆盖 / 强特失衡 +10×(1-覆盖)', async () => {
    await setupHarness([
      { agentId: '1011', cinemaLevel: 0, dodgeCounterCount: 6 },
      { agentId: '1381' },
      { agentId: '1211' }, // 丽娜（电，同属性）
    ])
    let calc = useResourceCalc()
    const c0 = calc.resourceResult.value!.characters.find(c => c.agentId === '1011')!
    const basic0 = c0.executions.find(e => e.moveId === 'basic_attack')
    expect((basic0?.dmgBonus ?? 0)).toBe(0)

    await setupHarness([
      { agentId: '1011', cinemaLevel: 2, dodgeCounterCount: 6 },
      { agentId: '1381' },
      { agentId: '1211' },
    ])
    calc = useResourceCalc()
    const c2 = calc.resourceResult.value!.characters.find(c => c.agentId === '1011')!
    const basic2 = c2.executions.find(e => e.moveId === 'basic_attack')
    // 默认覆盖率 0.5 → +15
    expect((basic2?.dmgBonus ?? 0)).toBeGreaterThan(0)
  })
})
