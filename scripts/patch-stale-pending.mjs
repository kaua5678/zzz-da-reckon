#!/usr/bin/env node
/**
 * 修正四条「凭名字联想写出来的 pending」——用户 2026-09-14 集中问答里逐条裁过的三态。
 *
 * 为什么用脚本而不是手改 JSON：AGENTS 规则 2——`public/static/*.json` 是生成物，
 * 改动必须走 `scripts/` 管道重跑（幂等：文本已改成目标值就 skip，重复跑不产生 diff）。
 *
 * 每条改动的**依据**都写在下面（都是本轮盘上实测，不是推断）：
 *
 * 1) **1641 余火标度**：pending 标 `[猜测·低]，待正式服复核` ⇒ 其实**可以当场确认**。
 *    证据 = 同一行的 `energy_gain_base=71040` 在 catalog 里就是 `energy_recovery 7.104`
 *    （`node scripts/resolve.mjs 招式 1641 1641004`）⇒ 这批整型列统一 ×10000；
 *    双源同值（gachabase `1641.json` 与 nanoka_missing/full/1641.json 都是 147634）
 *    ⇒ 余火/次 = 14.7634，正是用户说的「十几」。**反证**：按 /100 会得 1476 而长按仅耗 90
 *    ⇒ 一次燃烧攻击连放 16 次，不成立。代码侧同口径已随 `763f791` 落注释。
 *
 * 2) **1561「普通风化 DoT 总伤害池」**：**这条机制不存在**，pending 是凭空造的。
 *    证据 = ① `docs/mechanism-reference.md:193`「**一次性**风化伤害（基础倍率 1250%）+ 施加
 *    持续 30s 的风化**状态**（期间风属性直伤提升）」、`:195`「有风属性时 **DoT 伤害归零**（被乱流吞了）」；
 *    ② 代码侧 `src/core/anomalyPool/helpers.ts:1332` 注释就写着「风化 1250% **单次**」；
 *    ③ `windAnomalyDmgBonus` **确实接进了异常结算**（`src/core/damage.ts:747` 与
 *    `src/core/anomalyPool/helpers.ts:890`），pending 说「尚未接入基础倍率模型」也不成立。
 *    ⇒ 整条 pending 撤下（改判 = 无此机制），不新建任何东西。
 *
 * 3) **1581 luminize_voidflare**：文本没错但**缺限定词**（规则 16②：无限定词的主体会被按名字联想套用）。
 *    「游戏内实测伤害校对仍待做」被读成了「耀变没建模」——其实 `src/specs/agents/1581.json:69`
 *    就记着「已实现并有生效测试；耀变结算在异常池自动进行」（最后动它 = `84d825e`）。
 *    ⇒ 只把主语补全（缺的是**一次实伤数字校核**，不是机制缺失）。
 *
 * 4) **1581 special_voidflare**：pending 说「账本无对应条目」**说反了方向**——
 *    账本有（`src/specs/agents/1581.json:70` 标着「2026-08-26 **用户确认**：特殊虚耀 ×2.5 独立乘区」），
 *    **引擎没有**：全仓 `2.5`/`250` 只出现在 `useResourceCalc.ts:789` 的 **formula 文案字符串**里，
 *    `src/mechanics/agents/remielle.ts` 无相关常量，`src/core/damage.ts:997` 明写
 *    「特殊虚耀属于异常事件，不走直伤公式；这里只保留资源池中的事件次数记录」
 *    ⇒ 挂着「用户确认」的口径零算术实现 = 规则 16① 点名的**死口径**（比没注释更危险）。
 *    本脚本只把 pending 文本改成**准确描述**（谁有、谁没有、缺哪一步），**不擅自补乘区**
 *    （新增乘区要用户裁决，AGENTS 规则 6/MECHANIC_PATTERNS 不许造新乘区）。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { writeJsonCompact } from './lib/jsonio.mjs'

const root = process.cwd()
const MECHANICS = resolve(root, 'public/static/character-mechanics.json')
const dryRun = process.argv.includes('--dry-run')

/** 每条 = { agentId, mechId, 旧文本子串（定位用，对不上就报错不猜）, 新文本（null = 撤下整条）, 依据 } */
const FIXES = [
  {
    agentId: '1641', mechId: 'core_passive_1641',
    match: '余火获取速率按 attack_data /10000 口径解读',
    replace: null,
    intoImplemented: '余火标度已确认（2026-09-14 用户复核 + 盘上对账）：同列 energy_gain 71040→catalog 7.104 证明整型列统一 ×10000，故 attack_data_0/10000 = 余火/次（三段 8.02 / 四段 14.76 / 强特 15.02+19.70 / 连携 14.88 / 终结 28.82，双源一致），与消耗 90 同单位。口径钉在 src/mechanics/agents/phoenix.ts 的 PHOENIX_COMBUSTION_MOVE_ID 注释（commit 763f791）。',
    why: '标度已由同列 energy_gain 当场证实，不再需要「待正式服复核」',
  },
  {
    agentId: '1561', mechId: 'tea_party_etiquette',
    match: '普通风化DoT总伤害池尚未接入',
    replace: null,
    intoImplemented: '无此机制（2026-09-14 用户复核 + 文档/代码对账）：风化 = 一次性伤害（基础倍率 1250%）+ 持续 30s 的「风化状态」（期间风属性直伤提升），本身不产生持续出伤（docs/mechanism-reference.md §8.4、src/core/anomalyPool/helpers.ts「风化 1250% 单次」，且「有风属性时 DoT 伤害归零（被乱流吞了）」）。windAnomalyDmgBonus 已接进异常结算（src/core/damage.ts、anomalyPool/helpers.ts），不存在待接的「风化 DoT 总伤害池」。',
    why: 'pending 描述的机制不存在；原句还误称 windAnomalyDmgBonus 未接入（它接了）',
  },
  {
    agentId: '1581', mechId: 'luminize_voidflare',
    match: '游戏内实测伤害校对仍待做',
    replace: '耀变**已建模且有生效测试**（本 spec 审计行 2026-08-25 记「展示账本已实现并有生效测试；耀变结算在异常池自动进行」）。本条缺的不是机制、是**一次游戏内实伤数字与模型值的对表**：账本值为 Excel 模型值（非实测）。补一次实伤截图即可销账。',
    why: '原句无限定词，被读成「耀变没建模」（规则 16②）',
  },
  {
    agentId: '1581', mechId: 'special_voidflare',
    match: '账本无特殊虚耀对应条目',
    replace: '方向纠正（2026-09-14 实测）：**账本有、引擎没有**。本 spec 的口径行（2026-08-26 用户确认）记着「特殊虚耀 ×2.5 独立乘区」，但全仓 2.5 只出现在 useResourceCalc 的 formula **文案字符串**里，remielle.ts 无该常量，core/damage.ts 明写「特殊虚耀…不走直伤公式，只保留事件次数记录」⇒ 这是规则 16① 的**死口径**（挂着「用户确认」却零算术实现）。待用户裁决：① 补 250% 独立乘区进异常结算，或 ② 撤该口径改按「只计次数」。补乘区属新乘区，不许 agent 自行落（规则 6 / MECHANIC_PATTERNS）。',
    why: '原句把缺口指错了方向（说账本没有，其实引擎没有）',
  },
]

