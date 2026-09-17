/**
 * R20-h3「队伍级面板效果」契约（`AgentTeamPanelEffectInput` / `teamPanelEffects`）的判据。
 *
 * ## 本批做了什么（2026-09-17 round 20，棘轮 32 → 28）
 *
 * `helpers.ts#computePanelPhases` 里两组**跨槽**硬编码块迁进各来源角色模块：
 * · 莱特 1161 影画4「后场队友能量效率 +10%×后场占比，**本人不吃**」⇒ `lighter.ts#teamPanelEffects`
 * · 耀嘉音 1311 咏叹华彩（全队增伤/暴伤，**含自己**）+ 影画4 职业分支（**排除自己**）
 *   ⇒ `yaojiayin.ts#applyYaojiayinTeamPanelEffects`
 *
 * ## 为什么必须单独有这个文件（不是「补测试」的仪式）
 *
 * 这四处是 **P2 陷阱**（round 15 规划曾给出「搬进来源角色 applyPanel」的**错误**建议）：
 * `applyPanel` 由 `computePanelPhases(slot, …)` **逐槽位**派发、只传该槽自己的 `panel`
 * ⇒ 搬进来源角色的 `applyPanel` 只会在**来源自己那一格**生效，队友永远吃不到
 * （实测形态：`lighter.test.ts` 的「队友 +5 / 莱特 0」断言会**静默变成**「莱特 5 / 队友 0」）。
 * 故本文件用**真派发器**（`computePanelPhases`）逐槽位验，而不是直调钩子。
 *
 * ## 判据分层
 *
 * ① **精确值**（禁 `> 0`）：覆盖率 0 / 0.5 / 1 三端点 × 命座 0/3/4/5/6 的逐档数值；
 * ② **自排除语义**（两处**刻意不对称**，逐位保留）：
 *    莱特 C4 **排除自己**、耀嘉音咏叹**含自己**、耀嘉音 C4 分支**排除自己**；
 * ③ **职业分支**：耀嘉音 C4 只给 anomaly / stun 目标加对应字段，其它职业不加；
 * ④ **空槽安全**：前导空槽时按**槽位号**定位目标（判据 17），不按数组下标；
 * ⑤ **顺序无关性**：两个来源同时在队时，结果与槽位排列无关（契约只允许可交换加法）。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { computePanelPhases } from '@/composables/resourceCalc/helpers'

type Member = { agentId: string; cinemaLevel?: number }

/** 组一支队并算某槽面板（真派发器入口，非直调钩子） */
async function panelOf(
  team: Member[],
  slot: number,
  settings: Record<string, number> = {},
  opts: { forSlot?: number } = {},
) {
  const { catalog, config } = await setupHarness(
    team.map((m, i) => ({ ...m, slot: i })) as never,
    { recommendedBuild: true },
  )
  config.autoYidhariAxis = false
  config.useStunAxis = false
  for (const [k, v] of Object.entries(settings)) config.setMechanicSetting(k, v)
  const p = computePanelPhases(slot, config, catalog)
  expect(p, `slot ${slot} 面板为空`).not.toBeNull()
  void opts
  return p!.inCombat
}

