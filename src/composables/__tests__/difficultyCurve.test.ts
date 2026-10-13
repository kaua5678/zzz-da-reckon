/**
 * 难度曲线展示层判据：`buildCurveChart` 纯函数契约 + `computeDifficultyCurves` 真实跑一队的集成冒烟。
 *
 * 用户 2026-09-10 口径：**每队的 x 不一定对齐**（x = 该队自己的累积难度代价），
 * 所以判据不是「同一 x 上比大小」，而是：曲线单调不减、平台队如实标 flat、现场必恢复。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { mockStaticFetch, newPinia, setupHarness } from '@/test/harness'
import { liveInteractions } from '@/composables/liveInteractions'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { withAnalysisScenario } from '@/composables/analysisScenario'
import {
  assignLabelLanes, attributeDmgChanges, buildCurveChart, computeDifficultyCurves, diffDmgBySource,
  captureDmgBySource, captureKeyCounts, diffKeyCounts, estimateLabelWidth, linkCountToDmg, majorChanges,
  measureOperationalDifficulty, pickNonOverlapping, truncationHintAt, laneKeyOf, seriesForLane, INTERACTION_CUT_MIN,
  type DifficultyCurveOptions, type DifficultyCurveRow,
} from '@/composables/difficultyCurve'
import { absorbCapOf, clearDifficultyLevers, climbDifficultyLadder, scanAbsorbGrid, type LadderResult, type LadderPoint } from '@/composables/difficultyLadder'
import { applyTeamToStore, computeDifficulty } from '@/composables/teamCompare'
import { frontlineOccupationBreakdown, netFrontlineOccupation } from '@/core/resource/timeOccupation'
import { teamPresets } from '@/data/teamPresets'
import { COMBO_ALIGN_ABSORB_RATIO_SETTING, DEFAULT_COMBO_ALIGN_ABSORB_RATIO } from '@/data/resourceDefaults'
import type { BossPreset, BossPresetPhase, PhaseBuffCard } from '@/types/bossPreset'

beforeEach(() => {
  newPinia()
  mockStaticFetch()
})

// ========== 合成阶梯（纯函数判据用，不跑引擎） ==========

/**
 * 把 [操作难度, 伤害] 点列包成 `LadderResult`（T140c 关键点结构）。
 *
 * `points` = 点名序列（缺省 = `baseline → max`；给了就逐点对应）。
 * 轴态缺省 `none`（合成夹具不跑引擎）；需要轴态的用例用 `axisKinds` 指定。
 */
function mkLadder(
  points: [number, number][],
  pointNames: LadderPoint['point'][] = [],
  counts: Record<string, number>[] = [],
  /**
   * 逐点截断量（截断提醒判据用）：`[手填交互, 实打交互, 截断秒]`。
   * 缺省 = 不采（`undefined`）⇒ `truncationHintAt` 一律返回 null（与 `capture` 未给时同口径）。
   */
  trunc: [number, number, number?][] = [],
  axisKinds: LadderPoint['axis']['kind'][] = [],
  gain?: number,
): LadderResult {
  const names: LadderPoint['point'][] = pointNames.length > 0 ? pointNames : ['baseline', 'max']
  const mkAxis = (kind: LadderPoint['axis']['kind']): LadderPoint['axis'] => ({
    kind, skipped: { time: 0, decibel: 0, energy: 0 }, skippedTotal: 0, fallback: kind === 'infeasible',
  })
  const pts: LadderPoint[] = points.map(([x, dmg], i) => {
    const name = names[Math.min(i, names.length - 1)]!
    return {
      x, dmg, point: name,
      knobs: {
        interactions: name === 'baseline' ? 'default' : 'joint',
        absorb: name === 'baseline' ? 0 : name === 'max' ? 0.4 : 0.2,
      },
      axis: mkAxis(axisKinds[i] ?? 'none'),
      counts: counts[i],
      ...(trunc[i]
        ? { interactionsFilled: trunc[i]![0], interactionsPlayed: trunc[i]![1], overflow: trunc[i]![2] ?? 0 }
        : {}),
    }
  })
  const base = points[0]![1]
  const final = points[points.length - 1]![1]
  return {
    base,
    final,
    points: pts,
    axisPointMissing: !names.includes('axis'),
    gain: gain ?? final - base,
  }
}

/** 合成图行（纯函数判据不关心金档/期数，填占位；`period*`/`label`/`hp` 只在环境模式有意义） */
const HP = 100_000_000
const mkRow = (presetId: string, name: string, ladder: LadderResult, hp = HP): DifficultyCurveRow =>
  ({ presetId, name, ladder, periodKey: null, periodId: null, label: name, hp })

describe('buildCurveChart（纯函数）', () => {
  it('空输入返回可画的空图（不产生 NaN / 负上界）', () => {
    const c = buildCurveChart([], HP)
    expect(c.series).toEqual([])
    expect(c.costMax).toBe(1)
    // 纵轴下限 150%（与散点页同口径：击杀线 100% 之上留出两倍血量的余量）
    expect(c.ratioMax).toBe(150)
    expect(c.costTicks[0]).toBe(0)
    for (const t of c.costTicks) expect(t).toBeLessThanOrEqual(c.costMax)
  })

  it('比例 = 伤害/血量%；上界为 50 的倍数且 ≥100；刻度覆盖到 costMax', () => {
    const rows: DifficultyCurveRow[] = [
      mkRow('a', 'A', mkLadder([[0, 45_000_000], [3, 90_000_000]], ['baseline', 'max'])),
      mkRow('b', 'B', mkLadder([[0, 20_000_000], [1, 22_000_000], [4, 30_000_000]], ['baseline', 'max', 'max'])),
    ]
    const c = buildCurveChart(rows, HP)
    expect(c.series).toHaveLength(2)
    expect(c.series[0]!.points.map(p => p.ratio)).toEqual([45, 90])
    expect(c.costMax).toBe(4)
    expect(c.ratioMax % 50).toBe(0)
    expect(c.ratioMax).toBeGreaterThanOrEqual(100)
    expect(c.costTicks[c.costTicks.length - 1]).toBe(4)
  })

  it('★ x 轴上限覆盖**所有点**（不是末点）—— 非单调曲线不得越界（2026-10-12 修）', () => {
    // 用户症状：「难度曲线右边的图像看不见，只能看见低难度的部分」。
    // 根因：costMax 原取 `s.totalCost`（= **末点** x），而口径明写 **x 不保证单调**
    // （有的杠杆减少交互 ⇒ 难度降、伤害升 = 白拿的优化，贪心优先做）。
    // ⇒ 末点 x < 中途某点 x 时，那些点的 cx 超出绘图区右边界、被 SVG 裁掉。
    // 实测（全库 97 队）：72 队非单调，3 队越界；筛成单队时最严重
    // （实测样本：某队 maxX=61.26 而末点 x=23.4 ⇒ cx=2763，viewBox 宽仅 1100）。
    const rows: DifficultyCurveRow[] = [
      // 先升后降：末点 x=2，但中途有 x=10 的点（G2 白拿）
      mkRow('a', 'A', mkLadder([[0, 10], [10, 30], [2, 40]], ['baseline', 'max', 'max'])),
    ]
    const c = buildCurveChart(rows, 100)
    expect(c.costMax).toBeGreaterThanOrEqual(10)
    // 不变量：**任何点都不得超出轴上限**（这正是「画到框外看不见」的机器判据）
    for (const s of c.series) {
      for (const p of s.points) expect(p.cost).toBeLessThanOrEqual(c.costMax + 1e-9)
    }
    // 末刻度必须落在轴上限（否则最右那批点无从读数）
    expect(c.costTicks[c.costTicks.length - 1]).toBe(c.costMax)
    // 末点 x 仍如实保留在 totalCost 里（表里「N 点」列用的是它，语义不变）
    expect(c.series[0]!.totalCost).toBe(2)
  })

  it('★ 不变量：任意点集下，所有点 x 都落在 [0, costMax] 内（防越界回归）', () => {
    // 与上一条同源，但用「乱序/回撤/平台」三种形状把不变量钉死——
    // 上一条只覆盖「先升后降」，这条覆盖「回撤多次」「末点最小」等极端。
    const shapes: [number, number][][] = [
      [[0, 10], [5, 20], [3, 25], [8, 30], [1, 35]],       // 多次回撤、末点最小
      [[0, 10], [12, 20], [0, 30]],                         // 回到起点
      [[0, 10], [0, 10], [0, 10]],                          // 全平台
      [[0, 10], [7, 20]],                                   // 单调（对照组）
    ]
    const rows = shapes.map((pts, i) => mkRow(`s${i}`, `S${i}`, mkLadder(pts, [])))
    const c = buildCurveChart(rows, 100)
    const allX = c.series.flatMap(s => s.points.map(p => p.cost))
    expect(c.costMax).toBe(Math.max(1, ...allX))
    for (const x of allX) {
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThanOrEqual(c.costMax + 1e-9)
    }
  })

  it('单调不减 + 提升倍数/斜率：每队自己的 x 不对齐也照样成立', () => {
    const rows: DifficultyCurveRow[] = [
      mkRow('a', 'A', mkLadder([[0, 10], [1, 20], [4, 30], [6, 30]], ['baseline', 'axis', 'progress', 'max'])),
      mkRow('b', 'B', mkLadder([[0, 10], [3, 11]], ['baseline', 'max'])),
    ]
    for (const s of buildCurveChart(rows, 100).series) {
      for (let i = 1; i < s.points.length; i++) {
        expect(s.points[i]!.cost).toBeGreaterThanOrEqual(s.points[i - 1]!.cost)
        expect(s.points[i]!.dmg).toBeGreaterThanOrEqual(s.points[i - 1]!.dmg)
      }
      expect(s.gainX).toBeGreaterThanOrEqual(1)
      expect(s.flat).toBe(false)
    }
    const [a, b] = buildCurveChart(rows, 100).series
    expect(a!.gainX).toBe(3)
    expect(a!.totalCost).toBe(6)
    expect(b!.slope).toBeCloseTo(10 / 3, 6) // (11−10)/10 = +10% ÷ 3 点
  })

  it('平台队（一个目标都没录取）标 flat 且只有起点；代价 0 的目标不塌缩', () => {
    const flat = buildCurveChart([mkRow('f', 'F', mkLadder([[0, 45_000_000]]))], HP)
    expect(flat.series[0]!.flat).toBe(true)
    expect(flat.series[0]!.points).toHaveLength(1)
    expect(flat.series[0]!.gainPct).toBe(0)

    // G4 代价 = 0：两点同 x（0 → 0），仍是两个可画的点
    const zeroCost = buildCurveChart(
      [mkRow('z', 'Z', mkLadder([[0, 50_000_000], [0, 50_500_000]], ['baseline', 'progress']))], HP,
    )
    expect(zeroCost.series[0]!.points).toHaveLength(2)
    expect(zeroCost.series[0]!.points.every(p => p.cost === 0)).toBe(true)
    expect(zeroCost.series[0]!.flat).toBe(false)
  })
})

