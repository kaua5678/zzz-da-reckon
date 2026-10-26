import { beforeEach, describe, expect, it } from 'vitest'
import { mockStaticFetch, newPinia, resolveTeammateBuffsOnEmptyPanel, setupHarness } from '@/test/harness'
import { useCatalogStore } from '@/stores/catalog'
import { useConfigStore } from '@/stores/config'
import { computePanelPhases } from '@/composables/resourceCalc/panelPhases'
import {
  computeAriaBonuses,
  computeYaojiayinTremolos,
  MOVE_CLUSTER,
  MOVE_TREMOLO,
  yaojiayinMechanic,
  yaojiayinSkillLevel,
} from '@/mechanics/agents/yaojiayin'

const baseConfig = {
  wEngineId: '', wEngineModLevel: 1,
  driveDisc: { fourPieceSetId: '', twoPieceSetId: '', mainStats: {}, subStatAllocation: {} },
  parryCount: 0, dodgeCounterCount: 0, defAssistCount: 0, chainCountPerStun: 1, basicAttackTimeWeight: 1,
}

/** 强攻队友触发额外能力 */
async function setup(cinemaLevel = 0, mateId = '1041') {
  const catalog = useCatalogStore()
  await catalog.load()
  await catalog.loadTeammateBuffs()
  const config = useConfigStore()
  // 关掉默认危局全局增伤，避免污染咏叹差分断言
  for (const buff of config.globalBuffs) buff.enabled = false
  config.team[0] = { slot: 0, agentId: mateId, cinemaLevel: 0, ...baseConfig } as any
  config.team[1] = { slot: 1, agentId: '1311', cinemaLevel, ...baseConfig } as any
  config.team[2] = { slot: 2, agentId: '', cinemaLevel: 0, ...baseConfig } as any
  config.syncTeammateBuffsFromTeam()
  return { catalog, config }
}

