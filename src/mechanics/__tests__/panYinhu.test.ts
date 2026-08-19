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

async function setup(mateId = '1441', cinemaLevel = 0) {
  const catalog = useCatalogStore()
  await catalog.load()
  await catalog.loadTeammateBuffs()
  const config = useConfigStore()
  for (const buff of config.globalBuffs) buff.enabled = false
  // slot0 潘引壶，slot1 队友（1441 真斗 = 命破 → 触发额外能力）
  config.team[0] = { slot: 0, agentId: '1421', cinemaLevel, ...baseConfig } as any
  config.team[1] = { slot: 1, agentId: mateId, cinemaLevel: 0, ...baseConfig } as any
  config.team[2] = { slot: 2, agentId: '', cinemaLevel: 0, ...baseConfig } as any
  config.syncTeammateBuffsFromTeam()
  return { catalog, config }
}

describe('潘引壶（1421）核心被动[通窍]贯穿力', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    stubFetch()
  })

  it('队友入场获得贯穿力 = 潘引壶初始攻×18%（cap 540）；影画6 放大至24%（cap 720）', async () => {
    const { catalog, config } = await setup('1441', 0)
    const phases0 = computePanelPhases(0, config, catalog)!
    const panAtkOut = (phases0.outOfCombat as any).atk as number

    const withBuff = (computePanelPhases(1, config, catalog)!.inCombat as any).sheerForceFlat as number
    config.toggleTeammateBuff('pan_yinhu.core_open_meridians_sheer_force', false)
    const withoutBuff = (computePanelPhases(1, config, catalog)!.inCombat as any).sheerForceFlat as number
    config.toggleTeammateBuff('pan_yinhu.core_open_meridians_sheer_force', true)

    const expected0 = Math.min(540, panAtkOut * 0.18)
    expect(withBuff - withoutBuff).toBeCloseTo(expected0, 0)
    expect(expected0).toBeGreaterThan(0)

    // 影画6：buffModifiers ×4/3 → 比例24%、上限720（引擎同步放大 cap）
    config.team[0].cinemaLevel = 6
    config.syncTeammateBuffsFromTeam()
    const withC6 = (computePanelPhases(1, config, catalog)!.inCombat as any).sheerForceFlat as number
    const expected6 = Math.min(720, panAtkOut * 0.24)
    expect(withC6 - withoutBuff).toBeCloseTo(expected6, 0)
  })
})

describe('潘引壶额外能力·食铁纳金与影画1（[气绝]增伤门控）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    stubFetch()
  })

  it('[命破]或同阵营（云岿山）队友：气绝增伤+20%、影画1再+10%；无命破非同阵营：全部门控', async () => {
    // 正例1：1441 真斗（命破，怪啖屋 ≠ 云岿山 → 纯专精命中）
    const pos1 = await setup('1441', 0)
    const on1 = (computePanelPhases(1, pos1.config, pos1.catalog)!.inCombat as any).dmgBonus as number
    pos1.config.toggleTeammateBuff('pan_yinhu.additional_stupefaction_dmg', false)
    const off1 = (computePanelPhases(1, pos1.config, pos1.catalog)!.inCombat as any).dmgBonus as number
    pos1.config.toggleTeammateBuff('pan_yinhu.additional_stupefaction_dmg', true)
    expect((computePanelPhases(0, pos1.config, pos1.catalog)!.inCombat as any).additionalAbilityActive).toBe(1)
    expect(on1 - off1).toBeCloseTo(20, 5)

    // 正例2：1391 橘福福（击破，云岿山同阵营 → 纯阵营命中）
    const pos2 = await setup('1391', 0)
    expect((computePanelPhases(0, pos2.config, pos2.catalog)!.inCombat as any).additionalAbilityActive).toBe(1)

    // 影画1：气绝敌人增伤再+10%（与额外能力同源门控）
    pos1.config.team[0].cinemaLevel = 1
    pos1.config.syncTeammateBuffsFromTeam()
    const on1c1 = (computePanelPhases(1, pos1.config, pos1.catalog)!.inCombat as any).dmgBonus as number
    expect(on1c1 - on1).toBeCloseTo(10, 5)

    // 负例：1081 比利（强攻，狡兔屋）→ 额外能力与影画1 均被门控，开关无差分
    const neg = await setup('1081', 1)
    const pNeg = computePanelPhases(1, neg.config, neg.catalog)!.inCombat as any
    neg.config.toggleTeammateBuff('pan_yinhu.additional_stupefaction_dmg', false)
    neg.config.toggleTeammateBuff('pan_yinhu.cinema_1_stupefaction_dmg', false)
    const pNegOff = computePanelPhases(1, neg.config, neg.catalog)!.inCombat as any
    expect((computePanelPhases(0, neg.config, neg.catalog)!.inCombat as any).additionalAbilityActive ?? 0).toBe(0)
    expect(pNeg.dmgBonus).toBeCloseTo(pNegOff.dmgBonus, 5)
  })
})
