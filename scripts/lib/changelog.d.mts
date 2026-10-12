/**
 * `scripts/lib/changelog.mjs` 的类型声明（供 vitest/TS 消费，先例：recording.d.mts /
 * ui-check-runtime.d.mts / presetCategories.d.mts）。
 *
 * ⚠ 与 `.mjs` 的运行时导出必须一一对应：`check-guards` 判据 14-C（scanDtsDrift）会对账
 * 「手写声明 ↔ 运行时导出」，多一个或少一个都红（防声明漂移成死数据）。
 */

/** 提交类型 → 展示口径（kind / 中文名 / 排序） */
export declare const TYPE_META: Record<string, { kind: string; label: string; order: number }>
/** kind → 展示元数据（筛选项与顺序） */
export declare const KIND_META: Record<string, { label: string; order: number }>
/** 已知类型集合（由 TYPE_META 派生） */
export declare const KNOWN_TYPES: string[]
/** 一律归 other 的类型（wip / merge） */
export declare const NOISE_TYPES: Set<string>
/** git log 字段分隔符（`\u001f`） */
export declare const FIELD_SEP: string
/** git log 记录分隔符（`\u001e`） */
export declare const RECORD_SEP: string
/** git log 格式串（生成器与测试共用） */
export declare const GIT_LOG_FORMAT: string

/** 类型 → kind（未登记 / 噪音一律 other） */
export declare function kindOfType(type: string): string

/** 解析一条提交标题 */
export declare function parseCommitSubject(raw: string): {
  type: string
  scope: string
  kind: string
  breaking: boolean
  summary: string
  known: boolean
}

/** 摘要规范化：`NaN` → `非数`、`Infinity` → `∞`（防 ui-check 的数值外露体检误判文本） */
export declare function sanitizeSummary(text: string): string

/** 一条日志条目（= changelog.json 里 days[].entries[] 的元素；日期在分组上，不逐条存） */
export declare interface ChangelogEntry {
  /** 短 hash */
  h: string
  /** 作者日期 YYYY-MM-DD（分组用；写进产物时由 days[].d 承载并从此结构剥掉） */
  d: string
  /** 中文类型名（如「问题修复」；未识别为「其他」） */
  t: string
  /** kind id（feature / fix / refactor / docs / other）—— 筛选与配色用 */
  k: string
  /** 展示用摘要（`scope：subject`；未识别类型为原始标题） */
  s: string
  /** 1 = 破坏性变更（`!`），仅真时出现 */
  bc?: number
}

/** 一条 git log 记录 → 日志条目 */
export declare function toEntry(line: string): ChangelogEntry

/** 产物形态：条目里已无 `d`（日期在 days[].d 上） */
export declare type ChangelogDayEntry = Omit<ChangelogEntry, 'd'>

/** 条目数组 → 按日期倒序分组的结构 */
export declare function buildChangelog(
  entries: ChangelogEntry[],
  meta?: { generatedFrom?: string; head?: string },
): {
  generatedFrom: string
  head: string
  total: number
  kinds: { id: string; label: string; order: number; count: number }[]
  days: { d: string; entries: ChangelogDayEntry[] }[]
}

/** 把 git log 整段输出切成单条记录 */
export declare function splitRecords(stdout: string): string[]
