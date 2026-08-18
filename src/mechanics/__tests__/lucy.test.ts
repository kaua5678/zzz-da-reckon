import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useCatalogStore } from '@/stores/catalog'
import { useConfigStore } from '@/stores/config'
import {
  assignLucyUltNeighborEnergy,
  computeLucyBoarCount,
  computeLucyCheer,
  LUCY_BOAR_CD_DEFAULT,
  lucyBoarCd,
  lucyMechanic,
} from '@/mechanics/agents/lucy'

const catalogText = readFileSync(new URL('../../../public/static/catalog.json', import.meta.url), 'utf8')
const buffsText = readFileSync(new URL('../../../public/static/teammate-buffs.json', import.meta.url), 'utf8')
const recsText = readFileSync(new URL('../../../public/static/build-recommendations.json', import.meta.url), 'utf8')

const baseConfig = {
  wEngineId: '', wEngineModLevel: 5,
  driveDisc: { fourPieceSetId: '', twoPieceSetId: '', mainStats: { 4: 'atkPct' as any, 5: 'fireDmg' as any, 6: 'atk' as any }, subStatAllocation: {} },
  parryCount: 0, dodgeCounterCount: 0, defAssistCount: 0,
  quickAssistCount: 0, chainCountPerStun: 1, basicAttackTimeWeight: 1,
}

function stubFetch() {
  vi.stubGlobal('fetch', vi.fn(async (url: any) => {
    const u = String(url)
    if (u.includes('/static/catalog.json')) return { ok: true, json: async () => JSON.parse(catalogText) }
    if (u.includes('/static/teammate-buffs.json')) return { ok: true, json: async () => JSON.parse(buffsText) }
    if (u.includes('/static/build-recommendations.json')) return { ok: true, json: async () => JSON.parse(recsText) }
    return { ok: false, json: async () => ({}) }
  }))
}

describe('露西纯函数', () => {
  it('邻位回能：3人 下一位30 前一位10', () => {
    const m = assignLucyUltNeighborEnergy([0, 1, 2], 1)
    expect(m[2]).toBe(30)
    expect(m[0]).toBe(10)
    expect(m[1]).toBeUndefined()
  })
  it('邻位回能：2人 另一人30', () => {
    const m = assignLucyUltNeighborEnergy([0, 1], 0)
    expect(m[1]).toBe(30)
  })
  it('加油：0命仅强特；2命+连携终结；6命 C6=队友强特', () => {
    const c0 = computeLucyCheer({ cinemaLevel: 0, exSpecialCount: 3, chainCountTotal: 2, ultimateCount: 1, teammateExSpecialTotal: 5 })
    expect(c0.cheerTriggers).toBe(3)
    expect(c0.totalSpins).toBe(3)
    expect(c0.c6Bombs).toBe(0)
    const c2 = computeLucyCheer({ cinemaLevel: 2, exSpecialCount: 3, chainCountTotal: 2, ultimateCount: 1, teammateExSpecialTotal: 5 })
    expect(c2.cheerTriggers).toBe(3 + 2 + 1)
    expect(c2.totalSpins).toBe(6)
    const c6 = computeLucyCheer({ cinemaLevel: 6, exSpecialCount: 2, chainCountTotal: 0, ultimateCount: 0, teammateExSpecialTotal: 4 })
    expect(c6.c6Bombs).toBe(4)
    expect(c6.totalSpins).toBe(2 + 4)
    expect(c6.c1EnergyPerMember).toBe((2 + 4) * 2)
  })
})

