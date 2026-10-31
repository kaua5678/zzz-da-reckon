/** scripts/lib/guide-entry-budget.mjs 的类型声明（供 vitest/TS 消费，先例：json-dup-keys.d.mts / record-key-dead-reads.d.mts） */

/** 单条预算（行）。标定：换尺时 63 条实测 中位数 12 / p90 38 / p95 52 ⇒ 40 约 3× 中位数、p90 加余量。 */
export declare const GUIDE_ENTRY_MAX_LINES: number
/** 反空洞下限（条目数）。掉到 50 以下 = 扫描面塌陷，先修扫描器。 */
export declare const GUIDE_ENTRY_MIN_COUNT: number
/** 反空洞下限（§4 行数）。标定：换尺时实测 1205 行。 */
export declare const GUIDE_SECTION_MIN_LINES: number
/** 编年史形态上限：§4 内「行首日期」的行数（只减不增）。 */
export declare const GUIDE_CHRONICLE_LINE_CAP: number

/** 存量超标条目登记项（只减不增）。 */
export interface GuideEntryAllowEntry {
  /** 条目 key：编号条目 `#18` / `### 坑 N` ⇒ `坑 61` / §4 内的表格小节 `表:🔁` */
  key: string
  /** 登记时的实测行数 —— **该条自己的棘轮上限**：涨过它就红，不只看 GUIDE_ENTRY_MAX_LINES */
  max: number
  /** 为什么还挂账 / 拆薄时该动哪块（写目标形态，不写沿革） */
  why: string
}

/** §4 的一条（坑条目 / 表格小节）。 */
export interface GuideEntry {
  key: string
  /** 条目起始行（1-based 文件行号） */
  line: number
  /** 标题前 48 字（已去掉 `*`/`#`） */
  title: string
  /** 条目行数（到下一条起点 / §4 末尾为止） */
  lines: number
}

/** 存量超标登记（只减不增）；长度必须 == RATCHET_BURNDOWN「手册 §4 超标条目」的 frozen。 */
export declare const GUIDE_ENTRY_OVERBUDGET_ALLOWLIST: GuideEntryAllowEntry[]

export interface GuideEntryReport {
  /** §4 区（`## 4.` … `## 5.`）是否扫到；false = 扫描面塌了（判据 34 直接红） */
  found: boolean
  /** §4 行数（含 `## 4.` 表头行，与 countGuideSection4Lines 同一口径） */
  sectionLines: number
  entryCount: number
  entries: GuideEntry[]
  /** 超预算（> GUIDE_ENTRY_MAX_LINES）的全部条目 */
  overBudget: GuideEntry[]
  /** 其中**没登记**的（新增超标 ⇒ 红） */
  newOverBudget: GuideEntry[]
  /** 已登记但涨过自身 max（挂账条目也只许变短） */
  overMaxRegistered: (GuideEntry & { max: number })[]
  /** 登记了但已降到预算内（该销号） */
  staleAllowlist: (GuideEntryAllowEntry & { lines: number })[]
  /** 登记了但 §4 里找不到该 key（改名 / 被删） */
  missingAllowlist: GuideEntryAllowEntry[]
  /** §4 内「行首日期」的行（编年史形态） */
  chronicleLines: { line: number; text: string }[]
}

/** 扫 §4 的条目与预算问题。allowlist 可注入（测试负控用）。纯函数：不读 zc / 不碰 git。 */
export declare function scanGuideEntries(root: string, allowlist?: GuideEntryAllowEntry[]): GuideEntryReport

/** 判据 34 的失败清单（空数组 = 通过）。detail 行统一带两空格缩进。 */
export declare function guideEntryBudgetProblems(report: GuideEntryReport): string[]
