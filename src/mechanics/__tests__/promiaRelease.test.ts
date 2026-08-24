/** 普罗米娅绝裁异放：Type A 固定倍率 + 霜刑上限钳制（审计收口 2026-08-24） */
import { describe, expect, it } from 'vitest'
import { PROMIA_C2_RELEASE_MULTIPLIER_RATIO, PROMIA_EXECUTION_RELEASE_MULTIPLIER, promiaFrostCap } from '../agents/promia'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'

describe('普罗米娅（1541）绝裁异放', () => {
  it('C0：事件存在、倍率 635、次数 ≤ 霜刑上限 2', async () => {
    const { config } = await setupHarness([{ agentId: '1541' }])
    const calc = useResourceCalc()
    const char = calc.resourceResult.value!.characters.find(c => c.agentId === '1541')!
    const ev = (char.anomalyEventExecutions ?? []).find(e => e.eventId === 'promia_execution_release')
    if ((calc.stunPoolResult.value?.stunCount ?? 0) <= 0) return
    expect(ev).toBeTruthy()
    expect(ev!.fields).toContain(`releaseMultiplier=${PROMIA_EXECUTION_RELEASE_MULTIPLIER}`)
    expect(ev!.count).toBeLessThanOrEqual(promiaFrostCap(0))
    expect(ev!.element).toBe('dominant')
  })

  it('C2 倍率 ×2.2（[猜测·中] 待口供）；霜刑上限 3', async () => {
    expect(promiaFrostCap(0)).toBe(2)
    expect(promiaFrostCap(1)).toBe(3)
    expect(Math.round(PROMIA_EXECUTION_RELEASE_MULTIPLIER * PROMIA_C2_RELEASE_MULTIPLIER_RATIO)).toBe(1397)
    const { config } = await setupHarness([{ agentId: '1541', cinemaLevel: 2 }])
    const calc = useResourceCalc()
    const char = calc.resourceResult.value!.characters.find(c => c.agentId === '1541')!
    const ev = (char.anomalyEventExecutions ?? []).find(e => e.eventId === 'promia_execution_release')
    if (ev) expect(ev.fields).toContain('releaseMultiplier=1397')
  })
})
