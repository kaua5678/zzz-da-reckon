import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useCatalogStore } from '@/stores/catalog'
import { useConfigStore } from '@/stores/config'
import { computePanelPhases } from '@/composables/resourceCalc/helpers'
import { getTargetedStat } from '@/core/buff'
import { xideMechanic } from '@/mechanics/agents/xide'

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

async function setup(mateId = '1081', cinemaLevel = 0) {
  const catalog = useCatalogStore()
  await catalog.load()
  await catalog.loadTeammateBuffs()
  const config = useConfigStore()
  for (const buff of config.globalBuffs) buff.enabled = false
  // slot0 席德，slot1 队友（1081 比利 = 物理·强攻 → 正兵/额外能力触发）
  config.team[0] = { slot: 0, agentId: '1461', cinemaLevel, ...baseConfig } as any
  config.team[1] = { slot: 1, agentId: mateId, cinemaLevel: 0, ...baseConfig } as any
  config.team[2] = { slot: 2, agentId: '', cinemaLevel: 0, ...baseConfig } as any
  config.syncTeammateBuffsFromTeam()
  return { catalog, config }
}

describe('席德（1461）正兵拐门控（核心被动/影画2）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    stubFetch()
  })

  it('[强攻]队友在队：明攻攻击+1000/暴伤+30%/围杀增伤+25%；命破/击破队友不生效', async () => {
    // 正例：1081 比利（强攻）
    const pos = await setup('1081', 0)
    expect((computePanelPhases(0, pos.config, pos.catalog)!.inCombat as any).additionalAbilityActive).toBe(1)
    const pPos = computePanelPhases(1, pos.config, pos.catalog)!
    const atkOn = (pPos.inCombat as any).atk as number
    const cdOn = (pPos.inCombat as any).critDmg as number
    const dmgOn = (pPos.inCombat as any).dmgBonus as number
    pos.config.toggleTeammateBuff('seed.core_vanguard_bright_attack', false)
    const pOff = computePanelPhases(1, pos.config, pos.catalog)!.inCombat as any
    pos.config.toggleTeammateBuff('seed.core_vanguard_bright_attack', true)
    expect(atkOn - pOff.atk).toBeCloseTo(1000, 0)
    expect(cdOn - pOff.critDmg).toBeCloseTo(30, 5)
    expect(dmgOn - pOff.dmgBonus).toBeCloseTo(25, 5)

    // 负例1：1441 真斗（命破=rupture，原文不触发——击破/命破最易混淆项）
    const neg1 = await setup('1441', 0)
    expect((computePanelPhases(0, neg1.config, neg1.catalog)!.inCombat as any).additionalAbilityActive ?? 0).toBe(0)
    const n1On = computePanelPhases(1, neg1.config, neg1.catalog)!.inCombat as any
    neg1.config.toggleTeammateBuff('seed.core_vanguard_bright_attack', false)
    const n1Off = computePanelPhases(1, neg1.config, neg1.catalog)!.inCombat as any
    neg1.config.toggleTeammateBuff('seed.core_vanguard_bright_attack', true)
    expect(n1On.atk).toBeCloseTo(n1Off.atk, 5)

    // 负例2：1621 洛克茜（击破，无 buff 组）→ 同样不触发
    const neg2 = await setup('1621', 0)
    expect((computePanelPhases(0, neg2.config, neg2.catalog)!.inCombat as any).additionalAbilityActive ?? 0).toBe(0)
  })

  it('影画2：围杀无视20%防御（enemyDefReduction，按额外能力门控）', async () => {
    const pos = await setup('1081', 2)
    const on = (computePanelPhases(1, pos.config, pos.catalog)!.inCombat as any).enemyDefReduction as number
    pos.config.toggleTeammateBuff('seed.cinema_2_encirclement_def_ignore', false)
    const off = (computePanelPhases(1, pos.config, pos.catalog)!.inCombat as any).enemyDefReduction as number
    pos.config.toggleTeammateBuff('seed.cinema_2_encirclement_def_ignore', true)
    expect(on - off).toBeCloseTo(20, 5)

    // 门控：无强攻队友时开关无差分
    const neg = await setup('1441', 2)
    const nOn = (computePanelPhases(1, neg.config, neg.catalog)!.inCombat as any).enemyDefReduction as number
    neg.config.toggleTeammateBuff('seed.cinema_2_encirclement_def_ignore', false)
    const nOff = (computePanelPhases(1, neg.config, neg.catalog)!.inCombat as any).enemyDefReduction as number
    neg.config.toggleTeammateBuff('seed.cinema_2_encirclement_def_ignore', true)
    expect(nOn).toBeCloseTo(nOff, 5)
  })
})

