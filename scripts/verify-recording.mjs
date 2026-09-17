/**
 * 角色录入完成判据（机器可检，防止"声称实现但没测试/没读档案"）
 *
 * 背景（AGENTS.md §0 + SOP §6.10）：录入角色的 AI 可能"写了代码改了 spec 就声称完成"，
 * 实际机制没进伤害池。本脚本对每个 spec status ∈ {implemented*} 的角色做三件纯文本检查：
 *
 *   ① 测试覆盖：src/mechanics/__tests__ 或 src/composables/__tests__ 有测试文件引用其 agentId。
 *      （无测试 = 声称实现但零验证 → FAIL）
 *   ② 断言存在：引用了 agentId 的测试文件里有 expect 断言。
 *      （有测试文件但只 assert 字段存在 / 空测试 → 弱信号，WARN）
 *   ③ 档案核对：docs/MECHANICS_IMPLEMENTATION.md 有该角色的档案段，且段首有「当前实现状态」行。
 *      （无状态行 = 未核对现状 → WARN，提示录入时补）
 *
 * 不检查"差分断言"形态（形态太杂会漏报），以"有测试文件 + 有 expect"作为客观完成信号。
 * 历史检查为纯文本；新录入另验 evidence contract（来源/逐条覆盖/AST 引用）。
 * 静态追踪不等于语义正确或测试通过；接入 `npm run verify` 的实际 Vitest 仍是必要条件。
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { loadPacket, validateRecording, repositoryReader } from './lib/recording.mjs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const specDir = join(root, 'src', 'specs', 'agents')
const mechDocPath = join(root, 'docs', 'MECHANICS_IMPLEMENTATION.md')

const implementedStatuses = new Set([
  'implemented',
  'implemented_approximation',
  'implemented_generic_skill_level',
  'implemented_expected_value',
  'implemented_state_machine',
])

// 收集测试文件内容（一次读入）
const testDirs = [
  join(root, 'src', 'mechanics', '__tests__'),
  join(root, 'src', 'composables', '__tests__'),
]
const testFiles = []
for (const dir of testDirs) {
  try {
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.test.ts')) continue
      const p = join(dir, f)
      testFiles.push({ name: f, path: p, text: readFileSync(p, 'utf8') })
    }
  } catch {
    /* dir 不存在则跳过 */
  }
}

const mechDoc = readFileSync(mechDocPath, 'utf8')

function hasTest(agentId) {
  const refs = testFiles.filter(t => t.text.includes(`'${agentId}'`) || t.text.includes(`"${agentId}"`))
  return refs
}

let failed = 0
let warned = 0
let checked = 0

const specs = readdirSync(specDir).filter(f => f.endsWith('.json'))
for (const file of specs) {
  const spec = JSON.parse(readFileSync(join(specDir, file), 'utf8'))
  if (!implementedStatuses.has(spec.status)) continue
  const agentId = spec.agentIds[0]
  const label = `${agentId} ${spec.name}`

  // ① 测试覆盖
  const refs = hasTest(agentId)
  checked++
  if (refs.length === 0) {
    failed++
    console.log(`  FAIL ${label}: 声称 implemented 但无测试文件引用 agentId`)
    continue
  }

  // ② 断言存在
  const hasExpect = refs.some(t => t.text.includes('expect('))
  checked++
  if (!hasExpect) {
    warned++
    console.log(`  WARN ${label}: 有测试文件但无 expect 断言（${refs.map(t => t.name).join(', ')}）`)
  }

  // ③ 档案状态行
  checked++
  const sectionMatch = mechDoc.includes(`（${agentId}）`) || mechDoc.includes(`/${agentId}`) || mechDoc.includes(agentId)
  if (!sectionMatch) {
    warned++
    console.log(`  WARN ${label}: MECHANICS_IMPLEMENTATION.md 无该角色档案段`)
  } else {
    // 段首状态行粗查：agentId 出现后 400 字符内有「当前实现状态」
    const idx = mechDoc.indexOf(agentId)
    const near = idx >= 0 ? mechDoc.slice(idx, idx + 800) : ''
    if (!near.includes('当前实现状态')) {
      warned++
      console.log(`  WARN ${label}: 档案段无「当前实现状态」行（未核对现状，录入时补）`)
    }
  }
}

// Evidence contracts are mandatory for new implemented agents. Historical exemptions
// are explicit, printed, and removed when migrated; existing legacy checks still apply.
const recordingDir = join(root, 'data', 'recordings')
const legacy = JSON.parse(readFileSync(join(recordingDir, 'legacy.json'), 'utf8')).agentIds
const contracts = readdirSync(recordingDir).filter(f => /^\d{4}\.json$/.test(f))
for (const file of contracts) {
  checked++
  const id = file.slice(0, 4)
  try {
    const doc = JSON.parse(readFileSync(join(recordingDir, file), 'utf8'))
    const errors = validateRecording(doc, loadPacket(root, id), { stage: 'complete', readText: repositoryReader(root) })
    if (errors.length) throw new Error(errors.join('\n    '))
    if (legacy.includes(id)) throw new Error('契约已完成，请移除 legacy 豁免')
  } catch (e) { failed++; console.log(`  FAIL ${id} recording contract: ${e.message}`) }
}
for (const file of specs) {
  const spec = JSON.parse(readFileSync(join(specDir, file), 'utf8'))
  const id = spec.agentIds?.[0]
  if (implementedStatuses.has(spec.status) && !legacy.includes(id) && !existsSync(join(recordingDir, `${id}.json`))) {
    failed++; console.log(`  FAIL ${id}: 新录入缺 data/recordings/${id}.json 原文契约`)
  }
}
console.log(`  Evidence contracts: ${contracts.length}; legacy unreviewed: ${legacy.length}（不代表已通过逐条语义验收）`)

console.log(
  failed === 0
    ? `\n${checked} recording checks passed${warned > 0 ? `（${warned} warn）` : ''}`
    : `\n${failed} recording check(s) failed, ${warned} warn`
)
process.exit(failed === 0 ? 0 : 1)
