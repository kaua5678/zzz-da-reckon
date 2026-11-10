#!/usr/bin/env node
/**
 * 登记 / 撤销音擎的「专武归属」（`catalog.json` → `wEngines[].ownerAgentId`）。
 *
 * 用法：
 *   node scripts/tag-wengine-owner.mjs <wEngineId> <agentId>   # 登记
 *   node scripts/tag-wengine-owner.mjs <wEngineId> --clear      # 撤销
 *
 * 为什么要有这个脚本：`ownerAgentId` 是**元数据**不是数值（数值仍只从 nanoka raw 导入），
 * 但 catalog.json 是生成产物、禁止手改本体（AGENTS §1.2 / §1.14）。测试服占位音擎
 * （`--tag v1`，见 scripts/import-nanoka-wengine.mjs）按规则**不声明归属**；当某个角色
 * 正式服还没上线、而它的音擎只有 v1 占位时，要把归属落到那唯一一把上只能显式登记——
 * 就是本脚本的用途（首例：挽昼 1601 → 14160v1、知更鸟 1661 → 14166v1，2026-11-10）。
 *
 * 写前先拦（失败 exit 1，不写文件）：
 *  ① 音擎与角色都必须已在 catalog；
 *  ② 一个角色至多一把专武（要换归属，先 `--clear` 旧的那把）；
 *  ③ 音擎特化必须与角色特化一致（同 `core/__tests__/catalogData.test.ts` 那条判据：
 *    特化错标会让 `core/buff.ts` 的 matchSpecialty 静默丢掉整条音擎效果）。
 *
 * 正式服同 id 音擎落地后：先 `--clear` 本占位件的归属，再按常规导入正式 id
 * （`node scripts/import-nanoka-wengine.mjs <id>`，ownerAgentId 由 raw 的 code_name 推出）。
 */
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readJson, writeJsonCompact } from './lib/jsonio.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const catalogPath = resolve(root, 'public/static/catalog.json')

const args = process.argv.slice(2)
const id = args[0]
const clear = args.includes('--clear')
const agentId = clear ? '' : args[1]
if (!id || (!clear && !agentId)) {
  console.error('用法: node scripts/tag-wengine-owner.mjs <wEngineId> <agentId> | <wEngineId> --clear')
  process.exit(2)
}

const catalog = readJson(catalogPath)
const engines = catalog.wEngines ?? []
const idx = engines.findIndex(w => String(w.id) === String(id))
if (idx < 0) {
  console.error(`音擎 ${id} 不在 catalog.wEngines`)
  process.exit(1)
}
const engine = engines[idx]

if (clear) {
  if (!engine.ownerAgentId) {
    console.log(`${id} 本来就没有 ownerAgentId，无需撤销`)
    process.exit(0)
  }
  const old = engine.ownerAgentId
  delete engine.ownerAgentId
  writeJsonCompact(catalogPath, catalog)
  console.log(`CLR  ${id} ${engine.name?.zhCN ?? ''}：ownerAgentId ${old} → （无）`)
  process.exit(0)
}

const agent = (catalog.agents ?? []).find(a => String(a.id) === String(agentId))
if (!agent) {
  console.error(`角色 ${agentId} 不在 catalog.agents`)
  process.exit(1)
}
if (engine.specialty && agent.specialty && engine.specialty !== agent.specialty) {
  console.error(`特化不一致：音擎 ${id} = ${engine.specialty}，角色 ${agentId} ${agent.name?.zhCN ?? ''} = ${agent.specialty}`)
  process.exit(1)
}
const clash = engines.find(w => String(w.ownerAgentId) === String(agentId) && String(w.id) !== String(id))
if (clash) {
  console.error(`${agentId} ${agent.name?.zhCN ?? ''} 已有专武 ${clash.id} ${clash.name?.zhCN ?? ''}（一角色至多一把；先 --clear 旧的）`)
  process.exit(1)
}

if (engine.ownerAgentId === String(agentId)) {
  console.log(`${id} 的 ownerAgentId 已是 ${agentId}，无需改动`)
  process.exit(0)
}

/**
 * 键序与其它音擎保持一致：ownerAgentId 紧跟 specialty（其余键原样保留、顺序不变）。
 * catalog.json 是紧凑单行生成产物，重排键会让整份 diff 变成噪声。
 */
const rebuilt = {}
for (const [k, v] of Object.entries(engine)) {
  rebuilt[k] = v
  if (k === 'specialty') rebuilt.ownerAgentId = String(agentId)
}
if (!('ownerAgentId' in rebuilt)) rebuilt.ownerAgentId = String(agentId)
catalog.wEngines[idx] = rebuilt
writeJsonCompact(catalogPath, catalog)
console.log(`SET  ${id} ${engine.name?.zhCN ?? ''}：ownerAgentId = ${agentId} ${agent.name?.zhCN ?? ''}`)
