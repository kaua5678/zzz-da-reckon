/**
 * 难度曲线**关键旋钮点**（取代 2026-09-10 的「五档贪心阶梯」，用户 2026-10-12 口径）。
 *
 * ## 为什么改（用户原话，改这里前先读）
 *
 * > 「我认为当前计算器的逻辑下，G1-5 分为 5 个部分就**没能正确表达难度上升并且总伤上升**的意思。
 * >  其中**保底更是含混了很多概念**。让轴可行本质是轴对资源有要求，这并不能全权交给 G3，
 * >  因为**时间资源在 G5 这里也能帮助实现轴**。」
 * > 「难度旋钮确实比较自由，但我认为**只需少量计算某些旋钮值**就行。**最低，最高，刚好实现轴模式，
 * >  重大进步**，这几点就可以窥见整个难度曲线的变化了。」
 *
 * 旧结构的病根：把不同维度的开关（操作次数 / 资源开关 / 计数取整 / 时间重分配）排成**一条按性价比
 * 竞争的路径**，于是「让轴立起来」这件事被**独占给 G3（保底）**——而实测证明 G5（合轴）同样能让轴
 * 从不可行变可行（`auto-1461-1521-1491`：r=0 弃轴 57.526M → r=0.2 完整轴 83.388M）。
 *
 * ## 新结构：**单一难度轴 + 四个关键点**
 *
 * 旋钮只有两个（用户 §1(3)：纯收益**拉满**、非纯收益**取最优分配**）：
 * - **操作难度** `interactions`：交互次数配置。非纯收益 ⇒ **取最优分配**（`joint-levers` 联合搜索，
 *   它自己带「伤害不降 + 不新增截断」守卫）；
 * - **时间压力** `absorb`：动态合轴吸收率。纯收益 ⇒ **拉满**（= `absorbCap`），不参与竞争。
 *
 * | # | 点名 | 定义 |
 * |---|---|---|
 * | ① | `baseline` 最低 | 全关基线（`clearDifficultyLevers` 语义不变），交互取角色默认 |
 * | ② | `axis` 刚好实现轴模式 | 求**最小** `(joint 交互, 吸收率)` 使**轴成立**（`axisStands`）；无轴队 / 本就成立则**如实跳过** |
 * | ③ | `progress` 重大进步 | 在 ② 之上继续推进到**下一个关键跃迁**（Δ伤害 ≥ 阈值 **且** 出现 ≥1 次离散动作增量） |
 * | ④ | `max` 最高 | 纯收益拉满（吸收 = cap）+ 非纯收益取最优（joint） |
 *
 * ## ④ 为什么不含「计数取整」（G4）—— 实测证据，**不是**设计偏好
 *
 * 卡 §3.1 字面写「④ = 现状 G2+G4+G5 全开」，但 §6.5 又要求「④ ≥ ① 全库 97 队」。
 * 实测（`.zc/perf/T140cPredict{3,4,5}.perf.ts`，套 Boss + `applyGoldSteps` = 本卡验收面）：
 *
 * | ④ 的构成 | 「④ ≥ ①」违例 |
 * |---|---|
 * | G2+G4+G5（卡字面） | **2 队**（`auto-1521-1251-1311` −2.158M、`auto-1401-1411-1031` −3.528M） |
 * | **G2+G5（本实现）** | **0 队** |
 *
 * 逐杠杆消融定位元凶**唯一 = G4（计数投影）**：G4 单独作用于 ① 时 **21/97 队为负**（最坏 −12.476M）
 * ⇒ 它**不是单调增益的难度旋钮**，而是**计数口径**（「失衡次数怎么算」），本就不该占难度轴上的一个点。
 * 卡 §3.3 已把 `guarantee.stun`（同样是计数口径）从阶梯移出，本处是同一裁决的延伸。
 * ⚠ 全曲线计数口径因此**恒定 = 全关口径**（`clearDifficultyLevers` 的投影 off），
 *   不随难度漂移——这正是「难度轴只表达难度」的前提。
 *
 * ## 保底降级为「轴可行性判定条件」（卡 §3.3）
 *
 * `guarantee.fury` / `guarantee.ultimate` **不再由本模块打开**：轴要立起来时由引擎自己决定补多少资源
 * （`convergence.ts#guaranteeFury` 的「轴模式 ⇒ 视同勾选」，用户裁决 2026-10-11，**实现一字不动**）。
 * 本卡改的是它**在曲线口径下的地位**，不是它的实现。
 *
 * ## 展示层契约
 *
 * `difficultyCurve.ts` 用 `opts.base` 换掉「全关」基线（预设静态权重/交互，与散点页同口径）
 * ——本模块自己不依赖 `teamCompare`，保持纯策略。轴态的唯一事实源是 `difficultyAxis.ts#axisStateOf`。
 *
 * 判据测试：`__tests__/difficultyLadder.test.ts`（点数 / ①④ 恒存在 / 轴态 / 单调）+ `difficultyAxis.test.ts`。
 */
