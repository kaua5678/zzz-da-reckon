/**
 * 星见雅(1091) 命座生效测试：对齐 character-constellations.json 的定案口径。
 * - M1 落霜无视防御 / M2 暴击与风花闪反增伤+入场6落霜 / M4 霜灼·破+30% / M6 极意+30%；
 * - 各命座逐级抬高全管线伤害（C0 < C2 < C4 < C6），防「录了没生效」。
 */
import { describe, expect, it } from 'vitest'
import { miyabiMechanic } from '@/mechanics/agents/miyabi'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { useCatalogStore } from '@/stores/catalog'
import { panelAt } from '@/core/panel'

describe('星见雅 transform 面板累积回归（2026-09-01：收敛轮间叠成 600 积蓄效率）', () => {
  it('C6 面板 anomalyBuildUpEfficiency 为单次合理值（远小于累积的 600）', async () => {
    const { config } = await setupHarness([{ agentId: '1091', cinemaLevel: 6 }, '', ''])
    for (const buff of config.globalBuffs) buff.enabled = false
    const calc = useResourceCalc()
    void calc.damagePoolRows.value // 触发 calcOutput → transform 跑完
    // 冰焰（min(上限, 暴击率)×覆盖率）+ 霜灼 20；曾因 transform 裸 `+=` 叠成 600
    const eff = calc.panels.value?.[0]?.anomalyBuildUpEfficiency ?? 0
    expect(eff).toBeLessThan(100)
    expect(eff).toBeGreaterThan(0)
  })
})

describe('星见雅命座生效（全管线）', () => {
  async function damageAt(cinemaLevel: number): Promise<number> {
    const { config } = await setupHarness([{ agentId: '1091', cinemaLevel }, '', ''])
    const calc = useResourceCalc()
    const dmg = calc.teamTotalDamage.value
    // 还原现场，避免影响同文件后续用例的 store 状态
    config.team[0].cinemaLevel = 0
    return dmg
  }

  it('C0 > 0 且各命座逐级有效：C2 > C0、C4 ≥ C2、C6 > C4', async () => {
    const d0 = await damageAt(0)
    expect(d0).toBeGreaterThan(0)
    const d2 = await damageAt(2)
    expect(d2).toBeGreaterThan(d0)
    const d4 = await damageAt(4)
    expect(d4).toBeGreaterThanOrEqual(d2)
    const d6 = await damageAt(6)
    expect(d6).toBeGreaterThan(d4)
  })
})

describe('星见雅滑块生效差分（防守卫冻结，SOP §3.5：改滑块→结果确实变）', () => {
  it('miyabi.iceFlameCoverage → 冰焰积蓄效率差分（applyPanel 静态消费）', () => {
    // coverage 由 applyPanel 从 settings 算（显式非 1 值优先，否则按队伍/命座自动默认）；
    // 消费在 applyMiyabiPanel：iceFlameBonus = min(80, critRate) × coverage。
    // 核心被动「所有单位 +20%」已迁到 teamPanelEffects（F2 裁决 2026-09-25 改全队），
    // 直接调 applyPanel 不再含这 +20；该条由 C1 全队用例与霜灼全队行为另行覆盖。
    const efficiencyFor = (coverage: number, critRate = 20) => {
      const panel: any = { critRate, anomalyBuildUpEfficiency: 0, miyabiHasWindTeammate: 0 }
      miyabiMechanic.applyPanel!({
        slot: 0, agent: null, cinemaLevel: 0, team: [],
        panel, settings: { 'miyabi.iceFlameCoverage': coverage },
      } as never)
      return panel.anomalyBuildUpEfficiency
    }
    const on = efficiencyFor(0.8)
    const off = efficiencyFor(0.2)
    // 0.8 → 20×0.8=16；0.2 → 20×0.2=4（均不含已迁走的核心被动 +20）
    expect(on).toBeCloseTo(20 * 0.8, 1)
    expect(off).toBeCloseTo(20 * 0.2, 1)
    expect(on - off).toBeCloseTo(20 * 0.6, 1)
    // 面板链路原点：setting 经 resolveMechanicSettings → applyPanel 静态算 coverage
    const p2: any = { critRate: 20, anomalyBuildUpEfficiency: 0, miyabiHasWindTeammate: 0 }
    miyabiMechanic.applyPanel!({
      slot: 0, agent: null, cinemaLevel: 0, team: [],
      panel: p2, settings: { 'miyabi.iceFlameCoverage': 0.8 },
    } as never)
    expect(p2.miyabiIceFlameCoverage).toBeCloseTo(0.8, 5)
  })

  it('miyabi.frostburnBreakCount / frostburnBreakRate → 霜灼·破次数差分（buildExecutions）', async () => {
    const { config } = await setupHarness([{ agentId: '1091', cinemaLevel: 0 }, '', ''])
    const frostbreakCountOf = () => {
      const calc = useResourceCalc()
      const row = calc.resourceResult.value!.characters[0].executions.find(e => e.moveId === 'miyabi_frostburn_break')
      return row?.count ?? 0
    }
    // 次数滑块显式覆盖：12 次
    config.setMechanicSetting('miyabi.frostburnBreakCount', 12)
    expect(frostbreakCountOf()).toBe(12)
    config.setMechanicSetting('miyabi.frostburnBreakCount', 6)
    expect(frostbreakCountOf()).toBe(6)
    // 比率滑块：次数=0（自动）时按强特数×比率
    config.setMechanicSetting('miyabi.frostburnBreakCount', 0)
    config.setMechanicSetting('miyabi.frostburnBreakRate', 2)
    const doubled = frostbreakCountOf()
    config.setMechanicSetting('miyabi.frostburnBreakRate', 1)
    const base = frostbreakCountOf()
    expect(doubled).toBe(base * 2)
    expect(base).toBeGreaterThan(0)
  })
})

