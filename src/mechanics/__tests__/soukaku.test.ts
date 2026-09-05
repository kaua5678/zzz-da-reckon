import { beforeEach, describe, expect, it } from 'vitest'
import { mockStaticFetch, newPinia } from '@/test/harness'
import { useCatalogStore } from '@/stores/catalog'
import { useConfigStore } from '@/stores/config'
import { computePanelPhases } from '@/composables/resourceCalc/helpers'
import { calcSoukakuUltEnergy } from '@/core/resource/helpers'
import {
  applySoukakuTeamEnergyFlags,
  assignSoukakuUltNeighborEnergy,
  SOUKAKU_C6_DMG_BONUS,
  SOUKAKU_CHOP_SLAM_ACTION_TIME,
  SOUKAKU_FAN_ACTION_TIME,
  SOUKAKU_FROST_BASIC3_ACTION_TIME,
  SOUKAKU_FROST_DASH_ACTION_TIME,
  SOUKAKU_SLAM_ACTION_TIME,
  SOUKAKU_SWING_ENERGY,
  SOUKAKU_WIND_BALL_ACTION_TIME,
  soukakuMechanic,
} from '@/mechanics/agents/soukaku'

const baseConfig = {
  wEngineId: '', wEngineModLevel: 1,
  driveDisc: { fourPieceSetId: '', twoPieceSetId: '', mainStats: {}, subStatAllocation: {} },
  parryCount: 0, dodgeCounterCount: 0, defAssistCount: 0,
  quickAssistCount: 0, chainCountPerStun: 1, basicAttackTimeWeight: 1,
}

async function setup(cinemaLevel = 0, mateId = '1091') {
  const catalog = useCatalogStore()
  await catalog.load()
  await catalog.loadTeammateBuffs()
  const config = useConfigStore()
  for (const buff of config.globalBuffs) buff.enabled = false
  // 1091 雅 冰异常 第六课 → 同属性同阵营
  config.team[0] = { slot: 0, agentId: mateId, cinemaLevel: 0, ...baseConfig } as any
  config.team[1] = { slot: 1, agentId: '1131', cinemaLevel, ...baseConfig } as any
  config.team[2] = { slot: 2, agentId: '', cinemaLevel: 0, ...baseConfig } as any
  config.syncTeammateBuffsFromTeam()
  return { catalog, config }
}

describe('苍角纯函数', () => {
  it('终结邻位回能 30/10', () => {
    expect(assignSoukakuUltNeighborEnergy([0, 1, 2], 1)).toEqual({ 0: 10, 2: 30 })
    expect(assignSoukakuUltNeighborEnergy([0, 1], 1)).toEqual({ 0: 30 })
  })

  it('applyTeamEnergyFlags 写入邻位', () => {
    const configs: any[] = [
      { slot: 0, agentId: '1091' },
      { slot: 1, agentId: '1131' },
      { slot: 2, agentId: '1011' },
    ]
    applySoukakuTeamEnergyFlags(configs)
    expect(configs[0].soukakuEnergyPerSoukakuUlt).toBe(10)
    expect(configs[2].soukakuEnergyPerSoukakuUlt).toBe(30)
    expect(configs[1].soukakuEnergyPerSoukakuUlt).toBe(0)
  })

  it('calcSoukakuUltEnergy 按终结次数结算', () => {
    const configs: any[] = [
      { slot: 0, agentId: '1091', soukakuEnergyPerSoukakuUlt: 30 },
      { slot: 1, agentId: '1131', soukakuEnergyPerSoukakuUlt: 0 },
    ]
    const states: any[] = [{ ultimateCount: 2 }, { ultimateCount: 2 }]
    expect(calcSoukakuUltEnergy(configs, states, configs[0])).toBe(60)
  })

  it('影画6 霜染段 dmgBonus+45', () => {
    const cfg: any = { soukakuCinemaLevel: 6 }
    const executions: any[] = [
      { moveId: '1131004', dmgBonus: 0, skillTableNote: '' },
      { moveId: '1131001', dmgBonus: 0, skillTableNote: '' },
    ]
    soukakuMechanic.patchExecutions!({ cfg, state: {} as any, executions } as any)
    expect(executions[0].dmgBonus).toBe(SOUKAKU_C6_DMG_BONUS)
    expect(executions[1].dmgBonus).toBe(0)
  })

  it('影画2 满层回能：1.2×触发次数注入 initialEnergyGift（默认5）；低命不注入', () => {
    const cfg: any = { initialEnergyGift: 40, 'setting:soukaku.c2RefundCount': 5 }
    soukakuMechanic.buildCharConfig!({ cinemaLevel: 2, cfg } as any)
    expect(cfg.initialEnergyGift).toBeCloseTo(40 + 1.2 * 5)

    const cfg0: any = { initialEnergyGift: 40, 'setting:soukaku.c2RefundCount': 5 }
    soukakuMechanic.buildCharConfig!({ cinemaLevel: 1, cfg: cfg0 } as any)
    expect(cfg0.initialEnergyGift).toBeCloseTo(40)
  })

  it('强特能量成本 = 30能量×击数：默认2击=60；1击=30（自我能量循环供给侧）', () => {
    const cfg2: any = {}
    soukakuMechanic.buildCharConfig!({ cinemaLevel: 0, cfg: cfg2 } as any)
    expect(cfg2.exSpecialEnergyConsume).toBe(SOUKAKU_SWING_ENERGY * 2)

    const cfg1: any = { 'setting:soukaku.exPressCount': 1 }
    soukakuMechanic.buildCharConfig!({ cinemaLevel: 0, cfg: cfg1 } as any)
    expect(cfg1.exSpecialEnergyConsume).toBe(SOUKAKU_SWING_ENERGY)
  })
})

