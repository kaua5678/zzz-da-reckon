/**
 * spec 结构校验（60 角色）
 *
 * 标注约定（写 spec note 时必须遵守，新 AI 录入前必读）：
 * - 每条机制要么 [已确认]（用户拍板 → 同时写入 verifications 变成 golden test），
 *   要么 [猜测·高/中/低]（格式：实现:<字段/模块> | 依据:"<原文片段>" | 待核对:<点>）。
 *   不允许存在既无确认又无标注的机制描述。
 * - status 语义：not_described_not_implemented（没收到机制描述）/ implemented_approximation
 *   （近似实现，通常带可调滑块）/ implemented / partially_implemented。
 * - 死数据检查（AGENTS 规则 4）：已在 src/mechanics/agents/*.ts 注册模块的角色，
 *   spec attributeConversions 必须可证明被消费（模块显式调用 applySpecAttributeConversions，
 *   或条目 note 标注「实现位置：」），否则 FAIL；adjustable 滑块给出 WARN。
 * - 完整字段说明见 src/specs/template.json 的 _comment；完整角色示例见
 *   src/specs/agents/1451.json（卢西娅·艾洛温）。
 * - 已在 public/static/teammate-buffs.json 承载的拐力不要重复填 teamBuffs。
 */
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const specDir = join(root, 'src', 'specs', 'agents')
const allowedStatuses = new Set([
  'implemented',
  'implemented_approximation',
  'partially_implemented',
  'not_described_not_implemented',
])

let failed = 0
let checks = 0

function check(name, condition, detail = '') {
  checks++
  if (condition) {
    console.log(`  ok ${name}`)
  } else {
    failed++
    console.log(`  FAIL ${name}${detail ? ` - ${detail}` : ''}`)
  }
}

const catalog = JSON.parse(readFileSync(join(root, 'public/static/catalog.json'), 'utf8'))
const moves = new Set()
for (const skills of catalog.agentSkills ?? []) {
  for (const category of skills.categories ?? []) {
    for (const move of category.moves ?? []) moves.add(move.id)
  }
}
/** catalog 里的 agentId → 中文名（用于 spec 文件名/名称一致性校验） */
const agentNameById = new Map()
for (const agent of catalog.agents ?? []) {
  agentNameById.set(String(agent.id), agent.name?.zhCN ?? '')
}

// ===== 死数据检查（AGENTS 规则 4）：自定义 TS 模块角色的 spec 字段无解释器消费者 =====
// 模块来源 = src/mechanics/agents/*.ts 里声明的 agentIds（含 const 解析）。
// attributeConversions 必须可证明被消费，否则 FAIL：
//   ① 模块文件显式调用 applySpecAttributeConversions；或
//   ② 条目 note 标注「实现位置：」（纯记录条目）。
// adjustable 资源（滑块）给出 WARN（无可靠静态证据，先警示不打断）。
const mechanicsDir = join(root, 'src', 'mechanics', 'agents')
const moduleSourceByAgent = new Map()
for (const file of readdirSync(mechanicsDir)) {
  if (!file.endsWith('.ts')) continue
  const src = readFileSync(join(mechanicsDir, file), 'utf8')
  const consts = new Map()
  for (const m of src.matchAll(/(?:const|export const)\s+(\w+)\s*=\s*'(\d+)'/g)) consts.set(m[1], m[2])
  for (const m of src.matchAll(/agentIds:\s*\[([^\]]*)\]/g)) {
    for (const tok of m[1].split(',')) {
      const lit = tok.match(/'(\d+)'/)
      const name = tok.trim().match(/^([A-Za-z_]\w*)$/)
      const id = lit ? lit[1] : (name ? consts.get(name[1]) : undefined)
      if (id) moduleSourceByAgent.set(id, src)
    }
  }
}

const files = readdirSync(specDir).filter(file => file.endsWith('.json'))
check('spec directory has JSON files', files.length > 0)

