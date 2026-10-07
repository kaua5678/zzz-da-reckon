/**
 * 判据 28：死兜底硬门（r723，2026-10-07；r731 扩到可选链；r732 起判调用结果）——src 非测试 `.ts` 里，对类型不含 null / undefined 的值
 * 不许写空值处理：`a ?? b`（右侧永远取不到）与 `a?.b` / `a?.[k]` / `f?.()`（短路永远不发生）。
 *
 * 为什么需要：
 *   r723 用 TS 类型检查器普查 origin/master `bcb12bfe`：src 非测试 .ts 有 871 处这种 `??`（127 个文件）——右侧永远取不到，
 *   却把「必填」契约写成了「可能缺」，同一字段还散着不同默认值（般岳 `cfg.blockCount ?? 0` 与 `?? DEFAULT_BLOCK` 并存；
 *   战斗时间 `?? 180` 写了 36 处）。读代码的人分不清哪些值真会缺，写模块的人（含低级模型）照抄习惯越写越多，
 *   评审拦不住。r723 删了引擎内部契约上的 800 处，并把 CharacterOperationConfig 里 buildCharConfig 恒写的 19 个字段改成必填。
 *   r731：`?.` 是同一句话的另一种写法，而且会把后面的死 `??` 洗白——`threads.moduleFeedback?.x ?? 0` 里
 *   moduleFeedback 必填，但 `?.` 让左侧类型带上 undefined，只查 `??` 的门就看不见。普查 src 非测试 .ts：
 *   链头死 `?.` 320 处（声明过的属性 104 / 标识符 94 / 元素访问 122）、链内 76 处。普查与逐类判断见 docs/mcp-dead-nullish-census.md。
 *
 * 规则（TS 类型检查器；program = tsconfig.app.json 里的 .ts 文件，与判据 29 共用，见 ./app-program.mjs）：
 *   · 判的对象：`e ?? b` 的 e，`e?.x` / `e?.[k]` / `e?.()` 的 e（去括号）。两种写法共用一套口径（`subjectOf`）：
 *     - 声明过的属性访问 `o.p`（声明 = 属性签名 / 属性声明 / 对象字面量属性 / 参数属性）：取 e 在该位置的类型（含控制流收窄）；
 *     - 标识符：同上；
 *     - 调用结果 `f()`（不在可选链里）：取调用的类型（r732 起。此前豁免；r732 普查 src 非测试 .ts，调用结果上的死处理 0 处——
 *       豁免已经不买任何东西，留着只会让 `f() ?? 默认值` 从这里溜进来）；
 *     - 可选链内部（只对 `?.`）：`a?.p?.x` 的 `a?.p` 取 p 的声明类型——整条链已在 a 处短路，p 不含空则第二个 `?.` 永不生效，
 *       应写 `a?.p.x`。`??` 的左侧是可选链、`?.` 的接收者是加了括号（已断链）的 `(a?.p)`：不判——链头是元素访问时
 *       （`a[k]?.p ?? 0`）链的类型不带 undefined，但运行时会短路；链头本身是死 `?.` 时由那一节报，改掉后这里自然进判。
 *   · 类型不含 null / undefined / any / unknown / void / never / 类型参数 / 索引访问 / 条件类型 ⇒ 违规。
 *   · 不管：元素访问 `a[k]`（未开 noUncheckedIndexedAccess，`Record<string, T>` / `T[]` 的取值类型不含 undefined 但运行时可缺；
 *     r731 实测打开该选项 vue-tsc 报 2423 处，不开）；初值是元素访问或可选链的变量 `const x = a[k]` / `const y = a[k]?.p`
 *     （类型同样不带 undefined；r731 起两种写法都不判）；
 *     走索引签名的点访问（同理）；`||`（0 / '' 也会取右侧，是另一种语义）。
 *   · 不设豁免（r725 删除信任边界表）：TS 管不到的入口只有 JSON（`res.json() as T`、`import.meta.glob` 转型），
 *     validate:data 按代码转型用的类型逐字段校验全部 JSON 入口、漏登记的入口即红（scripts/lib/json-contract.mjs）；
 *     浏览器存储与文件导入都过解析函数。所以类型说必填就是必填。r723–r724 的豁免表（126 → 59 处）见 census §4。
 *     外部库类型说谎（lib.dom 的 `navigator.clipboard` 在非安全上下文实为 undefined）⇒ 在读点写诚实类型
 *     `const c: Clipboard | undefined = navigator.clipboard`，不加豁免。
 *   · 扫 `src/**` 的 .ts（不含 .d.ts、*.test.ts、*.perf.ts、任何 `__tests__/`、测试基建 `src/test/`）。
 *     `.vue` 不扫（要 vue-tsc 的类型信息）。反空洞：扫描文件数 < `DEAD_NULLISH_MIN_FILES` 视为目录没扫到，判据失败。
 *
 * 报错时怎么改：值确实总在 ⇒ 删掉 `?? 默认值`、把 `?.` 改成 `.`，默认值只留在源头（store 默认 / buildCharConfig / emptyPanel）；
 *   值真的可能缺 ⇒ 改类型（字段加 `?`），让每个读点都看见。别为了过门换成 `||` / 三元 / `=== undefined` / `&&`——
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
const unparen = (e) => { while (ts.isParenthesizedExpression(e)) e = e.expression; return e }

/** 属性声明 → owner 名（具名接口 / 类 / 类型别名；匿名字面量类型 = null） */
function ownerOf(decl) {
  const p = decl.parent
  if (p && (ts.isInterfaceDeclaration(p) || ts.isClassDeclaration(p)) && p.name) return p.name.text
  if (p && ts.isTypeLiteralNode(p) && p.parent && ts.isTypeAliasDeclaration(p.parent)) return p.parent.name.text
  return null
}

