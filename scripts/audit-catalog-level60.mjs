#!/usr/bin/env node
/**
 * catalog ↔ raw 对账审计：找出 catalog 落库值与 nanoka raw 源**应当映射出的值**不一致的角色。
 *
 * ## 为什么需要它（2026-09-12 事故驱动）
 * `import-nanoka-beta-agent.mjs` 的 level60 映射有几类字段是「base + 突破加成」合成，
 * 其中最容易被漏写的一类就是**暴击**：
 *   critRate = stats.crit            + extra_level['6'].extra['20101'].value
 *   critDmg  = stats.crit_damage     + extra_level['6'].extra['21101'].value
 * 历史 bug：脚本只写了裸 `stats.crit` / `stats.crit_damage`，漏掉突破项 → catalog 里
 * 明明有突破加成的角色被落成了全库通用的裸基值 5/50。因「大家都一样」所以肉眼完全看不出来，
 * 直到某角色（克拉蕾 1611）被单独订正才暴露——**全库 23 个有突破加成的角色里 18 个是错的**。
 *
 * ## 泛用设计：为什么不硬编码 crit
 * 映射规则集中在 `FIELD_RULES` 表里，每条 = 「raw 取值路径 + 合成函数 + catalog 目标字段」。
 * 将来发现别的字段也有同类「漏加突破」问题，**加一行规则即可**，不用改脚本主体。
 * 这正是 AGENTS 规则 16③「否决必须留痕」的正面用法：把「别这么写」变成「机器会拦」。
 *
 * ## 用法
 *   node scripts/audit-catalog-level60.mjs              # 全字段审计（默认）
 *   node scripts/audit-catalog-level60.mjs --json        # 机器可读输出（CI 用）
 *   node scripts/audit-catalog-level60.mjs --field critRate
 *   node scripts/audit-catalog-level60.mjs --agent 1611
 *   node scripts/audit-catalog-level60.mjs --list-rules  # 打印当前规则表
 *
 * 退出码：0 = 无差异；1 = 有差异（CI 友好）；2 = 用法/数据错误。
 * ⚠ 只读脚本，**从不写 catalog**。修单向：`scripts/patch-level60-ascension.mjs --write`。
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
// 单一事实源（规则 11）：规则表与 patch 脚本共用，审计抓到什么 = 修复改什么
import { FIELD_RULES } from './lib/level60-rules.mjs'

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const RAW_DIR = join(root, 'data/raw/nanoka_missing/full')
const catalogPath = join(root, 'public/static/catalog.json')

const args = process.argv.slice(2)
const has = (f) => args.includes(f)
const argOf = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined }

if (has('--list-rules')) {
  console.log(`字段映射规则表（${FIELD_RULES.length} 条）：\n`)
  for (const r of FIELD_RULES) console.log(`  ${r.field.padEnd(10)} ${r.label}\n    ${r.note}`)
  process.exit(0)
}

if (!existsSync(catalogPath)) { console.error(`catalog 不存在：${catalogPath}`); process.exit(2) }
if (!existsSync(RAW_DIR)) { console.error(`raw 目录不存在：${RAW_DIR}`); process.exit(2) }

const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'))
const agentsById = new Map(catalog.agents.map((a) => [String(a.id), a]))
const rawFiles = readdirSync(RAW_DIR).filter((f) => /^\d+\.json$/.test(f)).sort()

const fieldFilter = argOf('--field')
const agentFilter = argOf('--agent')
const rules = fieldFilter ? FIELD_RULES.filter((r) => r.field === fieldFilter) : FIELD_RULES
if (rules.length === 0) { console.error(`未知字段 ${fieldFilter}；可用：${FIELD_RULES.map(r => r.field).join(', ')}`); process.exit(2) }

const diffs = []
let compared = 0
const skippedNoRaw = []

for (const file of rawFiles) {
  const id = file.replace('.json', '')
  if (agentFilter && id !== agentFilter) continue
  const agent = agentsById.get(id)
  if (!agent) continue
  let raw
  try { raw = JSON.parse(readFileSync(join(RAW_DIR, file), 'utf8')) } catch { continue }

  for (const rule of rules) {
    const want = rule.expected(raw)
    if (want === undefined) continue
    const got = agent.level60?.[rule.field]
    compared++
    const tolerance = rule.tolerance ?? 0
    if (Math.abs(num(got) - num(want)) > tolerance + 1e-9) {
      diffs.push({ id, name: agent.name?.zhCN ?? '', field: rule.field, got, want, delta: num(want) - num(got) })
    }
  }
}

const noRaw = catalog.agents.filter((a) => !rawFiles.includes(`${a.id}.json`)).map((a) => a.id)

if (has('--json')) {
  console.log(JSON.stringify({ compared, diffs, noRawCount: noRaw.length }, null, 2))
} else {
  console.log(`catalog ↔ raw 对账（规则 ${rules.length} 条 / 有 raw 的角色 ${agentFilter ? 1 : rawFiles.length}）\n`)
  if (diffs.length === 0) {
    console.log(`  ✅ 无差异（比对 ${compared} 个字段值）`)
  } else {
    console.log(`  ⚠ ${diffs.length} 处不一致（共比对 ${compared} 个字段值）：\n`)
    const w = { id: 6, name: 14, field: 10 }
    console.log(`   ${'id'.padEnd(w.id)}${'角色'.padEnd(w.name)}${'字段'.padEnd(w.field)}catalog → 应为（差）`)
    console.log(`   ${'-'.repeat(58)}`)
    for (const d of diffs) {
      console.log(`   ${d.id.padEnd(w.id)}${d.name.padEnd(w.name)}${d.field.padEnd(w.field)}${String(d.got)} → ${d.want} (${d.delta > 0 ? '+' : ''}${d.delta})`)
    }
    console.log(`\n  修复：node scripts/patch-level60-ascension.mjs [--write]`)
  }
  if (noRaw.length && !agentFilter) console.log(`\n  注：${noRaw.length} 个角色无 raw 源，未纳入比对（${noRaw.slice(0, 8).join(', ')}${noRaw.length > 8 ? '…' : ''}）`)
}

process.exit(diffs.length === 0 ? 0 : 1)
