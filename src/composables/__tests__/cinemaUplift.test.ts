/**
 * 命座提升率分析器（analyzeCinemaUplift）的行为锁：把「机制录了但没接进计算」从人工肉眼
 * 自检升级成红灯。
 *
 * 背景：AGENTS 规则 5 要求每录一条命座效果后，去「资源利用率页·命座提升率」确认没有橙色
 * 「⚠无变化」角标——这是本项目最高频事故类型（死数据）的唯一检测手段，却只能靠人看。
 * 检测算法原先埋在 ResourceUtilizationPage.vue 里（含 store 改写 + nextTick），测试无法调用。
 * 抽到 composables/cinemaUplift.ts 后，这里锁三件事：
 *   ① 分析器不改坏现场（命座等级与失衡锁必须恢复原值）；
 *   ② 三态自检语义正确（ok / execLevel / unimplemented 的判据）；
 *   ③ 真实角色的已实现命座级别不会被判成 unimplemented。
 *
 * 全角色版的零成本不变量（60 角色 C0 vs C6 伤害必须有提升）在 allAgentsSweep.test.ts，
 * 本文件只覆盖分析器本身的逐级语义，避免重复烧 CI 时间。
 *
 * 超时：**不写 per-test 绝对超时**（2026-09-14 实测：本文件用例单跑 17.1s / 14.1s，原先钉 `30000`，
 * 满套件并发下占比 57% / 47% —— 与 `charIncrementInt.test.ts` 同族缺陷：它测的是机器/并发，不是回归）。
 * 统一由 `vite.config.ts` 的 `testTimeout: 180_000` 承担。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useConfigStore } from '@/stores/config'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { useCatalogStore } from '@/stores/catalog'
import {
  analyzeCinemaUplift,
  buildCinemaMetrics,
  collectCinemaMetrics,
  CINEMA_METRICS,
  UPLIFT_EPSILON_PCT,
  type CinemaMetricSource,
} from '@/composables/cinemaUplift'

const constellations: Record<string, { cinemas?: { cinema: number; status?: string }[] }> =
  JSON.parse(readFileSync(new URL('../../../public/static/character-constellations.json', import.meta.url), 'utf8')).characters ?? {}

/** 该角色某一级命座是否被状态表声明为「已实现」 */
function declaresImplemented(agentId: string, cinema: number): boolean {
  const entry = (constellations[agentId]?.cinemas ?? []).find(c => c.cinema === cinema)
  return String(entry?.status ?? '').startsWith('implemented')
}

async function analyze(agentId: string, mates: string[] = [], configure?: (config: ReturnType<typeof useConfigStore>) => void) {
  const { config } = await setupHarness([{ agentId }, ...mates.map(id => ({ agentId: id }))])
  configure?.(config)
  const calc = useResourceCalc()
  const catalogStore = useCatalogStore()
  const rows = await analyzeCinemaUplift({
    configStore: config,
    catalogStore,
    readDamage: () => calc.teamTotalDamage.value,
    readUltimateTotal: () => (calc.resourceResult.value?.characters ?? [])
      .reduce((sum, c) => sum + (c.ultimateCount ?? 0), 0),
    // R1：附加指标与伤害同场景读数（求和口径单源在 collectCinemaMetrics）
    readMetrics: () => collectCinemaMetrics({
      characters: calc.resourceResult.value?.characters,
      stunPool: calc.stunPoolResult.value,
      anomalyPool: calc.anomalyPoolResult.value,
    }),
    targetStunCount: calc.stunPoolResult.value?.stunCount ?? 4,
    slots: [0],
  })
  return { rows, config, calc }
}

