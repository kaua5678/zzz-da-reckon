import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const catalog = JSON.parse(readFileSync(join(root, 'public/static/catalog.json'), 'utf8'))
const specDir = join(root, 'src/specs/agents')
const specs = readdirSync(specDir)
  .filter(file => file.endsWith('.json'))
  .map(file => JSON.parse(readFileSync(join(specDir, file), 'utf8')))

const byAgent = new Map()
for (const spec of specs) {
  for (const agentId of spec.agentIds ?? []) {
    byAgent.set(agentId, spec)
  }
}

const rows = (catalog.agents ?? []).map(agent => {
  const spec = byAgent.get(agent.id)
  return {
    id: agent.id,
    name: agent.name?.zhCN || agent.name?.en || agent.id,
    hasSpec: !!spec,
    conversions: spec?.attributeConversions?.length ?? 0,
    resources: spec?.resources?.length ?? 0,
    fusions: spec?.rowFusions?.length ?? 0,
    events: spec?.events?.length ?? 0,
    verifications: spec?.verifications?.length ?? 0,
  }
})

const covered = rows.filter(row => row.hasSpec)
const missing = rows.filter(row => !row.hasSpec)

console.log(`Agents: ${rows.length} | Spec covered: ${covered.length} | Missing: ${missing.length}\n`)
console.log('| ID | Name | Spec | Conv | Res | Fusion | Events | Verify |')
console.log('| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |')
for (const row of rows) {
  console.log(`| ${row.id} | ${row.name} | ${row.hasSpec ? 'yes' : 'no'} | ${row.conversions} | ${row.resources} | ${row.fusions} | ${row.events} | ${row.verifications} |`)
}

if (missing.length > 0) {
  console.log(`\nMissing: ${missing.map(row => `${row.id}(${row.name})`).join(', ')}`)
}
