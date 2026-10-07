/**
 * 死通道扫描 · **LanguageService 精粒度版**（判据 14 的补充面；挂 vitest，不进 `npm run check` 链）。
 *
 * 立项：现有判据 14 是**字段名级正则**（check-guards.mjs）——完整立项叙事见 git log（原
 * `.claude/task-ledger-silent-gaps.md` 已随账本瘦身删除；待办在 `.claude/OPEN-ITEMS.md` T2），
 * 已实测两类盲区：① 扫不到**内联 opts**（`function f(o: { bar?: T })`）与 `stores/types` 面；
 * ② 同名无关字段误报（归档 DTO 的抗性字段：21 个「读取点」全是 `stores/config.ts`
 * 同名字段）。本模块用 TypeScript LanguageService（`ls.findReferences`，精确到属性符号）+
 * AST 写入点交叉，补这两个面。建 program 实测 ~4s ⇒ 只适合 vitest，不适合 check 链首端。
 *
 * **什么算死**（同时满足才报，宁可漏报不误报）：
 *   1. 候选 = `DEFAULT_SCAN_DIRS` 内**导出的** interface/type 的可选属性（`foo?: T`），
 *      或**导出函数**的内联 opts 形参（`(o: { foo?: T })`）里的可选属性；
 *   2. **零写入点**：全程序 AST 里没有任何 `PropertyAssignment`/`属性赋值` 以该名字写值
 *      （跨类型同名写入也算——保守方向：namesake 写入会**压制**报告，这正是 O2 反误报要的），
 *      且 LS 的 write-access 引用为 0，且 .vue 文本里没有 `foo:` 写入形态（TS 看不见 .vue）；
 *   3. 声明本身之外无其它引用也允许（reads=0 → `dead-both`；reads>0 → `dead-input`，
 *      即「实现读 `opts.foo ?? 默认` 但全仓没人传」的 goldLevel 死旋钮）。
 * **什么不算死**：① .vue / 其它类型里有同名写入（哪怕无关——保守压制）；② 测试里有写入；
 *   ③ spread 写入（`...partial`）在 AST 上不可见——**已知盲区**，靠 LS write-access 兜一部分，
 *   剩余风险 = 漏报（不误报），可接受。
 * **豁免/棘轮**：`DEAD_CHANNEL_LS_BASELINE` 冻结现状（key = `文件:行 符号`，每条带 since + 证据）；
 * 测试断言「实测死集合 ⊆ 基线」（**新增即红**）；基线条目已不再命中 = 改善，测试打印提示、
 * 由下任从基线删掉（棘轮只减不增，与 DEAD_CHANNEL_ALLOWLIST 同款纪律：不许为绿而登记）。
 *
 * @fact engine:guards/死通道LS 口径: 死通道=导出可选属性/内联opts可选属性 全仓零写入点（AST PropertyAssignment∪LS write-access∪vue `foo:` 三重交叉，namesake 同名写入保守压制不报）；reads=0 记 dead-both、reads>0 记 dead-input；基线棘轮新增即红；**基线键行号无关**（`文件 符号`，带行号的旧键经 normalizeBaseKey 兼容——2026-09-15 实测：无关改动给 types/resource/config.ts 插 9 行致 9 条冻结基线条目假红） | 据 实测@2026-09-15·复核@2026-09-25·复核@2026-09-27·复核@2026-09-30 | 验 src/scripts/__tests__/deadChannelLs.test.ts | 锚 scripts/lib/dead-channel-ls.mjs#scanDeadChannelsLs | 信 高
 * @fact engine:guards/死导出 口径: 死导出=src 非测试 .ts 的导出（含 `export {x} from` / `export {x as y}` 转出别名）没有任何**生产消费点**（本文件使用 / 其他 src 非测试 .ts / scripts 的 .ts / .vue 的 import）；**测试侧引用不算**（`__tests__`、`*.test.ts`、`src/test/`）——只被测试引用 = 生产死代码 + 它的测试（R33 真实病灶形态）；使用点沿别名链逐跳标记，命名空间按值用 / `import()` 未解构 ⇒ 整模块算被用（保守）；.vue 解析 `<script>` 的 import 经被导入模块导出表落到符号；例外只有 DEAD_EXPORT_TEST_SEAMS（必须与模块私有状态同处的测试接口，失效条目报红）；全仓棘轮 = 死导出为空；已知不覆盖=只被另一个死导出引用的导出（单层判定，前者删后下次扫描才红） | 据 实测@2026-10-07（r721：一次遍历反向索引取代逐导出 findReferences——⑫ 37.8s→约 5s；扫面 src/core→全 src；全仓 2402 导出中只被测试引用 21 + 零引用 5，逐条裁决：删 / 搬进测试侧 / 4 条登记测试接口） | 验 src/scripts/__tests__/deadChannelLs.test.ts | 锚 scripts/lib/dead-channel-ls.mjs#scanDeadExports + scripts/lib/dead-channel-ls.mjs#DEAD_EXPORT_TEST_SEAMS | 信 高
 */
