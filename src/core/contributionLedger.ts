/**
 * 贡献账（Contribution Ledger）——**所有「求和得到某个量」的通用底座**（2026-10-20）。
 *
 * ## 为什么建它（用户口径）
 * 用户贴出 Excel 的做法并指出本质：
 * > 「横轴是拐力提供者，纵轴是属性区，每当有拐力事件我就在提供者对应的属性区加该拐力，
 * >   最后所有拐力求和…**不仅仅是属性计算，你的倍率求和、喧响求和其实都是这样算的**。
 * >   最好把能通用的全通用起来，这种计算逻辑**不要分太多小部件相加**，
 * >   矩阵的延展性也很好，**有新数据了直接加一列就行**。」
 *
 * 现状问题（实测：全仓 61 处 `reduce((sum`）：每个求和点各自实现、各自决定口径，
 * 且**不记来源** ⇒ ① 同一量散在多处实现会漂移；② 展示层要解释「这个数从哪来」只能重算一遍；
 * ③ 加一个新来源就得改一处求和代码（用户说的「写个小插件在外面挂着」）。
 *
 * ## 形状
 * 一条 `Contribution` = 「谁（origin）在哪个维度（key）上贡献了多少（amount）」。
 * 把相同的 contribution 按 (origin, key) 归并 → 就是**矩阵**；对列求和 → 就是**总量**。
 * 增维度只需在 `ContributionAdapter` 里加一个取值函数，**求和逻辑不再重写**。
 *
 * ## 契约（护栏）
 * 1. **单一求值源**：amount 必须来自与引擎写值**同一函数**（如属性的 `resolveEffectValue`），
 *    禁止展示层自己重算一遍 —— 那正是「两份实现互相漂移」的老毛病。
 * 2. **不重不漏**：`totals` 必须等于引擎真实值；凡不走本通道的来源，必须在 `unreconciled` 里**显式列出差额**，
 *    不许静默消失（`tests` 里有恒等式断言：矩阵和 + 差额 === 真实值）。
 * 3. **可延展**：新增来源 = 新增 contribution；新增维度 = 新增 adapter 的 keyOf；**不改求和逻辑**。
 */

/** 一条贡献：谁 × 哪个维度 × 多少 */
export interface Contribution<Key extends string = string> {
  /** 维度键（属性 stat / 乘区名 / 来源类型 …） */
  key: Key
  amount: number
  /** 数值口径：flat 直接相加；pct 为百分比点数 */
  mode: 'flat' | 'pct'
  /** 提供者（用于归行）；缺省视作「全局」 */
  origin?: ContributionOrigin
  /**
   * **第三维：具体内容**（用户 2026-10-20 定口径）。
   *
   * > 「如果第三维是具体内容比如二件套羁绊、副词条加成等，那么任意一个属性加成在我们三维矩阵中
   * >   都能找到自己的唯一位置，就能不重不漏了。」
   *
   * 行(提供者) × 列(属性) 之外，还要有这一维才能**唯一落位**：
   * 同一个「驱动盘词条」行、同一列 `defPct`，底下可能同时存在「6号位主词条 48%」「副词条×20 96%」
   * 「二件套 16%」——不区分就会变成一坨 160%，既无法核对来源，也无法发现重复计数。
   *
   * 约定：`slotKey` 必须**稳定且唯一**（同一加成重复应用时给出同一个值 ⇒ 去重可判）。
   * 典型取值：`主词条:6` / `副词条:defPct×20` / `套装2pc:34200` / `核心被动` / `影画2`。
   */
  slotKey?: string
  /** 更细的来源说明（核心被动 / 影画2 / 招式命中 …），展示层展开用 */
  detail?: string
}

/** 贡献提供者（= 矩阵的行） */
export interface ContributionOrigin {
  /** 稳定键：同类同名的提供者应归并到同一行 */
  key: string
  /** 显示名 */
  label: string
  /** 大类，用于定序与着色 */
  kind: string
  /** 槽位（-1 = 无归属/全局）；用于同类内定序 */
  slot?: number
}

export interface LedgerCell<Key extends string = string> {
  key: Key
  amount: number
  mode: 'flat' | 'pct'
  /** 该格的逐条明细（同一提供者同一维度可能来自多条）。`id` 用于「不重」判据（同一来源不得计两次） */
  entries: LedgerEntry[]
}

/** 单条明细：第三维（`slotKey`）是「唯一落位」的判据 */
export interface LedgerEntry {
  id: string
  detail: string
  amount: number
  /** 第三维：具体内容（主词条:6 / 副词条×20 / 套装2pc …）；缺省 = 未标注 */
  slotKey?: string
}

export interface LedgerRow<Key extends string = string> {
  origin: ContributionOrigin
  cells: Map<Key, LedgerCell<Key>>
  contributionCount: number
}