describe('强特自循环：扇风（扇子+风团体型段数）+ 下砸 + 霜染冲刺/合轴#3', () => {
  const run = ({ exCount = 3, swings, chop, bodySize }: { exCount?: number; swings?: number; chop?: number; bodySize?: string }) => {
    const cfg: any = {}
    if (swings !== undefined) cfg['setting:soukaku.exPressCount'] = swings
    if (chop !== undefined) cfg['setting:soukaku.chopSlam'] = chop
    if (bodySize !== undefined) cfg.bodySize = bodySize
    const executions: any[] = []
    soukakuMechanic.buildExecutions!({ cfg, state: { exSpecialCount: exCount }, executions } as any)
    return executions
  }
  const rowOf = (executions: any[], moveId: string) => executions.filter(r => r.moveId === moveId)

  it('默认口径（2击/劈斩关/大体型）：第2击扇子 + 风团12段 + 下砸(集合啦#1) + 霜染冲刺 + 全合轴#3 各×强特次数', () => {
    const rows = run({ exCount: 3, bodySize: 'large' })
    const fan2 = rowOf(rows, '1131011')
    expect(fan2).toHaveLength(1) // 首击扇子由通用强特行发行，模块只补第2击
    expect(fan2[0].count).toBe(3)
    expect(fan2[0].actionTime).toBe(SOUKAKU_FAN_ACTION_TIME)
    const balls = rowOf(rows, '1131010')
    expect(balls[0].count).toBe(3 * 2 * 6)
    expect(balls[0].totalTime).toBeCloseTo(3 * 2 * SOUKAKU_WIND_BALL_ACTION_TIME) // 体型段数不额外耗时
    const slam = rowOf(rows, '1131012')
    expect(slam).toHaveLength(1)
    expect(slam[0].count).toBe(3)
    expect(slam[0].actionTime).toBe(SOUKAKU_SLAM_ACTION_TIME)
    const dash = rowOf(rows, '1131016')
    expect(dash[0].count).toBe(3)
    expect(dash[0].actionTime).toBe(SOUKAKU_FROST_DASH_ACTION_TIME)
    const basic3 = rowOf(rows, '1131006')
    expect(basic3[0].count).toBe(3)
    expect(basic3[0].actionTime).toBe(SOUKAKU_FROST_BASIC3_ACTION_TIME)
    expect(basic3[0].comboAlignRatio).toBe(1) // 全合轴
    expect(basic3[0].totalComboAlignTime).toBeCloseTo(3 * SOUKAKU_FROST_BASIC3_ACTION_TIME)
  })

  it('劈斩开：下砸换成快速展旗·集合啦#2（更快），不再发行集合啦#1', () => {
    const rows = run({ exCount: 3, chop: 1, bodySize: 'large' })
    expect(rowOf(rows, '1131012')).toHaveLength(0)
    const chopSlam = rowOf(rows, '1131013')
    expect(chopSlam).toHaveLength(1)
    expect(chopSlam[0].actionTime).toBe(SOUKAKU_CHOP_SLAM_ACTION_TIME)
    expect(chopSlam[0].actionTime).toBeLessThan(SOUKAKU_SLAM_ACTION_TIME)
  })

  it('风团按敌方体型：小0（风团行不发，其余轮次招式照发）/中3/大6（同艾莲剑气）', () => {
    const small = run({ bodySize: 'small' })
    expect(rowOf(small, '1131010')).toHaveLength(0)
    expect(rowOf(small, '1131012')).toHaveLength(1)
    expect(rowOf(small, '1131016')).toHaveLength(1)
    expect(rowOf(small, '1131006')).toHaveLength(1)
    expect(rowOf(run({ bodySize: 'medium' }), '1131010')[0].count).toBe(3 * 2 * 3)
    expect(rowOf(run({ bodySize: 'large' }), '1131010')[0].count).toBe(3 * 2 * 6)
  })

  it('击数滑块：1击=不发第2击扇子、风团减半；能量账本恒 0（耗能走主强特 30×击数）', () => {
    const rows = run({ swings: 1, bodySize: 'large' })
    expect(rowOf(rows, '1131011')).toHaveLength(0)
    expect(rowOf(rows, '1131010')[0].count).toBe(3 * 1 * 6)
    for (const row of [...rowOf(rows, '1131011'), ...rowOf(rows, '1131010')]) {
      expect(row.totalEnergyConsume).toBe(0)
      expect(row.totalDecibelRecovery).toBe(0)
    }
  })

  it('下砸/霜染冲刺/合轴#3 的回能喧响走倍率表回填（非 0 占位，0=显式禁用引擎口径）', () => {
    const rows = run({ bodySize: 'large' })
    const slam = rowOf(rows, '1131012')[0]
    expect(slam.decibelRecovery).toBe(1) // → enrich 回填集合啦#1 表值 68.7775
    expect(slam.energyRecovery).toBe(0) // 集合啦#1 表值本身为 0
    for (const row of [rowOf(rows, '1131016')[0], rowOf(rows, '1131006')[0]]) {
      expect(row.decibelRecovery).toBe(1) // → 回填表值喧响
      expect(row.energyRecovery).toBe(1) // → 回填表值回能（自我能量循环供给侧）
    }
  })

  it('强特次数为0时不发任何自循环行', () => {
    expect(run({ exCount: 0, bodySize: 'large' })).toHaveLength(0)
  })
})

