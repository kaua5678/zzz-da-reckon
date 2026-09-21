/**
 * 难度曲线（降序·一般化路径）——从**最优配置**出发，逐级降一个杠杆，看伤害掉到哪一档。
 *
 * 用户口径 2026-09-20：
 *  · 「我认为可以加个难度曲线，勾选后，填入对应计算次数，计算会进行多次计算，只挑选最高伤害的几次」；
 *  · 「topN 难道只能全都算出来然后选最高吗，我以为能在逻辑上实现从最优到一般化的变化，
 *    比如合轴率降低、交互降低导致大招次数降低等」；
 *  · 「弹刀只影响喧响比较多，闪反比较无所谓，收益很低。快支更是没啥收益，不用算。
 *    我认为默认做一些影响较大的就行」；
 *  · 「要考虑计算成本，不能太卡顿了」。
 *
 * **与 `climbDifficultyLadder` 的分工**（同族、视角相反，别合并）：
 *  · 爬梯 = 从**全关**出发逐目标录取（回答「我该怎么提升」）；
 *  · 本模块 = 从**全开**出发逐级退化（回答「我不那么操作会掉多少」= 难度档位）。
 *  两者互补：爬梯给优化路径，本模块给**档位阶梯**。
 *
 * **成本设计**（用户「不能太卡顿」的硬约束，实测单次计算 ≈450ms）：
 *  杠杆级数展开 = 档位数（**不是笛卡尔积**）⇒ 默认 ≤6 档 ≈ 3s；
 *  每降一级只做**一次**计算（不试开-回滚），且**增量出结果**（`onPoint` 每档回调，UI 边算边画）。
 *
 * **杠杆选择与顺序**（依据 2026-09-20 实测档位地图，见 `outerCycleColdStart.test.ts` 注释）：
 *  · 合轴率：跨档主杠杆（0.4→10 轮 26.4M，0.8→11 轮 29.8M，1.0→30.2M）⇒ **先降**；
 *  · 交互配额（弹刀）：**凑档**量（剑势 29.13→30.13 跨过 30 触发第 5 次照影）⇒ 次降；
 *  · 形态轴：同合轴率下 `full` 恒最高（C0@0.8：full 29.8M / pair 21.8M / mie 19.6M）⇒ **最后**降；
 *  · **闪反 / 快速支援不进杠杆集**（用户实测收益低：「闪反比较无所谓，快支更是没啥收益，不用算」）。
 *
 * @fact engine:难度曲线/降序一般化 口径: 档位阶梯从**最优配置**逐级降一个杠杆（合轴率 → 弹刀配额 → 形态轴），每级只算一次、经 `onPoint` 增量出结果；档位数 = 杠杆级数展开数（非笛卡尔积），默认 ≤6 档；闪反/快速支援不进杠杆集（收益低，用户裁决） | 据 用户@2026-09-20（「从最优到一般化的变化」「不能太卡顿」「快支更是没啥收益」） | 验 src/composables/__tests__/difficultyDescent.test.ts | 锚 src/composables/difficultyDescent.ts#descendDifficultyCurve | 信 确认
 * ⟳复核: 杠杆集/顺序、`DESCENT_PLATEAU_RATIO` 平台门槛、或 `maxSteps` 缺省再动时，复核「档位数 == 杠杆级数展开数（成本 = 档数）」与「实测仍有真实非单调档（合轴率→0 那档回升）」两条声明 | 到期 2026-12-31
 */
import { COMBO_ALIGN_ABSORB_RATIO_SETTING, DEFAULT_COMBO_ALIGN_ABSORB_RATIO } from '@/data/resourceDefaults'
import type { LadderCtx } from './difficultyLadder'
import { captureKeyCounts, captureDmgBySource, stunWindowRatioOf, ENGINE_INTERACTION_FIELDS } from './difficultyCurve'
import { computeDifficulty, interactionSurvivalBySlot, roundInteractionCount } from './teamCompare'
import { frontlineOccupationBreakdown } from '@/core/resource/helpers'
import type { InteractionItem } from '@/types/teamPreset'



/**
 * 平台判据：本档伤害相对**上一档**下降不足该比例时停（防「降了半天伤害没变」的无效档）。
 *
 * 为什么是常量不是 opts 旋钮（规则 12 最小实现阶梯 + 仓库棘轮「豁免清单只减不增」）：
 * 它只有一个口径（0.5% = 量化噪声量级，与 `difficultyLadder#minGainRatio` 的 1e-4 同族但更宽——
 * 降档的伤害差通常远大于 0.5%，设门槛只为拦「完全没变」的平台档）。做成 opts 会新增一条
 * 「只读不写」的旋钮通道，却没有第二个调用方需要改它。
 */
