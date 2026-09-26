// 判据 22：引擎/编排层「读角色前缀字段」计数棘轮（只减不增）
//
// 为什么另立判据：agentId 棘轮只管 `agentId === '1051'` 这类身份判定；而 `cfg.billyC1Energy`、
// `remielleSlot` 这类**以角色命名的字段**同样把角色知识钉在 core/resourceCalc 里，却不受任何
// 判据约束。CC-13（2026-09-26）已证明这类字段可以零 delta 通用化 ⇒ 用计数棘轮防回潮、记还款。
// 口径与首次普查：docs/mcp-r22d1-batch12-field-census.md §5（905 处，误报 triggerCount 84 ⇒ 821）。
//
// 度量口径（与普查脚本 /home/kaua/calc-arch/census.mjs 逐字一致，改口径 = 换尺，按 AGENTS 规则 17②）：
// - 范围：git ls-files 'src/core/*.ts' 'src/composables/resourceCalc/*.ts' src/composables/useResourceCalc.ts，排除 __tests__
// - 前缀：src/mechanics/agents/*.ts 文件名开头的小写词（排除 spec/starlight/index/shared/types）
// - 匹配：\b<前缀>[A-Z]\w*\b，只数代码部分（整行注释 / 块注释 / 行尾 // 之后不计）
// - 豁免：ROLE_FIELD_EXEMPT（通用词撞了角色前缀的误报，例：triggerCount = 异常触发次数，不是扳机）
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, basename } from 'node:path'

export const CORE_ROLE_FIELD_BASELINE = 712
export const ROLE_FIELD_EXEMPT = ['triggerCount']
const PREFIX_EXCLUDE = ['spec', 'starlight', 'index', 'shared', 'types']
const SCOPE = ['src/core/*.ts', 'src/composables/resourceCalc/*.ts', 'src/composables/useResourceCalc.ts']

/** 由角色模块文件名推前缀（纯函数，便于测试） */
export function rolePrefixesFrom(fileNames) {
  return [...new Set(fileNames.filter(f => f.endsWith('.ts'))
    .map(f => (basename(f, '.ts').match(/^[a-z]+/) ?? [''])[0])
    .filter(p => p && !PREFIX_EXCLUDE.includes(p)))].sort()
}

/** 数一段源码里代码部分的角色前缀字段引用（纯函数）；返回 [{ field, line }] */
export function findRoleFieldRefs(text, prefixes, exempt = ROLE_FIELD_EXEMPT) {
  if (prefixes.length === 0) return []
  const re = new RegExp(`\\b(${prefixes.join('|')})[A-Z][A-Za-z0-9]*\\b`, 'g')
  const out = []
  let inBlock = false
  text.split('\n').forEach((line, i) => {
    const t = line.trim()
    const isComment = inBlock || t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')
    if (t.startsWith('/*') && !t.includes('*/')) inBlock = true
    if (inBlock && t.includes('*/')) inBlock = false
    if (isComment) return
    const code = line.split('//')[0]
    for (const m of code.matchAll(re)) if (!exempt.includes(m[0])) out.push({ field: m[0], line: i + 1 })
  })
  return out
}

/** 扫仓库；非 git 环境返回 null（调用方跳过） */
export function scanCoreRoleFields(root) {
  let files
  try {
    files = execFileSync('git', ['-C', root, 'ls-files', ...SCOPE], { encoding: 'utf8' })
      .split('\n').filter(f => f && !f.includes('__tests__'))
  } catch { return null }
  const agentsDir = join(root, 'src/mechanics/agents')
  if (!existsSync(agentsDir)) return null
  const prefixes = rolePrefixesFrom(readdirSync(agentsDir))
  const byFile = new Map()
  let count = 0
  for (const f of files) {
    const p = join(root, f)
    if (!existsSync(p)) continue
    const refs = findRoleFieldRefs(readFileSync(p, 'utf8'), prefixes)
    if (refs.length) { byFile.set(f, refs); count += refs.length }
  }
  return { count, byFile, prefixes }
}
