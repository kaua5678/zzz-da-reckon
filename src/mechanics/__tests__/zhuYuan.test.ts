import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useCatalogStore } from '@/stores/catalog'
import { useConfigStore } from '@/stores/config'
import { computePanelPhases } from '@/composables/resourceCalc/helpers'
import { getTargetedStat } from '@/core/buff'
import { zhuYuanMechanic } from '@/mechanics/agents/zhuYuan'

const catalogText = readFileSync(new URL('../../../public/static/catalog.json', import.meta.url), 'utf8')
const buffsText = readFileSync(new URL('../../../public/static/teammate-buffs.json', import.meta.url), 'utf8')
const recsText = readFileSync(new URL('../../../public/static/build-recommendations.json', import.meta.url), 'utf8')

const baseConfig = {
  wEngineId: '', wEngineModLevel: 1,
  driveDisc: { fourPieceSetId: '', twoPieceSetId: '', mainStats: {}, subStatAllocation: {} },
  parryCount: 0, dodgeCounterCount: 0, defAssistCount: 0,
  quickAssistCount: 0, chainCountPerStun: 1, basicAttackTimeWeight: 1,
}

function stubFetch() {
  vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
    const value = String(url)
    if (value.includes('/static/catalog.json')) return { ok: true, json: async () => JSON.parse(catalogText) }
    if (value.includes('/static/teammate-buffs.json')) return { ok: true, json: async () => JSON.parse(buffsText) }
    if (value.includes('/static/build-recommendations.json')) return { ok: true, json: async () => JSON.parse(recsText) }
    return { ok: false, json: async () => ({}) }
  }))
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
    setActivePinia(createPinia())
    stubFetch()
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
    setActivePinia(createPinia())
    stubFetch()
  })

  it('强化霰弹增伤+40% 走 basic/dashAttack 定向；失衡部分按覆盖率滑块（默认0）', async () => {
    const { catalog, config } = await setup('1031', 0)
    const phases = computePanelPhases(0, config, catalog)!
    const inC = phases.inCombat as any
    const out = phases.outOfCombat as any
    expect(getTargetedStat(inC, 'skillDmgBonus', 'basic') - getTargetedStat(out, 'skillDmgBonus', 'basic')).toBeCloseTo(40, 5)
    expect(getTargetedStat(inC, 'skillDmgBonus', 'dashAttack') - getTargetedStat(out, 'skillDmgBonus', 'dashAttack')).toBeCloseTo(40, 5)
    // 失衡覆盖率默认 0：无额外增伤
    expect((inC.skillDmgBonus ?? 0) - (out.skillDmgBonus ?? 0)).toBeCloseTo(0, 5)

    // 滑块调到 50%：失衡部分 +20
    config.setMechanicSetting('zhuYuan.coreStunnedCoverage', 0.5)
    const inHalf = computePanelPhases(0, config, catalog)!.inCombat as any
    expect(getTargetedStat(inHalf, 'skillDmgBonus', 'basic') - getTargetedStat(out, 'skillDmgBonus', 'basic')).toBeCloseTo(60, 5)
    config.setMechanicSetting('zhuYuan.coreStunnedCoverage', 0)
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

  it('影画6 以太余温：floor(霰弹总量/12)次 ×4枚鹿弹执行行', () => {
    const cfg: any = { zhuyuanCinemaLevel: 6, defAssistCount: 1, dodgeCounterCount: 1, quickAssistCount: 1 }
    const executions: any[] = []
    zhuYuanMechanic.buildExecutions!({ cfg, state: mkState(), executions } as any)
    expect(executions.length).toBe(1)
    expect(executions[0].moveId).toBe('zhuyuan_c6_afterglow_bullets')
    // cinema6 含影画1 快速装填：总量 36+21=57 → floor(57/12)=4 次 ×4 枚
    expect(executions[0].count).toBe(4 * 4)
    expect(executions[0].damageMultiplier).toBe(220)
    expect(executions[0].element).toBe('ether')

    // 非6命不生成
    const cfg0: any = { zhuyuanCinemaLevel: 0, defAssistCount: 1, dodgeCounterCount: 1, quickAssistCount: 1 }
    const empty: any[] = []
    zhuYuanMechanic.buildExecutions!({ cfg: cfg0, state: mkState(), executions: empty } as any)
    expect(empty.length).toBe(0)
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
})
