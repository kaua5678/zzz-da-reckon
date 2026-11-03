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
 * `guarantee.fury` **不再由本模块打开**：轴要立起来时由引擎自己决定补多少资源
 * （`convergence.ts#guaranteeFury` 的「轴模式 ⇒ 视同勾选」，用户裁决 2026-10-11，**实现一字不动**）。
 * 本卡改的是它**在曲线口径下的地位**，不是它的实现。
 *
 * ## 展示层契约
 *
 * `difficultyCurve.ts` 用 `opts.base` 换掉「全关」基线（预设静态权重/交互，与散点页同口径）
 * ——本模块自己不依赖 `teamCompare`，保持纯策略。轴态的唯一事实源是 `difficultyAxis.ts#axisStateOf`。
 *
 * 判据测试：`__tests__/difficultyLadder.test.ts`（点数 / ①④ 恒存在 / 轴态 / 单调）+ `difficultyAxis.test.ts`；
 * 「② 烧吸收确有必要」全库判据拆 4 片并行跑（`__tests__/difficultyLadderBurnShard{0..3}.test.ts`，
 * 共用 `src/test/ladderBurnShard.ts`；拆片理由与实测成本表见该文件头）。
 */
import { type StunAxisState, type ConfigModel, type ComboAlignState, type ActionCountField } from '@/stores/config'
import type { ResourceCalc } from '@/composables/useResourceCalc'
import { applyTimeWeightAllocation, tauntLeverSlots } from '@/composables/timeWeightAllocation'
import { axisStateOf, axisStands, axisRequirementMet, axisTruncationReason, partialAxisContributes, type AxisState } from '@/composables/difficultyAxis'
import { getInteractionDefaults } from '@/mechanics/interactionBaseline'
import { getAgentMechanic } from '@/mechanics/registry'
import { COMBO_ALIGN_ABSORB_RATIO_SETTING, DEFAULT_COMBO_ALIGN_ABSORB_RATIO } from '@/data/resourceDefaults'
import type { PointScene } from '@/types/configDelta'
import type { ContinuousStunProgress } from '@/core/continuousStun'

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

/** 交互旋钮的四档配置（用户 §1(3)：非纯收益**取最优分配**；T141 新增 `'zero'` / `'slotLadder'`） */
export type InteractionKnob = 'zero' | 'default' | 'joint' | 'slotLadder'

/**
 * 施加交互旋钮。
 *
 * - `'zero'`（**T141 新增，①「最低」档用**）：把三槽交互全部清零（`clearInteractions`）——
 *   用户口径 4+5「低难度下就是**全 0 交互**的」「不该用预设」⇒ ① 落在难度轴的**原点**；
 * - `'default'`：**不跑**自动分配（= 交互取角色/预设默认值）；
 * - `'joint'`：跑 `joint-levers` 多杠杆联合搜索（平A 权重 + 弹刀 + 嘲讽取消）。
 *
 * ⚠ `'joint'` **自己带守卫**：搜索内部有「伤害不降 + 不新增截断 + 吸收量不增」的可行性门
 * （见 `timeWeightAllocation#jointLeverStrategy`）⇒ 单独施加它不会让伤害下降。
 * 这是「取最优分配」能作为难度旋钮的**前提**（实测 97 队单独施加：0 队负增益）。
 * ⚠ `'joint'` **不会把交互清零**：它是在**当前值**上做 ± 搜索 ⇒ 从 `'zero'` 出发与从 `'default'`
 * 出发会落到不同局部解。本模块的路径是 ①(zero) → ②③④(joint)，即「从全 0 出发让搜索自己加回来」，
 * 这正是用户口径 4 要的「由计算器自动计算」（而不是从预设值出发）。
 *
 * ## ⚠ `joint-levers` 的**局部最优盲区**（T141 实测，故 ④ 另跑一次逐槽扫描）
 *
 * `joint-levers` 的弹刀阶梯是**坐标上升**（每次 ±2，接受才走）⇒ 起点决定落点。
 * 实测 `auto-1371-1481-1451` @ `r=cap`：`joint` 从全 0 出发只加了**槽0 的 2 次弹刀**
 * （弹刀 `2/0/0`，58.872M），而**全槽各 3 次**是 70.487M——坐标上升被「单槽 +2 不涨」卡住，
 * 看不到「三槽一起加」的台阶（该队的失衡台阶需要三槽同时够到阈值）。
 * ⇒ 本模块在 `'joint'` 之上再叠一层 `'slotLadder'`（见 `optimizeInteractionsPerSlot`）。
 */
export function applyInteractionKnob(ctx: LadderCtx, knob: InteractionKnob): void {
  if (knob === 'zero') { clearInteractions(ctx); return }
  if (knob === 'default') return // 全关 = 不动权重（调用方已由 clearDifficultyLevers 复位）
  /**
   * **嘲讽取消 = 纯收益杠杆 ⇒ 拉满**（用户口径 2026-10-19 逐字）：
   *
   * > 「取消损失也算白给的收益吧，**前台时间多了就像合轴率一样的**。
   * >   次数上限是你的**后摇次数上限**，最高是把后摇减到 0s」
   * > 「我是说**提升难度的时候**才能自动拉满，比如**提高合轴率的时候，也要考虑这个值**。」
   *
   * ⇒ 与合轴吸收率（`absorbCapOf`：纯收益 ⇒ 拉满到 cap）同族，但**只在 ②③④ 拉、① 不拉**：
   * ① 是「全 0 交互」的难度下限（连嘲讽都不打）；②③④ 逐步加操作量，取消后摇是
   * 「同样的操作量换更多前台时间」⇒ 该给就给。
   *
   * **上限不由本模块计算**：写 `bounds.max`（见 TAUNT_CANCEL_FULL），引擎
   * `computeBanyueRageCycle` 用 `min(手填, 失衡外连段数)` 硬截断 ⇒ 等价「拉到后摇归零」，不会超发。
   * 这样本模块**不需要知道**后摇有多少——那取决于怒相/连段/轴态，是引擎的活。
   */
  /**
   * ⚠ **判据是「模块声明了该杠杆」，不是「字段存在」**（2026-10-23 修，用户实报「曲线斜率太低」）。
   *
   * 修前用 `row?.tauntCancelCount === undefined` 判——但 `defaultCharacter` 给**每个**角色都预置了
   * `tauntCancelCount: 0` ⇒ 三槽全过判据 ⇒ 无般岳的队也写满 3×99 = **297 次**。
   * 而 `liveInteractions` 读 store 原值（不读引擎 clamp 后的实际值）⇒ x 轴白吃 297×1.2 = **356 点**
   * （实测 `auto-1591-1481-1211`：写满前后伤害逐位相同 112.834M，x 从 0 涨到 356.4）——
   * 「斜率 0.0%/点」的主因就是它（`banyue-liuyin-lucia` 的 297 项占 x 的 92.8%）。
   * 单一来源 = `timeWeightAllocation#tauntLeverSlots`（同一条 `characterCountInputs` 能力判据，规则 11）。
   */
  for (const slot of tauntLeverSlots(ctx.config)) {
    ctx.config.setActionCount(slot, 'tauntCancelCount', TAUNT_CANCEL_FULL)
  }
  applyTimeWeightAllocation({ calc: ctx.calc, configStore: ctx.config }, 'joint-levers')
  if (knob === 'slotLadder') optimizeInteractionsPerSlot(ctx)
}

/**
 * 「嘲讽取消拉满」的写入值。
 *
 * 取 `ACTION_COUNT_BOUNDS.tauntCancelCount.max`（99）而不是「后摇次数」：后摇次数由引擎在
 * 怒相/连段/轴态上算出来，编排层拿不到也不该复制那套推导（规则 11 单一事实源）。
 * 引擎侧 `Math.min(手填, 失衡外连段数)` 保证写 99 与写真实值结果**逐位相同**。
 */
const TAUNT_CANCEL_FULL = 99

/**
 * **按槽位职业分别求交互最优**（T141 卡 §3.2/§4 的既定口径）。
 *
 * ## 用户口径（2026-10-12 逐字）
 * > 「**主c交互大多是不亏的**，我说了**闪反比平a厉害**，**弹刀也不差**，**失衡和喧响还很赚**，
 * >   所以多半会赚。**辅助交互才是亏的**。能考虑的只有**击破弹刀让失衡加速**，这也不一定赚。」
 *
 * 逐槽隔离实测（`.zc/perf/T141perSlot.perf.ts`，`auto-1611-1141-1211`）**完全印证**：
 * | 槽 | 定位 | 弹刀 1→16 | 闪反 1→30 |
 * |---|---|---|---|
 * | 0 | 克拉蕾（主C） | 全程正（+0.07 → +5.87M） | 全程正、单调升（+0.17 → +19.06M） |
 * | 1 | 莱卡恩（击破） | 正，峰 +8.16M | 正（+13.995M） |
 * | 2 | 丽娜（支援） | **负**（−0.19 → −1.75M） | 前期负、8 次后转正（失衡台阶） |
 * ⇒ 「给辅助加交互是纯亏」**不能**当成硬性禁加（支援闪反在失衡台阶后也转正），
 * 故本函数**不禁任何槽**，只做**逐槽坐标上升 + 伤害不降门**（让数据自己决定）。
 *
 * ## 与 `joint-levers` 的分工（为什么不合并）
 *
 * `joint-levers` 是**全队联合**搜索（含平A 权重均衡 / 能量喂能 / 角点解），它是「分配最优」；
 * 本函数是**逐槽交互阶梯**，治的是它的**局部最优盲区**（见 `applyInteractionKnob` 末段实测）。
 * 两者叠加 = 先联合分配、再逐槽把交互台阶踩上去；每一步都过 `accepted` 门（伤害严格增 + 可行），
 * 故**不会让伤害下降**，也就不可能把 ④ 拉到 ① 以下。
 *
 * ## 口径（卡 §2.3b：不能只看边际伤害）
 *
 * 接受条件 = **伤害严格增**（`> best + 1e-6`）**且** `feasible()`（不新增截断、不加深吸收）。
 * 卡 §2.3b 要求「实际执行的动作数不得下降」——由 `feasible()` 的截断臂 + 本函数的
 * 「伤害严格增」共同保证：若加交互把招式挤出时间线（截断↑）则门当场回滚。
 *
 * ⚠ **上限 16 次/槽**：卡 §2.3 的逐槽表扫到 16 已见峰后回落（弹刀 16 次 −27.45M 是三槽混扫的
 * 旧读数；逐槽表在 16 次仍是正），且再高只增成本。步长 1（不是 2）：失衡台阶是**离散**的
 * （实测 1371 在 2→3 之间跳 +2.62M），步长 2 会跳过奇数台阶。
 */