describe('苍角面板', () => {
  beforeEach(() => { newPinia(); mockStaticFetch() })

  it('核心攻拐与同属性冰伤20；影画4冰抗-10', async () => {
    const { catalog, config } = await setup(0, '1091')
    const mateOut = computePanelPhases(0, config, catalog)!.outOfCombat
    const mate = computePanelPhases(0, config, catalog)!.inCombat
    const skOut = computePanelPhases(1, config, catalog)!.outOfCombat
    const expectedAtk = Math.min(1000, skOut.atk * 0.4)
    expect(mate.atk).toBeGreaterThan(mateOut.atk + expectedAtk * 0.5)
    expect(mate.iceDmg - (mateOut.iceDmg ?? 0)).toBeCloseTo(20)

    config.team[1].cinemaLevel = 4
    config.syncTeammateBuffsFromTeam()
    const c4 = computePanelPhases(0, config, catalog)!.inCombat
    expect(c4.enemyIceResReduction - mate.enemyIceResReduction).toBeCloseTo(10)
  })

  it('无同属性/同阵营时额外冰伤不生效', async () => {
    // 11号 1041 火强攻 卡吕冬
    const { catalog, config } = await setup(0, '1041')
    const mateOut = computePanelPhases(0, config, catalog)!.outOfCombat
    const mate = computePanelPhases(0, config, catalog)!.inCombat
    expect(mate.atk).toBeGreaterThan(mateOut.atk) // 核心攻仍在
    expect(mate.iceDmg - (mateOut.iceDmg ?? 0)).toBe(0)
  })
})
