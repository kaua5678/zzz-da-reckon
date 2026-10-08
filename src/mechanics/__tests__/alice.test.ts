import { describe, expect, it } from 'vitest'
import { computePanelPhases } from '@/composables/resourceCalc/panelPhases'
import { emptyPanel } from '@/core/panel'
import { calcPoolAnomalyDamage, calcPoolDirectDamage, type PoolAnomalyRow, type PoolDirectRow } from '@/composables/resourceCalc/poolDamage'

// CC-176/177 模块测试桩环境：与各用例 input 里的 enemy / anomalyMultiplier 桩值一致
const STUB_ENV = { enemy: { defense: 0, level: 60, stunVuln: 1.5 }, enemyDamageRes: {}, infectionElement: 'wind', anomalyMultiplier: 1 }
import { useResourceCalc } from '@/composables/useResourceCalc'
import { setupHarness } from '@/test/harness'
import { aliceMechanic } from '@/mechanics/agents/alice'

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
    const dot = calc.anomalyPoolResult.value?.coweringDot
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

// CC-19b 2026-09-26：块 2/4/5 经 `extraAnomalyRows` 派发点进伤害池（真管线）。
// 这条是派发点接线（`flattenAnomalyRowGroups` 消费 + 稳定排序）的自证锚点：
// 把派发点短路成空，本断言必须红。
describe('CC-19b：爱丽丝异常附加行进伤害池（extraAnomalyRows 派发点接线）', () => {
  it('极性强击行 polar-assault-damage 与畏缩行 alice-cowering-dot 进伤害池', async () => {
    // 爱丽丝(物理) + 格莉丝(电异常) + 11号(火强攻)：多属性 ⇒ 剑意攒满触发星芒圆舞曲#3 赠送极性强击
    await setupHarness([
      { agentId: '1401', cinemaLevel: 0, parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
      { agentId: '1181', cinemaLevel: 0, parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
      { agentId: '1041', cinemaLevel: 0, parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
    ], { recommendedBuild: true })
    const calc = useResourceCalc()
    const polar = calc.damagePoolRows.value.find(r => r.id === 'polar-assault-damage')
    expect(polar, '极性强击行未进伤害池（extraAnomalyRows 派发点断了）').toBeTruthy()
    expect(polar!.count).toBeGreaterThan(0)
    expect(polar!.multiplier).toBe(713)

    const dot = calc.damagePoolRows.value.find(r => r.id === 'alice-cowering-dot')
    expect(dot, '畏缩 DOT 行未进伤害池（extraAnomalyRows 派发点断了）').toBeTruthy()
    expect(dot!.count).toBeGreaterThan(0)
    expect(dot!.perDamage).toBeGreaterThan(0)
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
      panel: { additionalAbilityActive: 1 },
    })
    expect(withOn.disorderCount, '门控开启时紊乱次数应当透传（通道活着）').toBe(5)
    const withOff = cfgExternalCountsProbe({
      aliceTeamAssaultCount: 0,
      aliceDisorderCount: 5,
      panel: { additionalAbilityActive: 0 },
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

// CC-19b 2026-09-26：块 2/4/5 自 `damagePoolAnomaly.ts` 迁进模块能力 `extraAnomalyRows`
// （设计稿 `docs/mcp-cc19-extra-anomaly-rows.md` §7.1）。逐字锁 id/count/multiplier/order。
describe('CC-19b：爱丽丝 extraAnomalyRows（极性强击 / C6 决胜 / 畏缩 DoT 逐字）', () => {
  const panel = () => ({ ...emptyPanel(), atk: 1000, anomalyProficiency: 100, assaultCritRate: 50 })
  const aliceSrc = (overrides: Record<string, unknown> = {}) => ({
    sparkCount: 2,
    c2UltSparkCount: 1,
    ...overrides,
  })
  const coweringDot = {
    dotInterval: 0.95,
    dotRatio: 2.5,
    assaultDamagePerTrigger: 100,
    dotDamagePerTick: 2.5,
    totalTicks: 8,
    totalDotDamage: 20,
  }
  const input = (overrides: Record<string, unknown> = {}) => ({
    slot: 0,
    charResult: { agentId: '1401', ultimateCount: 1, aliceSwordWillSource: aliceSrc() } as never,
    windRate: 0,
    anomalyProgress: (el: string) => (el === 'physical_polar_assault'
      ? { element: 'physical_polar_assault', triggerCount: 3 } as never
      : undefined),
    buildVirtualPanel: () => null,
    buildSettlementEntries: () => [],
    axisStunFor: () => 0.5,
    enemy: { defense: 0, level: 60, stunVuln: 1.5 },
    enemyDamageRes: {},
    anomalyMultiplier: 1,
    teamAgentId: (s: number) => (s === 0 ? '1401' : ''),
    agentName: (_id: string, _s: number) => '爱丽丝',
    panel: panel() as never,
    cinemaLevel: 6,
    isAxis: false,
    stunCoverage: 1,
    inWindowFraction: () => 1,
    ultimateInAxisFraction: () => 1,
    axisInUnits: () => 0,
    getMechanicSetting: (_k: string, d: number) => d,
    anomalyPool: { coweringDot: coweringDot } as never,
    // CC-19c-2 2026-09-26：ExtraAnomalyRowsInput 再扩 6 个必填字段；爱丽丝只解构自己需要的字段，桩值不参与。
    entryPanel: undefined,
    skills: undefined,
    panelOf: () => undefined,
    teamElement: () => 'physical',
    getTeamMechanicSetting: (_k: string, d: number) => d,
    elementLabel: (el: string) => el,
    // CC-176：模块内直伤走 input.directDamage（与伤害池正路同一拼装）；桩环境无侵染（emptyPanel 侵染加成 0）。
    directDamage: (row: PoolDirectRow) => calcPoolDirectDamage(STUB_ENV, row),
    // CC-177：模块内异常伤害走 input.anomalyDamage（同一拼装）。
    anomalyDamage: (row: PoolAnomalyRow) => calcPoolAnomalyDamage(STUB_ENV, row),
    ...overrides,
  })

  it('极性强击逐字：id/count/multiplier（order=20，不看命座）', () => {
    const groups = aliceMechanic.extraAnomalyRows!(input({ cinemaLevel: 0 }))
    const g = groups.find(x => x.order === 20)!
    expect(g, 'cinemaLevel<6 也必须有极性强击组（块 2 不看命座）').toBeTruthy()
    expect(g.rows[0]).toMatchObject({
      id: 'polar-assault-damage',
      slot: 0,
      agentId: '1401',
      agentName: '爱丽丝',
      type: '极性强击',
      name: '极性强击（三蓄赠送）',
      element: 'physical_polar_assault',
      source: '三蓄赠送触发 · 无视积蓄进度 · 爱丽丝面板',
      count: 3,
      multiplier: 713,
    })
    expect(g.rows[0].perDamage).toBeGreaterThan(0)
    expect(g.rows[0].totalDamage).toBe(g.rows[0].perDamage * 3)
  })

  it('C6 行逐字：id/count（order=40，状态进入 2+1 次 × 5）', () => {
    const groups = aliceMechanic.extraAnomalyRows!(input())
    const g = groups.find(x => x.order === 40)!
    expect(g.rows[0]).toMatchObject({
      id: 'alice-c6-decisive-extra-attack',
      slot: 0,
      agentId: '1401',
      type: '爱丽丝6命附伤',
      name: '爱丽丝6命决胜状态额外攻击',
      element: 'physical',
      count: 15, // (sparkCount 2 + ultimateCount 1) × perStateCount 5
    })
  })

  it('畏缩行逐字：id/count/perDamage（order=50）', () => {
    const groups = aliceMechanic.extraAnomalyRows!(input())
    const g = groups.find(x => x.order === 50)!
    expect(g.rows[0]).toMatchObject({
      id: 'alice-cowering-dot',
      slot: 0,
      agentId: '1401',
      type: '畏缩 DOT',
      name: '爱丽丝畏缩 DOT',
      element: 'physical',
      source: '畏缩状态 · 每 0.95s 强击伤害 2.5%',
      count: 8,
      perDamage: 2.5,
      totalDamage: 20,
    })
  })

  it('三组齐全时 order 依次为 20/40/50', () => {
    const groups = aliceMechanic.extraAnomalyRows!(input())
    expect(groups.map(g => g.order)).toEqual([20, 40, 50])
  })

  it('cinemaLevel<6 → 不含 C6 组（极性强击/畏缩仍在）', () => {
    const groups = aliceMechanic.extraAnomalyRows!(input({ cinemaLevel: 0 }))
    expect(groups.map(g => g.order)).toEqual([20, 50])
  })
})
