/**
 * 失衡轴栈遍历引擎（预制轴 = 优先级栈，只算总量）
 *
 * 模型：一个角色（队伍×命座）挂一条「富裕轴」优先级栈，引擎对每次失衡窗口走栈：
 * 1. 从栈顶（最高优先级）往下取动作，逐个检查资源：
 *    - 闪能（强特）→ **超出总量的动作直接去掉**（用户口径 2026-09-08：通用规则，耗资源的招式
 *      都从总量里拿，不许凭空创造；四舍五入开关在**总量侧**补缺口，见下）；
 *    - 喧响（终结技/开帷幕）→ 同口径**去掉**（总回复只够 3 次大招时，轴里捏的第 4 次打不出来 → 扣除）；
 *    - 时间 → 累计动作时长；**第一个装不下的动作照常施放、按窗口剩余比例部分进窗**
 *      （`inAxisCount`，2026-10-18 用户口径「超时不是应该把最后一个动作算部分易伤吗？」），
 *      其后的动作整段舍弃；窗口剩余为 0 时也与整段舍弃同形态（记 `skipped.time`）。
 * 2. 循环到资源耗尽或窗口填满。
 *
 * ⚠ **`count` 恒为整数**（用户 2026-10-18：「count 肯定是整数……也不可否认这是一次完整的释放大招」）
 * ——一次施放扣一次资源、占满一次前台时间；只有 `inAxisCount` 可以是小数（吃易伤的那部分）。
 *
 * 效果：资源全够 = 爆发轴（栈顶到底全打）；资源不够 = 低优先级动作被跳过 = 经济轴自然分化。
 * 本模块只做「哪些动作被执行」的纯函数决策，不碰面板/倍率/伤害。
 */

import type { StunAxisKind } from '@/types/resource'
import type { StunWindowTrace } from './stunTimeline'

export interface StackActionCost {
  slot: number
  moveId: string
  /** 该栈条目要打的次数 */
  count: number
  /** 单次动作时长（秒） */
  actionTime: number
  /** 单次闪能消耗（强特；0 = 不耗闪能） */
  energyCost: number
  /** 单次喧响消耗（终结技/开帷幕；0 = 不耗喧响） */
  decibelCost: number
  /**
   * 单次**角色专属资源**消耗（点；0 = 不耗该资源）。
   *
   * 为什么需要（T169，2026-10-15）：闪能/喧响之外还有第三类「轴内会被打空」的资源——
   * 般岳的**山威**：每进一次怒相得 4 点，一组免费连段（论道→狮子吼·怒）耗 2 点 ⇒
   * 一次怒相最多 2 组。修前轴栈只认闪能/喧响/时间三类门，而连段块的闪能成本是 0
   * （耗山威不耗闪能，见 `banyue.ts#combos`）⇒ **用户捏几块，栈就执行几块**，
   * 超出怒相可供给量（`rage × 2` 组）的部分变成**没有伤害对应物的幽灵块**、
   * 却照常占用轴内时间（实测 trigger/jufufu/liuyin 捏 10 块而容量 6 ⇒ 超额 4 块）。
   *
   * 资源的**供给侧**由角色自己的模块声明（`StackTraversalInput.swayBySlot`），
   * 本引擎只做「够不够」的通用门控 —— 不认任何角色 id（判据 26）。
   */
  swayCost?: number
  /** 动作开始时间（秒，相对失衡窗口起点；缺省 0，可为负=窗口外提前起手）。
   *  平A填充用：从该槽位最后一个动作的结束时刻填到窗口结束（富余才填），不是「窗口 − Σ动作时长」。 */
  startTime?: number
  /** 窗口终结动作（如佩洛伊斯右分支决算）：该动作做完时清空窗口剩余失衡时间——
   *  所在窗口平A填充恒为 0（剩余时间已被清空，没有可填充的富余），窗口有效失衡时长按其结束时刻截断。 */
  endsStunWindow?: boolean
}

export interface StackAxisInput {
  /** 优先级栈，数组顺序 = 优先级从高到低 */
  actions: StackActionCost[]
  /**
   * 轴类型（T155）：`tail` 末尾优先占 1 窗 / `bestEffort` 有富余给 1 / `fallback` 末条吃剩余 /
   * `fixed` 按 `count`。缺省按 `count` 推断（见 `axisKindOf`）。
   */
  kind?: StunAxisKind
  /** 该轴打几次失衡窗口。**只在 `kind === 'fixed'` 时有语义**（其余类型的窗数由分配算法决定）。 */
  count?: number
  /** 该轴的兜底平A角色槽位：资源不足时剩余窗口时间由该角色打平A填充；缺省不填充 */
  basicFillerSlot?: number
  /**
   * 进轴时敌人身上已有的**残痕值**（点数，600 = 1 层；用户口径 2026-10-12）。
   * 栈引擎只做**透传**（本字段不参与时间/资源门控），由消费它的角色模块做轴内时序推演。
   */
  entryGash?: number
}