/**
 * **本队该爬哪些交互字段**（T171 声明式爬升面）——基础两字段 + 各槽角色声明的特色字段。
 *
 * ## 口径（用户 2026-10-15「每个角色都有自己特色的交互……新角色最好能简单设置下就能用上」）
 *
 * - **基础两字段恒在**：`parryCount` / `dodgeCounterCount`（卡 §2.3 表里唯二被逐槽量过的通用杠杆，
 *   所有角色都有 ⇒ 无声明角色也照爬，纯追加语义）；
 * - **特色字段按槽追加**：该槽角色 `interactionDefaults` 里非零的 `block` / `dual`
 *   → `blockCount` / `dualCounterCount`。
 *
 * ⚠ **为什么复用 `interactionDefaults` 而不是新增一份声明**：它已是「本角色有哪些交互」的
 * **单一事实源**（`setAgent` 换人预填、`applyRoleInteractionBaseline` 同源）⇒
 * **新角色接入 = 零额外声明**，声明了自己会打的交互就自动爬得到（规则 11 单一来源）。
 *
 * ⚠ **哨兵语义字段（`0` = 自动）天然不在表内**：`interactionDefaults` 只有
 * `parry` / `dodge` / `block` / `dual` 四个键，而 `yixuanInk3Count`（≤0 = 自动消耗全部闪能）、
 * `yixuanExtremeAssistCount`（-1 = 自动）都不在其中 ⇒ **白名单天然安全**，
 * 不会把「自动吃满」爬成「一次都不打」（那是盲目遍历 14 字段会踩的坑）。
 *
 * ⚠ 顺序稳定（基础两字段在前、特色字段按槽序）：坐标上升的落点依赖顺序，抖动会让曲线不可复现。
 */
export function climbFieldsOf(ctx: LadderCtx): ActionCountField[] {
  const out: ActionCountField[] = ['parryCount', 'dodgeCounterCount']
  const seen = new Set<ActionCountField>(out)
  for (let slot = 0; slot < 3; slot++) {
    const agentId = ctx.config.team[slot]?.agentId
    if (!agentId) continue
    const d = getInteractionDefaults(agentId)
    /**
     * ⚠ 2026-10-21「通用交互基准全 0」之后，`interactionDefaults` 恒为 0 ⇒ 只看非零值会让**所有**角色的
     * 特色字段从爬升面消失（实测般岳金身/双反：面板上明明有输入框，爬升面只剩基础两字段）。
     * ⇒ 来源改成「非零基准 **或** `interactionFieldTypes` 显式声明」——后者是「本角色有这些交互」的
     * 单一声明（Tag 白名单仍是 parry/dodge/block/dual 四项，哨兵字段不会因声明某个 type 被爬）。
     */
    const decl = getAgentMechanic(agentId)?.interactionFieldTypes ?? {}
    // `block` / `dual` 是该表里唯二映射到「非基础字段」的项（parry/dodge 已在前两行）
    if ((d.block > 0 || decl.blockCount) && !seen.has('blockCount')) { out.push('blockCount'); seen.add('blockCount') }
    if ((d.dual > 0 || decl.dualCounterCount) && !seen.has('dualCounterCount')) { out.push('dualCounterCount'); seen.add('dualCounterCount') }
    /**
     * ★ **比例型爬升声明**（T173，用户口径 2026-10-15）——「相对已有量按比例放宽」的旋钮
     * （仪玄后台墨影凝云：上限 = 已有后台 × 1.5）。契约见 `typesHooks#InteractionClimbDecl`。
     *
     * ⚠ **形态与 `interactionDefaults` 不同，故单列一条通道**：那张表只能表达「从 0 爬到绝对值 N」，
     * 而这些字段的起点是**本轮收敛出来的已有量**（每轮可能变）⇒ 起点与上限都要按轮从结果里取。
     * ⚠ **哨兵语义字段依旧排除**：声明里 `field` 是模块显式写的 ⇒ `0 = 自动` 的字段不会被爬
     * （爬它会把「自动吃满」变「一次都不打」）。
     */
    const climb = getAgentMechanic(agentId)?.interactionClimb
    if (climb && !seen.has(climb.field)) { out.push(climb.field); seen.add(climb.field) }
  }
  return out
}

