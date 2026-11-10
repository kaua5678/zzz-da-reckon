import { describe, expect, it } from 'vitest'
import { computePanelPhases } from '@/composables/resourceCalc/panelPhases'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { COMBO_ALIGN_ABSORB_RATIO_SETTING } from '@/data/resourceDefaults'
import {
  AIRE_C1_ETHER_ANOMALY_RES_IGNORE,
  AIRE_C2_DEF_IGNORE,
  AIRE_C2_DELUSION_DEF_IGNORE,
  AIRE_C6_DECIBEL_GIFT,
  AIRE_CORE_PROFICIENCY,
  AIRE_ABSOLUTE_PITCH_MOVE_ID,
  AIRE_RELEASE_RATIO_PER_TEN,
  AIRE_RELEASE_STUN_BONUS_PCT,
  AIRE_C4_RELEASE_ENERGY,
  AIRE_C4_RELEASE_DECIBEL,
  AIRE_C6_ETHANOL_DMG_BONUS,
  computeAireCycle,
  aireMechanic,
  aireAbsolutePitchCount,
  aireDelusionCheerLayers,
  aireDelusionCoverage,
  aireEnhancedPitchShare,
} from '@/mechanics/agents/aire'
import { setupHarness } from '@/test/harness'
import { calcAnomalyDamage } from '@/core/damage'

async function setup(mateId = '1141', cinemaLevel = 0) {
  const result = await setupHarness([
    { agentId: '1501', cinemaLevel, parryCount: 0, dodgeCounterCount: 0 },
    { agentId: mateId, cinemaLevel: 0, parryCount: 0, dodgeCounterCount: 0 },
  ])
  for (const buff of result.config.globalBuffs) buff.enabled = false
  return result
}

function cycle(overrides: Partial<Parameters<typeof computeAireCycle>[0]> = {}) {
  return computeAireCycle({
    cinemaLevel: 6,
    additionalActive: true,
    ...overrides,
  })
}

describe('爱芮（1501）总量', () => {
  it('核心异常精通恒为90，影画门控C1/C2/C6', () => {
    expect(cycle({ cinemaLevel: 0 }).coreProficiency).toBe(AIRE_CORE_PROFICIENCY)
    expect(cycle({ cinemaLevel: 0 }).c1EtherAnomalyResIgnore).toBe(0)
    expect(cycle({ cinemaLevel: 1 }).c1EtherAnomalyResIgnore).toBe(AIRE_C1_ETHER_ANOMALY_RES_IGNORE)
    // 面板/纯函数路径只承载常驻 16%；妄想时刻那 8% 由覆盖率在结算期补（CC-561）
    expect(cycle({ cinemaLevel: 1 }).c2DefIgnore).toBe(0)
    expect(cycle({ cinemaLevel: 2 }).c2DefIgnore).toBe(AIRE_C2_DEF_IGNORE)
    expect(cycle({ cinemaLevel: 6 }).c2DefIgnore).toBe(AIRE_C2_DEF_IGNORE)
    expect(cycle({ cinemaLevel: 5 }).c6DecibelGift).toBe(0)
    expect(cycle({ cinemaLevel: 6 }).c6DecibelGift).toBe(AIRE_C6_DECIBEL_GIFT)
  })
})

