import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useCatalogStore } from '@/stores/catalog'
import { useConfigStore } from '@/stores/config'
import { computePanelPhases } from '@/composables/resourceCalc/helpers'

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
  // slot0 照，slot1 队友（1081 比利 = 物理·强攻 → 触发额外能力）
  config.team[0] = { slot: 0, agentId: '1341', cinemaLevel, ...baseConfig } as any
  config.team[1] = { slot: 1, agentId: mateId, cinemaLevel: 0, ...baseConfig } as any
  config.team[2] = { slot: 2, agentId: '', cinemaLevel: 0, ...baseConfig } as any
  config.syncTeammateBuffsFromTeam()
  return { catalog, config }
}

/** 照的增伤公式：clamp(floor((初始最大生命值-15000)/400)+10, 10, 40) */
function zhaoDmgBonusExpected(hp: number): number {
  return Math.min(40, Math.max(10, Math.floor((hp - 15000) / 400) + 10))
}

describe('照（1341）额外能力·凝聚力门控', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    stubFetch()
  })

  it('[强攻]队友在队：全队增伤公式生效；仅防护队友：被门控过滤', async () => {
    // 正例：1081 比利（强攻）→ 增伤 buff 生效，差分 = 公式值（源 = 照局外生命）
    const pos = await setup('1081')
    const phasesPos = computePanelPhases(0, pos.config, pos.catalog)!
    const zhaoHpOut = (phasesPos.outOfCombat as any).hp as number
    const withBuff = (phasesPos.inCombat as any).dmgBonus as number

    pos.config.toggleTeammateBuff('zhao.additional_ability.dmg_bonus', false)
    const withoutBuff = (computePanelPhases(0, pos.config, pos.catalog)!.inCombat as any).dmgBonus as number
    pos.config.toggleTeammateBuff('zhao.additional_ability.dmg_bonus', true)

    const expected = zhaoDmgBonusExpected(zhaoHpOut)
    expect(withBuff - withoutBuff).toBeCloseTo(expected, 5)
    expect(expected).toBeGreaterThanOrEqual(10)

    // 负例：1121 本（防护，贝洛伯格重工 ≠ 坎卜斯黑枝，且条件只看专精）→ buff 被过滤，开关无差分
    const neg = await setup('1121')
    const pNegOn = (computePanelPhases(0, neg.config, neg.catalog)!.inCombat as any).dmgBonus as number
    neg.config.toggleTeammateBuff('zhao.additional_ability.dmg_bonus', false)
    const pNegOff = (computePanelPhases(0, neg.config, neg.catalog)!.inCombat as any).dmgBonus as number
    neg.config.toggleTeammateBuff('zhao.additional_ability.dmg_bonus', true)
    expect(pNegOn).toBeCloseTo(pNegOff, 5)
  })
})

describe('照核心被动拐力（无条件部分）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    stubFetch()
  })

  it('以太帷幕·涌泉：全队生命+5%、攻击+1000（Lv.12）', async () => {
    const { catalog, config } = await setup('1081', 0)
    const phases = computePanelPhases(0, config, catalog)!
    const out = phases.outOfCombat as any
    const inC = phases.inCombat as any

    expect(inC.hp - out.hp).toBeCloseTo(out.hp * 0.05, 0)
    expect(inC.atk - out.atk).toBeCloseTo(1000, 0)
  })
})

describe('照影画拐力（teammate-buffs 按命座门控）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    stubFetch()
  })

  it('命座差分（作用于队友 slot1）：1命全属抗无视15%、2命队伍其他角色攻击+15%', async () => {
    const { catalog, config } = await setup('1081', 0)
    const phases0 = computePanelPhases(1, config, catalog)!
    const p0 = phases0.inCombat as any

    config.team[0].cinemaLevel = 1
    config.syncTeammateBuffsFromTeam()
    const p1 = computePanelPhases(1, config, catalog)!.inCombat as any
    expect(p1.enemyResReduction - p0.enemyResReduction).toBeCloseTo(15, 5)

    config.team[0].cinemaLevel = 2
    config.syncTeammateBuffsFromTeam()
    const phases2 = computePanelPhases(1, config, catalog)!
    const p2 = phases2.inCombat as any
    // 队伍其他角色攻击+15%：差分 = 局外攻击（基底）× 15%
    const atkBase = (phases2.outOfCombat as any).atk
    expect(p2.atk - p0.atk).toBeCloseTo(atkBase * 0.15, 0)
  })

  it('影画2 原文「队伍中其他角色」：照自身不吃该攻击加成', async () => {
    const { catalog, config } = await setup('1081', 2)
    const phases2 = computePanelPhases(0, config, catalog)!
    const atkWithC2 = (phases2.inCombat as any).atk as number

    config.team[0].cinemaLevel = 0
    config.syncTeammateBuffsFromTeam()
    const atkAtC0 = (computePanelPhases(0, config, catalog)!.inCombat as any).atk as number
    expect(atkWithC2 - atkAtC0).toBeCloseTo(0, 0)
  })
})