import { createRequire } from 'node:module'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const ts = require('typescript')

/** 候选声明的扫描面（O2 盲区 stores/types 已并入）；引用分析仍覆盖整个 program */
export const DEFAULT_SCAN_DIRS = ['src/composables', 'src/core', 'src/data', 'src/stores', 'src/types']

export const REPO_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')

/**
 * 冻结基线（棘轮：只许减少）。key = `<相对文件> <属性名>`（**行号无关**——带行号的旧键仍被
 * `normalizeBaseKey` 兼容，见其注释里的错位假红事故）。
 * 每条 why 必须写「怎么证明它是死的」——不许为绿而登记（同 DEAD_CHANNEL_ALLOWLIST 纪律）。
 * 首轮实测 2026-09-14（与 T10 报告 /home/kaua/.dsh/session-manager/reports/T10-a1.md 对账见报告）。
 */
export const DEAD_CHANNEL_LS_BASELINE = {
  'src/composables/pullPlannerEngine.ts:375 freePoolPerSpecialty': {
    since: '2026-09-14',
    why: 'dead-input（**有意保留的调参旋钮**，CC-94 2026-09-27 裁决）：生产调用方都不传，走 `?? 1`（每职业 1 个免费池代表 = 现行性能剪枝口径）；`0` = 全量免费池，是实测「2 已分钟级」时留的调参入口，删了会丢失该入口。回收条件：抽卡规划器重写或确认永不调参时删字段并内联 1',
  },
}

/**
 * 死导出判据的**测试接口豁免**（r721 起取代 `DEAD_EXPORT_BASELINE`——那份基线自 R34 起就是空对象）。
 *
 * 只收「必须与模块私有状态同处」的测试接口：缓存命中计数、快路径 / 记忆化开关。它们读写模块内的
 * `let` 状态，搬不进 `src/test`。能搬的（测试夹具、断言用的常量集合）一律搬到测试侧，**不进这里**。
 * key = `<相对文件> <导出名>`；why 写清「哪些测试靠它、为什么搬不走」。
 * 条目失效（导出被删 / 长出了生产消费者）进 `staleSeams`，deadChannelLs.test ⑫ 变红——名单不许腐烂。
 */
export const DEAD_EXPORT_TEST_SEAMS = {
  'src/core/resource/rowBuild.ts getFeasibleRowsMemoHits': { since: '2026-10-07', why: '可行行记忆化命中计数，读模块私有 feasibleRowsMemo；feasibleRowsMemo.test 断言命中次数' },
  'src/core/resource/rowBuild.ts setRowFastPathsEnabled': { since: '2026-10-07', why: '行构造快路径开关，写模块私有 let；allAgentsGuards / feasibleRowsMemo 关快路径对拍慢路径' },
  'src/composables/useResourceCalc.ts getCalcOutputMemoStats': { since: '2026-10-07', why: 'calcOutput 记忆化命中 / 未命中 / 旁路计数，读模块私有状态；calcOutputMemo / wEngineCoverageFixpointT10 断言' },
  'src/composables/useResourceCalc.ts setCalcOutputMemoEnabled': { since: '2026-10-07', why: 'calcOutput 记忆化开关，写模块私有 let；calcOutputMemo / outerContinuity / allAgentsGuards 关记忆化对拍' },
}

