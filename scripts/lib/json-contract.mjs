/**
 * 外部 JSON 类型契约（r725，2026-10-07）——代码把 JSON 转型成什么 TS 类型，validate:data 就按那个类型校验数据。
 *
 * 为什么需要：
 *   运行时 `res.json() as Catalog`、`import.meta.glob` + `as AgentMechanicSpec` 这类转型 TS 不查。r725 前类型里的
 *   「必填」对 JSON 来源的值没人保证，判据 28（死兜底）只好对这些类型整片豁免（信任边界表 59 处），读点各写各的兜底。
 *   而手写的字段清单（r724 Boss / 轴预设块）只覆盖抄进去的那几个键，类型一改就和清单脱节。
 *   r725 首跑实测 31 个键与声明不符（`BuffEffect.value` 78 条缺、`SkillRow.label` 3462 行缺、`statDisplay.label`
 *   声明 LocalizedString 实为 string……），全部按数据改真后，类型 = 数据契约，信任边界表删除。
 *
 * 规则：
 *   · `JSON_CONTRACTS` 一张表登记全部 JSON 入口（`fetch('/static/*.json')`、`import.meta.glob('*.json')`）与代码转型用的
 *     类型；`findUncoveredJsonEntries` 扫 src 非测试代码，漏登记的入口即红——新入口不能绕过契约。静态 `import x from
 *     '….json'` 不算入口：开了 resolveJsonModule，TS 按文件内容推断类型，`as` 也要与内容相容（如 enginePools.json）。
 *   · 校验按 TS 类型检查器解析出的类型递归走：必填属性必须在（可选 / 含 undefined 的可缺）；string / number /
 *     boolean / 字面量 / null 按值核；数组、元组逐元素；联合取「值的种类相容」的分支，任一分支全过即过；
 *     索引签名核未声明键的值。any / unknown 不核；多余键不报（与 TS 结构类型一致）；函数类型属性跳过。
 *   · 类型表达不了的语义约束（id 唯一、引用存在、非空数组、整数……）仍在 validate-data.mjs 里手写。
 *
 * 报错时怎么改：数据真缺 / 形态不同 ⇒ 改类型（可选、加 null、放宽字面量联合），让读点看见；数据写错 ⇒ 改数据和生成脚本。
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const F = ts.TypeFlags

/** JSON 入口 → 代码转型用的类型。`json` 单文件 / `dir` 目录下全部 *.json；`array` = 文件顶层是该类型的数组。 */
export const JSON_CONTRACTS = [
  { json: 'public/static/catalog.json', file: 'src/types/catalog.ts', type: 'Catalog' },
  { json: 'public/static/teammate-buffs.json', file: 'src/types/catalog.ts', type: 'TeammateBuffGroup', array: true },
  { json: 'public/static/build-recommendations.json', file: 'src/types/catalog.ts', type: 'BuildRecommendations' },
  { json: 'public/static/boss-presets.json', file: 'src/types/bossPreset.ts', type: 'BossPresetFile' },
  { json: 'public/static/run-archive.json', file: 'src/composables/runArchiveImport.ts', type: 'RunArchiveFile' },
  { dir: 'src/specs/agents', file: 'src/specs/types.ts', type: 'AgentMechanicSpec' },
  { dir: 'src/data/teamPresets', file: 'src/data/teamPresets.ts', type: 'TeamPresetFile' },
  { dir: 'src/data/stunAxisPresets', file: 'src/data/stunAxisPresets.ts', type: 'StunAxisPreset' },
]

function kindOf(v) {
  return v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v
}

