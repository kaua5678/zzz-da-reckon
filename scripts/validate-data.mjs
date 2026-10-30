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
    // 预设文件只带「身份 + 策划标签」：配装类字段一律派生（用户 2026-10-26「预设队伍只需带 3 个人的信息就行」）。
    // 拦在数据侧而不是靠代码忽略——否则写了 wEngines 的人会以为生效了，实际被 presetBaseEngines 覆盖。
    const CONFIG_FIELDS = ['wEngines', 'driveDiscs', 'chainCountPerStun', 'basicAttackTimeWeight', 'autoEngine', 'minGold']
    const configFieldsInFile = CONFIG_FIELDS.filter(k => data[k] !== undefined)
    check(`${rel}: 不写配装类字段（基础音擎/驱动盘/权重/下位池/金数门槛一律派生）`,
      !data.disabled ? configFieldsInFile.length === 0 : true,
      `出现 ${configFieldsInFile.join(', ')} → 这些字段由 goldStepsFromCatalog#presetBaseEngines / catalogGoldSteps 派生；真要固定请用页面「预设金数 → 保存到预设文件」写 goldSteps/standardSteps，或改用队伍对比页的逐槽锁定（slotCodes）`)
    check(`${rel}: goldSteps 若声明则必须是「用户显式配置」而非模板克隆`,
      (data.goldSteps ?? []).length === 0 || (data.goldSteps ?? []).every(s => typeof s.label === 'string' && s.label.length > 0),
      'goldSteps 每条必须有 label（模板占位标签「主C 1命」这类不算，请用页面保存）')
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
// 2026-10-18 清零：最后 15 条历史欠账（1031/1071/1131/1151/1161/1171/1301/1311/1421/1461/
// 1491/1511/1521/1611/1621）已按代码逐个核对后补录 character-mechanics.json（条目内容来自各角色
// 模块头注释 + spec + teammate-buffs 组，逐条标注 implementedParts / pendingParts / codePaths）。
// 白名单里另有 7 条（1221/1241/1251/1261/1341/1361/1411）此前已有条目、是过期残留，一并删除。
// ⇒ 现在**任何角色缺条目都会直接红**（护栏由「冻结」转为「强制」）。
const KNOWN_MISSING_MECHANICS_CHARACTERS = new Set()
const KNOWN_MISSING_CONSTELLATION_CHARACTERS = new Set(['1611', '1621'])

const mechanicsChars = new Set(Object.keys((load('public/static/character-mechanics.json').characters ?? {})))
const constellationChars = new Set(Object.keys((load('public/static/character-constellations.json').characters ?? {})))

const missingMechanics = agents.filter(a => !mechanicsChars.has(String(a.id)) && !KNOWN_MISSING_MECHANICS_CHARACTERS.has(String(a.id)))
check('every catalog agent has a character-mechanics.json entry',
  missingMechanics.length === 0,
  `缺 mechanics 条目: ${missingMechanics.map(a => a.id).join(', ')} → 在 character-mechanics.json 补一条（core_passive_<id> / additional_ability_<id>，实现位置写 codePaths），不要再走白名单`)

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

// 判据 31（动作时间的类型加成）：秽盾（ether_purify）在录制时带按招式类型的固定加成
// （闪反 +150 / 招架 +250 / 终结 +500），真实动作时间 = (秽盾 − 加成)/100。
// 修前 `scripts/import-nanoka-missing.mjs` 只按**名字**判加成，般岳「支援突击：冲霄」英文名
// `Assist Follow-Up: Pierce Heavens` 不含任何类型关键词 ⇒ 加成判 0 ⇒ 时间取 秽盾/100 = 2.667s
// （真实 1.167s）；而倍率演算页用 `MOVE_TIME_ADJUSTMENTS` 手写 −1.5 补上 ⇒ **同一招两个页面
// 两个时间**（用户 2026-10-18：「算的什么就展示什么，不蒙骗用户」）。
// 现规则数据驱动、单源 `scripts/lib/type-bonus-time.mjs`；本判据锁「catalog 与规则一致」。
// @fact engine:招式时间/类型加成 口径: 秽盾 − 积蓄 ∈ {150,250,500}±2 ⇒ 真实动作时间 = (秽盾−加成)/100（数据优先、名字佐证）；全库 94 条命中，修前仅 1471029 不一致 | 据 用户@2026-10-18 | 验 npm run validate:data | 锚 scripts/lib/type-bonus-time.mjs#inferTypeBonusFromRows | 信 确认
// ⟳复核: nanoka 若改秽盾录制口径（不再带类型加成）或新增第 4 种加成值，须重跑 scripts/patch-move-action-time.mjs 并复核本判据命中数（当前 94 条） | 到期 2027-04-30
{
  const { inferTypeBonusFromRows, counterAssistEtherBase } = await import('./lib/type-bonus-time.mjs')
  const badTime = []
  let checked = 0
  for (const skills of catalog.agentSkills ?? []) {
    for (const category of skills.categories ?? []) {
      for (const move of category.moves ?? []) {
        const row = id => (move.rows ?? []).find(r => r.id === id)?.values?.[0] ?? 0
        const ether = row('ether_purify')
        const buildup = row('anomaly_buildup')
        // 反制支援系：定点基数 300（数据反推不出来，按招族认）——与类型加成走同一条护栏，
        // 漏掉它就会把 1601204 算成 6.0s / 1661017 算成 6.784s（2026-10-30 实际发生过）。
        const counterBase = counterAssistEtherBase(move)
        if (counterBase > 0 && ether > counterBase) {
          checked++
          const expectCounter = Math.round((ether - counterBase) / 100 * 10000) / 10000
          const actualCounter = typeof move.actionTime === 'number' ? move.actionTime : NaN
          if (!(Math.abs(actualCounter - expectCounter) <= 0.01)) {
            badTime.push(`${move.id} ${move.name?.zhCN ?? ''}: actionTime=${actualCounter} 应为 ${expectCounter}（反制支援基数 ${counterBase}，秽盾${ether}）`)
          }
          continue
        }
        const bonus = inferTypeBonusFromRows({ etherPurify: ether, anomalyBuildup: buildup })
        if (bonus <= 0) continue
        checked++
        const expect = Math.round((ether - bonus) / 100 * 10000) / 10000
        const actual = typeof move.actionTime === 'number' ? move.actionTime : NaN
        // 容差 0.01s：catalog 有 3 位小数记录（0.934），重算得 0.9337，属量化抖动不是错
        if (!(Math.abs(actual - expect) <= 0.01)) {
          badTime.push(`${move.id} ${move.name?.zhCN ?? ''}: actionTime=${actual} 应为 ${expect}（秽盾${ether} = 积蓄${buildup} + 加成${bonus}）`)
        }
      }
    }
  }
  check(`agentSkills: actionTime matches type-bonus rule (${checked} moves with type bonus)`,
    checked > 0 && badTime.length === 0,
    `${badTime.slice(0, 8).join('; ')} → 跑 node scripts/patch-move-action-time.mjs 重算`)
}

console.log(failed === 0 ? `\n${checks} data checks passed` : `\n${failed} data check(s) failed`)
process.exit(failed === 0 ? 0 : 1)
