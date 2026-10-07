#!/usr/bin/env node
// 机器护栏：AGENTS.md 里仍靠纯文字守着的规则 → 会大声失败的判据（挂在 check/verify 链首端）。
//
// 为什么存在：本仓库已验证的经验是「让 agent 守规矩的从来不是措辞，是会红的 CI」——
// AGENTS.md 每条硬规则的历史防线（validate:specs / allAgentsSweep / resolve exit 1 / 拆 CI job）
// 全是事故后加的机器判据，加完没有复发。本文件补齐最后几条纯文字规则：
//   1. fetch-stub 冻结   —— AGENTS §3「新测试一律用 src/test/harness.ts，禁止复制 fetch stub」
//   2. agentId 分支棘轮  —— 规则 6「队伍级机制走 applyTeamConfig，禁止往 useResourceCalc 加分支」
//   3. 工作区状态防误提交 —— 规则 13「task-ledger/ledgers 是工作状态不是项目知识」
//   7. 展示层越层棘轮    —— ARCHITECTURE §0「依赖方向：展示 → 编排 → 引擎」
//      （views/components 禁 import @/core|@/mechanics|@/specs；存量冻结只减不增）
//  19. 录入层→编排层值倒置 —— ARCHITECTURE §0「录入层被编排/引擎经 registry 消费」
//      （mechanics/specs 禁值导入 @/composables，import type 豁免；行为面 + claret 形状锁成对，
//       实现面 scripts/lib/layer-inversion.mjs）
//  20. 队友 Buff 控件守卫 —— 规则 16/§2「声明了但拨了没反应」的控件面
//      （实现面 scripts/lib/teammate-buff-controls.mjs；.vue 模板不参与单测 ⇒ 必须有独立判据）
//  21. JSON 重复键静默覆盖 —— 规则 14「生成产物与数据文件的结构不变量」
//      （同一对象内同名键 ⇒ JSON.parse 后者覆盖前者、前一份值静默消失；2026-09-22 事故 =
//       1091.json 重复 teamBuffs 键让「雅 C1 全队积蓄 +20%」失效而全链全绿，
//       实现面 scripts/lib/json-dup-keys.mjs）
//
// 用法：node scripts/check-guards.mjs（npm run check / npm run verify 已挂载）
// 逃生口（都要求显式改本文件，让「例外」在 diff 里留痕）：
//   - fetch-stub：测试迁移到 setupHarness 后，从 FETCH_STUB_ALLOWLIST 删掉对应行（清单与
//     现状做集合相等校验，漏删即红，防清单变死数据）
//   - agentId 棘轮：基线只减不增。下调（进步）需在提交说明写明；上调没有合法路径——
//     角色特例逻辑属于 src/mechanics/agents/<id>.ts 的 applyTeamConfig（派发器在
//     composables/resourceCalc/panelPhases.ts，见规则 6 / ARCHITECTURE §3）
import { execSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
// 语言层（事实语法/锚点解析）的单一实现在 zc.mjs，护栏只调用不复制（规则 11）
import { auditAuthoredFacts, resolveAnchor, scanAuthoredFacts } from './zc.mjs'
// level60 字段映射规则表（审计/修复/导入脚本三方共用，规则 11）
import { FIELD_RULES } from './lib/level60-rules.mjs'
import {
  reconcileMoveElements,
  moveElementReconcileOk,
  formatMoveElementReconcile,
} from './lib/move-element-reconcile.mjs'
import { scanScopedStyleReach } from './lib/scoped-style-reach.mjs'
import { scanCompactedSlotIndex, IDX_SAFE_ALLOWLIST } from './lib/compacted-slot-index.mjs'
// 判据 19：录入层 → 编排层值倒置（2026-09-19 round 37，见 scripts/lib/layer-inversion.mjs 头注释）
import {
  scanLayerInversion,
  layerInversionOk,
  formatLayerInversion,
  LAYER_INVERSION_MIN_TOTAL_SITES,
} from './lib/layer-inversion.mjs'
// 判据 20：队友 Buff 控件守卫（2026-09-20 R65-J1，见 scripts/lib/teammate-buff-controls.mjs 头注释）
import {
  scanTeammateBuffControls,
  TEAMMATE_BUFF_VIEW,
  REGION_START,
  REGION_END,
} from './lib/teammate-buff-controls.mjs'
// 角色身份判定检测面（AST 单源；2026-09-17 round 19 换尺批，见 scripts/lib/agent-identity-lines.mjs 头注释）
import { countIdentityBranchLines, countIdentityBranchLinesInFiles } from './lib/agent-identity-lines.mjs'
// 判据 21：JSON 重复键静默覆盖（2026-09-22 无人值守班次，见 scripts/lib/json-dup-keys.mjs 头注释）
import { scanJsonDupKeys, formatJsonDupKeys } from './lib/json-dup-keys.mjs'
// CC-85：登记数据表（棘轮 burn-down / 技术债 / 口径触发器豁免）独立成数据文件；判据逻辑留在本文件。
// 改基线、登记债务、登记豁免 ⇒ 改 scripts/lib/guard-registries.mjs。
import { RATCHET_BURNDOWN, DEBT_REGISTRY, CALIBER_TRIGGER_ALLOWLIST, RECORD_KEY_DEAD_READ_ALLOWLIST } from './lib/guard-registries.mjs'
// 判据 25：无类型记录字符串键死读（CC-91，2026-09-27，见 scripts/lib/record-key-dead-reads.mjs 头注释）
import { scanRecordKeyDeadReads, formatRecordKeyDeadReads } from './lib/record-key-dead-reads.mjs'
// 判据 26：角色 / 招式 id 字面量只许在 id 的家（data / mechanics/agents / specs）（CC-449 展示层 → CC-450 全 src，2026-10-04，见 scripts/lib/id-literal-gate.mjs 头注释）
import { scanIdLiterals, formatIdLiterals, ID_LITERAL_BASELINE, ID_HOME_DIRS } from './lib/id-literal-gate.mjs'
export { RATCHET_BURNDOWN, DEBT_REGISTRY, CALIBER_TRIGGER_ALLOWLIST, RECORD_KEY_DEAD_READ_ALLOWLIST }

export const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

// ---- 判据 1：fetch-stub 冻结 ----

/** 直接操纵全局 fetch 的写法（合法路径只有 src/test/harness.ts 一处） */
export const FETCH_STUB_PATTERNS = [
  /\(\s*global\s+as\s+any\s*\)\s*\.\s*fetch\s*=/,
  /\bglobal\s*\.\s*fetch\s*=/,
  /\bglobalThis\s*\.\s*fetch\s*=/,
  /\bvi\s*\.\s*stubGlobal\s*\(\s*['"]fetch['"]/,
]

export function detectFetchStub(content) {
  return FETCH_STUB_PATTERNS.some(re => re.test(content))
}

/**
 * 护栏系统自身文件，不参与扫描：harness.ts 是唯一合法的 fetch stub 实现；
 * checkGuards.test.ts 的 detector fixture 必然包含被禁写法的字面量（自指豁免，非债务）。
 */
export const GUARD_SYSTEM_FILES = [
  'src/test/harness.ts',
  'src/scripts/__tests__/checkGuards.test.ts',
]

/**
 * 存量债务清单：2026-08-30 冻结时的 39 个自带 fetch stub 的测试（全仓库唯一形态是
 * `vi.stubGlobal('fetch'`）。新测试用 setupHarness；存量测试迁移一个删一行。
 */
export const FETCH_STUB_ALLOWLIST = [
]

function walkTestFiles(root) {
  const out = []
  const srcDir = join(root, 'src')
  const rec = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) rec(p)
      else if (name.endsWith('.test.ts')) out.push(relative(root, p).split('\\').join('/'))
    }
  }
  rec(srcDir)
  return out.sort()
}

/** files: [{ path, content }]（path 为仓库相对 posix 路径）→ 违规 path 列表 */
export function fetchStubViolations(files) {
  return files
    .filter(f => !GUARD_SYSTEM_FILES.includes(f.path) && detectFetchStub(f.content))
    .map(f => f.path)
}

export function scanFetchStubs(root = ROOT) {
  const files = walkTestFiles(root).map(path => ({ path, content: readFileSync(join(root, path), 'utf8') }))
  const violations = fetchStubViolations(files)
  const allowed = new Set(FETCH_STUB_ALLOWLIST)
  const stale = FETCH_STUB_ALLOWLIST.filter(p => !violations.includes(p))
  return { violations, stale }
}

// ---- 判据 11：棘轮 burn-down 契约（防「冻结 = 永久化」） ----
//
// 为什么需要：棘轮（agentId 53 / 展示层 23 / check-tokens 各基线）解决了「不许变差」，
// 但**没有解决「什么时候变好」**——实测 `AGENT_BRANCH_BASELINE = 53` 自 2026-08-30 冻结后
// 在 git 历史里**从未被下调过**（`git log -S` 只有 + 没有 -）。护栏因此变成一份「永久的豁免书」：
// 新 agent 看到 53/53 全绿，会读成「这是可接受的状态」而不是「这是待还的债」。
//
// 本判据是**只报不红**的到期提醒（对齐 debt: registry 的 philosophy，但更软）：
// 每条棘轮登记 { current, plan, due }；`zc status` 把「到期/超期/无进展」的棘轮点名。
// 不设红线的理由：红了会逼人**改日期作弊**或**灌水凑数**，反而毁掉测量——
// 与 timeGolden 基线「是测量工具不是开发否决权」（规则 10 用户裁决）同一条哲学。
//
// 到期语义：due 是「承诺下调到 target 的日期」，不是「必须清零」。
// 到期日之后若 current 仍 == frozen 值（零进展），进 stale 列表被点名。

// RATCHET_BURNDOWN（棘轮 burn-down 登记表） 已移至 scripts/lib/guard-registries.mjs（CC-85 2026-09-27，census §5.91），由本文件顶部 import 并原样转出。

/**
 * 计算每条棘轮的 burn-down 状态。
 * `measure(id)` 由调用方注入（避免本文件硬依赖各判据的测量实现）。
 * 返回 [{ ...entry, current, progress, stale, overdue }]
 * - progress = frozen - current（>0 表示已还款）
 * - stale = 已过 due 且零进展（点名；这是本判据存在的唯一理由）
 * - overdue = 已过 due 但还没做完（有进展或已清零 → 提示剩余/收尾，不算 stale）
 *
 * ⚠ 2026-09-12 修一处被 frozen>0 长期掩盖的判据缺陷：原式 `stale: overdue && progress <= 0`
 * 在**已清零**时误报——frozen=0 且 current=0 ⇒ progress=0 ⇒ 判 stale，而同一行 `done` 却是 true
 * （0 ≤ target）。此前所有棘轮 frozen 都 >0，`progress<=0` 恰与「零进展」等价，故从未暴露；
 * agentId 棘轮 8→0 后立刻连红三条（未到期/有进展/清零三个用例），属**判据自身**的错。
 * 修正：先排除已完成（done），再用 progress<=0 判零进展。
 */
export function computeBurndown(measure, today = new Date().toISOString().slice(0, 10)) {
  return RATCHET_BURNDOWN.map(e => {
    const current = measure(e.id)
    const progress = e.frozen - current
    const overdue = today > e.due
    const done = current <= e.target
    return {
      ...e,
      current,
      progress,
      remaining: Math.max(0, current - e.target),
      overdue,
      stale: overdue && !done && progress <= 0,
      done,
      dueSoon: !overdue && daysBetween(today, e.due) <= 30,
    }
  })
}

/** 两个 ISO 日期之间的天数（b - a） */
export function daysBetween(a, b) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000)
}

// ---- 判据 9：README 文档表 == docs/ 实际文件（防文档清单漂移） ----
//
// 为什么需要：2026-09-11 评审实测 README §6 自述「共 11 份」、表格末尾又写「以本表为准（10 份）」，
// 而 docs/ 实有 13 份（DATA_FETCHING.md 与 multiplier-record.md 不在"唯一权威表"里）。
// CI 只检查 `implementation-status.md` 的漂移，**这类清单漂移完全不可见**——而 README §6 正是
// agent 找文档的入口（AGENTS §0「该改哪先查导航文档」）：表里没有的文档 = 事实上不存在。
//
// 口径：README §6 表格里出现的 `docs/**.md` 集合必须与 `docs/` 下实际 .md **双向相等**；
// 且节标题里的份数自述必须等于实际值（防"加了文档忘了改数字"）。红：漏登记或份数不符。
//
// ⚠ 递归口径（2026-10-06）：原实现只扫 `docs/*.md` 顶层，于是 `docs/proposals/pull-value-optimization.md`
// （17KB，抽卡价值口径）**完全不在判据视野内**——正是本条要防的"表里没有的文档 = agent 找不到"，
// 只是深了一层。子目录天然被 glob 漏掉，所以扫描必须递归，登记路径按 `docs/<相对路径>` 写。

