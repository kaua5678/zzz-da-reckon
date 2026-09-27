/**
 * 「无类型记录字符串键死读」扫描器（判据 25 的实现面；CC-91，2026-09-27）。
 *
 * ## 要拦的形态
 * 角色模块常把 cfg 断言成无类型记录再按键读：
 *   const record = cfg as unknown as Record<string, unknown>
 *   danceHitCount: Number(record.vivianDanceHit ?? 0)
 * 若全仓**没有任何地方写入或声明** `vivianDanceHit`，这个读取恒得缺省值（死通道），
 * 而 tsc / vitest / 判据 14 与 `zc dead-channels`（二者只扫**类型里声明过的字段**）全部看不见。
 *
 * ## 实测事故（非假想）
 * CC-90 核实命座 1331 影画6 时发现：vivian.ts 的 `record.vivianDanceHit` 与 `record.vivianAssistCount`
 * 全仓零写入 ⇒ 飞羽「舞步命中」「支援突击 +2」两源恒 0，支援突击后的悬落也少算。CC-91 修复。
 *
 * ## 判据定义（宁漏不误伤）
 * 1. 在 src 非测试 .ts/.vue 中找「记录变量」：`const|let X = … as [unknown as] Record<string, unknown|any>`；
 * 2. 在**遮罩掉注释与字符串**后的正文里收集 `X.key` 读取（排除 `=`/`+=`/`??=` 等写入与方法调用）；
 * 3. 某 key 在全部 src 非测试文件（只遮罩注释、**保留字符串**）里作为独立标识符的出现次数
 *    ≤ 它被当作记录读取的次数 ⇒ 除了这些读取别处从未出现（无写入、无类型声明、无对象字面量、
 *    无简写、无字符串键）⇒ 报。
 * 口径很保守：任何别处出现（哪怕是简写属性或 setting id 字符串）都算「有人用」，不报。
 *
 * ## 反空洞
 * `detectorSelfTest()` 用判别性 fixture 自证：死读必报 / 别处有写入必不报 / 字符串里的「x.key」不算读取；
 * 另设读取总数下限 RECORD_KEY_MIN_READS，扫描面缩水时判红而不是报零问题。
 */
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** 反空洞下限：记录读取总数低于此值 ⇒ 扫描面缺失，「零命中」不可采信（2026-09-27 实测约 400） */
export const RECORD_KEY_MIN_READS = 150

const DECL = /(?:const|let)\s+([A-Za-z_$][\w$]*)\s*(?::\s*Record<string,\s*(?:unknown|any)>\s*)?=\s*[^;\n]*?\bas\s+(?:unknown\s+as\s+)?Record<string,\s*(?:unknown|any)>/g

const blank = s => s.replace(/[^\n]/g, ' ')

/** 保长度遮罩：注释（与可选的字符串字面量）替换为等长空白，换行保留 ⇒ 行号不偏 */
export function maskSource(text, { strings }) {
  let out = ''
  let i = 0
  const n = text.length
  while (i < n) {
    const c = text[i]
    const d = text[i + 1]
    if (c === '/' && d === '*') {
      const j = text.indexOf('*/', i + 2)
      const end = j < 0 ? n : j + 2
      out += blank(text.slice(i, end)); i = end; continue
    }
    if (c === '/' && d === '/' && text[i - 1] !== ':') {
      let j = text.indexOf('\n', i)
      if (j < 0) j = n
      out += blank(text.slice(i, j)); i = j; continue
    }
    if (c === '\'' || c === '"' || c === '`') {
      let j = i + 1
      while (j < n && text[j] !== c) { if (text[j] === '\\') j++; if (c !== '`' && text[j] === '\n') break; j++ }
      const end = Math.min(n, j + 1)
      out += strings ? c + blank(text.slice(i + 1, end - 1)) + (end - 1 > i ? text[end - 1] : '') : text.slice(i, end)
      i = end; continue
    }
    out += c; i++
  }
  return out
}

