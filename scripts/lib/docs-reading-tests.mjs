/**
 * 「读 docs 的测试」显式清单 + 判定器（T114，2026-10-09）。
 *
 * ## 为什么需要
 * 流程文档 §6 选项②「只改文档的提交跳过 vitest、只跑 check-guards」一直挂着「未采用」，
 * 理由只写了一句散文「读取 docs 的测试会红，本轮已实测会红」。T114 把它做成机器判据：
 * 先有**显式清单 + 棘轮**，才允许把「docs-only ⇒ 只跑清单」这条快路接进收尾流程。
 *
 * ## 本仓库的硬约束：只能靠显式清单，不能靠 `--changed` / import 图
 * T114 实测（基线 `0b81c1df`，隔离 worktree，`vitest 4.1.10`）：
 * - 改 `docs/**` ⇒ `vitest list --changed HEAD` 选中 **0** 个文件，而同一改动
 *   实测会打红 `checkGuards.test.ts`（§4 行数棘轮 `728 > 727`）⇒ **静默漏测**；
 * - 改 `public/static/catalog.json` ⇒ 同样选中 **0** 个文件，而仓库有 **52** 个测试文件
 *   经 `mockStaticFetch` 读该数据（`grep -rl "mockStaticFetch" src --include=*.test.ts` = 64）；
 * - 改 `src/composables/useResourceCalc.ts` + `src/core/resource/helpers.ts` ⇒ 选中 **222** 个文件、
 *   跑 **204.9 s**，而同机同时段全量 `npm test` = **242.7 s** ⇒ 快环反而更慢且仍漏 27 个引用它的测试文件。
 *
 * ## 判定器口径（**宁多勿漏**，但只收「真读 docs / 真读仓库现状」）
 * 集合 = 三条规则的并集，**不是**人工精选的「真的读 docs」集：
 *   ① 从测试文件出发走本地 import 闭包（相对路径 + `@/` 别名 + `scripts/` 前缀），
 *      闭包里任一文件命中「读 docs 信号」（`docs/` 路径、`'docs'` 字面量、`README.md`、任何 `*.md` 文件名）⇒ 入选；
 *   ② 测试**自身**起子进程或写 `scripts/*.mjs` 路径字面量（`execSync|execFileSync|spawnSync|execFile|spawn`
 *      或 `scripts/**.mjs`）⇒ 入选。理由：`child_process` 的目标对静态 import 图**不可见**，
 *      而这些脚本读 docs / 读仓库现状（本仓库实有 20+ 处）；
 *   ③ 测试**自身**跑仓库级扫描（`git ls-files` / `git grep` / `grep -r`）⇒ 入选。同理：读的是仓库现状，
 *      import 图看不见。
 *
 * ⚠ **为什么不收「闭包触及 `scripts/**`」**（T114 实测踩到，记录以免重犯）：那条规则会把任何
 * 传递 import 了 `scripts/lib/` 下**纯数据模块**的测试都捞进来——实测 `difficultyCurveWorker.test.ts`
 * 只因 `presetCategories.mjs`（零 docs 引用）被闭包命中而入选，而同一规则还让集合随 `scripts/lib/`
 * 的新增数据模块**无界增长**（并行会话新增一个测试文件即红）。收窄为 ②③（只认**测试自身**的
 * 子进程/扫描面）后集合从 35 降到 **31**，且不影响任何真读者：① 覆盖全部直接读 docs 的测试。
 * 代价是 T114 实测 31 文件 / 约 40 秒（对全量 248.2 秒仍是 84% 的节省）。
 *
 * ## 棘轮（在 `src/scripts/__tests__/checkGuards.test.ts`）
 * ① 清单必须逐字等于 `DOCS_READING_TESTS`（防静默放宽/收紧）；
 * ② 每个条目必须真实存在（防改名后清单退化成空集而无人察觉）；
 * ③ **每个「读 docs 且被某个测试闭包覆盖」的源文件必须在某条清单条目的闭包内**（防新写一个读 docs 的
 *    扫描器却没人把它挂进清单）。⚠ 口径限定在「被测试覆盖」上：仓库里另有 11 个读 docs 的源文件是
 *    CLI 工具 / `.vue` 页面（`scripts/resolve.mjs` / `validate-specs.mjs` /
 *    `generate-implementation-status.mjs` / `MultiplierCoeffPage.vue` 等），它们**本来就没有**
 *    对应测试文件，要求「必须被清单覆盖」是错的判据（会把 11 条正确状态判红）；
 * ④ 反空洞下限：清单条数 ≥ `DOCS_READING_MIN_TESTS`、扫描面 ≥ `DOCS_READING_MIN_SCANNED`。
 *
 * ⚠ 本模块**不进** `check` / `verify` 链（与 `test:fast` 同规矩：快环只能是可选的收尾提速路径）。
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

/** 不参与闭包扫描的目录（依赖 / 版本库 / 生成产物） */
export const DOCS_READING_SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'coverage'])