/** 按类型校验一个值；错误交给 `sink(key, path, msg)`。key = `Owner.prop`，用于汇总 */
export function makeValidator(checker) {
  const shapes = new Map()
  const tn = (t) => checker.typeToString(t).slice(0, 90)
  const isArr = (t) => checker.isArrayType(t) || checker.isTupleType(t)
  const hasUndef = (t) => !!(t.flags & (F.Undefined | F.Void)) || (t.isUnion() && t.types.some(hasUndef))
  /** 具名接口 / 类 / 无类型参数的别名 ⇒ 类型名；匿名字面量、Record<…> 等 ⇒ null（用路径 key 命名） */
  const ownerName = (t) => {
    if (t.symbol && t.symbol.flags & (ts.SymbolFlags.Interface | ts.SymbolFlags.Class)) return t.symbol.name
    return t.aliasSymbol && !t.aliasTypeArguments?.length ? t.aliasSymbol.name : null
  }
  const shape = (t) => {
    let s = shapes.get(t)
    if (s) return s
    const props = checker.getPropertiesOfType(t).map((p) => {
      const decl = p.valueDeclaration ?? p.declarations?.[0]
      const type = decl ? checker.getTypeOfSymbolAtLocation(p, decl) : checker.getDeclaredTypeOfSymbol(p)
      return { name: p.name, type, optional: !!(p.flags & ts.SymbolFlags.Optional) || hasUndef(type), fn: type.getCallSignatures().length > 0 }
    })
    s = { props, names: new Set(props.map((p) => p.name)), idx: checker.getIndexInfosOfType(t).map((i) => ({ type: i.type, match: keyMatcher(i.keyType) })) }
    shapes.set(t, s)
    return s
  }
  const keyMatcher = (k) => {
    if (k.flags & F.String) return () => true
    if (k.flags & F.Number) return (key) => /^-?\d+(\.\d+)?$/.test(key)
    if (k.flags & F.TemplateLiteral) {
      const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const re = new RegExp('^' + k.texts.map((tx, i) => esc(tx) + (i < k.types.length ? (k.types[i].flags & F.Number ? '-?\\d+(?:\\.\\d+)?' : '[\\s\\S]*?') : '')).join('') + '$')
      return (key) => re.test(key)
    }
    return () => false
  }
  const compatible = (kind, m) => {
    const f = m.flags
    if (f & (F.Any | F.Unknown)) return true
    switch (kind) {
      case 'null': return !!(f & F.Null)
      case 'string': return !!(f & (F.String | F.StringLiteral | F.TemplateLiteral))
      case 'number': return !!(f & (F.Number | F.NumberLiteral))
      case 'boolean': return !!(f & (F.Boolean | F.BooleanLiteral))
      case 'array': return isArr(m)
      case 'object': return !!(f & (F.Object | F.Intersection)) && !isArr(m)
      default: return false
    }
  }
  const literal = (m) => !!(m.flags & (F.StringLiteral | F.NumberLiteral | F.BooleanLiteral))
  const litMatch = (m, v) => (m.flags & F.BooleanLiteral ? v === (m.intrinsicName === 'true') : m.value === v)
  /** 对象分支的判别属性（字面量类型的属性）与值一致？联合按判别属性选分支，报错才对得上号（如 type: 'fixed' ⇒ FixedBuffEffect） */
  const discriminantOk = (v, m) => {
    if (kindOf(v) !== 'object' || isArr(m) || !(m.flags & (F.Object | F.Intersection))) return true
    for (const p of shape(m).props) {
      const lits = (p.type.isUnion() ? p.type.types : [p.type]).filter((x) => !(x.flags & (F.Undefined | F.Void)))
      if (!lits.length || !lits.every(literal) || v[p.name] === undefined) continue
      if (!lits.some((x) => litMatch(x, v[p.name]))) return false
    }
    return true
  }

  function check(v, t, path, key, sink, depth = 0) {
    if (depth > 64) return
    const f = t.flags
    if (f & (F.Any | F.Unknown)) return
    if (t.isUnion()) {
      if (v === undefined) {
        if (!hasUndef(t)) sink(key, path, '缺失')
        return
      }
      const cands = t.types.filter((m) => compatible(kindOf(v), m))
      if (!cands.length) return sink(key, path, `值是 ${kindOf(v)}，类型 ${tn(t)}`)
      if (cands.every(literal)) {
        if (!cands.some((m) => litMatch(m, v))) sink(key, path, `${JSON.stringify(v)} 不在 ${tn(t)}`)
        return
      }
      const disc = cands.filter((m) => discriminantOk(v, m))
      let best = null
      for (const m of disc.length ? disc : cands) {
        const errs = []
        check(v, m, path, key, (...e) => errs.push(e), depth + 1)
        if (!errs.length) return
        if (!best || errs.length < best.length) best = errs
      }
      for (const e of best) sink(...e)
      return
    }
    if (v === undefined) return f & (F.Undefined | F.Void) ? undefined : sink(key, path, '缺失')
    if (f & F.Null) return v === null ? undefined : sink(key, path, '应为 null')
    if (v === null) return sink(key, path, `null（类型 ${tn(t)}）`)
    if (literal(t)) return litMatch(t, v) ? undefined : sink(key, path, `${JSON.stringify(v)} 应为 ${tn(t)}`)
    if (f & (F.String | F.TemplateLiteral)) return typeof v === 'string' ? undefined : sink(key, path, `应为 string，实为 ${kindOf(v)}`)
    if (f & F.Number) return typeof v === 'number' ? undefined : sink(key, path, `应为 number，实为 ${kindOf(v)}`)
    if (f & F.Boolean) return typeof v === 'boolean' ? undefined : sink(key, path, `应为 boolean，实为 ${kindOf(v)}`)
    if (checker.isTupleType(t)) {
      if (!Array.isArray(v)) return sink(key, path, `应为元组，实为 ${kindOf(v)}`)
      checker.getTypeArguments(t).forEach((et, i) => check(v[i], et, `${path}[${i}]`, `${key}[${i}]`, sink, depth + 1))
      return
    }
    if (checker.isArrayType(t)) {
      if (!Array.isArray(v)) return sink(key, path, `应为数组，实为 ${kindOf(v)}`)
      const et = checker.getTypeArguments(t)[0]
      v.forEach((x, i) => check(x, et, `${path}[${i}]`, `${key}[]`, sink, depth + 1))
      return
    }
    if (f & (F.Object | F.Intersection)) {
      if (kindOf(v) !== 'object') return sink(key, path, `应为对象，实为 ${kindOf(v)}`)
      const s = shape(t)
      const on = ownerName(t) ?? key
      for (const p of s.props) {
        if (p.fn) continue
        const pv = v[p.name]
        if (pv === undefined) {
          if (!p.optional) sink(`${on}.${p.name}`, `${path}.${p.name}`, '缺失')
          continue
        }
        check(pv, p.type, `${path}.${p.name}`, `${on}.${p.name}`, sink, depth + 1)
      }
      if (s.idx.length) {
        for (const k of Object.keys(v)) {
          if (s.names.has(k)) continue
          const ii = s.idx.find((i) => i.match(k))
          if (ii) check(v[k], ii.type, `${path}[${JSON.stringify(k)}]`, `${key}[*]`, sink, depth + 1)
        }
      }
      return
    }
    sink(key, path, `未支持的类型 ${tn(t)}`)
  }
  return check
}

