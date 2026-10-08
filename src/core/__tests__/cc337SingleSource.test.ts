import { describe, expect, it } from 'vitest'
import { discRequirementMet, resolveDiscStatTemplate } from '@/core/buff'
import { calcFlashEnergyRegenTotal, calcEnergyRegenTotal } from '@/data/agentPanelStats'
import { calcPanel, emptyPanel } from '@/core/panel'
import { parseMoveEnergyCost } from '@/core/resource/moveLookup'
import { IMPACT_VARIABLES } from '@/core/impactVars'
import { computePerSlotBuildUp } from '@/composables/positionCompare'
import type { Agent, BuffEffect } from '@/types/catalog'
import type { AnomalyPoolResult } from '@/types/resource'

describe('CC-337: 单一事实源与跨模块对账守护', () => {
  it('calcPanel 在 outOfCombat 与 inCombat 面板上统一盖章 energyRegenOutOfCombat', () => {
    const agent = {
      id: 'test-agent',
      name: { zh: '测试', en: 'Test' },
      rarity: 'S',
      attribute: 'fire',
      specialty: 'anomaly',
      faction: 'test',
      level60: {
        hpBase: 8000,
        atkBase: 800,
        defBase: 600,
        impact: 90,
        critRate: 5,
        critDmg: 50,
        anomalyMastery: 110,
        anomalyProficiency: 110,
        penRatio: 0,
        energyRegen: 1.5,
      },
      coreSkill: { levels: [] },
      combatBuffs: {
        corePassive: {
          scope: 'outOfCombat',
          effects: [
            {
              id: 'out-er-pct',
              type: 'fixed',
              stat: 'energyRegenBonusPct',
              value: 20,
              mode: 'pct',
            },
            {
              id: 'out-er-flat',
              type: 'fixed',
              stat: 'energyRegenBonusFlat',
              value: 0.3,
              mode: 'flat',
            },
          ],
        },
        additionalAbility: {
          scope: 'inCombat',
          effects: [
            {
              id: 'in-er-pct',
              type: 'fixed',
              stat: 'energyRegenBonusPct',
              value: 50,
              mode: 'pct',
            },
          ],
        },
        cinemaBuffs: [],
      },
    } as unknown as Agent

    const res = calcPanel(
      agent,
      undefined,
      {
        fourPieceSetId: '',
        twoPieceSetId: '',
        mainStats: { 4: 'atkPct', 5: 'atkPct', 6: 'atkPct' },
        subStatAllocation: {} as never,
      },
      new Map(),
      [],
      null,
      { cinemaLevel: 0, wEngineModLevel: 1 },
    )

    // 局外回能 = 1.5 * (1 + 0.20) + 0.3 = 2.1
    expect(res.outOfCombat.energyRegenOutOfCombat).toBeCloseTo(2.1, 9)
    // 局内面板继承同一个局外总回能（不受局内 +50% 回能影响）
    expect(res.inCombat.energyRegenOutOfCombat).toBeCloseTo(2.1, 9)
    // 局内实时总回能 = 1.5 * (1 + 0.70) + 0.3 = 2.85
    expect(calcEnergyRegenTotal(res.inCombat)).toBeCloseTo(2.85, 9)

    const flashPanel = emptyPanel()
    flashPanel.flashEnergyRegen = 2
    flashPanel.flashEnergyRegenBonusPct = 25
    flashPanel.flashEnergyRegenBonusFlat = 0.5
    expect(calcFlashEnergyRegenTotal(flashPanel)).toBeCloseTo(3.0, 9)
  })

  it('discRequirementMet 与 resolveDiscStatTemplate 统一处理门槛与 {attribute} 模板', () => {
    const agent = {
      id: '1131',
      attribute: 'ice',
      specialty: 'support',
    } as unknown as Agent

    expect(
      discRequirementMet(
        { specialty: 'support', outOfCombatStat: { stat: 'anomalyProficiency', min: 120 } as never },
        agent,
        { anomalyProficiency: 150 },
      ),
    ).toBe(true)
    expect(
      discRequirementMet(
        { outOfCombatStat: { stat: 'anomalyProficiency', min: 120 } as never },
        agent,
        { anomalyProficiency: 100 },
      ),
    ).toBe(false)
    expect(
      discRequirementMet(
        { outOfCombatStat: { stat: 'anomalyProficiency', min: 120 } as never },
        agent,
        undefined,
      ),
    ).toBe(false)

    const rawEffect: BuffEffect = {
      id: 'freedom-blues-4pc',
      type: 'fixed',
      stat: 'enemy{attribute}AnomalyBuildupResReductionPct' as never,
      value: 20,
      mode: 'pct',
    }
    expect(resolveDiscStatTemplate(rawEffect, agent.attribute).stat).toBe(
      'enemyIceAnomalyBuildupResReductionPct',
    )
  })

  it('parseMoveEnergyCost 区分能量与替代资源（防轴块把非能量资源当能量扣减）', () => {
    expect(parseMoveEnergyCost(undefined)).toEqual({
      energyConsume: 0,
      costType: 'free',
      costAmount: 0,
      resourceId: undefined,
    })
    expect(parseMoveEnergyCost({ 'Energy Cost': '60', 'Follow-Up Energy Cost': '20' })).toEqual({
      energyConsume: 60,
      costType: 'energy',
      costAmount: 60,
      resourceId: undefined,
    })
    expect(parseMoveEnergyCost({ 'Flash Energy Cost': '40' })).toEqual({
      energyConsume: 40,
      costType: 'energy',
      costAmount: 40,
      resourceId: 'flash',
    })
    expect(parseMoveEnergyCost({ 'Sharpness Cost': '60' })).toEqual({
      energyConsume: 0,
      costType: 'resource',
      costAmount: 60,
      resourceId: 'sharpness',
    })
  })

  it('computePerSlotBuildUp 将异属性赠送积蓄归因到同属性主贡献者槽位', () => {
    const anomalyPool = {
      perElement: [
        {
          element: 'ice',
          contributions: [
            { slot: 0, element: 'ice', totalBuildUp: 1200 },
            { slot: 2, element: 'ice', totalBuildUp: 300 }, // 2 号位物理角色赠送的冰积蓄
          ],
        },
      ],
    } as unknown as AnomalyPoolResult
    const team = [{ agentId: 'ice-main' }, { agentId: 'sub' }, { agentId: 'phys-gifter' }]
    const catalog = {
      getAgent: (id: string) =>
        id === 'ice-main'
          ? { damageElement: 'ice' }
          : id === 'phys-gifter'
            ? { damageElement: 'physical' }
            : { damageElement: 'fire' },
    }
    expect(computePerSlotBuildUp(anomalyPool, team, catalog)).toEqual([1500, 0, 0])
  })

  it('六种属性抗性变量由 resistanceVar 统一生成读写（CC-538：表项自带 read / write）', () => {
    const state: Record<string, any> = {
      enemy: { damageResistances: { physical: 10, fire: -20, ice: 0, electric: 0, ether: 0, wind: 0 } },
    }
    const store = {
      get enemy() {
        return state.enemy
      },
      setEnemy(patch: Record<string, any>) {
        state.enemy = { ...state.enemy, ...patch }
      },
      setActionCount() {},
      team: [],
    }
    const res = (element: string) => IMPACT_VARIABLES.find(v => v.id === `${element}Resistance`)!
    expect(res('physical').read(store)).toBe(10)
    expect(res('fire').read(store)).toBe(-20)

    res('wind').write(store, -15)
    expect(state.enemy.damageResistances).toEqual({ physical: 10, fire: -20, ice: 0, electric: 0, ether: 0, wind: -15 })
    expect(res('wind').read(store)).toBe(-15)
  })
})