export function optimizeInteractionsPerSlot(ctx: LadderCtx, maxCount = 16): void {
  const rr = () => ctx.calc.resourceResult.value
  /** 当前截断秒数（每次求值后读，**不是**一次性的地板——见下方注释） */
  const truncated = () => rr()?.convergence.timeTruncatedSeconds ?? 0
  /**
   * ⚠ **地板必须每步重取**（T141 实测修的缺陷）：旧写法在进入函数时算一次 `floor`，
   * 于是「第一步让截断从 0 涨到 4.7s」之后，**所有后续步都恒被判越界**（4.7 > 0）
   * ⇒ 整条阶梯在第一步就死掉，④ 的交互量恒为 0（实测 `auto-1521-1481-1311` 的 ④
   * `interactionsPlayed = 0`，而 `auto-1611-1141-1211` 的 ② 只加到 2 次就停）。
   * 正确口径 = **相对上一步不恶化**（「不新增截断」的原意是「这一步没让它变差」，
   * 不是「永远不许超过起点」）。
   */
  const baselineTrunc = truncated()
  /**
   * **实际执行的动作数**（卡 §2.3b 的主判据，用户 2026-10-12 逐字）：
   * > 「你击破耗那么多时间，**考虑过主c动作被挤压没有**…如果你**时间不够，超过合轴率上限能包容的时间，
   * >   你的动作都打不出来**。也许目前失衡写的逻辑是强制触发，但实际上**时间截断才是强制的**。」
   * > 「而且**主c的时间被挤压后，喧响和能量都不够，轴内估计全是空气了**。」
   *
   * = 轴内 `executed` 动作数 + 伤害池行数（**两条通道都量**：前者是「轴内打出来的」、
   * 后者是「进伤害池的」）。实测（`.zc/perf/T141guard.perf.ts`）：给**辅助**槽加弹刀时
   * 总伤可能仍涨，但 `executed` 会 39→32（主C 的轴内动作被挤出）——这正是用户点名要防的形态。
   */
  const executedCount = () => {
    let n = 0
    for (const v of Object.values(ctx.calc.stackTraversalResult.value?.executed ?? {})) n += v.count
    return n
  }
  const poolRows = () => ctx.calc.damagePoolRows.value.length
  /**
   * **轴内被跳过的招数**（`skippedTotal`）——接受门 ④ 的量（用户口径 2026-10-15）。
   * 口径是**单调不恶化**（不得比上一步多跳），不是「必须为 0」：起点本就不成立时（全 0 交互
   * 喂不饱轴）拿「必须为 0」当门会让阶梯一步都走不动 ⇒ ④ 退化成 ①，比截断更糟。
   */
  const skipCount = () => axisStateOf(ctx.calc).skippedTotal
  /**
   * ## 爬升面（T171 改声明式，用户口径 2026-10-15）
   *
   * 用户逐字：
   * > 「**每个角色都有自己特色的交互**，比如**仪玄的后台墨痕化形可以在后台造成攻击**。」
   * > 「你这种改动可以复用吧？比如**新角色有什么交互要求最好能简单设置下就能用上**。」
   *
   * ### 修前缺陷（实测）
   *
   * 这里**写死 `['parryCount', 'dodgeCounterCount']`**，而 ① 会把 **14 个交互字段全清零**
   * ⇒ 其余 12 个字段（含般岳的金身/双反、仪玄的墨痕化形系列）从 0 出发、**永不加回**。
   * T170 已用「搜索起点 = 角色声明的 `interactionDefaults`」缓解（般岳因此能立轴），
   * 但**只能回到声明值**、不能再往上爬 ⇒ 需要比声明值更多时仍搜不到。
   *
   * ### 现口径：基础两字段 + 各槽角色声明的特色字段
   *
   * - **基础两字段恒在**（`parryCount` / `dodgeCounterCount`）：它们是卡 §2.3 表里唯二被逐槽量过的
   *   通用杠杆，且所有角色都有（无声明角色也靠它们）；
   * - **特色字段按槽追加**：取该槽角色模块声明的 `interactionDefaults` 里**非零**的项
   *   （`block` → `blockCount`、`dual` → `dualCounterCount`）。
   *   ⚠ **用 `interactionDefaults` 而不是新声明**：它已经是「本角色有哪些交互」的**单一事实源**
   *   （`setAgent` 换人预填、`applyRoleInteractionBaseline` 都用它）⇒ 新角色接入 = **零额外声明**，
   *   只要它声明了自己会打的交互，本阶梯就自动爬得到。
   * - **哨兵语义字段不在此列**（`yixuanInk3Count` 等 `0 = 自动` 的字段）：它们**不在**
   *   `interactionDefaults` 的四个键里（那张表只有 parry/dodge/block/dual）
   *   ⇒ 白名单天然安全，不会把「自动吃满」爬成「一次都不打」。
   */
  const climbKeys = climbFieldsOf(ctx)
  /**
   * ★ **比例型爬升字段的按轮上限**（T173，用户口径 2026-10-15「**自动爬升上限是他已有后台的 50%**，
   * 不能说他后台全都在合轴」）——返回该槽该字段**本轮允许爬到**的最大值；非比例型字段返回 `null`（无上限）。
   *
   * ## 口径（三条，缺一条即静默失效）
   *
   * 1. **上限在「进入本字段的阶梯前」取一次**：`anchor` 是**收敛后的读数**（不是构建期算的常量），
   *    但**必须在写第一个值之前**读——见下方 ⚠ 自指陷阱。同一个字段在 ③/④ 各走一遍阶梯时各取一次
   *    ⇒ 「按轮取」；换队/换档/收敛变了都会重新读。
   * 2. **上限是「终点值」不是「增量」**：`capOf(anchor)` 返回 `anchor + floor(anchor × 比例)`，
   *    故判据写成 `next <= cap`（而不是 `next - anchor <= 增量`）——两者等价，
   *    因为阶梯是**从已有量往上走**的（`anchor` 就是起点），故「终点 ≤ 已有 × 1.5」即「增量 ≤ 已有 × 0.5」。
   * 3. **anchor 只认声明字段所在槽**：`anchorOf(rr)` 由模块自己按结果行算（它知道自己是谁），
   *    本函数只负责把 store 读取器递给它（`capOf` 的第二参），**不复制比例默认值**（规则 11）。
   *
   * ⚠ **anchor = 0 ⇒ 上限 = 0**（模块契约）：没有已有后台 ⇒ 一次都不能爬
   * （「没得爬」的语义，与用户口径「不能说他后台全都在合轴」一致）。
   *
   * ## ⚠ 自指陷阱（**逐字改这条前必读**，2026-10-16 实测）
   *
   * 直觉写法是「每步重读 anchor」——**那是自指的，上限会随爬升自己长大**：
   * 被爬字段是**手动**字段，而模块的锚读的是**本轮结果行**
   * （`max(手动, 自动)`）⇒ 写下 `m` 之后 anchor 就变成 `m`、上限随之变成 `1.5m`
   * ⇒ 每步 +50% 的**几何增长**，上限形同不存在。
   * 实测（`.zc/perf/T134probe8.perf.ts`，`yixuan-trigger-lucia`，anchor=11）：
   * `m=11 → anchorNow=11 capNow=16`、`m=12 → 12/18`、…、`m=17 → 17/25` ⇒ **cap 永不生效**，阶梯一路爬到 `maxCount`。
   * ⇒ 正解 = **在写第一个值之前把 anchor 钉住**（它就是「已有后台」，爬升不应改变自己的分母）。
   */
  const climbCapAt = (slot: number, key: ActionCountField, which: 'cap' | 'anchor' = 'cap'): number | null => {
    const agentId = ctx.config.team[slot]?.agentId
    const climb = agentId ? getAgentMechanic(agentId)?.interactionClimb : undefined
    if (!climb || climb.field !== key) return null
    const rr = ctx.calc.resourceResult.value
    if (!rr) return 0
    const anchor = climb.anchorOf(rr)
    return which === 'anchor' ? anchor : climb.capOf(anchor, ctx.config.getMechanicSetting)
  }
  // 逐槽、逐类型坐标上升
  for (const key of climbKeys) {
    for (let slot = 0; slot < 3; slot++) {
      let best = ctx.calc.teamTotalDamage.value
      let prevTrunc = truncated()
      let prevExec = executedCount()
      let prevRows = poolRows()
      let prevSkips = skipCount()
      /**
       * ⚠ **必须在循环外、写第一个值之前取**（自指陷阱见 `climbCapAt` 头注释）：
       * 每步重读 anchor 会让上限跟着爬升一起长大 ⇒ 门形同不存在（实测几何增长）。
       */
      const cap = climbCapAt(slot, key)
      /**
       * ★ **比例型字段的起点 = 已有量（anchor），不是 0**（T173）。
       *
       * 为什么必须显式落地（**实测，不是设计偏好**）：锚读的是**本轮结果行**，而手动字段为 0 时
       * 结果行由引擎的自动反推提供 ⇒ 起点**在盘上不是 0、在 store 里是 0**。
       * 只给上限不落地会产生两个错：
       * ① 阶梯第 1 步把 0 写成 1 ⇒ 反推被**手动覆盖**顶掉 ⇒ 对数从 11 掉到 1 ⇒ 伤害**暴跌**
       *    （实测 `yixuan-trigger-lucia`：57.16M → 5.34M）⇒ 接受门第 ① 条当场回滚，阶梯一步都走不动；
       * ② 上限因此永远够不到（起点离上限 10+ 步，而第一步就被拒）。
       *
       * ⚠ **物化不是逐位 0 delta**（实测）：锚读的是**自动反推**那一份的读数，而把它写进手动字段后
       * 外层不动点落点会变（实测 `yixuan-trigger-lucia`：auto `iter=2` / manual 写回 `iter=3`，
       * 同为 12 对但伤害 57.913M → 57.561M，**−0.35M / −0.61%**）。⇒ 物化必须与随后的爬升**同生共死**：
       * 整步（物化 + 爬升）结束时若**反而更差**，就把整步回滚（`materialized` 标记 + 末尾判据）。
       * 这样「爬升」永远不会让 ④ 的天花板比不爬更低（本模块的单调性契约）。
       */
      const anchorStart = cap !== null ? climbCapAt(slot, key, 'anchor') : null
      const cur0 = Number((ctx.config.team[slot] as unknown as Record<string, number | undefined>)?.[key] ?? 0)
      let materialized = false
      let dmgBeforeMaterialize = 0
      if (anchorStart !== null && anchorStart > cur0) {
        dmgBeforeMaterialize = ctx.calc.teamTotalDamage.value
        ctx.config.setActionCount(slot, key, anchorStart)
        materialized = true
        // 物化改变了现场 ⇒ 接受门的四个读数全部重新基线（否则第一步会拿「物化前」的伤害比）
        best = ctx.calc.teamTotalDamage.value
        prevTrunc = truncated()
        prevExec = executedCount()
        prevRows = poolRows()
        prevSkips = skipCount()
      }
      for (let n = 0; n < maxCount; n++) {
        const cur = Number((ctx.config.team[slot] as unknown as Record<string, number | undefined>)?.[key] ?? 0)
        const next = cur + 1
        /**
         * ⚠ **上限门必须在写之前判**（写进去再回滚会让引擎多算一次、也会在别的判据上留下痕迹）：
         * 越界即**视为阶梯终点**（`break`，与「加不动」同一条出路——它不是失败，是这条字段爬到头了）。
         */
        if (cap !== null && next > cap) break
        ctx.config.setActionCount(slot, key, next)
        const dmg = ctx.calc.teamTotalDamage.value
        const trunc = truncated()
        const exec = executedCount()
        const rows = poolRows()
        /**
         * 接受门（四条，全过才走）：
         *  ① **伤害严格增**（非纯收益杠杆的基本要求）；
         *  ② **不新增截断**（相对上一步、且不劣于本阶梯起点）；
         *  ③ **执行数不下降**（卡 §2.3b：`executed` 与伤害池行数都不得降）。
         *  ③ 是 T141 新加的：只看 ① 会把「加辅助交互 ⇒ 总伤微涨但主C 动作被挤掉」判成正收益
         * （实测槽2 弹刀=2：伤害 57.615M vs 起点 58.053M 其实已跌，但更隐蔽的形态是
         * `executed` 39→32 而伤害因别处补回而微涨）。
         *
         *  ④ **不得让轴内被跳过的招数变多**（用户口径 2026-10-15「达到资源要求然后计算」）。
         * ⚠ 这一条是实测逼出来的：`banyue-trigger-lucia` 的**预设交互**下轴是 `complete`，
         * 而逐槽阶梯为了加伤害把弹刀加到 4 ⇒ 轴掉成 `partial`（跳过 4 招）⇒ 该点整档不成立。
         * 用户口径「**我要的是你达到资源要求然后计算**」⇒ 优化器不能为了伤害把轴弄坏：
         * 轴模式下的伤害只有在轴成立的档位上才有意义。
         * 口径是**相对上一步**（`skips <= prevSkips`），故起点不成立时阶梯照样能走
         * （只禁止「越加越糟」）。这与截断门互补：截断门决定这一点**算不算数**，
         * 本条决定优化器**别把本来能成立的轴推坏**。
         */
        const skips = skipCount()
        /**
         * ★ **修轴臂**（2026-10-25）：起点轴不成立时（13b9f584 交互全 0 之后这是常态），
         * 只认「伤害严格增」会让阶梯在**第一次**加交互就被拒（金身/双反那一步的伤害是为轴付钱，
         * 未跨过资源阈值前纯亏）⇒ 轴永远修不回来（实测 banyue-trigger-lucia 全档截断、
         * block/dual 恒 0、② 缺失）。
         *
         * 用户口径 2026-10-15「我要的是你**达到资源要求然后计算**」⇒ 轴未成立时段，
         * 「轴内被跳过的招数**变少**」本身就是正收益：接受该步（伤害让位），并把 best 降到新伤害，
         * 后续步继续按「少跳」爬；一旦轴成立（skips 不再降），立刻回到原四条严格门。
         * 另三条门（截断/执行数/行数）在修轴臂里**照旧生效**——修轴不能靠截断或挤掉动作换。
         */
        const repairsAxis = skips < prevSkips - 1e-6
        const ok = repairsAxis
          ? trunc <= prevTrunc + 1e-6 && trunc <= baselineTrunc + 1e-6
            && exec >= prevExec - 1e-6 && rows >= prevRows
          : dmg > best + 1e-6
            && trunc <= prevTrunc + 1e-6 && trunc <= baselineTrunc + 1e-6
            && exec >= prevExec - 1e-6 && rows >= prevRows
            && skips <= prevSkips
        if (ok) {
          best = dmg
          prevTrunc = trunc
          prevExec = exec
          prevRows = rows
          prevSkips = skips
        } else {
          ctx.config.setActionCount(slot, key, cur) // 回滚：不涨 / 越界 / 挤掉动作
          break
        }
      }
      /**
       * ⚠ **物化整步回滚**（T173；与上面注释的实测数字同源）：物化那一下自己会动外层不动点，
       * 若整步走完（物化 + 后续爬升）**比物化前更低**，说明这一步净亏 ⇒ 整体还原成 `cur0`。
       * 保证「爬升」不会让这一档的天花板比不爬低（本模块 ④ ≥ ① 的结构性保证之一）。
       */
      if (materialized && ctx.calc.teamTotalDamage.value + 1e-6 < dmgBeforeMaterialize) {
        ctx.config.setActionCount(slot, key, cur0)
      }
    }
  }
}

/**
 * 保底键（**不再由阶梯打开**，见文件头「保底降级」）。
 * 保留常量是因为 `clearDifficultyLevers` 仍要清它们（用户意图归零 = ① 的语义）。
 */
const GUARANTEE_KEYS = ['guarantee.stun', 'guarantee.fury'] as const

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

/**
 * **难度曲线 ①「最低」档的全部交互类型**（T141 用户口径 4 + 5，逐字）：
 * > 「预设把弹刀填在 12 次，这里**在计算难度曲线的时候不该用预设**啊，该由**计算器自动计算**。
 * >  **预设只是难度曲线的其中一个点而已**」
 * > 「我认为首先算低难度下，就是**全 0 交互**的。」
 *
 * ## 为什么是「全 0」而不是「预设值」
 *
 * 0 交互 = **难度的天然下限**（完全不操作）。旧 ① 走预设/职业基准（非支援/防护 = 弹刀6 + 闪反10，
 * 锋御 5 队实测 41 次）⇒ 曲线起点**不在难度轴的原点**，用户看到的「起点已经很难、终点反而简单」
 * 有一半来自这里。
 *
 * ## ⚠ 理由订正（2026-10-12 二次修订，前一版说法已作废）
 *
 * 前一版说「起点已在**交互负收益区**」——**那是错的**（错因：探针三槽同时加交互，把「主C 赚」
 * 与「辅助亏」混成了「先升后降」）。逐槽隔离实测（`T141perSlot.perf.ts`）显示收益**按槽位职业分**：
 * 主C 全程正、辅助负、击破靠失衡加速可能很赚。⇒ 全 0 的理由是**难度下限**，不是「起点在负区」。
 *
 * ## 清零范围 = 全部交互类型（单一事实源 = `ACTION_COUNT_BOUNDS` 的交互键）
 *
 * 包含弹刀/闪反/格挡/双反/嘲讽取消/葬血打断/强特完美格挡/强袭训令/仪玄三件套（墨痕化形、
 * 完美格挡、极限支援、墨影凝云）与普罗米娅匿影——凡「用户操作换资源/伤害」的旋钮都归零。
 * **不碰** `chainCountPerStun` / `basicAttackTimeWeight`：前者是连携配置、后者是平A 分配，
 * 都不是「交互次数」（用户口径 4 的语境是「弹刀填 12 次」这类操作量）。
 *
 * ⚠ 2026-10-26：名单里的**快速支援（`quickAssistCount`）已删**——手动快支整体下线后它不是「可填的
 * 操作量」而是不存在的字段，不再有「① 清不清零」的问题（②③④ 也从未加回过它）。
 */
