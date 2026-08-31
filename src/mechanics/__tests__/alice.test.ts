import { describe, expect, it } from 'vitest'
import { computePanelPhases } from '@/composables/resourceCalc/helpers'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { setupHarness } from '@/test/harness'

/** 爱丽丝（物理）+ 格莉丝（电异常，触发额外能力） */
async function setup(cinemaLevel = 0) {
  const result = await setupHarness([
    { agentId: '1401', cinemaLevel, parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
    { agentId: '1181', cinemaLevel: 0, parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
  ])
  for (const buff of result.config.globalBuffs) buff.enabled = false
  return result
}

describe('爱丽丝（1401）命座面板增益', () => {
  it('影画1：目标防御-20% 接入面板（1命 vs 0命差分）', async () => {
    const c0 = await setup(0)
    const d0 = (computePanelPhases(0, c0.config, c0.catalog)!.inCombat as any).enemyDefReduction ?? 0
    const c1 = await setup(1)
    const d1 = (computePanelPhases(0, c1.config, c1.catalog)!.inCombat as any).enemyDefReduction ?? 0
    expect(d1 - d0).toBe(20)
  })

  it('影画2：全队强击+15% 与物理紊乱+15% 接入面板', async () => {
    const c0 = await setup(0)
    const p0 = computePanelPhases(0, c0.config, c0.catalog)!.inCombat as any
    const c2 = await setup(2)
    const p2 = computePanelPhases(0, c2.config, c2.catalog)!.inCombat as any
    expect((p2.anomalyDmgBonus ?? 0) - (p0.anomalyDmgBonus ?? 0)).toBe(15)
    expect((p2.disorderDamageBonus ?? 0) - (p0.disorderDamageBonus ?? 0)).toBe(15)
  })

  it('影画4：无视10%物理抗性接入面板', async () => {
    const c0 = await setup(0)
    const r0 = (computePanelPhases(0, c0.config, c0.catalog)!.inCombat as any).enemyPhysicalResReduction ?? 0
    const c4 = await setup(4)
    const r4 = (computePanelPhases(0, c4.config, c4.catalog)!.inCombat as any).enemyPhysicalResReduction ?? 0
    expect(r4 - r0).toBe(10)
  })
})

describe('爱丽丝影画6决胜状态额外攻击', () => {
  it('6命生成决胜状态额外攻击行（3300% 精通 × 必定暴击），0命不生成', async () => {
    await setup(6)
    const calc6 = useResourceCalc()
    const rows6 = calc6.damagePoolRows.value.filter(r => r.type === '爱丽丝6命附伤')
    expect(rows6.length).toBeGreaterThan(0)
    for (const row of rows6) {
      expect(row.totalDamage).toBeGreaterThan(0)
      expect(row.element).toBe('physical')
      expect(row.note ?? '').toContain('必定暴击')
    }
  })

  it('0命不生成决胜状态额外攻击行', async () => {
    await setup(0)
    const calc0 = useResourceCalc()
    const rows0 = calc0.damagePoolRows.value.filter(r => r.type === '爱丽丝6命附伤')
    expect(rows0.length).toBe(0)
  })
})

describe('爱丽丝畏缩 DOT', () => {
  it('畏缩 DOT 进入伤害池（type=畏缩 DOT，element=physical）', async () => {
    await setup(0)
    const calc = useResourceCalc()
    // 异常池已算出畏缩 DOT 总伤害
    const dot = calc.anomalyPoolResult.value?.aliceCoweringDot
    expect(dot?.totalDotDamage ?? 0).toBeGreaterThan(0)
    // 曾遗漏：畏缩 DOT 只在 ResultPage 单独展示、未进 damagePoolRows（团队总伤害漏算）
    const rows = calc.damagePoolRows.value.filter(r => r.type === '畏缩 DOT')
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect(row.element).toBe('physical')
      expect(row.totalDamage).toBeGreaterThan(0)
      expect(row.count).toBeGreaterThan(0)
    }
  })
})

describe('爱丽丝滑块生效差分（防守卫冻结，SOP §3.5）', () => {
  it('alice.cinema6PerStateCount → 6命决胜额外攻击次数差分（damagePool 决胜追击行）', async () => {
    const { config } = await setupHarness([{ agentId: '1401', cinemaLevel: 6 }, { agentId: '1181' }])
    const extraOf = () => {
      const calc = useResourceCalc()
      const row = calc.damagePoolRows.value.find(r => r.id === 'alice-c6-decisive-extra-attack')
      return row?.count ?? 0
    }
    config.setMechanicSetting('alice.cinema6PerStateCount', 6)
    const on = extraOf()
    config.setMechanicSetting('alice.cinema6PerStateCount', 2)
    const off = extraOf()
    expect(on).toBeGreaterThan(0)
    // 总次数 = 状态进入次数 × perStateCount：6/2 档位比值 3
    expect(on / off).toBeCloseTo(3, 5)
  })
})