/** 反空洞下限：清单条数小于此数 ⇒「清单仍有效」不可采信（T114 实测 31） */
export const DOCS_READING_MIN_TESTS = 28
/** 反空洞下限：扫描面（src+scripts 源文件数）小于此数 ⇒ 扫描器失明（T114 实测 998） */
export const DOCS_READING_MIN_SCANNED = 800

/**
 * 「读 docs 的测试」显式清单（T114 @ `0b81c1df` 实测派生，**31 条**）。
 *
 * 派生方式见本文件头注释（规则 ①∪②∪③）；**人工复核过**：
 * - 直接读者：`multiplierRecord`（读 `docs/multiplier-record.md`）、`specTeamBuffSingleSource`
 *   （读 `docs/mechanism-reference.md`）、`checkGuards`（§4 行数 / 密度 / README 文档表 / `@fact`）；
 * - 起子进程 / 跑仓库级扫描的守卫类：`zc*`、`checkTokens`、`deadChannelLs`、`jsonDupKeys`、
 *   `idLiteralGate`、`layerInversion`、`scopedStyleReach`、`timeGolden`（`git status` 查 catalog 脏否）等。
 *
 * ⚠ 2026-10-10 T128 追加 1 条（31 → **32**）：`fieldWriterUniqueness`（判据 30）——它按规则 ② 入选
 * （测试自身写 `scripts/lib/field-writer-uniqueness.mjs` 路径字面量），跑的是仓库级 AST 扫描
 * （读 `src/**` 现状，与 `idLiteralGate` 同族）。加清单条目是本判据规定的动作（checkGuards 的棘轮会红）。
 */
export const DOCS_READING_TESTS = [
  'src/composables/__tests__/agentColorSingleSource.test.ts',
  'src/composables/__tests__/compactedSlotValueBlindSpot.test.ts',
  'src/composables/__tests__/multiplierRecord.test.ts',
  'src/composables/__tests__/outerContinuity.test.ts',
  'src/composables/__tests__/phaseBuffParser.test.ts',
  'src/composables/__tests__/timeGolden.test.ts',
  'src/core/__tests__/calcPanelCallContract.test.ts',
  'src/core/__tests__/coreMechanicsRegistryOnly.test.ts',
  'src/data/__tests__/teamPresets.test.ts',
  'src/mechanics/__tests__/specResourceTotalSingleSource.test.ts',
  'src/mechanics/__tests__/specTeamBuffSingleSource.test.ts',
  'src/scripts/__tests__/agentIdentity.test.ts',
  'src/scripts/__tests__/checkGuards.test.ts',
  'src/scripts/__tests__/checkTokens.test.ts',
  'src/scripts/__tests__/compactedSlotIndex.test.ts',
  'src/scripts/__tests__/deadChannelLs.test.ts',
  'src/scripts/__tests__/fieldWriterUniqueness.test.ts',
  'src/scripts/__tests__/idLiteralGate.test.ts',
  'src/scripts/__tests__/jsonDupKeys.test.ts',
  'src/scripts/__tests__/layerInversion.test.ts',
  'src/scripts/__tests__/moveElementReconcile.test.ts',
  'src/scripts/__tests__/recordKeyDeadReads.test.ts',
  'src/scripts/__tests__/recording.test.ts',
  'src/scripts/__tests__/scopedStyleReach.test.ts',
  'src/scripts/__tests__/teammateBuffControls.test.ts',
  'src/scripts/__tests__/uiCheck.test.ts',
  'src/scripts/__tests__/uiCheckStartup.test.ts',
  'src/scripts/__tests__/zc.test.ts',
  'src/scripts/__tests__/zcBrief.test.ts',
  'src/scripts/__tests__/zcDeadChannels.test.ts',
  'src/scripts/__tests__/zcWhere.test.ts',
  'src/scripts/__tests__/zcWorkspace.test.ts',
]

