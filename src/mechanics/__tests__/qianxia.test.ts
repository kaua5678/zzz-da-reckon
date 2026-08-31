import { beforeEach, describe, expect, it } from 'vitest'
import { mockStaticFetch, newPinia } from '@/test/harness'
import { useCatalogStore } from '@/stores/catalog'
import { useConfigStore } from '@/stores/config'
import { computePanelPhases } from '@/composables/resourceCalc/helpers'
import { qianxiaMechanic, QIANXIA_GAZE_MARK_MOVE_IDS } from '@/mechanics/agents/qianxia'

const baseConfig = {
  wEngineId: '', wEngineModLevel: 1,
  driveDisc: { fourPieceSetId: '', twoPieceSetId: '', mainStats: {}, subStatAllocation: {} },
  parryCount: 0, dodgeCounterCount: 0, defAssistCount: 0,
  quickAssistCount: 0, chainCountPerStun: 1, basicAttackTimeWeight: 1,
}

async function setup(mateId = '1081', cinemaLevel = 0) {
  const catalog = useCatalogStore()
  await catalog.load()
  await catalog.loadTeammateBuffs()
  const config = useConfigStore()
  for (const buff of config.globalBuffs) buff.enabled = false
  // slot0 千夏，slot1 队友（1081 比利 = 物理·强攻 → 触发额外能力）
  config.team[0] = { slot: 0, agentId: '1491', cinemaLevel, ...baseConfig } as any
  config.team[1] = { slot: 1, agentId: mateId, cinemaLevel: 0, ...baseConfig } as any
  config.team[2] = { slot: 2, agentId: '', cinemaLevel: 0, ...baseConfig } as any
  config.syncTeammateBuffsFromTeam()
  return { catalog, config }
}

describe('千夏（1491）额外能力·白日梦对位法门控', () => {
  beforeEach(() => {
    newPinia()
    mockStaticFetch()
  })

  it('[强攻]队友在队：帷幕失衡易伤 +30% 生效；支援队友（不同阵营）：不生效', async () => {
    // 正例：1081 比利（强攻）
    const pos = await setup('1081')
    const pPos = computePanelPhases(0, pos.config, pos.catalog)!.inCombat as any
    expect(pPos.additionalAbilityActive).toBe(1)
    expect(pPos.stunDmgMultiplierBonus).toBeCloseTo(30, 5)

    // 负例：1211 丽娜（支援，维多利亚家政 ≠ 妄想天使）
    const neg = await setup('1211')
    const pNeg = computePanelPhases(0, neg.config, neg.catalog)!.inCombat as any
    expect(pNeg.additionalAbilityActive ?? 0).toBe(0)
    expect(pNeg.stunDmgMultiplierBonus).toBeCloseTo(0, 5)
  })

  it('进场回能 15：额外能力激活时并入 initialEnergyGift，未激活不注入', () => {
    const cfgOn: any = {}
    qianxiaMechanic.buildCharConfig!({ cfg: cfgOn, panel: { additionalAbilityActive: 1 } } as any)
    expect(cfgOn.initialEnergyGift).toBe(15)

    const cfgOff: any = {}
    qianxiaMechanic.buildCharConfig!({ cfg: cfgOff, panel: { additionalAbilityActive: 0 } } as any)
    expect(cfgOff.initialEnergyGift ?? 0).toBe(0)
  })
})

describe('千夏影画拐力（teammate-buffs 按命座门控）', () => {
  beforeEach(() => {
    newPinia()
    mockStaticFetch()
  })

  it('命座差分：1命减防 7%×3、2命攻击 +10%、4命全队增伤 +18%', async () => {
    const { catalog, config } = await setup('1081', 0)
    const phases0 = computePanelPhases(0, config, catalog)!
    const p0 = phases0.inCombat as any

    config.team[0].cinemaLevel = 1
    config.syncTeammateBuffsFromTeam()
    const p1 = computePanelPhases(0, config, catalog)!.inCombat as any
    expect(p1.enemyDefReduction - p0.enemyDefReduction).toBeCloseTo(21, 5)

    config.team[0].cinemaLevel = 2
    config.syncTeammateBuffsFromTeam()
    const phases2 = computePanelPhases(0, config, catalog)!
    const p2 = phases2.inCombat as any
    // 局内大攻击 +10%：差分 = 局外攻击（基底）× 10%
    const atkBase = (phases2.outOfCombat as any).atk
    expect(p2.atk - p0.atk).toBeCloseTo(atkBase * 0.1, 0)

    config.team[0].cinemaLevel = 4
    config.syncTeammateBuffsFromTeam()
    const p4 = computePanelPhases(0, config, catalog)!.inCombat as any
    expect(p4.dmgBonus - p2.dmgBonus).toBeCloseTo(18, 5)
  })

  it('核心被动攻击拐：按千夏局外攻击 30% 上限 1050（开关差分）', async () => {
    const { catalog, config } = await setup('1081', 0)
    const phases = computePanelPhases(0, config, catalog)!
    const atkOut = (phases.outOfCombat as any).atk ?? 0
    const withBuff = (phases.inCombat as any).atk

    config.toggleTeammateBuff('buff_j8kf2r9m4q', false)
    const withoutBuff = (computePanelPhases(0, config, catalog)!.inCombat as any).atk
    config.toggleTeammateBuff('buff_j8kf2r9m4q', true)

    const expected = Math.min(1050, Math.floor(atkOut * 0.3))
    expect(withBuff - withoutBuff).toBeCloseTo(expected, 0)
    expect(expected).toBeGreaterThan(0)
  })

  it('影画6 潜心创作：自身必暴 + 攻击×0.03% 暴伤（封顶105，覆盖率滑杆）；低命不生效', () => {
    const panel: any = { atk: 3000, critRate: 10, critDmg: 50 }
    qianxiaMechanic.applyPanel!({ cinemaLevel: 6, panel, settings: { 'qianxia.c6FocusCoverage': 1 } } as any)
    expect(panel.critRate).toBeCloseTo(110) // 10 + 100
    expect(panel.critDmg).toBeCloseTo(50 + Math.min(105, 3000 * 0.03)) // 50 + 90

    const p0: any = { atk: 3000, critRate: 10, critDmg: 50 }
    qianxiaMechanic.applyPanel!({ cinemaLevel: 5, panel: p0, settings: { 'qianxia.c6FocusCoverage': 1 } } as any)
    expect(p0.critRate).toBeCloseTo(10)
    expect(p0.critDmg).toBeCloseTo(50)
  })
})

