#!/usr/bin/env node
/**
 * 实体解析 CLI —— AI 查证工具（防名字联想事故，见 docs/ENTITY_CARDS.md）。
 *
 * 为什么存在：游戏名词（音擎名/角色名）在 LLM 训练分布里有强先验，名字联想会产生
 * 「感觉已知但从未验证」的断言，且因为名字是真的、只是挂错实体，错误能一路通过不报错
 * （2026-08-30 事故：心弦夜响被联想成仪玄专武，实际仪玄专武是青溟笼舍 14137）。
 * 本工具让验证比幻觉便宜：跨实体断言前先跑这里，输出一律用 `名字(id)` 绑定格式引用。
 *
 * 解析规则（防静默猜错的核心设计）：
 *   1. 精确 id 命中 → 直接用
 *   2. 精确名命中（zhCN / en）→ 直接用
 *   3. 唯一子串命中 → 用；多个候选 → 打印候选清单并 exit 1（大声失败）
 *   4. 未命中 → exit 1
 *
 * 用法：
 *   node scripts/resolve.mjs 音擎 心弦夜响          # 音擎完整解剖（归属/副属性/精炼效果）
 *   node scripts/resolve.mjs 角色 1371              # 角色解剖（基础面板/专武[反查 owner]/配装推荐）
 *   node scripts/resolve.mjs 专武 仪玄              # 角色专武（经 ownerAgentId 权威路径解析）
 *   node scripts/resolve.mjs 套装 折枝              # 驱动盘套装 2pc/4pc 效果
 *   node scripts/resolve.mjs boss <名|id>           # Boss 条目概要
 *   scripts/resolve.mjs buff 千夏                   # 队友 buff 组
 *   node scripts/resolve.mjs spec 1471              # 角色 spec 摘要（status/notes 计数）
 *   node scripts/resolve.mjs audit [专武|混淆名]    # 全量体检（信息版；护栏测试在 buildRecWengine.test.ts）
 *
 * 派生数值（暴击预算/面板/伤害）不要用本工具手拼 —— 用引擎探针：
 *   npm run probe:panel -- --agent 1371
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const readJson = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'))

const catalog = readJson('public/static/catalog.json')
const recs = readJson('public/static/build-recommendations.json')
const teammateBuffs = readJson('public/static/teammate-buffs.json')
const bossPresets = readJson('public/static/boss-presets.json')
const presetsBosses = bossPresets.bosses ?? []

const agents = catalog.agents ?? []
const engines = catalog.wEngines ?? []
const sets = catalog.driveDiscSets ?? []
const bosses = catalog.bosses ?? []

const SPEC_LABELS = { attack: '强攻', stun: '击破', anomaly: '异常', support: '支援', defense: '防护', rupture: '命破', edgeguard: '戍卫', sharpen: '锐化' }
const ATTR_LABELS = { physical: '物理', fire: '火', ice: '冰', electric: '电', ether: '以太', wind: '风', lumiflux: '辉光' }

const zh = (o) => o?.zhCN ?? o?.en ?? '?'
const idName = (o) => `${zh(o?.name ?? o)}(${o?.id})`

/** 在实体集合里按 id 或名解析；歧义/未命中时大声失败 */
function resolveEntity(list, token, what) {
  const t = String(token).trim()
  const byId = list.filter(e => String(e.id) === t)
  if (byId.length === 1) return byId[0]
  if (byId.length > 1) fail(`id=${t} 命中 ${byId.length} 个${what}（数据异常）`)
  const byExact = list.filter(e => e.name?.zhCN === t || e.name?.en === t)
  if (byExact.length === 1) return byExact[0]
  const bySub = list.filter(e => (e.name?.zhCN ?? '').includes(t) || (e.name?.en ?? '').toLowerCase().includes(t.toLowerCase()))
  if (bySub.length === 1) return bySub[0]
  if (bySub.length > 1) fail(`「${t}」歧义，命中 ${bySub.length} 个${what}：\n${bySub.map(e => `  - ${idName(e)}`).join('\n')}\n请用 id 或更长的名字再试。`)
  fail(`未找到${what}「${t}」。`)
}