describe('buildCurveChart · 环境模式：血量**逐行**取（用户 2026-10-13「不同期数的血量膨胀」）', () => {
  const mk = (hp: number) => mkRow('p1', '队', mkLadder([[0, 20_000_000], [10, 40_000_000]]), hp)

  it('同一队两条道（不同期血量）⇒ ratio 各按自己的血量算，不被当期血量统一', () => {
    const c = buildCurveChart([mk(20_000_000), mk(80_000_000)], 20_000_000)
    expect(c.series).toHaveLength(2)
    // 早期期：20M/20M = 100%、40M/20M = 200%
    expect(c.series[0]!.points.map(p => p.ratio)).toEqual([100, 200])
    // 后期期（血量 4 倍）：20M/80M = 25%、40M/80M = 50%
    expect(c.series[1]!.points.map(p => p.ratio)).toEqual([25, 50])
    // ★ 若误用调用方那一个 hp，两条会算出同一组 ratio ⇒ 这条判据就是防它的
    expect(c.series[0]!.points.map(p => p.ratio)).not.toEqual(c.series[1]!.points.map(p => p.ratio))
    expect(c.series[0]!.hp).toBe(20_000_000)
    expect(c.series[1]!.hp).toBe(80_000_000)
  })

  it('道的唯一键：环境模式加期后缀（一个 presetId 可以有多条），自身实力模式 = presetId', () => {
    const envRows: DifficultyCurveRow[] = [
      { ...mk(20_000_000), periodKey: 'k0', periodId: 'pa', label: '早期' },
      { ...mk(20_000_000), periodKey: 'k1', periodId: 'pb', label: '后期' },
    ]
    const c = buildCurveChart(envRows, 20_000_000)
    expect(c.series.map(s => s.laneKey)).toEqual(['p1::k0', 'p1::k1'])
    expect(new Set(c.series.map(s => s.laneKey)).size).toBe(2) // 键唯一 ⇒ 图例/选中不会互相覆盖
    expect(c.series.map(s => s.label)).toEqual(['早期', '后期'])
    expect(buildCurveChart([mk(20_000_000)], 20_000_000).series[0]!.laneKey).toBe('p1')
  })

  it('血量缺失/非正 ⇒ 退回调用方给的血量（自身实力模式的口径），不产生 Infinity/NaN', () => {
    const c = buildCurveChart([mkRow('p1', '队', mkLadder([[0, 10_000_000]]), 0)], 50_000_000)
    expect(c.series[0]!.hp).toBe(50_000_000)
    expect(c.series[0]!.points[0]!.ratio).toBe(20)
  })
})

describe('laneKeyOf / seriesForLane：一队多道时认对 series（实机踩到的回归）', () => {
  const series = [
    { laneKey: 'p1::a1', presetId: 'p1', tag: 'first' },
    { laneKey: 'p1::a2', presetId: 'p1', tag: 'second' },
    { laneKey: 'p2', presetId: 'p2', tag: 'solo' },
  ]

  it('道键：自身实力模式 = presetId；环境模式 = presetId::periodKey', () => {
    expect(laneKeyOf('p1', null)).toBe('p1')
    expect(laneKeyOf('p1', 'a2')).toBe('p1::a2')
  })

  it('★ 同一队的两条道各认到自己的 series（按 presetId 找会全落回第一条）', () => {
    expect(seriesForLane(series, { presetId: 'p1', laneKey: 'p1::a1' })?.tag).toBe('first')
    expect(seriesForLane(series, { presetId: 'p1', laneKey: 'p1::a2' })?.tag).toBe('second')
    // ★ 回归判据：「该传 laneKey 却没传」（接线漏了）⇒ **认不到**，而不是随便落回第一条。
    //   宁可那条道不画，也不要把两条道画成同一条线（画错比不画更难发现）。
    expect(seriesForLane(series, { presetId: 'p1' })).toBeUndefined()
    // 带上 laneKey 后，第二条道**不再**拿到 first（这正是修复要保证的）
    expect(seriesForLane(series, { presetId: 'p1', laneKey: 'p1::a2' })?.tag).not.toBe('first')
  })

  it('版本轴口径（一个预设一条 series）仍能认到；认不到 ⇒ undefined，不瞎给一条', () => {
    expect(seriesForLane(series, { presetId: 'p2' })?.tag).toBe('solo')
    // 该队删了/筛选隐藏 ⇒ 认不到就 undefined（画错线比不画更糟）
    expect(seriesForLane(series, { presetId: 'p9', laneKey: 'p9::x' })).toBeUndefined()
  })
})

describe('关键次数差分（用户口径：难度上升到关键变化要标注）', () => {
  it('只认「变多」；变少 / 缺席 / 浮点噪声不标注；<1 的跃迁算变化但不算 major', () => {
    const changes = diffKeyCounts(
      { 大招: 7, 强特: 19.16, 连携: 8.9, 紊乱: 4, 乱流: 0, 失衡: 2 },
      { 大招: 8, 强特: 20.16, 连携: 9.0, 紊乱: 3, 乱流: 1, 失衡: 2.0000001, 新项: 5 },
    )
    const byLabel = Object.fromEntries(changes.map(c => [c.label, c]))
    expect(byLabel['大招']).toMatchObject({ from: 7, to: 8, delta: 1, major: true })
    expect(byLabel['强特']).toMatchObject({ major: true })          // +1.0：整数台阶
    expect(byLabel['连携']!.major).toBe(false)                      // 只跨了 0.1，不算「多一次」
    expect(byLabel['连携']!.delta).toBeCloseTo(0.1, 6)
    expect(byLabel['乱流']).toMatchObject({ major: true })
    expect(byLabel['失衡']).toBeUndefined()                        // +1e-7 浮点噪声，直接不算变化
    expect(byLabel['紊乱']).toBeUndefined()                        // 变少不标注
    expect(byLabel['新项']).toBeUndefined()                        // 上一档没有该项 = 不标注（防口径漂移）
    expect(majorChanges(changes).map(c => c.label).sort()).toEqual(['乱流', '大招', '强特'])
  })

  it('buildCurveChart：changes = 相邻档差分；jumps 只留「多了一次」的档', () => {
    const rows: DifficultyCurveRow[] = [mkRow('a', 'A', mkLadder(
      [[0, 100], [1, 200], [4, 300]],
      ['baseline', 'progress', 'max'],
      [
        { 大招: 7, 连携: 8.9, 紊乱: 0 },
        { 大招: 8, 连携: 8.95, 紊乱: 0 },  // 大招 +1（major）；连携 +0.05（minor）
        { 大招: 8, 连携: 9.9, 紊乱: 1 },   // 连携 +0.95（minor）；紊乱 +1（major）
      ],
    ))]
    const s = buildCurveChart(rows, 100).series[0]!
    expect(s.points[0]!.changes).toEqual([])
    expect(s.points[1]!.changes.map(c => c.label).sort()).toEqual(['大招', '连携'])
    expect(s.points[2]!.changes.length).toBe(2)
    // jumps = 有 major 的档位（第 2 档的 major 只有大招；第 3 档只留紊乱）
    expect(s.jumps.map(j => j.cost)).toEqual([1, 4])
    expect(s.jumps[0]!.changes.map(c => c.label)).toEqual(['大招'])
    expect(s.jumps[1]!.changes.map(c => c.label)).toEqual(['紊乱'])
  })
})

