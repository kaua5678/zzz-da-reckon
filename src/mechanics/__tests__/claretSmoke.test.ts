/**
 * 克拉蕾(1611) v12 录入生效测试（2026-09-03，nanoka 3.2.12+18601660）：
 * - 锐能：进场 60 + 终结技 10/次（raw chain.description[1]）→ 秘血铸锋 60/发（旧「毁伤回锐能」口径已废除）；
 * - 残痕值：平A聚合 + 秘血铸锋 234.96% × 积蓄效率（核心 50% + 影画2 20%）→ 满 100 = 1 层；
 * - 毁伤：min(层数, 斩金断铁×1+葬血强袭×3+影画6)×覆盖率 + 影画6 直接毁伤；
 * - C2 毁伤倍率 ×130%（执行行 override）与 C1/C6 全管线抬升。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import {
  computeClaretSharpResource,
  C2_MAIM_MULT,
  SHARPNESS_COST_PER_EX,
  SHARPNESS_ULTIMATE_GAIN,
} from '@/mechanics/agents/claret'

beforeEach(() => {
  // setupHarness 内部自建 pinia；这里仅保证 fetch stub 隔离
})

describe('克拉蕾锐能（v12：进场 60 + 终结技 10/次 → 秘血铸锋 60/发）', () => {
  const base = {
    basicGashPerSec: 0,
    basicAttackTime: 0,
    exGashValue: 234.96,
    exCount: 1,
    cleaveSpecialCount: 1,
    bloodBurialCount: 1,
    gashCoverage: 1,
    cinemaLevel: 0,
    chainCountTotal: 0,
    ultimateCount: 0,
  }

  it('锐能账本 = 进场 60 + 终结技 10/次（0 次 → floor(60/60) = 1 发、结余 0）', () => {
    const r = computeClaretSharpResource({ ...base, cinemaLevel: 0 })
    expect(r.sharpnessGain).toBe(60)
    expect(r.ultimateCount).toBe(0)
    expect(r.affordableExCount).toBe(1)
    expect(r.sharpnessSpend).toBe(SHARPNESS_COST_PER_EX)
    expect(r.sharpnessRemaining).toBe(0)
  })

  it('终结技回锐能计入总量：2 次 → 80（仍 1 发、结余 20）；6 次 → 120 → 2 发', () => {
    // raw chain.description[1]「招式发动时，回复10点锐能」——此前零引用，2026-09-11 接入
    const u2 = computeClaretSharpResource({ ...base, cinemaLevel: 0, ultimateCount: 2 })
    expect(u2.sharpnessGain).toBe(60 + 2 * SHARPNESS_ULTIMATE_GAIN)
    expect(u2.affordableExCount).toBe(1)
    expect(u2.sharpnessRemaining).toBe(20)
    const u6 = computeClaretSharpResource({ ...base, cinemaLevel: 0, ultimateCount: 6 })
    expect(u6.sharpnessGain).toBe(120)
    expect(u6.affordableExCount).toBe(2)
    expect(u6.sharpnessSpend).toBe(120)
    expect(u6.sharpnessRemaining).toBe(0)
    // 负值防御：不给负数锐能
    const neg = computeClaretSharpResource({ ...base, cinemaLevel: 0, ultimateCount: -3 })
    expect(neg.sharpnessGain).toBe(60)
    expect(neg.ultimateCount).toBe(0)
  })

  it('残痕值 = (平A聚合 + 秘血铸锋 234.96%) × 积蓄效率；每 600 点 = 1 层（上限 3）', () => {
    // 仅 EX：234.96 × 1.5 = 352.44 → 0 层（用户口径：600 点一次毁伤）
    const r = computeClaretSharpResource({ ...base, cinemaLevel: 0 })
    expect(r.gashBuildupMultiplier).toBeCloseTo(1.5, 5)
    expect(r.gashValuePct).toBeCloseTo(234.96 * 1.5, 5)
    expect(r.gashStacks).toBe(0)
    // 平A 1200 + EX 234.96 → 1434.96 × 1.5 = 2152.44 → 3 层（上限）
    const full = computeClaretSharpResource({ ...base, basicGashPerSec: 20, basicAttackTime: 60 })
    expect(full.gashValuePct).toBeCloseTo((1200 + 234.96) * 1.5, 2)
    expect(full.gashStacks).toBe(3)
    // 影画2：积蓄效率 +20% → 1.7
    const r2 = computeClaretSharpResource({ ...base, cinemaLevel: 2 })
    expect(r2.gashBuildupMultiplier).toBeCloseTo(1.7, 5)
  })

  it('毁伤：min(层数, 需求) 拆分到斩金断铁/葬血强袭；影画6 直接毁伤不消耗残痕', () => {
    // 层数 3（平A 1200 + EX → 2152 × 1.5）：需求 = 斩金断铁1 + 葬血强袭3 = 4 → 消耗 3 → 毁伤 3（cleave 1 + burial 2）
    const full = { ...base, basicGashPerSec: 20, basicAttackTime: 60 }
    const r = computeClaretSharpResource(full)
    expect(r.maimDemand).toBe(4)
    expect(r.gashStackConsumed).toBe(3)
    expect(r.maimFromCleave).toBe(1)
    expect(r.maimFromBurial).toBe(2)
    expect(r.maimCount).toBe(3)
    // C6：连携/终结各 +1 直接毁伤（不占残痕层数）
    const r6 = computeClaretSharpResource({ ...full, cinemaLevel: 6, chainCountTotal: 2, ultimateCount: 1 })
    expect(r6.maimFromC6).toBe(3)
    expect(r6.maimCount).toBe(6) // 消耗 3 + C6 3
  })

  it('残痕覆盖率 50%：消耗层数按比例折算', () => {
    const full = { ...base, basicGashPerSec: 20, basicAttackTime: 30 }
    const r = computeClaretSharpResource({ ...full, cinemaLevel: 0, gashCoverage: 0.5 })
    // (600+234.96)×1.5=1252.44 → 2 层 × 0.5 = 1 层消耗
    expect(r.gashStackConsumed).toBe(1)
    expect(r.maimCount).toBe(1)
  })
})

describe('克拉蕾全管线冒烟（v12）', () => {
  async function setup() {
    return setupHarness([{ agentId: '1611', cinemaLevel: 0 }, '', ''])
  }

  it('C6 队伍伤害 > C0（命座有效性，含影画1/3/5 生效；C6 直接毁伤入行）', async () => {
    const { config } = await setup()
    const calc = useResourceCalc()
    const d0 = calc.teamTotalDamage.value
    expect(d0).toBeGreaterThan(0)
    config.team[0].cinemaLevel = 6
    const d6 = calc.teamTotalDamage.value
    expect(d6).toBeGreaterThan(d0)
  })

  it('影画1 电抗无视 16% 确实抬高结果（v12 C1 口径）', async () => {
    const { config } = await setup()
    const calc = useResourceCalc()
    const d0 = calc.teamTotalDamage.value
    config.team[0].cinemaLevel = 1
    const d1 = calc.teamTotalDamage.value
    expect(d1).toBeGreaterThan(d0)
  })

  it('平A双基准：常态血锻 345.21%/s 与铭刻锻星 531.88%/s 按铭刻时间占比加权（改滑块结果确实变）', async () => {
    const { config, catalog } = await setup()
    const calc = useResourceCalc()
    const basicOf = () => calc.resourceResult.value!.characters
      .find(c => c.agentId === '1611')!.executions.find(e => e.moveId === 'basic_attack')!
    const srcOf = () => calc.resourceResult.value!.characters
      .find(c => c.agentId === '1611')!.claretSharpResourceSource!

    // 默认口径 = **账本推导**（滑块 0），总额口径（不算每窗摊多少连携）：
    //   铭刻总时间 = N×16s + 总延长秒（连携×2s + 停表白送时长）
    //   常态时间   = 平A总时间 − 铭刻总时间
    //   锐能总量   = 自动累积 1.5/s × **接战时间**（前后台都回，铭刻内也回）+ 血锻增益 3.0/s × 常态时间 ≥ N×60
    expect(config.getMechanicSetting('claret.inscriptionBasicTimeShare', 0)).toBe(0)
    expect(srcOf().inscriptionBasicTimeShareSource).toBe('ledger')
    expect(srcOf().ultimateCount).toBe(2)
    // 锐能收入两条腿：基础自动累积（catalog level60.sharpnessRegen）+ 血锻招式增益 = 4.5/s
    expect(srcOf().sharpnessAutoPerSec).toBeCloseTo(1.5, 5)
    // 自动累积的时长基准 = 接战时间（用户口径 2026-09-11：前后台都回，不是平A时间）
    expect(srcOf().combatTime).toBeGreaterThan(basicOf().totalTime)
    expect(srcOf().normalAttackSharpnessPerSec).toBeCloseTo(3, 5)
    expect(srcOf().normalSharpnessPerSec).toBeCloseTo(4.5, 5)
    // 总延长秒 = 连携×2s + (连携+终结)动作时长——**连携/大招不吃强化，故不消耗强化时间**（停表覆盖率 100%）
    //   可观测判据：链/大的实际动作时长必须被算进铭刻总时间（16s×轮 + 总延长）
    const chainExec = calc.resourceResult.value!.characters.find(c => c.agentId === '1611')!
      .executions.find(e => e.moveId === '1611020')
    const ultExec = calc.resourceResult.value!.characters.find(c => c.agentId === '1611')!
      .executions.find(e => e.moveId === '1611021')
    const chainSeconds = (chainExec?.actionTime ?? 0) * (chainExec?.count ?? 0)
    const ultSeconds = (ultExec?.actionTime ?? 0) * (ultExec?.count ?? 0)
    expect(chainSeconds).toBeGreaterThan(0)
    expect(ultSeconds).toBeGreaterThan(0)
    expect(srcOf().inscriptionWindowSeconds).toBeCloseTo(
      (chainExec?.count ?? 0) * 2 + chainSeconds + ultSeconds, 5,
    )
    expect(srcOf().inscriptionBasicTime).toBeCloseTo(
      srcOf().inscriptionEntries * 16 + srcOf().inscriptionWindowSeconds, 5,
    )
    expect(srcOf().inscriptionEntries).toBeGreaterThanOrEqual(1)
    // 口径自洽：铭刻 + 常态 恒 = 平A时间；share = 铭刻份额
    expect(srcOf().normalBasicTimeNeeded + srcOf().inscriptionBasicTime).toBeCloseTo(basicOf().totalTime, 5)
    expect(srcOf().inscriptionBasicTimeShare).toBeCloseTo(
      srcOf().inscriptionBasicTime / basicOf().totalTime, 5,
    )
    expect(srcOf().derivedInscriptionTimeShare).toBeCloseTo(srcOf().inscriptionBasicTimeShare, 5)
    expect(basicOf().damageMultiplier).toBeCloseTo(srcOf().basicDamagePerSec, 5)
    expect(basicOf().damageMultiplierOverride).toBe(true)
    expect(basicOf().dazeMultiplierOverride).toBe(true)
    // EX 发数 = 轮数
    const charOf = () => calc.resourceResult.value!.characters.find(c => c.agentId === '1611')!
    expect(charOf().executions.find(e => e.moveId === '1611010')?.count).toBe(srcOf().affordableExCount)

    // 滑块 1–100 = 手动覆盖；60% → 345.208×0.4 + 531.882×0.6 = 457.21；残痕 100×0.4+120×0.6 = 112
    config.setMechanicSetting('claret.inscriptionBasicTimeShare', 60)
    expect(srcOf().inscriptionBasicTimeShareSource).toBe('manual')
    expect(srcOf().basicDamagePerSec).toBeCloseTo(457.21, 1)
    expect(srcOf().basicGashPerSec).toBeCloseTo(112, 5)
    expect(basicOf().damageMultiplier).toBeCloseTo(457.21, 1)
    expect(basicOf().anomalyBuildUp).toBeCloseTo(112, 5)
    // 手动 60% ⇒ 常态段时间 = 平A时间 × 40%（= 滑块直接决定，不再看账本）
    expect(srcOf().normalBasicTimeNeeded).toBeCloseTo(basicOf().totalTime * 0.4, 5)
    // 滑块 20%：345.208×0.8 + 531.882×0.2 = 382.54；残痕 100×0.8+120×0.2 = 104
    config.setMechanicSetting('claret.inscriptionBasicTimeShare', 20)
    expect(srcOf().basicDamagePerSec).toBeCloseTo(345.21 * 0.8 + 531.88 * 0.2, 1)
    expect(srcOf().basicGashPerSec).toBeCloseTo(104, 5)
    // 滑块 → 100%：整段按铭刻锻星基准
    config.setMechanicSetting('claret.inscriptionBasicTimeShare', 100)
    expect(srcOf().basicDamagePerSec).toBeCloseTo(531.88, 1)
    expect(srcOf().basicGashPerSec).toBeCloseTo(120, 5)

    // 基准段来自真实倍率表行（不是硬编码）：1611003 血锻#3 / 1611007 锻星#3
    const moves = catalog.getAgentSkills('1611')!.categories.find(c => c.id === 'basic')!.moves
    const dps = (id: string) => {
      const m = moves.find(x => x.id === id)!
      return m.rows.find(r => r.id === 'damage')!.values[0] / (m.actionTime ?? 1)
    }
    expect(dps('1611003')).toBeCloseTo(345.21, 1)
    expect(dps('1611007')).toBeCloseTo(531.88, 1)
    // 残痕走 gachabase `gash_buildup` 独立列（≠ anomaly_buildup）：锻星 170/1.7 = 120
    const gash = (id: string) => {
      const m = moves.find(x => x.id === id)!
      return m.rows.find(r => r.id === 'gash_buildup')!.values[0] / (m.actionTime ?? 1)
    }
    expect(gash('1611007')).toBeCloseTo(120, 5)
    expect(gash('1611003')).toBeCloseTo(100, 2)
  })

  it('影画2 毁伤倍率 ×130%：执行行 override 生效（表值 1625.6% × 1.3 = 2113.28%）', async () => {
    const { config } = await setup()
    config.team[0].cinemaLevel = 2
    const calc = useResourceCalc()
    const row = calc.resourceResult.value!.characters.find(c => c.agentId === '1611')!
      .executions.find(e => e.moveId === '1611013' && (e.damageMultiplierOverride ?? false))
    expect(row).toBeTruthy()
    expect(row!.damageMultiplier).toBeCloseTo(1625.6 * C2_MAIM_MULT, 1)
  })
})
