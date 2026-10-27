#!/usr/bin/env node
/**
 * 首屏体积审计 —— 「打开网站加载太多」专项的重入工具（2026-10-27 首建）。
 *
 * ## 为什么要这个工具
 *
 * 这个问题的直觉答案（砍数据 / 砍功能）几乎总是错的：入口 chunk 里约 90% 是**计算必需**的
 * 角色模块与 spec 数据，砍了就少功能。真正能砍的只有三类，且每次重构后会重新长回来：
 *
 *   ① 只作文档、运行时零消费者的字段（例：spec 的 notes，2026-10-27 实测 110 KB gz = 入口 21%）
 *   ② 被塞进启动关键路径、但只有某个按钮要用的数据（例：build-recommendations.json 25 KB gz）
 *   ③ 被 manualChunks 强制提前加载、本该随懒加载页面延后的依赖（例：naive-ui 175 KB gz）
 *
 * 本脚本只回答「现在各是多少」，不做判断——判断口径写在 docs/ARCHITECTURE.md §3「首屏体积」行。
 *
 * ## 用法
 *
 *   node scripts/bundle-audit.mjs                      # 出报告
 *   node scripts/bundle-audit.mjs --expect-gz 420000   # 超过阈值 exit 1（回归哨兵）
 *   node scripts/bundle-audit.mjs --json               # 机器可读
 *
 * ## 口径（改之前先读）
 *
 * - 「入口 chunk」= rollup isEntry 的 chunk，即首屏必下载的 JS；不含 CSS 与静态 JSON。
 * - gz 用 zlib level 9 现场压：生产 CDN 实际用 br 会更小，但同一把尺子下比较是准的。
 * - 逐模块 gz 是「各自单独压完相加」，会系统性高估（丢掉跨模块重复串）⇒ 只看占比与排序，
 *   结论数字认「入口 gz」那一行。
 * - 构建走 write:false（不落盘、不碰 dist），跑完 git status 仍干净。
 */
import { build } from 'vite'
import { gzipSync } from 'node:zlib'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, relative } from 'node:path'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
/** 反引号（markdown 行内代码），避免本文件源码里出现裸反引号 */
const BT = String.fromCharCode(96)
const gz = buf => gzipSync(Buffer.isBuffer(buf) ? buf : Buffer.from(buf), { level: 9 }).length
const kb = n => (n / 1024).toFixed(1)
const code = s => BT + s + BT

const argv = process.argv.slice(2)
const expectIdx = argv.indexOf('--expect-gz')
const EXPECT_GZ = expectIdx >= 0 ? Number(argv[expectIdx + 1]) : null
const JSON_OUT = argv.includes('--json')

// ─────────────────────────── 1. 构建并按模块归因 ───────────────────────────
const result = await build({
  root: ROOT,
  configFile: resolve(ROOT, 'vite.config.ts'),
  logLevel: 'error',
  build: { write: false },
})
const chunks = (Array.isArray(result) ? result : [result.output])
  .flatMap(r => (Array.isArray(r) ? r : r.output))
  .filter(x => x.type === 'chunk')
const entry = chunks.find(c => c.isEntry)
if (!entry) {
  console.error('✗ 没找到入口 chunk（isEntry）——构建产物结构变了？')
  process.exit(1)
}

/**
 * 首屏口径 = 从 entry 出发沿**静态 import 图**走到的全部 chunk + 它们的 CSS。
 * 动态 import（懒加载页面）不算——那正是「砍首屏」时要让它们待着的地方。
 * 只看 entry 自己会**低估**（vendor 分块不在 entry.modules 里）。
 */
const chunkByName = new Map(chunks.map(c => [c.fileName, c]))
const assetsByFile = new Map((Array.isArray(result) ? result : [result.output])
  .flatMap(r => (Array.isArray(r) ? r : r.output))
  .filter(x => x.type === 'asset')
  .map(a => [a.fileName, a]))