/** 纯函数：texts = Map<相对路径, 源码>，返回死读命中 */
export function findRecordKeyDeadReads(texts) {
  const reads = []
  const bare = new Map()
  for (const [file, raw] of texts) {
    const code = maskSource(raw, { strings: true })
    bare.set(file, maskSource(raw, { strings: false }))
    const vars = new Set([...code.matchAll(DECL)].map(m => m[1]))
    for (const v of vars) {
      const re = new RegExp(`(?<![\\w$.])${v.replace(/\$/g, '\\$')}\\.([A-Za-z_$][\\w$]*)(?![\\w$])(?!\\s*(?:=(?!=)|\\+=|-=|\\?\\?=|\\|\\|=|&&=|\\())`, 'g')
      for (const m of code.matchAll(re)) {
        reads.push({ file, variable: v, key: m[1], line: code.slice(0, m.index).split('\n').length })
      }
    }
  }
  const dead = []
  for (const key of [...new Set(reads.map(r => r.key))].sort()) {
    const word = new RegExp(`(?<![\\w$])${key.replace(/\$/g, '\\$')}(?![\\w$])`, 'g')
    let total = 0
    for (const t of bare.values()) total += (t.match(word) || []).length
    const sites = reads.filter(r => r.key === key)
    if (total <= sites.length) dead.push({ key, sites: sites.map(s => `${s.file}:${s.line}`) })
  }
  return { reads: reads.length, dead }
}

/** detector 判别性自证：死读必报 / 别处有写入必不报 / 字符串里的「x.key」不算读取 / 注释不算别处出现 */
export function detectorSelfTest() {
  const failures = []
  const decl = 'const r = cfg as unknown as Record<string, unknown>\n'
  const t1 = new Map([['a.ts', decl + '// fooDead 注释不算出现\nconst x = Number(r.fooDead ?? 0)\n']])
  const h1 = findRecordKeyDeadReads(t1).dead
  if (!(h1.length === 1 && h1[0].key === 'fooDead' && h1[0].sites[0] === 'a.ts:3')) failures.push('死读未报或行号错：' + JSON.stringify(h1))
  const t2 = new Map([['a.ts', decl + 'const y = Number(r.fooAlive ?? 0)\n'], ['b.ts', 'rec.fooAlive = 1\n']])
  if (findRecordKeyDeadReads(t2).dead.length !== 0) failures.push('别处有写入仍被报（误伤）')
  const t3 = new Map([['a.ts', decl + "const s = setting(cfg, 'r.fooStr', 0)\n"]])
  if (findRecordKeyDeadReads(t3).reads !== 0) failures.push('字符串内的 r.fooStr 被当作读取')
  const t4 = new Map([['a.ts', decl + 'r.fooW = 2\nconst z = r.fooW\n']])
  if (findRecordKeyDeadReads(t4).dead.length !== 0) failures.push('同文件写入后读取被误报')
  return { ok: failures.length === 0, failures }
}

/** 全库扫描（判据 25）；allowlist = { key: 理由 }（登记在 guard-registries.mjs） */
export function scanRecordKeyDeadReads(root, allowlist = {}) {
  const files = execSync("git ls-files 'src/*.ts' 'src/*.vue'", { cwd: root, encoding: 'utf8' })
    .split('\n').filter(f => f && !/__tests__|\.test\.ts$|\.spec\.ts$/.test(f))
  const texts = new Map(files.map(f => [f, readFileSync(join(root, f), 'utf8')]))
  const { reads, dead } = findRecordKeyDeadReads(texts)
  const fresh = dead.filter(d => !(d.key in allowlist))
  const staleAllow = Object.keys(allowlist).filter(k => !dead.some(d => d.key === k))
  const selfTest = detectorSelfTest()
  const belowFloor = reads < RECORD_KEY_MIN_READS
  return { scanned: files.length, reads, dead, fresh, staleAllow, selfTest, belowFloor,
    ok: fresh.length === 0 && staleAllow.length === 0 && selfTest.ok && !belowFloor }
}

export function formatRecordKeyDeadReads(report) {
  const lines = []
  if (report.belowFloor) lines.push(`  ✗ 记录读取仅 ${report.reads} 处 < 下限 ${RECORD_KEY_MIN_READS}：扫描面缺失，零命中不可采信`)
  if (!report.selfTest.ok) lines.push('  ✗ detector 自证失败：', ...report.selfTest.failures.map(f => '    ' + f))
  for (const d of report.fresh) lines.push(`  ✗ ${d.key}：全仓除记录读取外零出现（无写入/声明）⇒ 恒取缺省值 — ${d.sites.join(' ')}`)
  if (report.fresh.length) lines.push('    → 接通写入方（模块 buildCharConfig / 编排层注入），或删除读取并如实登记 pending；确属有意的存量才登记 RECORD_KEY_DEAD_READ_ALLOWLIST（guard-registries.mjs）')
  for (const k of report.staleAllow) lines.push(`  ✗ 豁免 ${k} 已不再是死读：从 RECORD_KEY_DEAD_READ_ALLOWLIST 删除（只减不增）`)
  return lines
}