export const DESCENT_PLATEAU_RATIO = 0.005

/**
 * 平台判据的**连续步数**（用户口径 2026-09-20 实机点通暴露后定）：
 * 单步掉幅低于门槛**不足以**判定整条曲线已平——实机实测（预设队 0命1精）合轴率
 * 1.0→0.75 只掉 0.48%（恰压在 0.5% 门槛下），但「合轴节省」已少 7s ⇒ 杠杆明显在起作用，
 * 后续档位（0.5 / 0.25 / 0）会继续掉。旧实现用单步判据 ⇒ 曲线只出 2 档就停，信息量丢失。
 * 改为**连续 N 步**都低于门槛才停（N=2）：既拦住真平台（连降两档都不动），
 * 又不因一次量化波动（整数装包残差）提前收尾。
 */
export const DESCENT_PLATEAU_STEPS = 2

/** 一个可退化杠杆：把某一维从「最优」降到「一般」 */
export interface DescentLever {
  id: string
  /** 展示名（进 tooltip / 图例，也是 `DescentPoint.degraded` 的取值） */
  label: string
  /** 级数（第 0 级 = 最优，最后一级 = 最一般）。`apply` 收到的是级号。 */
  levelCount: number
  /** 施加第 `level` 级（0 = 最优） */
  apply: (ctx: LadderCtx, level: number) => void
}

/** 一档（曲线上的一个点） */
export interface DescentPoint {
  /** 第几档（0 = 最优） */
  step: number
  /** 操作难度（`opts.costOf` 给了才有意义；缺省 0） */
  x: number
  dmg: number
  /** 本档相对上一档**降了哪个杠杆**（0 档 = null） */
  degraded: string | null
  /** 每个杠杆当前处在第几级（`id → level`），供 UI 展示「现在是什么配置」 */
  levels: Record<string, number>
  /** 本档相对最优的伤害损失率（%），0 档 = 0 */
  lossPct: number
  /** 关键次数快照（大招/强特/失衡/轮数…，`difficultyCurve#captureKeyCounts`） */
  counts?: Record<string, number>
  /** 伤害按来源分组（`difficultyCurve#captureDmgBySource`，做「这一档掉了谁的伤害」归因） */
  dmgBySource?: Record<string, number>
  /** 本档是因「伤害几乎不再下降」而停的末档（平台标记） */
  plateaued?: boolean
  /**
   * **非单调归因**（用户口径 2026-09-20：「这种不单调也包含信息，可以让用户知道：A 因素降低
   * 难度更多，但是伤害没降多少，导致曲线有不单调的效果」）。
   *
   * 只在**本档伤害高于上一档**时出现（多因素下不强求正相关，用户明确「不必纠结伤害一定要和
   * 难度正相关，单因素可以，但多因素不太可能强制正相关」）——如实标注而不是抹平：
   *  · `kind: 'damage-rose'` 伤害回升（难度降得更多，但伤害没跟着降）
   *  · `difficultyDelta` 本档相对上一档的操作难度变化（负 = 难度确实降了）
   *  · `reason` 一句话成因（如「合轴率降幅 > 交互档回升」）
   */
  nonMonotonic?: {
    kind: 'damage-rose'
    /** 相对上一档的难度变化（负 = 本档更简单） */
    difficultyDelta: number
    /** 相对上一档的伤害变化（正 = 回升） */
    damageDelta: number
    /** 成因一句话（给 UI 直接显示） */
    reason: string
  }
}

export interface DescentResult {
  /** 最优档伤害（全杠杆拉满） */
  best: number
  points: DescentPoint[]
  /** 每个杠杆实际用到的级号（未用满 = 提前停） */
  usedLevels: Record<string, number>
  /** 走过的总档数（含最优档） */
  steps: number
  /**
   * 曲线开始前的**弹刀基准**（逐槽用户原值）。UI 「点击套用某档」时把它传回
   * `applyDescentLevels` —— 否则连续套用会以「上一档缩过的值」为基数越缩越小。
   */
  parryBase: number[]
}

