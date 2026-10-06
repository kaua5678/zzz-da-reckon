/**
 * 难度阶梯（伤害-难度曲线的核心）：**逐目标贪心录取**（用户 2026-09-10 口径）。
 *
 * 形态三要点（用户原话提炼，改这里前先读）：
 *  ① 难度轴 = **每队自己的"优化路径"**，不是全局档位 ⇒ **各队 x 不对齐是特性**；
 *  ② 点 = **累积开启的优化目标**（"达成某个目标算一次"），档位数 = 目标数；
 *  ③ 开启顺序由**贪心**（单位难度收益最高者优先）决定 ⇒ 曲线 = 该队的最优提升路径。
 *
 * **只录取有实际增益的目标**（`gain > max(0, base×minGainRatio)`，默认相对门槛 0.01%）：曲线因此**单调不减**，"全开"= 已录取目标的并集，
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
import { type StunAxisState, type ConfigModel, type ComboAlignState } from '@/stores/config'
import { DEFAULT_STUN_PLAN_PROJECTION_CODE } from '@/core/stunPlanProjection'
// 量化地板与引擎同源（规则 11：跨文件常量只从单一来源引用）——见 `containRatioOf` 的容差说明
import { TIME_BUDGET_TOLERANCE_SECONDS } from '@/core/resource'
import type { ResourceCalc } from '@/composables/useResourceCalc'
import { applyTimeWeightAllocation } from '@/composables/timeWeightAllocation'
import { COMBO_ALIGN_ABSORB_RATIO_SETTING, DEFAULT_COMBO_ALIGN_ABSORB_RATIO } from '@/data/resourceDefaults'

export interface LadderCtx {
  config: ConfigModel
  calc: ResourceCalc
  /**
   * 用户的动态合轴吸收上限（机制参数 `time.comboAlignAbsorbRatio` 在「全关」之前的值）。
   * `clearDifficultyLevers` 把上限置 0（全关 = 不吸收）前记在这里，G5 分档推进到它为止；缺省 = 引擎缺省 0.4。
   */
  absorbCap?: number
}

const GUARANTEE_KEYS = ['guarantee.stun', 'guarantee.fury', 'guarantee.ultimate'] as const

/** G5 第二档（封顶）用的吸收上限 = 用户设置值（缺省 0.4）；0 = 不吸收 ⇒ 整条 G5 不适用 */
function absorbCapOf(ctx: LadderCtx): number {
  const cap = ctx.absorbCap ?? ctx.config.getMechanicSetting(COMBO_ALIGN_ABSORB_RATIO_SETTING, DEFAULT_COMBO_ALIGN_ABSORB_RATIO)
  return Number.isFinite(cap) ? Math.min(1, Math.max(0, cap)) : DEFAULT_COMBO_ALIGN_ABSORB_RATIO
}

/**
 * G5 **第一档**（「刚好包容」）用的吸收比例：让该队当前溢出**恰好归零**的最小比例；无需包容时返回 `null`。
 *
 * ## 为什么要它（用户口径 2026-10-05）
 *
 * > 「合轴率分两档推上去其实没有意义。如果招式溢出了需要合轴包容，就来一次包容，而不是 20%。
 * >  然后再来一次封顶的 40% 或者玩家设置的更高，来表示更高难度下合轴做到最好能多出多少伤害。
 * >  如果该队伍算出来本来就没招式溢出，那么我们直接不算中间档位，只算最高合轴率
 * >  表示一下合轴这一板块对伤害的影响就行」
 *
 * 旧实现按「上限的一半」机械分档（0 → cap/2 → cap）。实测全库 104 队（`ysgrungcensus.perf.ts`）：
 * **89 队**的 0.2 档与 0.4 档伤害**逐位相同**（中间档是空操作）；而**只有 7 队** r=0 时真有溢出，
 * 且它们的「包容所需比例 r*」分布极散（0.10 / 0.35 / 0.70 / 吸不动）—— 与固定的 20% 毫无关系：
 * 对 r*=0.10 的队 20% 是浪费，对 r*=0.70 的队 20% **根本包不住**。
 *
 * ## 扫描必须**线性**，不能二分
 *
 * 实测 `overflow(r)` **非单调**：`auto-1431-1481-1491` 为
 * `r=0 → 34.25、0.1 → 86.39（变差！）、0.2 → 36.35、0.3 → 22.52、0.4 → 19.80 …`
 * （吸收改变并行判定 ⇒ 折叠环落点整体重排）。二分的前提不成立，只能按网格从小到大取首个归零点。
 *
 * ## 成本
 *
 * 每次试算 = 一次全队重算（与阶梯其余目标同价）。**只有 r=0 确有溢出的队才付**（全库 7/104）；
 * 其余 97 队读一次 r=0 的溢出量即返回 `null`（阶梯本就要为 `base` 算一次，增量可忽略）。
 *
 * @param zeroOverflow 可选注入：r=0 时的溢出量（调用方已量过就传进来，省一次重算）
 * @returns 包容所需比例（(0, cap] 内）或 `null`（无溢出 / 需超过 cap 才包得住 ⇒ 该档不成立）
 */