/** 源文件扩展名（闭包扫描面） */
const SRC_EXT = /\.(ts|mts|mjs|js|vue)$/
/** 测试文件判据 */
const TEST_EXT = '.test.ts'
/**
 * 「读 docs 信号」——保守（宁多勿漏）：
 * `docs/` 路径、`'docs'` 字面量、`README.md`、任何 `*.md` 文件名（含裸名，如 `ARCHITECTURE.md`）。
 */
const DOCS_SIGNAL = /docs\/|['"`]docs['"`]|README\.md|[\w-]+\.md['"`)]/i

/**
 * 「测试自身起子进程 / 写 scripts 路径字面量」信号（规则②）：
 * `execSync|execFileSync|spawnSync|execFile|spawn` 调用，或任何 `scripts/**.mjs` 路径字面量。
 * ⚠ 只认**测试文件自身**，不认 import 闭包——闭包口径会把「传递 import 了 scripts/lib 下纯数据模块」
 * 的测试全捞进来（T114 实测误收 `difficultyCurveWorker.test.ts`，根因 `presetCategories.mjs` 零 docs 引用）。
 */
const SUBPROCESS_SIGNAL = /\b(execSync|execFileSync|spawnSync|execFile|spawn)\s*\(|scripts\/[\w./-]+\.m?js/
/**
 * 「测试自身跑仓库级扫描」信号（规则③）：`git ls-files` / `git grep` / `grep -r`。
 * 同理只认测试自身：读的是仓库现状，import 图看不见。
 */
const REPO_SCAN_SIGNAL = /git\s+ls-files|git\s+grep|grep\s+-r/

/** 去掉块注释与行注释（避免把注释里提到的 `docs/` 当成真读者；宁多勿漏只针对**真引用**） */
export function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, '$1')
}

/** 递归列出根下源文件（跳过 DOCS_READING_SKIP_DIRS 与隐藏目录） */
export function listSourceFiles(root) {
  const out = []
  const walk = (d) => {
    for (const n of readdirSync(d, { withFileTypes: true })) {
      if (DOCS_READING_SKIP_DIRS.has(n.name) || n.name.startsWith('.')) continue
      const p = join(d, n.name)
      if (n.isDirectory()) walk(p)
      else if (SRC_EXT.test(n.name)) out.push(p.replace(/\\/g, '/'))
    }
  }
  for (const top of ['src', 'scripts']) {
    try { walk(join(root, top)) } catch { /* 目录缺失 ⇒ 该半区为空，由反空洞下限兜 */ }
  }
  return out
}

/** 该文件是否命中「读 docs 信号」（去注释后判） */
export function readsDocs(src) {
  return DOCS_SIGNAL.test(stripComments(src))
}

