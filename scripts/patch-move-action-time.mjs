#!/usr/bin/env node
/**
 * 定点修正招式 actionTime（catalog 是数值唯一事实源，改数值走脚本，不手改 JSON）。
 *
 * 背景（2026-08 用户口径）：nanoka 导入旧公式「秽盾/100，闪反-1.5、弹刀-2.5、终结-5」隐含
 * 假设秽盾 = 动作时间×100 + 类型加成（+150/+250/+500）。该假设对部分招式不成立：
 *   - 佩洛伊斯(1551) 大招：万军诛绝/无拘剑势/永陷幽囚 秽盾 = 积蓄 + 350.01，
 *     凯旋坦途 = 积蓄 + 0.01 —— 真实时间 = 积蓄/100，用户游戏内核对：
 *     万军诛绝 2.4329 / 凯旋坦途 1.1503 / 无拘剑势 3.0663 / 永陷幽囚 2.2836。
 *   - 招架支援 #3 的秽盾本就是裸时间×100（无 +250 加成），被 -2.5 错钳成 0.001；
 *     原始管线角色（维琳娜/简等）#3 均录 1.166 可交叉验证。
 *   - 叶瞬光(1431) 终结技、雨果(1291)/星徽·比利(1531)/猫又(1021) 闪避反击：秽盾 ≈ 积蓄
 *     （加成整体缺失），真实时间 = 积蓄/100。
 *
 * 规则（与 import-nanoka-missing.mjs actionTime 新逻辑同源）：
 *   A. 显式覆盖：USER_TIME_OVERRIDES（公式推不出的第三种秽盾偏移，必须用户核对值）。
 *   B. 加成缺失：类型加成 >0 且 秽盾≈积蓄（|差|≤2）→ 时间 = round4(积蓄/100)。
 *   C. 加成缺失且无积蓄（招架支援#3 型）：秽盾 ≤ 加成额 → 时间 = round3(秽盾/100)。
 * 歧义 case 不动（如可琳[舍] 秽盾=积蓄+75.01，裸值/积蓄两解），留给用户核对。
 *
 * 幂等：已是目标值时输出 unchanged 不写文件。改完跑 npm run validate:data +
 * npm run gen:multiplier-record + 相关测试。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { writeJsonCompact } from './lib/jsonio.mjs'
import { counterAssistEtherBase, inferTypeBonusFromRows, inferTypeBonusFromName, TYPE_BONUS_TOLERANCE } from './lib/type-bonus-time.mjs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const catalogPath = join(root, 'public', 'static', 'catalog.json')

/** moveId → 用户核对的 actionTime（秒）。仅用于公式不可推导的秽盾偏移。 */
const USER_TIME_OVERRIDES = {
  // 佩洛伊斯四终结技：真实时间 = 积蓄/100（2026-08 用户核对）
  1551015: 2.4329, // 终结技：万军诛绝（积蓄 243.29）
  1551014: 1.1503, // 终结技：凯旋坦途（积蓄 115.03）
  1551013: 3.0663, // 终结技：无拘剑势（积蓄 306.63）
  1551016: 2.2836, // 终结技：永陷幽囚（积蓄 228.36）
  // 可琳(1061) 闪避反击：150 秽盾奖励分散成 75+100t，时间 = 积蓄/100
  1061015: 0.6581, // 闪避反击：[舍] #1（积蓄 65.81）
  1061016: 0.6581, // 闪避反击：[舍] #2（积蓄 65.81）
  // 妮可(1031) 闪避反击：同上 75 分散
  1031205: 0.3164, // 闪避反击：牵制炮击 #1（积蓄 31.64）
  1031206: 0.3164, // 闪避反击：牵制炮击 #2（积蓄 31.64）
  // 妮可(1031) 终结技：特制以太榴弹 #1 奖励 200 秽盾 / #2 奖励 300
  1031304: 0.36, // 终结技：特制以太榴弹 #1（积蓄 35.99 → 0.3599）
  1031305: 0.54, // 终结技：特制以太榴弹 #2（积蓄 53.99 → 0.5399）
  // 奥菲丝(1301) 终结技：与火共舞 #1 奖励 300 秽盾 / #2 奖励 200
  1301015: 0.27, // 终结技：与火共舞 #1（积蓄 27）
  1301016: 0.18, // 终结技：与火共舞 #2（积蓄 18）
  // 照(1341) 终结技·兔兔连斩：两段共享 500 终结技秽盾加成，且**拆成 400+100**——
  // 旧公式对 #1 减满 500 得 0.467、对 #2 减满 500 得负数（故 catalog 里 #2 是 null）。
  // 用户口径 2026-09-11：「第一行秽盾应该是 −400，第二行 −100，他把奖励分成两半了，
  // 所以时间大概是 1.467+0.367，也就是说用秒均积蓄=100 来算」→ 真实时间 = 积蓄/100。
  1341014: 1.4666, // 终结技：兔兔连斩 #1（积蓄 146.66）
  1341023: 0.367, // 终结技：兔兔连斩 #2（积蓄 36.7）
}

