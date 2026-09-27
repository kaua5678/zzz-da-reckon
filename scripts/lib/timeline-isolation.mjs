/**
 * 判据 26：事件时间轴影子内核隔离（R4-A1，2026-09-27 第 119 轮；设计稿 docs/mcp-timeline-shadow-kernel.md D6）。
 *
 * ## 为什么要这条
 * R4 硬约束 1：影子阶段**零差**——不得改变任何现有输出、不得接 UI。影子内核能保证零差的唯一结构性理由
 * 是「没有人 import 它」。这条判据把这个理由从口头约定变成可红的护栏：
 * - **入边**：非测试 src（`src/core/timeline/**` 自身除外）对 `core/timeline` 的任何 import 都不允许
 *   （值、类型、动态、`export … from` 一律计——零入边比「只禁值导入」更容易验证，影子阶段也没有正当的类型需求）；
 * - **出边**：`src/core/timeline/**` 的非测试文件只能依赖 `@/core/*`、`@/types/*`、`@/utils/*` 与自身，
 *   不得 import composables / stores / mechanics / specs / views / components / data，也不得 import `vue` / `pinia`。
 *
 * ## 反空洞
 * `src/core/timeline/` 下非测试 `.ts` 少于 `TIMELINE_MIN_FILES` ⇒ 判红（目录改名 / 走错根目录时，
 * 「零入边」读数不可采信）。
 *
 * ## 何时改这条
 * 用影子内核替换现引擎的任何输出属于 R4 的**不可逆点，必须用户裁决**。裁决通过后，由那一刀删掉入边禁令
 * （出边禁令保留：core 不依赖编排层是既有分层）。**不要为了接线而放宽本判据。**
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, posix, relative, sep } from 'node:path'
import { stripComments } from './dead-channel-scan.mjs'

export const TIMELINE_DIR = 'src/core/timeline'
/** 反空洞下限：types.ts + stunTrack.ts + decibelTrack.ts */
export const TIMELINE_MIN_FILES = 3
/** 出边禁止的别名前缀与裸包名 */
export const TIMELINE_FORBIDDEN_OUT = ['@/composables', '@/stores', '@/mechanics', '@/specs', '@/views', '@/components', '@/data', 'vue', 'pinia']
const FORBIDDEN_OUT_DIRS = ['src/composables', 'src/stores', 'src/mechanics', 'src/specs', 'src/views', 'src/components', 'src/data']

const SPEC_RES = [
  /\b(?:import|export)\b[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]/g, // import … from / export … from（含多行）
  /\bimport\s*['"]([^'"]+)['"]/g, // 副作用 import
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g, // 动态 import
]

/** 源码里的全部模块说明符（先去注释） */
export function extractSpecifiers(content) {
  const text = stripComments(content)
  const out = []
  for (const re of SPEC_RES) for (const m of text.matchAll(re)) out.push(m[1])
  return out
}

/** 把说明符解析成仓库相对路径（别名 `@/` → `src/`；相对路径按文件所在目录解析；裸包名原样返回） */
export function resolveSpecifier(fromFile, spec) {
  if (spec.startsWith('@/')) return `src/${spec.slice(2)}`
  if (spec.startsWith('.')) return posix.normalize(posix.join(posix.dirname(fromFile), spec))
  return spec
}

const inDir = (p, dir) => p === dir || p.startsWith(`${dir}/`)

function listTs(root, dir) {
  const files = []
  const rec = (d) => {
    if (!existsSync(d)) return
    for (const n of readdirSync(d).sort()) {
      const p = join(d, n)
      if (statSync(p).isDirectory()) { if (n !== 'node_modules') rec(p); continue }
      if (!/\.(ts|vue|mts)$/.test(n) || n.endsWith('.d.ts')) continue
      const rel = relative(root, p).split(sep).join('/')
      if (rel.includes('/__tests__/') || /\.test\.ts$/.test(rel)) continue
      files.push(rel)
    }
  }
  rec(join(root, dir))
  return files
}

/** 纯函数判定（自证与单测共用）：给定 { file: content } 映射 ⇒ { inbound, outbound } */
export function classifyTimelineEdges(sources) {
  const inbound = []
  const outbound = []
  for (const [file, content] of Object.entries(sources)) {
    const self = inDir(file, TIMELINE_DIR)
    for (const spec of extractSpecifiers(content)) {
      const target = resolveSpecifier(file, spec)
      if (!self && inDir(target, TIMELINE_DIR)) inbound.push({ file, spec })
      if (self) {
        const bad = TIMELINE_FORBIDDEN_OUT.some(p => spec === p || spec.startsWith(`${p}/`))
          || FORBIDDEN_OUT_DIRS.some(d => inDir(target, d))
        if (bad) outbound.push({ file, spec })
      }
    }
  }
  return { inbound, outbound }
}

/** 检测器自证：一条入边、一条出边、一条合法边、一条注释里的假边 */
export function timelineIsolationSelfTest() {
  const r = classifyTimelineEdges({
    'src/composables/x.ts': "import { simulate } from '@/core/timeline/stunTrack'\n// import y from '@/core/timeline/types'",
    'src/core/timeline/a.ts': "import type { X } from '@/composables/resourceCalc/roundResult'\nimport { f } from '../resource/helpers'",
    'src/core/other.ts': "export { g } from './timeline/decibelTrack'",
  })
  const ok = r.inbound.length === 2 && r.outbound.length === 1
    && r.inbound.some(e => e.file === 'src/core/other.ts')
  return { ok, detail: r }
}

export function scanTimelineIsolation(root) {
  const selfTest = timelineIsolationSelfTest()
  const timelineFiles = listTs(root, TIMELINE_DIR)
  const sources = {}
  for (const f of listTs(root, 'src')) sources[f] = readFileSync(join(root, f), 'utf8')
  const { inbound, outbound } = classifyTimelineEdges(sources)
  const hollow = timelineFiles.length < TIMELINE_MIN_FILES
  return {
    ok: selfTest.ok && !hollow && inbound.length === 0 && outbound.length === 0,
    timelineFiles: timelineFiles.length,
    scanned: Object.keys(sources).length,
    inbound,
    outbound,
    hollow,
    selfTest,
  }
}

export function formatTimelineIsolation(report) {
  const lines = []
  if (!report.selfTest.ok) lines.push('  ✗ 检测器自证失败（正则被改坏？）')
  if (report.hollow) lines.push(`  ✗ ${TIMELINE_DIR} 下非测试文件 ${report.timelineFiles} < ${TIMELINE_MIN_FILES}：目录改名或扫错根目录，零入边读数不可采信`)
  for (const e of report.inbound) lines.push(`  ✗ 入边 ${e.file} → ${e.spec}：影子阶段零入边（R4 硬约束 1）；接线属于不可逆点，须用户裁决`)
  for (const e of report.outbound) lines.push(`  ✗ 出边 ${e.file} → ${e.spec}：影子内核只能依赖 @/core、@/types、@/utils；需要引擎数据就在 types.ts 声明结构子集，由测试侧传入`)
  return lines
}

// 供调试：node scripts/lib/timeline-isolation.mjs
if (process.argv[1] && process.argv[1].endsWith('timeline-isolation.mjs')) {
  const root = dirname(dirname(dirname(new URL(import.meta.url).pathname)))
  console.log(JSON.stringify(scanTimelineIsolation(root), null, 2))
}
