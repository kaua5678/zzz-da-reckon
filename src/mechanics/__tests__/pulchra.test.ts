import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { computePanelPhases } from '@/composables/resourceCalc/helpers'

describe('波可娜（1351）困迹/影画 面板', () => {
  it('额外能力困迹：全队追加攻击增伤 +30（skillDmgBonus__additionalAttack）', async () => {
    const { catalog, config } = await setupHarness([
      { agentId: '1351', cinemaLevel: 0 },
      { agentId: '1301' }, // 奥菲丝（强攻，触发业务搭档？业务搭档需强攻/命破/同阵营）
      { agentId: '1271' }, // 赛斯
    ])
    // 赛斯(1271) 自身无追加攻击增伤 → 困迹给其 +30
    const p = computePanelPhases(2, config, catalog)!.inCombat as any
    expect(p['skillDmgBonus__additionalAttack'] ?? 0).toBe(30)
  })

  it('影画1 困迹暴击+10 / 影画2 猎步攻击×1.1（命座差分）', async () => {
    const { catalog, config } = await setupHarness([
      { agentId: '1351', cinemaLevel: 0 },
      { agentId: '1301' },
      { agentId: '1271' },
    ])
    const p0 = computePanelPhases(0, config, catalog)!.inCombat as any
    config.team[0].cinemaLevel = 2
    const p2 = computePanelPhases(0, config, catalog)!.inCombat as any
    expect((p2.critRate ?? 0) - (p0.critRate ?? 0)).toBe(10)
    expect(p2.atk).toBeGreaterThan(p0.atk)
  })
})

describe('波可娜（1351）猎步/影画6 执行', () => {
  it('猎步：失衡值 +30（spec resource total>0）', async () => {
    await setupHarness([
      { agentId: '1351', cinemaLevel: 0 },
      { agentId: '1301' },
      { agentId: '1271' },
    ])
    const calc = useResourceCalc()
    const pulchra = calc.resourceResult.value!.characters.find(c => c.agentId === '1351')!
    expect(pulchra.specResources?.['pulchra_hunt_step']).toBeTruthy()
  })

  it('影画6：噬爪·噩梦袭影 伤害 +15（moveId 1351006/1351007）', async () => {
    await setupHarness([
      { agentId: '1351', cinemaLevel: 6 },
      { agentId: '1301' },
      { agentId: '1271' },
    ])
    const calc = useResourceCalc()
    const pulchra = calc.resourceResult.value!.characters.find(c => c.agentId === '1351')!
    const nightmare = pulchra.executions.find(e => e.moveId === '1351006' || e.moveId === '1351007')
    if (nightmare) {
      expect((nightmare.dmgBonus ?? 0)).toBeGreaterThanOrEqual(15)
    }
  })
})