#!/usr/bin/env node
/* Fetch full zh character JSON for the 30 newly added nanoka agents.
 * Full JSON includes passive / talent / potential / skill_list, which the
 * existing skills-only scraper does not cover.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const listPath = resolve(root, 'data/raw/nanoka_missing/list.json')
const outDir = resolve(root, 'data/raw/nanoka_missing/full')
const BASE_URL = 'https://static.nanoka.cc/zzz/3.2.1+17934514/zh/character/'

const list = JSON.parse(readFileSync(listPath, 'utf8'))
mkdirSync(outDir, { recursive: true })

let ok = 0
let failed = 0
for (const id of Object.keys(list)) {
  const target = resolve(outDir, `${id}.json`)
  if (existsSync(target)) {
    ok++
    continue
  }
  const res = await fetch(`${BASE_URL}${id}.json`)
  if (!res.ok) {
    failed++
    console.error(`FAIL ${id}: HTTP ${res.status}`)
    continue
  }
  const data = await res.json()
  writeFileSync(target, JSON.stringify(data, null, 2))
  ok++
  console.log(`OK ${id} ${data.name ?? ''}`)
}

console.log(`done ok=${ok} failed=${failed}`)
process.exit(failed === 0 ? 0 : 1)
