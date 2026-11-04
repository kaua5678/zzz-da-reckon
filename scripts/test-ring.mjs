#!/usr/bin/env node
/**
 * 测试三环：**每个对话跑哪一圈**的单一事实源。
 *
 * ## 这版和 T186 版的区别（2026-11-04 换尺，读数为证）
 *
 * 旧版把 `CORE_EXCLUDES` **手写死**在源码里，并用一句话当判据：「单文件 ≥ `CORE_MAX_SECONDS`(20s)
 * ⇒ 出 core」。实测它**从来没被执行过**：
 * - `grep -rn 'CORE_MAX_SECONDS'` 全仓零引用（只有定义 + 一条 `≥` 断言）；
 * - 清单自 2026-10-18 之后再没量过 ⇒ core 里挂进 12 个 ≥20s 的新文件
 *   （`interactionSurface` 曾独占 core 墙钟 99.4%），反向也有 3 条早已 <20s 却仍被排除。
 *
 * 现在 **清单 = 数据派生的结果**，`scripts/lib/test-durations.json` 是唯一输入：
 * 逐文件实测秒数 → `seconds >= CORE_MAX_SECONDS && !invariant` 的自动出 core。
 * 换尺不改代码：重跑全量拿新的 `--reporter=json` 产物 → 更新那个 JSON → 环自动跟着变。
 *
 * ## 三环的**判据**（不是按时长拍脑袋，是按「这圈错了会不会漏」）
 *
 * | 环 | 何时跑 | 判据 |
 * |---|---|---|
 * | **core** | **每个对话收工**（AGENTS §1 规则 1） | 跨切面不变量网 + 一切 <20s 的文件 |
 * | **fast** | 合并前 / 半天的活收尾 | core + 20~60s 那批（多队 × 多档的中等矩阵） |
 * | **full** | **每隔 2~3 天 / 合并前 / CI** | 全部（含 ≥60s 的全库扫描与数值快照） |
 *
 * ⚠ **core ⊂ fast ⊂ full 是硬约束**（`check-guards` 判据 32 机器断言）。
 *
 * ## 为什么仍然不是「按改动选测试」（`--changed` 在本仓库实测不可用）
 *
 * 114/228 个测试经 `setupHarness` 走全管线、**不 import 被测源码** ⇒ import 图不成立
 * （`vitest --changed HEAD` 实测只选中 1 个文件，漏掉真正覆盖 damagePool 的
 * `timeGolden`/`allAgentsSweep`）。所以只能靠「全量清单 + 分层」+ 路径规则提示升环。
 *
 * ## 用法
 *
 * ```bash
 * node scripts/test-ring.mjs core       # 核心环（每对话；npm run check 的 vitest 段）
 * node scripts/test-ring.mjs fast       # 快环（合并前）
 * node scripts/test-ring.mjs full       # 全量（= npm test，不经本脚本改语义）
 * node scripts/test-ring.mjs advise     # 按 git diff 提示「这次改动必须升到哪一环」
 * node scripts/test-ring.mjs excludes core   # 打印该环排除集（给 package.json / 棘轮读）
 * node scripts/test-ring.mjs measured   # 打印各环的实测 CPU / 文件数 / 最长文件（换尺后自检用）
 * ```
 */

import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'

export const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

/** 逐文件实测秒数的**唯一输入**（`scripts/gen-test-ring.mjs` 从全量 json 产物生成） */
const DURATIONS_FILE = join(ROOT, 'scripts', 'lib', 'test-durations.json')
const durationsDoc = JSON.parse(readFileSync(DURATIONS_FILE, 'utf8'))
/** 文件名 → 实测秒数（2026-11-04 全量 `--reporter=json` 产物） */
export const MEASURED_SECONDS = durationsDoc.entries
export const MEASURED_AT = durationsDoc.measuredAt
export const MEASURED_HEAD = durationsDoc.measuredHead

/**
 * **核心环保留面**：哪怕它 ≥`CORE_MAX_SECONDS`，也因为它是「跨切面不变量网」而必须留在每对话那圈。
 *
 * 入选判据（三条同时满足）：① 覆盖**维度**而不是某个功能点（全角色 × 命座 / 全预设 × 时间账这类矩阵）；
 * ② 它红了说明「别的地方也错了」，而不是「这个功能坏了」；③ 实测 ≤ 60s（超过就不是每对话能付的价）。
 *
 * ⚠ 改这张表等于改「每对话的保证强度」，必须在提交说明里写清「砍掉/新增了哪条不变量」。
 * ⚠ 五条都实测过「拆开后仍会红」的场景（见各自 why），不是凭直觉留的。
 */
