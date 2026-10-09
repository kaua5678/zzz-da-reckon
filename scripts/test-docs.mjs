/**
 * docs-only 收尾快路（T114，2026-10-09）。
 *
 * 用途：一次提交**只改 `docs/**`** 时，用「读 docs 的测试」显式清单代替全量 vitest。
 * 判据与清单的单一来源 = `scripts/lib/docs-reading-tests.mjs`（规则 11：不在 package.json 里
 * 复抄 34 条路径——复抄必然漂移）。
 *
 * 用法：
 *     node scripts/test-docs.mjs            # 先判 docs-only，不是就拒绝并退出 2
 *     node scripts/test-docs.mjs --force    # 跳过 docs-only 判定（人工确认「这批只动 docs」）
 *
 * ⚠ 三条红线（与 `test:fast` 同规矩，棘轮在 `src/scripts/__tests__/checkGuards.test.ts`）：
 *   ① 本脚本**不得**被 `check` / `verify` 引用（快路只能是可选的收尾提速，不许变成验收面）；
 *   ② 清单不许静默放宽——棘轮①要求它与派生集逐字相等；
 *   ③ 它不是验收：`npm run verify` 仍是交付口径，本脚本只在**文档批次**里替代那一次全量 vitest。
 *
 * T114 实测（隔离 worktree @ 0b81c1df，4 worker）：
 *   docs-only 改动（§4 +1 行）⇒ 全量 535 文件 248.2s = 1 failed；本快路 34 文件 39.3s = **同一处** failed
 *   ⇒ 失败集逐条相同，省 208.9s。
 *   ⚠ 反例：`vitest --changed HEAD` 对同一改动选中 **0** 个文件（静默漏测），故本脚本不用 `--changed`。
 */
import { execFileSync } from 'node:child_process'
import { DOCS_READING_TESTS, isDocsOnlyChange } from './lib/docs-reading-tests.mjs'

const force = process.argv.includes('--force')
if (!force) {
  let changed = ''
  try {
    changed = execFileSync('git', ['diff', '--name-only', 'HEAD'], { encoding: 'utf8' })
  } catch (e) {
    console.error('test-docs: 取 `git diff --name-only HEAD` 失败（非 git 工作区？）：', e.message)
    process.exit(2)
  }
  if (!isDocsOnlyChange(changed)) {
    const files = changed.split('\n').map(s => s.trim()).filter(Boolean)
    console.error(
      `test-docs: 拒绝——本批改动不是 docs-only（共 ${files.length} 个文件，非 docs/ 前缀的有：\n`
      + files.filter(f => !f.startsWith('docs/')).map(f => `  ${f}`).join('\n')
      + '\n）。这条快路只对**纯文档批次**成立；代码批次请跑全量 `npm test` / `npm run verify`。'
      + '\n（确认「这批确实只动文档」时用 `node scripts/test-docs.mjs --force`。）',
    )
    process.exit(2)
  }
  console.error(`test-docs: docs-only 确认（${changed.split('\n').filter(Boolean).length} 个 docs/ 文件）⇒ 跑「读 docs 的测试」清单 ${DOCS_READING_TESTS.length} 条`)
}
let rc = 0
try {
  execFileSync('npx', ['vitest', 'run', ...DOCS_READING_TESTS], { stdio: 'inherit' })
} catch (e) {
  // vitest 非零退出：把它的退出码原样透出（默认 `status`；信号死亡按 1 处理），
  // ⚠ 不要把 Node 的堆栈打出来——那会把真正的失败信息淹掉（T114 实测踩到）。
  rc = typeof e.status === 'number' ? e.status : 1
  if (rc === 0) rc = 1
}
process.exit(rc)