/**
 * 类型加成：**数据优先、名字佐证**（2026-10-18 用户口径）。
 *
 * 修前只看名字 ⇒ 般岳「支援突击：冲霄」（英文名 Assist Follow-Up，不含任何类型关键词）
 * 的 150 闪反加成判不出来，时间取成 秽盾/100 = 2.667s（真实 1.167s）。
 * 现规则 = `秽盾 − 积蓄 ∈ {150,250,500}±2` ⇒ 加成由数据直接给出；名字只在与数据冲突时
 * 报错（全库 0 例，见 scripts/audit-type-bonus.mjs），避免静默改错别人的时间。
 */
function typeBonus(move) {
  const ether = rowValue(move, 'ether_purify')
  const buildup = rowValue(move, 'anomaly_buildup')
  const byData = inferTypeBonusFromRows({ etherPurify: ether, anomalyBuildup: buildup })
  const byName = inferTypeBonusFromName(move)
  if (byData > 0 && byName > 0 && byData !== byName) {
    console.warn(`⚠ ${move.id} ${move.name?.zhCN ?? ''}: 数据加成 ${byData} 与名字加成 ${byName} 冲突，按数据修正；请核对秽盾/积蓄`)
  }
  return byData > 0 ? byData : byName
}

function rowValue(move, rowId) {
  const row = (move.rows ?? []).find((r) => r.id === rowId)
  const v = row?.values?.[0]
  return typeof v === 'number' ? v : 0
}

const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'))

let changed = 0
for (const skills of catalog.agentSkills ?? []) {
  for (const category of skills.categories ?? []) {
    for (const move of category.moves ?? []) {
      const before = move.actionTime
      let target = USER_TIME_OVERRIDES[move.id]
      let reason = '用户核对覆盖'
      if (target == null) {
        const bonus = typeBonus(move)
        const ether = rowValue(move, 'ether_purify')
        const buildup = rowValue(move, 'anomaly_buildup')
        // 反制支援系（Counter Assist）：秽盾 = 300 + 100t。**数据反推不出来**（积蓄不参与那个恒等式），
        // 只能按招族认 —— 单源 `lib/type-bonus-time.mjs#counterAssistEtherBase`。
        const counterBase = counterAssistEtherBase(move)
        if (counterBase > 0 && ether > counterBase) {
          target = Math.round((ether - counterBase) / 100 * 10000) / 10000
          reason = `反制支援基数 ${counterBase}（秽盾${ether}）→ (秽盾−基数)/100`
        } else if (bonus > 0 && ether > 0 && buildup > 0 && Math.abs(ether - buildup) <= 2) {
          // 秽盾 ≈ 积蓄：秽盾里**没有**类型加成（数据缺口），真实时间 = 积蓄/100
          target = Math.round(buildup / 100 * 10000) / 10000
          reason = `加成缺失（秽盾${ether}≈积蓄${buildup}）→ 积蓄/100`
        } else if (bonus > 0 && ether > 0 && buildup <= 0 && ether <= bonus) {
          target = Math.round(ether / 100 * 1000) / 1000
          reason = `无加成无积蓄（秽盾${ether}≤加成${bonus}）→ 秽盾/100`
        } else if (bonus > 0 && ether > 0 && buildup > 0 && Math.abs(ether - buildup - bonus) <= 2) {
          // 秽盾 − 积蓄 = 类型加成：**加成确实存在**，真实时间 = (秽盾−加成)/100。
          // 修前这里没有分支 ⇒ 走兜底 ether/100（把加成当成时间），般岳冲霄因此 2.667s（应 1.167s）。
          target = Math.round((ether - bonus) / 100 * 10000) / 10000
          reason = `秽盾${ether} = 积蓄${buildup} + 加成${bonus} → (秽盾−加成)/100`
        }
      }
      // 只改**实质偏差**（> 0.01s = 1 厘秒）：catalog 里大量招式是 3 位小数、按 (秽盾−加成)/100 重算
      // 会得到 4 位小数（0.934 → 0.9337，差 0.3ms）——这类量化抖动不是修正，是噪声，不改。
      if (target == null || Math.abs(target - before) <= 0.01) continue
      console.log(`patch ${move.id} ${move.name?.zhCN ?? ''}: ${before} → ${target}（${reason}）`)
      move.actionTime = target
      changed++
    }
  }
}

if (changed === 0) {
  console.log('no changes')
  process.exit(0)
}
writeJsonCompact(catalogPath, catalog)
console.log(`done, ${changed} move(s) patched`)
