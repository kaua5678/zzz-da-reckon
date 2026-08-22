#!/usr/bin/env node
/**
 * gachabase 角色数据爬取 —— 第二数据源，用于交叉验证 catalog 倍率行（nanoka 缺能量等列）。
 *
 * 用法：node scripts/fetch-gachabase-agent.mjs <agentId> <slug> [lang]
 *   例：node scripts/fetch-gachabase-agent.mjs 1401 alice
 *   slug = gachabase URL 里的英文小写名（https://zzz.gachabase.net/agents/1401/alice/beta?lang=chs）
 *
 * 页面为 SSR，内嵌原始数据 `skill_data:[{id:..., damage_multiplier_base:...}]`（键无引号的 JS 对象字面量）。
 * 字段口径（×10000 或 ×100 后 = catalog Lv12 值，已用爱丽丝验证）：
 *   damage_multiplier_base+step×11 → /100   = rows[damage].values[0]（Lv12 = base + 11×step）
 *   daze_multiplier_base+step×11   → /100   = rows[daze].values[0]
 *   energy_gain_base               → /10000 = rows[energy_recovery].values[0]（不随等级成长）
 *   individual_decibel_gain_base   → /10000 = rows[decibel_recovery].values[0]
 *   anomaly_buildup                → /100   = rows[anomaly_buildup].values[0]
 *   ether_purify                   → /100   = rows[ether_purify].values[0]
 *
 * 输出：data/raw/gachabase/<agentId>.json（归一化后的 skill_data），供比对/补录用。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const [agentId, slug, lang = 'chs'] = process.argv.slice(2)
if (!agentId || !slug) {
  console.error('用法: node scripts/fetch-gachabase-agent.mjs <agentId> <slug> [lang]')
  process.exit(1)
}

const url = `https://zzz.gachabase.net/agents/${agentId}/${slug}/beta?lang=${lang}`
const res = await fetch(url)
if (!res.ok) {
  console.error(`FAIL ${url}: HTTP ${res.status}`)
  process.exit(1)
}
const html = await res.text()

// 提取内嵌 skill_data 数组（键无引号；对象间以 ,{id: 分隔）。
// skill_data 对象以「{id:N,damage_multiplier_base:」开头、字段全扁平（唯一内层数组
// attack_data:[..] 不含 {}），故从起点取到下一个 "}" 即完整对象。
const FIELD =
  /(damage_multiplier_base|damage_multiplier_step|daze_multiplier_base|daze_multiplier_step|energy_gain_base|energy_gain_step|anomaly_buildup|sp_consume|individual_decibel_gain_base|individual_decibel_gain_step|ether_purify):(-?[\d.]+)/g
const rows = []
for (const start of html.matchAll(/\{id:(\d+),damage_multiplier_base:/g)) {
  const end = html.indexOf('}', start.index)
  if (end < 0) continue
  const obj = html.slice(start.index, end + 1)
  const fields = {}
  for (const f of obj.matchAll(FIELD)) fields[f[1]] = Number(f[2])
  const attackData = obj.match(/attack_data:\[([\d.]*)\]/)
  rows.push({
    id: Number(start[1]),
    ...fields,
    ...(attackData ? { attack_data: attackData[1].split(',').filter(Boolean).map(Number) } : {}),
  })
}
if (!rows.length) {
  console.error('FAIL: 页面中未找到 skill_data 对象')
  process.exit(1)
}

const outDir = resolve(root, 'data', 'raw', 'gachabase')
mkdirSync(outDir, { recursive: true })
const outPath = resolve(outDir, `${agentId}.json`)
writeFileSync(outPath, `${JSON.stringify({ source: url, fetchedAt: new Date().toISOString(), skill_data: rows }, null, 2)}\n`)
console.log(`OK ${rows.length} 条 → ${outPath}`)
