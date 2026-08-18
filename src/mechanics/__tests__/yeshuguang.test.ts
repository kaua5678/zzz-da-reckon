import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useCatalogStore } from '@/stores/catalog'
import { useConfigStore } from '@/stores/config'
import {
  computeOutsideSwordGain,
  computeYeshuguangCycle,
  yeshuguangMechanic,
  YESHUGUANG_FULL_STUN_MOVES,
} from '@/mechanics/agents/yeshuguang'

const catalogText = readFileSync(new URL('../../../public/static/catalog.json', import.meta.url), 'utf8')
const buffsText = readFileSync(new URL('../../../public/static/teammate-buffs.json', import.meta.url), 'utf8')
const recsText = readFileSync(new URL('../../../public/static/build-recommendations.json', import.meta.url), 'utf8')

const baseConfig = {
  wEngineId: '', wEngineModLevel: 5,
  driveDisc: { fourPieceSetId: '', twoPieceSetId: '', mainStats: { 4: 'atkPct' as any, 5: 'physicalDmg' as any, 6: 'critRate' as any }, subStatAllocation: {} },
  parryCount: 10, dodgeCounterCount: 6, defAssistCount: 20,
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

async function setup(team: Array<{ agentId: string; cinemaLevel: number }>) {
  const catalog = useCatalogStore()
  await catalog.load()
  await catalog.loadTeammateBuffs()
  const config = useConfigStore()
  for (let i = 0; i < 3; i++) {
    const t = team[i]
    config.team[i] = { slot: i, agentId: t?.agentId ?? '', cinemaLevel: t?.cinemaLevel ?? 0, ...baseConfig } as any
  }
  config.syncTeammateBuffsFromTeam()
  return { catalog, config }
}

describe('叶瞬光 computeYeshuguangCycle', () => {
  it('0命：观止2，飞光缩放 2/6；喧响进→斩妄，照影进→归尘', () => {
    const c = computeYeshuguangCycle({
      ultimateCount: 2,
      giftUltCount: 1,
      zhaoyingCountSetting: -1,
      outsideSwordGain: 12, // 2 照影
      cinemaLevel: 0,
      battleTime: 180,
    })
    expect(c.decibelForms).toBe(2)
    expect(c.giftForms).toBe(1)
    expect(c.zhaoyingForms).toBe(2)
    expect(c.totalForms).toBe(5)
    expect(c.guanzhiPerForm).toBe(2)
    expect(c.feiguangScale).toBeCloseTo(2 / 6)
    expect(c.finisherZhanwang).toBe(2)
    expect(c.finisherGuichen).toBe(3)
  })

  it('2命打满：观止 2+6=8，飞光缩放 8/6', () => {
    const c = computeYeshuguangCycle({
      ultimateCount: 1,
      giftUltCount: 0,
      zhaoyingCountSetting: 0,
      outsideSwordGain: 0,
      cinemaLevel: 2,
      battleTime: 180,
    })
    expect(c.guanzhiPerForm).toBe(8)
    expect(c.feiguangScale).toBeCloseTo(8 / 6)
    expect(c.finisherZhanwang).toBe(1)
    expect(c.finisherGuichen).toBe(0)
  })
})

describe('叶瞬光面板合道/影画', () => {
  beforeEach(() => { setActivePinia(createPinia()); stubFetch() })

  it('0→1：伤害+10、减防+20', async () => {
    const { catalog, config } = await setup([{ agentId: '1431', cinemaLevel: 0 }])
    const { computePanelPhases } = await import('@/composables/resourceCalc/helpers')
    const p0 = computePanelPhases(0, config, catalog)!.inCombat as any
    config.team[0].cinemaLevel = 1
    const p1 = computePanelPhases(0, config, catalog)!.inCombat as any
    expect(p1.dmgBonus - p0.dmgBonus).toBe(10)
    expect((p1.enemyDefReduction ?? 0) - (p0.enemyDefReduction ?? 0)).toBe(20)
  })

  it('帷幕易伤上限：0命 2.1，4命 3.0', async () => {
    const { catalog, config } = await setup([{ agentId: '1431', cinemaLevel: 0 }])
    const { computePanelPhases } = await import('@/composables/resourceCalc/helpers')
    const p0 = computePanelPhases(0, config, catalog)!.inCombat as any
    expect(p0.yeshuguangStunCapMult).toBe(2.1)
    config.team[0].cinemaLevel = 4
    const p4 = computePanelPhases(0, config, catalog)!.inCombat as any
    expect(p4.yeshuguangStunCapMult).toBe(3.0)
  })

  it('影画1 剑势初始6；影画4 喧响1000', () => {
    const cfg: any = { battleTime: 180 }
    yeshuguangMechanic.buildCharConfig!({
      cfg, panel: { additionalAbilityActive: 1 }, cinemaLevel: 4, skills: { categories: [] }, team: [],
    } as any)
    expect(cfg.yeshuguangSwordInitial).toBe(6)
    expect(cfg.initialDecibelGift).toBe(1000)
    expect(cfg.ultimateMoveId).toBe('1431025')
  })
})

describe('叶瞬光 buildExecutions 打满循环', () => {
  it('1 次喧响进：灭×2 极×2 扶摇×1 飞光×1 斩妄×1', () => {
    const cfg: any = {
      yeshuguangCinemaLevel: 0,
      yeshuguangSwordInitial: 0,
      yeshuguangGiftUltCount: 0,
      yeshuguangMoveDmg: {
        '1431013': 1783, '1431009': 1209, '1431017': 182,
        '1431018': 2116, '1431019': 2322, '1431027': 6168,
        '1431025': 3850, '1431028': 800,
      },
      yeshuguangMoveTimes: {
        '1431013': 1.5, '1431009': 1.4, '1431017': 0.325,
        '1431018': 1.967, '1431019': 2.533, '1431027': 0.001,
        '1431025': 1, '1431028': 2.2,
      },
      yeshuguangAtk0PerSec: 0,
      battleTime: 180,
      dodgeCounterCount: 0,
    }
    const executions: any[] = []
    yeshuguangMechanic.buildExecutions!({
      cfg,
      state: { ultimateCount: 1, exSpecialCount: 0, basicAttackTime: 0, backstageTime: 0, chainCountTotal: 0 },
      executions,
    } as any)
    const cnt = (id: string) => executions.find(e => e.moveId === id)?.count ?? 0
    expect(cnt('1431013')).toBe(2)
    expect(cnt('1431009')).toBe(2)
    expect(cnt('1431017')).toBe(1)
    expect(cnt('1431018')).toBe(1)
    expect(executions.find(e => e.moveId === '1431018').damageMultiplier).toBeCloseTo(2116 * (2 / 6))
    expect(cnt('1431027')).toBe(1)
    expect(cnt('1431019')).toBe(0)
  })

  it('满易伤 move 集合含关键白毛招', () => {
    expect(YESHUGUANG_FULL_STUN_MOVES.has('1431013')).toBe(true)
    expect(YESHUGUANG_FULL_STUN_MOVES.has('1431018')).toBe(true)
    expect(YESHUGUANG_FULL_STUN_MOVES.has('1431027')).toBe(true)
  })
})

describe('局外剑势', () => {
  it('帷幕×3 需额外能力激活', () => {
    const cfg: any = {
      yeshuguangSwordInitial: 6,
      yeshuguangAtk0PerSec: 0,
      yeshuguangTeamCurtainCount: 2,
      yeshuguangAdditionalAbilityActive: 1,
      dodgeCounterCount: 0,
    }
    expect(computeOutsideSwordGain(cfg, { basicAttackTime: 0, exSpecialCount: 0, chainCountTotal: 0 })).toBe(6 + 6)
  })
})
