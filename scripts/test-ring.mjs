#!/usr/bin/env node
/**
 * 测试三环：**每个对话跑哪一圈**的单一事实源（T186，2026-10-18）。
 *
 * ## 为什么需要这个文件（问题不是「测试慢」，是「每对话都跑全量」）
 *
 * 实测（2026-10-18，16 核 / 空载）：
 * - 全量 `npm test` / `npm run verify`：**542~638s**、591 个文件、CPU 合计 3609s；
 * - 每个对话的收工口径（AGENTS §1 规则 1）写的是 `npm run check`，而 `check` 里挂的是 **`npm test`（全量）**
 *   ⇒ 每个对话都付全量价。`.zc/journal.jsonl` 实测 1201 条收工记录里 **735 条**用 `npm run verify`、
 *   66 条用 `npm run check`（同为全量），只有 1 条用定向 vitest。
 * - 用户裁决（2026-10-18）：「全量只需要每隔几天做一次就行了，现在属于每个对话都做」。
 *
 * ## 三环的**判据**（不是按时长拍脑袋，是按「这圈错了会不会漏」）
 *
 * | 环 | 何时跑 | 判据 | 实测 |
 * |---|---|---|---|
 * | **core** | **每个对话收工**（AGENTS §1 规则 1） | 跨切面不变量网 + 一切快文件 | ~150s |
 * | **fast** | 合并前 / 半天的活收尾 | core + 重型全库扫描/搜索（`test:fast` 既有口径） | ~335s |
 * | **full** | **每隔 2~3 天 / 合并前 / CI** | 全部（含 20s 以上的单文件重负载与数值快照） | ~542s |
 *
 * ⚠ **core ⊂ fast ⊂ full 是硬约束**（`check-guards` 的 `test:rings` 判据机器断言）。
 *
 * ## 为什么清单必须显式（`--changed` 在本仓库实测不可用）
 *
 * 同 `test:fast` 的既有结论：114/228 个测试经 `setupHarness` 走全管线、**不 import 被测源码**
 * ⇒ import 图不成立（`vitest --changed HEAD` 实测只选中 1 个文件，漏掉真正覆盖 damagePool 的
 * `timeGolden`/`allAgentsSweep`）。所以只能靠显式名单 + 棘轮守着。
 *
 * ## 用法
 *
 * ```bash
 * node scripts/test-ring.mjs core       # 核心环（每对话；npm run check 的 vitest 段）
 * node scripts/test-ring.mjs fast       # 快环（合并前）
 * node scripts/test-ring.mjs full       # 全量（= npm test，不经本脚本改语义）
 * node scripts/test-ring.mjs advise     # 按 git diff 提示「这次改动必须升到哪一环」
 * node scripts/test-ring.mjs excludes core   # 打印该环排除集（给 package.json / 棘轮读）
 * ```
 */

import { execFileSync } from 'node:child_process'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

/**
 * **核心环保留面**：哪怕它 ≥20s，也因为它是「跨切面不变量网」而必须留在每对话的环里。
 *
 * 入选判据（三条同时满足）：① 覆盖**维度**而不是某个功能点（全角色 × 命座这类矩阵）；
 * ② 它红了说明「别的地方也错了」，而不是「这个功能坏了」；③ 实测 ≤ 60s。
 *
 * ⚠ 改这张表等于改「每对话的保证强度」，必须在提交说明里写清「砍掉/新增了哪条不变量」。
 */
export const CORE_INVARIANTS = [
  {
    file: 'allAgentsSweep.test.ts',
    seconds: 31,
    why: '全角色 × 命座 0/6 的全管线不变量（时间不溢出 / moveId 有效 / 次数非负 / 伤害有限）——角色录入类改动的总网',
  },
]

/** core 的时长门槛：单文件实测 ≥ 它且不在 CORE_INVARIANTS 里 ⇒ 出 core */
export const CORE_MAX_SECONDS = 20

/**
 * **core 排除集**。每条必须带实测秒数（2026-10-18 全量 `--reporter=json` 产物）：
 * 数字是「为什么它在这」的唯一证据；秒数显著变了就该重新判一次放哪环。
 */
