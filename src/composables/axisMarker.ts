/**
 * **难度曲线上的轴态视觉编码 + 「这一档的轴」视图**（R10，用户 2026-10-16）。
 *
 * ## 用户原话（R10 立项）
 *
 * > 「如果用了预设轴，比如 4 失衡，就要**显示每个轴的可视化**。不然我在难度曲线上不知道一个队伍是
 * >  **无轴打出的伤害**还是**完整 4 失衡**，还是**4 失衡但某些招式没打出来**。虽然已经尽量补充交互
 * >  和资源去保证轴内动作了，但还是有些情况下有**动作截断**。显示出来我就可以**对照交互和合轴率**
 * >  看下能不能优化了。」
 *
 * ## 为什么编码必须是**形状**而不是颜色
 *
 * 用户口径里要「一眼看出」四种态；而颜色在本仓已被三重占用：队伍身份色（图例）/ 属性色 /
 * 双主题。只靠颜色 ⇒ ① 色盲不可分 ② 同一队四点同色 ⇒ 态与态之间根本没有色差。故本模块输出
 * **填充形状**（solid 实心 / half 半实心 / hollow 空心，曲线下方另有 cross 打叉），颜色继续表达队伍身份。
 *
 * ## 与既有图形的互斥（**加形状前先读这张表**，冲突了就换个形状）
 *
 * | 既有图形 | 含义 | 来源 |
 * |---|---|---|
 * | 实心圆 | 曲线点（本模块再细分填充） | `TeamComparePage` 曲线层 |
 * | 空心菱形 | 曲线外补充点（极限点/alt axis） | `CurveSeries.altPoints` |
 * | 空心方框（虚线） | **交互被时间线砍**（不是轴态！） | `CurveSeries.truncated` |
 * | 实线圆环 + 文字 | 关键次数跃迁 | `CurveSeries.jumps` |
 * | 灰色细空心小圆 + 虚线 | **非轴参照**（同一队关轴、易伤均匀摊） | `CurveSeries.noAxisPoints` |
 *
 * 本模块因此**只填既有的实心圆**（不新增第五种挂点），另为「被轴砍掉的档」提供一个**打叉**图形
 * （`axisCutMarkerOf`）——它画在曲线**下方**、不与曲线连线，与上面五种都不同形。
 *
 * ⚠ **「轴没打完」与「交互被砍」是两回事**（R10 口径约束，`difficultyCurve.ts` 头注释亦有警告）：
 * 前者 = 整档不成立（`axisRequirementMet` 为假 ⇒ 进 `axisTruncated`），后者 = 打了但被砍短
 * （`hint !== null` ⇒ 进 `truncated`、画空心方框）。**两张图例必须分开放，文案不许混**。
 *
 * ## 判据（`__tests__/axisMarker.test.ts`）
 *
 * - 四态两两**形状互不相同**（反空洞：不许两个态同形）；
 * - `partial` 的「跳过 N 招」与 `AxisSkipCounts` 四条原因**逐条对得上**（不自己再算一遍）；
 * - `none` / `infeasible` 的跳过明细**必须为空**（不许编造「跳过了什么」）；
 * - 被砍档图形（cross）**不在**曲线点形状集合里（两个容器不许混）。
 */
import type { StackTraversalResult } from '@/core/stunAxisStack'
import type { AxisKind, AxisSkipCounts, AxisState } from '@/composables/difficultyAxis'

/** 曲线点的填充形状（**四态各一**，见文件头互斥表） */
export type AxisMarkerShape = 'solid' | 'hollow' | 'half' | 'cross'


/** 引擎的四条跳过原因（与 `StackTraversalResult.skipped[].reason` 同源，不另立一套） */
export type AxisSkipReason = StackTraversalResult['skipped'][number]['reason']

