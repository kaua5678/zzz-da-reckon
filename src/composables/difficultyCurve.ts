/**
 * 难度曲线展示层：把 `climbDifficultyLadder` 的逐队贪心阶梯变成可画、可比的形状。
 *
 * 用户 2026-09-10 口径（改这里前先读）：
 *  ① **x 轴 = 每队自己的优化路径**（累积难度代价），**各队 x 不对齐是特性**——
 *     对比看的是形状（起点 / 斜率 / 天花板 / 提升倍数），不是同一 x 上的大小；
 *  ② 点 = 累积开启的优化目标，档位数 = 录取到的目标数（最简版就是「全关 / 全开」两点）；
 *  ③ 开启顺序由贪心决定 ⇒ 这条曲线 = **该队的最优提升路径**。
 *
 * **口径（与散点页对齐，别各自发明）**：
 *  · 全关基线 = `help teamCompare#applyTeamToStore`（预设声明的静态权重 / 交互 / 音擎 / 驱动盘）
 *    + `clearDifficultyLevers`（保底关、计数投影 off）+ `timeWeightStrategy='static'`（不跑自动分配）；
 *  · Boss / 期数 = 当前选中的期数视图（与散点同一入口）；
 *  · **不含 buff、不加金、不自动下位**（v1 有意简化：曲线要的是跨队同口径的形状，
 *    这三项都会让不同队站在不同起点上）⇒ 曲线起点 ≠ 散点页某个点，页面已注明。
 *
 * `buildCurveChart` 是纯函数（不碰 store / 引擎），判据测试在同名单测文件里。
 *
 * @fact engine:难度曲线/x轴 口径: x = 每队自己的累积难度代价（G1 权重均衡 1 / G2 弹刀·联合 3 / G3 保底 2 / G4 取整 0，占位代价），**各队 x 不对齐是特性**——只比形状（起点/斜率/天花板/倍数），不比同一 x | 据 用户@2026-09-10 | 验 difficultyCurve.test.ts::单调不减 | 锚 src/composables/difficultyCurve.ts#buildCurveChart | 信 确认
 * @fact engine:难度曲线/全关基线 口径: 「全关」= 散点页口径（`applyTeamToStore` 预设静态权重/交互 + `clearDifficultyLevers` + timeWeightStrategy=static），**不是** `resetDifficultyGoals` 的 agent 默认权重 ⇒ 展示层必须用 `opts.base` 覆盖；不含 buff/加金/自动下位，故曲线起点 ≠ 散点页的点（页面已注明） | 据 用户@2026-09-10 | 验 difficultyCurve.test.ts::computeDifficultyCurves | 锚 src/composables/difficultyCurve.ts#computeDifficultyCurves | 信 确认
 */
import { useConfigStore } from '@/stores/config'
import { useResourceCalc } from '@/composables/useResourceCalc'
import {
  clearDifficultyLevers, climbDifficultyLadder, summarizeLadder,
  type DifficultyGoal, type LadderResult,
} from '@/composables/difficultyLadder'
import { applyAxisBinding, applyTeamToStore, restoreStore, snapshotStore } from '@/composables/teamCompare'
import type { BossPreset, BossPresetPhase } from '@/types/bossPreset'
import type { TeamPreset } from '@/types/teamPreset'

type Calc = ReturnType<typeof useResourceCalc>

export interface DifficultyCurveOptions {
  presets: TeamPreset[]
  boss: BossPreset
  /** 目标期数（与散点页同一入口：`selectedPhase`） */
  phase: BossPresetPhase
  /** 目标集（缺省 = DIFFICULTY_GOALS） */
  goals?: DifficultyGoal[]
  /** 相对门槛（缺省 1e-4） */
  minGainRatio?: number
}

/** 一队的阶梯结果（展示层行） */
export interface DifficultyCurveRow {
  presetId: string
  name: string
  ladder: LadderResult
}

/**
 * 逐队算难度曲线（同步）。调用方按队分批调度避免卡 UI（同 `computeTeamComparePoints`）。
 * 计算完成/异常后恢复现场（队伍/敌方/轴/全局 buff + 机制开关 + 权重分配策略）。
 */
