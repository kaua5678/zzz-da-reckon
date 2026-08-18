import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const shouldWrite = args.includes('--write')
const force = args.includes('--force')
const specDir = join(root, 'src/specs/agents')
const catalog = JSON.parse(readFileSync(join(root, 'public/static/catalog.json'), 'utf8'))
const template = JSON.parse(readFileSync(join(root, 'src/specs/template.json'), 'utf8'))
// 剥离 _comment（模板自带字段说明，不写进角色 spec）
const { _comment, ...templateSpec } = template

const existing = new Set()
for (const file of readdirSync(specDir)) {
  if (!file.endsWith('.json')) continue
  const spec = JSON.parse(readFileSync(join(specDir, file), 'utf8'))
  for (const agentId of spec.agentIds ?? []) existing.add(agentId)
}

const missing = (catalog.agents ?? []).filter(agent => !existing.has(agent.id))
let created = 0
let skipped = 0

for (const agent of missing) {
  const filename = `${agent.id}.json`
  const target = join(specDir, filename)
  if (existsSync(target) && !force) {
    skipped++
    continue
  }
  const name = agent.name?.zhCN || agent.name?.en || agent.id
  const spec = {
    ...templateSpec,
    id: `agent:${agent.id}`,
    name,
    agentIds: [agent.id],
    notes: [`待录入：${name} 的机制、资源、事件与验证。`],
  }
  if (shouldWrite) {
    writeFileSync(target, `${JSON.stringify(spec, null, 2)}\n`, 'utf8')
    console.log(`wrote ${filename}`)
  } else {
    console.log(`would write ${filename} (${name})`)
  }
  created++
}

console.log(shouldWrite
  ? `${created} skeletons written${skipped ? `, ${skipped} skipped` : ''}`
  : `${created} skeletons ready; pass --write to save`)