describe('analyzeCinemaUplift（命座提升率 + 死数据自检）', () => {
  it('不改坏现场：命座等级与失衡锁在返回前恢复原值', async () => {
    const { config } = await setupHarness([{ agentId: '1371', cinemaLevel: 2 }, { agentId: '1251' }, { agentId: '1271' }])
    const calc = useResourceCalc()
    const catalogStore = useCatalogStore()
    const stunLockBefore = config.enemy.stunCountLock
    const cinemasBefore = config.team.map(c => c?.cinemaLevel ?? 0)

    await analyzeCinemaUplift({
      configStore: config,
      catalogStore,
      readDamage: () => calc.teamTotalDamage.value,
      readUltimateTotal: () => 0,
      targetStunCount: calc.stunPoolResult.value?.stunCount ?? 4,
      slots: [0],
    })

    expect(config.team.map(c => c?.cinemaLevel ?? 0)).toEqual(cinemasBefore)
    expect(config.enemy.stunCountLock).toBe(stunLockBefore)
  })

  it('多槽隔离（CC-338）：slots=[0,1] 下槽 1 的提升率与单独分析 slots=[1] 逐位一致（槽 0 不残留 C6）', async () => {
    const { config } = await setupHarness([{ agentId: '1371', cinemaLevel: 0 }, { agentId: '1251', cinemaLevel: 0 }, { agentId: '1271', cinemaLevel: 0 }])
    const calc = useResourceCalc()
    const catalogStore = useCatalogStore()
    const targetStunCount = calc.stunPoolResult.value?.stunCount ?? 4
    const soloSlot1 = await analyzeCinemaUplift({
      configStore: config,
      catalogStore,
      readDamage: () => calc.teamTotalDamage.value,
      readUltimateTotal: () => 0,
      targetStunCount,
      slots: [1],
      maxLevel: 2,
    })
    const bothSlots = await analyzeCinemaUplift({
      configStore: config,
      catalogStore,
      readDamage: () => calc.teamTotalDamage.value,
      readUltimateTotal: () => 0,
      targetStunCount,
      slots: [0, 1],
      maxLevel: 2,
    })
    expect(bothSlots[1].entries).toEqual(soloSlot1[0].entries)
  })

  it('逐级返回 1..6 且字段自洽（gainPct 有限、warn 三态之一、ult 次数非负）', async () => {
    const { rows } = await analyze('1371', ['1251', '1271'])
    expect(rows).toHaveLength(1)
    const entries = rows[0].entries
    expect(entries.map(e => e.to)).toEqual([1, 2, 3, 4, 5, 6])
    for (const e of entries) {
      expect(Number.isFinite(e.gainPct), `命座${e.to} gainPct 非有限`).toBe(true)
      expect(['ok', 'execLevel', 'unimplemented']).toContain(e.warn)
      expect(e.ultBefore).toBeGreaterThanOrEqual(0)
      expect(e.ultAfter).toBeGreaterThanOrEqual(0)
    }
  })

  it('自检语义：面板有字段变化 → ok；无面板变化但伤害移动 |gain| ≥ ε（含微负）→ execLevel；零移动 → unimplemented', async () => {
    const { rows } = await analyze('1371', ['1251', '1271'])
    for (const e of rows[0].entries) {
      if (e.changedFields.length > 0) {
        expect(e.warn, `命座${e.to} 有面板变化却不是 ok`).toBe('ok')
      } else if (Math.abs(e.gainPct) >= UPLIFT_EPSILON_PCT) {
        // 与 analyzer 同源：伤害符号变化本身是执行/资源级生效证据（预算极紧时可轻微负增益）
        expect(e.warn, `命座${e.to} 无面板变化但有移动，应为 execLevel`).toBe('execLevel')
      } else {
        expect(e.warn).toBe('unimplemented')
      }
    }
  })

  it('防死数据：状态表声明已实现的命座级别不得被判为 unimplemented（仪玄/般岳/卢西娅）', async () => {
    type Configure = (config: ReturnType<typeof useConfigStore>) => void
    const cases: Array<[string, string[], Configure | undefined]> = [
      // 仪玄 4命（静心）增伤载体 = 凝云/墨烬影消行：自动口径下轴外闪能全打 3 连墨痕化形（cloudOut=0），
      // 非轴模式 C4 无载体会被误报死数据——按实战口径挂失衡轴（轴内凝云）验证
      ['1371', ['1251', '1271'], config => {
        config.useStunAxis = true
        config.stunAxes = [{ name: '轴1', count: 3, actions: [{ slot: 0, moveId: '1371022', count: 1 }], basicFillerSlot: 0 }]
      }],
      ['1471', ['1481'], undefined],
      ['1451', ['1051'], undefined],
    ]
    for (const [agentId, mates, configure] of cases) {
      const { rows } = await analyze(agentId, mates, configure)
      const bad = rows[0].entries
        .filter(e => declaresImplemented(agentId, e.to) && e.warn === 'unimplemented')
        .map(e => `影画${e.to}（提升 ${e.gainPct.toFixed(3)}%）`)
      expect(
        bad,
        `${agentId} 以下命座在状态表标了已实现，但面板无变化且伤害无提升（死数据）：${bad.join('、')}`,
      ).toHaveLength(0)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// R1（docs/REQUIREMENTS.md）：命座提升率的附加指标栏（失衡值/积蓄/喧响/能量…）
// 选栏依据与探针逐队 Δ 表见 docs/mcp-cinema-uplift-multi-metric.md §2
// ═══════════════════════════════════════════════════════════════════════════════

describe('R1 附加指标栏（失衡值/积蓄/喧响/能量）', () => {
  /** R1 点名的四栏（用户原话：失衡、积蓄、喧响、能量） */
  const PRIMARY = ['stunBuildUp', 'anomBuildUp', 'decibelTotal', 'energyTotal']

  it('栏位定义：四栏齐全、中文列名与游戏内叫法一致、顺序即页面列顺序', () => {
    const labels = Object.fromEntries(CINEMA_METRICS.map(m => [m.key, m.label]))
    expect(labels.stunBuildUp).toBe('失衡值')
    expect(labels.anomBuildUp).toBe('积蓄')
    expect(labels.decibelTotal).toBe('喧响')
    expect(labels.energyTotal).toBe('能量')
    // 方案 B 的机器面：失衡栏用「失衡值总量」，**不许**用被 stunCountLock 钉死的「失衡次数」
    // （探针实测 3 队里 2 队 stunCount 逐级 Δ 恒 0，用它当栏会直接违反「不是恒 0」的验收）
    expect(CINEMA_METRICS.some(m => m.key === 'stunCount')).toBe(false)
    // 派生量同理不进栏：连携次数/紊乱次数由失衡次数派生；derivedEnergy 与 energyTotal 逐位相同
    for (const redundant of ['chainCountTotal', 'disorderCount', 'derivedEnergy']) {
      expect(CINEMA_METRICS.some(m => m.key === redundant), `${redundant} 不该进栏`).toBe(false)
    }
    for (const key of PRIMARY) expect(CINEMA_METRICS.some(m => m.key === key), `缺 ${key} 栏`).toBe(true)
  })

  it('每一级命座都有数，且栏位与 CINEMA_METRICS 逐位对齐（不能只出第一级）', async () => {
    const { rows } = await analyze('1371', ['1251', '1271'])
    const entries = rows[0].entries
    expect(entries.map(e => e.to)).toEqual([1, 2, 3, 4, 5, 6])
    for (const e of entries) {
      expect(e.metrics, `命座${e.to} 缺指标读数`).toHaveLength(CINEMA_METRICS.length)
      // 顺序与键集必须与定义逐位一致：页面表头取 CINEMA_METRICS、单元格取 e.metrics，错位就会串栏
      expect(e.metrics.map(m => m.key)).toEqual(CINEMA_METRICS.map(m => m.key))
      for (const m of e.metrics) {
        expect(Number.isFinite(m.before), `命座${e.to} ${m.key} before 非有限`).toBe(true)
        expect(Number.isFinite(m.after), `命座${e.to} ${m.key} after 非有限`).toBe(true)
        expect(Number.isFinite(m.delta)).toBe(true)
        expect(Number.isFinite(m.pct)).toBe(true)
        expect(m.delta).toBeCloseTo(m.after - m.before, 6)
        expect(m.label).toBeTruthy()
      }
    }
  })

  it('★ R1 验收：新增四栏都不是恒 0（逐级至少有一级会动）', async () => {
    // 探针实测（仪玄1371+青衣1251+赛斯1271，锁定场景，C0 基线）四栏 Δ 全非零：
    // 失衡值 −4354.56 / 积蓄 −4197.98 / 喧响 −1874.80 / 能量 −20.55（最大绝对值，见文档 §2 表）
    const { rows } = await analyze('1371', ['1251', '1271'])
    const entries = rows[0].entries
    for (const key of PRIMARY) {
      const deltas = entries.map(e => e.metrics.find(m => m.key === key)!.delta)
      const maxAbs = Math.max(...deltas.map(Math.abs))
      expect(maxAbs, `${key} 栏在 1..6 命逐级全为 0（恒 0 栏，R1 不接受）：Δ=[${deltas.join(', ')}]`).toBeGreaterThan(0)
    }
  })

  it('★ 同场景纪律：伤害/大招/附加指标都在「失衡次数锁定」窗口内读（R1 要求 3）', async () => {
    // 机器面锁死口径：三个读取器被调用时 enemy.stunCountLock 必须都等于 targetStunCount。
    // 若有人把 ult 或 metrics 移回锁外读（改前的形态），本用例立刻变红。
    const { config } = await setupHarness([{ agentId: '1371' }, { agentId: '1251' }, { agentId: '1271' }])
    const calc = useResourceCalc()
    const catalogStore = useCatalogStore()
    const target = 2
    const originalLock = config.enemy.stunCountLock
    const seen: Record<string, number[]> = { dmg: [], ult: [], metrics: [] }
    await analyzeCinemaUplift({
      configStore: config,
      catalogStore,
      readDamage: () => { seen.dmg.push(config.enemy.stunCountLock); return calc.teamTotalDamage.value },
      readUltimateTotal: () => { seen.ult.push(config.enemy.stunCountLock); return 0 },
      readMetrics: () => {
        seen.metrics.push(config.enemy.stunCountLock)
        return collectCinemaMetrics({
          characters: calc.resourceResult.value?.characters,
          stunPool: calc.stunPoolResult.value,
          anomalyPool: calc.anomalyPoolResult.value,
        })
      },
      targetStunCount: target,
      slots: [0],
    })
    for (const kind of ['dmg', 'ult', 'metrics'] as const) {
      expect(seen[kind].length, `${kind} 一次都没被读到`).toBeGreaterThan(0)
      expect(
        seen[kind].filter(v => v !== target),
        `${kind} 有 ${seen[kind].filter(v => v !== target).length} 次读数不在锁定场景内（口径分裂）`,
      ).toEqual([])
    }
    // 收工必须把锁恢复成原值（不改坏现场；原值可能本来就是 -1，故对比原值而不是硬编码 -1）
    expect(config.enemy.stunCountLock).toBe(originalLock)
  })

  it('向后兼容：不传 readMetrics 时 metrics 为空数组（既有调用方零改动）', async () => {
    const { config } = await setupHarness([{ agentId: '1371' }, { agentId: '1251' }])
    const calc = useResourceCalc()
    const rows = await analyzeCinemaUplift({
      configStore: config,
      catalogStore: useCatalogStore(),
      readDamage: () => calc.teamTotalDamage.value,
      readUltimateTotal: () => 0,
      targetStunCount: calc.stunPoolResult.value?.stunCount ?? 4,
      slots: [0],
    })
    expect(rows[0].entries.every(e => e.metrics.length === 0)).toBe(true)
    // 三态语义不受影响（仍按 changedFields / gainPct 判）
    expect(rows[0].entries.every(e => ['ok', 'execLevel', 'unimplemented'].includes(e.warn))).toBe(true)
  })

  it('collectCinemaMetrics：求和口径（能量/喧响/强特逐角色求和，积蓄各属性求和，失衡值取池级总量）', () => {
    const fixture = {
      characters: [
        { energySource: { total: 100 }, decibelSource: { total: 3000 }, exSpecialCount: 4 },
        { energySource: { total: 50.5 }, decibelSource: { total: 2000 }, exSpecialCount: 1 },
      ],
      stunPool: { totalStunBuildUp: 45241.776 },
      anomalyPool: {
        perElement: [{ totalBuildUp: 10 }, { totalBuildUp: 2.5 }],
        totalTriggerCount: 11,
        coverage: { coverageRate: 0.611 },
      },
    } as unknown as CinemaMetricSource
    const got = collectCinemaMetrics(fixture)
    expect(got.energyTotal).toBeCloseTo(150.5, 9)
    expect(got.decibelTotal).toBeCloseTo(5000, 9)
    expect(got.exSpecial).toBe(5)
    expect(got.stunBuildUp).toBeCloseTo(45241.776, 9)
    expect(got.anomBuildUp).toBeCloseTo(12.5, 9)
    expect(got.anomTriggers).toBe(11)
    expect(got.coverage).toBeCloseTo(0.611, 9)
    // 空/缺字段一律回落 0，不许 NaN（页面会直接显示）
    const empty = collectCinemaMetrics({ characters: null, stunPool: null, anomalyPool: null })
    for (const def of CINEMA_METRICS) {
      expect(Number.isFinite(empty[def.key]), `${def.key} 空输入非有限`).toBe(true)
      expect(empty[def.key]).toBe(0)
    }
  })

  it('buildCinemaMetrics：delta/pct 口径与 gainPct 同族（base<=0 → pct 0），null 读数 → 空数组', () => {
    expect(buildCinemaMetrics(null, { energyTotal: 1 })).toEqual([])
    expect(buildCinemaMetrics({ energyTotal: 1 }, null)).toEqual([])
    const got = buildCinemaMetrics(
      { stunBuildUp: 1000, anomBuildUp: 0, decibelTotal: 500, energyTotal: 200, exSpecial: 4, anomTriggers: 2, coverage: 0.5 },
      { stunBuildUp: 800, anomBuildUp: 0, decibelTotal: 600, energyTotal: 200, exSpecial: 5, anomTriggers: 2, coverage: 0.56 },
    )
    expect(got.map(m => m.key)).toEqual(CINEMA_METRICS.map(m => m.key))
    const byKey = Object.fromEntries(got.map(m => [m.key, m]))
    expect(byKey.stunBuildUp.delta).toBeCloseTo(-200, 9)      // 负增量必须保留符号（预算权衡）
    expect(byKey.stunBuildUp.pct).toBeCloseTo(-20, 9)
    expect(byKey.decibelTotal.delta).toBeCloseTo(100, 9)
    expect(byKey.decibelTotal.pct).toBeCloseTo(20, 9)
    expect(byKey.anomBuildUp.pct).toBe(0)                     // base=0 → pct 0（与 gainPct 同口径）
    expect(byKey.anomBuildUp.delta).toBe(0)
    expect(byKey.energyTotal.delta).toBe(0)
    expect(byKey.exSpecial.delta).toBe(1)
    expect(byKey.coverage.delta).toBeCloseTo(0.06, 9)
    expect(byKey.coverage.kind).toBe('rate')
    // 缺键回落 0，不产生 NaN
    const partial = buildCinemaMetrics({}, {})
    expect(partial.every(m => m.delta === 0 && m.pct === 0 && Number.isFinite(m.before))).toBe(true)
  })
})