export interface StackTraversalInput {
  /** 轴列表：按顺序分配窗口；count 缺省 = 兜底（吃掉所有剩余窗口） */
  axes: StackAxisInput[]
  /** 失衡窗口数（失衡池收敛结果） */
  stunCount: number
  /** 单次失衡窗口时长（秒）= stunTime + 连携窗口 + 队伍延长 */
  windowDuration: number
  /** 各槽位可用闪能（点）；缺省槽位按 0 */
  energyBySlot?: Record<number, number>
  /** 各槽位可用喧响（点）；缺省槽位按 0 */
  decibelBySlot?: Record<number, number>
  /**
   * 各槽位可用**角色专属资源**（点；如般岳山威）；缺省槽位按 0 ⇒ `swayCost > 0` 的块一律跳过。
   *
   * ⚠ **供给侧是角色自己的事**：本引擎只做「够不够」的通用门控（同 `energyBySlot`/`decibelBySlot`），
   * 不认识任何资源名或角色 id（判据 26）。目前唯一供给方 = 般岳模块
   * （`axisRageCombos` 声明的两个连段块，`swayCost = 2`/块，供给 = `swayExCount` = 怒相数 × 4）。
   * ⚠ 与闪能/喧响同款**滞后一轮**注入（首轮空表 ⇒ 耗该资源的块首轮被跳过，下一轮起正常）。
   */
  swayBySlot?: Record<number, number>
  /**
   * 各槽位**本轮可分到的平A时间**（秒）——兜底平A填充的**硬上界**（用户口径 2026-10-25）。
   *
   * 病灶（实测 `auto-1521-1251-1311`）：8 窗 × 16s = 128s，轴脚本只提供 29.8s 动作，
   * 剩余 **93.5s** 全由兜底平A填——而该槽（希希芙）本轮只分到 **64.7s** 平A。
   * 凭空多打 28.8s 的平A（还被当成 100% 轴内、攒条全额计入）⇒ 窗口数被撑到 8，
   * 就是用户说的「非法出招」。原意只是「boss 失衡时间长了，角色自动补攻击，别像老轴那样空着」，
   * **不能凭空造动作**。
   *
   * 缺省（未给该槽）⇒ 不设上界，逐位不变（非轴 / 旧调用零影响）。
   */
  basicBudgetBySlot?: Record<number, number>
  /**
   * 好评（摇人值）总量（T157）：`bestEffort` 升级轴的**资源门控**（轴内 60/90 转大块的成本从这里扣）。
   * 缺省 / 负数 ⇒ 视作 0 ⇒ 升级轴一律「放过」（先打兜底轴），与用户口径
   * 「升级轴…**有资源就优先，没有就放过**」一致。
   */
  goodReview?: number
  /**
   * **决算块的窗口延长秒数**（佩洛伊斯·永陷幽囚；2026-10-20 用户口径两条简化）。
   *
   * 返回 > 0 ⇒ 该窗口的**有效时长** = `windowDuration + N`：
   * ① 该块整段算在窗内（不做跨界小数——「大招在最后不会出窗口」）；
   * ② 该块结束即窗口结束（「大招后立即决算不用算窗口时间」），不再向后延。
   *
   * 由编排层按**本槽角色模块能力** `stunWindowExtendOnEnd` 派发后传入（引擎不认 id，判据 26）；
   * 缺省 / 返回 0 ⇒ 逐位不变。
   */
  extendOnEndOf?: (slot: number, moveId: string) => number
}

/**
 * 某槽某招式在轴内的执行次数（StackTraversalResult.executed 的值，key = `${slot}:${moveId}`）。
 *
 * ## count 与 inAxisCount 的分工（跨界小数，2026-10-18）
 *
 * 用户口径 2026-10-18：「超时不是应该把最后一个动作算部分易伤吗？」+「小数这一块要做就要做完，
 * 不要显示一半骗一半」⇒ 窗口装不下的那个动作**不是整段消失**，而是「打出来了，但只有一部分
 * 落在失衡窗口里」：
 *
 *   count       = 施放次数（整数）：玩家确实起手了这个动作，它照常扣闪能/喧响、照常占前台时间
 *   inAxisCount = 其中落在失衡窗口内的部分（0..count）：只有这部分吃失衡易伤
 *
 * 例：18s 窗口，末动作 15.9s 起手、时长 4.083s ⇒ count += 1、inAxisCount += 2.1/4.083 = 0.514。
 *
 * ⚠ **为什么必须两个字段**（而不是把 count 直接改成 0.514）：
 *  - **资源**要按 count（整次）扣：玩家已经起手，闪能/喧响是真花掉了；按 0.514 扣会让「喧响够不够
 *    下一次大招」的判断凭空变宽松（用户 2026-10-18 明确：**喧响不够就是不能算**，那是资源口径，
 *    与跨界无关）；
 *  - **时间账**同理：动作占满它自己的 4.083s 前台，不是 2.1s；
 *  - **伤害 / 失衡**按 inAxisCount 拆：窗内那段吃易伤、窗外那段不吃（damagePool#axisSplitFor），
 *    窗内那段也不攒下一次失衡条（convergence#inAxisFractionProvider 的分子）。
 *
 * 缺省全在窗内（inAxisCount === count）时逐位等价于旧口径 ⇒ 未跨界的行为零变化。
 */
export interface ExecutedMoveCount {
  slot: number
  moveId: string
  /** 施放次数（整数） */
  count: number
  /**
   * 其中**落在失衡窗口内**的部分（0..count，可为小数）。
   *
   * ⚠ **恒有值**（不写「缺省 = count」）：两个消费方（伤害池拆分 / 失衡分数）都直接读它，
   * 差一个 `?? count` 就是静默把跨界那一次算成全额吃易伤——那正是「显示一半骗一半」。
   */
  inAxisCount: number
}

/**
 * 轴内**逐次执行序列**的一条（`StackTraversalResult.sequence` 的元素）。
 * 顺序 = 栈引擎实际执行的先后（同槽位内为真实先后；跨槽位并行，消费者须按槽过滤）。
 * 语义边界 = **轴内本地**（全局侧仍是总量口径，见 `StackTraversalResult.sequence` 头注释）。
 */