describe('操作难度自动算（x 轴自变量 = 交互值 + 时间占用，用户 2026-09-10 口径）', () => {
  it('liveInteractions：读**当前配置**的交互次数（不是预设声明），角色专属类型沿用预设', async () => {
    const { config } = await setupHarness(['', '', ''], { recommendedBuild: false })
    const preset = teamPresets.find(p => p.id === 'auto-1521-1481-1311')!
    // 先清零（harness 的 TEST_BASE_CHAR 给每槽 quickAssistCount=3，不清零会串味）
    for (const c of config.team) {
      c.parryCount = 0; c.dodgeCounterCount = 0; c.quickAssistCount = 0; c.blockCount = 0
    }
    config.team[0]!.parryCount = 3
    config.team[1]!.parryCount = 2
    config.team[0]!.quickAssistCount = 4
    const items = liveInteractions(config, preset)
    expect(items.find(i => i.type === 'parry')!.count).toBe(5)      // 跨槽位求和 = 这一档实打次数
    expect(items.find(i => i.type === 'quickAssist')!.count).toBe(4)
    expect(items.some(i => i.type === 'dodge')).toBe(true)          // 0 值也保留（明细要能照抄字段）
  })

  it('交互项按装配期截断存活率缩：逐槽 kept/requested；无截断（或缺 rr）= 逐位等于 config', async () => {
    // 用户 2026-09-11：「不上升合轴率导致招式截断，那么对应的资源回复也应该降低，或者交互次数应该降低」。
    // 纯函数口径（假 rr 只给 convergence.truncationBySlot）——不依赖"哪个队真截断"（那个集合随引擎修复在变：
    // 降配判据修正后交互型溢出被收进可行域，只剩 1431 簇等结构队）。
    const { config } = await setupHarness(['', '', ''], { recommendedBuild: false })
    const preset = teamPresets.find(p => p.id === 'auto-1521-1481-1311')!
    for (const c of config.team) { c.parryCount = 0; c.dodgeCounterCount = 0; c.quickAssistCount = 0; c.blockCount = 0 }
    config.team[0]!.parryCount = 8
    config.team[1]!.parryCount = 4
    const parry = (rr?: unknown) => liveInteractions(config, preset, rr as never).find(i => i.type === 'parry')!.count
    expect(parry()).toBe(12)                                    // 不传 rr = config 全量
    expect(parry(null)).toBe(12)                                // 无截断 = 因子 1
    // 逐槽缩：槽0 kept/requested = 0.5、槽1 = 0.75 ⇒ 8×0.5 + 4×0.75 = 7（2 位小数）
    const rr = { convergence: { truncationBySlot: [
      { slot: 0, requested: 100, kept: 50, cutSeconds: 50 },
      { slot: 1, requested: 100, kept: 75, cutSeconds: 25 },
    ] } }
    expect(parry(rr)).toBe(7)
    // 只截断槽0 ⇒ 槽1 因子 1（不在 truncationBySlot 里 = 不缩）
    expect(parry({ convergence: { truncationBySlot: [{ slot: 0, requested: 100, kept: 50, cutSeconds: 50 }] } })).toBe(8)  // 8×0.5 + 4×1
    // 空表 = 无截断（等价于「合轴率开满 → 截断 0」）⇒ 不缩
    expect(parry({ convergence: { truncationBySlot: [] } })).toBe(12)
  })

  it('measureOperationalDifficulty = Σ(交互×权重) + 溢出秒×溢出权重（权重可改）', async () => {
    const { config } = await setupHarness(['', '', ''], { recommendedBuild: false })
    const preset = teamPresets.find(p => p.id === 'auto-1521-1481-1311')!
    for (const c of config.team) { c.parryCount = 0; c.dodgeCounterCount = 0; c.quickAssistCount = 0; c.blockCount = 0; c.tauntCancelCount = 0 }
    config.team[0]!.parryCount = 3
    const calc = { resourceResult: { value: null } } as never
    // 把弹刀权重设成 2 ⇒ 3 次弹刀 = 6 点难度
    expect(measureOperationalDifficulty({ config, calc } as never, preset, { interaction: { parry: 2 } })).toBe(6)
    // 权重换回默认 0.5 档（INTERACTION_WEIGHTS.parry）后，同一配置的量随之变化
    const def = measureOperationalDifficulty({ config, calc } as never, preset)
    expect(def).toBeGreaterThan(0)
    expect(def).not.toBe(6)
  })

  it('集成：x 轴 = 实测操作难度（绝对值，与散点同尺），④ ≥ ①', async () => {
    const { catalog } = await setupHarness(['', '', ''], { recommendedBuild: false })
    await catalog.loadBuildRecommendations()
    const preset = teamPresets.find(p => p.id === 'auto-1521-1481-1311')!
    const [row] = await withAnalysisScenario(s => computeDifficultyCurves(s, { presets: [preset], boss: FAKE_BOSS, phase: FAKE_PHASE }))
    const pts = row!.ladder.points
    /**
     * ⚠ **T141 改口径**：① 现在是「**全 0 交互**」（用户口径 4+5「低难度下就是全 0 交互的」）
     * ⇒ 它的 x **不再保证 > 0**（交互项为 0；时间压力项仍可能 > 0）。
     * 旧断言 `pts[0].x > 0` 建立在「① 走预设交互」上——那正是本卡删掉的语义。
     * 保留的判据 = x 与 difficulty **同源同值**（绝对口径、与散点横轴同尺，这才是本条要钉的）。
     */
    expect(pts[0]!.x).toBeGreaterThanOrEqual(0)
    expect(pts[0]!.x).toBe(pts[0]!.difficulty)    // 与散点横轴同一口径，直接可比
    for (const p of pts) expect(p.x).toBeCloseTo(p.difficulty!, 6)
    // ⚠️ **T140c 起不再断言「伤害严格单调增」**（旧契约随贪心阶梯失效）：
    //  · x 不保证单调（joint 可能**减少**交互次数 ⇒ 难度降、伤害升 = 白拿的优化）——
    //    实测本队 x 65.4 → 45.4，难度确实回落了；
    //  · **相邻点伤害可以相等**：本队 ② 的轴在 (joint, 0) 下**已经完整** ⇒ ④ 把吸收抬到 0.4
    //    对它是空操作（实测 ②=④=89.830M）。这是**实情**，不是缺陷——「提高合轴上限对这条队没用」
    //    正是曲线该说的话（卡 §4：不回退该点，藏起来才是骗人）。
    //  ⇒ 新契约 = **④ ≥ ①**（卡 §6.5 的机器判据）：「难度上升 ⇒ 总伤上升」是**总体**保证，
    //    不是逐点严格递增（用户 §1(4)：低难度达不到资源要求就如实标注）。
    const last = pts[pts.length - 1]!
    expect(last.dmg).toBeGreaterThanOrEqual(pts[0]!.dmg - 1e-6)
    expect(row!.ladder.gain).toBeGreaterThan(0)
    /**
     * ## T141：x 现在**单调不减**（旧断言钉的「有降难度的一点」已作废）
     *
     * 旧断言 `pts.some(p => p.x < 前一点.x)` 要求曲线里**存在**一个难度回落点——那是旧口径的
     * **症状**：① 从预设交互起步，`joint` 优化时**减少**低效交互（弹刀 12→10 / 12→6）⇒
     * 难度降、伤害升（实测锋御 5 队 Δx = **−16.9 ~ −24.2**，用户 2026-10-12 报的
     * 「完全没有近似正相关的感觉」正是它）。
     *
     * 本卡修完后 ① 从**全 0 交互**起步 ⇒ 逐槽阶梯**只加不减** ⇒ x 自然单调不减。
     * 全库实测（`.zc/perf/T141axis2.perf.ts`，93 队生产路径）：**Δx < 0 的队 = 0 支**
     * （旧口径下锋御 5 队全为负）。
     * ⚠ 这条是卡 §3.4「难度同向」的机器判据（④.x ≥ ①.x）；单点 x 仍**不保证**逐点严格增
     * （相邻点可以相等——② 与 ④ 在轴已完整时同值，见上），故只钉「不减」。
     */
    expect(pts[pts.length - 1]!.x, '卡 §3.4：④ 的 x ≥ ① 的 x（难度同向）').toBeGreaterThanOrEqual(pts[0]!.x - 1e-9)
    for (let i = 1; i < pts.length; i++) {
      expect(pts[i]!.x, `x 单调不减（第 ${i} 点 ${pts[i]!.x} < 前一点 ${pts[i - 1]!.x}）`)
        .toBeGreaterThanOrEqual(pts[i - 1]!.x - 1e-9)
    }
  }, 300_000)
})

