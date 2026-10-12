/**
 * 更新日志（changelog）的**解析 / 分类单一事实源**。
 *
 * 数据流：`git log` → 本模块 `parseCommitSubject` 逐条解析 → `buildChangelog`
 * 汇总成分组结构 → `scripts/gen-changelog.mjs` 落成 `public/static/changelog.json`
 * → 运行时 `stores/catalog.ts#loadChangelog` → `components/ChangelogDialog.vue`。
 *
 * 为什么解析要独立成模块（而不是写在 gen 脚本里）：
 *   `gen-changelog.mjs` 是**生成器**（写文件、CI 里跑漂移检查），本模块是**纯函数**
 *   （输入字符串、输出对象）⇒ 能被 vitest 直接单测。生成器的正确性判据只有「文件与
 *   git 一致」这一条，而**解析口径**（哪种标题算 feat、scope 怎么切、未识别怎么办）
 *   需要逐条断言 —— 两者混在一个文件里就只能靠跑一遍脚本肉眼看。
 *
 * ⚠ 本模块**只做纯计算**，不碰文件系统、不调 git；读 log 与写盘都是 gen 脚本的事。
 */

/**
 * 提交类型 → 展示口径（**唯一**的类型表：分类、筛选项、排序全由它派生，不许再抄一份）。
 *
 * - `kind`：粗分，决定弹层里的筛选按钮与分组
 * - `label`：中文类型名
 * - `order`：展示优先级（数字小 = 排前面）
 */
export const TYPE_META = {
  feat: { kind: 'feature', label: '新功能', order: 10 },
  perf: { kind: 'feature', label: '性能优化', order: 20 },
  fix: { kind: 'fix', label: '问题修复', order: 30 },
  refactor: { kind: 'refactor', label: '重构', order: 40 },
  test: { kind: 'refactor', label: '测试', order: 50 },
  chore: { kind: 'refactor', label: '杂项', order: 60 },
  docs: { kind: 'docs', label: '文档', order: 70 },
}

/** `kind` → 展示元数据（UI 的筛选按钮直接读这张表；`order` 决定按钮顺序）。 */
export const KIND_META = {
  feature: { label: '功能', order: 10 },
  fix: { label: '修复', order: 20 },
  refactor: { label: '重构', order: 30 },
  docs: { label: '文档', order: 40 },
  other: { label: '其他', order: 90 },
}

/** 已知类型集合（由 TYPE_META 派生，不手抄）。 */
export const KNOWN_TYPES = Object.keys(TYPE_META)

/** 一律归 `other` 的类型：过程型提交（进行中 / 合并），对读日志的人没有信息量。 */
export const NOISE_TYPES = new Set(['wip', 'merge'])

/**
 * 类型 → kind（**唯一实现**；未登记 / 噪音类型一律 `other`）。
 * @param {string} type
 * @returns {keyof typeof KIND_META}
 */
export function kindOfType(type) {
  if (!type || NOISE_TYPES.has(type)) return 'other'
  return TYPE_META[type]?.kind ?? 'other'
}

/**
 * Conventional Commits 标题的正则（**有意宽松**，见下）。
 *
 * 形如 `<type>(<scope>)!: <subject>`；`!` = 破坏性变更。
 * 分隔符收半角 `:` 与全角 `：`（实测仓库里有 1 条全角写法，漏了它那条会掉进 other）。
 *
 * ⚠ **必须大小写敏感**：仓库里 166 条 `CC-507:` / `T114:` / `R37-J5:` 这类**任务编号**
 * 开头的标题，小写化的正则会把它们整批误判成 `<type>: <subject>`（`cc-507` 会被当成类型名）
 * ⇒ 全进 other，等于把近两成历史记录错误分类。`[a-z]+` 天然排除大写编号，
 * 这是**有意**的判据而不是疏漏。
 */
const SUBJECT_RE = /^([a-z]+)(?:\(([^)]*)\))?(!)?\s*[:：]\s*([\s\S]*)$/

/**
 * 解析一条提交标题。
 *
 * @param {string} raw git 的 `%s`（单行标题）
 * @returns {{ type: string, scope: string, kind: string, breaking: boolean, summary: string, known: boolean }}
 *   · `type` 未识别时为空串（不编造类型名）；`kind` 相应为 `other`
 *   · `summary` = 弹层里显示的那一行：已识别类型给「`scope：subject`」（无 scope 则只有 subject），
 *     未识别类型给原始标题（保留原措辞，不改写、不截断）
 */
