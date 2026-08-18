import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const agentId = args.find(arg => !arg.startsWith('--'))
const shouldWrite = args.includes('--write')

if (!agentId) {
  console.error('Usage: node scripts/create-agent-spec.mjs <agentId> [--write]')
  process.exit(1)
}

const catalog = JSON.parse(readFileSync(join(root, 'public/static/catalog.json'), 'utf8'))
const agent = (catalog.agents ?? []).find(item => item.id === agentId)
if (!agent) {
  console.error(`Agent ${agentId} not found in catalog`)
  process.exit(1)
}

const template = JSON.parse(readFileSync(join(root, 'src/specs/template.json'), 'utf8'))
// 剥离 _comment（模板自带字段说明，不写进角色 spec）
const { _comment, ...templateSpec } = template
const name = agent.name?.zhCN || agent.name?.en || agentId
const filename = `${agentId}.json`
const target = join(root, 'src/specs/agents', filename)

if (existsSync(target) && !args.includes('--force')) {
  console.error(`${filename} already exists; use --force to overwrite`)
  process.exit(1)
}

const spec = {
  ...templateSpec,
  id: `agent:${agentId}`,
  name,
  agentIds: [agentId],
  notes: [`待录入：${name} 的机制、资源、事件与验证。`],
}

if (shouldWrite) {
  writeFileSync(target, `${JSON.stringify(spec, null, 2)}\n`, 'utf8')
  console.log(`wrote ${filename}`)
} else {
  console.log(`would write ${filename} for ${name}`)
}
