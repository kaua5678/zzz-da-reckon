/**
 * spec 结构校验（60 角色）
 *
 * 标注约定（写 spec note 时必须遵守，新 AI 录入前必读）：
 * - 每条机制要么 [已确认]（用户拍板 → 同时写入 verifications 变成 golden test），
 *   要么 [猜测·高/中/低]（格式：实现:<字段/模块> | 依据:"<原文片段>" | 待核对:<点>）。
 *   不允许存在既无确认又无标注的机制描述。
 * - status 语义：not_described_not_implemented（没收到机制描述）/ implemented_approximation
 *   （近似实现，通常带可调滑块）/ implemented / partially_implemented。
 * - 完整字段说明见 src/specs/template.json 的 _comment；完整角色示例见
 *   src/specs/agents/lucia_elowen.json（1451）。
 * - 已在 public/static/teammate-buffs.json 承载的拐力不要重复填 teamBuffs。
 */
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const specDir = join(root, 'src', 'specs', 'agents')
const allowedStatuses = new Set([
  'implemented',
  'implemented_approximation',
  'partially_implemented',
  'not_described_not_implemented',
])

let failed = 0
let checks = 0

function check(name, condition, detail = '') {
  checks++
  if (condition) {
    console.log(`  ok ${name}`)
  } else {
    failed++
    console.log(`  FAIL ${name}${detail ? ` - ${detail}` : ''}`)
  }
}

const catalog = JSON.parse(readFileSync(join(root, 'public/static/catalog.json'), 'utf8'))
const moves = new Set()
for (const skills of catalog.agentSkills ?? []) {
  for (const category of skills.categories ?? []) {
    for (const move of category.moves ?? []) moves.add(move.id)
  }
}

const files = readdirSync(specDir).filter(file => file.endsWith('.json'))
check('spec directory has JSON files', files.length > 0)

const allIds = new Set()

for (const file of files) {
  const spec = JSON.parse(readFileSync(join(specDir, file), 'utf8'))
  const label = spec.id || file

  check(`${label}: schemaVersion is 1`, spec.schemaVersion === 1)
  check(`${label}: id is unique`, !allIds.has(spec.id))
  if (spec.id) allIds.add(spec.id)
  check(`${label}: agentIds is non-empty`, Array.isArray(spec.agentIds) && spec.agentIds.length > 0)
  check(`${label}: status is allowed`, allowedStatuses.has(spec.status))
  check(`${label}: attributeConversions is array`, Array.isArray(spec.attributeConversions))
  check(`${label}: resources is array`, Array.isArray(spec.resources))
  check(`${label}: rowFusions is array`, Array.isArray(spec.rowFusions))
  check(`${label}: events is array`, Array.isArray(spec.events))
  check(`${label}: verifications is array`, Array.isArray(spec.verifications))
  check(`${label}: stateMachines is array`, Array.isArray(spec.stateMachines))
  check(`${label}: teamBuffs is array when present`, spec.teamBuffs == null || Array.isArray(spec.teamBuffs))
  check(`${label}: additionalAbility has teamConditions when present`, spec.additionalAbility == null || Array.isArray(spec.additionalAbility.teamConditions))

  const localIds = new Set()
  for (const item of [
    ...(spec.attributeConversions ?? []),
    ...(spec.resources ?? []),
    ...(spec.rowFusions ?? []),
    ...(spec.events ?? []),
    ...(spec.verifications ?? []),
    ...(spec.stateMachines ?? []),
    ...(spec.teamBuffs ?? []),
  ]) {
    if (item?.id) {
      check(`${label}: nested id ${item.id} is unique`, !localIds.has(item.id), item.id)
      localIds.add(item.id)
    }
    if (item?.expected) {
      check(`${label}: verification ${item.id} has expected values`, Object.keys(item.expected).length > 0, item.id)
    }
  }

  for (const fusion of spec.rowFusions ?? []) {
    check(`${label}: fusion move ${fusion.moveId} exists in catalog`, moves.has(fusion.moveId), fusion.moveId)
  }
}

console.log(failed === 0 ? `\n${checks} spec checks passed` : `\n${failed} spec check(s) failed`)
process.exit(failed === 0 ? 0 : 1)
