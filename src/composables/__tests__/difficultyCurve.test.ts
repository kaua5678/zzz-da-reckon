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
  buildCurveChart, computeDifficultyCurves, diffKeyCounts, majorChanges,
  type DifficultyCurveRow,
} from '@/composables/difficultyCurve'
import type { LadderResult } from '@/composables/difficultyLadder'
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
      { presetId: 'a', name: 'A', ladder: mkLadder([[0, 45_000_000], [3, 90_000_000]], ['G2']) },
      { presetId: 'b', name: 'B', ladder: mkLadder([[0, 20_000_000], [1, 22_000_000], [4, 30_000_000]], ['G1', 'G2']) },
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
      { presetId: 'a', name: 'A', ladder: mkLadder([[0, 10], [1, 20], [4, 30], [6, 30]], ['G1', 'G2', 'G3']) },
      { presetId: 'b', name: 'B', ladder: mkLadder([[0, 10], [3, 11]], ['G2']) },
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
    const flat = buildCurveChart([{ presetId: 'f', name: 'F', ladder: mkLadder([[0, 45_000_000]]) }], HP)
    expect(flat.series[0]!.flat).toBe(true)
    expect(flat.series[0]!.points).toHaveLength(1)
    expect(flat.series[0]!.gainPct).toBe(0)

    // G4 代价 = 0：两点同 x（0 → 0），仍是两个可画的点
    const zeroCost = buildCurveChart(
      [{ presetId: 'z', name: 'Z', ladder: mkLadder([[0, 50_000_000], [0, 50_500_000]], ['G4']) }], HP,
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
    const rows: DifficultyCurveRow[] = [{
      presetId: 'a', name: 'A',
      ladder: mkLadder(
        [[0, 100], [1, 200], [4, 300]],
        ['G1', 'G2'],
        [],
        [
          { 大招: 7, 连携: 8.9, 紊乱: 0 },
          { 大招: 8, 连携: 8.95, 紊乱: 0 },  // 大招 +1（major）；连携 +0.05（minor）
          { 大招: 8, 连携: 9.9, 紊乱: 1 },   // 连携 +0.95（minor）；紊乱 +1（major）
        ],
      ),
    }]
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

    // 现场恢复（曲线模式会临时改机制开关与权重策略，必须还原）
    expect(config.team.map(c => c.agentId)).toEqual(before.agents)
    expect(config.enemy.hp).toBe(before.hp)
    expect(config.timeWeightStrategy).toBe(before.strategy)
    expect(JSON.stringify(config.mechanicSettings)).toBe(before.mechanics)
    expect(config.appliedBoss).toEqual(before.boss)
  }, 300_000)
})
