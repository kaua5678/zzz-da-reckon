/**
 * 音擎**触发型（condition 门控）效果**的整局覆盖率折算（单一事实源）。
 *
 * 背景：`core/wengineConditions.ts#wEngineConditionMet` 对除 `attributeCounter` 以外的 condition
 * 一律放行（散文条件不可机判）⇒ `fixed` 型效果默认按 **100% 生效**。实测代价（2026-11-06）：
 * 菲欧妮队里「轰鸣座驾」三选一被当成三条同时满覆盖（虚高 7.8pp），「双生泣星」4 层从不掉落
 * （虚高约 3pp）。用户裁决 2026-11-06：「接，真实才对」。
 *
 * 口径（沿用 `wEngineStackCoverage` 的时间加权思路，两者互补：那边管 `stacked`，这里管 `fixed`+condition）：
 * - **触发门控型**：覆盖率 = min(1, 触发次数 × 效果持续秒 / 战斗时长) × 单次触发占比。
 *   例 13128 轰鸣座驾：「[强化特殊技]命中时**随机触发三种效果中的一种**，持续 5 秒」⇒
 *   总覆盖 = 强化特殊技命中数 × 5 / 180，每种效果再乘 1/3。
 * - **失衡清空型**：层数在「目标从失衡状态恢复」时清零 ⇒ 按**分段积分**算平均层数（用户
 *   2026-11-06 给的算法：失衡 3 次 × 18s，余下 126s 均分 3.5 段非失衡，每段 36s；层数按
 *   异常施加次数均分到时间线性增长，最后半段 18s）。覆盖率 = 平均层数 / defaultStacks。
 * - **敌方异常型**：全队属性异常施加次数 > 0 ⇒ 100%，否则 0（二值）。
 *
 * 未登记的效果一律返回 null = 回退既有行为（100% / defaultStacks），不猜。
 *
 * @fact wengine:conditionCoverage/折算口径 口径: 三类登记——①触发门控型=min(1,有效触发时长/作用期)×单次触发占比;**分母按作用域分流**:`scope:'self'`(缺省,只影响装备者自己输出)=**战场时间** `timeAllocation.frontlineTime`(不是整场 180 秒——没上场时不吃这个 buff),`scope:'team'`(全队受益)=整场时长;有效触发时长按源分流:**能量预算(energyPerRefresh,优先)**=可用能量/单次刷新耗能×(持续秒+refreshActionSeconds),普通源=**施放次数**×持续秒(不是执行行求和),sustainedSources 无能量时=占用秒数+持续秒×施放次数;②失衡清空型=分段积分平均层数/defaultStacks(层数跨上下场保留⇒用整场);③敌方异常型=全队异常施加>0?100:0.⚠ 触发源 kind 名≠执行行 category 值;**无条件的效果绝不许登记**;**缺攻击段数数据的效果不许登记**(13106);13128 = 每 20 能量一次刷新 × (下砸 2s + 尾巴 5s);14118 派派事件数=每次施放 2 个(持续段 1 + 下砸 1) | 据 用户@2026-11-06「接，真实才对」+用户@2026-11-07「180/5*20=720…他才450」「不是5秒而是7秒，下砸耗时2秒尾端还有5s」「持续只算1段」「不该用180s算，而是用自己战场时间算」 | 验 src/data/__tests__/wEngineConditionCoverage.test.ts | 锚 src/data/wEngineConditionCoverage.ts#conditionCoverageOf | 信 高
 * ⟳复核: 新登记一件时核六件事——condition 归属、触发源「或」全列、有无段数数据、发动/命中、是否走能量预算、**scope 是 self 还是 team**(决定分母) | 到期 2027-05-07
 */

/** 归一化的执行行（只取折算需要的字段，避免 data 层依赖资源类型） */
export interface CoverageExecutionRow {
  category: string
  moveName: string
  count: number
  /** 该行总占用时间（秒）：持续型触发源按它算（`sustainedSources`） */
  totalTime?: number
}

