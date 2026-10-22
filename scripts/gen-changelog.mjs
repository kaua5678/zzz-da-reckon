/**
 * 生成 `public/static/changelog.json`（更新日志弹层的数据源）。
 *
 * 用法：
 *   node scripts/gen-changelog.mjs            # 写文件
 *   node scripts/gen-changelog.mjs --check    # 校验产物完整性（CI 用）
 *
 * 为什么是生成物而不是手写 JSON：日志的唯一事实源就是 git 历史本身。手写一份必然漂移
 * （改了代码忘了补日志），而漂移的日志比没有日志更坏 —— 它给出错误的「最新状态」。
 * 因此本仓库沿 `implementation-status.md` 的既有做法：**生成 + CI 检查**。
 *
 * ⚠ **`--check` 校验的是「完整性」，不是「逐字等于刚生成的产物」**（有意，别改回逐字比对）：
 *   `changelog.json` 是**随代码一起提交**的文件，而一次提交会同时改动源码与产物 ⇒
 *   产物内容永远落后它自己所在的那次提交一代（它不含「本提交」）。逐字比对要求把产物
 *   重新生成**再提交一次**，于是每次提交后 CI 必然红（实测推演），逼出「CI 常红 → 全哑」。
 *   改成：把产物与当前 git 历史逐条对账，要求
 *     ① 产物里的每条 (hash) 都在 git 历史里，且内容逐字段相同（防手改产物 / 解析口径变了没重生成）
 *     ② 落后不超过 `TOLERANCE` 条（防「很久没重生成」——那正是漂移）
 *   于是同一提交里源码 + 产物一起进来时是绿的，而**忘了重生成**与**手工改了产物**都会红。
 *
 * 口径（解析细节见 `scripts/lib/changelog.mjs` 头注释）：
 *   · `--no-merges`：合并提交的标题是分支名/任务号，对读日志的人没有信息量
 *   · 保留全部提交（含 `docs` 与任务编号标题），分类交给 `kind`，UI 侧可筛选/折叠
 *   · 只按**作者日期**（`%ad --date=short`）分组：rebase / cherry-pick 会让 committer
 *     日期跳到今天，一批老提交会整批堆到最新一天（实测 100 条 at≠ct）
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { auditChangelog, buildChangelog, splitRecords, toEntry, GIT_LOG_FORMAT } from './lib/changelog.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(root, 'public', 'static', 'changelog.json')
const checkOnly = process.argv.includes('--check')

/**
 * 允许产物落后于 git 的条数。
 *
 * 为什么不是 0：产物与源码在**同一次提交**里进来 ⇒ 它天然不含「本提交」自己（见头注释）。
 * 留 5 条余量给「同一提交里合了几笔」与合并提交的边界情况；真正要拦的是「几轮没重生成」
 * （那会落后几十上百条），这个阈值足够区分两者。
 */
const TOLERANCE = 5

/** 读 git 历史（`--no-merges`：合并提交不进日志）。 */
function readGitLog() {
  const stdout = execFileSync(
    'git',
    ['log', '--no-merges', `--pretty=format:${GIT_LOG_FORMAT}`, '--date=short'],
    { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 },
  )
  return splitRecords(stdout).map(toEntry)
}

function headHash() {
  return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
}

const entries = readGitLog()
const data = buildChangelog(entries, { generatedFrom: 'git log --no-merges', head: headHash() })
// 紧凑写（规则 14：public/static/*.json 紧凑产物，validate:data 会校验）
const text = JSON.stringify(data)

if (checkOnly) {
  if (!existsSync(OUT)) {
    console.error(`✗ public/static/changelog.json 不存在 → 跑 node scripts/gen-changelog.mjs`)
    process.exit(1)
  }
  const prev = JSON.parse(readFileSync(OUT, 'utf8'))
  const { problems, missing, actualCount, stale } = auditChangelog(prev, entries, { tolerance: TOLERANCE })
  if (problems.length > 0) {
    console.error(`✗ public/static/changelog.json 校验失败（完整性）：`)
    for (const p of problems.slice(0, 20)) console.error(`  · ${p}`)
    if (problems.length > 20) console.error(`  … 另有 ${problems.length - 20} 条`)
    process.exit(1)
  }
  // 新鲜度：**只警告不失败**（口径与理由见 lib/changelog.mjs#auditChangelog）——
  // 线上日志由部署 workflow 用全历史重新生成，仓库里这份落后不代表线上落后；
  // 但仓库里那份仍是「改了要记得提交」的对象，所以喊一声。
  if (stale) {
    console.warn(`⚠ public/static/changelog.json 落后 git ${missing} 条（> ${TOLERANCE}）→ 建议跑 node scripts/gen-changelog.mjs；不影响部署产物（部署时按全历史重新生成）`)
  }
  console.log(`ok changelog 完整（产物 ${actualCount} 条 / git ${entries.length} 条，落后 ${missing} 条` + (stale ? '，已警告' : ` ≤ ${TOLERANCE}`) + ')')
  process.exit(0)
}

writeFileSync(OUT, text)
const bytes = Buffer.byteLength(text)
console.log(`✓ public/static/changelog.json 已生成：${entries.length} 条 / ${data.days.length} 天 / ${(bytes / 1024).toFixed(0)} KB`)
for (const k of data.kinds) console.log(`    ${k.label.padEnd(5)} ${String(k.count).padStart(4)}  (${k.id})`)