export interface LedgerTable<Key extends string = string> {
  /** 列（维度键），按 `orderKey` 排序 */
  columns: Key[]
  rows: LedgerRow<Key>[]
  /** 列和（= 该维度的总贡献） */
  totals: Map<Key, number>
  /** 列的口径（pct / flat），供展示层决定是否加 % */
  columnMode: Map<Key, 'flat' | 'pct'>
}

/**
 * 维度适配器：把「某个具体领域」映射成贡献账。
 *
 * 属性矩阵、倍率分解、喧响账本各自实现一个 adapter，共用下面的 `buildLedgerTable`。
 * **加维度只改这里**（`orderKey` / `labelOf`），不动归并与求和。
 */
export interface ContributionAdapter<Item, Key extends string = string> {
  /** 领域对象 → 维度键 */
  keyOf(item: Item): Key
  /** 领域对象 → 贡献量（必须与引擎同源） */
  amountOf(item: Item): number | null
  /** 领域对象 → 数值口径 */
  modeOf(item: Item): 'flat' | 'pct'
  /** 领域对象 → 提供者 */
  originOf(item: Item): ContributionOrigin | undefined
  /** 领域对象 → 明细说明 */
  detailOf(item: Item): string
  /** 领域对象 → 稳定 id（判「不重」用；缺省回落到 detail） */
  idOf?(item: Item): string
  /**
   * 领域对象 → **第三维**（具体内容：主词条:6 / 副词条×20 / 套装2pc:34200 …）。
   * 行(提供者) × 列(属性) 不足以唯一落位时，靠它区分——见 `Contribution.slotKey` 的说明。
   */
  slotKeyOf?(item: Item): string
  /** 列排序权重（同一领域内保持稳定；缺省按 key 字典序） */
  orderKey?(key: Key): number
}

const GLOBAL_ORIGIN: ContributionOrigin = { key: 'global', label: '全局', kind: 'global', slot: -1 }

/**
 * 通用构建器：`Item[]` → 矩阵表。**全仓所有「求和得到某个量」都该走它**。
 *
 * 归并规则：`(origin.key, key)` 相同的贡献累加进同一格（用户的 Excel 就是这个语义：
 * 同一提供者在同一属性区出现多次就相加）。
 */
export function buildLedgerTable<Item, Key extends string = string>(
  items: readonly Item[],
  adapter: ContributionAdapter<Item, Key>,
): LedgerTable<Key> {
  const rows = new Map<string, LedgerRow<Key>>()
  const totals = new Map<Key, number>()
  const columnMode = new Map<Key, 'flat' | 'pct'>()

  for (const item of items) {
    const amount = adapter.amountOf(item)
    if (amount === null || amount === 0) continue
    const key = adapter.keyOf(item)
    const origin = adapter.originOf(item) ?? GLOBAL_ORIGIN

    let row = rows.get(origin.key)
    if (!row) {
      row = { origin, cells: new Map(), contributionCount: 0 }
      rows.set(origin.key, row)
    }
    const mode = adapter.modeOf(item)
    let cell = row.cells.get(key)
    if (!cell) {
      cell = { key, amount: 0, mode, entries: [] }
      row.cells.set(key, cell)
    }
    cell.amount += amount
    cell.entries.push({
      id: adapter.idOf?.(item) ?? adapter.detailOf(item),
      detail: adapter.detailOf(item),
      amount,
      slotKey: adapter.slotKeyOf?.(item),
    })
    row.contributionCount += 1

    totals.set(key, (totals.get(key) ?? 0) + amount)
    if (!columnMode.has(key)) columnMode.set(key, mode)
  }

  const columns = [...totals.keys()].sort((a, b) => {
    const order = adapter.orderKey
    if (order) {
      const d = order(a) - order(b)
      if (d !== 0) return d
    }
    return a.localeCompare(b)
  })

  // 行序：先按 kind 的分组序（事件里出现顺序不好保证，用稳定的 kind 名排序），再槽位、再名字
  const sortedRows = [...rows.values()].sort((a, b) => {
    if (a.origin.kind !== b.origin.kind) return a.origin.kind.localeCompare(b.origin.kind)
    const sa = a.origin.slot ?? -1
    const sb = b.origin.slot ?? -1
    if (sa !== sb) return sa - sb
    return a.origin.label.localeCompare(b.origin.label)
  })

  return { columns, rows: sortedRows, totals, columnMode }
}

/**
 * 差额对账（**不重不漏的护栏**）：真实值 − 账本合计。
 *
 * `unreconciled !== 0` **不一定是 bug** —— 可能是该来源不走本账本通道（如主副词条）。
 * 但要**显式列出来**，让「账本和 + 差额 = 真实值」这条恒等式可当场手算，
 * 而不是让账本给人「全量」的错觉（属性矩阵正是靠这条发现了主副词条/applyPanel 的缺口）。
 */
