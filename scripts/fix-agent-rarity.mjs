#!/usr/bin/env node
/**
 * 修复 catalog.json 角色稀有度（S/A）与 nanoka 原始数据不一致。
 *
 * 根因：早期 nanoka_stats_scraper 导入路径（现已不在 scripts/ 中）把缺失稀有度默认成 S，
 * 导致 妮可(1031)/苍角(1131)/露西(1151)/潘引壶(1421) 四个四星角色在 catalog 里被标成 S
 * （raw 数据 data/raw/nanoka_<id>_zh.json 的 rarity=3，即 A 级）——影响全站 S 级显示与
 * 「总限定金」口径（isLimitedAgent 把她们误算成限定 S）。
 *
 * 口径：raw 数据 rarity >= 4 → 'S'，否则 'A'；无 raw 文件的角色跳过（不改）。
 * 幂等：无不一致时输出 unchanged 不写文件。改完跑 npm run validate:data + npm test。
 */
import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const catalogPath = join(root, 'public', 'static', 'catalog.json')
const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'))

let changed = 0
for (const a of catalog.agents ?? []) {
  const rawPath = join(root, 'data', 'raw', `nanoka_${a.id}_zh.json`)
  if (!existsSync(rawPath)) continue
  const raw = JSON.parse(readFileSync(rawPath, 'utf8'))
  const derived = raw.rarity >= 4 ? 'S' : 'A'
  if (derived !== a.rarity) {
    console.log(`fix ${a.id} ${a.name?.zhCN ?? ''}: ${a.rarity} → ${derived}（raw rarity=${raw.rarity}）`)
    a.rarity = derived
    changed++
  }
}

if (changed === 0) {
  console.log('unchanged：角色稀有度与 raw 数据一致')
} else {
  writeFileSync(catalogPath, JSON.stringify(catalog, null, 2))
  console.log(`wrote ${catalogPath}（修复 ${changed} 名角色）`)
}
