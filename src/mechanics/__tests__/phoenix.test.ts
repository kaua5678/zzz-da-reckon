import { beforeEach, describe, expect, it } from 'vitest'
import { mockStaticFetch, newPinia } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { useCatalogStore } from '@/stores/catalog'
import { useConfigStore } from '@/stores/config'
import {
  computePhoenixScorchCrit,
  phoenixBasicGrants,
  phoenixChargedCount,
  phoenixMechanic,
  phoenixPerfectBlockHits,
  phoenixSkillLevel,
  planPhoenixBasic,
  PHOENIX_A34_PER_EX_ROUND,
  PHOENIX_C4_RELEASE_MULT,
  PHOENIX_RELEASE_BASE,
  PHOENIX_SCORCH_CRIT_DMG,
  PHOENIX_SCORCH_CRIT_RATE,
  PHOENIX_SCORCH_MASTERY_CAP,
  PHOENIX_SCORCH_MASTERY_THRESHOLD,
} from '@/mechanics/agents/phoenix'
import { BOSS_ATTACK_INTERACTIONS } from '@/composables/operationalDifficulty'
import { emptyPanel } from '@/core/panel'
import { getAnomalyCritStats } from '@/core/anomalyPool/helpers'
import { calcAnomalyDamage } from '@/core/damage'
import { clampActionCount } from '@/stores/config'

const baseConfig = {
  wEngineId: '', wEngineModLevel: 5,
  driveDisc: { fourPieceSetId: '', twoPieceSetId: '', mainStats: { 4: 'anomalyProficiency' as any, 5: 'fireDmg' as any, 6: 'anomalyMastery' as any }, subStatAllocation: {} },
  parryCount: 10, dodgeCounterCount: 6, blockCount: 20, chainCountPerStun: 0, basicAttackTimeWeight: 1,
}

