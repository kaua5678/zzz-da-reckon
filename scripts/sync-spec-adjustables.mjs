#!/usr/bin/env node
/* 给 spec 中所有 implemented_approximation 的回复/转化规则挂可调比例滑块。
 * 规则：默认 100%，范围 0%-200%，步进 5%，存成 0-1 比例。
 *
 * ⚠ 2026-09-10 收窄：**只给无自定义模块的 spec-only 角色挂滑块**（当前仅 1551 佩洛伊斯）。
 * 有自定义模块的角色分两类：
 * - 模块调用 spec 资源解释器（computeSpecResources/buildSpecEventExecutions）的 = adjustable **活的**
 *   （解释器按 setting:<id> 应用倍率，adjustable.default 常携带真实口径）——本脚本保守跳过，
 *   它们要么已带 adjustable（恢复保留），要么由模块 settings 管理；
 * - 其余模块角色（1171/1181/1261/1281/1291/1411/1511/1581）的 spec adjustable 是死数据
 *   （specToMechanicModule 从不注册、解释器不消费），2026-09-10 已从 spec 删除 16 条——
 *   这里必须跳过，否则重跑会把死滑块复活成静默 WARN。
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const specDir = resolve(root, 'src/specs/agents')
const mechanicsDir = resolve(root, 'src/mechanics/agents')

/** 与 validate-specs.mjs 同款解析：src/mechanics/agents/*.ts 里声明的 agentIds（含 const 解析） */
const customModuleAgents = new Set()
for (const file of readdirSync(mechanicsDir)) {
  if (!file.endsWith('.ts')) continue
  const src = readFileSync(resolve(mechanicsDir, file), 'utf8')
  const consts = new Map()
  for (const m of src.matchAll(/(?:const|export const)\s+(\w+)\s*=\s*'(\d+)'/g)) consts.set(m[1], m[2])
  for (const m of src.matchAll(/agentIds:\s*\[([^\]]*)\]/g)) {
    for (const tok of m[1].split(',')) {
      const lit = tok.match(/'(\d+)'/)
      const name = tok.trim().match(/^([A-Za-z_]\w*)$/)
      const id = lit ? lit[1] : (name ? consts.get(name[1]) : undefined)
      if (id) customModuleAgents.add(id)
    }
  }
}

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
  if (customModuleAgents.has(agentId)) continue // 死滑块禁区：模块角色 spec 不挂 adjustable
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
