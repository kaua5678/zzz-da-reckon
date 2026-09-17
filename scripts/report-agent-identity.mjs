/**
 * T8 identity inventory: read-only evidence, NOT the enforcing ratchet.
 * Scope and legacy count are imported from check-guards (one source of truth).
 * Unit = comparison occurrence; line totals are separately deduplicated. Never add them.
 * Pure named identity definitions are distinguished from business uses (including
 * find/filter callbacks). Unknown forms remain visible, never silently exempted.
 * Limits: syntax only, not symbol/type resolution; dynamic keys/indirect aliases
 * are unknown. This report does not claim complete semantic branch coverage.
 */
import ts from 'typescript'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { countAgentIdBranchLines, listAgentBranchFiles } from './check-guards.mjs'

const fields = new Set(['agentId', 'id', 'teammateBuffId'])
const comparisonKinds = new Set([
  ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken,
])
const unwrap = n => {
  while (ts.isParenthesizedExpression(n) || ts.isAsExpression(n) || ts.isNonNullExpression(n)) n = n.expression
  return n
}
function fieldOf(node) {
  const n = unwrap(node)
  if (ts.isIdentifier(n)) return fields.has(n.text) ? n.text : null
  if (ts.isPropertyAccessExpression(n)) return fields.has(n.name.text) ? n.name.text : null
  if (ts.isElementAccessExpression(n) && ts.isStringLiteral(n.argumentExpression)) {
    return fields.has(n.argumentExpression.text) ? n.argumentExpression.text : null
  }
  return null
}
function comparison(node) {
  if (!ts.isBinaryExpression(node) || !comparisonKinds.has(node.operatorToken.kind)) return null
  const left = fieldOf(node.left), right = fieldOf(node.right)
  if (!left && !right) return null
  const field = left || right
  const other = unwrap(left ? node.right : node.left)
  const literal = ts.isStringLiteralLike(other) ? other.text : null
  // Generic .id comparisons are not necessarily character identities.
  if (field === 'id' && literal !== null && !/^\d{4}$/.test(literal)) return null
  return { field, identity: literal }
}
function pureIdentity(node) {
  const n = unwrap(node)
  const match = comparison(n)
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
export function scanIdentitySource(content, file = 'fixture.ts') {
  const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true)
  const entries = []
  function visit(node) {
    const match = comparison(node)
    if (match) {
      const start = node.getStart(source)
      const { line, character } = source.getLineAndCharacterOfPosition(start)
      const kind = match.identity === null
        ? { category: 'unknown', reason: 'dynamic comparison value needs symbol resolution' }
        : classification(node)
      entries.push({ file, line: line + 1, column: character + 1, ...match, ...kind, text: node.getText(source) })
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return entries
}
export function summarizeIdentity(entries) {
  const lineCount = list => new Set(list.map(e => `${e.file}:${e.line}`)).size
  const groups = Object.fromEntries(['business', 'definition', 'unknown'].map(category => {
    const list = entries.filter(e => e.category === category)
    return [category, { comparisons: list.length, lines: lineCount(list) }]
  }))
  const definitions = entries.filter(e => e.category === 'definition')
  return {
    comparisons: entries.length, lines: lineCount(entries), ...groups,
    definitionIdentities: [...new Set(definitions.map(e => e.identity))].sort(),
  }
}
export function reportIdentity(root = resolve(dirname(fileURLToPath(import.meta.url)), '..')) {
  let legacyLines = 0
  const entries = []
  for (const file of listAgentBranchFiles(root)) {
    const content = readFileSync(resolve(root, file), 'utf8')
    legacyLines += countAgentIdBranchLines(content)
    entries.push(...scanIdentitySource(content, file))
  }
  return { legacyLines, summary: summarizeIdentity(entries), entries }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(reportIdentity(), null, 2))
}
