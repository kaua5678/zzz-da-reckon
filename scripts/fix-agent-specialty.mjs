#!/usr/bin/env node
/**
 * 修复 catalog.json 角色特化（specialty）与 nanoka 原始数据不一致。
 *
 * 起因（用户 2026-09-08 质疑「朱鸢是强攻啊，是项目写错了吗」）：审计发现
 * catalog.agents[1241 朱鸢].specialty = 'stun'（击破），而原文
 * data/raw/nanoka_missing/full/1241.json 与 data/raw/audit/1241.json 的
 * weapon_type 都是 {'1':'强攻'}。后果不只是分类显示：
 * - 专武 14124 防暴者Ⅵ型 requirement.specialty='attack'，而 collectWEngineBuffs
 *   以 `wEngine.specialty === agent.specialty` 为总开关（src/core/buff.ts#collectAllBuffs）
 *   → 朱鸢装专武时整条音擎效果（暴击率+15%、平A/冲刺充能增伤）被静默丢弃；
 * - 山大王 4pc / 队友职业门控（千夏强攻计数、席德、仪玄 hasStun、耀嘉音）全部错位。
 *
 * 口径：原文 weapon_type（中文标签优先，英文标签兜底）→ 代码枚举；映射不到的标签
 * 只警告不改值（规则 15：不凭名字联想静默选最像的）。
 * 幂等：无不一致时输出 unchanged 不写文件。
 * 用法：node scripts/fix-agent-specialty.mjs
 */
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeJsonCompact } from './lib/jsonio.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const catalogPath = join(root, 'public', 'static', 'catalog.json')
const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'))

/** nanoka weapon_type 标签 → 代码枚举（与 src/types/catalog.ts Specialty 一致） */
const WEAPON_TYPE_TO_CODE = {
  '强攻': 'attack', Attack: 'attack',
  '击破': 'stun', Stun: 'stun',
  '异常': 'anomaly', Anomaly: 'anomaly',
  '支援': 'support', Support: 'support',
  '防护': 'defense', Defense: 'defense',
  '命破': 'rupture', Rupture: 'rupture',
  '锋御': 'sharpen', Sharpen: 'sharpen',
  '锐化': 'sharpen',
  Armorer: 'sharpen', Edgeguard: 'edgeguard',
}

/** 原文来源优先级：full（中文全量）> audit（中文快照）> 顶层抓取（可能英文） */
const RAW_SOURCES = id => [
  join(root, 'data/raw/nanoka_missing/full', `${id}.json`),
  join(root, 'data/raw/audit', `${id}.json`),
  join(root, 'data/raw', `nanoka_${id}.json`),
]

/** weapon_type 形态：{'1':'强攻'} | 'Attack' | 缺失 */
function labelOf(value) {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object') {
    const zh = Object.values(value).find(v => typeof v === 'string')
    return zh ?? ''
  }
  return ''
}

let changed = 0
const unknown = new Set()
for (const agent of catalog.agents ?? []) {
  const id = String(agent.id)
  const path = RAW_SOURCES(id).find(existsSync)
  if (!path) continue
  let raw
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    continue
  }
  const label = labelOf(raw.weapon_type ?? raw.info?.weapon_type)
  if (!label) continue
  const derived = WEAPON_TYPE_TO_CODE[label]
  if (!derived) {
    unknown.add(`${id}:${label}`)
    continue
  }
  if (derived !== agent.specialty) {
    console.log(`fix ${id} ${agent.name?.zhCN ?? ''}: ${agent.specialty} → ${derived}（原文 weapon_type=${label}，源 ${path.replace(root + '/', '')}）`)
    agent.specialty = derived
    changed++
  }
}

if (unknown.size) console.log('未识别的 weapon_type 标签（跳过不改）:', [...unknown].join(', '))
if (changed === 0) {
  console.log('unchanged：角色特化与 raw 数据一致')
} else {
  writeJsonCompact(catalogPath, catalog)
  console.log(`wrote ${catalogPath}（修复 ${changed} 名角色）`)
}
