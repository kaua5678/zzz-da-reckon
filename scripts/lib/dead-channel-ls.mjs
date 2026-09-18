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
 * @fact engine:guards/死通道LS 口径: 死通道=导出可选属性/内联opts可选属性 全仓零写入点（AST PropertyAssignment∪LS write-access∪vue `foo:` 三重交叉，namesake 同名写入保守压制不报）；reads=0 记 dead-both、reads>0 记 dead-input；基线棘轮新增即红；**基线键行号无关**（`文件 符号`，带行号的旧键经 normalizeBaseKey 兼容——2026-09-15 实测：无关改动给 types/resource/config.ts 插 9 行致 9 条冻结基线条目假红） | 据 实测@2026-09-15 | 验 src/scripts/__tests__/deadChannelLs.test.ts | 锚 scripts/lib/dead-channel-ls.mjs#scanDeadChannelsLs | 信 高
 * @fact engine:guards/死导出LS 口径: 死导出=**导出函数/const/interface/type/class/enum** 在 LS 符号级 `findReferences` 下零引用（定义本身不计，program 含 __tests__）——与上一条候选面**正交**（上一条只认「可选属性」⇒ 对 calcDamage 这类死函数结构性全盲，因它签名里没有可选属性）；**只扫 src/core**（引擎层不被 .vue 直接消费；其它层 program 看不见 .vue 会有噪声）；棘轮 DEAD_EXPORT_BASELINE **R34 起为空对象**（新增即红；空基线必须配反空洞下限，否则「扫不到东西」与「真的零死导出」读数不可区分）；已知盲区=动态 import 变量化 / .vue 直引（判据 7 越层基线归零前未构造性排除）/ `ns[name]` 动态取用 | 据 实测@2026-09-18（R33：符号级实测 calcDamage 全仓仅 1 处=定义本身，无动态/字符串引用 ⇒ 删；同批删 3 死函数 + 1 死 helper，damage.ts −343 行。R34：首轮 3 条同法裁决为删并落地 ⇒ 基线归零） | 验 src/scripts/__tests__/deadChannelLs.test.ts | 锚 scripts/lib/dead-channel-ls.mjs#scanDeadExportsLs | 信 高
 */
import { createRequire } from 'node:module'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'
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
    why: 'dead-input：实现读 `opts.freePoolPerSpecialty ?? 默认`（:417），全仓（CharIncrementPage/TimeChartsPage 等调用方）零传入；判据 14 正则版同条已登记（B|…freePoolPerSpecialty），LS 版符号级复核一致',
  },
  'src/types/catalog.ts:191 agentSkillId': {
    since: '2026-09-14',
    why: 'dead-both：全仓 grep -w 仅命中本声明行（SkillTarget.agentSkillId 零读零写）',
  },
  'src/types/catalog.ts:293 skillLevelBonuses': {
    since: '2026-09-14',
    why: 'dead-both：全仓仅命中声明行（CoreSkillLevel.skillLevelBonuses 零读零写）',
  },
  'src/types/resource/config.ts:257 roxyWindCannonMoveId': {
    since: '2026-09-14',
    why: 'dead-both：CharacterOperationConfig 的仪玄风炮槽位——全仓仅命中声明行，模块（yixuan.ts）用别的字段名取数，此槽零读零写',
  },
  'src/types/resource/config.ts:259 roxyWindEyeMoveId': {
    since: '2026-09-14',
    why: 'dead-both：同 roxy 族，全仓仅命中声明行',
  },
  'src/types/resource/config.ts:263 roxyCycloneHammerMoveId': {
    since: '2026-09-14',
    why: 'dead-both：同 roxy 族，全仓仅命中声明行',
  },
  'src/types/resource/config.ts:265 roxyCycloneHammerCount': {
    since: '2026-09-14',
    why: 'dead-both：同 roxy 族，全仓仅命中声明行',
  },
  'src/types/resource/config.ts:277 claretMaimBurialMoveId': {
    since: '2026-09-14',
    why: 'dead-both：克拉蕾残痕族槽位，全仓仅命中声明行（模块未接此槽）',
  },
  'src/types/resource/config.ts:285 claretMaimBurialDamageMultiplier': {
    since: '2026-09-14',
    why: 'dead-both：同 claret 族，全仓仅命中声明行',
  },
  'src/types/resource/config.ts:317 claretSharpnessCost': {
    since: '2026-09-14',
    why: 'dead-both：同 claret 族（残痕消耗值在实现里另有来源，此配置槽零读零写）',
  },
  'src/types/resource/config.ts:449 normaBarrageCoverage': {
    since: '2026-09-14',
    why: 'dead-both：诺姆弹幕覆盖率槽，全仓仅命中声明行',
  },
  'src/types/resource/config.ts:451 normaTechGapCoverage': {
    since: '2026-09-14',
    why: 'dead-both：同 norma 族，全仓仅命中声明行',
  },
}