export const INTERACTION_COUNT_KEYS = [
  'parryCount', 'dodgeCounterCount', 'blockCount', 'perfectBlockCount', 'assaultOrderCount',
  'dualCounterCount', 'tauntCancelCount', 'claretBurialInterruptCount',
  'yixuanInk2Count', 'yixuanInk3Count', 'yixuanPerfectBlockCount',
  'promiaNiyingCount',
] as const

/**
 * 把三槽的全部交互次数清零（①「全 0 交互」的唯一实现）。
 *
 * `yixuanExtremeAssistCount` **不在名单里**：它的哨兵口径是 `-1 = 自动`（取队友弹刀和上限），
 * 写 0 会从「自动」变成「一次都不换场」——那是**另一种**语义，不是「清零交互」。
 * ① 保持它的自动档即可（队友弹刀已被清 0 ⇒ 自动值自然落到 0，无需显式写）。
 */
export function clearInteractions(ctx: LadderCtx): void {
  for (let slot = 0; slot < 3; slot++) {
    for (const key of INTERACTION_COUNT_KEYS) {
      // 只在字段存在时写：`setActionCount` 对未声明字段的行为由 store 决定，缺省字段（如
      // 般岳专属的 tauntCancelCount）本就不该被本模块初始化成 0 而改变语义。
      const cur = (ctx.config.team[slot] as unknown as Record<string, number | undefined> | undefined)?.[key]
      if (cur === undefined) continue
      ctx.config.setActionCount(slot, key, 0)
    }
  }
}

/**
 * **把各槽交互恢复到「角色声明的基准」**（`getInteractionDefaults`，单一事实源）——
 * ②③④ 的搜索起点，① 不用它（① 恒为全 0，见 `clearInteractions`）。
 *
 * ## 为什么必须有这一步（2026-10-15 实测修的缺陷，用户口径「达到资源要求然后计算」）
 *
 * ① 把 **14 个交互字段全清零**，而 `optimizeInteractionsPerSlot` 只爬
 * **`parryCount` / `dodgeCounterCount`** 两个字段 ⇒ 其余 12 个字段**从 0 出发、永远不会被加回来**。
 * 这对般岳是致命的：它的轴要靠**金身格挡（`blockCount`）+ 双反（`dualCounterCount`）**产嗔火
 * （模块 `interactionDefaults: { parry:6, dodge:10, block:12, dual:3 }`）⇒ 轴永远喂不饱。
 *
 * 实测（`.zc/perf/T170climb.perf.ts`，生产路径 ②③④ 现场）：
 * | 队 | 全 0 起爬（修前） | 恢复角色基准后 |
 * |---|---|---|
 * | `banyue-trigger-lucia` | `partial(4)` 49.91M | **`complete` 54.26M（+4.35M）** |
 * | `banyue-liuyin-lucia` | `partial(2)` 85.31M | `partial(1)` 83.80M |
 * ⇒ 修前不是「轴捏得不对」，而是**阶梯搜的维度不够**：它把角色声明会打的交互全清零后，
 * 只肯加回弹刀/闪反两种，般岳的金身/双反再也回不来。
 *
 * ## 为什么是「角色基准」而不是「预设声明的交互」
 *
 * 用户 T141 口径「**预设只是难度曲线的其中一个点而已**」排除了预设声明值；而
 * `interactionDefaults` 是**角色模块自己声明的固有行为**（与预设无关，`setAgent` 换人时也按它预填，
 * 见 `stores/config.ts` 的 `interactionBaselineFor`）⇒ 拿它当搜索起点，既不自相矛盾，
 * 又让曲线的 ②③④ 与「用户选完队拿到的现场」一致。
 *
 * 无声明角色恒为全 0 ⇒ **本函数对它们是 no-op**（纯追加语义，不改变既有 93 队的读数）。
 *
 * @fact engine:难度曲线/交互搜索起点 口径: ②③④ 的交互搜索从**角色声明的基准**（`getInteractionDefaults`）出发，**不是**从全 0 出发——① 清空 14 个交互字段、而 `optimizeInteractionsPerSlot` 只爬 `parryCount`/`dodgeCounterCount`，其余 12 个字段（含般岳的金身 `blockCount`/双反 `dualCounterCount`）从 0 出发**永不加回** ⇒ 轴恒喂不饱；① 本身仍恒为全 0（T141 难度原点，不受本函数影响） | 据 用户@2026-10-15「我要的是你达到资源要求然后计算」+ 实测 .zc/perf/T170climb.perf.ts | 验 src/composables/__tests__/difficultyLadder.test.ts::★ ②③④ 从「角色声明的交互基准」出发 | 锚 src/composables/difficultyLadder.ts#applyRoleInteractionBaseline | 信 确认
 * ⟳复核: 若 `INTERACTION_COUNT_KEYS` 增删字段、或 `optimizeInteractionsPerSlot` 的爬升字段集扩大（届时基准可能变得多余），重核「搜索起点」是否仍应是角色基准 | 到期 2027-04-30
 */
export function applyRoleInteractionBaseline(ctx: LadderCtx): void {
  for (let slot = 0; slot < 3; slot++) {
    const agentId = ctx.config.team[slot]?.agentId
    if (!agentId) continue
    const d = getInteractionDefaults(agentId)
    // 逐字段**只在声明非零时写**：写 0 会把「该字段缺省」与「声明为 0」混为一谈
    // （后者是真实语义，如支援/防护职业基准全 0）。
    if (d.parry > 0) ctx.config.setActionCount(slot, 'parryCount', d.parry)
    if (d.dodge > 0) ctx.config.setActionCount(slot, 'dodgeCounterCount', d.dodge)
    if (d.block > 0) ctx.config.setActionCount(slot, 'blockCount', d.block)
    if (d.dual > 0) ctx.config.setActionCount(slot, 'dualCounterCount', d.dual)
  }
}