// ⚠ 多自述口径（2026-10-06）：原实现只取**第一个** `（N 份）`（= 节标题）。而 2026-09-11 那次事故
// 的形态恰是「标题说 11 份 + 表尾说 10 份」——只要标题碰巧等于实际值，表尾写错就**永远看不见**
// （实测：标题 80 / 表尾 79 / 实际 80 ⇒ countMismatch 为假）。§6 里每一处份数自述都必须等于实际值。

/** 从 README 的 §6 段落抽出被登记的文档路径（相对 docs/，含子目录）与全部份数自述 */
export function parseDocTable(readmeText) {
  const start = readmeText.indexOf('## 6.')
  if (start < 0) return { files: [], declaredCount: null, declaredCounts: [] }
  const rest = readmeText.slice(start)
  const end = rest.indexOf('\n## ', 1)                 // 下一个二级标题
  const section = end > 0 ? rest.slice(0, end) : rest
  const files = [...section.matchAll(/`docs\/([A-Za-z0-9_./-]+\.md)`/g)].map(m => m[1])
  // 收集**所有**份数自述（标题 + 表尾 + 任何别处），逐个与实际值对账
  const declaredCounts = [...section.matchAll(/（(\d+) 份/g)].map(m => Number(m[1]))
  return {
    files: [...new Set(files)].sort(),
    declaredCount: declaredCounts.length > 0 ? declaredCounts[0] : null,   // 标题（向后兼容）
    declaredCounts,
  }
}

/**
 * 递归扫 docs/ 下实际 .md 文件（返回相对 docs/ 的路径，POSIX 分隔符，排序）。
 * 用 `withFileTypes` 判定类型：符号链接既非 isDirectory 也非 isFile ⇒ 天然不跟随（不递归进链接）。
 */
export function listDocs(root = ROOT) {
  const dir = join(root, 'docs')
  if (!existsSync(dir)) return []
  const out = []
  const walk = (abs, rel) => {
    for (const ent of readdirSync(abs, { withFileTypes: true })) {
      const childRel = rel ? `${rel}/${ent.name}` : ent.name
      if (ent.isDirectory()) walk(join(abs, ent.name), childRel)
      else if (ent.isFile() && ent.name.endsWith('.md')) out.push(childRel)
    }
  }
  walk(dir, '')
  return out.sort()
}

/** 返回 { missing, extra, declaredCount, declaredCounts, actualCount, countMismatch, staleCounts } */
export function auditDocTable(root = ROOT) {
  const readmePath = join(root, 'README.md')
  if (!existsSync(readmePath)) return null
  const { files, declaredCount, declaredCounts } = parseDocTable(readFileSync(readmePath, 'utf8'))
  const actual = listDocs(root)
  const declared = new Set(files)
  // 每一处份数自述都必须等于实际值（标题碰巧对、表尾写错 = 2026-09-11 事故形态）
  const staleCounts = (declaredCounts ?? []).filter(n => n !== actual.length)
  return {
    missing: actual.filter(f => !declared.has(f)),      // 实际有、表里没登记
    extra: files.filter(f => !actual.includes(f)),      // 表里登记、实际不存在（断链）
    declaredCount,
    declaredCounts: declaredCounts ?? [],
    staleCounts,
    actualCount: actual.length,
    countMismatch: declaredCount !== null && declaredCount !== actual.length,
  }
}

// ---- 判据 10：catalog ↔ raw 对账（防「漏加突破加成」这类全库静默数据错误） ----

/**
 * 为什么要有这条（2026-09-12 事故，见 ENGINE_PIPELINE_GUIDE §4 坑 40）：
 * 导入脚本写「base + 突破加成」类字段时只取了 base → 20 个角色的 level60 暴击被落成了
 * 全库通用裸基值 5/50。因为**大家都一样**，肉眼完全看不出来，也不会让任何测试变红
 * （`core/panel#calcBasePanel` 直接读、别处无补偿通道）——是典型的「静默」错误。
 *
 * **只红「可修且零容差」的字段**：规则表里 `patchable: false`（如 atkBase 对照组）或带容差的
 * 条目不进本判据——它们可能长期存在历史噪声或需人工确认，挂红会逼人去改不该改的东西
 * （进而为了变绿而乱改口径）。这类差异靠人工跑 `node scripts/audit-catalog-level60.mjs` 看全量报告。
 *
 * 单一事实源：规则表在 `scripts/lib/level60-rules.mjs`（与审计/修复脚本共用，规则 11）。
 */
export function auditCatalogLevel60(root = ROOT) {
  const catalogPath = join(root, 'public/static/catalog.json')
  const rawDir = join(root, 'data/raw/nanoka_missing/full')
  if (!existsSync(catalogPath) || !existsSync(rawDir)) return null
  let catalog
  try { catalog = JSON.parse(readFileSync(catalogPath, 'utf8')) } catch { return null }

  const agentsById = new Map((catalog.agents ?? []).map((a) => [String(a.id), a]))
  const rules = FIELD_RULES.filter((r) => r.patchable !== false && !r.tolerance)
  const violations = []
  let compared = 0

  for (const file of readdirSync(rawDir).filter((f) => /^\d+\.json$/.test(f)).sort()) {
    const id = file.replace('.json', '')
    const agent = agentsById.get(id)
    if (!agent) continue
    let raw
    try { raw = JSON.parse(readFileSync(join(rawDir, file), 'utf8')) } catch { continue }
    for (const rule of rules) {
      const want = rule.expected(raw)
      if (want === undefined) continue
      compared++
      const got = agent.level60?.[rule.field]
      if (Math.abs(Number(got ?? 0) - Number(want)) > 1e-9) {
        violations.push({ id, name: agent.name?.zhCN ?? '', field: rule.field, got, want })
      }
    }
  }
  return { compared, violations, fieldNames: rules.map((r) => r.field) }
}


// ---- 判据 18：招式伤害属性 ↔ nanoka raw 散文对账（R23-N1 / R26-J1：防招式伤害属性静默改回/退化） ----

/** 判据 18 对账执行器（薄包装，核心逻辑见 lib/move-element-reconcile.mjs） */
export function auditMoveElementsAgainstRaw(root = ROOT) {
  const catalogPath = join(root, 'public/static/catalog.json')
  const fullDir = join(root, 'data/raw/nanoka_missing/full')
  if (!existsSync(catalogPath) || !existsSync(fullDir)) return null
  let catalog
  try { catalog = JSON.parse(readFileSync(catalogPath, 'utf8')) } catch { return null }
  return reconcileMoveElements({ catalog, fullDir, enforceFloors: true })
}

// ---- 反空洞下限（判据 6 / 10 / 18）：区分「真干净」与「仪器坏了」 ----
//
// 三条判据原先都把「扫描面塌了」读成绿：目录缺失 ⇒ report null ⇒ ok:true 跳过；规则表被过滤空
// ⇒ compared/violations 都是 0 ⇒ 零违规绿。读数与真干净一模一样 = 假绿口子。
// 下面的下限 + rawSourceMissingVerdict 把「扫不到」与「修好了」分开。

/**
 * 反空洞下限（判据 10）：`auditCatalogLevel60` 的 compared 低于此数 ⇒ 零违规不可采信。
 * 2026-09-24 实测 = 62 角色 × 6 字段 = 372（含 critRate/critDmg/anomalyProficiency/
 * anomalyMastery/impact/energyRegen），取 350 留约 6% 给 raw 刷新时个别角色缺档；
 * 掉到 350 以下说明规则表被过滤空或 raw 文件名不再匹配，先查扫描面再改这个数。
 */
export const LEVEL60_MIN_COMPARED = 350

/**
 * 反空洞下限（判据 6）：`auditAuthoredFacts` 的 scanned 低于此数 ⇒ 零违规不可采信。
 * 2026-09-24 实测 = 143 条手写 @fact（src/scripts/docs 三语料）。取 130 留出正常增删余量；
 * 掉到 130 以下说明目录改名或 collector 写坏（扫描面塌了），不是「口径变干净了」。
 */
export const AUTHORED_FACTS_MIN_SCANNED = 130

/**
 * git 工作区内 raw 源目录缺失的判读（判据 10 / 18 的「报告 → ok」共用纯函数）。
 *
 * 方向（与 src/composables/__tests__/timeGolden.test.ts#catalogDirtyVsHead 同一口径）：
 * - root 下有 `.git`（目录 = 主工作区；**文件** = worktree 的 gitfile，两者都算）⇒ 这是 git
 *   工作区，而 `data/raw/nanoka_missing/full` 是 git 跟踪目录（64 个文件，CI 全量检出）⇒
 *   它缺失只可能是**被改名或删除** ⇒ `'red'`；
 * - 无 `.git`（zip 解包 / 打包分发，非判据场景）⇒ 降级 `'skip'`，调用方保持「跳过」绿。
 */
export function rawSourceMissingVerdict(root = ROOT) {
  return existsSync(join(root, '.git')) ? 'red' : 'skip'
}

/** 判据 10 的判定纯函数（抽出来让「合成 report → ok」可单测，不必真删 raw） */
export function level60Verdict(report, root = ROOT) {
  if (report === null) {
    if (rawSourceMissingVerdict(root) === 'red') {
      return {
        name: 'catalog/raw level60 对账 ✗ raw 目录缺失（git 工作区内 = 被改名/删除）',
        ok: false,
        detail: [
          '  ✗ data/raw/nanoka_missing/full 不存在，但 root 是 git 工作区（有 .git）',
          '  → git 跟踪目录在 git 工作区内缺失 = 被改名/删除；先 git status 查证并恢复，别用「跳过」掩盖',
        ],
      }
    }
    return { name: 'catalog/raw level60 对账 ⚠ 缺 catalog 或 raw 目录，跳过', ok: true, detail: [] }
  }
  const belowFloor = report.compared < LEVEL60_MIN_COMPARED
  return {
    name: `catalog/raw level60 对账 (${report.fieldNames.join('/')}) ${report.compared - report.violations.length}/${report.compared}`,
    ok: report.violations.length === 0 && !belowFloor,
    detail: [
      ...report.violations.slice(0, 20).map(v =>
        `  ✗ ${v.id} ${v.name} level60.${v.field}: ${v.got} → 应为 ${v.want}（漏加满级突破加成？）`),
      ...(report.violations.length > 20 ? [`  …另有 ${report.violations.length - 20} 条`] : []),
      ...(belowFloor ? [`  ✗ 反空洞下限：compared ${report.compared} < ${LEVEL60_MIN_COMPARED} → 规则表被过滤空 / raw 文件名不再匹配`] : []),
      ...(report.violations.length > 0 ? [
        `  → 修：node scripts/patch-level60-ascension.mjs --write（改完跑 npm run verify 并量 timeGolden delta）`,
        `  → 全量报告（含不进本判据的容差/对照组）：node scripts/audit-catalog-level60.mjs`,
      ] : []),
    ],
  }
}

/** 判据 18 的判定纯函数（与 level60Verdict 同构；非 null 分支口径不变 = moveElementReconcileOk） */
export function moveElementVerdict(report, root = ROOT) {
  if (report === null) {
    if (rawSourceMissingVerdict(root) === 'red') {
      return {
        name: '招式伤害属性对账 ✗ raw 目录缺失（git 工作区内 = 被改名/删除）',
        ok: false,
        detail: [
          '  ✗ data/raw/nanoka_missing/full 不存在，但 root 是 git 工作区（有 .git）',
          '  → git 跟踪目录在 git 工作区内缺失 = 被改名/删除；先 git status 查证并恢复，别用「跳过」掩盖',
        ],
      }
    }
    return { name: '招式伤害属性对账 ⚠ 缺 catalog 或 raw 目录，跳过', ok: true, detail: [] }
  }
  const ok = moveElementReconcileOk(report)
  return {
    name: `招式伤害属性对账 (move.damageElement ↔ nanoka raw 散文) ${report.scannedMoves - report.violations.length}/${report.scannedMoves} 招达标`,
    ok,
    detail: ok ? [] : formatMoveElementReconcile(report),
  }
}

