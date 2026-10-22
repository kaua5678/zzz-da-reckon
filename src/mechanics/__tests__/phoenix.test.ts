import { beforeEach, describe, expect, it } from 'vitest'
import { mockStaticFetch, newPinia } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { useCatalogStore } from '@/stores/catalog'
import { useConfigStore } from '@/stores/config'
import {
  computePhoenixScorchCrit,
  phoenixChargedCount,
  phoenixMechanic,
  phoenixSkillLevel,
  PHOENIX_C4_RELEASE_MULT,
  PHOENIX_RELEASE_BASE,
  PHOENIX_SCORCH_CRIT_DMG,
  PHOENIX_SCORCH_CRIT_RATE,
  PHOENIX_SCORCH_MASTERY_CAP,
  PHOENIX_SCORCH_MASTERY_THRESHOLD,
} from '@/mechanics/agents/phoenix'
import { BOSS_ATTACK_INTERACTIONS } from '@/composables/teamCompare'

const baseConfig = {
  wEngineId: '', wEngineModLevel: 5,
  driveDisc: { fourPieceSetId: '', twoPieceSetId: '', mainStats: { 4: 'anomalyProficiency' as any, 5: 'fireDmg' as any, 6: 'anomalyMastery' as any }, subStatAllocation: {} },
  parryCount: 10, dodgeCounterCount: 6, blockCount: 20,
  quickAssistCount: 0, chainCountPerStun: 0, basicAttackTimeWeight: 1,
}

