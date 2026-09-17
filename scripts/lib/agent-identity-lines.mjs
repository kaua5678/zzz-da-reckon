/**
 * 编排层「角色身份判定」检测面（AST 单源）。
 *
 * 为什么单独一个 lib（2026-09-17 round 19 换尺批，T8）：
 * 棘轮的旧尺是正则 `/agentId\s*(===|!==)/`，它**系统性漏计**两种同义形态——
 * `agent?.id === '1581'` 与 `agent.teammateBuffId === 'remielle'`。实测（T48 报告
 * `/home/kaua/.dsh/session-manager/reports/T48-a2.md`）：被计数的 15 行之外，
 * **另有 27 行同样是角色判定却完全不被计数**，且新写的 `.id ===` 特判永远不会被拦
 * ——棘轮的「只减不增」对它无效。故按规则 17②（度量口径纠正不适用「棘轮只减不增」）
 * 与规则 17⑥（先分类，再定计量单位）换尺：**执行尺 = 本文件**，分类/证据留在报告脚本。
 *
 * 计量单位（三句话，不要混用）：
 *  · **比较表达式数** = 命中比较的条数（同一行两个形态 = 2）。
 *  · **行数** = 按 `文件:行` 去重的条数（= 棘轮用的单位，与旧正则「按行计」的语义对齐）。
 *  · **迁移批次数** ≠ 行数：同一 `find/filter` 里往往一行多个形态，DRY 收敛与迁移是两件事。
 *
 * 纳入尺度的形态（**纯句法，不做符号解析**）：
 *  · `agentId` / `teammateBuffId`：与任何值比较即计（这两个字段名在本仓只有身份一种用法；
 *    动态值同样是身份判定，故 `identity === null` 仍留在执行尺里，报告脚本单列给人看）。
 *  · `id`：**仅当另一侧是四位数字字面量**才计——`.id` 在本仓还用于招式/数据行
 *    （`move.id === moveId` / `m.id === rowId` 族），不设限会把它们误计成角色判定
 *    （换尺实测：不设限 49 行，加限后 **42** 行，差的 7 行全是招式查找，见 `scanNonCharacterIds`）。
 *
 * 明确**不**纳入（各自有理由，别偷偷加宽）：
 *  · 局部别名（`fillerAgentId === '1051'`）：既非三形态也不被旧尺计，报告脚本作观察项。
 *  · 注释与字符串里的同形文本：AST 天然不含（旧正则靠「行首是否注释标记」的启发式，
 *    块注释中间的行若不以 `*` 开头就会漏计）。
 *
 * ⚠ 本文件是**检测面的唯一实现**：`check-guards`（棘轮）与 `report-agent-identity`
 *   （分类报告）都从这里 import，不各写一份 visitor（规则 11）。
 */
import ts from 'typescript'

/** 棘轮度量的三种身份形态（唯一事实源；报告脚本从这里 import，不复制一份） */
export const IDENTITY_FIELDS = ['agentId', 'id', 'teammateBuffId']
const fields = new Set(IDENTITY_FIELDS)
const comparisonKinds = new Set([
  ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken,
])
/** 角色 agentId 是四位数字；`.id` 的其它字符串（'basic'/'anomaly_buildup'）不是身份 */
export const CHARACTER_ID = /^\d{4}$/

/** 剥掉括号 / as / 非空断言，露出真正的接收者 */
export function unwrapIdentityNode(n) {
  while (ts.isParenthesizedExpression(n) || ts.isAsExpression(n) || ts.isNonNullExpression(n)) n = n.expression
  return n
}

/** 接收者上的身份字段名（`.agentId` / `.id` / `.teammateBuffId` / `['agentId']` / 裸标识符） */
export function identityFieldOf(node) {
  const n = unwrapIdentityNode(node)
  if (ts.isIdentifier(n)) return fields.has(n.text) ? n.text : null
  if (ts.isPropertyAccessExpression(n)) return fields.has(n.name.text) ? n.name.text : null
  if (ts.isElementAccessExpression(n) && ts.isStringLiteral(n.argumentExpression)) {
    return fields.has(n.argumentExpression.text) ? n.argumentExpression.text : null
  }
  return null
}

/** 局部别名形态（`fillerAgentId === '1051'`）：观察项，**不进执行尺** */
export function identityAliasOf(node) {
  const n = unwrapIdentityNode(node)
  const name = ts.isIdentifier(n) ? n.text
    : ts.isPropertyAccessExpression(n) ? n.name.text
      : null
  return name && name !== 'agentId' && /agentId$/i.test(name) ? name : null
}