describe('席德自身机制（额外能力/影画4/影画6）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    stubFetch()
  })

  it('额外能力：落华/终结技增伤+30%（basic/ultimate 定向）与无视25%电抗', async () => {
    const pos = await setup('1081', 0)
    const p = computePanelPhases(0, pos.config, pos.catalog)!
    const inC = p.inCombat as any
    const out = p.outOfCombat as any
    expect(getTargetedStat(inC, 'skillDmgBonus', 'basic') - getTargetedStat(out, 'skillDmgBonus', 'basic')).toBeCloseTo(30, 5)
    expect(getTargetedStat(inC, 'skillDmgBonus', 'ultimate') - getTargetedStat(out, 'skillDmgBonus', 'ultimate')).toBeCloseTo(30, 5)
    expect(inC.enemyElectricResReduction - (out.enemyElectricResReduction ?? 0)).toBeCloseTo(25, 5)

    // 负例：无强攻队友不施加
    const neg = await setup('1621', 0)
    const pn = computePanelPhases(0, neg.config, neg.catalog)!
    expect(getTargetedStat(pn.inCombat as any, 'skillDmgBonus', 'basic') - getTargetedStat(pn.outOfCombat as any, 'skillDmgBonus', 'basic')).toBeCloseTo(0, 5)
  })

  it('影画差分：4命终结技+20%与喧响效率+10%、6命暴伤+50%', async () => {
    const { catalog, config } = await setup('1081', 0)
    const p0 = computePanelPhases(0, config, catalog)!.inCombat as any
    const ult0 = getTargetedStat(p0, 'skillDmgBonus', 'ultimate')

    config.team[0].cinemaLevel = 4
    config.syncTeammateBuffsFromTeam()
    const p4 = computePanelPhases(0, config, catalog)!.inCombat as any
    expect(getTargetedStat(p4, 'skillDmgBonus', 'ultimate') - ult0).toBeCloseTo(20, 5)
    expect(p4.decibelGainEfficiency - (p0.decibelGainEfficiency ?? 0)).toBeCloseTo(10, 5)

    config.team[0].cinemaLevel = 6
    config.syncTeammateBuffsFromTeam()
    const p6 = computePanelPhases(0, config, catalog)!.inCombat as any
    expect(p6.critDmg - p4.critDmg).toBeCloseTo(50, 5)
  })

  it('影画6 激光：patchExecutions 给落华·重戮行附加 3×165% 攻击力', () => {
    const cfg: any = { xideCinemaLevel: 6, xideAtk: 3000 }
    const laser = { moveId: '1461006', skillTableNote: '' } as any
    const other = { moveId: '1461001', skillTableNote: '' } as any
    xideMechanic.patchExecutions!({ cfg, state: {} as any, executions: [laser, other], teamFrontlineSeconds: 0 } as any)
    expect(laser.flatDamageBonus).toBeCloseTo(3000 * 4.95, 5)
    expect(other.flatDamageBonus ?? 0).toBeCloseTo(0, 5)

    const cfg5: any = { xideCinemaLevel: 5, xideAtk: 3000 }
    const exec5 = { moveId: '1461006', skillTableNote: '' } as any
    xideMechanic.patchExecutions!({ cfg: cfg5, state: {} as any, executions: [exec5], teamFrontlineSeconds: 0 } as any)
    expect(exec5.flatDamageBonus ?? 0).toBeCloseTo(0, 5)
  })
})