/** 原因的**唯一中文口径**（曲线图例 / 轴视图 / tooltip 共用；页面不许各写一套） */
export const AXIS_SKIP_REASON_TEXT: Record<AxisSkipReason, string> = {
  time: '窗口时间装不下',
  decibel: '喧响不足',
  energy: '闪能不足',
  sway: '专属资源不足',
  family: '赠品连携已达上限（每窗 1 次）',
}

/** 原因在 `AxisSkipCounts` 里的键（引擎 reason 与 UI 计数字段的映射，**唯一一处**） */
const SKIP_KEY_OF: Record<AxisSkipReason, keyof AxisSkipCounts> = {
  time: 'time', decibel: 'decibel', energy: 'energy', sway: 'sway', family: 'family',
}

export interface AxisMarker {
  shape: AxisMarkerShape
  /** 图例短标签（与 `axisKindLabel` 同源语义，但这里给的是**图形**口径） */
  legend: string
  /** 该态的一句话解释（tooltip / 面板标题用） */
  detail: string
}

/**
 * 曲线点 → 填充形状。**这是「轴态 → 图形」的唯一映射**（2D SVG 与 3D canvas 都读它，
 * 不许各自 if 一遍——那正是本仓反复踩的「同一语义两份声明」）。
 */
export function axisMarkerOf(a: AxisState): AxisMarker {
  switch (a.kind) {
    case 'complete':
      return { shape: 'solid', legend: '完整轴', detail: '轴内招式一招没少' }
    case 'partial':
      return {
        shape: 'half',
        legend: `半实心（跳过 ${a.skippedTotal} 招）`,
        detail: `轴带残缺照跑：跳过 ${a.skippedTotal} 招（${skipReasonSummary(a)}）`,
      }
    case 'infeasible':
      return { shape: 'cross', legend: '打叉（轴不可行）', detail: '轴计划净占用超时间预算 ⇒ 弃轴，轴根本没执行' }
    case 'none':
      return { shape: 'hollow', legend: '空心圆（无轴）', detail: '该队没绑轴 / 轴开关关 ⇒ 易伤按时间均匀摊，不是「轴没打完」' }
  }
}

/**
 * **被轴砍掉的档**（不进曲线，画在曲线下方）→ 打叉 + 一句理由。
 *
 * 与 `axisMarkerOf` 的分工：后者回答「这个态长什么样」，本函数回答「这一档为什么不在曲线上」。
 * 两者对 `infeasible` 都给 `cross`（它本来就只会出现在曲线下方）。
 */
export function axisCutMarkerOf(a: AxisState): { shape: AxisMarkerShape; detail: string } {
  return {
    shape: 'cross',
    detail: a.kind === 'infeasible'
      ? '轴不可行（弃轴）⇒ 该档不成立，只作对照'
      : `轴没打完（跳过 ${a.skippedTotal} 招）⇒ 资源要求未满足，该档不成立，只作对照`,
  }
}

/** 跳过原因的「N 招 · 原因」摘要（空 ⇒ 空串，交给调用方决定措辞） */
export function skipReasonSummary(a: AxisState): string {
  const parts: string[] = []
  for (const reason of ['time', 'decibel', 'energy', 'sway'] as AxisSkipReason[]) {
    const n = a.skipped[SKIP_KEY_OF[reason]]
    if (n > 0) parts.push(`${AXIS_SKIP_REASON_TEXT[reason]} ${n} 招`)
  }
  return parts.join('、')
}

/**
 * 图例条目（页面直接 map 渲染）。
 *
 * ⚠ **infeasible 也列**：它在当前口径下**不会出现在曲线点里**（`axisRequirementMet` 为假 ⇒ 进
 * `axisTruncated`），但图例列它是**如实**的——用户要的是「看得出四态」，不是「只列今天恰好会出现的三态」。
 * 条目里用 `onCurve` 标注它画在哪，避免读者在曲线上白找。
 */
export interface AxisLegendEntry extends AxisMarker {
  kinds: AxisKind[]
  /** 该图形画在哪：`curve` = 曲线点上；`below` = 曲线下方（被砍档） */
  onCurve: 'curve' | 'below'
}

