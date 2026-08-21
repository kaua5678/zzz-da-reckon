import { describe, expect, it } from 'vitest'
import { computePanelPhases } from '@/composables/resourceCalc/helpers'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { setupHarness } from '@/test/harness'
import {
  BEN_C2_DEF_MULT,
  BEN_C4_COUNTER_DMG,
  BEN_C6_STUN_BONUS,
  BEN_DEF_TO_ATK,
  BEN_EX_NORMAL_MOVE_IDS,
  BEN_EX_PARRY_MOVE_IDS,
  BEN_EX_PARRY_RATE_SETTING,
  MOVE_C2_COUNTER,
  benMechanic,
} from '@/mechanics/agents/ben'

describe('本模块', () => {
  it('防转攻 applyPanel', () => {
    const panel: any = { def: 1000, atk: 500 }
    benMechanic.applyPanel!({ slot: 1, agent: {} as any, cinemaLevel: 0, team: [], outOfCombatPanel: panel, panel, settings: {} })
    expect(panel.atk).toBeCloseTo(500 + 1000 * BEN_DEF_TO_ATK)
  })

  it('影画2 只跟成功招架次数，影画4只增强成功反击段，影画6提升失衡', () => {
    const cfg: any = {
      benCinemaLevel: 6,
      benDef: 800,
      benExParrySuccessRate: 0.5,
      benExActionTimes: {},
    }
    const panel: any = { def: 800, atk: 0 }
    benMechanic.applyPanel!({ slot: 1, agent: {} as any, cinemaLevel: 6, team: [], outOfCombatPanel: panel, panel, settings: {} })
    expect(panel.stunBuildUpBonus__basic).toBe(BEN_C6_STUN_BONUS)

    const executions: any[] = []
    benMechanic.buildExecutions!({ cfg, state: { exSpecialCount: 4 } as any, executions } as any)
    for (const moveId of BEN_EX_NORMAL_MOVE_IDS) {
      expect(executions.find(e => e.moveId === moveId)?.count).toBe(2)
    }
    for (const moveId of BEN_EX_PARRY_MOVE_IDS) {
      expect(executions.find(e => e.moveId === moveId)?.count).toBe(2)
    }
    const c2 = executions.find(e => e.moveId === MOVE_C2_COUNTER)
    expect(c2?.count).toBe(2)
    expect(c2?.damageMultiplier).toBe(BEN_C2_DEF_MULT)
    expect(c2?.basisValueOverride).toBe(800)
    expect(c2?.dmgBonus).toBe(BEN_C4_COUNTER_DMG)

    benMechanic.patchExecutions!({ cfg, state: {} as any, executions } as any)
    expect(executions.find(e => e.moveId === '1121008')?.dmgBonus ?? 0).toBe(0)
    expect(executions.find(e => e.moveId === '1121010')?.dmgBonus).toBe(BEN_C4_COUNTER_DMG)
  })
})

describe('本全管线', () => {

  it('强特总组数=floor(可用总能量/60)，默认100%走招架成功分支', async () => {
    const { config } = await setupHarness([
      { agentId: '1121', cinemaLevel: 2 },
      { agentId: '1101' },
      '',
    ])
    for (const buff of config.globalBuffs) buff.enabled = false

    const calc = useResourceCalc()
    const ben = calc.resourceResult.value!.characters.find(char => char.agentId === '1121')!
    const expectedCombos = Math.floor(ben.derivedEnergy / 60)
    expect(ben.exSpecialCount).toBe(expectedCombos)
    for (const moveId of BEN_EX_NORMAL_MOVE_IDS) {
      expect(ben.executions.find(exec => exec.moveId === moveId)).toBeUndefined()
    }
    for (const moveId of BEN_EX_PARRY_MOVE_IDS) {
      expect(ben.executions.find(exec => exec.moveId === moveId)?.count).toBe(expectedCombos)
    }
    expect(ben.executions.find(exec => exec.moveId === MOVE_C2_COUNTER)?.count).toBe(expectedCombos)
  })

  it('强特招架成功率滑块真实分流招式，C2只按成功次数触发', async () => {
    const { config } = await setupHarness([
      { agentId: '1121', cinemaLevel: 2 },
      { agentId: '1101' },
      '',
    ])
    for (const buff of config.globalBuffs) buff.enabled = false
    config.setMechanicSetting(BEN_EX_PARRY_RATE_SETTING, 0.25)

    const calc = useResourceCalc()
    const ben = calc.resourceResult.value!.characters.find(char => char.agentId === '1121')!
    const success = ben.exSpecialCount * 0.25
    const normal = ben.exSpecialCount - success
    for (const moveId of BEN_EX_NORMAL_MOVE_IDS) {
      expect(ben.executions.find(exec => exec.moveId === moveId)?.count).toBeCloseTo(normal)
    }
    for (const moveId of BEN_EX_PARRY_MOVE_IDS) {
      expect(ben.executions.find(exec => exec.moveId === moveId)?.count).toBeCloseTo(success)
    }
    expect(ben.executions.find(exec => exec.moveId === MOVE_C2_COUNTER)?.count).toBeCloseTo(success)
  })

  it('同阵营时护盾暴击默认满覆盖，并可由用户调节覆盖率', async () => {
    const { catalog, config } = await setupHarness([
      { agentId: '1101' },
      { agentId: '1121' },
      '',
    ])
    for (const buff of config.globalBuffs) buff.enabled = false

    const full = computePanelPhases(0, config, catalog)!.inCombat
    config.setTeammateBuffCoverage('ben.additional_shield_crit_rate', 0)
    const zero = computePanelPhases(0, config, catalog)!.inCombat
    expect(full.critRate - zero.critRate).toBeCloseTo(16)

    config.setTeammateBuffCoverage('ben.additional_shield_crit_rate', 25)
    const quarter = computePanelPhases(0, config, catalog)!.inCombat
    expect(quarter.critRate - zero.critRate).toBeCloseTo(4)
  })

  it('无同属性/同阵营时护盾暴击不生效', async () => {
    const { catalog, config } = await setupHarness([
      { agentId: '1031' },
      { agentId: '1121' },
      '',
    ])
    for (const buff of config.globalBuffs) buff.enabled = false
    const out = computePanelPhases(0, config, catalog)!.outOfCombat
    const panel = computePanelPhases(0, config, catalog)!.inCombat
    expect(panel.critRate - out.critRate).toBe(0)
  })
})