describe('露西·抄家伙', () => {
  it('调用次数 = floor(前台时间 / cd)', () => {
    expect(computeLucyBoarCount(60, 4)).toBe(15)
    expect(computeLucyBoarCount(60, 6)).toBe(10)
    expect(computeLucyBoarCount(59, 4)).toBe(14)
    expect(computeLucyBoarCount(0, 4)).toBe(0)
  })
  it('冷却读取：缺省 4，钳制 4–6', () => {
    expect(lucyBoarCd({} as any)).toBe(LUCY_BOAR_CD_DEFAULT)
    expect(lucyBoarCd({ 'setting:lucy.boarCd': 5 } as any)).toBe(5)
    expect(lucyBoarCd({ 'setting:lucy.boarCd': 9 } as any)).toBe(6)
    expect(lucyBoarCd({ 'setting:lucy.boarCd': 1 } as any)).toBe(4)
  })
  it('模块声明抄家伙冷却设置：默认4，范围4–6', () => {
    const st = lucyMechanic.settings!.find(x => x.id === 'lucy.boarCd')!
    expect(st.default).toBe(4)
    expect(st.min).toBe(4)
    expect(st.max).toBe(6)
  })
  it('buildCharConfig：三段倍率之和 792.1', () => {
    const cfg: any = {}
    const skills: any = {
      categories: [{
        moves: [
          { id: '1151023', rows: [{ id: 'damage', values: [186] }] },
          { id: '1151024', rows: [{ id: 'damage', values: [255.1] }] },
          { id: '1151025', rows: [{ id: 'damage', values: [351] }] },
        ],
      }],
    }
    lucyMechanic.buildCharConfig!({ slot: 0, agent: {} as any, skills, cinemaLevel: 0, wEngineId: '', wEngineModLevel: 5, team: [], cfg } as any)
    expect(cfg.lucyBoarComboDmg).toBeCloseTo(186 + 255.1 + 351, 5)
  })
  it('buildExecutions：按冷却生成抄家伙执行，三段合计且不占前台时间', () => {
    const cfg: any = {
      lucyCinemaLevel: 0,
      lucySpinDmg: 500.8,
      lucyBoarComboDmg: 792.1,
      'setting:lucy.boarCd': 5,
    }
    const executions: any[] = []
    lucyMechanic.buildExecutions!({
      cfg,
      state: { exSpecialCount: 1, chainCountTotal: 0, ultimateCount: 0, frontlineTime: 60 },
      executions,
    } as any)
    const boar = executions.find(e => e.moveId === '1151023')
    expect(boar.count).toBe(12)
    expect(boar.damageMultiplier).toBeCloseTo(792.1, 5)
    expect(boar.actionTime).toBe(0)
  })
})

describe('露西面板/执行', () => {
  beforeEach(() => { setActivePinia(createPinia()); stubFetch() })

  it('加油 formula 合并 + 影画4 暴伤门控', async () => {
    const catalog = useCatalogStore()
    await catalog.load()
    await catalog.loadTeammateBuffs()
    const cheer = catalog.getTeammateBuffGroup('1151')?.buffs.find((b: any) => b.id === 'lucy.ex_special_cheer_on') as any
    expect(cheer?.effects?.[0]?.type).toBe('formula')
    const config = useConfigStore()
    config.team[0] = { slot: 0, agentId: '1041', cinemaLevel: 0, ...baseConfig } as any
    config.team[1] = { slot: 1, agentId: '1151', cinemaLevel: 3, ...baseConfig } as any
    config.team[2] = { slot: 2, agentId: '', cinemaLevel: 0, ...baseConfig } as any
    config.syncTeammateBuffsFromTeam()
    const { computePanelPhases } = await import('@/composables/resourceCalc/helpers')
    const p3 = computePanelPhases(0, config, catalog)!.inCombat as any
    config.team[1].cinemaLevel = 4
    config.syncTeammateBuffsFromTeam()
    const p4 = computePanelPhases(0, config, catalog)!.inCombat as any
    expect(p4.critDmg - p3.critDmg).toBe(10)
  })

  it('buildExecutions：加油3 + C6炸4 → 回旋7 + 炸4', () => {
    const cfg: any = {
      lucyCinemaLevel: 6,
      lucyTeammateExTotal: 4,
      lucySpinDmg: 500.8,
    }
    const executions: any[] = []
    lucyMechanic.buildExecutions!({
      cfg,
      state: { exSpecialCount: 3, chainCountTotal: 0, ultimateCount: 0 },
      executions,
    } as any)
    const spin = executions.find(e => e.moveId === '1151026')
    const bomb = executions.find(e => e.moveId === '1151_c6_pig_bomb')
    expect(spin.count).toBe(7)
    expect(spin.damageMultiplier).toBe(500.8)
    expect(bomb.count).toBe(4)
    expect(bomb.damageMultiplier).toBe(300)
  })
})
