#!/usr/bin/env node
// 机器护栏：AGENTS.md 里仍靠纯文字守着的规则 → 会大声失败的判据（挂在 check/verify 链首端）。
//
// 为什么存在：本仓库已验证的经验是「让 agent 守规矩的从来不是措辞，是会红的 CI」——
// AGENTS.md 每条硬规则的历史防线（validate:specs / allAgentsSweep / resolve exit 1 / 拆 CI job）
// 全是事故后加的机器判据，加完没有复发。本文件补齐最后几条纯文字规则：
//   1. fetch-stub 冻结   —— AGENTS §3「新测试一律用 src/test/harness.ts，禁止复制 fetch stub」
//   2. agentId 分支棘轮  —— 规则 6「队伍级机制走 applyTeamConfig，禁止往 useResourceCalc 加分支」
//   3. 工作区状态防误提交 —— 规则 13「task-ledger/ledgers 是工作状态不是项目知识」
//
// 用法：node scripts/check-guards.mjs（npm run check / npm run verify 已挂载）
// 逃生口（都要求显式改本文件，让「例外」在 diff 里留痕）：
//   - fetch-stub：测试迁移到 setupHarness 后，从 FETCH_STUB_ALLOWLIST 删掉对应行（清单与
//     现状做集合相等校验，漏删即红，防清单变死数据）
//   - agentId 棘轮：基线只减不增。下调（进步）需在提交说明写明；上调没有合法路径——
//     角色特例逻辑属于 src/mechanics/agents/<id>.ts 的 applyTeamConfig（派发器在
//     composables/resourceCalc/helpers.ts，见规则 6 / ARCHITECTURE §3）
import { execSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

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
  'src/composables/__tests__/decibelUltimateCount.test.ts',
  'src/composables/__tests__/determinism.test.ts',
  'src/composables/__tests__/excelAxisRepro.test.ts',
  'src/composables/__tests__/positionCompareDebug.test.ts',
  'src/composables/__tests__/seedInvariance.test.ts',
  'src/composables/__tests__/teamCompare.test.ts',
  'src/composables/__tests__/timeLedger.test.ts',
  'src/mechanics/__tests__/anbyCinema1.test.ts',
  'src/mechanics/__tests__/banyue-preset-int.test.ts',
  'src/mechanics/__tests__/banyue-timeoverflow.debug.test.ts',
  'src/mechanics/__tests__/banyue.test.ts',
  'src/mechanics/__tests__/caesar.test.ts',
  'src/mechanics/__tests__/grace.test.ts',
  'src/mechanics/__tests__/jufufu.test.ts',
  'src/mechanics/__tests__/lighter.test.ts',
  'src/mechanics/__tests__/lucy.test.ts',
  'src/mechanics/__tests__/lycaonSmoke.test.ts',
  'src/mechanics/__tests__/nekomata.test.ts',
  'src/mechanics/__tests__/nicole.test.ts',
  'src/mechanics/__tests__/normaSmoke.test.ts',
  'src/mechanics/__tests__/orphie.test.ts',
  'src/mechanics/__tests__/orphieSelf.test.ts',
  'src/mechanics/__tests__/panYinhu.test.ts',
  'src/mechanics/__tests__/peiluo.test.ts',
  'src/mechanics/__tests__/qianxia.test.ts',
  'src/mechanics/__tests__/rina.test.ts',
  'src/mechanics/__tests__/sigrid.test.ts',
  'src/mechanics/__tests__/soldier11.test.ts',
  'src/mechanics/__tests__/soukaku.test.ts',
  'src/mechanics/__tests__/xide.test.ts',
  'src/mechanics/__tests__/xixifu.test.ts',
  'src/mechanics/__tests__/yanagi.test.ts',
  'src/mechanics/__tests__/yaojiayin.test.ts',
  'src/mechanics/__tests__/yeshuguang.test.ts',
  'src/mechanics/__tests__/yixuanSmoke.test.ts',
  'src/mechanics/__tests__/zhuYuan.test.ts',
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

// ---- 判据 2：useResourceCalc agentId 分支棘轮 ----

export const AGENT_BRANCH_FILE = 'src/composables/useResourceCalc.ts'
/** 2026-08-30 冻结基线：规则 6 生效前的历史存量（按「含 agentId ===/!== 的行数」计） */
export const AGENT_BRANCH_BASELINE = 53

export function countAgentIdBranchLines(content) {
  return content.split('\n').filter(l => /agentId\s*(===|!==)/.test(l)).length
}

// ---- 判据 3：工作区状态文件防误提交 ----

/** 允许被 git 跟踪的 .claude/ 白名单（本仓库历史遗留：本地权限配置） */
export const CLAUDE_TRACKED_ALLOWLIST = ['.claude/settings.local.json']

export function findForbiddenTracked(trackedPaths) {
  return trackedPaths.filter(p =>
    (p === '.claude/task-ledger.md' || p.startsWith('.claude/ledgers/') || p.startsWith('.zcode/'))
    || (p.startsWith('.claude/') && !CLAUDE_TRACKED_ALLOWLIST.includes(p)),
  )
}

// ---- 判据 4：滑块生效测试（「加了滑块但没有测试引用」= 死数据风险） ----

/**
 * 存量缺口清单：2026-08-30 冻结时 77 个 settings id 里 49 个无任何测试引用。
 * 棘轮：新增滑块必须带「改滑块→结果确实变」的测试（AGENTS §2 滑块行 / 规则 5 同源思想）；
 * 存量补了测试就从下面删一行（漏删不红——与 fetch-stub 不同，多行清单无害但会过期，
 * 所以对「清单里其实已测」的行打 warn 提醒回收）。
 *
 * 2026-08-31 00:07 追加：orphie.frontSwitchRatio / jufufu.frontSwitchRatio 是并行会话
 * 时间预算任务的进行中 WIP（冻结清单后几分钟新增），其账本 Goal 含「补生效测试」。
 * 若该任务收尾后此二行仍在且无测试，即真实缺口。
 */
export const UNTESTED_SETTINGS_ALLOWLIST = [
  "aire.ts::aire.cheerEnergyBonus",
  "alice.ts::alice.cinema6PerStateCount",
  "anby.ts::anby.c2StunCoverage",
  "anbyZero.ts::anbyZero.cangguangCount",
  "ben.ts::ben.exParrySuccessRate",
  "billy.ts::billy.c4ExCrit",
  "billy.ts::billy.coreCrouchCoverage",
  "corin.ts::corin.c1Coverage",
  "ellen.ts::ellen.c1CritStacks",
  "ellen.ts::ellen.c2AvgCharge",
  "ellen.ts::ellen.c4CdRate",
  "ellen.ts::ellen.c6FeastCoverage",
  "ellen.ts::ellen.stormSurgeStacks",
  "evelyn.ts::evelyn.c1DefIgnoreCoverage",
  "evelyn.ts::evelyn.c4ShieldCoverage",
  "evelyn.ts::evelyn.c6FollowUpCount",
  "evelyn.ts::evelyn.garroteCount",
  "grace.ts::grace.shockStacks",
  "harumasa.ts::harumasa.a5Count",
  "harumasa.ts::harumasa.abnormalCoverage",
  "harumasa.ts::harumasa.edgeAverageStacks",
  "hugo.ts::hugo.c4Coverage",
  "hugo.ts::hugo.echoCoverage",
  "hugo.ts::hugo.exVerdictRatio",
  "hugo.ts::hugo.ultimateVerdictRatio",
  "koleda.ts::koleda.c1Coverage",
  "koleda.ts::koleda.c4ChargeStacks",
  "koleda.ts::koleda.chainStunCoverage",
  "lycaon.ts::lycaon.c1Coverage",
  "miyabi.ts::miyabi.frostburnBreakCount",
  "miyabi.ts::miyabi.frostburnBreakRate",
  "miyabi.ts::miyabi.iceFlameCoverage",
  "nekomata.ts::nekomata.c4CritRateCoverage",
  "orphie.ts::orphie.bladeLinkRatio",
  "specPanelBuffs.ts::jufufu.frontSwitchRatio",
  "promia.ts::promia.releaseCountOverride",
  "seth.ts::seth.additionalResCoverage",
  "seth.ts::seth.c6FinishCount",
  "soldier11.ts::soldier11.c2StackCoverage",
  "soldier11.ts::soldier11.prairieFireStunCoverage",
  "trigger.ts::trigger.hellCoordinatedCount",
  "trigger.ts::trigger.normalCoordinatedCount",
  "trigger.ts::trigger.sniperHitCount",
  "velina.ts::velina.cinema2CorrosionRate",
  "yaojiayin.ts::yaojiayin.ariaCoverage",
  "yidhari.ts::yidhari.exHealMissingHpPct",
  "yidhari.ts::yidhari.exPerStun",
  "yidhari.ts::yidhari.hpBurnPctPerSecond",
  "yidhari.ts::yidhari.tentacleInterval",
  "zhendou.ts::zhendou.c1LossCoverage",
]

/** 从 mechanics 模块源码抽 settings 块里的 id（字符串字面量 + 常量引用两种形态） */
export function extractSettingIds(moduleSource) {
  const lines = moduleSource.split('\n')
  let inBlock = false, depth = 0, buf = []
  for (const ln of lines) {
    if (!inBlock && /\bsettings\s*:\s*\[/.test(ln)) {
      inBlock = true
      depth = (ln.match(/\[/g) ?? []).length - (ln.match(/\]/g) ?? []).length
      buf = [ln]
      if (depth <= 0) inBlock = false
      continue
    }
    if (inBlock) {
      buf.push(ln)
      depth += (ln.match(/\[/g) ?? []).length - (ln.match(/\]/g) ?? []).length
      if (depth <= 0) inBlock = false
    }
  }
  if (!buf.length) return []
  const block = buf.join('\n')
  const literal = [...block.matchAll(/\bid\s*:\s*['"]([\w.\-]+)['"]/g)].map(m => m[1])
  const consts = [...block.matchAll(/\bid\s*:\s*([A-Z_][A-Z0-9_]*)\b/g)].map(m => {
    const def = moduleSource.match(new RegExp(`(?:const|let)\\s+${m[1]}\\s*=\\s*['"]([\\w.\\-]+)['"]`))
    return def ? def[1] : `UNRESOLVED:${m[1]}`
  })
  return [...literal, ...consts]
}

/**
 * 扫 src/mechanics/agents/ 的 settings 声明与全部 *.test.ts 的引用。
 * 返回 { declared: Map(module -> [ids]), untested: [module::id], stale: [清单里已测的] }
 */
export function scanSettingsCoverage(root = ROOT) {
  const agentsDir = join(root, 'src/mechanics/agents')
  const declared = new Map()
  for (const f of readdirSync(agentsDir).filter(f => f.endsWith('.ts'))) {
    const src = readFileSync(join(agentsDir, f), 'utf8')
    const ids = extractSettingIds(src)
    if (ids.length) declared.set(f, ids)
  }
  // 全部测试文本（src 下递归）
  const testTexts = []
  const rec = (d) => {
    if (!existsSync(d)) return
    for (const n of readdirSync(d)) {
      const p = join(d, n)
      if (statSync(p).isDirectory()) rec(p)
      else if (n.endsWith('.test.ts')) testTexts.push(readFileSync(p, 'utf8'))
    }
  }
  rec(join(root, 'src'))
  const allTests = testTexts.join('\n')
  const untested = []
  for (const [mod, ids] of declared) for (const id of ids) if (!allTests.includes(id)) untested.push(`${mod}::${id}`)
  const stale = UNTESTED_SETTINGS_ALLOWLIST.filter(e => !untested.includes(e))
  return { declared, untested, stale }
}

// ---- 判据 5：debt: 标记注册表（防「later = never」） ----

/**
 * 代码里的 debt: 标记注册表（AGENTS 规则 12）。新增标记必须在此登记（登记时写「到期动作」）；
 * 标记从代码里删除（债还清）必须同步销号，否则下面对不上即红。
 * 格式：'<file>:<标记关键词>' -> { since: '引入日期', due: '到期动作' }
 */
export const DEBT_REGISTRY = {
  'src/mechanics/agents/yuzuha.ts:转积蓄贡献挂柚叶槽位': {
    since: '2026-08-25', due: '若支援位柚叶积蓄占比成为异常池施加者判定异常，改为「不参与结算」精确口径',
  },
  'src/composables/pullPlannerEngine.ts:赠送卡窗口期自动获得': {
    since: '2026-08-29', due: '赠送卡窗口期（佩洛伊斯 1551）自动获得建模后，从免费名单移除',
  },
  'src/composables/runArchiveDeploy.ts:与 BossSelectCard.applyBoss 内联逻辑重复': {
    since: '2026-08-27', due: '提取共享的 layer-buff 写入函数，两处调用同一实现',
  },
  'scripts/import-nanoka-bosses.mjs:x弹刀时间语义': {
    since: '2026-08-28', due: '基塔布鲁弹刀时间语义明确后建模（当前仅 1 Boss 1 次，影响面小）',
  },
}

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
      } else if (/\.(ts|mjs|py)$/.test(n) && n !== 'check-guards.mjs') {
        const src = readFileSync(p, 'utf8')
        for (const ln of src.split('\n')) {
          const m = ln.match(/debt:\s*(.+)/)
          if (!m) continue
          markers.push({ file: rel, text: m[1].trim() })
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

// ---- 汇总 ----

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

  const branches = countAgentIdBranchLines(readFileSync(join(root, AGENT_BRANCH_FILE), 'utf8'))
  results.push({
    name: `agentId ratchet (规则 6: 队伍级机制走 applyTeamConfig) ${AGENT_BRANCH_FILE} = ${branches}/${AGENT_BRANCH_BASELINE}`,
    ok: branches === AGENT_BRANCH_BASELINE,
    detail: branches > AGENT_BRANCH_BASELINE
      ? [`  ✗ 分支数 ${AGENT_BRANCH_BASELINE}→${branches}：角色特例逻辑写进 useResourceCalc 了。移到 src/mechanics/agents/<id>.ts 的 applyTeamConfig（三阶段钩子，派发器 composables/resourceCalc/helpers.ts）`]
      : branches < AGENT_BRANCH_BASELINE
        ? [`  ✗ 分支数 ${AGENT_BRANCH_BASELINE}→${branches}：是进步，把 check-guards.mjs 的 AGENT_BRANCH_BASELINE 下调到 ${branches}（棘轮只减不增）`]
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
      detail: bad.map(p => `  ✗ 工作区状态文件被跟踪：${p} → git rm --cached（.claude/ledgers/ 与 .zcode/ 已 gitignore）`),
    })
  }

  const settings = scanSettingsCoverage(root)
  const newGaps = settings.untested.filter(e => !UNTESTED_SETTINGS_ALLOWLIST.includes(e))
  results.push({
    name: `settings coverage (规则 12/§2: 滑块声明必须有「改了确实变」测试) 已测 ${[...settings.declared.values()].flat().length - settings.untested.length}/${[...settings.declared.values()].flat().length}`,
    ok: newGaps.length === 0,
    detail: [
      ...newGaps.map(e => `  ✗ 新滑块无测试引用：${e} → 补「改滑块→面板/结果确实变」的生效测试（AGENTS §2 滑块行，般岳 rageGainCoverage 曾静默失效）`),
      ...settings.stale.map(e => `  ⚠ 清单可回收：${e} 已有测试，从 UNTESTED_SETTINGS_ALLOWLIST 删掉该行`),
    ],
  })

  const markers = scanDebtMarkers(root)
  const { unregistered, cleared } = matchDebtRegistry(markers)
  results.push({
    name: `debt registry (规则 12: debt: 标记防「later = never») ${markers.length - unregistered.length}/${markers.length} 登记`,
    ok: unregistered.length === 0 && cleared.length === 0,
    detail: [
      ...unregistered.map(m => `  ✗ 未登记的 debt 标记：${m.file}: ${m.text.slice(0, 40)}… → 在 check-guards.mjs 的 DEBT_REGISTRY 登记一条（since=引入日期, due=到期动作）`),
      ...cleared.map(m => `  ✗ 已还清但未销号：${m} → 标记已不在代码里，从 DEBT_REGISTRY 删除该条`),
    ],
  })

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