export function containRatioOf(ctx: LadderCtx, cap: number, zeroOverflow?: number): number | null {
  const readOverflow = (): number => ctx.calc.resourceResult.value?.overflowSeconds ?? 0
  if (cap <= 0) return null
  /**
   * 容差 = 引擎自己的**量化地板** `TIME_BUDGET_TOLERANCE_SECONDS`（1 秒），不是浮点噪声级。
   *
   * 为什么必须同源（2026-10-05 实测纠正）：整数取整（次数必整数，floor 后剩零头）会产生
   * **亚秒级** overflow —— 引擎口径明写「量化（floor 次数）导致残差 ~1s 属合轴可覆盖，不追求精确 0」
   * （坑 12/19），`solveTeam` 也按 `> 1s` 才判真超时。我最初用 `1e-3` 时，把
   * `auto-1591-1161-1211`（0.784s）与 `auto-1191-1481-1311`（0.234s）这类**量化噪声**误标成
   * 「吸满也包不住的结构性溢出」（普查输出里那条 `r* > 1.0`）——归因错误。
   * 同源后它们自动落进「无溢出 ⇒ 直接封顶」分支，与引擎判定一致。
   */
  const TOL = TIME_BUDGET_TOLERANCE_SECONDS
  const base = zeroOverflow ?? readOverflow()
  if (base <= TOL) return null // 本来就装得下（或只是量化噪声）⇒ 无需「包容」档
  const saved = ctx.config.getMechanicSetting(COMBO_ALIGN_ABSORB_RATIO_SETTING, DEFAULT_COMBO_ALIGN_ABSORB_RATIO)
  const STEPS = 20 // 5% 网格：够细（r* 实测落在 0.10/0.35/0.70），且把重算次数钉在常数
  try {
    for (let i = 1; i <= STEPS; i++) {
      const r = Math.round((cap * i / STEPS) * 1e4) / 1e4
      ctx.config.setMechanicSetting(COMBO_ALIGN_ABSORB_RATIO_SETTING, r)
      if (readOverflow() <= TOL) return r
    }
  } finally {
    // 无论命中与否都还原——调用方（试开/录取）自己会按档位写值，本函数只负责**探测**
    ctx.config.setMechanicSetting(COMBO_ALIGN_ABSORB_RATIO_SETTING, saved)
  }
  return null // cap 吸满仍装不下（结构性溢出）⇒ 该档不成立，交给封顶档如实上报截断
}

