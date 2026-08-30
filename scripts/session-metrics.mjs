#!/usr/bin/env node
// 会话级工作流度量：从 ZCode 本地会话库（~/.zcode/cli/db/db.sqlite，只读）提取
// 「agent 干活质量」硬指标，用于回答「文档/护栏/架构改动后工作流有没有变好」。
//
// ── 为什么存在 ──────────────────────────────────────────────────────────────
// 2026-08-30 用户问「怎么知道 AI 的工作流有没有提升」。答案分两半：
//   ① 数据已在本地盘上（db.sqlite：session/message/part/tool_usage/model_usage），
//      无需人工导出——本脚本只读查询它；
//   ② 但「after」样本尚不存在：实体卡+resolve 架构 08-30 14:38 才上线
//      （commit 5bb16e6），check-guards 当天晚上才接入。所以今天能做的是
//      **冻结 before 基线 + 预注册指标契约**，等真实任务攒够再对比。
//
// ── 预注册契约（对比时不得移动球门）──────────────────────────────────────────
// 分组：before = 2026-08-16..08-29（纯文档时代）；after = 架构上线后的录入类任务。
// 混淆控制：46 会话里出现过 10 个 model_id（stealth/ox-alpha 19 / glm-5.3 21 /
// deepseek-v4-flash 11 / …），对比必须按 model 分层；任务类型按会话标题粗分。
// **混杂因素清单（用户 2026-08-30 指出，对比时先排除这些解释再谈架构效果）**：
//   C1 harness 版本更新（工具行为变化，如 dsh 的 FS 版本守卫上线时点）
//   C2 模型切换 / 升级（同一任务不同模型基线不同——必须 --model 分层）
//   C3 思考档位（reasoningEffort）变化（dsh request/header 里有记录，可分层）
//   C4 任务难度漂移（after 期若全是硬任务，失败率升高不代表架构变差）
// 结论纪律：指标变化只能作为「方向参考」，不能单独作为因果证据；多指标同向 +
//   分层稳定 + 排除 C1-C4 后才可下「架构有效」的判断。
// 判定「提升」（after vs before，同 model 层内）：
//   M1 resolve 采用率：触及角色/音擎数据的会话中跑过 resolve.mjs 的比例
//      （before=0%，工具不存在；这才是「名字联想被查证替代」的直接度量）
//   M2 Edit 失败率：old_string 不匹配 = agent 的文件心智模型错（before 全期 5.8%；
//      dsh 侧用 error.code 分类，只有 FS_EDIT_NOT_FOUND 算心智模型错）
//   M3 事故登记增速：ENTITY_CARDS §8 每新增 N 个录入任务的撞名/漏读行数
//   M4 verify 执行率：有 Edit 的会话中跑过 npm run verify/check 的比例
// 已知口径陷阱：Bash exit≠0 不全是坏事——护栏大声失败（check-guards/validate 红）
// 是设计行为，对比时要按命令文本把「护栏红」与「命令错」分开。
//
// ── before 基线（2026-08-30 冻结，46 会话 / 08-16..08-30）───────────────────
//   Edit 1142 次，失败 71（5.9%）；Bash 4242 次，失败 126（2.9%）
//   resolve.mjs = 0 次 / probe:panel = 0 次（工具 08-30 才存在）
//   grep 类探索 ~2900 次、41/46 会话在用（规则 15 要替代的正是这个名字联想入口）
//   npm run verify = 160 次 / 13 个会话（采用率 ~28%）
//   08-30 当天（架构上线首日）：resolve 18 次/2 会话、probe 7 次/2 会话
//
// 用法：node scripts/session-metrics.mjs [--since 2026-08-30] [--model glm-5.3]
//   DB 路径可用 ZCODE_DB 环境变量覆盖；库不存在时打 warning 退出 0（非 CI 判据）。
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const DB_PATH = process.env.ZCODE_DB ?? join(homedir(), '.zcode/cli/db/db.sqlite')

const args = process.argv.slice(2)
const sinceIdx = args.indexOf('--since')
const since = sinceIdx >= 0 ? args[sinceIdx + 1] : null
const modelIdx = args.indexOf('--model')
const modelFilter = modelIdx >= 0 ? args[modelIdx + 1] : null

const VERBS = ['resolve.mjs', 'probe:panel', 'npm run verify', 'npm run check', 'docs:status', 'grep']

if (!existsSync(DB_PATH)) {
  console.warn(`⚠ 未找到会话库 ${DB_PATH}，无度量可出（本脚本非 CI 判据）`)
  process.exit(0)
}

const { DatabaseSync } = await import('node:sqlite')
const db = new DatabaseSync(DB_PATH, { readOnly: true })

const dayOf = (ms) => new Date(Number(ms)).toISOString().slice(0, 10)