export const CORE_INVARIANTS = [
  {
    file: 'allAgentsSweep.test.ts',
    why: '全角色 × 命座 0/3/4/5/6 的全管线不变量（时间不溢出 / moveId 有效 / 次数非负 / 伤害有限 / C6>C0）——角色录入类改动的总网',
  },
  {
    file: 'allAgentsGuards.test.ts',
    why: '全角色 × 命座 0/6 的行为级护栏（重算幂等 / 物化行快路径开或关逐位相同 / 历史无关）——引擎改动跨全角色的总网',
  },
  {
    file: 'timeGolden.test.ts',
    why: '时间账快照权威（105 预设 × 伤害/失衡/留白/逐槽账）——动时间、账本、数值的绝对判据',
  },
  {
    file: 'timeFillRatchet.test.ts',
    why: '时间填充棘轮绝对不变量——与 timeGolden 互补（保留的是「填充份额」而非最终伤害）',
  },
  {
    file: 'timeLedgerInvariants.test.ts',
    why: '账本绝对不变量（逐槽 Σ = 总账等）——前两者的前提，改了账本就必须看',
  },
]

/**
 * **core 的时长门槛**：单文件实测 ≥ 它且不在 `CORE_INVARIANTS` 里 ⇒ 出 core。
 * ⚠ 这个常量**现在真的被执行**（下面的 `CORE_EXCLUDES` 由它派生）；
 * 改它 = 改每对话的保证强度，要同步重跑 `measured` 看墙钟。
 */
export const CORE_MAX_SECONDS = 20

/** **fast 的时长门槛**：core 之上继续砍 ≥ 它的那批（20~60s 的中等矩阵留在 fast）。 */
export const FAST_MAX_SECONDS = 60

const INVARIANT_FILES = new Set(CORE_INVARIANTS.map(i => i.file))

/** 全部实测文件的文件名（派生的输入面） */
function measuredFiles() {
  return Object.keys(MEASURED_SECONDS)
}

/**
 * **core 排除集**：由实测秒数派生（`scripts/lib/test-durations.json`）。
 *
 * 为什么派生而不是手写：手写清单在 2026-10-18~11-04 之间腐坏过两次（漏进 12 个 ≥20s 的新文件、
 * 3 条该放回来的没放回来），而没有任何机器判据会红——**因为判据本身就是那份清单**。
 */
export const CORE_EXCLUDES = measuredFiles()
  .filter(f => !INVARIANT_FILES.has(f))
  .filter(f => (MEASURED_SECONDS[f] ?? 0) >= CORE_MAX_SECONDS)
  .sort((a, b) => (MEASURED_SECONDS[b] ?? 0) - (MEASURED_SECONDS[a] ?? 0))
  .map(f => ({
    file: f,
    seconds: MEASURED_SECONDS[f],
    why: '实测 ' + MEASURED_SECONDS[f] + 's ≥ 门槛 ' + CORE_MAX_SECONDS + 's（' + MEASURED_AT + ' @' + MEASURED_HEAD + '）',
  }))

/**
 * **路径 → 必须升环**（`advise` 用）。这是「少跑」与「跑得对」的分界：
 * 砍掉的全库用例不是不重要，是**只在动到它的输入时才重要**。
 */
export const RING_ADVICE = [
  {
    ring: 'full',
    match: /^src[\/](core[\/]|composables[\/](resourceCalc|useResourceCalc|convergence|damagePool|timeWeightAllocation|difficultyCurve|difficultyLadder))/,
    why: '计算路径 / 时间账 / 难度曲线：全库数值快照与全库扫描都在这一面',
  },
  {
    ring: 'full',
    match: /^(public[\/]static[\/]|src[\/]data[\/]|src[\/]specs[\/]|src[\/]mechanics[\/]agents[\/])/,
    why: '数值 / 数据 / 角色模块：全库 sweep 与 timeGolden 的输入变了',
  },
  {
    ring: 'full',
    match: /^(src[\/]scripts[\/]__tests__[\/]|scripts[\/]|src[\/]test[\/])/,
    why: '护栏 / 脚本本体：守卫自测（checkGuards.test.ts）与 zc 端到端在这一面',
  },
  {
    ring: 'fast',
    match: /^src[\/](views|components|composables[\/](charts|analysis))/,
    why: '展示层：check-tokens + UI 判据在 core，重型图表搜索在 fast',
  },
  {
    ring: 'fast',
    match: /^docs[\/](ENGINE_PIPELINE_GUIDE|AGENT_RECORDING_SOP|MECHANIC_PATTERNS|GAME_TERM_TO_CODE_FIELD)\.md$/,
    why: '四份方法文档：手册密度与 §4 条目预算的回归自测在 checkGuards.test.ts（core 排除）'
      + '——只改手册也必须跑到它，否则「改手册却触发不到手册判据」',
  },
]