import { type StunAxisState, type ConfigModel, type ComboAlignState } from '@/stores/config'
import type { ResourceCalc } from '@/composables/useResourceCalc'
import { applyTimeWeightAllocation } from '@/composables/timeWeightAllocation'
import { axisStateOf, axisStands, type AxisState } from '@/composables/difficultyAxis'
import { COMBO_ALIGN_ABSORB_RATIO_SETTING, DEFAULT_COMBO_ALIGN_ABSORB_RATIO } from '@/data/resourceDefaults'

export interface LadderCtx {
  config: ConfigModel
  calc: ResourceCalc
  /**
   * 用户的动态合轴吸收上限（机制参数 `time.comboAlignAbsorbRatio` 在「全关」之前的值）。
   * `clearDifficultyLevers` 把上限置 0（全关 = 不吸收）前记在这里，④ 拉满推进到它为止；缺省 = 引擎缺省 0.4。
   */
  absorbCap?: number
}

/**
 * ④「最高」的合轴吸收率 = 用户设置值（缺省 0.4）；0 = 不吸收 ⇒ 合轴这一维整条不适用。
 * **纯收益 ⇒ 拉满**（用户 §1(3)：合轴是纯收益，不参与竞争）。
 */
export function absorbCapOf(ctx: LadderCtx): number {
  const cap = ctx.absorbCap ?? ctx.config.getMechanicSetting(COMBO_ALIGN_ABSORB_RATIO_SETTING, DEFAULT_COMBO_ALIGN_ABSORB_RATIO)
  return Number.isFinite(cap) ? Math.min(1, Math.max(0, cap)) : DEFAULT_COMBO_ALIGN_ABSORB_RATIO
}

