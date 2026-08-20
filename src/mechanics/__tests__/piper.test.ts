import { describe, expect, it } from 'vitest'
import { computePanelPhases } from '@/composables/resourceCalc/helpers'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { emptyPanel } from '@/core/panel'
import {
  PIPER_C2_BASE_DMG,
  PIPER_C2_MOVE_IDS,
  PIPER_C4_ENERGY,
  computePiperMomentum,
  piperMechanic,
} from '@/mechanics/agents/piper'
import { setupHarness } from '@/test/harness'

async function setup(mateId = '1411', cinemaLevel = 0) {
  const result = await setupHarness([
    { agentId: '1281', cinemaLevel, parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
    { agentId: mateId, cinemaLevel: 0, parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
    '',
  ])
  for (const buff of result.config.globalBuffs) buff.enabled = false
  return result
}

describe('派派（1281）动力循环', () => {
  it('C0按旋转命中获得动力并封顶20层，C1按50%期望追加且封顶30层', () => {
    const c0 = computePiperMomentum({
      cinemaLevel: 0,
      exSpecialCount: 4,
      ultimateCount: 1,
    })
    expect(c0.baseGain).toBe(28)
    expect(c0.c1ExpectedGain).toBe(0)
    expect(c0.cap).toBe(20)
    expect(c0.stacks).toBe(20)

    const c1 = computePiperMomentum({
      cinemaLevel: 1,
      exSpecialCount: 3,
      ultimateCount: 1,
      specialHitCount: 4,
    })
    expect(c1.baseGain).toBe(23)
    expect(c1.c1ExpectedGain).toBe(13.5)
    expect(c1.cap).toBe(30)
    expect(c1.stacks).toBe(30)
  })

  it('动力层数只提升派派物理异常积蓄效率，C6将持续时间从12秒延长至16秒', () => {
    const panel = emptyPanel() as any
    piperMechanic.transformSkillExecutions!({
      panel,
      charResult: {
        specResources: {
          piper_momentum: computePiperMomentum({
            cinemaLevel: 6,
            exSpecialCount: 2,
            ultimateCount: 0,
          }),
        },
      },
    } as any)
    expect(panel.physicalAnomalyBuildUpEfficiency).toBe(60)
    expect(panel.piperMomentumStacks).toBe(15)
    expect(panel.dmgBonus ?? 0).toBe(0)

    const c0 = computePiperMomentum({ cinemaLevel: 0, exSpecialCount: 0, ultimateCount: 0 })
    const c6 = computePiperMomentum({ cinemaLevel: 6, exSpecialCount: 0, ultimateCount: 0 })
    expect(c0.durationSeconds).toBe(12)
    expect(c6.durationSeconds).toBe(16)
  })
})

describe('派派影画机制', () => {
  it('C2只给指定下砸招式增加10%加当前动力层数的物理增伤', () => {
    const target = [...PIPER_C2_MOVE_IDS].map(moveId => ({ moveId, dmgBonus: 0 }))
    const other = [{ moveId: '1281005', dmgBonus: 0 }, { moveId: '1281010', dmgBonus: 0 }]
    piperMechanic.patchExecutions!({
      cfg: {
        piperCinemaLevel: 2,
        piperSpecialSpinHits: 0,
        piperExHitsPerUse: 5,
        piperUltHitsPerUse: 8,
      },
      state: { exSpecialCount: 2, ultimateCount: 0 },
      executions: [...target, ...other],
    } as any)
    for (const exec of target) expect(exec.dmgBonus).toBe(PIPER_C2_BASE_DMG + 15)
    for (const exec of other) expect(exec.dmgBonus).toBe(0)
  })

  it('C4按异常触发次数回复能量，并受30秒冷却次数上限约束', () => {
    const c3 = { battleTime: 180, initialEnergyGift: 5 } as any
    piperMechanic.buildCharConfig!({ cinemaLevel: 3, cfg: c3 } as any)
    expect(c3.initialEnergyGift).toBe(5)

    const c4 = {
      battleTime: 90,
      initialEnergyGift: 5,
      'setting:piper.c4AnomalyTriggers': 6,
    } as any
    piperMechanic.buildCharConfig!({ cinemaLevel: 4, cfg: c4 } as any)
    expect(c4.piperC4AnomalyTriggers).toBe(3)
    expect(c4.initialEnergyGift).toBe(5 + 3 * PIPER_C4_ENERGY)
  })
})

describe('派派额外能力与完整提取链', () => {
  it('同属性、同阵营或其他异常队友激活全队18%增伤，普通异属性队友不激活', async () => {
    for (const mateId of ['1411', '1151', '1181']) {
      const { catalog, config } = await setup(mateId)
      const on = (computePanelPhases(0, config, catalog)!.inCombat as any).dmgBonus as number
      config.toggleTeammateBuff('piper_extra_team_damage', false)
      const off = (computePanelPhases(0, config, catalog)!.inCombat as any).dmgBonus as number
      expect(on - off).toBeCloseTo(18, 5)
    }

    const { catalog, config } = await setup('1271')
    const on = (computePanelPhases(0, config, catalog)!.inCombat as any).dmgBonus as number
    config.toggleTeammateBuff('piper_extra_team_damage', false)
    const off = (computePanelPhases(0, config, catalog)!.inCombat as any).dmgBonus as number
    expect(on).toBeCloseTo(off, 5)
  })

  it('面板后处理不会接管倍率提取，派派非普攻仍进入失衡与异常池', async () => {
    const { catalog } = await setup('1411')
    const calc = useResourceCalc()
    const result = calc.resourceResult.value!
    const piper = result.characters.find(character => character.agentId === '1281')!
    const nonBasicMoveIds = new Set(
      piper.executions
        .filter(exec => exec.moveId !== 'basic_attack' && exec.count > 0)
        .map(exec => exec.moveId),
    )
    expect(nonBasicMoveIds.size).toBeGreaterThan(0)

    const stunIds = new Set(
      calc.stunPoolResult.value!.contributions
        .filter(row => row.slot === 0)
        .map(row => row.moveId),
    )
    expect([...nonBasicMoveIds].some(moveId => stunIds.has(moveId))).toBe(true)
    expect(
      calc.anomalyPoolResult.value!.perElement
        .find(row => row.element === 'physical')?.totalBuildUp ?? 0,
    ).toBeGreaterThan(0)
    expect((calc.panels.value[0] as any).piperMomentumStacks).toBeGreaterThan(0)
    expect(catalog.getAgentSkills('1281')).toBeTruthy()
  })
})