export const CORE_EXCLUDES = [
  { file: 'difficultyCurve.test.ts', seconds: 374, why: '全库曲线扫描（单文件内 5 条 50~58s 全库用例，串行）' },
  { file: 'difficultyLadderBurnShard2.test.ts', seconds: 244, why: '难度曲线 ② 烧吸收分片 2/4（全库 93 队）' },
  { file: 'difficultyLadderBurnShard1.test.ts', seconds: 220, why: '难度曲线 ② 烧吸收分片 1/4' },
  { file: 'truncationCountDeduction.test.ts', seconds: 194, why: '全库预设 × 4 档弹刀扫描（截断不回灌资源）' },
  { file: 'difficultyLadderBurnShard3.test.ts', seconds: 168, why: '难度曲线 ② 烧吸收分片 3/4' },
  { file: 'difficultyLadderBurnShard0.test.ts', seconds: 154, why: '难度曲线 ② 烧吸收分片 0/4' },
  { file: 'difficultyLadder.test.ts', seconds: 123, why: '难度曲线关键旋钮点（每队一次全引擎 + 逐槽阶梯）' },
  { file: 'curveWorkerPool.test.ts', seconds: 97, why: '曲线 worker 池调度（真实引擎 × 多队）' },
  { file: 'r65j1DeadBuffProbe.test.ts', seconds: 70, why: '全角色死 buff 探针' },
  { file: 'pullPlannerEngine.test.ts', seconds: 64, why: '抽卡规划器（组合搜索）' },
  { file: 'mechanicSettingsEffect.test.ts', seconds: 64, why: '滑块生效矩阵（逐 setting × 逐角色）' },
  { file: 'charIncrementInt.test.ts', seconds: 62, why: '整数增量性能判据（自带机器速度标尺，与负载耦合）' },
  { file: 'axisFallbackReportCc457.test.ts', seconds: 58, why: '全库轴回落扫描' },
  { file: 'checkGuards.test.ts', seconds: 58, why: '守卫自测（31 条判据真扫描 + 151 例）；守卫 CLI 本身已在 core 里跑' },
  { file: 'difficultyLadderBurnWitness.test.ts', seconds: 55, why: '② 烧吸收非平凡性见证（真实引擎 × 3 队 × 双 cap）' },
  { file: 'hookReplay.test.ts', seconds: 55, why: '钩子重放（多队）' },
  { file: 'zcDeadChannels.test.ts', seconds: 53, why: '死通道 CLI（TypeScript LanguageService）' },
  { file: 'guaranteeLadderPosition.test.ts', seconds: 52, why: '保底阶梯（多队 × 多档）' },
  { file: 'lateCfgWrite.test.ts', seconds: 48, why: '迟写 cfg（多队）' },
  { file: 'roxyWindEyeTiming.test.ts', seconds: 47, why: '时序扫描（多档）' },
  { file: 'deadChannelLs.test.ts', seconds: 41, why: '死通道 LS 扫描（LanguageService 每条用例起 program）' },
  { file: 'dynamicComboAlign.test.ts', seconds: 40, why: '动态合轴对齐（多队）' },
  { file: 'teamTimeline.test.ts', seconds: 39, why: '队伍时间线（组合搜索）' },
  { file: 'zc.test.ts', seconds: 39, why: 'zc CLI 端到端（起子进程）' },
  { file: 'adminRulingEffect.test.ts', seconds: 37, why: '裁决生效矩阵' },
  { file: 'truncationRefold.test.ts', seconds: 35, why: '截断重折（多队）' },
  { file: 'cinemaUplift.test.ts', seconds: 34, why: '命座提升率（全角色 × 逐命座）' },
  { file: 'comboAlignClosedForm.test.ts', seconds: 34, why: '合轴闭式解（多队）' },
  { file: 'feasibleRowsMemo.test.ts', seconds: 28, why: '物化行缓存（多队）' },
  { file: 'adjustableEffect.test.ts', seconds: 25, why: '可调项生效矩阵' },
  { file: 'claretGashTiming.test.ts', seconds: 24, why: '角色时序扫描' },
  { file: 'interactionSweep.test.ts', seconds: 23, why: '交互扫描（多档）' },
  { file: 'moveFusion.test.ts', seconds: 23, why: '招式融合（全表）' },
  { file: 'stunCountLockInvariant.test.ts', seconds: 21, why: '失衡次数锁不变量（多队）' },
  // ⚠ 下面三条是**时间账三本账**的绝对不变量，语义上最该在 core，但都 > 20s。
  // 故由 RING_ADVICE 的路径提示兜底：动了时间/账本/物化行 ⇒ 必须升到 fast 以上，别只跑 core。
  { file: 'timeGolden.test.ts', seconds: 64, why: '时间账快照权威（105 预设）——⚠ 动时间逻辑时必须跑，见 RING_ADVICE' },
  { file: 'timeFillRatchet.test.ts', seconds: 23, why: '时间填充棘轮绝对不变量——⚠ 动时间逻辑时必须跑，见 RING_ADVICE' },
  { file: 'timeLedgerInvariants.test.ts', seconds: 28, why: '账本绝对不变量——⚠ 动账本时必须跑，见 RING_ADVICE' },
]

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
    why: '四份方法文档：手册密度（判据 11）与 §4 条目预算（判据 34）的回归自测在 checkGuards.test.ts'
      + '（58s，core 排除）——只改手册也必须跑到它，否则「改手册却触发不到手册判据」'
      + '（2026-10-26~30 实测：§4 条目预算红 4 天无人见）',
  },
]

/**
 * **fast 环排除集**：只砍真正的巨兽（≥60s）。它在 core 之上把 20~60s 那批放回来。
 *
 * 判据：20~60s 那批多是「多队 × 多档」的**中等**矩阵（`guaranteeLadderPosition` /
 * `hookReplay` / `lateCfgWrite` …）——它们出错时通常是**功能点**坏了，重跑定向测试能定位，
 * 不值得每轮都跑；而 ≥60s 那批是**全库/全角色**扫描，出错即代表口径整体位移，必须单独一层。
 */
export const FAST_MAX_SECONDS = 60

/** 环名 → 该环排除集。**包含关系必须成立**：excl(core) ⊇ excl(fast) ⊇ excl(full)=∅ */
export function excludesFor(ring) {
  if (ring === 'core') return CORE_EXCLUDES.map(e => e.file)
  if (ring === 'fast') return CORE_EXCLUDES.filter(e => e.seconds >= FAST_MAX_SECONDS).map(e => e.file)
  if (ring === 'full') return []
  throw new Error('未知环：' + ring + '（合法：core / fast / full）')
}

/** 环 → 保住多少文件 / 多少 CPU 秒（判据用；数字是 2026-10-18 全量实测） */
export const RING_MEASURED = {
  core: { seconds: 104, files: 556 },
  fast: { seconds: 249, files: 577 },
  full: { seconds: 542, files: 591 },
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
  console.error('用法：node scripts/test-ring.mjs <core|fast|full|advise|excludes <ring>>')
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