/** 折算输入（调用方已收敛的资源结果 + 敌人参数） */
export interface ConditionCoverageInput {
  effectId: string
  battleSeconds: number
  /** 该槽各类触发源的实打次数（执行行口径；缺省项按 0 处理） */
  triggerCountValues: Partial<Record<TriggerSourceKind, number>>
  /**
   * 该槽各类触发源的**占用秒数**（只对登记了 `sustainedSources` 的效果生效）。
   * 触发时长的上界 = 次数 × 持续秒 与 占用秒数 取小 —— 持续动作里命中不断、效果被反复刷新，
   * 但效果本身最长只能盖满整段动作。
   */
  triggerOccupiedSeconds?: Partial<Record<TriggerSourceKind, number>>
  /**
   * 该槽**整局可用能量**（`energySource.total`）：按能量预算折算覆盖率的效果用它。
   * 用于「一次刷新要花 N 点能量、持续 T 秒」这类——满覆盖所需的能量 = 战斗时长 / T × N。
   */
  availableEnergy?: number
  /**
   * 该槽**战场时间**（`timeAllocation.frontlineTime`，秒）。
   * 自身向效果的覆盖率分母用它，不是整场 180 秒 ——
   * 用户 2026-11-07：「这种招式打了吃 buff 似乎不该用 180s 算，而是用自己战场时间算。
   * 角色通常会在有 buff 的时候多打，没 buff 的时候换别人打」。
   * 队伍向效果（如 13113 全队攻击）仍用整场时长（它的受益期是全队输出期）。
   */
  frontlineSeconds?: number
  /** 全队属性异常触发总次数（每次施加 = 1 层；触电唇彩与双生泣星**共用这个计数器**） */
  anomalyApplications: number
  /** 失衡次数（StunPoolResult.stunCount 的真值，不是 plannedStunCount） */
  stunCount: number
  /** 单次失衡窗口时长（秒） */
  stunWindowSeconds: number
  maxStacks: number
  /** catalog 的 `defaultStacks`（覆盖率的分母 —— 与 resolveEffectValue 的乘区一致） */
  defaultStacks: number
}

/**
 * 触发源：从执行行里数「哪类动作打了几次」。
 *
 * ⚠ **kind 名 ≠ category 值**，映射表在下面（`TRIGGER_SOURCE_CATEGORIES`），**不要图省事写 `row.category === kind`**：
 * 实测踩过两次——① `dodgeCounter`（那是 `normalizeResourceSkillType` 的**输出**枚举值）vs 执行行上的 `dodge`；
 * ② `chainOrUltimate` 是个复合概念，执行行上只有 `chain`，用 `=== kind` 恒不命中 ⇒ 连携/终结类永远算 0。
 *
 * - `exSpecial`：强化特殊技（category=`special` 且招式名以「强化特殊技」开头——同 category 还含普通特殊技）。
 *   原文按「**命中**」判的（`exSpecialHit`）与按「**发动**」判的在这套口径里视为同一件事：
 *   一次强特施放 = 一次命中（多段命中仍在同一次发动窗口内，效果只刷新不叠加计数）。
 * - `chain`：连携技 + 终结技（引擎里两者同属 category=`chain`，不细分；原文「连携技或终结技」正好是这一类）
 * - `dodge`：闪避反击
 */
export type TriggerSourceKind = 'exSpecial' | 'chain' | 'dodge'

/** kind → 执行行 category 的映射（单一事实源；`exSpecial` 额外按招式名前缀细分） */
const TRIGGER_SOURCE_CATEGORIES: Readonly<Record<Exclude<TriggerSourceKind, 'exSpecial'>, string>> = {
  chain: 'chain',
  dodge: 'dodge',
}

/** 各触发源的实打次数（执行行口径；未收敛/该角色没有这类行 ⇒ 0） */
export function countTriggerSource(rows: readonly CoverageExecutionRow[], kind: TriggerSourceKind): number {
  let n = 0
  for (const row of rows) {
    const count = Math.max(0, row.count)
    if (!(count > 0)) continue
    if (kind === 'exSpecial') {
      if (row.category === 'special' && String(row.moveName).startsWith('强化特殊技')) n += count
    } else if (row.category === TRIGGER_SOURCE_CATEGORIES[kind]) {
      n += count
    }
  }
  return n
}

/**
 * 触发门控型登记：effect.id → 持续秒 + 单次触发占比 + 触发源。
 *
 * 只登记「**任何角色都能自然打到**」的触发源（强特 / 连携终结 / 闪避反击）——用户 2026-11-07：
 * 「强特接口是通用的，含羞恶面这些也能顺手做吧…我们主要看下位这种很多人可能选的」。
 * ⚠ 不登记「角色专属行为」类（`hpReduced` 海妖摇篮 = 章鱼专武的掉血循环、`offField` 后台、
 * `追加攻击` 等）：那些件要么是专武、要么根本不会被当别人的下位，硬折算只会引入假精度。
 */
