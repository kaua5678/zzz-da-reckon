import { describe, expect, it } from 'vitest'
import { computePanelPhases } from '@/composables/resourceCalc/helpers'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { setupHarness } from '@/test/harness'
import { computeJaneMechanic, janeMechanic } from '@/mechanics/agents/jane'

async function setup() {
  const result = await setupHarness([
    { agentId: '1261', parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
    { agentId: '1171', parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
    '',
  ])
  for (const buff of result.config.globalBuffs) buff.enabled = false
  return result
}

describe('简（1261）啮咬/狂热/强击暴击', () => {
  it('强击暴击率 = 基础20% + 精通×0.1%', () => {
    const s = computeJaneMechanic({ anomalyProficiency: 500, frenzyActive: true, frontlineSeconds: 170 })
    expect(s.assaultCritRate).toBeCloseTo(70, 5)
    expect(s.assaultCritDmgBonus).toBe(30)
    expect(s.frenzyBuildUpBonus).toBe(25)

    const low = computeJaneMechanic({ anomalyProficiency: 0, frenzyActive: true, frontlineSeconds: 0 })
    expect(low.assaultCritRate).toBe(20)
  })

  it('精通转攻击：>120 每点+2，上限600', () => {
    expect(computeJaneMechanic({ anomalyProficiency: 100, frenzyActive: true, frontlineSeconds: 0 }).atkFromMastery).toBe(0)
    expect(computeJaneMechanic({ anomalyProficiency: 200, frenzyActive: true, frontlineSeconds: 0 }).atkFromMastery).toBe(160)
    // 封顶：420 超出即到 600
    const capped = computeJaneMechanic({ anomalyProficiency: 420, frenzyActive: true, frontlineSeconds: 0 })
    expect(capped.atkFromMastery).toBe(600)
  })

  it('applyPanel 写入强击暴击率/暴伤与潜能强击暴伤（仅自身强击）', () => {
    const panel = { anomalyProficiency: 300 } as any
    janeMechanic.applyPanel!({ panel } as any)
    expect(panel.assaultCritRate).toBeCloseTo(50, 5) // 20 + 300×0.1
    expect(panel.assaultCritDmg).toBe(50)
    expect(panel.janeAssaultCritDmgBonus).toBe(30)
  })

  it('影画1/6 面板区在 helpers 简专属分支生效（passionCoverage 默认90%折算）', async () => {
    const { catalog, config } = await setup()
    const base = computePanelPhases(0, config, catalog)!.inCombat as any
    const p0 = {
      buildUp: base.physicalAnomalyBuildUpEfficiency,
      dmg: base.dmgBonus,
      critRate: base.critRate,
      critDmg: base.critDmg,
    }

    config.team[0].cinemaLevel = 1
    const p1 = computePanelPhases(0, config, catalog)!.inCombat as any
    // 影画1：物理积蓄+15×0.9=13.5；精通转伤害按覆盖率折算且封顶30
    expect(p1.physicalAnomalyBuildUpEfficiency - p0.buildUp).toBeCloseTo(13.5, 3)
    expect(p1.dmgBonus - p0.dmg).toBeGreaterThan(0)
    expect(p1.dmgBonus - p0.dmg).toBeLessThanOrEqual(30 * 0.9 + 1e-9)
    expect(p1.critRate - p0.critRate).toBeCloseTo(0, 5)

    config.team[0].cinemaLevel = 6
    const p6 = computePanelPhases(0, config, catalog)!.inCombat as any
    // 影画6：触发强击即狂热，双暴不折算覆盖率
    expect(p6.critRate - p1.critRate).toBeCloseTo(20 - (p1.critRate - p0.critRate), 5)
    expect(p6.critRate - p0.critRate).toBeCloseTo(20, 5)
    expect(p6.critDmg - p0.critDmg).toBeCloseTo(40, 5)

    // 覆盖率滑块可调：cinema=1 时物理积蓄贡献=(狂热25+影画15)×coverage，
    // 滑块 0.9→0.5 的变化量 = 40×(0.5−0.9) = −16
    config.team[0].cinemaLevel = 1
    const before = computePanelPhases(0, config, catalog)!.inCombat as any
    config.setMechanicSetting('jane.passionCoverage', 0.5)
    const half = computePanelPhases(0, config, catalog)!.inCombat as any
    expect(half.physicalAnomalyBuildUpEfficiency - before.physicalAnomalyBuildUpEfficiency).toBeCloseTo(-16, 3)
  })

  it('完整计算链：资源池带 janeMechanicSource、面板强击区生效', async () => {
    const { catalog, config } = await setup()
    const calc = useResourceCalc()
    const row = calc.resourceResult.value!.characters.find(ch => ch.agentId === '1261')!
    expect(row.janeMechanicSource).toBeTruthy()
    expect(row.janeMechanicSource!.assaultCritRate).toBeGreaterThan(20)
    expect(row.janeMechanicSource!.biteSeconds).toBeGreaterThanOrEqual(0)

    const p = computePanelPhases(0, config, catalog)!.inCombat as any
    expect(p.assaultCritRate).toBeGreaterThan(20)
    expect(p.janeAssaultCritDmgBonus).toBe(30)
  })

  it('萨霍夫跳进入执行计划：狂热 1 次，影画1 额外 +1 次', async () => {
    const { config } = await setup()
    config.team[0].cinemaLevel = 0
    const calc = useResourceCalc()
    await new Promise(r => setTimeout(r, 50))
    const c0 = calc.resourceResult.value!.characters.find(ch => ch.agentId === '1261')!
    const jump0 = c0.executions.find(e => e.moveId === '1261007')
    expect(jump0).toBeTruthy()
    expect(jump0!.count).toBe(1)
    expect(jump0!.damageMultiplier).toBeCloseTo(602.2 + 965 + 323, 3)

    config.team[0].cinemaLevel = 1
    await new Promise(r => setTimeout(r, 50))
    const c1 = calc.resourceResult.value!.characters.find(ch => ch.agentId === '1261')!
    const jump1 = c1.executions.find(e => e.moveId === '1261007')
    expect(jump1).toBeTruthy()
    expect(jump1!.count).toBe(2)
  })

  it('影画6 附伤走标准直伤管线：吃抗性/易伤（用户 2026-09-03 乘区口径：攻击区×倍率区打底，其余乘区全吃）', async () => {
    const { config } = await setup()
    config.team[0].cinemaLevel = 6
    const calc = useResourceCalc()
    await new Promise(r => setTimeout(r, 50))
    const row = calc.damagePoolRows.value.find(r => r.id === 'jane-c6-assault-followup')
    expect(row).toBeTruthy()
    expect(row!.perDamage).toBeGreaterThan(0)
    const base = row!.perDamage
    // 物理抗性 0 → 40：perDamage 应显著下降（旧实现只吃易伤，不吃抗性——此断言锁定新口径）
    config.setEnemy({ damageResistances: { physical: 40 } as any })
    await new Promise(r => setTimeout(r, 50))
    const withRes = calc.damagePoolRows.value.find(r => r.id === 'jane-c6-assault-followup')
    expect(withRes!.perDamage).toBeLessThan(base)
    // 敌方受伤 +20%（易伤）：perDamage 应抬升
    config.setEnemy({ damageResistances: { physical: 0 } as any })
    const taken = config.globalBuffs.find(b => b.id === 'b3')!
    taken.enabled = true
    taken.value = 20
    await new Promise(r => setTimeout(r, 50))
    const withTaken = calc.damagePoolRows.value.find(r => r.id === 'jane-c6-assault-followup')
    expect(withTaken!.perDamage).toBeGreaterThan(base)
  })
})
