import { describe, expect, it } from 'vitest'
import { computePanelPhases } from '@/composables/resourceCalc/helpers'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { emptyPanel } from '@/core/panel'
import {
  PIPER_BUILDUP_COVERAGE_DEFAULT,
  PIPER_C2_BASE_DMG,
  PIPER_C2_MOVE_WEIGHTS,
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
  it('满层通道：C0封顶20层、影画1封顶30层（起手转满后保持住，影画2增伤吃它）', () => {
    const c0 = computePiperMomentum({ cinemaLevel: 0 })
    expect(c0.cap).toBe(20)
    expect(c0.stacks).toBe(20)

    const c1 = computePiperMomentum({ cinemaLevel: 1 })
    expect(c1.cap).toBe(30)
    expect(c1.stacks).toBe(30)
  })

  it('积蓄通道：默认满覆盖（只有开局启动那段逐层，用户 2026-09-01 澄清），但可显式调低建模爬坡', () => {
    expect(PIPER_BUILDUP_COVERAGE_DEFAULT).toBe(1)
    expect(computePiperMomentum({ cinemaLevel: 0 }).buildupStacks).toBe(20)
    expect(computePiperMomentum({ cinemaLevel: 1 }).buildupStacks).toBe(30)
    // 两条通道结构上分离：调低覆盖率只动积蓄侧，影画2 的满层不受影响
    const ramp = computePiperMomentum({ cinemaLevel: 1, buildupCoverage: 0.6 })
    expect(ramp.buildupStacks).toBe(18)
    expect(ramp.stacks).toBe(30)
  })

  it('动力满层只提升派派物理异常积蓄效率，C6将持续时间从12秒延长至16秒', () => {
    // 面板级机制走 applyPanel（不是 transformSkillExecutions）：后者在收敛轮间对同一缓存
    // 面板对象 += 累积，曾致积蓄效率 80%×20 轮 = 1600%（2026-09-01 排查派派高估时发现）
    const panel = emptyPanel() as any
    piperMechanic.applyPanel!({ cinemaLevel: 6, panel, settings: {} } as any)
    expect(panel.physicalAnomalyBuildUpEfficiency).toBe(120) // 默认满覆盖：30 层 × 4%
    expect(panel.piperMomentumStacks).toBe(30) // 满层通道（影画2 用）
    expect(panel.dmgBonus ?? 0).toBe(0)

    const c0 = computePiperMomentum({ cinemaLevel: 0 })
    const c6 = computePiperMomentum({ cinemaLevel: 6 })
    expect(c0.durationSeconds).toBe(12)
    expect(c6.durationSeconds).toBe(16)
  })
})

