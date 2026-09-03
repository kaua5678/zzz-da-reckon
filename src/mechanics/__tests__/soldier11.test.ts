import { beforeEach, describe, expect, it } from 'vitest'
import { mockStaticFetch, newPinia } from '@/test/harness'
import { useCatalogStore } from '@/stores/catalog'
import { useConfigStore } from '@/stores/config'
import { soldier11Mechanic, patchSoldier11Executions } from '@/mechanics/agents/soldier11'
import { setupHarness } from '@/test/harness'
import { computePanelPhases } from '@/composables/resourceCalc/helpers'

const baseConfig = {
  wEngineId: '', wEngineModLevel: 5,
  driveDisc: { fourPieceSetId: '', twoPieceSetId: '', mainStats: { 4: 'atkPct' as any, 5: 'fireDmg' as any, 6: 'critRate' as any }, subStatAllocation: {} },
  parryCount: 10, dodgeCounterCount: 6, blockCount: 20,
  quickAssistCount: 0, chainCountPerStun: 0, basicAttackTimeWeight: 1,
}

function exec(moveId: string, category: string, count = 1): any {
  return { moveId, category, count }
}

function patchInput(cinema: number, executions: any[], state: any = {}, settings: Record<string, number> = {}) {
  const cfg: any = { battleTime: 180, soldier11CinemaLevel: cinema }
  for (const [k, v] of Object.entries(settings)) cfg[`setting:${k}`] = v
  return {
    cfg,
    state: { exSpecialCount: 0, chainCountTotal: 0, ultimateCount: 0, ...state } as any,
    executions,
  }
}

describe('「11号」（1041）patchExecutions：火力镇压增伤 / 影画2 / 影画6', () => {
  it('核心被动：火力镇压行 +70% dmgBonus，非火力镇压行不受影响', () => {
    const rows = [exec('1041002', 'basic'), exec('1041010', 'basic')]
    patchSoldier11Executions(patchInput(0, rows) as any)
    expect(rows[0].dmgBonus).toBe(70)
    expect(rows[1].dmgBonus ?? 0).toBe(0)
  })

  it('覆盖率滑块 50%：火力镇压增伤折算为 +35%', () => {
    const rows = [exec('1041004', 'basic')]
    patchSoldier11Executions(patchInput(0, rows, {}, { 'soldier11.fireSuppressCoverage': 0.5 }) as any)
    expect(rows[0].dmgBonus).toBe(35)
  })

  it('影画2 高温汇聚：2命时 basic/dodge 类行 +36%，0命不生效', () => {
    const rows0 = [exec('1041010', 'basic'), exec('1041050', 'dodge')]
    patchSoldier11Executions(patchInput(0, rows0) as any)
    expect(rows0[0].dmgBonus ?? 0).toBe(0)

    const rows2 = [exec('1041010', 'basic'), exec('1041050', 'dodge'), exec('1041030', 'special')]
    patchSoldier11Executions(patchInput(2, rows2) as any)
    expect(rows2[0].dmgBonus).toBe(36)
    expect(rows2[1].dmgBonus).toBe(36)
    expect(rows2[2].dmgBonus ?? 0).toBe(0)
  })

  it('影画6 炽热心流：充能可用比例折算 resIgnore（8层充能 vs 16次火力镇压 = 50% → 12.5%）', () => {
    const rows = [exec('1041002', 'basic', 16)]
    patchSoldier11Executions(patchInput(6, rows, { exSpecialCount: 1 }) as any)
    expect(rows[0].resIgnore).toBe(12.5)
  })

  it('影画6 充能充足：比例封顶 100% → 无视 25% 火抗', () => {
    const rows = [exec('1041002', 'basic', 4)]
    patchSoldier11Executions(patchInput(6, rows, { exSpecialCount: 1, ultimateCount: 1 }) as any)
    expect(rows[0].resIgnore).toBe(25)
  })

  it('防死数据：0命时影画6 resIgnore 恒为 0', () => {
    const rows = [exec('1041002', 'basic', 4)]
    patchSoldier11Executions(patchInput(0, rows, { exSpecialCount: 2 }) as any)
    expect(rows[0].resIgnore ?? 0).toBe(0)
  })
})

