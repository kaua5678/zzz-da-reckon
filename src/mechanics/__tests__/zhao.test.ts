import { describe, expect, it } from 'vitest'
import { computePanelPhases } from '@/composables/resourceCalc/helpers'
import { setupHarness } from '@/test/harness'
import {
  ZHAO_C4_CRIT_DMG,
  ZHAO_C4_DECIBEL,
  ZHAO_C4_MOVE_IDS,
  ZHAO_CHARGE_LIFE_RATIO,
  ZHAO_CHARGE_MAX_SECONDS,
  ZHAO_C6_CHARGE_MULTIPLIER,
  ZHAO_VERDICT_MOVE_ID,
  zhaoMechanic,
} from '@/mechanics/agents/zhao'

async function setup(mateId = '1081', cinemaLevel = 0) {
  const result = await setupHarness([
    { agentId: '1341', cinemaLevel, parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
    { agentId: mateId, cinemaLevel: 0, parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
    '',
  ])
  for (const buff of result.config.globalBuffs) buff.enabled = false
  return result
}

/** 照的增伤公式：clamp(floor((初始最大生命值-15000)/400)+10, 10, 40) */
function zhaoDmgBonusExpected(hp: number): number {
  return Math.min(40, Math.max(10, Math.floor((hp - 15000) / 400) + 10))
}

describe('照（1341）额外能力·凝聚力门控', () => {
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
  it('以太帷幕·涌泉：全队生命+5%、攻击+1000（Lv.12）', async () => {
    const { catalog, config } = await setup('1081', 0)
    const phases = computePanelPhases(0, config, catalog)!
    const out = phases.outOfCombat as any
    const inC = phases.inCombat as any

    expect(inC.hp - out.hp).toBeCloseTo(out.hp * 0.05, 0)
    expect(inC.atk - out.atk).toBeCloseTo(1000, 0)
  })
})

describe('照自身核心与影画机制', () => {
  it('核心按局外生命转暴击，影画6只将该转化提升至125%', async () => {
    const c0 = await setup('1081', 0)
    const p0 = computePanelPhases(0, c0.config, c0.catalog)!
    const outHp = (p0.outOfCombat as any).hp as number
    const coreAtC0 = (p0.inCombat as any).zhaoCoreCritRate as number
    expect(coreAtC0).toBeCloseTo(outHp / 1000 * 1.4, 5)

    const c6 = await setup('1081', 6)
    const p6 = computePanelPhases(0, c6.config, c6.catalog)!
    const coreAtC6 = (p6.inCombat as any).zhaoCoreCritRate as number
    expect(coreAtC6 - coreAtC0).toBeCloseTo(outHp / 1000 * 1.4 * 0.25, 5)
  })

  it('影画2自身攻击按局外攻击的20%增加，不放大局内固定攻击', async () => {
    const c0 = await setup('1081', 0)
    const p0 = computePanelPhases(0, c0.config, c0.catalog)!
    const c2 = await setup('1081', 2)
    const p2 = computePanelPhases(0, c2.config, c2.catalog)!
    expect((p2.inCombat as any).atk - (p0.inCombat as any).atk)
      .toBeCloseTo((p2.outOfCombat as any).atk * 0.2, 5)
  })

  it('影画4开帷幕一次性获得250喧响', () => {
    const cfg3 = { initialDecibelGift: 1000 } as any
    zhaoMechanic.buildCharConfig!({ cinemaLevel: 3, cfg: cfg3 } as any)
    expect(cfg3.initialDecibelGift).toBe(1000)

    const cfg4 = { initialDecibelGift: 1000 } as any
    zhaoMechanic.buildCharConfig!({ cinemaLevel: 4, cfg: cfg4 } as any)
    expect(cfg4.initialDecibelGift).toBe(1000 + ZHAO_C4_DECIBEL)
  })

  it('影画4只为最终裁决、连携和终结技增加40%暴伤', () => {
    const target = [...ZHAO_C4_MOVE_IDS].map(moveId => ({ moveId, critDmgBonus: 0 }))
    const other = [{ moveId: '1341001', critDmgBonus: 0 }, { moveId: '1341010', critDmgBonus: 0 }]
    zhaoMechanic.patchExecutions!({
      cfg: { zhaoCinemaLevel: 4 },
      executions: [...target, ...other],
      state: {},
    } as any)
    for (const exec of target) expect(exec.critDmgBonus).toBe(ZHAO_C4_CRIT_DMG)
    for (const exec of other) expect(exec.critDmgBonus).toBe(0)
  })
})

describe('照霜寒值循环与最终裁决蓄力生命附伤', () => {
  it('霜寒值满开帷幕，后台生成最终裁决蓄力附伤（flatDamageBonus）', () => {
    const mk = (cinemaLevel: number) => {
      const executions: any[] = []
      zhaoMechanic.buildExecutions!({
        cfg: { zhaoCinemaLevel: cinemaLevel, panel: { hp: 30000 } },
        state: { exSpecialCount: 2, ultimateCount: 1 },
        teamFrontlineSeconds: 90,
        executions,
      } as any)
      return executions
    }
    // 霜寒值 = 100 + 2×20 + 1×20 + 30×6 = 340 → 开帷幕 3 次
    const c0 = mk(0)
    expect(c0.length).toBe(1)
    expect(c0[0].moveId).toBe(ZHAO_VERDICT_MOVE_ID)
    expect(c0[0].count).toBe(3)
    expect(c0[0].timeBucket).toBe('backstage')
    expect(c0[0].flatDamageBonus).toBeCloseTo(30000 * ZHAO_CHARGE_MAX_SECONDS * ZHAO_CHARGE_LIFE_RATIO, 5)

    // 影画6：×1.4
    const c6 = mk(6)
    expect(c6[0].flatDamageBonus).toBeCloseTo(
      30000 * ZHAO_CHARGE_MAX_SECONDS * ZHAO_CHARGE_LIFE_RATIO * ZHAO_C6_CHARGE_MULTIPLIER, 5)
  })

  it('影画4暴伤仍作用于最终裁决行（蓄力附伤行）', () => {
    const executions: any[] = [{ moveId: ZHAO_VERDICT_MOVE_ID, critDmgBonus: 0 }]
    zhaoMechanic.buildExecutions!({
      cfg: { zhaoCinemaLevel: 4, panel: { hp: 30000 } },
      state: { exSpecialCount: 1, ultimateCount: 0 },
      teamFrontlineSeconds: 0,
      executions,
    } as any)
    zhaoMechanic.patchExecutions!({
      cfg: { zhaoCinemaLevel: 4 },
      state: {},
      executions,
    } as any)
    const verdict = executions.find(e => e.moveId === ZHAO_VERDICT_MOVE_ID)!
    expect(verdict.critDmgBonus).toBe(ZHAO_C4_CRIT_DMG)
  })
})

describe('照影画拐力（teammate-buffs 按命座门控）', () => {
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

  it('影画2 原文「队伍中其他角色」：照自身只获得自身20%，不叠加队友15%', async () => {
    const { catalog, config } = await setup('1081', 2)
    const phases2 = computePanelPhases(0, config, catalog)!
    const atkWithC2 = (phases2.inCombat as any).atk as number
    const atkBase = (phases2.outOfCombat as any).atk as number

    config.team[0].cinemaLevel = 0
    config.syncTeammateBuffsFromTeam()
    const atkAtC0 = (computePanelPhases(0, config, catalog)!.inCombat as any).atk as number
    expect(atkWithC2 - atkAtC0).toBeCloseTo(atkBase * 0.2, 5)
  })
})
