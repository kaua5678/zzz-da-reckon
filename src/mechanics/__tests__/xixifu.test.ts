import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useCatalogStore } from '@/stores/catalog'
import { useConfigStore } from '@/stores/config'
import { computePanelPhases } from '@/composables/resourceCalc/helpers'
import { xixifuMechanic } from '@/mechanics/agents/xixifu'

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

async function setup(mateId = '1621', cinemaLevel = 0) {
  const catalog = useCatalogStore()
  await catalog.load()
  await catalog.loadTeammateBuffs()
  const config = useConfigStore()
  for (const buff of config.globalBuffs) buff.enabled = false
  // slot0 希希芙，slot1 队友（1621 洛克茜 = 风·击破 → 触发额外能力）
  config.team[0] = { slot: 0, agentId: '1521', cinemaLevel, ...baseConfig } as any
  config.team[1] = { slot: 1, agentId: mateId, cinemaLevel: 0, ...baseConfig } as any
  config.team[2] = { slot: 2, agentId: '', cinemaLevel: 0, ...baseConfig } as any
  config.syncTeammateBuffsFromTeam()
  return { catalog, config }
}

/** 核心被动电系无视防御公式（Lv.12）：clamp(floor((回能-1.4)/0.12)+6, 6, 25) */
function defIgnoreExpected(regen: number): number {
  return Math.min(25, Math.max(6, Math.floor((regen - 1.4) / 0.12) + 6))
}

describe('希希芙（1521）核心被动电系无视防御公式', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    stubFetch()
  })

  it('按希希芙局外回能取公式值；影画1 放大140%并附带5%电抗无视', async () => {
    const { catalog, config } = await setup('1621', 0)
    const phases0 = computePanelPhases(0, config, catalog)!
    const out = phases0.outOfCombat as any
    const regen = out.energyRegen * (1 + (out.energyRegenBonusPct ?? 0) / 100) + (out.energyRegenBonusFlat ?? 0)
    const expected0 = defIgnoreExpected(regen)

    const withBuff = (computePanelPhases(1, config, catalog)!.inCombat as any).enemyElectricDefReduction as number
    config.toggleTeammateBuff('xixifu.core_electric_def_ignore', false)
    const withoutBuff = (computePanelPhases(1, config, catalog)!.inCombat as any).enemyElectricDefReduction as number
    config.toggleTeammateBuff('xixifu.core_electric_def_ignore', true)
    expect(withBuff - withoutBuff).toBeCloseTo(expected0, 5)
    expect(expected0).toBeGreaterThan(6)

    // 影画1：公式×1.4（先 clamp 后放大）+ 全队电抗无视5%
    config.team[0].cinemaLevel = 1
    config.syncTeammateBuffsFromTeam()
    const p1 = computePanelPhases(1, config, catalog)!.inCombat as any
    expect(p1.enemyElectricDefReduction - withoutBuff).toBeCloseTo(expected0 * 1.4, 5)
    expect(p1.enemyElectricResReduction).toBeCloseTo(5, 5)
  })
})