describe('时间压力 = 硬溢出 + 合轴抵扣（用户 2026-09-11：合轴让溢出降低，这俩其实是一个东西）', () => {
  it('computeDifficulty 的时间压力项：两半合成一项、只挂一个权重，0 秒 = 不出现', () => {
    const w = { interaction: { parry: 1 } }
    const base = computeDifficulty([{ type: 'parry', count: 10 }], [], 0, w)
    expect(base.difficulty).toBe(10)
    // 合轴抵扣 4 秒 ⇒ +4 点，明细写明是「合轴抵扣」那一半
    const withAlign = computeDifficulty([{ type: 'parry', count: 10 }], [], 0, w, 4)
    expect(withAlign.difficulty).toBe(14)
    expect(withAlign.detail).toContain('时间压力4s(合轴抵扣4)×1')
    // 硬溢出那一半同价：4 秒硬溢出 ≡ 4 秒合轴抵扣 ≡ 2+2 拆开（用户口径：同一笔秒数）
    expect(computeDifficulty([{ type: 'parry', count: 10 }], [], 4, w, 0).difficulty).toBe(14)
    expect(computeDifficulty([{ type: 'parry', count: 10 }], [], 2, w, 2).difficulty).toBe(14)
    // 权重可改：2 点/秒 ⇒ +8；权重 0 / 无秒数 = 不出现（零行为变更）
    expect(computeDifficulty([{ type: 'parry', count: 10 }], [], 0, { ...w, timePressure: 2 }, 4).difficulty).toBe(18)
    expect(computeDifficulty([{ type: 'parry', count: 10 }], [], 0, { ...w, timePressure: 0 }, 4).difficulty).toBe(10)
    expect(computeDifficulty([{ type: 'parry', count: 10 }], [], 0, w).difficulty).toBe(10)
  })

  it('前线占用拆解：gross / 轴内节省 / 抵扣 / 净占用 / saved 自洽（saved = gross − net）', async () => {
    const { catalog, config } = await setupHarness(['', '', ''], { recommendedBuild: false })
    await catalog.loadBuildRecommendations()
    const calc = useResourceCalc()
    // 用真实一队的结果核对恒等式（合轴默认全 0 ⇒ 多数队 saved 可能为 0，等式仍须成立）
    const preset = teamPresets.find(p => p.id === 'auto-1521-1481-1311')!
    applyTeamToStore(config, preset)          // 曲线算完会恢复现场 ⇒ 这里自己套一次队再读引擎结果
    const rr = calc.resourceResult.value!
    const b = frontlineOccupationBreakdown(rr)
    expect(b.saved).toBeCloseTo(Math.max(0, b.grossFrontline - b.net), 6)
    expect(b.creditApplied).toBeGreaterThanOrEqual(0)
    expect(b.axisOverlap).toBeGreaterThanOrEqual(0)
    expect(b.net).toBeCloseTo(netFrontlineOccupation(rr), 6)  // 拆解函数与净占用单一事实源一致
  }, 300_000)
})

describe('合轴吸收（T140c：纯收益 ⇒ 拉满；④ 的吸收率 == absorbCap）', () => {
  /**
   * ## 本块的口径沿革（T140c 取代，**不是静默删除**）
   *
   * 旧块锁的是 v4 的「两档推进」：`DIFFICULTY_GOALS` 里 `G5` 是 `repeatable` 目标，
   * 第一次 apply = 「刚好包容」（`containRatioOf`），第二次 = 封顶（用户上限）。
   *
   * **T140c 删掉了「分档推进」这个概念**：用户 2026-10-12 口径「纯收益（合轴/取消后摇/墨影凝云合轴）
   * **拉满**」⇒ 合轴不再是"一档"，而是**④ 最高点的定义**（吸收率 = `absorbCap`）。
   * `DIFFICULTY_GOALS` / `repeatable` / `dropped` 随贪心阶梯一并删除（卡 §3.3/§3.4）。
   *
   * `containRatioOf` **本身保留**（它是纯函数，且 ② 的网格扫描与它同族）——它的容差口径
   * （与引擎的量化地板同源）仍是活判据，见下方 `scanAbsorbGrid` 用例。
   */
  it('★ ④ 的吸收率 == absorbCap（纯收益拉满），且不写静态合轴率覆盖', async () => {
    const { catalog, config } = await setupHarness(['', '', ''], { recommendedBuild: false })
    await catalog.loadBuildRecommendations()
    const calc = useResourceCalc()
    const preset = teamPresets.find(p => p.id === 'auto-1461-1521-1491')!
    const ctx = { config, calc }
    clearDifficultyLevers(ctx)
    applyTeamToStore(config, preset)
    const d0 = calc.teamTotalDamage.value

    const r = climbDifficultyLadder(ctx, preset.team as [string, string, string], {
      base: c => c.calc.teamTotalDamage.value,
      capture: c => ({
        counts: captureKeyCounts(c.calc), dmgBySource: captureDmgBySource(c.calc),
        overflow: c.calc.resourceResult.value?.overflowSeconds ?? 0,
      }),
    })
    const last = r.points[r.points.length - 1]!
    expect(last.point).toBe('max')
    expect(last.knobs.absorb).toBeCloseTo(DEFAULT_COMBO_ALIGN_ABSORB_RATIO, 9)
    expect(last.knobs.interactions, 'T141：④ 的非纯收益取最优 = 逐槽阶梯（slotLadder）').toBe('slotLadder')
    // 拉满对该队仍有增益 ⇒ 合轴这一维不是空操作（用户「直接不算中间档位，只算最高合轴率」）
    expect(last.dmg).toBeGreaterThan(d0)
    // 不写静态合轴率覆盖（动态吸收是唯一通道）
    expect(Object.keys(config.comboAlignOverrides ?? {}).length).toBe(0)
  }, 300_000)

  it('★ `scanAbsorbGrid`：线性网格 + 命中即停 + 无论命中与否都还原（②③ 共用的唯一扫描器）', async () => {
    // T140c 前这里锁的是 `containRatioOf`（G5 的「刚好包容」专用探测）。该函数随「分档推进」概念一并删除，
    // 但它证明过的三件套（**线性网格 + try/finally 还原 + 不二分**）被抽成 `scanAbsorbGrid`，
    // 成为 ②③ 共用的**唯一**「求最小旋钮值」实现 ⇒ 本用例改为直接锁这个共享件。
    //
    // 为什么不能二分：`overflow(r)` 与 `axisStands(r)` 都**非单调**（吸收改变并行判定 ⇒ 折叠环落点整体重排），
    // 实测 `auto-1431-1481-1491` 的 overflow 序列为 `34.25 → 86.39（变差！）→ 36.35 → 22.52 → 19.80`。
    const { catalog, config } = await setupHarness(['', '', ''], { recommendedBuild: false })
    await catalog.loadBuildRecommendations()
    const calc = useResourceCalc()
    const preset = teamPresets.find(p => p.id === 'auto-1591-1481-1211')!
    const ctx = { config, calc }
    clearDifficultyLevers(ctx)
    applyTeamToStore(config, preset)
    // 前置：全关 = 不吸收
    expect(config.getMechanicSetting(COMBO_ALIGN_ABSORB_RATIO_SETTING, -1)).toBe(0)

    // ① 命中即停 + 返回值 == 首个命中点（网格 = (0, cap] 的 5% 等分）
    const seen: number[] = []
    const hit = scanAbsorbGrid(ctx, 0.4, 0, r => { seen.push(r); return r >= 0.2 - 1e-9 }, 20)
    expect(hit).toBeCloseTo(0.2, 9)
    expect(seen[seen.length - 1], '命中后不得继续扫').toBeCloseTo(0.2, 9)
    // 网格步长 = cap/steps = 0.4/20 = **0.02**（2% 网格，不是 5%）⇒ 0.2 是第 10 个点
    expect(seen.length, '网格步长 = cap/steps = 0.02 ⇒ 0.2 是第 10 个点').toBe(10)
    // ② **还原**：探测完吸收率必须回到进入前的值（本函数只探测，不落点）
    expect(config.getMechanicSetting(COMBO_ALIGN_ABSORB_RATIO_SETTING, -1), '无论命中与否都必须还原').toBe(0)

    // ③ 全程不命中 ⇒ null，且同样还原
    const miss = scanAbsorbGrid(ctx, 0.4, 0, () => false, 20)
    expect(miss).toBeNull()
    expect(config.getMechanicSetting(COMBO_ALIGN_ABSORB_RATIO_SETTING, -1)).toBe(0)

    // ④ 空区间（from ≥ cap）⇒ 不扫、不抛错、直接 null
    expect(scanAbsorbGrid(ctx, 0.4, 0.4, () => true, 20)).toBeNull()
    expect(scanAbsorbGrid(ctx, 0, 0, () => true, 20)).toBeNull()

    // ⑤ 起点 from > 0：网格落在 (from, cap] 上（③ 从 ② 的落点往上推进的语义）
    const up: number[] = []
    scanAbsorbGrid(ctx, 0.4, 0.2, r => { up.push(r); return false }, 4)
    expect(up[0], '首个网格点必须 > from').toBeGreaterThan(0.2)
    expect(up[up.length - 1], '末个网格点 == cap').toBeCloseTo(0.4, 9)
  }, 300_000)

  it('v3 遗留保证：吸收拉满时伤害不低于全关（自动吸收真的省出前台时间）', async () => {
    const { catalog, config } = await setupHarness(['', '', ''], { recommendedBuild: false })
    await catalog.loadBuildRecommendations()
    const calc = useResourceCalc()
    // 时间压力队 般岳/琉音/卢西娅·艾洛温（同为「般岳 4 怒相 + 琉音好评溢出」结构）。
    // 2026-10-12：原用 `auto-1471-1481-1451`，该条与手编 `banyue-liuyin-lucia` 是同 3 人孪生
    // ⇒ 按「成员集合唯一」口径删掉 auto- 那条，夹具改用存活的手编条目（同队同槽位）。
    // ⚠ 本用例断言的是**不变量**（吸收拉满 ⇒ 伤害不低于全关），不依赖某套配装的具体数值。
    const preset = teamPresets.find(p => p.id === 'banyue-liuyin-lucia')!
    const ctx = { config, calc }
    clearDifficultyLevers(ctx)
    applyTeamToStore(config, preset)
    const d0 = calc.teamTotalDamage.value
    const saved0 = frontlineOccupationBreakdown(calc.resourceResult.value!).saved
    expect(saved0).toBeCloseTo(0, 6)           // 全关 = 不吸收 ⇒ saved = 0
    expect(config.getMechanicSetting(COMBO_ALIGN_ABSORB_RATIO_SETTING, -1)).toBe(0)

    const r = climbDifficultyLadder(ctx, preset.team as [string, string, string], {
      base: c => c.calc.teamTotalDamage.value,
      // 跑完会还原现场 ⇒ 用 capture 在 ④ 那一刻读 saved（同一次求值）
      capture: c => ({ counts: {}, dmgBySource: {}, overflow: 0,
        interactionsFilled: 0, interactionsPlayed: 0,
        ...(c === ctx ? {} : {}) }),
    })
    void r
    // 直接验「拉满」这一档本身（阶梯跑完已还原，故这里显式施加一次）
    config.setMechanicSetting(COMBO_ALIGN_ABSORB_RATIO_SETTING, DEFAULT_COMBO_ALIGN_ABSORB_RATIO)
    const saved1 = frontlineOccupationBreakdown(calc.resourceResult.value!).saved
    expect(Object.keys(config.comboAlignOverrides ?? {}).length).toBe(0) // 不再写静态合轴率覆盖
    expect(saved1).toBeGreaterThan(0.5)        // 解放出前台时间（队友前台被吸收）
    // ⚠ **2026-10-05 改 `toBeGreaterThan` → `toBeGreaterThanOrEqual`**（§20.5-3 轴态吃吸收后暴露）：
    // 吸收量 = `min(溢出, 容量)`（`helpers.ts` 的 `take`）⇒ **溢出被吸满后，再提高比例不再增加 saved**。
    // 实测本队：saved 28.63s 恰为可吸收上限 ⇒ 0.4 档**无事可做**，两档 saved **精确相等**。
    // ⇒ 「逐档严格变大」从来不是该设计的不变量；正确的设计保证 = **单调不减**（容量↑ ⇒ 可吸收量↑，
    //    但以溢出为上限）。
    expect(calc.teamTotalDamage.value).toBeGreaterThanOrEqual(d0) // 到上限：伤害不低于全关
  }, 300_000)

  it('现场恢复：跑完阶梯后合轴率覆盖与吸收率必须还原（只探测不落地）', async () => {
    const { catalog, config } = await setupHarness(['', '', ''], { recommendedBuild: false })
    await catalog.loadBuildRecommendations()
    const calc = useResourceCalc()
    const preset = teamPresets.find(p => p.id === 'auto-1371-1481-1451')!
    const ctx = { config, calc }
    clearDifficultyLevers(ctx)
    applyTeamToStore(config, preset)
    const before = JSON.stringify(config.comboAlignOverrides ?? {})
    climbDifficultyLadder(ctx, preset.team as [string, string, string], {
      base: c => c.calc.teamTotalDamage.value,
    })
    expect(JSON.stringify(config.comboAlignOverrides ?? {})).toBe(before) // 没留痕
    expect(config.getMechanicSetting(COMBO_ALIGN_ABSORB_RATIO_SETTING, -1)).toBe(0) // 吸收也还原到全关的 0
    expect(frontlineOccupationBreakdown(calc.resourceResult.value!).saved).toBeCloseTo(0, 6)
  }, 300_000)

  it('CC-388 现场恢复按整表快照还原：跑前已存在的合轴率覆盖原样回来（非空表才看得出键形态拼错）', async () => {
    const { catalog, config } = await setupHarness(['', '', ''], { recommendedBuild: false })
    await catalog.loadBuildRecommendations()
    const calc = useResourceCalc()
    const preset = teamPresets.find(p => p.id === 'auto-1371-1481-1451')!
    const ctx = { config, calc }
    clearDifficultyLevers(ctx)
    applyTeamToStore(config, preset)
    // opts.base 跳过「全关」重置（resetDifficultyGoals 会有意清空合轴率覆盖），让覆盖在跑的时候确实存在
    config.setComboAlignOverride(0, 'basic_attack', 0.37)
    const before = JSON.stringify(config.comboAlignOverrides ?? {})
    expect(before).not.toBe('{}')
    climbDifficultyLadder(ctx, preset.team as [string, string, string], {
      base: c => c.calc.teamTotalDamage.value,
    })
    expect(JSON.stringify(config.comboAlignOverrides ?? {})).toBe(before)
    expect(config.getComboAlignOverride(0, 'basic_attack', -1)).toBeCloseTo(0.37, 9)
  }, 300_000)
})

