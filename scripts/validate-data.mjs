import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { CATALOG_FIELDS } from './lib/catalog-fields.mjs'
import { classifyPreset } from './lib/presetCategories.mjs'
import { JSON_CONTRACTS, checkJsonContracts, findUncoveredJsonEntries, formatJsonContractErrors, jsonContractSelfTest } from './lib/json-contract.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
let failed = 0
let checks = 0

function load(relativePath) {
  return JSON.parse(readFileSync(join(root, relativePath), 'utf8'))
}

function check(name, condition, detail = '') {
  checks++
  if (condition) {
    console.log(`  ok ${name}`)
  } else {
    failed++
    console.log(`  FAIL ${name}${detail ? ` - ${detail}` : ''}`)
  }
}

const catalog = load('public/static/catalog.json')

// ===== 产物不变量（2026-08-27）：生成产物必须紧凑、catalog.json 只含 Catalog 类型字段 =====
// 历史：import 脚本全部 JSON.stringify(x, null, 2) 回写，catalog.json 膨胀到 ~5.2MB（compact ~2.6MB），
// 且「读整份→改→写整份」循环把无人消费的 legacy 字段永久携带。护栏强制后，再膨胀/再引入死键即红。
// 修复入口：npm run minify:static
{
  const catalogKeys = Object.keys(catalog).sort()
  const expectedKeys = [...CATALOG_FIELDS].sort()
  const extra = catalogKeys.filter(k => !expectedKeys.includes(k))
  const missing = expectedKeys.filter(k => !catalogKeys.includes(k))
  check('catalog.json top-level keys match Catalog whitelist',
    extra.length === 0 && missing.length === 0,
    `extra: ${extra.join(', ') || 'none'}; missing: ${missing.join(', ') || 'none'} → npm run minify:static`)

  for (const f of readdirSync(join(root, 'public', 'static'))) {
    if (!f.endsWith('.json')) continue
    const raw = readFileSync(join(root, 'public', 'static', f), 'utf8')
    const compactBytes = Buffer.byteLength(JSON.stringify(JSON.parse(raw)))
    check(`public/static/${f} is compact JSON`,
      Buffer.byteLength(raw) - compactBytes <= 1,
      `${Buffer.byteLength(raw)}B vs compact ${compactBytes}B → npm run minify:static`)
  }
}

// ===== 外部 JSON 类型契约（r725）：代码把 JSON 转型成什么 TS 类型，数据就得符合那个类型（scripts/lib/json-contract.mjs）=====
// 判据 28（死兜底）据此信任这些类型、不设豁免；下面手写的只剩类型表达不了的语义（唯一、引用存在、非空、整数……）。
{
  const self = jsonContractSelfTest()
  check('json-contract validator self-test (good sample clean, each bad kind caught)', self.ok, self.failures.join('; '))
  const uncovered = findUncoveredJsonEntries(root)
  check(`every JSON entry in src is registered in JSON_CONTRACTS (${JSON_CONTRACTS.length} entries)`, uncovered.length === 0,
    `未登记：${uncovered.join('; ')} → 在 scripts/lib/json-contract.mjs 登记入口与代码转型用的类型`)
  const { files, errors } = checkJsonContracts(root)
  check(`JSON data matches the TS types code casts it to (${files} files)`, errors.length === 0,
    `${errors.length} 处不符（按入口 / 键汇总如下）：数据真缺 ⇒ 字段改可选；数据写错 ⇒ 改数据与生成脚本`)
  for (const line of formatJsonContractErrors(errors)) console.log(line)
}

const agents = catalog.agents ?? []
const agentById = new Map(agents.map(a => [String(a.id), a]))
const agentOf = id => agentById.get(String(id))
const ENGINE_POOLS = load('src/data/enginePools.json')
const catalogWEngines = new Set((load('public/static/catalog.json').wEngines ?? []).map(w => String(w.id)))
const skills = catalog.agentSkills ?? []