describe('希希芙额外能力·毒素发酵（全队暴伤+40%、自身额外+10%）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    stubFetch()
  })

  it('自身额外+10%：按 additionalAbilityActive 门控施加', () => {
    const mk = (active: number) => ({
      slot: 0, agent: { id: '1521' } as any, cinemaLevel: 0, team: [],
      panel: { critDmg: 50, additionalAbilityActive: active } as any,
    })
    const on = mk(1); xixifuMechanic.applyPanel!(on as any)
    expect((on.panel as any).critDmg).toBeCloseTo(60, 5)

    const off = mk(0); xixifuMechanic.applyPanel!(off as any)
    expect((off.panel as any).critDmg).toBeCloseTo(50, 5)
  })

  it('门控：[击破]或同属性（电）队友激活 → 队友暴伤+40%、希希芙自己+50%；命破/强攻不生效', async () => {
    // 正例1：1621 洛克茜（风·击破=stun，非电属性、无队友 buff → 纯专精命中）
    const pos1 = await setup('1621', 0)
    const phases1 = computePanelPhases(0, pos1.config, pos1.catalog)!
    expect((phases1.inCombat as any).additionalAbilityActive).toBe(1)
    const critBase = (phases1.outOfCombat as any).critDmg as number
    const selfCd = (phases1.inCombat as any).critDmg as number
    pos1.config.toggleTeammateBuff('xixifu.additional_toxin_crit_dmg', false)
    const selfCdOff = (computePanelPhases(0, pos1.config, pos1.catalog)!.inCombat as any).critDmg as number
    pos1.config.toggleTeammateBuff('xixifu.additional_toxin_crit_dmg', true)
    expect(selfCd - selfCdOff).toBeCloseTo(40, 5) // 全队 buff 部分
    expect(selfCdOff - critBase).toBeCloseTo(15, 5) // 模块自身+10% + 终结技帷幕+5%
    expect(selfCd - critBase).toBeCloseTo(55, 5) // 合计

    const mateCd = (computePanelPhases(1, pos1.config, pos1.catalog)!.inCombat as any).critDmg as number
    pos1.config.toggleTeammateBuff('xixifu.additional_toxin_crit_dmg', false)
    const mateCdOff = (computePanelPhases(1, pos1.config, pos1.catalog)!.inCombat as any).critDmg as number
    pos1.config.toggleTeammateBuff('xixifu.additional_toxin_crit_dmg', true)
    expect(mateCd - mateCdOff).toBeCloseTo(40, 5)

    // 正例2：1181 格莉丝（电属性，同属性命中）
    const pos2 = await setup('1181', 0)
    expect((computePanelPhases(0, pos2.config, pos2.catalog)!.inCombat as any).additionalAbilityActive).toBe(1)

    // 负例1：1441 真斗（命破=rupture，原文不触发——击破≠命破，最易混淆项）
    const neg1 = await setup('1441', 0)
    const pNeg1On = computePanelPhases(0, neg1.config, neg1.catalog)!.inCombat as any
    neg1.config.toggleTeammateBuff('xixifu.additional_toxin_crit_dmg', false)
    const pNeg1Off = computePanelPhases(0, neg1.config, neg1.catalog)!.inCombat as any
    neg1.config.toggleTeammateBuff('xixifu.additional_toxin_crit_dmg', true)
    expect(pNeg1On.additionalAbilityActive ?? 0).toBe(0)
    expect(pNeg1On.critDmg).toBeCloseTo(pNeg1Off.critDmg, 5)

    // 负例2：1081 比利（强攻，狡兔屋）→ 不激活，开关无差分
    const neg = await setup('1081', 0)
    const pNegOn = computePanelPhases(0, neg.config, neg.catalog)!.inCombat as any
    neg.config.toggleTeammateBuff('xixifu.additional_toxin_crit_dmg', false)
    const pNegOff = computePanelPhases(0, neg.config, neg.catalog)!.inCombat as any
    neg.config.toggleTeammateBuff('xixifu.additional_toxin_crit_dmg', true)
    expect(pNegOn.additionalAbilityActive ?? 0).toBe(0)
    expect(pNegOn.critDmg).toBeCloseTo(pNegOff.critDmg, 5)
  })
})

