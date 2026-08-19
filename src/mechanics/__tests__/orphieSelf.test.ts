import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useCatalogStore } from '@/stores/catalog'
import { useConfigStore } from '@/stores/config'
import { computePanelPhases } from '@/composables/resourceCalc/helpers'
import { inferSkillDamageTarget } from '@/core/damage'
import { getTargetedStat } from '@/core/buff'
import { orphieMechanic } from '@/mechanics/agents/orphie'

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
  config.team[0] = { slot: 0, agentId: '1301', cinemaLevel, ...baseConfig } as any
  config.team[1] = { slot: 1, agentId: mateId, cinemaLevel: 0, ...baseConfig } as any
  config.team[2] = { slot: 2, agentId: '', cinemaLevel: 0, ...baseConfig } as any
  config.syncTeammateBuffsFromTeam()
  return { catalog, config }
}

/** 原文视为[追加攻击]的招式（高压火枪全6段为用户确认口径） */
const ADDITIONAL_MOVE_IDS = new Set([
  '1301001', '1301002', '1301003', '1301004', '1301005', '1301006',
  '1301009', '1301010', '1301011', '1301022', '1301014', '1301015', '1301016',
])

describe('奥菲丝（1301）追加攻击 tag 与定向增伤', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    stubFetch()
  })

  it('catalog 打标：13 个原文招式带 additionalAttack，其余招式不带', async () => {
    const catalog = useCatalogStore()
    await catalog.load()
    const skills = (catalog as any).agentSkills?.find?.((s: any) => s.agentId === '1301')
      ?? JSON.parse(catalogText).agentSkills.find((s: any) => s.agentId === '1301')
    expect(skills).toBeTruthy()
    const seen: string[] = []
    for (const category of skills.categories) {
      for (const move of category.moves) {
        const tagged = (move.skillTags ?? []).includes('additionalAttack')
        expect(tagged, `${move.id} ${move.name?.zhCN}`).toBe(ADDITIONAL_MOVE_IDS.has(move.id))
        seen.push(move.id)
      }
    }
    for (const id of ADDITIONAL_MOVE_IDS) expect(seen).toContain(id)
  })

  it('inferSkillDamageTarget：additionalAttack tag 优先于类别推断', () => {
    const fakeCategory = { id: 'chain' } as any
    const tagged = { id: 'x', name: { zhCN: '连携技：枪管过热' }, skillTags: ['additionalAttack'] } as any
    const plain = { id: 'y', name: { zhCN: '连携技：某招式' } } as any
    expect(inferSkillDamageTarget(fakeCategory, tagged)).toBe('additionalAttack')
    expect(inferSkillDamageTarget(fakeCategory, plain)).toBe('chain')
  })

  it('核心被动自身面板：暴击率+25%、追加攻击增伤+85% 只进增伤区的 additionalAttack 定向', async () => {
    const { catalog, config } = await setup('1621', 0)
    const phases = computePanelPhases(0, config, catalog)!
    const out = phases.outOfCombat as any
    const inC = phases.inCombat as any
    expect(inC.critRate - out.critRate).toBeCloseTo(25, 5)
    const additionalBonus = getTargetedStat(inC, 'skillDmgBonus', 'additionalAttack')
      - getTargetedStat(out, 'skillDmgBonus', 'additionalAttack')
    expect(additionalBonus).toBeCloseTo(85, 5)
    // 其他招式类别不吃这 85%（增伤区按 tag 定向，不是全局增伤）
    expect(getTargetedStat(inC, 'skillDmgBonus', 'basic') - getTargetedStat(out, 'skillDmgBonus', 'basic')).toBeCloseTo(0, 5)
    expect((inC.skillDmgBonus ?? 0) - (out.skillDmgBonus ?? 0)).toBeCloseTo(0, 5)
  })

  it('影画差分：1命火抗无视15%、2命攻击+20%、4命终结技增伤+40%', async () => {
    const { catalog, config } = await setup('1621', 0)
    const phases0 = computePanelPhases(0, config, catalog)!
    const p0 = phases0.inCombat as any

    config.team[0].cinemaLevel = 1
    config.syncTeammateBuffsFromTeam()
    const p1 = computePanelPhases(0, config, catalog)!.inCombat as any
    expect(p1.enemyFireResReduction - p0.enemyFireResReduction).toBeCloseTo(15, 5)

    config.team[0].cinemaLevel = 2
    config.syncTeammateBuffsFromTeam()
    const phases2 = computePanelPhases(0, config, catalog)!
    const p2 = phases2.inCombat as any
    // 影画2 按面板攻击乘20%近似（velina 先例）
    expect(p2.atk - p1.atk).toBeCloseTo(p1.atk * 0.2, 0)

    config.team[0].cinemaLevel = 4
    config.syncTeammateBuffsFromTeam()
    const p4 = computePanelPhases(0, config, catalog)!.inCombat as any
    const ultDmg4 = getTargetedStat(p4, 'skillDmgBonus', 'ultimate')
    const ultDmg2 = getTargetedStat(p2, 'skillDmgBonus', 'ultimate')
    expect(ultDmg4 - ultDmg2).toBeCloseTo(40, 5)
  })
})