export interface DifficultyGoal {
  id: string
  label: string
  /** 难度代价（占位口径，见文件头） */
  cost: number
  /** 是否改写权重/交互次数/合轴率（试开后需要快照还原） */
  mutates: boolean
  /**
   * **可重复录取**：录取后不退出候选池，下一轮继续试开，直到「增益低于门槛被丢弃」或防呆上限（24 档）用完。
   * 用于「分档推进」的杠杆（如合轴率：先 +50%、再 +100%），使曲线能出现多个台阶而不是一步到顶。
   */
  repeatable?: boolean
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
    // 缺省为 off 时施加 round（实测优于 ceil）；缺省为 physical（CC-144，第 172 轮）时施加缺省本身，
    // 保证阶梯顶点 = 主结果口径（round 投影的是规划值，叠在 physical 之上是退步）。「全关」仍写死 0 = 旧口径基线。
    apply: ctx => { ctx.config.setMechanicSetting('time.stunPlanProjection', DEFAULT_STUN_PLAN_PROJECTION_CODE === 0 ? 2 : DEFAULT_STUN_PLAN_PROJECTION_CODE) },
  },
  {
    /**
     * **合轴吸收（自动）** —— 用户 2026-09-10 口径：「合轴率在资源利用率处修改，但那是手动的，
     * 之前没考虑自动修改」+「把队友的前台时间进行合轴率的优化，再次解放出来部分可使用的前台时间，
     * 进而让主c的资源回复和平a时间更多，导致总伤增加」。
     *
     * **v2/v3 口径（用户 2026-09-19）**：合轴不是录死的招式合轴率，而是引擎在溢出时按溢出量动态吸收队友前台
     * （`calcTimeAllocation` 动态合轴），且**队友前台最多被吸收上限比例**（全局变量，缺省 40%；「超过了就无力合轴了」）。
     *
     * **v4 档位结构（用户 2026-10-05，取代 v3 的「上限一半」机械分档）**：
     * - **第一档 = 「刚好包容」**：仅当 r=0 时确有溢出才存在，比例 = `containRatioOf`（实测求最小归零点）。
     * - **第二档 = 封顶**（`absorbCapOf` = 玩家设置，缺省 0.4）——表示「更高难度下合轴做到最好能多出多少伤害」。
     * - **无溢出的队**：跳过第一档，直接封顶（用户：「本来就没招式溢出…直接不算中间档位，
     *   只算最高合轴率表示一下合轴这一板块对伤害的影响」）。
     *
     * 为什么改（实测 `ysgrungcensus.perf.ts`，全库 104 队）：旧 0.2 档与 0.4 档在 **89 队**上伤害**逐位相同**
     * （空操作）；真需要包容的只有 **7 队**，且 r* 分布极散（0.10/0.35/0.70/吸不动），与固定 20% 无关。
     * ⚠ 另实测：**r=0 就没溢出的队，提高合轴率仍涨伤害**（吸收释放平A池给主C，如 `auto-1461-1521-1031`
     * 66.108M → 78.229M，+18%）⇒ 封顶档对全库都有意义，不能因为「没溢出」就整条丢弃。
     *
     * 手填的招式合轴率覆盖（结果页「合轴率调节」弹窗）仍是独立的手动通道，全关照旧清掉。
     * `repeatable`：两档（包容 → 封顶）；到封顶后再套是空操作，边际收益掉门槛即停。
     */
    id: 'G5', label: '合轴吸收（自动：先刚好包容溢出，再压到上限）', cost: 1, mutates: true, repeatable: true,
    apply: ctx => {
      const cap = absorbCapOf(ctx)
      if (cap <= 0) return
      const cur = ctx.config.getMechanicSetting(COMBO_ALIGN_ABSORB_RATIO_SETTING, DEFAULT_COMBO_ALIGN_ABSORB_RATIO)
      if (cur >= cap - 1e-9) return // 已到封顶 ⇒ 空操作（repeatable 的自然停点）
      // 第一档：当前还是「全关/低档」且确有溢出 ⇒ 先求「刚好包容」的比例；否则直接封顶
      if (cur <= 1e-9) {
        const contain = containRatioOf(ctx, cap)
        if (contain !== null && contain < cap - 1e-9) {
          ctx.config.setMechanicSetting(COMBO_ALIGN_ABSORB_RATIO_SETTING, contain)
          return
        }
        // 无溢出 / 包容即封顶 / 吸满也包不住 ⇒ 落到封顶档
      }
      ctx.config.setMechanicSetting(COMBO_ALIGN_ABSORB_RATIO_SETTING, cap)
    },
  },
]

/**
 * 关掉全部"优化目标"旋钮（保底 / 计数投影），不清队伍。
 * 展示层（`difficultyCurve.ts`）自定义「全关」基线时复用它，保证"全关"的语义单源。
 */
export function clearDifficultyLevers(ctx: LadderCtx) {
  for (const k of GUARANTEE_KEYS) ctx.config.setMechanicSetting(k, 0)
  ctx.config.setMechanicSetting('time.stunPlanProjection', 0)
  // 合轴率优化也是「优化目标」：全关 = 不动手动/表格给的合轴率（用户手填值由调用方快照还原）
  for (let s = 0; s < 3; s++) ctx.config.clearComboAlignOverrides(s)
  // 动态合轴吸收：全关 = 不吸收（0）；用户上限先记进 ctx，G5 分档推进到它（调用方快照/还原 mechanicSettings）
  if (ctx.absorbCap === undefined) ctx.absorbCap = absorbCapOf(ctx)
  ctx.config.setMechanicSetting(COMBO_ALIGN_ABSORB_RATIO_SETTING, 0)
}

