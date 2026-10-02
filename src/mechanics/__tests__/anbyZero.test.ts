import { describe, expect, it } from 'vitest'
import { computePanelPhases } from '@/composables/resourceCalc/helpers'
import { useResourceCalc } from '@/composables/useResourceCalc'
import {
  ANBY_ZERO_C2_CRIT_RATE,
  ANBY_ZERO_C4_RES_IGNORE,
  ANBY_ZERO_C6_VORTEX_MULTIPLIER,
  ANBY_ZERO_ADDITIONAL_CRIT_RATE,
  ANBY_ZERO_CORE_DMG,
  ANBY_ZERO_RAIJITU_MOVE_ID,
  ANBY_ZERO_TEAM_FOLLOWUP_DMG_BY_POTENTIAL,
  ANBY_ZERO_WHITE_LIGHTNING_MOVE_ID,
  computeAnbyZeroCycle,
  anbyZeroMechanic,
} from '@/mechanics/agents/anbyZero'
import { setupHarness } from '@/test/harness'
import { getAgentSpec } from '@/specs/registry'

async function setup(mateId = '1141', cinemaLevel = 0, potentialLevel = 6) {
  const result = await setupHarness([
    { agentId: '1381', cinemaLevel, potentialLevel, parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
    { agentId: mateId, cinemaLevel: 0, potentialLevel: 6, parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
  ])
  for (const buff of result.config.globalBuffs) buff.enabled = false
  return result
}

function cycle(overrides: Partial<Parameters<typeof computeAnbyZeroCycle>[0]> = {}) {
  return computeAnbyZeroCycle({
    cinemaLevel: 6,
    potentialLevel: 6,
    cangguangCount: 6,
    exSpecialCount: 2,
    additionalActive: true,
    silverStarCoverage: 1,
    ...overrides,
  })
}

describe('零号·安比（1381）白雷折算', () => {
  it('白雷次数=苍光+影画1强特×3，雷殛每3次、涡流每6次整除', () => {
    const c = cycle({ cinemaLevel: 6, cangguangCount: 6, exSpecialCount: 2 })
    expect(c.whiteLightningFromCangguang).toBe(6)
    expect(c.whiteLightningFromC1).toBe(6)
    expect(c.whiteLightningTotal).toBe(12)
    expect(c.raijituCount).toBe(4)
    expect(c.vortexCount).toBe(2)
    // 非6命不产生涡流；非1命强特不产生白雷
    expect(cycle({ cinemaLevel: 0, exSpecialCount: 2 }).whiteLightningFromC1).toBe(0)
    expect(cycle({ cinemaLevel: 5, cangguangCount: 6 }).vortexCount).toBe(0)
  })

  it('核心被动增伤与影画4电抗无视按银星覆盖率折算', () => {
    expect(cycle({ silverStarCoverage: 0.5 }).coreDmgBonus).toBe(ANBY_ZERO_CORE_DMG * 0.5)
    expect(cycle({ cinemaLevel: 4, silverStarCoverage: 1 }).c4ResIgnore).toBe(ANBY_ZERO_C4_RES_IGNORE)
    expect(cycle({ cinemaLevel: 3 }).c4ResIgnore).toBe(0)
  })

  it('暴击率=额外能力+10与影画2+12叠加', () => {
    expect(cycle({ cinemaLevel: 2, additionalActive: true }).critRateGain).toBe(
      ANBY_ZERO_ADDITIONAL_CRIT_RATE + ANBY_ZERO_C2_CRIT_RATE)
    expect(cycle({ cinemaLevel: 2, additionalActive: false }).critRateGain).toBe(ANBY_ZERO_C2_CRIT_RATE)
    expect(cycle({ cinemaLevel: 0, additionalActive: true }).critRateGain).toBe(ANBY_ZERO_ADDITIONAL_CRIT_RATE)
  })
})

describe('零号·安比执行行', () => {
  const cfgWith = (cinema: number, extra: Record<string, unknown> = {}) => ({
    panel: { additionalAbilityActive: 1 },
    anbyZeroCinemaLevel: cinema,
    anbyZeroCangguangCount: 6,
    anbyZeroSilverStarCoverage: 1,
    anbyZeroAdditionalActive: true,
    ...extra,
  })

  it('生成真实moveId白雷/雷殛行与合成涡流行，均视为追加攻击', () => {
    const executions: any[] = []
    anbyZeroMechanic.buildExecutions!({
      cfg: cfgWith(6),
      state: { exSpecialCount: 2, ultimateCount: 0, chainCountTotal: 0 },
      executions,
    } as any)
    const wl = executions.find(r => r.moveId === ANBY_ZERO_WHITE_LIGHTNING_MOVE_ID)
    expect(wl.count).toBe(12)
    expect(wl.skillDamageTarget).toBe('additionalAttack')
    expect(executions.find(r => r.moveId === ANBY_ZERO_RAIJITU_MOVE_ID)?.count).toBe(4)
    const vortex = executions.find(r => r.moveId === '1381_c6_electromagnetic_vortex')
    expect(vortex.count).toBe(2)
    expect(vortex.damageMultiplier).toBe(ANBY_ZERO_C6_VORTEX_MULTIPLIER)
    expect(vortex.damageMultiplierOverride).toBe(true)
    expect(vortex.skillDamageTarget).toBe('additionalAttack')
  })

  it('低命座不产生涡流行', () => {
    const executions: any[] = []
    anbyZeroMechanic.buildExecutions!({
      cfg: cfgWith(0),
      state: { exSpecialCount: 0, ultimateCount: 0, chainCountTotal: 0 },
      executions,
    } as any)
    expect(executions.find(r => r.moveId === '1381_c6_electromagnetic_vortex')).toBeUndefined()
  })
})

describe('零号·安比完整计算链', () => {
  it('额外能力由击破/支援队友激活，攻击队友不激活', async () => {
    for (const mateId of ['1141', '1031']) {
      const { catalog, config } = await setup(mateId)
      expect((computePanelPhases(0, config, catalog)!.inCombat as any).additionalAbilityActive).toBe(1)
    }
    const neg = await setup('1191')
    expect((computePanelPhases(0, neg.config, neg.catalog)!.inCombat as any).additionalAbilityActive ?? 0).toBe(0)
  })

  it('资源池生成白雷/雷殛/涡流行', async () => {
    await setup('1141', 6)
    const calc = useResourceCalc()
    const anby = calc.resourceResult.value!.characters.find(row => row.agentId === '1381')!
    expect(anby.executions.some(row => row.moveId === ANBY_ZERO_WHITE_LIGHTNING_MOVE_ID)).toBe(true)
    expect(anby.anbyZeroCycle).toBeTruthy()
  })

  it('面板增益进入最终面板（暴击率/银星增伤/影画4电抗无视）', async () => {
    await setup('1141', 4)
    const calc = useResourceCalc()
    expect(calc.resourceResult.value!.characters.find(row => row.agentId === '1381')!.anbyZeroCycle).toBeTruthy()
    const panel = calc.panels.value[0] as any
    expect(panel.critRate).toBeGreaterThanOrEqual(ANBY_ZERO_ADDITIONAL_CRIT_RATE + ANBY_ZERO_C2_CRIT_RATE)
    expect(panel.dmgBonus).toBeGreaterThanOrEqual(ANBY_ZERO_CORE_DMG)
    expect(panel.enemyElectricResReduction).toBeGreaterThanOrEqual(ANBY_ZERO_C4_RES_IGNORE)
  })

  it('覆盖率滑块→面板重算（防守卫冻结，SOP §3.5）', async () => {
    const { catalog, config } = await setup('1141', 4)
    const dmgOf = () => (computePanelPhases(0, config, catalog)!.inCombat as any).dmgBonus ?? 0
    config.setMechanicSetting('anbyZero.silverStarCoverage', 1)
    const on = dmgOf()
    config.setMechanicSetting('anbyZero.silverStarCoverage', 0)
    const off = dmgOf()
    expect(on - off).toBeCloseTo(ANBY_ZERO_CORE_DMG, 1)
  })
})

describe('零号·安比全队追加攻击增伤（teamBuff 全队通道）', () => {
  it('第 228 轮：展示表 ANBY_ZERO_TEAM_FOLLOWUP_DMG_BY_POTENTIAL 与 spec 公式逐档相等；结果卡字段不乘银星覆盖率', () => {
    const effect = getAgentSpec('1381')!.teamBuffs!.find(b => b.id === 'anby_zero_extra_team_followup')!.effects![0] as any
    // 公式文本被改 ⇒ 本断言红，提醒同步展示表
    expect(effect.formula.expression).toBe('25 + min(1, max(0, x - 1)) * (4*x + 1)')
    for (let x = 1; x <= 6; x++) {
      expect(ANBY_ZERO_TEAM_FOLLOWUP_DMG_BY_POTENTIAL[x], `潜能 ${x}`).toBe(25 + Math.min(1, Math.max(0, x - 1)) * (4 * x + 1))
      expect(cycle({ potentialLevel: x, silverStarCoverage: 0.5 }).teamFollowupDmgBonus).toBe(ANBY_ZERO_TEAM_FOLLOWUP_DMG_BY_POTENTIAL[x])
    }
    expect(cycle({ additionalActive: false }).teamFollowupDmgBonus).toBe(0)
  })

  it('第 228 轮：引擎生效值随潜能变化——队友面板满潜比 1 潜多 25（50 vs 25）', async () => {
    const hi = await setup('1141', 0, 6)
    const v6 = (computePanelPhases(1, hi.config, hi.catalog)!.inCombat as any).dmgBonus__additionalAttack
    const lo = await setup('1141', 0, 1)
    const v1 = (computePanelPhases(1, lo.config, lo.catalog)!.inCombat as any).dmgBonus__additionalAttack
    expect(v6 - v1).toBeCloseTo(25, 6)
  })

  it('额外能力电极化：全队 dmgBonus__additionalAttack +25%（teamBuff 合并）', async () => {
    const { catalog, config } = await setup('1141', 0)
    const p0 = computePanelPhases(0, config, catalog)!.inCombat as any
    expect(p0.dmgBonus__additionalAttack).toBeGreaterThanOrEqual(25)
    // 队友面板也吃到（全队向）
    const p1 = computePanelPhases(1, config, catalog)!.inCombat as any
    expect(p1.dmgBonus__additionalAttack).toBeGreaterThanOrEqual(25)
  })

  it('核心被动银星追攻暴伤：全队 critDmg__additionalAttack = 安比自身暴伤×35%（derived）', async () => {
    const { catalog, config } = await setup('1141', 0)
    const p0 = computePanelPhases(0, config, catalog)!.inCombat as any
    // 自身暴伤基准 50 → 追加攻击暴伤额外 ≈ 50×0.35 = 17.5
    expect(p0.critDmg__additionalAttack).toBeGreaterThanOrEqual(17)
    const p1 = computePanelPhases(1, config, catalog)!.inCombat as any
    expect(p1.critDmg__additionalAttack).toBeGreaterThanOrEqual(17)
  })

  it('潜能电脉冲档位驱动全队追攻增伤：潜能I=25% / 潜能VI=50%', async () => {
    const p1 = (await setup('1141', 0, 1))
    const p1p = computePanelPhases(0, p1.config, p1.catalog)!.inCombat as any
    expect(p1p.dmgBonus__additionalAttack).toBeGreaterThanOrEqual(25)
    expect(p1p.dmgBonus__additionalAttack).toBeLessThan(34)

    const p6 = (await setup('1141', 0, 6))
    const p6p = computePanelPhases(0, p6.config, p6.catalog)!.inCombat as any
    expect(p6p.dmgBonus__additionalAttack).toBeGreaterThanOrEqual(50)
  })
})

describe('零号安比滑块生效差分（防守卫冻结，SOP §3.5）', () => {
  const base = { cinemaLevel: 0, potentialLevel: 6, exSpecialCount: 2, additionalActive: true, silverStarCoverage: 1 }

  it('anbyZero.cangguangCount → 白雷总量差分（苍光次数直接入白雷池 → 雷缀次数）', () => {
    const on = computeAnbyZeroCycle({ ...base, cangguangCount: 6 })
    const off = computeAnbyZeroCycle({ ...base, cangguangCount: 0 })
    expect(on.whiteLightningTotal - off.whiteLightningTotal).toBe(6)
    expect(on.raijituCount).toBeGreaterThan(off.raijituCount)
  })
})
