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
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const catalogPath = join(root, 'public', 'static', 'catalog.json')

/** moveId → 要写入的 energyCost 对象（整对象覆盖） */
const OVERRIDES = {
  // 真斗「强化特殊技：归烬·天坠」：闪能消耗 80 点（命破角色的能均指闪能）
  1441015: { 'Flash Energy Cost': '80' },
}

const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'))

let changed = 0
for (const skills of catalog.agentSkills ?? []) {
  for (const category of skills.categories ?? []) {
    for (const move of category.moves ?? []) {
      const patch = OVERRIDES[move.id]
      if (!patch) continue
      const before = JSON.stringify(move.energyCost ?? null)
      const after = JSON.stringify(patch)
      if (before === after) {
        console.log(`unchanged ${move.id} ${move.name?.zhCN ?? ''}`)
        continue
      }
      console.log(`patch ${move.id} ${move.name?.zhCN ?? ''}: ${before} → ${after}`)
      move.energyCost = patch
      changed++
    }
  }
}

if (changed === 0) {
  console.log('no changes')
  process.exit(0)
}
writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`)
console.log(`done, ${changed} move(s) patched`)