/**
 * 冻结基线：**`src/core` 的零引用导出函数**（棘轮，只许减少）。
 *
 * 为什么只扫 `src/core`（口径，别扩面）：
 * - `src/core` 是**引擎层**，按 ARCHITECTURE §0 依赖方向（展示 → 编排 → 引擎）**不被 .vue 直接消费**
 *   ⇒ 不需要 `.vue` 文本兜底，误报面最小。⚠ 判据 7 的越层棘轮基线仍是 **15**（非 0）
 *   ⇒ 「core 不被 .vue 引用」**不是**构造性保证，只是当前状态；若越层数变化需复核本判据。
 * - 其它层（`src/composables` / `src/data` / `src/mechanics`）**大量**被 .vue 消费，而 TS program
 *   **看不见 .vue** ⇒ 必须靠文本兜底，实测仍有噪声（见 R33 报告）⇒ 不纳入硬判据，只报不红。
 *
 * 每条 why 必须写「怎么证明它是死的」——不许为绿而登记（同 DEAD_CHANNEL_ALLOWLIST 纪律）。
 * R33（2026-09-18）首轮实测：**3 条**（`isVariantPair` + substatAlloc 两条）。
 * ⚠ 同批删掉的 4 个（`damage.ts` 的 calcDamage / calcStunBuildUp / calcDisorderDamage +
 *   旧 `pickRemielleLevelValue`）**一律不进基线**——它们当轮就没
 *   （棘轮语义 = 「现在是死的」；改进项应表现为 resolved，而不是留一条永不命中的键）。
 *
 * ★ R34（2026-09-18）**归零**：首轮那 3 条已全部裁决为删并落地（见各条原 why 的历史结论）——
 *   · `isVariantPair`：**陷阱**（不是无害死码）。它把「基础元素相同」当作「同一个异常」，
 *     而活口径恰好相反：变种元素是**独立积蓄槽**、**可互相紊乱**（`anomalyPool.ts` 覆盖率
 *     `coverageTriggerCounts` 按变体自身元素统计，`helpers.ts` 头注释原文「变种元素之间在紊乱
 *     系统中视为不同元素」）。⇒ 读它的人会得出**与活实现相反**的紊乱资格结论。
 *   · `substatAlloc.ts` 两条 + 整个文件：旧固定步数启发式（100% 暴击封顶），活实现是
 *     `substatOptimizer.ts#computeOptimalSubStats`（`critRateCap` 200%，锋御锐暴）；
 *     其 `computeBaseCritRate` 与活 `computeNoSubstatPanel` **同形但分叉**（后者不读 globalBuffs、
 *     不吃 `critRate` 特判）⇒ 同 `roughStats.critRate` 型陷阱：值会算偏。
 *   ⇒ 基线现在是**空对象**（这是目标态，不是失败）：任何**新**死导出都会被判 fresh 而红。
 *   ⚠ 空基线必须配**反空洞下限**（见 deadChannelLs.test.ts ⑫ 的 `exports > 100`）——
 *     否则「扫描器静默扫不到东西」与「仓库真的零死导出」在读数上不可区分。
 */
export const DEAD_EXPORT_BASELINE = {}

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
//
// 死导出基线生成记录（2026-09-18 R33 首轮，同样逐条人工复核）：
// `node -e "import('./scripts/lib/dead-channel-ls.mjs').then(m=>console.log(JSON.stringify(m.scanDeadExportsLs().dead,null,1)))"`