/** 走目录收 .ts（跳过 __tests__ 与 .d.ts——测试写入也算写入，故测试文件进 program 但不进候选面） */
function walkTs(dir, out = []) {
  if (!existsSync(dir)) return out
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    const st = statSync(p)
    if (st.isDirectory()) walkTs(p, out)
    else if (e.endsWith('.ts') && !e.endsWith('.d.ts')) out.push(p)
  }
  return out
}

/** program 覆盖面：src 全部 .ts（含 __tests__，写入点要全仓计数）+ scripts 的 .ts */
export function collectProgramFiles(root) {
  return [...walkTs(join(root, 'src')), ...walkTs(join(root, 'scripts'))]
}

export function createLsHost(files, root) {
  const cache = new Map()
  const read = (f) => {
    if (cache.has(f)) return cache.get(f)
    let text = null
    try { text = readFileSync(f, 'utf8') } catch { text = null }
    cache.set(f, text)
    return text
  }
  return {
    getScriptFileNames: () => files,
    getScriptVersion: () => '0',
    getScriptSnapshot: (f) => {
      const t = read(f)
      return t == null ? undefined : ts.ScriptSnapshot.fromString(t)
    },
    getCurrentDirectory: () => root,
    getCompilationSettings: () => ({
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: false,          // 与 T10 同口径：只要引用图，不做类型检查
      noEmit: true,
      skipLibCheck: true,
      allowImportingTsExtensions: true,
      resolveJsonModule: true,
      // ★ 必须配 paths：否则 `@/core/x` 形式的 import **整个解析不到**，LS 会把被引用符号
      //   报成零引用。R33 实测：漏配时 `calcAnomalyBuildUp` / `calcDirectDamage` 等被误报为死
      //   （假阳性方向），补上后引用数从 0 → 真实值。改这一项等于改判据灵敏度，勿删。
      baseUrl: root,
      paths: { '@/*': ['src/*'] },
    }),
    getDefaultLibFileName: (o) => ts.getDefaultLibFilePath(o),
    fileExists: (f) => read(f) != null,
    readFile: (f) => read(f) ?? undefined,
    readDirectory: () => [],
  }
}

const isExported = (node) =>
  (ts.canHaveModifiers(node) ? ts.getModifiers(node) ?? [] : []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword)

/** 候选：导出 interface/type 的可选属性 + 导出函数内联 opts 形参的可选属性 */
function collectCandidates(program, scanDirs, root) {
  const inScan = (f) => scanDirs.some((d) => f.startsWith(join(root, d)))
  const cands = []
  for (const sf of program.getSourceFiles()) {
    if (sf.isDeclarationFile || !inScan(sf.fileName)) continue
    const rel = relative(root, sf.fileName)
    const addProps = (typeNode, container) => {
      if (!typeNode || !ts.isTypeLiteralNode(typeNode)) return
      for (const member of typeNode.members) {
        if (ts.isPropertySignature(member) && member.questionToken && ts.isIdentifier(member.name)) {
          cands.push({ file: rel, line: sf.getLineAndCharacterOfPosition(member.getStart()).line + 1, prop: member.name.text, container })
        }
      }
    }
    const visit = (node) => {
      if (ts.isInterfaceDeclaration(node) && isExported(node)) {
        for (const member of node.members) {
          if (ts.isPropertySignature(member) && member.questionToken && ts.isIdentifier(member.name)) {
            cands.push({ file: rel, line: sf.getLineAndCharacterOfPosition(member.getStart()).line + 1, prop: member.name.text, container: node.name.text })
          }
        }
      }
      // 导出函数/导出 const 箭头函数的内联 opts 形参
      const fn = ts.isFunctionDeclaration(node) && isExported(node) ? node
        : ts.isVariableStatement(node) && isExported(node)
          ? node.declarationList.declarations.map((d) => d.initializer).find((i) => i && (ts.isArrowFunction(i) || ts.isFunctionExpression(i)))
          : null
      if (fn && fn.parameters) {
        for (const p of fn.parameters) addProps(p.type, `${(fn.name && fn.name.text) || 'arrow'}#opts`)
      }
      ts.forEachChild(node, visit)
    }
    visit(sf)
  }
  return cands
}

