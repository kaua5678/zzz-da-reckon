import { describe, expect, it } from 'vitest'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { setupHarness } from '@/test/harness'
import { buildAnomalyVirtualPanel } from '@/composables/resourceCalc/anomalyPanels'
import { computePanelPhases, computeEntrySnapshotPanel } from '@/composables/resourceCalc/panelPhases'
import { findMoveById } from '@/data/moveTableQueries'
import { emptyPanel } from '@/core/panel'
import { calcVoidflareDamage, computeRemielleMechanic, getRemielleLevelValue, remielleMechanic, remielleFlowerFeatherDanceCasts, remielleFleetingGraceMultiplier, remielleSpecialVoidflareCount, remielleSpecialVoidflareRainbowCount, remielleSpecialVoidflareUseCount, REMIELLE_LUMEN_DRAIN_PER_SECOND, REMIELLE_LUMEN_FLIGHT_SECONDS, REMIELLE_LUMEN_FLOWER_FEATHER_THRESHOLD, REMIELLE_LUMEN_GAIN, REMIELLE_LUMEN_MAX, remielleRoundCount, REMIELLE_SPLIT_ROUND_MAX } from '@/mechanics/agents/remielle'
import type { AgentSkills } from '@/types/catalog'
import { getAgentSpec } from '@/specs/registry'
import { emptyAnomalyPool } from '@/test/fixtures'

