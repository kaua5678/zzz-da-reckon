#!/usr/bin/env node
/**
 * 把 catalog.json 的专武归属（wEngines[].ownerAgentId）同步进 build-recommendations.json：
 * 给缺「专武推荐」块的角色补齐。
 *
 * 根因：build-recommendations.json 是初始提交时从 nanoka.cc 一次性爬取的，专武块只覆盖了
 * 当时能按 ID 规律推导的 30 个角色——后录入的 30 个角色（橘福福/仪玄/般岳等）专武块缺失，
 * 配装推荐面板不显示专武、「一键应用」（applyBuildRecommendationForSlot）也不装专武。
 *
 * 口径：数值唯一事实源 = catalog.json（AGENTS §1.2）。凡 ownerAgentId 指向该角色的音擎即为
 * 其专武；只补缺失（无 nanoka_wengine_id）的条目，已有爬取数据一律不覆盖。
 * catalog_wengine_id 直接写音擎数字 id（2026-08 id 迁移后与 nanoka 同源），保证「一键应用」必命中。
 * catalog 无专武归属的角色（如 1551 佩洛伊斯——专武尚未录入 catalog）跳过并告警，不造数。
 * 幂等：无缺失时输出 unchanged 不写文件。改完跑 npm run check。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { writeJsonCompact } from './lib/jsonio.mjs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const catalogPath = join(root, 'public', 'static', 'catalog.json')
const recsPath = join(root, 'public', 'static', 'build-recommendations.json')
const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'))
const recs = JSON.parse(readFileSync(recsPath, 'utf8'))

/** catalog advancedStat.stat → 展示用英文副词条（与既有爬取条目同词表） */
const SUB_STAT_LABELS = {
  impact: 'Impact',
  critDmg: 'CRIT DMG',
  critRate: 'CRIT Rate',
  atkPct: 'ATK',
  hpPct: 'HP',
  energyRegen: 'Energy Regen',
  anomalyMastery: 'Anomaly Mastery',
  penRatio: 'PEN Ratio',
  anomalyProficiency: 'Anomaly Proficiency',
  defPct: 'DEF',
}

// ownerAgentId → 专武（一把角色至多一把；撞车直接失败，防止静默取错）
const ownerEngine = new Map()
for (const w of catalog.wEngines ?? []) {
  const owner = w.ownerAgentId ? String(w.ownerAgentId) : ''
  if (!owner) continue
  if (ownerEngine.has(owner)) {
    console.error(`✗ 角色 ${owner} 有多把专武归属（${ownerEngine.get(owner).id} / ${w.id}），先在 catalog 里修正`)
    process.exit(1)
  }
  ownerEngine.set(owner, w)
}

const agentName = new Map((catalog.agents ?? []).map(a => [String(a.id), a.name?.zhCN ?? String(a.id)]))

let filled = 0
const noOwner = []
for (const [agentId, rec] of Object.entries(recs.characters ?? {})) {
  if (rec.wengine?.nanoka_wengine_id) continue
  const engine = ownerEngine.get(agentId)
  if (!engine) {
    noOwner.push(`${agentId} ${agentName.get(agentId) ?? ''}`)
    continue
  }
  const advanced = engine.level60?.advancedStat ?? {}
  rec.wengine = {
    nanoka_wengine_id: String(engine.id),
    rank: engine.rarity ?? 'S',
    name_en: engine.name?.en ?? engine.name?.zhCN ?? String(engine.id),
    name_zh: engine.name?.zhCN ?? engine.name?.en ?? String(engine.id),
    icon: `Weapon_${engine.rarity ?? 'S'}_${agentId}`,
    atk: engine.level60?.atkBase ?? 0,
    sub_stat: SUB_STAT_LABELS[advanced.stat] ?? advanced.stat ?? '-',
    desc: engine.effect?.description?.zhCN ?? '',
    catalog_wengine_id: String(engine.id),
  }
  console.log(`+ ${agentId} ${agentName.get(agentId) ?? ''} → ${engine.name?.zhCN}（${engine.id}）`)
  filled++
}

if (noOwner.length) console.warn(`! catalog 无专武归属（不造数，待录入后重跑）：${noOwner.join('、')}`)

if (!filled) {
  console.log('unchanged（无缺失专武推荐）')
} else {
  recs.metadata = recs.metadata ?? {}
  recs.metadata.note = `${recs.metadata.note ?? ''}；缺失专武块由 scripts/sync-signature-wengine-recs.mjs 从 catalog ownerAgentId 补齐`.replace(/^；/, '')
  writeJsonCompact(recsPath, recs)
  console.log(`写入 ${recsPath}：补 ${filled} 条`)
}
