#!/usr/bin/env node
/**
 * beta 冻结快照 CLI：把已录入的测试服角色整体冻结成旁挂副本（`<agentId>v<n>`）。
 *
 * ⚠ 时机纪律：在**导入新一版数据 / 改写正主模块之前**跑——快照冻结的是「当前」实现与数值。
 * 跑完建议立刻 `git tag agent/<agentId>/<sourceVersion>` 把冻结时刻的整树钉住（脚本会打印建议命令）。
 *
 * 产出四件（纯函数实现见 scripts/lib/beta-snapshot.mjs 头注释）：
 *   public/static/beta-agents.json      —— catalog 切片旁挂（紧凑写；beta 开关打开才被 store 合并）
 *   src/mechanics/agents/beta/<id>v<n>.ts —— 机制模块冻结副本（glob 自动注册；spec-only 角色跳过）
 *   src/specs/agents/<id>v<n>.json      —— spec 冻结副本（beta: true；verify-recording / docs:status 豁免）
 *   （git tag 由人执行，不自动打）
 *
 * 用法：
 *   node scripts/snapshot-agent.mjs 1091 --tag v1 --source-version '3.3.2+18895034'
 *   node scripts/snapshot-agent.mjs 1091 --tag v1 --source-version '3.3.2+18895034' --dry-run
 *
 * 之后：设置 → Beta 角色 → 打开开关（刷新页面生效），v1 就以普通角色身份进所有对比/修改模块。
 */
import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  BETA_TAG_RE,
  findModuleFile,
  mergeBetaFile,
  moduleBanner,
  readJsonIfExists,
  rewriteAgentSlice,
  rewriteModuleSource,
  rewriteSpec,
  sliceCatalogFor,
} from './lib/beta-snapshot.mjs'
import { writeJsonCompact, writeJsonPretty } from './lib/jsonio.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const argOf = f => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined }
const dryRun = args.includes('--dry-run')

const positional = []
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--tag' || args[i] === '--source-version') { i++; continue }
  if (args[i] === '--dry-run') continue
  if (!args[i].startsWith('--')) positional.push(args[i])
}
const agentId = positional[0]
const tag = argOf('--tag')
const sourceVersion = argOf('--source-version') ?? 'unknown'

if (!agentId || !tag || !BETA_TAG_RE.test(tag)) {
  console.error("用法: node scripts/snapshot-agent.mjs <agentId> --tag <v\\d+> --source-version <nanoka版本> [--dry-run]")
  process.exit(2)
}

const catalog = JSON.parse(readFileSync(join(root, 'public/static/catalog.json'), 'utf8'))
const slice = sliceCatalogFor(catalog, agentId)
if (!slice) {
  console.error(`[snapshot] catalog 里没有角色 ${agentId}（先完成录入，快照冻结的是已录入实现）`)
  process.exit(2)
}
const betaId = `${agentId}${tag}`
if (catalog.agents.some(a => String(a.id) === betaId)) {
  console.error(`[snapshot] ${betaId} 与真实角色 id 冲突（真实 id 空间已排到这里）`)
  process.exit(2)
}

const gitSha = execSync('git rev-parse --short HEAD', { cwd: root }).toString().trim()
const createdAt = new Date().toISOString()
const gitTag = `agent/${agentId}/${sourceVersion}`
const meta = { agentId, betaId, tag, sourceVersion, gitTag, createdAt }
const provenanceNote = `beta 冻结副本：源 ${agentId}@${gitSha}（nanoka ${sourceVersion}，${createdAt.slice(0, 10)}）`

// 机制模块定位（排除 beta/ 自身，防止二次快照把已冻结副本当源）
const agentsDir = join(root, 'src/mechanics/agents')
const agentSources = readdirSync(agentsDir)
  .filter(f => f.endsWith('.ts'))
  .map(f => ({ path: f, content: readFileSync(join(agentsDir, f), 'utf8') }))
const moduleFiles = findModuleFile(agentSources, agentId)
if (moduleFiles.length > 1) {
  console.error(`[snapshot] ${agentId} 被多个模块声明：${moduleFiles.join(', ')} —— 快照不支持多模块角色`)
  process.exit(2)
}

const entries = rewriteAgentSlice(slice, agentId, tag, meta)
const spec = rewriteSpec(
  JSON.parse(readFileSync(join(root, `src/specs/agents/${agentId}.json`), 'utf8')),
  agentId, tag, provenanceNote,
)
const betaFilePath = join(root, 'public/static/beta-agents.json')
const betaFile = mergeBetaFile(readJsonIfExists(readFileSync, betaFilePath), entries, meta)

// —— 落盘 ——
console.log(`[snapshot] ${agentId} → ${betaId}（nanoka ${sourceVersion} @ ${gitSha}）${dryRun ? ' [dry-run]' : ''}`)
if (!dryRun) {
  writeJsonCompact(betaFilePath, betaFile)

  const specOut = join(root, `src/specs/agents/${betaId}.json`)
  writeJsonPretty(specOut, spec)

  if (moduleFiles.length === 1) {
    const sourceFile = `src/mechanics/agents/${moduleFiles[0]}`
    const rewritten = rewriteModuleSource(readFileSync(join(root, sourceFile), 'utf8'), agentId, betaId)
    if (rewritten.replacements === 0) {
      console.error(`[snapshot] ${sourceFile} 里没有 '${agentId}' 字面量——模块定位逻辑异常，拒绝落盘`)
      process.exit(2)
    }
    mkdirSync(join(agentsDir, 'beta'), { recursive: true })
    writeFileSync(
      join(agentsDir, 'beta', `${betaId}.ts`),
      moduleBanner({ sourceFile, betaId, sourceVersion, gitSha, createdAt }) + rewritten.source,
    )
    console.log(`  机制模块冻结：${sourceFile} → src/mechanics/agents/beta/${betaId}.ts（改写 ${rewritten.replacements} 处 id）`)
  } else {
    console.log('  机制模块：无 TS 模块（spec-only 角色），副本由 specs registry 兜底注册')
  }
  console.log(`  catalog 切片：agent + skills${slice.engines.length ? ` + 专武×${slice.engines.length}` : ''} → public/static/beta-agents.json`)
  console.log(`  spec 冻结：src/specs/agents/${betaId}.json`)
  console.log('\n下一步：')
  console.log(`  git tag ${gitTag}   # 把冻结时刻的整树钉住（原实现 + 引擎状态）`)
  console.log('  npm run check        # 确认注册/校验链全绿')
  console.log('  现在可以导入新一版数据覆盖正主了；对比时在 设置 → Beta 角色 打开开关')
}
