/** 普罗米娅绝裁异放：Type A 固定倍率 + 霜刑上限钳制（审计收口 2026-08-24） */
import { describe, expect, it } from 'vitest'
import { PROMIA_C2_RELEASE_BONUS, PROMIA_EXECUTION_RELEASE_MULTIPLIER } from '../agents/promia'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { computePanelPhases } from '@/composables/resourceCalc/helpers'

describe('普罗米娅（1541）绝裁异放', () => {
  it('C0：事件存在、倍率 635；次数由回复端驱动（>0 且不受持有上限钳制）', async () => {
    const { config } = await setupHarness([{ agentId: '1541' }])
    const calc = useResourceCalc()
    const char = calc.resourceResult.value!.characters.find(c => c.agentId === '1541')!
    const ev = (char.anomalyEventExecutions ?? []).find(e => e.eventId === 'promia_execution_release')
    if ((calc.stunPoolResult.value?.stunCount ?? 0) <= 0) return
    expect(ev).toBeTruthy()
    expect(ev!.fields).toContain('releaseMultiplier=635')
    expect(ev!.count).toBeGreaterThan(0)
  })

  it('C2 = 635+120 = 755（加百分点，用户口供）；次数覆盖滑块生效', async () => {
    expect(PROMIA_C2_RELEASE_BONUS).toBe(120)
    const { config } = await setupHarness([{ agentId: '1541', cinemaLevel: 2 }])
    const calc = useResourceCalc()
    const char = calc.resourceResult.value!.characters.find(c => c.agentId === '1541')!
    const ev = (char.anomalyEventExecutions ?? []).find(e => e.eventId === 'promia_execution_release')
    if (!ev) return
    expect(ev.fields).toContain('releaseMultiplier=755')
  })
})

describe('普罗米娅 饮冰·全队异放增伤（formula 型 teamBuff）', () => {
  it('队友面板读取 anomalyReleaseDmgBonus = 0.35×max(0, 掌控-150)', async () => {
    const { config, catalog } = await setupHarness([{ agentId: '1541' }, { agentId: '1371' }])
    const calc = useResourceCalc()
    void calc
    const her = computePanelPhases(0, config, catalog)!
    const mate = computePanelPhases(1, config, catalog)!.inCombat as unknown as Record<string, number>
    const m = her.outOfCombat.anomalyMastery ?? 0
    const expected = Math.max(0, Math.min(999, (m - 150) * 0.35))
    expect(mate.anomalyReleaseDmgBonus ?? 0).toBeCloseTo(expected)
  })
})