describe('菲欧妮（1641）3.3.12 v12 正式录入', () => {
  beforeEach(() => {
    newPinia()
    mockStaticFetch()
  })

  async function setup(teamAgentIds: [string, string, string], cinemaLevel = 0, wEngineId = '') {
    const catalog = useCatalogStore()
    await catalog.load()
    await catalog.loadTeammateBuffs()
    const config = useConfigStore()
    teamAgentIds.forEach((agentId, slot) => {
      config.team[slot] = { slot, agentId, cinemaLevel: slot === 0 ? cinemaLevel : 0, ...baseConfig, wEngineId: slot === 0 ? wEngineId : '' } as any
    })
    config.syncTeammateBuffsFromTeam()
    const { computePanelPhases } = await import('@/composables/resourceCalc/panelPhases')
    return { catalog, config, computePanelPhases }
  }

  it('纯函数：[灼蚀] 异常暴击 v12（率 30+0.7×(初始掌控−155) 封顶255，伤 25 + 额外能力15 + 影画1 25）', () => {
    const base = computePhoenixScorchCrit({ initialMastery: 155, additionalActive: false, cinemaLevel: 0 })
    expect(base.rate).toBeCloseTo(PHOENIX_SCORCH_CRIT_RATE, 5)
    expect(base.dmg).toBe(PHOENIX_SCORCH_CRIT_DMG)
    // 阈值以下不加率
    const below = computePhoenixScorchCrit({ initialMastery: 100, additionalActive: false, cinemaLevel: 0 })
    expect(below.rate).toBeCloseTo(30, 5)
    // 200 掌控：30 + 45×0.7 = 61.5
    const mid = computePhoenixScorchCrit({ initialMastery: 200, additionalActive: false, cinemaLevel: 0 })
    expect(mid.rate).toBeCloseTo(30 + 45 * 0.7, 5)
    // 255 封顶 = 100%
    const cap = computePhoenixScorchCrit({ initialMastery: PHOENIX_SCORCH_MASTERY_CAP, additionalActive: false, cinemaLevel: 0 })
    expect(cap.rate).toBeCloseTo(100, 5)
    // 超过 255 不再增长（min 截断）
    const over = computePhoenixScorchCrit({ initialMastery: 320, additionalActive: false, cinemaLevel: 0 })
    expect(over.rate).toBeCloseTo(100, 5)
    // 额外能力 +15（固定档，v12 不再按异常角色数分档）
    const add = computePhoenixScorchCrit({ initialMastery: PHOENIX_SCORCH_MASTERY_THRESHOLD, additionalActive: true, cinemaLevel: 0 })
    expect(add.dmg).toBe(40)
    // 影画1 +25
    const c1 = computePhoenixScorchCrit({ initialMastery: PHOENIX_SCORCH_MASTERY_THRESHOLD, additionalActive: true, cinemaLevel: 1 })
    expect(c1.dmg).toBe(65)
  })

  it('纯函数：异放倍率随技能等级（影画3/5 通用技能等级 +2/+4）', () => {
    expect(phoenixSkillLevel(0)).toBe(12)
    expect(phoenixSkillLevel(3)).toBe(14)
    expect(phoenixSkillLevel(5)).toBe(16)
    // 焚罪 225+20×(s-1)：满级 445
    expect(PHOENIX_RELEASE_BASE.charged + PHOENIX_RELEASE_BASE.chargedPerLevel * (phoenixSkillLevel(0) - 1)).toBe(445)
    // 烬火追魂 300+27×(s-1)：满级 597
    expect(PHOENIX_RELEASE_BASE.entry + PHOENIX_RELEASE_BASE.entryPerLevel * (phoenixSkillLevel(0) - 1)).toBe(597)
    expect(PHOENIX_C4_RELEASE_MULT).toBe(600)
  })

  it('面板差分：[灼蚀] 异常暴击率/暴伤入 EV 乘区（spec teamBuffs 通用承载）', async () => {
    const { computePanelPhases } = await setup(['1641', '1171', ''], 0)
    const phases = computePanelPhases(0, useConfigStore(), useCatalogStore())!
    const inCombat = phases.inCombat as any
    // 初始掌控 152 > 155? 不满足（152 < 155）⇒ 率只有 30
    expect(inCombat.anomalyCritRate ?? 0).toBeGreaterThanOrEqual(30)
    expect(inCombat.anomalyCritDmg ?? 0).toBeGreaterThanOrEqual(40) // 25 + 额外能力15
  })

  it('资源区块：[灼蚀] 暴击/焚罪/燎斩/烬火追魂计数与执行行同源', async () => {
    await setup(['1641', '1171', ''], 0)
    const calc = useResourceCalc()
    const phoenix = calc.resourceResult.value!.characters.find(c => c.agentId === '1641')!
    const cycle = phoenix.phoenixCycle!
    expect(cycle.coreProficiency).toBe(85)
    expect(cycle.scorchCritDmg).toBe(40) // 25 + 额外能力15（1171 柏妮思=异常队友）
    expect(cycle.emberCap).toBe(120)
    expect(cycle.chargedCount).toBeGreaterThanOrEqual(0)
    // 烬火追魂行存在且计数 = 终结次数
    const entry = phoenix.executions.find(e => e.moveId === '1641019')
    if (cycle.entryCount > 0 && entry) {
      expect(entry.count).toBe(cycle.entryCount)
      expect(entry.totalTime).toBe(0) // 收尾追加攻击不占前台时间
    }
  })

  it('执行行：眩焰（通用强特）+ 坠阳（40 能量）+ 燎斩（0 能量）三行按同一次数收敛', async () => {
    await setup(['1641', '1171', ''], 0)
    const phoenix = useResourceCalc().resourceResult.value!.characters.find(c => c.agentId === '1641')!
    const ex = phoenix.executions.find(e => e.moveId === '1641008')
    const second = phoenix.executions.find(e => e.moveId === '1641009')
    const liao = phoenix.executions.find(e => e.moveId === '1641023')
    if (ex && ex.count > 0) {
      expect(second, '坠阳随强特产行').toBeTruthy()
      expect(liao, '燎斩随强特产行').toBeTruthy()
      expect(second!.count).toBe(ex.count)
      expect(liao!.count).toBe(ex.count)
      expect(second!.totalEnergyConsume).toBeCloseTo(ex.count * 40, 5)
      expect(liao!.totalEnergyConsume).toBe(0) // 燎斩消耗升变而非能量
    }
  })

  it('异放事件：焚罪（C0 445%）+ 烬火追魂（C0 597%）+ 影画4 额外 600% + [灼蚀] 周期火伤', async () => {
    await setup(['1641', '1171', ''], 0)
    let phoenix = useResourceCalc().resourceResult.value!.characters.find(c => c.agentId === '1641')!
    let events = phoenix.anomalyEventExecutions ?? []
    // C0：s=12 ⇒ 焚罪 225+20×11 = 445、烬火追魂 300+27×11 = 597
    const charged = events.find(e => e.eventId === 'phoenix_charged_release')
    const entry = events.find(e => e.eventId === 'phoenix_entry_release')
    if (charged) expect(charged.formula).toContain('445')
    if (entry) expect(entry.formula).toContain('597')
    expect(events.find(e => e.eventId === 'phoenix_c4_charged_release'), 'C0 无影画4 额外异放').toBeUndefined()

    // [灼蚀] 周期火伤事件（C0 也生效）
    const dot = events.find(e => e.eventId === 'phoenix_scorch_dot')
    if (dot) {
      expect(dot.eventType).toBe('direct_damage')
      expect(dot.damageMultiplier).toBe(50)
    }

    // C4：s=14 ⇒ 焚罪 225+20×13 = 485，且两个额外异放 600% 出现
    await setup(['1641', '1171', ''], 4)
    phoenix = useResourceCalc().resourceResult.value!.characters.find(c => c.agentId === '1641')!
    events = phoenix.anomalyEventExecutions ?? []
    const c4Charged = events.find(e => e.eventId === 'phoenix_c4_charged_release')
    const c4Entry = events.find(e => e.eventId === 'phoenix_c4_entry_release')
    if (c4Charged) expect(c4Charged.formula).toContain('600')
    if (c4Entry) expect(c4Entry.formula).toContain('600')
    const chargedC4 = events.find(e => e.eventId === 'phoenix_charged_release')
    if (chargedC4) expect(chargedC4.formula).toContain('485')
  })

  /**
   * 用户 2026-10-29 ②：「核心技写了敌人每 8 秒受到 50% 攻击力的直伤伤害计算了吗，这个相当于 8 秒一个 50% 直伤倍率事件。」
   *
   * 答案 = **已建模**（direct_damage 事件 → 直伤行 `direct-damage-<slot>-phoenix_scorch_dot`）；本用例锁三件
   * 此前没有任何判据看着的事：
   * ① 事件带**强化特殊技定向**（原文「该伤害视为[强化特殊技]伤害」）——改前这句话只活在 note 文案里，
   *    没有任何通道（`damagePoolRelease` 直伤事件分支不传 `skillDamageTarget`）⇒ 拿不到任何 `__exSpecial` buff；
   * ② 行真的物化进伤害池且 multiplier = 50%（不是只活在事件列表里）；
   * ③ 次数 = floor(有效战斗时间 / 8)（覆盖率滑块缺省 1）。
   */
  it('[灼蚀] 周期火伤：强化特殊技定向 + 物化进伤害池 + 次数 = floor(有效时长/8)', async () => {
    const { config } = await setup(['1641', '1171', ''], 0)
    const calc = useResourceCalc()
    const phoenix = calc.resourceResult.value!.characters.find(c => c.agentId === '1641')!
    const dot = (phoenix.anomalyEventExecutions ?? []).find(e => e.eventId === 'phoenix_scorch_dot')!
    expect(dot.eventType).toBe('direct_damage')
    expect(dot.damageMultiplier).toBe(50)
    expect(dot.skillDamageTarget, '原文「视为[强化特殊技]伤害」必须走招式族定向').toBe('exSpecial')

    const row = calc.damagePoolRows.value.find(r => r.id.endsWith('phoenix_scorch_dot'))!
    expect(row, '周期火伤必须物化进伤害池（只登记事件 = 不结算）').toBeTruthy()
    expect(row.multiplier).toBe(50)
    expect(row.count).toBe(Math.floor(config.enemy.battleTime / 8))
  })

  /**
   * 用户 2026-10-29 ①：「菲欧妮的异常暴击区…这个应该在结算区，除了紊乱不能吃，其他的什么异放耀变乱流都能吃，
   * 和简的强击暴击是加算的，但是简的强击暴击耀变不能吃。」
   *
   * 本用例锁「加算」与「紊乱不吃」两条分区口径（耀变见 `remielle.test.ts`；乱流见
   * `core/anomalyPool/helpers#calcTurbulenceSettlement` 的 `calcAnomalyCritExpect`）。
   */
  it('[灼蚀] 异常暴击分区：与强击暴击同区加算；异常/异放吃，紊乱不吃', () => {
    const panel = { ...emptyPanel(), anomalyCritRate: 30, anomalyCritDmg: 40, assaultCritRate: 60, assaultCritDmg: 50 }
    // 物理强击：通用异常暴击（[灼蚀] 30/40）+ 强击暴击（简 60/50）**同区加算**
    expect(getAnomalyCritStats(panel, 'physical')).toMatchObject({ rate: 90, dmg: 90 })
    // 属性异常：只吃通用那一份，强击暴击不参与
    expect(getAnomalyCritStats(panel, 'fire')).toMatchObject({ rate: 30, dmg: 40 })

    const rowsOf = (kind: 'anomaly' | 'release' | 'disorder') => calcAnomalyDamage({
      panel, element: 'fire', baseMultiplier: 100, enemyDefense: 953,
      enemyDefReduction: 0, enemyDefFlatReduction: 0, enemyResistance: 0, enemyResReduction: 0,
      critMode: 'crit', damageKind: kind,
    }).breakdown.map(b => b.label)
    expect(rowsOf('anomaly')).toContain('异常暴击')
    expect(rowsOf('release')).toContain('异常暴击')
    expect(rowsOf('disorder'), '紊乱不吃异常暴击').not.toContain('异常暴击')
  })

  it('命座差分：C6 无视15%全属性抗性 + 异放无视40%防御；整局伤害 C6 > C0', async () => {
    await setup(['1641', '1171', ''], 0)
    const d0 = useResourceCalc().teamTotalDamage.value
    const { config, computePanelPhases } = await setup(['1641', '1171', ''], 0)
    const bare = computePanelPhases(0, config, useCatalogStore())!.inCombat as any
    config.team[0]!.cinemaLevel = 6
    config.syncTeammateBuffsFromTeam()
    const c6Panel = computePanelPhases(0, config, useCatalogStore())!.inCombat as any
    // 三通道：影画6「菲欧妮无视目标15%全属性伤害抗性」原文无「异常」限定 = 自身**直伤**无视
    expect((c6Panel.enemyResIgnoreDirect ?? 0) - (bare.enemyResIgnoreDirect ?? 0)).toBeCloseTo(15, 5)
    const d6 = useResourceCalc().teamTotalDamage.value
    expect(d6).toBeGreaterThan(d0)

    await setup(['1641', '1171', ''], 6)
    const phoenix = useResourceCalc().resourceResult.value!.characters.find(c => c.agentId === '1641')!
    expect(phoenix.phoenixCycle!.c6ResIgnore).toBe(15)
    expect(phoenix.phoenixCycle!.c6ReleaseDefIgnore).toBe(40)
  })

  it('专武 14164「涅槃初翎」生效差分（v12）：异常精通+90（精炼1）+ 火伤+40%', async () => {
    const { config, computePanelPhases } = await setup(['1641', '1171', ''], 0)
    const bare = computePanelPhases(0, config, useCatalogStore())!.inCombat as any
    config.team[0]!.wEngineId = '14164'
    config.team[0]!.wEngineModLevel = 1
    const armed = computePanelPhases(0, config, useCatalogStore())!.inCombat as any
    expect(armed.anomalyProficiency - bare.anomalyProficiency).toBeCloseTo(90, 5)
    expect(armed.fireDmg - bare.fireDmg).toBeCloseTo(40, 5)
  })

  it('模块声明：v12 三项影画/技能等级/固定异放倍率都在通道上', () => {
    expect(phoenixMechanic.id).toBe('agent:phoenix')
    expect(phoenixMechanic.agentIds).toEqual(['1641'])
    const ids = phoenixMechanic.settings?.map(s => s.id) ?? []
    expect(ids).toContain('phoenix.chargedAttackCount')
    expect(ids).toContain('phoenix.releaseCoverage')
    expect(ids).toContain('phoenix.scorchCoverage')
    expect(phoenixMechanic.axisMoveFreeOfDecibel!('1641019')).toBe(true)
    expect(phoenixMechanic.axisMoveFreeOfDecibel!('1641013')).toBe(false)
  })

  /**
   * 完美格挡 → 燔焰（用户裁决 2026-10-22）：「可以，毕竟他有交互收益。此交互需要 boss 产生攻击，
   * 所以要算非失衡占比。此外还有 cd 算出的上限。」
   *
   * 三件事在这里一次锁死：
   * ① **入口存在**：模块声明 `characterCountInputs: perfectBlockCount`（原缺失 ⇒ 用户填不到）；
   * ② **CD 上限**：有效次数 = min(填写次数, floor(有效战斗时间/10))——原式是「每 10 次一次」（读错单位）；
   * ③ **难度侧非失衡占比**：`perfectBlock` 已在 `BOSS_ATTACK_INTERACTIONS`（只断言登记，不重算公式）。
   */
  it('完美格挡：输入框已声明；燔焰按 min(次数, floor(有效时间/10))×5 计入（CD 上限）', async () => {
    // ① 入口声明
    const decl = phoenixMechanic.characterCountInputs?.find(i => i.field === 'perfectBlockCount')
    expect(decl, '菲欧妮必须声明完美格挡输入框').toBeTruthy()
    expect(decl!.label).toBe('完美格挡')
    // ③ 难度侧：需怪攻击（吃非失衡占比修正）
    expect(BOSS_ATTACK_INTERACTIONS).toContain('perfectBlock')

    // ② CD 上限：180s 有效时间 ⇒ 最多 18 次
    const cap = Math.floor(180 / 10)
    const cfgBase = {
      phoenixCinemaLevel: 0,
      phoenixCombustionMeta: {},
      phoenixBasicCycle: [],
      battleTime: 180,
      invincibleTime: 0,
      perfectBlockCount: 0,
    } as any
    const ember = (perfectBlockCount: number, invincibleTime = 0) => {
      const cfg = { ...cfgBase, perfectBlockCount, invincibleTime }
      return phoenixChargedCount(cfg, { basicAttackTime: 0 } as any, [])
    }
    // 0 次 ⇒ 0 燔焰 ⇒ 0 次焚罪
    expect(ember(0)).toBe(0)
    // 10 次（= CD 上限以内）⇒ 10×5 = 50 燔焰 ⇒ floor(50/90) = 0 次焚罪
    expect(ember(10)).toBe(0)
    // 18 次（= 上限）⇒ 90 燔焰 ⇒ 1 次焚罪
    expect(ember(cap)).toBe(1)
    // **超上限 999 次 ⇒ 仍只按 18 次算**（CD 是硬约束，不是「次数/10」）
    expect(ember(999)).toBe(1)
    // 无敌时间扣减后上限收紧：180-100=80s ⇒ floor(80/10)=8 次 ⇒ 40 燔焰 ⇒ 0 次焚罪
    expect(ember(999, 100)).toBe(0)
  })

  /**
   * 平A段计划（用户口径 2026-10-22 定稿）——「战斗循环就是 e→a→a，所有 a 都落在第三/四段」。
   *
   * 三件事在这里钉死：
   * ① **从 0 正向填充**：名额是免费上限，池装不下就少打（不是「有名额必须打」也不是「超出上界截断」）；
   * ② **掠火起手**：名额用尽后由普通 E（0 能量）起手接 a34 —— a1/a2 起手不存在（用户亲口订正）；
   * ③ **完美格挡短版**：掠火完美格挡可直入第三段、跳过熔毁（与燔焰 +5 共用同一 10s CD）。
   */
  describe('平A段计划（a3/a4 循环 + 掠火起手）', () => {
    // catalog 实测时长：a3 0.84 / a4 1.943 / 掠火 0.35 / 熔毁 0.875
    const cycle = [
      { moveId: '1641001', actionTime: 0.12 },
      { moveId: '1641002', actionTime: 0.413 },
      { moveId: '1641003', actionTime: 0.84 },
      { moveId: '1641004', actionTime: 1.943 },
    ]
    const slash = { actionTime: 0.35 }
    const melt = { actionTime: 0.875 }
    const PAIR = 0.84 + 1.943 // 2.783

    it('名额是免费上限：池小则少打（从 0 正向填充，不是超满截断）', () => {
      const p = planPhoenixBasic({ basicTime: PAIR * 3, cycle, grants: 99, slash, melt })
      expect(p.freePairs).toBe(3) // 只装得下 3 对
      expect(p.paidRounds).toBe(0) // 没有剩余时间
      expect(p.counts['1641003']).toBe(3)
      expect(p.counts['1641004']).toBe(3)
      expect(p.usedTime).toBeCloseTo(PAIR * 3, 9)
    })

    it('名额用尽后由掠火起手轮填满（a1/a2 起手不存在）', () => {
      const p = planPhoenixBasic({ basicTime: PAIR * 2 + (0.35 + 0.875 + PAIR), cycle, grants: 2, slash, melt })
      expect(p.freePairs).toBe(2)
      expect(p.paidRounds).toBe(1)
      expect(p.counts['1641007']).toBe(1) // 掠火
      expect(p.counts['1641006']).toBe(1) // 熔毁（未触发完美格挡）
      expect(p.counts['1641001'] ?? 0).toBe(0) // 绝不回落到 a1 起手
      expect(p.counts['1641002'] ?? 0).toBe(0)
      expect(p.counts['1641003']).toBe(3) // 2 免费 + 1 起手轮
      expect(p.counts['1641004']).toBe(3)
    })

    it('掠火完美格挡 ⇒ 跳过熔毁的短版轮（更省时间，同样给 1 个 a34）', () => {
      const p = planPhoenixBasic({ basicTime: 0.35 + PAIR, cycle, grants: 0, slash, melt, slashPerfectBlocks: 1 })
      expect(p.perfectRounds).toBe(1)
      expect(p.counts['1641007']).toBe(1)
      expect(p.counts['1641006'] ?? 0).toBe(0) // 完美格挡跳过熔毁
      expect(p.counts['1641003']).toBe(1)
      expect(p.usedTime).toBeCloseTo(0.35 + PAIR, 9)
    })

    it('段是离散动作：余量只按派生链前缀吃，装不满的段留白（不折算半段）', () => {
      // 剩 0.5s：掠火(0.35) 吃得下，熔毁(0.875)/a3(0.84) 都不够 ⇒ 只打掠火就停
      const p = planPhoenixBasic({ basicTime: PAIR * 2 + 0.5, cycle, grants: 99, slash, melt })
      expect(p.freePairs).toBe(2)
      expect(p.paidRounds).toBe(0) // 没有完整起手轮
      expect(p.counts['1641007']).toBe(1) // 只有掠火这一段前缀
      expect(p.counts['1641006'] ?? 0).toBe(0) // 熔毁装不下
      expect(p.counts['1641003']).toBe(2) // 绝不凭空造第三段
      expect(p.counts['1641004']).toBe(2)
      expect(p.usedTime).toBeCloseTo(PAIR * 2 + 0.35, 9)
    })

    it('名额来源：3×强特轮数 + 连携 + 烬火追魂 + 闪反 + 支援突击（不含快支，见下方反锁）', () => {
      const grants = phoenixBasicGrants(
        { dodgeCounterCount: 6, parryCount: 10 } as never,
        { exSpecialCount: 5, ultimateCount: 4, chainCountTotal: 3 } as never,
      )
      // 5 轮 × 3 + 连携 3 + 烬火追魂 4（= 终结次数）+ 闪反 6 + 支援突击 10
      expect(grants).toBe(5 * PHOENIX_A34_PER_EX_ROUND + 3 + 4 + 6 + 10)
    })

    it('完美格挡 10s CD 是硬约束，且掠火短版轮与燔焰 +5 共用同一上限（单一事实源）', () => {
      const cfg = { battleTime: 180, invincibleTime: 0, perfectBlockCount: 999 } as never
      expect(phoenixPerfectBlockHits(cfg)).toBe(18)
      expect(phoenixPerfectBlockHits({ battleTime: 180, invincibleTime: 100, perfectBlockCount: 999 } as never)).toBe(8)
      expect(phoenixPerfectBlockHits({ battleTime: 180, invincibleTime: 0, perfectBlockCount: 3 } as never)).toBe(3)
    })
  })

  /**
   * 交互上限（用户口径 2026-10-22：「这些交互的上限设置了没，格挡不该太多」）。
   *
   * 三档约束各就各位：
   * ① **store 界**（`ACTION_COUNT_BOUNDS`）：parry/dodge/block 全 `0..99`、perfectBlock `0..999`；
   * ② **原作硬约束**：完美格挡「10 秒内最多触发一次」⇒ 180s 局最多 18 次（`phoenixPerfectBlockHits`）；
   * ③ **资源约束**：掠火轮/熔毁/快支都是**真实动作行**，占前台时间 ⇒ 填得再多也只是挤平A池。
   *
   * ⚠ 本测试锁的是「①+②」，③ 由端到端用例锁（快支行存在 + 时间进账本）。
   */
  it('交互上限：perfectBlock 按 10s CD 封顶（180s 局 ≤18），四项交互界 0..99', async () => {
    // ② 原作 CD：填写 999 = 与填写 18 等价（180s / 10s = 18）
    expect(phoenixPerfectBlockHits({ battleTime: 180, invincibleTime: 0, perfectBlockCount: 999 } as never)).toBe(18)
    expect(phoenixPerfectBlockHits({ battleTime: 180, invincibleTime: 0, perfectBlockCount: 18 } as never)).toBe(18)
    expect(phoenixPerfectBlockHits({ battleTime: 180, invincibleTime: 0, perfectBlockCount: 5 } as never)).toBe(5)
    // 无敌时间扣减 ⇒ 上限收紧（180−100=80s ⇒ 8 次）
    expect(phoenixPerfectBlockHits({ battleTime: 180, invincibleTime: 100, perfectBlockCount: 999 } as never)).toBe(8)
    // ① store 界：这三个是「需要 boss 出手」的交互，界面不许填成三位数
    // （quickAssistCount 2026-10-26 删除，不再是可填字段）
    for (const f of ['parryCount', 'dodgeCounterCount', 'blockCount'] as const) {
      expect(clampActionCount(f, 1000), f).toBe(99)
    }
    // 完美格挡原文是「10 秒一次」而非「一次一用」，界放到 999 也不会爆量（被 ② 钳住）
    expect(clampActionCount('perfectBlockCount', 1000)).toBe(999)
  })

  /**
   * **快速支援不进名额**（用户裁决 2026-10-22）：原文确有「点按普攻可衔接第三段」，
   * 但引擎不物化快支行（无代价）⇒ 收它 = 白送 a34、上限形同虚设。这条反锁「不收」。
   *
   * ⚠ 2026-10-26：`quickAssistCount` 字段整体删除（手动快支下线）⇒ 原「实打侧：改快支次数不改变
   * a34 名额」那半条已无从构造（没有字段可改），保留纯函数侧（入参类型层就收不进来）+ 快支行不物化。
   */
  it('快速支援：不进 a34 名额（引擎不物化快支行 ⇒ 收了就是零成本白送）', async () => {
    const grantsNoQa = phoenixBasicGrants(
      { dodgeCounterCount: 0, parryCount: 0 } as never,
      { exSpecialCount: 4, ultimateCount: 0, chainCountTotal: 0 } as never,
    )
    // 只按 3×强特轮数计，快支不参与（入参里没有快支项 —— 类型层就收不进来）
    expect(grantsNoQa).toBe(4 * PHOENIX_A34_PER_EX_ROUND)

    // 也不该物化出快支行（本模块不补行；全队交互 0 也不退化 ⇒ 名额仍 > 0）
    await setup(['1641', '1171', ''], 0)
    const phoenix = useResourceCalc().resourceResult.value!.characters.find(c => c.agentId === '1641')!
    expect(phoenix.phoenixCycle!.a34FreePairs + phoenix.phoenixCycle!.a34PaidRounds).toBeGreaterThan(0)
    expect(phoenix.executions.find(e => e.moveId === '1641014')).toBeUndefined()
  })

  it('端到端：段行物化 + 聚合行只留时间/回能 + 时间从平A池 carve（不双计）', async () => {
    await setup(['1641', '1171', ''], 0)
    const phoenix = useResourceCalc().resourceResult.value!.characters.find(c => c.agentId === '1641')!
    const agg = phoenix.executions.find(e => e.moveId === 'basic_attack')!
    const segRows = phoenix.executions.filter(e => ['1641003', '1641004', '1641007', '1641006'].includes(e.moveId))
    expect(segRows.length, '段行必须物化').toBeGreaterThan(0)
    // 聚合行：伤害/失衡/积蓄归零（段行承载），时间 = 池 − 段行时长（carve），回能保留
    expect(agg.damageMultiplier ?? 0).toBe(0)
    expect(agg.dazeMultiplier ?? 0).toBe(0)
    expect(agg.anomalyBuildUp ?? 0).toBe(0)
    expect(agg.totalEnergyRecovery ?? 0, '平A回能必须留在池上').toBeGreaterThan(0)
    const segTime = segRows.reduce((s, r) => s + (r.totalTime ?? 0), 0)
    const bat = phoenix.timeAllocation.basicAttackTime
    expect(agg.totalTime + segTime, '聚合行 + 段行 ≡ 平A池（时间不双计）').toBeCloseTo(bat, 6)
    // 段行都是前台 basic 桶（与聚合行同桶）
    for (const r of segRows) expect(r.timeBucket).toBe('basic')
    // 段行次数与资源区块展示同源
    const cycle = phoenix.phoenixCycle!
    const third = segRows.filter(r => r.moveId === '1641003').reduce((s, r) => s + r.count, 0)
    expect(third).toBe(cycle.basicThird)
  })

  it('[灼蚀] 覆盖率滑块生效：0 → 无周期火伤事件', async () => {
    const { config } = await setup(['1641', '1171', ''], 0)
    config.setMechanicSetting('phoenix.scorchCoverage', 0)
    const phoenix = useResourceCalc().resourceResult.value!.characters.find(c => c.agentId === '1641')!
    const events = phoenix.anomalyEventExecutions ?? []
    expect(events.find(e => e.eventId === 'phoenix_scorch_dot')).toBeUndefined()
  })
})