check('catalog has agents and skills', agents.length > 0 && skills.length > 0)
check('agent/skill tables match in count', agents.length === skills.length)
check('agent ids are unique', new Set(agents.map(a => a.id)).size === agents.length)
check('skill agent ids are unique', new Set(skills.map(s => s.agentId)).size === skills.length)

const skillIds = new Set(skills.map(s => s.agentId))
check('every agent has a skills table', agents.every(a => skillIds.has(a.id)))

for (const key of ['wEngines', 'driveDiscSets', 'bosses']) {
  const rows = catalog[key] ?? []
  check(`${key} is a non-empty array`, Array.isArray(rows) && rows.length > 0)
  check(`${key} ids are unique`, new Set(rows.map(r => r.id)).size === rows.length)
}

const allowedStatuses = new Set([
  'implemented',
  'implemented_generic_skill_level',
  'implemented_approximation',
  'implemented_expected_value',
  'implemented_state_machine',
  'implemented_state_machine_approximation',
  'partially_implemented',
  'not_described_not_implemented',
])

for (const file of ['character-mechanics.json', 'character-constellations.json']) {
  const data = load(`public/static/${file}`)
  const unknown = []

  const walk = (value) => {
    if (!value || typeof value !== 'object') return
    if (typeof value.status === 'string' && !allowedStatuses.has(value.status)) {
      unknown.push(value.status)
    }
    for (const child of Object.values(value)) walk(child)
  }
  walk(data)

  check(`${file} parses and uses known status values`, unknown.length === 0, unknown.join(', '))
}

check('teammate buffs data is present', load('public/static/teammate-buffs.json').length > 0)

// ===== 数据管道坑校验（替代 md 散文，机器强制） =====

// 1. faction 非空：额外能力 sameFactionAsSelf 依赖；由 scripts/import-factions.mjs 从 nanoka camp 录入。
const emptyFaction = agents.filter(a => !a.faction || String(a.faction).trim() === '').map(a => a.id)
check('every agent has non-empty faction', emptyFaction.length === 0, `缺失 faction: ${emptyFaction.join(', ')} → node scripts/import-factions.mjs --write`)

// 2. attack_data 导入完整性：nanoka 有非零 attack_data 的 move，catalog 也要有 attack_data_0 行。
//    老/slug 角色曾用旧脚本导入、漏 attack_data；新角色用 import-nanoka-missing.mjs 会导。
function buildNanokaAttackDataMoves() {
  const set = new Set()
  const scanSkillsJson = (path) => {
    try {
      const data = JSON.parse(readFileSync(path, 'utf8'))
      for (const s of data.skills ?? []) {
        if ((s.attack_data ?? []).some(v => v > 0)) set.add(String(s.id))
      }
    } catch { /* 忽略损坏文件 */ }
  }
  const rawDir = join(root, 'data/raw/nanoka_missing')
  if (existsSync(rawDir)) {
    for (const f of readdirSync(rawDir)) if (f.endsWith('_skills.json')) scanSkillsJson(join(rawDir, f))
  }
  const auditDir = join(root, 'data/raw/audit')
  if (existsSync(auditDir)) {
    for (const f of readdirSync(auditDir)) {
      if (!f.endsWith('.json')) continue
      try {
        const data = JSON.parse(readFileSync(join(auditDir, f), 'utf8'))
        for (const cat of Object.values(data.skill ?? {})) {
          for (const desc of cat.description ?? []) {
            for (const pe of desc.param ?? []) {
              for (const [moveId, v] of Object.entries(pe.param ?? {})) {
                if ((v?.attack_data ?? []).some(x => x > 0)) set.add(String(moveId))
              }
            }
          }
        }
      } catch { /* 忽略损坏文件 */ }
    }
  }
  return set
}

const nanokaAttackDataMoves = buildNanokaAttackDataMoves()
const missingAttackData = []
for (const s of skills) {
  for (const cat of s.categories ?? []) {
    for (const m of cat.moves ?? []) {
      if (nanokaAttackDataMoves.has(m.id) && !m.rows.some(r => String(r.id).startsWith('attack_data_'))) {
        missingAttackData.push(`${s.agentId}:${m.id}`)
      }
    }
  }
}
check('attack_data imported for moves that nanoka provides', missingAttackData.length === 0, `缺 attack_data: ${missingAttackData.join(', ')} → node scripts/import-attack-data.mjs <nanokaId> --write`)