/**
 * **符号级死导出扫描**（R32-J2 的直接产物，补 DEAD_CHANNEL_LS_BASELINE 的**函数面**盲区）。
 *
 * 与 `scanDeadChannelsLs` 的区别（两者互补，都要）：
 * - 旧扫描：候选 = 导出 **interface 的可选属性** / 内联 opts 可选属性 ⇒ 找的是「**死旋钮**」；
 * - 本扫描：候选 = 导出 **函数/const/interface/type/class/enum** ⇒ 找的是「**死函数**」。
 *   ⇒ 旧扫描对 `calcDamage`（一个 200 行的死函数，**不是**可选属性）**结构性全盲**：
 *     它的签名里没有一个可选属性，扫描器连看都不会看它一眼。这才是 R32-J2 能藏那么久的机器面原因。
 *
 * 判定 = **LS 符号级零引用**（`findReferences` 在整个 program 上，含 __tests__；定义本身不计）。
 * 零引用 ⇒ 连测试都没碰过它 —— 比「字段名级 grep」强得多（grep 看不见 `import { a as b }`）。
 *
 * ⚠ **只扫 `src/core`**（理由见 DEAD_EXPORT_BASELINE 头注释）：其它层被 .vue 消费而 program 看不见 .vue。
 * ⚠ 已知盲区（如实登记，不假装覆盖）：① 动态 `import()` 变量化 / 字符串拼接引用；② .vue 直接引用
 *   （仅当判据 7 越层棘轮归零后才构造性排除，当前基线 15 ⇒ 未排除）；③ `import * as ns` 后
 *   `ns[name]` 动态取用（LS 记为 write/read 但符号可能是 any）。
 *
 * @param {{root?: string, dirs?: string[], files?: string[]}} [opts]
 * @returns {{dead: Array<{key:string,file:string,line:number,name:string,kind:string}>, exports:number, ms:number}}
 */
export function scanDeadExportsLs(opts = {}) {
  const root = opts.root ?? REPO_ROOT
  const dirs = opts.dirs ?? ['src/core']
  const t0 = Date.now()
  const files = opts.files ?? collectProgramFiles(root)
  const ls = ts.createLanguageService(createLsHost(files, root))
  const program = ls.getProgram()
  const checker = program.getTypeChecker()
  const inScan = (f) => dirs.some((d) => f.startsWith(join(root, d)))
  const dead = []
  let exportCount = 0
  for (const sf of program.getSourceFiles()) {
    if (sf.isDeclarationFile || !inScan(sf.fileName)) continue
    const rel = relative(root, sf.fileName)
    const modSym = checker.getSymbolAtLocation(sf)
    if (!modSym) continue
    let exports = []
    try { exports = checker.getExportsOfModule(modSym) } catch { continue }
    for (const sym of exports) {
      const decls = sym.getDeclarations() ?? []
      const d = decls[0]
      // 只认「在本文件里声明」的导出（跳过 `export { x } from './y'` 的转出口，避免重复计数）
      if (!d || !d.getSourceFile || d.getSourceFile() !== sf) continue
      exportCount++
      const name = sym.getName()
      const pos = d.name && d.name.getStart ? d.name.getStart() : d.getStart()
      let refs = []
      try { refs = ls.findReferences(sf.fileName, pos) ?? [] } catch { refs = [] }
      let n = 0
      for (const g of refs) for (const r of g.references) if (!r.isDefinition) n++
      if (n > 0) continue
      const kind = ts.isFunctionDeclaration(d) ? 'function'
        : ts.isVariableDeclaration(d) ? 'const'
          : ts.isInterfaceDeclaration(d) ? 'interface'
            : ts.isTypeAliasDeclaration(d) ? 'type'
              : ts.isClassDeclaration(d) ? 'class'
                : ts.isEnumDeclaration(d) ? 'enum' : 'other'
      dead.push({
        key: `${rel} ${name}`,
        file: rel,
        line: sf.getLineAndCharacterOfPosition(d.getStart()).line + 1,
        name,
        kind,
      })
    }
  }
  dead.sort((a, b) => a.key.localeCompare(b.key))
  return { dead, exports: exportCount, ms: Date.now() - t0 }
}
