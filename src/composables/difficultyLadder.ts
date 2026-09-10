/**
 * 难度阶梯（伤害-难度曲线的核心）：**逐目标贪心录取**（用户 2026-09-10 口径）。
 *
 * 形态三要点（用户原话提炼，改这里前先读）：
 *  ① 难度轴 = **每队自己的"优化路径"**，不是全局档位 ⇒ **各队 x 不对齐是特性**；
 *  ② 点 = **累积开启的优化目标**（"达成某个目标算一次"），档位数 = 目标数；
 *  ③ 开启顺序由**贪心**（单位难度收益最高者优先）决定 ⇒ 曲线 = 该队的最优提升路径。
 *
 * **只录取有实际增益的目标**（`gain > max(minGain, base×minGainRatio)`，默认相对门槛 0.01%）：曲线因此**单调不减**，"全开"= 已录取目标的并集，
 * 而不是"所有目标全开"——实测有目标在特定队是负收益（G4 `ceil` 在 2 队 −3.5~−4.5%、G3 保底在 2 队 −5%），
 * 把它们硬塞进阶梯只会让曲线掉头。被丢弃的目标进 `dropped`，如实上报。
 *
 * **代价 `cost` 是占位口径**（用户裁决项）：当前按"玩家要额外付出多少操作"粗排——
 * G1 权重均衡（多打平A，最省心）=1、G2 弹刀/联合（要掐时机，最吃操作）=3、
 * G3 保底（要打满才生效）=2、G4 取整（只是计算口径，玩家不改操作）=0。
 * 后续可换成「交互增量」或用户自填权重（同对比页「难度权重」弹层先例）。
 *
 * **展示层 `difficultyCurve.ts` 用 `opts.base` 换掉「全关」基线**（预设静态权重/交互，
 * 与散点页同口径）——本模块自己不依赖 `teamCompare`，保持纯策略。
 *
 * 判据测试：`__tests__/difficultyLadder.test.ts`（单调性 / 负收益被丢弃 / 目标契约）。
 */
import { useConfigStore } from '@/stores/config'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { applyTimeWeightAllocation } from '@/composables/timeWeightAllocation'

export interface LadderCtx {
  config: ReturnType<typeof useConfigStore>
  calc: ReturnType<typeof useResourceCalc>
}

const GUARANTEE_KEYS = ['guarantee.stun', 'guarantee.fury', 'guarantee.ultimate'] as const

export interface DifficultyGoal {
  id: string
  label: string
  /** 难度代价（占位口径，见文件头） */
  cost: number
  /** 是否改写权重/交互次数（试开后需要快照还原） */
  mutates: boolean
  /** 打开该目标（在已录取目标之上生效） */
  apply: (ctx: LadderCtx) => void
}

/** 目标集（草案，全部用现成旋钮；新增目标只改这里，调用点不动） */
export const DIFFICULTY_GOALS: DifficultyGoal[] = [
  {
    id: 'G1', label: '权重均衡（多打平A回能）', cost: 1, mutates: true,
    apply: ctx => { applyTimeWeightAllocation({ calc: ctx.calc, configStore: ctx.config }, 'marginal-equalize') },
  },
  {
    id: 'G2', label: '弹刀/交互调优（联合搜索）', cost: 3, mutates: true,
    apply: ctx => { applyTimeWeightAllocation({ calc: ctx.calc, configStore: ctx.config }, 'joint-levers') },
  },
  {
    id: 'G3', label: '保底达成（4 失衡等）', cost: 2, mutates: false,
    apply: ctx => { for (const k of GUARANTEE_KEYS) ctx.config.setMechanicSetting(k, 1) },
  },
  {
    id: 'G4', label: '取整（失衡→计数投影）', cost: 0, mutates: false,
    apply: ctx => { ctx.config.setMechanicSetting('time.stunPlanProjection', 2) }, // 默认 round（实测优于 ceil）
  },
]

/**
 * 关掉全部"优化目标"旋钮（保底 / 计数投影），不清队伍。
 * 展示层（`difficultyCurve.ts`）自定义「全关」基线时复用它，保证"全关"的语义单源。
 */
export function clearDifficultyLevers(ctx: LadderCtx) {
  for (const k of GUARANTEE_KEYS) ctx.config.setMechanicSetting(k, 0)
  ctx.config.setMechanicSetting('time.stunPlanProjection', 0)
}

/**
 * 缺省「全关」基线：套预设队伍基础档（`applyTeamPreset` = 0命1精 + 配装推荐）+ 关优化目标。
 * **注意它不套预设声明的静态权重/交互**（`setAgent` 只给 agent 默认值）——散点页口径由
 * `teamCompare#applyTeamToStore` 定义，展示层经 `opts.base` 传入（见 difficultyCurve.ts）。
 */
export function resetDifficultyGoals(ctx: LadderCtx, team: [string, string, string]): number {
  clearDifficultyLevers(ctx)
  for (let i = 0; i < 3; i++) ctx.config.setAgent(i, team[i])
  ctx.config.applyTeamPreset(team)
  return ctx.calc.teamTotalDamage.value
}

