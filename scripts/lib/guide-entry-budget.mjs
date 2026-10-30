/**
 * 判据 34：手册 §4「常见坑」区的**条目预算**（2026-10-30；落地 docs/mcp-guard-audit-surface-work.md §6 的 P1/B-2）。
 *
 * 为什么换尺（旧尺 = 工具函数 countGuideSection4Lines 的总行数，frozen === target === 1099）：
 *   规则 16③ **要求**「试过又放弃的方案必须写进 §4 坑条目的否决记录」，规则 8 又要求
 *   「协议/口径/证据进手册」⇒ 每次正常开发都可能 +N 行，而总量棘轮的语义是「一行都不许涨」。
 *   实测：2026-10-23 冻结 1099 后，10-26 的坑 60/61（+83 行，含实测数字与三条否决记录）
 *   把总量顶到 1182 ⇒ 硬断言红；审计记录里同一处已被迫「上调 frozen」5 次、
 *   「就地压行数（删证据）」多次（engine 指南 git log --grep="§4 行数"）。
 *   ⇒ 旧尺在**惩罚被规则要求的行为**，它的读数涨不代表退化（实测逐 commit 归因：+106 全是
 *   证据句 / 否决记录，0 条逐日对账）。
 *
 * 新尺量的是什么：**单条膨胀**，不是总量。
 *   - 每条（坑条目 / §4 内的表格小节）≤ GUIDE_ENTRY_MAX_LINES 行；
 *   - 存量超标条目登记在册（只减不增：账内涨了照样红，降到预算内没销号也红）；
 *   - §4 内「行首日期」的行 ≤ GUIDE_CHRONICLE_LINE_CAP（编年叙事进 git log / .claude，不进手册）；
 *   - 反空洞下限（条目数 / §4 行数）：扫描面塌陷时判据会红，不许「假装干净」。
 *   这条尺同时满足审计卡给出的验收：**加 1 行否决记录 ⇒ 不红**（本模块只看单条长度），
 *   **加编年史行 ⇒ 结构断言红**（chronicleLines）。
 *
 * 条目怎么切（⚠ 唯一的启发式，写在明面上）：
 *   - 起点 = `### ` 标题行，或**编号严格递增**的 `N. ` 行；
 *   - 编号回退的行算**子项**，不另起条目 —— 实测先例：坑 61（L1299-1303）正文里用
 *     `1./2./3.` 列了三条修法，若按「见 N. 就切」会把 54 行的坑 61 切成 3 条，
 *     预算失去意义。判据 34 管长度，不管编号连续性（那另说）。
 *   - `## 5.` 之后不扫（§4 边界由 `countGuideSection4Lines` 同一口径）。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** 单条预算（行）。标定：换尺时 63 条实测 中位数 12 / p90 38 / p95 52 ⇒ 40 约 3× 中位数、p90 加余量。 */
export const GUIDE_ENTRY_MAX_LINES = 40

/** 反空洞下限（条目数）。标定：换尺时实测 62 条；掉到 50 以下 = 扫描面塌陷，先修扫描器。 */
export const GUIDE_ENTRY_MIN_COUNT = 50

/** 反空洞下限（§4 行数）。标定：换尺时实测 1205 行。 */
export const GUIDE_SECTION_MIN_LINES = 800

/**
 * 编年史形态上限：§4 内「行首日期」的行数（`2026-10-30 今天…` 这种）。
 * 标定：换尺时实测 1 条（L308 是列表续行「2026-09-08 点名的 3 处 + 2026-09-09 实测追加的 4 处」，
 * 不是编年叙事）⇒ 上限 = 1，只减不增。
 */
export const GUIDE_CHRONICLE_LINE_CAP = 1

/**
 * 存量超标条目（只减不增）。每条：
 * - key：条目 key（编号条目 = `#18`；`### 坑 N` = `坑 61`；§4 内的表格小节 = `表:🔁`）
 * - max：登记时的实测行数（**这是该条自己的棘轮上限**：涨过它就红，不只看 40）
 * - why：为什么还挂账 / 拆薄时该动哪块（写目标形态，不写沿革）
 * ⚠ 本清单长度必须 == RATCHET_BURNDOWN「手册 §4 超标条目」的 frozen（checkGuards.test.ts 双向锁）。
 */
