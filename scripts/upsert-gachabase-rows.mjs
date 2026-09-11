#!/usr/bin/env node
/* 【gachabase 补列导入】把第二数据源里**尚未进 catalog 的列**补成倍率行。
 *
 * 背景（2026-09-11 事故）：`fetch-gachabase-agent.mjs` 早先用字段白名单正则抓页面，
 * `gash_buildup`（残痕积累）/ `sharpness_gain_base`（锐能回复）/ `adrenaline_base`（肾上腺素）
 * 三列**从未进过 `data/raw/gachabase/*.json`，因此永远进不了 catalog**——
 * 「克拉蕾锐能只长在血锻四式」「锻星残痕 120/s ≠ 常态 100/s」这类事实在仓库里查不到。
 * 抓取侧已改为通用字段抓取；本脚本负责把已有缓存里的列落成 catalog 行。
 *
 * 用法：node scripts/upsert-gachabase-rows.mjs <agentId> [--write]
 *   node scripts/upsert-gachabase-rows.mjs 1611 --write
 *
 * 口径：
 * - 只**新增**行，不覆盖已有行（`damage/daze/decibel_recovery/anomaly_buildup/ether_purify` 的
 *   权威来源仍是 nanoka 导入路径；本脚本绝不改这些行的值，也**不碰 actionTime**——
 *   actionTime = ether_purify/100 由 `import-nanoka-v12.mjs` 维护，`multiplierCoefficients` 有护栏）；
 * - 值 = 页面列 / 比例（gash ÷100；sharpness、adrenaline ÷10000），与 base 网显示值一致；
 * - 幂等：已存在的目标行跳过（只刷值不动 label/kind）；
 * - 目标行 id / kind：
 *     gash_buildup      → id `gash_buildup`      kind `gash`
 *     sharpness_gain_base → id `sharpness_gain`  kind `sharpness`
 *     adrenaline_base   → id `adrenaline`        kind `adrenaline`
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeJsonCompact } from './lib/jsonio.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const agentId = process.argv[2]
const write = process.argv.includes('--write')
if (!agentId) {
  console.error('用法: node scripts/upsert-gachabase-rows.mjs <agentId> [--write]')
  process.exit(1)
}

const gbPath = resolve(root, 'data', 'raw', 'gachabase', `${agentId}.json`)
if (!existsSync(gbPath)) {
  console.error(`缺少 gachabase 缓存：${gbPath}\n先跑 node scripts/fetch-gachabase-agent.mjs <agentId> <slug>`)
  process.exit(1)
}
const gb = JSON.parse(readFileSync(gbPath, 'utf8'))
const byId = new Map(gb.skill_data.map(r => [String(r.id), r]))

const catalogPath = resolve(root, 'public', 'static', 'catalog.json')
const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'))
const skills = (catalog.agentSkills ?? []).find(s => String(s.agentId) === agentId)
if (!skills) {
  console.error(`catalog 无 agentSkills[${agentId}]`)
  process.exit(1)
}

/**
 * 页面字段 → { rowId, kind, divisor, label }。
 *
 * `adrenaline_base` 口径（用户 2026-09-11 确认）：gachabase 英文列名 = 游戏里的**闪能**回复
 * （命破角色的专属能量），nanoka 把它翻成「肾上腺素」是误译。落成 `flash_energy_recovery`
 * 与引擎既有通道**同名**（`calcBasicAttackRegenPerSec` / `rowEnergyTotal` / 角色模块的
 * `rowValue(move,'flash_energy_recovery')` 都只认这个名字），不新增 kind、不改引擎。
 * 数据佐证：这 5 个角色的 `energy_gain_base` 全为 0 且互斥 —— 正是命破的「只有闪能、没有能量」。
 */
const CONVERSIONS = [
  { field: 'gash_buildup', rowId: 'gash_buildup', kind: 'gash', divisor: 100, label: { zhCN: '残痕积累', en: 'Gash Buildup' } },
  { field: 'sharpness_gain_base', rowId: 'sharpness_gain', kind: 'sharpness', divisor: 10000, label: { zhCN: '锐能回复', en: 'Sharpness Gain' } },
  { field: 'adrenaline_base', rowId: 'flash_energy_recovery', kind: 'flashEnergy', divisor: 10000, label: { zhCN: '闪能回复', en: 'Adrenaline (Flash Energy)' } },
]

const round3 = (v) => Math.round(v * 1000) / 1000
let added = 0
let updated = 0
let skipped = 0
const report = []

for (const cat of skills.categories) {
  for (const move of cat.moves) {
    const src = byId.get(String(move.id))
    if (!src) continue
    for (const conv of CONVERSIONS) {
      const raw = src[conv.field]
      if (!raw) continue // 0 / 缺失 = 该招式无此通道，不建行（与表一致：无量不成行）
      const value = round3(raw / conv.divisor)
      // 迁移历史：早期把该列落成 `adrenaline` 行（kind adrenaline）——落新行 + 删旧行
      if (conv.rowId === 'flash_energy_recovery') {
        const legacyIdx = (move.rows ?? []).findIndex(r => r.id === 'adrenaline')
        if (legacyIdx >= 0) {
          move.rows.splice(legacyIdx, 1)
          report.push(`− ${move.id} 删除旧 adrenaline 行`)
        }
      }
      const existing = (move.rows ?? []).find(r => r.id === conv.rowId)
      if (existing) {
        const prev = existing.values?.[0]
        if (prev !== value) {
          existing.values = [value]
          updated++
          report.push(`~ ${move.id} ${conv.rowId} ${prev} → ${value}`)
        } else {
          skipped++
        }
        continue
      }
      move.rows = move.rows ?? []
      // 位置：跟在同族行后（anomaly_buildup / ether_purify），避免行序抖动
      const anchorId = conv.rowId === 'gash_buildup' ? 'anomaly_buildup' : 'ether_purify'
      const anchorIdx = move.rows.findIndex(r => r.id === anchorId)
      const row = { id: conv.rowId, label: conv.label, kind: conv.kind, values: [value] }
      if (anchorIdx >= 0) move.rows.splice(anchorIdx + 1, 0, row)
      else move.rows.push(row)
      added++
      report.push(`+ ${move.id} ${conv.rowId} = ${value}`)
    }
  }
}

console.log(`agent ${agentId}：新增 ${added} 行 · 刷值 ${updated} 行 · 已存在跳过 ${skipped} 行`)
for (const line of report.slice(0, 40)) console.log(' ', line)
if (report.length > 40) console.log(`  …（另有 ${report.length - 40} 条）`)

if (write) {
  writeJsonCompact(catalogPath, catalog)
  console.log(`已写入 ${catalogPath}（紧凑格式；跑 npm run validate:data 验收）`)
} else {
  console.log('（dry-run；加 --write 落盘）')
}