function snapshot(ctx: LadderCtx) {
  return {
    w: [0, 1, 2].map(s => ctx.config.team[s]!.basicAttackTimeWeight),
    p: [0, 1, 2].map(s => ctx.config.team[s]!.parryCount ?? 0),
  }
}
function restore(ctx: LadderCtx, snap: { w: number[]; p: number[] }) {
  for (let s = 0; s < 3; s++) {
    ctx.config.setBasicAttackTimeWeight(s, snap.w[s])
    ctx.config.setParryCount(s, snap.p[s])
  }
}
/** 关掉一个已录取目标（仅在试开回滚时用） */
function undo(ctx: LadderCtx, goal: DifficultyGoal) {
  if (goal.id === 'G3') for (const k of GUARANTEE_KEYS) ctx.config.setMechanicSetting(k, 0)
  else if (goal.id === 'G4') ctx.config.setMechanicSetting('time.stunPlanProjection', 0)
  // G1/G2 靠快照还原（它们写权重/弹刀）
}

export interface LadderPoint {
  /** 累积难度（各队自己的 x，不对齐是特性） */
  x: number
  dmg: number
  /** 这一档新录取的目标（null = 全关起点） */
  opened: string | null
}
export interface LadderResult {
  base: number
  final: number
  points: LadderPoint[]
  opened: string[]
  /** 试开后因 Δ<0 被丢弃的目标（如实上报，不静默） */
  dropped: { id: string; gain: number }[]
}

export interface LadderOpts {
  goals?: DifficultyGoal[]
  /** 绝对门槛（伤害） */
  minGain?: number
  /**
   * **相对门槛**（占全关伤害的比例，缺省 1e-4 = 0.01%）。
   * 为什么需要：实测有目标在特定队是 **Δ=0 的平台**（如 `auto-1041-1571-1031` 四个目标全 0.0M）——
   * 只判 `gain > 0` 会把它们全录进来 ⇒ 曲线出现"难度涨了、伤害不涨"的平台段，对"难易强度"比较有害。
   * 故录取条件 = `gain > max(minGain, base × minGainRatio)`（**严格正**且超过噪声量级）。
   */
  minGainRatio?: number
  /**
   * **自定义「全关」基线**（缺省 = `resetDifficultyGoals` = 预设基础档）。
   * 展示层（`difficultyCurve.ts`）传入以对齐散点页口径 = `applyTeamToStore`（预设静态权重/交互）
   * + `clearDifficultyLevers`。返回基线伤害。
   */
  base?: (ctx: LadderCtx, team: [string, string, string]) => number
}

/**
 * 从「全关」出发贪心爬阶梯：每步试开每个未录取目标，取 **Δ伤害 / 代价** 最高者；
 * **Δ<0 的目标不录取**（单调性保证）。代价为 0 的目标按 Δ 直接比较（除零保护）。
 */
export function climbDifficultyLadder(
  ctx: LadderCtx,
  team: [string, string, string],
  opts: LadderOpts = {},
): LadderResult {
  const goals = opts.goals ?? DIFFICULTY_GOALS
  const minGain = opts.minGain ?? 0
  const minGainRatio = opts.minGainRatio ?? 1e-4
  const base = opts.base ? opts.base(ctx, team) : resetDifficultyGoals(ctx, team)
  const acceptAt = Math.max(minGain, base * minGainRatio)
  let dmg = base
  let x = 0
  const opened: string[] = []
  const dropped: { id: string; gain: number }[] = []
  const points: LadderPoint[] = [{ x: 0, dmg: base, opened: null }]
  const remaining = new Set(goals)

  while (remaining.size > 0) {
    let best: { goal: DifficultyGoal; gain: number; score: number; dmg: number } | null = null
    for (const goal of remaining) {
      const snap = goal.mutates ? snapshot(ctx) : null
      goal.apply(ctx)
      const d = ctx.calc.teamTotalDamage.value
      if (snap) restore(ctx, snap)
      else undo(ctx, goal)
      const gain = d - dmg
      const score = goal.cost > 0 ? gain / goal.cost : gain
      if (!best || score > best.score) best = { goal, gain, score, dmg: d }
    }
    if (!best) break
    if (best.gain <= acceptAt) {
      // 负收益（或低于门槛）→ 丢弃，不进阶梯
      dropped.push({ id: best.goal.id, gain: best.gain })
      remaining.delete(best.goal)
      continue
    }
    best.goal.apply(ctx)
    dmg = ctx.calc.teamTotalDamage.value
    x += best.goal.cost
    opened.push(best.goal.id)
    remaining.delete(best.goal)
    points.push({ x, dmg, opened: best.goal.id })
  }
  return { base, final: dmg, points, opened, dropped }
}

/** 曲线摘要（用于"难易强度"比较）：全关 / 终点 / 提升率 / 单位难度收益 */
export function summarizeLadder(r: LadderResult) {
  const gain = (r.final - r.base) / Math.max(1, r.base) * 100
  const totalCost = r.points[r.points.length - 1]?.x ?? 0
  return {
    base: r.base, final: r.final, gainPct: gain, totalCost,
    /** 每点难度的伤害增益（% / 点）；代价 0 时按总增益计（除零保护） */
    slope: totalCost > 0 ? gain / totalCost : gain,
  }
}