/** `const x = a[k]` / `const y = a[k]?.p`（初值去括号 / as / satisfies 后是元素访问或可选链）——与初值本身同样不判 */
function isUncheckedAlias(checker, id) {
  const d = checker.getSymbolAtLocation(id)?.declarations?.[0]
  if (!d || !ts.isVariableDeclaration(d) || !d.initializer) return false
  let init = d.initializer
  while (ts.isParenthesizedExpression(init) || ts.isAsExpression(init) || ts.isSatisfiesExpression(init)) init = init.expression
  return ts.isElementAccessExpression(init) || ts.isOptionalChain(init)
}

/**
 * 空值处理的对象 e 按什么判：返回 { owner, prop, type }，不判返回 null。`link` = e 是 `?.` 的接收者（否则是 `??` 的左侧）。
 */
function subjectOf(checker, e, link) {
  const inChain = link && ts.isOptionalChain(e)
  e = unparen(e)
  if (!inChain && ts.isOptionalChain(e)) return null
  if (ts.isPropertyAccessExpression(e)) {
    const sym = checker.getSymbolAtLocation(e.name)
    const decl = sym?.declarations?.[0]
    if (!decl || !isPropDecl(decl)) return null
    const type = inChain ? checker.getTypeOfSymbolAtLocation(sym, e) : checker.getTypeAtLocation(e)
    return { owner: ownerOf(decl) ?? '(匿名)', prop: e.name.text, type }
  }
  if (inChain) return null
  if (ts.isCallExpression(e)) return { owner: '(调用)', prop: e.expression.getText().replace(/\s+/g, ' ').slice(-40), type: checker.getTypeAtLocation(e) }
  if (!ts.isIdentifier(e) || isUncheckedAlias(checker, e)) return null
  return { owner: '(局部)', prop: e.text, type: checker.getTypeAtLocation(e) }
}

