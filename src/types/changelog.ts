/**
 * 更新日志（`public/static/changelog.json`，由 `scripts/gen-changelog.mjs` 从 git 历史生成）。
 *
 * ⚠ 本文件是**产物形态**的类型：与 `scripts/lib/changelog.mjs` 的 `toEntry` /
 * `buildChangelog` 必须逐字段一致 —— 由 `validate:data` 的 JSON 契约（r725）机器校验，
 * 契约登记在 `scripts/lib/json-contract.mjs`（入口 = `stores/catalog.ts` 的 fetch）。
 *
 * 为什么字段名这么短：产物两千多条、随包发布，长字段名纯属浪费（与 catalog.json 同口径）。
 * 语义见下面每个字段的注释；生成侧的解析口径在 `scripts/lib/changelog.mjs` 头注释。
 */

/** 单条日志。`d`（日期）不在这里 —— 它由外层分组承载，见 `ChangelogDay`。 */
export interface ChangelogEntry {
  /** 短 commit hash */
  h: string
  /** 中文类型名（如「问题修复」；未识别的标题为「其他」） */
  t: string
  /** kind id：`feature` / `fix` / `refactor` / `docs` / `other`（筛选与配色用） */
  k: string
  /** 展示用摘要（`scope：subject`；未识别类型时为原始标题） */
  s: string
  /** 1 = 破坏性变更（提交标题带 `!`）。可选：只在为真时写入产物 */
  bc?: number
}

/** 一天（`d` = 作者日期 YYYY-MM-DD，倒序排列）。 */
export interface ChangelogDay {
  d: string
  entries: ChangelogEntry[]
}

/** 筛选按钮的数据源（含条数与展示顺序）⇒ UI 渲染筛选器时零硬编码类型表。 */
export interface ChangelogKind {
  id: string
  label: string
  order: number
  count: number
}

/** `changelog.json` 顶层。 */
export interface ChangelogFile {
  /** 生成来源（排障用，如 `git log --no-merges`） */
  generatedFrom: string
  /** 生成时的 HEAD 短 hash（**仅排障**：CI 里 checkout 后与生成时不同是常态，不参与漂移判定） */
  head: string
  /** 总条数 */
  total: number
  kinds: ChangelogKind[]
  days: ChangelogDay[]
}
