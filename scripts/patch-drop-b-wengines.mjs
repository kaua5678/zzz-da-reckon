#!/usr/bin/env node
/**
 * 移除 catalog.wEngines 里的 B 级音擎（用户裁决 2026-09-09：「B 级没人用，删了都行」）。
 *
 * 背景：catalog 里 B 级音擎 8 条（「月相」-望/晦/朔、残响-Ⅰ/Ⅱ/Ⅲ型、电磁暴-贰式、灰烬-钴蓝），
 * 其中 4 条被动未建模（selfBuff.effects 为空），无任何预设 / 配装推荐引用，只在武器下拉里占位；
 * 3.2 新增的 12016「月相」-弦同属此列（不再补录）。
 *
 * 删除后：武器下拉只剩 A/S；raw 存档 `data/raw/nanoka_wengine_<id>_{zh,en}.json` 保留，
 * 需要恢复时按 id 重导：`node scripts/import-nanoka-wengine.mjs <id> --force`（并把它加回
 * import-nanoka-wengine.mjs 的 ALL_MISSING，否则无参运行不会自动补）。
 *
 * 幂等：catalog 已无 B 级时输出 0 条。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const path = join(root, 'public', 'static', 'catalog.json')
const catalog = JSON.parse(readFileSync(path, 'utf8'))

const dropped = catalog.wEngines.filter(w => w.rarity === 'B')
catalog.wEngines = catalog.wEngines.filter(w => w.rarity !== 'B')

if (dropped.length) {
  writeFileSync(path, JSON.stringify(catalog))
  console.log(`移除 B 级音擎 ${dropped.length} 条：${dropped.map(w => `${w.id} ${w.name?.zhCN ?? ''}`).join('、')}`)
} else {
  console.log('catalog 已无 B 级音擎（幂等）')
}
console.log(`wEngines 现存 ${catalog.wEngines.length} 条 → ${path}`)