/** 写入点（名字级、跨类型保守压制）：AST PropertyAssignment + `.foo =` 赋值 */
function collectValueWrites(program) {
  const writes = new Map() // prop -> [{file,line}]
  const push = (name, sf, pos) => {
    const rel = sf.fileName
    const line = sf.getLineAndCharacterOfPosition(pos).line + 1
    if (!writes.has(name)) writes.set(name, [])
    writes.get(name).push({ file: rel, line })
  }
  for (const sf of program.getSourceFiles()) {
    if (sf.isDeclarationFile) continue
    const visit = (node) => {
      if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name)) push(node.name.text, sf, node.name.getStart())
      else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
        && ts.isPropertyAccessExpression(node.left) && ts.isIdentifier(node.left.name)) push(node.left.name.text, sf, node.left.name.getStart())
      ts.forEachChild(node, visit)
    }
    visit(sf)
  }
  return writes
}

/** .vue 文本兜底：TS 看不见 .vue，任何 `^\s*foo\s*:` 行都当潜在写入（保守压制）。一次遍历建索引。 */
function buildVueWriteIndex(root) {
  const idx = new Map()
  const walk = (dir) => {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e)
      const st = statSync(p)
      if (st.isDirectory()) { if (e !== '__tests__') walk(p) }
      else if (e.endsWith('.vue')) {
        const lines = readFileSync(p, 'utf8').split('\n')
        lines.forEach((l, i) => {
          const m = l.match(/^\s*([A-Za-z_$][\w$]*)\s*:/)
          if (!m) return
          if (!idx.has(m[1])) idx.set(m[1], [])
          idx.get(m[1]).push(`${relative(root, p)}:${i + 1}`)
        })
      }
    }
  }
  const src = join(root, 'src')
  if (existsSync(src)) walk(src)
  return idx
}

/** 名字级文本出现索引（src + data + public/static 的 .ts/.vue/.json）：file:line 集合，供隔离判定 */
function buildNameOccurrenceIndex(root) {
  const idx = new Map()
  const exts = new Set(['.ts', '.vue', '.json'])
  const addFile = (p) => {
    if (!exts.has(p.slice(p.lastIndexOf('.')))) return
    let text
    try { text = readFileSync(p, 'utf8') } catch { return }
    const rel = relative(root, p)
    text.split('\n').forEach((l, i) => {
      for (const m of l.matchAll(/\b([A-Za-z_$][\w$]*)\b/g)) {
        const k = `${rel}:${i + 1}`
        if (!idx.has(m[1])) idx.set(m[1], new Set())
        idx.get(m[1]).add(k)
      }
    })
  }
  const walk = (dir) => {
    if (!existsSync(dir)) return
    for (const e of readdirSync(dir)) {
      const p = join(dir, e)
      const st = statSync(p)
      if (st.isDirectory()) { if (e !== '__tests__' && e !== 'node_modules') walk(p) }
      else addFile(p)
    }
  }
  walk(join(root, 'src'))
  walk(join(root, 'data'))
  walk(join(root, 'public', 'static'))
  return idx
}

/**
 * 扫描死通道。
 * @param {{root?: string, dirs?: string[], files?: string[]}} [opts] root=仓库根；files 供单测注入自建 program
 * @returns {{dead: Array<{key:string,file:string,line:number,prop:string,container:string,reads:number,confidence:'dead-both'|'dead-input',evidence:string}>, candidates:number, ms:number}}
 */