export const TRIGGER_GATED_EFFECTS: Readonly<Record<string, {
  durationSeconds: number
  sharePerTrigger: number
  /**
   * 触发源**集合**：原文写「A 或 B 时」的（如 13111「发动[强化特殊技]**或**[连携技]」）必须全列，
   * 只取其中一个会把覆盖率无端砍掉一半；集合内**并集**计数（同一行的次数不重复算）。
   */
  sources: readonly TriggerSourceKind[]
  /**
   * 触发源里**属于持续动作**的那几个：按**占用秒数**计有效触发时长（"持续期一直刷新"），
   * 其余源仍按「次数 × 持续秒」。缺省 = 全部按次数。
   *
   * 为什么需要：原文按「**命中时**」判、且带 ICD 的效果（13128「0.3 秒内最多触发一次」），
   * 在 3 秒长的持续强特里会被反复刷新 —— 一次施放 ≠ 一次触发。
   */
  sustainedSources?: readonly TriggerSourceKind[]
  /**
   * **一次刷新消耗的能量**（点）：给了就改用**能量预算**口径（优先于占用秒数）——
   * 覆盖率 = min(1, 能量 / 单次消耗 × 持续秒 / 战斗时长)。
   * 用于「持续耗能型强特」：施放本身按 20/秒 持续扣、末段下砸再扣 20 ⇒ 每 20 点能量就是一次刷新机会。
   */
  energyPerRefresh?: number
  /**
   * **刷新动作本身的耗时**（秒），与 `durationSeconds` 相加才是「一次刷新覆盖多久」。
   * 用户 2026-11-07：「实际上并不是 5 秒，而是 7 秒，他一个下砸耗时 2 秒，尾端还有 5s」
   * ⇒ 下砸 2 秒期间一直在打（判定持续在刷新）+ 结束后挂 5 秒 = 7 秒。
   */
  refreshActionSeconds?: number
  /**
   * 作用域：`self`（缺省）= 只影响装备者自己的输出 ⇒ 分母用**战场时间**；
   * `team` = 全队受益 ⇒ 分母用整场战斗时长。
   */
  scope?: 'self' | 'team'
}>> = {
  // ── 13128 轰鸣座驾（A级·异常·派派的专武）──
  // 原文：「[强化特殊技]**命中敌人时**，随机触发以下三种效果中的一种，持续5秒，**0.3秒内最多触发一次**，
  //        同类效果不可叠加，重复触发时刷新持续时间，**多个效果可以同时存在**」
  //
  // ⚠ **不做 ÷3**（早期版本按「一次施放只随机出一种」乘了 1/3，是错的）：强特是**持续多段命中**——
  // 派派的引擎转单次 3.0 秒、非常重 2.13 秒，可琳小心裙角 #2 段 2.79 秒。按 0.3s 的 ICD，
  // 一次 3 秒的施放能触发约 10 次抽取，几次施放下来三种效果**必然同时在线**（原文也明写「可以同时存在」）。
  // ÷3 只在「一次施放只打中一下」的离散强特上成立，而那类角色本来就不是这件武器的目标人群。
  //
  // 无法更精确的原因：catalog 每个强特只有**一条伤害行**，没有攻击段数 ⇒ 抽不到「一次施放打了几下」。
  // 但这里不需要段数：ICD 已经给出触发频率上界（≤1 次/0.3s），持续强特期间的抽取次数远大于 3。
  effect_wiki_494_self_atk: { durationSeconds: 5, sharePerTrigger: 1, sources: ['exSpecial'], sustainedSources: ['exSpecial'], energyPerRefresh: 20, refreshActionSeconds: 2 },
  effect_wiki_494_self_ap: { durationSeconds: 5, sharePerTrigger: 1, sources: ['exSpecial'], sustainedSources: ['exSpecial'], energyPerRefresh: 20, refreshActionSeconds: 2 },
  effect_wiki_494_self_anomaly_build_up_efficiency: { durationSeconds: 5, sharePerTrigger: 1, sources: ['exSpecial'], sustainedSources: ['exSpecial'], energyPerRefresh: 20, refreshActionSeconds: 2 },
  // ── 13113 含羞恶面（A级·支援）：「发动[强化特殊技]时全队攻击+2%×4层，持续 12 秒」──
  // 全队攻击力 ⇒ 受益期是全队输出期，分母用整场时长
  effect_wiki_215_team_atk: { durationSeconds: 12, sharePerTrigger: 1, sources: ['exSpecial'], scope: 'team' },
  // ── 13019 青漪灵鼎（A级·命破）：「发动[强化特殊技]获得 1 层，最多 3 层，持续 20 秒」──
  effect_wiki_1774_self_dmg: { durationSeconds: 20, sharePerTrigger: 1, sources: ['exSpecial'] },
  // 同件：3 层时暴击率 +6.5%（原文「拥有 3 层增益效果时」⇒ 与层数同一覆盖窗口）
  effect_wiki_1774_self_crit_rate: { durationSeconds: 20, sharePerTrigger: 1, sources: ['exSpecial'] },
  // ── 14147 怒目金刚（限定S·命破，常被其他命破借穿）：只登记**火贯穿**那半条 ──
  // 原文「暴击率提升20%…；装备者启动[强化特殊技]时，火属性贯穿伤害提升9%×2层，持续20秒」
  // ⇒ `effect_wiki_1721_self_crit_rate` 是**无条件**的（condition 挂在整组上只为表达后半条），
  //   登记它会把无条件暴击率一起折掉。与 14118 的 self_atk 同一类错误，一处都不许漏。
  effect_wiki_1721_self_fire_sheer: { durationSeconds: 20, sharePerTrigger: 1, sources: ['exSpecial'] },
  // ── 14118 嵌合编译器：**不登记**（两个理由，都是「登记了反而错」）──
  // ① `effect_wiki_214_self_ap`（精通+25×3层）已由 `wEngineStackCoverage` 按「能量扣除事件 × 8s / 战斗时长」
  //    折算 stacked 层数，这里再登记就是重复折算；
  // ② `effect_wiki_214_self_atk`（攻击力+12%）原文是**无条件**的——catalog 的 condition 挂在整组 selfBuff 上
  //    （`specialOrExSpecial`）只为表达「精通那半条要触发」，主效果并不需要发动强特。按触发源折算它 =
  //    把无条件加成折掉（实测会把嵌合编译器的主词条白砍 12% 攻击力）。
  // ── 13106 家政员（A级·强攻）：**不登记**（默认 100%）──
  // 原文「[强化特殊技]命中时，物理伤害+3%×15层，持续 1 秒」。它确实是**持续出伤**（可琳强特 #2 段单次 2.79 秒），
  // 但「15 层要几次命中才叠满」取决于**攻击段数**，而 catalog 现在没有段数数据 ⇒ 折算不出可信值。
  // 早期版本按「占用秒数 / 战斗时长」硬算得 16%，被用户 2026-11-07 否决：
  //   「可琳自己带专武就给全 buff 就行，我们去计算 16% 其实不太准，目前还没有攻击段数的数据，
  //    没办法帮用户算。只能默认全 100% 了」⇒ 未登记 = 回退满覆盖，等段数数据录入后再接。
  // ── 13111 旋钻机-赤轴（A级·强攻）：「发动[强化特殊技]或[连携技]时，持续 10 秒，15 秒内最多触发一次」──
  effect_wiki_265_self_basic_dash_electric_dmg: { durationSeconds: 10, sharePerTrigger: 1, sources: ['exSpecial', 'chain'] },
  // ── 13014 电波漫步（A级·命破）：「发动[连携技]或[终结技]获得 1 层，最多 3 层，持续 12 秒」──
  effect_wiki_1340_self_sheer_force: { durationSeconds: 12, sharePerTrigger: 1, sources: ['chain'] },
  // ── 13004 星徽引擎（A级·强攻）：「发动[闪避反击]或[快速支援]时攻击+12%，持续 12 秒」──
  // ⚠ 只数闪避反击；「快速支援」那半条**不数**（用户 2026-11-07：「快支不用数，反正用户能调覆盖率，
  //   他有需求调满就行」）——手调滑块优先于自动折算（`mergeWEngineEffectCoverageAuto`），需要时自己拖。
  effect_wiki_156_self_atk: { durationSeconds: 12, sharePerTrigger: 1, sources: ['dodge'] },
}

