/**
 * 难度曲线展示层判据：`buildCurveChart` 纯函数契约 + `computeDifficultyCurves` 真实跑一队的集成冒烟。
 *
 * 用户 2026-09-10 口径：**每队的 x 不一定对齐**（x = 该队自己的累积难度代价），
 * 所以判据不是「同一 x 上比大小」，而是：曲线单调不减、平台队如实标 flat、现场必恢复。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { mockStaticFetch, newPinia, setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import {
  assignLabelLanes, attributeDmgChanges, buildCurveChart, computeDifficultyCurves, diffDmgBySource,
  captureKeyCounts, diffKeyCounts, estimateLabelWidth, linkCountToDmg, liveInteractions, majorChanges,
  measureOperationalDifficulty, pickNonOverlapping,
  type DifficultyCurveRow,
} from '@/composables/difficultyCurve'
import { DIFFICULTY_GOALS, clearDifficultyLevers, climbDifficultyLadder, type LadderResult } from '@/composables/difficultyLadder'
import { applyTeamToStore, computeDifficulty } from '@/composables/teamCompare'
import { frontlineOccupationBreakdown, netFrontlineOccupation } from '@/core/resource/helpers'
import { teamPresets } from '@/data/teamPresets'
import type { BossPreset, BossPresetPhase } from '@/types/bossPreset'

beforeEach(() => {
  newPinia()
  mockStaticFetch()
})

// ========== 合成阶梯（纯函数判据用，不跑引擎） ==========

/** 把 [累积代价, 伤害] 点列包成 LadderResult；opened 逐点对应（首点是全关起点） */
function mkLadder(
  points: [number, number][],
  opened: string[] = [],
  dropped: LadderResult['dropped'] = [],
  counts: Record<string, number>[] = [],
): LadderResult {
  return {
    base: points[0]![1],
    final: points[points.length - 1]![1],
    points: points.map(([x, dmg], i) => ({
      x, dmg, opened: i === 0 ? null : (opened[i - 1] ?? null), counts: counts[i],
    })),
    opened,
    dropped,
  }
}

/** 合成图行（纯函数判据不关心金档，填占位） */
const mkRow = (presetId: string, name: string, ladder: LadderResult): DifficultyCurveRow =>
  ({ presetId, name, ladder })