export function axisMarkerLegend(): AxisLegendEntry[] {
  const probe = (k: AxisKind): AxisState => ({
    kind: k,
    skipped: { time: 0, decibel: 0, energy: 0, sway: 0, family: 0 },
    skippedTotal: 0,
    fallback: k === 'infeasible',
  })
  return [
    { ...axisMarkerOf(probe('complete')), kinds: ['complete'], onCurve: 'curve' },
    { ...axisMarkerOf(probe('partial')), kinds: ['partial'], onCurve: 'curve' },
    { ...axisMarkerOf(probe('none')), kinds: ['none'], onCurve: 'curve' },
    {
      shape: 'cross',
      legend: '打叉（该档不成立）',
      detail: '轴不可行（或跳过 N 招但没过「残疾轴」门槛）⇒ 该档不进曲线，只作对照',
      // ⚠ 只登记 infeasible：partial **可能**在曲线上（过了门槛 ⇒ half），也可能在这里（没过 ⇒ cross）。
      // 图例不替它下结论——读者点开该档看面板里的实际理由。
      kinds: ['infeasible'],
      onCurve: 'below',
    },
  ]
}

// ===================== 「这一档的轴」视图（纯函数） =====================

/** 轴内实际执行的一条动作（`executed` 的一行） */
export interface AxisExecutedLine {
  slot: number
  moveId: string
  /** 可读招式名（`nameOf` 解析；解析不到时回落 moveId，不编名字） */
  name: string
  /** 施放次数（整数） */
  count: number
  /** 其中落在失衡窗口内的部分（可含小数，见 `ExecutedMoveCount.inAxisCount`） */
  inAxisCount: number
}

/** 被跳过的一条动作（`skipped` 的一行） */
export interface AxisSkippedLine {
  slot: number
  moveId: string
  name: string
  reason: AxisSkipReason
  reasonText: string
}

/** 按原因汇总的跳过条数（与 `AxisSkipCounts` 同源，只做展示排序） */
export interface AxisSkipTotal {
  reason: AxisSkipReason
  text: string
  count: number
}

export interface AxisDetailView {
  kind: AxisKind
  /** 面板标题（如「这一档的轴」的后缀：完整轴 / 跳过 3 招 …） */
  title: string
  /** 一句话口径说明（无轴的档要明确写「不是没打完」） */
  note: string
  executed: AxisExecutedLine[]
  skipped: AxisSkippedLine[]
  skipTotals: AxisSkipTotal[]
}

/**
 * 把引擎轴栈 → 面板要的三块（执行 / 跳过 / 按原因汇总）。
 *
 * **纯函数，不重算任何判定**：跳过计数只从 `AxisState.skipped` 读（`axisStateOf` 已按引擎
 * `skipped` 分类过），执行清单只从 `stackTraversalResult.executed` 读（引擎物化后的实打次数）。
 * `stack` 为 null（非轴队 / 弃轴）⇒ 执行清单为空且**如实**为空，不补一行「平A填充」凑数。
 */
