import { beforeEach, describe, expect, it } from 'vitest'
import { mockStaticFetch, newPinia } from '@/test/harness'
import { useCatalogStore } from '@/stores/catalog'
import { useConfigStore } from '@/stores/config'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { buildCharConfig, computePanelPhases } from '@/composables/resourceCalc/helpers'

const baseConfig = {
  wEngineId: '',
  wEngineModLevel: 5,
  driveDisc: {
    fourPieceSetId: '',
    twoPieceSetId: '',
    mainStats: { 4: 'atkPct' as any, 5: 'physicalDmg' as any, 6: 'critRate' as any },
    subStatAllocation: {},
  },
  parryCount: 0,
  dodgeCounterCount: 0,
  quickAssistCount: 0,
  chainCountPerStun: 0,
  basicAttackTimeWeight: 1,
}

beforeEach(() => {
  newPinia()
  mockStaticFetch()
})

async function setupSoloAgent(agentId: string) {
  const catalog = useCatalogStore()
  await catalog.load()
  const config = useConfigStore()
  config.team[0] = { slot: 0, agentId, cinemaLevel: 0, ...baseConfig } as any
  config.team[1] = { slot: 1, agentId: '', cinemaLevel: 0, ...baseConfig } as any
  config.team[2] = { slot: 2, agentId: '', cinemaLevel: 0, ...baseConfig } as any
  return config
}

async function damageAt(agentId: string, level: number): Promise<number> {
  const config = await setupSoloAgent(agentId)
  config.setCinemaLevel(0, level)
  const calc = useResourceCalc()
  await new Promise(r => setTimeout(r, 0))
  return calc.teamTotalDamage.value
}

