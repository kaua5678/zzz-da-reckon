/**
 * CC-78：赠送极性强击注入异常池不再要求 anomalyPoolSetup 声明者（原 roundInputs `setup &&`）。
 * 手法：队里没有爱丽丝（无 setup），临时给莱卡恩 1141（槽 1）挂 giftedPolarAssaultCount = 2（afterEach 还原），
 * 整管线后异常池应出现 physical_polar_assault 赠送 2 次、全记在槽 1。换回旧实现 ⇒ 无该元素 ⇒ 红。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { getAgentMechanic } from '@/mechanics'
import type { AgentMechanicModule } from '@/mechanics/types'
import { firstGiftedPolarAssaultSlot } from '@/composables/resourceCalc/giftedPolarAssault'
import type { CharacterResourceResult } from '@/types/resource'

type Hook = AgentMechanicModule['giftedPolarAssaultCount']
let patched: { m: AgentMechanicModule; orig: Hook } | undefined
afterEach(() => { if (patched) patched.m.giftedPolarAssaultCount = patched.orig; patched = undefined })

describe('CC-78 赠送与 anomalyPoolSetup 解耦', () => {
  it('firstGiftedPolarAssaultSlot：第一个赠送 > 0 的槽；无 ⇒ undefined', () => {
    const alice = { agentId: '1401', slot: 2, aliceSwordWillSource: { sparkCount: 3 } } as unknown as CharacterResourceResult
    const zero = { agentId: '1401', slot: 0, aliceSwordWillSource: { sparkCount: 0 } } as unknown as CharacterResourceResult
    const other = { agentId: '1141', slot: 1 } as unknown as CharacterResourceResult
    expect(firstGiftedPolarAssaultSlot([zero, other, alice])).toBe(2)
    expect(firstGiftedPolarAssaultSlot([zero, other])).toBeUndefined()
  })

  it('无爱丽丝、只有别的模块赠送：照样注入异常池并记在该槽', async () => {
    const m = getAgentMechanic('1141')!
    patched = { m, orig: m.giftedPolarAssaultCount }
    m.giftedPolarAssaultCount = () => 2
    await setupHarness([
      { agentId: '1041', cinemaLevel: 0, potentialLevel: 6 },
      { agentId: '1141', cinemaLevel: 0, potentialLevel: 6 },
      { agentId: '1211', cinemaLevel: 0, potentialLevel: 6 },
    ])
    const calc = useResourceCalc() as unknown as { anomalyPoolResult: { value: { perElement: Array<{ element: string; triggerCount: number; perSlotTriggerCounts: number[]; totalBuildUp: number }> } | null } }
    const pool = calc.anomalyPoolResult.value
    expect(pool, '异常池应存在').toBeTruthy()
    const gifted = pool!.perElement.find(e => e.element === 'physical_polar_assault' && e.totalBuildUp === 0)
    expect(gifted, '应有赠送的极性强击条目').toBeTruthy()
    expect(gifted!.triggerCount).toBe(2)
    expect(gifted!.perSlotTriggerCounts[1]).toBe(2)
  }, 60000)
})