/** 判据 6 的判定纯函数（scanned 反空洞下限 + 违规清单；抽出下限以便单测 129/130 边界） */
export function authoredFactsVerdict(audited) {
  const scanned = audited.scanned.length
  const belowFloor = scanned < AUTHORED_FACTS_MIN_SCANNED
  return {
    name: `@fact anchors (语言层: 手写口径必须有据 + 锚得住 + 验指得到) ${scanned - audited.violations.length}/${scanned}`,
    ok: audited.violations.length === 0 && !belowFloor,
    detail: [
      ...(belowFloor ? [`  ✗ 反空洞下限：scanned ${scanned} < ${AUTHORED_FACTS_MIN_SCANNED} → 语料扫描面塌了（目录改名 / collector 写坏）`] : []),
      ...audited.violations.map(v => {
        const how = {
          'parse-failed': '语法不合法 → node scripts/zc.mjs lang 看语法',
          'no-provenance': '缺「据」→ 补 | 据 用户@YYYY-MM-DD 或 实测@YYYY-MM-DD',
          'anchor-missing': '缺「锚」→ 补 | 锚 <路径>#<符号>（口径实现在哪）',
          'file-missing': '锚文件不存在 → 口径已过期，改锚或删事实',
          'symbol-missing': '锚符号不存在 → 实现改名/删除了，复核口径后改锚',
          'verifier-file-missing': '「验」指向的测试文件不存在 → 改成真正锁这条口径的测试（路径或文件名）',
          'verifier-case-missing': '「验」里 :: / # 后的用例名在测试文件中找不到 → 用例改名了，同步改「验」',
          'verifier-script-missing': '「验」里的 npm run 脚本不存在 → 改成现有脚本',
        }[v.problem] ?? v.problem
        return `  ✗ ${v.file}:${v.line} ${how}`
      }),
    ],
  }
}

// ---- 判据 11：手册数字 id 密度棘轮（任务卡 2026-09-12「经验手册防历史记录化」第 1 步） ----

/**
 * 度量口径（写死在这里，别处不许另算）：**全文**中 `/\b1\d{3}\b/` 命中次数 ÷ 总行数。
 * - 用「次数」不用「含 id 的行数」：编年史行的特征就是把一队 id 打包在同一行
 *   （`auto-1431-1481-1491 +39.4%`），按行数计会被打包稀释，按次数计才对症。
 * - `\b` 边界天然排除 7 位 moveId（1611028）、5 位 prop id（20101/31201）、boss id（4xxxx）。
 * - 分母是**全文行数**：往手册里加纯协议/判据文字（不含 id）会摊薄密度——这正是期望方向，
 *   案例编年史该进 git 历史与 .claude 账本，不该沉淀在手册里（AGENTS 规则 8 分层契约）。
 * 天花板 = 2026-09-12 实测向上取整留余量后冻结。`MECHANICS_IMPLEMENTATION.md` **不在列**：
 * 它是档案（逐角色口径记录，个体性=本职），任务卡实测后明确不动。
 * ⚠ **天花板是防变差的红灯面，不是还款面**（批量拆薄后的反效果实测，2026-09-12）：
 * 四栏拆薄删的是散文（分母）而判据/否决记录按规则 16③ 必须保测量数字（分子），
 * 于是密度**反升** 0.196→0.237——拿密度当还款目标会奖励灌水。还款量化在
 * burn-down 条目「手册 §4 行数」（frozen 1340 → 804（−40%）→ 719（−46%，二轮结算），还款面 = 任务卡主口径「§4 行数 −40%」）。
 *
 * @fact engine:guards/手册密度 口径: 密度 = /\b1\d{3}\b/ 次数 ÷ 行数，四份方法文档按 2026-09-12 实测冻结天花板；编年叙事只进 git/账本，手册只收协议/口径/证据；还款面 = §4 行数（密度只拦变差，拆薄后反升属口径性质） | 据 任务卡@2026-09-12（用户确认方向）·反效果实测@2026-09-12·复核@2026-09-25·复核@2026-09-27 | 验 src/scripts/__tests__/checkGuards.test.ts | 锚 scripts/check-guards.mjs#MANUAL_DENSITY_CEILINGS | 信 确认
 */
export const MANUAL_DENSITY_CEILINGS = {
  'docs/ENGINE_PIPELINE_GUIDE.md': 0.30,      // 立项实测 0.287；批量拆薄后 0.237（反升，见头注）
  'docs/AGENT_RECORDING_SOP.md': 0.05,        // 实测 0.037
  'docs/GAME_TERM_TO_CODE_FIELD.md': 0.16,    // 实测 0.147
  'docs/MECHANIC_PATTERNS.md': 0.20,          // 实测 0.187
}

/** 计算四份方法文档的数字 id 密度；文件缺失时该条 density = null（不判红，与判据 10 同风格） */
export function scanManualDensity(root = ROOT) {
  const out = {}
  for (const [rel, ceiling] of Object.entries(MANUAL_DENSITY_CEILINGS)) {
    const p = join(root, rel)
    if (!existsSync(p)) { out[rel] = { ceiling, lines: 0, hits: 0, density: null }; continue }
    const text = readFileSync(p, 'utf8')
    const lines = text.split('\n').length
    const hits = (text.match(/\b1\d{3}\b/g) ?? []).length
    out[rel] = { ceiling, lines, hits, density: Math.round((hits / lines) * 1000) / 1000 }
  }
  return out
}

/** ENGINE_PIPELINE_GUIDE §4「常见坑」区（## 4. 至 ## 5.）行数——burn-down「手册 §4 行数」的还款面度量 */
export function countGuideSection4Lines(root = ROOT) {
  const p = join(root, 'docs/ENGINE_PIPELINE_GUIDE.md')
  if (!existsSync(p)) return NaN
  const lines = readFileSync(p, 'utf8').split('\n')
  const s4 = lines.findIndex(l => l.startsWith('## 4.'))
  const s5 = lines.findIndex(l => l.startsWith('## 5.'))
  return s4 >= 0 && s5 > s4 ? s5 - s4 : NaN
}

/**
 * 复核触发器（任务卡「经验手册防历史记录化」第 5 步；**只报不红**，zc drift 点名）：
 * 方法文档里带有效期的结论，就地挂一行——
 *     ⟳复核: <到点要判什么> | 到期 <YYYY-MM-DD>
 * 到期日 ≤ 今天而标记还在 = 这条结论没人复核过，可能已经过期（事件型触发如「正式服上线」
 * 写成预计复核日）。与判据 11 同族：一个拦新增编年史（红），一个防旧结论静默过期（报）。
 * 机制同 drift 的诚实性：复核查实后改写结论并**撤掉标记**（或顺延日期并写明复核人理由），
 * 不许只删日期装没发生。⚠ 自指陷阱：约定说明文字不许写出可解析的示例日期。
 */
export function scanDocReviewTriggers(root = ROOT, today = new Date().toISOString().slice(0, 10)) {
  const rows = []
  for (const rel of Object.keys(MANUAL_DENSITY_CEILINGS)) {
    const p = join(root, rel)
    if (!existsSync(p)) continue
    const lines = readFileSync(p, 'utf8').split('\n')
    lines.forEach((ln, i) => {
      const m = ln.match(/⟳复核[:：]\s*(.+?)\s*[|｜]\s*到期\s*(\d{4}-\d{2}-\d{2})/)
      if (m) rows.push({ file: rel, line: i + 1, due: m[2], overdue: m[2] <= today, text: m[1].trim() })
    })
  }
  return rows
}

/**
 * 代码侧 `@fact` 的复核触发器**逾期**检查（T15 对抗审计 #3 发现、本轮补的盲区）。
 *
 * 为什么需要：判据 15 的 `hasTrigger` **只查「有没有 ⟳复核 + 到期」**，从不比对今天；
 * 而唯一做逾期比对的 `scanDocReviewTriggers` 只遍历 `MANUAL_DENSITY_CEILINGS` 的**4 本方法文档**，
 * 完全不扫 `src/**` 的 `@fact`。⇒ 代码级口径写上「到期 2026-12-31」后，过期了**永远没人被点名**，
 * 而判据 15 的立项缘起正是「effectiveTime 那条口径挂了 14 天才被用户纠正」——没有逾期检查，
 * 触发器就只是**装饰**（挂上那天与过期那天看起来一样）。
 *
 * 口径：**只报不红**（与 scanDocReviewTriggers 同族；红了会逼人改日期作弊——规则 16 的既有教训）。
 * 数据源复用 `scanCaliberTriggers` 的 `withTrigger`（已是「有触发器的游戏语义口径」全集）。
 */
export function scanCaliberTriggerDue(root = ROOT, today = new Date().toISOString().slice(0, 10)) {
  const { withTrigger } = scanCaliberTriggers(root)
  const rows = []
  for (const t of withTrigger) {
    const p = join(root, t.file)
    if (!existsSync(p)) continue
    const lines = readFileSync(p, 'utf8').split('\n')
    // 触发器可能写在同一行尾部，或紧随其后单独一行（与 scanCaliberTriggers 同口径）
    const near = [lines[t.line - 1] ?? '', lines[t.line] ?? ''].join('\n')
    const m = near.match(/⟳复核[:：]\s*([\s\S]*?)[|｜]\s*到期\s*(\d{4}-\d{2}-\d{2})/)
    if (!m) continue
    rows.push({
      file: t.file, line: t.line, subject: t.subject, kind: t.kind,
      due: m[2], overdue: m[2] <= today, text: m[1].replace(/\s+/g, ' ').trim(),
    })
  }
  return rows
}


// ---- 判据 2：实现已整段迁至 `./lib/agent-branch-ratchet.mjs`（R46 结构熵切面，纯搬运）----
// 本块是 **re-export 壳**：既有消费者（`runAllChecks` / `scripts/zc.mjs` /
// `report-agent-identity.mjs` / `validate-specs.mjs` / `src/scripts/__tests__/*`）的 import 路径零改动。
// ⚠ 必须写成「import + export」两行——`export { … } from` **不建本地绑定**
// （R22 刀 A/B/C 已实证：那样写运行时 ReferenceError + vue-tsc TS2304）。
// ⚠ 改判据口径请改 `./lib/agent-branch-ratchet.mjs`，**不要在本文件重建同形函数**。
import { AGENT_BRANCH_DIR, AGENT_BRANCH_FILE, listAgentBranchFiles, countAgentBranchLines, countAgentBranchLinesLegacy, AGENT_BRANCH_BASELINE, AGENT_BRANCH_MIN_FILES, CORE_AGENT_BRANCH_FILES, CORE_AGENT_BRANCH_BASELINE, countAgentIdBranchLinesInFiles, countAgentIdBranchLines } from './lib/agent-branch-ratchet.mjs'
export { AGENT_BRANCH_DIR, AGENT_BRANCH_FILE, listAgentBranchFiles, countAgentBranchLines, countAgentBranchLinesLegacy, AGENT_BRANCH_BASELINE, AGENT_BRANCH_MIN_FILES, CORE_AGENT_BRANCH_FILES, CORE_AGENT_BRANCH_BASELINE, countAgentIdBranchLinesInFiles, countAgentIdBranchLines } from './lib/agent-branch-ratchet.mjs'

// ---- 判据 3：工作区状态文件防误提交 ----

/** 允许被 git 跟踪的 .claude/ 白名单（本仓库历史遗留：本地权限配置） */
export const CLAUDE_TRACKED_ALLOWLIST = ['.claude/settings.local.json']

export function findForbiddenTracked(trackedPaths) {
  return trackedPaths.filter(p =>
    (p === '.claude/task-ledger.md' || p.startsWith('.claude/ledgers/') || p.startsWith('.zcode/') || p.startsWith('.zc/')
      || p.startsWith('.freebuff/'))
    || (p.startsWith('.claude/') && !CLAUDE_TRACKED_ALLOWLIST.includes(p)),
  )
}