export function computeDifficultyCurves(calc: Calc, options: DifficultyCurveOptions): DifficultyCurveRow[] {
  const configStore = useConfigStore()
  const snap = snapshotStore(configStore)
  // 机制开关与权重策略**不在** StoreSnapshot 里（散点页不碰它们，故不去改那个共享契约）
  const extra = {
    strategy: configStore.timeWeightStrategy,
    mechanics: { ...configStore.mechanicSettings },
  }
  const rows: DifficultyCurveRow[] = []
  try {
    configStore.applyBossPreset({ id: options.boss.id }, options.phase, options.boss.monster, options.boss.defaults)
    // 「全关」= 不跑自动权重分配；阶梯里的 G1/G2 自己显式跑均衡/联合
    configStore.timeWeightStrategy = 'static'
    for (const preset of options.presets) {
      applyAxisBinding(configStore, snap, preset)
      const ladder = climbDifficultyLadder({ config: configStore, calc }, preset.team as [string, string, string], {
        goals: options.goals,
        minGainRatio: options.minGainRatio,
        base: (ctx, team) => {
          clearDifficultyLevers(ctx)
          applyTeamToStore(ctx.config, preset)
          void team
          return ctx.calc.teamTotalDamage.value
        },
      })
      rows.push({ presetId: preset.id, name: preset.name, ladder })
    }
  } finally {
    configStore.timeWeightStrategy = extra.strategy
    for (const k of Object.keys(configStore.mechanicSettings)) delete configStore.mechanicSettings[k]
    Object.assign(configStore.mechanicSettings, extra.mechanics)
    restoreStore(configStore, snap)
  }
  return rows
}

// ========== 图表数据（纯函数） ==========

export interface CurveDatum {
  /** 累积难度代价（该队自己的 x） */
  cost: number
  dmg: number
  /** 伤害 / Boss 血量 × 100% */
  ratio: number
  /** 这一档新录取的目标 id（null = 全关起点） */
  opened: string | null
}

export interface CurveSeries {
  presetId: string
  name: string
  points: CurveDatum[]
  base: number
  final: number
  /** 提升倍数（终点 / 起点，1 = 无提升） */
  gainX: number
  gainPct: number
  totalCost: number
  /** % / 难度点（代价 0 时按总增益，除零保护见 summarizeLadder） */
  slope: number
  opened: string[]
  dropped: { id: string; gain: number }[]
  /** 一个目标都没录取（曲线是单点）：没有可优化的空间 */
  flat: boolean
}

export interface CurveChartData {
  series: CurveSeries[]
  costMax: number
  ratioMax: number
  costTicks: number[]
}

/** 曲线数据 → 图表（x = 累积代价，y = 伤害/血量%）；空输入返回可画的空图 */
export function buildCurveChart(rows: DifficultyCurveRow[], hp: number): CurveChartData {
  const safeHp = hp > 0 ? hp : 1
  const series: CurveSeries[] = rows.map(r => {
    const s = summarizeLadder(r.ladder)
    return {
      presetId: r.presetId,
      name: r.name,
      points: r.ladder.points.map(p => ({
        cost: p.x,
        dmg: p.dmg,
        ratio: (p.dmg / safeHp) * 100,
        opened: p.opened,
      })),
      base: s.base,
      final: s.final,
      gainX: r.ladder.base > 0 ? r.ladder.final / r.ladder.base : 1,
      gainPct: s.gainPct,
      totalCost: s.totalCost,
      slope: s.slope,
      opened: r.ladder.opened,
      dropped: r.ladder.dropped,
      flat: r.ladder.opened.length === 0,
    }
  })
  const costMax = Math.max(1, ...series.map(s => s.totalCost))
  const ratioMax = Math.max(100, Math.ceil(Math.max(...series.map(s => Math.max(...s.points.map(p => p.ratio), 0)), 150) / 50) * 50)
  const costStep = Math.max(1, Math.ceil(costMax / 5))
  const costTicks: number[] = []
  for (let v = 0; v <= costMax; v += costStep) costTicks.push(v)
  if (costTicks[costTicks.length - 1] !== costMax) costTicks.push(costMax)
  return { series, costMax, ratioMax, costTicks }
}
