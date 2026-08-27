#!/usr/bin/env node
// 产物瘦身：把 public/static/*.json 紧凑写，并剔除 catalog.json 里的 legacy 死键。
//
// 背景：历史 import 脚本全部用 JSON.stringify(x, null, 2) 回写 catalog.json，且「读整份→改→写整份」
// 的循环会把早已无人消费的旧字段永久携带下去。结果：catalog.json 5.18MB（compact 仅 2.59MB），
// 且 35 个顶层键里 25 个不在 `Catalog` 类型、无任何消费端（display*/*Map/example(s)/combatBuffs 等）。
//
// 用法：npm run minify:static  （幂等；可重复运行）
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CATALOG_FIELDS } from './lib/catalog-fields.mjs'
import { writeJsonCompact } from './lib/jsonio.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const staticDir = join(root, 'public', 'static')

function human(n) {
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(2)}MB` : `${(n / 1024).toFixed(1)}KB`
}

function minifyFile(file, { whitelist = null } = {}) {
  const path = join(staticDir, file)
  const raw = readFileSync(path, 'utf8')
  const data = JSON.parse(raw)

  const stripped = []
  if (whitelist) {
    const keep = new Set(whitelist)
    for (const key of Object.keys(data)) {
      if (!keep.has(key)) {
        stripped.push(key)
        delete data[key]
      }
    }
  }

  writeJsonCompact(path, data)
  const after = statSync(path).size
  return { before: Buffer.byteLength(raw), after, stripped }
}

let grandBefore = 0
let grandAfter = 0

for (const file of readdirSync(staticDir)) {
  if (!file.endsWith('.json')) continue
  const { before, after, stripped } = minifyFile(file, {
    whitelist: file === 'catalog.json' ? CATALOG_FIELDS : null,
  })
  grandBefore += before
  grandAfter += after
  const pct = before ? ((1 - after / before) * 100).toFixed(1) : '0'
  const tag = stripped.length ? `（剔除 ${stripped.length} 个死键：${stripped.join(', ')}）` : ''
  console.log(`  ${file}: ${human(before)} → ${human(after)} (-${pct}%)${tag}`)
}

console.log(`\n合计: ${human(grandBefore)} → ${human(grandAfter)} (-${grandBefore ? ((1 - grandAfter / grandBefore) * 100).toFixed(1) : '0'}%)`)