export function axisDetailOf(
  a: AxisState,
  stack: Pick<StackTraversalResult, 'executed' | 'skipped'> | null,
  nameOf: (slot: number, moveId: string) => string,
): AxisDetailView {
  const executed: AxisExecutedLine[] = []
  const skipped: AxisSkippedLine[] = []
  if (stack) {
    for (const rec of Object.values(stack.executed)) {
      executed.push({
        slot: rec.slot,
        moveId: rec.moveId,
        name: nameOf(rec.slot, rec.moveId),
        count: rec.count,
        inAxisCount: rec.inAxisCount,
      })
    }
    // 槽位序 → 次数降序：同槽内「打得最多的」排前面，跨槽按 1/2/3 号位分组（与资源卡顺序一致）
    executed.sort((x, y) => x.slot - y.slot || y.count - x.count || x.moveId.localeCompare(y.moveId))
    for (const s of stack.skipped) {
      skipped.push({
        slot: s.slot,
        moveId: s.moveId,
        name: nameOf(s.slot, s.moveId),
        reason: s.reason,
        reasonText: AXIS_SKIP_REASON_TEXT[s.reason],
      })
    }
    skipped.sort((x, y) => x.slot - y.slot || x.reason.localeCompare(y.reason) || x.moveId.localeCompare(y.moveId))
  }
  const skipTotals: AxisSkipTotal[] = (['time', 'decibel', 'energy', 'sway'] as AxisSkipReason[])
    .map(reason => ({ reason, text: AXIS_SKIP_REASON_TEXT[reason], count: a.skipped[SKIP_KEY_OF[reason]] }))
    .filter(t => t.count > 0)
  return {
    kind: a.kind,
    title: a.kind === 'complete' ? '完整轴' : a.kind === 'partial' ? `跳过 ${a.skippedTotal} 招` : a.kind === 'infeasible' ? '轴不可行' : '无轴',
    note: a.kind === 'none'
      ? '这一档本来就没绑轴：易伤按时间均匀摊，**不是**「轴没打完」。要看轴态请先绑定失衡轴预设。'
      : a.kind === 'infeasible'
        ? '轴计划净占用超时间预算 ⇒ 引擎弃轴，轴根本没执行；下面的执行清单为空是**如实**的。'
        : a.kind === 'complete'
          ? '轴内招式一招没少（引擎 `skipped` 为空）。'
          : `轴带残缺照跑：引擎按资源门控跳过了 ${a.skippedTotal} 招（${skipReasonSummary(a)}）。`,
    executed,
    skipped,
    skipTotals,
  }
}

/**
 * 「拿什么和轴态对照」的三个量（用户原话：「对照交互和合轴率看下能不能优化」）。
 *
 * 三个量各有**既有单一事实源**，本函数只做取值与缺省标注，不算任何新数：
 * - 交互手填 / 实打 ← `LadderPoint.interactionsFilled` / `interactionsPlayed`（`sumInteractions`）；
 * - 合轴吸收率 ← `LadderPoint.knobs.absorb`（该档旋钮的绝对值，0..cap）；
 * - 合轴节省秒数 ← 轴栈 `overlapSeconds`（窗口内跨角色块并行的并集节省）。
 *
 * 缺省一律给 `null` 并带 `nullReason`（**不写 0**：0 是「测到 0」，null 是「没测」）。
 */
export interface AxisCompareView {
  interactionsFilled: number | null
  interactionsPlayed: number | null
  absorb: number | null
  overlapSeconds: number | null
  /** 逐量的缺省原因（键 = 字段名；有值就不出现） */
  nullReason: Partial<Record<'interactionsFilled' | 'interactionsPlayed' | 'absorb' | 'overlapSeconds', string>>
}

export function axisCompareOf(input: {
  interactions?: { filled: number; played: number } | null
  absorb?: number | null
  stack?: Pick<StackTraversalResult, 'overlapSeconds'> | null
}): AxisCompareView {
  const nullReason: AxisCompareView['nullReason'] = {}
  if (!input.interactions) {
    nullReason.interactionsFilled = '该档没采交互量快照'
    nullReason.interactionsPlayed = '该档没采交互量快照'
  }
  if (input.absorb === null || input.absorb === undefined) nullReason.absorb = '该档没有合轴旋钮（非轴队 / 未采）'
  if (!input.stack) nullReason.overlapSeconds = '非轴队 / 弃轴 ⇒ 没有轴内并行'
  return {
    interactionsFilled: input.interactions?.filled ?? null,
    interactionsPlayed: input.interactions?.played ?? null,
    absorb: input.absorb ?? null,
    overlapSeconds: input.stack?.overlapSeconds ?? null,
    nullReason,
  }
}