/**
 * **吸收率网格扫描**：在 `(from, cap]` 上按线性网格从小到大找**首个**满足条件的比例。
 * 这是本模块**唯一**的「求最小旋钮值」实现（② 与 ③ 共用），三件套与旧 `containRatioOf` 同源：
 * **线性网格 + `try/finally` 还原 + 容差/网格常量单源**。
 *
 * ## 为什么必须**线性**扫描，不能二分
 *
 * 实测 `overflow(r)` **非单调**：`auto-1431-1481-1491` 为
 * `r=0 → 34.25、0.1 → 86.39（变差！）、0.2 → 36.35、0.3 → 22.52、0.4 → 19.80 …`
 * （吸收改变并行判定 ⇒ 折叠环落点整体重排）⇒ 二分的前提不成立，只能按网格从小到大取首个命中。
 * 同族的 `axisStands(r)` 同样非单调（吸收改变时间账 ⇒ 轴态整体重排）。
 *
 * ## 容差与网格的单一来源
 *
 * 网格 = `steps` 等分（缺省 20 = 5%）。**容差不在这里**：判据（`probe` 返回什么算命中）由调用方给，
 * ② 给的 `axisStands` 读引擎的 `convergence.axisFallback` ⇒ 容差 = 引擎自己的
 * `AXIS_FALLBACK_TOLERANCE_SEC`（**单一事实源在引擎**，本模块不复制）。
 * ⚠ 历史教训（别把容差搬回本模块）：旧 `containRatioOf` 在这里自设过 `1e-3` 的溢出容差，
 * 把 `auto-1591-1161-1211`（0.784s 量化残差）误标成「吸满也包不住的结构性溢出」——归因错误。
 * 引擎口径明写「量化（floor 次数）导致残差 ~1s 属合轴可覆盖，不追求精确 0」（坑 12/19）。
 *
 * ## 还原纪律
 *
 * 无论命中与否，`finally` 都把吸收率还原到进入前的值——**本函数只负责探测**，
 * 落点由调用方自己写（② 落 ② 的值、③ 落 ③ 的值）。缺了它，一次探测会把上一档的残余
 * 留给下一档（T140c 前的实测事故：队间串味让天花板被压低）。
 *
 * @param from 扫描起点（不含；② 从 0 起，③ 从 ② 的落点起）
 * @param probe 每个网格点调用一次；返回 `true` = 命中并停止。**可在闭包里捕获现场**（②③ 都这么做：
 *   命中时的伤害/轴态就是要落的点，重算一次纯属浪费）
 * @returns 命中的比例，或 `null`（扫到 cap 都没命中）
 */
export function scanAbsorbGrid(
  ctx: LadderCtx,
  cap: number,
  from: number,
  probe: (r: number) => boolean,
  steps = 20,
): number | null {
  if (cap <= from + 1e-9) return null
  const saved = ctx.config.getMechanicSetting(COMBO_ALIGN_ABSORB_RATIO_SETTING, DEFAULT_COMBO_ALIGN_ABSORB_RATIO)
  const n = Math.max(1, Math.trunc(steps))
  try {
    for (let i = 1; i <= n; i++) {
      const r = Math.round((from + (cap - from) * i / n) * 1e4) / 1e4
      ctx.config.setMechanicSetting(COMBO_ALIGN_ABSORB_RATIO_SETTING, r)
      if (probe(r)) return r
    }
  } finally {
    ctx.config.setMechanicSetting(COMBO_ALIGN_ABSORB_RATIO_SETTING, saved)
  }
  return null
}

/** 交互旋钮的两档配置（用户 §1(3)：非纯收益**取最优分配**） */
export type InteractionKnob = 'default' | 'joint'

/**
 * 施加交互旋钮。
 *
 * - `'default'`：**不跑**自动分配（= 「全关」语义，交互取角色/预设默认值）；
 * - `'joint'`：跑 `joint-levers` 多杠杆联合搜索（平A 权重 + 弹刀 + 嘲讽取消）。
 *
 * ⚠ 它**自己带守卫**：搜索内部有「伤害不降 + 不新增截断 + 吸收量不增」的可行性门
 * （见 `timeWeightAllocation#jointLeverStrategy`）⇒ 单独施加它不会让伤害下降。
 * 这是「取最优分配」能作为难度旋钮的**前提**（实测 97 队单独施加：0 队负增益）。
 */
export function applyInteractionKnob(ctx: LadderCtx, knob: InteractionKnob): void {
  if (knob === 'default') return // 全关 = 不动权重（调用方已由 clearDifficultyLevers 复位）
  applyTimeWeightAllocation({ calc: ctx.calc, configStore: ctx.config }, 'joint-levers')
}

/**
 * 保底键（**不再由阶梯打开**，见文件头「保底降级」）。
 * 保留常量是因为 `clearDifficultyLevers` 仍要清它们（用户意图归零 = ① 的语义）。
 */
const GUARANTEE_KEYS = ['guarantee.stun', 'guarantee.fury', 'guarantee.ultimate'] as const