interface LadderMutSnap {
  w: number[]
  /**
   * **全部交互次数的整表快照**（T141：① 会清零 14 个交互字段，不只是弹刀）。
   *
   * ⚠ 旧实现只存 `parryCount`（那时 ① 不动交互、只有 joint 会改弹刀）。① 改「全 0 交互」后
   * 若仍只还原弹刀 ⇒ **闪反/快支/格挡/嘲讽取消等 13 个字段的 0 会漏回调用方现场**
   * （本函数契约是「只探测、不改现场」，见函数尾 `restore`）。故整表存/整表还原。
   * 键 = `INTERACTION_COUNT_KEYS`（单一事实源）；`undefined` 字段不存不写（缺省语义见 `clearInteractions`）。
   */
  inter: Array<Record<string, number | undefined>>
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
    inter: [0, 1, 2].map(s => {
      const row = ctx.config.team[s] as unknown as Record<string, number | undefined> | undefined
      const out: Record<string, number | undefined> = {}
      for (const key of INTERACTION_COUNT_KEYS) out[key] = row?.[key]
      return out
    }),
    align: ctx.config.getComboAlignState(),
    absorb: ctx.config.getMechanicSetting(COMBO_ALIGN_ABSORB_RATIO_SETTING, DEFAULT_COMBO_ALIGN_ABSORB_RATIO),
    axis: ctx.config.getAxisState(),
  }
}
function restore(ctx: LadderCtx, snap: LadderMutSnap) {
  for (let s = 0; s < 3; s++) {
    ctx.config.setActionCount(s, 'basicAttackTimeWeight', snap.w[s])
    const row = snap.inter[s]!
    for (const key of INTERACTION_COUNT_KEYS) {
      const v = row[key]
      if (v !== undefined) ctx.config.setActionCount(s, key, v)
    }
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
  /**
   * 这一点的**难度构成明细**（仅当 `opts.costDetailOf` 给了才在）：
   * 「哪几项交互 × 多少次 × 什么权重 + 时间压力秒」。
   *
   * 为什么要有它（用户 2026-11-03）：「**他的默认操作模式算什么难度**？总不能没有自动调整吧，
   * 比如你把交互全硬编码为 0 还不能改」——此前曲线点只有 `x` 总数，**看不出交互是引擎自己搜出来的
   * 还是写死的**。逐类型明细 + 权重把这件事变成可读的读数（悬停 tooltip 显示）。
   * 单一来源 = `teamCompare#computeDifficulty` 的 `detail`（与散点页横轴同一函数）。
   * ⚠ ①（最低）的交互恒为 0 是**用户 2026-10-15 裁的难度原点**（「低难度下就是全 0 交互的」），
   * ②③④ 则是引擎搜出来的（`joint` / `slotLadder` 旋钮，见 `applyInteractionKnob`）。
   */
  costDetail?: string
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
   * **连续失衡进度**（2026-10-23）：本档离下一次完整失衡还差多少（`missingBuildUp` 点失衡值）。
   * 展示层据此标注「再加点配置或交互就能达到完整失衡，进入下一阶段」。**不改任何数值。**
   * 缺省（没采）= 不标注。
   */
  stunProgress?: ContinuousStunProgress
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
  /**
   * 这一点的**现场差分**（仅当 `opts.sceneOf` 给了才在）——「这一点是在什么配置下算出来的」。
   *
   * 展示层拿它**按需重算**该档的完整资源池（`restoreStateDelta` + 新建独立场景 + 求值），
   * 而不是随点携带 41.5KB 的整份引擎结果（实测：整份结果 41.5KB/点 vs 差分 2.1KB/点）。
   * 契约与判据见 `configDelta.ts` 与 `configDelta.test.ts`（★ 往返逐字节相同）。
   */
  scene?: LadderPointScene
  /**
   * 这一点的**非轴参照**（仅当 `opts.noAxisOf` 给了才在，用户口径 2026-10-16）：
   * 同一现场关掉轴时的伤害与操作难度。
   *
   * 用户逐字：「我本意是想展示**非轴模式**的数据的，表示**模拟均匀战斗**而不是**集中利用失衡易伤**」
   * ⇒ 与轴点成对，图上直接读出「集中利用」比「均匀摊」多赚多少。
   */
  noAxis?: { dmg: number; cost: number }
}

/**
 * 一档的**现场差分**（相对本次运行基线）——`LadderPointScene` = `types/configDelta.ts#PointScene`
 * 的**兼容别名**（T189：散点 / 选第三人的点也带同一份现场，类型单一来源下沉到 types/）。
 *
 * `base` = 运行起点的整份 `$state` 值快照（每次 `computeDifficultyCurves` 一份，所有道共用），
 * `delta` = 该档与基线的差分。重放 = `restoreStateDelta(config, base, delta)`
 * ⇒ 现场与落点那刻**逐字节相同**（判据 `difficultyCurve.test.ts::★ 重放每点现场`）。
 */
export type LadderPointScene = PointScene

/**
 * 一点的快照：展示层要什么就采什么（`opts.capture` 的返回）。
 *
 * ⚠️ 全部字段必须在**同一时刻**读同一份 `calc.resourceResult.value`（`counts` / `dmgBySource` /
 * `overflow` / 两个交互量都是）——分两次采会与点位错配。
 */
export interface LadderSnapshot {
  counts: Record<string, number>
  dmgBySource: Record<string, number>
  /**
   * **本档的加权失衡易伤**（Σ行伤害×行覆盖率 / Σ行伤害，0..1）——残疾轴放行判据的左边。
   *
   * 用户口径 2026-10-18：「这个**残疾轴的综合易伤超过非轴的默认均匀易伤**后，就可以认为残疾轴
   * 也是有轴易伤上的贡献，可以不隐藏。」判据消费方 = `difficultyAxis#partialAxisContributes`。
   *
   * ⚠ **必须由 `capture` 在本档求值时采**（与 `counts` / `dmgBySource` 同一刻）：
   * `land` 里现读 `calc.damagePoolRows.value` 会与阶梯的其它读取构成**级联重算**（实测把
   * `difficultyLadder.test` 卡死 10min+）。缺省（旧调用方没采）= 不判残疾轴（保持旧口径）。
   */
  weightedStunCoverage?: number
  /** 本点时间线截断秒数（引擎 `overflowSeconds`） */
  overflow?: number
  /**
   * **连续失衡进度**（2026-10-23，用户口径）：本档离下一次完整失衡还差多少。
   *
   * 用途 = 展示层标注「**再加点配置或交互就能达到完整失衡，进入下一阶段**」——
   * 它**不改任何数值**（引擎里「没攒满 = 没开启 = 没有易伤」是用户 2026-10-21 的裁决），
   * 只回答「还差多远」。口算源 = `core/continuousStun.ts#continuousStunProgress`。
   * 缺省（没采）= 不标注。
   */
  stunProgress?: ContinuousStunProgress
  /** 本点手填（声明）交互总次数（缩前） */
  interactionsFilled?: number
  /** 本点实打交互总次数（缩后） */
  interactionsPlayed?: number
}

/**
 * ④（最高点）的两条**入口**（T182，2026-11-02）。
 *
 * - `'baseline'`：从 ① 的现场重来（T141 口径，结构性保证 ④ ≥ ①）；
 * - `'progress'`：从 ③ 的落点现场再爬一次（T182 新增，修「④ < ③」——见 ④ 段注释的实测表）。
 *
 * 两条入口都是「吸收拉满 + 交互取最优」的同一个旋钮组合，只差**搜索起点**（坐标上升起点决定落点）。
 */
export type MaxEntry = 'baseline' | 'progress'

export interface LadderResult {
  base: number
  final: number
  /** 关键点序列（1~4 点；`baseline` 与 `max` 恒存在，见卡 §4） */
  points: LadderPoint[]
  /**
   * ④ **实际胜出的入口**（T182）。展示层复现 ④ 现场时**必须按它选入口**
   * （`difficultyCurve.ts` 的曲线外补充点 / 极限点），否则摆出的是另一条入口的现场
   * ⇒「同 x」这个前提不成立。缺省（④ 未落点）= undefined。
   */
  maxEntry?: MaxEntry
  /**
   * ④ 各入口臂的**实测伤害**（按伤害降序 = 落点尝试次序；缺省 = ④ 未落点）。
   *
   * 留痕而不是只留胜者：判据要能断言「④ = 各臂取高」（T182 主判据），
   * 诊断也要能回答「这个天花板是哪条入口爬出来的、另一条差多少」。
   */
  maxArms?: Array<{ entry: MaxEntry; dmg: number }>
  /**
   * ③「台阶」**只在吸收拉满时才出现 ⇒ 已并入 ④**（T183，用户「可以把 23 合并」）。
   * 缺省 = 没有这回事（③ 缺失的原因是「区间内完整失衡台阶不存在」，不是合并）。
   */
  progressMergedIntoMax?: boolean
  /** ② 点是否缺失（本队轴在任何难度下都不成立）——UI 据此在 ③ 位置如实标注 */
  axisPointMissing: boolean
  /**
   * ④ 点相对 ① 的伤害增量（「难度上升 ⇒ 总伤上升」的机器判据，卡 §6.5）。
   * **实测可为负**（如 G4 类口径漂移混入时）；本结构如实上报，不隐藏。
   */
  gain: number
  /**
   * **被截断的档位**（轴模式要求未满足 ⇒ 不出数，用户口径 2026-10-15）。
   *
   * 与 `points` 互补：`points` 是**算得出的**点，这里是**被砍掉的**点（含它为什么被砍）。
   *
   * 为什么要留痕而不是静默丢弃：用户要的是「低难度**不该算**」，不是「低难度**看不见**」——
   * 曲线起点被砍掉时，UI 必须说清「这条曲线从哪个难度起才成立」，否则用户会以为轴坏了。
   *
   * ⚠ 命名与 `difficultyCurve#CurveSeries.truncated` **不是一回事**：那个指「交互被时间线砍」，
   * 本字段指「轴没打完 ⇒ 整档不成立」。两者可能同时出现，别混用。
   */
  axisTruncated: AxisTruncatedPoint[]
}

/**
 * 被截断的档位（轴要求未满足 ⇒ 不出数）。
 *
 * ⚠ `dmg` **有意保留**：它是「这一档本来会打出多少」的如实读数，供 UI 说明
 * 「轴没打完时能打 N，但那个数不算轴模式的结果」。**它不得进入 `points`**
 * （那正是本卡要禁的：把未达标的档当成曲线上的点）。
 */
export interface AxisTruncatedPoint {
  point: KnobPointName
  /**
   * 这一档的**操作难度**（= 与曲线点同一个 `costOf` 量的；缺失 = 调用方没给 `costOf`）。
   *
   * 用户口径 2026-10-16：「**低难度的计算点要说明其是自动轴（非轴），高难度的计算点就是完整轴模式，
   * 要能让人看出来难度提升、轴、和伤害提升的大致关系**」⇒ 被砍的档要能在图上被**画出来**
   * （画在曲线**下方**作对照，不进曲线），没有 `x` 就落不了图。
   */
  x?: number
  /** 这一档本来会打出的伤害（如实读数，仅用于解释，不作为结果） */
  dmg: number
  /** 这一档的轴态（`partial` = 跳过 N 招 / `infeasible` = 轴崩了） */
  axis: AxisState
  /** 被砍的原因（可读，UI 直接用） */
  reason: string
  /**
   * 这一档的**现场差分**（仅当 `opts.sceneOf` 给了才在）。
   *
   * ⚠ 被砍的档**也有完整现场**：它算得出伤害（`dmg` 就是这么来的），只是轴要求没满足而不进曲线。
   * 用户 2026-10-16「我本来想看看有没有 4 失衡，伤害为什么低」问的往往正是这些档 ⇒ 明细面板
   * 必须能给它们看资源池（页面按 `axisTruncated` 如实标注「轴没打完」）。
   */
  scene?: LadderPointScene
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
  /** **难度构成明细**（缺省不采）：与 `costOf` **同刻同现场**量，见 `LadderPoint.costDetail` */
  costDetailOf?: (ctx: LadderCtx) => string
  /**
   * ② 的扫描步数（吸收率网格；缺省 20 = 5% 网格，见 `scanAbsorbGrid`）。
   * 单测可调小以控成本。
   */
  axisScanSteps?: number
  /**
   * **每档采一次现场差分**（缺省不采 = 零开销）——落点与被砍的档都采（见 `LadderPointScene`）。
   *
   * 成本：一次 `JSON.stringify` 全表比对（实测 ~0.2ms/档，相对 50–120ms 的一次全队求值可忽略）。
   * 与 `capture` 的分工：`capture` 采**读数**（次数/伤害来源），本项采**输入**（配置现场）。
   */
  sceneOf?: (ctx: LadderCtx) => LadderPointScene
  /**
   * **每点采一次「非轴参照」**（缺省不采 = 零开销）：在同一现场关轴重算，返回该点的非轴伤害与难度。
   * 见 `LadderPoint.noAxis`。成本 = 每点一次完整求值（点 1~4 ⇒ 每队多 1~4 次）。
   */
  noAxisOf?: (ctx: LadderCtx) => { dmg: number; cost: number }
}

/**
 * ③「台阶」判据的**唯一可数量 = 完整失衡窗口数**（T183，用户 2026-11-02）。
 *
 * 用户逐字：「第三个重大进步感觉太模糊了…比如**完整 3 失衡到完整 4 失衡**…如果**整个交互只让失衡
 * 变了 1 次**，那也相当于第三个找不到。」
 *
 * ## 为什么必须换掉旧判据（实测病根：把「秒」当「次」）
 *
 * 旧判据 = 「`counts` 里**任一项** Δ≥1」——而 `counts` 里**混着「合轴节省」（单位是秒）**。
 * 实测 `auto-1461-1521-1491`（页面口径）：② → ③ 那一步的全部变化只有
 * **「合轴节省 +1.32s」**（次数一个没动），台阶因此照落 ⇒ 用户看到的就是「模糊的第三点」。
 * 同一队的真台阶（完整失衡 2→3）其实出现在 ④。
 *
 * ## 读数口径
 *
 * 优先读连续失衡的**完整窗数**（`continuousStunProgress.completeWindows`，与页面「已完整 N 次」
 * 同一读数）；调用方没采它时回落队伍级「失衡」次数（`stunCount`）。
 * ⚠ 两个读数都缺（调用方没给 `capture`）⇒ **判不出台阶** ⇒ ③ 如实不出（不再"默认算成立"）。
 *
 * @fact engine:难度曲线/③台阶 口径: ③ 的台阶判据 = **完整失衡窗口数 +1**（优先 `continuousStunProgress.completeWindows`，缺则回落队伍级「失衡」次数）；**秒量（「合轴节省」）不参与台阶判定**——旧判据把它当次数，实测 `auto-1461-1521-1491` 的 ③ 就是被「合轴节省 +1.32s」单独触发的；台阶若只在吸收拉满时出现 ⇒ 并入 ④（`progressMergedIntoMax`）；读数缺（调用方没给 capture）⇒ 如实不落点 | 据 用户@2026-11-02（「第三个重大进步太模糊了…比如完整 3 失衡到完整 4 失衡…如果整个交互只让失衡变了 1 次，那也相当于第三个找不到」） | 验 src/composables/__tests__/difficultyLadder.test.ts::★ 回归：② 缺失时 ③ 必须把**交互步**算作候选 | 锚 src/composables/difficultyLadder.ts#stunWindowsOf | 信 确认
 * ⟳复核: 台阶量改口径（改用别的可数量 / 同时要求多个台阶 / 残缺窗也算）时重核「①②③④ 点名序列 + 合并规则」并复测全库 avgPoints | 到期 2027-06-30
 */
const STUN_WINDOW_LABEL = '失衡'
function stunWindowsOf(
  snap: { counts?: Record<string, number>; stunProgress?: ContinuousStunProgress } | undefined,
): number | undefined {
  if (!snap) return undefined
  const cw = snap.stunProgress?.completeWindows
  return cw === undefined ? snap.counts?.[STUN_WINDOW_LABEL] : cw
}

/**
 * ③ 的**台阶候选/基准点**（T183 就地起名）：点位状态 + 它的关键次数读数 + 完整失衡窗口读数。
 * 两个字段都要带上：次数读数在「没采到连续失衡进度」时是台阶判据的回落源（见 `stunWindowsOf`）。
 */
interface StepCandidate {
  st: PointState
  counts?: Record<string, number>
  windows?: number
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
 * - **保底不再是一点**：`guarantee.fury` 由引擎按轴需求自行补齐（见文件头）。
 */
export function climbDifficultyLadder(
  ctx: LadderCtx,
  team: [string, string, string],
  opts: LadderOpts = {},
): LadderResult {
  const minGainRatio = opts.minGainRatio ?? 1e-4
  const cap = absorbCapOf(ctx)
  /**
   * ⚠ **`base` 不再是 `opts.base` 的返回值**（T141 起）：`opts.base` 只负责套预设/配装/金步现场，
   * ① 还要在其上把交互清零（`applyInteractionKnob(ctx,'zero')`，见下方 ① 段）。
   * ⇒ 这里只**建立现场**，`base` 取 ① 落点后的伤害，保证 `r.base === points[0].dmg`（`difficultyLadder.test`
   * 与 `summarizeLadder` 都按这条恒等式读）。
   */
  if (opts.base) opts.base(ctx, team)
  else resetDifficultyGoals(ctx, team)
  const capture = opts.capture
  const costOf = opts.costOf
  /** 采一点快照（同一点的全部字段读同一份 `resourceResult`，见 `LadderSnapshot` 注释） */
  const snap = (): Pick<LadderPoint, 'counts' | 'dmgBySource' | 'overflow' | 'interactionsFilled' | 'interactionsPlayed'> & { weightedStunCoverage?: number; stunProgress?: ContinuousStunProgress } => {
    const s = capture?.(ctx)
    return s
      ? {
          counts: s.counts, dmgBySource: s.dmgBySource,
          overflow: s.overflow, interactionsFilled: s.interactionsFilled, interactionsPlayed: s.interactionsPlayed,
          ...(s.weightedStunCoverage !== undefined ? { weightedStunCoverage: s.weightedStunCoverage } : {}),
          ...(s.stunProgress !== undefined ? { stunProgress: s.stunProgress } : {}),
        }
      : {}
  }
  /**
   * **被截断的档位**（轴要求未满足 ⇒ 不出数，用户口径 2026-10-15）。
   * `land` 命中就 push ⇒ 必须先于 `land` 声明（`const` 的 TDZ 不会等到调用时才报）。
   */
  const axisTruncated: AxisTruncatedPoint[] = []
  /**
   * 把当前现场落成一个点（伤害已算好）。
   * `x` 与 `difficulty` 同源同值（绝对值口径），**只量一次** `costOf`（它是纯读，但仍别重复调用）。
   *
   * ⚠ **返回 null = 这一档不出数**（轴模式要求未满足，用户口径 2026-10-15）。
   * 调用方必须把 null 当成「这一点不存在」——**不是**「伤害为 0 的点」。
   * 判据本身在 `difficultyAxis#axisRequirementMet`（唯一事实源），本函数只执行它。
   */
  const land = (name: KnobPointName, st: PointState): LadderPoint | null => {
    /**
     * ⚠ **快照只采一次**（`snap()` 内部调 `capture`，后者含一次全队求值级联）：
     * 旧写法在「残疾轴放行」分支再调一次 `snap()` 判覆盖率 ⇒ 每档多一次求值，
     * 实测把 `difficultyLadder.test` 从 ~60s 拖到 6min+（CPU 满载）。
     */
    const snapshot = snap()
    if (!axisRequirementMet(st.axis)) {
      /**
       * **残疾轴放行**（用户口径 2026-10-18）：`partial`（跳过 N 招）不再一律不出数——
       * 只要**这一档的整体易伤确实高于非轴均匀摊**，就说明轴真的贡献了集中易伤，应当展示。
       * 用户原话：「只有少数招式打不了的可以展示……**这个残疾轴的综合易伤超过非轴的默认均匀易伤后**，
       * 就可以认为残疾轴也是有轴易伤上的贡献，可以不隐藏。」
       * 判据唯一事实源 = `difficultyAxis#partialAxisContributes`。
       * `infeasible`（弃轴）天然不过（轴没执行 ⇒ 加权易伤退回非轴口径 ⇒ 差值 ≈ 0）。
       */
      // 覆盖率取**本档快照**（`capture` 与 `counts`/`dmgBySource` 同刻采），不在这里现读伤害池
      // ——现读会与阶梯的其它读取构成级联重算（实测卡死 10min+），见 `LadderSnapshot.weightedStunCoverage`。
      const weighted = snapshot.weightedStunCoverage
      const passes = st.axis.kind === 'partial' && weighted !== undefined
        && partialAxisContributes(weighted, ctx.calc.stunCoverage.value)
      if (!passes) {
        /**
         * 被砍的档也带**现场**（用户问的「有没有 4 失衡」往往正是这些档）与 **x**（用户 2026-10-16
         * 要求图上能看出「难度 ↔ 轴 ↔ 伤害」的关系 ⇒ 它们要能被画在曲线下方作对照）。
         * ⚠ `x` 与曲线点同一个 `costOf`（量一次）——两把尺会让对照错位。
         */
        axisTruncated.push({
          point: name, dmg: st.dmg, axis: st.axis, reason: axisTruncationReason(st.axis),
          ...(costOf ? { x: costOf(ctx) } : {}),
          ...sceneSnap(),
        })
        return null
      }
    }
    const x = costOf ? costOf(ctx) : 0
    /** 构成明细与 `x` 同刻量（同一现场、同一次读数）⇒ 两者不可能描述不同的档 */
    const costDetail = opts.costDetailOf?.(ctx)
    /**
     * 非轴参照（用户 2026-10-16）——**必须在伤害已算好、现场仍是该点**时采；
     * `noAxisOf` 内部自带轴状态保存/恢复，采完现场不变（继续落点）。
     */
    const noAxis = opts.noAxisOf?.(ctx)
    return {
      x,
      dmg: st.dmg,
      point: name,
      knobs: st.knobs,
      axis: st.axis,
      ...snapshot,
      ...sceneSnap(),
      ...(noAxis ? { noAxis } : {}),
      ...(costOf ? { difficulty: x } : {}),
      ...(costDetail ? { costDetail } : {}),
    }
  }

  // ===== ① baseline（最低）=====
  /**
   * **T141 改口径**：① 不再是「预设/职业基准交互 + 全关」，而是「**全 0 交互** + 全关」。
   *
   * 用户口径 4+5（逐字）：「预设把弹刀填在 12 次，这里**在计算难度曲线的时候不该用预设**啊，
   * 该由**计算器自动计算**。**预设只是难度曲线的其中一个点而已**」/「首先算低难度下，就是**全 0 交互**的」。
   *
   * ⚠ **`opts.base` 仍先跑**（它负责套预设/配装/金步等**非交互**现场），清零在它**之后**——
   * 顺序反了会被 `applyTeamToStore` 的 `applyPresetInteractions` 写回预设值。
   * ⚠ 交互值进 `interactionsFilled` / `interactionsPlayed` 快照（`land` 内 `snap()`）⇒ 判据可直接读
   * 「① 的交互类项 == 0」（卡 §6.5）。
   */
  /**
   * ⚠ **`before` 必须在 ① 清零之前采**（T141）：本函数的契约是「只探测、不改现场」，
   * 而 ① 会把 14 个交互字段清零。快照采晚了 ⇒ `restore` 还原的是「已清零」的现场，
   * 调用方的预设交互被永久抹掉（`difficultyLadder.test` ⑥ 实测抓到这个缺陷：
   * 跑完阶梯后 `parryCount` 停在 `[0,0,0]` 而跑前是 `[6,6,0]`）。
   */
  const before = snapshot(ctx)
  /**
   * 现场差分通道（`opts.sceneOf`）：只读地采当前现场，**不改任何东西**。
   * 采在 ① 之前/之后都不影响数值，但必须与 `land` 同一刻的现场一致——两者都在「伤害已算好」时调用。
   */
  const sceneSnap = (): { scene?: LadderPointScene } => {
    const s = opts.sceneOf?.(ctx)
    return s ? { scene: s } : {}
  }
  applyInteractionKnob(ctx, 'zero')
  const baseState = readState(ctx, { interactions: 'zero', absorb: 0 })
  /** ① 的关键次数快照（③ 的跃迁基准；与 `land` 内的 `snap()` 同源同刻） */
  const baseSnap = capture?.(ctx)
  const baseCounts = baseSnap?.counts
  const baseWindows = stunWindowsOf(baseSnap)
  const basePt = land('baseline', baseState)
  const points: LadderPoint[] = basePt ? [basePt] : []
  /**
   * ① 的伤害 = 曲线的难度原点（`acceptAt` 的基准也跟着它，见上方注释）。
   *
   * ⚠ **① 被截断时仍取它**：截断只决定「这一点算不算结果」，不改变「难度门槛按什么量级算」——
   * 门槛是全关伤害的一个比例，与这一点是否达标无关。若改取 `points[0].dmg`，① 被砍时门槛会
   * 跟着塌向 0 ⇒ ③ 的跃迁判据整体失真（那是比截断更隐蔽的错误）。
   */
  const base = baseState.dmg
  const acceptAt = Math.max(0, base * minGainRatio)

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
  let axisPointMissing = false
  /** ③ 的台阶只在吸收拉满时出现 ⇒ 已并入 ④（T183；UI 可据此说明「③ 并入 ④」） */
  let progressMergedIntoMax = false
  let axisPoint: LadderPoint | null = null
  /**
   * ③ 的**扫描基准点**（② 存在时 = ②；② 缺失时 = 「① 之后路径上的下一点」）。
   *
   * 为什么需要它（卡 §4 的既定口径）：
   * > **非轴队（`none`）**：不产出 ② 点，**曲线只有 ①③④**；轴态列显示 `—`。
   * 若 ③ 硬依赖 ②，非轴队就只剩 ①④ 两点 ⇒ 违反卡 §4。故 ③ 的基准取「路径上 ② 本该在的位置」：
   * 交互已取最优（joint）、吸收仍为 0。对非轴队这就是**① 到 ④ 之间的唯一天然中间态**。
   */
  let progressBase: StepCandidate | null = null
  /** ③ 的扫描起点吸收率（= 基准点的吸收率） */
  let progressFrom = 0
  /**
   * ③ 的**前置候选**：当 ② 缺失时，「① → (joint, 0)」这一步本身就是 ③ 的天然候选
   * （交互从 `default` 变 `joint` 是一次真实的离散重分配）。
   *
   * ⚠ 为什么必须单列（2026-10-12 实测修，缺陷）：② 的第一步会**无条件**施加 joint，
   * 而 ② 缺失时旧实现把 ③ 的基准点设成「joint + 吸收 0」⇒ **joint 那一步的跃迁被基准点预先吃掉**，
   * ③ 只剩吸收率可动 ⇒ 永远找不到跃迁 ⇒ 非轴队塌成 2 点。
   * 实测（`.zc/perf/T140cGap.perf.ts`，38 支 2 点队抽 12 支）：
   * **S1 交互步带跃迁 11 队 / S2 吸收步带跃迁 0 队**，而其中 34 队在 ①→④ 之间确实有跃迁
   * （`.zc/perf/T140cWhy2.perf.ts`）⇒ 这些队的 ③ 本该存在。
   */
  /** ③ 的「台阶」读数随候选带上（T183：台阶 = 完整失衡窗口数 +1，见 `stunWindowsOf`） */
  let preJoint: StepCandidate | null = null
  {
    /**
     * **②③④ 的搜索起点 = 角色声明的交互基准**（`applyRoleInteractionBaseline`，2026-10-15 新增）。
     *
     * ⚠ 必须在这里、且在 `joint` **之前**：① 刚把 14 个字段清零，若直接 `joint`，般岳的
     * 金身/双反（轴产嗔火的来源）就再也加不回来了（`optimizeInteractionsPerSlot` 只爬弹刀/闪反）
     * ⇒ 轴恒不成立。实测 `banyue-trigger-lucia`：修前 `partial(4)` 49.91M、
     * 恢复基准后 `complete` 54.26M。
     * ⚠ **只影响 ②③④，不影响 ①**：① 仍是「全 0 交互」的难度原点（T141 用户口径）。
     */
    applyRoleInteractionBaseline(ctx)
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
    const jointSnap = capture?.(ctx)
    preJoint = { st: jointOnly, counts: jointSnap?.counts, windows: stunWindowsOf(jointSnap) }
    /**
     * ★ 轴修扫（2026-10-25）：13b9f584「交互默认全 0」之后，② 的轴常要靠角色特色交互才能立起来
     * （般岳：金身 blockCount 产嗔火 → 怒相 → 山威）。逐槽阶梯是坐标上升、只认伤害/跳过数的单调改善，
     * 过不了「加 6 次才少跳 2、加到 20 次才补满」的山谷（实测 0/6/12/20 次：跳 4/2/2/0，伤害 56.4/60.2/57.1/57.3M）。
     * 用户口径「我要的是你达到资源要求然后计算」⇒ ② 允许一次有界枚举：按模块声明的 interactionFieldTypes
     * （blockCount / dualCounterCount）试候选值，命中即用最小可行值。
     * ⚠ 只扫声明过的字段（哨兵字段不会被误写）；只在轴不成立时触发（成立时零额外求值）。
     */
    let jointNow = jointOnly
    if (!axisStands(jointNow.axis)) {
      const candidates = [4, 8, 12, 16, 20, 24]
      const declaredFields: Array<{ slot: number; field: ActionCountField }> = []
      for (let slot = 0; slot < 3; slot++) {
        const agentId = ctx.config.team[slot]?.agentId
        if (!agentId) continue
        const decl = getAgentMechanic(agentId)?.interactionFieldTypes ?? {}
        if (decl.blockCount) declaredFields.push({ slot, field: 'blockCount' })
        if (decl.dualCounterCount) declaredFields.push({ slot, field: 'dualCounterCount' })
      }
      for (const { slot, field } of declaredFields) {
        let hit = false
        for (const v of candidates) {
          ctx.config.setActionCount(slot, field, v)
          const st = readState(ctx, { interactions: 'joint', absorb: 0 })
          if (axisStands(st.axis)) { jointNow = st; hit = true; break }
        }
        if (hit) break
        ctx.config.setActionCount(slot, field, 0)
      }
    }
    /** 命中即用修扫后的现场继续走 ② / 吸收网格（未命中则 jointNow === jointOnly，逐位同旧） */
    if (jointNow !== jointOnly) {
      const jointFixSnap = capture?.(ctx)
      preJoint = { st: jointNow, counts: jointFixSnap?.counts, windows: stunWindowsOf(jointFixSnap) }
    }
    if (axisStands(jointNow.axis)) {
      // 交互最优后轴**本就成立** ⇒ ② = (joint, 0)。
      // 用户 §4：合轴「拉满」与「轴成立」冲突时**优先让轴成立** ⇒ 这里不为好看去抬吸收率（0 已经够）。
      axisPoint = land('axis', jointNow)
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
      progressBase = {
        st: { dmg: axisPoint.dmg, knobs: axisPoint.knobs, axis: axisPoint.axis },
        counts: axisPoint.counts,
        // ② 的落点自带 `stunProgress`（`captureLadderSnapshot` 采）⇒ 直接构造读数源，不额外求值
        windows: stunWindowsOf({ counts: axisPoint.counts, stunProgress: axisPoint.stunProgress }),
      }
    } else {
      /**
       * ② 缺失（非轴队 / 轴在任何难度下都不成立）⇒ ③ 以 **① 的交互状态**为基准，
       * 让「交互 → joint」这一步本身成为 ③ 的第一个候选（见 `preJoint` 注释的实测归因）。
       * 故这里**先把现场还原回 ①**（joint 已被上面的 `applyInteractionKnob` 写进现场）。
       *
       * ⚠ **T141 起 ① 的交互 = 全 0**（不是 `before` 的预设值）⇒ 还原目标是「① 的落点」而不是
       * 「进入本函数前的现场」。旧写法 `restore(ctx, before)` 会把预设交互写回来，于是 ③ 的
       * 基准点变成「预设交互 + 吸收 0」——与 ①（全 0）不一致，`progressBase` 的伤害也不再等于
       * `points[0].dmg`，③ 的跃迁判据（`st.dmg − progressBase.dmg ≥ acceptAt`）整体偏移。
       */
      applyInteractionKnob(ctx, 'zero')
      /**
       * ⚠ **不能用 `points[0].counts`**：① 可能被截断（轴要求未满足）⇒ `points` 为空 ⇒ 崩。
       * ① 的关键次数快照在截断与否下都存在（`snap()` 是纯读），故单独采一次。
       */
      progressBase = {
        st: readState(ctx, { interactions: 'zero', absorb: 0 }),
        counts: baseCounts,
        windows: baseWindows,
      }
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
   * ⚠ 成本纪律：② 存在时现场已是 ② 的配置 ⇒ 循环里**只改吸收率**；② 缺失时先试**交互步**
   *   （`preJoint`，那是非轴队唯一真实的离散跃迁来源），再扫吸收率。
   */
  /**
   * ③ 落点的**现场快照**（T182）：④ 的第二条入口要从这里出发（见 ④ 段）。
   * 必须在**落点那一刻**采——`scanAbsorbGrid` 的 `finally` 会把吸收率还原到扫描前，
   * 事后采到的就不是 ③ 的现场了。
   */
  let progressSnap: LadderMutSnap | null = null
  if (progressBase) {
    /**
     * **「台阶」判据（T183）= 完整失衡窗口数 +1**（用户 2026-11-02 口径，见 `stunWindowsOf` 头注释）。
     *
     * 与旧判据（`counts` 里任一项 Δ≥1）的分水岭：旧判据把**秒**当**次** —— 实测
     * `auto-1461-1521-1491` 的 ③ 就是被「合轴节省 +1.32s」**单独**触发的（次数一个没动），
     * 这正是用户说的「第三个重大进步太模糊」。
     * ⚠ 读数缺（调用方没给 `capture`）⇒ 判不出台阶 ⇒ **如实不落点**（旧行为是「默认算成立」）。
     */
    const stunStepUp = (windows: number | undefined): boolean =>
      progressBase.windows !== undefined && windows !== undefined
      && windows - progressBase.windows >= 1 - 1e-6
    // ② 缺失 ⇒ 先试「交互步」（`preJoint`）：它是非轴队 ①→④ 之间唯一带跃迁的候选
    let landed = false
    if (!axisPoint && preJoint) {
      const st = preJoint.st
      if (st.dmg - progressBase.st.dmg >= acceptAt && stunStepUp(preJoint.windows)) {
        // 现场切到 joint（`applyInteractionKnob` 幂等：joint 写下的值再跑一次结果相同）
        applyInteractionKnob(ctx, 'joint')
        const pt = land('progress', st)
        if (pt) { points.push(pt); landed = true; progressSnap = snapshot(ctx) }
      }
    }
    // 未落点 ⇒ 扫吸收率（② 存在时从 ② 的落点起；② 缺失且交互步未落点则从 0 起）
    if (!landed) {
      const from = progressFrom
      scanAbsorbGrid(ctx, cap, from, r => {
        const st = readState(ctx, { interactions: 'joint', absorb: r })
        if (st.dmg - progressBase.st.dmg < acceptAt) return false
        const s = capture?.(ctx)
        if (!stunStepUp(stunWindowsOf(s))) return false
        const pt = land('progress', st) // 命中即落点
        if (!pt) return false // 轴要求未满足 ⇒ 这一点不出数（继续往后扫，别停）
        /**
         * **台阶只在「吸收拉满」时才出现 ⇒ 与 ④ 重合 ⇒ 合并**（T183，用户「可以把 23 合并」）：
         * 这一档的旋钮组合已经等于 ④（吸收 = cap），再出一个 ③ 只是同一点的重复读数。
         * 如实留痕在 `progressMergedIntoMax`，UI 可据此说明「③ 已并入 ④」。
         */
        if (r >= cap - 1e-9) { progressMergedIntoMax = true; return true }
        points.push(pt)
        progressSnap = snapshot(ctx) // ③ 落点现场（含它自己的吸收率）——④ 的第二条入口用
        return true
      }, scanSteps)
    }
  }

  // ===== ④ max（最高）=====
  /**
   * 纯收益拉满（吸收 = cap）+ 非纯收益取最优（joint）。**恒存在**（卡 §4）：它是
   * 「难度上升 ⇒ 总伤上升」的落点，也是曲线的天花板。即使 ②③ 都缺失（非轴队 / 轴不成立），
   * 本点仍然存在 ⇒ 曲线至少有 ①②④ 里的 ①④ 两点。
   *
   * ## ⚠ 为什么 ④ 必须**从 ① 的现场重来**（T141 实测修的缺陷，别省这一次搜索）
   *
   * ②③ 用的 joint 解是在 **`absorb = 0`**（或 ② 的落点）上求的，而 ④ 把吸收拉到了 `cap`
   * ⇒ **优化目标变了，旧解不再是 cap 下的最优**。实测（`.zc/perf/T141order.perf.ts`，
   * `yixuan-trigger-lucia`）：
   *
   * | 路径 | 交互 | 伤害 |
   * |---|---|---|
   * | ① 全 0 交互 @ r=0 | 弹刀 0/0/0 | 60.569M |
   * | `joint@r0` → 抬到 cap（**旧 ④**） | 弹刀 **2/0/2** | **53.209M** ← 比 ① 还低 7.36M |
   * | `joint@cap`（**新 ④**，从 ① 现场重来） | 弹刀 0/0/0 | **61.973M** |
   *
   * 根因：`joint` 在 `r=0` 时加的那 2 次弹刀，在 `r=cap` 下**这份前台时间有更好的用途**
   * （吸收已把队友前台腾出来，弹刀挤占的是主C 的平A）⇒ 旧解在 cap 上成了**负收益**，
   * 于是 ④ < ①，破卡 §6.6「④.dmg ≥ ①.dmg」。
   *
   * ## ⚠ 更隐蔽的一层：**平A 权重**的残留（`clearInteractions` 不清权重）
   *
   * 只「清交互」还不够——`joint` 的搜索**起点包含平A 权重**，而 ② 会把权重搜成别的值。
   * 实测（`.zc/perf/T141entry.perf.ts`，`auto-1091-1511-1311`）：
   *
   * | ④ 的进入现场 | 权重 | 伤害 |
   * |---|---|---|
   * | 预设权重（① 的现场） | 1/1/0 | **71.331M** |
   * | ② 的残留 | **2/0/0** | **56.095M** ← ④ < ①（59.538M） |
   *
   * ⇒ ②③ 的残留会让 ④ 落进一个**更差的局部最优**（`joint` 是坐标上升，起点决定落点）。
   * 修法 = ④ **先还原到 ① 的现场**（`restore(ctx, before)` 把权重/交互/合轴率全还原），
   * 再清交互、拉满吸收、重跑搜索 ⇒ ④ 成为**与 ②③ 路径无关的确定点**
   * （这正是「④ 是曲线的天花板」应有的性质：天花板不该取决于中间点怎么走）。
   *
   * ## ⚠ 第三层：`joint` 自己的局部最优（故 ④ 用 `'slotLadder'` 而非 `'joint'`）
   *
   * 即便从 ① 现场重来，`joint-levers` 的**单槽 ±2 坐标上升**仍会卡住。实测
   * （`.zc/perf/T141d1371.perf.ts`，`auto-1371-1481-1451` @ `r=cap`）：
   *
   * | 交互档 | 伤害 |
   * |---|---|
   * | 全 0（`zero`） | 52.672M |
   * | `joint` 从全 0 出发（只加槽0 弹刀 2） | **58.872M** ← ④ < ①（59.626M） |
   * | **三槽各 3 次弹刀** | **70.487M** ← 真正的天花板 |
   *
   * 根因：该队的失衡台阶需要**三槽同时**够到阈值，而单槽 +2 时伤害不涨 ⇒ 坐标上升当场停住。
   * ⇒ ④ 改用 `'slotLadder'`（`optimizeInteractionsPerSlot`：逐槽逐类型步长 1 的阶梯，
   * 见卡 §4「交互自动求最优 = **按槽位分别求**」）。它每步都过「伤害严格增 + 不新增截断」门
   * ⇒ 单调不减，**不会**低于 ①（这就是 ④ ≥ ① 的结构性保证，不是碰巧）。
   *
   * 成本：`joint`（~15-20 求值）+ 逐槽阶梯（≤ 3 槽 × 2 类型 × 16 步 = 96 求值，实际早停）。
   * 它买的是 ④ 的正确性与**路径无关性**——天花板值这个价。
   * ⚠ 但「只从 ① 重来」**不是**天花板问题的完整解（会丢掉 ③ 的更好盆地）⇒ T182 起为**两条入口取高**，
   *   见下方 T182 段。
   */
  /**
   * ## ⚠ T182（2026-11-02）：只从 ① 重来 ⇒ ④ 会**低于 ③**（用户实报「难度曲线不单调」）
   *
   * 用户口径（逐字）：「**最高难度被看的最多，他要算准确**。理论上合轴率拉满得出最多富余时间，
   * 交互较多得出更多收益，一个队伍应当这时候最强了。」
   *
   * 实测（页面同源口径 `PROBE_DIFF_TEAMS=auto-1461-1031-1521`，期数 3.3 · 熔狱行赭 hp 19698 万）：
   *
   * | 配置 | 伤害 | 蛇影层数 |
   * |---|---|---|
   * | ③ progress（joint @ 吸收 0.02） | 68.53M | 22 |
   * | ④ 旧口径（**只**从 ① 重来，slotLadder @ 0.4） | **66.39M** ← 比 ③ 低 2.14M、x 却 +17.3 点 | 17 |
   * | ④ 新口径（③ 现场重来，本段） | **72.44M** | 23 |
   * | 参照：③ 现场 + **只**抬吸收到 cap | 72.24M ↑ | 24 |
   * | 参照：③ 现场 + **只** slotLadder（吸收不动） | 68.85M ↑ | 22 |
   *
   * ⇒ **两只旋钮单独/一起上都是涨的**，掉档不是旋钮语义问题，而是**搜索起点**问题：
   * `joint`/`slotLadder` 都是坐标上升（起点决定落点，见上方 T141 第 2/3 层）⇒
   * 从 ① 出发爬到的是**另一个更差的局部解**（蛇影 17，而 ③ 的盆地能到 23），
   * 于是「难度 +17.3 点、总伤 −2.14M」，用户看到的就是「不单调」。
   * 旧修法（T141 只从 ① 重来）是为修「④ < ①」立的、本身没错；**错在把它当成唯一入口**。
   * 判据只钉了 ④ ≥ ①（全库 97 队 0 违例），没有钉 ④ ≥ ③ ⇒ 这个洞此前无机器看守。
   *
   * **现口径 = 两条入口各爬一次、取伤害高者**：
   * - 臂 A（`'baseline'`，T141）：保 ④ ≥ ① 的**结构性**保证；
   * - 臂 B（`'progress'`）：保 ④ ≥ ③ 的**实测**（③ 缺失时无此臂）。
   *
   * 成本：多一次 `slotLadder`（≤96 次全队求值，实际早停），且**只在 ③ 存在时付**。
   *
   * ⚠ **否决「用穷举换准确」（用户 2026-11-02）**：用户逐字「这里我们肯定要考虑**计算成本和计算可信度**
   * **综合效果**，**优化算法达成帕累托最优是长久目标**，你想用穷举肯定给未来的计算成本埋下风险」
   * ⇒ 方向 = **在成本预算内把搜索做得更聪明**（候选：`interactionSurface` 已有的帕累托梯度线 /
   * 上界包络那套），**不是**再加臂、再加网格。上面这条两臂取高是「同一旋钮组合的两次起点」——
   * 成本已知（+1 次 slotLadder），不是穷举。
   *
   * @fact engine:难度曲线/④口径 口径: ④ = **两条入口取高** —— 臂 A 从 ① 现场重来、臂 B 从 ③ 落点重来，两条都是「吸收拉满 + 逐槽交互最优（slotLadder）」的同一旋钮组合，只差搜索原点（坐标上升起点决定落点）⇒ 单臂会丢 ③ 的更好盆地（实测 auto-1461-1031-1521：③ 68.53M → 单臂 ④ 66.39M < ③；双臂 ④ 73.33M）；胜出入口 = `LadderResult.maxEntry`、各臂伤害 = `maxArms`，展示层复现 ④ 现场必须按入口选 | 据 用户@2026-11-02（「最高难度被看的最多，他要算准确…一个队伍应当这时候最强了」） | 验 src/composables/__tests__/difficultyLadder.test.ts::★ T182 | 锚 src/composables/difficultyLadder.ts#climbDifficultyLadder | 信 确认
   * ⟳复核: ④ 的旋钮组合再变（新增第三臂 / 换 `slotLadder` 的接受门 / 出现第五个点名点）时，重核「两条入口取高」是否仍覆盖全部盆地，且 `maxArms` 的两臂仍是全部候选 | 到期 2027-06-30
   */
  interface MaxArm { entry: MaxEntry; dmg: number; snap: LadderMutSnap }
  const maxArms: MaxArm[] = []
  /** 收一臂：调用方已把现场摆好，这里只读伤害 + 采现场快照（胜出后要还原到它才能落点） */
  const collectMaxArm = (entry: MaxEntry) => {
    maxArms.push({ entry, dmg: ctx.calc.teamTotalDamage.value, snap: snapshot(ctx) })
  }
  // 臂 A：① 现场重来（T141 口径 ⇒ ④ ≥ ① 的结构性保证）
  restore(ctx, before) // ← 回到进入本函数前的现场（= ① 的权重/合轴率底子）
  ctx.config.setMechanicSetting(COMBO_ALIGN_ABSORB_RATIO_SETTING, cap)
  applyInteractionKnob(ctx, 'zero')
  /**
   * ⚠ 与 ② 同源：④ 也从「全 0 + 角色声明的交互基准」出发（不是从 0 出发）。
   * 少了这一句，④ 会重新落回「般岳金身/双反 = 0」的喂不饱现场 ⇒ 天花板整档不成立
   * （而 ② 却成立）——那正是修前 `banyue-trigger-lucia` 的形态。
   */
  applyRoleInteractionBaseline(ctx)
  applyInteractionKnob(ctx, 'slotLadder')
  collectMaxArm('baseline')
  // 臂 B：③ 落点现场重来（T182）。③ 的交互解是在**它自己的吸收率**上求的 ⇒
  // 抬到 cap 后优化目标变了，必须**重跑一次逐槽阶梯**（同 T141 第 2 层那条性质）。
  if (progressSnap) {
    restore(ctx, progressSnap)
    ctx.config.setMechanicSetting(COMBO_ALIGN_ABSORB_RATIO_SETTING, cap)
    applyInteractionKnob(ctx, 'slotLadder')
    collectMaxArm('progress')
  }
  /**
   * 取伤害高者。⚠ **逐臂试落点**（而不是「先选伤害最高的臂、再落一次」）：某一臂可能过不了
   * 轴要求（`land` 返回 null）⇒ 不能因为它伤害高就把 ④ 整点丢掉（「④ 恒存在」优先）。
   */
  let maxEntry: MaxEntry | undefined
  for (const arm of [...maxArms].sort((a, b) => b.dmg - a.dmg)) {
    restore(ctx, arm.snap)
    const pt = land('max', readState(ctx, { interactions: 'slotLadder', absorb: cap }))
    if (!pt) continue
    maxEntry = arm.entry
    points.push(pt)
    break
  }

  // 现场恢复：本函数只负责**探测**，调用方（`computeDifficultyCurves` 的调用方）按契约还原
  restore(ctx, before)

  /**
   * `final` = **最后一个算得出的点**的伤害；一个点都算不出（轴要求在任何难度下都不满足）
   * ⇒ 退化为 `base`（全关读数）。⚠ **不得**回退成 `points[0]`（可能为空 ⇒ 崩）。
   */
  const final = points[points.length - 1]?.dmg ?? base
  return {
    base, final, points, axisPointMissing, gain: final - base, axisTruncated,
    ...(maxEntry ? { maxEntry } : {}),
    ...(maxArms.length > 0
      ? { maxArms: [...maxArms].sort((a, b) => b.dmg - a.dmg).map(a => ({ entry: a.entry, dmg: a.dmg })) }
      : {}),
    ...(progressMergedIntoMax ? { progressMergedIntoMax: true } : {}),
  }
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