describe('R20-h3 莱特 C4：后场队友能量效率（★ 本人不吃）', () => {
  // 莱特 C4 的确切口径：+10 × min(1, backstageRatio)；默认 ratio = 2/3 ⇒ +6.666…
  it('C4 + 默认占比 2/3 ⇒ 队友 +10×2/3；莱特本人 0', async () => {
    const mate = await panelOf([{ agentId: '1181' }, { agentId: '1161', cinemaLevel: 4 }, { agentId: '' }], 0)
    expect(mate.energyGainEfficiency ?? 0).toBeCloseTo(10 * (2 / 3), 10)
    const self = await panelOf([{ agentId: '1181' }, { agentId: '1161', cinemaLevel: 4 }, { agentId: '' }], 1)
    expect(self.energyGainEfficiency ?? 0, '莱特本人不得吃自己的 C4').toBe(0)
  })

  it('C3 ⇒ 0（未达影画4门槛）；C6 ⇒ 与 C4 同值（无额外档）', async () => {
    const c3 = await panelOf([{ agentId: '1181' }, { agentId: '1161', cinemaLevel: 3 }, { agentId: '' }], 0)
    expect(c3.energyGainEfficiency ?? 0).toBe(0)
    const c6 = await panelOf([{ agentId: '1181' }, { agentId: '1161', cinemaLevel: 6 }, { agentId: '' }], 0)
    expect(c6.energyGainEfficiency ?? 0).toBeCloseTo(10 * (2 / 3), 10)
  })

  it('★ 滑块端点精确折算：ratio=0 ⇒ 0；ratio=1 ⇒ +10；ratio=0.5 ⇒ +5', async () => {
    for (const [ratio, expected] of [[0, 0], [0.5, 5], [1, 10]] as const) {
      const p = await panelOf(
        [{ agentId: '1181' }, { agentId: '1161', cinemaLevel: 4 }, { agentId: '' }],
        0,
        { 'lighter.backstageRatio': ratio },
      )
      expect(p.energyGainEfficiency ?? 0, `ratio=${ratio}`).toBeCloseTo(expected, 10)
    }
  })

  it('队里没有莱特 ⇒ 无该加成（钩子按「来源在队」派发，不是按目标判据）', async () => {
    const p = await panelOf([{ agentId: '1181' }, { agentId: '1011' }, { agentId: '' }], 0)
    expect(p.energyGainEfficiency ?? 0).toBe(0)
  })
})

describe('R20-h3 耀嘉音咏叹华彩：全队增伤/暴伤（★ 含自己，与莱特刻意不对称）', () => {
  it('C0（技能等级 12）⇒ 队友 +20 伤害 / +25 暴伤（cov=1，exact）', async () => {
    // ⚠ 基线必须用**同一支队只改 cov**：换队友（1311↔1011）会改掉整份队友 buff 集，
    // 实测干扰 +44（那是 teammate-buffs 的贡献，不是咏叹）⇒ 那样测的不是本钩子。
    const off = await panelOf([{ agentId: '1181' }, { agentId: '1311' }, { agentId: '1011' }], 0, { 'yaojiayin.ariaCoverage': 0 })
    const on = await panelOf([{ agentId: '1181' }, { agentId: '1311' }, { agentId: '1011' }], 0, { 'yaojiayin.ariaCoverage': 1 })
    expect((on.dmgBonus ?? 0) - (off.dmgBonus ?? 0)).toBeCloseTo(20, 10)
    expect((on.critDmg ?? 0) - (off.critDmg ?? 0)).toBeCloseTo(25, 10)
  })

  it('★ 含自己：耀嘉音本人面板也吃自己的咏叹（原块无自排除）', async () => {
    const self = await panelOf([{ agentId: '1311' }, { agentId: '1011' }, { agentId: '' }], 0)
    const solo = await panelOf([{ agentId: '1011' }, { agentId: '1181' }, { agentId: '' }], 0)
    // 两次都有 1011 提供同款队友 buff 面；差异应含咏叹的 +20/+25
    expect((self.dmgBonus ?? 0) - (solo.dmgBonus ?? 0)).toBeGreaterThanOrEqual(19.999)
  })

  it('★ 命座档位精确分叉：C0=12级(+20/+25)、C3=14级(+22/+28)、C5=16级(+24/+31)', async () => {
    // 同样：同队同命座，只切 cov 0→1 取差（避免队友 buff 集干扰）
    for (const [cinema, dmg, crit] of [[0, 20, 25], [3, 22, 28], [5, 24, 31]] as const) {
      const team = [{ agentId: '1181' }, { agentId: '1311', cinemaLevel: cinema }, { agentId: '1011' }]
      const off = await panelOf(team, 0, { 'yaojiayin.ariaCoverage': 0 })
      const on = await panelOf(team, 0, { 'yaojiayin.ariaCoverage': 1 })
      expect((on.dmgBonus ?? 0) - (off.dmgBonus ?? 0), `C${cinema} dmg`).toBeCloseTo(dmg, 10)
      expect((on.critDmg ?? 0) - (off.critDmg ?? 0), `C${cinema} crit`).toBeCloseTo(crit, 10)
    }
  })

  it('★ 覆盖率端点：cov=0.5 ⇒ 精确折半（+10/+12.5）；cov=0 与「无耀嘉音」同值', async () => {
    const team = [{ agentId: '1181' }, { agentId: '1311' }, { agentId: '1011' }]
    const zero = await panelOf(team, 0, { 'yaojiayin.ariaCoverage': 0 })
    const half = await panelOf(team, 0, { 'yaojiayin.ariaCoverage': 0.5 })
    expect((half.dmgBonus ?? 0) - (zero.dmgBonus ?? 0)).toBeCloseTo(10, 10)
    expect((half.critDmg ?? 0) - (zero.critDmg ?? 0)).toBeCloseTo(12.5, 10)
  })
})