// ===== src/data JSON 解析校验（import.meta.glob 运行时加载的坏 JSON 要到页面才炸） =====
function walkJson(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walkJson(p))
    else if (entry.name.endsWith('.json')) out.push(p)
  }
  return out
}
const dataJsonFiles = walkJson(join(root, 'src', 'data'))
let dataJsonParseFailed = false
for (const f of dataJsonFiles) {
  try {
    JSON.parse(readFileSync(f, 'utf8'))
  } catch (e) {
    dataJsonParseFailed = true
    console.log(`  FAIL ${f.replace(join(root, 'src', 'data') + '/', '')} JSON 解析失败 - ${e.message}`)
  }
}
check('src/data/**/*.json all parse', !dataJsonParseFailed)

for (const f of dataJsonFiles) {
  const rel = f.replace(join(root, 'src', 'data') + '/', '')
  const data = JSON.parse(readFileSync(f, 'utf8'))
  if (rel.startsWith('teamPresets/')) {
    // 分类口径护栏（用户 2026-09-08）：一级=输出核心职业队名、二级=该核心属性，
    // 单源在 scripts/lib/presetCategories.mjs。漏填 subgroup 会让预设掉进「未分属性」
    // （选「命破队·火」看不见般岳其余配队就是这么来的）；把击破/支援写成 group 也在此拦。
    if (!data.disabled) {
      const verdict = classifyPreset((data.team ?? []).map(String), agentOf)
      check(`${rel}: group/subgroup 符合分类口径`,
        !!verdict && data.group === verdict.group && data.subgroup === verdict.subgroup,
        verdict ? `实际 ${data.group}/${data.subgroup ?? '（缺）'}，应为 ${verdict.group}/${verdict.subgroup}（跑 node scripts/sync-preset-categories.mjs）`
                : `${data.group}/${data.subgroup ?? '（缺）'}——队内无输出位（击破/支援/防护不构成队伍分类）`)
    }
    // autoEngine 声明校验：poolRef 必须在命名池有定义；池内音擎 id 必须在 catalog 存在（防手滑 typo）
    const ae = data.autoEngine
    if (ae) {
      const layers = [ae, ...Object.values(ae.byAgent ?? {}), ...Object.values(ae.bySlot ?? {})]
      for (let li = 0; li < layers.length; li++) {
        const layer = layers[li]
        for (const ref of layer?.poolRef ? [layer.poolRef] : []) {
          check(`${rel}: autoEngine poolRef「${ref}」在 enginePools 有定义`, ENGINE_POOLS[ref] != null)
        }
        for (const id of layer?.pool ?? []) {
          check(`${rel}: autoEngine 音擎 ${id} 在 catalog`, catalogWEngines.has(String(id)))
        }
      }
    }
  } else if (rel.startsWith('stunAxisPresets/')) {
    // 字段与类型由上面的 JSON 契约校验（StunAxisPreset；加载器 r727 起不做运行时过滤、直接转型）；这里只查类型表达不了的：
    // axes / plans 至少其一、动作槽位是整数、team 每项是 '*' 或 catalog 里的角色（写错的 id 让预设永远匹配不上，且不报错）
    const axes = [...(data.axes ?? []), ...(data.plans ?? []).flatMap(p => p.axes ?? [])]
    const badSlots = axes.flatMap(ax => (ax.actions ?? []).filter(a => !Number.isInteger(a.slot)).map(a => `${ax.name}/${a.moveId}`))
    const badTeam = (data.team ?? []).filter(t => t !== '*' && !agentOf(t)).map(t => `team ${t}`)
    check(`${rel}: has axes or plans; every action slot is an integer; team ids are '*' or catalog agents`,
      (Array.isArray(data.axes) || Array.isArray(data.plans)) && badSlots.length === 0 && badTeam.length === 0,
      [...badSlots.slice(0, 5), ...badTeam].join('; '))
  }
}