/**
 * 缺省「全关」基线：套预设队伍基础档（`applyTeamPreset` = 0命1精 + 配装推荐）+ 关优化目标。
 * **注意它不套预设声明的静态权重/交互**（`setAgent` 只给 agent 默认值）——散点页口径由
 * `teamCompare#applyTeamToStore` 定义，展示层经 `opts.base` 传入（见 difficultyCurve.ts）。
 */
export function resetDifficultyGoals(ctx: LadderCtx, team: [string, string, string]): number {
  clearDifficultyLevers(ctx)
  for (let i = 0; i < 3; i++) {
    ctx.config.setCinemaLevel(i, 0)
    ctx.config.setWEngineModLevel(i, 1)
  }
  ctx.config.applyTeamPreset(team)
  return ctx.calc.teamTotalDamage.value
}

interface LadderMutSnap {
  w: number[]
  p: number[]
  /** 合轴率覆盖整表快照（不透明，CC-388 键已是 agentId）；G5 会写它，试开回滚必须一起还原 */
  align: ComboAlignState
  /** 动态合轴吸收上限（机制参数）；G5 写它，试开回滚必须一起还原 */
  absorb: number
  /** 轴状态（切轴档会写 stunAxes/stunAxisPlans/useStunAxis，试开回滚必须一起还原） */
  axis: StunAxisState
}
function snapshot(ctx: LadderCtx): LadderMutSnap {
  return {
    w: [0, 1, 2].map(s => ctx.config.team[s]!.basicAttackTimeWeight),
    p: [0, 1, 2].map(s => ctx.config.team[s]!.parryCount ?? 0),
    align: ctx.config.getComboAlignState(),
    absorb: ctx.config.getMechanicSetting(COMBO_ALIGN_ABSORB_RATIO_SETTING, DEFAULT_COMBO_ALIGN_ABSORB_RATIO),
    axis: ctx.config.getAxisState(),
  }
}
function restore(ctx: LadderCtx, snap: LadderMutSnap) {
  for (let s = 0; s < 3; s++) {
    ctx.config.setActionCount(s, 'basicAttackTimeWeight', snap.w[s])
    ctx.config.setActionCount(s, 'parryCount', snap.p[s])
  }
  ctx.config.setComboAlignState(snap.align)
  ctx.config.setMechanicSetting(COMBO_ALIGN_ABSORB_RATIO_SETTING, snap.absorb)
  ctx.config.setAxisState(snap.axis)
}
/** 关掉一个已录取目标（仅在试开回滚时用） */
function undo(ctx: LadderCtx, goal: DifficultyGoal) {
  if (goal.id === 'G3') for (const k of GUARANTEE_KEYS) ctx.config.setMechanicSetting(k, 0)
  else if (goal.id === 'G4') ctx.config.setMechanicSetting('time.stunPlanProjection', 0)
  // G1/G2 靠快照还原（它们写权重/弹刀）
}

