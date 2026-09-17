/**
 * T8 identity inventory: read-only evidence, NOT the enforcing ratchet.
 * Scope and legacy count are imported from check-guards (one source of truth).
 * Unit = comparison occurrence; line totals are separately deduplicated. Never add them.
 * Pure named identity definitions are distinguished from business uses (including
 * find/filter callbacks). Unknown forms remain visible, never silently exempted,
 * and carry a best-effort same-file consumer trail.
 * Limits: syntax only, not symbol/type resolution; dynamic keys/indirect aliases
 * are unknown. This report does not claim complete semantic branch coverage.
 * `blindSpots` is observation-only: it is NOT part of any counted measure.
 *
 * Usage: node scripts/report-agent-identity.mjs [--md] [--at-head]
 */
import ts from 'typescript'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { countAgentIdBranchLines, listAgentBranchFiles } from './check-guards.mjs'
// 检测面（AST 单源）：本脚本只做**分类/证据**，不自己判「哪些比较算身份」（规则 11）
import {
  IDENTITY_FIELDS, identityComparison, scanIdentityNodes, unwrapIdentityNode as unwrap,
} from './lib/agent-identity-lines.mjs'
export { IDENTITY_FIELDS }

/** 具名定义判据：函数体只由「身份比较」的 `||` 串成（身份判定本身来自 lib，不重写一份） */
function pureIdentity(node) {
  const n = unwrap(node)
  const match = identityComparison(n)
  if (match && match.identity !== null) return true
  return ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.BarBarToken
    && pureIdentity(n.left) && pureIdentity(n.right)
}
function classification(node) {
  for (let p = node.parent; p; p = p.parent) {
    if (ts.isCallExpression(p)) return { category: 'business', reason: 'comparison selects data in a call/callback' }
    if (ts.isFunctionLike(p)) {
      const parent = p.parent
      if (parent && ts.isCallExpression(parent)) return { category: 'business', reason: 'inline callback selects business data' }
      const named = (ts.isFunctionDeclaration(p) && p.name)
        || (ts.isArrowFunction(p) && ts.isVariableDeclaration(parent))
      let expression = p.body
      if (expression && ts.isBlock(expression)) {
        expression = expression.statements.length === 1 && ts.isReturnStatement(expression.statements[0])
          ? expression.statements[0].expression : null
      }
      if (named && expression && pureIdentity(expression)) {
        return { category: 'definition', reason: 'named function returns only identity comparison(s)' }
      }
      return { category: 'business', reason: 'comparison inside business function' }
    }
    if (ts.isIfStatement(p) || ts.isConditionalExpression(p)) {
      return { category: 'business', reason: 'conditional branch' }
    }
    if (ts.isVariableDeclaration(p) || ts.isPropertyAssignment(p)) {
      return { category: 'unknown', reason: 'stored identity flag: consumer must be reviewed' }
    }
  }
  return { category: 'unknown', reason: 'no proven classification' }
}
/** 存储标志的最近声明名（用于追踪消费者）；纯启发式，不做符号解析 */
function storedName(node) {
  for (let p = node.parent; p; p = p.parent) {
    if ((ts.isPropertyAssignment(p) || ts.isPropertyDeclaration(p)) && ts.isIdentifier(p.name)) {
      return { name: p.name.text, node: p }
    }
    if (ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) return { name: p.name.text, node: p }
    if (ts.isFunctionLike(p) || ts.isStatement(p)) return null
  }
  return null
}
/** 同名标识符/字符串键的其它出现行（best-effort，可能被同名遮蔽干扰 ⇒ 仅供人工核查） */
function consumerLines(source, name, declared) {
  const lines = new Set()
  const visit = node => {
    // `x.name` 的属性名本身就是 Identifier 子节点 ⇒ 标识符一条即可覆盖点号形态；
    // 字符串键（`x['name']`）另判，避免把任意同文本字面量都算成消费者。
    const isMatch = ts.isIdentifier(node) ? node.text === name
      : ts.isStringLiteral(node) && node.text === name
        && ts.isElementAccessExpression(node.parent) && node.parent.argumentExpression === node
    if (isMatch && !isInside(node, declared)) {
      lines.add(source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return [...lines].sort((a, b) => a - b)
}
function isInside(node, ancestor) {
  for (let p = node; p; p = p.parent) if (p === ancestor) return true
  return false
}
function positionOf(source, node) {
  const { line, character } = source.getLineAndCharacterOfPosition(node.getStart(source))
  return { line: line + 1, column: character + 1 }
}
/** 扫一份源码：返回逐条比较（含分类与证据）+ 观察项。身份判定本身来自 lib（单一 visitor） */
export function scanIdentitySource(content, file = 'fixture.ts') {
  const { source, identity, nonCharacter, aliases } = scanIdentityNodes(content, file)
  const entries = []
  for (const hit of identity) {
    // 分类只在**本文件**做（证据/理由属报告面）；形态判定在 lib（两个消费者共用一份）
    const kind = hit.identity === null
      ? { category: 'unknown', reason: 'dynamic comparison value needs symbol resolution' }
      : classification(hit.node)
    const entry = {
      file, ...positionOf(source, hit.node), field: hit.field, identity: hit.identity, ...kind,
      text: hit.node.getText(source),
    }
    if (kind.category === 'unknown' && kind.reason.startsWith('stored')) {
      const stored = storedName(hit.node)
      if (stored) {
        entry.storedAs = stored.name
        entry.consumers = consumerLines(source, stored.name, stored.node)
      }
    }
    entries.push(entry)
  }
  const blindSpots = aliases.map(a => ({
    file, ...positionOf(source, a.node), alias: a.alias, identity: a.identity,
    reason: 'local alias of an identity value: neither legacy regex nor the ratchet shapes count it',
    text: a.node.getText(source),
  }))
  // 观察项：非角色 `.id` 比较（moveId/dataId/overrideId/rowId 族）——**不进任何度量**，
  // 但必须露面（换尺实测 17 条 = 动态 7 + 非四位字符串 10），否则「不并入」会退化成「看不见」。
  const nonCharacterIds = nonCharacter.map(h => ({
    file, ...positionOf(source, h.node), field: h.field, identity: h.identity, text: h.node.getText(source),
  }))
  return { entries, blindSpots, nonCharacterIds }
}
const lineKeys = list => new Set(list.map(e => `${e.file}:${e.line}`))
function group(list) {
  return { comparisons: list.length, lines: lineKeys(list).size }
}
export function summarizeIdentity(entries) {
  const groups = Object.fromEntries(['business', 'definition', 'unknown'].map(category => {
    const list = entries.filter(e => e.category === category)
    return [category, group(list)]
  }))
  const definitions = entries.filter(e => e.category === 'definition')
  const byShape = Object.fromEntries(IDENTITY_FIELDS.map(field => [field, group(entries.filter(e => e.field === field))]))
  // 形态重叠：`a.id === 'X' || a.teammateBuffId === 'X'` 这种同一行双形态（不可把它们相加当独立存量）
  const fieldsByLine = new Map()
  for (const e of entries) {
    const key = `${e.file}:${e.line}`
    if (!fieldsByLine.has(key)) fieldsByLine.set(key, new Set())
    fieldsByLine.get(key).add(e.field)
  }
  const shapeOverlap = {}
  for (const a of IDENTITY_FIELDS) {
    for (const b of IDENTITY_FIELDS) {
      if (a >= b) continue
      const lines = [...fieldsByLine.values()].filter(s => s.has(a) && s.has(b)).length
      if (lines) shapeOverlap[`${a}+${b}`] = lines
    }
  }
  return {
    comparisons: entries.length, lines: lineKeys(entries).size, ...groups,
    definitionIdentities: [...new Set(definitions.map(e => e.identity))].sort(),
    byShape, shapeOverlap,
  }
}
/** 按身份 id 去重：每个 id 的比较数/行数/涉及分类（重复比较表达式 = DRY 候选，≠ 迁移批次数） */
export function groupByIdentity(entries) {
  const map = new Map()
  for (const e of entries) {
    const key = e.identity === null ? '<dynamic>' : e.identity
    const cur = map.get(key) ?? { identity: key, comparisons: 0, lines: new Set(), categories: new Set() }
    cur.comparisons += 1
    cur.lines.add(`${e.file}:${e.line}`)
    cur.categories.add(e.category)
    map.set(key, cur)
  }
  return [...map.values()]
    .map(({ identity, comparisons, lines, categories }) => ({
      identity, comparisons, lines: lines.size, categories: [...categories].sort(),
    }))
    .sort((a, b) => b.comparisons - a.comparisons || String(a.identity).localeCompare(String(b.identity)))
}
/**
 * 度量面的源码读取（与 `check-guards.listAgentBranchFiles()` 同源——扫面绝不另写一份）。
 *
 * 取数纪律（照抄 `AGENT_BRANCH_BASELINE` 的既有纪律）：**基线必须量提交态**。
 * 本仓高频并行会话，工作树里常有别人迁移中途的 WIP——量它会得到会变的假数
 * （实测：2026-09-17 14:52 另一会话正在删 `convergence.ts` 的判据，工作树 15 而 HEAD 17）。
 * 故**默认 HEAD**（可复现、可对账），`--worktree` 显式量当前真实状态（迁移中途自看进度用）。
 */
export function readIdentitySources(root = resolve(dirname(fileURLToPath(import.meta.url)), '..'), options = {}) {
  const atHead = options.atHead !== false   // 默认 HEAD；显式 { atHead: false } 才量工作树
  return listAgentBranchFiles(root).map(file => {
    if (!atHead) return { file, content: readFileSync(resolve(root, file), 'utf8'), source: 'worktree' }
    try {
      return {
        file,
        content: execFileSync('git', ['show', `HEAD:${file}`], { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }),
        source: 'HEAD',
      }
    } catch {
      // 新文件（未提交）/ 无 git ⇒ 回退工作树，不静默丢文件；但**如实标注**该文件不是 HEAD 读数
      return { file, content: readFileSync(resolve(root, file), 'utf8'), source: 'worktree-fallback' }
    }
  })
}
export function reportIdentity(root = resolve(dirname(fileURLToPath(import.meta.url)), '..'), options = {}) {
  const requestedHead = options.atHead !== false
  const sources = readIdentitySources(root, { atHead: requestedHead })
  // 取数面如实上报：只要有一个文件回退了（未提交/无 git），就不能声称「这是 HEAD 读数」
  const fellBack = sources.filter(s => s.source === 'worktree-fallback').length
  const measuredAt = !requestedHead ? 'worktree' : fellBack === 0 ? 'HEAD' : fellBack === sources.length ? 'worktree' : 'mixed'
  let legacyLines = 0
  const entries = []
  const blindSpots = []
  const nonCharacterIds = []
  const legacySet = new Set()
  for (const { file, content } of sources) {
    legacyLines += countAgentIdBranchLines(content)
    content.split('\n').forEach((l, i) => {
      const t = l.trim()
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return
      if (/agentId\s*(===|!==)/.test(l)) legacySet.add(`${file}:${i + 1}`)
    })
    const scanned = scanIdentitySource(content, file)
    entries.push(...scanned.entries)
    blindSpots.push(...scanned.blindSpots)
    nonCharacterIds.push(...scanned.nonCharacterIds)
  }
  const summary = summarizeIdentity(entries)
  const businessLines = new Set(entries.filter(e => e.category === 'business').map(e => `${e.file}:${e.line}`))
  summary.deltaVsLegacy = {
    businessLinesBeyondLegacyRuler: [...businessLines].filter(k => !legacySet.has(k)).length,
    legacyLinesNotBusiness: [...legacySet].filter(k => !businessLines.has(k)).length,
  }
  // 身份字面量的**数据面**对账（规则 15：跨实体断言必须查证，不凭名字联想）：
  // 每个字面量是否能被 catalog 解析成角色 id / teammateBuffId。解析不到的值单独列出，
  // 由人判定「死别名 / 未来值 / 误报」——脚本只报不判、不进任何计数。
  const catalog = loadCatalogIdentities(root)
  const resolve = value => (catalog ? resolveIdentityValue(catalog, value) : 'no-catalog')
  const identityValues = groupByIdentity(entries).map(i => ({ ...i, resolves: resolve(i.identity) }))
  // 角色判定合计（机器可复算，不硬编码数字）：业务判定行 ∪ 待核存储标志行
  // —— 后者是 unknown，但身份字面量在 catalog 里能解析成角色 ⇒ 只可能是角色判定；
  //    **仍单独列出待人工确认**（规则 17⑥：先分类，再定计量单位），不自动并进业务数。
  const unresolvedValues = new Set(identityValues.filter(i => i.resolves === 'unresolved').map(i => i.identity))
  const reviewable = entries.filter(e =>
    e.category === 'unknown' && e.identity !== null
    // 解析成功、或同值在别处解析失败但在存储标志上（如 'remielle' ⇒ 别名，人工已核）
    && (resolve(e.identity) === 'agent.id' || resolve(e.identity) === 'teammateBuffId'))
  const characterLines = new Set([...businessLines, ...reviewable.map(e => `${e.file}:${e.line}`)])
  summary.characterJudgment = {
    lines: characterLines.size,
    businessLines: businessLines.size,
    reviewableUnknownLines: new Set(reviewable.map(e => `${e.file}:${e.line}`)).size,
    newBeyondLegacy: [...characterLines].filter(k => !legacySet.has(k)).length,
    legacyLines: legacySet.size,
    unresolvedIdentityValues: [...unresolvedValues],
    // 非角色 `.id` 比较（moveId/dataId/overrideId/rowId 族）：**不并入**执行尺，但逐个露面
    nonCharacterUnknownLines: new Set(nonCharacterIds.map(e => `${e.file}:${e.line}`)).size,
  }
  return { measuredAt, fellBack, legacyLines, summary, byIdentity: identityValues, entries, blindSpots, nonCharacterIds }
}
/** catalog 里的可解析身份值（agent.id + agent.teammateBuffId）；缺文件返回 null（只报不红） */
function loadCatalogIdentities(root) {
  const path = resolve(root, 'public/static/catalog.json')
  if (!existsSync(path)) return null
  const agents = JSON.parse(readFileSync(path, 'utf8')).agents ?? []
  const ids = new Set(), buffIds = new Set()
  for (const a of agents) {
    if (a.id) ids.add(String(a.id))
    if (a.teammateBuffId) buffIds.add(String(a.teammateBuffId))
  }
  return { ids, buffIds }
}
function resolveIdentityValue({ ids, buffIds }, value) {
  if (value === '<dynamic>') return 'dynamic'
  if (ids.has(value)) return 'agent.id'
  if (buffIds.has(value)) return 'teammateBuffId'
  return 'unresolved'
}
const CATEGORY_LABEL = { business: '业务判定', definition: '纯身份定义', unknown: '无法自动分类' }
export function formatMarkdown(report) {
  const { measuredAt, fellBack, legacyLines, summary, byIdentity, entries, blindSpots, nonCharacterIds = [] } = report
  const out = []
  const SURFACE = {
    HEAD: 'HEAD 提交态（默认；抗并行会话 WIP）',
    worktree: '工作树（当前真实状态，可能含并行会话迁移中途的 WIP）',
    mixed: `混合（${fellBack} 个文件未提交/无 git，已回退工作树读）`,
  }
  out.push(`# T8 身份判定分类报告（只读，不改运行时）`, '')
  out.push(`- 取数面：**${SURFACE[measuredAt] ?? measuredAt}**（进度自看用 \`--worktree\`）`)
  out.push(`- 旧口径（正则，**已不作为棘轮判据**）：**${legacyLines}** 行`)
  out.push(`- **执行尺（AST 三形态，= \`AGENT_BRANCH_BASELINE\`）：${summary.lines} 行** / ${summary.comparisons} 比较表达式`)
  for (const category of ['business', 'definition', 'unknown']) {
    out.push(`  - ${CATEGORY_LABEL[category]}：**${summary[category].lines}** 行 / ${summary[category].comparisons} 表达式`)
  }
  out.push(`- 旧尺之外的新增业务判定：**${summary.deltaVsLegacy.businessLinesBeyondLegacyRuler}** 行`
    + `（旧尺行不属于业务判定的：${summary.deltaVsLegacy.legacyLinesNotBusiness}）`)
  const cj = summary.characterJudgment
  out.push(`- **角色判定合计 ${cj.lines} 行** = 业务判定 ${cj.businessLines} + 待人工确认的存储标志 `
    + `${cj.reviewableUnknownLines}（= ${legacyLines} 旧尺 + **${cj.newBeyondLegacy} 新增**）`)
  out.push(`- 非角色 \`.id\` 比较（moveId/dataId/overrideId/rowId 族）${cj.nonCharacterUnknownLines} 条`
    + `—— **不属本尺**，另列观察项、不并入也不删除`)
  if (cj.unresolvedIdentityValues.length) {
    out.push(`- ⚠ catalog 解析不到的身份字面量：${cj.unresolvedIdentityValues.map(v => `\`${v}\``).join('、')}`
      + `（人工已核：见报告；脚本不判死活）`)
  }
  out.push(`- 按身份去重：${byIdentity.filter(i => i.identity !== '<dynamic>').length} 个角色 id`
    + `（最高频 ${byIdentity.slice(0, 3).map(i => `${i.identity}×${i.comparisons}`).join(' / ')}）`)
  const shapeParts = Object.entries(summary.byShape).map(([k, g]) => `${k} ${g.lines} 行`)
  const overlapParts = Object.entries(summary.shapeOverlap).map(([k, n]) => `${k} 同行 ${n} 行`)
  out.push(`- 按形态：${shapeParts.join(' · ')}${overlapParts.length ? `（重叠：${overlapParts.join('、')} ⇒ 形态数不可相加）` : ''}`, '')
  const unresolved = byIdentity.filter(i => i.resolves === 'unresolved')
  if (unresolved.length) {
    out.push(`## ⚠ 数据面解析不到的身份字面量（${unresolved.length} 个，只报不判，不进计数）`, '')
    out.push('这些字面量**既不是 catalog 的 `agent.id` 也不是任何 `teammateBuffId`**'
      + '（解析口径见 `loadCatalogIdentities`）。可能是死别名，也可能是未来/测试值 —— 由人判定，脚本不猜。', '')
    for (const i of unresolved) out.push(`- \`${i.identity}\` × ${i.comparisons} 比较 / ${i.lines} 行（${i.categories.join('+')}）`)
    out.push('')
  }
  for (const category of ['business', 'definition', 'unknown']) {
    const list = entries.filter(e => e.category === category)
    out.push(`## ${CATEGORY_LABEL[category]}（${list.length} 表达式 / ${group(list).lines} 行）`, '')
    for (const e of list) {
      const trail = e.consumers && e.consumers.length ? ` → 消费者行 ${e.consumers.join(',')}` : ''
      out.push(`- \`${e.file}:${e.line}:${e.column}\` [${e.field}] \`${e.text}\` — ${e.reason}${trail}`)
    }
    out.push('')
  }
  if (blindSpots.length) {
    out.push(`## 观察项·别名盲区（**不计入任何度量**，${blindSpots.length} 条）`, '')
    for (const b of blindSpots) out.push(`- \`${b.file}:${b.line}:${b.column}\` \`${b.text}\` — ${b.reason}`)
    out.push('')
  }
  if (nonCharacterIds.length) {
    out.push(`## 观察项·非角色 \`.id\` 比较（**不计入任何度量**，${nonCharacterIds.length} 条）`, '')
    out.push('招式/数据行查找（`.id === moveId` / `r.id === rowId` 族）：换尺时曾把它们误计成角色判定'
      + '（不设限 49 行 → 加限 42 行），故单列在此，既不并入也不删除。', '')
    for (const e of nonCharacterIds) {
      out.push(`- \`${e.file}:${e.line}:${e.column}\` \`${e.text}\`${e.identity === null ? '（动态值）' : `（非四位字符串 \`${e.identity}\`）`}`)
    }
    out.push('')
  }
  return out.join('\n')
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = reportIdentity(undefined, { atHead: !process.argv.includes('--worktree') })
  console.log(process.argv.includes('--md') ? formatMarkdown(report) : JSON.stringify(report, null, 2))
}
