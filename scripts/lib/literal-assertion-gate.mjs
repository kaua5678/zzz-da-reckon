/**
 * 判据 27：字面量类型断言硬门（r719，2026-10-07）——src 非测试代码不许把对象 / 数组字面量 `as` 成领域类型，也不许 `as never` / `as any`。
 *
 * 为什么需要（事故）：
 *   r718（`e88b72f8`）月城柳极性紊乱执行行写成 `events.push({ … } as AnomalyEventExecution)`，漏了必填 `fields`。
 *   对象字面量一加 `as T`，TS 只查「两边能否互相赋值」——缺必填字段的字面量是 T 的超类型，照样过；多余字段也不报 ⇒
 *   vue-tsc 绿，资源池页 → 异常池运行时崩溃。`as never` / `as any` 更彻底：什么都能过。
 *   r719 用 TS AST 普查 origin/master `52417207`：这类断言 15 处（对象字面量 9 + 对象字面量数组 1 + as never 5），分散 10 个文件。
 *   逐处去掉后：2 处是真不符（`DriveDiscConfig.mainStats` 类型三键必填而运行时会缺键；`DiscSetLike.effectText` 与目录的
 *   `LocalizedString` 不符），3 处把钩子入参重新打包、丢了 6–8 个必填字段（规格基座今天恰好不读），其余 10 处是多余断言。
 *   多余断言今天无害，明天有人往对象里少写一个字段就是下一个月城柳；累积这么多说明靠评审拦不住。
 *
 * 规则（纯句法，TS AST；`.vue` 只扫 `<script>` 块）：
 *   · `x as never` / `x as any`（含 `<never>x` / `<any>x`）⇒ 违规。
 *   · 对象字面量 `{ … } as T` ⇒ 违规，除非：空 `{}`；T 是 `Record<…>`（拓宽成字典，没有必填字段可漏）；
 *     全部属性都是计算键 `{ [k]: v }`（TS 把联合类型的计算键拓宽成索引签名，只能断言）。
 *   · 数组字面量 `[ … ] as T` ⇒ 有元素直接是对象字面量就违规（`[{ … }] as X[]` 与上一条同理）；元组 / 展开 / 空数组不管。
 *   · 不管：`as const`（不是断言）；`x as unknown as T` 双重断言（动态键访问器 / 调试探针 / 框架与泛型边界，
 *     r719 逐条判过 17 处，见 docs/mcp-r6-refactor-list.md §8.0 #24）；标识符 / 调用结果的收窄（TS 会查两边可比）。
 *   · 扫 `src/**` 的 `.ts` / `.vue`（不含 `.d.ts`、`*.test.ts`、任何 `__tests__/`、测试基建 `src/test/`）。
 *   · 反空洞下限：扫描文件数 < `LITERAL_ASSERTION_MIN_FILES` 视为目录没扫到，判据失败（与判据 25/26 同款）。
 *
 * 报错时怎么改：直接写字面量，或类型标注 `const x: T = { … }`；编译报错 = 契约不符 ⇒ 补字段或改类型
 *   （docs/AGENT_RECORDING_SOP.md §3 第 6 条）。往 cfg 塞新键 ⇒ 先在模块的 `CharacterOperationConfig` 扩充里声明；
 *   把钩子入参重新打包再断言 ⇒ 原样转交 `input`。不设豁免表：真要逃逸就写 `as unknown as T` 并在旁边写为什么（显眼、可 grep）。
 *
 * 明确**不**纳入：模板表达式里的断言（`<template>` 不解析）；测试代码（测试里造残缺对象是常态）。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const ts = require('typescript')
/** 仓库根（从 `scripts/lib/` 上溯三级；与 check-guards.mjs 的 ROOT 同值） */
const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
export const LITERAL_ASSERTION_SCAN_DIR = 'src'
export const LITERAL_ASSERTION_BASELINE = 0
/** 反空洞下限：2026-10-07 实测 src 非测试 .ts/.vue（不含 .d.ts、src/test/）共 338 个 */
export const LITERAL_ASSERTION_MIN_FILES = 280

/** `.vue` → 各 `<script>` 块 + 行偏移；`.ts` → 整文件 */
function scriptBlocks(text, isVue) {
  if (!isVue) return [{ code: text, lineOffset: 0 }]
  const out = []
  const re = /<script\b[^>]*>([\s\S]*?)<\/script>/g
  let m
  while ((m = re.exec(text))) {
    const start = m.index + m[0].indexOf('>') + 1
    out.push({ code: m[1], lineOffset: text.slice(0, start).split('\n').length - 1 })
  }
  return out
}

const unparen = (e) => { while (ts.isParenthesizedExpression(e)) e = e.expression; return e }

/** 一个断言节点 → 违规形态（null = 不违规） */
function classify(node, sf) {
  const t = node.type
  if (t.kind === ts.SyntaxKind.NeverKeyword) return 'as never'
  if (t.kind === ts.SyntaxKind.AnyKeyword) return 'as any'
  if (t.getText(sf) === 'const') return null
  const e = unparen(node.expression)
  if (ts.isObjectLiteralExpression(e)) {
    if (e.properties.length === 0) return null
    if (ts.isTypeReferenceNode(t) && t.typeName.getText(sf) === 'Record') return null
    if (e.properties.every(p => p.name && ts.isComputedPropertyName(p.name))) return null
    return '对象字面量'
  }
  if (ts.isArrayLiteralExpression(e) && e.elements.some(x => ts.isObjectLiteralExpression(unparen(x)))) return '对象字面量数组'
  return null
}