export function scanDeadChannelsLs(opts = {}) {
  const root = opts.root ?? REPO_ROOT
  const dirs = opts.dirs ?? DEFAULT_SCAN_DIRS
  const t0 = Date.now()
  const files = opts.files ?? collectProgramFiles(root)
  const ls = ts.createLanguageService(createLsHost(files, root))
  const program = ls.getProgram()
  const cands = collectCandidates(program, dirs, root)
  const writes = collectValueWrites(program)
  const vueIdx = buildVueWriteIndex(root)
  const occIdx = opts.strictTextIsolation === false ? null : buildNameOccurrenceIndex(root)
  const dead = []
  const seen = new Set()
  for (const c of cands) {
    const key0 = `${c.file}:${c.line} ${c.prop}`
    /**
     * **行号无关键**（2026-09-15 加）：`key0` 含行号 ⇒ 只要在它上面插/删任意行，
     * 已冻结的基线条目就整体错位，实测会把**同一个死字段**报成「新增死通道」而红
     * （事故：自由对比/爱丽丝剑仪两笔各给 `types/resource/config.ts` 加了若干行，
     * 该文件里 9 条 roxy / claret / norma 系基线条目行号 +9 ⇒ 判据 14-LS 当场假红 9 条，
     * 而它们**一条没变**）。棘轮要拦的是「新的死字段」，不是「同一字段换了行号」。
     * 引用分析与基线比对一律用本键；`file`/`line` 仍保留在返回值里供人定位。
     */
    const stableKey = `${c.file} ${c.prop}`
    if (seen.has(stableKey)) continue
    seen.add(stableKey)
    if (writes.has(c.prop)) continue                      // AST 名字级写入（含 namesake，保守压制）
    const abs = join(root, c.file)
    const src = program.getSourceFile(abs)
    if (!src) continue
    const lines = src.text.split('\n')
    const lineText = lines[c.line - 1] ?? ''
    const offset = lines.slice(0, c.line - 1).reduce((s, l) => s + l.length + 1, 0) + lineText.indexOf(c.prop)
    let lsWrites = 0
    let reads = 0
    const readLocs = []
    const attributed = new Set([`${c.file}:${c.line}`])   // 声明行 + LS 归属的引用行 = 允许出现处
    for (const sym of ls.findReferences(abs, offset) ?? []) {
      for (const r of sym.references) {
        const rf = program.getSourceFile(r.fileName)
        if (rf) {
          const rl = rf.getLineAndCharacterOfPosition(r.textSpan.start).line + 1
          attributed.add(`${relative(root, r.fileName)}:${rl}`)
        }
        if (r.isDefinition) continue
        if (r.isWriteAccess) { lsWrites++; continue }
        reads++
        if (readLocs.length < 3 && rf) readLocs.push(`${relative(root, r.fileName)}:${rf.getLineAndCharacterOfPosition(r.textSpan.start).line + 1}`)
      }
    }
    if (lsWrites > 0) continue
    if (vueIdx.has(c.prop)) continue
    // 名字级文本隔离（防 namesake / spread / JSON 数据契约误报）：除声明行与 LS 归属引用行外，
    // 该名字在 src+data+public/static 里还有任何出现 ⇒ 保守压制不报（O2 反误报的核心闸门）
    if (occIdx) {
      const extra = [...(occIdx.get(c.prop) ?? [])].filter((loc) => !attributed.has(loc))
      if (extra.length > 0) continue
    }
    dead.push({
      key: stableKey,
      keyWithLine: key0,
      file: c.file,
      line: c.line,
      prop: c.prop,
      container: c.container,
      reads,
      confidence: reads === 0 ? 'dead-both' : 'dead-input',
      evidence: reads === 0
        ? `零写入点（AST+LS+vue 三重交叉）且零读取；容器 ${c.container}`
        : `零写入点（AST+LS+vue 三重交叉）；实现读 ${reads} 处（${readLocs.join('、')}）走 ?? 默认`,
    })
  }
  dead.sort((a, b) => a.key.localeCompare(b.key))
  return { dead, candidates: cands.length, ms: Date.now() - t0 }
}

/** 棘轮 diff：fresh = 实测有但基线没有（红）；resolved = 基线有但实测没有（改善，打印提示） */
/**
 * 基线键规范化：容忍两种写法 ——
 * - 老写法 `<文件>:<行> <符号>`（首轮 2026-09-14 生成，键里带行号）
 * - 新写法 `<文件> <符号>`（行号无关，推荐）
 * 两条都归一到 `文件 符号` 再比对 ⇒ **老的基线不必重写**即可获得行号无关性
 * （迁移是渐进的：下次动到某条时顺手去掉行号即可）。
 */
export function normalizeBaseKey(k) {
  // 去掉 `:数字` 行号段（路径里不会有 `:数字 ` 这种形状）
  return String(k).replace(/:\d+\s/, ' ')
}

