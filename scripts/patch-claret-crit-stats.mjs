#!/usr/bin/env node
/* ⚠️ **已被取代（2026-09-12）——保留仅供历史追溯，新活请用通用脚本**
 *
 * 替代者：
 *   - `scripts/lib/level60-rules.mjs`    —— 字段映射规则表（单一事实源）
 *   - `scripts/audit-catalog-level60.mjs` —— 只读审计（全字段、全角色，有差异 EXIT=1）
 *   - `scripts/patch-level60-ascension.mjs` —— 按规则订正（dry-run 默认）
 * 本脚本只修 1611 一个角色的两个字段，且公式写死；通用脚本覆盖全部 8 个字段 × 62 角色。
 * 跑它现在只会输出「已正确 / 无改动」——它的修复已被吸收进 catalog。
 *
 * 以下为原始说明（历史背景，勿据此重写同类脚本）：
 * 修复 catalog 1611 克拉蕾 level60 的暴击字段（数据错误：critDmg=0 / critRate=19.4）。
 *
 * 背景（2026-09-12，用户指出 + 账本 `task-ledger.md` 首条交接）：
 *   - nanoka 正式服 /zzz/3.2/zh/character/1611.json：`stats.crit=500`（基础暴击率 5%）、
 *     `stats.crit_damage=5000`（万分比 → 基础暴击伤害 **50%**）、ascension 突破
 *     `extra_level['6'].extra['20101']=2880`（暴击率 +28.8%）。
 *   - catalog 原值 `critDmg:0` / `critRate:19.4` 来自**已过期的 8 月快照**
 *     （data/raw/nanoka_1611.json 与 data/raw/audit/1611.json：crit_damage=0、20101=1440 → 5+14.4=19.4）。
 *     同一份 conduit 里 `sharpCritDmg:150` / `sharpnessRegen:1.5` 却已是**正式服口径**
 *     （sharp_critical_damage=15000 / ep_recover=150），可见两个暴击字段被漏更新。
 *   - 订正后 1611 = 全 catalog 唯一 critDmg=0 的角色被消除；锋御模板基础暴伤 = 50（与其他 61 名角色同）。
 *
 * 口径（与全库其余 61 名角色一致，用 1241 朱鸢 / 1461「席德」校准）：
 *   critRate = base crit + 满突破暴击率加成  = 5 + 2880/100 = **33.8**
 *   critDmg  = base 暴击伤害（1611 无 21101 暴伤突破）      = **50**
 *   校准依据：1241/1461 的 ascension 21101=2880，catalog critDmg=78.8 = 50 + 28.8 → 证明
 *   level60 是「满级满突破面板」，突破暴击加成**必须**计入（panel.ts 直接读 s.critRate，别处无补偿通道）。
 *
 * 用法：node scripts/patch-claret-crit-stats.mjs [--write]
 *   默认 dry-run；--write 写回 catalog.json（紧凑，走 lib/jsonio）。
 */
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeJsonCompact } from './lib/jsonio.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const write = process.argv.includes('--write')
const AGENT_ID = '1611'
const catalogPath = resolve(root, 'public/static/catalog.json')
const rawPath = resolve(root, `data/raw/nanoka_missing/full/${AGENT_ID}.json`)

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'))
const raw = JSON.parse(readFileSync(rawPath, 'utf8'))
const agent = catalog.agents.find((a) => a.id === AGENT_ID)
if (!agent) { console.error(`catalog 无 ${AGENT_ID}`); process.exit(1) }

const st = raw.stats ?? {}
const extra6 = raw?.extra_level?.['6']?.extra ?? {}
// 突破加成：20101=暴击率 / 21101=暴击伤害（prop 名取自 nanoka extra_level 的 name 字段）
const ASC = { critRate: '20101', critDmg: '21101' }
const derived = {
  critRate: Math.round((num(st.crit) + num(extra6[ASC.critRate]?.value)) / 100 * 100) / 100,
  critDmg: Math.round((num(st.crit_damage) + num(extra6[ASC.critDmg]?.value)) / 100 * 100) / 100,
}

console.log(`${AGENT_ID} ${agent.name.zhCN}：`)
let dirty = false
for (const [k, want] of Object.entries(derived)) {
  const got = agent.level60[k]
  const same = Math.abs((got ?? 0) - want) < 1e-9
  console.log(`  ${k.padEnd(9)} ${String(got).padStart(7)} → ${String(want).padStart(7)}${same ? '  (已正确)' : '  <<< 订正'}`)
  if (!same) { agent.level60[k] = want; dirty = true }
}

if (!dirty) { console.log('\n无改动'); process.exit(0) }
if (write) {
  writeJsonCompact(catalogPath, catalog)
  console.log('\n已写入 catalog.json（紧凑）')
} else {
  console.log('\ndry-run（--write 生效）')
}