describe('奥菲丝影画6 激光附加伤害（patchExecutions moveId 限定）', () => {
  const mkExec = (moveId: string) => ({ moveId, skillTableNote: '' }) as any

  it('6命：蓄热充能/与火共舞行附加 250% 局内攻；其余招式与非6命不附加', () => {
    const cfg: any = { orphieCinemaLevel: 6, orphieAtk: 3000 }
    const laser = mkExec('1301011')
    const ult1 = mkExec('1301015')
    const ult2 = mkExec('1301016')
    const other = mkExec('1301009')
    orphieMechanic.patchExecutions!({ cfg, state: {} as any, executions: [laser, ult1, ult2, other], teamFrontlineSeconds: 0 } as any)
    expect(laser.flatDamageBonus).toBeCloseTo(3000 * 2.5, 5)
    expect(ult1.flatDamageBonus).toBeCloseTo(3000 * 2.5, 5)
    expect(ult2.flatDamageBonus).toBeCloseTo(3000 * 2.5, 5)
    expect(other.flatDamageBonus ?? 0).toBeCloseTo(0, 5)
    expect(laser.skillTableNote).toContain('影画6')

    // 非6命不附加
    const cfg5: any = { orphieCinemaLevel: 5, orphieAtk: 3000 }
    const exec5 = mkExec('1301011')
    orphieMechanic.patchExecutions!({ cfg: cfg5, state: {} as any, executions: [exec5], teamFrontlineSeconds: 0 } as any)
    expect(exec5.flatDamageBonus ?? 0).toBeCloseTo(0, 5)
  })

  it('buildCharConfig 预存命座与局内攻（flatDamageBonus 基数）', () => {
    const cfg: any = {}
    orphieMechanic.buildCharConfig!({ cfg, cinemaLevel: 6, panel: { atk: 4321 } } as any)
    expect(cfg.orphieCinemaLevel).toBe(6)
    expect(cfg.orphieAtk).toBe(4321)
  })
})

describe('奥菲丝蓄炎资源循环（spec resource）', () => {
  const mkState = () => ({
    exSpecialCount: 2, chainCountTotal: 1, ultimateCount: 1,
    basicAttackTime: 10, frontlineTime: 30, backstageTime: 0,
  }) as any

  it('获取=强特20×2+连携20+终结20+蚀光一闪(战斗时长×4)，消耗=蓄热充能每次100', () => {
    const cfg: any = { orphieCinemaLevel: 0, battleTime: 100 }
    const result: any = orphieMechanic.buildResourceResult!({ cfg, state: mkState() } as any)
    const xuyan = result.specResources.orphie_xuyan
    expect(xuyan).toBeTruthy()
    expect(xuyan.initialValue).toBe(100)
    expect(xuyan.maxValue).toBe(125)
    expect(xuyan.gains.xuyan_ex_special_gain).toBeCloseTo(40, 5)
    expect(xuyan.gains.xuyan_chain_gain).toBeCloseTo(20, 5)
    expect(xuyan.gains.xuyan_ultimate_gain).toBeCloseTo(20, 5)
    expect(xuyan.gains.xuyan_shiguang_gain).toBeCloseTo(400, 5)
    expect(xuyan.gains.xuyan_c6_blade_gain ?? 0).toBeCloseTo(0, 5)
    // 蓄热充能次数 = floor((初始100 + 总获取520) / 100)
    expect(xuyan.spendCounts.xuyan_heat_charge_spend).toBe(Math.floor((100 + 40 + 20 + 20 + 400) / 100))
  })

  it('影画6 火刀+10 按 cinema>=6 门控（次数=floor(普攻时间/2)）', () => {
    const cfg6: any = { orphieCinemaLevel: 6, battleTime: 100 }
    const r6: any = orphieMechanic.buildResourceResult!({ cfg: cfg6, state: mkState() } as any)
    expect(cfg6.orphieBladeHits).toBe(5)
    expect(r6.specResources.orphie_xuyan.gains.xuyan_c6_blade_gain).toBeCloseTo(50, 5)

    const cfg5: any = { orphieCinemaLevel: 5, battleTime: 100 }
    const r5: any = orphieMechanic.buildResourceResult!({ cfg: cfg5, state: mkState() } as any)
    expect(cfg5.orphieBladeHits).toBe(0)
    expect(r5.specResources.orphie_xuyan.gains.xuyan_c6_blade_gain ?? 0).toBeCloseTo(0, 5)
  })

  it('resourceSections 输出蓄炎资源卡', () => {
    const cfg: any = { orphieCinemaLevel: 0, battleTime: 100 }
    const result: any = orphieMechanic.buildResourceResult!({ cfg, state: mkState() } as any)
    const sections = orphieMechanic.resourceSections!({ result, cfg } as any)
    expect(sections.length).toBeGreaterThan(0)
    expect(sections.some((s: any) => s.title?.includes('蓄炎'))).toBe(true)
  })
})
