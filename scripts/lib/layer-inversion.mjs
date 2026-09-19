/**
 * 「录入层 → 编排层」值倒置扫描器（判据 19 `layer-inversion` 的实现面）。
 *
 * ## 要拦的形态
 * `src/mechanics/**` / `src/specs/**`（录入层）对 `@/composables/*`（编排层）的**值导入**。
 * ARCHITECTURE §0：录入层被编排/引擎经 registry 消费 ⇒ 依赖只能是「编排 → 录入」；反向值边必成环。
 * 实测病灶（2026-09-19，R35 取证 / round 37 落地）：`src/mechanics/agents/claret.ts:15`
 *   `import { pickThirdNamedBasicSegment, fusedRowValue } from '@/composables/resourceCalc/helpers'`
 * —— 穷尽扫描录入层 **9 站点 = 8 `import type` + 1 值**，这条唯一值边经 Tarjan SCC 实测造成
 * **8 模块强连通分量**（claret → resourceCalc/helpers → panelPhases → mechanics/index → claret，
 * 另含 anomalyPanels / core/resource / core/resource/helpers / core/resource/crossAgentSupply）。
 *
 * ## 为什么两侧既有判据都看不见（结构盲区，不是疏漏）
 * - 判据 7 `exhibition-layer` 只扫 `src/views` + `src/components` 的 .vue，且禁令正则里没有 `composables`；
 * - 判据 12 `core role-import` 只扫 `src/core/** → @/mechanics/agents/*`。
 * ⇒ 「录入层 → 编排层」这条边此前**结构性地无人监管**。
 *
 * ## 判据定义（成对：行为面 + 形状面，缺一不可）
 * - **行为面**：值导入站点 == 0，**且**总站点（含 `import type`）≥ `LAYER_INVERSION_MIN_TOTAL_SITES`
 *   （反空洞下限：目录改名 / 正则写坏 / 走错根目录时「扫不到」与「真清零」读数不可区分——
 *   与 dead-channel-ls 空基线配反空洞下限是同一条纪律）；
 * - **形状面**：`LAYER_INVERSION_SHAPE_LOCKS` 点名的历史病灶文件源码**任何位置**不得再出现
 *   `@/composables` 字面量（连注释也不许：它是给 `grep` 用的回归锁，任何形态回流都该在 diff 里被看见；
 *   只有行为面 ⇒ 「改成 `import type` 再在运行时 `import()`」这类绕行看不出来，故成对）。
 *
 * ## 分类口径（单一入口 `classifyImportSpecifierSites`）
 * - 只有**语句级** `import type … from` / `export type … from` 豁免（纯类型面不产生运行时边，与判据 7/12 同款）；
 * - 内联 `import { type X } from` 按**值**计（isolatedModules 下该语句仍保留为运行时 import）；
 * - `export … from` / 副作用 `import '…'` / 动态 `import('…')` 按值计；
 * - 类型位的 `import('…').Name`（velina/alice 对 `@/types` 的既有写法）按 **type** 计——判定 = 紧跟
 *   `.标识符` 且不是 `.then/.catch/.finally`；
 * - 注释行豁免（与判据 7 同一套：语句起始行以 `//` / `*` / `/*` 开头）；
 * - 多行 `import type {\n … \n} from '@/composables/x'` 按整条语句分类（逐行扫会把收尾行误判成值导入，
 *   这正是本扫描器不复用判据 7 逐行 detector 的原因）。
 *
 * ## 修法（已验先例 = 判据 7 的 `sharpCritMultiplier` 下沉）
 * 纯函数下沉 `src/data/`，原位置改 import + export 两行壳（round 37：`data/moveTableQueries.ts` ←
 * `resourceCalc/skillRows.ts` 的 4 个纯查询）；**不是**在录入层重建同形函数（分裂单一事实源，规则 11）。
 * 只有类型需求 ⇒ 写 `import type`。
 *
 * @fact engine:guards/层倒置 口径: 录入层（src/mechanics/** + src/specs/** 的非测试 .ts）对 @/composables/* 的值导入必须为 0（语句级 import type 豁免；export…from / 副作用 import / 动态 import / 内联 type 按值计，类型位 import('…').Name 按 type 计），且总站点 ≥ 8 作反空洞下限；形状锁 claret.ts 源码不得含 @/composables 字面量；录入层要用编排层纯函数一律下沉 src/data/（先例 sharpCritMultiplier / moveTableQueries） | 据 实测@2026-09-19（R35 穷尽扫描 9 站点 = 8 type + 1 值 + Tarjan 8 模块 SCC；round 37 下沉 4 符号后值导入 0，timeGolden/allAgentsSweep 零 delta） | 验 src/scripts/__tests__/layerInversion.test.ts | 锚 scripts/lib/layer-inversion.mjs#scanLayerInversion | 信 高
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

/** 录入层目录（ARCHITECTURE §0：声明式 spec + TS 机制模块） */
export const ENTRY_LAYER_DIRS = ['src/mechanics', 'src/specs']

