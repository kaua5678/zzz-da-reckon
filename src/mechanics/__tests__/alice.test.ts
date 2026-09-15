import { describe, expect, it } from 'vitest'
import { computePanelPhases } from '@/composables/resourceCalc/helpers'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { setupHarness } from '@/test/harness'

/** 爱丽丝（物理）+ 格莉丝（电异常，触发额外能力） */
async function setup(cinemaLevel = 0) {
  const result = await setupHarness([
    { agentId: '1401', cinemaLevel, parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
    { agentId: '1181', cinemaLevel: 0, parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
  ])
  for (const buff of result.config.globalBuffs) buff.enabled = false
  return result
}

describe('爱丽丝（1401）命座面板增益', () => {
  it('影画1：目标防御-20% 接入面板（1命 vs 0命差分）', async () => {
    const c0 = await setup(0)
    const d0 = (computePanelPhases(0, c0.config, c0.catalog)!.inCombat as any).enemyDefReduction ?? 0
    const c1 = await setup(1)
    const d1 = (computePanelPhases(0, c1.config, c1.catalog)!.inCombat as any).enemyDefReduction ?? 0
    expect(d1 - d0).toBe(20)
  })

  it('影画2：全队强击+15% 与物理紊乱+15% 接入面板', async () => {
    const c0 = await setup(0)
    const p0 = computePanelPhases(0, c0.config, c0.catalog)!.inCombat as any
    const c2 = await setup(2)
    const p2 = computePanelPhases(0, c2.config, c2.catalog)!.inCombat as any
    expect((p2.anomalyDmgBonus ?? 0) - (p0.anomalyDmgBonus ?? 0)).toBe(15)
    expect((p2.disorderDamageBonus ?? 0) - (p0.disorderDamageBonus ?? 0)).toBe(15)
  })

  it('影画4：无视10%物理抗性接入面板', async () => {
    const c0 = await setup(0)
    const r0 = (computePanelPhases(0, c0.config, c0.catalog)!.inCombat as any).enemyPhysicalResReduction ?? 0
    const c4 = await setup(4)
    const r4 = (computePanelPhases(0, c4.config, c4.catalog)!.inCombat as any).enemyPhysicalResReduction ?? 0
    expect(r4 - r0).toBe(10)
  })
})

describe('爱丽丝影画6决胜状态额外攻击', () => {
  it('6命生成决胜状态额外攻击行（3300% 精通 × 必定暴击），0命不生成', async () => {
    await setup(6)
    const calc6 = useResourceCalc()
    const rows6 = calc6.damagePoolRows.value.filter(r => r.type === '爱丽丝6命附伤')
    expect(rows6.length).toBeGreaterThan(0)
    for (const row of rows6) {
      expect(row.totalDamage).toBeGreaterThan(0)
      expect(row.element).toBe('physical')
      expect(row.note ?? '').toContain('必定暴击')
    }
  })

  it('0命不生成决胜状态额外攻击行', async () => {
    await setup(0)
    const calc0 = useResourceCalc()
    const rows0 = calc0.damagePoolRows.value.filter(r => r.type === '爱丽丝6命附伤')
    expect(rows0.length).toBe(0)
  })
})

describe('爱丽丝畏缩 DOT', () => {
  it('畏缩 DOT 进入伤害池（type=畏缩 DOT，element=physical）', async () => {
    await setup(0)
    const calc = useResourceCalc()
    // 异常池已算出畏缩 DOT 总伤害
    const dot = calc.anomalyPoolResult.value?.aliceCoweringDot
    expect(dot?.totalDotDamage ?? 0).toBeGreaterThan(0)
    // 曾遗漏：畏缩 DOT 只在 ResultPage 单独展示、未进 damagePoolRows（团队总伤害漏算）
    const rows = calc.damagePoolRows.value.filter(r => r.type === '畏缩 DOT')
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect(row.element).toBe('physical')
      expect(row.totalDamage).toBeGreaterThan(0)
      expect(row.count).toBeGreaterThan(0)
    }
  })
})

describe('爱丽丝滑块生效差分（防守卫冻结，SOP §3.5）', () => {
  it('alice.cinema6PerStateCount → 6命决胜额外攻击次数差分（damagePool 决胜追击行）', async () => {
    const { config } = await setupHarness([{ agentId: '1401', cinemaLevel: 6 }, { agentId: '1181' }])
    const extraOf = () => {
      const calc = useResourceCalc()
      const row = calc.damagePoolRows.value.find(r => r.id === 'alice-c6-decisive-extra-attack')
      return row?.count ?? 0
    }
    config.setMechanicSetting('alice.cinema6PerStateCount', 6)
    const on = extraOf()
    config.setMechanicSetting('alice.cinema6PerStateCount', 2)
    const off = extraOf()
    expect(on).toBeGreaterThan(0)
    // 总次数 = 状态进入次数 × perStateCount：6/2 档位比值 3
    expect(on / off).toBeCloseTo(3, 5)
  })
})

/**
 * 剑仪的两条外部次数源（全队强击 / 紊乱）——2026-09-15 修复的结构性死参数。
 *
 * 修复前：`buildAliceSwordWillSource(cfg, state)` 的三个调用点**都没传第 3 参**
 * `anomalyPoolData` ⇒ `?? 0` 兜底 ⇒ spec `1401.json` 里声明 `status:"implemented"` 的
 * `alice_team_assault_gain` / `alice_disorder_gain` 两条 gain 规则**恒产 0**
 * （声明已实现、结构上拿不到数）。
 *
 * 三条断言各盯一个**会红的失败模式**（不是复读实现）：
 *  ① 收入真的 > 0（改回不传参即红）；
 *  ② 紊乱那条的**额外能力门控**真的生效（门控未过不算钱，防「单爱丽丝队算多」）；
 *  ③ 强击只算**爱丽丝自己**触发的（原文主语是「爱丽丝」，队友触发的不给她的剑仪）。
 */
describe('爱丽丝剑仪外部次数源（全队强击 / 紊乱）', () => {
  /** 爱丽丝(物理) + 格莉丝(电异常) + 11号(火强攻)：多属性 ⇒ 会紊乱；有物理 ⇒ 会强击 */
  async function setupMulti() {
    const r = await setupHarness([
      { agentId: '1401', cinemaLevel: 0, parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
      { agentId: '1181', cinemaLevel: 0, parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
      { agentId: '1041', cinemaLevel: 0, parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
    ], { recommendedBuild: true })
    for (const buff of r.config.globalBuffs) buff.enabled = false
    return r
  }
  const srcOf = () => {
    const calc = useResourceCalc()
    return {
      calc,
      src: calc.resourceResult.value?.characters.find(c => c.agentId === '1401')?.aliceSwordWillSource,
    }
  }

  it('★ 两条收入真的进池（修复前恒 0）：teamAssaultGain>0 且 disorderGain>0', async () => {
    await setupMulti()
    const { calc, src } = srcOf()
    const ap = calc.anomalyPoolResult.value
    expect(ap, '该队应当产出异常池结果').toBeTruthy()
    // 前置：异常池真的产出了这两类次数（否则下面的 >0 断言可能因"没触发"而假红）
    const physical = ap!.perElement.find(p => p.element === 'physical')?.triggerCount ?? 0
    expect(physical, '爱丽丝是物理角色，应当触发过强击').toBeGreaterThan(0)
    expect(ap!.disorderCount, '三属性队应当触发过紊乱').toBeGreaterThan(0)

    expect(src!.teamAssaultGain, '全队强击收入必须 >0（修复前恒 0）').toBeGreaterThan(0)
    expect(src!.disorderGain, '紊乱收入必须 >0（修复前恒 0）').toBeGreaterThan(0)
    // 10 剑意/次强击、30 剑意/次紊乱（alice.ts 的 TEAM_ASSAULT_SWORD_WILL / DISORDER_SWORD_WILL）
    expect(src!.teamAssaultGain % 10).toBe(0)
    expect(src!.disorderGain % 30).toBe(0)
  })

  it('★ 紊乱收入带额外能力门控：同队型门控开/关决定这笔钱在不在', async () => {
    // 同一支两人队（爱丽丝 + 11号），只翻「额外能力是否触发」这一个开关。
    // ⚠ 必须**双向**断言：只断「未过=0」的话，整条通道死掉（永远 0）时该用例也是绿的 ——
    //   那正是本次要修的那个 bug 的形态，不能再用它当判据。
    const { config } = await setupHarness([
      { agentId: '1401', cinemaLevel: 0, parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
      { agentId: '1041', cinemaLevel: 0, parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
    ], { recommendedBuild: true })
    for (const buff of config.globalBuffs) buff.enabled = false
    // 该队型不满足额外能力（无第二名单异常/支援）⇒ 紊乱收入 0
    const without = srcOf().src!
    expect(without.disorderGain, '额外能力未触发时不该拿紊乱剑仪').toBe(0)
    // 双向：门控开 ⇒ 同一份次数应当透传（证明通道活着，不是"永远 0"）
    const { cfgExternalCountsProbe } = await import('@/mechanics/agents/alice')
    const withOn = cfgExternalCountsProbe({
      aliceTeamAssaultCount: 0,
      aliceDisorderCount: 5,
      aliceAdditionalAbilityActive: true,
    })
    expect(withOn.disorderCount, '门控开启时紊乱次数应当透传（通道活着）').toBe(5)
    const withOff = cfgExternalCountsProbe({
      aliceTeamAssaultCount: 0,
      aliceDisorderCount: 5,
      aliceAdditionalAbilityActive: false,
    })
    expect(withOff.disorderCount, '门控关闭时应当归零').toBe(0)
  })

  it('★ 强击只算爱丽丝自己触发的（原文主语「爱丽丝」，队友触发的不给）', async () => {
    // 柚叶(1411 支援·物理) 会自己打出物理强击 ⇒ team 口径与 self 口径必然不同
    const { config } = await setupHarness([
      { agentId: '1401', cinemaLevel: 0, parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
      { agentId: '1411', cinemaLevel: 0, parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
      { agentId: '1031', cinemaLevel: 0, parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
    ], { recommendedBuild: true })
    for (const buff of config.globalBuffs) buff.enabled = false
    const { calc, src } = srcOf()
    const ap = calc.anomalyPoolResult.value
    const phys = ap?.perElement.find(p => p.element === 'physical')
    const perSlot = phys?.perSlotTriggerCounts ?? []
    const aliceSlot = calc.resourceResult.value?.characters.find(c => c.agentId === '1401')?.slot ?? -1
    expect(aliceSlot, '爱丽丝应当在队里').toBeGreaterThanOrEqual(0)
    const aliceOnly = perSlot[aliceSlot] ?? 0
    const teamWide = phys?.triggerCount ?? 0
    // 前提：队友真的也打了强击（否则这条断言退化，测不出 self 口径）
    expect(teamWide, '柚叶是物理角色，应当也贡献了强击（否则本用例测不出 self 口径）')
      .toBeGreaterThan(aliceOnly)
    // 收入 = 爱丽丝自己的次数 × 10，**不是**全队次数 × 10
    expect(src!.teamAssaultGain).toBe(aliceOnly * 10)
    expect(src!.teamAssaultGain).not.toBe(teamWide * 10)
  })

  it('★ 极性强击不重复计入强击收入（它另有 alice_polarity_feedback 规则）', async () => {
    await setupMulti()
    const { calc, src } = srcOf()
    const ap = calc.anomalyPoolResult.value
    const phys = ap?.perElement.find(p => p.element === 'physical')?.triggerCount ?? 0
    const polar = ap?.perElement.find(p => p.element === 'physical_polar_assault')?.triggerCount ?? 0
    expect(polar, '该队应当触发过极性强击（星芒圆舞曲#3 赠送）').toBeGreaterThan(0)
    // 强击收入只按 physical 计数：若把 physical_polar_assault 也加进来会多算 polar×10
    expect(src!.teamAssaultGain).toBeLessThan((phys + polar) * 10)
  })
})