// ---- 判据 7+12：实现已整段迁至 `./lib/layer-import-ratchet.mjs`（R46 结构熵切面，纯搬运）----
// 本块是 **re-export 壳**：既有消费者（`runAllChecks` / `scripts/zc.mjs` /
// `report-agent-identity.mjs` / `validate-specs.mjs` / `src/scripts/__tests__/*`）的 import 路径零改动。
// ⚠ 必须写成「import + export」两行——`export { … } from` **不建本地绑定**
// （R22 刀 A/B/C 已实证：那样写运行时 ReferenceError + vue-tsc TS2304）。
// ⚠ 改判据口径请改 `./lib/layer-import-ratchet.mjs`，**不要在本文件重建同形函数**。
import { EXHIBITION_LAYER_DIRS, EXHIBITION_LAYER_FORBIDDEN, EXHIBITION_LAYER_IMPORT_BASELINE, EXHIBITION_LAYER_MIN_FILES, CORE_LAYER_DIR, CORE_ROLE_IMPORT_BASELINE, CORE_ROLE_IMPORT_MIN_FILES, scanCoreRoleImports, scanRoleModuleValueDeps, findRoleModuleValueDeps, ROLE_MODULE_DEP_DIRS, ROLE_MODULE_DEP_BASELINE, ROLE_MODULE_DEP_MIN_FILES, detectExhibitionLayerImport, countExhibitionLayerImports, scanExhibitionLayerImports } from './lib/layer-import-ratchet.mjs'
export { EXHIBITION_LAYER_DIRS, EXHIBITION_LAYER_FORBIDDEN, EXHIBITION_LAYER_IMPORT_BASELINE, EXHIBITION_LAYER_MIN_FILES, CORE_LAYER_DIR, CORE_ROLE_IMPORT_BASELINE, CORE_ROLE_IMPORT_MIN_FILES, scanCoreRoleImports, scanRoleModuleValueDeps, findRoleModuleValueDeps, ROLE_MODULE_DEP_DIRS, ROLE_MODULE_DEP_BASELINE, ROLE_MODULE_DEP_MIN_FILES, detectExhibitionLayerImport, countExhibitionLayerImports, scanExhibitionLayerImports } from './lib/layer-import-ratchet.mjs'
import { CORE_ROLE_FIELD_BASELINE, CORE_ROLE_SCAN_MIN_FILES, ROLE_FIELD_EXEMPT, scanCoreRoleFields, findRoleFieldRefs, rolePrefixesFrom, CORE_ROLE_INFIX_BASELINE, ROLE_INFIX_EXEMPT, INFIX_PREFIX_EXCLUDE, camelSegments, findRoleInfixRefs, scanCoreRoleInfix } from './lib/core-role-field-ratchet.mjs'
export { CORE_ROLE_FIELD_BASELINE, CORE_ROLE_SCAN_MIN_FILES, ROLE_FIELD_EXEMPT, scanCoreRoleFields, findRoleFieldRefs, rolePrefixesFrom, CORE_ROLE_INFIX_BASELINE, ROLE_INFIX_EXEMPT, INFIX_PREFIX_EXCLUDE, camelSegments, findRoleInfixRefs, scanCoreRoleInfix } from './lib/core-role-field-ratchet.mjs'


// ---- 判据 4：实现已整段迁至 `./lib/settings-coverage.mjs`（R46 结构熵切面，纯搬运）----
// 本块是 **re-export 壳**：既有消费者（`runAllChecks` / `scripts/zc.mjs` /
// `report-agent-identity.mjs` / `validate-specs.mjs` / `src/scripts/__tests__/*`）的 import 路径零改动。
// ⚠ 必须写成「import + export」两行——`export { … } from` **不建本地绑定**
// （R22 刀 A/B/C 已实证：那样写运行时 ReferenceError + vue-tsc TS2304）。
// ⚠ 改判据口径请改 `./lib/settings-coverage.mjs`，**不要在本文件重建同形函数**。
import { SETTINGS_UNTESTED_BACKLOG, extractSettingIds, loadRegistrySnapshot, scanSettingsCoverage, settingsCoverageOk, formatSettingsCoverage, SETTINGS_COVERAGE_MIN_MODULES } from './lib/settings-coverage.mjs'
export { SETTINGS_UNTESTED_BACKLOG, extractSettingIds, loadRegistrySnapshot, scanSettingsCoverage, settingsCoverageOk, formatSettingsCoverage, SETTINGS_COVERAGE_MIN_MODULES } from './lib/settings-coverage.mjs'

// ---- 判据 5：debt: 标记注册表（防「later = never」） ----

// DEBT_REGISTRY（技术债登记簿） 已移至 scripts/lib/guard-registries.mjs（CC-85 2026-09-27，census §5.91），由本文件顶部 import 并原样转出。

/**
 * 自指豁免：标记扫描器自身必然包含被扫描模式的字面量（与 GUARD_SYSTEM_FILES 同一性质，
 * 非债务）。scripts/zc.mjs 的事实抽取器把 'debt:' 列为 MARKERS 之一，头注释也统计它的
 * 出现次数——若不豁免，装上 zc 当天就会凭空多出两条「未登记债务」。
 */
// @fact engine:guards/自指豁免 口径: 扫描器自身含被扫模式的字面量属自指、不计违规（fetch-stub 用 GUARD_SYSTEM_FILES，debt 用本清单，事实扫描用占位符跳过） | 据 实测@2026-09-01·复核@2026-09-04·复核@2026-09-08·复核@2026-09-25·复核@2026-09-27 | 验 src/scripts/__tests__/zc.test.ts | 锚 scripts/check-guards.mjs#DEBT_SCAN_SELF_REFERENTIAL | 信 确认
export const DEBT_SCAN_SELF_REFERENTIAL = ['scripts/zc.mjs', 'scripts/lib/dead-channel-scan.mjs', 'scripts/lib/guard-registries.mjs']

/** codebase 里实际的 debt: 标记 → [{ file, text }, ...]（text 为 'debt:' 后整段说明） */
export function scanDebtMarkers(root = ROOT) {
  const markers = []
  const rec = (d) => {
    if (!existsSync(d)) return
    for (const n of readdirSync(d)) {
      const p = join(d, n)
      const rel = relative(root, p).split(sep).join('/')
      if (statSync(p).isDirectory()) {
        if (n === 'node_modules' || n === 'dist' || n === '__tests__') continue
        rec(p)
      } else if (/\.(ts|mjs|py)$/.test(n) && n !== 'check-guards.mjs' && !DEBT_SCAN_SELF_REFERENTIAL.includes(rel)) {
        const src = readFileSync(p, 'utf8')
        for (const ln of src.split('\n')) {
          const m = ln.match(/debt:\s*(.+)/)
          if (!m) continue
          markers.push({ file: rel, text: m[1].trim() })
        }
      } else if (/\.json$/.test(n) && rel.startsWith('src/specs/agents/')) {
        // 2026-09-10（账本 Open #6）：spec JSON 的 notes 里也写 debt: 标记，此前扫描不覆盖
        // → 既不计数也不登记（1411.json 那条债静默至今）。spec 是单行 JSON，逐行扫描即可。
        const src = readFileSync(p, 'utf8')
        for (const ln of src.split('\n')) {
          const m = ln.match(/debt:\s*(.+)/)
          if (!m) continue
          markers.push({ file: rel, text: m[1].trim().slice(0, 200) })
        }
      }
    }
  }
  rec(join(root, 'src'))
  rec(join(root, 'scripts'))
  return markers
}

/** 注册表 key 形如 '<file>:<关键词>'；标记与注册条目匹配 = 文件相同 && 标记文本包含关键词 */
export function matchDebtRegistry(markers) {
  const registered = Object.keys(DEBT_REGISTRY)
  const splitKey = (k) => [k.slice(0, k.indexOf(':')), k.slice(k.indexOf(':') + 1)]
  const unregistered = markers.filter(m =>
    !registered.some(k => { const [f, kw] = splitKey(k); return f === m.file && m.text.includes(kw) }))
  const cleared = registered.filter(k => {
    const [f, kw] = splitKey(k)
    return !markers.some(m => m.file === f && m.text.includes(kw))
  })
  return { unregistered, cleared }
}