describe('爱芮完整计算链', () => {
  it('额外能力由击破/支援/异常队友激活，普通异阵营队友不激活', async () => {
    for (const mateId of ['1141', '1031', '1181']) {
      const { catalog, config } = await setup(mateId)
      expect((computePanelPhases(0, config, catalog)!.inCombat as any).additionalAbilityActive).toBe(1)
    }
    const neg = await setup('1191')
    expect((computePanelPhases(0, neg.config, neg.catalog)!.inCombat as any).additionalAbilityActive ?? 0).toBe(0)
  })

  it('资源池写入爱芮循环', async () => {
    await setup('1141', 6)
    const calc = useResourceCalc()
    const aire = calc.resourceResult.value!.characters.find(row => row.agentId === '1501')!
    expect(aire.aireCycle).toBeTruthy()
  })

  it('面板增益进入最终面板（异常精通/影画1抗性无视/影画2无视防御）', async () => {
    await setup('1141', 2)
    const calc = useResourceCalc()
    expect(calc.resourceResult.value!.characters.find(row => row.agentId === '1501')!.aireCycle).toBeTruthy()
    const panel = calc.panels.value[0] as any
    expect(panel.anomalyProficiency).toBeGreaterThanOrEqual(AIRE_CORE_PROFICIENCY)
    expect(panel.enemyEtherAnomalyResReduction).toBeGreaterThanOrEqual(AIRE_C1_ETHER_ANOMALY_RES_IGNORE)
    // 防御三通道（2026-11-09）：影画2「攻击**和触发[异放]**时无视16%防御」两半分落 ——
    // 「攻击」那半 ⇒ 直伤族（只有直伤吃）；「触发[异放]」那半 ⇒ releaseModifier（异放专属层）。
    // ⚠ 都**不得**进 enemyDefReduction / enemyAnomalyDefReduction：那两个层任何异常都吃，会过度授予。
    expect(panel.enemyDefIgnoreDirect).toBeGreaterThanOrEqual(AIRE_C2_DEF_IGNORE)
    expect(panel.enemyDefReduction ?? 0).toBe(0)
    expect(panel.enemyAnomalyDefReduction ?? 0).toBe(0)
  })

  it('★ 异放专属减防层级：只在异放行结算，异常父层（侵蚀/感电/紊乱）读不到', async () => {
    const { catalog, config } = await setup('1141', 2)
    const panel = computePanelPhases(0, config, catalog)!.inCombat
    // ① 异放专属层真的产出：常驻 16% 在面板上；妄想时刻那 8% 由覆盖率在结算期补（CC-561）
    const cfg = { aireCinemaLevel: 2, battleTime: 180, invincibleTime: 0 } as any
    // C2 覆盖率跟随终结次数：3 次 × 15s / 180s = 0.25 ⇒ 16 + 8×0.25 = 18
    const mod = aireMechanic.releaseModifier!({ self: { slot: 0, cinemaLevel: 2, panel, cfg, ultimateCount: 3 } })
    expect(mod.enemyDefReduction).toBeCloseTo(AIRE_C2_DEF_IGNORE + AIRE_C2_DELUSION_DEF_IGNORE * 0.25, 5)
    // 手搭 self（无 cfg）⇒ 只给面板常驻 16%，不凭空授予妄想时刻那半
    const bare = aireMechanic.releaseModifier!({ self: { slot: 0, cinemaLevel: 2, panel } })
    expect(bare.enemyDefReduction).toBeCloseTo(AIRE_C2_DEF_IGNORE, 5)
    // ② 缺省 self 作用域 ⇒ 只有爱芮自己的异放行吃（不给队友异放）
    expect(aireMechanic.releaseModifierScope ?? 'self').toBe('self')
    // ③ 父层必须是 0：写进父层会让侵蚀/感电/紊乱 也吃 ⇒ 过度授予（用户口径 2026-11-09）
    expect(panel.enemyAnomalyDefReduction ?? 0).toBe(0)
    expect(panel.enemyDefReduction ?? 0).toBe(0)
    // ④ 行为面：同一面板下，「异常父事件」不吃异放加成 —— releaseModifier 不参与非异放行，
    //    故父事件伤害只取决于面板（父层 0 ⇒ 与无该 buff 一致）
    const base = { ...panel, enemyDefIgnoreDirect: 0 }
    const asParent = calcAnomalyDamage({
      panel: base, element: 'ether', baseMultiplier: 100, enemyDefense: 953,
      enemyDefReduction: 0, enemyDefFlatReduction: 0, enemyResistance: 0, enemyResReduction: 0,
      damageKind: 'anomaly',
    }).damage
    const withRelease = calcAnomalyDamage({
      panel: base, element: 'ether', baseMultiplier: 100, enemyDefense: 953,
      enemyDefReduction: mod.enemyDefReduction ?? 0, enemyDefFlatReduction: 0,
      enemyResistance: 0, enemyResReduction: 0,
      damageKind: 'release',
    }).damage
    expect(withRelease).toBeGreaterThan(asParent) // 异放独占这份加成
  })

  it('影画2 妄想时刻 8% 按覆盖率落结算期（C2 跟随终结次数 / C6 跟随首次放大滑块）', async () => {
    // 纯函数：覆盖率单一源——C2~C5 按终结次数、C6 按首次放大窗口
    const c2Cfg = { aireCinemaLevel: 2, battleTime: 180, invincibleTime: 0 } as any
    expect(aireDelusionCoverage(c2Cfg, 3)).toBeCloseTo(0.25, 6) // 3×15/180
    expect(aireDelusionCoverage(c2Cfg, 20)).toBe(1) // 封顶 1
    const c6Cfg = { aireCinemaLevel: 6, battleTime: 180, invincibleTime: 0 } as any
    expect(aireDelusionCoverage(c6Cfg, 3)).toBeCloseTo(150 / 180, 6) // 首次放大 30s
    expect(aireDelusionCoverage({ ...c6Cfg, 'setting:aire.firstUltTime': 0 }, 3)).toBe(1)
    // 真管线：直伤行拿到 8%×覆盖率的行级 defIgnore（= 直伤专属乘区），面板只留常驻 16%
    const { catalog, config } = await setup('1141', 2)
    const panel = computePanelPhases(0, config, catalog)!.inCombat as any
    expect(panel.enemyDefIgnoreDirect).toBe(AIRE_C2_DEF_IGNORE)
    const calc = useResourceCalc()
    const aire = calc.resourceResult.value!.characters.find(c => c.agentId === '1501')!
    const coverage = aire.aireCycle!.c2DelusionCoverage
    expect(coverage).toBeGreaterThan(0)
    expect(aire.aireCycle!.c2DefIgnore).toBeCloseTo(AIRE_C2_DEF_IGNORE + AIRE_C2_DELUSION_DEF_IGNORE * coverage, 6)
    const rowDefIgnore = (aire.executions ?? []).map(e => e.defIgnore ?? 0)
    expect(rowDefIgnore.length).toBeGreaterThan(0)
    expect(Math.max(...rowDefIgnore)).toBeCloseTo(AIRE_C2_DELUSION_DEF_IGNORE * coverage, 6)
  })

  it('影画6进场喧响+1200写入角色配置（开局赠送 = 1000 基础 + 1200 影画6）', async () => {
    await setup('1141', 6)
    const calc = useResourceCalc()
    const cfgC6 = calc.resourceConfig.value!.characters.find(c => c.agentId === '1501')!
    /**
     * CC-561：`initialDecibelGift` 是**进场赠送**通道，只放真的进场赠礼 ——
     * 基础 1000 + 影画6「进入战场立即获得 1200」= 2200。
     * 影画4 的异放回响（floor(有效时间/10)=18 次 × 70）是**战斗内累计**，改走不可分享通道
     * `extraSelfDecibelReward`（此前贴进开局赠送 ⇒ 结果卡显示 3460，用户 2026-11-10 反馈「我感觉只有 2200」）。
     */
    expect(cfgC6.initialDecibelGift).toBe(1000 + AIRE_C6_DECIBEL_GIFT)
    expect(cfgC6.extraSelfDecibelReward).toBe(18 * AIRE_C4_RELEASE_DECIBEL)
  })

  it('核心异放事件：dominant 元素 + 比例模式 + 绝对音准载体', () => {
    // 2026-10-19 口径：滑块 = **上限**（次数自动）。这里上限给足（999）⇒ 事件次数 = 自动值
    const cfg = { 'setting:aire.absolutePitchCount': 999 } as any
    // 次数自动 = 应援能量/2 + 全场应援 ⇒ 计数类字段（强特/连携）必须给全，否则自动值为 0
    const state = { frontlineTime: 120, backstageTime: 60, ultimateCount: 2, exSpecialCount: 8, chainCountTotal: 4 } as any
    const autoCount = aireAbsolutePitchCount(cfg, state, 180)
    expect(autoCount).toBeGreaterThan(0)
    const events: any[] = []
    aireMechanic.buildAnomalyEvents!({ cfg, state, events, totalTime: 180 })
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      eventId: 'aire_absolute_pitch_release',
      eventType: 'release',
      element: 'dominant',
      carrierMoveId: AIRE_ABSOLUTE_PITCH_MOVE_ID,
      count: autoCount,
    })
    expect(events[0].releaseRatio).toMatchObject({
      basis: 'anomalyMastery',
      perTenByElement: AIRE_RELEASE_RATIO_PER_TEN,
      stunBonusPct: AIRE_RELEASE_STUN_BONUS_PCT,
    })
  })

  it('核心异放进入伤害池（type=异放，次数自动推导>0）', async () => {
    await setup('1141', 0)
    const calc = useResourceCalc()
    const rows = calc.damagePoolRows.value
    const releases = rows.filter(r => r.type === '异放' && r.agentId === '1501')
    expect(releases.length).toBeGreaterThan(0)
    const totalCount = releases.reduce((s, r) => s + r.count, 0)
    expect(totalCount).toBeGreaterThan(0)
    expect(releases.every(r => r.totalDamage > 0)).toBe(true)
  })

  it('异放次数自动推导 = 应援能量/2 + 全场应援（非C6=终结×3；C6=floor(t/6)+3）；帷幕按次数（4个/次×teamVeilCountTotal）', () => {
    const cfg = { aireCinemaLevel: 0, panel: { additionalAbilityActive: 1 }, teamVeilCountTotal: 3 } as any
    const state = { exSpecialCount: 4, chainCountTotal: 5, ultimateCount: 2 } as any
    const events: any[] = []
    aireMechanic.buildAnomalyEvents!({ cfg, state, events, totalTime: 180 })
    // 应援能量 = 4强特×3 + 5连携×4 + 3帷幕×4 = 44；全场应援 = 2终结×3 = 6 → 异放 = floor(44/2)+6 = 28
    // （CC-196 订正：「妄想内异常 +1层/6s」是影画6 专属，旧口径全命座 floor(180/6)=30 → 52）
    expect(events[0].count).toBe(28)
    // 影画6（CC-561 口径）：首次放大 30s（滑块缺省）⇒ 窗口 = 180−0−30 = 150s ⇒ floor(150/6)=25 层
    // + 首次进入妄想 3 层 = 28 → 22+28 = 50
    const events6: any[] = []
    aireMechanic.buildAnomalyEvents!({ cfg: { ...cfg, aireCinemaLevel: 6 }, state, events: events6, totalTime: 180 })
    expect(events6[0].count).toBe(50)
    // 滑块置 0 = 旧口径（进场即妄想时刻）⇒ 30 层 + 3 = 33 → 22+33 = 55（可逆）
    const events6Old: any[] = []
    aireMechanic.buildAnomalyEvents!({
      cfg: { ...cfg, aireCinemaLevel: 6, 'setting:aire.firstUltTime': 0 }, state, events: events6Old, totalTime: 180,
    })
    expect(events6Old[0].count).toBe(55)
    // 生效断言：帷幕次数翻倍 → 应援能量 +3×4 → 异放 +6
    const cfg2 = { aireCinemaLevel: 0, panel: { additionalAbilityActive: 1 }, teamVeilCountTotal: 6 } as any
    const events2: any[] = []
    aireMechanic.buildAnomalyEvents!({ cfg: cfg2, state, events: events2, totalTime: 180 })
    expect(events2[0].count).toBe(34)
  })

  it('影画1：异放事件带 releaseCrit（基础25/25，掌控>100每点+0.5）', () => {
    const state = { frontlineTime: 120, backstageTime: 60, ultimateCount: 2, exSpecialCount: 8, chainCountTotal: 4 } as any
    const cfg = { 'setting:aire.absolutePitchCount': 999, aireCinemaLevel: 1 } as any
    const events: any[] = []
    aireMechanic.buildAnomalyEvents!({ cfg, state, events, totalTime: 180 })
    expect(events[0].releaseCrit).toMatchObject({
      ratePct: 25,
      dmgPct: 25,
      masteryThreshold: 100,
      masteryPerPointRatePct: 0.5,
    })
    const cfg0 = { 'setting:aire.absolutePitchCount': 999, aireCinemaLevel: 0 } as any
    const events0: any[] = []
    aireMechanic.buildAnomalyEvents!({ cfg: cfg0, state, events: events0, totalTime: 180 })
    expect(events0[0].releaseCrit).toBeUndefined()
  })

  it('影画1：异放伤害高于 0 命（releaseCrit 生效）', async () => {
    await setup('1141', 0)
    const dmg0 = useResourceCalc().damagePoolRows.value
      .filter(r => r.type === '异放' && r.agentId === '1501')
      .reduce((s, r) => s + r.totalDamage, 0)
    expect(dmg0).toBeGreaterThan(0)

    await setup('1141', 1)
    const dmg1 = useResourceCalc().damagePoolRows.value
      .filter(r => r.type === '异放' && r.agentId === '1501')
      .reduce((s, r) => s + r.totalDamage, 0)
    expect(dmg1).toBeGreaterThan(dmg0)
  })

  it('影画4：异放回能/喧响按 floor(有效时间/10) 注入正确通道（不是「开局赠送」）', async () => {
    await setup('1141', 4)
    const calc = useResourceCalc()
    const cfgC4 = calc.resourceConfig.value!.characters.find(c => c.agentId === '1501')!
    const aire = calc.resourceResult.value!.characters.find(c => c.agentId === '1501')!
    // 异放次数 ≥ floor(有效时间/6) > floor(180/10)=18 → triggers=18
    // CC-561：回能走 bonusEnergy（固定源），喧响走 extraSelfDecibelReward（不可分享），开局赠送保持 40/1000
    expect(cfgC4.aireC4EnergyGift).toBe(18 * AIRE_C4_RELEASE_ENERGY)
    expect(cfgC4.initialEnergyGift).toBe(40)
    expect(cfgC4.extraSelfDecibelReward).toBe(18 * AIRE_C4_RELEASE_DECIBEL)
    expect(cfgC4.initialDecibelGift).toBe(1000)
    const entry = (aire.energySource?.bonusEntries ?? []).find(e => e.key === 'aireC4ReleaseEnergy')
    expect(entry?.value).toBe(18 * AIRE_C4_RELEASE_ENERGY)
    expect(aire.decibelSource.unshareableBonus).toBeGreaterThanOrEqual(18 * AIRE_C4_RELEASE_DECIBEL)
  })

  it('影画6：+40% 只作用于原文点名的强化版绝对音准（1501008）与终结技', () => {
    const cfg = { aireCinemaLevel: 6, battleTime: 180, invincibleTime: 0 } as any
    const state = { ultimateCount: 2 } as any
    const executions = [
      { moveId: '1501016', dmgBonus: 0, skillTableNote: '' }, // 终结技
      { moveId: '1501008', dmgBonus: 0, skillTableNote: '' }, // 强化版绝对音准（妄想时刻内）
      { moveId: '1501007', dmgBonus: 0, skillTableNote: '' }, // 普通 #3（首次放大之前打的）——不是强化版
      { moveId: '1501001', dmgBonus: 0, skillTableNote: '' }, // 甜心律动，不 boost
    ] as any[]
    aireMechanic.patchExecutions!({ cfg, state, executions, teamFrontlineSeconds: 0 })
    expect(executions[0].dmgBonus).toBe(AIRE_C6_ETHANOL_DMG_BONUS)
    expect(executions[1].dmgBonus).toBe(AIRE_C6_ETHANOL_DMG_BONUS)
    // CC-561：原文「强化版[普通攻击：绝对音准]和[终结技]造成的以太伤害提升40%」
    // ⇒ 普通 #3 行不吃（旧实现按「妄想时刻全覆盖」对全段加 40%，前提已被首次放大时间纠正）
    expect(executions[2].dmgBonus).toBe(0)
    expect(executions[3].dmgBonus).toBe(0)
  })
})