/**
 * 关掉全部"优化目标"旋钮（保底 / 计数投影 / 合轴率），不清队伍。
 * ①「最低」基线复用它，保证"全关"的语义单源。
 *
 * ⚠ **保底键仍在此清零**（`guarantee.*` 是**用户意图**，配装页复选框 + 归档部署都会写）——
 * 本卡只是不再让**阶梯**去打开它们；轴需要时由引擎按「视同勾选」自行补齐（`convergence#guaranteeFury`），
 * 那是**本轮读数**、不落 store ⇒ 这里的清零与它不冲突（这正是该设计选择「不写 store」的原因）。
 */
export function clearDifficultyLevers(ctx: LadderCtx) {
  for (const k of GUARANTEE_KEYS) ctx.config.setMechanicSetting(k, 0)
  ctx.config.setMechanicSetting('time.stunPlanProjection', 0)
  // 合轴率优化也是「优化目标」：全关 = 不动手动/表格给的合轴率（用户手填值由调用方快照还原）
  for (let s = 0; s < 3; s++) ctx.config.clearComboAlignOverrides(s)
  // 动态合轴吸收：全关 = 不吸收（0）；用户上限先记进 ctx，④ 拉满推进到它（调用方快照/还原 mechanicSettings）
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
  /** 合轴率覆盖整表快照（不透明，CC-388 键已是 agentId）；④ 会写它，试开回滚必须一起还原 */
  align: ComboAlignState
  /** 动态合轴吸收上限（机制参数）；④ 写它，试开回滚必须一起还原 */
  absorb: number
  /** 轴状态（切轴档会写 stunAxes/stunAxisPlans/useStunAxis，试开回滚必须一起还原） */
  axis: StunAxisState
}
function snapshot(ctx: LadderCtx): LadderMutSnap {
  return {
    w: [0, 1, 2].map(s => ctx.config.team[s]!.basicAttackTimeWeight),
    p: [0, 1, 2].map(s => ctx.config.team[s]!.parryCount),
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

/** 关键点的点名（**机器可判定的四态**，卡 §3.1；UI 与报告共用一个口径） */
export type KnobPointName = 'baseline' | 'axis' | 'progress' | 'max'

export interface LadderPoint {
  /**
   * x 轴值。两种口径：
   *  · 缺省（静态 cost）：**累积**代价（从 0 开始累加各点自带 cost）；
   *  · 给了 `opts.costOf`：**实测的操作难度绝对值**（起点 = 全关那一点的难度，不是 0）——
   *    于是这条曲线的 x 与散点图的横轴**同一把尺**（可跨图对照）。
   */
  x: number
  dmg: number
  /** 这一点的**点名**（① `baseline` / ② `axis` / ③ `progress` / ④ `max`） */
  point: KnobPointName
  /**
   * 这一点的**旋钮取值**（用户 §1(2)「只需少量计算某些旋钮值」——曲线要如实报出旋钮在哪）。
   * 交互取 `'default'`（全关，不跑自动分配）/ `'joint'`（取最优分配）；吸收率是绝对值（0..cap）。
   */
  knobs: { interactions: InteractionKnob; absorb: number }
  /**
   * 这一点的**轴态**（唯一事实源 = `difficultyAxis.ts#axisStateOf`）。
   * 用户 §1(4)：「低难度的曲线因为达不到资源要求而弃轴或者跳过部分招式了，**标注没正常打完就行**」
   * ⇒ 曲线如实报三态 + `none`，不隐藏、不合并。
   */
  axis: AxisState
  /**
   * 这一点的**关键次数**快照（仅当 `opts.capture` 给了才在；键 = **可读标签**，如 `大招` / `克拉蕾·毁伤触发`）。
   * 相邻点做差就是「难度上升带来的次数跃迁」（见 `difficultyCurve.ts#diffKeyCounts`）。
   */
  counts?: Record<string, number>
  /**
   * 这一点的**伤害按来源分组**（键 = 招式名 / 异常类型；Σ 值 == 本点 `dmg`）。
   * 相邻点做差就是「这一点 +N 伤害是谁贡献的」（见 `difficultyCurve.ts#diffDmgBySource`）。
   */
  dmgBySource?: Record<string, number>
  /**
   * 这一点的**绝对操作难度**（仅当 `opts.costOf` 给了才在；单位 = 展示层口径）。
   * `x` 就是它（**绝对值**，不是相对全关的增量）。
   */
  difficulty?: number
  /**
   * 这一点的**时间线截断秒数**（引擎 `overflowSeconds`；与 `counts` 同一份快照采）。
   * >0 = 资源允许的动作装不进战斗时间、被装配期砍掉。缺省（没给 `opts.capture`）= 不采。
   */
  overflow?: number
  /**
   * 这一点**手填（预设声明）的交互总次数**——即难度 x 轴「缩之前」的交互量（`liveInteractions` 传 rr=null）。
   */
  interactionsFilled?: number
  /** 这一点**实打（缩后）的交互总次数** = x 轴交互项真正用的那个量（`liveInteractions` 传本点 rr） */
  interactionsPlayed?: number
}

/**
 * 一点的快照：展示层要什么就采什么（`opts.capture` 的返回）。
 *
 * ⚠️ 全部字段必须在**同一时刻**读同一份 `calc.resourceResult.value`（`counts` / `dmgBySource` /
 * `overflow` / 两个交互量都是）——分两次采会与点位错配。
 */
export interface LadderSnapshot {
  counts: Record<string, number>
  dmgBySource: Record<string, number>
  /** 本点时间线截断秒数（引擎 `overflowSeconds`） */
  overflow?: number
  /** 本点手填（声明）交互总次数（缩前） */
  interactionsFilled?: number
  /** 本点实打交互总次数（缩后） */
  interactionsPlayed?: number
}

export interface LadderResult {
  base: number
  final: number
  /** 关键点序列（1~4 点；`baseline` 与 `max` 恒存在，见卡 §4） */
  points: LadderPoint[]
  /** ② 点是否缺失（本队轴在任何难度下都不成立）——UI 据此在 ③ 位置如实标注 */
  axisPointMissing: boolean
  /**
   * ④ 点相对 ① 的伤害增量（「难度上升 ⇒ 总伤上升」的机器判据，卡 §6.5）。
   * **实测可为负**（如 G4 类口径漂移混入时）；本结构如实上报，不隐藏。
   */
  gain: number
}

export interface LadderOpts {
  /**
   * **相对门槛**（占全关伤害的比例，缺省 1e-4 = 0.01%）。
   * 用于 ③「重大进步」的判定：Δ伤害必须**严格正**且超过噪声量级，
   * 否则曲线出现"难度涨了、伤害不涨"的平台段，对"难易强度"比较有害。
   */
  minGainRatio?: number
  /**
   * **自定义「全关」基线**（缺省 = `resetDifficultyGoals` = 预设基础档）。
   * 展示层（`difficultyCurve.ts`）传入以对齐散点页口径 = `applyTeamToStore`（预设静态权重/交互）
   * + `clearDifficultyLevers`。返回基线伤害。
   */
  base?: (ctx: LadderCtx, team: [string, string, string]) => number
  /**
   * **每点采一次快照**（缺省不采 = 零开销）。在伤害已被最终计算后调用，
   * 所以读到的就是这个落点的资源结果（`damagePoolRows` 此刻已算好，读它不额外求值）。
   */
  capture?: (ctx: LadderCtx) => LadderSnapshot
  /**
   * **自定义「操作难度」测量**（用户 2026-09-10 口径：「难度系数肯定是自动算呀，参数可以修改，
   * 自变量就是交互值、吃掉队友的合轴时间等」）。给了它之后 `x` = **绝对值**（与散点横轴同尺）。
   */
  costOf?: (ctx: LadderCtx) => number
  /**
   * ② 的扫描步数（吸收率网格；缺省 20 = 5% 网格，见 `scanAbsorbGrid`）。
   * 单测可调小以控成本。
   */
  axisScanSteps?: number
}

/** 一个「点位」的完整现场（写盘前先试算，够好才落地） */
interface PointState {
  dmg: number
  knobs: { interactions: InteractionKnob; absorb: number }
  axis: AxisState
}

/** 读当前现场的伤害 + 轴态（轴态唯一事实源 = `difficultyAxis.ts`） */
function readState(ctx: LadderCtx, knobs: PointState['knobs']): PointState {
  return { dmg: ctx.calc.teamTotalDamage.value, knobs, axis: axisStateOf(ctx.calc) }
}

/**
 * 算一队的**关键旋钮点**（同步）。调用方按队分批调度避免卡 UI（同 `computeTeamComparePoints`）。
 *
 * ## 算法（每一步都对应卡里的一个既定口径，不是启发式）
 *
 * 1. **① baseline**：`opts.base`（缺省 `resetDifficultyGoals`）→ 记伤害 + 轴态；
 * 2. **② axis**（「刚好实现轴模式」）：**双旋钮网格扫描**——
 *    交互取 `'joint'`（非纯收益取最优），吸收率按 `scanAbsorbGrid` 的线性网格从小到大扫，
 *    取**首个使轴成立**（`axisStands`）的比例。本就成立 ⇒ 该点 = (joint, 0)；无轴队 ⇒ **跳过该点**；
 *    吸满也不成立 ⇒ 该点**缺失**（`axisPointMissing = true`，卡 §4）；
 * 3. **③ progress**（「重大进步」）：在 ② 之上把吸收推到 ④ 的水平，取「Δ伤害 ≥ 门槛 **且**
 *    出现 ≥1 次离散动作增量」的那个跃迁点。**无跃迁 ⇒ 跳过该点**（如实，不硬造）；
 * 4. **④ max**：吸收拉满（= `absorbCap`）+ 交互取最优 ⇒ **恒存在**。
 *
 * ## 与旧「贪心阶梯」的关键差别
 *
 * - **没有 `dropped`**：不再有"丢弃目标"的概念——每个点要么存在要么如实缺失（卡 §3.4）；
 * - **不按性价比竞争**：②③④ 是**沿单一难度轴推进**的定点，不是按 Δ/代价 排序的路径
 *   ⇒ 曲线能如实出现下降段（卡 §4：不回退该点，「下降是引擎的实情，藏起来才是骗人」）；
 * - **保底不再是一点**：`guarantee.fury`/`ultimate` 由引擎按轴需求自行补齐（见文件头）。
 */
export function climbDifficultyLadder(
  ctx: LadderCtx,
  team: [string, string, string],
  opts: LadderOpts = {},
): LadderResult {
  const minGainRatio = opts.minGainRatio ?? 1e-4
  const cap = absorbCapOf(ctx)
  const base = opts.base ? opts.base(ctx, team) : resetDifficultyGoals(ctx, team)
  const acceptAt = Math.max(0, base * minGainRatio)
  const capture = opts.capture
  const costOf = opts.costOf
  /** 采一点快照（同一点的全部字段读同一份 `resourceResult`，见 `LadderSnapshot` 注释） */
  const snap = (): Pick<LadderPoint, 'counts' | 'dmgBySource' | 'overflow' | 'interactionsFilled' | 'interactionsPlayed'> => {
    const s = capture?.(ctx)
    return s
      ? {
          counts: s.counts, dmgBySource: s.dmgBySource,
          overflow: s.overflow, interactionsFilled: s.interactionsFilled, interactionsPlayed: s.interactionsPlayed,
        }
      : {}
  }
  /**
   * 把当前现场落成一个点（伤害已算好）。
   * `x` 与 `difficulty` 同源同值（绝对值口径），**只量一次** `costOf`（它是纯读，但仍别重复调用）。
   */
  const land = (name: KnobPointName, st: PointState): LadderPoint => {
    const x = costOf ? costOf(ctx) : 0
    return {
      x,
      dmg: st.dmg,
      point: name,
      knobs: st.knobs,
      axis: st.axis,
      ...snap(),
      ...(costOf ? { difficulty: x } : {}),
    }
  }

  // ===== ① baseline（最低）=====
  const points: LadderPoint[] = [land('baseline', readState(ctx, { interactions: 'default', absorb: 0 }))]

  /**
   * ## 成本契约（改扫描前先读）
   *
   * 每队的总求值次数 = **1（①）+ 1 次 joint 搜索（~15-20 求值）+ ② 网格（≤ `scanSteps`）
   * + ③ 网格（≤ `scanSteps`）+ 1（④）**，即 ≈ 45~65 次全队求值。
   *
   * ⚠ **`joint` 只施加一次**（它是本函数里最贵的单项）。② 与 ③ 的网格**只改吸收率**、复用同一份
   * joint 配置——若在网格里重复调用 `applyInteractionKnob(ctx,'joint')`，每步会重跑一次联合搜索
   * ⇒ 成本 ×20（实测初版写法 ≈ 400 次求值/队）。**这是本函数唯一的成本纪律。**
   *
   * 网格步长 = `scanAbsorbGrid` 的 `steps`（缺省 20 = 5%）；单测可调小控成本。
   */
  const scanSteps = Math.max(1, Math.trunc(opts.axisScanSteps ?? 20))
  const before = snapshot(ctx)
  let axisPointMissing = false
  let axisPoint: LadderPoint | null = null
  /**
   * ③ 的**扫描基准点**（② 存在时 = ②；② 缺失时 = 「① 之后路径上的下一点」）。
   *
   * 为什么需要它（卡 §4 的既定口径）：
   * > **非轴队（`none`）**：不产出 ② 点，**曲线只有 ①③④**；轴态列显示 `—`。
   * 若 ③ 硬依赖 ②，非轴队就只剩 ①④ 两点 ⇒ 违反卡 §4。故 ③ 的基准取「路径上 ② 本该在的位置」：
   * 交互已取最优（joint）、吸收仍为 0。对非轴队这就是**① 到 ④ 之间的唯一天然中间态**。
   */
  let progressBase: { st: PointState; counts?: Record<string, number> } | null = null
  /** ③ 的扫描起点吸收率（= 基准点的吸收率） */
  let progressFrom = 0
  {
    // ② 的第一步：交互取最优（守卫在 joint-levers 内部：伤害不降 + 不新增截断 + 吸收量不增）。
    // ⚠ 这一次调用之后，**joint 写下的权重/弹刀/嘲讽取消一直留在现场**，②③④ 都在它之上取值。
    applyInteractionKnob(ctx, 'joint')
    /**
     * ⚠ **为什么交互先于吸收**（实测，`.zc/perf/T140cPredict6.perf.ts`）：
     * 卡 §6.3 要求 `banyue-norma-lucia` 的 ② 落在 **r\*≈0.45**，而该数字**只在「先 joint 再扫 r」下复现**
     * （裸交互 r\*=0.80）。语义上也自洽：joint 是「取最优分配」，它改变的是**必要的**前台占用，
     * 而吸收率是**兜底**手段 ⇒ 先把最优分配做掉，再问"还差多少兜底"。
     */
    const jointOnly = readState(ctx, { interactions: 'joint', absorb: 0 })
    const jointCounts = capture?.(ctx)?.counts
    if (axisStands(jointOnly.axis)) {
      // 交互最优后轴**本就成立** ⇒ ② = (joint, 0)。
      // 用户 §4：合轴「拉满」与「轴成立」冲突时**优先让轴成立** ⇒ 这里不为好看去抬吸收率（0 已经够）。
      axisPoint = land('axis', jointOnly)
    } else if (cap > 0) {
      // 逐步抬吸收率，取**首个**使轴成立的值（线性网格，不能二分 ⇒ 见 `scanAbsorbGrid` 头注释）
      scanAbsorbGrid(ctx, cap, 0, r => {
        const st = readState(ctx, { interactions: 'joint', absorb: r })
        if (!axisStands(st.axis)) return false
        axisPoint = land('axis', st) // 命中即落点（现场就在闭包里，不重算）
        return true
      }, scanSteps)
      // 吸满也不成立 ⇒ 该点缺失（卡 §4：曲线直接跳到 ④，并在 ③ 位置标注「本轴在任何难度下都不成立」）
      if (!axisPoint) axisPointMissing = true
    } else {
      axisPointMissing = true // cap = 0（用户关掉合轴）⇒ 没有可用的时间旋钮
    }
    if (axisPoint) {
      points.push(axisPoint)
      progressBase = { st: { dmg: axisPoint.dmg, knobs: axisPoint.knobs, axis: axisPoint.axis }, counts: axisPoint.counts }
    } else {
      // ② 缺失（非轴队 / 轴在任何难度下都不成立）⇒ ③ 以「joint + 吸收 0」为基准
      progressBase = { st: jointOnly, counts: jointCounts }
    }
    /** ③ 的扫描起点吸收率（= 基准点的吸收率；② 存在时就是它的落点） */
    progressFrom = progressBase.st.knobs.absorb
  }

  // ===== ③ progress（重大进步）=====
  /**
   * 在基准点之上继续推进到**下一个关键跃迁**：Δ伤害 ≥ 门槛 **且** 出现 ≥1 次离散动作增量
   * （`counts` 里任一项 Δ≥1）。无跃迁 ⇒ 该点**跳过**（如实，不硬造一个平台点）。
   *
   * ⚠ 需要 `opts.capture` 才能判「离散动作增量」；没给 capture 时退化为「只看 Δ伤害 ≥ 门槛」。
   * ⚠ 现场此刻已是基准点的配置（joint + 基准吸收率）⇒ 循环里**只改吸收率**（成本纪律，见上）。
   */
  if (progressBase) {
    const baseCounts = progressBase.counts
    const from = progressFrom
    scanAbsorbGrid(ctx, cap, from, r => {
      const st = readState(ctx, { interactions: 'joint', absorb: r })
      if (st.dmg - progressBase.st.dmg < acceptAt) return false
      // 「跃迁」= 出现 ≥1 次离散动作增量（用户 §1(2)「重大进步」；口径见 difficultyCurve#diffKeyCounts）
      const jumped = baseCounts === undefined ? true : (() => {
        const s = capture?.(ctx)
        if (!s) return true
        for (const [k, v] of Object.entries(s.counts)) {
          const prev = baseCounts[k]
          if (prev !== undefined && v - prev >= 1 - 1e-6) return true
        }
        return false
      })()
      if (!jumped) return false
      points.push(land('progress', st)) // 命中即落点
      return true
    }, scanSteps)
  }

  // ===== ④ max（最高）=====
  /**
   * 纯收益拉满（吸收 = cap）+ 非纯收益取最优（joint，已施加）。
   * **恒存在**（卡 §4）：它是「难度上升 ⇒ 总伤上升」的落点，也是曲线的天花板。
   * 即使 ②③ 都缺失（非轴队 / 轴不成立），本点仍然存在 ⇒ 曲线至少有 ①②④ 里的 ①④ 两点。
   */
  ctx.config.setMechanicSetting(COMBO_ALIGN_ABSORB_RATIO_SETTING, cap)
  points.push(land('max', readState(ctx, { interactions: 'joint', absorb: cap })))

  // 现场恢复：本函数只负责**探测**，调用方（`computeDifficultyCurves` 的调用方）按契约还原
  restore(ctx, before)

  const final = points[points.length - 1]!.dmg
  return { base, final, points, axisPointMissing, gain: final - base }
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