function fail(msg) {
  console.error(`✗ ${msg}`)
  process.exit(1)
}

function line(k, v) { console.log(`  ${k}: ${v}`) }

/** 音擎精炼效果分解：每条 effect 按 modificationValues 给出精炼阶梯 */
function describeEngineEffects(e) {
  const eff = e.effect
  if (!eff) return console.log('  精炼效果: 无')
  console.log(`  精炼效果「${zh(eff.name)}」${eff.requirement ? `（门槛：${zh(eff.requirement.label)}）` : ''}:`)
  for (const f of eff.selfBuff?.effects ?? []) {
    const ladder = f.modificationValues?.value ?? f.modificationValues?.valuePerStack
    const scope = f.scope ? `[${f.scope}]` : ''
    if (ladder?.length) {
      console.log(`    - ${f.stat} ${ladder.join('/')}（精炼1-5，默认档 ${f.value ?? f.valuePerStack}）${f.type !== 'fixed' ? ` · ${f.type}` : ''}${scope}`)
    } else {
      console.log(`    - ${f.stat} +${f.value ?? f.valuePerStack ?? '?'}${f.maxStacks ? ` ×${f.defaultStacks ?? f.maxStacks}层(上限${f.maxStacks})` : ''} ${f.type}${scope}`)
    }
  }
}

function showEngine(e) {
  const owner = e.ownerAgentId ? agents.find(a => String(a.id) === String(e.ownerAgentId)) : null
  console.log(`== 音擎 ${idName(e)} ==`)
  line('稀有度/门槛', `${e.rarity ?? '?'} · ${SPEC_LABELS[e.specialty] ?? e.specialty ?? '通用'}${e.attribute ? '/' + (ATTR_LABELS[e.attribute] ?? e.attribute) : ''}`)
  line('专武归属', owner ? `${idName(owner)}（ownerAgentId 权威）` : '无 ownerAgentId（非专武）')
  line('白值', `atkBase ${e.level60?.atkBase ?? '?'}`)
  line('副属性', e.level60?.advancedStat ? `${e.level60.advancedStat.stat} +${e.level60.advancedStat.value}${e.level60.advancedStat.mode === 'pct' ? '%' : ''}` : '无')
  line('精炼等级', `modification 仅元数据（${e.modification?.minLevel ?? 1}-${e.modification?.maxLevel ?? 5}，默认 ${e.modification?.defaultLevel ?? 1}）；效果数值在 effect.selfBuff[].modificationValues`)
  describeEngineEffects(e)
}

function showAgent(a) {
  const sig = engines.find(e => String(e.ownerAgentId) === String(a.id))
  const rec = recs.characters?.[String(a.id)]
  console.log(`== 角色 ${idName(a)} ==`)
  line('特化/属性', `${SPEC_LABELS[a.specialty] ?? a.specialty} · ${ATTR_LABELS[a.attribute] ?? a.attribute} · ${a.faction ?? '?'} · ${a.rarity}`)
  line('专武', sig ? `${idName(sig)}（ownerAgentId 反查）` : '无（ownerAgentId 无指向，如 1551 佩洛伊斯=未录入）')
  if (a.level60) {
    const l = a.level60
    line('基础面板(60)', `HP ${l.hpBase} · ATK ${l.atkBase} · DEF ${l.defBase} · 暴击 ${l.critRate}%/${l.critDmg}% · 冲击 ${l.impact} · 精通 ${l.anomalyProficiency} · 掌握 ${l.anomalyMastery}`)
  }
  if (rec?.wengine) line('配装推荐音擎', `${rec.wengine.name_zh}(${rec.wengine.catalog_wengine_id})`)
  if (rec?.main_stats) {
    const ms = Object.entries(rec.main_stats).map(([slot, s]) => `${slot}号位:${s.name}`).join(' · ')
    line('推荐主词条', ms)
  }
  if (rec?.drive_disc_sets) {
    const four = rec.drive_disc_sets.four_piece?.name_zh ?? ''
    const two = rec.drive_disc_sets.two_piece?.name_zh ?? ''
    if (four || two) line('推荐套装', `4件:${four} + 2件:${two}`)
  }
  const skills = catalog.agentSkills?.find(s => String(s.agentId) === String(a.id))
  if (skills) {
    const cats = skills.categories.map(cc => `${cc.id}×${cc.moves.length}`).join(' · ')
    line('倍率表', `${cats}（招式查询: node scripts/resolve.mjs 招式 ${a.id} <moveId|招式名>）`)
  }
  console.log('  暴击预算/面板等派生数值 → 引擎探针 PROBE_AGENT=' + a.id + ' npm run probe:panel（勿手工加 JSON）')
}