// ── 每会话模型映射（分层用）──
const sessModel = {}
for (const r of db.prepare('SELECT session_id, model_id FROM model_usage').all())
  sessModel[r.session_id] = r.model_id

// ── 指标 1：每日 Edit/Bash 成败 ──
const rows = db.prepare(`
  SELECT s.id sid, s.time_created tc,
    SUM(CASE WHEN tu.tool_name='Edit' THEN 1 ELSE 0 END) edits,
    SUM(CASE WHEN tu.tool_name='Edit' AND tu.status!='completed' THEN 1 ELSE 0 END) edit_fail,
    SUM(CASE WHEN tu.tool_name='Bash' THEN 1 ELSE 0 END) bash,
    SUM(CASE WHEN tu.tool_name='Bash' AND tu.exit_code IS NOT NULL AND tu.exit_code!=0 THEN 1 ELSE 0 END) bash_fail
  FROM session s LEFT JOIN tool_usage tu ON tu.session_id=s.id
  GROUP BY s.id ORDER BY s.time_created`).all()

const day = {}
let tot = { s: 0, e: 0, ef: 0, b: 0, bf: 0 }
console.log(`date        sess  Edit(ok/fail)  Bash(ok/fail)`)
for (const r of rows) {
  if (since && dayOf(r.tc) < since) continue
  if (modelFilter && sessModel[r.id] !== modelFilter) continue
  const d = dayOf(r.tc)
  day[d] = day[d] || { s: 0, e: 0, ef: 0, b: 0, bf: 0 }
  day[d].s++; day[d].e += r.edits; day[d].ef += r.edit_fail; day[d].b += r.bash; day[d].bf += r.bash_fail
  tot.s++; tot.e += r.edits; tot.ef += r.edit_fail; tot.b += r.bash; tot.bf += r.bash_fail
}
for (const [d, v] of Object.entries(day))
  console.log(`${d}  ${String(v.s).padStart(4)}  ${v.e - v.ef}/${v.ef}        ${v.b - v.bf}/${v.bf}`)
if (tot.e || tot.b) {
  console.log(`TOTAL      ${String(tot.s).padStart(4)}  ${tot.e - tot.ef}/${tot.ef}        ${tot.b - tot.bf}/${tot.bf}`)
  if (tot.e) console.log(`Edit 失败率 ${(100 * tot.ef / tot.e).toFixed(1)}%` + (tot.b ? ` | Bash 失败率 ${(100 * tot.bf / tot.b).toFixed(1)}%` : ''))
}

// ── 指标 2：动词采用（按天 × 会话数）──
const parts = db.prepare(`SELECT session_id, time_created, data FROM part WHERE data LIKE '%"type":"tool"%' ORDER BY time_created`).all()
const verbDay = {}, verbSess = new Map()
for (const p of parts) {
  if (modelFilter && sessModel[p.session_id] !== modelFilter) continue
  let d
  try { d = JSON.parse(p.data) } catch { continue }
  if (d?.type !== 'tool' || d.tool !== 'Bash') continue
  const cmd = d.state?.input?.command ?? ''
  if (typeof cmd !== 'string' || !cmd) continue
  const dayKey = dayOf(p.time_created)
  if (since && dayKey < since) continue
  for (const v of VERBS) {
    if (!cmd.includes(v)) continue
    verbDay[v] = verbDay[v] || {}
    verbDay[v][dayKey] = (verbDay[v][dayKey] || 0) + 1
    if (!verbSess.has(v)) verbSess.set(v, new Set())
    verbSess.get(v).add(p.session_id)
  }
}
console.log(`\n动词采用（按天）：`)
for (const v of VERBS) {
  if (!verbDay[v]) continue
  const days = Object.entries(verbDay[v]).map(([d, c]) => `${d}=${c}`).join(' ')
  console.log(`  ${v}（${verbSess.get(v).size} 会话）: ${days}`)
}

// ── 指标 3：verify 执行率（有 Edit 的会话为分母，分母分子同窗口/同分层）──
const sessCreated = {}
for (const r of db.prepare('SELECT id, time_created FROM session').all()) sessCreated[r.id] = Number(r.time_created)
const sessTools = db.prepare(`SELECT session_id FROM tool_usage WHERE tool_name = 'Edit'`).all()
const editSess = new Set(sessTools.map(r => r.session_id).filter(s =>
  (!modelFilter || sessModel[s] === modelFilter)
  && (!since || dayOf(sessCreated[s] ?? 0) >= since)))
const verifySess = verbSess.get('npm run verify') ?? new Set()
const checkSess = verbSess.get('npm run check') ?? new Set()
const covered = [...editSess].filter(s => verifySess.has(s) || checkSess.has(s)).length
if (editSess.size) console.log(`\nverify 执行率：有 Edit 的 ${editSess.size} 会话中 ${covered} 跑过 verify/check = ${(100 * covered / editSess.size).toFixed(0)}%`)