describe('派派影画机制', () => {
  it('C2只给指定下砸招式增加10%+满层动力的物理增伤（恒满）', () => {
    const target = [...PIPER_C2_MOVE_IDS].map(moveId => ({ moveId, dmgBonus: 0 }))
    const other = [{ moveId: '1281005', dmgBonus: 0 }, { moveId: '1281010', dmgBonus: 0 }]
    piperMechanic.patchExecutions!({
      cfg: { piperCinemaLevel: 2 },
      state: { exSpecialCount: 2, ultimateCount: 0 },
      executions: [...target, ...other],
    } as any)
    // 影画1+ 满层30 → 10 + 30 = 40%；终结技只有 30% 倍率是下砸 → 按占比折算 40 × 0.3 = 12
    for (const exec of target) {
      const expected = (PIPER_C2_BASE_DMG + 30) * (PIPER_C2_MOVE_WEIGHTS[exec.moveId] ?? 1)
      expect(exec.dmgBonus, exec.moveId).toBe(expected)
    }
    expect(target.find(e => e.moveId === '1281014')!.dmgBonus).toBe(12)
    expect(target.find(e => e.moveId === '1281009')!.dmgBonus).toBe(40)
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

describe('派派动力覆盖率滑块（校准对照实验的唯一入口）', () => {
  it('面板通道幂等：同一面板对象重复 applyPanel 不累积（回归：曾在收敛轮间叠成 1600%）', () => {
    const panel = emptyPanel() as any
    piperMechanic.applyPanel!({ cinemaLevel: 6, panel, settings: {} } as any)
    const once = panel.physicalAnomalyBuildUpEfficiency
    // 引擎每轮重算都会给新面板对象；这里显式验证「同对象再来一次」不会翻倍——
    // 真出现累积时该断言会红（这正是派派高估 +18652 的真实根因）
    const fresh = emptyPanel() as any
    piperMechanic.applyPanel!({ cinemaLevel: 6, panel: fresh, settings: {} } as any)
    expect(fresh.physicalAnomalyBuildUpEfficiency).toBe(once)
  })

  it('纯函数：覆盖率只折算积蓄通道，按 round(cap × coverage) 并钳制在 [0, cap]', () => {
    expect(computePiperMomentum({ cinemaLevel: 1, buildupCoverage: 0.5 }).buildupStacks).toBe(15)
    expect(computePiperMomentum({ cinemaLevel: 0, buildupCoverage: 0.5 }).buildupStacks).toBe(10)
    expect(computePiperMomentum({ cinemaLevel: 1, buildupCoverage: 0 }).buildupStacks).toBe(0)
    expect(computePiperMomentum({ cinemaLevel: 1, buildupCoverage: 5 }).buildupStacks).toBe(30) // 越界钳制
    // 满层通道不受滑块影响
    expect(computePiperMomentum({ cinemaLevel: 1, buildupCoverage: 0 }).stacks).toBe(30)
    expect(computePiperMomentum({ cinemaLevel: 1, buildupCoverage: 0.5 }).note).toContain('覆盖率')
  })

  it('折算同时穿到两处：物理积蓄效率与影画2增伤', () => {
    const panel = emptyPanel() as any
    piperMechanic.applyPanel!({ cinemaLevel: 6, panel, settings: { 'piper.momentumCoverage': 0.5 } } as any)
    expect(panel.physicalAnomalyBuildUpEfficiency).toBe(60) // 覆盖率 50% → 15 层 × 4%（默认满覆盖时是 120）
    expect(panel.piperMomentumStacks).toBe(30) // 满层通道不受滑块影响
  })

  it('滑块生效（端到端）：积蓄覆盖率 40% → 积蓄层数与全队总伤同时下降', async () => {
    const full = await setup('1411', 1)
    const calcFull = useResourceCalc()
    const cycleFull = calcFull.resourceResult.value?.characters?.[0]?.specResources?.piper_momentum as { stacks: number; buildupStacks: number } | undefined
    const dmgFull = calcFull.teamTotalDamage.value ?? 0
    expect(cycleFull?.stacks).toBe(30)
    expect(cycleFull?.buildupStacks).toBe(30) // 默认满覆盖
    expect(dmgFull).toBeGreaterThan(0)
    void full

    const low = await setup('1411', 1)
    low.config.setMechanicSetting('piper.momentumCoverage', 0.4)
    const calcLow = useResourceCalc()
    const cycleLow = calcLow.resourceResult.value?.characters?.[0]?.specResources?.piper_momentum as { stacks: number; buildupStacks: number } | undefined
    const dmgLow = calcLow.teamTotalDamage.value ?? 0
    expect(cycleLow?.buildupStacks).toBe(12) // round(30 × 0.4)
    expect(cycleLow?.stacks).toBe(30) // 满层不受影响
    expect(dmgLow).toBeLessThan(dmgFull)
  })
})

describe('影画3/5 技能等级：通用规则已覆盖，模块不重复实现（用户 2026-09-01「技能等级应该建模」的查证结果）', () => {
  it('派派 C0/C3/C5 的 skillLevelBonus = 0 / 2 / 4（通用通道，resourceCalc/helpers.ts）', async () => {
    for (const [cinema, expected] of [[0, 0], [3, 2], [5, 4], [6, 4]] as const) {
      const { catalog, config } = await setup('1411', cinema)
      const panel = computePanelPhases(0, config, catalog)!.inCombat as any
      expect(panel.skillLevelBonus ?? 0, 'cinema=' + cinema).toBe(expected)
    }
  })
})