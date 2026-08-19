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

async function setup(mateId = '1441', cinemaLevel = 0) {
  const catalog = useCatalogStore()
  await catalog.load()
  await catalog.loadTeammateBuffs()
  const config = useConfigStore()
  for (const buff of config.globalBuffs) buff.enabled = false
  // slot0 希希芙，slot1 队友（1441 真斗 = 命破 → 触发额外能力）
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
    const { catalog, config } = await setup('1441', 0)
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

  it('门控：[击破]或同属性（电）队友激活 → 队友暴伤+40%、希希芙自己+50%；无命中不生效', async () => {
    // 正例1：1441 真斗（命破，怪啖屋 ≠ 新艾利都治安局 → 纯专精命中）
    const pos1 = await setup('1441', 0)
    const phases1 = computePanelPhases(0, pos1.config, pos1.catalog)!
    expect((phases1.inCombat as any).additionalAbilityActive).toBe(1)
    const critBase = (phases1.outOfCombat as any).critDmg as number
    const selfCd = (phases1.inCombat as any).critDmg as number
    pos1.config.toggleTeammateBuff('xixifu.additional_toxin_crit_dmg', false)
    const selfCdOff = (computePanelPhases(0, pos1.config, pos1.catalog)!.inCombat as any).critDmg as number
    pos1.config.toggleTeammateBuff('xixifu.additional_toxin_crit_dmg', true)
    expect(selfCd - selfCdOff).toBeCloseTo(40, 5) // 全队 buff 部分
    expect(selfCdOff - critBase).toBeCloseTo(10, 5) // 模块「自身额外10%」部分
    expect(selfCd - critBase).toBeCloseTo(50, 5) // 合计

    const mateCd = (computePanelPhases(1, pos1.config, pos1.catalog)!.inCombat as any).critDmg as number
    pos1.config.toggleTeammateBuff('xixifu.additional_toxin_crit_dmg', false)
    const mateCdOff = (computePanelPhases(1, pos1.config, pos1.catalog)!.inCombat as any).critDmg as number
    pos1.config.toggleTeammateBuff('xixifu.additional_toxin_crit_dmg', true)
    expect(mateCd - mateCdOff).toBeCloseTo(40, 5)

    // 正例2：1181 格莉丝（电属性，同属性命中）
    const pos2 = await setup('1181', 0)
    expect((computePanelPhases(0, pos2.config, pos2.catalog)!.inCombat as any).additionalAbilityActive).toBe(1)

    // 负例：1081 比利（强攻，狡兔屋）→ 不激活，开关无差分
    const neg = await setup('1081', 0)
    const pNegOn = computePanelPhases(0, neg.config, neg.catalog)!.inCombat as any
    neg.config.toggleTeammateBuff('xixifu.additional_toxin_crit_dmg', false)
    const pNegOff = computePanelPhases(0, neg.config, neg.catalog)!.inCombat as any
    neg.config.toggleTeammateBuff('xixifu.additional_toxin_crit_dmg', true)
    expect(pNegOn.additionalAbilityActive ?? 0).toBe(0)
    expect(pNegOn.critDmg).toBeCloseTo(pNegOff.critDmg, 5)
  })
})
