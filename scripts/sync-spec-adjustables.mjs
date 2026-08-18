#!/usr/bin/env node
/* 给 spec 中所有 implemented_approximation 的回复/转化规则挂可调比例滑块。
 * 规则：默认 100%，范围 0%-200%，步进 5%，存成 0-1 比例。
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const specDir = resolve(root, 'src/specs/agents')

const files = readdirSync(specDir).filter(file => file.endsWith('.json'))
let added = 0
const customAdjustedRules = new Map([
  ['1051', new Set(['yidhari_ex_heal'])],
  ['1471', new Set(['banyue_fury_from_parry'])],
])

for (const file of files) {
  const specPath = resolve(specDir, file)
  const spec = JSON.parse(readFileSync(specPath, 'utf8'))
  const agentId = spec.agentIds[0]
  let changed = false

  for (const resource of spec.resources ?? []) {
    const rules = [
      ...(resource.gainRules ?? []),
      ...(resource.feedbackGainRules ?? []),
    ]
    for (const rule of rules) {
      if (rule.status !== 'implemented_approximation') continue
      if (rule.adjustable) continue
      const ruleId = rule.id ?? rule.trigger
      if (customAdjustedRules.get(agentId)?.has(ruleId)) continue
      rule.adjustable = {
        id: `${agentId}.${resource.id}.${ruleId}.rate`,
        label: `${spec.name}·${resource.name}·${String(rule.trigger).slice(0, 40)}`,
        description: '近似转化量按比例调整，默认 100%；实际回复量 = 原近似值 × 该比例。',
        default: 1,
        min: 0,
        max: 2,
        step: 0.05,
        suffix: '%',
      }
      added++
      changed = true
    }
  }

  if (changed) {
    writeFileSync(specPath, `${JSON.stringify(spec, null, 2)}\n`, 'utf8')
  }
}

console.log(`adjustable rules synced: ${added}`)
