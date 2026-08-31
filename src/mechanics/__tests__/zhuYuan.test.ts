import { beforeEach, describe, expect, it } from 'vitest'
import { mockStaticFetch, newPinia } from '@/test/harness'
import { useCatalogStore } from '@/stores/catalog'
import { useConfigStore } from '@/stores/config'
import { computePanelPhases } from '@/composables/resourceCalc/helpers'
import { getTargetedStat } from '@/core/buff'
import { zhuYuanMechanic } from '@/mechanics/agents/zhuYuan'

const baseConfig = {
  wEngineId: '', wEngineModLevel: 1,
  driveDisc: { fourPieceSetId: '', twoPieceSetId: '', mainStats: {}, subStatAllocation: {} },
  parryCount: 0, dodgeCounterCount: 0, defAssistCount: 0,
  quickAssistCount: 0, chainCountPerStun: 1, basicAttackTimeWeight: 1,
}

async function setup(mateId = '1031', cinemaLevel = 0) {
  const catalog = useCatalogStore()
  await catalog.load()
  await catalog.loadTeammateBuffs()
  const config = useConfigStore()
  for (const buff of config.globalBuffs) buff.enabled = false
  // slot0 朱鸢，slot1 队友（1031 妮可 = 支援 → 触发额外能力）
  config.team[0] = { slot: 0, agentId: '1241', cinemaLevel, ...baseConfig } as any
  config.team[1] = { slot: 1, agentId: mateId, cinemaLevel: 0, ...baseConfig } as any
  config.team[2] = { slot: 2, agentId: '', cinemaLevel: 0, ...baseConfig } as any
  config.syncTeammateBuffsFromTeam()
  return { catalog, config }
}

describe('朱鸢（1241）额外能力·武装协同门控', () => {
  beforeEach(() => {
    newPinia()
    mockStaticFetch()
  })

  it('[支援]或同阵营（治安局）队友激活 → 暴击率+30%；命破队友不激活', async () => {
    // 正例1：1031 妮可（以太·支援，狡兔屋 ≠ 新艾利都治安局 → 纯专精命中）
    const pos1 = await setup('1031', 0)
    const p1 = computePanelPhases(0, pos1.config, pos1.catalog)!
    expect((p1.inCombat as any).additionalAbilityActive).toBe(1)
    expect((p1.inCombat as any).critRate - (p1.outOfCombat as any).critRate).toBeCloseTo(30, 5)

    // 正例2：1521 希希芙（强攻，新艾利都治安局 → 纯阵营命中）
    const pos2 = await setup('1521', 0)
    expect((computePanelPhases(0, pos2.config, pos2.catalog)!.inCombat as any).additionalAbilityActive).toBe(1)

    // 负例：1441 真斗（命破，怪啖屋 → 不激活）
    const neg = await setup('1441', 0)
    const pNeg = computePanelPhases(0, neg.config, neg.catalog)!
    expect((pNeg.inCombat as any).additionalAbilityActive ?? 0).toBe(0)
    expect((pNeg.inCombat as any).critRate - (pNeg.outOfCombat as any).critRate).toBeCloseTo(0, 5)
  })
})

describe('朱鸢核心被动与影画（自身面板）', () => {
  beforeEach(() => {
    newPinia()
    mockStaticFetch()
  })

  it('核心被动强化霰弹增伤+40% 走 basic/dashAttack 定向', async () => {
    const { catalog, config } = await setup('1031', 0)
    const phases = computePanelPhases(0, config, catalog)!
    const inC = phases.inCombat as any
    const out = phases.outOfCombat as any
    expect(getTargetedStat(inC, 'skillDmgBonus', 'basic') - getTargetedStat(out, 'skillDmgBonus', 'basic')).toBeCloseTo(40, 5)
    expect(getTargetedStat(inC, 'skillDmgBonus', 'dashAttack') - getTargetedStat(out, 'skillDmgBonus', 'dashAttack')).toBeCloseTo(40, 5)
  })

  it('影画差分：2命以太增伤+50%、4命以太抗性无视+25%', async () => {
    const { catalog, config } = await setup('1031', 0)
    const p0 = computePanelPhases(0, config, catalog)!.inCombat as any

    config.team[0].cinemaLevel = 2
    config.syncTeammateBuffsFromTeam()
    const p2 = computePanelPhases(0, config, catalog)!.inCombat as any
    expect(p2.etherDmg - p0.etherDmg).toBeCloseTo(50, 5)

    config.team[0].cinemaLevel = 4
    config.syncTeammateBuffsFromTeam()
    const p4 = computePanelPhases(0, config, catalog)!.inCombat as any
    expect(p4.enemyEtherResReduction - p2.enemyEtherResReduction).toBeCloseTo(25, 5)
  })

  it('模块单元：applyPanel 门控与定向增伤', () => {
    const mk = (active: number, cinema: number) => ({
      slot: 0, agent: { id: '1241' } as any, cinemaLevel: cinema, team: [],
      panel: { critRate: 5, additionalAbilityActive: active } as any,
    })
    const on = mk(1, 4); zhuYuanMechanic.applyPanel!(on as any)
    expect((on.panel as any).critRate).toBeCloseTo(35, 5)
    expect((on.panel as any).skillDmgBonus__basic).toBeCloseTo(40, 5)
    expect((on.panel as any).etherDmg).toBeCloseTo(50, 5)
    expect((on.panel as any).enemyEtherResReduction).toBeCloseTo(25, 5)

    const off = mk(0, 0); zhuYuanMechanic.applyPanel!(off as any)
    expect((off.panel as any).critRate).toBeCloseTo(5, 5)
    expect((off.panel as any).skillDmgBonus__dashAttack).toBeCloseTo(40, 5)
    expect((off.panel as any).etherDmg ?? 0).toBeCloseTo(0, 5)
  })
})

