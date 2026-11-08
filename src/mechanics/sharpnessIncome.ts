/**
 * 锐能（Sharpness）收支式——**唯一事实源**（2026-11-08，规则 11）。
 *
 * ## 为什么要有这个文件
 *
 * 改造前「本局锐能总量」有**两份闭式**，各自抄一遍 `SHARPNESS_INITIAL = 60`：
 * - `agents/claret.ts#computeClaretSharpResource`：`60 + 终结技次数 × 10`
 * - `agents/sunbringer.ts#solveSunbringerLoops`：`60 + regen/s × 接战秒 + 平A锐能/s × 平A秒`
 *
 * 两处口径**本来就是同一件事**（进场赠送 + 自动回复 + 招式回复 + 外来赠予），只是项目节奏不同：
 * 克拉蕾的自动回复走两态账本（`deriveClaretTwoStateTime` 单独算 `sharpnessTotal`）、
 * 挽昼直接把三项加起来。两份闭式一旦分叉，任何一处改公式另一处不会跟着变。
 *
 * ## 口径（四项相加，无钳制）
 *
 * ```
 * total = initial + auto + move + gifts
 *   auto  = regenPerSec × seconds        // 自动累积（按**接战**时间，前后台都回）
 *   move  = movePerSec  × moveSeconds    // 招式级回复（catalog `sharpness_gain` 列秒均 × 招式时间）
 *   gifts = Σ gifts[]                    // 外来赠予（队友终结技等，见下）
 * ```
 *
 * **不做 clamp**：调用方各自决定要不要夹（克拉蕾的账本要保留「锐能不足」这个负结余读数）。
 * 这里只负责**把四项怎么加**这件事只写一遍——加法顺序固定为 `initial → auto → move → gifts`，
 * 所以逐项拼出来的浮点结果与原两处手写式**逐位相同**（改造前后 dmg 完全一致，见
 * `sharpnessIncome.test.ts` 的逐位等价组与 `timeGolden` 基线）。
 *
 * ## gifts（跨槽赠予口）
 *
 * 3.4.3 知更鸟终结技「全队[锋御]角色固定回复 20 点锐能」是**跨槽**来源：锐能池住在各锋御模块
 * 自己的 cfg 里，引擎没有也**不该有**跨槽锐能通道（规则 6：跨槽一律走 `applyTeamConfig`）。
 * 消费方式 = 知更鸟在 postRound 相位把「本槽终结技次数 × 20」写进每个锋御队友的
 * `cfg.sharpnessGiftFromTeam`（模块私有 cfg 字段），锋御模块把它作为**一条 gift** 传进来。
 *
 * 这就是把 `gifts` 做成**数组**而不是单值的原因：先例已经有两条（克拉蕾的终结技 +10 也是 gift），
 * 未来再加来源不需要改签名——只加一条 `gifts: [...]`。
 *
 * @fact mechanic:sharpnessIncome/锐能收支 口径: 本局锐能总量 = initial + regenPerSec×seconds + movePerSec×moveSeconds + Σgifts，四项固定顺序相加、不做 clamp；它是克拉蕾(1611)与挽昼(1601)锐能池的单一事实源（改造前是两份各抄 SHARPNESS_INITIAL=60 的闭式） | 据 规则11（跨文件常量只从单一来源引用）@AGENTS.md + 用户@2026-11-08「锐能池现在是两份闭式…必须先抽单一事实源」 | 验 src/mechanics/__tests__/sharpnessIncome.test.ts | 锚 src/mechanics/sharpnessIncome.ts#sharpnessIncome | 信 确认
 * ⟳复核: 若出现第三种「非 initial/auto/move/gift」的锐能来源（如池上限、按比例消耗、敌方扣除），或某角色锐能池改成非加性闭式，则本式的四项分解不再完备 ⇒ 重核并扩展签名 | 到期 2027-09-30
 */

/**
 * 锐能：**进场赠送** 60 点（勘域 180s 一次 ⇒ 每局一次）。
 *
 * 单一事实源在此（改造前 `claret.ts` 与 `sunbringer.ts` 各抄一份字面量 60）。
 * 两个模块现在都 `export { SHARPNESS_INITIAL }` 自本文件，测试的既有 import 路径不变。
 */
export const SHARPNESS_INITIAL = 60

/** 锐能收支的输入。缺省字段按 0 处理（= 该来源本局不发生）。 */
export interface SharpnessIncomeInput {
  /** 进场赠送（一般传 {@link SHARPNESS_INITIAL}；账本里只算「增量」时可省略） */
  initial?: number
  /** 自动累积速率（点/秒，catalog `level60.sharpnessRegen`） */
  regenPerSec?: number
  /** 自动累积的时长基准（秒）——**接战时间**（用户口径 2026-09-11：前后台都回），不是平A时间 */
  seconds?: number
  /** 招式级回复速率（点/秒）——常态平A基准段的 `sharpness_gain / actionTime` */
  movePerSec?: number
  /** 招式级回复的时长（秒）——平A时间 */
  moveSeconds?: number
  /**
   * 外来赠予（点）。每条独立相加：克拉蕾的「终结技 +10/次」按 `ultimateCount × 10` 传一条，
   * 知更鸟的「全队锋御 +20/次」按 `cfg.sharpnessGiftFromTeam` 传一条。
   */
  gifts?: readonly number[]
}

/** 锐能收支明细（`total` 即本局总量；其余三项供资源卡分项展示） */
export interface SharpnessIncome {
  /** 四项之和（**不 clamp**：调用方按需处理负结余） */
  total: number
  /** 自动累积部分（`regenPerSec × seconds`） */
  auto: number
  /** 招式级回复部分（`movePerSec × moveSeconds`） */
  move: number
  /** 外来赠予合计（Σ gifts） */
  gifts: number
}

/**
 * 数值清洗：非有限值（NaN / ±Infinity / undefined）一律记 0。
 *
 * 为什么必须有（规则 10「静默错值」形态）：catalog 的 `sharpness_gain` 是未夹紧的列，
 * 一旦录成空/NaN，会让整条锐能池变成 NaN ⇒ EX 发数 `floor(NaN/30)` = NaN ⇒ 执行行计数 NaN，
 * 而引擎对 NaN 计数的处理是**静默按 0 发行**（不报错）——本函数把这类脏输入挡在池外。
 * ⚠ 只挡非有限值，**不夹紧负数**（负结余是合法读数，见文件头）。
 */
function finiteOrZero(v: number | undefined): number {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}

/**
 * 锐能收支（纯函数）。加法顺序固定 `initial → auto → move → gifts`，与改造前两处手写式逐位相同。
 */
export function sharpnessIncome(input: SharpnessIncomeInput): SharpnessIncome {
  const initial = finiteOrZero(input.initial)
  const auto = finiteOrZero(input.regenPerSec) * finiteOrZero(input.seconds)
  const move = finiteOrZero(input.movePerSec) * finiteOrZero(input.moveSeconds)
  let gifts = 0
  for (const g of input.gifts ?? []) gifts += finiteOrZero(g)
  return { total: initial + auto + move + gifts, auto, move, gifts }
}