describe('CC-561 妄想时刻窗口（首次放大时间滑块）', () => {
  const base: any = { aireCinemaLevel: 6, battleTime: 180, invincibleTime: 0 }

  it('层数 = floor((战斗时间 − 无敌时间 − 首次放大时间)/6)，下限 0', () => {
    expect(aireDelusionCheerLayers(base, 180)).toBe(25) // 180−0−30 = 150
    expect(aireDelusionCheerLayers({ ...base, invincibleTime: 24 }, 180)).toBe(21) // 156−30 = 126
    expect(aireDelusionCheerLayers({ ...base, 'setting:aire.firstUltTime': 0 }, 180)).toBe(30) // 旧口径
    expect(aireDelusionCheerLayers({ ...base, 'setting:aire.firstUltTime': 60 }, 180)).toBe(20)
    expect(aireDelusionCheerLayers({ ...base, 'setting:aire.firstUltTime': 180 }, 180)).toBe(0)
    expect(aireDelusionCheerLayers({ ...base, 'setting:aire.firstUltTime': 999 }, 180)).toBe(0)
    // 手搭 cfg 无 battleTime 时回落入参 totalTime（单测直调路径）
    expect(aireDelusionCheerLayers({ aireCinemaLevel: 6 } as any, 180)).toBe(25)
  })

  it('强化版绝对音准占比 = 妄想窗口 / 有效战斗时间（滑块 0 恢复全覆盖）', () => {
    expect(aireEnhancedPitchShare(base, 3, 180)).toBeCloseTo(150 / 180, 6)
    expect(aireEnhancedPitchShare({ ...base, 'setting:aire.firstUltTime': 0 }, 3, 180)).toBe(1)
    // 非 6 命口径不变：min(1, 终结次数 × 15s / 战斗时长)
    expect(aireEnhancedPitchShare({ ...base, aireCinemaLevel: 5 }, 2, 180)).toBeCloseTo(30 / 180, 6)
  })

  it('真实管线：aire.firstUltTime 改滑块 → 绝对音准#3 次数确实变（SOP §3.5 生效测试）', async () => {
    const { config } = await setupHarness([{ agentId: '1501', cinemaLevel: 6 }, { agentId: '1181' }])
    config.setMechanicSetting(COMBO_ALIGN_ABSORB_RATIO_SETTING, 0)
    const pitchOf = () => {
      const calc = useResourceCalc()
      const aire = calc.resourceResult.value!.characters.find(c => c.agentId === '1501')!
      return (aire.anomalyEventExecutions ?? []).find(e => e.eventId === 'aire_absolute_pitch_release')?.count ?? 0
    }
    config.setMechanicSetting('aire.firstUltTime', 0)
    const immediate = pitchOf()
    config.setMechanicSetting('aire.firstUltTime', 180)
    const late = pitchOf()
    // 首次放大 0s ⇒ 整局妄想；180s ⇒ 窗口为空（只剩进入妄想那 3 层）
    expect(immediate - late).toBeGreaterThan(20)
  })

  it('真实管线：开局赠送只含进场赠礼（C6 = 2200），影画4 异放回响单列', async () => {
    await setup('1141', 6)
    const aire = useResourceCalc().resourceResult.value!.characters.find(c => c.agentId === '1501')!
    expect(aire.decibelSource.initialGift).toBe(1000 + AIRE_C6_DECIBEL_GIFT)
    expect(aire.decibelSource.unshareableBonus).toBeGreaterThanOrEqual(18 * AIRE_C4_RELEASE_DECIBEL)
  })
})

