#!/usr/bin/env node
/**
 * gachabase 字段覆盖审计（2026-09-11 立，起因：`sharpness_gain` / `gash_buildup` 静默丢失）。
 *
 * 背景：`fetch-gachabase-agent.mjs` 曾用**字段白名单正则**抓页面内嵌 skill_data，
 * 于是页面新增/未列入的列（`gash_buildup`、`sharpness_gain_base`、`adrenaline_base`）
 * 在 `data/raw/gachabase/<id>.json` 里根本不存在，进而**永远进不了 catalog**——
 * 「克拉蕾锐能只长在血锻四式」这种机制的原始数据在仓库里查不到，只能靠人肉翻网页。
 *
 * 本脚本回答一个问题：**页面上的每一列，我们都导入了吗 / 都消费了吗？**
 *   ① 列覆盖（第一层）：对每个有缓存的角色，列出页面字段 ∩（catalog 行 id ∪ 已知非行字段），
 *      标出「未导入」的字段名与受影响招数条数；
 *   ② 语义消费（第二层，见下方 ROW_CONSUMERS）：catalog 里的每个 row.id **有没有消费端**；
 *   ③ 退出码：第一层有「未导入」字段 或 第二层有 row.id 查无消费端，即 exit 1（机器护栏，CI 可挂）。
 *
 * 两层缺一不可：第一层只答「页面字段落成 catalog 行了吗」，**答不了**「catalog 行有人读吗」——
 * 命破 `flash_energy_recovery` 事故正是卡在第二层：行在、61 条非零数据在，但记账通道只读
 * `energy_recovery`，整条通道静默归零，而第一层全绿。
 *
 * 用法：
 *   node scripts/audit-gachabase-fields.mjs            # 全部角色（有缓存才算列覆盖）
 *   node scripts/audit-gachabase-fields.mjs 1611       # 只看某角色
 *   node scripts/audit-gachabase-fields.mjs --list     # 只列「哪些角色还没有 gachabase 缓存」
 *
 * 补缓存：`node scripts/fetch-gachabase-agent.mjs <agentId> <slug>`（slug = 页面 URL 小写名）。
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const only = process.argv[2] && !process.argv[2].startsWith('--') ? String(process.argv[2]) : null
const listOnly = process.argv.includes('--list')

const catalog = JSON.parse(readFileSync(resolve(root, 'public/static/catalog.json'), 'utf8'))
const gbDir = resolve(root, 'data', 'raw', 'gachabase')

/**
 * 已知**不是** catalog 行的页面字段，以及它们去哪了 / 为什么可以不在 catalog：
 * key → { sink: 落点, consumed: 是否有消费端 }
 */
const KNOWN_SINKS = {
  id: { sink: 'move id 本体', consumed: true },
  attack_data: { sink: 'rows[attack_data_N]（导入脚本按 kind=special 落行）', consumed: true },
  damage_multiplier_base: { sink: 'rows[damage].values[0]', consumed: true },
  damage_multiplier_step: { sink: 'rows[damage] 等级成长', consumed: true },
  daze_multiplier_base: { sink: 'rows[daze].values[0]', consumed: true },
  daze_multiplier_step: { sink: 'rows[daze] 等级成长', consumed: true },
  energy_gain_base: { sink: 'rows[energy_recovery].values[0]', consumed: true },
  energy_gain_step: { sink: '（游戏不随等级成长）', consumed: true },
  individual_decibel_gain_base: { sink: 'rows[decibel_recovery].values[0]', consumed: true },
  individual_decibel_gain_step: { sink: '（游戏不随等级成长）', consumed: true },
  anomaly_buildup: { sink: 'rows[anomaly_buildup].values[0]', consumed: true },
  ether_purify: { sink: 'rows[ether_purify].values[0] + move.actionTime = ether_purify/100', consumed: true },
  sp_consume: { sink: 'findExSpecial costType=resource 的成本（如锐能 60）', consumed: true },
}

/** 期望成为 catalog 行、但历史上被白名单漏掉的字段 → 目标行 id */
const EXPECTED_ROWS = {
  gash_buildup: 'gash_buildup',
  sharpness_gain_base: 'sharpness_gain',
  // gachabase 英文名 adrenaline = 游戏「闪能」（命破专属能量）→ 落 flash_energy_recovery（单一通道名）
  adrenaline_base: 'flash_energy_recovery',
}

