/**
 * 自动预设生成器（用户 2026-09-03）：把「最低金顶分 +2」窗口的全部队伍收进预设库。
 *
 * 口径与 consumer 同源声明：
 * - **金数走单一事实源 `src/composables/limitedGold.ts#runLimitedGold`**（经 `lib/ts-modules.mjs`
 *   用 vite ssrLoadModule 载入；规则 11）。本脚本曾自抄一份 `memberGold`，与 TS 侧**口径分叉**：
 *   常驻 S 名单 11 个 vs 6 个（多出 1011/1051/1061/1081/1111/1241/1261），且把音擎精炼
 *   **无条件**计金（TS 侧只在 `weaponId` 认得出是限定 S 音擎时才计）。两处对同一份归档算出
 *   不同金数且都不报错——2026-10-08 归档重整时一并收口。
 * - 前沿 = 每 room（seasonId|targetId）顶分击杀 run 的最低金 + 2 窗口（lowGoldFrontier 同逻辑）。
 * - 生成条目：group/subgroup 走 `scripts/lib/presetCategories.mjs` 单源判定——
 *   一级 = 队伍**输出核心**职业（强攻/命破/异常/锋御队），二级 = 该核心属性。
 *   输出核心 = 槽位 0（本库约定 0=主C）；槽位 0 是击破/支援/防护等辅助位时，
 *   退到队内第一个输出定位成员；整队无输出位 → 跳过不收录（用户 2026-09-08：
 *   「击破队和支援队没必要分…他们是辅助，怎么能作为一个命名呢」。旧版把 team[0]
 *   职业直接当队名，于是 耀嘉音/柚叶 带队的实战队塞出了「支援队」这类假分类）。
 *   goldSteps = []（默认 01 基线——用户「默认配置全 01」；
 *   实战命座/精炼记入 note 出处）；interactions = []（不预设，走角色职业基准——用户 09-11「完全不需要以前这个死数值」，CC-261）。
 * - 同名队去重：**成员集合相同（顺序无关）= 同一队**，只留 1 条（保留判据见去重段）；
 *   本脚本会清理 `auto-*` 孤儿文件（上一轮生成但本轮不再产出的），手编预设不受影响。
 * - 同一口径的回填/校验：`node scripts/sync-preset-categories.mjs`（手编预设 subgroup
 *   漏填曾让「命破队·火」只出 1 条，般岳其余配队掉进「未分属性」看不见）。
 *
 * 用法：node scripts/gen-auto-presets.mjs
 */
import { readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { classifyPreset, resolveCarryAgent } from './lib/presetCategories.mjs'
import { loadTsModule, closeTsModules } from './lib/ts-modules.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const archive = JSON.parse(readFileSync(join(root, 'public/static/run-archive.json'), 'utf8'))
const bossFile = JSON.parse(readFileSync(join(root, 'public/static/boss-presets.json'), 'utf8'))
const catalog = JSON.parse(readFileSync(join(root, 'public/static/catalog.json'), 'utf8'))

// 金数口径单一事实源（规则 11）：与 RunArchivePage / pullValue / charIncrement 同一实现。
const { runLimitedGold: teamGold } = await loadTsModule(root, '/src/composables/limitedGold.ts')

const agentById = new Map(catalog.agents.map(a => [String(a.id), a]))
const wEngineIds = new Set(catalog.wEngines.map(w => String(w.id)))
const nameOf = (id) => agentById.get(String(id))?.name?.zhCN ?? id
const agentOf = (id) => agentById.get(String(id))

// 前沿：每 room 顶分击杀 run → 最低金 + 2 窗口
const byRoom = new Map()
for (const r of archive.runs ?? []) {
  if (r.bossKilled !== true) continue
  if (!Array.isArray(r.team) || r.team.length !== 3) continue
  if (r.team.some(m => !m?.agentId || !agentById.has(String(m.agentId)))) continue
  const key = `${r.seasonId}|${r.targetId}`
  const e = byRoom.get(key) ?? { maxScore: 0, runs: [] }
  e.runs.push(r)
  if ((r.score ?? 0) > e.maxScore) e.maxScore = r.score
  byRoom.set(key, e)
}
const frontier = []
for (const { maxScore, runs } of byRoom.values()) {
  const top = runs.filter(r => r.score === maxScore)
  const minGold = Math.min(...top.map(r => teamGold(r.team)))
  for (const r of top) if (teamGold(r.team) <= minGold + 2) frontier.push(r)
}

// 按队伍组合去重（同 3 角色 = 1 条，**与槽位顺序无关**）。
// 修复 2026-09-13：旧签名 `team.map(agentId).join('+')` 顺序敏感——同一 3 人换位即不同签名，
// 曾产出 11 组重复（14 条冗余，如 auto-1091-1031-1511 与 auto-1091-1511-1031 实为同一队）。
// 排序键 = 成员 id 升序拼接；保留判据：金数低 > score 高 > 槽位 0 是输出核心（展示口径
// 本库约定 0=主C）> run id 字典序（纯确定性兜底）。
// @fact engine:preset/队伍身份 口径: 成员集合顺序无关——同 3 人换槽位 = 同队只留 1 条；保留判据 金数低 > score 高 > 槽位 0 是输出核心 > run id 字典序 |据 用户报障@2026-09-13·复核@2026-09-25·复核@2026-09-30 |验 src/data/__tests__/teamPresets.test.ts「auto-* 预设按成员集合去重」 |锚 scripts/gen-auto-presets.mjs#better |信 高
// ⟳复核: 若放宽到 4 人队 / 允许同队多形态共存（如按轴分家）时，确认「成员集合 = 队伍身份」这条去重口径仍成立，并同步保留判据 | 到期 2026-12-31
const byTeam = new Map()
const better = (r, cur) => {
  const g = teamGold(r.team) - teamGold(cur.team)
  if (g !== 0) return g < 0
  const s = (r.score ?? 0) - (cur.score ?? 0)
  if (s !== 0) return s > 0
  const carryFirst = (x) => (resolveCarryAgent(x.team.map(m => String(m.agentId)), agentOf) === String(x.team[0].agentId) ? 0 : 1)
  const c = carryFirst(r) - carryFirst(cur)
  if (c !== 0) return c < 0
  return String(r.id) < String(cur.id)
}
for (const r of frontier) {
  const sig = [...r.team.map(m => String(m.agentId))].sort().join('+')
  const cur = byTeam.get(sig)
  if (!cur || better(r, cur)) byTeam.set(sig, r)
}

/*
 * ⚠ 跨来源去重：**已被现有预设覆盖的成员集，不再产出 auto- 孪生**（2026-10-12 用户报
 * 「还有重复的队伍，仪玄卢西娅队」）。
 *
 * 上面那段只在本脚本**自己产出的** frontier 之间去重，对手编预设视而不见 ⇒ 同一 3 人
 * 会同时存在 `auto-1371-1391-1451`（仪玄+橘福福+卢西娅·艾洛温）与 `yixuan-jufufu-lucia`
 * （仪玄+橘福福+卢西娅）两条，在下拉里就是同一支队出现两次。
 * 实测（修复前）：4 组这样的孪生——仪玄橘福福卢西娅 / 般岳琉音卢西娅 / 克拉蕾珂蕾妲丽娜 /
 * 克拉蕾洛克茜丽娜。
 *
 * 口径依据 = `src/data/teamPresets.ts` 头注释记的用户裁决（2026-09-11）：
 * 「同名队只留一条……auto- 保留为**唯一来源**；手编只在没有 auto 孪生时保留」。
 * ⚠ 本脚本**不删手编**（那是数据改动，且手编可能带策划字段）——这里只保证**不再新增**孪生；
 * 存量由人工按同一条口径清理。这样重跑本脚本不会把删掉的孪生又生成回来。
 */
const outDirForDedup = outDir
const existingSignatures = new Set()
for (const f of readdirSync(outDirForDedup)) {
  if (!f.endsWith('.json') || f.startsWith('_') || f.startsWith('auto-')) continue
  try {
    const p = JSON.parse(readFileSync(join(outDirForDedup, f), 'utf8'))
    if (!Array.isArray(p.team) || p.team.length !== 3) continue
    existingSignatures.add([...p.team.map(String)].sort().join('+'))
  } catch { /* 坏文件交给 validate:data 报，不在这里吞成「无冲突」 */ }
}
let skippedTwins = 0
for (const sig of [...byTeam.keys()]) {
  if (existingSignatures.has(sig)) { byTeam.delete(sig); skippedTwins++ }
}
if (skippedTwins) console.log(`跳过已被现有预设覆盖的成员集 ${skippedTwins} 条（防 auto- 孪生重复）`)

const kebab = (s) => s.replace(/[^a-z0-9]+/gi, '-').toLowerCase().replace(/^-|-$/g, '')
const presets = [...byTeam.values()].sort((a, b) => String(a.team[0].agentId).localeCompare(String(b.team[0].agentId))).flatMap(r => {
  // 一级/二级分类 = 队伍输出核心（槽位 0 是辅助位则退到队内输出位）的职业/属性
  const verdict = classifyPreset(r.team.map(m => String(m.agentId)), agentOf)
  if (!verdict) return [] // 整队无输出位：击破/支援不构成队伍分类，跳过
  const gold = teamGold(r.team)
  const configText = r.team.map(m => `${nameOf(m.agentId)} M${m.mindscape ?? 0}·精${m.phase ?? 1}·${m.weaponId ?? '-'}`).join(' / ')
  return {
    id: `auto-${kebab(r.team.map(m => m.agentId).join('-'))}`,
    group: verdict.group,
    subgroup: verdict.subgroup,
    // 命名只带人物组成（用户 2026-09-03：自动无有效信息、低金可改金数，都不入名）
    name: r.team.map(m => nameOf(m.agentId)).join('+'),
    note: `自动收录自实战顶分：${r.id}｜${r.score} 分 ${r.timeSeconds}s｜实战配装：${configText}｜金数 ${gold}（最低金+窗口收录，用户 2026-09-03）。默认 01 基线（goldSteps 空）；交互不预设，走角色职业基准（setAgent 预填，CC-261）；命中数据有出入可在此修订。`,
    team: r.team.map(m => m.agentId),
    wEngines: r.team.map(m => (m.weaponId && wEngineIds.has(String(m.weaponId))) ? String(m.weaponId) : ''),
    goldSteps: [],
    // 交互不预设（CC-261）：旧 parry8/dodge4 占位（用户 09-03）已被 09-04「setAgent 按职业基准预填」
    // 与 09-11「完全不需要以前这个死数值」取代；空数组 = 走 interactionBaselineFor（含模块专属默认）。
    interactions: [],
  }
})

const outDir = join(root, 'src/data/teamPresets')
// 每文件 1 条预设（validate-data 校验器按单条对象读取；loader glob ./teamPresets/*.json 兼容）
for (const p of presets) {
  writeFileSync(join(outDir, `${p.id}.json`), JSON.stringify(p, null, 2) + '\n')
}
// 孤儿清理：auto-* 只由本脚本产出（用户 2026-09-11 裁决「同名队 auto- 为唯一来源」），
// 本轮没再生成的 auto-* 文件 = 上一轮遗留（重复队被去重 / 归档数据变动），删掉防止复活。
const keepIds = new Set(presets.map(p => `${p.id}.json`))
let removed = 0
for (const f of readdirSync(outDir)) {
  if (!f.startsWith('auto-') || !f.endsWith('.json') || keepIds.has(f)) continue
  unlinkSync(join(outDir, f))
  removed++
}
if (removed) console.log(`清理孤儿 auto-* 文件 ${removed} 条`)
const groupCount = {}
for (const p of presets) groupCount[`${p.group} · ${p.subgroup}`] = (groupCount[`${p.group} · ${p.subgroup}`] ?? 0) + 1
console.log(`前沿 ${frontier.length} 队 → 去重后 ${presets.length} 条自动预设`)
console.log('分组分布:', Object.entries(groupCount).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(' | '))

// vite 服务句柄不关会让进程不退出（ts-modules 的契约）
await closeTsModules()
