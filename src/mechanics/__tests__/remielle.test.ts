import { describe, expect, it } from 'vitest'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { setupHarness } from '@/test/harness'
import { buildAnomalyVirtualPanel, computePanelPhases, computeEntrySnapshotPanel, findMoveById } from '@/composables/resourceCalc/helpers'
import { emptyPanel } from '@/core/panel'
import { calcVoidflareDamage, computeRemielleMechanic, getRemielleLevelValue, remielleMechanic, remielleFlowerFeatherDanceCasts, remielleFleetingGraceMultiplier, remielleSpecialVoidflareCount } from '@/mechanics/agents/remielle'
import type { AgentSkills } from '@/types/catalog'
import { getAgentSpec } from '@/specs/registry'

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
  it('CC-120：spec resources 的 luminizeMasteryRatio（仅供机制表展示，不参与计算）与模块/引擎口径一致', () => {
    // spec 曾写 0.1（与模块 @fact 记载的旧转写错误相同）；resources 不被执行，只进机制表和逻辑编辑器，所以只错在展示
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

  // @fact agent:1581/异化C2加算单写者 口径: C2 异化+20 唯一写者=catalog cinemaBuffs 自身buff；teammate-buffs 条 remielle_c2_team_refringe_coefficient_bonus_pct 以 effect 级 excludeTargetAgentIds 排除蕾米本人（曾双通道双计：3异常队 C2 面板 BonusPct=50，正确 30=3异常的10+C2的20；同 buff 的 Prismatic 无视15%防御不排除、她本人照吃） | 据 账本校对@2026-09-07·复核@2026-09-25·锚未变@2026-09-27 | 验 src/mechanics/__tests__/remielle.test.ts | 锚 src/core/buff.ts#isExcludedForTarget | 信 确认
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

  // @fact agent:1581/特殊虚耀×2.5独立乘区 口径: 特殊虚耀（开局虚耀·垂虹载体·全吃进场记录面板）伤害 = 垂虹耀变倍率 ×2.5 的独立乘区，只作用于特殊虚耀行 remielle-special-voidflare；普通虚耀（花羽轮舞/缭乱终幕/惊鸿载体·基础区=触发队友面板）不吃该乘区——两者基础区来源不同（特殊=蕾米自供偏低故补偿 2.5 倍、普通=队友供偏高） | 据 用户@2026-08-26（原文见 src/specs/agents/1581.json 口径行）+ 用户@2026-09-14「引擎没有就造一个乘区」·复核@2026-09-25·实测@2026-09-27（×2.5 算术落点已随 CC-9a 迁 damagePoolAnomaly.ts、再随 CC-19c-2 迁 remielle.ts 模块能力 extraAnomalyRows，口径未变） | 验 src/mechanics/__tests__/remielle.test.ts | 锚 src/mechanics/agents/remielle.ts#extraAnomalyRows | 信 确认
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
      element: 'lumiflux',
      enemyDefense: config.enemy.defense,
      enemyResistances: (config.enemy as any).damageResistances ?? (config.enemy as any).resistances ?? {},
      stunMultiplier: config.enemy.stunVuln,
      stunned: true,
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
    anomalyPool: null,
    entryPanel: panel() as never,
    skills: skills() as unknown as AgentSkills,
    panelOf: (s: number) => (s === 1 || s === 2 ? panel() as never : undefined),
    teamElement: () => 'electric',
    getTeamMechanicSetting: (_k: string, d: number) => d,
    elementLabel: (el: string) => (el === 'electric' ? '电' : el),
    // CC-176：蕾米埃尔不产直伤行，桩不参与。
    directDamage: () => { throw new Error('remielle extraAnomalyRows 不应调用 directDamage') },
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

  it('2 个队友虚耀计数：order=60，耀变行 id/count 逐字', () => {
    const groups = remielleMechanic.extraAnomalyRows!(input({
      anomalyPool: { perSlotAnomalyTriggers: [0, 2, 3] } as never,
    }))
    expect(groups).toHaveLength(1)
    expect(groups[0].order).toBe(60)
    // 3 个载体 × 2 个队友槽 = 6 行，顺序为 actionRows 外层循环 × voidflareBySlot 内层循环
    expect(groups[0].rows.map(r => r.id)).toEqual([
      'remielle-luminize-assist-1', 'remielle-luminize-assist-2',
      'remielle-luminize-ultimate-1', 'remielle-luminize-ultimate-2',
      'remielle-luminize-basic-1', 'remielle-luminize-basic-2',
    ])
    // 支援技按队友虚耀次数原样；终结技按 q 批次（5 次 ⇒ 1 批：firstPerBatch=1, secondPerBatch=2）
    expect(groups[0].rows[0]).toMatchObject({
      slot: 0, agentId: '1581', agentName: '蕾米埃尔', type: '耀变',
      name: '支援技花羽轮舞·耀变', element: 'electric',
      source: '队友1 的电异常虚耀', count: 2,
    })
    expect(groups[0].rows[1]).toMatchObject({ id: 'remielle-luminize-assist-2', count: 3 })
    expect(groups[0].rows[2]).toMatchObject({ id: 'remielle-luminize-ultimate-1', count: 1 })
    expect(groups[0].rows[3]).toMatchObject({ id: 'remielle-luminize-ultimate-2', count: 2 })
    // 惊鸿 × (1 + remielleCinema6FleetingGraceVoidflareTriggerMultiplier)；emptyPanel 初值 0 ⇒ 0 命 ×1（CC-165）
    expect(groups[0].rows[4]).toMatchObject({ id: 'remielle-luminize-basic-1', count: 2 })
    expect(groups[0].rows[5]).toMatchObject({ id: 'remielle-luminize-basic-2', count: 3 })
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
      name: '普通攻击垂虹·特殊虚耀', element: 'lumiflux',
      source: '蕾米进场记录面板 × 2.5 特殊独立乘区', count: 3,
    })
  })

  it('CC-165：特殊虚耀个数 1 命 3 / 4 命 6 / 6 命 12，惊鸿 0 命 ×1 / 6 命 ×2（状态表与 6 命原文口径）', () => {
    const e = emptyPanel()
    expect(remielleSpecialVoidflareCount(e)).toBe(0)
    const c1 = { ...e, remielleCinema1SpecialVoidflareCount: 1 }
    const c4 = { ...c1, remielleCinema4SpecialVoidflareRefillCount: 3 }
    const c6 = { ...c4, remielleCinema6SpecialVoidflareTriggerMultiplier: 1, remielleCinema6FleetingGraceVoidflareTriggerMultiplier: 1 }
    expect([c1, c4, c6].map(remielleSpecialVoidflareCount)).toEqual([3, 6, 12])
    expect(remielleFleetingGraceMultiplier(e)).toBe(1)
    expect(remielleFleetingGraceMultiplier(c6)).toBe(2)
    // 6 命三个 TriggerMultiplier 是加成语义：空面板初值必须为 0（否则与 1 + x 叠成双计）
    expect([e.remielleCinema6LuminizeTriggerMultiplier, e.remielleCinema6SpecialVoidflareTriggerMultiplier, e.remielleCinema6FleetingGraceVoidflareTriggerMultiplier]).toEqual([0, 0, 0])
  })

  it('无 C1 → 不含特殊虚耀行（普通耀变行仍在）', () => {
    const groups = remielleMechanic.extraAnomalyRows!(input({
      anomalyPool: { perSlotAnomalyTriggers: [0, 2, 3] } as never,
    }))
    expect(groups[0].rows.find(r => r.id === 'remielle-special-voidflare')).toBeUndefined()
    expect(groups[0].rows.length).toBe(6)
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

  it('蕾米埃尔在队：每行 refringe = 该行面板的异化系数 + 提升（> 0）', async () => {
    const { config, catalog } = await setup(0)
    const panels = [0, 1, 2].map(s => computePanelPhases(s, config, catalog)!.inCombat)
    const prog = { element: 'electric', totalBuildUp: 200, contributions: [{ slot: 0, totalBuildUp: 120 }, { slot: 1, totalBuildUp: 80 }] }
    const built = buildAnomalyVirtualPanel(prog as never, panels, config, catalog)!
    expect(built.rows.length).toBe(2)
    for (const row of built.rows) {
      const p = panels[row.slot]
      const want = (p.remielleRefringeCoefficient ?? 0) + (p.remielleRefringeCoefficientBonusPct ?? 0)
      expect(want).toBeGreaterThan(0)
      expect(row.refringe).toBe(want)
    }
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