function listTrackedFiles(root) {
  try {
    return execSync('git ls-files', { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean)
  } catch {
    return null // 非 git 环境（如 zip 解包）跳过本判据，CLI 会打 warning
  }
}

// ---- 判据 13：名词表三态对账（防「数据在源里但没人消费」） ----
//
// 为什么需要：2026-09-13 实测——`data/raw/nanoka_missing/noun_3.2.3.json` 68 条名词里，
// [秽盾]（键 2000002）**全仓零消费锚点**：原文写「获得高额的防御力、减伤加成和抗打断能力提升
// 且不会失衡；代理人能通过攻击削减[秽盾]」「被打破时…回复能量或闪能」，而仓库只把
// `shieldCount` 当「破盾奖励次数」折能量——盾本体的防御/减伤/削盾量/破盾净除全无建模，
// 且 `core/effectiveTime.ts` 头注释还把秽盾当成**无敌时间**（旧口径，2026-09-13 用户已纠正）。
//
// 这类缺口**没有任何失败测试**：源数据在、代码也在，只是两者之间没有连线。机器不红 ⇒ 人不知道。
// 本判据把三态变成机器判据：**已建模**（src 有可解析消费锚点）/ **已挂账**（登记位置 + since）/
// **未处理**（两者皆无）——未处理即红。
//
// 三态数据由 `scripts/lib/noun-triage.json` 承载（逐条判定 + 证据），本判据只做**校验**：
// ① 覆盖完整性（源里的键一个不许漏、也不许多）
// ② `modeled` 的锚必须能被 `resolveAnchor` 解析（断锚 = 口径已过期，同判据 6 的哲学）
// ③ `deferred` 必须有 `registeredAt` + `since`（挂账不是"口头说说"，要有落点与日期）
// ④ 源数据自身变化（新增/删除名词）必须同步对账文件——否则新名词静默进来没人判
//
// 为什么允许「挂账」态：一次性把 68 条全修完不现实，全红会逼人**关掉判据**（判据失效）。
// 挂账 = 诚实处置（同 debt: registry / RATCHET_BURNDOWN 的哲学），未处理才是静默缺口。

/** 名词表三态对账文件（逐条判定 + 证据；由人工/子代理维护，本判据校验其自洽性） */
export const NOUN_TRIAGE_FILE = 'scripts/lib/noun-triage.json'
/** 名词表源（nanoka 原文；`noun*.json` 的当前唯一实文件） */
export const NOUN_SOURCE_FILE = 'data/raw/nanoka_missing/noun_3.2.3.json'
/** 三态取值（改这里 = 改判据语义，diff 里留痕） */
export const NOUN_STATES = ['modeled', 'deferred', 'unhandled']

/**
 * 名词表源文件的最小键数（**只减不增地**冻结；2026-09-14 实测 68）。
 *
 * 为什么要有（T15 对抗审计 #8 发现、本轮实测复核）：判据是「源里的键都要有对账」，
 * 于是**把源文件清空成 `{}` 反而全绿**（无项可审 = missing/extra/unhandled 全空）。
 * 源文件是 nanoka 原文转录的**外部事实面**，不该由本仓库的对账动作反向改写——
 * 键数一旦减少就是「源被削了」，必须红。要合法减少先改这个常量并写清为什么。
 */
export const NOUN_SOURCE_MIN_KEYS = 68

/**
 * 校验名词表三态对账。返回 { ok, source, triage, missing, extra, badState, noEvidence,
 * brokenAnchor, noRegister, unhandled, sourceShrunk }。
 *
 * 文件缺失：**源在、对账文件没了 = 红**（T15 审计 #2：那正是「把账本删掉就绿」的逃生通道）；
 * 只有两者都不在才返回 null（环境不全不误伤——与判据 9/10 同风格）。
 */
export function auditNounTriage(root = ROOT, resolveAnchorFn = resolveAnchor) {
  const srcPath = join(root, NOUN_SOURCE_FILE)
  // 最小键数下限只在**真实仓库**生效：单测 fixture 就是 1–2 条的最小样例（`root !== ROOT`
  // ⇒ 降级为「源/账至少一方的存在性必须自洽」那两条，不校验绝对条数）。
  // 否则每个最小 fixture 都得凑满 68 条噪音数据，判据的可测性反而被这条下限吃掉。
  const minKeys = root === ROOT ? NOUN_SOURCE_MIN_KEYS : 0
  const triagePath = join(root, NOUN_TRIAGE_FILE)
  const hasSource = existsSync(srcPath)
  const hasTriage = existsSync(triagePath)
  if (!hasSource && !hasTriage) return null
  if (hasSource && !hasTriage) {
    return {
      ok: false, source: {}, triage: { entries: {} }, sourceKeys: [], missing: [], extra: [],
      badState: [], noEvidence: [], brokenAnchor: [], noRegister: [], unhandled: [],
      sourceShrunk: [`源文件在（${NOUN_SOURCE_FILE}）但对账文件缺失（${NOUN_TRIAGE_FILE}）→ 补回对账文件（删账本不能让判据变绿）`],
    }
  }
  if (!hasSource && hasTriage) {
    return {
      ok: false, source: {}, triage: {}, sourceKeys: [], missing: [], extra: [],
      badState: [], noEvidence: [], brokenAnchor: [], noRegister: [], unhandled: [],
      sourceShrunk: [`对账文件在（${NOUN_TRIAGE_FILE}）但源文件缺失（${NOUN_SOURCE_FILE}）→ 源是外部事实面，不该被删`],
    }
  }
  const source = JSON.parse(readFileSync(srcPath, 'utf8'))
  const triage = JSON.parse(readFileSync(triagePath, 'utf8'))
  const entries = triage.entries ?? {}
  const sourceKeys = Object.keys(source)
  const triagedKeys = Object.keys(entries)
  const missing = sourceKeys.filter(k => !triagedKeys.includes(k))
  const extra = triagedKeys.filter(k => !sourceKeys.includes(k))
  const badState = []
  const noEvidence = []
  const brokenAnchor = []
  const noRegister = []
  const unhandled = []
  // 源被削（清空 = 无项可审 = 全绿）是最廉价的假绿通道，见 NOUN_SOURCE_MIN_KEYS
  const sourceShrunk = sourceKeys.length < minKeys
    ? [`源键数 ${sourceKeys.length} < 冻结下限 ${minKeys}（${NOUN_SOURCE_FILE}）→ 源是 nanoka 转录的事实面，不该变少；确需下调先改 NOUN_SOURCE_MIN_KEYS 并写明理由`]
    : []
  for (const [key, e] of Object.entries(entries)) {
    if (!NOUN_STATES.includes(e.state)) badState.push(`${key} ${e.name ?? ''} → state=${e.state}`)
    // trim：纯空格/换行不算证据（T15 审计 #9）
    if (!e.evidence?.trim()) noEvidence.push(`${key} ${e.name ?? ''}`)
    if (e.state === 'modeled') {
      const r = resolveAnchorFn(e.anchor, root)
      if (!r.ok) brokenAnchor.push(`${key} ${e.name ?? ''} → ${e.anchor ?? '(缺锚)'}（${r.reason}）`)
    }
    if (e.state === 'deferred' && (!e.registeredAt || !e.since)) {
      noRegister.push(`${key} ${e.name ?? ''} → registeredAt=${e.registeredAt ?? '(缺)'} since=${e.since ?? '(缺)'}`)
    }
    if (e.state === 'unhandled') unhandled.push(`${key} ${e.name ?? ''}｜${e.evidence ?? '（无证据）'}`)
  }
  const ok = missing.length === 0 && extra.length === 0 && badState.length === 0
    && noEvidence.length === 0 && brokenAnchor.length === 0 && noRegister.length === 0
    && unhandled.length === 0 && sourceShrunk.length === 0
  return { ok, source, triage, sourceKeys, missing, extra, badState, noEvidence, brokenAnchor, noRegister, unhandled, sourceShrunk }
}


// ---- 判据 14：实现已整段迁至 `./lib/dead-channel-scan.mjs`（R46 结构熵切面，纯搬运）----
// 本块是 **re-export 壳**：既有消费者（`runAllChecks` / `scripts/zc.mjs` /
// `report-agent-identity.mjs` / `validate-specs.mjs` / `src/scripts/__tests__/*`）的 import 路径零改动。
// ⚠ 必须写成「import + export」两行——`export { … } from` **不建本地绑定**
// （R22 刀 A/B/C 已实证：那样写运行时 ReferenceError + vue-tsc TS2304）。
// ⚠ 改判据口径请改 `./lib/dead-channel-scan.mjs`，**不要在本文件重建同形函数**。
import { DEAD_CHANNEL_ALLOWLIST, stripComments, stripCommentsAndStrings, stripStringLiterals, scanDeadOptionalProps, scanReadOnlyOptionalProps, scanDtsDrift, extractRuntimeExports, countDeadChannelWorkload, applyDeadChannelAllowlist } from './lib/dead-channel-scan.mjs'
export { DEAD_CHANNEL_ALLOWLIST, stripComments, stripCommentsAndStrings, stripStringLiterals, scanDeadOptionalProps, scanReadOnlyOptionalProps, scanDtsDrift, extractRuntimeExports, countDeadChannelWorkload, applyDeadChannelAllowlist } from './lib/dead-channel-scan.mjs'

// ---- 判据 15：口径复核触发器强制（防「旧结论静默过期」） ----
//
// 为什么需要：`zc drift` 已有「锚文件在『据』日期之后被改过」的点名机制，但它是**只报不红**，
// 且只看「锚文件 mtime」——看不见「口径本身需要定期复核」这件事。实测：手写 `@fact` 93 条里
// 85 条是**游戏语义**（口径=已定的算法/语义），而带 `⟳复核` 触发器的**一条都没有**
// （docs 里仅 3 条）⇒ 所有口径都是"永不过期"的，包括 `effectiveTime.ts` 那条
// 「无敌（秽盾/转阶段动画）」——用户 2026-09-13 才纠正，代码里已挂了 14 天没人发现。
//
// 判据形态 = **棘轮 + 豁免清单（带 since/due）**：
// - 存量口径进豁免清单（一次性），新增游戏语义口径缺 `⟳复核` 行 = 红；
// - 豁免清单条目补齐触发器后销号（清单过期即红 ⇒ burn-down，防「冻结 = 永久豁免」）；
// - 触发器写在 `@fact` 的**下一行注释**（`⟳复核: <到点判什么> | 到期 <YYYY-MM-DD>`）——
//   解析器只认 `据|验|锚|信` 槽位，未知前缀直接忽略 ⇒ 行尾追加不破坏 `parseFactLine`。
//
// 「游戏语义」判定 = 主体**不是**工程元口径（`engine:guards` / `engine:zc` / `ui:` / `utils:`）
// 且种类 ∈ {口径, 映射}。工程元口径的"复核"由守卫自己保证（判据红了就有人看），不需要挂日期。

/**
 * 工程元口径主体前缀（这些的复核靠守卫红，不靠日期提醒）——
 * `engine:guards`（护栏自身口径）/ `engine:zc`（工具链）/ `ui:`（UI 契约）/
 * `utils/`、`utils:`（通用工具）/ `engine:mechanics单一事实源`（校验器元规则）。
 * 用前缀匹配：主体写法既有 `utils:format` 也有 `utils/format/localized`（`/` 分隔）。
 */
export const CALIBER_NON_GAME_SUBJECTS = [
  'engine:guards', 'engine:zc', 'ui:', 'utils:', 'utils/',
  'engine:mechanics',
]
/** 需要复核触发器的种类（口径=已定语义；映射=术语↔字段对应，游戏改版即失效） */
export const CALIBER_TRIGGER_KINDS = ['口径', '映射']

/**
 * 工程元口径的**锚文件位**：`scripts/**`（工具链）· `docs/**`（手册）· `src/utils/**`（通用格式化/
 * 展示工具，与游戏机制无关）。
 *
 * `src/utils/**` 收进来的依据 = `docs/ARCHITECTURE.md` §0 的五层模型里它不属于任何机制层，
 * 内容是 `format.ts`（数字/本地化格式化）/ `statMeta.ts`（属性元数据）/ `modelingGaps.ts`（缺口提示）/
 * `image.ts`（图片 URL）这类纯工具——实测仓库里唯一的 `utils/` 前缀事实就是
 * `@fact utils/format/localized`（LocalizedString 解析口径，锚 src/utils/format.ts）。
 * 见 `isEngineeringFact` 的组合判据说明。
 */
export function isEngineeringAnchor(file) {
  return /^(scripts|docs|src\/utils)\//.test(file)
}

/**
 * 是否为「工程元口径」= subject 前缀命中 **且** 锚文件在工程位。
 *
 * 单看前缀是可逃逸白名单（作者改个 subject 就绕开判据）；单看文件位又会把
 * 「写在 src/ 里的工具函数口径」（如 `utils/format/localized`）误判成游戏口径。
 * 两者**同时**成立才豁免 —— 逃逸路径只剩「把锚挪出 src/**」，那已是真工程元口径。
 */
export function isEngineeringFact(fact, file) {
  return CALIBER_NON_GAME_SUBJECTS.some(p => fact.subject.startsWith(p)) && isEngineeringAnchor(file)
}

// CALIBER_TRIGGER_ALLOWLIST（口径复核触发器存量豁免） 已移至 scripts/lib/guard-registries.mjs（CC-85 2026-09-27，census §5.91），由本文件顶部 import 并原样转出。

/**
 * 扫游戏语义口径缺 `⟳复核` 触发器的情况。
 * 「有没有触发器」= 该 `@fact` 行本身或**紧邻的下一行**（都是注释）里出现 `⟳复核` + `到期 <日期>`。
 * 返回 { game: [{file,line,subject,kind}], withTrigger, missing, stale }。
 */
export function scanCaliberTriggers(root = ROOT, facts = null) {
  const scanned = facts ?? scanAuthoredFacts(root)
  const game = []
  const withTrigger = []
  for (const s of scanned) {
    const f = s.fact
    if (!f || !CALIBER_TRIGGER_KINDS.includes(f.kind)) continue
    // 工程元口径豁免 = **subject 前缀命中 且 锚文件在工程位（scripts/ 或 docs/）**。
    // 为什么必须加后半条（2026-09-14 修，T15 审计 #10）：原先只看前缀，而前缀由作者自由书写
    // ⇒ **游戏口径只要把 subject 写成 `ui:agent/1561风华上限` 就整条不进 game 集**，
    // 既不红也不进清单（实测逃逸成功：game=0 / missing=0）。
    // 加锚文件判据后，「工程前缀 + 游戏代码」这一组合会被**当成游戏口径**要求触发器——
    // 逃逸要么放弃前缀、要么把锚挪出 src/**（后者是真工程元口径，合理）。
    if (isEngineeringFact(f, s.file)) continue
    const p = join(root, s.file)
    const lines = existsSync(p) ? readFileSync(p, 'utf8').split('\n') : []
    // 本行 + 下一行（允许 `⟳复核` 写在 @fact 行的尾部，或紧随其后单独一行）
    const near = [s.raw ?? '', lines[s.line] ?? ''].join('\n')
    const hasTrigger = /⟳复核[:：]/.test(near) && /到期\s*\d{4}-\d{2}-\d{2}/.test(near)
    const row = { file: s.file, line: s.line, subject: f.subject, kind: f.kind }
    if (hasTrigger) withTrigger.push(row)
    else game.push({ ...row, key: `${s.file} ${f.subject}` })
  }
  const exempt = new Set(CALIBER_TRIGGER_ALLOWLIST)
  const missing = game.filter(g => !exempt.has(g.key))
  const hit = new Set(game.map(g => g.key))
  const stale = CALIBER_TRIGGER_ALLOWLIST.filter(k => !hit.has(k))
  return { game, withTrigger, missing, stale }
}

// ---- 汇总 ----

/**
 * 全部判据。
 * **async**：判据 14-C 需要 `import()` 各 `.mjs` 拿运行时导出表（与手写 `.d.mts` 对账）——
 * 静态 import 会成环（本文件就是被对账对象之一）。
 */
export function runAllChecks(root = ROOT) {
  const results = []

  const { violations, stale } = scanFetchStubs(root)
  const extra = violations.filter(p => !FETCH_STUB_ALLOWLIST.includes(p))
  results.push({
    name: 'fetch-stub freeze (AGENTS §3: 新测试一律走 setupHarness)',
    ok: extra.length === 0 && stale.length === 0,
    detail: [
      ...extra.map(p => `  ✗ 新增 fetch stub：${p} → 改用 src/test/harness.ts 的 setupHarness / mockStaticFetch / setTeam`),
      ...stale.map(p => `  ✗ 清单过期：${p} 已迁移但仍在 FETCH_STUB_ALLOWLIST，删掉该行`),
    ],
  })

  const branchFiles = listAgentBranchFiles(root)
  const branches = countAgentBranchLines(root)
  const branchVoid = branchFiles.length < AGENT_BRANCH_MIN_FILES
  results.push({
    name: `agentId ratchet (规则 6: 队伍级机制走 applyTeamConfig) ${AGENT_BRANCH_FILE} + resourceCalc/ = ${branches}/${AGENT_BRANCH_BASELINE}`
      + ` [AST 身份判定: agentId/.id(四位数字)/teammateBuffId/局部 const 别名]`,
    ok: branches === AGENT_BRANCH_BASELINE && !branchVoid,
    detail: branchVoid
      ? [`  ✗ 反空洞下限：度量面只有 ${branchFiles.length} 个文件 < ${AGENT_BRANCH_MIN_FILES} → ${AGENT_BRANCH_DIR}/ 改名/搬家了？`,
        '    → 修扫描器（listAgentBranchFiles），**不要**下调基线：',
        '      扫描面塌陷会让 count 变小甚至归零，照着「是进步」改基线 = 永久关闭这条护栏。']
      : branches > AGENT_BRANCH_BASELINE
        ? [`  ✗ 角色判定 ${AGENT_BRANCH_BASELINE}→${branches}：角色特例逻辑写进编排层了（度量面 ${branchFiles.length} 个文件）。移到 src/mechanics/agents/<id>.ts 的 applyTeamConfig（三阶段钩子）或声明式钩子（axisWindowOverlays / backstageAutoFill 等），派发器在 composables/resourceCalc/panelPhases.ts`,
          '  → 度量口径 = AST 身份判定形态（`agentId` / `.id` 四位数字 / `teammateBuffId` / 局部 const 别名），按行去重；',
          '     查当前清单：node scripts/report-agent-identity.mjs --md（分类 + 证据 + 观察项）']
        : branches < AGENT_BRANCH_BASELINE
          ? [`  ✗ 角色判定 ${AGENT_BRANCH_BASELINE}→${branches}：度量面正常（${branchFiles.length} 个文件）⇒ 是进步，把 scripts/lib/agent-branch-ratchet.mjs 的 AGENT_BRANCH_BASELINE 下调到 ${branches}（棘轮只减不增）`]
          : [],
  })

  // 引擎层同款棘轮（规则 6 在 core 的延伸；此前 core 是豁免区，评审实测 36 处无护栏）
  // ⚠ 度量面 = 硬编码文件清单：文件被改名/搬家时 readFileSync 会 ENOENT 抛错（不静默）——但抛错
  //   会把整条 check-guards 打断，故这里先探测存在性，给出可读的失败信息（反空洞，2026-10-06）。
  const coreMissing = CORE_AGENT_BRANCH_FILES.filter(f => !existsSync(join(root, f)))
  const coreBranches = coreMissing.length > 0 ? 0 : countAgentIdBranchLinesInFiles(CORE_AGENT_BRANCH_FILES, root)
  results.push({
    name: `core agentId ratchet (规则 6 延伸: 引擎层角色无关) ${CORE_AGENT_BRANCH_FILES.join(' + ')} = ${coreBranches}/${CORE_AGENT_BRANCH_BASELINE}`,
    ok: coreBranches === CORE_AGENT_BRANCH_BASELINE && coreMissing.length === 0,
    detail: coreMissing.length > 0
      ? [`  ✗ 反空洞：度量面文件不存在 → ${coreMissing.join(', ')}（改名/搬家？）`,
        '    → 修 CORE_AGENT_BRANCH_FILES，**不要**下调基线（扫不到 ≠ 没问题）']
      : coreBranches > CORE_AGENT_BRANCH_BASELINE
        ? [`  ✗ core 内 agentId 特判 ${CORE_AGENT_BRANCH_BASELINE}→${coreBranches}：引擎层应当角色无关。`,
          '    → 角色机制回 src/mechanics/agents/<id>.ts；跨角色联动走 applyTeamConfig 三阶段钩子；',
          '      确实需要引擎侧通用通道的，抽成 cfg 字段由模块写入（engine 读字段、不读 agentId）']
        : coreBranches < CORE_AGENT_BRANCH_BASELINE
          ? [`  ✗ core 内 agentId 特判 ${CORE_AGENT_BRANCH_BASELINE}→${coreBranches}：度量面正常（${CORE_AGENT_BRANCH_FILES.length} 个文件）⇒ 是进步，把 CORE_AGENT_BRANCH_BASELINE 下调到 ${coreBranches}（棘轮只减不增）`]
          : [],
  })

  const tracked = listTrackedFiles(root)
  if (tracked === null) {
    results.push({ name: 'workspace state not tracked (规则 13: 工作状态 ≠ 项目知识)', ok: true, detail: ['  ⚠ 非 git 环境，跳过'] })
  } else {
    const bad = findForbiddenTracked(tracked)
    results.push({
      name: 'workspace state not tracked (规则 13: 工作状态 ≠ 项目知识)',
      ok: bad.length === 0,
      detail: bad.map(p => `  ✗ 工作区状态文件被跟踪：${p} → git rm --cached（.zcode/ .zc/ .freebuff/ 已 gitignore）`),
    })
  }

  // ---- 判据 7：展示层越层 import 棘轮（ARCHITECTURE §0 依赖方向） ----
  const layer = scanExhibitionLayerImports(root)
  const layerVoid = layer.scanned < EXHIBITION_LAYER_MIN_FILES
  results.push({
    name: `exhibition-layer ratchet (ARCHITECTURE §0: 展示 → 编排 → 引擎，views/components 禁 import 引擎/录入层) = ${layer.count}/${EXHIBITION_LAYER_IMPORT_BASELINE}`,
    ok: layer.count === EXHIBITION_LAYER_IMPORT_BASELINE && !layerVoid,
    detail: layerVoid
      // ⚠ 先判空洞：扫描面塌了时 count 变小**不是进步**，是判据瞎了（见 MIN_FILES 头注释）
      ? [`  ✗ 反空洞下限：只扫到 ${layer.scanned} 个 .vue < ${EXHIBITION_LAYER_MIN_FILES} → 展示层目录改名/搬家了？`,
        `    → 修扫描器（EXHIBITION_LAYER_DIRS = ${EXHIBITION_LAYER_DIRS.join(' / ')}），**不要**下调基线：`,
        '      扫描面塌陷会让 count 变小，照着「是进步」改基线 = 永久关闭这条护栏。']
      : layer.count > EXHIBITION_LAYER_IMPORT_BASELINE
        ? [
          `  ✗ 越层 import ${EXHIBITION_LAYER_IMPORT_BASELINE}→${layer.count}：展示层直接 import 了 @/core|@/mechanics|@/specs`,
          '    → 常量/纯函数下沉 src/data/，或经编排层（composables）透出；import type 不算越层',
          ...layer.sites.slice(0, 12).map(s => `      ${s.file}:${s.line}  ${s.text}`),
        ]
        : layer.count < EXHIBITION_LAYER_IMPORT_BASELINE
          ? [`  ✗ 越层 import ${EXHIBITION_LAYER_IMPORT_BASELINE}→${layer.count}：扫描面正常（${layer.scanned} 个 .vue）⇒ 是进步，把 scripts/lib/layer-import-ratchet.mjs 的 EXHIBITION_LAYER_IMPORT_BASELINE 下调到 ${layer.count}（棘轮只减不增）`]
          : [],
  })

  // ---- 判据 12：引擎层静态依赖具体角色模块棘轮（agentId 棘轮的语义补强面） ----
  const coreRole = scanCoreRoleImports(root)
  const coreRoleVoid = coreRole.scanned < CORE_ROLE_IMPORT_MIN_FILES
  results.push({
    name: `core role-import ratchet (规则 6 语义面: 引擎按能力查询, 不按角色查询) src/core/** → @/mechanics/agents/* = ${coreRole.count}/${CORE_ROLE_IMPORT_BASELINE}`,
    ok: coreRole.count === CORE_ROLE_IMPORT_BASELINE && !coreRoleVoid,
    detail: coreRoleVoid
      ? [`  ✗ 反空洞下限：只扫到 ${coreRole.scanned} 个 .ts < ${CORE_ROLE_IMPORT_MIN_FILES} → src/core 改名/搬家了？`,
        '    → 修扫描器，**不要**下调基线（扫描面塌陷 = 判据瞎了，不是进步）']
      : coreRole.count > CORE_ROLE_IMPORT_BASELINE
        ? [
          `  ✗ 引擎层新增对具体角色模块的值导入 ${CORE_ROLE_IMPORT_BASELINE}→${coreRole.count}：`,
          '    → 角色数学回 src/mechanics/agents/<id>.ts，经 `AgentMechanicModule` 声明式字段暴露能力',
          '      （crossAgentSupply / axisWindowOverlays / backstageAutoFill / transformAnomalyPool …），',
          '      引擎按**能力**查询（`getAgentMechanic(id)?.<能力>`），不 import 具体模块、不写 id 字面量。',
          '    → 为什么另立判据：agentId 棘轮是词法判据，看不见这种耦合（它不写 id）——实测病灶是',
          '      core/resource.ts 曾住 135 行诺姆/琉音赠链数学，新角色接赠链必须改引擎。',
          ...coreRole.sites.slice(0, 12).map(s => `      ${s.file}:${s.line}  ${s.text}`),
        ]
        : coreRole.count < CORE_ROLE_IMPORT_BASELINE
          ? [`  ✗ core role-import ${CORE_ROLE_IMPORT_BASELINE}→${coreRole.count}：扫描面正常（${coreRole.scanned} 个 .ts）⇒ 是进步，把 CORE_ROLE_IMPORT_BASELINE 下调到 ${coreRole.count}（棘轮只减不增）`]
          : [],
  })

  // ---- 判据 22：core/编排层读角色前缀字段计数棘轮（口径 scripts/lib/core-role-field-ratchet.mjs） ----
  const roleField = scanCoreRoleFields(root)
  if (roleField === null) {
    results.push({ name: 'core role-field ratchet ⚠ 非 git 环境，跳过', ok: true, detail: [] })
  } else {
    results.push({
      name: `core role-field ratchet (判据 22: 角色知识回模块, 引擎不读 <角色>Xxx 字段) = ${roleField.count}/${CORE_ROLE_FIELD_BASELINE}`,
      ok: roleField.count === CORE_ROLE_FIELD_BASELINE && roleField.scanned >= CORE_ROLE_SCAN_MIN_FILES,
      detail: roleField.scanned < CORE_ROLE_SCAN_MIN_FILES
        ? [`  ✗ 反空洞下限：只扫到 ${roleField.scanned} 个文件 < ${CORE_ROLE_SCAN_MIN_FILES} → git ls-files scope 变了 / src/mechanics/agents 改名？`,
          '    → 修扫描器，**不要**下调基线（扫描面塌陷 = 判据瞎了，不是进步）']
        : roleField.count > CORE_ROLE_FIELD_BASELINE
          ? [
            `  ✗ 角色前缀字段引用 ${CORE_ROLE_FIELD_BASELINE}→${roleField.count}（新增）：`,
            '    → 数学通用的改通用字段（范式 CC-13 / CC-14a）；逻辑专属的迁模块能力 getAgentMechanic(id)?.<能力>',
            `    → 通用词撞角色前缀的误报加进 ROLE_FIELD_EXEMPT（现：${ROLE_FIELD_EXEMPT.join(', ')}）并写明理由`,
            ...[...roleField.byFile].slice(0, 8).map(([f, r]) => `      ${f}: ${r.length}`),
          ]
          : roleField.count < CORE_ROLE_FIELD_BASELINE
            ? [`  ✗ core role-field ${CORE_ROLE_FIELD_BASELINE}→${roleField.count}：扫描面正常（${roleField.scanned} 个文件）⇒ 是进步，把 CORE_ROLE_FIELD_BASELINE 与 RATCHET_BURNDOWN「core 角色前缀字段」.frozen 同步下调到 ${roleField.count}（棘轮只减不增）`]
            : [],
    })
  }

  // ---- 判据 23：角色名中缀 / core 子目录棘轮（CC-43b；口径 scripts/lib/core-role-field-ratchet.mjs 判据 23 段） ----
  const roleInfix = scanCoreRoleInfix(root)
  if (roleInfix === null) {
    results.push({ name: 'core role-infix ratchet ⚠ 非 git 环境，跳过', ok: true, detail: [] })
  } else {
    results.push({
      name: `core role-infix ratchet (判据 23: 标识符中缀/子目录也不带角色名) = ${roleInfix.count}/${CORE_ROLE_INFIX_BASELINE}`,
      ok: roleInfix.count === CORE_ROLE_INFIX_BASELINE && roleInfix.scanned >= CORE_ROLE_SCAN_MIN_FILES,
      detail: roleInfix.scanned < CORE_ROLE_SCAN_MIN_FILES
        ? [`  ✗ 反空洞下限：只扫到 ${roleInfix.scanned} 个文件 < ${CORE_ROLE_SCAN_MIN_FILES} → git ls-files scope 变了 / 目录改名？`,
          '    → 修扫描器，**不要**下调基线（扫描面塌陷 = 判据瞎了，不是进步）']
        : roleInfix.count > CORE_ROLE_INFIX_BASELINE
          ? [
            `  ✗ 含角色名段的标识符 ${CORE_ROLE_INFIX_BASELINE}→${roleInfix.count}（新增）：`,
            '    → 纯命名的改通用名（范式 CC-43a）；逻辑专属的迁模块能力 getAgentMechanic(id)?.<能力>',
            `    → 英文通用词撞角色名的误报加进 ROLE_INFIX_EXEMPT（现：${ROLE_INFIX_EXEMPT.join(', ')}）并写明理由`,
            ...[...roleInfix.byFile].slice(0, 8).map(([f, r]) => `      ${f}: ${r.map(x => x.field).join(', ')}`),
          ]
          : roleInfix.count < CORE_ROLE_INFIX_BASELINE
            ? [`  ✗ core role-infix ${CORE_ROLE_INFIX_BASELINE}→${roleInfix.count}：扫描面正常（${roleInfix.scanned} 个文件）⇒ 是进步，把 CORE_ROLE_INFIX_BASELINE 与 RATCHET_BURNDOWN「core 角色名中缀/子目录」.frozen 同步下调到 ${roleInfix.count}（棘轮只减不增）`]
            : [],
    })
  }

  // ---- 判据 24：编排层 + core → 角色模块值依赖（CC-45；多行 import/export、裸 import、动态 import 均计；type-only 豁免；硬门 0） ----
  const roleDeps = scanRoleModuleValueDeps(root)
  const roleDepsVoid = roleDeps.scanned < ROLE_MODULE_DEP_MIN_FILES
  results.push({
    name: `role-module value-dep gate (判据 24: ${ROLE_MODULE_DEP_DIRS.join(' + ')} → @/mechanics/agents/* 值依赖) = ${roleDeps.count}/${ROLE_MODULE_DEP_BASELINE}`,
    ok: roleDeps.count === ROLE_MODULE_DEP_BASELINE && !roleDepsVoid,
    detail: roleDepsVoid
      ? [`  ✗ 反空洞下限：只扫到 ${roleDeps.scanned} 个 .ts < ${ROLE_MODULE_DEP_MIN_FILES} → 扫描目录改名/搬家了？`,
        '    → 修扫描器，**不要**下调基线（扫描面塌陷 = 判据瞎了，不是进步）']
      : roleDeps.count === ROLE_MODULE_DEP_BASELINE ? [] : [
        `  ✗ 编排层/core 对具体角色模块的值依赖 ${ROLE_MODULE_DEP_BASELINE}→${roleDeps.count}：`,
        '    → 逻辑专属：types.ts 加可选能力、角色模块实现、编排层 getAgentMechanic(agentId)?.<能力> 派发（范式 CC-43c promoteHugCounts）',
        '    → 无角色语义的纯函数：迁 src/core（范式 CC-44 core/resource/targetSlot.ts）；纯类型改 import type / export type',
        ...roleDeps.sites.slice(0, 8).map(s => `      ${s.file}:${s.line} [${s.kind}] ${s.spec}`),
      ],
  })

  const settings = scanSettingsCoverage(root)
  // ⚠ 冻结清单按 id 本体匹配（`module::id` 里的 id 部分）——见 settings-coverage.mjs 的注释：
  // setting id 全局唯一，而模块 id 会随改名/合并漂移。
  const newGaps = settings.untested.filter(e => !SETTINGS_UNTESTED_BACKLOG.some(b => e.endsWith(`::${b}`)))
  const settingsMin = root === ROOT ? SETTINGS_COVERAGE_MIN_MODULES : 0
  // ⚠ `name` 与加下限前**逐字节相同**（反空洞下限只在 `ok` 与红时 detail 里体现）——这是**有意**的：
  // ① 绿基线输出可 `cmp` 逐字节对拍 ⇒ 证明本改动**零意外扰动**其它 18 条判据（最强保真仪器）；
  // ② 下限口径与 `NOUN_SOURCE_MIN_KEYS`（判据 13，同样不打进绿行）一致，而**不是**
  //    `LAYER_INVERSION_MIN_TOTAL_SITES`（判据 19 那种打进绿行的写法）——两者都是既有先例，此处选前者
  //    是为了拿到 ① 这条保真证明。⚠ 不要为了「让下限更显眼」改这一行：那会牺牲 ①，而可见性已由
  //    `settingsCoverage.test` 的回归锁（常量 >0 + 可红性自证）覆盖。
  // ⚠ R49 换尺后 `已测 N/M` 的分母从 84 变 **180**（M = 运行时注册表 id 数）—— 这是**口径纠正的
  //    可见化**，不是退步：旧读数 84/84 掩盖了 96 个看不见的 id，现读数把真实存量摆上台面。
  results.push({
    name: `settings coverage (规则 12/§2: 滑块声明必须有「改了确实变」测试) 已测 ${[...settings.declared.values()].flat().length - settings.untested.length}/${[...settings.declared.values()].flat().length}`,
    ok: settingsCoverageOk(settings, newGaps, settingsMin),
    // ⚠ detail **恒**由 formatSettingsCoverage 产出（不是只在红时）——`stale` 的「清单可回收」
    // 是**绿也要打印**的 warn（原实现如此，别改成条件输出而静默掉回收提醒）。
    detail: formatSettingsCoverage(settings, newGaps, settingsMin),
  })

  const markers = scanDebtMarkers(root)
  const { unregistered, cleared } = matchDebtRegistry(markers)
  results.push({
    name: `debt registry (规则 12: debt: 标记防「later = never») ${markers.length - unregistered.length}/${markers.length} 登记`,
    ok: unregistered.length === 0 && cleared.length === 0,
    detail: [
      ...unregistered.map(m => `  ✗ 未登记的 debt 标记：${m.file}: ${m.text.slice(0, 40)}… → 在 scripts/lib/guard-registries.mjs 的 DEBT_REGISTRY 登记一条（since=引入日期, due=到期动作）`),
      ...cleared.map(m => `  ✗ 已还清但未销号：${m} → 标记已不在代码里，从 DEBT_REGISTRY 删除该条`),
    ],
  })

  // ---- 判据 9：README §6 文档表 == docs/ 实际文件（防清单漂移不可见） ----
  const docs = auditDocTable(root)
  results.push({
    name: docs === null
      ? 'docs table (README §6 == docs/**.md 递归) ⚠ 无 README，跳过'
      : `docs table (README §6 == docs/**.md 递归) ${docs.actualCount} 份`,
    ok: docs === null || (docs.missing.length === 0 && docs.extra.length === 0 && !docs.countMismatch && docs.staleCounts.length === 0),
    detail: docs === null ? [] : [
      ...docs.missing.map(f => `  ✗ docs/${f} 未登记进 README §6 文档表 → 补一行（表里没有的文档 = agent 找不到）`),
      ...docs.extra.map(f => `  ✗ README §6 登记了 docs/${f}，但文件不存在 → 断链，删该行或补文件`),
      ...(docs.countMismatch ? [`  ✗ README §6 节标题自述「${docs.declaredCount} 份」，实际 ${docs.actualCount} 份 → 改节标题里的数字`] : []),
      // 表尾等其它位置的份数自述（标题对了不代表别处对了——2026-09-11 事故形态）
      ...docs.staleCounts.map(n => `  ✗ README §6 里有一处份数自述「${n} 份」，实际 ${docs.actualCount} 份 → 改成 ${docs.actualCount}（§6 内每处份数都必须一致）`),
    ],
  })

  // ---- 判据 6：手写 @fact 的锚必须解析得到（语言层，规则 8/9 的机器面） ----
  // 抽取自散文的事实不受约束（存量）；作者手写的 @fact 是新增承诺，必须能钉在代码上，
  // 否则口径会悄悄过期——这正是文档腐烂的形态，只是换了个更短的载体。
  // 语料含 docs/ 的声明行（2026-09-15 术语表 review 补的盲区）：规则 8 允许手册写「口径」，
  // 若不入语料则手册里的 @fact 断锚/缺据都不红——实测 3 条 docs 事实此前完全不可见。
  const authored = auditAuthoredFacts(root)
  results.push(authoredFactsVerdict(authored))

  // ---- 判据 10：catalog level60 ↔ raw 源对账（坑 40：漏加突破加成是静默错误） ----
  results.push(level60Verdict(auditCatalogLevel60(root), root))

  // ---- 判据 11：手册数字 id 密度棘轮（任务卡 2026-09-12：防手册编年史化） ----
  const density = scanManualDensity(root)
  const dense = Object.entries(density).filter(([, d]) => d.density !== null && d.density > d.ceiling)
  results.push({
    name: dense.length === 0
      ? `手册密度棘轮 (规则 8 分层契约: 协议/口径/证据进手册, 编年史进 git/账本) ${Object.keys(density).length}/${Object.keys(density).length} 达标`
      : `手册密度棘轮 ✗ ${dense.length} 份超天花板`,
    ok: dense.length === 0,
    detail: dense.map(([f, d]) =>
      `  ✗ ${f} 密度 ${d.density} > 天花板 ${d.ceiling}（hits ${d.hits}/行 ${d.lines}）`
      + ` → 新案例叙事进 .claude 账本或 git，手册条目按「症状/根因/判据/否决记录」四栏模板写`),
  })

  // ---- 判据 13：名词表三态对账（防「数据在源里但没人消费」） ----
  const noun = auditNounTriage(root)
  const nounCounts = noun === null ? null : noun.triage.entries && {
    modeled: Object.values(noun.triage.entries).filter(e => e.state === 'modeled').length,
    deferred: Object.values(noun.triage.entries).filter(e => e.state === 'deferred').length,
    unhandled: noun.unhandled.length,
  }
  results.push({
    name: noun === null
      ? `名词表三态对账 ⚠ ${NOUN_SOURCE_FILE} 与 ${NOUN_TRIAGE_FILE} 均缺失，跳过`
      : `名词表三态对账 (${NOUN_SOURCE_FILE}: ${noun.sourceKeys.length} 条 → modeled ${nounCounts?.modeled ?? 0} / deferred ${nounCounts?.deferred ?? 0} / unhandled ${nounCounts?.unhandled ?? 0})`,
    ok: noun === null || noun.ok,
    detail: noun === null ? [] : [
      ...(noun.sourceShrunk ?? []).map(s => `  ✗ 源面异常：${s}`),
      ...noun.missing.map(k => `  ✗ 源里有但未对账：${k} ${noun.source[k]?.name ?? ''} → 在 ${NOUN_TRIAGE_FILE} 补一条三态判定`),
      ...noun.extra.map(k => `  ✗ 对账文件多出源里没有的键：${k} → 源数据已变，删该条`),
      ...noun.badState.map(s => `  ✗ state 非法：${s} → 只许 ${NOUN_STATES.join(' / ')}`),
      ...noun.noEvidence.map(s => `  ✗ 缺 evidence：${s} → 写一句话（在哪找到的什么 / 搜了什么没找到）`),
      ...noun.brokenAnchor.map(s => `  ✗ modeled 但锚解析不到：${s} → 改锚或降级为 deferred/unhandled（断锚 = 口径已过期）`),
      ...noun.noRegister.map(s => `  ✗ deferred 但缺登记：${s} → 补 registeredAt（<文件>:<行>）与 since（日期）`),
      ...noun.unhandled.map(s => `  ✗ 未处理（红）：${s} → 建模（补 src 消费锚点）或挂账（登记进 docs 待办/DEBT_REGISTRY）；`
        + '挂账也是合法处置，见判据 13 头注释'),
      ...(noun.unhandled.length > 0 ? [
        `  → 数据在源里但没人消费 = 无失败测试的静默缺口（[秽盾] 就是这么漏了 14 天）。`,
        `  → 本轮只要求「每条有着落」：modeled 给锚 / deferred 给登记 / unhandled 清零。`,
      ] : []),
    ],
  })

  // ---- 判据 14：死通道扫描（防「接口/参数在但实现没接」） ----
  {
    // 显式传段：候选为空时也要查该段清单是否该销号（见 applyDeadChannelAllowlist 的 ⚠ 说明）
    const deadA = applyDeadChannelAllowlist(scanDeadOptionalProps(root), 'A')
    const deadB = applyDeadChannelAllowlist(scanReadOnlyOptionalProps(root), 'B')
    const dts = scanDtsDrift(root)
    const dtsDrift = [...dts.declaredNotExported, ...dts.exportedNotDeclared]
    const dtsFresh = applyDeadChannelAllowlist(dtsDrift, 'C')
    const fresh = [...deadA.fresh, ...deadB.fresh, ...dtsFresh.fresh]
    const stale = [...deadA.stale, ...deadB.stale, ...dtsFresh.stale]
    const counts = `A 零读零写 ${deadA.allowlisted.length} / B 只读不写 ${deadB.allowlisted.length} / C dts 漂移 ${dtsFresh.allowlisted.length}`
    results.push({
      name: `死通道扫描 (规则 16: 接口在实现没接) ${counts} 已豁免`,
      ok: fresh.length === 0 && stale.length === 0,
      detail: [
        ...fresh.map(c => `  ✗ 新增未登记死通道：${c.key}${'reads' in c ? `（reads=${c.reads} writes=${c.writes}）` : ''}`
          + ` → 接上消费点，或在 scripts/lib/dead-channel-scan.mjs 的 DEAD_CHANNEL_ALLOWLIST 登记一条（since/due/why）`),
        ...stale.map(k => `  ✗ 豁免清单过期：${k} → 已不再命中，从 DEAD_CHANNEL_ALLOWLIST 删掉该条（棘轮只减不增）`),
        ...(fresh.length > 0 || stale.length > 0 ? [
          '  → 三类形态：A 导出的可选项零调用（goldLevel 模式）/ B 可选项只读不写、`?? 默认值` 静默兜底',
          '    （invincibleTime 模式：引擎读、面板可写、数据不给）/ C 手写 .d.mts 与 .mjs 运行时导出漂移（TS2305 模式）。',
        ] : []),
      ],
    })
  }

  // ---- 判据 15：口径复核触发器强制（防「旧结论静默过期」） ----
  {
    const cal = scanCaliberTriggers(root, authored.scanned)
    results.push({
      name: `口径复核触发器 (规则 8/16: 游戏语义口径必须挂 ⟳复核 到期日) 已挂 ${cal.withTrigger.length} / 待补 ${cal.missing.length}`,
      ok: cal.missing.length === 0 && cal.stale.length === 0,
      detail: [
        ...cal.missing.slice(0, 20).map(m => `  ✗ 游戏语义口径缺复核触发器：${m.key} → 在 @fact 行尾或下一行注释补`
          + ' `⟳复核: <到点判什么> | 到期 <YYYY-MM-DD>`（解析器只认 据/验/锚/信 槽位，追加不影响 parseFactLine）'),
        ...(cal.missing.length > 20 ? [`  …另有 ${cal.missing.length - 20} 条`] : []),
        ...cal.stale.map(k => `  ✗ 豁免清单过期：${k} → 该口径已补触发器，从 CALIBER_TRIGGER_ALLOWLIST 删掉该行（棘轮只减不增）`),
        ...(cal.missing.length > 0 ? [
          `  → 到期与否不在本判据（这里只查「有没有」触发器，防止口径"永不过期"），逾期点名见 ` + "`zc drift`" + ` / #scanCaliberTriggerDue，`,
          `     `+"`zc drift`"+` 查「到没到期」并点名逾期项。工程元口径（${CALIBER_NON_GAME_SUBJECTS.join(' / ')}）豁免——它们的复核靠守卫红。`,
        ] : []),
      ],
    })
  }

  // ---- 判据 16：scoped 样式可达性（防「规则留在别处的 scoped 里，消费组件吃不到」） ----
  {
    const reach = scanScopedStyleReach(root)
    const KIND_LABEL = {
      'views-css': 'src/views 下的 scoped css',
      'shared-css': '共享 scoped-src 文件',
      'page-inline': '页面内联 scoped',
      'component-inline': '他组件内联 scoped',
    }
    const kindLabel = k => k.split('+').map(x => KIND_LABEL[x] ?? x).join(' + ')
    results.push({
      name: `scoped 样式可达性 (规则 16: 组件用了「看不见的 scoped 定义」的类) 失配 ${reach.violations.length} 处`
        + (reach.skip ? `（${reach.skip}，跳过）` : `（定义面 ${reach.defs} 条 / 消费组件 ${reach.consumers} 个）`),
      ok: reach.skip !== null || reach.violations.length === 0,
      detail: [
        ...reach.violations.slice(0, 15).map(v => `  ✗ .${v.cls} 用在 ${v.component}，但只在 ${v.definedIn}（${kindLabel(v.kind)}）里定义`
          + ` → 该规则对这个组件**不生效**（scoped 选择器带的是定义方的 data-v-*）`),
        ...(reach.violations.length > 15 ? [`  …另有 ${reach.violations.length - 15} 处`] : []),
        ...(reach.violations.length > 0 ? [
          '  → 症状是「屏幕上少了一条线/一处字号」，编译过、测试绿、ui-check 也不报 ⇒ 只能靠本判据。',
          '  → 修法三选一：① 类是跨块共享的 ⇒ 搬进 src/styles/chart-blocks.css（各块用 <style scoped src> 载入，',
          '     **特异性不变**、源码一份）；② 只有该组件用 ⇒ 搬进组件自己的 css（或全局 charts.css）；',
          '     ③ 消费组件确实要用 ⇒ 补 `<style scoped src>` 载入定义文件，或在自己内联 scoped 里补一份（注明出自定义方）。',
          '  → 别无出处地「复制一份到组件里」了事（规则 11 双份必漂移；实测 dd-caption 两份已漂 11 vs 11.5px）。',
        ] : []),
      ],
    })
  }

  // ---- 判据 17：压缩数组按槽位号索引（防「槽位号 ≠ 下标」整类静默缺陷回来） ----
  {
    const scan = scanCompactedSlotIndex(root)
    results.push({
      name: `压缩数组槽位索引 (判据 17: characters/panels/damagePanels/entrySnapshotPanels 的下标 ≠ 槽位号) 违规 ${scan.violations.length} 处`
        + `（豁免 ${IDX_SAFE_ALLOWLIST.length} 条 / 扫 ${scan.scanned} 行）`,
      ok: scan.violations.length === 0,
      detail: [
        ...scan.violations.slice(0, 15).map(v => `  ✗ ${v.file}:${v.line}  ${v.array}[${v.key}] → ${v.text}`),
        ...(scan.violations.length > 15 ? [`  …另有 ${scan.violations.length - 15} 处`] : []),
        ...(scan.violations.length > 0 ? [
          '  → 四数组按**位置压缩**（buildCharConfig/computePanel 跳过空槽）⇒ 槽位号 ≠ 下标；',
          '     前导/中间空槽时静默取到 undefined 或**别人那份对象**（实测：艾莲影画4 冻结 4→0、回能 16→0，',
          '     格雷丝写进队友 cfg，奥菲丝/薇薇安/蕾米埃尔直接抛 TypeError），且**无任何既有测试会变红**。',
          '  → 修法：① 模块内取自己那份 ⇒ 用派发器直给的 `cfg`（AgentTeamConfigInput.cfg /',
          '     AgentNextRoundFeedbackInput.cfg）；② 取队友那份 / 任何面板 ⇒ `.find(x => x.slot === slot)`，',
          '     面板族还可用 `panelAt(panels, slot)`（src/core/panel.ts，带未盖章密集数组兜底）。',
          '  → 确属**下标语义**（非槽位号）的用法走 scripts/lib/compacted-slot-index.mjs 的 IDX_SAFE_ALLOWLIST，',
          '     每条必须写明理由（棘轮只减不增；理由不成立就该改代码而不是加豁免）。',
        ] : []),
      ],
    })
  }


  // ---- 判据 18：招式伤害属性 ↔ nanoka raw 散文对账（R23-N1：防招式伤害属性静默改回/退化） ----
  {
    results.push(moveElementVerdict(auditMoveElementsAgainstRaw(root), root))
  }

  // ---- 判据 19：录入层 → 编排层值倒置（ARCHITECTURE §0 依赖方向；R35-J2 唯一值边 claret.ts 已下沉 data/） ----
  {
    const report = scanLayerInversion(root)
    results.push({
      name: `layer-inversion (判据 19: 录入层 mechanics/specs 禁值导入编排层 @/composables) 值导入 ${report.valueCount} 处`
        + `（type 站点 ${report.typeCount} / 总站点 ${report.total} ≥ ${LAYER_INVERSION_MIN_TOTAL_SITES} 反空洞`
        + ` / 形状锁 ${report.shapeViolations.length} 处 / 扫 ${report.scannedFiles} 文件）`,
      ok: layerInversionOk(report),
      detail: layerInversionOk(report) ? [] : formatLayerInversion(report),
    })
  }

  // ---- 判据 20：队友 Buff 控件守卫（R65-J1；「可点但拨了没反应」= 面向用户缺陷） ----
  {
    const report = scanTeammateBuffControls(root)
    const detail = []
    if (report.missing) {
      detail.push(`  ✗ 渲染面文件不存在：${TEAMMATE_BUFF_VIEW} → 本判据扫描面已失效，检查文件是否改名/搬走`)
    } else if (!report.regionFound) {
      detail.push(`  ✗ 队友 Buff 列表区域定位失败（找 ${REGION_START} … ${REGION_END}）`)
      detail.push('    → 模板结构变了：按新结构更新 scripts/lib/teammate-buff-controls.mjs 的两个 REGION_* 标记')
    } else if (report.controls.length === 0) {
      detail.push('  ✗ 区域内零控件 ⇒ 「零违规」不可采信（反空洞：扫不到与修好了不可区分）')
      detail.push('    → 若控件确实被移除，删除本判据并同步 RATCHET_BURNDOWN；若是选择器写坏，修选择器')
    } else {
      for (const v of report.violations) {
        detail.push(`  ✗ ${v.tag} 无 isInteractive( 渲染门控 ⇒ 用户看见拨了没反应的死控件`)
        detail.push(`      ${v.opening}`)
      }
      if (report.violations.length > 0) {
        detail.push('    → 给控件（或其祖先）加 `v-if="isInteractive(buff)"`；可交互性单一事实源 =')
        detail.push('      src/utils/teammateBuffRows.ts（进数值通道 ∧ 有可求值载荷），别在模板里手写条件')
      }
    }
    results.push({
      name: `队友 Buff 控件守卫 (判据 20: 无 isInteractive 门控的 checkbox/slider) `
        + `违规 ${report.violations.length} 处 / 扫 ${report.controls.length} 控件`,
      ok: report.ok,
      detail,
    })
  }

  // ---- 判据 21：JSON 重复键静默覆盖（2026-09-22 无人值守班次；事故 = 1091.json 重复 teamBuffs 键） ----
  {
    const report = scanJsonDupKeys(root)
    results.push({
      name: `JSON 重复键静默覆盖 (判据 21: 同一对象内同名键 ⇒ JSON.parse 后者覆盖前者) `
        + `重复 ${report.duplicates.length} 处 / 扫 ${report.scanned} 个 .json`
        + ` / detector 自证 ${report.selfTest.ok ? '过' : '失败'}`,
      ok: report.ok,
      detail: report.ok ? [] : formatJsonDupKeys(report),
    })
  }

  // ---- 判据 25：无类型记录字符串键死读（CC-91；事故 = vivian.ts record.vivianDanceHit / vivianAssistCount 全仓零写入） ----
  {
    const report = scanRecordKeyDeadReads(root, RECORD_KEY_DEAD_READ_ALLOWLIST)
    results.push({
      name: `无类型记录键死读 (判据 25: Record<string, unknown> 按键读取却全仓零写入/声明 ⇒ 恒取缺省) `
        + `死读 ${report.fresh.length} 处 / 记录读取 ${report.reads} 处 / 豁免 ${Object.keys(RECORD_KEY_DEAD_READ_ALLOWLIST).length}`
        + ` / detector 自证 ${report.selfTest.ok ? '过' : '失败'}`,
      ok: report.ok,
      detail: report.ok ? [] : formatRecordKeyDeadReads(report),
    })
  }
  // ---- 判据 26：角色 / 招式 id 字面量只许在 id 的家（CC-449 立于展示层：事故 = r487 文档断言「views 无 moveId 字面量」而 StunAxisPage 实有 3 处，八轮逐处下沉各配一把单文件锁；CC-450 实测全 src 其余 228 文件 0 处 ⇒ 扩成层不变量） ----
  {
    const report = scanIdLiterals(root)
    results.push({
      name: `id-literal gate (判据 26: 角色/招式 id 字面量只住 ${ID_HOME_DIRS.join(' | ')}；别处按能力/声明/数据表查，不认 id) `
        + `= ${report.count}/${ID_LITERAL_BASELINE} / 扫 ${report.scanned} 文件 / detector 自证 ${report.selfTest.ok ? '过' : '失败'}`,
      ok: report.ok,
      detail: report.ok ? [] : formatIdLiterals(report),
    })
  }

  return { results, ok: results.every(r => r.ok) }
}

// ---- CLI ----
const invokedAsCli = process.argv[1]
  && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
if (invokedAsCli) {
  const { results, ok } = runAllChecks()
  for (const r of results) {
    console.log(`${r.ok ? 'ok' : '✗'} ${r.name}`)
    for (const d of r.detail) console.log(d)
  }
  if (!ok) { console.log(`${results.filter(r => !r.ok).length} guard check(s) failed`); process.exit(1) }
  console.log(`${results.length} guard checks passed`)
}