describe('千夏猫的凝视触发与磨爪器（2026-08-31 建模）', () => {
  const mkExec = (moveId: string, count: number): any => ({
    moveId, moveName: moveId, category: 'special', count, actionTime: 1,
    totalTime: count, comboAlignRatio: 0, totalComboAlignTime: 0,
    energyConsume: 0, totalEnergyConsume: 0, decibelRecovery: 0, totalDecibelRecovery: 0,
    energyRecovery: 0, totalEnergyRecovery: 0,
  })

  it('凝视触发次数 = min(标记供给, 触发者命中)；倍率按强攻/异常占比拆分', () => {
    // 标记供给 10（强特 #1×10）、触发者命中 8 → 8 次；队内强攻1+异常1 → 各半
    const executions = [mkExec('1491007', 10)]
    const cfg: any = {
      qianxiaCinemaLevel: 0, qianxiaAttackAgents: 1, qianxiaAnomalyAgents: 1,
      qianxiaTriggerHits: 8, teamVeilCountTotal: 2, battleTime: 180,
      panel: {},
    }
    qianxiaMechanic.buildExecutions!({ cfg, state: { ultimateCount: 1 } as any, executions })
    const gazeRows = executions.filter(e => String(e.moveId).startsWith('1491_gaze'))
    expect(gazeRows).toHaveLength(2)
    expect(gazeRows[0].count).toBe(4) // 强攻 8×0.5
    expect(gazeRows[0].damageMultiplier).toBe(150)
    expect(gazeRows[1].count).toBe(4) // 异常 8×0.5
    expect(gazeRows[1].damageMultiplier).toBe(240)
    expect(gazeRows[1].critRateBonus).toBe(100)
    expect(gazeRows[1].critDmgBonus).toBe(80)
    expect(executions.every(e => e.timeBucket === 'backstage' || !String(e.moveId).startsWith('1491_'))).toBe(true)
  })

  it('影画2：触发倍率提升 350%/540%；影画6：凝视伤害 +50%；磨爪器→泡泡行', () => {
    const executions = [mkExec('1491008', 6)]
    const cfg: any = {
      qianxiaCinemaLevel: 6, qianxiaAttackAgents: 1, qianxiaAnomalyAgents: 0,
      qianxiaTriggerHits: 6, teamVeilCountTotal: 3, battleTime: 180,
      panel: {},
    }
    qianxiaMechanic.buildExecutions!({ cfg, state: { ultimateCount: 2 } as any, executions })
    const attack = executions.find(e => e.moveId === '1491_gaze_attack_trigger')!
    expect(attack.damageMultiplier).toBe(350) // 150+200
    expect(attack.dmgBonus).toBe(50) // 影画6
    // 异常触发者 0 人 → 异常行不物化（count=0 过滤）
    expect(executions.find(e => e.moveId === '1491_gaze_anomaly_trigger')).toBeUndefined()
    // 磨爪器 = 帷幕3×2 + 异常CD(0, 无异常角色) + 180/10=18 + 大招2×6=12 → 36；泡泡 = min(36, 90)=36
    const bubble = executions.find(e => e.moveId === '1491_bubble_auto_attack')!
    expect(bubble.count).toBe(36)
    expect(bubble.damageMultiplier).toBe(100)
  })

  it('标记招式常量覆盖普攻第四段与全部强特段（倍率表真实行）', () => {
    expect([...QIANXIA_GAZE_MARK_MOVE_IDS].sort()).toEqual(
      ['1491004', '1491007', '1491008', '1491018', '1491019'].sort(),
    )
  })

  it('滑块 qianxia.gazeTriggerHits：手动触发者命中数确实改变凝视触发次数（0=自动按标记供给）', () => {
    const mk = (settingHits: number) => {
      const executions = [mkExec('1491007', 10)]
      const cfg: any = {
        qianxiaCinemaLevel: 0, qianxiaAttackAgents: 1, qianxiaAnomalyAgents: 0,
        qianxiaTriggerHits: settingHits, teamVeilCountTotal: 0, battleTime: 180,
        panel: {},
      }
      qianxiaMechanic.buildExecutions!({ cfg, state: { ultimateCount: 0 } as any, executions })
      return executions.find(e => e.moveId === '1491_gaze_attack_trigger')!.count
    }
    expect(mk(0)).toBe(10) // 自动 = 标记供给 10
    expect(mk(4)).toBe(4) // 手动 4 < 供给
    expect(mk(20)).toBe(10) // 手动 20 > 供给 → min 封顶 10
  })
})