/**
 * 一个 program 里的死兜底。`isScanned(rel)` 决定哪些源文件参与；返回 { sites, scanned }。
 * sites: [{ file, line, form: '??' | '?.', owner, prop, type, text, node }]（node = `??` 二元式 / 带 `?.` 的那一节）
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
      let form = null, s = null
      if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) {
        form = '??'
        s = subjectOf(checker, n.left, false)
      } else if ((ts.isPropertyAccessExpression(n) || ts.isElementAccessExpression(n) || ts.isCallExpression(n)) && n.questionDotToken) {
        form = '?.'
        s = subjectOf(checker, n.expression, true)
      }
      if (s && !mayBeNullish(s.type)) {
        const line = sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1
        sites.push({ file: rel, line, form, owner: s.owner, prop: s.prop, type: checker.typeToString(s.type).slice(0, 40),
          text: n.getText(sf).replace(/\s+/g, ' ').slice(0, 100), node: n })
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
    'interface Cfg { a: number; b?: number; c: number | undefined; s: string; o: { v: number }; p?: { v: number } }', // 1
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
    'export const x9 = f() ?? 1', // 16 违规：调用结果 number（r732 起判）
    'export function g(p: Cfg) { if (p.b === undefined) return 0; return p.b ?? 2 }', // 17 违规：收窄后 number
    "export const x10 = (cfg.s ?? '')", // 18 违规：string
    '// export const x11 = cfg.a ?? 0', // 19 注释
    'declare const list: { [i: number]: Cfg }', // 20
    'const al = list[0]', // 21
    'export const y1 = cfg.o?.v', // 22 违规：o 必填
    'export const y2 = cfg.p?.v', // 23 p 可选
    'export const y3 = opt?.o?.v', // 24 违规（链内）：o 必填，整条链已在 opt 处短路
    'export const y4 = opt?.p?.v', // 25 链内 p 可选
    'export const y5 = (opt?.o)?.v', // 26 括号断链：(opt?.o) 可为 undefined
    'export const y6 = list[0]?.a', // 27 元素访问
    'export const y7 = al?.a', // 28 下标取值的别名，同元素访问
    'export const y8 = al ?? cfg', // 29 同上（`??` 同样豁免）
    'export function h(c: Cfg, fn: () => number) { return [c?.a, fn?.()] }', // 30 违规 ×2：参数必填
    'declare const ro: { r: { [k: string]: Cfg } }', // 31
    "export const y9 = ro.r?.['k']", // 32 违规：r 必填
    'export const y10 = list[0]?.a ?? 0', // 33 链头是元素访问：链的类型不带 undefined，但运行时会短路
    'const ac = list[0]?.o', // 34
    'export const y11 = ac?.v', // 35 初值是可选链的变量，同上
    'declare function fc(): Cfg', // 36
    'declare function fo(): Cfg | undefined', // 37
    'export const y12 = [fc()?.a, fo()?.a]', // 38 违规 ×1：fc() 不含空；fo() 可缺
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
  const want = '8,14,16,17,18,22,24,30,30,32,38'
  if (got !== want) failures.push(`命中行应为 ${want}，实为 ${got}：${JSON.stringify(r.sites.map((s) => s.text))}`)
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
    lines.push(`  ✗ ${report.count} 处死兜底：对类型不含 null/undefined 的值写了 \`?? 默认值\`（右侧永远取不到）或 \`?.\`（永不短路），让读者以为值会缺：`)
    lines.push('    → 值确实总在 ⇒ 删掉 `?? 默认值`、`?.` 改成 `.`（默认值只留在源头：store 默认 / buildCharConfig / emptyPanel）')
    lines.push('    → 值真的可能缺 ⇒ 字段改成可选（加 `?`），让每个读点都看见；别换成 `||` / 三元 / `=== undefined` / `&&` 绕门')
    lines.push('    → 值来自 JSON ⇒ 类型由 validate:data 契约校验（scripts/lib/json-contract.mjs），数据真会缺就同样改可选')
    lines.push('    → 外部库类型说谎（如 navigator.clipboard）⇒ 读点写诚实类型 `const c: Clipboard | undefined = navigator.clipboard`')
    for (const s of report.sites.slice(0, 20)) lines.push(`      ${s.file}:${s.line}  ${s.form} [${s.owner}.${s.prop}: ${s.type}]  ${s.text}`)
  }
  return lines
}
