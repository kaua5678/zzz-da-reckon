import { describe, expect, it } from 'vitest'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { setupHarness } from '@/test/harness'
import { computeRemielleMechanic } from '@/mechanics/agents/remielle'

async function setup() {
  const result = await setupHarness([
    { agentId: '1581', parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
    { agentId: '1331', parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
    '',
  ])
  for (const buff of result.config.globalBuffs) buff.enabled = false
  return result
}

describe('蕾米埃尔（1581）虚曜·耀变·异化系数', () => {
  it('异化系数 = 异常精通×0.02%；耀变倍率提升 = 异常精通×0.1%', () => {
    const s = computeRemielleMechanic({ anomalyProficiency: 500 })
    expect(s.refringeCoefficient).toBeCloseTo(10, 5)
    expect(s.luminizeMultiplierBonus).toBeCloseTo(50, 5)
    expect(s.voidflareStored).toBe(3)
    expect(s.voidflareMax).toBe(3)

    const zero = computeRemielleMechanic({ anomalyProficiency: 0 })
    expect(zero.refringeCoefficient).toBe(0)
    expect(zero.luminizeMultiplierBonus).toBe(0)
  })

  it('完整计算链：资源池带 remielleMechanicSource，虚耀账本随精通缩放', async () => {
    await setup()
    const calc = useResourceCalc()
    const row = calc.resourceResult.value!.characters.find(ch => ch.agentId === '1581')!
    expect(row.remielleMechanicSource).toBeTruthy()
    expect(row.remielleMechanicSource!.voidflareMax).toBe(3)
    expect(row.remielleMechanicSource!.refringeCoefficient).toBeGreaterThanOrEqual(0)
  })
})
