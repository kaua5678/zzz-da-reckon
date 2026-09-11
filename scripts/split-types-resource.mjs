#!/usr/bin/env node
/**
 * 一次性结构重构脚本：把 src/types/resource.ts 按 section banner 拆成 src/types/resource/ 目录 + barrel。
 *
 * 为什么这么拆（评审第二梯队 #7）：2566 行 / 19 个 section 的单文件是并行会话的合并冲突热点
 * （近 60 提交里改了 60 次）。拆成按域分文件后，冲突面收敛到具体域。
 *
 * 为什么下游零改动：消费方一律写 `@/types/resource`（85 个文件）。拆成**目录 + index.ts barrel**
 * 后，同一路径经目录 index 解析到 barrel（已前置实证：bundler moduleResolution + vite 均支持）。
 *
 * 为什么是纯机械移动：全文件 69 个顶层声明**全部**带 export 前缀、无模块级副作用代码
 * （仅 1 个运行时函数 isFrontlineExecution），因此按行区间切片不破坏任何语义。
 * 每个域文件各自 import 它引用到的其他域符号——用「未定义标识符」驱动补齐（typecheck 报错即清单）。
 *
 * 用法：node scripts/split-types-resource.mjs [--write]
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(root, 'src/types/resource.ts')
const OUT_DIR = join(root, 'src/types/resource')

/**
 * section 标题 → 目标文件（按语义归域，不按出现顺序）。
 * key 是 banner 里的中文标题（`// ============ X ============` 的 X）。
 */
const SECTION_TO_FILE = {
  '时间分配': 'time.ts',
  '迭代中间状态': 'time.ts',
  '能量资源': 'energy.ts',
  '喧响资源': 'energy.ts',
  '维琳娜专属资源': 'agentResources.ts',
  '爱丽丝专属资源': 'agentResources.ts',
  '角色资源汇总': 'agentResources.ts',
  '特殊动作喧响奖励': 'agentResources.ts',
  '招式执行计划': 'execution.ts',
  '队伍资源汇总': 'team.ts',
  '计算输入': 'config.ts',
  '计算配置': 'config.ts',
  '失衡池': 'pools.ts',
  '积蓄池': 'pools.ts',
  '异常覆盖率': 'pools.ts',
  '紊乱伤害': 'pools.ts',
  '爱丽丝畏缩 DOT': 'pools.ts',
  '乱流伤害': 'pools.ts',
  '失衡轴': 'pools.ts',
}

const FILE_HEADER = {
  'time.ts': '时间分配 / 迭代中间状态',
  'energy.ts': '能量（含闪能）与喧响资源',
  'agentResources.ts': '单角色资源汇总与角色专属资源（维琳娜 / 爱丽丝等）',
  'execution.ts': '招式执行计划（SkillExecution 及其派生）',
  'team.ts': '队伍资源汇总（TeamResourceResult 及其派生）',
  'config.ts': '计算输入与配置（CharacterOperationConfig / ResourceCalcConfig —— 引擎的输入面）',
  'pools.ts': '失衡池 / 积蓄池 / 异常覆盖率 / 紊乱 / 乱流 / 失衡轴',
}

const src = readFileSync(SRC, 'utf8')
const lines = src.split('\n')

// ---- 1. 切成 section 块 ----
const bannerRe = /^\/\/ =+ (.+?) =+$/
const chunks = []           // { title, start, end, text }
let preamble = []           // 文件头注释（首个 banner 之前）
let cur = null
for (let i = 0; i < lines.length; i++) {
  const m = lines[i].match(bannerRe)
  if (m) {
    if (cur) { cur.end = i - 1; chunks.push(cur) }
    else preamble = lines.slice(0, i)
    cur = { title: m[1], start: i, end: lines.length - 1 }
  }
}
if (cur) { cur.end = lines.length - 1; chunks.push(cur) }
for (const c of chunks) c.text = lines.slice(c.start, c.end + 1).join('\n').replace(/\s+$/, '')

// 校验：每个 section 都必须有归属，否则报错退出（防静默漏搬）
const unmapped = chunks.filter(c => !SECTION_TO_FILE[c.title])
if (unmapped.length) {
  console.error('✗ 有 section 未映射到目标文件：', unmapped.map(c => c.title))
  process.exit(1)
}