export interface StackSequenceEntry {
  slot: number
  moveId: string
  count: number
  /**
   * **窗口序号**（从 1 起）——轴是**每窗重放的模板**，同一 moveId 会在每个窗口各出现一次。
   *
   * 用途：把「进轴值」（如克拉蕾残痕 `entryGash`）正确应用为**每窗开头**的初值，
   * 而不是整条序列只给一次——用户口径 2026-10-12：「我预设开头给1800，每个轴开头都该给1800呀。
   * 你这个静默清零搞得轴都没效果了，那轴的复制性呢」。
   */
  window: number
  /**
   * 该动作在**窗口内的开始时刻**（秒，相对失衡窗口起点；缺省 0）。
   *
   * 用途：把轴内推演结果（如克拉蕾的毁伤触发）标回时间轴上——用户口径 2026-10-12：
   * 「你的毁伤我还是没看到哪里写了触发时间点，触发多少次」。
   * ⚠ 跨窗口的重复执行都从各自窗口的 0 起算（栈是逐窗遍历的）⇒ 这是**窗内相对时刻**，
   *   不是整局绝对时刻；消费方若要排整局时间轴需自行按窗序偏移。
   */
  startTime: number
}

export interface StackTraversalResult {
  /** 轴内实际执行的每个动作（跨所有窗口合计，key = `${slot}:${moveId}` → 次数） */
  executed: Record<string, ExecutedMoveCount>
  /**
   * 轴内**逐次执行序列**（按实际执行先后；见 `StackSequenceEntry`）——**轴内本地数据**。
   *
   * 用途：角色专属资源在**轴内**的本地时序推演（克拉蕾残痕「积累 → 消耗 → 再积累」，
   * 用于判断轴内这次够不够消耗、能否触发毁伤）。
   * ⚠ 不是全局事件排序：全局侧失衡轴仍是「从总量里选取一部分做计数判定」（用户 2026-10-12 口径），
   *   本字段只暴露轴自身的执行先后；跨槽位并行 ⇒ 消费者必须**只按本槽过滤**后再推演。
   */
  sequence: StackSequenceEntry[]
  /** 轴内执行总耗时（秒） */
  timeUsed: number
  /**
   * 合轴节省（秒）：窗口内各角色块区间并集长度与块时长和的差（跨槽位并行只计一次前台）。
   * 时间预算消费口径：物化行全额 − 本值 = 前台净占用（iterate 平A池吃进节省）。
   */
  overlapSeconds: number
  /**
   * 合轴节省按块分摊（`${slot}:${moveId}` → 秒）：物化行按同一键扣减（行 count = 块次数、
   * 行 totalTime 全额，扣后为净占用）。比例分摊严格可加，Σ 值 = overlapSeconds。
   */
  overlapByAction: Record<string, number>
  /** 消耗闪能 */
  energyUsed: number
  /** 全队可用闪能总量（提示资源是否充足） */
  totalEnergy: number
  /** 消耗喧响 */
  decibelUsed: number
  /** 全队可用喧响总量（提示资源是否充足） */
  totalDecibel: number
  /**
   * 进轴残痕值（点数）：**透传**自消费轴（`StackAxisInput.entryGash`），供编排层注入 cfg。
   * 多轴时取**首条非零**（现实里只有一条轴会声明它；不设多轴求和以免语义含糊）。
   */
  entryGash: number
  /** 实际用到的窗口数（≤ stunCount） */
  windowsUsed: number
  /** 被跳过的动作（资源不足） */
  skipped: { slot: number; moveId: string; reason: 'energy' | 'decibel' | 'time' | 'sway' }[]
  /** 兜底平A填充总秒数（资源不足的剩余窗口时间，所有轴合计） */
  basicFillSeconds: number
  /** 各槽位兜底平A填充秒数（每轴可指定不同 filler slot） */
  basicFillBySlot: Record<number, number>
  /**
   * **逐窗轨迹**（`docs/STUN_TIMELINE_PROJECT.md` 期 1，2026-10-20；纯追加）。
   *
   * 每个**被调度的**窗口一条（含一个动作都没执行的空窗——聚合口径里它照样占一个名义窗长），
   * 记录该窗的：决算块延长 / 截断时刻 / 执行了哪些动作（含跨界 `inAxisCount`）/ 毛占用 /
   * 合轴节省 / 平A填充。时间轴排布（`core/stunTimeline.ts#buildStunTimeline`）读它，
   * 不重新推演窗口内容（否则就是第二套账）。
   *
   * ⚠ 只**追加记录**，不参与任何判定：本字段对栈的时间门/资源门/合轴/填充零影响。
   */
  windowTrace: StunWindowTrace[]
  note: string
}

/**
 * 轴类型推断（缺省标签时的兼容路径；轴页会把推断结果显示成标签，不隐藏）。
 * `count` ≥ 1 ⇒ fixed（显式次数）；否则 ⇒ fallback（兜底吃剩余）。
 */
export function axisKindOf(axis: Pick<AxisWindowShape, 'kind' | 'count'>): StunAxisKind {
  if (axis.kind !== undefined) return axis.kind
  return axis.count !== undefined && axis.count >= 1 ? 'fixed' : 'fallback'
}

/**
 * 把失衡窗口数按轴类型分配（用户口径 2026-10-14：「**末尾优先**，**双转大（尽量打的类别）
 * 看情况放 0-1 个**，**其余兜底**」）。
 *
 * ## 分配顺序（四阶段，优先级从高到低）
 *  ① **末尾优先**：`tail` 轴**先占 1 窗**（「最后打收尾轴」）——从后往前，每条 tail 预留 1 窗；
 *  ② **显式固定**：`fixed` 轴按 `count` 精确分配（用户明确写下的次数）；
 *  ③ **尽量打**：`bestEffort` 轴**有富余给 1、否则给 0**（「看情况放 0-1 个」）；
 *  ④ **兜底**：`fallback` 轴吃**所有剩余**；多条 fallback 时只有**最后一条**吃剩余（末条兜底），
 *     其余得 0。
 *
 * ## 为什么是这个顺序（旧实现的缺陷）
 * 旧式 `count !== undefined ? min(count, remaining) : remaining` 把「缺省」一律当吃剩余，
 * **无论它在第几位** ⇒ 首条缺省就吃光全部窗，其后的显式轴（含收尾轴）全被压成 0：
 * 实测 `5火10大 [循环:缺省, 双转大:1, 末尾:1]` + 失衡 4 ⇒ `[4,0,0]`（用户口径 `[2,1,1]`）；
 * `仪琉 [常规:缺省, 尾段:0]` ⇒ `[4,0]`（收尾轴从未执行，用户口径 `[3,1]`）。
 * 且类型注释原写「多条轴时按顺序分配，**末条兜底**」——实现与文档自相矛盾（兜底给了首条）。
 *
 * 返回每个轴分配到的窗口数（与 axes 同序）。供栈遍历、连携加权、转大加权共用同一套口径。
 */
