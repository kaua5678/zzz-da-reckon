import { describe, expect, it } from 'vitest'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { setupHarness } from '@/test/harness'
import { computePanelPhases } from '@/composables/resourceCalc/helpers'
import { computeRemielleMechanic } from '@/mechanics/agents/remielle'

/** 3异常队（蕾米+薇薇安+月城柳），额外能力 tier=3；globalBuffs 关掉防污染（SOP §7） */
async function setup(cinemaLevel = 0) {
  const result = await setupHarness([
    { agentId: '1581', cinemaLevel, parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
    { agentId: '1331', parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
    { agentId: '1221', parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
  ])
  for (const buff of result.config.globalBuffs) buff.enabled = false
  return result
}

describe('蕾米埃尔（1581）虚曜·耀变·异化系数', () => {
  it('异化系数 = 异常精通×0.02%；耀变倍率提升 = 异常精通×0.2%（2026-09-07 账本+原文四源校对，旧 0.1% 为转写错误）', () => {
    const s = computeRemielleMechanic({ anomalyProficiency: 500 })
    expect(s.refringeCoefficient).toBeCloseTo(10, 5)
    expect(s.luminizeMultiplierBonus).toBeCloseTo(100, 5)
    expect(s.voidflareStored).toBe(3)
    expect(s.voidflareMax).toBe(3)

    const zero = computeRemielleMechanic({ anomalyProficiency: 0 })
    expect(zero.refringeCoefficient).toBe(0)
    expect(zero.luminizeMultiplierBonus).toBe(0)
  })

  it('面板：catalog corePassive 公式进面板——耀变倍率提升=精通×0.2、异化基础=精通×0.02', async () => {
    const { config, catalog } = await setup(0)
    const p = computePanelPhases(0, config, catalog)!.inCombat
    const ap = p.anomalyProficiency ?? 0
    expect(ap).toBeGreaterThan(0)
    expect(p.remielleLuminizeMultiplierBonus).toBeCloseTo(ap * 0.2, 5)
    expect(p.remielleRefringeCoefficient).toBeCloseTo(ap * 0.02, 5)
  })

  // @fact agent:1581/异化C2加算单写者 口径: C2 异化+20 唯一写者=catalog cinemaBuffs 自身buff；teammate-buffs 条 remielle_c2_team_refringe_coefficient_bonus_pct 以 effect 级 excludeTargetAgentIds 排除蕾米本人（曾双通道双计：3异常队 C2 面板 BonusPct=50，正确 30=3异常的10+C2的20；同 buff 的 Prismatic 无视15%防御不排除、她本人照吃） | 据 账本校对@2026-09-07 | 验 src/mechanics/__tests__/remielle.test.ts | 锚 src/core/buff.ts#isExcludedForTarget | 信 确认
  it('C2 命座差分：3异常队 BonusPct 精确 10→30（+20 单写者，双计修复回归）；本人吃 Prismatic 无视15%防御；队友侧全队口径 30 不变', async () => {
    const c0 = await setup(0)
    const p0 = computePanelPhases(0, c0.config, c0.catalog)!.inCombat
    // 3异常 +10（teammate-buff 1581.core_passive.refringe_3_anomaly，tier=3 门控）
    expect(p0.remielleRefringeCoefficientBonusPct).toBeCloseTo(10, 5)

    const c2 = await setup(2)
    const p2 = computePanelPhases(0, c2.config, c2.catalog)!.inCombat
    // 正确值 = 3异常10 + C2的20 = 30；修复前 catalog 自身buff 与 teammate-buff 双通道各 +20 → 50
    expect(p2.remielleRefringeCoefficientBonusPct).toBeCloseTo(30, 5)
    expect(p2.remielleRefringeCoefficientBonusPct - p0.remielleRefringeCoefficientBonusPct).toBeCloseTo(20, 5)
    // C2 同一 teammate-buff 的 def-ignore 效果不排除本人（原文：队伍中[异常]角色，含蕾米自己）
    expect(p2.enemyAnomalyDefReduction).toBeCloseTo(15, 5)
    // 队友侧不受排除影响：全队异常伤害公式读到 C2+20 与 3异常+10（2026-08-26 用户口径②）
    const mate = computePanelPhases(1, c2.config, c2.catalog)!.inCombat
    expect(mate.remielleRefringeCoefficientBonusPct).toBeCloseTo(30, 5)
  })

  it('完整计算链：资源池带 remielleMechanicSource，虚耀账本随精通缩放', async () => {
    await setup()
    const calc = useResourceCalc()
    const row = calc.resourceResult.value!.characters.find(ch => ch.agentId === '1581')!
    expect(row.remielleMechanicSource).toBeTruthy()
    expect(row.remielleMechanicSource!.voidflareMax).toBe(3)
    expect(row.remielleMechanicSource!.refringeCoefficient).toBeGreaterThanOrEqual(0)
    // 展示账本与引擎公式同源不变量：耀变倍率提升(×0.2%) = 异化系数(×0.02%) × 10
    expect(row.remielleMechanicSource!.luminizeMultiplierBonus)
      .toBeCloseTo(row.remielleMechanicSource!.refringeCoefficient * 10, 5)
  })
})