describe('耀嘉音纯函数', () => {
  it('咏叹华彩技能等级与数值', () => {
    expect(yaojiayinSkillLevel(0)).toBe(12)
    expect(yaojiayinSkillLevel(3)).toBe(14)
    expect(yaojiayinSkillLevel(5)).toBe(16)
    expect(computeAriaBonuses(12)).toEqual({ dmgBonus: 20, critDmg: 25 })
    expect(computeAriaBonuses(14)).toEqual({ dmgBonus: 22, critDmg: 28 })
    expect(computeAriaBonuses(16)).toEqual({ dmgBonus: 24, critDmg: 31 })
  })

  it('核心攻击 35%/1200 与 C2 54%/1600（走生产通道：teammate-buffs 派生 + C2 差额公式，CC-188）', async () => {
    newPinia(); mockStaticFetch()
    const catalog = useCatalogStore()
    await catalog.load()
    await catalog.loadTeammateBuffs()
    const core = ['yaojiayin.core_andante_atk']
    const c2 = [...core, 'yaojiayin.cinema_2.core_andante_atk_bonus']
    expect(resolveTeammateBuffsOnEmptyPanel(core, 3000).atk).toBeCloseTo(1050, 9)
    expect(resolveTeammateBuffsOnEmptyPanel(core, 4000).atk).toBeCloseTo(1200, 9)
    expect(resolveTeammateBuffsOnEmptyPanel(c2, 3000).atk).toBeCloseTo(1600, 9)
    expect(resolveTeammateBuffsOnEmptyPanel(c2, 2000).atk).toBeCloseTo(1080, 9)
  })

  /**
   * **能量自动驱动（用户裁决 2026-10-22）**：
   * > 「这个耀嘉音的触发次数改成能量自动触发。他的能量自动扣完，他不是靠前台释放强特耗能的，
   * >   而是他有能量就会提供快支，队友用一次快支切人他就扣能量打出攻击。」
   *
   * 原文佐证：「每拥有25点能量，耀嘉音将拥有1点[和弦]」＋「队伍中其他角色通过[快速支援]/[连携技]/
   * [招架支援]/[回避支援]入场时，**耀嘉音将消耗25点能量**，并追加释放1道[震音]」。
   *
   * ⚠ 修前是 `min(⌊能量/25⌋, 队友快支次数)`——把「队友填了几次快支」当成她的天花板；
   * 而她的和弦自己就能造快速支援（操作中命中 3s/重击 1s），默认队（快支全 0）震音恒 0、能量全废。
   * 现口径：`付费震音 = ⌊能量/25⌋`，入场次数只是诊断读数。
   */
  it('震音：付费 = ⌊能量/25⌋（能量自动扣完，不受队友快支次数限制）；额外能力与C2追加', () => {
    const base = computeYaojiayinTremolos({
      totalEnergy: 200, entryCount: 10, combatTime: 180, cinemaLevel: 0, additionalActive: false,
    })
    expect(base.paidTremolos).toBe(8) // floor(200/25)
    expect(base.freeTremolos).toBe(0)
    expect(base.clusters).toBe(0)

    const aa = computeYaojiayinTremolos({
      totalEnergy: 200, entryCount: 10, combatTime: 180, cinemaLevel: 0, additionalActive: true,
    })
    expect(aa.paidTremolos).toBe(8)
    expect(aa.freeTremolos).toBe(8)
    expect(aa.clusters).toBe(24)
    expect(aa.totalTremolos).toBe(16)

    const c2 = computeYaojiayinTremolos({
      totalEnergy: 200, entryCount: 10, combatTime: 30, cinemaLevel: 2, additionalActive: false,
    })
    // C2 追加按**付费震音次数**（= 入场）与 3s CD：min(8, floor(30/3)=10) = 8
    expect(c2.c2Extra).toBe(8)
    expect(c2.freeTremolos).toBe(8)
    expect(c2.clusters).toBe(24)

    // ★ 反锁：entryCount（队友快支次数）**不再是上限**——填 0 也是 8 次付费震音
    const noEntries = computeYaojiayinTremolos({
      totalEnergy: 200, entryCount: 0, combatTime: 180, cinemaLevel: 0, additionalActive: false,
    })
    expect(noEntries.paidTremolos, '能量自动扣完 ⇒ 队友快支 0 次也有 8 次震音').toBe(8)
    const fewEntries = computeYaojiayinTremolos({
      totalEnergy: 200, entryCount: 3, combatTime: 180, cinemaLevel: 0, additionalActive: false,
    })
    expect(fewEntries.paidTremolos, '入场 3 次不再是天花板').toBe(8)
    expect(fewEntries.entries, '入场读数 = 付费震音次数（一次入场合一次扣能）').toBe(8)

    const c6 = computeYaojiayinTremolos({
      totalEnergy: 250, entryCount: 20, combatTime: 100, cinemaLevel: 6, additionalActive: true,
    })
    expect(c6.paidTremolos).toBe(10)
    expect(c6.c6Capriccio).toBe(Math.min(10, Math.floor(100 / 10)))
  })
})

describe('耀嘉音执行行', () => {
  it('buildExecutions 生成音簇/C6随想曲/C4附加（震音本体走通用强特行，不在本模块产行）', () => {
    const cfg: any = {
      invincibleTime: 0,
      yaojiayinCinemaLevel: 6,
      panel: { additionalAbilityActive: 1 },
      yaojiayinEntryCount: 12,
      yaojiayinTremoloDmg: 92.2,
      yaojiayinClusterDmg: 48.2,
      yaojiayinCapriccioDmg: 542.4,
      yaojiayinTeamHasAttack: 1,
    }
    const executions: any[] = []
    yaojiayinMechanic.buildExecutions!({
      cfg,
      state: {
        totalEnergy: 200,
        exSpecialCount: 8, // 通用强特通道给的付费震音次数（= floor(200/25)）
        chainCountTotal: 0,
        ultimateCount: 0,
        frontlineTime: 40,
        backstageTime: 140,
      },
      executions,
    } as any)
    // ★ 震音本体 = 通用强特行（buildCharConfig 设 exSpecialMoveId=1311008 + 25 能量/次），
    // 模块**不再自建**（防双计）——这条反锁住「别把通用通道的事手写回来」。
    expect(executions.find(e => e.moveId === MOVE_TREMOLO), '震音不得由模块自建').toBeUndefined()
    const cluster = executions.find(e => e.moveId === MOVE_CLUSTER)
    expect(cluster.count).toBeGreaterThan(0)
    expect(cluster.damageMultiplier).toBeCloseTo(48.2 * 2)
    const cap = executions.find(e => e.moveId === '1311004')
    expect(cap?.count).toBeGreaterThan(0)
    expect(cap?.critRateBonus).toBe(80)
    const c4 = executions.find(e => e.moveId === '1311c4_atk_bonus')
    expect(c4?.count).toBeGreaterThan(0)
    expect(c4?.damageMultiplier).toBe(300)
  })
})