/**
 * 轴预设 id **跨文件唯一**（2026-10-05，§20.5-3 旁路发现）。
 *
 * 为什么必须拦：`stunAxisPresets.ts` 用 `Object.values(import.meta.glob(...))` 装载（文件序），
 * 而 `selectAutoStunAxisPreset` 的消歧链是「章过滤 → 有琉优先 → 有 plans 优先 → candidates[0]」
 * ——**没有 tie-break** ⇒ 同 id 两条同时命中时，**选中谁取决于文件名序**，不确定。
 * 实测历史缺陷（2026-10-05 已修）：`般其他.json`(team 通配 `1471` + 两个星号槽) 与
 * `般诺通用.json`(team `1471` + `1571` + 星号) 同 id `preset-1471-1571-1451`。
 *
 * ⚠ **当前影响面 = 0**（实测，勿夸大）：全库唯一真正同时命中两条同 id 轴的队是
 * `auto-1471-1571-1451`，而它**会弃轴** ⇒ 两条候选殊途同归。
 * 故本判据是**防未来踩坑的数据完整性护栏**，不是「正在算错的 bug」的修复。
 * 完整可达性枚举：`.claude/axis-absorb-predictions.md` §26。
 */
const axisPresetIdOwners = new Map()
const axisPresetIdDupes = []
for (const f of dataJsonFiles) {
  const rel = f.replace(join(root, 'src', 'data') + '/', '')
  if (!rel.startsWith('stunAxisPresets/')) continue
  const data = JSON.parse(readFileSync(f, 'utf8'))
  if (typeof data.id !== 'string') continue
  const prev = axisPresetIdOwners.get(data.id)
  if (prev === undefined) { axisPresetIdOwners.set(data.id, rel); continue }
  axisPresetIdDupes.push(`${data.id}（${prev} 与 ${rel}）`)
}
check(`stunAxisPresets ids are unique across files${axisPresetIdDupes.length ? '：重复 ' + axisPresetIdDupes.join('、') : ''}`,
  axisPresetIdDupes.length === 0)

// ===== 状态表同步护栏（README §3.7）：新增角色必须同步两张状态表 =====
// 历史欠账白名单：数据补齐后逐条删除（删除后即强制）。护栏只约束「新增缺口」，不自动补数据。
const KNOWN_MISSING_MECHANICS_CHARACTERS = new Set([
  '1261', '1411', '1171', '1511', '1491', '1341', '1311', '1151', '1031',
  '1131', '1221', '1161', '1251', '1361', '1241', '1071', '1521', '1301',
  '1461', '1421', '1611', '1621',
])
const KNOWN_MISSING_CONSTELLATION_CHARACTERS = new Set(['1611', '1621'])

const mechanicsChars = new Set(Object.keys((load('public/static/character-mechanics.json').characters ?? {})))
const constellationChars = new Set(Object.keys((load('public/static/character-constellations.json').characters ?? {})))

const missingMechanics = agents.filter(a => !mechanicsChars.has(String(a.id)) && !KNOWN_MISSING_MECHANICS_CHARACTERS.has(String(a.id)))
check('every catalog agent has a character-mechanics.json entry (or whitelisted historical debt)',
  missingMechanics.length === 0,
  `缺 mechanics 条目: ${missingMechanics.map(a => a.id).join(', ')} → 同步 README §3.7，补齐后从 KNOWN_MISSING_MECHANICS_CHARACTERS 删除`)

const missingConstellations = agents.filter(a => !constellationChars.has(String(a.id)) && !KNOWN_MISSING_CONSTELLATION_CHARACTERS.has(String(a.id)))
check('every catalog agent has a character-constellations.json entry (or whitelisted historical debt)',
  missingConstellations.length === 0,
  `缺 constellations 条目: ${missingConstellations.map(a => a.id).join(', ')} → 同步 README §3.7，补齐后从 KNOWN_MISSING_CONSTELLATION_CHARACTERS 删除`)