const firstLoad = new Set()
const queue = [entry.fileName]
while (queue.length) {
  const name = queue.shift()
  if (firstLoad.has(name)) continue
  firstLoad.add(name)
  const c = chunkByName.get(name)
  if (c) for (const imp of c.imports) queue.push(imp)
}
let firstLoadJsGz = 0
let firstLoadCssGz = 0
const firstLoadRows = []
const seenCss = new Set()
for (const name of firstLoad) {
  const c = chunkByName.get(name)
  if (c) {
    const g = gz(c.code)
    firstLoadJsGz += g
    firstLoadRows.push({ name, gz: g })
    for (const css of (c.viteMetadata?.importedCss ?? [])) seenCss.add(css)
  }
}
for (const css of seenCss) {
  const a = assetsByFile.get(css)
  if (!a) continue
  firstLoadCssGz += gz(typeof a.source === 'string' ? a.source : Buffer.from(a.source))
}
const firstLoadTotalGz = firstLoadJsGz + firstLoadCssGz
firstLoadRows.sort((a, b) => b.gz - a.gz)

const entryGz = gz(entry.code)
const modules = Object.entries(entry.modules ?? {}).map(([id, m]) => ({
  id: relative(ROOT, id.split('?')[0]),
  raw: m.renderedLength ?? 0,
  gz: m.code ? gz(m.code) : 0,
}))

/** 按目录聚合到两层，避免一屏花名册 */
const bucketOf = rel => {
  const parts = rel.split('/')
  if (parts[0] !== 'src') return parts.slice(0, 2).join('/') || rel
  const dirs = parts.slice(0, -1)
  return dirs.length <= 1 ? 'src（根）' : dirs.slice(0, 2).join('/')
}
const byDir = new Map()
for (const m of modules) {
  const k = bucketOf(m.id)
  const cur = byDir.get(k) ?? { raw: 0, gz: 0, files: 0 }
  cur.raw += m.raw
  cur.gz += m.gz
  cur.files += 1
  byDir.set(k, cur)
}
const totalRaw = modules.reduce((s, m) => s + m.raw, 0)

// ─────────────────────── 2. 静态 JSON：首屏阻塞 vs 懒加载 ───────────────────────
/** 首屏阻塞清单 = src/composables/calculatorStartup.ts 的 Promise.all 三件套；改那里要同步改这里 */
const STARTUP_JSON = [
  ['catalog.json', '目录（角色/音擎/技能表）'],
  ['teammate-buffs.json', '队友 Buff'],
  ['build-recommendations.json', '配装推荐（只有「应用预设」按钮要它）'],
]
const LAZY_JSON = [
  ['boss-presets.json', 'Boss 预设（进页面才拉）'],
  ['run-archive.json', '实战归档（进页面才拉）'],
  ['changelog.json', '更新日志（开弹层才拉）'],
  ['beta-agents.json', 'beta 快照（开关打开才拉）'],
  ['character-mechanics.json', '机制台账（归档页才拉）'],
  ['character-constellations.json', '影画台账（归档页才拉）'],
]
const jsonSize = name => {
  try {
    const p = resolve(ROOT, 'public/static', name)
    return { raw: statSync(p).size, gz: gz(readFileSync(p)) }
  } catch { return null }
}

// ─────────────────── 3. spec JSON 字段占比（找「零消费者」） ───────────────────
const SPEC_DIR = resolve(ROOT, 'src/specs/agents')
const fieldBytes = new Map()
let specTotal = 0
for (const f of readdirSync(SPEC_DIR).filter(f => f.endsWith('.json'))) {
  const text = readFileSync(resolve(SPEC_DIR, f), 'utf8')
  specTotal += text.length
  let obj
  try { obj = JSON.parse(text) } catch { continue }
  for (const [k, v] of Object.entries(obj)) {
    fieldBytes.set(k, (fieldBytes.get(k) ?? 0) + JSON.stringify(v).length)
  }
}
/** 已知「构建期剥离」的字段（口径单源 = scripts/lib/spec-doc-fields.mjs） */
const stripped = new Set(['notes'])
/**
 * 生产运行时零消费者、但**尚未剥离**的字段：只有测试（读盘）与 scripts/ 工具在读。
 * 留着是因为各自收益太小（合计 < 4 KB），剥它们要多放宽 3 个必填类型字段 —— 不值。
 * ⚠ 判据：出现「运行时读取了却说它只给测试用」即本条说谎，见 specDocFields.test.ts。
 */
const testOnly = new Set(['verifications', 'status', 'schemaVersion'])