/**
 * 第二层：**消费端登记表** —— catalog 里出现过的每个 row.id 必须被哪些源文件消费。
 *
 * 为什么需要它（第一层查不出的事故）：命破的 `flash_energy_recovery` 行有 61 条非零数据，
 * 但引擎记账通道只读 `energy_recovery` ⇒ 整条通道静默归零，而第一层（列覆盖）全绿。
 * 「行存在」与「行被读」是两件事，前者绿不代表后者绿。
 *
 * 判据（故意用**引号字面量**，比 `grep row.id` 强）：
 *   每个 row.id 登记的**每一个**消费端文件都必须存在，且其内容里出现 `'row.id'` 或 `"row.id"`；
 *   少任何一个即红，并点名到具体文件。
 * 为什么不用裸子串 / 为什么要求引号：裸 `grep -rn "<row.id>"` 会把**注释里的提及**算成消费端，
 * 于是「写一行注释说这个字段很重要」就能让检查变绿 —— 那正是本仓库要防的「死口径」
 * （AGENTS.md 规则 16①：写「X 是 Y」前先确认有活调用点）。带引号的字面量才是行 id
 * 在代码里被真正比较/索引/注册的形态。
 *
 * ⚠ 为什么不能用「任一文件出现即算」的弱判据：修复前 `flash_energy_recovery` 就已
 * 有 2 个消费端（平A通道 moveLookup + 伊德海莉单角色模块），naive grep **恒绿** ⇒
 * 抓不到「记账通道漏读」这个真 bug。登记表把「谁**必须**读」写成显式契约，漏一个就红。
 * 同理，判据是 AND 不是 OR：事故形态是「展示层读了、记账层没读」，OR 会让一处字面量
 * 兜住整行 ⇒ 记账通道再次静默归零时检查照样全绿，退化成它本该拦住的 naive grep。
 *
 * 维护约定：catalog 新增 row.id ⇒ 这里必须补一行，否则本检查 exit 1（这是有意的摩擦：
 * 新通道上线时必须指名它的消费端，而不是让它悄悄躺在 catalog 里没人读）。
 *
 * 特例语义：
 * - `ether_purify` **不是伤害行、也不是资源行** —— 它是 `actionTime` 的来源
 *   （`move.actionTime = ether_purify/100`，见 types/catalog.ts 的 actionTime 注释）。
 *   这里登记的消费端是「标准倍率系数表」，即该行 id 必须在 `StandardRowId` / `STANDARD_ROW_IDS`
 *   里注册（倍率表按 row id 索引取值，`multiplierCoefficients` 用它反推系数）。
 *   后继 agent 勿把它当资源行去接记账通道。
 * - `attack_data_0` / `attack_data_1` 是 kind:'special' 通道（角色专属资源回复/特殊计数），
 *   不是常规行：0 号走标准倍率表，1 号只有星徽·比利消费。
 */
const ROW_CONSUMERS = {
  // 伤害/失衡/异常：enrich 回填（helpers.ts 按 row id 取值 patch 执行行）
  damage: ['src/composables/resourceCalc/helpers.ts'],
  daze: ['src/composables/resourceCalc/helpers.ts'],
  anomaly_buildup: ['src/composables/resourceCalc/helpers.ts'],
  // 记账层（能量/喧响）：展示层 helpers.ts + 记账层 moveLookup.ts（row.id === 分支）
  decibel_recovery: ['src/composables/resourceCalc/helpers.ts', 'src/core/resource/moveLookup.ts'],
  energy_recovery: ['src/composables/resourceCalc/helpers.ts', 'src/core/resource/moveLookup.ts'],
  // 命破闪能：本次修复新接入（平A回能通道 + 记账层）
  flash_energy_recovery: ['src/composables/resourceCalc/helpers.ts', 'src/core/resource/moveLookup.ts'],
  // 角色模块专属行
  gash_buildup: ['src/mechanics/agents/claret.ts'],
  sharpness_gain: ['src/mechanics/agents/claret.ts'],
  luminize_multiplier: ['src/mechanics/agents/remielle.ts'],
  // 非资源行：actionTime 来源（= ether_purify/100），登记「必须在标准倍率系数表注册」
  ether_purify: ['src/data/standardMultiplierTable.ts'],
  attack_data_0: ['src/data/standardMultiplierTable.ts'],
  attack_data_1: ['src/mechanics/agents/starlightBilly.ts'],
}

