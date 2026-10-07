/**
 * 判据 28：死兜底硬门（r723，2026-10-07）——src 非测试 `.ts` 里，左侧类型不含 null / undefined 的 `a ?? b` 不许写。
 *
 * 为什么需要：
 *   r723 用 TS 类型检查器普查 origin/master `bcb12bfe`：src 非测试 .ts 有 871 处这种 `??`（127 个文件）——右侧永远取不到，
 *   却把「必填」契约写成了「可能缺」，同一字段还散着不同默认值（般岳 `cfg.blockCount ?? 0` 与 `?? DEFAULT_BLOCK` 并存；
 *   战斗时间 `?? 180` 写了 36 处）。读代码的人分不清哪些值真会缺，写模块的人（含低级模型）照抄习惯越写越多，
 *   评审拦不住。r723 删了引擎内部契约上的 800 处，并把 CharacterOperationConfig 里 buildCharConfig 恒写的 19 个字段改成必填。
 *   普查与逐类判断见 docs/mcp-dead-nullish-census.md。
 *
 * 规则（TS 类型检查器；program = tsconfig.app.json 里的 .ts 文件，与判据 29 共用，见 ./app-program.mjs）：
 *   · `a ?? b`，a 去括号后是「声明过的属性访问」（非可选链 `?.`；声明 = 属性签名 / 属性声明 / 对象字面量属性 / 参数属性）
 *     或标识符，且 a 在该位置的类型（含控制流收窄）不含 null / undefined / any / unknown / void / never / 类型参数 /
 *     索引访问 / 条件类型 ⇒ 违规。
 *   · 不管：元素访问 `a[k] ?? b`（未开 noUncheckedIndexedAccess，`Record<string, T>` 的取值类型不含 undefined 但运行时可缺）；
 *     走索引签名的点访问（同理）；调用结果 `f() ?? b`；`||`（0 / '' 也会取右侧，是另一种语义）。
 *   · 不设豁免（r725 删除信任边界表）：TS 管不到的入口只有 JSON（`res.json() as T`、`import.meta.glob` 转型），
 *     validate:data 按代码转型用的类型逐字段校验全部 JSON 入口、漏登记的入口即红（scripts/lib/json-contract.mjs）；
 *     浏览器存储与文件导入都过解析函数。所以类型说必填就是必填。r723–r724 的豁免表（126 → 59 处）见 census §4。
 *   · 扫 `src/**` 的 .ts（不含 .d.ts、*.test.ts、*.perf.ts、任何 `__tests__/`、测试基建 `src/test/`）。
 *     `.vue` 不扫（要 vue-tsc 的类型信息）。反空洞：扫描文件数 < `DEAD_NULLISH_MIN_FILES` 视为目录没扫到，判据失败。
 *
 * 报错时怎么改：值确实总在 ⇒ 删掉 `?? 默认值`，默认值只留在源头（store 默认 / buildCharConfig / emptyPanel）；
 *   值真的可能缺 ⇒ 改类型（字段加 `?`），让每个读点都看见。别为了过门把 `??` 换成 `||` / 三元 / `=== undefined`——
 *   那是同一个谎换个写法。外部 JSON 的字段真会缺 ⇒ 同样改类型（validate:data 的契约校验会告诉你数据实况）。
 */
import { createRequire } from 'node:module'
import { dirname, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { appTsProgram, isAppTsScanned } from './app-program.mjs'

const require = createRequire(import.meta.url)
const ts = require('typescript')
/** 仓库根（从 `scripts/lib/` 上溯三级；与 check-guards.mjs 的 ROOT 同值） */
const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
export const DEAD_NULLISH_BASELINE = 0
/** 反空洞下限：2026-10-07 实测扫到 src 非测试 .ts 共 296 个（下限取约 85%） */
export const DEAD_NULLISH_MIN_FILES = 250

const NULLISH = ts.TypeFlags.Null | ts.TypeFlags.Undefined | ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.Void
  | ts.TypeFlags.Never | ts.TypeFlags.TypeParameter | ts.TypeFlags.IndexedAccess | ts.TypeFlags.Conditional
  | ts.TypeFlags.Substitution | ts.TypeFlags.Index
const mayBeNullish = (t) => (t.flags & NULLISH) !== 0 || (t.isUnion() && t.types.some(mayBeNullish))
const isPropDecl = (d) => ts.isPropertySignature(d) || ts.isPropertyDeclaration(d) || ts.isPropertyAssignment(d)
  || ts.isShorthandPropertyAssignment(d) || ts.isParameter(d)

/** 属性声明 → owner 名（具名接口 / 类 / 类型别名；匿名字面量类型 = null） */
function ownerOf(decl) {
  const p = decl.parent
  if (p && (ts.isInterfaceDeclaration(p) || ts.isClassDeclaration(p)) && p.name) return p.name.text
  if (p && ts.isTypeLiteralNode(p) && p.parent && ts.isTypeAliasDeclaration(p.parent)) return p.parent.name.text
  return null
}

/**
 * 一个 program 里的死兜底。`isScanned(rel)` 决定哪些源文件参与；返回 { sites, scanned }。
 * sites: [{ file, line, owner, prop, type, text }]
 */
export function findDeadNullish(program, { root = ROOT, isScanned } = {}) {
  const checker = program.getTypeChecker()
  const sites = []
  let scanned = 0
  for (const sf of program.getSourceFiles()) {
    if (sf.isDeclarationFile) continue
    const rel = relative(root, sf.fileName).split(sep).join('/')
    if (!isScanned(rel)) continue
    scanned++
    const visit = (n) => {
      if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) {
        let left = n.left
        while (ts.isParenthesizedExpression(left)) left = left.expression
        let owner = null, prop = null, hit = false
        if (ts.isPropertyAccessExpression(left) && !ts.isOptionalChain(left)) {
          const decl = checker.getSymbolAtLocation(left.name)?.declarations?.[0]
          if (decl && isPropDecl(decl)) {
            hit = true
            owner = ownerOf(decl)
            prop = left.name.text
          }
        } else if (ts.isIdentifier(left)) {
          hit = true
          prop = left.text
        }
        if (hit && !mayBeNullish(checker.getTypeAtLocation(left))) {
          const line = sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1
          sites.push({ file: rel, line, owner: owner ?? (ts.isIdentifier(left) ? '(局部)' : '(匿名)'), prop,
            type: checker.typeToString(checker.getTypeAtLocation(left)).slice(0, 40),
            text: n.getText(sf).replace(/\s+/g, ' ').slice(0, 100) })
        }
      }
      ts.forEachChild(n, visit)
    }
    visit(sf)
  }
  return { sites, scanned }
}