export function diffAgainstBaseline(dead, baseline = DEAD_CHANNEL_LS_BASELINE) {
  const base = new Set(Object.keys(baseline).map(normalizeBaseKey))
  const now = new Set(dead.map((d) => normalizeBaseKey(d.key)))
  return {
    fresh: dead.filter((d) => !base.has(normalizeBaseKey(d.key))),
    // resolved 用「基线键规范化后是否仍出现在实测集合」判定
    resolved: Object.keys(baseline).filter((k) => !now.has(normalizeBaseKey(k))),
  }
}

// 基线生成记录（2026-09-14 首轮）：`node -e "import('./scripts/lib/dead-channel-ls.mjs').then(m=>console.log(JSON.stringify(m.scanDeadChannelsLs().dead,null,1)))"`
// → 逐条人工复核后钉进 DEAD_CHANNEL_LS_BASELINE（每条 why 带证据行号）；复核过程与 T10 对账见夜班报告 T14-a1。

/** 测试侧文件：`__tests__/`、`*.test.ts`、`*.spec.ts` 与 `src/test/`（测试基础设施）——它们的引用不算消费 */
function isTestSide(root, f) {
  const p = f.replace(/\\/g, '/')
  return /\/__tests__\/|\.(test|spec)\.ts$/.test(p) || p.startsWith(root.replace(/\\/g, '/') + '/src/test/')
}

/** `.vue` 的 import 说明符 → 仓内文件（`@/` = src；相对路径按 .vue 所在目录）；解析不到返回 null */
function resolveVueSpecifier(root, fromFile, spec) {
  let base
  if (spec.startsWith('@/')) base = join(root, 'src', spec.slice(2))
  else if (spec.startsWith('.')) base = join(dirname(fromFile), spec)
  else return null
  for (const c of [base, base + '.ts', join(base, 'index.ts')]) {
    if (existsSync(c) && statSync(c).isFile()) return c
  }
  return null
}

function walkVue(dir, out = []) {
  if (!existsSync(dir)) return out
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e === '__tests__') continue
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walkVue(p, out)
    else if (e.endsWith('.vue')) out.push(p)
  }
  return out
}

const exportKindOf = (d) => ts.isFunctionDeclaration(d) ? 'function'
  : ts.isVariableDeclaration(d) ? 'const'
    : ts.isInterfaceDeclaration(d) ? 'interface'
      : ts.isTypeAliasDeclaration(d) ? 'type'
        : ts.isClassDeclaration(d) ? 'class'
          : ts.isEnumDeclaration(d) ? 'enum'
            : ts.isExportSpecifier(d) ? 'reexport' : 'other'

/**
 * **死导出扫描**（r721 起：全 `src` 层 · 只认生产消费）。
 *
 * 判定：`src` 下非测试 `.ts` 的每个导出（含 `export {x} from` / `export {x as y}` 转出别名），没有任何
 * **生产消费点**即为死导出。生产消费点 = 本文件内使用 / 其他 `src` 非测试 `.ts` / `scripts` 的 `.ts` / `.vue` 的 import。
 * **测试侧引用不算**（`__tests__`、`*.test.ts`、`src/test/`）：只被测试引用的导出 = 生产死代码 + 它的测试
 * ——R33 的真实病灶（`damage.test.ts` 测的是 `damage.ts` 的死副本，活实现零测试）正是这一形态。
 *
 * 实现：一次遍历生产文件的全部标识符，把使用点解析到符号并**沿别名链逐跳标记**（`import {a as b}`、
 * `export {x} from` 的每一跳都算被用，原始声明也算）；import / export 语句本身不是使用。三类写法单独解析：
 * 命名空间 `ns.x`、对象解构 `const {x} = ns`（含 `await import()` 解构）、简写属性 `{ x }`。
 * 保守兜底（宁可漏报不误报）：命名空间被当值用（`ns[k]`、`Object.values(ns)`、传参）或 `import()` 结果未解构
 * ⇒ 该模块全部导出算被用。`.vue` 不在 program 里：解析其 `<script>` 块的 import，按名字经被导入模块的导出表落到符号。
 *
 * 取代 `scanDeadExportsLs`（逐导出 `findReferences`，只扫 core，测试引用算活；⑫ 单例 37.8s）与 R34 的
 * `auditNonCoreDeadExports`（非 core 三道兜底，只报不红）。
 * 已知不覆盖：只被另一个死导出引用的导出，要等前者删掉后的下一次扫描才红（单层判定）。
 *
 * @param {{root?: string, seams?: Record<string, {since: string, why: string}>}} [opts]
 * @returns {{dead: Array<{key:string,file:string,line:number,name:string,kind:string}>, staleSeams: string[], exports: number, ms: number}}
 */