/**
 * 敌方异常状态型登记：effect.id → 无附加参数（判据就是「场上有没有处于属性异常的敌人」）。
 *
 * 覆盖率 = 全队属性异常施加总次数 > 0 ? 100% : 0%。
 *
 * 用户口径 2026-11-07：「触电的异常次数和双生重合了吧，这不是通用计数器吗」——**对**：
 * 分母与 13008 双生泣星用的是同一个 `anomalyApplications`（资源侧池的 perElement.triggerCount 之和），
 * 不另建第二套计数。差别只在判据形态：双生要「每次施加 +1 层（还会被失衡清空）」，
 * 触电要的是「场上有没有异常」这个**二值**。
 *
 * 为什么值得登记：异常队里它恒 100%（等于没折算），但**纯直伤队/无人挂异常时会静默按满覆盖给
 * +16% 攻击 +25% 增伤**——那是白送的一条 41% 面板，正是「满覆盖假设最失真」的场合。
 */
export const ENEMY_ANOMALY_EFFECTS: ReadonlySet<string> = new Set([
  // 13009 触电唇彩（A级·异常）：「当场上存在处于属性异常状态下的敌人时，攻击力+10%/…，对目标造成的伤害额外提升15%/…」
  'effect_wiki_210_self_atk',
  'effect_wiki_210_self_dmg',
])

