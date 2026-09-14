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
  // 第二轮（2026-09-14 用户裁决后追加）：上一版把这条写成「待用户裁决」，用户当场裁了「造一个乘区」。
  // ⚠ `match` 指向**上一版落盘的文本**（链式 patch）——同一个 mechId 允许两条 FIX 顺序生效，
  //    但每次跑只会有其一命中：旧文本在 → 打第 1 条；已是新文本 → 打第 2 条；都不是 → skip。
  {
    agentId: '1581', mechId: 'special_voidflare',
    match: '方向纠正（2026-09-14 实测）',
    replace: '**待建乘区**（2026-09-14 用户裁决）：本 spec 口径行（2026-08-26 用户确认）「特殊虚耀 ×2.5 独立乘区」引擎**零实现**——全仓 2.5 只在 useResourceCalc 的 formula 文案字符串里，core/damage.ts 明写「特殊虚耀不走直伤公式，只保留事件次数记录」。用户裁决原话：「游戏里这就是特殊虚耀特有的单独乘区，因为特殊虚耀的基础区是蕾米自己的，不同于普通虚耀，所以给这个伤害翻 2.5 倍单独赔偿。**引擎没有就造一个乘区**」。⇒ 待办 = 给特殊虚耀建 250% 独立乘区并接进异常结算（full 档：先写预测再量 timeGolden delta 逐队归因，规则 10）。落点候选 src/core/anomalyPool/（耀变/异放结算同族），别在编排层加 agentId 分支（规则 6）。',
    why: '用户裁决「造一个乘区」⇒ 由「账本有引擎没有」升级为明确的待建项',
  },
  // 第三轮（2026-09-14，工人 ff24a370 证伪上一轮派活方的审计）：**「引擎零实现」是我读错了**。
  // 乘区自初始提交 1a1f8c6 就在线：`resourceCalc/damagePool.ts:1589` `specialMultiplier = rainbowMultiplier * 2.5`
  // ⇒ 我那句「全仓 2.5 只在 formula 文案字符串里」漏搜了 `src/composables/resourceCalc/`（只查了 core/anomalyPool）。
  // `core/damage.ts:997` 的「不走直伤公式、只计次数」说的是 **core 直伤视图防双计**，不是没实现。
  {
    agentId: '1581', mechId: 'special_voidflare',
    match: '待建乘区**（2026-09-14 用户裁决）',
    replace: '已实现（2026-09-14 复核纠正）：×2.5 独立乘区自初始提交 `1a1f8c6` 就在线——落点 `src/composables/resourceCalc/damagePool.ts` 的 `specialMultiplier = rainbowMultiplier * 2.5` → `calcVoidflareDamage`（垂虹 1581007 耀变倍率 × 进场面板，C1 另有无视 50% 抗），行 `remielle-special-voidflare` 汇入 teamTotalDamage。实测 C6 3 异常队：垂虹 180% ⇒ 基础区 450%，行 perDamage 与独立重算**逐位相等**（不乘 2.5 的重算比值恰 2.5）；普通虚耀三载体行（assist/ultimate/basic）无 ×2.5。⚠ 本条 pending 曾被我误写成「引擎零实现/待建」——根因 = 只 grep 了 core 与 anomalyPool、漏了编排层，且把 `core/damage.ts`「不走直伤公式」（那是**防双计**）读成「未实现」⇒ 若照字面再建一处会 ×6.25 双计。回归锁 = remielle.test.ts 的乘区逐位断言（该乘区此前全仓零测试）。',
    why: '上一轮派活方审计错误，按实测撤回「待建」并留下误判根因（防下任再建第二处）',
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