export interface LadderPoint {
  /**
   * x 轴值。两种口径：
   *  · 缺省（静态 cost）：**累积**代价（从 0 开始累加各目标自带 cost）；
   *  · 给了 `opts.costOf`：**实测的操作难度绝对值**（起点 = 全关那一档的难度，不是 0）——
   *    于是这条曲线的 x 与散点图的横轴**同一把尺**（可跨图对照），代价是它不再保证单调：
   *    有的杠杆会**减少**交互次数（如联合策略调低弹刀）⇒ 难度下降、伤害上升 = 白拿的优化。
   */
  x: number
  dmg: number
  /** 这一档新录取的目标（null = 全关起点） */
  opened: string | null
  /**
   * 这一档的「关键次数」快照（仅当 `opts.capture` 给了才在；键 = **可读标签**，如 `大招` / `克拉蕾·毁伤触发`）。
   * 相邻档做差就是「难度上升带来的次数跃迁」，展示层据此标注（见 `difficultyCurve.ts#diffKeyCounts`）。
   */
  counts?: Record<string, number>
  /**
   * 这一档的**伤害按来源分组**（键 = 招式名 / 异常类型；Σ 值 == 本档 `dmg`）。
   * 相邻档做差就是「这一档 +N 伤害是谁贡献的」（见 `difficultyCurve.ts#diffDmgBySource`）。
   */
  dmgBySource?: Record<string, number>
  /**
   * 这一档的**绝对操作难度**（仅当 `opts.costOf` 给了才在；单位 = 展示层口径，如
   * 「Σ交互次数×权重 + 时间压力秒×权重」的操作难度点，见 `teamCompare#computeDifficulty`）。
   * `x` 就是它（**绝对值**，不是相对全关的增量）。
   */
  difficulty?: number
  /**
   * 这一档的**时间线截断秒数**（引擎 `overflowSeconds`；与 `counts` 同一份快照采）。
   * >0 = 资源允许的动作装不进战斗时间、被装配期砍掉。缺省（没给 `opts.capture`）= 不采。
   */
  overflow?: number
  /**
   * 这一档**手填（预设声明）的交互总次数**——即难度 x 轴「缩之前」的交互量（`liveInteractions` 传 rr=null）。
   * 与 `interactionsPlayed` 配对才能看出「这一档交互被砍了多少」：截断/降配**两个通道**都体现在这里
   * （实测：全库 104 队里 `overflowSeconds > 1` 只有 5 队，真正普遍的通道是降配 `interactionScale`）。
   */
  interactionsFilled?: number
  /** 这一档**实打（缩后）的交互总次数** = x 轴交互项真正用的那个量（`liveInteractions` 传本档 rr） */
  interactionsPlayed?: number
}

/**
 * 一档的快照：展示层要什么就采什么（`climbDifficultyLadder#opts.capture` 的返回）。
 *
 * ⚠️ 全部字段必须在**同一时刻**读同一份 `calc.resourceResult.value`（`counts` / `dmgBySource` /
 * `overflow` / 两个交互量都是）——分两次采会与档位错配（试开/回滚之间配置已变）。
 */
export interface LadderSnapshot {
  counts: Record<string, number>
  dmgBySource: Record<string, number>
  /** 本档时间线截断秒数（引擎 `overflowSeconds`） */
  overflow?: number
  /** 本档手填（声明）交互总次数（缩前） */
  interactionsFilled?: number
  /** 本档实打交互总次数（缩后） */
  interactionsPlayed?: number
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
  /**
   * **相对门槛**（占全关伤害的比例，缺省 1e-4 = 0.01%）。
   * 为什么需要：实测有目标在特定队是 **Δ=0 的平台**（如 `auto-1041-1571-1031` 四个目标全 0.0M）——
   * 只判 `gain > 0` 会把它们全录进来 ⇒ 曲线出现"难度涨了、伤害不涨"的平台段，对"难易强度"比较有害。
   * 故录取条件 = `gain > max(0, base × minGainRatio)`（**严格正**且超过噪声量级）。
   */
  minGainRatio?: number
  /**
   * **自定义「全关」基线**（缺省 = `resetDifficultyGoals` = 预设基础档）。
   * 展示层（`difficultyCurve.ts`）传入以对齐散点页口径 = `applyTeamToStore`（预设静态权重/交互）
   * + `clearDifficultyLevers`。返回基线伤害。
   */
  base?: (ctx: LadderCtx, team: [string, string, string]) => number
  /**
   * **每档采一次快照**（缺省不采 = 零开销）。在伤害已被最终计算后调用，
   * 所以读到的就是这个落点的资源结果（`damagePoolRows` 此刻已算好，读它不额外求值）。
   * 展示层用它做「大招多一次 / 紊乱多一次」标注与「这一档伤害是谁贡献的」归因。
   */
  capture?: (ctx: LadderCtx) => LadderSnapshot
  /**
   * **自定义「操作难度」测量**（用户 2026-09-10 口径：「难度系数肯定是自动算呀，参数可以修改，
   * 自变量就是交互值、吃掉队友的合轴时间等」）。
   *
   * 给了它之后：
   *  · 每个候选目标的代价 = **实测 Δ难度**（试开时前后各量一次，负增量按 0 = 免费杠杆）；
   *  · 排序 `score = Δ伤害 ÷ Δ难度`（Δ难度 = 0 时退化为按 Δ伤害 排，即「白拿的优化先做」）；
   *  · `x` 累积 Δ难度（单位 = 调用方口径），`LadderPoint.difficulty` 记绝对值。
   * 缺省不给 = 沿用目标自带的静态 `cost`（纯策略模块的占位口径，供不接引擎的调用方用）。
   */
  costOf?: (ctx: LadderCtx) => number
}