/**
 * ★ C1 全队异常积蓄效率 +20% 的**生效判据**（影画一第二分句）。
 *
 * 原文：斩击命中[霜灼]敌人并消除[霜灼]时，全队角色属性异常积蓄效率提升 20%，持续 10 秒。
 *
 * ## 为什么需要这条测试（1091.json 重复 `teamBuffs` 键事故）
 *
 * `src/specs/agents/1091.json` 曾有**两个** `teamBuffs` 键：L110 的真实声明
 * （含 `miyabi_c1_team_buildup`）与 L143 的 `[]`。`JSON.parse` 对重复键**后者胜**
 * ⇒ 运行时读到的 `teamBuffs` 恒为 `[]`，而 L143 在文件里**排在 `notes` 之后**、
 * 位置隐蔽（紧随命座 notes，看起来像"本角色无拐力"的正常声明）。
 * 后果：C1 的 +20 在全管线**静默丢失**，而 spec 文件肉眼"明明写着"这条 buff。
 *
 * 本用例的断言**只钉 delta、不钉绝对值**——探针跑的是 harness 兜底盘（`recommendedBuild: false`
 * 时主C也穿 34200 荆棘玫瑰 2件套防御 +16%）且 `globalBuffs` 被显式关闭，绝对值不可移植
 * （见 harness 头注释）。delta = 同一队伍同配置下**只切这一条 buff 开关**的差。
 *
 * 门控链（R2-E 取证已确认自动正确，本用例同时反锁它）：
 * `deriveTeammateBuffEnabled` 读 `source: '影画一'` → `parseCinemaRequirement` = 1
 * ⇒ `enabled = 在队 && cinemaLevel >= 1`。
 *
 * ⚠ 为什么既有基线全盲（`timeGolden` / `timeFillRatchet` / `allAgentsSweep` 324 tests 零 delta）：
 * ① 105 预设虽含雅队（`preset:auto-1091-1511-1411` 等 5 条），但预设路径 `cinemaLevel` 全 **0**
 *    ⇒ 门控关；② 60 角色 × 命座单飞是**单槽无队友**，C6 时 buff 虽活、雅本人面板 +20，
 *    但总伤/失衡读数不动。⇒ 生效证据只能由本用例这种「C1 + 有队友」的手组队形态提供。
 */