/**
 * 轴窗分配的**可用资源**（T157，用户口径「升级轴…有资源就优先，没有就放过」）。
 *
 * 不传 ⇒ `bestEffort` 退回「有富余就给 1」（纯按剩余窗数判，旧行为）；
 * 传了 ⇒ 按**总量鸡兔同笼**判定（见下）。
 *
 * ## ★ 用户口径（2026-10-14，本型的判据来源）
 * > 「≥120这个条件不对。你**无法确定进入三大轴的时刻好评点如何**。这里你只能根据**好评总量**，
 * >   比如三大轴比普通多用了 60 点好评，在**普通×3+收尾×1** 的基础上，若**富余 60 点好评**
 * >   就可以把一个普通换成三大轴，**鸡兔同笼**的感觉。如果富余 120 点可以换 2 个，
 * >   变成**三大×2+普通×1+收尾×1**。」
 *
 * ⚠ **不是**「逐窗检查当前余额够不够下一窗」—— 那依赖**进入该窗的时刻余额**，而那是
 * 不可预知的（前置动作的转大/回能随时在变）。正确算法 = **先按基础轴算总成本，再看总量富余
 * 能换几个升级轴**（鸡兔同笼）。
 */
export interface AxisWindowResources {
  /** 好评（摇人值）总量：轴内 60/90 转大块的每窗成本从这里扣 */
  goodReview?: number
  /** 各槽位可用闪能（强化特殊技能量）：`energyCost > 0` 的块从这里扣 */
  energyBySlot?: Readonly<Record<number, number>>
  /** 各槽位可用喧响：`decibelCost > 0` 的块从这里扣 */
  decibelBySlot?: Readonly<Record<number, number>>
}

/**
 * 轴窗分配能看到的**轴的最小形状**（判据 29：同一形状出现两处以上就起名）。
 * `StunAxis` / `StackAxisInput` 都满足它 —— 分配只需要这三样：类型、固定次数、逐动作成本。
 */
export interface AxisWindowShape {
  readonly kind?: StunAxisKind
  readonly count?: number
  readonly actions?: ReadonlyArray<{
    readonly promoteVariant?: string
    readonly count?: number
    readonly energyCost?: number
    readonly decibelCost?: number
  }>
}

/** 槽位表求和（缺省 ⇒ 0） */
function sumSlots(rec?: Readonly<Record<number, number>>): number {
  return rec ? Object.values(rec).reduce((a, b) => a + Math.max(0, b), 0) : 0
}

/** 基础轴（= fallback）及其下标：升级轴的增量成本与「基础占满」的对照系 */
function baseAxisOf(
  axes: ReadonlyArray<AxisWindowShape>,
  kinds: readonly StunAxisKind[],
): { axis: AxisWindowShape; idx: number } | null {
  const idx = kinds.lastIndexOf('fallback')
  return idx >= 0 ? { axis: axes[idx], idx } : null
}

/** 单轴每窗资源成本（轴内所有动作的每窗成本求和） */
function axisWindowCostOf(axis: AxisWindowShape): { review: number; energy: number; decibel: number } {
  let review = 0; let energy = 0; let decibel = 0
  for (const act of axis.actions ?? []) {
    const c = act.count ?? 1
    if (act.promoteVariant === '60') review += 60 * c
    else if (act.promoteVariant === '90') review += 90 * c
    energy += Math.max(0, act.energyCost ?? 0) * c
    decibel += Math.max(0, act.decibelCost ?? 0) * c
  }
  return { review, energy, decibel }
}