const staticRows = [
  ...STARTUP_JSON.map(([name, use]) => ({ name, use, blocking: true, ...(jsonSize(name) ?? {}) })),
  ...LAZY_JSON.map(([name, use]) => ({ name, use, blocking: false, ...(jsonSize(name) ?? {}) })).filter(r => r.raw !== undefined),
]
const specFields = [...fieldBytes]
  .sort((a, b) => b[1] - a[1])
  .slice(0, 12)
  .map(([field, bytes]) => ({
    field,
    bytes,
    consumer: stripped.has(field) ? 'stripped' : testOnly.has(field) ? 'testOnly' : 'runtime',
  }))

if (JSON_OUT) {
  console.log(JSON.stringify({
    firstLoad: { jsGz: firstLoadJsGz, cssGz: firstLoadCssGz, totalGz: firstLoadTotalGz, chunks: firstLoadRows },
    entry: { raw: totalRaw, gz: entryGz },
    byDir: [...byDir].map(([dir, v]) => ({ dir, ...v })).sort((a, b) => b.raw - a.raw),
    staticJson: staticRows,
    specFields,
    specTotal,
  }, null, 2))
} else {
  console.log('# 首屏体积审计\n')
  console.log('首屏总量（entry 静态 import 图 + CSS）：**gzip ' + kb(firstLoadTotalGz) + ' KB** = JS ' + kb(firstLoadJsGz) + ' + CSS ' + kb(firstLoadCssGz) + '\n')
  console.log('| 首屏 chunk | gzip KB |')
  console.log('| --- | ---: |')
  for (const r of firstLoadRows) console.log('| ' + code(r.name) + ' | ' + kb(r.gz) + ' |')
  console.log('')
  console.log('入口 chunk 本体：raw ' + kb(totalRaw) + ' KB · gzip ' + kb(entryGz) + ' KB（下面按目录看它装了谁）\n')
  console.log('## 入口 chunk 按目录\n')
  console.log('| 目录 | raw KB | 占比 | 模块数 |')
  console.log('| --- | ---: | ---: | ---: |')
  for (const [k, v] of [...byDir].sort((a, b) => b[1].raw - a[1].raw).slice(0, 12)) {
    console.log('| ' + code(k) + ' | ' + kb(v.raw) + ' | ' + (v.raw / totalRaw * 100).toFixed(1) + '% | ' + v.files + ' |')
  }

  console.log('\n## 静态 JSON（public/static/）\n')
  console.log('| 文件 | 用途 | raw KB | gz KB | 首屏阻塞 |')
  console.log('| --- | --- | ---: | ---: | :---: |')
  for (const r of staticRows) {
    console.log('| ' + code(r.name) + ' | ' + r.use + ' | ' + (r.raw ? kb(r.raw) : '—') + ' | ' + (r.gz ? kb(r.gz) : '—') + ' | ' + (r.blocking ? '**是**' : '否') + ' |')
  }

  console.log('\n## spec 源文件字段占比（src/specs/agents/*.json）\n')
  console.log('| 字段 | raw KB | 占 spec 总量 | 运行时消费者 |')
  console.log('| --- | ---: | ---: | --- |')
  for (const f of specFields) {
    const consumer = f.consumer === 'stripped'
      ? '**无（构建期已剥离）**'
      : f.consumer === 'testOnly' ? '无（仅测试/脚本读盘）' : '有'
    console.log('| ' + code(f.field) + ' | ' + kb(f.bytes) + ' | ' + (f.bytes / specTotal * 100).toFixed(1) + '% | ' + consumer + ' |')
  }
  console.log('\n合计 ' + kb(specTotal) + ' KB —— 这部分已含在上面 src/specs/agents 行里，此处只看字段构成。')
}

if (EXPECT_GZ != null && Number.isFinite(EXPECT_GZ) && firstLoadTotalGz > EXPECT_GZ) {
  console.error('\n✗ 首屏 gzip ' + firstLoadTotalGz + ' B 超过阈值 ' + EXPECT_GZ + ' B —— 新增了什么进首屏？')
  process.exit(1)
}
if (EXPECT_GZ != null && Number.isFinite(EXPECT_GZ)) console.log('\n✓ 首屏 gzip ' + firstLoadTotalGz + ' B ≤ 阈值 ' + EXPECT_GZ + ' B')