/** 失衡清空型登记：effect.id → 满层数（取 catalog `maxStacks`） */
export const STUN_CLEARED_STACK_EFFECTS: Readonly<Record<string, number>> = {
  // 13008 双生泣星（A 级·异常）：「…最多叠加 4 层，目标从失衡状态恢复或死亡时，对应增益效果结束」
  effect_wiki_212_self_ap: 4,
}

/** 各触发源的占用秒数（只数 tick 过的行；未登记 totalTime 的调用方按 0 处理） */
export function occupiedSecondsOf(rows: readonly CoverageExecutionRow[], kind: TriggerSourceKind): number {
  let seconds = 0
  for (const row of rows) {
    if (!(row.count > 0)) continue
    const matches = kind === 'exSpecial'
      ? row.category === 'special' && String(row.moveName).startsWith('强化特殊技')
      : row.category === TRIGGER_SOURCE_CATEGORIES[kind]
    if (matches) seconds += Math.max(0, row.totalTime ?? 0)
  }
  return seconds
}

/**
 * 触发门控覆盖率（0-1）：min(1, 命中数 × 持续秒 / 战斗时长) × 单次触发占比。
 * battleSeconds ≤ 0（未跑资源）⇒ null = 不折算。
 */
export function triggerGateCoverage(
  hits: number,
  durationSeconds: number,
  battleSeconds: number,
  sharePerTrigger = 1,
): number | null {
  if (!(battleSeconds > 0) || !(durationSeconds > 0)) return null
  const uptime = Math.min(1, Math.max(0, hits) * durationSeconds / battleSeconds)
  return Math.max(0, Math.min(1, uptime * sharePerTrigger))
}

/**
 * 失衡清空型的**平均层数**（时间分段积分）。
 *
 * 分段口径（用户 2026-11-06）：失衡 N 次、每次 W 秒 ⇒ 非失衡时间 = 战斗时长 − N×W，均分为
 * N + 0.5 段（最后一次只走到半段）；每段从 0 层按「每 `perStack` 秒 +1 层」线性涨到满层；
 * 失衡窗口内按满层计（层数在窗口**结束时**才清零）。
 * `perStack` = 战斗时长 / 全队异常施加次数。
 */
export function stunClearedStackLayers(input: {
  battleSeconds: number
  stunCount: number
  stunWindowSeconds: number
  anomalyApplications: number
  maxStacks: number
}): number | null {
  const { battleSeconds, anomalyApplications, maxStacks } = input
  if (!(battleSeconds > 0) || !(maxStacks > 0) || !(anomalyApplications > 0)) return null
  const perStack = battleSeconds / anomalyApplications
  const stunCount = Math.max(0, input.stunCount)
  const stunTotal = Math.min(battleSeconds, stunCount * Math.max(0, input.stunWindowSeconds))
  const nonStun = Math.max(0, battleSeconds - stunTotal)
  // 非失衡时段数 = 失衡次数 + 1（最后一次只走到半段，用户算例 3 次失衡 ⇒ 3.5 段）；
  // 无失衡时整局就是一段，不能退化成 0.5 段
  const segments = Math.max(1, stunCount + 0.5)
  const segmentLength = nonStun / segments
  /** 从 0 层起按 1/perStack 线性加层：积分（层·秒）；到顶后按满层线性 */
  const accumulated = (seconds: number): number => {
    const fullAt = perStack * maxStacks
    if (seconds <= fullAt) return (seconds * seconds) / (2 * perStack)
    return (maxStacks * maxStacks * perStack) / 2 + maxStacks * (seconds - fullAt)
  }
  const fullSegments = Math.floor(segments)
  const partial = segments - fullSegments
  const total = fullSegments * accumulated(segmentLength)
    + (partial > 0 ? accumulated(segmentLength * partial) : 0)
    + maxStacks * stunTotal
  return Math.max(0, Math.min(maxStacks, total / battleSeconds))
}

