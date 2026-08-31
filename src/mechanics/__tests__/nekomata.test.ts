/**
 * 猫又（1021）呼噜能量 30/40 档穿刺口径生效测试（用户口供 2026-08-23）：
 * - 尾巴失踪术无伤害，30 档价值 = 免费接一次穿刺（净省 10 点）；伤害载体只有绒爪穿刺(1021019)。
 * - 失衡内只能打 40 档长按，失衡外一律 30 档；非轴按占比滑杆（-1=自动覆盖率），轴模式按捏块精确计。
 * - 回归护栏：旧实现把尾巴失踪术错挂终结技 1021012 按其倍率产出行——任何执行行不得再出现该载体。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { mockStaticFetch, newPinia, setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { computePanelPhases } from '@/composables/resourceCalc/helpers'
import {
  estimateNekomataHitPurrGain,
  NEKOMATA_BASIC_HIT_PURR_PER_SEC,
  NEKOMATA_CATSHOW_BONUS,
  NEKOMATA_CATSHOW_MOVE_IDS,
  planNekomataPierceCasts,
} from '@/mechanics/agents/nekomata'

describe('planNekomataPierceCasts（预算分配纯函数，门控不建模——用户口径）', () => {
  it('占比 0：全部 30 档；占比 1：全部 40 档', () => {
    expect(planNekomataPierceCasts(300, { holdBudgetShare: 0 }))
      .toMatchObject({ holdCount: 0, dodgeCount: 10, totalCount: 10, spent: 300 })
    expect(planNekomataPierceCasts(300, { holdBudgetShare: 1 }))
      .toMatchObject({ holdCount: 7, dodgeCount: 0, totalCount: 7, spent: 280 })
  })

  it('混合占比：先保 40 档预算，剩余全按 30 档', () => {
    // 预算 400、占比 0.5 → 40档预算 200 → 5 次；剩 200 → 6 次 30 档 + 余 20
    expect(planNekomataPierceCasts(400, { holdBudgetShare: 0.5 }))
      .toMatchObject({ holdCount: 5, dodgeCount: 6, totalCount: 11, spent: 380 })
  })

  it('轴模式：捏块数精确决定 40 档，其余预算转 30 档', () => {
    // 轴内捏 3 块 → 3×40=120；预算 300 剩 180 → 6 次 30 档
    expect(planNekomataPierceCasts(300, { axisHoldPicks: 3 }))
      .toMatchObject({ holdCount: 3, dodgeCount: 6, totalCount: 9 })
    // 捏块超出预算承载：封顶到 floor(预算/40)
    expect(planNekomataPierceCasts(100, { axisHoldPicks: 9 }).holdCount).toBe(2)
  })

  it('低预算按总量除：39 点也能打 1 发 30 档（门控不建模）', () => {
    expect(planNekomataPierceCasts(39)).toMatchObject({ dodgeCount: 1, spent: 30 })
    expect(planNekomataPierceCasts(29)).toMatchObject({ totalCount: 0 })
    expect(planNekomataPierceCasts(69)).toMatchObject({ dodgeCount: 2, spent: 60 })
  })
})

describe('攻击数据命中回呼噜（catalog attack_data_0）', () => {
  it('平A聚合行走秒均 × 秒数；招式行按次数 × 单次回复', () => {
    // 秒均 = Σ(gain×at)/Σat ≈ 1.0695/s（六段加权）
    expect(NEKOMATA_BASIC_HIT_PURR_PER_SEC).toBeCloseTo(1.0695, 3)
    const gain = estimateNekomataHitPurrGain([
      { moveId: 'basic_attack', count: 0, totalTime: 60 },
      { moveId: '1021010', count: 10 },
      { moveId: '1021017', count: 6 },
      { moveId: '1021019', count: 8 }, // 穿刺 attack_data=0，不贡献
    ] as never)
    expect(gain).toBeCloseTo(NEKOMATA_BASIC_HIT_PURR_PER_SEC * 60 + 1.5745 * 10 + 2.187 * 6, 3)
  })
})

describe('猫又全管线集成（harness）', () => {
  beforeEach(() => {
    newPinia()
    mockStaticFetch()
  })

  async function setupNeko() {
    const { config } = await setupHarness([{ agentId: '1021' }, '', ''])
    return config
  }

  function pierceRows(calc: ReturnType<typeof useResourceCalc>) {
    const neko = calc.resourceResult.value!.characters.find(c => c.agentId === '1021')!
    return {
      exec: neko.executions.filter(e => e.moveId === '1021019'),
      rows: calc.damagePoolRows.value.filter(r => r.moveId === '1021019'),
    }
  }

  it('非轴模式：滑杆 -1 自动 / 手动覆盖改变穿刺次数与总伤；无任何 1021012 载体行（旧错挂回归护栏）', async () => {
    const config = await setupNeko()
    const calc = useResourceCalc()
    // 默认 -1 = 自动覆盖率：单猫又队失衡覆盖率趋近 0 → 几乎全部 30 档
    const autoRows = pierceRows(calc)
    expect(autoRows.exec.length).toBeGreaterThan(0)
    expect(autoRows.exec[0]!.count).toBeGreaterThan(0)

    // 占比拉满 1 → 全部走 40 档 → 同预算下次数变少（40 > 30/发）
    config.setMechanicSetting('nekomata.stunCastShare', 1)
    await new Promise(r => setTimeout(r, 50))
    const holdRows = pierceRows(calc)
    expect(holdRows.exec[0]!.count).toBeLessThan(autoRows.exec[0]!.count)

    // 回归护栏：旧实现把尾巴失踪术事件挂在 1021012（终结技）上按其倍率额外产出行；
    // 现在 1021012 只允许出现「通用终结技」一行且次数 = 终结技次数。
    const nekoAll = calc.resourceResult.value!.characters.find(c => c.agentId === '1021')!
    const ultRows = nekoAll.executions.filter(e => e.moveId === '1021012')
    expect(ultRows.length).toBe(1)
    expect(ultRows[0]!.count).toBe(nekoAll.ultimateCount)
  })

  it('穿刺行动作时间按倍率表计入前台（1.5666s/次），伤害倍率取 1021019 的 damage 行', async () => {
    await setupNeko()
    const calc = useResourceCalc()
    const neko = calc.resourceResult.value!.characters.find(c => c.agentId === '1021')!
    const pierce = neko.executions.find(e => e.moveId === '1021019')!
    expect(pierce.actionTime).toBeCloseTo(1.5666, 4)
    expect(pierce.totalTime).toBeCloseTo(pierce.actionTime * pierce.count, 4)
    expect(pierce.damageMultiplier).toBeCloseTo(2527.8, 1)
  })
})


describe('永续面板项与猫步秀（2026-08-23 第二批口供）', () => {
  async function panelFor(cinemaLevel: number) {
    const { config, catalog } = await setupHarness([{ agentId: '1021', cinemaLevel }, '', ''])
    return computePanelPhases(0, config, catalog)!.inCombat
  }

  it('猫步诡影 60% 全档永续；C1 无视物抗16 / C2 能量效率25+夜行暴伤20 / C4 暴击率14 / C6 暴伤再54+夜行60', async () => {
    const p0 = await panelFor(0)
    expect(p0.dmgBonus).toBeGreaterThanOrEqual(60)

    const p1 = await panelFor(1)
    expect((p1.enemyPhysicalResReduction ?? 0) - (p0.enemyPhysicalResReduction ?? 0)).toBeCloseTo(16)

    const p2 = await panelFor(2)
    expect((p2.energyGainEfficiency ?? 0) - (p0.energyGainEfficiency ?? 0)).toBeCloseTo(25)
    expect((p2.critDmgBonus ?? 0) - (p0.critDmgBonus ?? 0)).toBeCloseTo(20)

    const p4 = await panelFor(4)
    expect((p4.critRateBonus ?? 0) - (p2.critRateBonus ?? 0)).toBeCloseTo(14)
    expect((p4.critDmgBonus ?? 0) - (p2.critDmgBonus ?? 0)).toBeCloseTo(20) // 夜行 40 vs 20

    const p6 = await panelFor(6)
    expect((p6.critDmgBonus ?? 0) - (p4.critDmgBonus ?? 0)).toBeCloseTo(74) // 夜行 60−40=20 + C6 满层 54
  })

  it('猫步秀 +70%（AA 门控）：支援队友在队时限定了招式行增伤，不在队则无', async () => {
    async function catshowRowOnPierce(teammate: string) {
      const { config, catalog } = await setupHarness([{ agentId: '1021' }, { agentId: teammate }, ''])
      computePanelPhases(0, config, catalog)
      const calc = useResourceCalc()
      const neko = calc.resourceResult.value!.characters.find(c => c.agentId === '1021')!
      return neko.executions.find(e => e.moveId === '1021019')!
    }
    const off = await catshowRowOnPierce('1251') // 青衣：击破，非支援且不同属性/阵营 → AA 关
    const on = await catshowRowOnPierce('1151') // 露西：支援 → AA 触发
    expect(on.dmgBonus! - (off.dmgBonus ?? 0)).toBeCloseTo(NEKOMATA_CATSHOW_BONUS)
    expect(NEKOMATA_CATSHOW_MOVE_IDS).toContain('1021008')
  })

  it('[超凶爪印]：每秒一行 30% 攻物理（后台不占前台），伤害池按物理元素结算', async () => {
    await setupHarness([{ agentId: '1021' }, '', ''])
    const calc = useResourceCalc()
    const neko = calc.resourceResult.value!.characters.find(c => c.agentId === '1021')!
    const claw = neko.executions.find(e => e.moveId === 'nekomata_chaoxiong_claw')!
    expect(claw.count).toBeGreaterThan(150) // ≈ 每秒一发 × 战斗时长
    expect(claw.damageMultiplier).toBe(30)
    expect(claw.actionTime).toBe(0)
    expect(claw.totalTime).toBe(0)
    const row = calc.damagePoolRows.value.find(r => r.moveId === 'nekomata_chaoxiong_claw')
    expect(row).toBeTruthy()
    expect(row!.element).toBe('physical')
  })

  it('轴模式：CD 自动行（autoSplitByStun）自动按失衡时间占比拆失衡内满易伤/轴外', async () => {
    const { config } = await setupHarness([{ agentId: '1021' }, { agentId: '1251' }, ''])
    config.useStunAxis = true
    config.stunAxes = [
      { name: '轴1', actions: [{ slot: 1, moveId: '1251007', count: 1 }] },
    ] as never
    config.enemy.stunCountLock = 3
    await new Promise(r => setTimeout(r, 60))
    const calc = useResourceCalc()
    const clawRows = calc.damagePoolRows.value.filter(r => r.moveId === 'nekomata_chaoxiong_claw')
    expect(clawRows.length).toBeGreaterThanOrEqual(2) // 失衡内 + 轴外两段
    const inStun = clawRows.find(r => (r.stunMult ?? 1) > 1)
    const outStun = clawRows.find(r => (r.stunMult ?? 1) <= 1)
    expect(inStun).toBeTruthy()
    expect(outStun).toBeTruthy()
    expect(inStun!.count).toBeGreaterThan(0)
    expect(outStun!.count).toBeGreaterThan(0)
    // 占比内份额 ≈ 失衡时间占比 × 总秒数（3窗 × ~16s / 180 ≈ 26%）
    expect(inStun!.count).toBeLessThan(outStun!.count)
  })
})

describe('猫又滑块生效差分（防守卫冻结，SOP §3.5）', () => {
  it('nekomata.c4CritRateCoverage → 影画4暴击率差分（applyNekoPanel settings 通道，+14×覆盖率）', async () => {
    const { config } = await setupHarness([{ agentId: '1021', cinemaLevel: 4 }, '', ''])
    const read = () => {
      const calc = useResourceCalc()
      const p = calc.panels.value[0] as any
      return p?.critRateBonus ?? 0
    }
    config.setMechanicSetting('nekomata.c4CritRateCoverage', 1)
    const on = read()
    config.setMechanicSetting('nekomata.c4CritRateCoverage', 0)
    const off = read()
    expect(on - off).toBeCloseTo(14, 1)
    expect(on).toBeGreaterThan(off)
  })
})