function findExportedType(program, checker, root, file, name) {
  const sf = program.getSourceFile(join(root, file))
  if (!sf) throw new Error(`契约类型文件不在 program：${file}`)
  let sym = checker.getExportsOfModule(checker.getSymbolAtLocation(sf)).find((s) => s.name === name)
  if (!sym) throw new Error(`${file} 没有导出 ${name}`)
  if (sym.flags & ts.SymbolFlags.Alias) sym = checker.getAliasedSymbol(sym)
  return checker.getDeclaredTypeOfSymbol(sym)
}

/** 按 `contracts` 校验全部 JSON；返回 { files, errors: [{ group, source, key, path, msg }] }（group = 表里的入口名） */
export function checkJsonContracts(root = ROOT, contracts = JSON_CONTRACTS) {
  const cfg = ts.getParsedCommandLineOfConfigFile(join(root, 'tsconfig.app.json'), {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: (d) => { throw new Error(String(d.messageText)) } })
  const program = ts.createProgram({ rootNames: [...new Set(contracts.map((c) => join(root, c.file)))], options: { ...cfg.options, noEmit: true } })
  const checker = program.getTypeChecker()
  const check = makeValidator(checker)
  const errors = []
  let files = 0
  for (const c of contracts) {
    const t = findExportedType(program, checker, root, c.file, c.type)
    const group = c.json ?? `${c.dir}/*.json`
    const rels = c.dir ? readdirSync(join(root, c.dir)).filter((f) => f.endsWith('.json')).sort().map((f) => `${c.dir}/${f}`) : [c.json]
    if (!rels.length) errors.push({ group, source: c.dir, key: '<空目录>', path: c.dir, msg: '目录里没有 JSON（入口登记错了？）' })
    for (const rel of rels) {
      files++
      const data = JSON.parse(readFileSync(join(root, rel), 'utf8'))
      const sink = (key, path, msg) => errors.push({ group, source: rel, key, path, msg })
      if (c.array) {
        if (!Array.isArray(data)) sink(c.type, '$', '顶层应为数组')
        else data.forEach((x, i) => check(x, t, `$[${i}]`, c.type, sink))
      } else check(data, t, '$', c.type, sink)
    }
  }
  return { files, errors }
}

