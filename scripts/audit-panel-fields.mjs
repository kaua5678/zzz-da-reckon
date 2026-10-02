#!/usr/bin/env node
/**
 * PanelValues 未声明字段盘点（r400，docs/mcp-panel-fields.md）。
 *
 * 原理：临时把 `src/types/catalog.ts` 里 PanelValues 的 `[key: string]: number` 换掉，跑 `vue-tsc -b --force`，
 * 编译器报出的每一处 = 一次「靠索引签名才成立」的访问（比正则扫描精确：变量名、解构、DeepReadonly 都能定位）。
 * 跑完**一定恢复** catalog.ts（finally 里 `git checkout`）。
 *
 * 用法（务必在**临时 worktree** 里跑，别在主工作区：中途被杀会留下改坏的 catalog.ts）：
 *   node scripts/audit-panel-fields.mjs <worktree> [none|template] [out.json]
 *     none     = 整个删掉索引签名（全量清单）
 *     template = 换成 `[key: \`${string}__${string}\`]: number`（定向属性键已被覆盖后的剩余清单；默认）
 * 输出：stdout 打 markdown 表（字段 / tsc 可见写读次数 / 归属 single:模块|multi-mod|cross|test-only / 文件），
 *       动态键访问点（TS7053，按文件计数）与其他错误（断言 / 测试对象字面量）。
 * 注意：「W1 R0」只表示 **tsc 看得见的** 读为 0；按字符串键读的（spec JSON、statMeta、组件 `p[key]`）
 *       要另外 `grep -rnw <字段> src public/static` 确认，见文档 §3。
 */
import fs from 'node:fs'
import { execSync } from 'node:child_process'

const [WT, mode = 'template', outJson] = process.argv.slice(2)
if (!WT) { console.error('usage: node scripts/audit-panel-fields.mjs <worktree> [none|template] [out.json]'); process.exit(1) }
const CAT = `${WT}/src/types/catalog.ts`
const SIG = '  [key: string]: number\n}'
const src0 = fs.readFileSync(CAT, 'utf8')
if (src0.split(SIG).length !== 2) { console.error('PanelValues 索引签名形态变了（或已删除），先更新本脚本的 SIG'); process.exit(1) }
const repl = mode === 'none' ? '}' : '  [key: `${string}__${string}`]: number\n}'
let log = ''
try {
  fs.writeFileSync(CAT, src0.replace(SIG, repl))
  try { execSync('npx vue-tsc -b --force', { cwd: WT, stdio: 'pipe', maxBuffer: 64 << 20 }) }
  catch (e) { log = String(e.stdout ?? '') + String(e.stderr ?? '') }
} finally {
  fs.writeFileSync(CAT, src0)
}

const lines = log.split('\n').filter(l => /error TS\d+/.test(l))
const cache = {}
const lineOf = (f, n) => ((cache[f] ??= fs.readFileSync(`${WT}/${f}`, 'utf8').split('\n'))[n - 1] ?? '')
const props = new Map(); const dynamic = []; const other = []
for (const l of lines) {
  const m = l.match(/^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/)
  if (!m) { other.push(l); continue }
  const [, file, ln, col, code, msg] = m
  const text = lineOf(file, +ln)
  // 类型名可能是 PanelValues，也可能是 DeepReadonly 展开后的对象字面量类型（含 `readonly hp: number`）
  const pm = msg.match(/^Property '(\w+)' does not exist on type '(?:PanelValues'|DeepReadonly<PanelValues>'|\{[^']*readonly hp: number)/)
  if ((code === 'TS2339' || code === 'TS2551') && pm) {
    const name = pm[1]
    const after = text.slice(+col - 1 + name.length)
    const kind = /^\s*(\?\?|\|\||&&|\+|-|\*|\/)?=(?!=)/.test(after) ? 'W' : 'R'
    if (!props.has(name)) props.set(name, [])
    props.get(name).push({ file, line: +ln, kind })
  } else if (code === 'TS7053') {
    dynamic.push({ file, line: +ln, text: text.trim().slice(0, 160) })
  } else {
    other.push(`${file}:${ln} ${code} ${msg.slice(0, 140)}`)
  }
}
const mod = f => (f.match(/mechanics\/agents\/(\w+)\.ts$/) || [])[1]
const rows = [...props].sort((a, b) => a[0].localeCompare(b[0])).map(([name, occ]) => {
  const files = [...new Set(occ.map(o => o.file))]
  const prod = files.filter(f => !/__tests__|\/test\//.test(f))
  const mods = [...new Set(prod.map(mod).filter(Boolean))]
  const W = occ.filter(o => o.kind === 'W').length
  const scope = prod.length === 0 ? 'test-only'
    : prod.length === 1 && mods.length === 1 ? `single:${mods[0]}`
    : prod.every(f => mod(f)) ? `multi-mod:${mods.join('+')}` : 'cross'
  return { name, W, R: occ.length - W, scope, files: files.map(f => f.replace(/^src\//, '')) }
})
if (outJson) fs.writeFileSync(outJson, JSON.stringify({ mode, total: lines.length, rows, dynamic, other }, null, 1))
console.log(`<!-- mode=${mode} total=${lines.length} named=${rows.length} dynamic=${dynamic.length} other=${other.length} -->`)
console.log('| 字段 | 写/读（tsc 可见） | 归属 | 出现文件 |\n|---|---|---|---|')
for (const r of rows) console.log(`| \`${r.name}\` | W${r.W} R${r.R} | ${r.scope} | ${r.files.join(', ')} |`)
const byFile = {}
for (const d of dynamic) byFile[d.file] = (byFile[d.file] ?? 0) + 1
console.log('\n动态键访问（TS7053）：' + Object.entries(byFile).map(([f, n]) => `\`${f}\`×${n}`).join('，'))
console.log('\n其他：\n' + other.map(x => `- ${x}`).join('\n'))