// ===== 文件名 ↔ agentId ↔ 中文名 三方一致性 =====
// 动机（实际踩过的改错文件陷阱）：spec 曾经命名双轨（`<id>.json` 与 `<拼音slug>.json` 并存），
// 而 slug 会与另一个角色的拼音撞车 —— `juhufu.json` 实为朱鸢(1241)，橘福福(1391) 的拼音恰是
// `jufufu` 且其 spec 是 `1391.json`；配上 `jufufu.test.ts`(橘福福)，两者只差一字，AI/人都极易
// 改错文件（docs 里也确实写出过指向不存在的 `jufufu.json`）。
// 规则（spec 由 import.meta.glob 加载，文件名对运行时无意义 → 可无痛统一）：
//   ① 文件名必须是 `<agentIds[0]>.json`，不允许拼音 slug —— 从根上消灭romanization 撞车；
//   ② spec.name 必须与 catalog 中该 agentId 的中文名同源（防 spec 挂错角色）。
//      同源判定放宽到「互相包含 或 共同前缀≥2 字」，容忍官方全名/简称/书名号差异
//      （雅/星见雅、「扳机」/扳机、诺姆·霍洛韦尔/霍洛维尔、奥菲丝&「鬼火」/奥菲丝·马格努森&「鬼火」），
//      但拦住「朱鸢 vs 橘福福」这类完全不同的角色。
const stripDecor = s => String(s ?? '').replace(/[「」·&\s]/g, '')
const sameOrigin = (a, b) => {
  const x = stripDecor(a)
  const y = stripDecor(b)
  if (!x || !y) return true
  if (x.includes(y) || y.includes(x)) return true
  let i = 0
  while (i < x.length && i < y.length && x[i] === y[i]) i++
  return i >= 2
}
for (const file of files) {
  const spec = JSON.parse(readFileSync(join(specDir, file), 'utf8'))
  const base = file.replace(/\.json$/, '')
  const primaryId = String(spec.agentIds?.[0] ?? '')
  check(`spec 文件名 ${file} = <agentId>.json`, base === primaryId,
    `文件名必须等于 agentIds[0]（${primaryId}）。拼音 slug 已禁用：slug 会与别的角色撞车（juhufu=朱鸢 vs jufufu=橘福福），改错文件的代价极高。`)
  if (primaryId && agentNameById.has(primaryId)) {
    const catalogName = agentNameById.get(primaryId)
    check(`${file}: spec.name「${spec.name}」与 catalog 中 ${primaryId}「${catalogName}」同源`,
      sameOrigin(spec.name, catalogName),
      `spec 可能挂错角色（agentIds 与 name 不是同一个人）`)
  }
}

const allIds = new Set()

for (const file of files) {
  const spec = JSON.parse(readFileSync(join(specDir, file), 'utf8'))
  const label = spec.id || file

  check(`${label}: schemaVersion is 1`, spec.schemaVersion === 1)
  check(`${label}: id is unique`, !allIds.has(spec.id))
  if (spec.id) allIds.add(spec.id)
  check(`${label}: agentIds is non-empty`, Array.isArray(spec.agentIds) && spec.agentIds.length > 0)
  check(`${label}: status is allowed`, allowedStatuses.has(spec.status))
  check(`${label}: attributeConversions is array`, Array.isArray(spec.attributeConversions))
  check(`${label}: resources is array`, Array.isArray(spec.resources))
  check(`${label}: rowFusions is array`, Array.isArray(spec.rowFusions))
  check(`${label}: events is array`, Array.isArray(spec.events))
  check(`${label}: verifications is array`, Array.isArray(spec.verifications))
  check(`${label}: stateMachines is array`, Array.isArray(spec.stateMachines))
  check(`${label}: teamBuffs is array when present`, spec.teamBuffs == null || Array.isArray(spec.teamBuffs))
  check(`${label}: additionalAbility has teamConditions when present`, spec.additionalAbility == null || Array.isArray(spec.additionalAbility.teamConditions))

  const localIds = new Set()
  for (const item of [
    ...(spec.attributeConversions ?? []),
    ...(spec.resources ?? []),
    ...(spec.rowFusions ?? []),
    ...(spec.events ?? []),
    ...(spec.verifications ?? []),
    ...(spec.stateMachines ?? []),
    ...(spec.teamBuffs ?? []),
  ]) {
    if (item?.id) {
      check(`${label}: nested id ${item.id} is unique`, !localIds.has(item.id), item.id)
      localIds.add(item.id)
    }
    if (item?.expected) {
      check(`${label}: verification ${item.id} has expected values`, Object.keys(item.expected).length > 0, item.id)
    }
  }

  for (const fusion of spec.rowFusions ?? []) {
    check(`${label}: fusion move ${fusion.moveId} exists in catalog`, moves.has(fusion.moveId), fusion.moveId)
  }

  // 死数据检查（AGENTS 规则 4，见文件头注释）
  const hasCustomModule = spec.agentIds.some(id => moduleSourceByAgent.has(id))
  if (hasCustomModule) {
    const moduleCallsConverter = spec.agentIds.some(id =>
      /applySpecAttributeConversions\s*\(/.test(moduleSourceByAgent.get(id) ?? ''))
    for (const conv of spec.attributeConversions ?? []) {
      const noteMarked = typeof conv.note === 'string' && conv.note.includes('实现位置：')
      check(
        `${label}: conversion ${conv.id} 有消费者（模块显式调用 applySpecAttributeConversions 或 note 标注「实现位置：」）`,
        moduleCallsConverter || noteMarked,
        `自定义模块角色的 attributeConversions 不会被 spec 解释器消费（死数据）。机制须在模块实现并在 note 写「实现位置：<模块/函数>」，或删除该条目（防双计，参见般岳 hp→贯穿力 修复）。`
      )
    }
    for (const res of spec.resources ?? []) {
      if (res.adjustable && !(typeof res.note === 'string' && res.note.includes('实现位置：'))) {
        console.log(`  WARN ${label}: adjustable 资源 ${res.id} 在自定义模块角色 spec 无消费者（AGENTS 规则 4）——机制必须在模块实现；仅作记录请在 note 写「实现位置：」`)
      }
    }
  }
}

console.log(failed === 0 ? `\n${checks} spec checks passed` : `\n${failed} spec check(s) failed`)
process.exit(failed === 0 ? 0 : 1)