export function allocateAxisWindows(
  axes: ReadonlyArray<AxisWindowShape>,
  stunCount: number,
  res?: AxisWindowResources,
): number[] {
  const n = axes.length
  const wins = new Array<number>(n).fill(0)
  // ⚠ **不取整**：`stunCount` 在轴栈侧可能是小数（外层不动点的计划值），旧实现原样使用。
  // 本轮加过 `Math.floor` 造成非预期改动（banyue 轴退化用例翻转），已回退——分配语义只改
  // 「谁先拿窗」，不改「一共几窗」。
  let remaining = Math.max(0, stunCount)
  if (n === 0 || remaining <= 0) return wins
  const kinds = axes.map(a => axisKindOf(a))

  // ① 末尾优先：tail 轴从后往前各预留 1 窗
  for (let i = n - 1; i >= 0; i--) {
    if (remaining <= 0) break
    if (kinds[i] === 'tail') { wins[i] = 1; remaining -= 1 }
  }
  // ② 显式固定次数
  for (let i = 0; i < n; i++) {
    if (remaining <= 0) break
    if (kinds[i] !== 'fixed') continue
    const w = Math.max(0, Math.min(axes[i].count ?? 0, remaining))
    wins[i] += w; remaining -= w
  }
  // ③ 尽量打（升级轴）：**总量鸡兔同笼**（用户口径见 `AxisWindowResources` 文档）。
  //
  // 算法：先让**基础轴**（fallback）吃满它该吃的窗（`baseWindows`），据此算基础总成本
  // （好评 / 闪能 / 喧响各自的总量），再问「**富余量能换几个升级窗**」——
  // 每个升级窗的**增量成本** = 升级轴每窗成本 − 基础轴每窗成本（可为 0 或负 ⇒ 不限量）。
  // 换出来的窗从基础轴扣、给升级轴（`u` 个基础窗变升级窗）。
  //
  // 多条 bestEffort 时按数组顺序依次消耗富余（每条独立算增量）；`remaining` 不足则不换。
  for (let i = 0; i < n; i++) {
    if (remaining <= 0) break
    if (kinds[i] !== 'bestEffort') continue
    if (res === undefined) { wins[i] += 1; remaining -= 1; continue }
    const base = baseAxisOf(axes, kinds)
    if (!base) continue
    const upCost = axisWindowCostOf(axes[i])
    const baseCost = axisWindowCostOf(base.axis)
    // 每个升级窗的增量（相对基础轴）；≤0 ⇒ 换上去不额外花钱 ⇒ 富余视为无限
    const dReview = upCost.review - baseCost.review
    const dEnergy = upCost.energy - baseCost.energy
    const dDecibel = upCost.decibel - baseCost.decibel
    const swapBy = (delta: number, budget: number | undefined): number => {
      if (delta <= 0) return Number.POSITIVE_INFINITY
      if (budget === undefined) return Number.POSITIVE_INFINITY
      return Math.floor(Math.max(0, budget) / delta)
    }
    /**
     * 富余 = **总量 − 所有「不吃升级时」的窗成本**。
     *
     * ⚠ **必须把 tail（收尾轴）等已分配轴的成本一起扣掉**（T158 修我自己写漏的一处）：
     * 用户口径的基准是「**普通×3 + 收尾×1**」这个**完整形态**的总成本，
     * 不是「基础轴 × 全部剩余窗」。实测（失衡4、5火10大）：基础 330 = 普通 3×60 + 收尾 150；
     * 我最初只扣 `60 × 3 = 180` ⇒ 好评 330 时就换出 2 个三大（应为 0 个）。
     */
    const baseWindows = wins[base.idx] + remaining   // 基础轴当前 + 还没分的
    const fixedCost = { review: baseCost.review * baseWindows, energy: baseCost.energy * baseWindows, decibel: baseCost.decibel * baseWindows }
    for (let j = 0; j < n; j++) {
      if (j === i || kinds[j] === 'bestEffort') continue   // 升级轴自己的成本不算「基础」
      const c = axisWindowCostOf(axes[j])
      fixedCost.review += c.review * wins[j]
      fixedCost.energy += c.energy * wins[j]
      fixedCost.decibel += c.decibel * wins[j]
    }
    const surplusReview = res.goodReview === undefined ? undefined : res.goodReview - fixedCost.review
    const surplusEnergy = sumSlots(res.energyBySlot) - fixedCost.energy
    const surplusDecibel = sumSlots(res.decibelBySlot) - fixedCost.decibel
    const u = Math.max(0, Math.min(
      Math.min(baseWindows, remaining),
      swapBy(dReview, surplusReview),
      swapBy(dEnergy, surplusEnergy),
      swapBy(dDecibel, surplusDecibel),
    ))
    if (!Number.isFinite(u) || u <= 0) continue
    const take = Math.min(u, remaining)
    wins[i] += take; remaining -= take
    // 换出来的窗从基础轴扣（基础轴在阶段④还会吃「剩余」，不必在此预扣）
    wins[base.idx] = Math.max(0, wins[base.idx] - take)
    remaining += take   // 扣回基础轴 ⇒ 那些窗重新可分配（给升级轴后 remaining 不变）
    remaining -= take
  }
  // ④ 兜底：末条 fallback 吃剩余（前面的 fallback 得 0）
  const fallbackIdx = kinds.lastIndexOf('fallback')
  if (fallbackIdx >= 0 && remaining > 0) {
    wins[fallbackIdx] += remaining
    remaining = 0
  }
  return wins
}

