import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useCatalogStore } from '@/stores/catalog'
import { useConfigStore } from '@/stores/config'
import {
  computeOutsideSwordGain,
  computeYeshuguangCycle,
  shortAxisFeiguangCount,
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

const baseDmg = {
  '1431013': 1783, '1431009': 1209, '1431017': 182,
  '1431018': 2116, '1431019': 2322, '1431027': 6168,
  '1431025': 3850, '1431028': 800,
}
const baseTimes = {
  '1431013': 1.5, '1431009': 1.4, '1431017': 0.325,
  '1431018': 1.967, '1431019': 2.533, '1431027': 0.001,
  '1431025': 1, '1431028': 2.2,
}

describe('叶瞬光 computeYeshuguangCycle', () => {
  it('打满 0命：观止2，飞光×2 缩放2/6；喧响→斩妄', () => {
    const c = computeYeshuguangCycle({
      ultimateCount: 2, giftUltCount: 1, zhaoyingCountSetting: -1,
      outsideSwordGain: 12, cinemaLevel: 0, battleTime: 180, formAxis: 'full',
    })
    expect(c.totalForms).toBe(5)
    expect(c.guanzhiPerForm).toBe(2)
    expect(c.feiguangPerForm).toBe(2)
    expect(c.feiguangScaleEach).toBeCloseTo(2 / 6)
    expect(c.miePerForm).toBe(2)
    expect(c.jiPerForm).toBe(2)
    expect(c.finisherZhanwang).toBe(2)
    expect(c.finisherGuichen).toBe(3)
  })

  it('打满 2命：观止8，飞光缩放8/6', () => {
    const c = computeYeshuguangCycle({
      ultimateCount: 1, giftUltCount: 0, zhaoyingCountSetting: 0,
      outsideSwordGain: 0, cinemaLevel: 2, battleTime: 180, formAxis: 'full',
    })
    expect(c.guanzhiPerForm).toBe(8)
    expect(c.feiguangScaleEach).toBeCloseTo(8 / 6)
  })

  it('短轴灭极：0命 4 飞光；2命 10 飞光；耗剑势3', () => {
    expect(shortAxisFeiguangCount('short_pair', 0)).toBe(4)
    expect(shortAxisFeiguangCount('short_pair', 2)).toBe(10)
    const c0 = computeYeshuguangCycle({
      ultimateCount: 1, giftUltCount: 0, zhaoyingCountSetting: 0,
      outsideSwordGain: 0, cinemaLevel: 0, battleTime: 180, formAxis: 'short_pair',
    })
    expect(c0.miePerForm).toBe(1)
    expect(c0.jiPerForm).toBe(1)
    expect(c0.fuyaoPerForm).toBe(0)
    expect(c0.swordSpentPerForm).toBe(3)
    expect(c0.feiguangPerForm).toBe(4)
    expect(c0.guanzhiPerForm).toBe(2)
    const c2 = computeYeshuguangCycle({
      ultimateCount: 1, giftUltCount: 0, zhaoyingCountSetting: 0,
      outsideSwordGain: 0, cinemaLevel: 2, battleTime: 180, formAxis: 'short_pair',
    })
    expect(c2.feiguangPerForm).toBe(10)
    expect(c2.guanzhiPerForm).toBe(2 + 3)
  })

  it('短轴仅灭：0命 5 飞光；2命 12 飞光；耗剑势2', () => {
    expect(shortAxisFeiguangCount('short_mie', 1)).toBe(5)
    expect(shortAxisFeiguangCount('short_mie', 6)).toBe(12)
    const c = computeYeshuguangCycle({
      ultimateCount: 1, giftUltCount: 0, zhaoyingCountSetting: 0,
      outsideSwordGain: 0, cinemaLevel: 0, battleTime: 180, formAxis: 'short_mie',
    })
    expect(c.miePerForm).toBe(1)
    expect(c.jiPerForm).toBe(0)
    expect(c.swordSpentPerForm).toBe(2)
    expect(c.feiguangPerForm).toBe(5)
  })

  it('C6 明灯愿：进场2+每轮1，floor/3 归尘改斩妄；附伤=轮次', () => {
    // 3 轮：明灯愿 2+3=5 → upgrade 1；假设 2 归尘+1 斩妄 基础 → 归尘1 斩妄2
    const c = computeYeshuguangCycle({
      ultimateCount: 1, giftUltCount: 1, zhaoyingCountSetting: 0,
      outsideSwordGain: 0, cinemaLevel: 6, battleTime: 180, formAxis: 'full',
    })
    // gift 1 forms? ultimate 1 + gift 1 = 2 forms. mingdeng=2+2=4, upgrade=1
    expect(c.totalForms).toBe(2)
    expect(c.mingdengTotal).toBe(4)
    expect(c.mingdengUpgrade).toBe(1)
    // base zhanwang=1 guichen=1 → after upgrade zhanwang=2 guichen=0
    expect(c.finisherZhanwang).toBe(2)
    expect(c.finisherGuichen).toBe(0)
    expect(c.c6AttachCount).toBe(2)
  })
})

describe('叶瞬光面板', () => {
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

  it('帷幕易伤上限 0命2.1 / 4命3.0', async () => {
    const { catalog, config } = await setup([{ agentId: '1431', cinemaLevel: 0 }])
    const { computePanelPhases } = await import('@/composables/resourceCalc/helpers')
    expect(computePanelPhases(0, config, catalog)!.inCombat.yeshuguangStunCapMult).toBe(2.1)
    config.team[0].cinemaLevel = 4
    expect(computePanelPhases(0, config, catalog)!.inCombat.yeshuguangStunCapMult).toBe(3.0)
  })
})

describe('叶瞬光 buildExecutions', () => {
  it('打满 1 喧响：灭2 极2 扶摇1 飞光2 斩妄1', () => {
    const cfg: any = {
      yeshuguangCinemaLevel: 0, yeshuguangSwordInitial: 0, yeshuguangGiftUltCount: 0,
      yeshuguangMoveDmg: baseDmg, yeshuguangMoveTimes: baseTimes,
      yeshuguangAtk0PerSec: 0, battleTime: 180, dodgeCounterCount: 0,
      'setting:yeshuguang.formAxis': 0,
    }
    const executions: any[] = []
    yeshuguangMechanic.buildExecutions!({
      cfg, state: { ultimateCount: 1, exSpecialCount: 0, basicAttackTime: 0, chainCountTotal: 0 }, executions,
    } as any)
    const cnt = (id: string) => executions.find(e => e.moveId === id)?.count ?? 0
    expect(cnt('1431013')).toBe(2)
    expect(cnt('1431009')).toBe(2)
    expect(cnt('1431017')).toBe(1)
    expect(cnt('1431018')).toBe(2)
    expect(executions.find(e => e.moveId === '1431018').damageMultiplier).toBeCloseTo(2116 * (2 / 6))
    expect(cnt('1431027')).toBe(1)
  })

  it('影画2：飞光/斩妄 moveId 限定 defIgnore +40，其它招不加', () => {
    const cfg: any = {
      yeshuguangCinemaLevel: 2, yeshuguangSwordInitial: 0, yeshuguangGiftUltCount: 0,
      yeshuguangMoveDmg: baseDmg, yeshuguangMoveTimes: baseTimes,
      yeshuguangAtk0PerSec: 0, battleTime: 180, dodgeCounterCount: 0,
      'setting:yeshuguang.formAxis': 0,
    }
    const executions: any[] = [
      { moveId: '1431018', count: 1 },
      { moveId: '1431027', count: 1 },
      { moveId: '1431013', count: 1 },
    ]
    yeshuguangMechanic.patchExecutions!({ cfg, state: {}, executions } as any)
    expect(executions.find(e => e.moveId === '1431018').defIgnore).toBe(40)
    expect(executions.find(e => e.moveId === '1431027').defIgnore).toBe(40)
    expect(executions.find(e => e.moveId === '1431013').defIgnore ?? 0).toBe(0)
  })

  it('短轴灭极 0命：灭1 极1 飞光4', () => {
    const cfg: any = {
      yeshuguangCinemaLevel: 0, yeshuguangSwordInitial: 0, yeshuguangGiftUltCount: 0,
      yeshuguangMoveDmg: baseDmg, yeshuguangMoveTimes: baseTimes,
      yeshuguangAtk0PerSec: 0, battleTime: 180, dodgeCounterCount: 0,
      'setting:yeshuguang.formAxis': 1,
    }
    const executions: any[] = []
    yeshuguangMechanic.buildExecutions!({
      cfg, state: { ultimateCount: 1, exSpecialCount: 0, basicAttackTime: 0, chainCountTotal: 0 }, executions,
    } as any)
    const cnt = (id: string) => executions.find(e => e.moveId === id)?.count ?? 0
    expect(cnt('1431013')).toBe(1)
    expect(cnt('1431009')).toBe(1)
    expect(cnt('1431017')).toBe(0)
    expect(cnt('1431018')).toBe(4)
  })

  it('C6：附伤次数=轮次，满易伤集合含附伤 id', () => {
    const cfg: any = {
      yeshuguangCinemaLevel: 6, yeshuguangSwordInitial: 0, yeshuguangGiftUltCount: 0,
      yeshuguangMoveDmg: baseDmg, yeshuguangMoveTimes: baseTimes,
      yeshuguangAtk0PerSec: 0, battleTime: 180, dodgeCounterCount: 0,
      'setting:yeshuguang.formAxis': 0,
    }
    const executions: any[] = []
    yeshuguangMechanic.buildExecutions!({
      cfg, state: { ultimateCount: 2, exSpecialCount: 0, basicAttackTime: 0, chainCountTotal: 0 }, executions,
    } as any)
    const attach = executions.find(e => e.moveId === '1431_c6_finisher_attach')
    expect(attach.count).toBe(2)
    expect(attach.damageMultiplier).toBe(1500)
    expect(YESHUGUANG_FULL_STUN_MOVES.has('1431_c6_finisher_attach')).toBe(true)
  })
})

describe('局外剑势', () => {
  it('帷幕×3 需额外能力', () => {
    const cfg: any = {
      yeshuguangSwordInitial: 6, yeshuguangAtk0PerSec: 0,
      yeshuguangTeamCurtainCount: 2, yeshuguangAdditionalAbilityActive: 1, dodgeCounterCount: 0,
    }
    expect(computeOutsideSwordGain(cfg, { basicAttackTime: 0, exSpecialCount: 0, chainCountTotal: 0 })).toBe(12)
  })
})