describe('cinema skill level damage', () => {
  it.each(['1561', '1261', '1011', '1481', '1571'])('applies cinema 3/5 skill levels to %s', async (agentId) => {
    const d2 = await damageAt(agentId, 2)
    const d3 = await damageAt(agentId, 3)
    const d4 = await damageAt(agentId, 4)
    const d5 = await damageAt(agentId, 5)
    expect(d2).toBeGreaterThan(0)
    expect(d3 / d2).toBeGreaterThan(1.02)
    expect(d5 / d4).toBeGreaterThan(1.02)
  })

  it('norma cinema2: 技术鸿沟易伤 30→60 翻倍（额外能力触发时）', async () => {
    const catalog = useCatalogStore()
    await catalog.load()
    const config = useConfigStore()
    // 艾莲(1191, 强攻) 队友触发诺姆额外能力
    config.team[0] = { slot: 0, agentId: '1571', cinemaLevel: 2, ...baseConfig } as any
    config.team[1] = { slot: 1, agentId: '1191', cinemaLevel: 0, ...baseConfig } as any
    config.team[2] = { slot: 2, agentId: '', cinemaLevel: 0, ...baseConfig } as any

    const cfgM2 = buildCharConfig(0, config, catalog)!
    expect(cfgM2.normaAdditionalAbilityActive).toBe(true)
    expect(cfgM2.normaTechGapStunBonus).toBe(60) // M2: 6%/层 × 10层（3%→6% 翻倍）

    config.setCinemaLevel(0, 1)
    const cfgM1 = buildCharConfig(0, config, catalog)!
    expect(cfgM1.normaTechGapStunBonus).toBe(30) // M1: 3%/层 × 10层

    config.setCinemaLevel(0, 2)
    expect(cfgM2.normaC2EnergyPerTrigger).toBe(25) // M2 帽子把戏回能
  })

  it('yidhari curtain HP: cinema4 = 涌泉生命 5%→10%，真正重算 panel.hp（修复前 4 命提升率为 0%）', async () => {
    const catalog = useCatalogStore()
    await catalog.load()
    await catalog.loadTeammateBuffs()
    const config = useConfigStore()
    config.team[0] = { slot: 0, agentId: '1051', cinemaLevel: 3, ...baseConfig } as any
    config.team[1] = { slot: 1, agentId: '', cinemaLevel: 0, ...baseConfig } as any
    config.team[2] = { slot: 2, agentId: '', cinemaLevel: 0, ...baseConfig } as any
    config.syncTeammateBuffsFromTeam()
    const hpC3 = buildCharConfig(0, config, catalog)!.panel.hp
    config.setCinemaLevel(0, 4)
    config.syncTeammateBuffsFromTeam()
    const hpC4 = buildCharConfig(0, config, catalog)!.panel.hp
    expect(hpC3).toBeGreaterThan(0)
    expect(hpC4 / hpC3).toBeCloseTo(1.1 / 1.05, 4) // 3命 +5% → 4命 +10%
  })

  it('liuyin cinema6 echo: 轴模式下余音也生成（修复前被 !isAxis 包裹，轴模式 6 命提升率为 0%）', async () => {
    const catalog = useCatalogStore()
    await catalog.load()
    const config = useConfigStore()
    // 伊琉卢：autoYidhariAxis 默认开 → 章鱼自动轴生效（轴模式）
    config.team[0] = { slot: 0, agentId: '1051', cinemaLevel: 0, ...baseConfig } as any
    config.team[1] = { slot: 1, agentId: '1481', cinemaLevel: 6, ...baseConfig } as any
    config.team[2] = { slot: 2, agentId: '1451', cinemaLevel: 0, ...baseConfig } as any
    config.syncTeammateBuffsFromTeam()
    const calc = useResourceCalc()
    await new Promise(r => setTimeout(r, 50))
    expect(calc.autoActive.value).toBe(true) // 自动轴确实生效
    const rows = calc.damagePoolRows.value
    const echo = rows.find(r => r.name.includes('余音'))
    expect(echo).toBeDefined()
    expect(echo!.totalDamage).toBeGreaterThan(0)
  })

  it('lucia w-engine 14145（铸梦炉歌）：局内生命 hpPct 按精炼等级生效（5精炼24% + 涌泉5% = ×1.29）', async () => {
    const catalog = useCatalogStore()
    await catalog.load()
    await catalog.loadTeammateBuffs()
    const config = useConfigStore()
    const cfg = { ...baseConfig, wEngineId: '14145', wEngineModLevel: 5 } as any
    config.team[0] = { slot: 0, agentId: '1451', cinemaLevel: 0, ...cfg } as any
    config.team[1] = { slot: 1, agentId: '', cinemaLevel: 0, ...baseConfig } as any
    config.team[2] = { slot: 2, agentId: '', cinemaLevel: 0, ...baseConfig } as any
    config.syncTeammateBuffsFromTeam()

    const w = catalog.getWEngine('14145')
    expect(w).toBeDefined()
    expect(w!.specialty).toBe('support') // 与卢西娅职业匹配

    const p5 = computePanelPhases(0, config, catalog)!
    // 局内 pct = 专武 hpPct(5精炼 24%) + 卢西娅核心被动涌泉 5% → ×1.29（加算）
    expect(p5.inCombat.hp / p5.outOfCombat.hp).toBeCloseTo(1.29, 4)

    // 3精炼：19.5% + 5% = ×1.245
    config.team[0].wEngineModLevel = 3
    const p3 = computePanelPhases(0, config, catalog)!
    expect(p3.inCombat.hp / p3.outOfCombat.hp).toBeCloseTo(1.245, 4)
  })

  it('setAgent 自动推荐音擎：优先专属（ownerAgentId），不再取同职业第一个 S', async () => {
    const catalog = useCatalogStore()
    await catalog.load()
    await catalog.loadTeammateBuffs()
    const config = useConfigStore()
    const cfg = { ...baseConfig, wEngineId: '' } as any
    config.team[0] = { slot: 0, agentId: '', cinemaLevel: 0, ...cfg } as any
    config.team[1] = { slot: 1, agentId: '', cinemaLevel: 0, ...cfg } as any
    config.team[2] = { slot: 2, agentId: '', cinemaLevel: 0, ...cfg } as any

    // 伊德海莉（rupture）→ 专属 14105 海妖摇篮（修复前会取同职业第一个 S = 14153 星辉比利专武）
    config.setAgent(0, '1051')
    expect(config.team[0].wEngineId).toBe('14105')
    // 星辉·比利（rupture）→ 专属 14153
    config.setAgent(0, '1531')
    expect(config.team[0].wEngineId).toBe('14153')
    // 卢西娅（support）→ 专属 14145 铸梦炉歌
    config.setAgent(0, '1451')
    expect(config.team[0].wEngineId).toBe('14145')
  })

  it('applyBuildRecommendationForSlot 写入数字音擎 id（catalog_wengine_id 已迁移）', async () => {
    const catalog = useCatalogStore()
    await catalog.load()
    await catalog.loadTeammateBuffs()
    await catalog.loadBuildRecommendations()
    const config = useConfigStore()
    const cfg = { ...baseConfig, wEngineId: '' } as any
    config.team[0] = { slot: 0, agentId: '1451', cinemaLevel: 0, ...cfg } as any
    config.team[1] = { slot: 1, agentId: '', cinemaLevel: 0, ...cfg } as any
    config.team[2] = { slot: 2, agentId: '', cinemaLevel: 0, ...cfg } as any
    config.applyBuildRecommendationForSlot(0)
    expect(config.team[0].wEngineId).toBe('14145') // 铸梦炉歌，旧 zzz_wiki_1611
    // getWEngine 对旧 id 兼容（legacyIds 兜底）
    expect(catalog.getWEngine('zzz_wiki_1611')?.id).toBe('14145')
  })
})