describe('星见雅 C1 全队积蓄效率 +20%（影画一第二分句·生效判据）', () => {
  const BUFF_ID = 'miyabi_c1_team_buildup'
  const MIYABI_SLOT = 0
  const TEAMMATE_SLOT = 1
  // 影画一 → 需 C1 的雅 + 一名队友（队友用于验证"全队"而非仅自身）
  const C1_TEAM: Parameters<typeof setupHarness>[0] = [{ agentId: '1091', cinemaLevel: 1 }, { agentId: '1131' }, '']
  const C0_TEAM: Parameters<typeof setupHarness>[0] = [{ agentId: '1091', cinemaLevel: 0 }, { agentId: '1131' }, '']
  // 不含雅：门控应恒关（"零影响面"对照）
  const NO_MIYABI_TEAM: Parameters<typeof setupHarness>[0] = [{ agentId: '1131' }, { agentId: '1211' }, '']

  /** 该条在 teammateBuffGroups 里的注册条数（0 = spec 声明根本没进运行时）。 */
  function registeredCount(): number {
    const catalog = useCatalogStore()
    return catalog.teammateBuffGroups
      .flatMap(g => (g.buffs ?? []).map(b => b.id))
      .filter(id => id === BUFF_ID).length
  }

  /**
   * 同一队独立装配一次，读回「自动门控态 / 雅 / 队友 的积蓄效率 / 总伤」。
   * `force` 省略 = 用自动门控结果；给了值则显式覆盖开关（用于取**同配置**的对照读数）。
   */
  async function probe(team: Parameters<typeof setupHarness>[0], force?: boolean) {
    const { config } = await setupHarness(team)
    for (const buff of config.globalBuffs) buff.enabled = false
    const auto = config.isTeammateBuffEnabled(BUFF_ID)
    if (force !== undefined) config.toggleTeammateBuff(BUFF_ID, force)
    const calc = useResourceCalc()
    void calc.damagePoolRows.value // 触发 transform 跑完（同本文件首条用例）
    return {
      auto,
      enabled: config.isTeammateBuffEnabled(BUFF_ID),
      miyabiEff: panelAt(calc.panels.value, MIYABI_SLOT)?.anomalyBuildUpEfficiency ?? 0,
      teammateEff: panelAt(calc.panels.value, TEAMMATE_SLOT)?.anomalyBuildUpEfficiency ?? 0,
      damage: calc.teamTotalDamage.value,
    }
  }

  it('C1 队：队友与雅本人的 anomalyBuildUpEfficiency 各 +20（钉 delta，不钉绝对值）', async () => {
    const on = await probe(C1_TEAM)
    const off = await probe(C1_TEAM, false)
    // ★ 主判据先行：delta 是"这条 buff 有没有进数值通道"的唯一直接读数。
    // 重复 teamBuffs 键未删时 on 与 off 都是关断态 ⇒ delta 恒 0（先红）。
    // 「全队角色」：队友（槽1 苍角）与来源角色本人（槽0 雅）同吃 +20（includeOwner: true）
    expect(on.teammateEff - off.teammateEff, `队友 delta（on=${on.teammateEff} off=${off.teammateEff}）`)
      .toBeCloseTo(20, 5)
    expect(on.miyabiEff - off.miyabiEff, `雅本人 delta（on=${on.miyabiEff} off=${off.miyabiEff}）`)
      .toBeCloseTo(20, 5)
    // 门控链反锁（R2-E 取证：source '影画一' → parseCinemaRequirement = 1）
    expect(registeredCount(), `spec 声明的 ${BUFF_ID} 必须进 teammateBuffGroups`).toBe(1)
    expect(on.auto, 'C1 在队 + 影画一 ⇒ 自动激活').toBe(true)
    expect(off.enabled, '显式关断后应读到关（证明 delta 不是恒真）').toBe(false)
  })

  it('C0 队：门控关断且面板/伤害零变化（C1 效果不得泄漏到 0 命）', async () => {
    const auto = await probe(C0_TEAM)
    const off = await probe(C0_TEAM, false)
    expect(auto.auto, 'C0 < 影画一 ⇒ 自动门控必须关').toBe(false)
    // 反空洞：管线必须真的跑起来（否则「零变化」只是「什么都没算」）
    expect(auto.damage, 'C0 队应有非零总伤读数').toBeGreaterThan(0)
    // 「零变化」= C0 的自动态与显式关断态逐位一致 ⇒ 门控确实拦住了
    expect(auto.teammateEff).toBe(off.teammateEff)
    expect(auto.miyabiEff).toBe(off.miyabiEff)
    expect(auto.damage).toBe(off.damage)
    // ★ 灵敏度反锁（防"零变化"是空转）：同一条 buff 在 C0 队**显式打开**必须仍给出 +20
    // ⇒ 通道是活的、读数可动，C0 的零变化来自**门控**而非通道坏死。
    const forced = await probe(C0_TEAM, true)
    expect(forced.teammateEff - off.teammateEff, '显式打开后队友应 +20（证明通道可动）')
      .toBeCloseTo(20, 5)
  })

  it('不含雅的队伍：门控恒关且面板/伤害零变化（零影响面对照）', async () => {
    const auto = await probe(NO_MIYABI_TEAM)
    const off = await probe(NO_MIYABI_TEAM, false)
    expect(auto.auto, '雅不在队 ⇒ 门控必须关').toBe(false)
    expect(auto.damage, '该队应有非零总伤读数').toBeGreaterThan(0)
    expect(auto.teammateEff).toBe(off.teammateEff)
    expect(auto.miyabiEff).toBe(off.miyabiEff)
    expect(auto.damage).toBe(off.damage)
  })
})