describe('耀嘉音面板接线', () => {
  beforeEach(() => { newPinia(); mockStaticFetch() })

  it('核心攻击与咏叹华彩全队生效', async () => {
    const { catalog, config } = await setup(0, '1041')
    const mateOut = computePanelPhases(0, config, catalog)!.outOfCombat
    const mate = computePanelPhases(0, config, catalog)!.inCombat
    const yj = computePanelPhases(1, config, catalog)!.inCombat
    const yjOut = computePanelPhases(1, config, catalog)!.outOfCombat
    const expectedAtk = Math.min(1200, yjOut.atk * 0.35)
    expect(mate.atk).toBeGreaterThan(mateOut.atk + expectedAtk * 0.5)
    expect(yj.atk).toBeGreaterThan(yjOut.atk)
    // 咏叹 lv12 → 伤害+20、暴伤+25（相对局外）
    expect(mate.dmgBonus - (mateOut.dmgBonus ?? 0)).toBeCloseTo(20, 0)
    expect(mate.critDmg - mateOut.critDmg).toBeCloseTo(25, 0)
  })

  it('影画1 全抗-18；影画2 核心攻差分', async () => {
    const { catalog, config } = await setup(0, '1041')
    const c0 = computePanelPhases(0, config, catalog)!.inCombat
    config.team[1].cinemaLevel = 1
    config.syncTeammateBuffsFromTeam()
    const c1 = computePanelPhases(0, config, catalog)!.inCombat
    expect(c1.enemyResReduction - c0.enemyResReduction).toBeCloseTo(18)

    const atk0 = c0.atk
    config.team[1].cinemaLevel = 2
    config.syncTeammateBuffsFromTeam()
    const c2 = computePanelPhases(0, config, catalog)!.inCombat
    expect(c2.atk).toBeGreaterThan(atk0)
  })

  it('咏叹数值随 3/5 命技能等级提升', async () => {
    const { catalog, config } = await setup(0, '1041')
    const dmgOf = () => {
      const p = computePanelPhases(0, config, catalog)!
      return p.inCombat.dmgBonus - (p.outOfCombat.dmgBonus ?? 0)
    }
    const d0 = dmgOf()
    config.team[1].cinemaLevel = 3
    config.syncTeammateBuffsFromTeam()
    const d3 = dmgOf()
    config.team[1].cinemaLevel = 5
    config.syncTeammateBuffsFromTeam()
    const d5 = dmgOf()
    expect(d0).toBeCloseTo(20, 0)
    expect(d3).toBeCloseTo(22, 0)
    expect(d5).toBeCloseTo(24, 0)
  })

  it('影画4 异常队友获得积蓄效率', async () => {
    // 简 1261 异常
    const { catalog, config } = await setup(4, '1261')
    const mate = computePanelPhases(0, config, catalog)!.inCombat
    expect(mate.anomalyBuildUpEfficiency).toBeGreaterThan(0)
  })
})

describe('耀嘉音滑块生效差分（防守卫冻结，SOP §3.5）', () => {
  it('yaojiayin.ariaCoverage → 咏叹华彩全队增伤/暴伤差分（computePanelPhases 1311 分支）', async () => {
    const { catalog, config } = await setupHarness([{ agentId: '1311', cinemaLevel: 0 }, { agentId: '1141' }, ''])
    const read = () => {
      const p = computePanelPhases(1, config, catalog)!.inCombat as any
      return { dmg: p.dmgBonus ?? 0, crit: p.critDmg ?? 0 }
    }
    config.setMechanicSetting('yaojiayin.ariaCoverage', 1)
    const on = read()
    config.setMechanicSetting('yaojiayin.ariaCoverage', 0)
    const off = read()
    // 0命技能等级 12 → 伤害 +20、暴伤 +25（各 ×覆盖率）
    expect(on.dmg - off.dmg).toBeCloseTo(20, 1)
    expect(on.crit - off.crit).toBeCloseTo(25, 1)
    expect(on.dmg).toBeGreaterThan(off.dmg)
  })
})
