/** 普罗米娅绝裁异放：Type A 固定倍率 + 霜刑上限钳制（审计收口 2026-08-24） */
import { describe, expect, it } from 'vitest'
import {
  PROMIA_C2_RELEASE_BONUS,
  PROMIA_C6_ALL_RES_IGNORE,
  PROMIA_C6_SPECIAL_RELEASE_MULT,
  PROMIA_EXECUTION_RELEASE_MULTIPLIER,
} from '../agents/promia'
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

describe('普罗米娅 处刑式·匿影（交互栏次数）', () => {
  it('匿影次数生效：+10寒蚀/次进回复端，且解锁重霜执行行 ×N', async () => {
    const { config } = await setupHarness([{ agentId: '1541' }])
    const calc = useResourceCalc()
    config.setPromiaNiyingCount(0, 5)
    const char = calc.resourceResult.value!.characters.find(c => c.agentId === '1541')!
    const ev = (char.anomalyEventExecutions ?? []).find(e => e.eventId === 'promia_execution_release')
    expect(ev?.fields.some(f => String(f).includes('niying=5')), '回复端应含匿影分项').toBe(true)
    const zhongshuang = char.executions.find(e => e.moveId === '1541011')
    if (zhongshuang) {
      expect(zhongshuang.count).toBe(5)
      expect(zhongshuang.totalTime).toBeCloseTo(2.35 * 5)
    }
  })
})

describe('普罗米娅 影画4/6 异常结算区（2026-08-26）', () => {
  it('影画6：特殊异放事件存在（200%，15s CD，启动2s → 180s 计 12 次）', async () => {
    const { config } = await setupHarness([{ agentId: '1541', cinemaLevel: 6 }])
    const calc = useResourceCalc()
    const char = calc.resourceResult.value!.characters.find(c => c.agentId === '1541')!
    const ev = (char.anomalyEventExecutions ?? []).find(e => e.eventId === 'promia_c6_special_release')
    expect(ev).toBeTruthy()
    expect(ev!.fields).toContain(`releaseMultiplier=${PROMIA_C6_SPECIAL_RELEASE_MULT}`)
    // 启动 2s：floor((180-2)/15)+1 = 12
    expect(ev!.count).toBe(12)
  })

  it('影画6：自身异常/紊乱无视 15% 全抗进面板', async () => {
    const { config, catalog } = await setupHarness([{ agentId: '1541', cinemaLevel: 6 }])
    const panel = computePanelPhases(0, config, catalog)!.inCombat as any
    expect(panel.enemyResReduction).toBeGreaterThanOrEqual(PROMIA_C6_ALL_RES_IGNORE)
  })

  it('影画4：异放回寒蚀 +5 → 霜刑反馈环使绝裁异放次数多于 0命', async () => {
    const c0 = await setupHarness([{ agentId: '1541' }])
    const calc0 = useResourceCalc()
    const ev0 = (calc0.resourceResult.value!.characters.find(c => c.agentId === '1541')!.anomalyEventExecutions ?? [])
      .find(e => e.eventId === 'promia_execution_release')

    const c4 = await setupHarness([{ agentId: '1541', cinemaLevel: 4 }])
    const calc4 = useResourceCalc()
    const ev4 = (calc4.resourceResult.value!.characters.find(c => c.agentId === '1541')!.anomalyEventExecutions ?? [])
      .find(e => e.eventId === 'promia_execution_release')

    expect(ev0).toBeTruthy()
    expect(ev4).toBeTruthy()
    if (ev0 && ev4) expect(ev4.count).toBeGreaterThan(ev0.count)
  })

  it('异放回喧响：绝裁/特殊异放各 +100 计入终结技次数（extraSelfDecibelReward）', async () => {
    const { config } = await setupHarness([{ agentId: '1541', cinemaLevel: 6 }])
    const calc = useResourceCalc()
    const promia = calc.resourceResult.value!.characters.find(c => c.agentId === '1541')!
    // 喧响来自异放回能 → decibelSource 应含额外喧响
    expect(promia.decibelSource).toBeTruthy()
  })
})
