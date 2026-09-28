/**
 * 只读审计：接口属性「生产代码只写不读」普查（CC-190，第 213 轮；结论与分诊见 docs/mcp-write-only-props.md）
 *
 * 为什么不并进 scripts/lib/dead-channel-scan.mjs：那里按**名字**全仓计数（A 段零读零写、B 段只读不写），
 * 常见名（`gold`、`level`）在别处被读过就洗白——CC-189 的 `LevelOverride.gold` 按名字永远扫不出来。
 * 本脚本两段交集：
 *   ① TS LanguageService `findReferences` 按**符号**查引用，生产代码零读取的属性入候选
 *      （.vue 看不见 ⇒ 名字在 .vue 里出现过的剔除；字符串键动态读取看不见 ⇒ ② 兜底）；
 *   ② 按名字在全 src（含 .vue、去注释）找任何形式的读取（`.name` 非赋值 / `['name']` / 字符串 / 解构 / 裸名运算），
 *      一个都没有的才输出。② 会因同名局部变量**漏报**（宁漏不误），所以输出是「高置信候选」，**不是判定**。
 * 输出 TSV：声明位置 / 字段 / opt|req / 写入数 / 测试读取数。耗时约 2–3 分钟（~4000 个属性各查一次引用）。
 * 不进 verify / check-guards：噪音形态（结果对象被测试读、JSON 数据类型字段）需要人工分诊，做成守卫会逼人为变绿乱删。
 * 用法（仓库根）：node scripts/audit-write-only-props.cjs > /tmp/wo.tsv
 */
const ts = require('typescript')
const fs = require('fs'), path = require('path')
const ROOT = process.cwd()
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => {
  const p = path.join(d, e.name)
  if (e.isDirectory()) return e.name === 'node_modules' ? [] : walk(p)
  return /\.ts$/.test(e.name) && !/\.d\.ts$/.test(e.name) ? [p] : []
})
const files = walk(path.join(ROOT, 'src'))
const opts = {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
  strict: true, resolveJsonModule: true, allowImportingTsExtensions: true, noEmit: true, skipLibCheck: true,
  baseUrl: ROOT, paths: { '@/*': ['./src/*'] }, lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
}
const host = {
  getScriptFileNames: () => files, getScriptVersion: f => '1',
  getScriptSnapshot: f => fs.existsSync(f) ? ts.ScriptSnapshot.fromString(fs.readFileSync(f, 'utf8')) : undefined,
  getCurrentDirectory: () => ROOT, getCompilationSettings: () => opts,
  getDefaultLibFileName: o => ts.getDefaultLibFilePath(o),
  fileExists: ts.sys.fileExists, readFile: ts.sys.readFile, readDirectory: ts.sys.readDirectory,
  directoryExists: ts.sys.directoryExists, getDirectories: ts.sys.getDirectories,
}
const ls = ts.createLanguageService(host, ts.createDocumentRegistry())
const prog = ls.getProgram()
const rel = f => path.relative(ROOT, f).split(path.sep).join('/')
const isTest = f => /__tests__|\.test\.ts$|\/test\//.test(rel(f))
const scope = /^src\/(core|composables|data|mechanics|specs|stores|types|utils|services|lib)\//
const targets = []
for (const sf of prog.getSourceFiles()) {
  const r = rel(sf.fileName)
  if (!scope.test(r) || isTest(sf.fileName)) continue
  const visit = (n) => {
    if (ts.isPropertySignature(n) && n.name && ts.isIdentifier(n.name) &&
        (ts.isInterfaceDeclaration(n.parent) || (ts.isTypeLiteralNode(n.parent) && ts.isTypeAliasDeclaration(n.parent.parent)))) {
      targets.push({ sf, node: n.name, name: n.name.text, file: r, line: sf.getLineAndCharacterOfPosition(n.name.getStart()).line + 1, opt: !!n.questionToken })
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
}
console.error('targets', targets.length)
function kind(sf, pos) {
  let tok = ts.getTokenAtPosition ? ts.getTokenAtPosition(sf, pos) : null
  if (!tok) { const find = (n) => (pos >= n.getStart(sf) && pos < n.getEnd()) ? (ts.forEachChild(n, find) || n) : undefined; tok = find(sf) }
  const p = tok.parent
  if (!p) return 'read'
  if ((ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) && p.name === tok) return 'write'
  if (ts.isPropertySignature(p) || ts.isPropertyDeclaration(p)) return 'decl'
  if (ts.isPropertyAccessExpression(p) && p.name === tok) {
    let e = p; while (ts.isParenthesizedExpression(e.parent) || ts.isNonNullExpression(e.parent)) e = e.parent
    const b = e.parent
    if (b && ts.isBinaryExpression(b) && b.left === e && b.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && b.operatorToken.kind <= ts.SyntaxKind.LastAssignment) {
      return b.operatorToken.kind === ts.SyntaxKind.EqualsToken ? 'write' : 'rw'
    }
    if (b && ts.isDeleteExpression(b)) return 'write'
    return 'read'
  }
  if (ts.isElementAccessExpression(p) || ts.isLiteralTypeNode(p)) return 'read'
  if (ts.isBindingElement(p)) return 'read'
  return 'read'
}
const seen = new Set()
const rows = []
// ② 名字兜底语料（去注释）
const corpus = (function cw(d) {
  return fs.readdirSync(d, { withFileTypes: true }).flatMap(e => {
    const p = path.join(d, e.name)
    if (e.isDirectory()) return e.name === '__tests__' ? [] : cw(p)
    if (!/\.(ts|vue)$/.test(e.name) || /\.(test|d)\.ts$/.test(e.name)) return []
    return [fs.readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1')]
  })
})(path.join(ROOT, 'src')).join('\n')
const esc = s => s.replace(/[$]/g, '\\$')
function nameRead(name) {
  const n = esc(name)
  return [
    new RegExp('[.?]\\.?' + n + '\\b(?!\\s*(?:=(?!=)|\\?\\?=|\\|\\|=|&&=))'),
    new RegExp("\\[\\s*['\"]" + n + "['\"]\\s*\\]"),
    new RegExp("['\"`]" + n + "['\"`]"),
    new RegExp('\\{[^{}()]*\\b' + n + '\\b[^{}()]*\\}\\s*(?:=|:\\s*\\w)'),
    new RegExp('(?<![.\\w$])' + n + '\\s*(?:\\?\\?|&&|\\|\\||[-+*/<>]=?|\\))'),
  ].some(re => re.test(corpus))
}
let i = 0
for (const t of targets) {
  i++
  if (i % 200 === 0) console.error(i)
  let refs
  try { refs = ls.findReferences(t.sf.fileName, t.node.getStart()) } catch { continue }
  if (!refs) continue
  let pr = 0, tr = 0, w = 0
  const key = refs.flatMap(r => r.references).filter(x => x.isDefinition).map(x => x.fileName + ':' + x.textSpan.start).sort().join('|')
  if (seen.has(key)) continue
  seen.add(key)
  for (const r of refs) for (const ref of r.references) {
    const sf = prog.getSourceFile(ref.fileName); if (!sf) continue
    const k = kind(sf, ref.textSpan.start)
    if (k === 'decl') continue
    if (k === 'write') { w++; continue }
    if (isTest(ref.fileName)) tr++; else pr++
  }
  if (pr === 0 && !nameRead(t.name)) {
    rows.push([t.file + ':' + t.line, t.name, t.opt ? 'opt' : 'req', w, tr].join('\t'))
  }
}
process.stdout.write(rows.join('\n') + '\n')
console.error('done', rows.length)
