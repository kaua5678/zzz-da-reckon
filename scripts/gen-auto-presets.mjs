/**
 * 自动预设生成器（用户 2026-09-03）：把「最低金顶分 +2」窗口的全部队伍收进预设库。
 *
 * 口径与 consumer 同源声明：
 * - 金数 = 限定 S 本体 1 + 影画 + 精炼(phase−1)；常驻 S（STANDARD_S_AGENT_IDS）与
 *   AGENT_RELEASE_NODE 无条目（四星/A 级）不计——与 src/composables/limitedGold.ts 同口径。
 * - 前沿 = 每 room（seasonId|targetId）顶分击杀 run 的最低金 + 2 窗口（lowGoldFrontier 同逻辑）。
 * - 生成条目：group = 主C 职业（命破/异常/强攻/击破/支援/防护/锋御队），
 *   subgroup = 主C 元素；goldSteps = []（默认 01 基线——用户「默认配置全 01」；
 *   实战命座/精炼记入 note 出处）；interactions = []（难度 0，自动队供参考）。
 * - 常驻 S 名单与发布节点：↓ 两处键级常量与 TS 侧同源（改动需同步）：
 *   src/composables/teamCompare.ts STANDARD_S_AGENT_IDS、src/data/versionTimeline.ts AGENT_RELEASE_NODE。
 *
 * 用法：node scripts/gen-auto-presets.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const archive = JSON.parse(readFileSync(join(root, 'public/static/run-archive.json'), 'utf8'))
const bossFile = JSON.parse(readFileSync(join(root, 'public/static/boss-presets.json'), 'utf8'))
const catalog = JSON.parse(readFileSync(join(root, 'public/static/catalog.json'), 'utf8'))

const STANDARD_S_AGENT_IDS = new Set(['1011', '1021', '1041', '1051', '1061', '1081', '1111', '1141', '1211', '1241', '1261'])
const AGENT_RELEASE_NODE = { 1371: 1, 1391: 1, 1401: 1, 1301: 1, 1051: 1, 1481: 1, 1471: 1, 1431: 1, 1491: 1, 1501: 1, 1511: 1, 1521: 1, 1531: 1, 1561: 1, 1571: 1, 1581: 1, 1591: 1, 1621: 1, 1611: 1, 1091: 1, 1291: 1, 1281: 1, 1171: 1, 1131: 1, 1421: 1, 1541: 1, 1351: 1, 1551: 1, 1461: 1, 1331: 1, 1231: 1, 1101: 1 }

function memberGold(m) {
  if (!AGENT_RELEASE_NODE[m.agentId]) return 0
  if (STANDARD_S_AGENT_IDS.has(m.agentId)) return 0
  return 1 + (m.mindscape ?? 0) + Math.max(0, (m.phase ?? 1) - 1)
}
const teamGold = (team) => team.reduce((s, m) => s + memberGold(m), 0)

const agentById = new Map(catalog.agents.map(a => [String(a.id), a]))
const wEngineIds = new Set(catalog.wEngines.map(w => String(w.id)))
const nameOf = (id) => agentById.get(String(id))?.name?.zhCN ?? id
const ELEMENT_LABEL = { physical: '物理', fire: '火', ice: '冰', electric: '电', ether: '以太', wind: '风', frostfire: '烈霜' }
const SPEC_GROUP = { rupture: '命破队', anomaly: '异常队', attack: '强攻队', stun: '击破队', support: '支援队', defense: '防护队', sharpen: '锋御队' }

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

// 按队伍组合去重（同 3 角色 = 1 条；保留金数最低、平手取 score 高者）
const byTeam = new Map()
for (const r of frontier) {
  const sig = r.team.map(m => m.agentId).join('+')
  const cur = byTeam.get(sig)
  if (!cur || teamGold(r.team) < teamGold(cur.team) || (teamGold(r.team) === teamGold(cur.team) && (r.score ?? 0) > (cur.score ?? 0))) byTeam.set(sig, r)
}

const kebab = (s) => s.replace(/[^a-z0-9]+/gi, '-').toLowerCase().replace(/^-|-$/g, '')
const presets = [...byTeam.values()].sort((a, b) => String(a.team[0].agentId).localeCompare(String(b.team[0].agentId))).map(r => {
  const main = agentById.get(String(r.team[0].agentId))
  const spec = main?.specialty ?? 'attack'
  const el = main?.damageElement ?? 'physical'
  const gold = teamGold(r.team)
  const configText = r.team.map(m => `${nameOf(m.agentId)} M${m.mindscape ?? 0}·精${m.phase ?? 1}·${m.weaponId ?? '-'}`).join(' / ')
  return {
    id: `auto-${kebab(r.team.map(m => m.agentId).join('-'))}`,
    group: SPEC_GROUP[spec] ?? '强攻队',
    subgroup: ELEMENT_LABEL[el] ?? el,
    name: r.team.map(m => nameOf(m.agentId)).join('+') + '（自动·低金）',
    note: `自动收录自实战顶分：${r.id}｜${r.score} 分 ${r.timeSeconds}s｜实战配装：${configText}｜金数 ${gold}（最低金+窗口收录，用户 2026-09-03）。默认 01 基线（goldSteps 空）；命中数据有出入可在此修订。`,
    team: r.team.map(m => m.agentId),
    wEngines: r.team.map(m => (m.weaponId && wEngineIds.has(String(m.weaponId))) ? String(m.weaponId) : ''),
    goldSteps: [],
    interactions: [],
  }
})

const outDir = join(root, 'src/data/teamPresets')
// 每文件 1 条预设（validate-data 校验器按单条对象读取；loader glob ./teamPresets/*.json 兼容）
for (const p of presets) {
  writeFileSync(join(outDir, `${p.id}.json`), JSON.stringify(p, null, 2) + '\n')
}
const groupCount = {}
for (const p of presets) groupCount[`${p.group} · ${p.subgroup}`] = (groupCount[`${p.group} · ${p.subgroup}`] ?? 0) + 1
console.log(`前沿 ${frontier.length} 队 → 去重后 ${presets.length} 条自动预设`)
console.log('分组分布:', Object.entries(groupCount).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(' | '))