const HP = 100_000_000

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
      mkRow('a', 'A', mkLadder([[0, 45_000_000], [3, 90_000_000]], ['G2'])),
      mkRow('b', 'B', mkLadder([[0, 20_000_000], [1, 22_000_000], [4, 30_000_000]], ['G1', 'G2'])),
    ]
    const c = buildCurveChart(rows, HP)
    expect(c.series).toHaveLength(2)
    expect(c.series[0]!.points.map(p => p.ratio)).toEqual([45, 90])
    expect(c.costMax).toBe(4)
    expect(c.ratioMax % 50).toBe(0)
    expect(c.ratioMax).toBeGreaterThanOrEqual(100)
    expect(c.costTicks[c.costTicks.length - 1]).toBe(4)
  })

  it('单调不减 + 提升倍数/斜率：每队自己的 x 不对齐也照样成立', () => {
    const rows: DifficultyCurveRow[] = [
      mkRow('a', 'A', mkLadder([[0, 10], [1, 20], [4, 30], [6, 30]], ['G1', 'G2', 'G3'])),
      mkRow('b', 'B', mkLadder([[0, 10], [3, 11]], ['G2'])),
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
      [mkRow('z', 'Z', mkLadder([[0, 50_000_000], [0, 50_500_000]], ['G4']))], HP,
    )
    expect(zeroCost.series[0]!.points).toHaveLength(2)
    expect(zeroCost.series[0]!.points.every(p => p.cost === 0)).toBe(true)
    expect(zeroCost.series[0]!.flat).toBe(false)
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
      ['G1', 'G2'],
      [],
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
    const preset = teamPresets.find(p => p.id === 'auto-1311-1521-1361')!
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

  it('measureOperationalDifficulty = Σ(交互×权重) + 溢出秒×溢出权重（权重可改）', async () => {
    const { config } = await setupHarness(['', '', ''], { recommendedBuild: false })
    const preset = teamPresets.find(p => p.id === 'auto-1311-1521-1361')!
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

  it('集成：x 轴 = 实测操作难度（绝对值，与散点同尺），伤害单调增', async () => {
    const { catalog } = await setupHarness(['', '', ''], { recommendedBuild: false })
    await catalog.loadBuildRecommendations()
    const calc = useResourceCalc()
    const preset = teamPresets.find(p => p.id === 'auto-1311-1521-1361')!
    const [row] = computeDifficultyCurves(calc, { presets: [preset], boss: FAKE_BOSS, phase: FAKE_PHASE })
    const pts = row!.ladder.points
    expect(pts[0]!.x).toBeGreaterThan(0)          // x = 绝对操作难度（全关也不是 0：有基础交互）
    expect(pts[0]!.x).toBe(pts[0]!.difficulty)    // 与散点横轴同一口径，直接可比
    for (const p of pts) expect(p.x).toBeCloseTo(p.difficulty!, 6)
    // ⚠️ 实测口径下 x **不保证单调**：有的杠杆减少交互次数（难度降、伤害升 = 白拿的优化）。
    // 只要求伤害单调（曲线意义所在），并把「难度降过」这件事如实暴露出来。
    for (let i = 1; i < pts.length; i++) expect(pts[i]!.dmg).toBeGreaterThan(pts[i - 1]!.dmg)
    expect(pts.some((p, i) => i > 0 && p.x < pts[i - 1]!.x)).toBe(true) // 这条队实测就有降难度的一档
  }, 300_000)
})

describe('队友合轴也算难度（用户 2026-09-10：合轴节约出来的时间越多，难度越高，总伤越多）', () => {
  it('computeDifficulty 的 align 项：1 秒 = 1 点（可调），0 秒/权重 0 = 不出现', () => {
    const base = computeDifficulty([{ type: 'parry', count: 10 }], [], 0, { interaction: { parry: 1 } })
    expect(base.difficulty).toBe(10)
    // 合轴解放 4 秒 ⇒ +4 点，并在明细里写明来源
    const withAlign = computeDifficulty([{ type: 'parry', count: 10 }], [], 0, { interaction: { parry: 1 } }, 4)
    expect(withAlign.difficulty).toBe(14)
    expect(withAlign.detail).toContain('队友合轴节省4s')
    // 权重可改：2 点/秒 ⇒ +8
    expect(computeDifficulty([{ type: 'parry', count: 10 }], [], 0, { interaction: { parry: 1 }, align: 2 }, 4).difficulty).toBe(18)
    // 权重 0 或没给秒数 = 老口径（零行为变更）
    expect(computeDifficulty([{ type: 'parry', count: 10 }], [], 0, { interaction: { parry: 1 }, align: 0 }, 4).difficulty).toBe(10)
    expect(computeDifficulty([{ type: 'parry', count: 10 }], [], 0, { interaction: { parry: 1 } }).difficulty).toBe(10)
  })

  it('前线占用拆解：gross / 轴内节省 / 抵扣 / 净占用 / saved 自洽（saved = gross − net）', async () => {
    const { catalog, config } = await setupHarness(['', '', ''], { recommendedBuild: false })
    await catalog.loadBuildRecommendations()
    const calc = useResourceCalc()
    // 用真实一队的结果核对恒等式（合轴默认全 0 ⇒ 多数队 saved 可能为 0，等式仍须成立）
    const preset = teamPresets.find(p => p.id === 'auto-1311-1521-1361')!
    applyTeamToStore(config, preset)          // 曲线算完会恢复现场 ⇒ 这里自己套一次队再读引擎结果
    const rr = calc.resourceResult.value!
    const b = frontlineOccupationBreakdown(rr)
    expect(b.saved).toBeCloseTo(Math.max(0, b.grossFrontline - b.net), 6)
    expect(b.creditApplied).toBeGreaterThanOrEqual(0)
    expect(b.axisOverlap).toBeGreaterThanOrEqual(0)
    expect(b.net).toBeCloseTo(netFrontlineOccupation(rr), 6)  // 拆解函数与净占用单一事实源一致
  }, 300_000)
})

describe('G5 合轴率优化（自动杠杆，用户 2026-09-10：手填→自动）', () => {
  it('套用 G5 ⇒ 合轴率覆盖被写入、saved 变大、伤害不降（自动优化真的省出前台时间）', async () => {
    const { catalog, config } = await setupHarness(['', '', ''], { recommendedBuild: false })
    await catalog.loadBuildRecommendations()
    const calc = useResourceCalc()
    const preset = teamPresets.find(p => p.id === 'auto-1311-1521-1361')!
    const ctx = { config, calc }
    clearDifficultyLevers(ctx)                 // 全关基线（会清掉合轴率覆盖）
    applyTeamToStore(config, preset)
    const d0 = calc.teamTotalDamage.value
    const saved0 = frontlineOccupationBreakdown(calc.resourceResult.value!).saved
    expect(saved0).toBeCloseTo(0, 6)           // 缺省合轴率全 0（opt-in）⇒ 全关 saved = 0

    const g5 = DIFFICULTY_GOALS.find(g => g.id === 'G5')!
    g5.apply(ctx)
    const d1 = calc.teamTotalDamage.value
    const saved1 = frontlineOccupationBreakdown(calc.resourceResult.value!).saved
    expect(Object.keys(config.comboAlignOverrides ?? {}).length).toBeGreaterThan(0) // 覆盖写进去了
    expect(saved1).toBeGreaterThan(0.5)        // 解放出前台时间
    expect(d1).toBeGreaterThanOrEqual(d0)      // 伤害不降（自动合轴率的收益）
    // 可重复：再套一次 ⇒ 合轴率到 100%，saved 更大
    g5.apply(ctx)
    expect(frontlineOccupationBreakdown(calc.resourceResult.value!).saved).toBeGreaterThan(saved1)
  }, 300_000)

  it('试开回滚不留痕：G5 没被录取时，合轴率覆盖必须还原（阶梯快照含 comboAlignOverrides）', async () => {
    const { catalog, config } = await setupHarness(['', '', ''], { recommendedBuild: false })
    await catalog.loadBuildRecommendations()
    const calc = useResourceCalc()
    const preset = teamPresets.find(p => p.id === 'auto-1311-1521-1361')!
    const ctx = { config, calc }
    clearDifficultyLevers(ctx)
    applyTeamToStore(config, preset)
    const before = JSON.stringify(config.comboAlignOverrides ?? {})
    // minGainRatio=10（1000%）⇒ G5 的增益必然低于门槛 ⇒ 试开后丢弃
    const r = climbDifficultyLadder(ctx, preset.team as [string, string, string], {
      goals: [DIFFICULTY_GOALS.find(g => g.id === 'G5')!],
      minGainRatio: 10,
      costOf: c => measureOperationalDifficulty(c, preset),
    })
    expect(r.opened).toEqual([])
    expect(r.dropped.map(d => d.id)).toEqual(['G5'])
    expect(JSON.stringify(config.comboAlignOverrides ?? {})).toBe(before) // 没留痕
    expect(frontlineOccupationBreakdown(calc.resourceResult.value!).saved).toBeCloseTo(0, 6)
  }, 300_000)
})

describe('合轴节省秒数上曲线（用户：只需管合轴了多少时间出来）', () => {
  it('G5 录取的那一档，快照里的「合轴节省」涨幅 = 解放出来的秒数，且够 major（Δ≥1）', async () => {
    const { catalog, config } = await setupHarness(['', '', ''], { recommendedBuild: false })
    await catalog.loadBuildRecommendations()
    const calc = useResourceCalc()
    const preset = teamPresets.find(p => p.id === 'auto-1311-1521-1361')!
    const ctx = { config, calc }
    clearDifficultyLevers(ctx)
    applyTeamToStore(config, preset)
    const p0 = captureKeyCounts(calc)
    expect(p0['合轴节省']).toBeCloseTo(0, 6)              // 全关：没做合轴率优化
    DIFFICULTY_GOALS.find(g => g.id === 'G5')!.apply(ctx)
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
    const calc = useResourceCalc()
    const preset = teamPresets.find(p => p.id === 'auto-1311-1521-1361')
    expect(preset, '预设数据里应有 auto-1311-1521-1361（实测 +42.9% 的爬梯样本）').toBeTruthy()

    const before = {
      agents: config.team.map(c => c.agentId),
      hp: config.enemy.hp,
      strategy: config.timeWeightStrategy,
      mechanics: JSON.stringify(config.mechanicSettings),
      boss: config.appliedBoss,
    }

    const rows = computeDifficultyCurves(calc, { presets: [preset!], boss: FAKE_BOSS, phase: FAKE_PHASE })

    expect(rows).toHaveLength(1)
    const ladder = rows[0]!.ladder
    // 起点 = 全关基线（静态预设权重档），且**确实爬出了增益**（这条队实测 +40% 量级）
    expect(ladder.base).toBeGreaterThan(0)
    expect(ladder.points[0]!.dmg).toBe(ladder.base)
    expect(ladder.opened.length).toBeGreaterThanOrEqual(1)
    // 伤害必须单调增（曲线意义所在）；x = 绝对操作难度，**允许回落**（杠杆减少交互次数时难度下降）
    for (let i = 1; i < ladder.points.length; i++) {
      expect(ladder.points[i]!.dmg).toBeGreaterThan(ladder.points[i - 1]!.dmg)
    }
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
})