export interface DescentOpts {
  /**
   * 是否启用**降配档单调闸门**（缺省 true，用户口径 2026-09-20）：
   * 引擎的自动降配（`interactionScale`）在历史行为下会「回升」——合轴率降下去后时间账变宽，
   * 它把交互档加回来（实测 C0：合轴率 0.20→0.10 时交互档 0.25→0.375、闪反 3→4、伤害 24.21M→24.36M），
   * 于是正因子下降却把伤害推上去，难度轴与伤害不再单调。开启后闸门只降不升，
   * 「合轴降 ⇒ 难度降 + 伤害降」在全区间成立。关掉 = 历史行为（仅用于对照）。
   */
  monotoneGate?: boolean
  /**
   * 档数上限（用户填的「计算次数」）。缺省 6。
   * 实际档数 = min(上限, 杠杆级数展开数)。
   */
  maxSteps?: number
  /** 每档采一次关键次数/伤害来源快照（缺省采） */
  capture?: boolean
  /** 操作难度测量（与散点页同尺，`teamCompare#computeDifficulty`）；给了它就完全接管 x 的测量 */
  costOf?: (ctx: LadderCtx) => number
  /**
   * 是否用**内置难度测量**（store 直读，缺省 true）。关掉且未给 `costOf` ⇒ x 恒 0、不产非单调归因。
   * 保留它的理由 = 有些调用方（单测）只关心伤害档位，不想付测量成本。
   */
  measureDifficulty?: boolean
  /** 每算完一档回调一次（**增量出结果**：UI 边算边画，不必等全部完成） */
  onPoint?: (p: DescentPoint, all: DescentPoint[]) => void
}

/**
 * 默认杠杆集（**数组顺序即降级优先级**：先降跨档影响大的）。
 *
 * 级数设计：合轴率按「上限的 1 / 3/4 / 1/2 / 1/4 / 0」五级；弹刀配额同类五级；
 * 形态轴三级（full → short_pair → short_mie）。展开共 5+5+3 = 13 档，默认被 `maxSteps` 截到 6。
 */
export function defaultDescentLevers(): DescentLever[] {
  return [
    {
      id: 'absorb',
      label: '合轴率',
      levelCount: 5,
      apply: (ctx, level) => {
        const cap = ctx.absorbCap
          ?? ctx.config.getMechanicSetting(COMBO_ALIGN_ABSORB_RATIO_SETTING, DEFAULT_COMBO_ALIGN_ABSORB_RATIO)
        const base = Number.isFinite(cap) ? Math.min(1, Math.max(0, cap)) : DEFAULT_COMBO_ALIGN_ABSORB_RATIO
        const factor = [1, 0.75, 0.5, 0.25, 0][level] ?? 0
        ctx.config.setMechanicSetting(COMBO_ALIGN_ABSORB_RATIO_SETTING, base * factor)
      },
    },
    {
      id: 'parry',
      label: '弹刀次数',
      levelCount: 5,
      /**
       * 只动**弹刀**（`parryCount`）：用户实测闪反收益低、快支无收益 ⇒ 不进杠杆集。
       * 基准取用户当前值（每个槽各自的 parryCount），按比例缩并取整——次数是离散量。
       */
      apply: (ctx, level) => {
        const factor = [1, 0.75, 0.5, 0.25, 0][level] ?? 0
        for (let s = 0; s < 3; s++) {
          const base = ctx.descentParryBase?.[s] ?? ctx.config.team[s]?.parryCount ?? 0
          ctx.config.setParryCount(s, Math.round(base * factor))
        }
      },
    },
    {
      id: 'formAxis',
      label: '明心境轴',
      levelCount: 3,
      // 级号直接映射 setting：0 = full(打满) / 1 = short_pair(灭极) / 2 = short_mie(仅灭)
      apply: (ctx, level) => { ctx.config.setMechanicSetting('yeshuguang.formAxis', level) },
    },
  ]
}

/**
 * 从最优出发逐级一般化，产出**难度档位阶梯**。
 *
 * 算法（每档恰好一次计算，无试开-回滚 ⇒ 成本 = 档数）：
 *  ① 所有杠杆拉到第 0 级（最优）算一次 = 曲线起点；
 *  ② 每轮挑「还没降到底、且优先级最高」的杠杆降一级，算一次、记一档、回调 `onPoint`；
 *  ③ 本档掉幅 < `DESCENT_PLATEAU_RATIO` 时判平台，停（末档标 `plateaued`）；
 *  ④ 结束前把用户原配置**复位**（曲线只读用户设置，不写回）。
 */
