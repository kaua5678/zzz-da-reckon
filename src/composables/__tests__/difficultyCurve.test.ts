/**
 * 难度曲线展示层判据：`buildCurveChart` 纯函数契约 + `computeDifficultyCurves` 真实跑一队的集成冒烟。
 *
 * 用户 2026-09-10 口径：**每队的 x 不一定对齐**（x = 该队自己的累积难度代价），
 * 所以判据不是「同一 x 上比大小」，而是：曲线单调不减、平台队如实标 flat、现场必恢复。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { mockStaticFetch, newPinia, setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { buildCurveChart, computeDifficultyCurves, type DifficultyCurveRow } from '@/composables/difficultyCurve'
import type { LadderResult } from '@/composables/difficultyLadder'
import { teamPresets } from '@/data/teamPresets'
import type { BossPreset, BossPresetPhase } from '@/types/bossPreset'

beforeEach(() => {
  newPinia()
  mockStaticFetch()
})

// ========== 合成阶梯（纯函数判据用，不跑引擎） ==========

/** 把 [累积代价, 伤害] 点列包成 LadderResult；opened 逐点对应（首点是全关起点） */
function mkLadder(points: [number, number][], opened: string[] = [], dropped: LadderResult['dropped'] = []): LadderResult {
  return {
    base: points[0]![1],
    final: points[points.length - 1]![1],
    points: points.map(([x, dmg], i) => ({ x, dmg, opened: i === 0 ? null : (opened[i - 1] ?? null) })),
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

    // 现场恢复（曲线模式会临时改机制开关与权重策略，必须还原）
    expect(config.team.map(c => c.agentId)).toEqual(before.agents)
    expect(config.enemy.hp).toBe(before.hp)
    expect(config.timeWeightStrategy).toBe(before.strategy)
    expect(JSON.stringify(config.mechanicSettings)).toBe(before.mechanics)
    expect(config.appliedBoss).toEqual(before.boss)
  }, 300_000)
})