export const GUIDE_ENTRY_OVERBUDGET_ALLOWLIST = [
  { key: '#18', max: 46, why: 'Boss 弹刀反推 + 控制技/反制支援两族口径；拆薄方向 = 两族各立一条（弹刀反推 / 紫光技组）' },
  { key: '#19', max: 59, why: '时间预算族 6 个子坑（欠打回填/轴退化/双算/合轴/降配/截断）；拆薄方向 = 子坑各一条 + 本条只留索引' },
  { key: '#33', max: 86, why: '折叠环两套机制互为惰性 + 三版否决记录；拆薄方向 = 症状/判据留本条，三版否决记录外链' },
  { key: '#35', max: 71, why: '留白专项重定向；拆薄方向 = 口径留本条，逐队归因/实验过程外链（那是账本内容）' },
  { key: '#52', max: 49, why: '「文本写得很清楚，实现错位」三类形态；拆薄方向 = 三形态各一条' },
  { key: '#54', max: 52, why: '外层环载体两族成因；拆薄方向 = 「先查模型闭合」协议留本条，逐案外链' },
  { key: '坑 61', max: 58, why: '2026-10-26 落地（用户裁决原文 + 三臂对账 + 三条否决）；拆薄方向 = 裁决原文压成指针、遗留段另立一条' },
]

const SECTION_START = /^## 4\./
const SECTION_END = /^## 5\./
const ENTRY_HEADING = /^#{3,4} /
const PIT_HEADING = /^### 坑 (\d+)/
const NUMBERED = /^(\d{1,2})\.\s/
const DATE_LEADING = /^\s*\d{4}-\d{2}-\d{2}/

