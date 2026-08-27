import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { computePanelPhases } from '@/composables/resourceCalc/helpers'
import { computePulchraHuntStepCount } from '../agents/pulchra'

describe('波可娜（1351）猎步次数纯函数', () => {
  it('猎步次数 = 强特 + 支援突击(招架) + 连携 + 终结', () => {
    expect(computePulchraHuntStepCount({ exSpecialCount: 6, parryCount: 6, chainCountTotal: 2, ultimateCount: 3 })).toBe(17)
  })
})

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

  it('核心循环：噬爪·噩梦袭影后台追加攻击 6命第一行次数 > 0命（7 vs 5）', async () => {
    await setupHarness([
      { agentId: '1351', cinemaLevel: 0, parryCount: 6 },
      { agentId: '1301' },
      { agentId: '1271' },
    ])
    const c0 = useResourceCalc().resourceResult.value!.characters.find(c => c.agentId === '1351')!
    const first0 = c0.executions.find(e => e.moveId === '1351006')!
    const second0 = c0.executions.find(e => e.moveId === '1351007')!
    expect(first0).toBeTruthy()
    expect(second0).toBeTruthy()
    expect(first0.timeBucket).toBe('backstage')
    expect(first0.count).toBeGreaterThan(0)

    await setupHarness([
      { agentId: '1351', cinemaLevel: 6, parryCount: 6 },
      { agentId: '1301' },
      { agentId: '1271' },
    ])
    const c6 = useResourceCalc().resourceResult.value!.characters.find(c => c.agentId === '1351')!
    const first6 = c6.executions.find(e => e.moveId === '1351006')!
    expect(first6.count).toBeGreaterThan(first0.count)
  })

  it('影画6：困迹增伤从追加攻击扩展为全伤害', async () => {
    const { catalog, config } = await setupHarness([
      { agentId: '1351', cinemaLevel: 6 },
      { agentId: '1301' },
      { agentId: '1271' },
    ])
    const p = computePanelPhases(2, config, catalog)!.inCombat as any
    // C6：困迹 +30% 走 skillDmgBonus（all），base additionalAttack 条已禁用
    expect((p['skillDmgBonus'] ?? 0)).toBe(30)
    expect((p['skillDmgBonus__additionalAttack'] ?? 0)).toBe(0)
  })
})