describe('艾莲儿滑块生效差分（防守卫冻结，SOP §3.5）', () => {
  it('aire.cheerEnergyBonus → 绝对音准#3 次数差分（应援能量额外 → pitchCount）', async () => {
    const { config } = await setupHarness([{ agentId: '1501', cinemaLevel: 0 }, { agentId: '1181' }])
    /**
     * ⚠ **T141：钉住动态合轴吸收 = 0**，让本用例只量 `aire.cheerEnergyBonus` 这一个自变量。
     * T141 第 3 档让吸收**常开**（缺省 0.4，且不再要求「有溢出」）⇒ 平A/次数重新分配会小幅改写
     * 次数差分（实测 `on − off` 由 100 → 97）——那是**吸收量**的效应，不是本滑块语义变了。
     * 差值判据（> 0 且 ≥ 量级）本身没动，只是把混进来的第二个变量排除。
     */
    config.setMechanicSetting(COMBO_ALIGN_ABSORB_RATIO_SETTING, 0)
    const pitchOf = () => {
      const calc = useResourceCalc()
      const aire = calc.resourceResult.value!.characters.find(c => c.agentId === '1501')!
      const evt = (aire.anomalyEventExecutions ?? []).find(e => e.eventId === 'aire_absolute_pitch_release')
      return evt?.count ?? 0
    }
    config.setMechanicSetting('aire.cheerEnergyBonus', 200)
    const on = pitchOf()
    config.setMechanicSetting('aire.cheerEnergyBonus', 0)
    const off = pitchOf()
    // +200 应援能量 → 直接 +100 次绝对音准（每次耗 2）。CC-197 起直伤行按倍率表回能（#3 3.6/次）
    // ⇒ 多出的能量换更多强特 → 更多应援能量，真管线差值 ≥ 100（精确 +100 由纯函数用例钉住）
    expect(on - off).toBeGreaterThanOrEqual(100)
    expect(on).toBeGreaterThan(off)
  })

  it('CC-196 纯函数：同一 state 下 cheerEnergyBonus +200 ⇒ 次数恰 +100', () => {
    const state = { exSpecialCount: 10, chainCountTotal: 4, basicAttackTime: 30 }
    const cfg: any = { aireBasicCheerCycleSeconds: 3.183 }
    const off = aireAbsolutePitchCount(cfg, state, 180)
    const on = aireAbsolutePitchCount({ ...cfg, 'setting:aire.cheerEnergyBonus': 200 }, state, 180)
    expect(on - off).toBe(100)
    // 应援能量 = 10×3 + 4×4 + floor(30/3.183)=9 ⇒ 55 → floor(55/2)=27；非C6 无终结 ⇒ 全场应援 0
    expect(off).toBe(27)
    // 影画6（CC-561）：首次放大 30s ⇒ 窗口 150s ⇒ floor(150/6)=25 层（无终结 ⇒ 无首次进入 3 层）
    expect(aireAbsolutePitchCount({ ...cfg, aireCinemaLevel: 6 }, state, 180)).toBe(52)
    // 滑块 0 = 旧口径 floor(180/6)=30
    expect(aireAbsolutePitchCount({ ...cfg, aireCinemaLevel: 6, 'setting:aire.firstUltTime': 0 }, state, 180)).toBe(57)
    // 非C6 终结 3 次 ⇒ +9
    expect(aireAbsolutePitchCount(cfg, { ...state, ultimateCount: 3 }, 180)).toBe(36)
  })
})

describe('CC-125：「初始异常掌控」读局外面板', () => {
  it('buildCharConfig 记局外掌控，异放事件的 basisValue / masteryValue 取它', () => {
    const cfg: any = {}
    aireMechanic.buildCharConfig!({ cinemaLevel: 1, cfg, panel: { anomalyMastery: 180 }, outOfCombatPanel: { anomalyMastery: 140 } } as any)
    expect(cfg.aireInitialMastery).toBe(140)
    const events: any[] = []
    // 2026-10-19：次数自动，上限给足 ⇒ 事件次数由应援能量推导（计数类字段必须给全）
    aireMechanic.buildAnomalyEvents!({ cfg: { ...cfg, 'setting:aire.absolutePitchCount': 999 }, state: { frontlineTime: 120, backstageTime: 60, exSpecialCount: 8, chainCountTotal: 4 } as any, events, totalTime: 180 })
    expect(events[0].releaseRatio.basisValue).toBe(140)
    expect(events[0].releaseCrit.masteryValue).toBe(140)
  })
})