describe('合轴节省秒数上曲线（用户：只需管合轴了多少时间出来）', () => {
  it('G5 录取的那一档，快照里的「合轴节省」涨幅 = 解放出来的秒数，且够 major（Δ≥1）', async () => {
    const { catalog, config } = await setupHarness(['', '', ''], { recommendedBuild: false })
    await catalog.loadBuildRecommendations()
    const calc = useResourceCalc()
    const preset = teamPresets.find(p => p.id === 'auto-1371-1481-1451')!
    const ctx = { config, calc }
    clearDifficultyLevers(ctx)
    applyTeamToStore(config, preset)
    const p0 = captureKeyCounts(calc)
    expect(p0['合轴节省']).toBeCloseTo(0, 6)              // 全关：不吸收
    // ④ 的合轴语义 = 拉满到用户上限（T140c：不再有 G5 目标，纯收益直接拉满）
    config.setMechanicSetting(COMBO_ALIGN_ABSORB_RATIO_SETTING, absorbCapOf(ctx))
    const p1 = captureKeyCounts(calc)
    const d = diffKeyCounts(p0, p1).find(c => c.label === '合轴节省')
    expect(d, '必须出现「合轴节省」涨幅').toBeTruthy()
    expect(d!.delta).toBeCloseTo(frontlineOccupationBreakdown(calc.resourceResult.value!).saved, 6)
    expect(d!.major).toBe(true)                            // Δ≥1 秒 ⇒ 进面板/标注
  }, 300_000)
})

describe('图上标注分道（防重叠）', () => {
  it('同 x / 相近的标注分到不同道；离得远的可以共用一道；道号有界', () => {
    const items = [
      { x: 100, width: 60 },  // 与 110 重叠
      { x: 110, width: 60 },
      { x: 400, width: 60 },  // 远的，可回道 0
      { x: 105, width: 60 },  // 与 100/110 重叠 ⇒ 道 2
    ]
    const lanes = assignLabelLanes(items, 3)
    expect(lanes[0]).not.toBe(lanes[1])
    expect(lanes[0]).not.toBe(lanes[3])
    expect(lanes[1]).not.toBe(lanes[3])
    expect(lanes[2]).toBe(0)
    for (const l of lanes) expect(l).toBeLessThan(3)
  })

  it('道满了也不越界（退回最空的道，返回仍在 maxLanes 内）', () => {
    const items = Array.from({ length: 6 }, (_, i) => ({ x: 100 + i, width: 80 }))
    const lanes = assignLabelLanes(items, 2)
    expect(lanes).toHaveLength(6)
    for (const l of lanes) expect(l).toBeLessThan(2)
  })

  it('估宽：中文比数字宽（否则标注会算得过窄而叠上）', () => {
    expect(estimateLabelWidth('大招+1')).toBeLessThan(estimateLabelWidth('希希芙·蛇影层数来源+12'))
  })
})

