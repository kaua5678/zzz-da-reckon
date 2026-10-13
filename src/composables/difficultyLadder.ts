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
  applyTimeWeightAllocation({ calc: ctx.calc, configStore: ctx.config }, 'joint-levers')
  if (knob === 'slotLadder') optimizeInteractionsPerSlot(ctx)
}

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
  // 逐槽、逐类型坐标上升（弹刀 + 闪反 = 卡 §2.3 表里唯二被逐槽量过的两类）
  for (const key of ['parryCount', 'dodgeCounterCount'] as const) {
    for (let slot = 0; slot < 3; slot++) {
      let best = ctx.calc.teamTotalDamage.value
      let prevTrunc = truncated()
      let prevExec = executedCount()
      let prevRows = poolRows()
      for (let n = 0; n < maxCount; n++) {
        const cur = Number((ctx.config.team[slot] as unknown as Record<string, number | undefined>)?.[key] ?? 0)
        const next = cur + 1
        ctx.config.setActionCount(slot, key, next)
        const dmg = ctx.calc.teamTotalDamage.value
        const trunc = truncated()
        const exec = executedCount()
        const rows = poolRows()
        /**
         * 接受门（三条，全过才走）：
         *  ① **伤害严格增**（非纯收益杠杆的基本要求）；
         *  ② **不新增截断**（相对上一步、且不劣于本阶梯起点）；
         *  ③ **执行数不下降**（卡 §2.3b：`executed` 与伤害池行数都不得降）。
         * ③ 是 T141 新加的：只看 ① 会把「加辅助交互 ⇒ 总伤微涨但主C 动作被挤掉」判成正收益
         * （实测槽2 弹刀=2：伤害 57.615M vs 起点 58.053M 其实已跌，但更隐蔽的形态是
         * `executed` 39→32 而伤害因别处补回而微涨）。
         */
        const ok = dmg > best + 1e-6
          && trunc <= prevTrunc + 1e-6 && trunc <= baselineTrunc + 1e-6
          && exec >= prevExec - 1e-6 && rows >= prevRows
        if (ok) {
          best = dmg
          prevTrunc = trunc
          prevExec = exec
          prevRows = rows
        } else {
          ctx.config.setActionCount(slot, key, cur) // 回滚：不涨 / 越界 / 挤掉动作
          break
        }
      }
    }
  }
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
 * 包含弹刀/闪反/格挡/双反/快支/嘲讽取消/葬血打断/强特完美格挡/强袭训令/仪玄三件套（墨痕化形、
 * 完美格挡、极限支援、墨影凝云）与普罗米娅匿影——凡「用户操作换资源/伤害」的旋钮都归零。
 * **不碰** `chainCountPerStun` / `basicAttackTimeWeight`：前者是连携配置、后者是平A 分配，
 * 都不是「交互次数」（用户口径 4 的语境是「弹刀填 12 次」这类操作量）。
 *
 * ⚠ **快支也清零**（用户口径 3「快支完全不算交互」只针对**难度权重**）——① 是「全 0 交互」的
 * 难度下限，快支虽然不吃难度权重，但它仍是「用户主动按出来的操作」⇒ 一并归零才自洽；
 * 快支在 ②③④ 由自动分配重新引入（吃 buff 的价值在那里体现）。
 */
export const INTERACTION_COUNT_KEYS = [
  'parryCount', 'dodgeCounterCount', 'blockCount', 'perfectBlockCount', 'assaultOrderCount',
  'dualCounterCount', 'tauntCancelCount', 'claretBurialInterruptCount',
  'yixuanInk2Count', 'yixuanInk3Count', 'yixuanPerfectBlockCount', 'yixuanBackstageComboCount',
  'promiaNiyingCount', 'quickAssistCount',
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
  applyInteractionKnob(ctx, 'zero')
  const points: LadderPoint[] = [land('baseline', readState(ctx, { interactions: 'zero', absorb: 0 }))]
  /** ① 的伤害 = 曲线的难度原点（`acceptAt` 的基准也跟着它，见上方注释） */
  const base = points[0]!.dmg
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
  let preJoint: { st: PointState; counts?: Record<string, number> } | null = null
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
    preJoint = { st: jointOnly, counts: jointCounts }
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
      const base0 = points[0]!
      progressBase = { st: readState(ctx, { interactions: 'zero', absorb: 0 }), counts: base0.counts }
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
  if (progressBase) {
    const baseCounts = progressBase.counts
    /** 「跃迁」判据：基准点 → 候选点之间出现 ≥1 次离散动作增量（口径见 difficultyCurve#diffKeyCounts） */
    const jumpedFrom = (from: Record<string, number> | undefined, to: Record<string, number> | undefined): boolean => {
      if (from === undefined || to === undefined) return true
      for (const [k, v] of Object.entries(to)) {
        const prev = from[k]
        if (prev !== undefined && v - prev >= 1 - 1e-6) return true
      }
      return false
    }
    // ② 缺失 ⇒ 先试「交互步」（`preJoint`）：它是非轴队 ①→④ 之间唯一带跃迁的候选
    let landed = false
    if (!axisPoint && preJoint) {
      const st = preJoint.st
      if (st.dmg - progressBase.st.dmg >= acceptAt && jumpedFrom(baseCounts, preJoint.counts)) {
        // 现场切到 joint（`applyInteractionKnob` 幂等：joint 写下的值再跑一次结果相同）
        applyInteractionKnob(ctx, 'joint')
        points.push(land('progress', st))
        landed = true
      }
    }
    // 未落点 ⇒ 扫吸收率（② 存在时从 ② 的落点起；② 缺失且交互步未落点则从 0 起）
    if (!landed) {
      const from = progressFrom
      scanAbsorbGrid(ctx, cap, from, r => {
        const st = readState(ctx, { interactions: 'joint', absorb: r })
        if (st.dmg - progressBase.st.dmg < acceptAt) return false
        const s = capture?.(ctx)
        if (!jumpedFrom(baseCounts, s?.counts)) return false
        points.push(land('progress', st)) // 命中即落点
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
   */
  restore(ctx, before) // ← 回到进入本函数前的现场（= ① 的权重/合轴率底子）
  ctx.config.setMechanicSetting(COMBO_ALIGN_ABSORB_RATIO_SETTING, cap)
  applyInteractionKnob(ctx, 'zero')
  applyInteractionKnob(ctx, 'slotLadder')
  points.push(land('max', readState(ctx, { interactions: 'slotLadder', absorb: cap })))

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