/** 单文件 → [{ line, kind, type, text }]；fileName 决定是否按 .vue 抽 <script> */
export function findLiteralAssertions(text, fileName = 'x.ts') {
  const out = []
  const raw = text.split('\n')
  for (const { code, lineOffset } of scriptBlocks(text, fileName.endsWith('.vue'))) {
    const sf = ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    const visit = (n) => {
      if (ts.isAsExpression(n) || ts.isTypeAssertionExpression(n)) {
        const kind = classify(n, sf)
        if (kind) {
          const line = sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1 + lineOffset
          out.push({ line, kind, type: n.type.getText(sf).replace(/\s+/g, ' '), text: (raw[line - 1] ?? '').trim().slice(0, 110) })
        }
      }
      ts.forEachChild(n, visit)
    }
    visit(sf)
  }
  return out
}

function isScanned(name) {
  if (name.endsWith('.vue')) return true
  return name.endsWith('.ts') && !name.endsWith('.d.ts') && !name.endsWith('.test.ts')
}

export function literalAssertionSelfTest() {
  const failures = []
  const t1 = "const a = { id: 'x' } as Foo\nevents.push({ k: 1 } as never)\nconst b = ([{ id: 1 }] as Bar[])\nconst c = x as any\nconst d = <Foo>{ id: 'y' }\n"
  const h1 = findLiteralAssertions(t1)
  const want1 = ['1:对象字面量', '2:as never', '3:对象字面量数组', '4:as any', '5:对象字面量']
  if (h1.map(h => `${h.line}:${h.kind}`).join() !== want1.join()) failures.push('正例未命中或行号错：' + JSON.stringify(h1))
  const t2 = [
    'const a = { ...c } as Record<string, unknown>',
    'const b = {} as Foo',
    'const c = { [k]: v } as Partial<Foo>',
    'const d = [a, b] as [string, string]',
    'const e = [...xs] as string[]',
    'const f = [] as Foo[]',
    'const g = { id: 1 } as const',
    'const h = [{ id: 1 }] as const',
    'const i = x as unknown as Foo',
    'const j = el as HTMLInputElement',
    '// const k = { id: 1 } as Foo',
  ].join('\n')
  const h2 = findLiteralAssertions(t2)
  if (h2.length) failures.push('反例误计：' + JSON.stringify(h2))
  const t3 = '<template>\n  <div>x</div>\n</template>\n<script setup lang="ts">\nconst p = { id: 1 } as Foo\n</script>\n'
  const h3 = findLiteralAssertions(t3, 'X.vue')
  if (!(h3.length === 1 && h3[0].line === 5)) failures.push('.vue <script> 行号错：' + JSON.stringify(h3))
  return { ok: failures.length === 0, failures }
}

/** 全 src 扫描（判据 27） */
export function scanLiteralAssertions(root = ROOT) {
  const sites = []
  let scanned = 0
  const rec = (dir) => {
    if (!existsSync(dir)) return
    for (const n of readdirSync(dir)) {
      const p = join(dir, n)
      const rel = relative(root, p).split(sep).join('/')
      if (statSync(p).isDirectory()) { if (n !== '__tests__' && rel !== 'src/test') rec(p); continue }
      if (!isScanned(n)) continue
      scanned++
      for (const s of findLiteralAssertions(readFileSync(p, 'utf8'), n)) sites.push({ file: rel, ...s })
    }
  }
  rec(join(root, LITERAL_ASSERTION_SCAN_DIR))
  const selfTest = literalAssertionSelfTest()
  const belowFloor = scanned < LITERAL_ASSERTION_MIN_FILES
  return { count: sites.length, sites, scanned, selfTest, belowFloor,
    ok: sites.length === LITERAL_ASSERTION_BASELINE && selfTest.ok && !belowFloor }
}

export function formatLiteralAssertions(report) {
  const lines = []
  if (!report.selfTest.ok) lines.push('  ✗ detector 自证失败：', ...report.selfTest.failures.map(f => '    ' + f))
  if (report.belowFloor) lines.push(`  ✗ 只扫到 ${report.scanned} 个文件（下限 ${LITERAL_ASSERTION_MIN_FILES}）：目录改名 / 搬家了？改 LITERAL_ASSERTION_SCAN_DIR`)
  if (report.count > LITERAL_ASSERTION_BASELINE) {
    lines.push(`  ✗ ${report.count} 处字面量类型断言 / as never / as any（硬门 0；会让缺必填字段的对象编译通过，r718 月城柳崩溃即此形）：`)
    lines.push('    → 直接写字面量或 `const x: T = { … }`；报错 = 契约不符 ⇒ 补字段或改类型（AGENT_RECORDING_SOP §3 第 6 条）')
    lines.push('    → cfg 新键先在模块的 CharacterOperationConfig 扩充里声明；钩子入参别重新打包再断言，原样转交 input')
    for (const s of report.sites.slice(0, 20)) lines.push(`      ${s.file}:${s.line}  [${s.kind.startsWith('as ') ? s.kind : `${s.kind} as ${s.type}`}]  ${s.text}`)
  }
  return lines
}
