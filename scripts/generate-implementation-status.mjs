import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function load(relativePath) {
  return JSON.parse(readFileSync(join(root, relativePath), 'utf8'))
}

const catalog = load('public/static/catalog.json')
const constellations = load('public/static/character-constellations.json')
const mechanics = load('public/static/character-mechanics.json')

const implementedStatuses = new Set([
  'implemented',
  'implemented_generic_skill_level',
  'implemented_approximation',
  'implemented_expected_value',
  'implemented_state_machine',
  'implemented_state_machine_approximation',
])

function summarize(statuses, pendingCount) {
  let implemented = 0
  let partial = 0
  let notDescribed = 0
  for (const status of statuses) {
    if (implementedStatuses.has(status)) implemented++
    else if (status === 'partially_implemented') partial++
    else if (status === 'not_described_not_implemented') notDescribed++
  }
  return { implemented, partial, notDescribed, pending: pendingCount }
}

function pendingCount(items) {
  return (items ?? []).reduce((sum, item) => sum + (Array.isArray(item.pending) ? item.pending.length : 0), 0)
}

const agents = catalog.agents ?? []
const specDir = join(root, 'src', 'specs', 'agents')
const specs = readdirSync(specDir)
  .filter(file => file.endsWith('.json'))
  .map(file => JSON.parse(readFileSync(join(specDir, file), 'utf8')))
const specRows = specs.map(spec => {
  const agentNames = spec.agentIds
    .map(id => agents.find(agent => agent.id === id)?.name?.zhCN || id)
    .join('、')
  return `| ${spec.name} | ${agentNames} | ${spec.attributeConversions.length} | ${spec.resources.length} | ${spec.rowFusions.length} | ${spec.events.length} | ${spec.verifications.length} |`
}).join('\n')
const rows = agents.map((agent) => {
  const id = agent.id
  const name = agent.name?.zhCN || agent.name?.en || id
  const constChar = constellations.characters?.[id]
  const mechChar = mechanics.characters?.[id]

  const constStatuses = (constChar?.cinemas ?? []).map(item => item.status).filter(Boolean)
  const constSummary = summarize(constStatuses, pendingCount(constChar?.cinemas))

  const mechStatuses = [
    ...(mechChar?.mechanics ?? []).map(item => item.status),
    ...(mechChar?.specialResources ?? []).flatMap(resource => [
      ...(resource.gainRules ?? []).map(rule => rule.implementation),
      ...(resource.spendRules ?? []).map(rule => rule.implementation),
    ]),
  ].filter(Boolean)
  const mechSummary = summarize(mechStatuses, pendingCount(mechChar?.mechanics))

  return {
    id,
    name,
    constSummary,
    mechSummary,
  }
})

const totals = {
  constellation: { implemented: 0, partial: 0, notDescribed: 0, pending: 0 },
  mechanic: { implemented: 0, partial: 0, notDescribed: 0, pending: 0 },
}

for (const row of rows) {
  const constSummary = row.constSummary ?? { implemented: 0, partial: 0, notDescribed: 0, pending: 0 }
  const mechSummary = row.mechSummary ?? { implemented: 0, partial: 0, notDescribed: 0, pending: 0 }
  for (const key of ['implemented', 'partial', 'notDescribed', 'pending']) {
    totals.constellation[key] += constSummary[key]
    totals.mechanic[key] += mechSummary[key]
  }
}

const table = rows.map((row) => {
  const c = row.constSummary
  const mech = row.mechSummary
  return `| ${row.name} | ${row.id} | ${c.implemented} | ${c.partial} | ${c.notDescribed} | ${c.pending} | ${mech.implemented} | ${mech.partial} | ${mech.pending} |`
}).join('\n')

const content = `# Implementation Status

> 本文档由 \`npm run docs:status\` 从静态 JSON 自动生成，不要手改。

## Summary

| 维度 | 已实现/近似 | 部分实现 | 未描述 | 待办条目 |
| --- | ---: | ---: | ---: | ---: |
| 命座 | ${totals.constellation.implemented} | ${totals.constellation.partial} | ${totals.constellation.notDescribed} | ${totals.constellation.pending} |
| 机制/专属资源 | ${totals.mechanic.implemented} | ${totals.mechanic.partial} | ${totals.mechanic.notDescribed} | ${totals.mechanic.pending} |

## Agent Spec Coverage

| Spec | 角色 | 转模 | 资源 | 融合 | 事件 | 验证 |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
${specRows}

状态口径：
- 已实现/近似：\`implemented*\` 系列，包含通用技能等级、期望值、状态机等实现方式。
- 部分实现：规则已记录或部分字段已接入，但尚未完整进入最终伤害/资源计算。
- 未描述：\`not_described_not_implemented\`，尚未收到机制描述，不视为已实现。
- 待办条目：各命座或机制条目中 \`pending\` 数组记录的具体缺口。

## Coverage Matrix

| 角色 | ID | 命座已实现 | 命座部分 | 命座未描述 | 命座待办 | 机制已实现 | 机制部分 | 机制待办 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
${table}
`

writeFileSync(join(root, 'docs/implementation-status.md'), content, 'utf8')
console.log(`wrote docs/implementation-status.md (${rows.length} agents)`)