// ---- 2. 归并到目标文件（保持 section 原顺序）----
const byFile = new Map()
for (const c of chunks) {
  const f = SECTION_TO_FILE[c.title]
  if (!byFile.has(f)) byFile.set(f, [])
  byFile.get(f).push(c)
}

// ---- 3. 收集每个文件导出的符号（供生成跨文件 import）----
const exportedByFile = new Map()   // file -> Set(symbol)
for (const [f, cs] of byFile) {
  const syms = new Set()
  for (const c of cs) {
    for (const m of c.text.matchAll(/^export\s+(?:declare\s+)?(?:interface|type|const|function|enum|class)\s+([A-Za-z0-9_]+)/gm)) {
      syms.add(m[1])
    }
  }
  exportedByFile.set(f, syms)
}
// 全局符号表：symbol -> 所属文件
const symToFile = new Map()
for (const [f, syms] of exportedByFile) for (const s of syms) symToFile.set(s, f)

// ---- 4. 写出各域文件 ----
if (existsSync(OUT_DIR)) rmSync(OUT_DIR, { recursive: true, force: true })
mkdirSync(OUT_DIR, { recursive: true })

const HEAD = '/**\n * ZZZ 资源池计算 · 类型定义（按域拆分自原 `src/types/resource.ts`，2026-09-11）\n *\n * 域：%DESC%\n * 消费方一律经 `@/types/resource`（barrel = ./index.ts）引用，勿深链本目录内部文件。\n */\n'
const written = []
for (const [f, cs] of byFile) {
  const own = cs.map(c => c.text).join('\n\n')
  // 本文件内**未在本文件声明**、但出现在全局符号表里的标识符 → 需要从别的域 import
  const used = new Set()
  for (const m of own.matchAll(/\b([A-Z][A-Za-z0-9_]*)\b/g)) used.add(m[1])
  const importedByFile = new Map()   // targetFile -> Set(symbol)
  for (const s of used) {
    const target = symToFile.get(s)
    if (!target || target === f) continue
    if (!importedByFile.has(target)) importedByFile.set(target, new Set())
    importedByFile.get(target).add(s)
  }
  const importLines = [...importedByFile.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([target, syms]) => `import type { ${[...syms].sort().join(', ')} } from './${target.replace(/\.ts$/, '')}'`)
  const body = [
    HEAD.replace('%DESC%', FILE_HEADER[f] ?? f),
    ...(importLines.length ? [importLines.join('\n'), ''] : []),
    own,
    '',
  ].join('\n')
  writeFileSync(join(OUT_DIR, f), body, { encoding: 'utf8' })
  written.push({ file: f, lines: body.split('\n').length, sections: cs.length, imports: importLines.length })
}

// ---- 5. barrel ----
const barrel = [
  '/**',
  ' * `@/types/resource` 的公开面（barrel）。',
  ' *',
  ' * 2026-09-11 由单文件 2566 行拆为按域多文件（评审第二梯队 #7）：并行会话的冲突面从「一个巨文件」',
  ' * 收敛到具体域；下游 85 个文件的 import 路径**零改动**（同一路径经目录 index 解析）。',
  ' *',
  ' * 新增类型请放进对应域文件，并在此 re-export（本文件保持「只 re-export、不定义」）。',
  ' */',
  ...[...byFile.keys()].sort().map(f => `export type * from './${f.replace(/\.ts$/, '')}'`),
  '',
  '// 唯一的运行时导出（类型面里夹带的一个判定函数）：值导出不能用 `export type *`，单列一行。',
  "export { isFrontlineExecution } from './execution'",
  '',
].join('\n')
writeFileSync(join(OUT_DIR, 'index.ts'), barrel, { encoding: 'utf8' })

console.log('拆分完成（预览，未删除原文件）：')
for (const w of written) console.log(`  src/types/resource/${w.file.padEnd(20)} ${String(w.lines).padStart(5)} 行 · ${w.sections} section · ${w.imports} 条跨域 import`)
console.log(`  src/types/resource/index.ts   ${String(barrel.split('\n').length).padStart(5)} 行 · barrel`)
console.log(`\n原文件 ${lines.length} 行 / ${chunks.length} section；未搬符号：${[...symToFile.keys()].length === 0 ? '无' : symToFile.size + ' 个'}`)
console.log('\n下一步：npm run typecheck（用报错驱动补齐跨域 import）→ 全绿后删除原 src/types/resource.ts')