export interface LedgerReconcileRow<Key extends string = string> {
  key: Key
  actual: number
  ledger: number
  unreconciled: number
}

export function reconcileLedger<Key extends string = string>(
  table: LedgerTable<Key>,
  actualOf: (key: Key) => number | undefined,
): LedgerReconcileRow<Key>[] {
  const out: LedgerReconcileRow<Key>[] = []
  for (const key of table.columns) {
    const actual = actualOf(key)
    if (typeof actual !== 'number') continue
    const ledger = table.totals.get(key) ?? 0
    out.push({ key, actual, ledger, unreconciled: actual - ledger })
  }
  return out
}

// ============================================================================
// 三维查询（B：下钻筛选 / C：按内容分面）——共用同一份 entries，不另存一份数据
// ============================================================================

/** 内容大类：把 `slotKey` 的前缀归成可读的「第三维取值」 */
export type ContentKind = '主词条' | '副词条' | '固定主词条' | '套装' | '音擎' | '角色被动' | '队友 buff' | '环境' | '其他'

/**
 * `slotKey` → 内容大类。
 *
 * 约定：各生产方在 `slotKey` 上用「类别:细节」前缀（`主词条:6` / `副词条:defPct×20` …），
 * 没带前缀的（如 effect id）按提供者的 `kind` 兜底归类。
 */
export function contentKindOf(slotKey: string | undefined, originKind: string): ContentKind {
  const prefix = slotKey?.split(':')[0]
  switch (prefix) {
    case '主词条': return '主词条'
    case '副词条': return '副词条'
    case '固定主词条': return '固定主词条'
    case '套装': return '套装'
    case '音擎': case '音擎高级词条': return '音擎'
    default: break
  }
  switch (originKind) {
    case 'driveDisc': return '套装'
    case 'wEngine': return '音擎'
    case 'agent': return '角色被动'
    case 'teammate': case 'teamEffect': return '队友 buff'
    case 'team': return '环境'
    default: return '其他'
  }
}

/** 一条三维扁平记录（表格/图表/导出都用它，避免各页面各自遍历 Map） */
export interface FlatContribution {
  key: string
  amount: number
  mode: 'flat' | 'pct'
  provider: string
  providerKind: string
  slot: number
  content: ContentKind
  slotKey: string
  detail: string
}

/**
 * 把一张账本表**摊平**成三维记录（提供者 × 属性 × 内容）。
 *
 * 这是 B（筛选下钻）与 C（按内容分面）的共同数据源：
 * 两者都只是在 `FlatContribution[]` 上做 `filter` / `groupBy`，
 * **不需要为每种视图各建一份账**（规则 11：共享量单一来源）。
 */
export function flattenLedger<Key extends string = string>(table: LedgerTable<Key>): FlatContribution[] {
  const out: FlatContribution[] = []
  for (const row of table.rows) {
    for (const [key, cell] of row.cells) {
      for (const entry of cell.entries) {
        out.push({
          key,
          amount: entry.amount,
          mode: cell.mode,
          provider: row.origin.label,
          providerKind: row.origin.kind,
          slot: row.origin.slot ?? -1,
          content: contentKindOf(entry.slotKey, row.origin.kind),
          slotKey: entry.slotKey ?? '',
          detail: entry.detail,
        })
      }
    }
  }
  return out
}

/** B：三维筛选条件（各字段为空 = 不限制） */
export interface ContributionFilter {
  providers?: readonly string[]
  keys?: readonly string[]
  contents?: readonly ContentKind[]
}

export function filterContributions(rows: readonly FlatContribution[], filter: ContributionFilter): FlatContribution[] {
  return rows.filter(r =>
    (!filter.providers?.length || filter.providers.includes(r.provider))
    && (!filter.keys?.length || filter.keys.includes(r.key))
    && (!filter.contents?.length || filter.contents.includes(r.content)),
  )
}

/** C：按内容大类分面 → 每个分面一张 `提供者 × 属性` 的二维表（复用 buildLedgerTable） */
export function facetByContent(rows: readonly FlatContribution[]): Map<ContentKind, FlatContribution[]> {
  const out = new Map<ContentKind, FlatContribution[]>()
  for (const r of rows) {
    const list = out.get(r.content) ?? []
    list.push(r)
    out.set(r.content, list)
  }
  return out
}

/** 内容大类的稳定展示顺序（主词条在最前：它是「看得见的那一条」，随后是副词条/套装/音擎/被动/队友/环境） */
export const CONTENT_KIND_ORDER: ContentKind[] = [
  '主词条', '副词条', '固定主词条', '套装', '音擎', '角色被动', '队友 buff', '环境', '其他',
]
