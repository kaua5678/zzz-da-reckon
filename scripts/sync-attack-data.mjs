#!/usr/bin/env node
/* 同步 attack_data 到 catalog：把 nanoka 数据里非零 attack_data 的 move，补进 catalog 的 attack_data_${i} 行。
 * 两个数据源（值口径不同）：
 *   - data/raw/nanoka_missing/<nanokaId>_skills.json：已缩放（闪络电压 3.2271 这种），直接采。
 *   - data/raw/audit/<slug>.json：raw 定点（32271 这种），÷10000 缩放后采。
 * 匹配：catalog move.id === nanoka move id（move id 一致）。
 * 用法：node scripts/sync-attack-data.mjs         # dry-run
 *       node scripts/sync-attack-data.mjs --write # 写回
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { writeJsonCompact } from './lib/jsonio.mjs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const catalogPath = resolve(root, 'public/static/catalog.json')
const skillsDir = resolve(root, 'data/raw/nanoka_missing')
const auditDir = resolve(root, 'data/raw/audit')

// moveId -> [attack_data 缩放值]
const adMap = new Map()

// 1. nanoka_missing skills（已缩放）
if (existsSync(skillsDir)) {
  for (const f of readdirSync(skillsDir)) {
    if (!f.endsWith('_skills.json')) continue
    try {
      const data = JSON.parse(readFileSync(join(skillsDir, f), 'utf8'))
      for (const s of data.skills ?? []) {
        const ads = (s.attack_data ?? []).map(v => (typeof v === 'number' ? v : 0))
        if (ads.some(v => v > 0)) adMap.set(String(s.id), ads)
      }
    } catch { /* ignore */ }
  }
}

// 2. audit（raw ÷10000）
if (existsSync(auditDir)) {
  for (const f of readdirSync(auditDir)) {
    if (!f.endsWith('.json')) continue
    try {
      const data = JSON.parse(readFileSync(join(auditDir, f), 'utf8'))
      for (const cat of Object.values(data.skill ?? {})) {
        for (const desc of cat.description ?? []) {
          for (const pe of desc.param ?? []) {
            for (const [moveId, v] of Object.entries(pe.param ?? {})) {
              const ads = (v?.attack_data ?? []).map(x => (typeof x === 'number' ? x / 10000 : 0))
              if (ads.some(x => x > 0) && !adMap.has(String(moveId))) adMap.set(String(moveId), ads)
            }
          }
        }
      }
    } catch { /* ignore */ }
  }
}

const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'))
let changed = 0
const patched = []

for (const skills of catalog.agentSkills) {
  for (const cat of skills.categories ?? []) {
    for (const move of cat.moves ?? []) {
      const ads = adMap.get(move.id)
      if (!ads) continue
      for (let i = 0; i < ads.length; i++) {
        if (ads[i] <= 0) continue
        if (move.rows.some(r => String(r.id) === `attack_data_${i}`)) continue
        move.rows.push({ id: `attack_data_${i}`, kind: 'special', values: [ads[i]] })
        changed++
        patched.push(`${skills.agentId}:${move.id}:attack_data_${i}=${ads[i]}`)
      }
    }
  }
}

console.log(`需补 attack_data 行：${changed}`)
for (const p of patched) console.log(`  + ${p}`)

if (process.argv.includes('--write')) {
  writeJsonCompact(catalogPath, catalog)
  console.log('已写回 catalog.json')
} else {
  console.log('（dry-run，未写回；加 --write 落地）')
}
