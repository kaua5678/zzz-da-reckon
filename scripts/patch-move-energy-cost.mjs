#!/usr/bin/env node
/**
 * 定点补录招式 energyCost（catalog 是数值唯一事实源，改数值走脚本，不手改 JSON）。
 *
 * 来源：nanoka 角色 JSON（https://static.nanoka.cc/zzz/<version>/zh/character/<id>.json）
 *   的 skill.special.description[].param「闪能消耗」字段 + 用户确认口径：
 *   - 1441015 真斗「强化特殊技：归烬·天坠」闪能消耗 80 点（nanoka param「闪能消耗: 80点」，
 *     用户 2026-08 确认；代入标准式 ×1.2 闪能质量后五列比值全部 ≈1.000，见
 *     multiplierCoefficients.test.ts 的真斗锚点用例）。
 *
 * 幂等：已是目标值时输出 unchanged 不写文件。改完跑 npm run validate:data +
 * npm run gen:multiplier-record + npm test。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { writeJsonCompact } from './lib/jsonio.mjs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const catalogPath = join(root, 'public', 'static', 'catalog.json')

/** moveId → 要写入的 energyCost 对象（整对象覆盖） */
const ENERGY_COST_OVERRIDES = {
  // 真斗「强化特殊技：归烬·天坠」：闪能消耗 80 点（命破角色的能均指闪能）
  1441015: { 'Flash Energy Cost': '80' },
}

/**
 * moveId → 倍率行数值覆盖（{rowId: Lv12 值}，整行值覆盖）。当前为空。
 * 教训（2026-08）：曾按「用户口径 50%」给爱丽丝「星芒圆舞曲 #1~#3」补录回能 2.011/2.821/7.169，
 * 但 gachabase 原始数据（energy_gain_base=0）与 catalog 双源一致确认官方就是 0，已撤销。
 * 结论：数值覆盖必须先经第二数据源交叉验证；gachabase 爬取见 scripts/fetch-gachabase-agent.mjs。
 */
const ROW_VALUE_OVERRIDES = {}

const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'))

let changed = 0
for (const skills of catalog.agentSkills ?? []) {
  for (const category of skills.categories ?? []) {
    for (const move of category.moves ?? []) {
      const costPatch = ENERGY_COST_OVERRIDES[move.id]
      if (costPatch) {
        const before = JSON.stringify(move.energyCost ?? null)
        const after = JSON.stringify(costPatch)
        if (before !== after) {
          console.log(`patch ${move.id} ${move.name?.zhCN ?? ''}: energyCost ${before} → ${after}`)
          move.energyCost = costPatch
          changed++
        } else {
          console.log(`unchanged ${move.id} ${move.name?.zhCN ?? ''}`)
        }
      }
      const rowPatch = ROW_VALUE_OVERRIDES[move.id]
      if (rowPatch) {
        for (const [rowId, value] of Object.entries(rowPatch)) {
          const row = (move.rows ?? []).find((r) => r.id === rowId)
          if (!row) {
            console.error(`MISSING row ${rowId} on ${move.id}，跳过`)
            continue
          }
          const before = row.values[0]
          if (before === value) {
            console.log(`unchanged ${move.id} ${move.name?.zhCN ?? ''}.${rowId} = ${value}`)
            continue
          }
          console.log(`patch ${move.id} ${move.name?.zhCN ?? ''}.${rowId}: ${before} → ${value}`)
          row.values[0] = value
          changed++
        }
      }
    }
  }
}

if (changed === 0) {
  console.log('no changes')
  process.exit(0)
}
writeJsonCompact(catalogPath, catalog)
console.log(`done, ${changed} move(s) patched`)