export function scanDeadExports(opts = {}) {
  const root = opts.root ?? REPO_ROOT
  const seams = opts.seams ?? DEAD_EXPORT_TEST_SEAMS
  const t0 = Date.now()
  const program = ts.createLanguageService(createLsHost(collectProgramFiles(root), root)).getProgram()
  const checker = program.getTypeChecker()
  const srcDir = join(root, 'src')
  const used = new Set()
  const wholeModules = new Set()
  const mark = (sym) => {
    for (let s = sym, hop = 0; s && hop < 32; hop++) {
      used.add(s)
      const ex = checker.getExportSymbolOfSymbol(s)
      if (ex) used.add(ex)
      if (!(s.flags & ts.SymbolFlags.Alias)) return
      s = checker.getImmediateAliasedSymbol(s)
    }
  }
  const moduleFileOf = (specifier) => {
    const m = checker.getSymbolAtLocation(specifier)
    const d = m && (m.valueDeclaration ?? (m.declarations ?? [])[0])
    return d && ts.isSourceFile(d) ? d.fileName : null
  }
  const namespaceDecl = (sym) => sym && (sym.declarations ?? []).find((d) => ts.isNamespaceImport(d))
  const isDeclName = (id, p) => p.name === id && (ts.isFunctionDeclaration(p) || ts.isVariableDeclaration(p) || ts.isClassDeclaration(p)
    || ts.isInterfaceDeclaration(p) || ts.isTypeAliasDeclaration(p) || ts.isEnumDeclaration(p) || ts.isModuleDeclaration(p)
    || ts.isParameter(p) || ts.isPropertyDeclaration(p) || ts.isPropertySignature(p) || ts.isMethodDeclaration(p)
    || ts.isMethodSignature(p) || ts.isPropertyAssignment(p) || ts.isEnumMember(p) || ts.isGetAccessor(p) || ts.isSetAccessor(p)
    || ts.isTypeParameterDeclaration(p))
  const isDynamicImport = (n) => ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword
    && n.arguments.length > 0 && ts.isStringLiteralLike(n.arguments[0])
  const destructuredAwait = (call) => {
    const p = call.parent
    const gp = p && p.parent
    return !!(p && ts.isAwaitExpression(p) && gp && ts.isVariableDeclaration(gp) && ts.isObjectBindingPattern(gp.name)) && gp
  }

  // ---- 生产 .ts：标识符使用点 ----
  for (const sf of program.getSourceFiles()) {
    const f = sf.fileName
    if (sf.isDeclarationFile || !f.startsWith(root) || f.includes('/node_modules/') || isTestSide(root, f)) continue
    const visit = (node) => {
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return
      if (ts.isExportAssignment(node) && ts.isIdentifier(node.expression)) return
      if (isDynamicImport(node) && !destructuredAwait(node)) {
        const mf = moduleFileOf(node.arguments[0])
        if (mf) wholeModules.add(mf)
      }
      if (ts.isIdentifier(node)) {
        const p = node.parent
        if (!p || isDeclName(node, p)) return
        if (ts.isPropertyAccessExpression(p) && p.name === node) {
          if (ts.isIdentifier(p.expression) && namespaceDecl(checker.getSymbolAtLocation(p.expression))) mark(checker.getSymbolAtLocation(node))
          return
        }
        if (ts.isQualifiedName(p) && p.right === node) {
          if (ts.isIdentifier(p.left) && namespaceDecl(checker.getSymbolAtLocation(p.left))) mark(checker.getSymbolAtLocation(node))
          return
        }
        if (ts.isBindingElement(p) && ts.isObjectBindingPattern(p.parent) && (p.propertyName === node || (!p.propertyName && p.name === node))) {
          const host = p.parent.parent
          if (ts.isVariableDeclaration(host) && host.initializer) {
            const prop = checker.getTypeAtLocation(host.initializer).getProperty(node.text)
            if (prop) mark(prop)
          }
          return
        }
        if (ts.isShorthandPropertyAssignment(p)) {
          mark(checker.getShorthandAssignmentValueSymbol(p))
          return
        }
        const sym = checker.getSymbolAtLocation(node)
        const ns = namespaceDecl(sym)
        if (ns) {
          const asBase = (ts.isPropertyAccessExpression(p) && p.expression === node) || (ts.isQualifiedName(p) && p.left === node)
          const destructured = ts.isVariableDeclaration(p) && p.initializer === node && ts.isObjectBindingPattern(p.name)
          if (!asBase && !destructured) {
            const mf = moduleFileOf(ns.parent.parent.moduleSpecifier)
            if (mf) wholeModules.add(mf)
          }
          return
        }
        mark(sym)
        return
      }
      ts.forEachChild(node, visit)
    }
    visit(sf)
  }

  // ---- .vue：<script> 块的 import（program 看不见 .vue） ----
  for (const vf of walkVue(srcDir)) {
    for (const m of readFileSync(vf, 'utf8').matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) {
      const vsf = ts.createSourceFile(vf + '.ts', m[1], ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
      const moduleOf = (spec) => {
        const target = resolveVueSpecifier(root, vf, spec)
        const tsf = target && program.getSourceFile(target)
        return tsf ? { file: target, mod: checker.getSymbolAtLocation(tsf) } : null
      }
      const byName = (mod, name) => {
        const s = mod && checker.tryGetMemberInModuleExports(name, mod)
        if (s) mark(s)
      }
      const visitVue = (node) => {
        if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
          const t = moduleOf(node.moduleSpecifier.text)
          const clause = node.importClause
          if (t && clause) {
            if (clause.name) byName(t.mod, 'default')
            const nb = clause.namedBindings
            if (nb && ts.isNamespaceImport(nb)) wholeModules.add(t.file)
            else if (nb) for (const el of nb.elements) byName(t.mod, (el.propertyName ?? el.name).text)
          }
          return
        }
        if (isDynamicImport(node)) {
          const t = moduleOf(node.arguments[0].text)
          const gp = destructuredAwait(node)
          if (t && gp) {
            for (const el of gp.name.elements) {
              const n = el.propertyName ?? el.name
              if (ts.isIdentifier(n)) byName(t.mod, n.text)
            }
          } else if (t) wholeModules.add(t.file)
        }
        ts.forEachChild(node, visitVue)
      }
      visitVue(vsf)
    }
  }

  // ---- 候选：src 非测试 .ts 的导出 ----
  const dead = []
  const seamAlive = new Map()
  let exportCount = 0
  for (const sf of program.getSourceFiles()) {
    const f = sf.fileName
    if (sf.isDeclarationFile || !f.startsWith(srcDir + '/') || isTestSide(root, f)) continue
    const mod = checker.getSymbolAtLocation(sf)
    if (!mod) continue
    const rel = relative(root, f)
    for (const sym of checker.getExportsOfModule(mod)) {
      const d = (sym.declarations ?? [])[0]
      // `export *` 透传的名字声明在别处，由声明处判
      if (!d || d.getSourceFile() !== sf) continue
      exportCount++
      const key = `${rel} ${sym.getName()}`
      const alive = wholeModules.has(f) || used.has(sym)
      if (Object.prototype.hasOwnProperty.call(seams, key)) { seamAlive.set(key, alive); continue }
      if (alive) continue
      const node = ts.isVariableDeclaration(d) ? d.parent.parent : d
      dead.push({ key, file: rel, line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1, name: sym.getName(), kind: exportKindOf(d) })
    }
  }
  const staleSeams = Object.keys(seams).filter((k) => seamAlive.get(k) !== false).sort()
  dead.sort((a, b) => a.key.localeCompare(b.key))
  return { dead, staleSeams, exports: exportCount, ms: Date.now() - t0 }
}