export function descendDifficultyCurve(
  ctx: LadderCtx,
  _team: [string, string, string],
  opts: DescentOpts = {},
): DescentResult {
  const levers = defaultDescentLevers()
  const maxSteps = Math.max(2, Math.floor(opts.maxSteps ?? 6))
  const capture = opts.capture !== false
  const costOf = opts.costOf
  /** 难度测量开关（`costOf` 优先；两者都没有时缺省测，用于非单调归因） */
  const measureDifficultyEnabled = opts.measureDifficulty !== false

  // —— 用户原配置快照（曲线结束时复位；只记杠杆会写的那几项）——
  const absorbBefore = ctx.config.getMechanicSetting(COMBO_ALIGN_ABSORB_RATIO_SETTING, DEFAULT_COMBO_ALIGN_ABSORB_RATIO)
  const parryBefore = [0, 1, 2].map(s => ctx.config.team[s]?.parryCount ?? 0)
  const axisBefore = ctx.config.getMechanicSetting('yeshuguang.formAxis', 0)
  ctx.descentParryBase = parryBefore

  const levelOf: Record<string, number> = {}
  for (const lv of levers) levelOf[lv.id] = 0

  const monotoneGate = opts.monotoneGate !== false
  const savedMonotone = ctx.config.interactionScaleMonotone
  const savedCeiling = ctx.config.interactionScaleCeiling
  if (monotoneGate) ctx.config.interactionScaleMonotone = true

  /**
   * 操作难度测量（store 直读口径，不依赖 `TeamPreset`）：
   * 与散点页同尺（`computeDifficulty`），交互项取**当前 store 值**——曲线每档会改弹刀，
   * 读预设声明量不出变化。截断存活率缩沿用 `interactionSurvivalBySlot`（与 `liveInteractions` 同源）。
   * 缺省**开启**（用户口径「标注那个点是什么因素」需要难度增量；多一次纯函数调用，成本可忽略）。
   */
  const measureDifficulty = (): number => {
    const rr = ctx.calc.resourceResult.value
    const survival = interactionSurvivalBySlot(rr)
    const items: InteractionItem[] = []
    for (const { type, field } of ENGINE_INTERACTION_FIELDS) {
      let count = 0
      for (let slot = 0; slot < 3; slot++) {
        const raw = Number(ctx.config.team[slot]?.[field] ?? 0)
        count += roundInteractionCount(raw * (survival.get(slot) ?? 1))
      }
      if (count > 0) items.push({ type, count })
    }
    const overflow = rr?.overflowSeconds ?? 0
    const saved = rr ? frontlineOccupationBreakdown(rr).saved : 0
    return computeDifficulty(
      items, ctx.config.team.map(c => c?.agentId ?? null), overflow, {}, saved,
      stunWindowRatioOf(ctx.calc, ctx.config.enemy),
    ).difficulty
  }

  /** 施加当前级号组合，读一次伤害 + 快照 */
  const measure = (): { dmg: number; x: number; counts?: Record<string, number>; dmgBySource?: Record<string, number> } => {
    for (const lv of levers) lv.apply(ctx, levelOf[lv.id]!)
    /**
     * 每档把闸门**重置到该档的弹刀系数**（= 该档「允许的最大交互档」），再由引擎按采纳值下调。
     * 为什么不是一路累积：档与档之间是独立采样点，累积会让第二档之后全部锁死在地板
     * （实测 C0 OFF 时 0.10/0.05/0 三档伤害全同 23.58M，曲线尾部失去分辨率）。
     */
    if (monotoneGate) {
      const parryLevel = levelOf.parry ?? 0
      const factor = [1, 0.75, 0.5, 0.25, 0][parryLevel] ?? 1
      ctx.config.interactionScaleCeiling = factor
    }
    const dmg = ctx.calc.teamTotalDamage.value
    return {
      dmg,
      x: costOf ? costOf(ctx) : (measureDifficultyEnabled ? measureDifficulty() : 0),
      ...(capture ? { counts: captureKeyCounts(ctx.calc), dmgBySource: captureDmgBySource(ctx.calc) } : {}),
    }
  }

  const points: DescentPoint[] = []
  const push = (p: DescentPoint) => { points.push(p); opts.onPoint?.(p, points) }

  const first = measure()
  const best = first.dmg
  push({ step: 0, x: first.x, dmg: best, degraded: null, levels: { ...levelOf }, lossPct: 0, counts: first.counts, dmgBySource: first.dmgBySource })

  let prevDmg = best
  let plateaued = false
  /** 连续低掉幅计数（见 DESCENT_PLATEAU_STEPS） */
  let flatStreak = 0
  while (points.length < maxSteps) {
    // 下一个要降的杠杆 = 数组序中首个「还没降到底」的（顺序即优先级）
    const target = levers.find(lv => (levelOf[lv.id]! + 1) < lv.levelCount)
    if (!target) break
    levelOf[target.id] = levelOf[target.id]! + 1
    const cur = measure()
    const lossPct = best > 0 ? (best - cur.dmg) / best * 100 : 0
    const marginal = best > 0 ? (prevDmg - cur.dmg) / best : 0
    const prev = points[points.length - 1]!
    /**
     * **非单调归因**（用户口径 2026-09-20）：本档伤害高于上一档时如实标注，不抹平——
     * 「这种不单调也包含信息，可以让用户知道：A 因素降低难度更多，但是伤害没降多少」。
     * 只在本档**难度确实降了**（difficultyDelta < 0）而伤害反升时给归因（否则是纯异常，不编故事）。
     */
    const damageDelta = cur.dmg - prevDmg
    const difficultyDelta = cur.x - prev.x
    const nonMonotonic = damageDelta > 1e-6
      ? {
          kind: 'damage-rose' as const,
          difficultyDelta,
          damageDelta,
          reason: difficultyDelta < 0
            ? `${target.label}降低了难度（难度 ${difficultyDelta.toFixed(1)}），但伤害没跟着降`
              + `（+${(damageDelta / 1e6).toFixed(2)}M）——交互档被引擎自动降配让回了一部分`
            : `${target.label}后伤害回升（+${(damageDelta / 1e6).toFixed(2)}M），难度未降`
              + `（${difficultyDelta >= 0 ? '+' : ''}${difficultyDelta.toFixed(1)}）`,
        }
      : undefined
    push({
      step: points.length, x: cur.x, dmg: cur.dmg, degraded: target.label,
      levels: { ...levelOf }, lossPct, counts: cur.counts, dmgBySource: cur.dmgBySource,
      ...(nonMonotonic ? { nonMonotonic } : {}),
    })
    prevDmg = cur.dmg
    // 连续 DESCENT_PLATEAU_STEPS 步都低于门槛才判平台（单步波动不算，见该常量注释）
    flatStreak = marginal < DESCENT_PLATEAU_RATIO ? flatStreak + 1 : 0
    if (flatStreak >= DESCENT_PLATEAU_STEPS) { plateaued = true; break }
  }
  if (plateaued && points.length > 0) points[points.length - 1]!.plateaued = true

  // 复位（不污染用户配置）
  ctx.config.setMechanicSetting(COMBO_ALIGN_ABSORB_RATIO_SETTING, absorbBefore)
  for (let s = 0; s < 3; s++) ctx.config.setParryCount(s, parryBefore[s]!)
  ctx.config.setMechanicSetting('yeshuguang.formAxis', axisBefore)
  ctx.config.interactionScaleMonotone = savedMonotone
  ctx.config.interactionScaleCeiling = savedCeiling
  ctx.descentParryBase = undefined

  return { best, points, usedLevels: { ...levelOf }, steps: points.length, parryBase: [...parryBefore] }
}