describe('「11号」快速火刀动作块与层数结算', () => {
  const fireKnifeInput = (state: Record<string, number>, cinema = 0) => ({
    cfg: { battleTime: 180, soldier11CinemaLevel: cinema },
    state: { exSpecialCount: 0, chainCountTotal: 0, ultimateCount: 0, basicAttackTime: 100, ...state } as any,
    executions: [] as any[],
  })

  it('层数结算：5 个窗口招（2强特+2连携+1终结）→ 层数预算封顶 2 套；爆炸行 = 2×6 层', () => {
    const input = fireKnifeInput({ exSpecialCount: 2, chainCountTotal: 2, ultimateCount: 1 })
    soldier11Mechanic.buildExecutions!(input as any)
    const rows = input.executions
    expect(rows.filter(r => r.moveId === '1041008')).toHaveLength(1)
    expect(rows.find(r => r.moveId === '1041008')!.count).toBe(2)
    expect(rows.find(r => r.moveId === '1041025')!.count).toBe(2)
    const boom = rows.find(r => r.moveId === '1041026')!
    expect(boom.count).toBe(2 * 6)
    expect(boom.actionTime).toBe(0)
    expect(boom.totalTime).toBe(0)
  })

  it('层数预算：0 发强特 → 无快速火刀行；2 发强特（无连携终结）→ 2 套', () => {
    const input = fireKnifeInput({ exSpecialCount: 0, chainCountTotal: 2, ultimateCount: 1 })
    soldier11Mechanic.buildExecutions!(input as any)
    expect(input.executions).toHaveLength(0)

    const input2 = fireKnifeInput({ exSpecialCount: 2, chainCountTotal: 0, ultimateCount: 0 })
    soldier11Mechanic.buildExecutions!(input2 as any)
    expect(input2.executions.find(r => r.moveId === '1041008')!.count).toBe(2)
    expect(input2.executions.find(r => r.moveId === '1041026')!.count).toBe(2 * 6)
  })

  it('爆炸行（1041026）在火力镇压集合内：核心被动 +70% 咬合', () => {
    const rows: any[] = [{ moveId: '1041026', category: 'basic', count: 6 }]
    patchSoldier11Executions(patchInput(0, rows) as any)
    expect(rows[0].dmgBonus).toBe(70)
  })

  it('combos 注册快速火刀动作块（轴编辑器可用）：A4+A5+爆炸×6，能耗 = 强特 80', () => {
    const combo = soldier11Mechanic.combos!['soldier11-fire-knife']
    expect(combo.energyCost).toBe(80)
    expect(combo.moves).toEqual([
      { moveId: '1041008', count: 1 },
      { moveId: '1041025', count: 1 },
      { moveId: '1041026', count: 6 },
    ])
  })
})

describe('「11号」applyPanel / buildCharConfig', () => {
  it('潜能·绝焰（最高档）：额外能力触发时暴伤 +48%，未触发为 0', () => {
    const panelOn: any = { additionalAbilityActive: 1 }
    soldier11Mechanic.applyPanel!({ panel: panelOn } as any)
    expect(panelOn.critDmg).toBe(48)

    const panelOff: any = {}
    soldier11Mechanic.applyPanel!({ panel: panelOff } as any)
    expect(panelOff.critDmg ?? 0).toBe(0)
  })

  it('影画1 快速升温：1命注入整局回能 floor(180/50)×40 = 120，0命不注入', () => {
    const cfg1: any = { battleTime: 180 }
    soldier11Mechanic.buildCharConfig!({ cfg: cfg1, cinemaLevel: 1 } as any)
    expect(cfg1.initialEnergyGift).toBe(120)

    const cfg0: any = { battleTime: 180 }
    soldier11Mechanic.buildCharConfig!({ cfg: cfg0, cinemaLevel: 0 } as any)
    expect(cfg0.initialEnergyGift ?? 0).toBe(0)
  })
})