/** 环名 → 该环排除集。**包含关系必须成立**：excl(core) ⊇ excl(fast) ⊇ excl(full)=∅ */
export function excludesFor(ring) {
  if (ring === 'core') return CORE_EXCLUDES.map(e => e.file)
  if (ring === 'fast') return CORE_EXCLUDES.filter(e => e.seconds >= FAST_MAX_SECONDS).map(e => e.file)
  if (ring === 'full') return []
  throw new Error('未知环：' + ring + '（合法：core / fast / full）')
}

/** 环 → 保住多少文件 / 多少 CPU 秒 / 最长文件（由实测派生，不是手抄） */
export function measureRing(ring) {
  const excl = new Set(excludesFor(ring))
  const kept = measuredFiles().filter(f => !excl.has(f))
  const seconds = kept.reduce((a, f) => a + (MEASURED_SECONDS[f] ?? 0), 0)
  let longest = { file: '', seconds: 0 }
  for (const f of kept) if ((MEASURED_SECONDS[f] ?? 0) > longest.seconds) longest = { file: f, seconds: MEASURED_SECONDS[f] }
  return { seconds, files: kept.length, longest }
}

/** 环 → 保住多少文件 / 多少 CPU 秒（判据用；派生值，随 `test-durations.json` 自动更新） */
export const RING_MEASURED = {
  core: measureRing('core'),
  fast: measureRing('fast'),
  full: measureRing('full'),
}

/** vitest 命令行参数 */
export function vitestArgsFor(ring) {
  return excludesFor(ring).map(f => '--exclude=**/' + f)
}

/** 按改动路径给出「这次该跑到哪一环」（只提示，不阻断） */
export function adviseFor(changedPaths) {
  let need = 'core'
  const hits = []
  for (const p of changedPaths) {
    for (const rule of RING_ADVICE) {
      if (!rule.match.test(p)) continue
      hits.push({ path: p, ring: rule.ring, why: rule.why })
      if (rule.ring === 'full' || (rule.ring === 'fast' && need === 'core')) need = rule.ring
    }
  }
  return { ring: need, hits }
}

function main(argv) {
  const [cmd, arg] = argv
  if (cmd === 'excludes') {
    console.log(JSON.stringify(excludesFor(arg ?? 'core'), null, 1))
    return 0
  }
  if (cmd === 'measured') {
    const fmt = r => r.files + ' 文件 / ' + r.seconds + 's CPU / 最长 ' + r.longest.seconds + 's（' + r.longest.file + '）'
    for (const ring of ['core', 'fast', 'full']) console.log(ring.padEnd(5) + ' ' + fmt(RING_MEASURED[ring]))
    console.log('（实测 ' + MEASURED_AT + ' @' + MEASURED_HEAD + '；输入 scripts/lib/test-durations.json）')
    return 0
  }
  if (cmd === 'advise') {
    const out = execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' })
    const paths = out.split('\n').filter(Boolean).map(l => l.slice(3).trim())
    const { ring, hits } = adviseFor(paths)
    console.log('建议环：' + ring + '（改了 ' + paths.length + ' 个文件）')
    for (const h of hits.slice(0, 8)) console.log('  ' + h.path + ' → 需 ' + h.ring + '：' + h.why)
    if (ring === 'core') console.log('  （没有命中升环规则 ⇒ 核心环够用）')
    return 0
  }
  if (cmd === 'core' || cmd === 'fast' || cmd === 'full') {
    const args = cmd === 'full' ? ['vitest', 'run'] : ['vitest', 'run', ...vitestArgsFor(cmd)]
    execFileSync('npx', args, { cwd: ROOT, stdio: 'inherit' })
    return 0
  }
  console.error('用法：node scripts/test-ring.mjs <core|fast|full|advise|measured|excludes <ring>>')
  return 2
}

if (process.argv[1] && process.argv[1].endsWith('test-ring.mjs')) {
  try {
    process.exitCode = main(process.argv.slice(2))
  } catch (e) {
    console.error(String(e?.message ?? e))
    process.exitCode = 1
  }
}