describe('朱鸢强化霰弹资源循环', () => {
  const mkState = () => ({
    basicAttackTime: 20, dodgeCounterCount: 1, exSpecialCount: 2,
    chainCountTotal: 2, ultimateCount: 1, quickAssistCount: 1,
    frontlineTime: 40, backstageTime: 0,
  }) as any

  it('霰弹账目：初始6+突击10+闪反1+强特6+连携6+终结3+快支1+支援突击3；消耗=总量', () => {
    const cfg: any = { zhuyuanCinemaLevel: 0, defAssistCount: 1, dodgeCounterCount: 1, quickAssistCount: 1 }
    const result: any = zhuYuanMechanic.buildResourceResult!({ cfg, state: mkState() } as any)
    const shells = result.specResources.zhuyuan_shells
    expect(shells).toBeTruthy()
    expect(shells.initialValue).toBe(6)
    expect(shells.gains.shells_basic_combo).toBeCloseTo(10, 5)
    expect(shells.gains.shells_dodge_counter).toBeCloseTo(1, 5)
    expect(shells.gains.shells_ex_special).toBeCloseTo(6, 5)
    expect(shells.gains.shells_chain).toBeCloseTo(6, 5)
    expect(shells.gains.shells_ultimate).toBeCloseTo(3, 5)
    expect(shells.gains.shells_quick_assist).toBeCloseTo(1, 5)
    expect(shells.gains.shells_def_assist).toBeCloseTo(3, 5)
    expect(shells.gains.shells_c1_reload_chain ?? 0).toBeCloseTo(0, 5)
    // 压制模式消耗次数 = 初始6 + 总获取30 = 36
    expect(shells.spendCounts.shells_suppression_spend).toBe(36)
  })

  it('影画1 快速装填（用户口径：连携6枚/终结9枚）', () => {
    const cfg: any = { zhuyuanCinemaLevel: 1, defAssistCount: 1, dodgeCounterCount: 1, quickAssistCount: 1 }
    const result: any = zhuYuanMechanic.buildResourceResult!({ cfg, state: mkState() } as any)
    const shells = result.specResources.zhuyuan_shells
    expect(shells.gains.shells_c1_reload_chain).toBeCloseTo(12, 5)  // 连携2次×6
    expect(shells.gains.shells_c1_reload_ultimate).toBeCloseTo(9, 5) // 终结1次×9
    expect(shells.spendCounts.shells_suppression_spend).toBe(36 + 21)
  })

  it('压制模式以太强化霰弹：1枚=1段，三段轮转，时间有界', () => {
    const cfg: any = { zhuyuanCinemaLevel: 0, defAssistCount: 1, dodgeCounterCount: 1, quickAssistCount: 1 }
    const executions: any[] = []
    zhuYuanMechanic.buildExecutions!({ cfg, state: mkState(), executions } as any)
    // mkState basicAttackTime=20 → 时间有界 maxByTime = floor(20/0.903)=22；霰弹总量36 → 打22枚
    const etherRows = executions.filter(r => ['1241010', '1241011', '1241012'].includes(r.moveId))
    expect(etherRows.length).toBe(3)
    expect(etherRows.every(r => r.element === 'ether')).toBe(true)
    expect(etherRows.reduce((s, r) => s + r.count, 0)).toBe(22)
    // 三段轮转：1241010=8、1241011=7、1241012=7
    expect(etherRows.find(r => r.moveId === '1241010')!.count).toBe(8)
    // 时间有界：总时 ≈ 22 × 0.903 ≈ 19.9 ≤ 20
    const etherTime = etherRows.reduce((s, r) => s + r.totalTime, 0)
    expect(etherTime).toBeLessThanOrEqual(20 + 0.5)
    // 非6命无余温行
    expect(executions.some(r => r.moveId === 'zhuyuan_c6_afterglow_bullets')).toBe(false)
  })

  it('核心被动失衡增伤+40%：per-row 挂在压制以太行（失衡覆盖率由失衡次数反推）', () => {
    const cfg: any = { zhuyuanCinemaLevel: 0, defAssistCount: 1, dodgeCounterCount: 1, quickAssistCount: 1, zhuYuanStunCoverage: 0.5 }
    const executions: any[] = []
    zhuYuanMechanic.buildExecutions!({ cfg, state: mkState(), executions } as any)
    const etherRows = executions.filter(r => ['1241010', '1241011', '1241012'].includes(r.moveId))
    // 覆盖率 50% → +20% 增伤挂在每段以太行
    expect(etherRows.length).toBe(3)
    expect(etherRows.every(r => r.dmgBonus === 20)).toBe(true)
    // 覆盖率 0 → 无 dmgBonus
    const cfg0: any = { zhuyuanCinemaLevel: 0, defAssistCount: 1, dodgeCounterCount: 1, quickAssistCount: 1, zhuYuanStunCoverage: 0 }
    const empty: any[] = []
    zhuYuanMechanic.buildExecutions!({ cfg: cfg0, state: mkState(), executions: empty } as any)
    expect(empty.filter(r => ['1241010', '1241011', '1241012'].includes(r.moveId)).every(r => (r.dmgBonus ?? 0) === 0)).toBe(true)
  })

  it('失衡覆盖率由失衡次数反推（applyTeamConfig converge）', () => {
    const characters: any[] = [{ slot: 0, agentId: '1241', zhuYuanStunCoverage: 0 }]
    zhuYuanMechanic.applyTeamConfig!({ slot: 0, characters, phase: 'converge', stunCount: 3, combatTime: 180 } as any)
    expect(characters[0].zhuYuanStunCoverage).toBeCloseTo(3 * 16 / 180, 5)
  })

  it('轴模式（捏轴）：失衡增伤按轴内压制以太占比', () => {
    const cfg: any = { zhuyuanCinemaLevel: 0, defAssistCount: 1, dodgeCounterCount: 1, quickAssistCount: 1, zhuYuanStunCoverage: 0.5, zhuYuanAxisActive: true, zhuYuanAxisEther: 0 }
    const executions: any[] = []
    zhuYuanMechanic.buildExecutions!({ cfg, state: mkState(), executions } as any)
    const etherRows = executions.filter(r => ['1241010', '1241011', '1241012'].includes(r.moveId))
    // 轴内 0 → 无增伤（即使反推覆盖率 0.5 也不生效）
    expect(etherRows.every(r => (r.dmgBonus ?? 0) === 0)).toBe(true)
  })

  it('影画6 以太余温：floor(霰弹总量/12)次 ×4枚鹿弹执行行（附在压制以太之后）', () => {
    const cfg: any = { zhuyuanCinemaLevel: 6, defAssistCount: 1, dodgeCounterCount: 1, quickAssistCount: 1 }
    const executions: any[] = []
    zhuYuanMechanic.buildExecutions!({ cfg, state: mkState(), executions } as any)
    const afterglow = executions.find(r => r.moveId === 'zhuyuan_c6_afterglow_bullets')
    expect(afterglow).toBeTruthy()
    // cinema6 含影画1 快速装填：总量 36+21=57 → floor(57/12)=4 次 ×4 枚
    expect(afterglow!.count).toBe(4 * 4)
    expect(afterglow!.damageMultiplier).toBe(220)
    expect(afterglow!.element).toBe('ether')
    // 压制以太行仍在
    expect(executions.some(r => r.moveId === '1241010')).toBe(true)
  })

  it('resourceSections 输出以太余温卡', () => {
    const cfg: any = { zhuyuanCinemaLevel: 6, defAssistCount: 1, dodgeCounterCount: 1, quickAssistCount: 1 }
    const result: any = zhuYuanMechanic.buildResourceResult!({ cfg, state: mkState() } as any)
    const sections = zhuYuanMechanic.resourceSections!({ result, cfg } as any)
    expect(sections.some((s: any) => s.title?.includes('强化霰弹'))).toBe(true)
    const afterglow = sections.find((s: any) => s.id === 'zhuyuan-afterglow')
    expect(afterglow).toBeTruthy()
    expect(afterglow!.summary).toContain('4')
  })

  it('影画6 余温回能：floor(霰弹总量/12)次 ×30 能量并入 initialEnergyGift（用户口径 2026-08）', () => {
    // cinema6 含影画1 快速装填：总量 36+21=57 → floor(57/12)=4 次 ×30 = 120 能量
    const cfg: any = { zhuyuanCinemaLevel: 6, defAssistCount: 1, dodgeCounterCount: 1, quickAssistCount: 1 }
    zhuYuanMechanic.buildResourceResult!({ cfg, state: mkState() } as any)
    expect(cfg.initialEnergyGift).toBe(4 * 30)

    // 非6命不注入
    const cfg0: any = { zhuyuanCinemaLevel: 0, defAssistCount: 1, dodgeCounterCount: 1, quickAssistCount: 1 }
    zhuYuanMechanic.buildResourceResult!({ cfg: cfg0, state: mkState() } as any)
    expect(cfg0.initialEnergyGift ?? 0).toBe(0)
  })
})
