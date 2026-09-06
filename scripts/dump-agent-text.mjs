#!/usr/bin/env node
/**
 * 游戏原文 dump（**术语还原版**）——录机制/核口径时的唯一正确读法。
 *
 * 为什么必须有这个工具（2026-09-07 事故）：nanoka raw 里的术语是**空壳标签**
 * `<Term:1000029></Term>`，名字在 `noun_*.json` 里、不在正文里。任何 `sed`/`replace(/<[^>]+>/g,'')`
 * 式的手工清洗都会把它**抹成空白**，于是：
 *   「希格莉德的任意<Term:1000029></Term>命中敌人时」→「希格莉德的任意命中敌人时」
 * 读出来就是一句**假原文**，而它语法完整、毫无破绽，能一路通过复核——本次就是拿它断言
 * 「模块误读了原文」，白绕十几轮（AGENTS 规则16①：口径必须挂在活代码上；这里是"必须挂在
 * 还原后的原文上"）。
 *
 * 用法：
 *   node scripts/dump-agent-text.mjs 希格莉德            # 全部（技能 + 影画 + 被动）
 *   node scripts/dump-agent-text.mjs 1591 --cat passive  # 只看被动/额外能力
 *   node scripts/dump-agent-text.mjs 1591 --cat talent   # 只看影画
 *   node scripts/dump-agent-text.mjs 1591 --cat chain    # 只看某类技能（basic/dodge/special/chain/assist）
 *   node scripts/dump-agent-text.mjs 1591 --lv 7         # 核心被动指定等级（默认取最高级 = 满级）
 *
 * 歧义/未命中 exit 1（与 scripts/resolve.mjs 同纪律：绝不凭名字联想静默选最像的）。
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const RAW = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'raw', 'nanoka_missing')
const CATALOG = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'static', 'catalog.json')

const argv = process.argv.slice(2)
const flags = {}
const pos = []
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith('--')) { flags[argv[i].slice(2)] = argv[++i] ?? '1'; continue }
  pos.push(argv[i])
}
const token = pos[0]
if (!token) {
  console.error('用法：node scripts/dump-agent-text.mjs <角色名|id> [--cat basic|dodge|special|chain|assist|talent|passive] [--lv N]')
  process.exit(1)
}

/** 术语表：取 data/raw/nanoka_missing/noun_*.json 里版本号最大的那份 */
function loadNouns() {
  const files = readdirSync(RAW).filter(f => /^noun_.*\.json$/.test(f)).sort()
  if (files.length === 0) return { map: {}, file: '(无 noun_*.json —— 术语无法还原！)' }
  const file = files[files.length - 1]
  return { map: JSON.parse(readFileSync(join(RAW, file), 'utf8')), file }
}
const { map: NOUNS, file: NOUN_FILE } = loadNouns()

/**
 * 清洗 raw 文本：术语还原 → 图标具名 → 去颜色标签 → 压空白。
 * ⚠️ 未命中术语**保留占位并标红**，绝不静默抹掉（抹掉就是本次事故的成因）。
 */
function clean(text) {
  return String(text ?? '')
    .replace(/<Term:(\d+)><\/Term>/g, (_m, id) => {
      const hit = NOUNS[id]
      return hit ? hit.name : `【术语${id}未命中noun表】`
    })
    .replace(/<IconMap:([^>]+)>/g, (_m, k) => {
      const map = { Icon_Normal: '[普攻键]', Icon_Special: '[特技键]', Icon_Dodge: '[闪避键]', Icon_Ultimate: '[终结键]', Icon_Assist: '[支援键]' }
      return map[k] ?? `[${k}]`
    })
    .replace(/\{Skill:(\d+),\s*Prop:(\d+)\}/g, '[倍率:$1]')
    .replace(/<[^>]+>/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim()
}

/** 角色解析：id 精确 → 名字精确 → 名字唯一子串；歧义 exit 1 */
function resolveAgent(tok) {
  const catalog = JSON.parse(readFileSync(CATALOG, 'utf8'))
  const agents = catalog.agents ?? []
  const byId = agents.find(a => String(a.id) === tok)
  if (byId) return byId
  const byName = agents.filter(a => a.name?.zhCN === tok || a.name?.en === tok)
  if (byName.length === 1) return byName[0]
  const bySub = agents.filter(a => (a.name?.zhCN ?? '').includes(tok))
  if (bySub.length === 1) return bySub[0]
  if (byName.length > 1 || bySub.length > 1) {
    console.error(`角色「${tok}」歧义（${[...new Set([...byName, ...bySub])].map(a => `${a.name.zhCN}(${a.id})`).join(', ')}）——用 id 或全名`)
  } else {
    console.error(`角色「${tok}」未命中 catalog`)
  }
  process.exit(1)
}

const agent = resolveAgent(token)
const rawPath = join(RAW, 'full', `${agent.id}.json`)
if (!existsSync(rawPath)) {
  console.error(`${agent.name?.zhCN}(${agent.id}) 无 raw 原文（${rawPath} 不存在）——data/raw/nanoka_missing/full/ 只覆盖补录角色`)
  process.exit(1)
}
const d = JSON.parse(readFileSync(rawPath, 'utf8'))

console.log(`== ${agent.name?.zhCN}(${agent.id}) 原文（术语还原，词表 ${NOUN_FILE}）==`)
if (Object.keys(NOUNS).length === 0) console.log('⚠ noun 表为空：术语无法还原，输出里的【未命中】标记必须当红灯看')

const want = flags.cat
const SKILL_CATS = ['basic', 'dodge', 'special', 'chain', 'assist']

if (!want || want === 'skill' || SKILL_CATS.includes(want)) {
  const cats = want && want !== 'skill' ? [want] : SKILL_CATS
  for (const cat of cats) {
    for (const it of d.skill?.[cat]?.description ?? []) {
      if (!it.desc) continue
      console.log(`\n### [${cat}] ${it.name}`)
      console.log(clean(it.desc))
    }
  }
}

if (!want || want === 'talent') {
  for (const [k, v] of Object.entries(d.talent ?? {})) {
    console.log(`\n##### 影画${k} · ${v.name}`)
    console.log(clean(v.desc))
  }
}

if (!want || want === 'passive') {
  const levels = Object.keys(d.passive?.level ?? {})
  // 被动等级键形如 1591501 = <agentId> + 5 + 等级序号；按尾号匹配，不硬编码角色
  const pick = flags.lv
    ? levels.filter(k => k.endsWith(String(flags.lv).padStart(2, '0')))
    : levels.slice(-1)
  if (flags.lv && pick.length === 0) console.error(`⚠ 被动等级 ${flags.lv} 不存在，可用尾号：${levels.map(k => k.slice(-2)).join(', ')}`)
  for (const key of pick) {
    const e = d.passive.level[key]
    console.log(`\n##### 被动 ${key}（${levels.indexOf(key) + 1}/${levels.length}）`)
    ;(e.name ?? []).forEach((nm, i) => {
      console.log(`--- ${nm}`)
      console.log(clean(e.desc?.[i] ?? ''))
    })
  }
}