const data = JSON.parse(readFileSync(MECHANICS, 'utf8'))
const chars = data.characters ?? {}
let changed = 0

for (const fix of FIXES) {
  const ch = chars[fix.agentId]
  if (!ch) { console.error(`✗ mechanics 缺角色 ${fix.agentId}`); process.exit(1) }
  const mech = (ch.mechanics ?? []).find(m => m.id === fix.mechId)
  if (!mech) { console.error(`✗ ${fix.agentId} 缺机制 ${fix.mechId}`); process.exit(1) }
  const idx = (mech.pending ?? []).findIndex(p => p.includes(fix.match))
  if (idx < 0) {
    // 幂等：已经改过（新文本在、旧文本没了）就 skip；两边都对不上才是真错误。
    // ⚠ 判据不能写成 `pending.some(...)`：撤下型改动会让 pending 变成空数组，
    //   `.some()` 永不进回调 ⇒ 第二次跑反而报「定位失败」（实测踩过）。先看目标态在不在，再看旧文本。
    const targetPresent = fix.replace
      ? (mech.pending ?? []).includes(fix.replace)
      : (mech.implemented ?? []).includes(fix.intoImplemented ?? '\x00')
    const already = targetPresent && !(mech.pending ?? []).some(x => x.includes(fix.match))
    console.log(`${already ? 'skip(已改)' : '✗ 定位失败'} ${fix.agentId}/${fix.mechId}`)
    if (!already) process.exit(1)
    continue
  }
  const old = mech.pending[idx]
  if (fix.replace) mech.pending[idx] = fix.replace
  else mech.pending.splice(idx, 1)
  if (fix.intoImplemented) {
    mech.implemented = [...(mech.implemented ?? []), fix.intoImplemented]
  }
  changed++
  console.log(`patched ${fix.agentId}/${fix.mechId}`)
  console.log(`  旧：${old.slice(0, 90)}…`)
  console.log(`  新：${fix.replace ? fix.replace.slice(0, 90) + '…' : '（撤下 pending，转 implemented）'}`)
  console.log(`  依据：${fix.why}`)
}

if (!changed) { console.log('无改动（全部已是目标状态）'); process.exit(0) }
if (dryRun) { console.log(`--dry-run：本应写 ${changed} 条`); process.exit(0) }
writeJsonCompact(MECHANICS, data)
console.log(`已写入 character-mechanics.json（${changed} 条，紧凑）`)