describe('标注碰撞剔除（分道之后仍会叠）', () => {
  it('同位置只留优先级高的；离得远的都留；留下的两两不重叠', () => {
    const box = (x: number, y: number, width = 60) => ({ x, y, width, height: 13 })
    const keep = pickNonOverlapping([box(100, 100), box(105, 100), box(400, 100)], [1, 5, 3])
    // 三个框：0/1 相撞、2 在远处。优先级 1>0 ⇒ 保留【第 1 个】（挤掉第 0 个），远的第 2 个照留
    expect(keep).toEqual([false, true, true])

    // 不变式：keep 出来的框两两不重叠（含斜对角相邻的情形）
    const boxes = [box(10, 10), box(20, 20), box(12, 12), box(200, 10), box(205, 11), box(300, 40)]
    const mask = pickNonOverlapping(boxes, [3, 6, 9, 1, 2, 0])
    const kept = boxes.filter((_, i) => mask[i])
    for (let i = 0; i < kept.length; i++) {
      for (let j = i + 1; j < kept.length; j++) {
        const a = kept[i]!, b = kept[j]!
        const overlap = a.x - a.width / 2 < b.x + b.width / 2 && b.x - b.width / 2 < a.x + a.width / 2
          && a.y - a.height / 2 < b.y + b.height / 2 && b.y - b.height / 2 < a.y + a.height / 2
        expect(overlap).toBe(false)
      }
    }
    expect(kept.length).toBeGreaterThan(0)
  })
})

describe('伤害归因（这一档 +N 伤害是谁贡献的）', () => {
  it('差分：新增/消失的来源都要算账；浮点噪声丢弃；按 Δ 降序', () => {
    const d = diffDmgBySource(
      { '终结技：A': 100, '乱流': 50, '普通攻击': 30 },
      { '终结技：A': 160, '乱流': 20, '连携技：B': 40, '普通攻击': 30 + 1e-9 },
    )
    expect(d.map(c => c.label)).toEqual(['终结技：A', '连携技：B', '乱流']) // 降序：+60 / +40 / −30
    expect(d[0]!.delta).toBe(60)
    expect(d[2]!.delta).toBe(-30)
    expect(d.some(c => c.label === '普通攻击')).toBe(false) // 1e-9 噪声
  })

  it('次数 ↔ 同类来源对照：按前缀/类型聚合同类伤害 Δ；无对应类别返回 null', () => {
    const dmg = diffDmgBySource(
      { '终结技：爬行恐惧': 10, '连携技：团伙作案': 5, '普通攻击（平A汇总）': 100, '乱流': 0 },
      { '终结技：爬行恐惧': 18.6, '连携技：团伙作案': 5.2, '普通攻击（平A汇总）': 95, '乱流': 3 },
    )
    expect(linkCountToDmg('大招', dmg)).toMatchObject({ label: '终结技系' })
    expect(linkCountToDmg('大招', dmg)!.delta).toBeCloseTo(8.6, 6)
    expect(linkCountToDmg('连携', dmg)!.delta).toBeCloseTo(0.2, 6)
    expect(linkCountToDmg('乱流', dmg)!.delta).toBeCloseTo(3, 6)
    // 「被挤掉」的平A也照样进对照（它是同类伤害行的净变化，不做因果声明）
    expect(linkCountToDmg('强特', dmg)).toBeNull()   // 没有强化特殊技行
    expect(linkCountToDmg('失衡', dmg)).toBeNull()   // 失衡没有对应伤害行（它是易伤窗口）
    expect(linkCountToDmg('克拉蕾·毁伤触发', dmg)).toBeNull() // 角色专属项不猜
  })

  it('摘要：正贡献取 top、被挤掉取**最负的**在前，且三段合计 ≡ 总 Δ（不漏账）', () => {
    const changes = diffDmgBySource(
      { a: 100, b: 100, c: 100, d: 100 },
      { a: 180, b: 60, c: 99, d: 140 }, // +80 / −40 / −1 / +40
    )
    const attr = attributeDmgChanges(changes, 2, 1)
    expect(attr.totalDelta).toBeCloseTo(79, 6)
    expect(attr.top.map(c => c.label)).toEqual(['a', 'd'])      // 正贡献降序
    expect(attr.squeezed.map(c => c.label)).toEqual(['b'])      // 最负的（−40），不是 −1
    expect(attr.squeezed[0]!.delta).toBe(-40)
    const sum = [...attr.top, ...attr.squeezed].reduce((s, c) => s + c.delta, 0) + attr.restDelta
    expect(sum).toBeCloseTo(attr.totalDelta, 6)                 // 其余 = −1，账对得上
  })
})

describe('截断提醒：要达到手填的交互要求至少需要多少难度（用户 2026-10-06 口径）', () => {
  it('纯函数：达标所需 x = 曲线右边第一个实打 ≥ 本档手填量的档（x 不单调时取最小）', () => {
    // 逐档 [手填, 实打]：档0 填41→打13（被砍）、档1 填41→打13（仍被砍）、档2 填41→打41（达标）
    const pts = [
      { x: 10, interactionsFilled: 41, interactionsPlayed: 13 },
      { x: 22, interactionsFilled: 41, interactionsPlayed: 13 },
      { x: 61, interactionsFilled: 41, interactionsPlayed: 41 },
    ]
    expect(truncationHintAt(pts, 0)).toMatchObject({ filled: 41, played: 13, cut: 28, neededX: 61 })
    expect(truncationHintAt(pts, 1)!.neededX).toBe(61)
    // 档2 自己没被砍 ⇒ 不提示
    expect(truncationHintAt(pts, 2)).toBeNull()
  })

  it('★ x 不单调时取**最小**的达标 x（「至少需要多少难度」按最省的那个档算）', () => {
    // 实测 x 会回落（杠杆减少交互 ⇒ 难度降伤害升）；达标档出现在更小的 x 上
    const pts = [
      { x: 50, interactionsFilled: 41, interactionsPlayed: 29 },
      { x: 30, interactionsFilled: 41, interactionsPlayed: 41 },  // 达标但 x 更小
      { x: 80, interactionsFilled: 41, interactionsPlayed: 41 },
    ]
    expect(truncationHintAt(pts, 0)!.neededX).toBe(30)
  })

  it('★ 整条曲线都达不到 ⇒ neededX = null + maxPlayed（不硬编一个数）', () => {
    // 实测 20 个有截断的队里 15 个是这一形态（如般岳簇：填 66 次、曲线最多打 45 次）
    const pts = [
      { x: 63.7, interactionsFilled: 66, interactionsPlayed: 45 },
      { x: 45.8, interactionsFilled: 66, interactionsPlayed: 31 },
    ]
    const h = truncationHintAt(pts, 0)!
    expect(h.neededX).toBeNull()
    expect(h.maxPlayed).toBe(45)          // 「最多只能打到 45 次」
    expect(h.cut).toBe(21)
  })

  it('触发条件：整整 1 次交互被砍，或时间线真砍了秒（亚次量化残差不算）', () => {
    expect(INTERACTION_CUT_MIN).toBe(1)
    // 差 0.43 次 = 量化残差（实测 auto-1531-1481-1451）⇒ 不提示
    expect(truncationHintAt([{ x: 36, interactionsFilled: 26, interactionsPlayed: 25.57 }], 0)).toBeNull()
    // 恰好 1 次 ⇒ 提示（阈值含等号）
    expect(truncationHintAt([{ x: 36, interactionsFilled: 26, interactionsPlayed: 25 }], 0)).not.toBeNull()
    // 交互一次没少，但时间线砍了 5s（> 引擎量化地板 1s）⇒ 也要提示
    const ovf = truncationHintAt([{ x: 47.6, interactionsFilled: 34, interactionsPlayed: 33.36, overflow: 5.49 }], 0)!
    expect(ovf.overflow).toBe(5.49)
    expect(ovf.cut).toBeCloseTo(0.64, 6)
    // 亚秒级溢出 = 量化噪声，且交互没少 ⇒ 不提示
    expect(truncationHintAt([{ x: 32, interactionsFilled: 25, interactionsPlayed: 24.93, overflow: 0.5 }], 0)).toBeNull()
  })

  it('没采到交互量的档不判断（capture 未给 ⇒ 宁可不提示也不误报）', () => {
    expect(truncationHintAt([{ x: 10, overflow: 9 }], 0)).toBeNull()
    expect(truncationHintAt([], 0)).toBeNull()
  })

  it('★ buildCurveChart 接线：truncated 只收有截断的爬梯档（全关起点不进），maxPlayed 取全曲线最大实打', () => {
    // 般岳簇形态：全程填 66、实打 45→31→25 ⇒ 每一档都被砍、且曲线内无法达标
    const rows: DifficultyCurveRow[] = [mkRow('b', '般岳', mkLadder(
      [[63.7, 100], [45.8, 200], [33.6, 300]],
      ['baseline', 'progress', 'max'],
      [],
      [[66, 45], [66, 31], [66, 25]],
    ))]
    const s = buildCurveChart(rows, 100).series[0]!
    // 全关起点（63.7，同样被砍）不进：它是曲线基准不是爬梯档，混进来 = 「起点难度更高却砍得更狠」（用户实测 2026-10-06）
    expect(s.truncated.map(p => p.cost)).toEqual([45.8, 33.6])
    expect(s.points[0]!.hint, '起点自己的截断仍在它的 hint').not.toBeNull()
    // 上限信息不靠起点进表：45 次恰是起点自己的实打量，series 与爬梯档的 hint 照样带出
    expect(s.maxPlayed).toBe(45)
    for (const p of s.truncated) {
      expect(p.hint.neededX).toBeNull()
      expect(p.hint.maxPlayed).toBe(45)
    }
    // 只有起点被砍（爬梯档都足量交付）⇒ truncated 空，但起点 hint 在——面板据此给该队一行说明，不静默消失
    const baseOnly = buildCurveChart([mkRow('o', 'O', mkLadder([[98, 10], [21, 20]], ['baseline', 'max'], [], [[41, 30.5], [15, 15]]))], 100).series[0]!
    expect(baseOnly.truncated).toEqual([])
    expect(baseOnly.points[0]!.hint).toMatchObject({ filled: 41, played: 30.5 })
    // 无截断的曲线：truncated 空、hint 全 null（提醒不出现 = 零视觉变化）
    const clean = buildCurveChart([mkRow('a', 'A', mkLadder([[0, 10], [5, 20]], ['baseline', 'max'], [], [[41, 41], [41, 41]]))], 100).series[0]!
    expect(clean.truncated).toEqual([])
    expect(clean.points.every(p => p.hint === null)).toBe(true)
    // 完全不采交互量（capture 未给）⇒ 也不提示
    const noCap = buildCurveChart([mkRow('n', 'N', mkLadder([[0, 10], [5, 20]], ['baseline', 'max']))], 100).series[0]!
    expect(noCap.truncated).toEqual([])
    expect(noCap.maxPlayed).toBeNull()
  })
})