const agents = catalog.agents.filter(a => !a.isTeammateOnly)
const cached = existsSync(gbDir) ? readdirSync(gbDir).filter(f => f.endsWith('.json')).map(f => f.replace(/\.json$/, '')) : []
const missingCache = agents.filter(a => !cached.includes(String(a.id))).map(a => `${a.id} ${a.name.zhCN}`)

if (listOnly) {
  console.log(`有 gachabase 缓存：${cached.length} / 角色表 ${agents.length}`)
  console.log(`缺缓存（${missingCache.length}）：`)
  for (const m of missingCache) console.log('  -', m)
  console.log('\n补缓存：node scripts/fetch-gachabase-agent.mjs <agentId> <slug>')
  process.exit(0)
}

const targets = only ? agents.filter(a => String(a.id) === only) : agents
let unimportedFields = 0
let checkedAgents = 0
let totalGapRows = 0

for (const agent of targets) {
  const id = String(agent.id)
  const file = resolve(gbDir, `${id}.json`)
  if (!existsSync(file)) continue
  checkedAgents++
  const gb = JSON.parse(readFileSync(file, 'utf8'))
  const rowsById = new Map(gb.skill_data.map(r => [String(r.id), r]))

  // 该角色 catalog 里已有的 row.id 集合
  const skill = (catalog.agentSkills ?? []).find(s => String(s.agentId) === id)
  const rowIds = new Set()
  for (const cat of skill?.categories ?? []) {
    for (const m of cat.moves) for (const r of m.rows ?? []) rowIds.add(String(r.id))
  }

  const fields = [...new Set(gb.skill_data.flatMap(r => Object.keys(r)))].filter(f => f !== 'id' && f !== 'attack_data')
  // `X_step` 是 `X_base` 的等级成长（同一列）：若 `X_base` 已报缺口，`X_step` 不重复计入
  const rowOf = (f) => {
    const base = f.endsWith('_step') ? `${f.slice(0, -'_step'.length)}_base` : f
    return EXPECTED_ROWS[f] ?? EXPECTED_ROWS[base] ?? f
  }
  const stepOnly = new Set(
    fields.filter(f => f.endsWith('_step') && fields.includes(`${f.slice(0, -'_step'.length)}_base`))
      .filter(f => !EXPECTED_ROWS[f]),
  )
  const gaps = []
  for (const f of fields) {
    if (KNOWN_SINKS[f] || stepOnly.has(f)) continue
    const targetRow = rowOf(f)
    if (rowIds.has(targetRow)) continue
    const nz = gb.skill_data.filter(r => (r[f] ?? 0) > 0).length
    gaps.push({ field: f, targetRow, nonzeroMoves: nz })
  }
  if (!gaps.length) {
    console.log(`ok ${id} ${agent.name.zhCN}：页面字段 ${fields.length} 个全部有落点`)
    continue
  }
  // 真缺口 = 该列在本角色上有非零数据却没进 catalog（数据静默丢失）
  // 信息项 = 该列本角色全为 0（角色没有这条通道，不建行是对的）
  const realGaps = gaps.filter(g => g.nonzeroMoves > 0)
  if (realGaps.length) unimportedFields += realGaps.length
  const zeroOnly = gaps.filter(g => g.nonzeroMoves === 0)
  if (!realGaps.length) {
    console.log(`ok ${id} ${agent.name.zhCN}：无非零字段丢失（${zeroOnly.map(g => g.field).join('/')} 全 0，不建行）`)
    continue
  }
  console.log(`\n✗ ${id} ${agent.name.zhCN}：${realGaps.length} 个**非零**字段未导入`)
  for (const g of realGaps) {
    totalGapRows += g.nonzeroMoves
    console.log(`   · ${g.field}（非零招式 ${g.nonzeroMoves} 条）→ 目标行 rows[${g.targetRow}] 不存在`)
  }
  if (id === '1611') {
    const sample = [...rowsById.values()].slice(0, 3)
    console.log('   样例：', sample.map(r => `${r.id}: gash=${(r.gash_buildup ?? 0) / 100} sharp=${(r.sharpness_gain_base ?? 0) / 10000}`).join(' | '))
  }
}