/** src 非测试代码里未登记进 `contracts` 的 JSON 入口（fetch / import.meta.glob） */
export function findUncoveredJsonEntries(root = ROOT, contracts = JSON_CONTRACTS) {
  const known = new Set(contracts.map((c) => c.json ?? `${c.dir}/*.json`))
  const out = []
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name)
      if (e.isDirectory()) { if (e.name !== '__tests__' && p !== join(root, 'src', 'test')) walk(p); continue }
      if (!/\.(ts|vue)$/.test(e.name) || /\.(test|perf)\.ts$/.test(e.name) || e.name.endsWith('.d.ts')) continue
      const text = readFileSync(p, 'utf8')
      const rel = relative(root, p).split(sep).join('/')
      const at = (m) => `${rel}:${text.slice(0, m.index).split('\n').length}`
      for (const m of text.matchAll(/fetch\(\s*['"`]\/static\/([^'"`]+\.json)['"`]/g)) {
        if (!known.has(`public/static/${m[1]}`)) out.push(`${at(m)} fetch /static/${m[1]}`)
      }
      for (const m of text.matchAll(/import\.meta\.glob\(\s*['"`]([^'"`]+\.json)['"`]/g)) {
        const g = relative(root, resolve(dirname(p), m[1])).split(sep).join('/')
        if (!known.has(g)) out.push(`${at(m)} import.meta.glob ${m[1]}`)
      }
    }
  }
  walk(join(root, 'src'))
  return out
}

/** 自证：内存小程序（noLib），必填缺失 / 原始类型 / 字面量联合 / 判别联合 / null / 索引签名 / 元组 / 多余键各一次 */
export function jsonContractSelfTest() {
  const file = '/__json_contract_selftest__/a.ts'
  const code = [
    'interface Array<T> { length: number; [n: number]: T }',
    'interface Boolean {} interface Function {} interface IArguments {} interface Number {} interface Object {} interface RegExp {} interface String {}',
    'type Record<K extends keyof any, T> = { [P in K]: T }',
    "interface E1 { type: 'fixed'; value: number }",
    "interface E2 { type: 'stacked'; perStack: number }",
    'interface Root {',
    '  id: string; n: number; flag?: boolean; kind: "a" | "b"; maybe: string | null; opt?: number',
    '  effects: (E1 | E2)[]; rec: Record<string, number>; pair: [string, number]; tpl: { [k: `${string}__${string}`]: number }',
    '}',
  ].join('\n')
  const options = { strict: true, noEmit: true, noLib: true, types: [] }
  const host = ts.createCompilerHost(options)
  const getSourceFile = host.getSourceFile.bind(host)
  host.getSourceFile = (f, lang, ...rest) => (f === file ? ts.createSourceFile(f, code, ts.ScriptTarget.Latest, true) : getSourceFile(f, lang, ...rest))
  host.fileExists = (f) => f === file
  host.readFile = (f) => (f === file ? code : undefined)
  const program = ts.createProgram({ rootNames: [file], options, host })
  const checker = program.getTypeChecker()
  const decl = program.getSourceFile(file).statements.find((s) => ts.isInterfaceDeclaration(s) && s.name.text === 'Root')
  const root = checker.getDeclaredTypeOfSymbol(checker.getSymbolAtLocation(decl.name))
  const check = makeValidator(checker)
  const good = { id: 'x', n: 1, kind: 'a', maybe: null, effects: [{ type: 'fixed', value: 1 }, { type: 'stacked', perStack: 2 }], rec: { a: 1 }, pair: ['p', 1], tpl: { a__b: 1, other: 'ignored' }, extra: true }
  const bad = { id: 1, kind: 'c', effects: [{ type: 'fixed' }, { type: 'stacked', perStack: 'x' }], rec: { a: 'x' }, pair: ['p', 'q'], tpl: { a__b: 'x' }, opt: null }
  const run = (v) => { const keys = []; check(v, root, '$', 'Root', (k) => keys.push(k)); return keys.sort().join(',') }
  const failures = []
  const g = run(good)
  if (g) failures.push(`合法样例不应报错，实报 ${g}`)
  const want = 'E1.value,E2.perStack,Root.id,Root.kind,Root.maybe,Root.n,Root.opt,Root.pair[1],Root.rec[*],Root.tpl[*]'
  const b = run(bad)
  if (b !== want.split(',').sort().join(',')) failures.push(`反例应报 ${want}，实报 ${b}`)
  return { ok: failures.length === 0, failures }
}

/** 汇总成可读行（同入口 + 同 key 合并计数，各给 2 个样例） */
export function formatJsonContractErrors(errors, limit = 30) {
  const groups = new Map()
  for (const e of errors) {
    const k = `${e.group}  ${e.key}`
    const g = groups.get(k) ?? { n: 0, samples: [] }
    g.n++
    if (g.samples.length < 2) g.samples.push(`${e.source === e.group ? '' : e.source.split('/').pop() + ' '}${e.path}: ${e.msg}`)
    groups.set(k, g)
  }
  return [...groups].sort((a, b) => b[1].n - a[1].n).slice(0, limit)
    .map(([k, g]) => `    ${String(g.n).padStart(5)} × ${k}  | ${g.samples.join(' || ').slice(0, 240)}`)
}