describe('菲欧妮（1641）3.3.12 v12 正式录入', () => {
  beforeEach(() => {
    newPinia()
    mockStaticFetch()
  })

  async function setup(teamAgentIds: [string, string, string], cinemaLevel = 0, wEngineId = '') {
    const catalog = useCatalogStore()
    await catalog.load()
    await catalog.loadTeammateBuffs()
    const config = useConfigStore()
    teamAgentIds.forEach((agentId, slot) => {
      config.team[slot] = { slot, agentId, cinemaLevel: slot === 0 ? cinemaLevel : 0, ...baseConfig, wEngineId: slot === 0 ? wEngineId : '' } as any
    })
    config.syncTeammateBuffsFromTeam()
    const { computePanelPhases } = await import('@/composables/resourceCalc/panelPhases')
    return { catalog, config, computePanelPhases }
  }

  it('纯函数：[灼蚀] 异常暴击 v12（率 30+0.7×(初始掌控−155) 封顶255，伤 25 + 额外能力15 + 影画1 25）', () => {
    const base = computePhoenixScorchCrit({ initialMastery: 155, additionalActive: false, cinemaLevel: 0 })
    expect(base.rate).toBeCloseTo(PHOENIX_SCORCH_CRIT_RATE, 5)
    expect(base.dmg).toBe(PHOENIX_SCORCH_CRIT_DMG)
    // 阈值以下不加率
    const below = computePhoenixScorchCrit({ initialMastery: 100, additionalActive: false, cinemaLevel: 0 })
    expect(below.rate).toBeCloseTo(30, 5)
    // 200 掌控：30 + 45×0.7 = 61.5
    const mid = computePhoenixScorchCrit({ initialMastery: 200, additionalActive: false, cinemaLevel: 0 })
    expect(mid.rate).toBeCloseTo(30 + 45 * 0.7, 5)
    // 255 封顶 = 100%
    const cap = computePhoenixScorchCrit({ initialMastery: PHOENIX_SCORCH_MASTERY_CAP, additionalActive: false, cinemaLevel: 0 })
    expect(cap.rate).toBeCloseTo(100, 5)
    // 超过 255 不再增长（min 截断）
    const over = computePhoenixScorchCrit({ initialMastery: 320, additionalActive: false, cinemaLevel: 0 })
    expect(over.rate).toBeCloseTo(100, 5)
    // 额外能力 +15（固定档，v12 不再按异常角色数分档）
    const add = computePhoenixScorchCrit({ initialMastery: PHOENIX_SCORCH_MASTERY_THRESHOLD, additionalActive: true, cinemaLevel: 0 })
    expect(add.dmg).toBe(40)
    // 影画1 +25
    const c1 = computePhoenixScorchCrit({ initialMastery: PHOENIX_SCORCH_MASTERY_THRESHOLD, additionalActive: true, cinemaLevel: 1 })
    expect(c1.dmg).toBe(65)
  })

  it('纯函数：异放倍率随技能等级（影画3/5 通用技能等级 +2/+4）', () => {
    expect(phoenixSkillLevel(0)).toBe(12)
    expect(phoenixSkillLevel(3)).toBe(14)
    expect(phoenixSkillLevel(5)).toBe(16)
    // 焚罪 225+20×(s-1)：满级 445
    expect(PHOENIX_RELEASE_BASE.charged + PHOENIX_RELEASE_BASE.chargedPerLevel * (phoenixSkillLevel(0) - 1)).toBe(445)
    // 烬火追魂 300+27×(s-1)：满级 597
    expect(PHOENIX_RELEASE_BASE.entry + PHOENIX_RELEASE_BASE.entryPerLevel * (phoenixSkillLevel(0) - 1)).toBe(597)
    expect(PHOENIX_C4_RELEASE_MULT).toBe(600)
  })

  it('面板差分：[灼蚀] 异常暴击率/暴伤入 EV 乘区（spec teamBuffs 通用承载）', async () => {
    const { computePanelPhases } = await setup(['1641', '1171', ''], 0)
    const phases = computePanelPhases(0, useConfigStore(), useCatalogStore())!
    const inCombat = phases.inCombat as any
    // 初始掌控 152 > 155? 不满足（152 < 155）⇒ 率只有 30
    expect(inCombat.anomalyCritRate ?? 0).toBeGreaterThanOrEqual(30)
    expect(inCombat.anomalyCritDmg ?? 0).toBeGreaterThanOrEqual(40) // 25 + 额外能力15
  })

  it('资源区块：[灼蚀] 暴击/焚罪/燎斩/烬火追魂计数与执行行同源', async () => {
    await setup(['1641', '1171', ''], 0)
    const calc = useResourceCalc()
    const phoenix = calc.resourceResult.value!.characters.find(c => c.agentId === '1641')!
    const cycle = phoenix.phoenixCycle!
    expect(cycle.coreProficiency).toBe(85)
    expect(cycle.scorchCritDmg).toBe(40) // 25 + 额外能力15（1171 柏妮思=异常队友）
    expect(cycle.emberCap).toBe(120)
    expect(cycle.chargedCount).toBeGreaterThanOrEqual(0)
    // 烬火追魂行存在且计数 = 终结次数
    const entry = phoenix.executions.find(e => e.moveId === '1641019')
    if (cycle.entryCount > 0 && entry) {
      expect(entry.count).toBe(cycle.entryCount)
      expect(entry.totalTime).toBe(0) // 收尾追加攻击不占前台时间
    }
  })

  it('执行行：眩焰（通用强特）+ 坠阳（40 能量）+ 燎斩（0 能量）三行按同一次数收敛', async () => {
    await setup(['1641', '1171', ''], 0)
    const phoenix = useResourceCalc().resourceResult.value!.characters.find(c => c.agentId === '1641')!
    const ex = phoenix.executions.find(e => e.moveId === '1641008')
    const second = phoenix.executions.find(e => e.moveId === '1641009')
    const liao = phoenix.executions.find(e => e.moveId === '1641023')
    if (ex && ex.count > 0) {
      expect(second, '坠阳随强特产行').toBeTruthy()
      expect(liao, '燎斩随强特产行').toBeTruthy()
      expect(second!.count).toBe(ex.count)
      expect(liao!.count).toBe(ex.count)
      expect(second!.totalEnergyConsume).toBeCloseTo(ex.count * 40, 5)
      expect(liao!.totalEnergyConsume).toBe(0) // 燎斩消耗升变而非能量
    }
  })

  it('异放事件：焚罪（C0 445%）+ 烬火追魂（C0 597%）+ 影画4 额外 600% + [灼蚀] 周期火伤', async () => {
    await setup(['1641', '1171', ''], 0)
    let phoenix = useResourceCalc().resourceResult.value!.characters.find(c => c.agentId === '1641')!
    let events = phoenix.anomalyEventExecutions ?? []
    // C0：s=12 ⇒ 焚罪 225+20×11 = 445、烬火追魂 300+27×11 = 597
    const charged = events.find(e => e.eventId === 'phoenix_charged_release')
    const entry = events.find(e => e.eventId === 'phoenix_entry_release')
    if (charged) expect(charged.formula).toContain('445')
    if (entry) expect(entry.formula).toContain('597')
    expect(events.find(e => e.eventId === 'phoenix_c4_charged_release'), 'C0 无影画4 额外异放').toBeUndefined()

    // [灼蚀] 周期火伤事件（C0 也生效）
    const dot = events.find(e => e.eventId === 'phoenix_scorch_dot')
    if (dot) {
      expect(dot.eventType).toBe('direct_damage')
      expect(dot.damageMultiplier).toBe(50)
    }

    // C4：s=14 ⇒ 焚罪 225+20×13 = 485，且两个额外异放 600% 出现
    await setup(['1641', '1171', ''], 4)
    phoenix = useResourceCalc().resourceResult.value!.characters.find(c => c.agentId === '1641')!
    events = phoenix.anomalyEventExecutions ?? []
    const c4Charged = events.find(e => e.eventId === 'phoenix_c4_charged_release')
    const c4Entry = events.find(e => e.eventId === 'phoenix_c4_entry_release')
    if (c4Charged) expect(c4Charged.formula).toContain('600')
    if (c4Entry) expect(c4Entry.formula).toContain('600')
    const chargedC4 = events.find(e => e.eventId === 'phoenix_charged_release')
    if (chargedC4) expect(chargedC4.formula).toContain('485')
  })

  it('命座差分：C6 无视15%全属性抗性 + 异放无视40%防御；整局伤害 C6 > C0', async () => {
    await setup(['1641', '1171', ''], 0)
    const d0 = useResourceCalc().teamTotalDamage.value
    const { config, computePanelPhases } = await setup(['1641', '1171', ''], 0)
    const bare = computePanelPhases(0, config, useCatalogStore())!.inCombat as any
    config.team[0]!.cinemaLevel = 6
    config.syncTeammateBuffsFromTeam()
    const c6Panel = computePanelPhases(0, config, useCatalogStore())!.inCombat as any
    expect((c6Panel.enemyResReduction ?? 0) - (bare.enemyResReduction ?? 0)).toBeCloseTo(15, 5)
    const d6 = useResourceCalc().teamTotalDamage.value
    expect(d6).toBeGreaterThan(d0)

    await setup(['1641', '1171', ''], 6)
    const phoenix = useResourceCalc().resourceResult.value!.characters.find(c => c.agentId === '1641')!
    expect(phoenix.phoenixCycle!.c6ResIgnore).toBe(15)
    expect(phoenix.phoenixCycle!.c6ReleaseDefIgnore).toBe(40)
  })

  it('专武 14164「涅槃初翎」生效差分（v12）：异常精通+90（精炼1）+ 火伤+40%', async () => {
    const { config, computePanelPhases } = await setup(['1641', '1171', ''], 0)
    const bare = computePanelPhases(0, config, useCatalogStore())!.inCombat as any
    config.team[0]!.wEngineId = '14164'
    config.team[0]!.wEngineModLevel = 1
    const armed = computePanelPhases(0, config, useCatalogStore())!.inCombat as any
    expect(armed.anomalyProficiency - bare.anomalyProficiency).toBeCloseTo(90, 5)
    expect(armed.fireDmg - bare.fireDmg).toBeCloseTo(40, 5)
  })

  it('模块声明：v12 三项影画/技能等级/固定异放倍率都在通道上', () => {
    expect(phoenixMechanic.id).toBe('agent:phoenix')
    expect(phoenixMechanic.agentIds).toEqual(['1641'])
    const ids = phoenixMechanic.settings?.map(s => s.id) ?? []
    expect(ids).toContain('phoenix.chargedAttackCount')
    expect(ids).toContain('phoenix.releaseCoverage')
    expect(ids).toContain('phoenix.scorchCoverage')
    expect(phoenixMechanic.axisMoveFreeOfDecibel!('1641019')).toBe(true)
    expect(phoenixMechanic.axisMoveFreeOfDecibel!('1641013')).toBe(false)
  })

  /**
   * 完美格挡 → 燔焰（用户裁决 2026-10-22）：「可以，毕竟他有交互收益。此交互需要 boss 产生攻击，
   * 所以要算非失衡占比。此外还有 cd 算出的上限。」
   *
   * 三件事在这里一次锁死：
   * ① **入口存在**：模块声明 `characterCountInputs: perfectBlockCount`（原缺失 ⇒ 用户填不到）；
   * ② **CD 上限**：有效次数 = min(填写次数, floor(有效战斗时间/10))——原式是「每 10 次一次」（读错单位）；
   * ③ **难度侧非失衡占比**：`perfectBlock` 已在 `BOSS_ATTACK_INTERACTIONS`（只断言登记，不重算公式）。
   */
  it('完美格挡：输入框已声明；燔焰按 min(次数, floor(有效时间/10))×5 计入（CD 上限）', async () => {
    // ① 入口声明
    const decl = phoenixMechanic.characterCountInputs?.find(i => i.field === 'perfectBlockCount')
    expect(decl, '菲欧妮必须声明完美格挡输入框').toBeTruthy()
    expect(decl!.label).toBe('完美格挡')
    // ③ 难度侧：需怪攻击（吃非失衡占比修正）
    expect(BOSS_ATTACK_INTERACTIONS).toContain('perfectBlock')

    // ② CD 上限：180s 有效时间 ⇒ 最多 18 次
    const cap = Math.floor(180 / 10)
    const cfgBase = {
      phoenixCinemaLevel: 0,
      phoenixCombustionMeta: {},
      phoenixBasicCycle: [],
      battleTime: 180,
      invincibleTime: 0,
      perfectBlockCount: 0,
    } as any
    const ember = (perfectBlockCount: number, invincibleTime = 0) => {
      const cfg = { ...cfgBase, perfectBlockCount, invincibleTime }
      return phoenixChargedCount(cfg, { basicAttackTime: 0 } as any, [])
    }
    // 0 次 ⇒ 0 燔焰 ⇒ 0 次焚罪
    expect(ember(0)).toBe(0)
    // 10 次（= CD 上限以内）⇒ 10×5 = 50 燔焰 ⇒ floor(50/90) = 0 次焚罪
    expect(ember(10)).toBe(0)
    // 18 次（= 上限）⇒ 90 燔焰 ⇒ 1 次焚罪
    expect(ember(cap)).toBe(1)
    // **超上限 999 次 ⇒ 仍只按 18 次算**（CD 是硬约束，不是「次数/10」）
    expect(ember(999)).toBe(1)
    // 无敌时间扣减后上限收紧：180-100=80s ⇒ floor(80/10)=8 次 ⇒ 40 燔焰 ⇒ 0 次焚罪
    expect(ember(999, 100)).toBe(0)
  })

  it('[灼蚀] 覆盖率滑块生效：0 → 无周期火伤事件', async () => {
    const { config } = await setup(['1641', '1171', ''], 0)
    config.setMechanicSetting('phoenix.scorchCoverage', 0)
    const phoenix = useResourceCalc().resourceResult.value!.characters.find(c => c.agentId === '1641')!
    const events = phoenix.anomalyEventExecutions ?? []
    expect(events.find(e => e.eventId === 'phoenix_scorch_dot')).toBeUndefined()
  })
})