/** 从源码抽本地 import 说明符（相对路径 / `@/` 别名 / `scripts/` 前缀；不解析 node_modules） */
export function localImportSpecs(root, file, src) {
  const out = []
  const re = /(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g
  let m
  while ((m = re.exec(src))) {
    const spec = m[1]
    if (spec.startsWith('@/')) out.push(resolve(root, 'src', spec.slice(2)))
    else if (spec.startsWith('.')) out.push(resolve(dirname(file), spec))
    else if (spec.startsWith('scripts/')) out.push(resolve(root, spec))
  }
  return out
}

/** 探测一个无扩展名路径的真实落点（.ts/.mts/.mjs/.js/index.*） */
export function probeFile(base) {
  for (const c of [base, base + '.ts', base + '.mts', base + '.mjs', base + '.js', join(base, 'index.ts'), join(base, 'index.mjs')]) {
    try { if (statSync(c).isFile()) return c.replace(/\\/g, '/') } catch { /* 继续探测 */ }
  }
  return null
}

/**
 * 派生「读 docs 的测试」集合并与显式清单对账（棘轮的数据面）。
 * `listed` 缺省用 `DOCS_READING_TESTS`（注入是为了让单测能喂假清单做反证）。
 */
export function scanDocsReadingTests(root, listed = DOCS_READING_TESTS) {
  const files = listSourceFiles(root)
  const rel = (f) => f.startsWith(root.replace(/\\/g, '/')) ? f.slice(root.replace(/\\/g, '/').length + 1) : f
  const docsRef = new Set()
  const graph = new Map()
  for (const f of files) {
    let src = ''
    try { src = readFileSync(f, 'utf8') } catch { continue }
    if (readsDocs(src)) docsRef.add(f)
    graph.set(f, localImportSpecs(root, f, src).map(probeFile).filter(x => !!x))
  }
  const closure = (t) => {
    const seen = new Set([t])
    const stack = [t]
    while (stack.length) {
      const cur = stack.pop()
      for (const nx of graph.get(cur) ?? []) if (!seen.has(nx)) { seen.add(nx); stack.push(nx) }
    }
    return seen
  }
  const tests = files.filter(f => f.endsWith(TEST_EXT))
  const derived = []
  const testCovered = new Set()   // 被任意测试的 import 闭包覆盖到的源文件（棘轮③的口径面）
  for (const t of tests) {
    const cl = [...closure(t)]
    for (const f of cl) testCovered.add(f)
    const self = stripComments(readFileSync(t, 'utf8'))
    // ① 闭包命中 docs 信号；② 测试自身起子进程/scripts 字面量；③ 测试自身跑仓库级扫描
    if (cl.some(f => docsRef.has(f)) || SUBPROCESS_SIGNAL.test(self) || REPO_SCAN_SIGNAL.test(self)) {
      derived.push(rel(t))
    }
  }
  derived.sort()
  // 棘轮③：每个「读 docs 且被某个测试闭包覆盖」的源文件必须在**某条清单条目的闭包**里
  // ⚠ 口径限定在「被测试覆盖」：CLI 工具 / .vue 页面（resolve.mjs / validate-specs.mjs /
  //   generate-implementation-status.mjs / MultiplierCoeffPage.vue 等 11 个）本来就没有测试文件，
  //   要求它们进清单是错的判据（会把正确状态判红）。
  const listedCovered = new Set()
  for (const l of listed) for (const f of closure(resolve(root, l))) listedCovered.add(f)
  const readerSources = [...docsRef].filter(f => !f.endsWith(TEST_EXT)).sort()
  const uncoveredReaders = readerSources.filter(f => testCovered.has(f) && !listedCovered.has(f)).map(rel)
  const missing = listed.filter(l => !existsSync(resolve(root, l)))
  return {
    scanned: files.length,
    derived,
    docsReaders: readerSources.map(rel),
    uncoveredReaders,
    missing,
    belowFloor: files.length < DOCS_READING_MIN_SCANNED || listed.length < DOCS_READING_MIN_TESTS,
    ok: uncoveredReaders.length === 0 && missing.length === 0
      && files.length >= DOCS_READING_MIN_SCANNED && listed.length >= DOCS_READING_MIN_TESTS,
  }
}

/**
 * docs-only 判定器：给定 `git diff --name-only` 的输出，判是否**全部**落在 `docs/` 前缀内。
 * 空输入（无改动）判 **false**（没有改动就没有提速可言，别把它当绿灯）。
 */
export function isDocsOnlyChange(nameOnlyOutput) {
  const files = nameOnlyOutput.split('\n').map(s => s.trim()).filter(Boolean)
  if (files.length === 0) return false
  return files.every(f => f.startsWith('docs/'))
}

/** 把报告渲染成 check-guards 风格的 detail 行 */
export function formatDocsReadingReport(r) {
  const out = [
    `  扫描 ${r.scanned} 源文件 · 派生 ${r.derived.length} 测试 · 读 docs 源文件 ${r.docsReaders.length}`,
  ]
  for (const m of r.missing) out.push(`  ✗ 清单条目不存在：${m}（改名后清单会静默退化成空集）`)
  for (const u of r.uncoveredReaders) out.push(`  ✗ 读 docs 的源文件未被清单覆盖：${u}（新写扫描器要挂进 DOCS_READING_TESTS）`)
  if (r.belowFloor) out.push('  ✗ 扫描面/清单低于反空洞下限：零命中不可采信')
  return out
}