export function calcStunAxisStack(input: StackTraversalInput): StackTraversalResult {
  const { axes, stunCount, windowDuration, goodReview: goodReviewInput } = input
  const energyBySlot = input.energyBySlot ?? {}
  const decibelBySlot = input.decibelBySlot ?? {}
  const swayBySlot = input.swayBySlot ?? {}

  const executed: Record<string, ExecutedMoveCount> = {}
  /**
   * 逐次执行序列（**按实际执行顺序**追加，含 `count`——一次 `bump(count>1)` 记一条）。
   *
   * 为什么需要：`executed` 按 `${slot}:${moveId}` 聚合，顺序信息丢失。而角色专属资源若是
   * **时序**过程（克拉蕾残痕：积累 → 消耗 → 再积累；够不够决定这一次毁伤触不触发），
   * 就必须知道顺序——这是 `docs/ENGINE_PIPELINE_GUIDE.md` 坑 19 记的 R54 债务所指的
   * 「引擎获得逐事件顺序通道（**不需要绝对时刻，只需顺序**）」。
   *
   * ⚠ 本字段是**纯追加**：既有字段一个不动 ⇒ 对未声明时序消费者的角色零影响。
   * ⚠ `slot` 是**槽位号**（不是 `characters` 下标，见 `core/panel.ts#panelAt` 同族口径）；
   *   跨槽位的相对顺序**不等于**真实同时性（各槽并行），故消费者必须**只按本槽过滤**后再推演。
   */
  const sequence: StackSequenceEntry[] = []
  const skipped: StackTraversalResult['skipped'] = []
  let timeUsed = 0
  let overlapSeconds = 0
  const overlapByAction: Record<string, number> = {}
  let windowsUsed = 0
  let basicFillSeconds = 0
  const basicFillBySlot: Record<number, number> = {}
  /**
   * 逐窗轨迹（期 1，纯追加）：每个被调度的窗口追加一条，见 `StackTraversalResult.windowTrace`。
   * 只记**已经算出来的**量，不参与任何判定。
   */
  const windowTrace: StunWindowTrace[] = []
  let energyUsed = 0
  let decibelUsed = 0

  const totalEnergy = Object.values(energyBySlot).reduce((a, b) => a + (b > 0 ? b : 0), 0)
  const totalDecibel = Object.values(decibelBySlot).reduce((a, b) => a + (b > 0 ? b : 0), 0)
  // 每槽位剩余资源（门控用）。**口径（用户 2026-09-10 裁决 #3）**：预设动作只能「从本槽位总量拿取」，
  // 不得跨槽挪用队伍总量、也不得反填总量——旧实现用 `decibelUsed/energyUsed` 累加对**队伍总量**
  // 比较，等于让 A 槽的大招花掉 B 槽的喧响（与引擎「每槽按自身产出推导次数」两套逻辑混合）。
  const energyLeft: Record<number, number> = { ...energyBySlot }
  const decibelLeft: Record<number, number> = { ...decibelBySlot }
  const swayLeft: Record<number, number> = { ...swayBySlot }

  /**
   * 记录一次施放。
   *
   * @param count       施放次数（整数，资源/时间按它扣）
   * @param inAxisCount 其中落在失衡窗口内的部分（0..count；跨界时 < count）
   */
  const bump = (slot: number, moveId: string, count: number, startTime = 0, win = 1, inAxisCount = count) => {
    const key = `${slot}:${moveId}`
    const cur = executed[key]
    if (cur) { cur.count += count; cur.inAxisCount += inAxisCount } else executed[key] = { slot, moveId, count, inAxisCount }
    // 逐次执行序列（**轴内本地时序数据**，2026-10-12）：`executed` 是**按 key 聚合**的、丢了顺序；
    // 而克拉蕾的残痕在轴内是「积累 → 消耗 → 再积累」的过程（用户口径：「一开始1800残痕值进去，
    // 打3层毁伤，残痕值归零，然后又积累1800，又打毁伤3层。再积累600点，再打一次，如果时间足够，
    // 就可以在轴内打出7次」）⇒ 轴内那一次单独计算需要知道**谁先谁后**。
    //
    // ⚠ 这**不是**全局事件排序能力、也不是全局口径变更（用户 2026-10-12 明确纠正）：
    //   全局侧失衡轴依旧是「**从总量里选取一部分来做计数判定**」——本字段只是把轴**自己本来就有的**
    //   执行先后（`window.actions` 的遍历序）如实暴露出来，供模块做**轴内本地**的时序推演。
    //   跨槽位是并行的，故消费者必须**只按本槽过滤**后再推演（不得跨槽比较先后）。
    // ⚠ 纯追加，既有字段一个不动 ⇒ 对未消费本字段的角色零行为变更。
    if (count > 0) sequence.push({ slot, moveId, count, startTime: Math.max(0, Number(startTime)), window: win })
  }

  // 窗口调度：按轴顺序分配；count 有值 → 精确次数，缺省 → 兜底吃剩余。
  // 每个窗口携带其来源轴的 filler slot（每轴可不同）。
  const schedule: { actions: StackActionCost[]; basicFillerSlot?: number }[] = []
  // ⚠ 与编排层 `convergence` 的 6 处调用**同源同参**：否则升级轴（bestEffort）在两处拿到的窗数
  // 不一致 ⇒ 栈执行的窗数与账本/转大计数对不上（T156 修的「残留 count 二次分配」是同族问题）。
  const winAlloc = allocateAxisWindows(axes, stunCount, {
    goodReview: goodReviewInput,
    energyBySlot,
    decibelBySlot,
  })
  axes.forEach((axis, ai) => {
    for (let i = 0; i < winAlloc[ai]; i++) schedule.push({ actions: axis.actions, basicFillerSlot: axis.basicFillerSlot })
  })

  let windowNo = 0
  for (const window of schedule) {
    windowNo++
    // 合轴：时间按槽位独立门控（各角色并行填窗口，互不挤占先后时间）
    const slotTime: Record<number, number> = {}
    // 各槽位时间线最晚结束时刻（max(startTime+actionTime)，仅执行成功的动作）——平A填充从这往后
    const slotMaxEnd: Record<number, number> = {}
    // 合轴检测（2026-08-30）：窗口内各角色的块在时间轴上并行（如般岳强特时琉音抱拳），
    // 前台净占用 = 各槽位块区间的【并集】而非块时长之和。每槽位顺序排块（cursor 累计，
    // 显式 startTime 更晚则顺延到它），跨槽位区间重叠部分只计一次前台。
    const windowIntervals: { key: string; t0: number; t1: number }[] = []
    const slotCursor: Record<number, number> = {}
    let windowDidSomething = false
    let windowTimeSum = 0
    /** 本窗合轴节省（期 1 逐窗轨迹用；窗口区间数 ≤ 1 时恒 0） */
    let windowTraceOverlap = 0
    /** 本窗执行的动作（期 1 逐窗轨迹；按实际执行顺序，含跨界 `inAxisCount`） */
    const windowActions: StunWindowTrace['actions'] = []
    // 窗口终结（决算）：执行过 endsStunWindow 动作后，窗口剩余失衡时间被清空（截断结束时刻取最晚）
    let windowTruncEnd = -1

    /**
     * **决算块的有效窗口时长**（佩洛伊斯·永陷幽囚，2026-10-20 用户口径两条简化）：
     * ① 「大招在最后不会出窗口，不计算跨窗易伤」⇒ 该块 `fits` 恒 1（不做跨界小数）；
     * ② 「大招后立即决算不用算窗口时间」⇒ 窗口有效结束时刻 = 该块结束时刻（不再向后延）。
     *
     * 实现：进入本窗口时先扫一遍，若含 `stunWindowExtendOnEnd` 声明的块，则把**有效窗口时长**
     * 放宽 N 秒（让它在窗尾也能整段打进窗口），并把 `windowTruncEnd` 记到该块结束处。
     * 无该声明的角色 ⇒ `effectiveWindowDuration === windowDuration`，逐位不变。
     */
    let effectiveWindowDuration = windowDuration
    for (const act of window.actions) {
      if (!act.endsStunWindow) continue
      const extend = Math.max(0, input.extendOnEndOf?.(act.slot, act.moveId) ?? 0)
      if (extend > 0) { effectiveWindowDuration = windowDuration + extend; break }
    }

    for (const act of window.actions) {
      for (let i = 0; i < act.count; i++) {
        const used = slotTime[act.slot] ?? 0
        /**
         * ## 时间门（2026-10-18 改「跨界小数」，用户口径「小数这一块要做要做完」）
         *
         * 旧口径：`used + actionTime > windowDuration` ⇒ **整段跳过**，动作落到轴外吃 1.0 倍
         * （伤害池里 `stunCoverage = 0`），引擎里从来没有「部分吃易伤」这回事。
         *
         * 新口径：动作**照常施放**（扣资源、占时间），但只有 `(windowDuration − used) / actionTime`
         * 这一段落在窗口里 ⇒ 那段吃失衡易伤、那段之外的**不吃**（也**不攒**下一次失衡条）。
         *
         * `fits` = 窗口剩余秒数装得下的**比例**（0..1）：
         *  - 1 = 整段在窗内（未跨界，逐位等价旧口径）；
         *  - 0 < fits < 1 = 跨界（本卡要表达的形态）；
         *  - 0 = 一点都放不下（起点就在窗外）。
         *
         * ⚠ **动作仍要计入 `count`**（资源/时间按整次算），只有 `inAxisCount` 按 fits 打折
         * ——理由见 `ExecutedMoveCount` 头注释。
         * ⚠ 例外不变：窗口终结动作（佩洛伊斯决算）无视时间阀门，恒整段吃满。
         */
        // ⚠ 用 `effectiveWindowDuration`（含决算块的窗口延长）：佩洛伊斯决算块按用户口径
        // 「大招在最后不会出窗口」⇒ 它总能整段打进窗内（fits = 1）。
        const fits = act.endsStunWindow || act.actionTime <= 0
          ? 1
          : Math.max(0, Math.min(1, (effectiveWindowDuration - used) / act.actionTime))
        // 窗口剩余为负（前序动作把该槽位撑爆）⇒ 一点都进不了窗口：按整段跳过（与旧口径同形态）
        if (fits <= 0 && !act.endsStunWindow && act.actionTime > 0) {
          skipped.push({ slot: act.slot, moveId: act.moveId, reason: 'time' })
          continue
        }
        // 资源门控（**通用口径**，用户 2026-09-08）：轴从**总量**里挑招式——任何耗资源的动作，
        // 超出该槽位总量就**去掉**（不执行、不计入），不许凭空创造。喧响实测语义：总回复 9000 →
        // 只够 3 次大招，轴里捏了 4 次 → 第 4 次打不出来（窗口里攒不出 3000），必须扣掉；
        // 轴里本来就只捏 3 次则不受影响。闪能（强特）同口径。
        // （历史备注）曾有一个「保底4喧响」开关在**总量侧**补缺口（补只给喧响的弹刀 →
        // decibelSource.total 变高），故当时不需要「允许超支」。该功能已于 2026-10-23 整体删除
        // （用户裁决「这个保底是余孽，不要再用了」）⇒ 现在没有任何开关能让总量超支，
        // 「不够就跳过」是唯一口径。
        // 本文件头注释一直写的也是「不够就跳过」，此前实现与之不符。
        if (act.decibelCost > 0 && (decibelLeft[act.slot] ?? 0) + 1e-9 < act.decibelCost) {
          skipped.push({ slot: act.slot, moveId: act.moveId, reason: 'decibel' })
          continue
        }
        if (act.energyCost > 0 && (energyLeft[act.slot] ?? 0) + 1e-9 < act.energyCost) {
          skipped.push({ slot: act.slot, moveId: act.moveId, reason: 'energy' })
          continue
        }
        // 角色专属资源门控（T169）：与上面两条**同口径**（超出本槽位总量就去掉，不许凭空创造）。
        // 资源名不在引擎里 —— 供给侧由角色模块声明（`StackTraversalInput.swayBySlot`），
        // 本引擎只判「够不够」。般岳山威：每怒相 4 点、一组免费连段 2 点 ⇒ 超出 `rage × 2` 组的
        // 连段块在此被去掉（修前它们既无伤害对应物又照占轴内时间）。
        if ((act.swayCost ?? 0) > 0 && (swayLeft[act.slot] ?? 0) + 1e-9 < (act.swayCost ?? 0)) {
          skipped.push({ slot: act.slot, moveId: act.moveId, reason: 'sway' })
          continue
        }
        if (act.energyCost > 0) {
          energyLeft[act.slot] = (energyLeft[act.slot] ?? 0) - act.energyCost
          energyUsed += act.energyCost
        }
        if (act.decibelCost > 0) {
          decibelLeft[act.slot] = (decibelLeft[act.slot] ?? 0) - act.decibelCost
          decibelUsed += act.decibelCost
        }
        if ((act.swayCost ?? 0) > 0) {
          swayLeft[act.slot] = (swayLeft[act.slot] ?? 0) - (act.swayCost ?? 0)
        }
        // 执行：整次计入 count（资源/时间按整次），只有 inAxisCount 按 fits 打折
        bump(act.slot, act.moveId, 1, act.startTime ?? 0, windowNo, fits)
        // 逐窗轨迹（期 1，纯追加）：同一 moveId 在本窗的多次施放各记一条，顺序 = 实际执行顺序
        windowActions.push({
          slot: act.slot,
          moveId: act.moveId,
          count: 1,
          inAxisCount: fits,
          startTime: Math.max(0, act.startTime ?? 0),
          actionTime: act.actionTime,
        })
        // ⚠ 槽位占用时间**按整段**推进（不是 fits×actionTime）：动作真的占满 4.083s 前台，
        // 窗内 2.1s 只是「吃易伤的那一段」。按 fits 推进会让后续动作凭空多出时间。
        slotTime[act.slot] = used + act.actionTime
        // 时间线末尾：该槽位最晚结束时刻（startTime 负值=窗口外提前起手，按 0 起算）
        const end = Math.max(0, act.startTime ?? 0) + act.actionTime
        slotMaxEnd[act.slot] = Math.max(slotMaxEnd[act.slot] ?? 0, end)
        // 合轴区间：该槽位顺序排块（cursor = 已排到的时刻），显式 startTime 更晚则顺延到它
        if (act.actionTime > 0) {
          const cursor = slotCursor[act.slot] ?? 0
          const t0 = Math.max(cursor, Math.max(0, act.startTime ?? 0))
          windowIntervals.push({ key: `${act.slot}:${act.moveId}`, t0, t1: t0 + act.actionTime })
          slotCursor[act.slot] = t0 + act.actionTime
        }
        windowTimeSum += act.actionTime
        windowDidSomething = true
        if (act.endsStunWindow) windowTruncEnd = Math.max(windowTruncEnd, end)
      }
    }

    if (windowDidSomething) windowsUsed++
    timeUsed += windowTimeSum
    // 合轴节省分摊：窗口总节省 = Σ块时长 − 区间并集（跨槽位并行只计一次前台）。
    // 按块时长比例分摊到 `${slot}:${moveId}`（比例分摊严格可加 Σ=总节省；「独立贡献」口径
    // 在多块完全重叠时不可加）。物化行按同一键扣减（行 count = 块次数，行 totalTime 全额）。
    if (windowIntervals.length > 1) {
      const sorted = [...windowIntervals].sort((a, b) => a.t0 - b.t0)
      let unionLen = 0
      let curT0 = sorted[0].t0
      let curT1 = sorted[0].t1
      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i].t0 > curT1) {
          unionLen += curT1 - curT0
          curT0 = sorted[i].t0
          curT1 = sorted[i].t1
        } else {
          curT1 = Math.max(curT1, sorted[i].t1)
        }
      }
      unionLen += curT1 - curT0
      const windowOverlap = Math.max(0, windowTimeSum - unionLen)
      windowTraceOverlap = windowOverlap
      if (windowOverlap > 1e-9) {
        for (const iv of windowIntervals) {
          const share = windowOverlap * ((iv.t1 - iv.t0) / windowTimeSum)
          overlapSeconds += share
          overlapByAction[iv.key] = (overlapByAction[iv.key] ?? 0) + share
        }
      }
    }
    // 决算截断窗（windowTruncEnd ≥ 0）不填平A：剩余失衡时间在决算做完时已被清空，没有可填充的富余。
    // 覆盖率要扣的截断损失秒不在这里算——那是时间账，由 convergence 决算截断段按实数窗口算（verdictSecondsLost）。
    let windowFillSec = 0
    if (windowTruncEnd < 0 && window.basicFillerSlot !== undefined && windowDidSomething) {
      // 兜底平A：从该槽位最后一个动作的结束时刻填到窗口结束（窗口有富余才填）。
      // 动作之间的空隙（startTime 留白）不算平A——平A只补「最后一个动作之后」的富余。
      const end = slotMaxEnd[window.basicFillerSlot] ?? 0
      /**
       * ⚠ 兜底填充受该槽**剩余平A预算**封顶（用户口径 2026-10-25）。原实现只看窗口剩多少，
       * 于是「窗口要 93.5s 平A、该槽只有 64.7s」时凭空多打 28.8s ⇒ 窗数虚高。
       */
      const budget = input.basicBudgetBySlot?.[window.basicFillerSlot]
      const alreadyFilled = basicFillBySlot[window.basicFillerSlot] ?? 0
      const remain = budget === undefined ? Number.POSITIVE_INFINITY : Math.max(0, budget - alreadyFilled)
      const fillSec = Math.max(0, Math.min(effectiveWindowDuration - end, remain))
      basicFillSeconds += fillSec
      basicFillBySlot[window.basicFillerSlot] = (basicFillBySlot[window.basicFillerSlot] ?? 0) + fillSec
      windowFillSec = fillSec
    }
    // 逐窗轨迹（期 1，纯追加）：本窗的延长 / 截断 / 动作 / 占用 / 合轴 / 填充。
    // ⚠ 空窗（一个动作都没执行）也记一条——聚合口径里它照样占一个名义窗长。
    windowTrace.push({
      index: windowNo - 1,
      nominalSeconds: windowDuration,
      extendSeconds: Math.max(0, effectiveWindowDuration - windowDuration),
      endSeconds: windowTruncEnd >= 0 ? windowTruncEnd : effectiveWindowDuration,
      truncated: windowTruncEnd >= 0,
      actions: windowActions,
      actionSeconds: windowTimeSum,
      overlapSeconds: windowTraceOverlap,
      fillSeconds: windowFillSec,
    })
  }

  return {
    executed,
    sequence,
    timeUsed,
    overlapSeconds,
    overlapByAction,
    energyUsed,
    totalEnergy,
    decibelUsed,
    totalDecibel,
    windowsUsed,
    basicFillSeconds,
    basicFillBySlot,
    windowTrace,
    entryGash: axes.reduce((acc, ax) => acc || Math.max(0, Number(ax.entryGash ?? 0)), 0),
    skipped,
    note: `栈遍历：${windowsUsed} 窗口 × 单窗口 ${windowDuration}s；闪能消耗 ${energyUsed} / ${totalEnergy}，喧响 ${decibelUsed} / ${totalDecibel}；超时/资源不足 ${skipped.length} 个动作（固定轴：资源不足只提示，不自动变轴）。`,
  }
}
