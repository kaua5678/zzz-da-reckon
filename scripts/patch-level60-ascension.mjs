#!/usr/bin/env node
/**
 * 按 raw 源订正 catalog level60 的「漏加突破加成」字段（当前主要修复 critRate / critDmg）。
 *
 * ## 背景（2026-09-12）
 * `import-nanoka-beta-agent.mjs` 写 level60.critRate/critDmg 时只取裸 `stats.crit`/`stats.crit_damage`，
 * **漏掉满级突破加成**（20101 暴击率 / 21101 暴击伤害）。结果：有突破加成的角色被落成了
 * 全库通用裸基值 5/50，而 1481/1571/1241/1461 等经**另一条已废弃的 scraper 路径**入库的角色
 * 却是含加成的 19.4/78.8 —— 同一个 catalog 里两套口径并存。
 *
 * 判定依据（三条，缺一不可）：
 *   ① `panel.ts` 直接读 `s.critRate`，**别处无补偿通道**（若有补偿则本修复会导致双计）
 *   ② 5 个已含加成的角色证明「level60 = 满级满突破面板」是既有正确口径
 *   ③ 裸值角色错得「整整齐齐」（全部恰好 = 5/50），符合单脚本漏写的特征而非逐角色口径差异
 *
 * ## 设计
 * 映射规则**复用** `audit-catalog-level60.mjs` 的 `FIELD_RULES`（单一事实源，规则 11），
 * 不在此重抄公式——审计抓到什么就修什么，两者永不脱节。
 *
 * ## 用法
 *   node scripts/patch-level60-ascension.mjs              # dry-run（默认，只打印）
 *   node scripts/patch-level60-ascension.mjs --write       # 写回 catalog.json（紧凑）
 *   node scripts/patch-level60-ascension.mjs --field critRate
 *
 * ⚠ 只改「审计判定为不一致」的字段；其余字段与其余角色逐字节不动。
 * ⚠ 改完必须跑 `npm run verify` + 量 timeGolden delta 并逐条归因（AGENTS 规则 10）。
 */
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { writeJsonCompact } from './lib/jsonio.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const RAW_DIR = join(root, 'data/raw/nanoka_missing/full')
const catalogPath = join(root, 'public/static/catalog.json')

const args = process.argv.slice(2)
const write = args.includes('--write')
const fieldFilter = (() => { const i = args.indexOf('--field'); return i >= 0 ? args[i + 1] : undefined })()

import { FIELD_RULES } from './lib/level60-rules.mjs'

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'))
const agentsById = new Map(catalog.agents.map((a) => [String(a.id), a]))
const rawFiles = readdirSync(RAW_DIR).filter((f) => /^\d+\.json$/.test(f))
const rules = FIELD_RULES.filter((r) => r.patchable !== false && (!fieldFilter || r.field === fieldFilter))

const changes = []
for (const file of rawFiles) {
  const id = file.replace('.json', '')
  const agent = agentsById.get(id)
  if (!agent) continue
  let raw
  try { raw = JSON.parse(readFileSync(join(RAW_DIR, file), 'utf8')) } catch { continue }

  for (const rule of rules) {
    const want = rule.expected(raw)
    if (want === undefined) continue
    const got = agent.level60?.[rule.field]
    const tol = rule.tolerance ?? 0
    if (Math.abs(num(got) - num(want)) > tol + 1e-9) {
      changes.push({ id, name: agent.name?.zhCN ?? '', field: rule.field, got, want })
      if (write) agent.level60[rule.field] = want
    }
  }
}

const title = write ? '已订正' : 'dry-run（将订正）'
console.log(`level60 突破加成订正 —— ${title} ${changes.length} 处\n`)
if (changes.length) {
  console.log(`   ${'id'.padEnd(6)}${'角色'.padEnd(16)}${'字段'.padEnd(10)}${'现值 → 订正值'}`)
  console.log(`   ${'-'.repeat(52)}`)
  for (const c of changes) {
    console.log(`   ${c.id.padEnd(6)}${c.name.padEnd(16)}${c.field.padEnd(10)}${String(c.got)} → ${c.want}`)
  }
} else {
  console.log('   无差异，catalog 与 raw 已一致')
}

if (write && changes.length) {
  writeJsonCompact(catalogPath, catalog)
  console.log(`\n✅ 已写入 catalog.json（紧凑）→ 请跑 npm run verify 并量 timeGolden delta`)
} else if (!write && changes.length) {
  console.log(`\n加 --write 生效`)
}
process.exit(0)
