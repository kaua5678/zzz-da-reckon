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
//
// ─────────────────────────────────────────────────────────────────────────────
// 反空洞下限（2026-10-06 加，用户质询「count < frozen 凭什么是进步」后补）
//
// **为什么必须存在**：本判据只比对 `count === frozen`。扫描面自己塌了（`git ls-files` 换 scope、
// `src/mechanics/agents` 改名、目录搬家）时 count 会掉到 0 而判据照样绿——更糟的是若 `frozen > 0`，
// 判据会红着说「是进步，把基线下调到 N」，照做 = **永久关闭护栏**。
// 实测（2026-10-06）：`src/views` 改名后 exhibition-layer 报 count 1→0，提示原文正是
// 「是进步，把 EXHIBITION_LAYER_IMPORT_BASELINE 下调到 0」——什么都没修，护栏却没了。
//
// 口径：下限取实测值的 ~75%（留重构余量，但拦得住「扫到 0」这种量级的塌陷）。
// 实测 2026-10-06：core role-field 48 个文件（git ls-files src/core）。
export const CORE_ROLE_SCAN_MIN_FILES = 35
//   2026-09-26 CC-20 口径纠正（换尺，规则 17②，不与代码改动混批）：追加 triggerPanel / triggerSlot /
//   triggerAgentId / triggerCountValues / triggerSources —— 实读全部用处均为「触发者（覆盖异常的角色）」
//   或「触发源」通用义（例 core/anomalyPool/helpers.ts `@param triggerPanel 触发者面板`），与扳机（trigger.ts）
//   无关，共 37 处误报。⚠ 从此这 5 个名字**专指触发者**：扳机角色自己的字段不得用这些名字（改用
//   模块内局部量或 getAgentMechanic 能力），否则会被豁免漏计。
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, basename } from 'node:path'

export const CORE_ROLE_FIELD_BASELINE = 0
export const ROLE_FIELD_EXEMPT = ['triggerCount', 'triggerPanel', 'triggerSlot', 'triggerAgentId', 'triggerCountValues', 'triggerSources']
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
  let scanned = 0
  for (const f of files) {
    const p = join(root, f)
    if (!existsSync(p)) continue
    scanned++
    const refs = findRoleFieldRefs(readFileSync(p, 'utf8'), prefixes)
    if (refs.length) { byFile.set(f, refs); count += refs.length }
  }
  return { count, byFile, prefixes, scanned }
}

// ─────────────────────────────────────────────────────────────────────────────
// 判据 23（CC-43b，2026-09-27）：角色名「中缀 / 子目录」棘轮 —— 补判据 22 的两处口径盲区
//
// 判据 22 只数 `\b<前缀>[A-Z]`（小写前缀开头）且只扫 `src/core/*.ts` 顶层 ⇒ 以下两类看不见：
//   ① 标识符**中间**带角色名：`applyLiuyinPromote`、`computeRemielleEntryPanel`、`AliceCoweringDotResult`；
//   ② core 子目录：`src/core/anomalyPool/**`、`src/core/resource/**`、`src/core/stunAxis/**`。
// CC-43a（同日）先零差改名清掉 7 个纯命名项，剩下的都是**真债**（按值导入角色模块 / 身份字面量 / 专属函数），
// 计入 CORE_ROLE_INFIX_BASELINE，只减不增。判据 22 不动（它是 0 的硬门，扩口径会破坏硬门语义）。
//
// 度量口径（改口径 = 换尺，按 AGENTS 规则 17②，不与代码改动混批）：
// - 范围：git ls-files src/core src/composables/resourceCalc src/composables/useResourceCalc.ts 中的 .ts，排除 __tests__
// - 前缀：同判据 22（rolePrefixesFrom），但排除 INFIX_PREFIX_EXCLUDE（英文通用词：trigger）
// - 匹配：把标识符按驼峰切段（`computeRemielleEntryPanel` → compute/Remielle/Entry/Panel），
//   任一段小写后 === 某前缀即计 1（⇒ `teamBenefit` 的 Benefit ≠ ben，不误报）；只数代码部分，字符串字面量不计
// - 豁免：ROLE_INFIX_EXEMPT（写明理由；不许当放宽判据用）
export const CORE_ROLE_INFIX_BASELINE = 0  // 2026-09-27 CC-43c 4→0 清零 ⇒ 硬门（同判据 22）；CC-43f 6→4；CC-43e 8→6；CC-43d 13→8
export const INFIX_PREFIX_EXCLUDE = ['trigger']
export const ROLE_INFIX_EXEMPT = [
  // configStore 用户持久化配置键（「自动伊德海莉轴」开关），改名需做存档迁移，收益低于成本；编排层只读它不写
  'autoYidhariAxis',
]

/** 驼峰切段（纯函数）：'computeRemielleEntryPanel' → ['compute','Remielle','Entry','Panel']；'xideAAActive' → ['xide','AA','Active'] */
export function camelSegments(id) {
  return id.match(/[A-Z]+(?![a-z])|[A-Z]?[a-z]+|\d+/g) ?? []
}

/** 数一段源码里代码部分含角色名段的标识符（纯函数）；返回 [{ field, line }] */
export function findRoleInfixRefs(text, prefixes, exempt = ROLE_INFIX_EXEMPT) {
  const set = new Set(prefixes.filter(p => !INFIX_PREFIX_EXCLUDE.includes(p)))
  if (set.size === 0) return []
  const out = []
  let inBlock = false
  text.split('\n').forEach((line, i) => {
    const t = line.trim()
    const isComment = inBlock || t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')
    if (t.startsWith('/*') && !t.includes('*/')) inBlock = true
    if (inBlock && t.includes('*/')) inBlock = false
    if (isComment) return
    const code = line.split('//')[0].replace(/'[^']*'|"[^"]*"|`[^`]*`/g, '')
    for (const m of code.matchAll(/\b[A-Za-z_$][\w$]*\b/g)) {
      if (exempt.includes(m[0])) continue
      if (camelSegments(m[0]).some(s => set.has(s.toLowerCase()))) out.push({ field: m[0], line: i + 1 })
    }
  })
  return out
}

/** 扫仓库（判据 23）；非 git 环境返回 null */
export function scanCoreRoleInfix(root) {
  let files
  try {
    files = execFileSync('git', ['-C', root, 'ls-files', 'src/core', 'src/composables/resourceCalc', 'src/composables/useResourceCalc.ts'], { encoding: 'utf8' })
      .split('\n').filter(f => f.endsWith('.ts') && !f.includes('__tests__'))
  } catch { return null }
  const agentsDir = join(root, 'src/mechanics/agents')
  if (!existsSync(agentsDir)) return null
  const prefixes = rolePrefixesFrom(readdirSync(agentsDir))
  const byFile = new Map()
  let count = 0
  let scanned = 0
  for (const f of files) {
    const p = join(root, f)
    if (!existsSync(p)) continue
    scanned++
    const refs = findRoleInfixRefs(readFileSync(p, 'utf8'), prefixes)
    if (refs.length) { byFile.set(f, refs); count += refs.length }
  }
  return { count, byFile, prefixes, scanned }
}
