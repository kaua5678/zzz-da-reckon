#!/usr/bin/env node
/**
 * 定点修复席德(1461)错位攻击数据（catalog 是数值唯一事实源，改数值走脚本，不手改 JSON）。
 *
 * 依据（用户观察 + base 数据源）：席德招式的 attack_data 实为 3 元组 [刚能, 回能, 喧响]——
 * 数值策划把能量回复/喧响回复填进了 attack_data 的 1/2 位，正列 sp_recovery/fever_recovery 反为 0
 * （nanoka raw 同构：sp_recovery=0、fever_recovery=0、attribute_infliction=0，见
 * data/raw/nanoka_missing/full/1461.json）。
 * 验证（磁陨轮舞 1461012，t=0.292s）：attack_data=[3.2084, 0.73, 8.03] →
 *   8.03/0.292 = 27.5/s 精确命中喧响基准、0.73/0.292 = 2.5/s 与
 *   霜蕊轮舞 #3/#4 已录正列的回能速率一致（2.5/s，席德自身调优，回能纵向系数 0.694）。
 * 修复：attack_data_1 → energy_recovery、attack_data_2 → decibel_recovery（覆盖 0），
 *   移除错位的 attack_data_1/2 行；attack_data_0（钢能/专属资源）保留。
 * 不动其他角色：1261 简/1551 佩洛伊斯的 attack_data_1 是独立第二资源（正列回能已真实），
 *   1531 星徽·比利 attack_data_1 = 回血（starlightBilly.ts 消费）。
 *
 * 幂等：已是目标值时输出 no changes 不写文件。改完跑 npm run validate:data +
 * npm run gen:multiplier-record + npm test。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { writeJsonCompact } from './lib/jsonio.mjs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const catalogPath = join(root, 'public', 'static', 'catalog.json')

const AGENT_ID = '1461' // 席德
const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'))

let changed = 0
for (const skills of catalog.agentSkills ?? []) {
  if (String(skills.agentId) !== AGENT_ID) continue
  for (const category of skills.categories ?? []) {
    for (const move of category.moves ?? []) {
      const rows = move.rows ?? []
      const ad1 = rows.find((r) => r.id === 'attack_data_1')
      const ad2 = rows.find((r) => r.id === 'attack_data_2')
      if (!ad1 && !ad2) continue
      const patches = []
      // 回能：attack_data_1 → energy_recovery（值 >0 才搬；席德特殊技/支援突击无回能通道，ad1=0 跳过）
      if (ad1 && ad1.values[0] > 0) {
        const er = rows.find((r) => r.id === 'energy_recovery')
        if (er) patches.push(['energy_recovery', er.values[0], ad1.values[0]])
        else console.error(`MISSING energy_recovery row on ${move.id}（attack_data_1=${ad1.values[0]}），跳过回能搬运`)
      }
      // 喧响：attack_data_2 → decibel_recovery
      if (ad2) {
        const db = rows.find((r) => r.id === 'decibel_recovery')
        if (db) patches.push(['decibel_recovery', db.values[0], ad2.values[0]])
        else console.error(`MISSING decibel_recovery row on ${move.id}（attack_data_2=${ad2.values[0]}），跳过喧响搬运`)
      }
      if (!patches.length) continue
      const removed = [ad1, ad2].filter(Boolean).map((r) => r.id).join('/')
      for (const [rowId, before, after] of patches) {
        console.log(`patch ${move.id} ${move.name?.zhCN ?? ''}.${rowId}: ${before} → ${after}`)
        const row = rows.find((r) => r.id === rowId)
        row.values[0] = after
      }
      console.log(`patch ${move.id} ${move.name?.zhCN ?? ''}: 移除 ${removed} 错位行`)
      move.rows = rows.filter((r) => r.id !== 'attack_data_1' && r.id !== 'attack_data_2')
      changed++
    }
  }
}

if (changed === 0) {
  console.log('no changes')
  process.exit(0)
}
writeJsonCompact(catalogPath, catalog)
console.log(`done, ${changed} move(s) patched`)
