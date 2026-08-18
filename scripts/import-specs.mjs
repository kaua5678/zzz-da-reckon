import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const sourceFile = args.find(arg => !arg.startsWith('--'))
const shouldWrite = args.includes('--write')
const force = args.includes('--force')

if (!sourceFile) {
  console.error('Usage: node scripts/import-specs.mjs <json-file> [--write] [--force]')
  process.exit(1)
}

const resolvedSource = isAbsolutePath(sourceFile) ? sourceFile : join(root, sourceFile)
const specs = JSON.parse(readFileSync(resolvedSource, 'utf8'))
if (!Array.isArray(specs)) {
  console.error('Expected an array of AgentMechanicSpec')
  process.exit(1)
}

const specDir = join(root, 'src', 'specs', 'agents')
let count = 0
let merged = 0

/**
 * 人工确认字段合并（教训：import-specs 曾整文件覆盖，把人工录入的 notes/teamBuffs/verifications 清空，
 * 导致「录了没进计算」。现在写入前合并，人工字段优先，--force 可跳过合并整文件覆盖）。
 * - notes / teamBuffs / verifications / status：已有（人工）优先；notes 追加新生成中不重复的条目
 * - 机制字段（attributeConversions/resources/events/rowFusions/stateMachines）：以新生成为准（脚本数据更新）
 */
function mergeHumanFields(existing, fresh) {
  if (!existing) return fresh
  const byId = (list) => new Map((list ?? []).map(item => [item.id ?? JSON.stringify(item), item]))
  const mergeById = (oldList, newList) => {
    const map = byId(oldList)
    for (const item of newList ?? []) {
      const key = item.id ?? JSON.stringify(item)
      if (!map.has(key)) map.set(key, item)
    }
    return [...map.values()]
  }
  const existingNotes = existing.notes ?? []
  const freshNotes = fresh.notes ?? []
  const notes = [...existingNotes, ...freshNotes.filter(n => !existingNotes.includes(n))]
  return {
    ...fresh,
    status: existing.status && existing.status !== 'not_described_not_implemented' ? existing.status : fresh.status,
    notes,
    teamBuffs: mergeById(existing.teamBuffs, fresh.teamBuffs),
    verifications: mergeById(existing.verifications, fresh.verifications),
  }
}

for (const spec of specs) {
  if (spec?.schemaVersion !== 1 || !spec?.id || !Array.isArray(spec?.agentIds) || spec.agentIds.length === 0) {
    console.error(`Invalid spec: ${spec?.id ?? 'unknown'}`)
    process.exit(1)
  }

  const filename = `${spec.id.replace(/^agent:/, '')}.json`
  const target = join(specDir, filename)
  const existing = existsSync(target) ? JSON.parse(readFileSync(target, 'utf8')) : null
  const out = existing && !force ? mergeHumanFields(existing, spec) : spec
  if (shouldWrite) {
    writeFileSync(target, `${JSON.stringify(out, null, 2)}\n`, 'utf8')
    console.log(`${existing && !force ? `merged ${filename}` : `wrote ${filename}`}`)
  } else {
    console.log(`${existing && !force ? `would merge ${filename}` : `would write ${filename}`} (${spec.name})`)
  }
  if (existing && !force) merged++
  count++
}

console.log(shouldWrite ? `${count} specs written` : `${count} specs ready; pass --write to save`)

function isAbsolutePath(value) {
  return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('/')
}
