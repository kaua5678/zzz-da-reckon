// 测量：mechanics/agents 模块写入的 cfg 键，按读者（a 仅本模块 / b 仅外部 / c 两者）× 写入钩子层级（once=buildCharConfig / round=applyTeamConfig / repeat=其他可重复调用钩子）分类。
// 用法：node scripts/cfg-key-census.cjs   [V=1 逐键明细] [EXT=1 外部读者分布] [TYPES=1 是否声明在 CharacterOperationConfig]
// 背景与结论见 docs/mcp-module-state.md（第 307 轮）。按词匹配读者，属近似测量。
// 测量：agents 模块写入的 cfg 键，按读者分类
const ts = require('typescript')
const fs = require('fs'), path = require('path')
const ROOT = path.join(__dirname, '..', 'src')
const AG = ROOT + '/mechanics/agents'
function walkDir(d, out = []) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (e.name !== '__tests__') walkDir(p, out) } else if (/\.(ts|vue|json)$/.test(e.name) && !/\.test\.ts$/.test(e.name)) out.push(p) } return out }
const files = walkDir(ROOT)
const writes = new Map() // key -> Set(file:hook)
const OBJ = /^(cfg|record|rec|c|mateCfg|mateRecord|own|merged)$/
const writeHooks = new Map() // key -> Set(hook)
for (const f of fs.readdirSync(AG).filter(x => x.endsWith('.ts'))) {
  const sf = ts.createSourceFile(f, fs.readFileSync(path.join(AG, f), 'utf8'), ts.ScriptTarget.Latest, true)
  const fns = new Map(); const hookOf = new Map() // fn node -> Set(hook)
  const hookInits = []
  const v1 = n => {
    if (ts.isFunctionDeclaration(n) && n.name) fns.set(n.name.text, n)
    if (ts.isVariableDeclaration(n) && n.initializer && ts.isIdentifier(n.name) && (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer))) fns.set(n.name.text, n.initializer)
    const inModuleObj = n.parent && ts.isObjectLiteralExpression(n.parent) && /agentIds/.test(n.parent.getText(sf).slice(0, 4000))
    if (inModuleObj && ts.isPropertyAssignment(n) && (ts.isIdentifier(n.initializer) || ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer))) hookInits.push([n.name.getText(sf), n.initializer])
    if (inModuleObj && ts.isShorthandPropertyAssignment(n)) hookInits.push([n.name.text, n.name])
    if (inModuleObj && ts.isMethodDeclaration(n)) hookInits.push([n.name.getText(sf), n])
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isPropertyAccessExpression(n.left) && /Mechanic$/.test(n.left.expression.getText(sf))) hookInits.push([n.left.name.text, n.right])
    ts.forEachChild(n, v1)
  }
  v1(sf)
  const mark = (fn, hook, d) => {
    if (!fn || d > 4) return
    if (!hookOf.has(fn)) hookOf.set(fn, new Set())
    if (hookOf.get(fn).has(hook)) return
    hookOf.get(fn).add(hook)
    const w = n => { if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && fns.has(n.expression.text)) mark(fns.get(n.expression.text), hook, d + 1); ts.forEachChild(n, w) }
    if (fn.body) w(fn.body)
  }
  for (const [hook, init] of hookInits) mark(ts.isIdentifier(init) ? fns.get(init.text) : init, hook, 0)
  const enclosingHooks = n => {
    const hs = new Set()
    for (let p = n.parent; p; p = p.parent) if (hookOf.has(p)) for (const h of hookOf.get(p)) hs.add(h)
    return hs
  }
  const visit = n => {
    if (ts.isBinaryExpression(n) && n.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && n.operatorToken.kind <= ts.SyntaxKind.LastAssignment) {
      const l = n.left
      if (ts.isPropertyAccessExpression(l) || ts.isElementAccessExpression(l)) {
        const obj = l.expression.getText(sf).replace(/[()\s;]|as any|as unknown as Record<string, ?unknown>|as never/g, '')
        let key = ts.isPropertyAccessExpression(l) ? l.name.text : (ts.isStringLiteral(l.argumentExpression) ? l.argumentExpression.text : null)
        if (key && OBJ.test(obj) && !key.startsWith('setting:')) {
          if (!writes.has(key)) writes.set(key, new Set())
          writes.get(key).add(f)
          if (!writeHooks.has(key)) writeHooks.set(key, new Set())
          const hs = enclosingHooks(n)
          if (hs.size === 0) writeHooks.get(key).add('?')
          for (const h of hs) writeHooks.get(key).add(h)
        }
      }
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
}
const texts = files.map(p => [path.relative(ROOT, p), fs.readFileSync(p, 'utf8')])
const rows = []
for (const [key, wfiles] of writes) {
  const re = new RegExp(`\\b${key}\\b`)
  const readers = new Set()
  for (const [rel, t] of texts) {
    if (rel.startsWith('types/')) continue
    if (!re.test(t)) continue
    // 只算读：去掉「key =」赋值出现后仍出现
    const stripped = t.split('\n').filter(line => re.test(line) && !new RegExp(`\\b${key}\\s*=[^=]`).test(line) && !/^\s*(\/\/|\*)/.test(line))
    if (stripped.length) readers.add(rel)
  }
  const own = [...wfiles].map(f => 'mechanics/agents/' + f)
  const selfOnly = [...readers].every(r => own.includes(r))
  const cls = readers.size === 0 ? 'none' : selfOnly ? 'a-private' : [...readers].some(r => own.includes(r)) ? 'c-both' : 'b-external'
  const hooks = [...(writeHooks.get(key) ?? [])]
  const tier = hooks.every(h => h === 'buildCharConfig') ? 'once' : hooks.every(h => h === 'buildCharConfig' || h === 'applyTeamConfig') ? 'round' : 'repeat'
  rows.push({ key, cls, tier, hooks, writers: own.map(x => x.replace('mechanics/agents/', '')), readers: [...readers].filter(r => !own.includes(r)) })
}
const by = {}
for (const r of rows) (by[r.cls] ||= []).push(r)
for (const cls of Object.keys(by).sort()) {
  const mods = new Set(by[cls].flatMap(r => r.writers))
  const t = {}; for (const r of by[cls]) t[r.tier] = (t[r.tier] || 0) + 1
  console.log(`== ${cls}: ${by[cls].length} 键 / ${mods.size} 模块  按写入钩子: ${JSON.stringify(t)}`)
  if (process.env.V) for (const r of by[cls]) console.log(`  [${r.tier}:${r.hooks.join('|')}] ${r.key}  W=${r.writers.join(',')}  R=${r.readers.join(',')}`)
}
if (process.env.EXT) {
  const cnt = {}
  for (const r of rows) for (const x of r.readers) { const k = x.split('/').slice(0, 2).join('/'); cnt[k] = (cnt[k] || 0) + 1 }
  console.log(cnt)
}
if (process.env.TYPES) {
  const cfgType = fs.readFileSync(ROOT + '/types/resource/config.ts', 'utf8')
  const declared = r => new RegExp(`^\\s*${r.key}\\??:`, 'm').test(cfgType)
  const res = {}
  for (const r of rows) { const k = `${r.cls}/${r.tier}`; res[k] ||= [0, 0]; res[k][declared(r) ? 0 : 1]++ }
  console.log('分类/钩子 → [类型已声明, 未声明]', res)
  console.log('config.ts 行数', cfgType.split('\n').length)
}