// ========== 集成：真跑一队（含现场恢复） ==========

const res20 = { physical: 20, fire: 20, ice: 20, electric: 20, ether: 20, wind: 20 }
const FAKE_BOSS: BossPreset = {
  id: '40009',
  name: '异构·基塔布鲁',
  nameEn: 'Integrated - Girtablullu',
  aliases: [],
  icon: null,
  iconSource: null,
  isCriticalAssault: true,
  monster: { stunVuln: 1.5, stunTime: 12, name: '异构·基塔布鲁' },
  defaults: { battleTime: 180, shieldCount: 0, energyShield: 0 },
  phases: [],
}
const FAKE_PHASE: BossPresetPhase = {
  phaseId: '690461',
  zoneKey: '69046201',
  version: '3.2',
  label: '3.2 · 2026-07-30',
  begin: '2026-07-30 04:00:00',
  modeType: 'critical_assault',
  stageName: '异构·基塔布鲁',
  stageNum: 1,
  level: 70,
  hp: 31_900_305,
  stunValue: 18933.95,
  defense: 953,
  bossAnomalyCoeff: 1.1,
  damageResistances: { ...res20 },
  stunResistances: { ...res20 },
  anomalyResistances: { ...res20 },
  weakness: [],
  resistance: [],
}

describe('computeDifficultyCurves（真实引擎 + 现场恢复）', () => {
  it('每队一条曲线、伤害单调不减，且算完恢复现场（队伍/敌方/机制开关/权重策略）', async () => {
    const { catalog, config } = await setupHarness(['', '', ''], { recommendedBuild: false })
    await catalog.loadBuildRecommendations()
    const preset = teamPresets.find(p => p.id === 'auto-1521-1481-1311')
    expect(preset, '预设数据里应有 auto-1521-1481-1311（实测 +47.6% 的爬梯样本）').toBeTruthy()

    const before = {
      agents: config.team.map(c => c.agentId),
      hp: config.enemy.hp,
      strategy: config.timeWeightStrategy,
      mechanics: JSON.stringify(config.mechanicSettings),
      boss: config.appliedBoss,
    }

    const rows = await withAnalysisScenario(s => computeDifficultyCurves(s, { presets: [preset!], boss: FAKE_BOSS, phase: FAKE_PHASE }))

    expect(rows).toHaveLength(1)
    const ladder = rows[0]!.ladder
    // 起点 = 全关基线（静态预设权重档），且**确实爬出了增益**（这条队实测 +40% 量级）
    expect(ladder.base).toBeGreaterThan(0)
    expect(ladder.points[0]!.dmg).toBe(ladder.base)
    // 点数 2~4（①④ 恒存在）；④ ≥ ①（「难度上升 ⇒ 总伤上升」）
    expect(ladder.points.length).toBeGreaterThanOrEqual(2)
    expect(ladder.points.length).toBeLessThanOrEqual(4)
    expect(ladder.gain).toBeGreaterThan(0)
    // x = 绝对操作难度，**允许回落**（joint 可能减少交互次数 ⇒ 难度降、伤害升 = 白拿的优化）
    // ⇒ 只要求「点名次序推进」，不要求 x 单调（卡 §4：下降段如实画出）
    for (const p of ladder.points) expect(p.x).toBe(p.difficulty)

    // 关键量快照：队伍级 7 项 + 「合轴节省」(秒) 齐备；changes 与相邻档差分逐位一致（面板/标注的数据源）
    const p0 = ladder.points[0]!
    for (const key of ['合轴节省', '大招', '强特', '连携', '失衡', '异常触发', '紊乱', '乱流']) {
      expect(typeof p0.counts?.[key], `快照应有「${key}」`).toBe('number')
    }
    const chartPts = buildCurveChart(rows, FAKE_PHASE.hp).series[0]!.points
    for (let i = 1; i < chartPts.length; i++) {
      expect(chartPts[i]!.changes).toEqual(diffKeyCounts(ladder.points[i - 1]!.counts, ladder.points[i]!.counts))
    }
    // 这条队在真 Boss 下确有跃迁；FAKE_BOSS 下只断言「标注的项都满足 major 契约」+ 数据非空
    expect(chartPts.length).toBe(ladder.points.length)
    for (const j of buildCurveChart(rows, FAKE_PHASE.hp).series[0]!.jumps) {
      expect(j.changes.length).toBeGreaterThan(0)
      for (const c of j.changes) expect(c.major).toBe(true)
    }

    // 伤害归因：分组求和 ≡ 该档伤害（`teamTotalDamage` 就是伤害池求和 ⇒ 归因精确，不是启发式）
    for (const p of ladder.points) {
      const sumBySource = Object.values(p.dmgBySource ?? {}).reduce((s, v) => s + v, 0)
      expect(p.dmgBySource, '每档都要有伤害来源分组').toBeTruthy()
      expect(sumBySource).toBeCloseTo(p.dmg, 6)
    }
    // 截断提醒的两个采集字段（与 counts 同一份快照）：手填量 ≥ 实打量恒成立，且都 > 0
    for (const p of ladder.points) {
      expect(typeof p.interactionsFilled, '每档都要采到手填交互量').toBe('number')
      expect(typeof p.interactionsPlayed, '每档都要采到实打交互量').toBe('number')
      expect(typeof p.overflow, '每档都要采到截断秒数').toBe('number')
      expect(p.interactionsFilled!).toBeGreaterThanOrEqual(0)
      expect(p.interactionsPlayed!).toBeGreaterThanOrEqual(0)
      expect(p.interactionsFilled!).toBeGreaterThanOrEqual(p.interactionsPlayed! - 1e-9)
    }
    /**
     * ⚠ **T141 改口径**：① 是「全 0 交互」⇒ 它的两个交互量**都是 0**（旧断言要求 > 0）。
     * 反空洞挪到 ④：该队的逐槽阶梯确实加了交互（否则「① = 0」可能只是整条曲线都不加交互）。
     */
    expect(ladder.points[0]!.interactionsPlayed, '① 是全 0 交互（用户口径 4+5）').toBe(0)
    const maxPt = ladder.points[ladder.points.length - 1]!
    expect(maxPt.interactionsPlayed, '反空洞：④ 的实打交互量应 > 0').toBeGreaterThan(0)
    // 这条队实测**无截断**（全库 104 队里只有 20 队有截断档）⇒ truncated 为空、每档 hint = null：
    // 提醒对它是**零视觉变化**（这是「只做提示、不改任何计算」的直接体现）
    const chartSeries = buildCurveChart(rows, FAKE_PHASE.hp).series[0]!
    expect(chartSeries.truncated).toEqual([])
    expect(chartSeries.points.every(p => p.hint === null)).toBe(true)
    expect(chartSeries.maxPlayed).toBeGreaterThan(0)
    // 每档的归因 Δ 之和 ≡ 该档伤害增量
    for (let i = 1; i < chartPts.length; i++) {
      const attr = attributeDmgChanges(chartPts[i]!.dmgChanges)
      expect(attr.totalDelta).toBeCloseTo(ladder.points[i]!.dmg - ladder.points[i - 1]!.dmg, 6)
    }

    // 现场恢复（曲线模式会临时改机制开关与权重策略，必须还原）
    expect(config.team.map(c => c.agentId)).toEqual(before.agents)
    expect(config.enemy.hp).toBe(before.hp)
    expect(config.timeWeightStrategy).toBe(before.strategy)
    expect(JSON.stringify(config.mechanicSettings)).toBe(before.mechanics)
    expect(config.appliedBoss).toEqual(before.boss)
  }, 300_000)

  it('切轴档（altAxes）T140c 取代：整条移出曲线（卡 §6.2「每队 1~4 点」不许第 5 点）', async () => {
    // ## 本用例的沿革（**取代**，不是静默删除——卡 §7 要求留痕）
    //
    // 原锁：`preset.altAxes` 被做成一条贪心目标（`AXIS:*`）进入爬梯，录取或如实进 `dropped`。
    // **T140c 让这条判据整体失效**：新结构只有四个定点、且卡 §6.2 要求「每队 1~4 点」
    // ⇒ 第 5 个点会破判据。`altAxes` 表达的是「高难度段换一条轴」，而 ②③④ 已经在同一难度轴上
    // **如实报轴态**（含「跳过 N 招」）⇒ 切轴档要表达的「高难段」由 ④ 的轴态如实承载。
    //
    // ⚠ 这是**有意的行为变更**（全库仅 `banyue-liuyin-lucia` 一条预设声明 altAxes）。
    // 否决记录见 `docs/ENGINE_PIPELINE_GUIDE.md` §4。
    const { catalog, config } = await setupHarness(['', '', ''], { recommendedBuild: false })
    await catalog.loadBuildRecommendations()
    const preset = teamPresets.find(p => p.id === 'banyue-liuyin-lucia')
    expect(preset?.altAxes, '般琉卢应带 10大轴切轴档（本判据的前提：库里确有声明 altAxes 的预设）').toHaveLength(1)

    const rows = await withAnalysisScenario(s => computeDifficultyCurves(s, { presets: [preset!], boss: FAKE_BOSS, phase: FAKE_PHASE }))
    const ladder = rows[0]!.ladder
    // ① 点数仍 1~4（**没有**第 5 个切轴点）
    expect(ladder.points.length).toBeLessThanOrEqual(4)
    // ② 点名里不含任何 AXIS:*（该概念随贪心阶梯删除）
    for (const pt of ladder.points) {
      expect(['baseline', 'axis', 'progress', 'max']).toContain(pt.point)
    }
    // ③ 现场恢复：切轴档若真被施加过会改轴状态；跑完必须还原
    expect(config.useStunAxis).toBe(false) // FAKE_BOSS + 该预设：快照轴态是未启用
  }, 300_000)
})