function showSet(s) {
  console.log(`== 驱动盘套装 ${idName(s)} ==`)
  for (const f of s.twoPiece?.effects ?? []) {
    line('2件套', `${f.stat} +${f.value}${f.type !== 'fixed' ? ` · ${f.type}` : ''}`)
  }
  if (s.fourPiece?.effectText) line('4件套文本', zh(s.fourPiece.effectText).slice(0, 120) + '…')
  for (const f of s.fourPiece?.selfBuff?.effects ?? []) {
    const ladder = f.modificationValues?.value ?? f.modificationValues?.valuePerStack
    line('4件套效果', `${f.stat} ${ladder ? ladder.join('/') : '+' + (f.value ?? f.valuePerStack ?? '?')}${f.maxStacks ? ` ×层(上限${f.maxStacks})` : ''} · ${f.type}`)
  }
}

/** Boss 完整解剖：catalog（抗性/当期 buff）+ boss-presets（血量/失衡档）双源 */
function showBoss(b) {
  console.log(`== Boss ${idName(b)} ==`)
  line('别名', (b.aliases ?? []).map(a => (typeof a === 'string' ? a : zh(a))).join(' / ') || '无')
  const t = b.target ?? {}
  line('防御/失衡倍率', `${t.defense ?? '?'} · 怪物失衡倍率 ${presetsBosses.find(p => p.catalogId === b.id)?.monster?.stunVuln ?? '?'}（boss-presets）`)
  line('弱点元素', (t.weaknessElements ?? []).map(e => ATTR_LABELS[e] ?? e).join('/') || '无')
  line('抗性元素', (t.resistanceElements ?? []).map(e => ATTR_LABELS[e] ?? e).join('/') || '无')
  if (Object.keys(t.resistanceOverrides ?? {}).length) line('抗性覆盖', JSON.stringify(t.resistanceOverrides))

  const encounters = [...(b.encounters ?? [])]
  for (const e of encounters.slice(-3)) {
    const app = (e.appearances ?? [])[0] ?? {}
    console.log(`  -- 期 ${app.gameVersion ?? '?'} P${app.phaseNo ?? '?'}（${app.startDate ?? '?'} ~ ${app.endDate ?? '?'}，${app.modeId ?? '?'}）${e.hidden ? ' [hidden]' : ''}`)
    if (e.enemyIntel) console.log(`     机制: ${zh(e.enemyIntel).slice(0, 150)}${zh(e.enemyIntel).length > 150 ? '…' : ''}`)
    for (const pb of e.playerBuffs ?? []) {
      const effs = (pb.effects ?? []).map(f => `${f.stat}${f.valuePerStack != null ? `±${f.valuePerStack}/层×${f.maxStacks}` : ` ${f.value ?? '?'}`}`).join(', ')
      console.log(`     当期buff ${zh(pb.name)}: ${effs || '（效果见原文）'} [${pb.calculationStatus ?? '?'}]`)
    }
    for (const pd of e.playerDebuffs ?? []) {
      const effs = (pd.effects ?? []).map(f => `${f.stat}${f.valuePerStack != null ? `±${f.valuePerStack}/层×${f.maxStacks}` : ` ${f.value ?? '?'}`}`).join(', ')
      console.log(`     当期debuff ${zh(pd.name)}: ${effs || '（效果见原文）'} [${pd.calculationStatus ?? '?'}]`)
    }
    if (!e.enemyIntel && !(e.playerBuffs ?? []).length && !(e.playerDebuffs ?? []).length) console.log('     （无当期机制）')
  }
  if (encounters.length > 3) console.log(`  （共 ${encounters.length} 期，只列最近 3 期）`)
  const pb = presetsBosses.find(p => p.catalogId === b.id)
  if (pb?.phases?.length) {
    const last = pb.phases[pb.phases.length - 1]
    line('最新档(boss-presets)', `${last.label} · HP ${last.hp}（系数 ${last.hpVersionCoeff}）· 失衡值 ${last.stunValue} · 防御 ${last.defense} · 异常系数 ${last.bossAnomalyCoeff}`)
    line('战斗预设', `battleTime ${pb.defaults?.battleTime}s · 秽盾 ${pb.defaults?.shieldCount} · 弹刀 ${pb.defaults?.parryTotal ?? '?'}（改默认值: scripts/import-nanoka-bosses.mjs BOSS_DEFAULTS）`)
  }
}