describe('「11号」额外能力·燎原全管线：同属性队友门控', () => {
  beforeEach(() => {
    newPinia()
    mockStaticFetch()
  })

  it('本（1121，火属性）在队：燎原触发，火伤 +10% + 失衡增伤 22.5%，暴伤 +48', async () => {
    const catalog = useCatalogStore()
    await catalog.load()
    await catalog.loadTeammateBuffs()
    const config = useConfigStore()
    config.team[0] = { slot: 0, agentId: '1041', cinemaLevel: 0, ...baseConfig } as any
    config.team[1] = { slot: 1, agentId: '1121', cinemaLevel: 0, ...baseConfig } as any
    config.team[2] = { slot: 2, agentId: '', cinemaLevel: 0, ...baseConfig } as any
    config.syncTeammateBuffsFromTeam()
    const { computePanelPhases } = await import('@/composables/resourceCalc/helpers')
    const withMate = computePanelPhases(0, config, catalog)!.inCombat as any
    expect(withMate.additionalAbilityActive).toBe(1)
    // 换掉同属性队友后的基线差分：火伤 32.5（10 + 22.5×默认满覆盖），暴伤 48（潜能最高档）
    config.team[1] = { slot: 1, agentId: '1011', cinemaLevel: 0, ...baseConfig } as any
    config.syncTeammateBuffsFromTeam()
    const withoutMate = computePanelPhases(0, config, catalog)!.inCombat as any
    expect(withMate.fireDmg - (withoutMate.fireDmg ?? 0)).toBe(32.5)
    expect(withMate.critDmg - withoutMate.critDmg).toBe(48)
  })

  it('防死数据：无同属性/同阵营队友时燎原不触发（fireDmg 只含驱动盘主属性）', async () => {
    const catalog = useCatalogStore()
    await catalog.load()
    await catalog.loadTeammateBuffs()
    const config = useConfigStore()
    config.team[0] = { slot: 0, agentId: '1041', cinemaLevel: 0, ...baseConfig } as any
    config.team[1] = { slot: 1, agentId: '1011', cinemaLevel: 0, ...baseConfig } as any // 安比：电属性/狡兔屋，均不满足
    config.team[2] = { slot: 2, agentId: '', cinemaLevel: 0, ...baseConfig } as any
    config.syncTeammateBuffsFromTeam()
    const { computePanelPhases } = await import('@/composables/resourceCalc/helpers')
    const p = computePanelPhases(0, config, catalog)!.inCombat as any
    expect(p.additionalAbilityActive ?? 0).toBe(0)
    // 空队友槽位基线：与安比同队时火伤应完全一致（燎原未贡献）
    config.team[1] = { slot: 1, agentId: '', cinemaLevel: 0, ...baseConfig } as any
    config.syncTeammateBuffsFromTeam()
    const baseline = computePanelPhases(0, config, catalog)!.inCombat as any
    expect(p.fireDmg).toBe(baseline.fireDmg)
  })
})

describe('「11号」滑块生效差分（防守卫冻结，SOP §3.5）', () => {
  it('soldier11.c2StackCoverage → 影画2普攻/闪反增伤差分（patchExecutions +36×覆盖率）', () => {
    const mk = (cov: number) => {
      const executions: any[] = [{ moveId: '1041001', category: 'basic', dmgBonus: 0 }]
      patchSoldier11Executions({
        cfg: { soldier11CinemaLevel: 2, 'setting:soldier11.c2StackCoverage': cov },
        state: {},
        executions,
      } as never)
      return executions[0].dmgBonus ?? 0
    }
    expect(mk(1)).toBeCloseTo(36, 5)
    expect(mk(0.5)).toBeCloseTo(18, 5)
    expect(mk(0)).toBe(0)
  })
})

describe('「11号」燎原火滑块生效差分（防守卫冻结，SOP §3.5）', () => {
  it('soldier11.prairieFireStunCoverage → 攻击失衡敌人增伤差分（computePanelPhases 1041 分支）', async () => {
    // 火队友（1171 柏妮思）激活燎原额外能力
    const { catalog, config } = await setupHarness([{ agentId: '1041', cinemaLevel: 0 }, { agentId: '1171' }])
    const read = () => {
      const p = computePanelPhases(0, config, catalog)!.inCombat as any
      return p.fireDmg ?? 0
    }
    config.setMechanicSetting('soldier11.prairieFireStunCoverage', 1)
    const on = read()
    config.setMechanicSetting('soldier11.prairieFireStunCoverage', 0)
    const off = read()
    expect(on - off).toBeCloseTo(22.5, 1)
    expect(on).toBeGreaterThan(off)
  })
})