/** 表格小节的 key 取标题首个词元（`### 🔁 同一物理量…` ⇒ `表:🔁`） */
function headingTag(heading) {
  const rest = heading.replace(/^#+\s*/, '')
  const m = rest.match(/^[^\s（(]{1,4}/)
  return '表:' + (m ? m[0] : rest.slice(0, 4))
}

/**
 * 扫 §4 的条目与预算问题。allowlist 可注入（测试负控用）。
 * 纯函数：不读 zc / 不碰 git。
 */
export function scanGuideEntries(root, allowlist = GUIDE_ENTRY_OVERBUDGET_ALLOWLIST) {
  const path = join(root, 'docs/ENGINE_PIPELINE_GUIDE.md')
  const empty = {
    found: false,
    sectionLines: 0,
    entryCount: 0,
    entries: [],
    overBudget: [],
    newOverBudget: [],
    overMaxRegistered: [],
    staleAllowlist: [],
    missingAllowlist: [],
    chronicleLines: [],
  }
  if (!existsSync(path)) return empty

  const lines = readFileSync(path, 'utf8').split('\n')
  const s4 = lines.findIndex(l => SECTION_START.test(l))
  if (s4 < 0) return empty
  const s5 = lines.findIndex((l, i) => i > s4 && SECTION_END.test(l))
  if (s5 <= s4) return empty

  const body = lines.slice(s4 + 1, s5)
  const starts = []
  let lastNumber = 0
  body.forEach((line, i) => {
    const pit = line.match(PIT_HEADING)
    if (pit) {
      lastNumber = Math.max(lastNumber, Number(pit[1]))
      starts.push({ i, key: '坑 ' + pit[1] })
      return
    }
    if (ENTRY_HEADING.test(line)) {
      starts.push({ i, key: headingTag(line) })
      return
    }
    const num = line.match(NUMBERED)
    if (num && Number(num[1]) > lastNumber) {
      lastNumber = Number(num[1])
      starts.push({ i, key: '#' + num[1] })
    }
  })

  const entries = starts.map((s, k) => {
    const end = k + 1 < starts.length ? starts[k + 1].i : body.length
    return {
      key: s.key,
      line: s4 + 2 + s.i,                       // 1-based 文件行号
      title: body[s.i].replace(/[*#]/g, '').trim().slice(0, 48),
      lines: end - s.i,
    }
  })

  const byKey = new Map(entries.map(e => [e.key, e]))
  const registered = new Map(allowlist.map(a => [a.key, a]))
  return {
    found: true,
    sectionLines: s5 - s4,
    entryCount: entries.length,
    entries,
    overBudget: entries.filter(e => e.lines > GUIDE_ENTRY_MAX_LINES),
    newOverBudget: entries.filter(e => e.lines > GUIDE_ENTRY_MAX_LINES && !registered.has(e.key)),
    overMaxRegistered: entries
      .filter(e => registered.has(e.key) && e.lines > registered.get(e.key).max)
      .map(e => ({ ...e, max: registered.get(e.key).max })),
    staleAllowlist: allowlist
      .filter(a => byKey.has(a.key) && byKey.get(a.key).lines <= GUIDE_ENTRY_MAX_LINES)
      .map(a => ({ ...a, lines: byKey.get(a.key).lines })),
    missingAllowlist: allowlist.filter(a => !byKey.has(a.key)),
    chronicleLines: body
      .map((l, i) => ({ line: s4 + 2 + i, text: l.trim().slice(0, 80) }))
      .filter(x => DATE_LEADING.test(x.text)),
  }
}

/** 判据 34 的失败清单（空数组 = 通过）。detail 行统一带两空格缩进（与其它判据同格式）。 */
export function guideEntryBudgetProblems(report) {
  const d = []
  if (!report.found) {
    return ['  ✗ docs/ENGINE_PIPELINE_GUIDE.md 的 §4 区（## 4. … ## 5.）扫不到 ⇒ 扫描面塌了，先修扫描器']
  }
  if (report.sectionLines < GUIDE_SECTION_MIN_LINES) {
    d.push('  ✗ §4 只有 ' + report.sectionLines + ' 行 < 下限 ' + GUIDE_SECTION_MIN_LINES
      + '（区边界改了 / 扫描器失明 ⇒ 先修扫描器，这不是进步）')
  }
  if (report.entryCount < GUIDE_ENTRY_MIN_COUNT) {
    d.push('  ✗ §4 只数出 ' + report.entryCount + ' 条 < 下限 ' + GUIDE_ENTRY_MIN_COUNT + '（同上）')
  }
  for (const e of report.newOverBudget) {
    d.push('  ✗ ' + e.key + '「' + e.title + '」' + e.lines + ' 行 > ' + GUIDE_ENTRY_MAX_LINES
      + '（' + e.line + ' 行起）：新增超标条目 ⇒ 就地拆薄或外链成大文档，**不许删证据行**')
  }
  for (const e of report.overMaxRegistered) {
    d.push('  ✗ ' + e.key + '「' + e.title + '」' + e.lines + ' 行 > 登记的 ' + e.max
      + '：挂账条目也只许变短（棘轮只减不增）⇒ 要在这条里补证据行，先把它拆薄 / 把实测与沿革外链，再补')
  }
  for (const a of report.staleAllowlist) {
    d.push('  ✗ 登记条目 ' + a.key + ' 已 ≤' + GUIDE_ENTRY_MAX_LINES + ' 行（现 ' + a.lines
      + '）⇒ 从 GUIDE_ENTRY_OVERBUDGET_ALLOWLIST 销号（登记表不许养死条目）')
  }
  for (const a of report.missingAllowlist) {
    d.push('  ✗ 登记条目 ' + a.key + ' 在 §4 找不到（改名 / 被删）⇒ 销号或订正 key')
  }
  if (report.chronicleLines.length > GUIDE_CHRONICLE_LINE_CAP) {
    d.push('  ✗ §4 里「行首日期」的行 ' + report.chronicleLines.length + ' 条 > 上限 '
      + GUIDE_CHRONICLE_LINE_CAP + '：编年叙事（逐日对账 / 实验过程）进 git log 与 .claude 账本，'
      + '手册只收协议 / 口径 / 证据。首条 L' + report.chronicleLines[GUIDE_CHRONICLE_LINE_CAP].line
      + '：' + report.chronicleLines[GUIDE_CHRONICLE_LINE_CAP].text)
  }
  return d
}