/** 招式/倍率查询：agentSkills 倍率表是 moveId 唯一权威（编号分段非连续，禁止推算） */
function showMove(agent, token) {
  const skills = catalog.agentSkills?.find(s => String(s.agentId) === String(agent.id))
  if (!skills) return fail(`角色 ${idName(agent)} 无倍率表（agentSkills）`)
  const allMoves = skills.categories.flatMap(cc => cc.moves.map(m => ({ ...m, category: cc.id })))
  const t = String(token ?? '').trim()
  if (t === '' || t === '列表' || t === 'list') {
    console.log(`== ${idName(agent)} 倍率表全列（${allMoves.length} 招）==`)
    for (const m of allMoves) console.log(`  ${m.id}  ${zh(m.name)} [${m.category}]`)
    return
  }
  let move = allMoves.find(m => m.id === t)
  if (!move) {
    const byName = allMoves.filter(m => zh(m.name) === t)
    if (byName.length === 1) move = byName[0]
    else {
      const bySub = allMoves.filter(m => zh(m.name).includes(t) || (m.name?.en ?? '').toLowerCase().includes(t.toLowerCase()))
      if (bySub.length === 1) move = bySub[0]
      else if (bySub.length > 1) return fail(`招式「${t}」歧义，命中 ${bySub.length} 个：\n${bySub.map(m => `  - ${zh(m.name)}(${m.id})`).join('\n')}`)
      else return fail(`角色 ${idName(agent)} 无招式「${t}」（可用: node scripts/resolve.mjs 招式 ${agent.id} 列全表）`)
    }
  }
  console.log(`== 招式 ${zh(move.name)}(${move.id}) · ${idName(agent)} · ${move.category} ==`)
  line('元素/类型', `${ATTR_LABELS[move.damageElement] ?? move.damageElement} · ${move.skillType} · actionTime ${move.actionTime ?? '?'}s`)
  for (const r of move.rows ?? []) {
    const vals = r.values ?? []
    const v = vals.length === 1 ? vals[0] : `${vals[0]}…${vals[vals.length - 1]}（${vals.length}档）`
    line(r.id, `${v}${r.damageBasis ? ` · basis ${r.damageBasis}` : ''}${r.damageElement ? ` · ${r.damageElement}` : ''}`)
  }
  console.log('  ⚠ nanoka skill_list 的 id 不是 moveId——匹配一律用本表 id（AGENT_RECORDING_SOP §0.5 陷阱）')
}

function showBuffGroup(g) {
  console.log(`== 队友 buff 组 ${idName(g)}（${SPEC_LABELS[g.specialty] ?? g.specialty}）==`)
  for (const b of g.buffs ?? []) {
    line(zh(b.source), `${zh(b.description).slice(0, 80)}… [${b.scope}] effects=${(b.effects ?? []).map(e => e.stat).join(',')}`)
  }
}

