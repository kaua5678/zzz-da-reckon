#!/usr/bin/env node
/* 把 nanoka_missing/<nanokaId>_skills.json 的 attack_data 导入 catalog 的对应 moves（attack_data_0 行）。
 * 用于已存在于 catalog、但旧脚本没导入 attack_data 的老/slug 角色（如青衣 1251）。
 * 匹配方式：catalog move.id === nanoka skill.id（move id 一致）。
 * 用法：node scripts/import-attack-data.mjs 1251 [--write]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const catalogPath = resolve(root, 'public/static/catalog.json')
const rawDir = resolve(root, 'data/raw/nanoka_missing')

const nanokaId = process.argv[2]
if (!nanokaId) {
  console.error('用法: node scripts/import-attack-data.mjs <nanokaId> [--write]')
  process.exit(1)
}

const skillsPath = resolve(rawDir, `${nanokaId}_skills.json`)
const skills = JSON.parse(readFileSync(skillsPath, 'utf8'))
const adMap = new Map()
for (const s of skills.skills || []) {
  const ads = (s.attack_data || []).map(v => (typeof v === 'number' ? v : 0))
  if (ads.some(v => v > 0)) adMap.set(String(s.id), ads)
}

const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'))
let changed = 0
let matched = 0

for (const agentSkills of catalog.agentSkills) {
  const moves = agentSkills?.categories?.flatMap(c => c.moves ?? []) ?? []
  if (moves.length === 0) continue
  let anyMatch = false
  for (const move of moves) {
    const ads = adMap.get(move.id)
    if (!ads) continue
    anyMatch = true
    // 已存在则跳过
    if (move.rows.some(r => String(r.id).startsWith('attack_data_'))) continue
    for (let i = 0; i < ads.length; i++) {
      if (ads[i] <= 0) continue
      move.rows.push({ id: `attack_data_${i}`, kind: 'special', values: [ads[i]] })
      changed++
    }
  }
  if (anyMatch) {
    matched++
    console.log(`匹配 agentSkills ${agentSkills.agentId}（nanoka ${nanokaId}）`)
  }
}

if (matched === 0) {
  console.warn(`警告：nanoka ${nanokaId} 未匹配到任何 catalog agentSkills（move id 不一致？）`)
} else {
  console.log(`新增 attack_data 行：${changed}`)
}

if (process.argv.includes('--write')) {
  writeFileSync(catalogPath, JSON.stringify(catalog, null, 2))
  console.log('已写回 catalog.json')
} else {
  console.log('（dry-run，未写回；加 --write 落地）')
}
