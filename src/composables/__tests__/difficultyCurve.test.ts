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
  diffKeyCounts, estimateLabelWidth, linkCountToDmg, majorChanges,
  type DifficultyCurveRow,
} from '@/composables/difficultyCurve'
import type { LadderResult } from '@/composables/difficultyLadder'
import { baseGoldOf } from '@/composables/teamCompare'
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
  ({ presetId, name, ladder, gold: { target: 0, totalGold: 0, label: '测试档' } })

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
    for (const l of lanes) expect(l).toBeGreaterThanOrEqual(0), expect(l).toBeLessThan(3)
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

describe('金档口径（缺省 = 该队基础金；两条路径同源）', () => {
  it('缺省档 == 显式基础金档（都走 applyGoldSteps，含 standardSteps）；更高金档伤害更高 + 越界钳制', async () => {
    const { catalog, config } = await setupHarness(['', '', ''], { recommendedBuild: false })
    await catalog.loadBuildRecommendations()
    const calc = useResourceCalc()
    // 必须选**带 goldSteps** 的预设：auto-* 是「只有队伍」的自动预设，0 金步 ⇒ 测不出加金效果
    const preset = teamPresets.find(p => p.id === 'yixuan-jufufu-lucia')!
    expect(preset.goldSteps.length, '这条队应有金步').toBeGreaterThan(3)
    const base = baseGoldOf(preset)
    expect(base, '这条队应有基础金（限定角色本体）').toBeGreaterThan(0)

    const def = computeDifficultyCurves(calc, { presets: [preset], boss: FAKE_BOSS, phase: FAKE_PHASE })
    expect(def[0]!.gold.target).toBe(base)
    expect(def[0]!.gold.totalGold).toBe(base)

    // 同一件事只能有一个数：显式传基础金 == 缺省（否则「预设基础档」会漏掉 standardSteps 常驻步）
    const explicit = computeDifficultyCurves(calc, { presets: [preset], boss: FAKE_BOSS, phase: FAKE_PHASE, goldLevel: base })
    expect(explicit[0]!.gold.totalGold).toBe(base)
    expect(explicit[0]!.ladder.base).toBeCloseTo(def[0]!.ladder.base, 6)

    // 加金：实际金档上去了，基线伤害也跟着上去（同 Boss、同金步口径）
    const richer = computeDifficultyCurves(calc, { presets: [preset], boss: FAKE_BOSS, phase: FAKE_PHASE, goldLevel: base + 3 })
    expect(richer[0]!.gold.totalGold).toBeGreaterThan(base)
    expect(richer[0]!.ladder.base).toBeGreaterThan(def[0]!.ladder.base)

    // 越界（远超该队档位上限）→ 钳制到最高档，如实记 target ≠ totalGold
    const overflow = computeDifficultyCurves(calc, { presets: [preset], boss: FAKE_BOSS, phase: FAKE_PHASE, goldLevel: 99 })
    expect(overflow[0]!.gold.target).toBe(99)
    expect(overflow[0]!.gold.totalGold).toBeLessThan(99)
    expect(overflow[0]!.gold.totalGold).toBeGreaterThanOrEqual(richer[0]!.gold.totalGold)
    expect(config.team.map(c => c.agentId)).toEqual(['', '', ''])
  }, 300_000)
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
  it('每队一条曲线、单调不减、且算完恢复现场（队伍/敌方/机制开关/权重策略）', async () => {
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
    for (let i = 1; i < ladder.points.length; i++) {
      expect(ladder.points[i]!.x).toBeGreaterThanOrEqual(ladder.points[i - 1]!.x)
      expect(ladder.points[i]!.dmg).toBeGreaterThan(ladder.points[i - 1]!.dmg)
    }

    // 关键次数快照：7 项队伍级键齐备；changes 与相邻档差分逐位一致（面板/标注的数据源）
    const p0 = ladder.points[0]!
    for (const key of ['大招', '强特', '连携', '失衡', '异常触发', '紊乱', '乱流']) {
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