/** 裸比较的比较名 + 另一侧字面量（不做任何分类；`literal === null` = 动态值） */
function bareComparison(node) {
  if (!ts.isBinaryExpression(node) || !comparisonKinds.has(node.operatorToken.kind)) return null
  const left = identityFieldOf(node.left), right = identityFieldOf(node.right)
  const field = left || right
  if (!field) return null
  const other = unwrapIdentityNode(left ? node.right : node.left)
  return { field, literal: ts.isStringLiteralLike(other) ? other.text : null }
}

/**
 * 单节点判定：角色身份比较（供报告的分类逻辑复用，别在报告里重写一份）。
 * `null` = 不是身份比较；`.id` 非四位数字字面量（招式/数据行）也返回 null —— 那些走 `isNonCharacterIdComparison`。
 */
export function identityComparison(node) {
  const bare = bareComparison(node)
  if (!bare) return null
  if (bare.field === 'id' && (bare.literal === null || !CHARACTER_ID.test(bare.literal))) return null
  return { field: bare.field, identity: bare.literal }
}

/** 观察项判定：`.id` 与动态值/普通字符串比较（moveId/dataId/overrideId/rowId 族）——不进度量 */
export function isNonCharacterIdComparison(node) {
  const bare = bareComparison(node)
  return !!bare && bare.field === 'id' && (bare.literal === null || !CHARACTER_ID.test(bare.literal))
}

function positionOf(source, node) {
  const { line, character } = source.getLineAndCharacterOfPosition(node.getStart(source))
  return { line: line + 1, column: character + 1 }
}

/**
 * 一次遍历产出三类**节点级**命中（报告脚本要在节点上做分类/追消费者，故必须给 node）：
 *  · `identity` = 执行尺输入（角色身份判定）
 *  · `nonCharacter` = 观察项（非角色 `.id` 比较：动态 7 + 非四位字符串 10）
 *  · `aliases` = 观察项（局部别名 `fillerAgentId === '1051'`，既非三形态也不被旧尺计）
 * 单一 visitor：`check-guards`（只数）与报告脚本（分类/证据）都从这里取，不各写一份（规则 11）。
 */
export function scanIdentityNodes(content, file = 'fixture.ts') {
  const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true)
  const identity = []
  const nonCharacter = []
  const aliases = []
  const visit = node => {
    if (ts.isBinaryExpression(node) && comparisonKinds.has(node.operatorToken.kind)) {
      const match = identityComparison(node)
      if (match) {
        identity.push({ node, ...match })
      } else if (isNonCharacterIdComparison(node)) {
        const bare = bareComparison(node)
        nonCharacter.push({ node, field: bare.field, identity: bare.literal })
      } else {
        // 别名形态：一侧是「以 agentId 结尾但不是身份形态」的名字，另一侧是四位数字字面量
        const l = identityAliasOf(node.left), r = identityAliasOf(node.right)
        const alias = l || r
        const other = unwrapIdentityNode(l ? node.right : node.left)
        if (alias && ts.isStringLiteralLike(other) && CHARACTER_ID.test(other.text)) {
          aliases.push({ node, alias, identity: other.text })
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return { source, identity, nonCharacter, aliases }
}

/**
 * 扁平化命中（`{ file, line, column, field, identity, text }`）：`check-guards` 与报告的展示面用。
 * 与 `scanIdentityNodes` 同一 visitor（本函数就是它的投影），不存在第二份判定逻辑。
 */
export function scanIdentitySurface(content, file = 'fixture.ts') {
  const { source, identity, nonCharacter } = scanIdentityNodes(content, file)
  const flat = hits => hits.map(h => ({
    file, ...positionOf(source, h.node), field: h.field, identity: h.identity, text: h.node.getText(source),
  }))
  return { comparisons: flat(identity), nonCharacter: flat(nonCharacter) }
}

/** 执行尺输入：角色身份判定（同一行多形态会产生多条） */
export function scanIdentityComparisons(content, file = 'fixture.ts') {
  return scanIdentitySurface(content, file).comparisons
}

/** 观察项：非角色 `.id` 比较（moveId/dataId/overrideId/rowId 族）——**不进任何度量** */
export function scanNonCharacterIdComparisons(content, file = 'fixture.ts') {
  return scanIdentitySurface(content, file).nonCharacter
}

/** 执行尺：按「文件:行」去重的角色判定行数 */
export function countIdentityBranchLines(content) {
  return new Set(scanIdentityComparisons(content).map(e => e.line)).size
}

/** 执行尺（多文件求和；`read` 注入取数方式，便于量工作树或 HEAD） */
export function countIdentityBranchLinesInFiles(files, read) {
  return files.reduce((n, f) => n + countIdentityBranchLines(read(f)), 0)
}