/**
 * 把某一档的级号写回用户配置（UI「点击套用」用）。
 *
 * 为什么放这里而不是 UI 里算（规则 11 单一事实源）：杠杆的**换算公式**（级号 → 合轴率系数 /
 * 弹刀比例）必须与 `defaultDescentLevers().apply` 同源——UI 再写一份必然漂移（改一处忘一处）。
 * 本函数 = 用同一批 lever 的 `apply`，但基数是**调用时读到的用户当前值**。
 *
 * @param levels 档位记录（`DescentPoint.levels`）
 */
export function applyDescentLevels(ctx: LadderCtx, levels: Record<string, number>, parryBase?: number[]): void {
  const savedBase = ctx.descentParryBase
  if (parryBase) ctx.descentParryBase = parryBase
  for (const lv of defaultDescentLevers()) {
    const level = levels[lv.id]
    if (level === undefined) continue
    lv.apply(ctx, level)
  }
  ctx.descentParryBase = savedBase
}

/**
 * 曲线摘要（UI 一行文案）：最优 / 最差 / 总损失率 / 档数 / **非单调档数**。
 *
 * `nonMonotonic` = 伤害回升的档数。用户口径 2026-09-20：多因素下不强求正相关，
 * 这个数**不是错误指标**，是「有几个点值得看归因」的提示。
 */
export function summarizeDescent(r: DescentResult) {
  const last = r.points[r.points.length - 1]
  const loss = r.best > 0 && last ? (r.best - last.dmg) / r.best * 100 : 0
  return {
    best: r.best,
    worst: last?.dmg ?? r.best,
    lossPct: loss,
    steps: r.steps,
    nonMonotonic: r.points.filter(p => p.nonMonotonic).length,
  }
}
