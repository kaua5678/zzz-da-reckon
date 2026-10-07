/**
 * 判据 29：类型只声明一次（r729，2026-10-08；r732 加 ③）——src 非测试 `.ts` 里不许把已知类型再写一遍。三种形态：
 *
 *   ① 恒等断言：`x as T` / `<T>x`，x 在该位置的类型（含控制流收窄）已经就是 T，或者 T 只比它多 null / undefined。
 *   ② 结构副本：类型字面量 `{ … }`（≥3 个成员，全是属性 / 方法签名）与 src 里某个具名 interface / type 别名逐字段相同
 *      （成员名、可选性、类型文本都一样，并且互相可赋值）。
 *   ③ 字面量副本（r732）：两处以上的类型字面量（同样 ≥3 个成员）彼此逐字段相同，又不等于任何具名类型——
 *      同一个形状没有名字，各处各写一遍。
 *
 * 为什么需要：
 *   r729 用 TS 类型检查器普查 origin/master `f808afdb`：恒等断言 41 处（同一类型 39、只加空 2），结构副本 14 处。
 *   两种写法都不改变任何类型，只把已有的类型再说一遍，代价却是实在的：
 *   · 恒等断言让声明改动静默失效。`outerExit as 'stable' | 'cycle' | 'maxIter' | undefined` 抄了 4 遍联合；
 *     声明里加一个取值，这 4 处会把它从类型里静默删掉。`skills as AgentSkills` 在一个函数里写了 16 遍，
 *     声明改成可缺时它们会把 undefined 吞掉。只加空的断言（`x as T | undefined`）把必填值说成可缺，
 *     后面的 `?? 默认值` 因此逃过判据 28。
 *   · 结构副本让同一个概念有两份声明。`ReleaseRowInput` 的注释写着「单一来源，r408 删除其重复内联类型」，
 *     damagePoolAnomaly 里却还留着一份逐字相同的副本；`TeamGoldState` 在 teamCompare / pullPlannerEngine 抄了 4 遍。
 *     改一份不会报错，两份就此分叉。
 *   r732：② 只比「字面量 ≡ 具名」，没有名字的形状各写各的，它看不见。普查 origin/master `8517ef07`：28 组 76 处——
 *     钩子的入参 / 返回形状只在 AgentMechanicModule 里写成字面量（`expandAxisAction?(input: { … })`、
 *     `releaseModifier?(…): { enemyResReduction; … }`），实现钩子的角色模块再抄一遍；`{ slot, moveId, count }` 在
 *     stunAxisStack / convergence / roundInputs 抄了 7 遍；菲尼克斯一个接口里 4 个字段各写一遍同一形状。
 *     起名之后由 ② 接管：再有人照抄，就是「字面量 ≡ 具名」。
 *   普查与逐处判断见 docs/mcp-type-restatement.md。
 *
 * 规则（TS 类型检查器；program = tsconfig.app.json 里的 .ts 文件，与判据 28 共用，见 ./app-program.mjs）：
 *   · ① 只比较「类型不受断言影响」的表达式：x 去括号后是标识符、属性访问、元素访问、非泛型调用（含套在外面的 `!` / `await`）。
 *     对象 / 数组字面量和泛型调用会以断言目标为上下文类型，比不出真实类型，不在本门（字面量断言归判据 27）。
 *     「同一类型」按类型对象判断（TS 对联合等类型做了驻留，同一组成员就是同一个对象），不用结构等价——
 *     结构等价但不同一的断言（如去 Readonly、换成带索引签名的 Record）可能有用，不报。
     元素访问 / 走索引签名的点访问加 `| undefined` 不报：未开 noUncheckedIndexedAccess，TS 不给 undefined 而运行时可缺，加上是如实（同判据 28 的口径）。
 *   · ② 只看声明在扫描面里、不带 extends、不在 `declare module` 里的具名类型；泛型具名类型的字段类型文本带类型参数，
 *     自然比不中。type 别名本身的 `{ … }` 是声明，不算副本。
 *   · ③ 只比没命中 ② 的字面量，按成员名串分组后逐字段比；两个具名类型彼此同形不报——名字本身说明作者认为是两个概念。
 *   · 扫描面与判据 28 相同（src 非测试 .ts；`.vue` 不扫）。反空洞：扫描文件数 < `TYPE_RESTATEMENT_MIN_FILES` 视为目录没扫到，判据失败。
 *
 * 报错时怎么改：
 *   ① 删掉断言。断言是为了绕开 TS 的控制流收窄（例：前面判过 `=== 'maxIter'` 已返回，后面改了 store 又要再判）⇒
 *     那是「拓宽」，不会命中本门；要是断言目标是一串手写联合，给联合起名，断言写名字。
 *   ② 改成引用那个具名类型（要只读就 `Readonly<具名>`）。具名类型在不能引用的层（如 types/ 引用 composables/）⇒
 *     把具名类型下沉到 types/。两者碰巧同形、含义不同 ⇒ 改一个字段名让含义体现在形状上，别为过门加豁免。
 *   ③ 给这个形状起名，放在各处都能引用的最低一层（钩子的入参 / 返回形状放 mechanics/typesHooks.ts，由 types.ts 转出；
 *     只在一个文件里重复的就地起名、不导出），各处改成引用名字。已有具名类型只差可选字段的（如 TimelineAxisNode）
 *     直接引用它。碰巧同形同 ②。
 */