/** 编排层别名前缀（`@/composables` 本身或其任意子路径） */
export const ORCHESTRATION_ALIAS = '@/composables'

/**
 * 反空洞下限：总站点（type + value）低于此值判扫描器失效。
 * 2026-09-19 实测录入层 9 站点（8 `import type { CalcRoundThreads }` + claret 1 值）；下沉后 8。
 * ⚠ 若将来把 `CalcRoundThreads` 迁去 `@/types` 使 type 站点自然减少，这里会红——那是提醒
 * 「反空洞下限要重新标定」，按实测值下调并写进提交说明，不要顺手删判据。
 */
export const LAYER_INVERSION_MIN_TOTAL_SITES = 8

/** 形状面回归锁：历史病灶文件，源码任何位置（含注释）不得再出现 `@/composables` 字面量 */
export const LAYER_INVERSION_SHAPE_LOCKS = ['src/mechanics/agents/claret.ts']

/** 语句级静态 import / export-from（含多行花括号）；分组：1 行首 2 缩进 3 关键字 4 type 5 引号 6 说明符 */
const STATIC_IMPORT_RE = /(^|\n)([ \t]*)(import|export)\s+(type\s+)?(?:\{[^}]*\}|\*(?:\s+as\s+\w+)?|\w+(?:\s*,\s*(?:\{[^}]*\}|\*\s+as\s+\w+))?)\s*from\s*(['"])([^'"\n]+)\5/g
/** 副作用导入 `import '…'` */
const SIDE_EFFECT_IMPORT_RE = /(^|\n)([ \t]*)import\s*(['"])([^'"\n]+)\3/g
/** 动态导入 / 类型位 import()；分组：1 引号 2 说明符 3 紧跟的 `.标识符`（可选） */
const DYNAMIC_IMPORT_RE = /\bimport\s*\(\s*(['"])([^'"\n]+)\1\s*\)(?:\s*\.\s*([A-Za-z_$][\w$]*))?/g

function isOrchestrationSpecifier(spec) {
  return spec === ORCHESTRATION_ALIAS || spec.startsWith(ORCHESTRATION_ALIAS + '/')
}

function lineNumberAt(content, index) {
  let n = 1
  for (let i = 0; i < index; i++) if (content.charCodeAt(i) === 10) n++
  return n
}

function lineTextAt(content, index) {
  const start = content.lastIndexOf('\n', index - 1) + 1
  let end = content.indexOf('\n', index)
  if (end === -1) end = content.length
  return content.slice(start, end)
}

function isCommentLine(text) {
  const t = text.trim()
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')
}

/**
 * 单文件源码 → 对编排层的 import 站点 [{ line, text, kind: 'type' | 'value', specifier }]。
 * 纯函数（不读磁盘），供 detector 单测构造 fixture 自证可红性。
 */
export function classifyImportSpecifierSites(content) {
  const sites = []
  const push = (index, kind, specifier) => {
    const text = lineTextAt(content, index)
    if (isCommentLine(text)) return
    sites.push({ line: lineNumberAt(content, index), text: text.trim().slice(0, 110), kind, specifier })
  }
  for (const m of content.matchAll(STATIC_IMPORT_RE)) {
    if (!isOrchestrationSpecifier(m[6])) continue
    const stmtIndex = m.index + m[1].length
    push(stmtIndex, m[4] ? 'type' : 'value', m[6])
  }
  for (const m of content.matchAll(SIDE_EFFECT_IMPORT_RE)) {
    if (!isOrchestrationSpecifier(m[4])) continue
    push(m.index + m[1].length, 'value', m[4])
  }
  for (const m of content.matchAll(DYNAMIC_IMPORT_RE)) {
    if (!isOrchestrationSpecifier(m[2])) continue
    const member = m[3]
    const typePosition = member !== undefined && !['then', 'catch', 'finally'].includes(member)
    push(m.index, typePosition ? 'type' : 'value', m[2])
  }
  return sites.sort((a, b) => a.line - b.line)
}

/** 录入层被扫文件：`.ts`，不含 `.d.ts` / 测试（测试自由引用编排层） */
export function listEntryLayerFiles(root) {
  const files = []
  const rec = (dir) => {
    if (!existsSync(dir)) return
    for (const n of readdirSync(dir).sort()) {
      const p = join(dir, n)
      if (statSync(p).isDirectory()) { rec(p); continue }
      if (!n.endsWith('.ts') || n.endsWith('.d.ts')) continue
      const rel = relative(root, p).split(sep).join('/')
      if (rel.includes('__tests__') || rel.endsWith('.test.ts')) continue
      files.push(rel)
    }
  }
  for (const d of ENTRY_LAYER_DIRS) rec(join(root, d))
  return files
}

/** 形状锁：点名文件里所有含 `@/composables` 字面量的行（含注释，刻意） */
export function scanShapeLocks(root, locks = LAYER_INVERSION_SHAPE_LOCKS) {
  const violations = []
  for (const file of locks) {
    const full = join(root, file)
    if (!existsSync(full)) { violations.push({ file, line: 0, text: '（形状锁文件不存在——清单腐烂，删掉该条或改指新路径）' }); continue }
    readFileSync(full, 'utf8').split('\n').forEach((l, i) => {
      if (l.includes(ORCHESTRATION_ALIAS)) violations.push({ file, line: i + 1, text: l.trim().slice(0, 110) })
    })
  }
  return violations
}

/**
 * 仓库级扫描 → 报告：
 * { scannedFiles, sites: [{ file, line, text, kind, specifier }], typeCount, valueCount, total, shapeViolations }
 */
export function scanLayerInversion(root) {
  const files = listEntryLayerFiles(root)
  const sites = []
  for (const file of files) {
    for (const s of classifyImportSpecifierSites(readFileSync(join(root, file), 'utf8'))) sites.push({ file, ...s })
  }
  const valueCount = sites.filter(s => s.kind === 'value').length
  const typeCount = sites.length - valueCount
  return {
    scannedFiles: files.length,
    sites,
    typeCount,
    valueCount,
    total: sites.length,
    shapeViolations: scanShapeLocks(root),
  }
}

/** 成对判据的合取：行为面（值导入 0 + 反空洞下限）∧ 形状面（锁文件零字面量） */
export function layerInversionOk(report, minTotal = LAYER_INVERSION_MIN_TOTAL_SITES) {
  return report.valueCount === 0 && report.total >= minTotal && report.shapeViolations.length === 0
}

/** 归因输出（只在红时打印） */
export function formatLayerInversion(report, minTotal = LAYER_INVERSION_MIN_TOTAL_SITES) {
  const out = []
  const values = report.sites.filter(s => s.kind === 'value')
  if (values.length > 0) {
    out.push(`  ✗ 录入层值导入编排层 ${values.length} 处（ARCHITECTURE §0：录入层被编排层消费，反向值边成环）`)
    for (const s of values.slice(0, 12)) out.push(`      ${s.file}:${s.line}  ${s.text}`)
    out.push('    → 纯函数/常量下沉 src/data/（先例 sharpCritMultiplier / moveTableQueries），原位置留 import + export 两行壳；')
    out.push('      只要类型就写 `import type`；不要在录入层重建同形函数（分裂单一事实源，规则 11）')
  }
  if (report.total < minTotal) {
    out.push(`  ✗ 反空洞下限：总站点 ${report.total} < ${minTotal}（扫 ${report.scannedFiles} 文件）——扫描器疑似失效`)
    out.push('    → 先核 ENTRY_LAYER_DIRS 是否仍是录入层真实目录、正则是否还认得 import 语法；确系 type 站点自然减少再按实测下调 LAYER_INVERSION_MIN_TOTAL_SITES')
  }
  if (report.shapeViolations.length > 0) {
    out.push(`  ✗ 形状锁：历史病灶文件重新出现 \`${ORCHESTRATION_ALIAS}\` 字面量 ${report.shapeViolations.length} 处`)
    for (const v of report.shapeViolations.slice(0, 12)) out.push(`      ${v.file}:${v.line}  ${v.text}`)
    out.push('    → 该文件对编排层的依赖已下沉 @/data/moveTableQueries；注释里也别写这个别名（锁是给 grep 用的）')
  }
  return out
}