const orphanMechanics = [...mechanicsChars].filter(id => !agents.some(a => String(a.id) === id))
const orphanConstellations = [...constellationChars].filter(id => !agents.some(a => String(a.id) === id))
check('status tables have no orphan ids (absent from catalog)', orphanMechanics.length === 0 && orphanConstellations.length === 0,
  `orphan mechanics: ${orphanMechanics.join(', ')}; orphan constellations: ${orphanConstellations.join(', ')}`)

// 单一事实源（规则 8/11）：核心被动/额外能力只记在 mechanics[]，禁止顶层重复字段
// （历史上顶层 corePassive/additionalAbility 是 sync 占位、从不回填 → 与 mechanics[] 漂移、
// 且被 generate-implementation-status 漏读；2026-09-04 归一，此护栏防回归）。
// @fact engine:mechanics单一事实源 口径: 角色核心被动/额外能力只记在 character-mechanics.json 的 mechanics[]，禁止顶层 corePassive/additionalAbility 重复字段（顶层占位从不回填会漂移且被状态表漏读）| 据 用户@2026-09-04·复核@2026-09-25 | 锚 scripts/validate-data.mjs#dupTopLevel | 信 确认
const mechData = load('public/static/character-mechanics.json').characters ?? {}
const dupTopLevel = Object.entries(mechData)
  .filter(([, c]) => c && (c.corePassive != null || c.additionalAbility != null))
  .map(([id]) => id)
check('character-mechanics has no top-level corePassive/additionalAbility (single source = mechanics[])',
  dupTopLevel.length === 0,
  `顶层重复字段（应并入 mechanics[] 后删除）: ${dupTopLevel.join(', ')}`)

// 单一事实源（规则 8/11）：命座状态只记在 constellations.cinemas，禁止 mechanics 角色条目
// 再带 cinemaImplementation / cinemaImplementations 镜像（历史上由 sync 写占位、从不回填 →
// 与 constellations 漂移 62 档/21 角色、零运行时读者；2026-09-25 W29 删除，此护栏防回归）。
// @fact engine:mechanics命座单一事实源 口径: character-mechanics.json 角色条目禁止 cinemaImplementation/cinemaImplementations 镜像字段，命座状态单源 = character-constellations.json#characters.<id>.cinemas（镜像占位从不回填会漂移）| 据 lead-arena-0925b@2026-09-25（W28） | 验 npm run validate:data | 锚 scripts/validate-data.mjs#cinemaMirrorKeys | 信 高
const cinemaMirrorKeys = /^cinemaImplementations?$/
const cinemaMirrors = Object.entries(mechData)
  .flatMap(([id, c]) => Object.keys(c ?? {}).filter(k => cinemaMirrorKeys.test(k)).map(k => `${id}.${k}`))
check('character-mechanics has no cinemaImplementation(s) mirror (single source = constellations.cinemas)',
  cinemaMirrors.length === 0,
  `命座镜像字段（应删，单源 = character-constellations.json#characters.<id>.cinemas）: ${cinemaMirrors.join(', ')}`)

// Boss 预设（r724 起 applyBossPreset 写进 EnemyConfig 的字段读点不兜底）：字段与类型由上面的 JSON 契约校验（BossPresetFile）。
// 三张抗性表的类型是 ResistanceTable（标准 6 元素各一项），缺键由契约报——r756 起这里不再另抄一份元素清单。
// 这里只查类型表达不了的：每个预设至少一个相位。
{
  const presets = load('public/static/boss-presets.json').bosses ?? []
  const bad = presets.filter(b => !(b.phases?.length > 0)).map(b => `${b.id}: phases`)
  check(`boss-presets: every preset has phases (${presets.length} presets)`,
    presets.length > 0 && bad.length === 0, bad.slice(0, 8).join('; '))
}

console.log(failed === 0 ? `\n${checks} data checks passed` : `\n${failed} data check(s) failed`)
process.exit(failed === 0 ? 0 : 1)
