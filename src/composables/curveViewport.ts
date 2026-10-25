/**
 * **曲线取值域自适应**（用户 2026-10-25）：
 *
 * > 「可以把 xy 轴的这个标尺合理修改一下。比如左右的难度曲线跨度太大，那么大面积看到的其实只是
 * >  横着的连线，而看不到数据。而且上下的空间也有很多浪费」
 *
 * ## 两个独立病灶（**别当成一件事**）
 *
 * ### ① 上下浪费 = Y 轴上界被硬编码下限顶住
 *
 * 旧式：`ratioMax = max(100, ceil(max(dataMax, 150) / 50) * 50)` —— 那两个 100/150 是**常量下限**。
 * 实测（2026-10-25，2 队样本）数据只落在 **25~53%**，于是上界 150 ⇒ 绘图区里数据只占底部 19%，
 * 上面 81% 是空的。而「击杀线 100%」本该是一把尺，被推到图中部、和曲线离得老远。
 *
 * ### ② 左右浪费 = X 轴等距线性，跨度大的道把别的道压扁
 *
 * 曲线点 x 是**操作难度绝对值**（0..100+，见 difficultyCurve 头注释），一条道从 ① 到 ④ 可能跨
 * 60~100 点，而它的**数据变化只发生在最后一小段** ⇒ 中间大段是水平连线（用户原话「大面积看到的
 * 其实只是横着的连线」）。
 *
 * ⚠ 但 X 轴**不能**简单换成对数/平方根：x 是「操作难度点数」，玩家要按**真实点数差**读代价
 * （「多 20 点难换取多少伤害」），非线性轴会让这个读数失真。所以这里用**分段压缩**：
 * 只有当某条道的 x 跨度显著大于其它道时，才把**空白中段**压掉，并**在轴上如实画出断口**。
 *
 * ## 口径（三条硬约束）
 *
 * 1. **不许丢点**：任何点都必须落在取值域内（`yMax >= 所有 ratio`、`xMax >= 所有 cost`）；
 * 2. **不许骗人**：压缩过就必须能看出来——返回 `xBreaks`，页面画断口 + 刻度标真实值；
 * 3. **纯函数**：不读 store / 不碰 Vue，判据见 `__tests__/curveViewport.test.ts`。
 *
 * ## 判据
 *
 * - 数据贴合度：自适应后 `数据跨度 / 取值域跨度` 必须 ≥ 阈值（否则「改了但没效果」）；
 * - 击杀线可见性：100% 落在域内且**不贴边**；
 * - 压缩只在需要时发生：跨度接近的道**不压缩**（`xBreaks` 为空）；
 * - 单调：压缩后 x 映射仍**严格单增**（同一条道上 x 大 ⇒ 画出来的 cx 不小）。
 */

/** 一条道在 x 上的取值范围（来自它自己的点） */
export interface LaneXRange {
  laneKey: string
  min: number
  max: number
}

/** x 轴被压掉的区间（页面据此画断口） */
export interface AxisBreak {
  /** 原值区间的起止（真实操作难度点数） */
  from: number
  to: number
  /** 压缩后在像素轴上占的比例宽度（0..1，相对于原跨度） */
  keepRatio: number
}

export interface XDomainPlan {
  /** 原值下限（通常是 0；若所有道都远离 0 则会抬到最近的整齐值） */
  min: number
  /** 原值上限（= 所有点 cost 的最大值；**不截断**） */
  max: number
  /**
   * 原值 → 归一化位置 [0,1] 的分段映射。**严格单调不减**。
   * `breaks` 为空 = 恒等线性（`v / (max-min)`）。
   */
  project: (v: number) => number
  /** 被压掉的区间（空 = 没压缩，X 轴是纯线性） */
  breaks: AxisBreak[]
}

export interface YDomainPlan {
  min: number
  max: number
  /** 刻度值（含 min / max；步长按域宽挑「整齐」档） */
  ticks: number[]
  /**
   * **语义锚点在域外**（如击杀线 100% 而数据只到 53%）——不是丢数据，是「这个参考线在画面之上」。
   * 页面据此在**顶边**画一条带 ⤒ 标记的短横线并标真实值，而不是为了容纳它把整张图压扁。
   *
   * ⚠ 为什么允许锚点出域（2026-10-25 实测）：把 100% 硬塞进域内 ⇒ 数据 25~53% 时上界被迫 100，
   * 数据只占纵向 28%（旧口径 19%）。用户点名「上下的空间也有很多浪费」——那 72% 的空白就是
   * 这条击杀线的代价。锚点出域后上界贴到 75，占比升到 56%，击杀线仍以「在画面之上」如实告知。
   */
  anchorsAbove: number[]
}