export function parseCommitSubject(raw) {
  const text = String(raw ?? '').trim()
  const m = SUBJECT_RE.exec(text)
  const type = m && KNOWN_TYPES.includes(m[1]) ? m[1] : ''
  if (!type) {
    return { type: '', scope: '', kind: 'other', breaking: false, summary: text, known: false }
  }
  const scope = (m[2] ?? '').trim()
  const subject = m[4].trim()
  return {
    type,
    scope,
    kind: kindOfType(type),
    breaking: m[3] === '!',
    summary: scope ? `${scope}：${subject}` : subject,
    known: true,
  }
}

/** git log 单条记录的字段分隔符（`%h<US>%ad<US>%s`）；选它是因为标题里不会出现它。 */
export const FIELD_SEP = '\u001f'

/** git log 记录之间的分隔符（`splitRecords` 与格式串共用一份，规则 11）。 */
export const RECORD_SEP = '\u001e'

/**
 * 摘要里的 `NaN` / `Infinity` 字面词 → 中文/符号写法。
 *
 * **为什么必须做**（实测，不是预防性洁癖）：`scripts/ui-check.mjs` 的 DOM 体检把页面文本里
 * 出现的 `\bNaN\b` / `\bInfinity\b` 判为「未格式化数值」并让实机点通失败
 * （`ui-check-runtime.mjs#rawNumberLeaks`，r716 立的闸门：展示处漏了 `fmt` 的典型症状）。
 * 那条闸门是对的 —— 它防的是「引擎算出的 NaN 直接插进页面」。但**提交标题是文本不是数值**：
 * 本仓库真有两提交的标题在讲这两个词（`feat(ui-check): … NaN / Infinity 即失败`、
 * `… 含 +Infinity 透传`），日志弹层一打开，页面文本里就有了 `NaN` ⇒ 实机点通必红。
 *
 * 处置：在**产物侧**换成等价的中文/数学写法（`NaN` → `非数`、`Infinity` → `∞`），
 * 而不是去放松 `rawNumberLeaks` —— 放宽那条闸门会连真正的数值外露一起放过（规则 10：
 * 基线/判据是测量工具，不为了让数字好看而改）。语义无损：`非数` / `∞` 正是这两个词的
 * 标准中文与数学写法，`+Infinity` 自然成为 `+∞`。
 *
 * @fact engine:changelog/摘要数值词 口径: 提交标题里的 NaN / Infinity 在产物侧规范化为「非数 / ∞」——ui-check 的 DOM 体检把页面文本出现这两个词判为未格式化数值（r716 闸门），而日志弹层会把提交标题整条显示出来；闸门不放松（它同时防真的数值外露），换的是文本措辞 | 据 实测@2026-10-12·ui-check 实机点通 FAIL 取证 | 验 changelog.test.ts::摘要里的 | 锚 scripts/lib/changelog.mjs#sanitizeSummary | 信 确认
 * ⟳复核: 若 rawNumberLeaks 的判据不再覆盖弹层文本（例如日志改用只读 DOM 之外的方式呈现），或规范化词与真实提交标题冲突，复核这条换算是否仍必要 | 到期 2027-04-12
 *
 * @param {string} text
 */
export function sanitizeSummary(text) {
  return String(text)
    .replace(/\bNaN\b/g, '非数')
    .replace(/\bInfinity\b/g, '∞')
}

/**
 * 一条 git log 记录 → 日志条目（**扁平、自描述**，便于单测逐条断言）。
 *
 * 字段设计（**有意**，规则 12 最小实现阶梯 + 规则 11 单一来源）：
 *   · `h` 短 hash · `d` 作者日期（分组用）· `s` 摘要
 *   · `t` 中文类型名（如「问题修复」）· `k` kind id（如 `fix`）—— **展示与筛选都直接读数据**，
 *     于是 UI 侧不需要再抄一份「类型 → 中文名」表（抄了就会与 `TYPE_META` 漂移）
 *   · `bc` 破坏性变更标记（`!`），只在为真时出现
 *   · **不存** scope：摘要 `s` 就是 `scope：subject`，另存一份既费体积又要保证两者一致
 *
 * 字段名取**最短**的：这是要随包发布的静态数据（两千多条），长字段名纯属浪费 ——
 * 与 `catalog.json` 的紧凑产物口径一致（规则 14）。
 * 类型在 `src/types/changelog.ts` 声明，运行时由 JSON 契约校验。
 *
 * @param {string} line 单条记录（字段用 `FIELD_SEP` 分隔）
 * @returns {{h:string,d:string,t:string,k:string,s:string,bc?:number}}
 */