import { createRequire } from 'node:module'
import { dirname, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { appTsProgram, isAppTsScanned } from './app-program.mjs'

const require = createRequire(import.meta.url)
const ts = require('typescript')
/** 仓库根（从 `scripts/lib/` 上溯三级；与 check-guards.mjs 的 ROOT 同值） */
const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
export const TYPE_RESTATEMENT_BASELINE = 0
/** 反空洞下限：2026-10-08 实测扫到 src 非测试 .ts 共 298 个（下限取约 85%） */
export const TYPE_RESTATEMENT_MIN_FILES = 250
/** 结构副本的最小成员数：两三个字段的小形状碰巧同形的多，3 个起已足以抓到 r729 普查里的全部副本 */
const MIN_MEMBERS = 3

const unparen = (e) => { while (ts.isParenthesizedExpression(e)) e = e.expression; return e }

/** 断言前的表达式，其类型是否不受断言目标影响（字面量 / 泛型调用会以断言目标为上下文类型） */
function isPlain(checker, e) {
  e = unparen(e)
  if (ts.isIdentifier(e) || ts.isPropertyAccessExpression(e) || ts.isElementAccessExpression(e)) return true
  if (ts.isNonNullExpression(e) || ts.isAwaitExpression(e)) return isPlain(checker, e.expression)
  if (ts.isCallExpression(e)) return !checker.getResolvedSignature(e)?.getDeclaration()?.typeParameters?.length
  return false
}

const isPropDecl = (d) => ts.isPropertySignature(d) || ts.isPropertyDeclaration(d) || ts.isPropertyAssignment(d)
  || ts.isShorthandPropertyAssignment(d) || ts.isParameter(d)

/** 元素访问 / 走索引签名的点访问：TS 不给 undefined、运行时却可缺（未开 noUncheckedIndexedAccess），给它加 `| undefined` 是如实 */
function mayBeMissing(checker, e) {
  e = unparen(e)
  if (ts.isElementAccessExpression(e)) return true
  if (!ts.isPropertyAccessExpression(e)) return false
  const decl = checker.getSymbolAtLocation(e.name)?.declarations?.[0]
  return !(decl && isPropDecl(decl))
}

/** 成员全是具名的属性 / 方法签名且不少于 MIN_MEMBERS 个 ⇒ 排好序的成员名串；否则 null */
function memberKey(members) {
  if (members.length < MIN_MEMBERS) return null
  const names = []
  for (const m of members) {
    if (!(ts.isPropertySignature(m) || ts.isMethodSignature(m)) || !m.name || ts.isComputedPropertyName(m.name)) return null
    names.push(m.name.getText())
  }
  return names.sort().join(',')
}

/** 两个对象类型逐字段相同：成员名、可选性、类型文本一致，且互相可赋值 */
function sameShape(checker, a, b) {
  if (!checker.isTypeAssignableTo(a, b) || !checker.isTypeAssignableTo(b, a)) return false
  const pa = a.getProperties()
  if (pa.length !== b.getProperties().length) return false
  return pa.every((p) => {
    const q = b.getProperty(p.name)
    return !!q && (p.flags & ts.SymbolFlags.Optional) === (q.flags & ts.SymbolFlags.Optional)
      && checker.typeToString(checker.getTypeOfSymbol(p)) === checker.typeToString(checker.getTypeOfSymbol(q))
  })
}

/**
 * 一个 program 里的类型重述。`isScanned(rel)` 决定哪些源文件参与；返回 { sites, scanned }。
 * sites: [{ file, line, kind: '恒等断言' | '只加空' | '结构副本' | '字面量副本', type, text }]（③ 排在最后）
 */
export function findTypeRestatements(program, { root = ROOT, isScanned } = {}) {
  const checker = program.getTypeChecker()
  const sources = program.getSourceFiles().filter((sf) => !sf.isDeclarationFile && isScanned(relative(root, sf.fileName).split(sep).join('/')))
  // 具名形状表：成员名串 → [{ name, type }]
  const named = new Map()
  const addNamed = (key, nameNode) => {
    if (!key) return
    if (!named.has(key)) named.set(key, [])
    named.get(key).push({ name: nameNode.text, type: checker.getTypeAtLocation(nameNode) })
  }
  for (const sf of sources) {
    const collect = (n) => {
      if (ts.isModuleDeclaration(n)) return // `declare module` 里的接口是增补片段，整体类型不等于片段
      if (ts.isInterfaceDeclaration(n) && !n.heritageClauses) addNamed(memberKey(n.members), n.name)
      else if (ts.isTypeAliasDeclaration(n) && ts.isTypeLiteralNode(n.type)) addNamed(memberKey(n.type.members), n.name)
      ts.forEachChild(n, collect)
    }
    collect(sf)
  }
  const sites = []
  // ③ 没命中 ② 的字面量：成员名串 → [{ file, line, lit, text }]
  const unnamed = new Map()
  for (const sf of sources) {
    const rel = relative(root, sf.fileName).split(sep).join('/')
    const at = (n) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1
    const text = (n) => n.getText(sf).replace(/\s+/g, ' ').slice(0, 100)
    const visit = (n) => {
      if ((ts.isAsExpression(n) || ts.isTypeAssertionExpression(n)) && n.type.kind !== ts.SyntaxKind.UnknownKeyword
        && !(ts.isTypeReferenceNode(n.type) && n.type.typeName.getText(sf) === 'const') && isPlain(checker, n.expression)) {
        const src = checker.getTypeAtLocation(n.expression)
        const dst = checker.getTypeFromTypeNode(n.type)
        const kind = src === dst ? '恒等断言'
          : checker.getNonNullableType(dst) === src && !mayBeMissing(checker, n.expression) ? '只加空' : null
        if (kind) sites.push({ file: rel, line: at(n), kind, type: checker.typeToString(src).slice(0, 40), text: text(n) })
      }
      if (ts.isTypeLiteralNode(n) && !ts.isTypeAliasDeclaration(n.parent)) {
        const key = memberKey(n.members)
        if (key) {
          const lit = checker.getTypeAtLocation(n)
          const hit = (named.get(key) ?? []).find((c) => sameShape(checker, lit, c.type))
          if (hit) sites.push({ file: rel, line: at(n), kind: '结构副本', type: hit.name, text: text(n) })
          else {
            if (!unnamed.has(key)) unnamed.set(key, [])
            unnamed.get(key).push({ file: rel, line: at(n), lit, text: text(n) })
          }
        }
      }
      ts.forEachChild(n, visit)
    }
    visit(sf)
  }
  // ③ 同一成员名串下逐字段相同的归为一类；一类 ≥2 处，每处都报
  for (let rest of unnamed.values()) {
    while (rest.length > 1) {
      const [head, ...others] = rest
      const same = [head, ...others.filter((o) => sameShape(checker, head.lit, o.lit))]
      rest = others.filter((o) => !same.includes(o))
      if (same.length > 1) for (const s of same) sites.push({ file: s.file, line: s.line, kind: '字面量副本', type: `×${same.length}`, text: s.text })
    }
  }
  return { sites, scanned: sources.length }
}

/** 自证：内存里的一份小程序（noLib，免加载 lib.d.ts），三种形态的正例 / 反例各覆盖 */
export function typeRestatementSelfTest() {
  const failures = []
  const file = '/__type_restatement_selftest__/a.ts'
  const code = [
    'interface Gold { a: number; b: string; c: boolean }', // 1
    'type Pair = { x: number; y: number; z?: string }', // 2
    'interface Gen<T> { a: T; b: T; c: T }', // 3
    'declare const g: Gold', // 4
    'declare const n: number', // 5
    'declare const m: number | undefined', // 6
    'declare function f(): Gold', // 7
    'declare function id<T>(v: T): T', // 8
    'export const r1 = g as Gold', // 9 违规：恒等
    'export const r2 = n as number | undefined', // 10 违规：只加空
    'export const r3 = m as number', // 11 收窄，不管
    'export const r4 = (f() as Gold).a', // 12 违规：非泛型调用恒等
    'export const r5 = id(g) as Gold', // 13 泛型调用不比
    "export const r6 = { a: 1, b: '', c: true } as Gold", // 14 字面量不比（判据 27 管）
    'export function h1(p: { a: number; b: string; c: boolean }) { return p }', // 15 违规：≡ Gold
    'export function h2(p: { a: number; b: string; c: number }) { return p }', // 16 字段类型不同
    'export function h3(p: { x: number; y: number; z?: string }) { return p }', // 17 违规：≡ Pair
    'export function h4(p: { x: number; y: number; z: string }) { return p }', // 18 可选性不同
    'export function h5(p: { a: number; b: number; c: number }) { return p }', // 19 Gen<T> 带类型参数，不算
    'export function h6(p: { a: number; b: string }) { return p }', // 20 不足 3 个成员
    'export const r7 = n as const', // 21 as const 不管
    '// export const r8 = g as Gold', // 22 注释
    'declare const rec: { [k: string]: number }', // 23
    "export const r9 = rec['k'] as number | undefined", // 24 元素访问加 undefined 是如实
    'export const r10 = rec.k as number | undefined', // 25 索引签名点访问同上
    'export const r11 = g.a as number | undefined', // 26 违规：声明过的必填属性只加空
    'export function h7(p: { u: number; v: string; w?: boolean }) { return p }', // 27 违规：字面量副本（≡ 28）
    'export const k1: { u: number; v: string; w?: boolean } | null = null', // 28 违规：字面量副本（≡ 27）
    'export function h8(p: { u: number; v: string; w: boolean }) { return p }', // 29 可选性不同，不同形
    'export function h9(p: { a: number; b: string; c: boolean }, q: { a: number; b: string; c: boolean }) { return p }', // 30 违规 ×2：≡ Gold 按结构副本报，不再按字面量副本重复报
    'type N1 = { p1: number; p2: number; p3: number }', // 31
    'type N2 = { p1: number; p2: number; p3: number }', // 32 具名 ≡ 具名不管（名字本身说明是两个概念）
  ].join('\n')
  const options = { strict: true, noEmit: true, noLib: true, types: [] }
  const host = ts.createCompilerHost(options)
  const getSourceFile = host.getSourceFile.bind(host)
  host.getSourceFile = (f, lang, ...rest) => (f === file ? ts.createSourceFile(f, code, ts.ScriptTarget.Latest, true) : getSourceFile(f, lang, ...rest))
  host.fileExists = (f) => f === file
  host.readFile = (f) => (f === file ? code : undefined)
  const program = ts.createProgram({ rootNames: [file], options, host })
  const r = findTypeRestatements(program, { root: '/__type_restatement_selftest__', isScanned: () => true })
  const got = r.sites.map((s) => `${s.line}${s.kind}`).join(',')
  const want = '9恒等断言,10只加空,12恒等断言,15结构副本,17结构副本,26只加空,30结构副本,30结构副本,27字面量副本,28字面量副本'
  if (got !== want) failures.push(`命中应为 ${want}，实为 ${got}：${JSON.stringify(r.sites.map((s) => s.text))}`)
  return { ok: failures.length === 0, failures }
}

/** 全 src 扫描（判据 29） */
export function scanTypeRestatements(root = ROOT) {
  const selfTest = typeRestatementSelfTest()
  const program = appTsProgram(root)
  if (!program) return { count: 0, sites: [], scanned: 0, selfTest, belowFloor: true, ok: false }
  const { sites, scanned } = findTypeRestatements(program, { root, isScanned: isAppTsScanned })
  const belowFloor = scanned < TYPE_RESTATEMENT_MIN_FILES
  return { count: sites.length, sites, scanned, selfTest, belowFloor,
    ok: sites.length === TYPE_RESTATEMENT_BASELINE && selfTest.ok && !belowFloor }
}

export function formatTypeRestatements(report) {
  const lines = []
  if (!report.selfTest.ok) lines.push('  ✗ detector 自证失败：', ...report.selfTest.failures.map((f) => '    ' + f))
  if (report.belowFloor) lines.push(`  ✗ 只扫到 ${report.scanned} 个文件（下限 ${TYPE_RESTATEMENT_MIN_FILES}）：tsconfig.app.json 的 include 变了？`)
  if (report.count > TYPE_RESTATEMENT_BASELINE) {
    lines.push(`  ✗ ${report.count} 处把已知类型又写了一遍：`)
    lines.push('    → 恒等断言 / 只加空：删掉断言（x 已经是这个类型；只加 undefined 的断言是把必填值说成可缺）')
    lines.push('    → 结构副本：改成引用那个具名类型（要只读就 Readonly<具名>）；具名类型在引用不到的层 ⇒ 下沉到 types/')
    lines.push('    → 字面量副本：给这个形状起名（钩子的入参 / 返回形状放 mechanics/typesHooks.ts；只在一个文件里重复就地起名、不导出），各处引用名字')
    lines.push('    → 碰巧同形、含义不同 ⇒ 改字段名让含义体现在形状上；别为过门加豁免')
    for (const s of report.sites.slice(0, 20)) lines.push(`      ${s.file}:${s.line}  [${s.kind}: ${s.type}]  ${s.text}`)
  }
  return lines
}