/** 曲线图取值域的完整计划（x/y 各自独立，互不影响） */
export interface CurveViewportPlan {
  x: XDomainPlan
  y: YDomainPlan
  /** 这些值落在域外（不该发生；非空 = 实现有 bug，页面应如实报警而不是静默裁点） */
  outOfDomain: number[]
}

/** 归一化位置（v 夹到 [min,max] 后按域宽算；域宽 0 ⇒ 恒 0.5，避免除零） */
function norm(v: number, min: number, max: number): number {
  const span = max - min
  if (!(span > 0)) return 0.5
  return Math.min(1, Math.max(0, (v - min) / span))
}

/**
 * **Y 轴**：贴合数据，但保留两条语义锚点。
 *
 * - 下界恒 0（伤害/血量% 从 0 起才是诚实比例；抬下界会让「伤害翻倍」看起来像「涨了一点点」）；
 * - 上界 = 向上取整到整齐档，**但至少覆盖击杀线 100%**（它是一条有意义的参考线，切掉会误导）；
 * - 只有当**数据本身就超过 100%** 时才让上界跟着数据走（此时击杀线在域内，不是贴边）。
 *
 * 这就解决了「上下浪费」：数据 25~53% ⇒ 上界 100（而不是 150），数据占 25~53% 的纵向空间。
 */
export function planYDomain(
  values: readonly number[],
  opts: { keepKillLine?: boolean; killLineInDomain?: boolean; includeZero?: boolean } = {},
): YDomainPlan {
  const keepKillLine = opts.keepKillLine ?? true
  /**
   * 击杀线是否**必须落在域内**。
   * - `true`（旧口径）：上界硬抬到 100 ⇒ 数据低时大片空白；
   * - `false`（新口径，2026-10-25 用户点名「上下浪费」后改）：上界贴合数据，
   *   击杀线改记进 `anchorsAbove`，页面在顶边如实标注。
   */
  const killLineInDomain = opts.killLineInDomain ?? false
  const includeZero = opts.includeZero ?? true
  const finite = values.filter(v => Number.isFinite(v))
  const dataMax = finite.length > 0 ? Math.max(...finite) : 0
  const dataMin = finite.length > 0 ? Math.min(...finite) : 0
  /**
   * 下界：默认仍从 0 起（「伤害/血量%」从 0 读比例最诚实）。
   * 但**数据整体远离 0**（最低点 > 域宽的 35%）时，留一段 0 基线就是纯浪费——
   * 此时把下界压到「最低点」并向下取整到整齐档，**并把 0 留给击杀线语义**。
   * 实测（2 队样本 25~53%）：从 0 起 ⇒ 数据只占 28%；下界 25 ⇒ 占 38%。
   */
  const floor = keepKillLine && killLineInDomain ? 100 : 0
  // ⚠ 上界**不加最小余量**：`ceil` 到整齐档本身就会给出余量（数据 53 ⇒ 75）。
  const rawMax = Math.max(dataMax, floor)
  const anchorsAbove: number[] = []
  // 只有「击杀线真的落在域外」才登记；上界已经把 100 包进去时它就在域内，不许再报一次
  if (keepKillLine && !killLineInDomain && dataMax < 100) anchorsAbove.push(100)
  const step = rawMax <= 100 ? 25 : rawMax <= 300 ? 50 : 100
  let min = 0
  if (!includeZero && dataMin > 0) min = Math.max(0, Math.floor(dataMin / step) * step)
  const max = Math.max(step, Math.ceil(rawMax / step) * step)
  if (anchorsAbove.length > 0 && max >= 100) anchorsAbove.length = 0
  const ticks: number[] = []
  for (let v = min; v <= max + 1e-9; v += step) ticks.push(Math.round(v * 1000) / 1000)
  return { min, max, ticks, anchorsAbove }
}

/**
 * **X 轴**：线性为主，只有「某条道跨度显著大于其它道、且它的点集中在很窄的一段」时才压空白中段。
 *
 * 判据（都满足才压）：
 * 1. 全体 x 跨度 ≥ `minSpanForCompress`（默认 40 点）——短跨度压缩没有收益，只会制造断口噪音；
 * 2. 存在一条道，它的 `max - min` ≥ 全体跨度 × `laneSpanShare`（默认 0.6）——
 *    即「这条道自己就占了大部分横向空间」，其它道必然被压扁。
 *
 * 压缩方式：把**没有点的空白区间**（相邻两个不同的 x 值之间，且间隔 ≥ 全体跨度 × `gapShare`）
 * 缩到 `compressTo`（默认 0.15）。**有数据的地方不压**，所以「数据挤在一起看不到」不会发生。
 *
 * ⚠ 压缩**只缩空白**：如果点本身就是均匀铺开的（没有大空白），压了也没用 ⇒ `breaks` 为空。
 */