function showSpec(agent) {
  let spec
  try { spec = readJson(`src/specs/agents/${agent.id}.json`) } catch { return fail(`角色 ${idName(agent)} 无 spec 文件（src/specs/agents/${agent.id}.json）`) }
  console.log(`== Spec ${idName(agent)} ==`)
  line('status', spec.status ?? '?')
  line('sections', `转模 ${spec.attributeConversions?.length ?? 0} · 资源 ${spec.resources?.length ?? 0} · 事件 ${spec.events?.length ?? 0} · 队友buff ${spec.teamBuffs?.length ?? 0} · 验证 ${spec.verifications?.length ?? 0}`)
  const notes = (spec.notes ?? []).filter(n => n.includes('[已确认]') || n.includes('[猜测'))
  line('口径标注', notes.length ? `${notes.length} 条（含已确认/猜测）` : '无')
  line('警告', '自定义 TS 模块角色的 spec 字段是死数据（AGENTS.md 规则 4），机制以 src/mechanics/agents/ 模块为准')
}

function audit(kind) {
  if (kind === undefined || kind === '专武') {
    console.log('== 体检：专武归属 ↔ 配装推荐一致性（护栏测试 buildRecWengine.test.ts 的 CLI 信息版）==')
    let ok = 0, bad = 0
    for (const e of engines) {
      if (!e.ownerAgentId) continue
      const rec = recs.characters?.[String(e.ownerAgentId)]?.wengine
      const good = rec && String(rec.catalog_wengine_id) === String(e.id)
      if (good) ok++
      else { bad++; console.log(`  ✗ ${idName(e)} → 推荐 ${rec?.catalog_wengine_id ?? '缺失'}`) }
    }
    console.log(`  ${ok} 条一致，${bad} 条不一致（不一致=数据 bug，测试会红）`)
  }
  if (kind === undefined || kind === '混淆名') {
    console.log('== 体检：互为子串的易混淆名对（名字联想高危区）==')
    for (const [list, what] of [[engines, '音擎'], [agents, '角色']]) {
      for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
        const a = zh(list[i].name), b = zh(list[j].name)
        if (a !== b && (a.includes(b) || b.includes(a))) console.log(`  ⚠ ${what}: 「${a}」↔「${b}」互为子串`)
      }
    }
  }
  if (kind !== undefined && kind !== '专武' && kind !== '混淆名') fail(`未知体检项「${kind}」（可用：专武 / 混淆名）`)
}

// ---- 入口 ----
const [cmd, ...rest] = process.argv.slice(2)
try {
  if (cmd === '音擎' || cmd === 'engine') showEngine(resolveEntity(engines, rest[0], '音擎'))
  else if (cmd === '角色' || cmd === 'agent') showAgent(resolveEntity(agents, rest[0], '角色'))
  else if (cmd === '专武' || cmd === 'sig') {
    const agent = resolveEntity(agents, rest[0], '角色')
    const sig = engines.find(e => String(e.ownerAgentId) === String(agent.id))
    if (!sig) fail(`角色 ${idName(agent)} 无专武归属（ownerAgentId 无指向）`)
    showEngine(sig)
  } else if (cmd === '套装' || cmd === 'set') showSet(resolveEntity(sets, rest[0], '套装'))
  else if (cmd === 'boss') showBoss(resolveEntity(bosses, rest[0], 'Boss'))
  else if (cmd === '招式' || cmd === 'move') showMove(resolveEntity(agents, rest[0], '角色'), rest[1] ?? '列表')
  else if (cmd === 'buff') showBuffGroup(resolveEntity(teammateBuffs, rest[0], 'buff 组'))
  else if (cmd === 'spec') showSpec(resolveEntity(agents, rest[0], '角色'))
  else if (cmd === 'audit') audit(rest[0])
  else {
    console.log('用法: node scripts/resolve.mjs <音擎|角色|专武|套装|boss|招式|buff|spec|audit> <名|id> [参数]')
    console.log('详见 docs/ENTITY_CARDS.md；派生数值（面板/暴击预算）用 npm run probe:panel')
    process.exit(cmd ? 1 : 0)
  }
} catch (err) {
  fail(err?.message ?? String(err))
}