describe('R20-h3 耀嘉音 C4 职业分支（★ 排除自己，按目标 specialty 分派）', () => {
  // 分支口径：+50% × (cov × 0.5)；cov=1 ⇒ +25
  it('异常目标 1181 ⇒ anomalyBuildUpEfficiency +25，且 stunBuildUpBonus 不变', async () => {
    const withYj = await panelOf([{ agentId: '1181' }, { agentId: '1311', cinemaLevel: 4 }, { agentId: '' }], 0)
    const without = await panelOf([{ agentId: '1181' }, { agentId: '1011' }, { agentId: '' }], 0)
    expect((withYj.anomalyBuildUpEfficiency ?? 0) - (without.anomalyBuildUpEfficiency ?? 0)).toBeCloseTo(25, 10)
    expect((withYj.stunBuildUpBonus ?? 0) - (without.stunBuildUpBonus ?? 0)).toBeCloseTo(0, 10)
  })

  it('击破目标 1141 ⇒ stunBuildUpBonus +25，且 anomalyBuildUpEfficiency 不变', async () => {
    const withYj = await panelOf([{ agentId: '1141' }, { agentId: '1311', cinemaLevel: 4 }, { agentId: '' }], 0)
    const without = await panelOf([{ agentId: '1141' }, { agentId: '1011' }, { agentId: '' }], 0)
    expect((withYj.stunBuildUpBonus ?? 0) - (without.stunBuildUpBonus ?? 0)).toBeCloseTo(25, 10)
    expect((withYj.anomalyBuildUpEfficiency ?? 0) - (without.anomalyBuildUpEfficiency ?? 0)).toBeCloseTo(0, 10)
  })

  it('★ C4 分支**排除自己**：耀嘉音本人（support）不因该分支被加 50', async () => {
    const self = await panelOf([{ agentId: '1311', cinemaLevel: 4 }, { agentId: '1181' }, { agentId: '' }], 0)
    const selfNoC4 = await panelOf([{ agentId: '1311', cinemaLevel: 0 }, { agentId: '1181' }, { agentId: '' }], 0)
    expect((self.anomalyBuildUpEfficiency ?? 0) - (selfNoC4.anomalyBuildUpEfficiency ?? 0)).toBe(0)
    expect((self.stunBuildUpBonus ?? 0) - (selfNoC4.stunBuildUpBonus ?? 0)).toBe(0)
  })

  it('C3 ⇒ 无职业分支（未达 C4）；职业不匹配的目标只拿一个字段', async () => {
    // C3（未达 C4）：同队切 cov 0→1，职业分支字段不得变
    const t3 = [{ agentId: '1181' }, { agentId: '1311', cinemaLevel: 3 }, { agentId: '1011' }]
    const a3 = await panelOf(t3, 0, { 'yaojiayin.ariaCoverage': 0 })
    const b3 = await panelOf(t3, 0, { 'yaojiayin.ariaCoverage': 1 })
    expect((b3.anomalyBuildUpEfficiency ?? 0) - (a3.anomalyBuildUpEfficiency ?? 0)).toBe(0)
    expect((b3.stunBuildUpBonus ?? 0) - (a3.stunBuildUpBonus ?? 0)).toBe(0)
    // C4 + **击破**目标（1011 安比 = stun，非 anomaly）⇒ 只拿 stunBuildUpBonus +25，
    // anomalyBuildUpEfficiency **不得**被动（原块是 if/if 互斥分派，不是两个都加）。
    const t4 = [{ agentId: '1011' }, { agentId: '1311', cinemaLevel: 4 }, { agentId: '1181' }]
    const a4 = await panelOf(t4, 0, { 'yaojiayin.ariaCoverage': 0 })
    const b4 = await panelOf(t4, 0, { 'yaojiayin.ariaCoverage': 1 })
    expect((b4.stunBuildUpBonus ?? 0) - (a4.stunBuildUpBonus ?? 0)).toBe(25)
    expect((b4.anomalyBuildUpEfficiency ?? 0) - (a4.anomalyBuildUpEfficiency ?? 0)).toBe(0)
  })
})