/** 3异常队（蕾米+薇薇安+月城柳），额外能力 tier=3；globalBuffs 关掉防污染（SOP §7） */
async function setup(cinemaLevel = 0) {
  const result = await setupHarness([
    { agentId: '1581', cinemaLevel, parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
    { agentId: '1331', parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
    { agentId: '1221', parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
  ])
  for (const buff of result.config.globalBuffs) buff.enabled = false
  return result
}

describe('蕾米埃尔（1581）虚曜·耀变·异化系数', () => {
  /**
   * 惊鸿（长按平A）：「招式命中处于失衡状态的敌人时，敌人的失衡持续时间提升3秒」。
   *
   * 缺陷形态：2026-10-20 普查发现**完全未实现**——采集侧 `teammate-buffs.json` 的 1581 组里没有这条
   * （1511/1551 有、走采集 buff；1581 没有 ⇒ 需模块自己加）。实测该队 `stunDurationBonusSeconds` 恒 0。
   * 负控：删掉 `applyRemiellePanel` 里那行 ⇒ 本用例红。
   */
  it('惊鸿：失衡持续时间 +3s 进面板（此前完全未实现）', () => {
    const p = { stunDurationBonusSeconds: 0 } as never as Record<string, number>
    remielleMechanic.applyPanel!({ slot: 0, agent: { id: '1581' }, team: [], panel: p, settings: {} } as never)
    expect(p.stunDurationBonusSeconds).toBeCloseTo(3)
  })

  it('CC-120：spec resources 的 luminizeMasteryRatio（spec 记录值，不参与计算）与模块/引擎口径一致', () => {
    // spec 曾写 0.1（与模块 @fact 记载的旧转写错误相同）；resources 不被执行，只进逻辑编辑器，所以只错在展示
    const ratio = getAgentSpec('1581')?.resources?.find(r => r.id === 'remielle_voidflare')?.properties.luminizeMasteryRatio
    expect(ratio).toBe(computeRemielleMechanic({ anomalyProficiency: 100 }).luminizeMultiplierBonus / 100)
    expect(ratio).toBe(0.2)
  })

  it('异化系数 = 异常精通×0.02%；耀变倍率提升 = 异常精通×0.2%（2026-09-07 账本+原文四源校对，旧 0.1% 为转写错误）', () => {
    const s = computeRemielleMechanic({ anomalyProficiency: 500 })
    expect(s.refringeCoefficient).toBeCloseTo(10, 5)
    expect(s.luminizeMultiplierBonus).toBeCloseTo(100, 5)
    expect(s.voidflareStored).toBe(3)
    expect(s.voidflareMax).toBe(3)

    const zero = computeRemielleMechanic({ anomalyProficiency: 0 })
    expect(zero.refringeCoefficient).toBe(0)
    expect(zero.luminizeMultiplierBonus).toBe(0)
  })

  it('面板：catalog corePassive 公式进面板——耀变倍率提升=精通×0.2、异化基础=精通×0.02', async () => {
    const { config, catalog } = await setup(0)
    const p = computePanelPhases(0, config, catalog)!.inCombat
    const ap = p.anomalyProficiency ?? 0
    expect(ap).toBeGreaterThan(0)
    expect(p.remielleLuminizeMultiplierBonus).toBeCloseTo(ap * 0.2, 5)
    expect(p.remielleRefringeCoefficient).toBeCloseTo(ap * 0.02, 5)
  })

  // @fact agent:1581/异化C2加算单写者 口径: C2 异化+20 唯一写者=catalog cinemaBuffs 自身buff；teammate-buffs 条 remielle_c2_team_refringe_coefficient_bonus_pct 以 effect 级 excludeTargetAgentIds 排除蕾米本人（曾双通道双计：3异常队 C2 面板 BonusPct=50，正确 30=3异常的10+C2的20；同 buff 的 Prismatic 无视15%防御不排除、她本人照吃） | 据 账本校对@2026-09-07·复核@2026-09-25·锚未变@2026-09-27·复核@2026-09-30·复核@2026-10-07 | 验 src/mechanics/__tests__/remielle.test.ts | 锚 src/core/buff.ts#isExcludedForTarget | 信 确认
  it('C2 命座差分：3异常队 BonusPct 精确 10→30（+20 单写者，双计修复回归）；本人吃 Prismatic 无视15%防御；队友侧全队口径 30 不变', async () => {
    const c0 = await setup(0)
    const p0 = computePanelPhases(0, c0.config, c0.catalog)!.inCombat
    // 3异常 +10（teammate-buff 1581.core_passive.refringe_3_anomaly，tier=3 门控）
    expect(p0.remielleRefringeCoefficientBonusPct).toBeCloseTo(10, 5)

    const c2 = await setup(2)
    const p2 = computePanelPhases(0, c2.config, c2.catalog)!.inCombat
    // 正确值 = 3异常10 + C2的20 = 30；修复前 catalog 自身buff 与 teammate-buff 双通道各 +20 → 50
    expect(p2.remielleRefringeCoefficientBonusPct).toBeCloseTo(30, 5)
    expect(p2.remielleRefringeCoefficientBonusPct - p0.remielleRefringeCoefficientBonusPct).toBeCloseTo(20, 5)
    // C2 同一 teammate-buff 的 def-ignore 效果不排除本人（原文：队伍中[异常]角色，含蕾米自己）
    expect(p2.enemyAnomalyDefReduction).toBeCloseTo(15, 5)
    // 队友侧不受排除影响：全队异常伤害公式读到 C2+20 与 3异常+10（2026-08-26 用户口径②）
    const mate = computePanelPhases(1, c2.config, c2.catalog)!.inCombat
    expect(mate.remielleRefringeCoefficientBonusPct).toBeCloseTo(30, 5)
  })

  it('CC-220：耀变失衡易伤区按覆盖率加权（与 calcStunMultiplier 同源；覆盖率不再被当布尔吃满额）', () => {
    const panel = { ...emptyPanel(), atk: 3000, anomalyProficiency: 300, stunDmgMultiplierBonus: 20, stunDmgMultiplierBonusAlways: 0, stunDmgMultiplierBonusCapAlways: 0 }
    const dmg = (stunned: boolean | number) => calcVoidflareDamage({
      sourcePanel: panel, remiellePanel: panel, multiplier: 100, element: 'lumiflux',
      enemyDefense: 953, enemyResistances: {}, stunMultiplier: 1.5, stunned, cinema1ResIgnore: 0,
    }).damage
    const off = dmg(false)
    const full = dmg(true)
    expect(full / off).toBeCloseTo(1.7, 12) // 1.5 + 20/100
    expect(dmg(0.3)).toBeCloseTo(off * (1 + 0.7 * 0.3), 6) // 旧实现 = full（覆盖率被当 truthy）
    expect(dmg(0)).toBeCloseTo(off, 9)
  })

  /**
   * 用户 2026-10-20：「资源池里面显示的异化度还是没有算加和异化，只显示了精通加成」。
   *
   * 口径 = 用户 Excel 账本的**属性矩阵**：横轴拐力提供者、纵轴属性区，逐格记贡献再**求和**。
   * 异化度 = 异常伤害区·全队拐那一列的总和 ⇒ 卡片必须显示「本体 + 加算」，且与伤害乘区同源。
   * 负控：把 `refringeCoefficientBonusPct` 从 buildRemielleResourceResult 的入参里去掉 ⇒ 本用例红。
   */
  it('资源卡异化度 = 本体 + 加算（3异常/C2），且与伤害乘区同源', async () => {
    for (const cinema of [0, 2]) {
      const { config, catalog } = await setup(cinema)
      const calc = useResourceCalc()
      const card = calc.resourceResult.value!.characters.find(c => c.agentId === '1581')!
      const s = card.remielleMechanicSource!
      expect(s.refringeCoefficientBonusPct).toBeCloseTo(cinema >= 2 ? 30 : 10, 5)
      expect(s.refringeTotalPct).toBeCloseTo(s.refringeCoefficient + s.refringeCoefficientBonusPct, 9)
      // 卡片总值 = 蕾米面板的乘区口径（1 + 总值/100）
      const ownerPanel = computePanelPhases(0, config, catalog)!.inCombat
      expect(s.refringeTotalPct).toBeCloseTo(
        ownerPanel.remielleRefringeCoefficient + ownerPanel.remielleRefringeCoefficientBonusPct, 6,
      )
      // 与异常虚拟面板「异化度」列同值（展示侧全队唯一值）
      const vp = calc.anomalyVirtualPanels.value[0]
      if (vp) expect(vp.virtual.refringe).toBeCloseTo(s.refringeTotalPct, 6)
    }
  }, 120000)

  it('完整计算链：资源池带 remielleMechanicSource，虚耀账本随精通缩放', async () => {
    await setup()
    const calc = useResourceCalc()
    const row = calc.resourceResult.value!.characters.find(ch => ch.agentId === '1581')!
    expect(row.remielleMechanicSource).toBeTruthy()
    expect(row.remielleMechanicSource!.voidflareMax).toBe(3)
    expect(row.remielleMechanicSource!.refringeCoefficient).toBeGreaterThanOrEqual(0)
    // 展示账本与引擎公式同源不变量：耀变倍率提升(×0.2%) = 异化系数(×0.02%) × 10
    expect(row.remielleMechanicSource!.luminizeMultiplierBonus)
      .toBeCloseTo(row.remielleMechanicSource!.refringeCoefficient * 10, 5)
  })

  // @fact agent:1581/特殊虚耀×2.5独立乘区 口径: 特殊虚耀（开局虚耀·垂虹载体·全吃进场记录面板）伤害 = 垂虹耀变倍率 ×2.5 的独立乘区，只作用于特殊虚耀行 remielle-special-voidflare；普通虚耀（花羽轮舞/缭乱终幕/惊鸿载体·基础区=触发队友面板）不吃该乘区——两者基础区来源不同（特殊=蕾米自供偏低故补偿 2.5 倍、普通=队友供偏高） | 据 用户@2026-08-26（原文见 src/specs/agents/1581.json 口径行）+ 用户@2026-09-14「引擎没有就造一个乘区」·复核@2026-09-25·实测@2026-09-27（×2.5 算术落点已随 CC-9a 迁 damagePoolAnomaly.ts、再随 CC-19c-2 迁 remielle.ts 模块能力 extraAnomalyRows，口径未变）·复核@2026-09-30·复核@2026-10-07 | 验 src/mechanics/__tests__/remielle.test.ts | 锚 src/mechanics/agents/remielle.ts#extraAnomalyRows | 信 确认
  // ⟳复核: 若 ×2.5 落点迁移（如搬去 core/anomalyPool）或特殊虚耀基础区口径变化，确认全仓只保留一处 ×2.5（防 ×6.25 双计：grep -rn "rainbowMultiplier \* 2.5" src 应恰好 1 处） | 到期 2026-12-31
  it('特殊虚耀 ×2.5 独立乘区生效（2026-09-15 复核：乘区自初始提交即在线，2026-09-14「引擎零实现」审计系误判）；普通虚耀逐字不吃 ×2.5', async () => {
    const { config, catalog } = await setup(6)
    const calc = useResourceCalc()
    const rows = calc.damagePoolRows.value
    const special = rows.find(r => r.id === 'remielle-special-voidflare')
    expect(special, 'C6 3异常队必须结算特殊虚耀行').toBeTruthy()

    // —— 独立重算：垂虹（1581007）耀变倍率 × 进场记录面板（特殊虚耀口径：不吃队友战内拐） ——
    const entryPanel = computeEntrySnapshotPanel(0, config, catalog)!
    const rainbowMove = findMoveById(catalog.getAgentSkills('1581'), '1581007')
    const rainbowLuminizeRow = rainbowMove?.rows.find(r => (r as any).kind === 'luminizeMultiplier' || r.id === 'luminize_multiplier')
    const rainbowMultiplier = getRemielleLevelValue(rainbowLuminizeRow as never, entryPanel.skillLevelBonus ?? 0)
    expect(rainbowMultiplier).toBeGreaterThan(0)
    const settle = (m: number) => calcVoidflareDamage({
      sourcePanel: entryPanel,
      remiellePanel: entryPanel,
      multiplier: m,
      // 与引擎同口径：特殊虚耀跟随下一位队友的属性（夹具 teamElement = 'electric'）
      element: 'electric',
      enemyDefense: config.enemy.defense,
      enemyResistances: (config.enemy as any).damageResistances ?? (config.enemy as any).resistances ?? {},
      stunMultiplier: config.enemy.stunVuln,
      // CC-220：行级传的是全局失衡覆盖率（0-1），耀变失衡区与其余伤害同走 calcStunMultiplier 加权
      stunned: calc.stunCoverage.value,
      cinema1ResIgnore: 50,
    }).damage

    // ① 特殊虚耀行 = 基础（不乘 2.5）× 2.5（独立乘区），逐位相等
    expect(special!.perDamage).toBeCloseTo(settle(rainbowMultiplier * 2.5), 6)
    expect(special!.perDamage / settle(rainbowMultiplier)).toBeCloseTo(2.5, 9)

    // ② 普通虚耀逐字不变：各载体行基础区倍率 = 对应招式自己的耀变倍率（无 ×2.5）
    const baseMultiplierIn = (note: string) => Number(/×([\d,.]+)% × 增伤/.exec(note)?.[1]?.replace(/,/g, '') ?? NaN)
    expect(baseMultiplierIn(special!.note)).toBeCloseTo(rainbowMultiplier * 2.5, 9)
    for (const [moveId, rowId] of [['1581015', 'remielle-luminize-assist'], ['1581016', 'remielle-luminize-ultimate'], ['1581008', 'remielle-luminize-basic']] as const) {
      const move = findMoveById(catalog.getAgentSkills('1581'), moveId)
      const luminizeRow = move?.rows.find(r => (r as any).kind === 'luminizeMultiplier' || r.id === 'luminize_multiplier')
      const mult = getRemielleLevelValue(luminizeRow as never, entryPanel.skillLevelBonus ?? 0)
      const normalRows = rows.filter(r => String(r.id).startsWith(`${rowId}-`))
      expect(normalRows.length, `${rowId} 必须有普通虚耀行`).toBeGreaterThan(0)
      for (const r of normalRows) {
        expect(baseMultiplierIn(r.note)).toBeCloseTo(mult, 9)
        expect(baseMultiplierIn(r.note)).not.toBeCloseTo(mult * 2.5, 3)
      }
    }
  })
})

// CC-19c-2 2026-09-26：块 6（耀变 / 特殊虚耀）自 `damagePoolAnomaly.ts` 迁进模块能力
// `extraAnomalyRows`（设计稿 `docs/mcp-cc19-extra-anomaly-rows.md` §7.2）。逐字锁 id/count/order。
describe('CC-19c-2：蕾米埃尔 extraAnomalyRows（耀变 / 特殊虚耀逐字）', () => {
  const panel = (overrides: Record<string, unknown> = {}) => ({
    ...emptyPanel(), atk: 1000, anomalyProficiency: 100, skillLevelBonus: 0, ...overrides,
  })
  /** 四个招式的耀变倍率行（values=[100] ⇒ multiplier=100） */
  const skills = () => ({
    id: '1581', agentId: '1581', name: { zhCN: '蕾米埃尔', en: 'Remielle' },
    categories: [{
      id: 'c', name: { zhCN: '', en: '' }, levelRange: { min: 1, max: 12, default: 12 },
      moves: ['1581015', '1581016', '1581008', '1581007'].map(id => ({
        id, name: { zhCN: '', en: '' },
        rows: [{ id: 'luminize_multiplier', label: { zhCN: '', en: '' }, kind: 'luminizeMultiplier', values: [100] }],
      })),
    }],
  })
  const input = (overrides: Record<string, unknown> = {}) => ({
    slot: 0,
    charResult: undefined,
    windRate: 0,
    anomalyProgress: () => undefined,
    buildVirtualPanel: () => null,
    buildSettlementEntries: () => [],
    axisStunFor: () => 0,
    enemy: { defense: 0, level: 60, stunVuln: 1.5 },
    enemyDamageRes: {},
    anomalyMultiplier: 1,
    teamAgentId: (s: number) => (s === 0 ? '1581' : s === 1 ? '1331' : '1221'),
    agentName: (_id: string, s: number) => (s === 0 ? '蕾米埃尔' : `队友${s}`),
    panel: panel() as never,
    cinemaLevel: 0,
    isAxis: false,
    stunCoverage: 1,
    inWindowFraction: () => 1,
    ultimateInAxisFraction: () => 1,
    axisInUnits: () => 0,
    getMechanicSetting: (_k: string, d: number) => d,
    anomalyPool: emptyAnomalyPool(),
    entryPanel: panel() as never,
    skills: skills() as unknown as AgentSkills,
    panelOf: (s: number) => (s === 1 || s === 2 ? panel() as never : undefined),
    teamElement: () => 'electric',
    getTeamMechanicSetting: (_k: string, d: number) => d,
    elementLabel: (el: string) => (el === 'electric' ? '电' : el),
    // CC-176：蕾米埃尔不产直伤行，桩不参与。
    directDamage: () => { throw new Error('remielle extraAnomalyRows 不应调用 directDamage') },
    anomalyDamage: () => { throw new Error('remielle extraAnomalyRows 不应调用 anomalyDamage') },
    ...overrides,
  })

  it('无 entryPanel → []', () => {
    expect(remielleMechanic.extraAnomalyRows!(input({ entryPanel: undefined }))).toEqual([])
  })

  it('无 panel → []', () => {
    expect(remielleMechanic.extraAnomalyRows!(input({ panel: undefined }))).toEqual([])
  })

  it('无队友虚耀计数（perSlotAnomalyTriggers 全 0）→ []', () => {
    expect(remielleMechanic.extraAnomalyRows!(input({
      anomalyPool: { perSlotAnomalyTriggers: [0, 0, 0] } as never,
    }))).toEqual([])
  })

  it('CC-325：无队友虚耀但有 C1 → 仍产特殊虚耀行（与队友异常无关；垂虹必做动作照扣时间，伤害不能丢）', () => {
    const groups = remielleMechanic.extraAnomalyRows!(input({
      anomalyPool: { perSlotAnomalyTriggers: [0, 0, 0] } as never,
      panel: panel({ remielleCinema1SpecialVoidflareCount: 1 }) as never,
    }))
    expect(groups).toHaveLength(1)
    expect(groups[0].rows.map(r => r.id)).toEqual(['remielle-special-voidflare'])
    expect(groups[0].rows[0]).toMatchObject({ count: 3, element: 'electric' })
    expect(groups[0].rows[0].totalDamage).toBeGreaterThan(0)
    // 展示侧事件记录同口径：虚耀池类记录 count=0 被滤掉，只剩特殊虚耀
    const records = remielleMechanic.anomalyEventRecords!({
      slot: 0, panel: panel({ remielleCinema1SpecialVoidflareCount: 1 }) as never,
      teamAgentIds: ['1581'], perSlotAnomalyTriggers: [0, 0, 0], cinemaLevel: 1, perElementTriggerCounts: {},
    } as never)
    expect(records.map(r => r.id)).toEqual(['remielle-special-voidflare'])
  })

  it('2 个队友虚耀计数：order=60，耀变行按「每动作结算已储存虚曜」逐字（用户 2026-10-18）', () => {
    const groups = remielleMechanic.extraAnomalyRows!(input({
      anomalyPool: { perSlotAnomalyTriggers: [0, 2, 3] } as never,
    }))
    expect(groups).toHaveLength(1)
    expect(groups[0].order).toBe(60)
    // 池 5 ⇒ 轮数 ⌊5/3⌋=1、每轮结算「已储存的 3 个」（按供给比例 2:3 整数分摊 ⇒ 1 / 2）
    // 无大招执行行（charResult 缺省）⇒ 终结技载体 0 次，只剩入场 + 长按A 两个载体 × 2 个队友槽 = 4 行
    expect(groups[0].rows.map(r => r.id)).toEqual([
      'remielle-luminize-assist-1', 'remielle-luminize-assist-2',
      'remielle-luminize-basic-1', 'remielle-luminize-basic-2',
    ])
    expect(groups[0].rows[0]).toMatchObject({
      slot: 0, agentId: '1581', agentName: '蕾米埃尔', type: '耀变',
      name: '支援技花羽轮舞·耀变', element: 'electric',
      source: '队友1 的电异常虚耀', count: 1,
    })
    expect(groups[0].rows[1]).toMatchObject({ id: 'remielle-luminize-assist-2', count: 2 })
    // 惊鸿 × (1 + remielleCinema6FleetingGraceVoidflareTriggerMultiplier)；emptyPanel 初值 0 ⇒ 0 命 ×1（CC-165）
    expect(groups[0].rows[2]).toMatchObject({ id: 'remielle-luminize-basic-1', count: 1 })
    expect(groups[0].rows[3]).toMatchObject({ id: 'remielle-luminize-basic-2', count: 2 })
  })

  it('用户 2026-10-18 玩法口径：一轮 3 豆 ⇒ 入场/长按A 各结算 3 次；有大招再加 3 次（共 9）', () => {
    const execs = (...ids: string[]) => ({ executions: ids.map(moveId => ({ moveId, count: 1 })) }) as never
    // ① 没大招：2 个动作 6 次耀变（3 入场 + 3 长按A）
    const noUlt = remielleMechanic.extraAnomalyRows!(input({
      anomalyPool: { perSlotAnomalyTriggers: [0, 3, 0] } as never,
      charResult: execs('1581014'),
    }))
    expect(noUlt[0].rows.reduce((s, r) => s + r.count, 0)).toBe(6)
    // ② 有大招：3 个动作 9 次耀变（3 入场 + 3 大招 + 3 长按A）
    const withUlt = remielleMechanic.extraAnomalyRows!(input({
      anomalyPool: { perSlotAnomalyTriggers: [0, 3, 0] } as never,
      charResult: execs('1581014', '1581016'),
    }))
    expect(withUlt[0].rows.reduce((s, r) => s + r.count, 0)).toBe(9)
    // ③ 没有大招执行行 ⇒ 终结技载体不结算（修前按「虚曜池 × 每虚曜一次」算，与蕾米打没打大招无关）
    const noUltAction = remielleMechanic.extraAnomalyRows!(input({
      anomalyPool: { perSlotAnomalyTriggers: [0, 3, 0] } as never,
    }))
    expect(noUltAction[0].rows.some(r => r.id.startsWith('remielle-luminize-ultimate'))).toBe(false)
    // 入场（花羽轮舞）与长按A（惊鸿）是每轮固定动作 ⇒ 仍在（3 豆一轮 ⇒ 各 3 次）
    expect(noUltAction[0].rows.reduce((s, r) => s + r.count, 0)).toBe(6)
  })

  it('C1（remielleCinema1SpecialVoidflareCount>0）时含 remielle-special-voidflare 行', () => {
    const groups = remielleMechanic.extraAnomalyRows!(input({
      anomalyPool: { perSlotAnomalyTriggers: [0, 2, 3] } as never,
      panel: panel({ remielleCinema1SpecialVoidflareCount: 1 }) as never,
    }))
    const special = groups[0].rows.find(r => r.id === 'remielle-special-voidflare')
    expect(special, 'C1 特殊虚耀行缺失').toBeTruthy()
    expect(special).toMatchObject({
      slot: 0, agentId: '1581', type: '特殊虚耀',
      // 2026-10-21 用户口径：特殊虚耀属性跟随下一位队友（流明无积蓄、不会形成异常主人，
      // 全游戏没有按流明结算的伤害）⇒ 不再是 'lumiflux'，夹具 teamElement 返回 'electric'
      name: '普通攻击垂虹·特殊虚耀', element: 'electric',
      source: '蕾米进场记录面板 × 2.5 特殊独立乘区', count: 3,
    })
  })

  it('CC-165/CC-166/CC-332：特殊虚耀垂虹施放次数 1/2/2 vs 耀变次数 3/6/12，惊鸿 0 命 ×1 / 6 命 ×2', () => {
    const e = emptyPanel()
    expect(remielleSpecialVoidflareRainbowCount(e)).toBe(0)
    expect(remielleSpecialVoidflareCount(e)).toBe(0)
    const c1 = { ...e, remielleCinema1SpecialVoidflareCount: 1 }
    const c4 = { ...c1, remielleCinema4SpecialVoidflareRefillCount: 3 }
    // C6：2 次垂虹 × 3 豆 × 2 倍耀变 = 12（①=③同一效果，用 FleetingGrace 字段；LuminizeTriggerMultiplier 为记录错误已删）
    const c6 = { ...c4, remielleCinema6FleetingGraceVoidflareTriggerMultiplier: 1 }
    expect([c1, c4, c6].map(remielleSpecialVoidflareRainbowCount)).toEqual([1, 2, 2])
    expect([c1, c4, c6].map(remielleSpecialVoidflareCount)).toEqual([3, 6, 12])
    // CC-332：extraNecessaryAction（普通攻击：垂虹载体动作）施放次数 = 垂虹轮次 1/2/2，buildAnomalyEvents（特殊虚耀事件）次数 = 耀变次数 3/6/12
    const cfgOf = (p: typeof e) => ({
      panel: p,
      remielleRainbowEndMoveId: '1581007',
      remielleRainbowEndActionTime: 1.5,
      remielleRainbowEndComboAlignRatio: 0,
      remielleRainbowEndDecibelRecovery: 20.625,
    } as never)
    expect([c1, c4, c6].map(p => remielleSpecialVoidflareUseCount(cfgOf(p)))).toEqual([1, 2, 2])
    // 2026-10-18 起 extraNecessaryAction 返回**数组**（入场/惊鸿/垂虹三类），垂虹是最后一项
    expect([c1, c4, c6].map(p => {
      const got = remielleMechanic.extraNecessaryAction!(cfgOf(p)) as ReadonlyArray<{ moveId?: string; count: number }> | null
      return got?.find(a => a.moveId === '1581007')?.count ?? 0
    })).toEqual([1, 2, 2])
    expect([c1, c4, c6].map(p => {
      const events: Array<{ count: number }> = []
      remielleMechanic.buildAnomalyEvents!({ cfg: cfgOf(p), state: {} as never, events: events as never, totalTime: 180 })
      return events[0]?.count ?? 0
    })).toEqual([3, 6, 12])
    expect(remielleFleetingGraceMultiplier(e)).toBe(1)
    expect(remielleFleetingGraceMultiplier(c6)).toBe(2)
    // 6 命 FleetingGraceTriggerMultiplier 是加成语义：空面板初值必须为 0（否则与 1 + x 叠成双计）
    expect(e.remielleCinema6FleetingGraceVoidflareTriggerMultiplier).toBe(0)
  })

  it('无 C1 → 不含特殊虚耀行（普通耀变行仍在）', () => {
    const groups = remielleMechanic.extraAnomalyRows!(input({
      anomalyPool: { perSlotAnomalyTriggers: [0, 2, 3] } as never,
    }))
    expect(groups[0].rows.find(r => r.id === 'remielle-special-voidflare')).toBeUndefined()
    // 无大招执行行 ⇒ 入场 + 长按A 两个载体 × 2 个队友槽 = 4 行（2026-10-18 起载体次数受招式封顶）
    expect(groups[0].rows.length).toBe(4)
  })
})

// CC-19c-2 2026-09-26：块 6 经 `extraAnomalyRows` 派发点进伤害池（真管线）。
// 这条是派发点接线的自证锚点：把派发点短路成空，本断言必须红。
describe('CC-19c-2：蕾米埃尔耀变行进伤害池（extraAnomalyRows 派发点接线）', () => {
  it('remielle-luminize-* 行进伤害池', async () => {
    await setup(0)
    const calc = useResourceCalc()
    const rows = calc.damagePoolRows.value.filter(r => String(r.id).startsWith('remielle-luminize-'))
    expect(rows.length, '耀变行未进伤害池（extraAnomalyRows 派发点断了）').toBeGreaterThan(0)
    for (const r of rows) {
      expect(r.type).toBe('耀变')
      expect(r.count).toBeGreaterThan(0)
      expect(r.totalDamage).toBeGreaterThan(0)
    }
  })
})

describe('CC-21：蕾米埃尔 globalAnomalyMultiplierFactor（全队异常乘区因子，自 useResourceCalc 迁入）', () => {
  it('异化系数 = 1 + (异化度 + 异化度提升) / 100；空面板 = 1', () => {
    const factor = remielleMechanic.globalAnomalyMultiplierFactor!
    expect(factor(emptyPanel())).toBe(1)
    expect(factor({ ...emptyPanel(), remielleRefringeCoefficient: 20, remielleRefringeCoefficientBonusPct: 5 })).toBeCloseTo(1.25, 12)
  })

})

describe('CC-41：一命花羽轮舞喧响走跨轮反馈（nextRoundFeedback → applyTeamConfig converge）', () => {
  // 原 CC-34c 用例测的是 buildCharConfig × 面板次数，而那个面板次数没有写入方（效果恒 0）；CC-41 改为跨轮反馈。
  it('次数 = 队友虚曜数（排除本槽），按 18s 冷却封顶', () => {
    expect(remielleFlowerFeatherDanceCasts(0, [99, 3, 4], 180)).toBe(7)
    expect(remielleFlowerFeatherDanceCasts(1, [3, 99, 4.9], 180)).toBe(7)
    expect(remielleFlowerFeatherDanceCasts(0, [0, 30, 30], 180)).toBe(10)
    expect(remielleFlowerFeatherDanceCasts(0, [0, 30, 30], 35)).toBe(1)
    expect(remielleFlowerFeatherDanceCasts(0, undefined, 180)).toBe(0)
  })
  const apply = (cfg: Record<string, unknown>, phase: string, casts?: number) => remielleMechanic.applyTeamConfig!({
    cfg: cfg as never, characters: [] as never, team: [] as never, phase: phase as never,
    threads: (casts === undefined ? undefined : { moduleFeedback: { remielleFlowerFeatherDanceCasts: casts } }) as never,
  } as never)
  it('converge：在已有值上累加 每次喧响 × 次数（100 + 200×3 = 700）', () => {
    const cfg: Record<string, unknown> = { extraSelfDecibelReward: 100, panel: { remielleFlowerFeatherDanceDecibelPerUse: 200 } }
    apply(cfg, 'converge', 3)
    expect(cfg.extraSelfDecibelReward).toBe(700)
  })
  it('影画 < 1（每次喧响 0）/ 非 converge 相位 / 无线程：不写', () => {
    const c0: Record<string, unknown> = { extraSelfDecibelReward: 100, panel: { remielleFlowerFeatherDanceDecibelPerUse: 0 } }
    apply(c0, 'converge', 3)
    expect(c0.extraSelfDecibelReward).toBe(100)
    const c1: Record<string, unknown> = { extraSelfDecibelReward: 100, panel: { remielleFlowerFeatherDanceDecibelPerUse: 200 } }
    apply(c1, 'pre', 3)
    apply(c1, 'converge', undefined)
    expect(c1.extraSelfDecibelReward).toBe(100)
  })
  it('集成：影画 1 比影画 0 喧响更多、终结次数不减（真实管线）', async () => {
    const run = async (cinema: number) => {
      const { config } = await setupHarness([{ agentId: '1581' }, { agentId: '1261' }, { agentId: '1331' }], { recommendedBuild: true })
      config.setCinemaLevel(0, cinema)
      const calc = useResourceCalc()
      const c = (calc.resourceResult.value?.characters ?? []).find(x => x.slot === 0)
      return { unshareable: c?.decibelSource?.unshareableBonus ?? 0, ult: c?.ultimateCount ?? 0 }
    }
    const c0 = await run(0)
    const c1 = await run(1)
    expect(c0.unshareable).toBe(0)
    expect(c1.unshareable).toBeGreaterThan(0)
    expect(c1.unshareable % 200).toBe(0)
    expect(c1.unshareable).toBeLessThanOrEqual(200 * 10)
    expect(c1.ult).toBeGreaterThanOrEqual(c0.ult)
  }, 60000)
})

describe('CC-34c②：Radiant Turn 失衡乘区由模块能力 skillDazeMultiplier 提供', () => {
  const fn = remielleMechanic.skillDazeMultiplier!
  it('1581010：1 + 档位%（35 档 → 1.35）', () => {
    expect(fn({ moveId: '1581010', panel: { ...emptyPanel(), remielleRadiantTurnDazeBonusPct: 35 } as never })).toBeCloseTo(1.35, 12)
  })
  it('其他招式 → 1；面板为 null 或字段缺席 → 1', () => {
    expect(fn({ moveId: '1581001', panel: { ...emptyPanel(), remielleRadiantTurnDazeBonusPct: 35 } as never })).toBe(1)
    expect(fn({ moveId: '1581010', panel: null })).toBe(1)
    expect(fn({ moveId: '1581010', panel: emptyPanel() as never })).toBe(1)
  })
})

describe('CC-35a：异常虚拟面板「异化度」列由模块能力 anomalyRefringePct 提供', () => {
  it('能力与全队乘区同源：factor = 1 + pct / 100', () => {
    const p = { ...emptyPanel(), remielleRefringeCoefficient: 12.5, remielleRefringeCoefficientBonusPct: 30 }
    expect(remielleMechanic.anomalyRefringePct!(p)).toBe(42.5)
    expect(remielleMechanic.globalAnomalyMultiplierFactor!(p)).toBe(1 + 42.5 / 100)
  })

  /**
   * 2026-10-20 订正（用户裁决「异化度确实是全队固定的，因为这是全队拐」）：异化度是**全队唯一值**，
   * 每行喂该行自己的面板是错的——异化系数本体（catalog `target.kind: 'self'`）只写在蕾米面板上，
   * 队友行只拿得到 3异常+10 / C2+20 的 `default` 部分 ⇒ 修前每行/虚拟面板恒显示 10.0（C0），
   * 而伤害实际乘的是 1 + (异化系数 + 提升)/100。负控：把取值改回「该行自己的面板」⇒ 本用例红。
   */
  it('蕾米埃尔在队：每行 refringe = 蕾米面板的异化系数 + 提升（全队固定值，不按行加权）', async () => {
    const { config, catalog } = await setup(0)
    const panels = [0, 1, 2].map(s => computePanelPhases(s, config, catalog)!.inCombat)
    const prog = { element: 'electric', totalBuildUp: 200, contributions: [{ slot: 0, totalBuildUp: 120 }, { slot: 1, totalBuildUp: 80 }] }
    const built = buildAnomalyVirtualPanel(prog as never, panels, config, catalog)!
    expect(built.rows.length).toBe(2)
    const owner = panels[0]!
    const want = (owner.remielleRefringeCoefficient ?? 0) + (owner.remielleRefringeCoefficientBonusPct ?? 0)
    expect(want).toBeGreaterThan(0)
    for (const row of built.rows) expect(row.refringe).toBe(want)
    expect(built.virtual.refringe).toBe(want)
    // 队友行自己的面板只有 default 加算项（异化系数本体钉在 self）⇒ 修前会显示更小的值
    const mateOwn = (panels[1]!.remielleRefringeCoefficient ?? 0) + (panels[1]!.remielleRefringeCoefficientBonusPct ?? 0)
    expect(mateOwn).toBeLessThan(want)
    // 展示值与伤害乘区同源：1 + pct/100
    expect(remielleMechanic.globalAnomalyMultiplierFactor!(owner)).toBeCloseTo(1 + want / 100, 12)
  })

  it('蕾米埃尔不在队：refringe 为 0', async () => {
    const { config, catalog } = await setupHarness([
      { agentId: '1331', parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
      { agentId: '1221', parryCount: 0, dodgeCounterCount: 0, quickAssistCount: 0 },
    ])
    const panels = [0, 1].map(s => computePanelPhases(s, config, catalog)!.inCombat)
    const prog = { element: 'electric', totalBuildUp: 100, contributions: [{ slot: 0, totalBuildUp: 100 }] }
    const built = buildAnomalyVirtualPanel(prog as never, panels, config, catalog)!
    expect(built.rows[0].refringe).toBe(0)
  })
})

/**
 * 浮晖（Term:1000032）与飞行轮数（用户 2026-10-18 玩法口径）。
 *
 * 原文：浮晖上限 120；相变时流状态下随时间消耗；花羽轮舞「若发动时剩余浮晖 ≤ 90，则不扣浮晖并进入映曜」；
 * 映曜 ⇒ 下一次垂虹升级为惊鸿（耀变 320% vs 垂虹 160%）。
 * 用户实测：120 → 90 约 15s ⇒ 2 点/秒；一轮 = 飞行段 + 花羽轮舞 + 惊鸿。
 */
describe('蕾米埃尔浮晖与飞行轮数', () => {
  it('浮晖常量与原文数值表一致', () => {
    expect(REMIELLE_LUMEN_MAX).toBe(120)
    expect(REMIELLE_LUMEN_FLOWER_FEATHER_THRESHOLD).toBe(90)
    expect(REMIELLE_LUMEN_DRAIN_PER_SECOND).toBe(2)
    // 120 → 90 需 15s（用户实测「通常15s左右」）
    expect(REMIELLE_LUMEN_FLIGHT_SECONDS).toBe(15)
    // 普攻段位与两招的回复量（原文 param 表）
    expect(REMIELLE_LUMEN_GAIN.basic1).toBe(5)
    expect(REMIELLE_LUMEN_GAIN.basic2).toBe(5)
    expect(REMIELLE_LUMEN_GAIN.basic3).toBe(15)
    expect(REMIELLE_LUMEN_GAIN.basic4).toBe(35)
    expect(REMIELLE_LUMEN_GAIN.solo).toBe(30)
    expect(REMIELLE_LUMEN_GAIN.rainbowEnd).toBe(120)
    expect(REMIELLE_LUMEN_GAIN.fleetingGrace).toBe(120)
    expect(REMIELLE_LUMEN_GAIN.flowerFeatherCost).toBe(40)
  })

  it('轮数 = min(豆子够打几轮, 时间够飞几轮)', () => {
    // 池 27 ⇒ 9 轮；后台 180s ÷ 15s = 12 轮 ⇒ 取 9（豆子侧咬合）
    expect(remielleRoundCount(27, 180)).toBe(9)
    // 用户口径：前台 60s ⇒ 后台 120s ⇒ 120/15 = 8 轮；池 60 ⇒ 20 轮豆子够 ⇒ 取 8
    expect(remielleRoundCount(60, 120)).toBe(8)
    // 后台不足（< 15s）⇒ 0 轮
    expect(remielleRoundCount(27, 10)).toBe(0)
    // 无后台时长（外部直调）⇒ 只按豆子判
    expect(remielleRoundCount(27, 0)).toBe(9)
    // 池不满一轮 ⇒ 0
    expect(remielleRoundCount(2, 180)).toBe(0)
  })

  it('资源卡标注飞行轮数与每轮时长', () => {
    const result = {
      slot: 2,
      remielleMechanicSource: computeRemielleMechanic({ anomalyProficiency: 100 }),
      // 战斗时长 = 前台 + 后台；180s / 15s 飞行段 = 12 轮（池 15 ⇒ 5 轮，时间侧未咬合）
      timeAllocation: { frontlineTime: 18.3, backstageTime: 161.7 },
    }
    const sections = remielleMechanic.resourceSections!({
      result,
      anomalyPoolResult: { perSlotAnomalyTriggers: [12, 3, 0] },
    } as never)
    expect(sections).toHaveLength(1)
    const labels = sections[0]!.rows.map(r => r.label)
    expect(labels).toContain('飞行轮数')
    expect(labels).toContain('每轮时长')
    expect(labels).toContain('首轮可能打垂虹')
    // 池 = 12 + 3 = 15 ⇒ 5 轮
    expect(sections[0]!.summary).toContain('飞行 5 轮')
  })
})

/**
 * 拆轮（用户 2026-10-18 逐字）：
 * 「他的前台变成 60s，后台不足 120s……如果想提高轮次，那肯定有些波次是 15s 以内就打出来的，
 *  这时候还没掉到 90，导致打不了惊鸿，只能打垂鸿。所以这里需要做一个计算，我们默认 7 轮上限，
 *  如果一个队伍的轮次想达到 8，就要拆一轮惊鸿，如果想达到 9，就要拆 2 轮。」
 */
describe('蕾米拆轮：7 轮完整惊鸿 + 拆轮降级为垂虹', () => {
  const panelOf = (split: number) => ({
    ...emptyPanel(), atk: 1000, anomalyProficiency: 100, skillLevelBonus: 0,
    remielleSplitRounds: split,
  }) as never

  it('默认 0：只打 7 轮惊鸿，第 8 轮起不再产惊鸿行', () => {
    const runs = (split: number, pool: number) => {
      const groups = remielleMechanic.extraAnomalyRows!({
        slot: 0,
        charResult: undefined,
        windRate: 0,
        anomalyProgress: () => undefined,
        buildVirtualPanel: () => null,
        buildSettlementEntries: () => [],
        axisStunFor: () => 0,
        enemy: { defense: 0, level: 60, stunVuln: 1.5 },
        enemyDamageRes: {},
        anomalyMultiplier: 1,
        teamAgentId: (s: number) => (s === 0 ? '1581' : s === 1 ? '1331' : '1221'),
        agentName: (_id: string, s: number) => (s === 0 ? '蕾米埃尔' : `队友${s}`),
        panel: panelOf(split),
        cinemaLevel: 0,
        isAxis: false,
        stunCoverage: 1,
        inWindowFraction: () => 1,
        ultimateInAxisFraction: () => 1,
        axisInUnits: () => 0,
        getMechanicSetting: (_k: string, d: number) => d,
        getTeamMechanicSetting: (_k: string, d: number) => d,
        anomalyPool: { perSlotAnomalyTriggers: [0, pool, 0] },
        entryPanel: panelOf(split),
        // 四个招式的耀变倍率行（与上面 CC-19c-2 的 skills() 同形，values=[100] ⇒ multiplier=100）
        skills: {
          id: '1581', agentId: '1581', name: { zhCN: '蕾米埃尔', en: 'Remielle' },
          categories: [{
            id: 'c', name: { zhCN: '', en: '' }, levelRange: { min: 1, max: 12, default: 12 },
            moves: ['1581015', '1581016', '1581008', '1581007'].map(id => ({
              id, name: { zhCN: '', en: '' },
              rows: [{ id: 'luminize_multiplier', label: { zhCN: '', en: '' }, kind: 'luminizeMultiplier', values: [100] }],
            })),
          }],
        },
        panelOf: () => panelOf(split),
        teamElement: () => 'electric',
        elementLabel: (e: string) => e,
        directDamage: () => ({ damage: 0, formula: '' }),
        anomalyDamage: () => ({ damage: 0, formula: '' }),
      } as never)
      const byKind: Record<string, number> = {}
      for (const r of groups[0]?.rows ?? []) {
        const k = r.id.replace('remielle-luminize-', '').split('-')[0]!
        byKind[k] = (byKind[k] ?? 0) + r.count
      }
      return byKind
    }
    // 池 24 ⇒ 8 轮豆子够；split=0 ⇒ 只有 7 轮惊鸿（21 次），没有垂虹超额行
    const d0 = runs(0, 24)
    expect(d0.basic).toBe(21)
    expect(d0.rainbow ?? 0).toBe(0)
    // 入场（花羽轮舞）仍按 7 轮结算
    expect(d0.assist).toBe(21)
    // split=1（用户口径「调成 1 你就写 6 惊鸿 2 垂鸿」）：
    // 拆 1 轮惊鸿 ⇒ 少 1 轮惊鸿（6 轮 = 18 次）、多 2 轮垂虹（2 轮 = 6 次），总轮次 8
    const d1 = runs(1, 24)
    expect(d1.basic).toBe(18)
    expect(d1.rainbow).toBe(6)
    expect(d1.assist).toBe(24)
    // split=2 ⇒ 5 惊鸿 + 4 垂虹 = 9 轮（池 27 才够，这里给 27）
    const d2 = runs(2, 27)
    expect(d2.basic).toBe(15)
    expect(d2.rainbow).toBe(12)
    expect(d2.assist).toBe(27)
  })

  it('拆轮上限 4（再多 180s 也打不完）；滑块 id 与声明同源', () => {
    expect(REMIELLE_SPLIT_ROUND_MAX).toBe(4)
    // 滑块 `remielle.splitRounds` 的生效判据：声明存在 + 面板字段按它写（applyPanel 单写者）
    const decl = remielleMechanic.settings?.find(s => s.id === 'remielle.splitRounds')
    expect(decl, '滑块必须声明（规则 12）').toBeTruthy()
    expect(decl!.default).toBe(0)
    expect(decl!.max).toBe(REMIELLE_SPLIT_ROUND_MAX)
    // 改滑块 ⇒ 面板字段跟着变（面板字段 = 载体侧唯一读点）
    for (const split of [0, 1, 4]) {
      const p = emptyPanel()
      remielleMechanic.applyPanel!({
        slot: 0, agent: { id: '1581' } as never, team: [] as never, panel: p,
        settings: { 'remielle.splitRounds': split },
      } as never)
      expect(p.remielleSplitRounds, `滑块 ${split} ⇒ 面板字段同步`).toBe(split)
    }
  })
})

/**
 * 子弹来源与丢弃（用户 2026-10-18 逐字）：
 * 「丢弃开关也很粗糙，不做开关，需要改为丢弃部分，这样子剩余部分进入细致分配算法就会自动算出
 *  打的更少的子弹，实现部分丢弃。如果丢弃全部，进入这个算法也会实现丢弃全部。」
 * 以及「大招固定一个 a 子弹，但总量只有 3 个 a，却打了 7 次大招，不符合实际」⇒ 细致分配。
 */
describe('蕾米虚曜子弹：细致分配 + 丢弃', () => {
  const allocSkills = {
    id: '1581', agentId: '1581', name: { zhCN: '', en: '' },
    categories: [{
      id: 'c', name: { zhCN: '', en: '' }, levelRange: { min: 1, max: 12, default: 12 },
      moves: ['1581015', '1581016', '1581008', '1581007'].map(id => ({
        id, name: { zhCN: '', en: '' },
        rows: [{ id: 'luminize_multiplier', label: { zhCN: '', en: '' }, kind: 'luminizeMultiplier', values: [100] }],
      })),
    }],
  }
  // drops 现在走面板字段（applyPanel 从 settings 读 → 面板 → extraAnomalyRows）
  const panelOf2 = (drops: Record<number, number> = {}) => ({
    ...emptyPanel(), atk: 1000, anomalyProficiency: 100, skillLevelBonus: 0,
    remielleTeammateDrops: Object.fromEntries(Object.entries(drops).map(([k, v]) => [String(k), v])),
  }) as never
  const alloc = (triggers: [number, number, number], drops: Record<number, number> = {}) => {
    const groups = remielleMechanic.extraAnomalyRows!({
      slot: 0, charResult: { executions: [{ moveId: '1581016', count: 7 }] }, windRate: 0,
      anomalyProgress: () => undefined, buildVirtualPanel: () => null, buildSettlementEntries: () => [],
      axisStunFor: () => 0, enemy: { defense: 0, level: 60, stunVuln: 1.5 }, enemyDamageRes: {},
      anomalyMultiplier: 1, teamAgentId: (s: number) => (s === 0 ? '1581' : s === 1 ? 'A' : 'B'),
      agentName: (id: string) => id, panel: panelOf2(drops), cinemaLevel: 0, isAxis: false, stunCoverage: 1,
      inWindowFraction: () => 1, ultimateInAxisFraction: () => 1, axisInUnits: () => 0,
      getMechanicSetting: (_k: string, d: number) => d,
      getTeamMechanicSetting: (_k: string, d: number) => d,
      anomalyPool: { perSlotAnomalyTriggers: triggers }, entryPanel: panelOf2(drops),
      skills: allocSkills, panelOf: () => panelOf2(drops), teamElement: () => 'electric',
      elementLabel: (e: string) => e,
      directDamage: () => ({ damage: 0, formula: '' }),
      anomalyDamage: () => ({ damage: 0, formula: '' }),
    } as never)
    const out: Record<string, number> = {}
    for (const r of groups[0]?.rows ?? []) out[r.id] = (out[r.id] ?? 0) + r.count
    return out
  }

  it('细致分配：A 只有 3 次异常 ⇒ 21 次载体里 A 只占 2~3 次（不再固定每轮 1 个）', () => {
    // 池 28 ⇒ 9 轮豆子够，但默认封顶 7 轮 ⇒ 7 轮 × 3 = 21 次每载体
    const r = alloc([0, 3, 25])
    expect(r['remielle-luminize-basic-1']! + r['remielle-luminize-basic-2']!).toBe(21)
    // 3:25 ⇒ A 占比 10.7%，21 次里约 2.2 ⇒ 整数分摊 2
    expect(r['remielle-luminize-basic-1']).toBe(2)
    expect(r['remielle-luminize-basic-2']).toBe(19)
    // 三个载体口径一致（不再「入场按比例、大招按滑块」两套）
    expect(r['remielle-luminize-assist-1']).toBe(2)
    expect(r['remielle-luminize-ultimate-1']).toBe(2)
  })

  it('丢弃全部 B ⇒ 只剩 A 的 3 次，轮数自动降到 1 轮', () => {
    const r = alloc([0, 3, 25], { 2: 25 })
    expect(r['remielle-luminize-basic-1']).toBe(3)
    expect(r['remielle-luminize-basic-2']).toBeUndefined()
  })

  it('丢弃部分 B ⇒ 剩余次数进分配，轮数与归属自动跟着算', () => {
    // 丢 20 次 ⇒ B 剩 5、A 3 ⇒ 池 8 ⇒ 2 轮 ⇒ 每载体 6 次，3:5 分摊 = 2 / 4
    const r = alloc([0, 3, 25], { 2: 20 })
    expect(r['remielle-luminize-basic-1']).toBe(2)
    expect(r['remielle-luminize-basic-2']).toBe(4)
  })

  it('默认封顶 7 轮（豆子够 9 轮也不飞 9 轮）', () => {
    const r = alloc([0, 15, 15])
    expect(r['remielle-luminize-basic-1']! + r['remielle-luminize-basic-2']!).toBe(21)
  })
})
