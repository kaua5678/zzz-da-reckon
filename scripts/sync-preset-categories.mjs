#!/usr/bin/env node
/**
 * 预设分类同步器（单一口径来自 scripts/lib/presetCategories.mjs）。
 *
 * 干什么：把 src/data/teamPresets/*.json 每条预设的 group/subgroup 重算成
 *   一级 = 队伍输出核心职业（强攻/命破/异常/锋御队），二级 = 该核心的属性。
 * 修的两个用户反馈（2026-09-08）：
 *   ① 一级菜单出现「击破队」「支援队」——击破/支援是辅助位，不能当队伍分类名；
 *   ② 选「命破队·火」只出 1 条——手编预设没填 subgroup，掉进「未分属性」，
 *      般岳（火命破主C）其余配队看不见。
 * 幂等：已一致的条目不写盘；`--check` 只报不写（validate-data 的护栏用它同源判定）。
 * 用法：node scripts/sync-preset-categories.mjs [--check]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { classifyPreset } from './lib/presetCategories.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const presetDir = join(root, 'src', 'data', 'teamPresets')
const catalog = JSON.parse(readFileSync(join(root, 'public', 'static', 'catalog.json'), 'utf8'))
const agentById = new Map(catalog.agents.map(a => [String(a.id), a]))
const agentOf = id => agentById.get(String(id))
const checkOnly = process.argv.includes('--check')

const changes = []
const dropped = []

for (const file of readdirSync(presetDir).filter(f => f.endsWith('.json')).sort()) {
  const path = join(presetDir, file)
  const raw = readFileSync(path, 'utf8')
  const data = JSON.parse(raw)
  if (data?.disabled || !Array.isArray(data.team)) continue // 模板/非法条目不动

  const verdict = classifyPreset(data.team, agentOf)
  if (!verdict) {
    dropped.push(`${file} ${data.name}（队内无输出位：击破/支援/防护不构成队伍分类）`)
    continue
  }
  const { group, subgroup } = verdict
  if (data.group === group && data.subgroup === subgroup) continue

  changes.push(`${file}: ${data.group}/${data.subgroup ?? '（缺）'} → ${group}/${subgroup}`)
  if (checkOnly) continue
  // 文本级打补丁：只动 group/subgroup 两行。手编预设的 goldSteps 是「一步一行」的排版，
  // 整体 JSON.stringify 重排会把 9 个文件冲成上千行 diff（也挡不住并行会话同文件改动）。
  const groupLine = /^(\s*)"group"\s*:\s*"(?:[^"\\]|\\.)*"\s*,?\s*$/m
  const subLine = /^(\s*)"subgroup"\s*:\s*"(?:[^"\\]|\\.)*"\s*,?\s*$/m
  let text = raw
  if (!groupLine.test(text)) {
    // 没有 group 行的老条目：插到 id 行之后
    text = text.replace(/^(\s*)"id"\s*:\s*("(?:[^"\\]|\\.)*"),\s*$/m,
      (_m, pad, idVal) => `${pad}"id": ${idVal},\n${pad}"group": ${JSON.stringify(group)},\n${pad}"subgroup": ${JSON.stringify(subgroup)},`)
  } else {
    text = text.replace(groupLine, (_m, pad) => {
      const g = `${pad}"group": ${JSON.stringify(group)},`
      return subLine.test(text) ? g : `${g}\n${pad}"subgroup": ${JSON.stringify(subgroup)},`
    })
    if (subLine.test(text)) text = text.replace(subLine, (m, pad) => `${pad}"subgroup": ${JSON.stringify(subgroup)},`)
  }
  writeFileSync(path, text.endsWith('\n') ? text : text + '\n')
}

if (changes.length === 0 && dropped.length === 0) {
  console.log('unchanged：全部预设的 group/subgroup 已符合分类口径')
} else {
  for (const c of changes) console.log(checkOnly ? `待同步 ${c}` : `sync ${c}`)
  for (const d of dropped) console.log(`无输出位（该条需人工处置或删）：${d}`)
  console.log(`${checkOnly ? 'check' : 'wrote'} ${changes.length} 条`)
}
