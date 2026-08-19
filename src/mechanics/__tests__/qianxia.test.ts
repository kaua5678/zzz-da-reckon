import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useCatalogStore } from '@/stores/catalog'
import { useConfigStore } from '@/stores/config'
import { computePanelPhases } from '@/composables/resourceCalc/helpers'
import { qianxiaMechanic } from '@/mechanics/agents/qianxia'

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
  // slot0 千夏，slot1 队友（1081 比利 = 物理·强攻 → 触发额外能力）
  config.team[0] = { slot: 0, agentId: '1491', cinemaLevel, ...baseConfig } as any
  config.team[1] = { slot: 1, agentId: mateId, cinemaLevel: 0, ...baseConfig } as any
  config.team[2] = { slot: 2, agentId: '', cinemaLevel: 0, ...baseConfig } as any
  config.syncTeammateBuffsFromTeam()
  return { catalog, config }
}

describe('千夏（1491）额外能力·白日梦对位法门控', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    stubFetch()
  })

  it('[强攻]队友在队：帷幕失衡易伤 +30% 生效；支援队友（不同阵营）：不生效', async () => {
    // 正例：1081 比利（强攻）
    const pos = await setup('1081')
    const pPos = computePanelPhases(0, pos.config, pos.catalog)!.inCombat as any
    expect(pPos.additionalAbilityActive).toBe(1)
    expect(pPos.stunDmgMultiplierBonus).toBeCloseTo(30, 5)

    // 负例：1211 丽娜（支援，维多利亚家政 ≠ 妄想天使）
    const neg = await setup('1211')
    const pNeg = computePanelPhases(0, neg.config, neg.catalog)!.inCombat as any
    expect(pNeg.additionalAbilityActive ?? 0).toBe(0)
    expect(pNeg.stunDmgMultiplierBonus).toBeCloseTo(0, 5)
  })

  it('进场回能 15：额外能力激活时并入 initialEnergyGift，未激活不注入', () => {
    const cfgOn: any = {}
    qianxiaMechanic.buildCharConfig!({ cfg: cfgOn, panel: { additionalAbilityActive: 1 } } as any)
    expect(cfgOn.initialEnergyGift).toBe(15)

    const cfgOff: any = {}
    qianxiaMechanic.buildCharConfig!({ cfg: cfgOff, panel: { additionalAbilityActive: 0 } } as any)
    expect(cfgOff.initialEnergyGift ?? 0).toBe(0)
  })
})

describe('千夏影画拐力（teammate-buffs 按命座门控）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    stubFetch()
  })

  it('命座差分：1命减防 7%×3、2命攻击 +10%、4命全队增伤 +18%', async () => {
    const { catalog, config } = await setup('1081', 0)
    const phases0 = computePanelPhases(0, config, catalog)!
    const p0 = phases0.inCombat as any

    config.team[0].cinemaLevel = 1
    config.syncTeammateBuffsFromTeam()
    const p1 = computePanelPhases(0, config, catalog)!.inCombat as any
    expect(p1.enemyDefReduction - p0.enemyDefReduction).toBeCloseTo(21, 5)

    config.team[0].cinemaLevel = 2
    config.syncTeammateBuffsFromTeam()
    const phases2 = computePanelPhases(0, config, catalog)!
    const p2 = phases2.inCombat as any
    // 局内大攻击 +10%：差分 = 局外攻击（基底）× 10%
    const atkBase = (phases2.outOfCombat as any).atk
    expect(p2.atk - p0.atk).toBeCloseTo(atkBase * 0.1, 0)

    config.team[0].cinemaLevel = 4
    config.syncTeammateBuffsFromTeam()
    const p4 = computePanelPhases(0, config, catalog)!.inCombat as any
    expect(p4.dmgBonus - p2.dmgBonus).toBeCloseTo(18, 5)
  })

  it('核心被动攻击拐：按千夏局外攻击 30% 上限 1050（开关差分）', async () => {
    const { catalog, config } = await setup('1081', 0)
    const phases = computePanelPhases(0, config, catalog)!
    const atkOut = (phases.outOfCombat as any).atk ?? 0
    const withBuff = (phases.inCombat as any).atk

    config.toggleTeammateBuff('buff_j8kf2r9m4q', false)
    const withoutBuff = (computePanelPhases(0, config, catalog)!.inCombat as any).atk
    config.toggleTeammateBuff('buff_j8kf2r9m4q', true)

    const expected = Math.min(1050, Math.floor(atkOut * 0.3))
    expect(withBuff - withoutBuff).toBeCloseTo(expected, 0)
    expect(expected).toBeGreaterThan(0)
  })
})