/**
 * 第二层：消费端检查（仅全量模式；单角色模式跳过以免噪声 —— 消费端是全局契约，
 * 与「这次只看哪个角色」无关，单角色跑时重复报同一批缺口没有信息量）。
 *
 * 判据见 ROW_CONSUMERS 头注释：每个 row.id 登记的每个消费端文件都必须存在且含引号字面量。
 */
let consumerGaps = 0
if (!only) {
  // 全局枚举 catalog 里出现过的所有 row.id（跨全部角色去重）
  const allRowIds = new Set()
  for (const skill of catalog.agentSkills ?? []) {
    for (const cat of skill.categories ?? []) {
      for (const m of cat.moves ?? []) for (const r of m.rows ?? []) allRowIds.add(String(r.id))
    }
  }

  const unregistered = []
  const missingLiteral = []
  for (const rowId of [...allRowIds].sort()) {
    const files = ROW_CONSUMERS[rowId]
    if (!files?.length) {
      unregistered.push(rowId)
      continue
    }
    // 消费端成立 = 该文件存在 **且** 内容里有带引号的行 id 字面量（注释里的裸提及不算）。
    // ⚠ 判据是「登记表里**每个**文件都必须消费」而非「至少一个」——为什么不是 OR：
    //   `flash_energy_recovery` 事故的形态正是「展示层读了、记账层没读」，若用 OR，
    //   helpers.ts 一处字面量就能让整行恒绿 ⇒ 记账通道再次静默归零时本检查**照样全绿**，
    //   那就退化成了它本该拦住的那个 naive grep。登记表列的是「必须消费它的文件」，
    //   少一个就是契约破了（谁破了要能点名到文件，见下面逐文件输出）。
    const broken = files.filter(f => {
      const abs = resolve(root, f)
      if (!existsSync(abs)) return true
      const src = readFileSync(abs, 'utf8')
      return !(src.includes(`'${rowId}'`) || src.includes(`"${rowId}"`))
    })
    if (broken.length) missingLiteral.push({ rowId, files, broken })
  }

  // 登记表里已不在 catalog 的条目（表过期信号；不判红——删行是合法操作，但应同步销号）
  const stale = Object.keys(ROW_CONSUMERS).filter(id => !allRowIds.has(id))

  if (unregistered.length || missingLiteral.length) {
    consumerGaps = unregistered.length + missingLiteral.length
    console.log(`\n✗ 消费端检查：${consumerGaps} 个 row.id 查无消费端（catalog 共 ${allRowIds.size} 种 row.id）`)
    for (const rowId of unregistered) {
      console.log(`   · ${rowId}：未登记消费端 → 在 ROW_CONSUMERS 里指名「谁必须读它」`)
    }
    for (const { rowId, broken } of missingLiteral) {
      console.log(`   · ${rowId}：登记的消费端未消费它（${broken.length}/${ROW_CONSUMERS[rowId].length} 个文件无字面量）`)
      for (const f of broken) {
        console.log(`       ${existsSync(resolve(root, f)) ? '无字面量' : '文件不存在'}  ${f}`)
      }
    }
  } else {
    console.log(`\nok 消费端检查：catalog ${allRowIds.size} 种 row.id 全部有登记的消费端（带引号字面量）`)
  }
  if (stale.length) {
    console.log(`   提示：ROW_CONSUMERS 有 ${stale.length} 条已不在 catalog（可销号）：${stale.join(', ')}`)
  }
}

console.log(
  `\n审计小结：检查 ${checkedAgents} 个有缓存角色，未导入字段 ${unimportedFields} 处（涉及非零招式 ${totalGapRows} 条）；`
  + `角色表共 ${agents.length}，缺 gachabase 缓存 ${missingCache.length}（--list 查看）`,
)
if (consumerGaps > 0) {
  console.log('处置：给该 row.id 接上消费端（行有数据却没人读 = 静默归零），或在本脚本 ROW_CONSUMERS 里登记其消费文件。')
}
if (unimportedFields > 0) {
  console.log('处置：补进 import/导入路径（不要手改 catalog），或在本脚本 KNOWN_SINKS 里登记落点。')
}
// 第一层（未导入字段）与第二层（无消费端）任一红即 exit 1
if (unimportedFields > 0 || consumerGaps > 0) process.exit(1)
