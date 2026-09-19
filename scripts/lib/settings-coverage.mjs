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
 */
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** 仓库根（从 `scripts/lib/` 上溯三级；与 check-guards.mjs 的 ROOT 同值） */
const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))))

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
