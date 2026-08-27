#!/usr/bin/env node
/* 把 nanoka camp 数据映射为 catalog 的 faction 字段。
 * 数据源：data/raw/audit/*.json（slug/老角色，文件名= catalog agentId）+ data/raw/nanoka_missing/full/*.json（新角色，文件名= nanoka id = catalog agentId）。
 * camp 是 {campId: factionName}；同一 campId 代表同一阵营，需统一成同一字符串（优先中文名）。
 * 用法：node scripts/import-factions.mjs         # dry-run，打印映射与覆盖
 *       node scripts/import-factions.mjs --write # 写回 catalog.json
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { writeJsonCompact } from './lib/jsonio.mjs'
import { resolve, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const catalogPath = resolve(root, 'public/static/catalog.json')
const auditDir = resolve(root, 'data/raw/audit')
const fullDir = resolve(root, 'data/raw/nanoka_missing/full')

const hasCJK = (s) => /[\u4e00-\u9fff]/.test(s ?? '')

// campId -> { name(中文优先), names(Set) }
const campNames = new Map()
const agentFaction = new Map() // catalogAgentId -> { campId, name }

function readCamp(filePath) {
  try {
    const data = JSON.parse(readFileSync(filePath, 'utf8'))
    const camp = data?.camp
    if (!camp || typeof camp !== 'object') return null
    const entries = Object.entries(camp)
    if (entries.length === 0) return null
    // 单阵营角色取第一个；多阵营取全部 join（罕见）
    const campId = entries[0][0]
    const name = String(entries[0][1] ?? '').trim()
    return { campId, name }
  } catch {
    return null
  }
}

function register(agentId, camp) {
  if (!camp || !camp.name) return
  if (!campNames.has(camp.campId)) campNames.set(camp.campId, { name: camp.name, names: new Set() })
  const rec = campNames.get(camp.campId)
  rec.names.add(camp.name)
  // 中文名优先
  if (hasCJK(camp.name)) rec.name = camp.name
  else if (!hasCJK(rec.name)) rec.name = camp.name
  agentFaction.set(agentId, { campId: camp.campId, name: rec.name })
}

for (const f of readdirSync(auditDir)) {
  if (!f.endsWith('.json')) continue
  const agentId = basename(f, '.json')
  register(agentId, readCamp(resolve(auditDir, f)))
}
for (const f of readdirSync(fullDir)) {
  if (!f.endsWith('.json')) continue
  const agentId = basename(f, '.json')
  register(agentId, readCamp(resolve(fullDir, f)))
}

const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'))
let covered = 0
let missing = []
let changed = 0

for (const agent of catalog.agents) {
  const rec = agentFaction.get(agent.id)
  if (!rec) {
    missing.push(agent.id)
    continue
  }
  covered++
  if (agent.faction !== rec.name) {
    if (process.argv.includes('--write')) agent.faction = rec.name
    changed++
  }
}

console.log('campId 映射（campId → 统一名）：')
for (const [id, rec] of [...campNames.entries()].sort((a, b) => Number(a[0]) - Number(b[0]))) {
  const variants = [...rec.names].filter(n => n !== rec.name)
  console.log(`  ${id} -> ${rec.name}${variants.length ? `  (变体: ${variants.join(', ')})` : ''}`)
}
console.log(`\n覆盖：${covered}/${catalog.agents.length} 个角色有 faction`)
console.log(`缺失：${missing.length ? missing.join(', ') : '无'}`)
console.log(`需变更：${changed} 个角色`)
if (process.argv.includes('--write')) {
  writeJsonCompact(catalogPath, catalog)
  console.log('已写回 catalog.json')
} else {
  console.log('（dry-run，未写回；加 --write 落地）')
}
