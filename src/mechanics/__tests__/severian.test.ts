import { beforeEach, describe, expect, it } from 'vitest'
import { mockStaticFetch, newPinia } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { useCatalogStore } from '@/stores/catalog'
import { useConfigStore } from '@/stores/config'
import {
  computeSeverianCycle,
  severianBasicFinisherHits,
  severianMechanic,
  SEVERIAN_FENGFENG_MULT,
} from '@/mechanics/agents/severian'

const baseConfig = {
  wEngineId: '', wEngineModLevel: 5,
  driveDisc: { fourPieceSetId: '', twoPieceSetId: '', mainStats: { 4: 'atkPct' as any, 5: 'windDmg' as any, 6: 'critRate' as any }, subStatAllocation: {} },
  parryCount: 10, dodgeCounterCount: 6, blockCount: 20,
  quickAssistCount: 0, chainCountPerStun: 0, basicAttackTimeWeight: 1,
}

describe('赛维里安（1631）⚠️3.3 测试服临时录入', () => {
  beforeEach(() => {
    newPinia()
    mockStaticFetch()
  })

  async function setup(teamAgentIds: [string, string, string], cinemaLevel = 0) {
    const catalog = useCatalogStore()
    await catalog.load()
    await catalog.loadTeammateBuffs()
    const config = useConfigStore()
    teamAgentIds.forEach((agentId, slot) => {
      config.team[slot] = { slot, agentId, cinemaLevel: slot === 0 ? cinemaLevel : 0, ...baseConfig } as any
    })
    config.syncTeammateBuffsFromTeam()
    const { computePanelPhases } = await import('@/composables/resourceCalc/helpers')
    return { catalog, config, computePanelPhases }
  }

  it('纯函数：疾锋四段循环 #4 命中计数（完整循环 1 次/轮，尾部推进到 #4 再 +1）', () => {
    const cycle = [
      { moveId: '1631001', actionTime: 0.327 },
      { moveId: '1631002', actionTime: 0.566 },
      { moveId: '1631003', actionTime: 0.981 },
      { moveId: '1631004', actionTime: 1.375 },
    ]
    const cycleTime = 0.327 + 0.566 + 0.981 + 1.375
    expect(severianBasicFinisherHits(0, cycle)).toBe(0)
    expect(severianBasicFinisherHits(cycleTime * 2, cycle)).toBe(2)
    // 尾部只打了前三段 → 推进到 #4，计 1 次
    expect(severianBasicFinisherHits(cycleTime * 2 + 0.327 + 0.566 + 0.981, cycle)).toBe(3)
    // 尾部不足前三段 → 不计
    expect(severianBasicFinisherHits(cycleTime * 2 + 0.5, cycle)).toBe(2)
  })

  it('纯函数：computeSeverianCycle 门控（额外能力/影画2/影画4/凭风）', () => {
    const c0 = computeSeverianCycle({ cinemaLevel: 0, additionalActive: false, fengfengStacks: 1, c4Coverage: 1 })
    expect(c0.coreCritDmg).toBe(60)
    expect(c0.atkFlat).toBe(0)
    expect(c0.c2AtkPct).toBe(0)
    expect(c0.fengfengMultBonus).toBe(SEVERIAN_FENGFENG_MULT[1])
    const c6 = computeSeverianCycle({ cinemaLevel: 6, additionalActive: true, fengfengStacks: 2, c4Coverage: 1 })
    expect(c6.atkFlat).toBe(700)
    expect(c6.c2AtkPct).toBe(15)
    expect(c6.c1BasicCritDmg).toBe(60)
    expect(c6.c4DefIgnore).toBe(16)
    expect(c6.fengfengMultBonus).toBe(SEVERIAN_FENGFENG_MULT[2])
    expect(c6.c6ShadowMultBonus).toBe(900)
  })

  it('面板差分：核心被动暴伤+60；[击破]队友触发额外能力攻击+700，无关队友不触发', async () => {
    const { config, computePanelPhases } = await setup(['1631', '1251', '']) // 1251 青衣=击破
    const pPos = computePanelPhases(0, config, useCatalogStore())!.inCombat as any
    const pOut = computePanelPhases(0, config, useCatalogStore())!.outOfCombat as any
    expect(pPos.critDmg - pOut.critDmg).toBeCloseTo(60, 5)
    expect(pPos.atk - pOut.atk).toBeGreaterThanOrEqual(700)

    // 负例：1081 比利（物理·狡兔屋，非支援/击破/同阵营）
    const neg = await setup(['1631', '1081', ''])
    const pNeg = neg.computePanelPhases(0, neg.config, useCatalogStore())!.inCombat as any
    const pNegOut = neg.computePanelPhases(0, neg.config, useCatalogStore())!.outOfCombat as any
    expect(pNeg.atk - pNegOut.atk).toBeLessThan(700)
  })

  it('面板差分：影画2 触发额外能力时攻击力×1.15；影画4 无视防御 16×覆盖率', async () => {
    const c0 = await setup(['1631', '1251', ''], 0)
    const p0 = c0.computePanelPhases(0, c0.config, useCatalogStore())!.inCombat as any
    const c2 = await setup(['1631', '1251', ''], 2)
    const p2 = c2.computePanelPhases(0, c2.config, useCatalogStore())!.inCombat as any
    expect(p2.atk).toBeGreaterThan(p0.atk)
    expect(p2.atk / p0.atk).toBeCloseTo(1.15, 2)

    const c6 = await setup(['1631', '1251', ''], 6)
    const p6 = c6.computePanelPhases(0, c6.config, useCatalogStore())!.inCombat as any
    expect((p6.enemyDefReduction ?? 0) - (p0.enemyDefReduction ?? 0)).toBeCloseTo(16, 5)
    c6.config.setMechanicSetting('severian.c4Coverage', 0)
    const p6c0 = c6.computePanelPhases(0, c6.config, useCatalogStore())!.inCombat as any
    expect((p6c0.enemyDefReduction ?? 0) - (p0.enemyDefReduction ?? 0)).toBeCloseTo(0, 5)
  })

  it('执行行：苍风影猎（流息驱动）/烈旋（滑块）产出；影画1 普攻暴伤+60 只作用 basic 组；凭风层数只作用入场类招式', async () => {
    const { config } = await setup(['1631', '1251', ''], 1)
    config.setMechanicSetting('severian.blazingSpinCount', 5)
    config.setMechanicSetting('severian.fengfengStacks', 2)
    const calc = useResourceCalc()
    const severian = calc.resourceResult.value!.characters.find(c => c.agentId === '1631')!
    const shadow = severian.executions.find(e => e.moveId === '1631006')!
    expect(shadow).toBeTruthy()
    expect(shadow.count).toBeGreaterThan(0) // 终结/连携流息收入 ≥100
    expect(shadow.totalTime).toBeCloseTo(shadow.count * shadow.actionTime, 6)
    // 影画1：basic 组行 critDmgBonus +60
    expect((shadow as any).critDmgBonus ?? 0).toBe(60)
    const chain = severian.executions.find(e => e.moveId === '1631012')
    if (chain) expect((chain as any).critDmgBonus ?? 0).toBe(0)
    // 凭风 2 层：连携/终结行 damageMultiplier = 倍率表基础 +300（override 生效）
    const catalog = useCatalogStore()
    const baseChain = catalog.catalog!.agentSkills.find(s => s.agentId === '1631')!
      .categories.find(c => c.id === 'chain')!.moves.find(m => m.id === '1631012')!
      .rows.find(r => r.id === 'damage')!.values[0]
    if (chain) {
      expect((chain as any).damageMultiplier).toBeCloseTo(baseChain + SEVERIAN_FENGFENG_MULT[2], 3)
      expect((chain as any).damageMultiplierOverride).toBe(true)
    }
  })

  it('命座差分：C6 苍风影猎最后一击 +900%（行倍率=基础+900 且 override），整局伤害 C6 > C0', async () => {
    await setup(['1631', '1251', ''], 0)
    const calc0 = useResourceCalc()
    const d0 = calc0.teamTotalDamage.value
    const s0 = calc0.resourceResult.value!.characters.find(c => c.agentId === '1631')!
    const shadow0 = s0.executions.find(e => e.moveId === '1631006')
    if (shadow0) expect((shadow0 as any).damageMultiplierOverride ?? false).toBe(false)

    const c6 = await setup(['1631', '1251', ''], 6)
    const calc6 = useResourceCalc()
    const s6 = calc6.resourceResult.value!.characters.find(c => c.agentId === '1631')!
    const shadow6 = s6.executions.find(e => e.moveId === '1631006')!
    expect(shadow6).toBeTruthy()
    const baseShadow = c6.catalog.catalog!.agentSkills.find(s => s.agentId === '1631')!
      .categories.find(c => c.id === 'basic')!.moves.find(m => m.id === '1631006')!
      .rows.find(r => r.id === 'damage')!.values[0]
    expect(shadow6.damageMultiplier).toBeCloseTo(baseShadow + 900, 3)
    expect(calc6.teamTotalDamage.value).toBeGreaterThan(d0)
  })

  it('长按风刃段（1631009，2026-09-12 用户纠错补录）：随强特产行，倍率/耗能按满充比例滑块缩放', async () => {
    const { config, catalog } = await setup(['1631', '1251', ''], 0)
    const baseBlade = catalog.catalog!.agentSkills.find(s => s.agentId === '1631')!
      .categories.find(c => c.id === 'special')!.moves.find(m => m.id === '1631009')!
      .rows.find(r => r.id === 'damage')!.values[0]
    expect(baseBlade).toBeGreaterThan(800) // 满倍率 818.4%（高收益段，必须建模）
    // catalog 耗能真实值（param 行 desc 文本提取）
    const bladeEc = catalog.catalog!.agentSkills.find(s => s.agentId === '1631')!
      .categories.find(c => c.id === 'special')!.moves.find(m => m.id === '1631009')!.energyCost
    expect(bladeEc?.['Energy Cost']).toBe('40')
    const exEc = catalog.catalog!.agentSkills.find(s => s.agentId === '1631')!
      .categories.find(c => c.id === 'special')!.moves.find(m => m.id === '1631008')!.energyCost
    expect(exEc?.['Energy Cost']).toBe('80')

    let calc = useResourceCalc()
    let blade = calc.resourceResult.value!.characters.find(c => c.agentId === '1631')!
      .executions.find(e => e.moveId === '1631009')!
    expect(blade).toBeTruthy()
    expect(blade.count).toBeGreaterThan(0) // 强特次数驱动
    expect(blade.damageMultiplier).toBeCloseTo(baseBlade, 3) // 默认满充比例 1
    expect((blade as any).damageMultiplierOverride).toBe(true)
    expect(blade.totalEnergyConsume).toBeCloseTo(blade.count * 40, 5)

    // 满充比例 0.5：倍率/耗能/时间同缩放
    config.setMechanicSetting('severian.windBladeChargeRatio', 0.5)
    calc = useResourceCalc()
    blade = calc.resourceResult.value!.characters.find(c => c.agentId === '1631')!
      .executions.find(e => e.moveId === '1631009')!
    expect(blade.damageMultiplier).toBeCloseTo(baseBlade * 0.5, 3)
    expect(blade.totalEnergyConsume).toBeCloseTo(blade.count * 20, 5)
  })

  it('专武 14163 生效差分（2026-09-12 录入）：装 vs 不装 → 暴伤+38.4、无视风抗+20%（特化门=attack 对齐；测试 wEngineModLevel=5 → 暴伤取精炼5值 38.4）', async () => {
    const { config, computePanelPhases } = await setup(['1631', '1251', ''], 0)
    const bare = computePanelPhases(0, config, useCatalogStore())!.inCombat as any
    config.team[0]!.wEngineId = '14163'
    const armed = computePanelPhases(0, config, useCatalogStore())!.inCombat as any
    expect(armed.critDmg - bare.critDmg).toBeCloseTo(38.4, 5)
    expect((armed.enemyWindResReduction ?? 0) - (bare.enemyWindResReduction ?? 0)).toBeCloseTo(32, 5) // 精炼5
    expect(armed.atk).toBeGreaterThan(bare.atk) // +24% 攻击（精炼5 atkPct）+ 专武 713 白值
  })

  it('模块注册与滑块：5 个滑块齐全，苍风影猎次数覆盖生效', async () => {
    expect(severianMechanic.agentIds).toContain('1631')
    expect((severianMechanic.settings ?? []).map(s => s.id).sort()).toEqual([
      'severian.blazingSpinCount', 'severian.c4Coverage', 'severian.fengfengStacks', 'severian.shadowHuntCount', 'severian.windBladeChargeRatio',
    ])
    const { config } = await setup(['1631', '1251', ''], 0)
    config.setMechanicSetting('severian.shadowHuntCount', 7)
    const calc = useResourceCalc()
    const shadow = calc.resourceResult.value!.characters.find(c => c.agentId === '1631')!
      .executions.find(e => e.moveId === '1631006')!
    expect(shadow.count).toBe(7)
  })
})
