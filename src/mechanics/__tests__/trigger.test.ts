import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useCatalogStore } from '@/stores/catalog'
import { useConfigStore } from '@/stores/config'
import { computePanelPhases } from '@/composables/resourceCalc/helpers'
import { triggerMechanic } from '@/mechanics/agents/trigger'

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
  // slot0 扳机，slot1 队友（1081 比利 = 物理·强攻 → 触发额外能力）
  config.team[0] = { slot: 0, agentId: '1361', cinemaLevel, ...baseConfig } as any
  config.team[1] = { slot: 1, agentId: mateId, cinemaLevel: 0, ...baseConfig } as any
  config.team[2] = { slot: 2, agentId: '', cinemaLevel: 0, ...baseConfig } as any
  config.syncTeammateBuffsFromTeam()
  return { catalog, config }
}

describe('「扳机」（1361）失衡易伤拐与命座差分', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    stubFetch()
  })

  it('核心被动失衡易伤+35%（Always 通道，失衡前亦生效）；影画1 再+20%、影画2 全队暴伤+24%', async () => {
    const { catalog, config } = await setup('1081', 0)
    const p0 = computePanelPhases(0, config, catalog)!.inCombat as any
    expect(p0.stunDmgMultiplierBonusAlways).toBeCloseTo(35, 5)

    config.team[0].cinemaLevel = 1
    config.syncTeammateBuffsFromTeam()
    const p1 = computePanelPhases(0, config, catalog)!.inCombat as any
    expect(p1.stunDmgMultiplierBonusAlways - p0.stunDmgMultiplierBonusAlways).toBeCloseTo(20, 5)

    config.team[0].cinemaLevel = 2
    config.syncTeammateBuffsFromTeam()
    const p2 = computePanelPhases(0, config, catalog)!.inCombat as any
    expect(p2.critDmg - p1.critDmg).toBeCloseTo(24, 5)
  })
})

describe('「扳机」额外能力·灵目银灯（暴击率超40%转失衡值）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    stubFetch()
  })

  it('公式 min(75, (暴击率-40)×1.5)，未激活不施加', () => {
    const mk = (critRate: number, active: number) => ({
      slot: 0, agent: { id: '1361' } as any, cinemaLevel: 0, team: [],
      panel: { critRate, additionalAbilityActive: active, stunBuildUpBonus: 0 } as any,
    })
    const cap = mk(90, 1); triggerMechanic.applyPanel!(cap as any)
    expect((cap.panel as any).stunBuildUpBonus).toBeCloseTo(75, 5)

    const mid = mk(80, 1); triggerMechanic.applyPanel!(mid as any)
    expect((mid.panel as any).stunBuildUpBonus).toBeCloseTo(60, 5)

    const low = mk(40, 1); triggerMechanic.applyPanel!(low as any)
    expect((low.panel as any).stunBuildUpBonus).toBeCloseTo(0, 5)

    const off = mk(90, 0); triggerMechanic.applyPanel!(off as any)
    expect((off.panel as any).stunBuildUpBonus).toBeCloseTo(0, 5)
  })

  it('门控：[强攻]或同属性（电）队友激活；火属性防护队友不激活', async () => {
    // 正例1：1081 比利（强攻）
    const pos1 = await setup('1081')
    const pPos1 = computePanelPhases(0, pos1.config, pos1.catalog)!.inCombat as any
    expect(pPos1.additionalAbilityActive).toBe(1)

    // 正例2：1181 格莉丝（电属性，同属性）
    const pos2 = await setup('1181')
    const pPos2 = computePanelPhases(0, pos2.config, pos2.catalog)!.inCombat as any
    expect(pPos2.additionalAbilityActive).toBe(1)

    // 负例：1121 本（火属性·防护，非[强攻]非同属性）
    const neg = await setup('1121')
    const pNeg = computePanelPhases(0, neg.config, neg.catalog)!.inCombat as any
    expect(pNeg.additionalAbilityActive ?? 0).toBe(0)
    // 基础暴击率5 < 40 阈值：即使激活失衡值加成也为0
    expect(pPos1.stunBuildUpBonus ?? 0).toBeCloseTo(0, 5)
  })
})