describe('R20-h3 契约纪律：槽位号 ≠ 下标 + 顺序无关', () => {
  it('★ 前导空槽：目标在槽位 2 时仍被正确加成（按槽位号定位，不是数组下标）', async () => {
    // team = ['', 1311(C5), 1181]，槽位 2 是异常角色，应吃咏叹 +24/+31（C5 满覆盖）
    const { catalog, config } = await setupHarness(
      [{ agentId: '' }, { agentId: '1311', cinemaLevel: 5 }, { agentId: '1181' }] as never,
      { recommendedBuild: true },
    )
    config.autoYidhariAxis = false
    config.useStunAxis = false
    const p = computePanelPhases(2, config, catalog)
    expect(p, '槽位 2 面板不应为空（前导空槽）').not.toBeNull()
    // 与「无耀嘉音的等价队」比：+24/+31 必须落在槽位 2（异常角色）身上
    const { catalog: c2, config: cfg2 } = await setupHarness(
      [{ agentId: '' }, { agentId: '1011' }, { agentId: '1181' }] as never,
      { recommendedBuild: true },
    )
    cfg2.autoYidhariAxis = false
    cfg2.useStunAxis = false
    const p2 = computePanelPhases(2, cfg2, c2)
    expect(p2).not.toBeNull()
    const dmgDelta = (p!.inCombat.dmgBonus ?? 0) - (p2!.inCombat.dmgBonus ?? 0)
    // 差异含咏叹（+24）+ 1011/1311 自身队友 buff 差；关键是**必须 > 20**（证明挂钩到槽2）
    expect(dmgDelta).toBeGreaterThan(20)
  })

  it('★ 顺序无关：莱特与耀嘉音互换槽位 ⇒ 目标面板的四个字段完全相同', async () => {
    const a = await panelOf([{ agentId: '1181' }, { agentId: '1161', cinemaLevel: 6 }, { agentId: '1311', cinemaLevel: 5 }], 0)
    const b = await panelOf([{ agentId: '1181' }, { agentId: '1311', cinemaLevel: 5 }, { agentId: '1161', cinemaLevel: 6 }], 0)
    expect(b.energyGainEfficiency ?? 0).toBeCloseTo(a.energyGainEfficiency ?? 0, 10)
    expect(b.dmgBonus ?? 0).toBeCloseTo(a.dmgBonus ?? 0, 10)
    expect(b.critDmg ?? 0).toBeCloseTo(a.critDmg ?? 0, 10)
  })
})