describe('星见雅核心被动「所有单位」积蓄 +20% 改全队（F2 裁决 2026-09-25）', () => {
  const MIYABI_SLOT = 0
  const TEAMMATE_SLOT = 1
  // 无风队（1091 雅 + 1131 苍角）：核心被动 +20% 应覆盖全队；C0 即激活（不依赖影画一）。
  const C0_TEAM: Parameters<typeof setupHarness>[0] = [{ agentId: '1091', cinemaLevel: 0 }, { agentId: '1131' }, '']
  // 无雅对照：核心被动 channel 不得泄漏（雅不在队 ⇒ 无 +20）。
  const NO_MIYABI_TEAM: Parameters<typeof setupHarness>[0] = [{ agentId: '1131' }, { agentId: '1211' }, '']

  async function effPair(team: Parameters<typeof setupHarness>[0]) {
    await setupHarness(team)
    const calc = useResourceCalc()
    void calc.damagePoolRows.value
    return {
      miyabiEff: panelAt(calc.panels.value, MIYABI_SLOT)?.anomalyBuildUpEfficiency ?? 0,
      teammateEff: panelAt(calc.panels.value, TEAMMATE_SLOT)?.anomalyBuildUpEfficiency ?? 0,
    }
  }

  it('无风队：雅本人与队友的 anomalyBuildUpEfficiency 均含核心被动 +20（F2 全队）', async () => {
    const withMiyabi = await effPair(C0_TEAM)
    const withoutMiyabi = await effPair(NO_MIYABI_TEAM)
    // 雅在队时，本人与队友都比「无雅对照」多 +20（核心被动唯一来源 = 雅）。
    expect(withMiyabi.miyabiEff - withoutMiyabi.teammateEff,
      `雅本人 delta（in=${withMiyabi.miyabiEff} ref=${withoutMiyabi.teammateEff}）`)
      .toBeGreaterThanOrEqual(20)
    expect(withMiyabi.teammateEff - withoutMiyabi.teammateEff,
      `队友 delta（in=${withMiyabi.teammateEff} ref=${withoutMiyabi.teammateEff}）`)
      .toBeCloseTo(20, 5)
  })

  it('CC-335 有风队：雅本人与队友的 anomalyBuildUpEfficiency 均被风队门控（队友不误吃核心被动 +20）', async () => {
    const windTeam: Parameters<typeof setupHarness>[0] = [
      { agentId: '1091', cinemaLevel: 0 },
      { agentId: '1131' },
      { agentId: '1561' }, // 维琳娜（风属性队友）
    ]
    const withWind = await effPair(windTeam)
    const withoutMiyabi = await effPair(NO_MIYABI_TEAM)
    // 队友槽（苍角）：有风队时不吃核心被动 +20（修复前队友槽 panel.miyabiHasWindTeammate 为 undefined 误得 +20）
    expect(withWind.teammateEff - withoutMiyabi.teammateEff).toBeCloseTo(0, 5)
    // 雅本人：有风队时仅保留自身冰焰（5% 基础暴击 × 100% 冰焰覆盖 = +5），不叠核心被动霜灼 +20
    expect(withWind.miyabiEff - withoutMiyabi.teammateEff).toBeCloseTo(5, 5)
  })
})