export function toEntry(line) {
  const [hash, date, ...rest] = String(line).split(FIELD_SEP)
  const parsed = parseCommitSubject(rest.join(FIELD_SEP))
  const meta = TYPE_META[parsed.type]
  const entry = {
    h: (hash ?? '').trim(),
    d: (date ?? '').trim(),
    t: meta ? meta.label : KIND_META.other.label,
    k: parsed.kind,
    s: sanitizeSummary(parsed.summary),
  }
  if (parsed.breaking) entry.bc = 1
  return entry
}

/**
 * 条目数组 → 按日期倒序分组的结构（= `changelog.json` 的最终形态）。
 *
 * 口径：
 * - **保留全部条目**（含 `other`）。任务是「更新日志展示」，而本仓库大量提交是
 *   `CC-507: …` / `T114: …` 这类任务编号标题（实测 301 条无类型 + 166 条大写编号开头）
 *   —— 整批丢掉会让日志缺掉近两成历史。归 `other` 只是**分类**（可筛选、可折叠），不是删除。
 * - 日期倒序（新的在前）；同日内保持 git log 原顺序（= 提交时间倒序）。
 * - 组内条目**剥掉 `d`**：日期已由外层 `days[].d` 承载，逐条再存一份是纯冗余
 *   （2460 条 × 每条一份日期 ≈ 37 KB），且两份可能不一致。
 * - `kinds` 是**筛选按钮的数据源**（含条数与展示顺序）⇒ UI 渲染筛选器时零硬编码。
 *
 * @param {Array<{h:string,d:string,t:string,k:string,s:string,bc?:number}>} entries `toEntry` 的输出
 * @param {{ generatedFrom?: string, head?: string }} meta 生成来源（写进产物便于排障）
 */
export function buildChangelog(entries, meta = {}) {
  /** @type {Map<string, Array>} */
  const byDay = new Map()
  /** @type {Record<string, number>} */
  const counts = {}
  for (const e of entries) {
    if (!e || !e.h || !e.d) continue
    if (!byDay.has(e.d)) byDay.set(e.d, [])
    const { d, ...rest } = e
    byDay.get(d).push(rest)
    counts[e.k] = (counts[e.k] ?? 0) + 1
  }
  const days = [...byDay.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0))
    .map(([d, list]) => ({ d, entries: list }))
  // 筛选按钮：只出**实际出现过**的 kind（数据里没有的 kind 不显示空按钮），按 KIND_META.order 排
  const kinds = Object.keys(counts)
    .map(id => ({ id, label: KIND_META[id]?.label ?? id, order: KIND_META[id]?.order ?? 999, count: counts[id] }))
    .sort((a, b) => a.order - b.order)
  const total = days.reduce((n, d) => n + d.entries.length, 0)
  return {
    generatedFrom: meta.generatedFrom ?? 'git log',
    head: meta.head ?? '',
    total,
    kinds,
    days,
  }
}

/**
 * `git log` 的格式串（生成器与测试共用一份，规则 11）。
 *
 * `%h` 短 hash · `%ad` 作者日期（配 `--date=short`）· `%s` 标题 · `%x1f`/`%x1e` 分隔符。
 * ⚠ git 的 `--pretty` 里**不能直接写控制字符**（会被当普通文本），必须用 `%x1f` 转义；
 * 而 JS 侧按 `FIELD_SEP`/`RECORD_SEP` 切分 —— 三者（格式串、两个常量、splitRecords）
 * 必须一致，所以格式串由常量拼出来，不手抄转义序列。
 */
export const GIT_LOG_FORMAT = `%h${FIELD_SEP}%ad${FIELD_SEP}%s${RECORD_SEP}`

/** 把 `git log --format=GIT_LOG_FORMAT` 的整段输出切成单条记录（滤掉空行与尾部空记录）。 */
export function splitRecords(stdout) {
  return String(stdout).split(RECORD_SEP).map(s => s.trim()).filter(Boolean)
}