/** 自证：内存里的一份小程序（noLib，免加载 lib.d.ts），正例 / 反例各覆盖一次 */
export function deadNullishSelfTest() {
  const failures = []
  const file = '/__dead_nullish_selftest__/a.ts'
  const code = [
    'interface Cfg { a: number; b?: number; c: number | undefined; s: string }', // 1
    'declare const cfg: Cfg', // 2
    'declare const opt: Cfg | undefined', // 3
    'declare const rec: { [k: string]: number }', // 4
    'declare function f(): number', // 5
    'declare let n: number', // 6
    'declare let m: number | null', // 7
    'export const x1 = cfg.a ?? 0', // 8 违规：必填 number
    'export const x2 = cfg.b ?? 0', // 9 可选
    'export const x3 = cfg.c ?? 0', // 10 含 undefined
    'export const x4 = opt?.a ?? 0', // 11 可选链
    "export const x5 = rec.k ?? 0", // 12 索引签名
    "export const x6 = rec['k'] ?? 0", // 13 元素访问
    'export const x7 = n ?? 1', // 14 违规：标识符 number
    'export const x8 = m ?? 1', // 15 含 null
    'export const x9 = f() ?? 1', // 16 调用结果不管
    'export function g(p: Cfg) { if (p.b === undefined) return 0; return p.b ?? 2 }', // 17 违规：收窄后 number
    "export const x10 = (cfg.s ?? '')", // 18 违规：string
    '// export const x11 = cfg.a ?? 0', // 19 注释
  ].join('\n')
  const options = { strict: true, noEmit: true, noLib: true, types: [] }
  const host = ts.createCompilerHost(options)
  const getSourceFile = host.getSourceFile.bind(host)
  host.getSourceFile = (f, lang, ...rest) => (f === file ? ts.createSourceFile(f, code, ts.ScriptTarget.Latest, true) : getSourceFile(f, lang, ...rest))
  host.fileExists = (f) => f === file
  host.readFile = (f) => (f === file ? code : undefined)
  const program = ts.createProgram({ rootNames: [file], options, host })
  const r = findDeadNullish(program, { root: '/__dead_nullish_selftest__', isScanned: () => true })
  const got = r.sites.map((s) => s.line).join(',')
  if (got !== '8,14,17,18') failures.push(`命中行应为 8,14,17,18，实为 ${got}：${JSON.stringify(r.sites.map((s) => s.text))}`)
  return { ok: failures.length === 0, failures }
}

/** 全 src 扫描（判据 28；program 与扫描面和判据 29 共用） */
export function scanDeadNullish(root = ROOT) {
  const selfTest = deadNullishSelfTest()
  const program = appTsProgram(root)
  if (!program) return { count: 0, sites: [], scanned: 0, selfTest, belowFloor: true, ok: false }
  const { sites, scanned } = findDeadNullish(program, { root, isScanned: isAppTsScanned })
  const belowFloor = scanned < DEAD_NULLISH_MIN_FILES
  return { count: sites.length, sites, scanned, selfTest, belowFloor,
    ok: sites.length === DEAD_NULLISH_BASELINE && selfTest.ok && !belowFloor }
}

export function formatDeadNullish(report) {
  const lines = []
  if (!report.selfTest.ok) lines.push('  ✗ detector 自证失败：', ...report.selfTest.failures.map((f) => '    ' + f))
  if (report.belowFloor) lines.push(`  ✗ 只扫到 ${report.scanned} 个文件（下限 ${DEAD_NULLISH_MIN_FILES}）：tsconfig.app.json 的 include 变了？`)
  if (report.count > DEAD_NULLISH_BASELINE) {
    lines.push(`  ✗ ${report.count} 处死兜底：\`a ?? b\` 的 a 类型不含 null/undefined（右侧永远取不到，却让读者以为值会缺）：`)
    lines.push('    → 值确实总在 ⇒ 删掉 `?? 默认值`（默认值只留在源头：store 默认 / buildCharConfig / emptyPanel）')
    lines.push('    → 值真的可能缺 ⇒ 字段改成可选（加 `?`），让每个读点都看见；别换成 `||` / 三元 / `=== undefined` 绕门')
    lines.push('    → 值来自 JSON ⇒ 类型由 validate:data 契约校验（scripts/lib/json-contract.mjs），数据真会缺就同样改可选')
    for (const s of report.sites.slice(0, 20)) lines.push(`      ${s.file}:${s.line}  [${s.owner}.${s.prop}: ${s.type}]  ${s.text}`)
  }
  return lines
}