describe('希希芙毒素资源循环与蚀骨', () => {
  const mkState = () => ({
    basicAttackTime: 20, exSpecialCount: 2, chainCountTotal: 1, ultimateCount: 1,
    frontlineTime: 40, backstageTime: 0,
  }) as any

  it('毒素账目：进场3+吐信段4×2+失衡占比0.5+毒牙3×2+长按3×2+连携3+终结3；蚀骨次数=总量', () => {
    const cfg: any = {}
    const result: any = xixifuMechanic.buildResourceResult!({ cfg, state: mkState() } as any)
    const toxin = result.specResources.xixifu_toxin
    expect(toxin).toBeTruthy()
    expect(toxin.initialValue).toBe(3)
    expect(toxin.maxValue).toBe(125)
    expect(toxin.gains.toxin_tuxin_stage4).toBeCloseTo(20, 5)      // basicAttackCount 10 × 2
    expect(toxin.gains.toxin_tuxin_stunned_bonus).toBeCloseTo(5, 5) // 10 × 1 × 0.5
    expect(toxin.gains.toxin_duya_base).toBeCloseTo(6, 5)
    expect(toxin.gains.toxin_duya_hold).toBeCloseTo(6, 5)
    expect(toxin.gains.toxin_chain).toBeCloseTo(3, 5)
    expect(toxin.gains.toxin_ultimate).toBeCloseTo(3, 5)
    // 蚀骨次数 = 初始3 + 总获取43 = 46（cost 1）
    expect(toxin.spendCounts.toxin_shigu_spend).toBe(46)
  })

  it('buildExecutions 生成蚀骨伤害行：次数=毒素总量、335% 攻击力、电属性', () => {
    const cfg: any = {}
    const executions: any[] = []
    xixifuMechanic.buildExecutions!({ cfg, state: mkState(), executions } as any)
    expect(executions.length).toBe(1)
    const shigu = executions[0]
    expect(shigu.moveId).toBe('xixifu_shigu')
    expect(shigu.count).toBe(46)
    expect(shigu.damageMultiplier).toBe(335)
    expect(shigu.element).toBe('electric')

    // 空 state 仍有进场初始3点毒素 → 蚀骨×3
    const empty: any[] = []
    xixifuMechanic.buildExecutions!({ cfg: {}, state: { basicAttackTime: 0, exSpecialCount: 0, chainCountTotal: 0, ultimateCount: 0 } as any, executions: empty } as any)
    expect(empty.length).toBe(1)
    expect(empty[0].count).toBe(3)
  })

  it('影画1：进场毒素 3→6（蚀骨次数随之+3）', () => {
    const cfg0: any = { xixifuCinemaLevel: 0 }
    const r0: any = xixifuMechanic.buildResourceResult!({ cfg: cfg0, state: mkState() } as any)
    const cfg1: any = { xixifuCinemaLevel: 1 }
    const r1: any = xixifuMechanic.buildResourceResult!({ cfg: cfg1, state: mkState() } as any)
    expect(r0.specResources.xixifu_toxin.initialValue).toBe(3)
    expect(r1.specResources.xixifu_toxin.initialValue).toBe(6)
    expect(r1.specResources.xixifu_toxin.spendCounts.toxin_shigu_spend
      - r0.specResources.xixifu_toxin.spendCounts.toxin_shigu_spend).toBe(3)
  })

  it('resourceSections 输出蛇吻次数卡 = floor(毒素总量/6)', () => {
    const cfg: any = {}
    const result: any = xixifuMechanic.buildResourceResult!({ cfg, state: mkState() } as any)
    const sections = xixifuMechanic.resourceSections!({ result, cfg } as any)
    expect(sections.some((s: any) => s.title?.includes('毒素'))).toBe(true)
    const shekiss = sections.find((s: any) => s.id === 'xixifu-shekiss')
    expect(shekiss).toBeTruthy()
    expect(shekiss!.summary).toContain(String(Math.floor(46 / 6)))
  })
})

describe('希希芙终结技帷幕（全队暴伤+5%）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    stubFetch()
  })

  it('队友面板暴伤差分 +5%', async () => {
    const { catalog, config } = await setup('1621', 0)
    const on = (computePanelPhases(1, config, catalog)!.inCombat as any).critDmg as number
    config.toggleTeammateBuff('xixifu.ultimate_curtain_crit_dmg', false)
    const off = (computePanelPhases(1, config, catalog)!.inCombat as any).critDmg as number
    config.toggleTeammateBuff('xixifu.ultimate_curtain_crit_dmg', true)
    expect(on - off).toBeCloseTo(5, 5)
  })
})
