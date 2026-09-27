/**
 * CC-130：席德「[正兵]获得[明攻]（攻击 +1000 / 暴伤 +30%）；席德与[正兵]获得[围杀]（增伤 +25%，影画2 无视防御 20%）」。
 * teammate-buffs 1461 组静态数据按全队生效 ⇒ 由模块能力 teammateBuffRecipientFilter 按接收槽剔除。
 * 期望：正兵 = 全部；席德本人 = 只有围杀；非正兵队友 = 无。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { computePanelPhases } from '@/composables/resourceCalc/helpers'
import { pickXideVanguardSlot } from '@/mechanics/agents/xide'

const BUFFS = ['seed.core_vanguard_bright_attack', 'seed.cinema_2_encirclement_def_ignore']

async function deltas(ids: string[]) {
  const { catalog, config } = await setupHarness(ids.map(agentId => ({ agentId, cinemaLevel: 2 })) as never, { recommendedBuild: true })
  const sel = (config as any).teammateBuffSelections
  const snap = () => ids.map((_, i) => {
    const p = computePanelPhases(i, config, catalog)!
    return { ooc: p.outOfCombat.atk, atk: p.inCombat.atk, cd: p.inCombat.critDmg, dmg: p.inCombat.dmgBonus, def: (p.inCombat as any).enemyDefReduction ?? 0 }
  })
  for (const id of BUFFS) sel[id] = { enabled: false, coverage: 100 }
  const off = snap()
  for (const id of BUFFS) sel[id] = { enabled: true, coverage: 100 }
  const on = snap()
  return on.map((o, i) => ({
    ooc: o.ooc, oocOff: off[i].ooc,
    atk: +(o.atk - off[i].atk).toFixed(6), cd: +(o.cd - off[i].cd).toFixed(6),
    dmg: +(o.dmg - off[i].dmg).toFixed(6), def: +(o.def - off[i].def).toFixed(6),
  }))
}

const ALL = { atk: 1000, cd: 30, dmg: 25, def: 20 }
const ENC = { atk: 0, cd: 0, dmg: 25, def: 20 }
const NONE = { atk: 0, cd: 0, dmg: 0, def: 0 }
const pick = (d: any) => ({ atk: d.atk, cd: d.cd, dmg: d.dmg, def: d.def })

describe('CC-130 席德明攻 / 围杀只给正兵（与席德本人）', () => {
  it('两名强攻队友：局外攻击高者为正兵吃全部，另一名什么都不吃，席德只吃围杀', async () => {
    const d = await deltas(['1461', '1081', '1191'])
    // 局内过滤不影响局外面板
    for (const x of d) expect(x.ooc).toBe(x.oocOff)
    const vanguard = d[1].ooc >= d[2].ooc ? 1 : 2
    const other = vanguard === 1 ? 2 : 1
    expect(pick(d[0])).toEqual(ENC)
    expect(pick(d[vanguard])).toEqual(ALL)
    expect(pick(d[other])).toEqual(NONE)
  })

  it('一名强攻 + 一名非强攻（奥菲丝队 1461/1301/1311）：非强攻的耀嘉音什么都不吃', async () => {
    const d = await deltas(['1461', '1301', '1311'])
    expect(pick(d[0])).toEqual(ENC)
    // 奥菲丝自身机制会按攻击再放大（实测 +1200），故攻击只断言 ≥ 1000；其余精确
    expect(d[1].atk).toBeGreaterThanOrEqual(1000)
    expect({ ...pick(d[1]), atk: 1000 }).toEqual(ALL)
    expect(pick(d[2])).toEqual(NONE)
  })

  it('pickXideVanguardSlot：按局外攻击选、并列取靠前槽、单候选不读攻击、无候选 -1', () => {
    const m = (slot: number, agentId: string, specialty: string, atkBase = 900) => ({ slot, agentId, agent: { specialty, level60: { atkBase } } }) as any
    const team = [m(0, '1461', 'attack'), m(1, 'A', 'attack', 999), m(2, 'B', 'attack', 1)]
    expect(pickXideVanguardSlot(team, s => (s === 2 ? 3000 : 2000))).toBe(2)
    expect(pickXideVanguardSlot(team, () => 2500)).toBe(1)
    let reads = 0
    expect(pickXideVanguardSlot([m(0, '1461', 'attack'), m(2, 'B', 'attack')], () => { reads++; return 1 })).toBe(2)
    expect(reads).toBe(0)
    expect(pickXideVanguardSlot([m(0, '1461', 'attack'), m(1, 'S', 'stun')], () => 1)).toBe(-1)
  })
})