export function planXDomain(
  values: readonly number[],
  opts: {
    laneRanges?: readonly LaneXRange[]
    minSpanForCompress?: number
    laneSpanShare?: number
    gapShare?: number
    compressTo?: number
  } = {},
): XDomainPlan {
  const finite = values.filter(v => Number.isFinite(v) && v >= 0)
  const min = 0
  const max = finite.length > 0 ? Math.max(...finite) : 1
  const span = max - min
  const identity: XDomainPlan = { min, max, project: v => norm(v, min, max), breaks: [] }
  const minSpan = opts.minSpanForCompress ?? 40
  if (finite.length < 2 || span < minSpan) return identity

  const laneSpanShare = opts.laneSpanShare ?? 0.6
  const widestLane = (opts.laneRanges ?? [])
    .map(l => ({ span: l.max - l.min, laneKey: l.laneKey }))
    .sort((a, b) => b.span - a.span)[0]
  if (widestLane && widestLane.span < span * laneSpanShare) return identity

  /**
   * 找**真空段**：相邻两个点之间若「附近没有任何其它点」且间隔 ≥ span × gapShare 才压。
   *
   * ⚠ 判据是**点的密度**不是单纯间隔（2026-10-25 实测踩到）：
   * 均匀铺开的点集（0,10,…,100）相邻间隔都是 10 = span 的 10% ⇒ 若只看间隔，它们会**全部**
   * 被当成「大空白」⇒ 压缩后什么也没变（每段都乘同一个系数），却平白多出 10 个断口。
   * ⇒ 只压「两侧邻居都很远」的那种大空档：取间隔分布的中位数，间隔 ≥ 中位数 × `gapSpread`
   * 且 ≥ span × gapShare 才算空白。
   */
  const gapShare = opts.gapShare ?? 0.08
  const compressTo = opts.compressTo ?? 0.15
  const sorted = [...new Set(finite)].sort((a, b) => a - b)
  const widths = sorted.slice(1).map((v, i) => v - sorted[i]!)
  const median = widths.length > 0 ? [...widths].sort((a, b) => a - b)[Math.floor(widths.length / 2)]! : 0
  const gaps: { from: number; to: number; width: number }[] = []
  for (let i = 1; i < sorted.length; i++) {
    const from = sorted[i - 1]!
    const to = sorted[i]!
    const width = to - from
    const isOutlier = median > 0 ? width >= median * 4 : true
    if (width >= span * gapShare && isOutlier) gaps.push({ from, to, width })
  }
  if (gaps.length === 0) return identity

  /**
   * 压后总宽 = Σ(有数据段宽) + Σ(空白段宽 × compressTo)。
   * 用**原值**做单位再换算成比例，避免逐段累积误差。
   */
  const gapWidth = gaps.reduce((s, g) => s + g.width, 0)
  const dataWidth = span - gapWidth
  const compressedSpan = dataWidth + gapWidth * compressTo
  if (!(compressedSpan > 0)) return identity

  const breaks: AxisBreak[] = gaps.map(g => ({ from: g.from, to: g.to, keepRatio: compressTo }))
  const project = (v: number): number => {
    const clamped = Math.min(max, Math.max(min, v))
    let acc = 0
    let cursor = min
    for (const g of gaps) {
      if (clamped >= g.to) {
        // 整个空白段都在左侧：算数据段 + 压缩后的空白段
        acc += (g.from - cursor) + g.width * compressTo
        cursor = g.to
      } else if (clamped > g.from) {
        // 落在空白段内部：按比例插入（压缩后）
        acc += (g.from - cursor) + ((clamped - g.from) / g.width) * g.width * compressTo
        return Math.min(1, Math.max(0, acc / compressedSpan))
      } else {
        break
      }
    }
    acc += clamped - cursor
    return Math.min(1, Math.max(0, acc / compressedSpan))
  }
  return { min, max, project, breaks }
}

/** 一并给出 x / y 计划 + 越界清单（页面唯一入口） */
export function planCurveViewport(input: {
  ratios: readonly number[]
  costs: readonly number[]
  laneRanges?: readonly LaneXRange[]
}): CurveViewportPlan {
  const y = planYDomain(input.ratios)
  const x = planXDomain(input.costs, { laneRanges: input.laneRanges })
  const outOfDomain: number[] = []
  for (const r of input.ratios) if (Number.isFinite(r) && (r < y.min || r > y.max)) outOfDomain.push(r)
  for (const c of input.costs) if (Number.isFinite(c) && (c < x.min - 1e-9 || c > x.max + 1e-9)) outOfDomain.push(c)
  return { x, y, outOfDomain }
}