/** 某效果的整局覆盖率（0-100）；null = 未登记/输入不足 ⇒ 不折算（保持既有行为） */
/** 效果的作用期长度（秒）：自身向用战场时间，队伍向用整场时长 */
function exposureSecondsOf(gated: { scope?: 'self' | 'team' }, input: ConditionCoverageInput): number {
  const battle = input.battleSeconds
  if (gated.scope === 'team') return battle
  const frontline = input.frontlineSeconds ?? 0
  return frontline > 0 ? Math.min(frontline, battle) : battle
}

export function conditionCoverageOf(input: ConditionCoverageInput): number | null {
  // ③ 敌方异常型：二值（与 ② 共用同一个异常施加计数器）
  if (ENEMY_ANOMALY_EFFECTS.has(input.effectId)) {
    return input.anomalyApplications > 0 ? 100 : 0
  }
  // ① 触发门控型：多源取和（原文「A 或 B 时」每发生一次都会触发一次，两类动作互不重复计数）
  const gated = TRIGGER_GATED_EFFECTS[input.effectId]
  if (gated) {
    /**
     * **能量预算口径**（优先于占用秒数）：持续耗能型强特按「每 N 点能量 = 一次刷新」算。
     * 用户 2026-11-07：「180/5×20 = 720 能量需求，他才 450，感觉有个一半多的覆盖率」——
     * 满覆盖 = 战斗时长 / 持续秒 × 单次耗能，实有能量除以它即覆盖率。
     */
    if (gated.energyPerRefresh && input.availableEnergy != null) {
      const refreshes = Math.max(0, input.availableEnergy) / gated.energyPerRefresh
      // 一次刷新覆盖 = 刷新动作耗时（下砸 2 秒，期间一直在打）+ 效果持续秒（5 秒）
      const perRefresh = gated.durationSeconds + (gated.refreshActionSeconds ?? 0)
      const covered = refreshes * perRefresh
      const uptime = Math.min(1, covered / exposureSecondsOf(gated, input))
      return Math.max(0, Math.min(1, uptime * gated.sharePerTrigger)) * 100
    }
    /**
     * 有效触发**时长**（秒）：
     * - 次数型源：次数 × 单次持续秒（打一下就触发一次、之后自然衰减）
     * - `sustainedSources` 里的源：直接用**占用秒数**（持续动作里命中不断刷新，效果最长盖满整段动作）
     * 两者相加后封顶在战斗时长。
     */
    let coveredSeconds = 0
    for (const source of gated.sources) {
      const hits = input.triggerCountValues[source] ?? 0
      const sustained = gated.sustainedSources?.includes(source) ?? false
      if (sustained) {
        const occupied = input.triggerOccupiedSeconds?.[source] ?? 0
        // 持续动作：占用期间命中不断（反复刷新）+ 施放结束后还剩**一整个持续秒**的尾巴。
        // 尾巴按「每次施放一份」计（施放间隔 > 持续秒时不重叠；重叠时会略高估，但比漏掉尾巴更接近真实）。
        coveredSeconds += occupied > 0
          ? occupied + gated.durationSeconds * hits
          : hits * gated.durationSeconds
      } else {
        coveredSeconds += hits * gated.durationSeconds
      }
    }
    const uptime = Math.min(1, Math.max(0, coveredSeconds) / exposureSecondsOf(gated, input))
    return Math.max(0, Math.min(1, uptime * gated.sharePerTrigger)) * 100
  }
  // ② 失衡清空型：平均层数 / defaultStacks
  const maxStacks = STUN_CLEARED_STACK_EFFECTS[input.effectId]
  if (maxStacks != null) {
    const layers = stunClearedStackLayers({
      battleSeconds: input.battleSeconds,
      stunCount: input.stunCount,
      stunWindowSeconds: input.stunWindowSeconds,
      anomalyApplications: input.anomalyApplications,
      maxStacks,
    })
    if (layers == null) return null
    const denom = input.defaultStacks > 0 ? input.defaultStacks : maxStacks
    return Math.max(0, Math.min(100, (layers / denom) * 100))
  }
  return null
}