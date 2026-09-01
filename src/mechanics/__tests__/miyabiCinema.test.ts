/**
 * 星见雅(1091) 命座生效测试：对齐 character-constellations.json 的定案口径。
 * - M1 落霜无视防御 / M2 暴击与风花闪反增伤+入场6落霜 / M4 霜灼·破+30% / M6 极意+30%；
 * - 各命座逐级抬高全管线伤害（C0 < C2 < C4 < C6），防「录了没生效」。
 */
import { describe, expect, it } from 'vitest'
import { miyabiMechanic } from '@/mechanics/agents/miyabi'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'

describe('星见雅 transform 面板累积回归（2026-09-01：收敛轮间叠成 600 积蓄效率）', () => {
  it('C6 面板 anomalyBuildUpEfficiency 为单次合理值（远小于累积的 600）', async () => {
    const { config } = await setupHarness([{ agentId: '1091', cinemaLevel: 6 }, '', ''])
    for (const buff of config.globalBuffs) buff.enabled = false
    const calc = useResourceCalc()
    void calc.damagePoolRows.value // 触发 calcOutput → transform 跑完
    // 冰焰（min(上限, 暴击率)×覆盖率）+ 霜灼 20；曾因 transform 裸 `+=` 叠成 600
    const eff = calc.panels.value?.[0]?.anomalyBuildUpEfficiency ?? 0
    expect(eff).toBeLessThan(100)
    expect(eff).toBeGreaterThan(0)
  })
})

describe('星见雅命座生效（全管线）', () => {
  async function damageAt(cinemaLevel: number): Promise<number> {
    const { config } = await setupHarness([{ agentId: '1091', cinemaLevel }, '', ''])
    const calc = useResourceCalc()
    const dmg = calc.teamTotalDamage.value
    // 还原现场，避免影响同文件后续用例的 store 状态
    config.team[0].cinemaLevel = 0
    return dmg
  }

  it('C0 > 0 且各命座逐级有效：C2 > C0、C4 ≥ C2、C6 > C4', async () => {
    const d0 = await damageAt(0)
    expect(d0).toBeGreaterThan(0)
    const d2 = await damageAt(2)
    expect(d2).toBeGreaterThan(d0)
    const d4 = await damageAt(4)
    expect(d4).toBeGreaterThanOrEqual(d2)
    const d6 = await damageAt(6)
    expect(d6).toBeGreaterThan(d4)
  })
})

describe('星见雅滑块生效差分（防守卫冻结，SOP §3.5：改滑块→结果确实变）', () => {
  it('miyabi.iceFlameCoverage → 冰焰积蓄效率差分（applyPanel 静态消费）', () => {
    // coverage 由 applyPanel 从 settings 算（显式非 1 值优先，否则按队伍/命座自动默认）；
    // 消费在 applyMiyabiPanel：iceFlameBonus = min(80, critRate) × coverage + 霜灼 20（无风队）
    const efficiencyFor = (coverage: number, critRate = 20) => {
      const panel: any = { critRate, anomalyBuildUpEfficiency: 0, miyabiHasWindTeammate: 0 }
      miyabiMechanic.applyPanel!({
        slot: 0, agent: null, cinemaLevel: 0, team: [],
        panel, settings: { 'miyabi.iceFlameCoverage': coverage },
      } as never)
      return panel.anomalyBuildUpEfficiency
    }
    const on = efficiencyFor(0.8)
    const off = efficiencyFor(0.2)
    // 0.8 → 20×0.8=16 +20（霜灼）；0.2 → 20×0.2=4 +20
    expect(on).toBeCloseTo(20 * 0.8 + 20, 1)
    expect(off).toBeCloseTo(20 * 0.2 + 20, 1)
    expect(on - off).toBeCloseTo(20 * 0.6, 1)
    // 面板链路原点：setting 经 resolveMechanicSettings → applyPanel 静态算 coverage
    const p2: any = { critRate: 20, anomalyBuildUpEfficiency: 0, miyabiHasWindTeammate: 0 }
    miyabiMechanic.applyPanel!({
      slot: 0, agent: null, cinemaLevel: 0, team: [],
      panel: p2, settings: { 'miyabi.iceFlameCoverage': 0.8 },
    } as never)
    expect(p2.miyabiIceFlameCoverage).toBeCloseTo(0.8, 5)
  })

  it('miyabi.frostburnBreakCount / frostburnBreakRate → 霜灼·破次数差分（buildExecutions）', async () => {
    const { config } = await setupHarness([{ agentId: '1091', cinemaLevel: 0 }, '', ''])
    const frostbreakCountOf = () => {
      const calc = useResourceCalc()
      const row = calc.resourceResult.value!.characters[0].executions.find(e => e.moveId === 'miyabi_frostburn_break')
      return row?.count ?? 0
    }
    // 次数滑块显式覆盖：12 次
    config.setMechanicSetting('miyabi.frostburnBreakCount', 12)
    expect(frostbreakCountOf()).toBe(12)
    config.setMechanicSetting('miyabi.frostburnBreakCount', 6)
    expect(frostbreakCountOf()).toBe(6)
    // 比率滑块：次数=0（自动）时按强特数×比率
    config.setMechanicSetting('miyabi.frostburnBreakCount', 0)
    config.setMechanicSetting('miyabi.frostburnBreakRate', 2)
    const doubled = frostbreakCountOf()
    config.setMechanicSetting('miyabi.frostburnBreakRate', 1)
    const base = frostbreakCountOf()
    expect(doubled).toBe(base * 2)
    expect(base).toBeGreaterThan(0)
  })
})