describe('computeDifficultyCurves · 环境模式（用户 2026-10-13：勾了环境 = 看综合实力）', () => {
  const CARD: PhaseBuffCard = {
    title: '凛冽',
    testOnly: false,
    effects: [{ stat: 'critDmg', value: 40 }],
    unparsed: [],
  }

  it('环境 OFF（缺省）与传 `environment: undefined` 逐位相同：不吃 buff、全部队同一期', async () => {
    const { catalog } = await setupHarness(['', '', ''], { recommendedBuild: false })
    await catalog.loadBuildRecommendations()
    const preset = teamPresets.find(p => p.id === 'auto-1521-1481-1311')!
    const base = { presets: [preset], boss: FAKE_BOSS, phase: FAKE_PHASE }
    const [a] = await withAnalysisScenario(s => computeDifficultyCurves(s, base))
    const [b] = await withAnalysisScenario(s => computeDifficultyCurves(s, base))
    // 两次调用逐位相同（本函数是纯求值器：同输入同输出）
    expect(b!.ladder.points.map(p => p.dmg)).toEqual(a!.ladder.points.map(p => p.dmg))
    expect(b!.ladder.base).toBe(a!.ladder.base)
  }, 300_000)

  it('★ 环境 ON：每队用**自己那一期**的敌人数值（换期 ⇒ 伤害真的变，证明 periodOf 被应用）', async () => {
    const { catalog } = await setupHarness(['', '', ''], { recommendedBuild: false })
    await catalog.loadBuildRecommendations()
    const preset = teamPresets.find(p => p.id === 'auto-1521-1481-1311')!
    /**
     * ⚠ 分期必须让**影响伤害的敌人数值**不同，否则这条判据是空的（本会话踩过一次）：
     * 血量只进 `ratio`（图上纵轴），**不进伤害** ⇒ 只换 `hp` 的「两期」跑出来逐位相同，
     * 断言 `base` 不同会失败、而断言「都 ≥ 2 点」恒真（vacuous）。
     * 这里改用**防御**（953 → 1906）——它进减伤乘区，是真正可观测的差。
     */
    const SOFT = { ...FAKE_PHASE, phaseId: 'p-soft', defense: 953, hp: 8_000_000 }
    const HARD = { ...FAKE_PHASE, phaseId: 'p-hard', defense: 1906, hp: 32_000_000 }
    const run = (phases: BossPresetPhase[]) => withAnalysisScenario(s => computeDifficultyCurves(s, {
      presets: [preset], boss: FAKE_BOSS, phase: FAKE_PHASE,
      environment: {
        lanesOf: () => phases.map((p, i) => ({ key: `k${i}`, phase: p, buffs: [] })),
        buffMode: 'none',
      },
    }))
    // ★ 一个预设 × 两期 ⇒ **两行**（道 = 预设 × 期；这正是「从版本细到期数」的落地形态）
    const two = await run([SOFT, HARD])
    expect(two).toHaveLength(2)
    expect(two.map(r => r.periodId)).toEqual(['p-soft', 'p-hard'])
    expect(two.map(r => r.periodKey)).toEqual(['k0', 'k1'])
    const [soft, hard] = two
    // ★ 换期 ⇒ 伤害真的不同（期被应用的最硬证据）
    expect(hard!.ladder.base).not.toBeCloseTo(soft!.ladder.base, 3)
    expect(hard!.ladder.base).toBeLessThan(soft!.ladder.base) // 防御翻倍 ⇒ 伤害更低
    // label 带队名（同队多期时摘要/图例要能区分），故断言「含该期标签」而不是逐字相等
    expect(hard!.label).toContain(HARD.label)
    expect(hard!.label).toContain(preset.name)
    // ★ lanesOf 返回空数组（该范围里没有可跑的道）⇒ **零行**，不塞假的
    expect(await run([])).toHaveLength(0)
  }, 300_000)

  it('★ buff 三态：auto 取该期伤害最高的牌（≥ 不吃），manual 用指定牌，找不到同名牌 = 不吃', async () => {
    const { catalog } = await setupHarness(['', '', ''], { recommendedBuild: false })
    await catalog.loadBuildRecommendations()
    const preset = teamPresets.find(p => p.id === 'auto-1521-1481-1311')!
    const run = (env: NonNullable<DifficultyCurveOptions['environment']>) =>
      withAnalysisScenario(s => computeDifficultyCurves(s, {
        presets: [preset], boss: FAKE_BOSS, phase: FAKE_PHASE, environment: env,
      }))
    const lanesOf = () => [{ key: 'k', phase: FAKE_PHASE, buffs: [CARD] }]
    const [none] = await run({ lanesOf: () => [{ key: 'k', phase: FAKE_PHASE, buffs: [CARD] }], buffMode: 'none' })
    const [auto] = await run({ lanesOf, buffMode: 'auto' })
    const [manual] = await run({ lanesOf, buffMode: 'manual', manualBuffTitle: '凛冽' })
    const [miss] = await run({ lanesOf, buffMode: 'manual', manualBuffTitle: '不存在的牌' })
    // auto 与 manual 都吃上了那张 +40% 暴伤牌 ⇒ 伤害严格高于不吃
    expect(auto!.ladder.base).toBeGreaterThan(none!.ladder.base)
    expect(manual!.ladder.base).toBeGreaterThan(none!.ladder.base)
    // auto 就是「取最高」⇒ 单张牌场景下与 manual 逐位相同
    expect(auto!.ladder.base).toBeCloseTo(manual!.ladder.base, 6)
    // 找不到同名牌 ⇒ **不吃**（不静默退化成别的牌）
    expect(miss!.ladder.base).toBeCloseTo(none!.ladder.base, 6)
  }, 300_000)

  it('buff 现场隔离：环境 ON 吃完牌，下一队不吃时牌必须被清掉（不残留）', async () => {
    const { catalog } = await setupHarness(['', '', ''], { recommendedBuild: false })
    await catalog.loadBuildRecommendations()
    const preset = teamPresets.find(p => p.id === 'auto-1521-1481-1311')!
    const run = (mode: 'none' | 'auto') => withAnalysisScenario(s => computeDifficultyCurves(s, {
      presets: [preset], boss: FAKE_BOSS, phase: FAKE_PHASE,
      environment: { lanesOf: () => [{ key: 'k', phase: FAKE_PHASE, buffs: [CARD] }], buffMode: mode },
    }))
    const [withBuff] = await run('auto')
    const [afterNone] = await run('none')
    // 若牌残留，第二次（none）会与第一次同高 ⇒ 这条判据就是防残留的
    expect(afterNone!.ladder.base).toBeLessThan(withBuff!.ladder.base)
  }, 300_000)
})
