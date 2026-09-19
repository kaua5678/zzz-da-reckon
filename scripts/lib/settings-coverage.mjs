/**
 * 判据 4「滑块生效测试」的实现面（R46 结构熵切面，纯搬运）。
 *
 * 为什么需要：每个录入的机制 = spec 字段 + 生效测试（规则 5）。「加了滑块但没有测试引用」
 * = 死数据风险；曾实测般岳 `rageGainCoverage` 滑块静默失效。
 * 棘轮：新增滑块必须带「改滑块→结果确实变」的测试；存量补了测试就从
 * `UNTESTED_SETTINGS_ALLOWLIST` 删一行（漏删不红，只打 warn 提醒回收）。
 *
 * ⚠ 本文件是 check-guards.mjs 判据 4 的**实现**；`runAllChecks` 经 re-export 壳消费。
 * ⚠ 纯搬运保真：正文与搬出前逐字节相同（仅整体 `export` 保留 + 新增本序言）。
 *
 * ## R47：反空洞下限（`SETTINGS_COVERAGE_MIN_MODULES`）
 * 原判据 `ok = newGaps.length === 0` 在**抽取器整体失效**时仍绿（打印 `已测 0/0`，EXIT=0）
 * —— `0/0` 与 `84/84` 在退出码上不可区分。R47 闸门判「前提成立」（`MIN=0` 平凡绿、
 * `MIN≥1` 在恒空注入下红）⇒ 加一条**扫到的模块数 ≥ 冻结实测值**的下限。
 * ⚠ **口径纪律**（与 `NOUN_SOURCE_MIN_KEYS` / `LAYER_INVERSION_MIN_TOTAL_SITES` 同）：
 * 常量**只减不增地**冻结；确需下调先改常量并在提交说明写明理由，**不许**顺手删判据。
 * ⚠ **已知局限（未修，见 `.claude/OPEN-ITEMS.md` R47-J2）**：块起始正则只认 `settings: [`
 * 对象属性形态，17 个用 `const settings: MechanicSetting[] = [` 独立声明的模块**结构性漏扫**
 * （实测 `extractSettingIds(banyue.ts)` = `[]`）。放宽后 35→51 模块 / 84→137 id / 21 个零引用
 * ⇒ 那是「扫描面缩水」另一个缺口，修它要么补 21 条测试要么加豁免（后者 = 放宽判据，禁）。
 */
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** 仓库根（从 `scripts/lib/` 上溯三级；与 check-guards.mjs 的 ROOT 同值） */
const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))))

// ---- 判据 4：滑块生效测试（「加了滑块但没有测试引用」= 死数据风险） ----

/**
 * 反空洞下限：扫到的**声明了 settings 块的模块数**（`declared.size`）低于此值 ⇒ 判扫描器失效。
 *
 * 为什么要有（R47 闸门判「前提成立」，见 `.claude/OPEN-ITEMS.md` R46-J2）：
 * 把 `extractSettingIds` 注入成恒 `return []` ⇒ 判据 4 打印 **`已测 0/0` 并 `19 guard checks passed`
 * （EXIT=0）** —— 抽取器整体失效与「真的 84/84 全测」在**退出码上不可区分**。
 * 同族先例：判据 13 `NOUN_SOURCE_MIN_KEYS = 68`、判据 19 `LAYER_INVERSION_MIN_TOTAL_SITES = 8`。
 *
 * ⚠ **口径为什么是「模块数」而不是「滑块数」**：滑块数随录入进展自然增减，拿它当下限 =
 * 把判据强度绑在业务量上（且「今天恰好有 84 个」一改就假红）。模块数 = 「扫描器有没有找到它的输入」
 * 的直接读数。闸门实测判别力：`MIN=0` ⇒ 恒空注入下**平凡绿**（这是立项的收口条件）；
 * `MIN=1`/`MIN=35` ⇒ 恒空注入下**红**。故下限**不得**写成 0 / 恒真。
 *
 * 2026-09-20 实测 35（`src/mechanics/agents/*.ts` 里含 `settings: [` 块的文件数）。
 * ⚠ 模块数**自然减少**（模块合并/改名/搬目录）时会红——那是提醒「下限要重新标定」：
 * 按实测值下调并写进提交说明，**不要顺手删判据**（同 `LAYER_INVERSION_MIN_TOTAL_SITES` 纪律）。
 */
export const SETTINGS_COVERAGE_MIN_MODULES = 35

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

/**
 * 判据 4 的合取：无新缺口 ∧ 扫描面非空洞（反空洞下限）。
 *
 * ⚠ `minModules` 缺省 = 冻结常量；显式传参只给测试夹具用（同 `layerInversionOk(report, minTotal)` 先例）。
 */
export function settingsCoverageOk(report, newGaps, minModules = SETTINGS_COVERAGE_MIN_MODULES) {
  return newGaps.length === 0 && report.declared.size >= minModules
}

/** 归因输出（只在红时打印） */
export function formatSettingsCoverage(report, newGaps, minModules = SETTINGS_COVERAGE_MIN_MODULES) {
  const out = [
    ...newGaps.map(e => `  ✗ 新滑块无测试引用：${e} → 补「改滑块→面板/结果确实变」的生效测试（ARCHITECTURE.md §3 滑块行，般岳 rageGainCoverage 曾静默失效）`),
    ...report.stale.map(e => `  ⚠ 清单可回收：${e} 已有测试，从 UNTESTED_SETTINGS_ALLOWLIST 删掉该行`),
  ]
  if (report.declared.size < minModules) {
    out.push(`  ✗ 反空洞下限：扫到 ${report.declared.size} 个声明 settings 的模块 < ${minModules} —— 抽取器疑似失效（恒空注入实测会打印「已测 0/0」并全绿）`)
    out.push('    → 先核 src/mechanics/agents/ 是否仍是要扫的目录、块起始正则是否还认得 `settings: [` 形态；')
    out.push('      确系模块自然减少再按实测下调 SETTINGS_COVERAGE_MIN_MODULES 并写明理由')
  }
  return out
}
