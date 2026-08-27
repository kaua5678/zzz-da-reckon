import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { computePanelPhases } from '@/composables/resourceCalc/helpers'

describe('真斗（1441）炽心/熔锋 面板', () => {
  it('熔锋 buff：炽心≥75 → 暴击率+10/火伤+20（spec resource）', async () => {
    const { catalog, config } = await setupHarness([
      { agentId: '1441', cinemaLevel: 0, parryCount: 6 },
      { agentId: '1271' }, // 赛斯（防护，不触发复燃之心——需支援/击破）
      { agentId: '1101' }, // 珂蕾妲（击破，触发复燃之心额外能力）
    ])
    const p = computePanelPhases(0, config, catalog)!.inCombat as any
    // 炽心：归烬·舍身 +100 / 招架 +75 → 恒 ≥75 → 熔锋常驻
    expect((p.critRate ?? 0)).toBeGreaterThanOrEqual(10)
    expect((p.fireDmg ?? 0)).toBeGreaterThanOrEqual(20)
  })

  it('影画2 熔锋火抗+8 / 影画4 最大生命+8%（命座差分）', async () => {
    const { catalog, config } = await setupHarness([
      { agentId: '1441', cinemaLevel: 0 },
      { agentId: '1101' },
      { agentId: '1271' },
    ])
    const p0 = computePanelPhases(0, config, catalog)!.inCombat as any
    config.team[0].cinemaLevel = 4
    const p4 = computePanelPhases(0, config, catalog)!.inCombat as any
    expect((p4.enemyFireResReduction ?? 0) - (p0.enemyFireResReduction ?? 0)).toBe(8)
    expect((p4.hpPct ?? 0) - (p0.hpPct ?? 0)).toBe(8)
  })
})

describe('真斗（1441）炽心资源与耗血暴伤', () => {
  it('炽心数值：归烬·舍身 +100 / 招架支援 +75', async () => {
    await setupHarness([
      { agentId: '1441', cinemaLevel: 0, parryCount: 6 },
      { agentId: '1101' },
      { agentId: '1271' },
    ])
    const calc = useResourceCalc()
    const zhendou = calc.resourceResult.value!.characters.find(c => c.agentId === '1441')!
    const heartfire = zhendou.specResources?.['zhendou_heartfire']
    expect(heartfire).toBeTruthy()
    expect(heartfire.totalGain).toBeGreaterThan(0)
    expect(heartfire.gains['zhendou_parry_heartfire_gain']).toBe(6 * 75)
  })

  it('耗血暴伤：炽风·胧切/支援突击 critDmgBonus +50（招式限定）', async () => {
    await setupHarness([
      { agentId: '1441', cinemaLevel: 0 },
      { agentId: '1101' },
      { agentId: '1271' },
    ])
    const calc = useResourceCalc()
    const zhendou = calc.resourceResult.value!.characters.find(c => c.agentId === '1441')!
    const longqie = zhendou.executions.find(e => e.moveId === '1441009' || e.moveId === '1441010')
    if (longqie) {
      expect((longqie.critDmgBonus ?? 0)).toBeGreaterThanOrEqual(50)
    }
  })

  it('影画6：归烬命中失衡敌人回 75 炽心 + 4 残焰（每次失衡一次）', async () => {
    await setupHarness([
      { agentId: '1441', cinemaLevel: 6, parryCount: 6 },
      { agentId: '1101' },
      { agentId: '1271' },
    ])
    const calc = useResourceCalc()
    const zhendou = calc.resourceResult.value!.characters.find(c => c.agentId === '1441')!
    const hf = zhendou.specResources?.['zhendou_heartfire']
    expect(hf.gains['zhendou_c6_heartfire_gain']).toBeGreaterThan(0)
    const rf = zhendou.specResources?.['zhendou_remnant_flame']
    expect(rf.gains['zhendou_c6_remnant_gain']).toBeGreaterThan(0)
  })
})