/**
 * 从「全关」出发贪心爬阶梯：每步试开每个未录取目标，取 **Δ伤害 / 代价** 最高者；
 * **Δ<0 的目标不录取**（单调性保证）。代价为 0 的目标按 Δ 直接比较（除零保护）。
 *
 * 代价来源两种（见 `LadderOpts.costOf`）：缺省用目标自带静态 cost；给了 `costOf` 就**实测**
 * 每个目标的操作难度增量（试开前/后各量一次），排序与 x 轴都用实测值。
 */
export function climbDifficultyLadder(
  ctx: LadderCtx,
  team: [string, string, string],
  opts: LadderOpts = {},
): LadderResult {
  const goals = opts.goals ?? DIFFICULTY_GOALS
  const minGainRatio = opts.minGainRatio ?? 1e-4
  const base = opts.base ? opts.base(ctx, team) : resetDifficultyGoals(ctx, team)
  const acceptAt = Math.max(0, base * minGainRatio)
  let dmg = base
  let x = 0
  const opened: string[] = []
  const dropped: { id: string; gain: number }[] = []
  const capture = opts.capture
  /**
   * 采一档快照。**一次 `capture` 调用 = 一档的全部字段**（`counts`/`dmgBySource`/`overflow`/两个交互量）
   * ——展示层的截断提醒要求这几个量同源，分两次采会与档位错配（试开/回滚之间配置已变）。
   */
  const snap = (): Pick<LadderPoint, 'counts' | 'dmgBySource' | 'overflow' | 'interactionsFilled' | 'interactionsPlayed'> => {
    const s = capture?.(ctx)
    return s
      ? {
          counts: s.counts, dmgBySource: s.dmgBySource,
          overflow: s.overflow, interactionsFilled: s.interactionsFilled, interactionsPlayed: s.interactionsPlayed,
        }
      : {}
  }
  const costOf = opts.costOf
  const maxSteps = 24 // 最多录取多少档（防 repeatable 目标不收敛）
  const cost0 = costOf ? costOf(ctx) : 0
  const points: LadderPoint[] = [{
    x: cost0, dmg: base, opened: null, ...snap(), ...(costOf ? { difficulty: cost0 } : {}),
  }]
  const remaining = new Set(goals)

  while (remaining.size > 0) {
    // 实测口径下，每个候选的代价 = 试开前后各量一次操作难度（当前已录取状态为基准）
    const costBefore = costOf ? costOf(ctx) : 0
    let best: { goal: DifficultyGoal; gain: number; score: number; dmg: number; dCost: number } | null = null
    for (const goal of remaining) {
      const snap = goal.mutates ? snapshot(ctx) : null
      goal.apply(ctx)
      const d = ctx.calc.teamTotalDamage.value
      const costAfter = costOf ? costOf(ctx) : 0
      if (snap) restore(ctx, snap)
      else undo(ctx, goal)
      const gain = d - dmg
      // 实测 Δ难度：负增量按 0（免费杠杆 = 白拿的优化，按 Δ伤害 排）
      const dCost = costOf ? Math.max(0, costAfter - costBefore) : goal.cost
      const score = dCost > 0 ? gain / dCost : gain
      if (!best || score > best.score) best = { goal, gain, score, dmg: d, dCost }
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
    // 实测口径下 x = 这一档的**绝对**操作难度（与散点横轴同尺）；静态口径下仍是累积 cost
    x = costOf ? costOf(ctx) : x + best.dCost
    opened.push(best.goal.id)
    // 可重复杠杆留在候选池里继续爬；普通目标录取即出池。maxSteps 是防呆（repeatable 靠「增益掉门槛」自然停）
    if (!best.goal.repeatable) remaining.delete(best.goal)
    if (opened.length >= maxSteps) break
    // 伤害落定后再采快照：这一档的 counts / dmgBySource / difficulty 与这一档的 dmg 同源
    points.push({
      x, dmg, opened: best.goal.id, ...snap(), ...(costOf ? { difficulty: x } : {}),
    })
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
