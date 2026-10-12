import type {
  AgentCharConfigInput,
  AgentMechanicModule,
  AgentPanelInput,
  AgentResourceInput,
  AgentResourceResultInput,
  AgentResourceSectionsInput,
} from '../types'
import type { MechanicSetting } from '@/types/resource'
import type { AgentSkills, SkillMove } from '@/types/catalog'
import type { CharacterResourceResult} from '@/types/resource'
import { fmt } from '@/utils/format'
import { getAgentSpec } from '@/specs/registry'
import { buildSpecEventExecutions } from '@/specs/mechanics'
// 录入层不得值导入编排层（判据 19 layer-inversion，本文件曾是全仓唯一病灶）：纯查询从 data 层取。
// R37-J1（2026-09-19）：`findMoveById` / `getRowValue` 也改用 data 层单源——本文件曾各有一份私有同形函数，
// 其中 `getRowValue` 漏乘逻辑编辑器行融合乘数（getRowFusionMultiplier），与引擎其余路径分裂；
// 判据 = claretSmoke.test.ts「R37-J1」组（行为面：基准行 ×2 ⇒ 平A秒均 ×2；形状面：本文件不得再有同形私有函数）。
import { pickThirdNamedBasicSegment, fusedRowValue, findMoveById, getRowValue } from '@/data/moveTableQueries'
import { mechanicSettingReader } from '@/utils/mechanicSettingCfg'
import { moduleExecRow, ENERGY_RECOVERY_OFF } from '@/mechanics/moduleExecRow'
import { cinemaLevelOf } from '@/data/cinemaLevel'
import type { AgentAxisActionExpandInput } from '@/mechanics/typesHooks'
import type { StackActionCost } from '@/core/stunAxisStack'

const cfgSetting = mechanicSettingReader(() => settings)
/**
 * 克拉蕾（1611）v12 重录（2026-09-03，raw = nanoka 3.2.12+18601660）：
 *
 * 核心被动·苍白血宴（Lv.7）：伤害均为锐化伤害（def 基底，引擎 SHARPEN_DAMAGE_PROFILE 消费，
 * 锐暴伤害 150% 已随 level60.sharpCritDmg 接入）；**部分**锐化伤害命中积累残痕值，
 * 锐暴口径（用户 2026-09-09）：暴击率**封顶 200%**，100% 以上每 1% 是一次额外锐暴判定，
 *   每次锐暴**乘算**（150% → 爆一次 ×2.5、爆两次 ×6.25）——引擎 `core/damage.ts sharpCritMultiplier`；
 * 残痕值满时敌人进入[残痕]（同时最多挂 3 层）；斩金断铁/葬血强袭命中[残痕]敌人消耗 1 层触发[毁伤]。
 * 口径（用户 2026-09-03，**2026-09-12 更正两处**）：残痕每 600 点 = 1 层（1 次毁伤）；每命中积累 = 该招
 * **`gash_buildup`** 表值（%）——旧口径错写成 `anomaly_buildup`（异常积蓄列，两列在平A 段恰好同值、
 * 在闪反/支援/终结段差很多，见 GAME_TERM_TO_CODE_FIELD §11.1），且只算平A+EX 漏掉其余全部招式；
 * 「上限 3 层」是敌人身上**同时存量**上限，不是整局毁伤次数上限（全局计算器按总量：毁伤 = min(总层数, 消耗需求)）。
 * 积蓄效率 = 1 + 核心 50% + 影画1 20%（状态近似常驻）。
 * 锐能：进场 +60（勘域 180s 一次 → 每局一次）；秘血铸锋（EX）消耗 60 → 每局 1 发。
 *   —— 旧「2 毁伤/局 → 2.5 锐能放不出 EX」问题由 v12 文本解决（用户 2026-09 口径确认）。
 * 核心被动（猩红铭刻/连携/终结/无垢熔锋期间）：暴击率 +30%、残痕积蓄效率 +50%（满覆盖近似）。
 * 核心被动·初始转化：每 1% 初始暴击伤害 → 初始暴击率 +0.35%（读 outOfCombatPanel，
 *   局内暴伤拐不转化；旧「未建模，初始暴伤≈0」判断已修正——锋御词条第三优先就是暴伤）。
 * 额外能力·血裔传承：全队触发[浸染]时克拉蕾回 300 喧响（20s CD）；队友/自身触发[毁伤]时
 *   全队[锋御]进入[残锋]（锐暴伤害 +25%，40s 刷新）——残锋写自身面板。当前数据面锋御（specialty=sharpen）只有克拉蕾
 *   一人 ⇒ 与原文「全队锋御」等价（CC-122 核对）；新增锋御角色时 `claretSmoke.test.ts` 绊线会红，届时改为 spec teamBuff
 *   + 条件 `{ type: 'specialty', values: ['sharpen'] }`（`src/specs/types.ts` 已有该条件类型）。
 * 影画1（淋漓古志）：锐暴命中时残痕积蓄效率 +20%（并入积蓄效率倍率）；毁伤伤害倍率 ×130%（执行行 override）。
 * 影画2（薪火荣冠）：猩红铭刻最大持续 +2s；铭刻/连携/终结/反制支援/支援突击期间无视 18% 电抗（满覆盖近似）。
 * 影画4：锻星第三段（1611007 连续斩击 + 1611029 下砸）/血契共鸣(1611020)/千锤百炼(1611021)
 *   伤害 +20%（patchExecutions dmgBonus）。
 * 影画6：血契共鸣/千锤百炼重击命中不消耗残痕直接触发 1 次单体毁伤（连携+终结次数）。
 */
const CLARET_AGENT_ID = '1611'
/** 毁伤（斩金断铁/葬血强袭/影画6 共用载体的表 id，v12 = 1625.6%） */
export const MAIM_MOVE_ID = '1611013'
/** 葬血强袭表 id（v12 = 626.3%，3 段横斩合计） */
export const BLOOD_BURIAL_MOVE_ID = '1611014'
/** 秘血铸锋（锐能强特）表 id（v12 = 1249.6%） */
export const EX_MOVE_ID = '1611010'
/** 锐能：进场 60（勘域 180s 一次）；秘血铸锋 60/发 */
export const SHARPNESS_INITIAL = 60
export const SHARPNESS_COST_PER_EX = 60
/**
 * 终结技：千锤百炼 发动时回复 10 点锐能。
 *
 * @fact agent:1611/锐能·终结技回复 口径: 终结技「血华誓·千锤百炼」发动时 +10 锐能（与进场 60 同为锐能来源；单次上限不参与总量口径，用户 2026-09 裁决） | 据 用户@2026-09-11·复核@2026-09-25·复核@2026-09-30·复核@2026-10-07 | 验 src/mechanics/__tests__/claretSmoke.test.ts | 锚 src/mechanics/agents/claret.ts#SHARPNESS_ULTIMATE_GAIN + src/mechanics/agents/claret.ts#computeClaretSharpResource | 信 确认
 *
 * 数据侧核实（2026-09-11）：nanoka 全表 `sp_recovery` / `sp_recovery_growth` 恒 0（含终结技 1611021），
 * 锐能回复只存在于原文描述文本 → 口径锚 = `data/raw/nanoka_missing/full/1611.json`
 * `skill.chain.description[1]`（终结技条目「招式发动时，回复10点锐能」）+ `scripts/audit-nanoka-missing.mjs`。
 * ⚠️ 该条此前**零引用**（只写在文档/注释里），本次接入 `computeClaretSharpResource`。
 */
export const SHARPNESS_ULTIMATE_GAIN = 10
/** 残痕值：每 600 点 = [残痕] 1 层（1 次毁伤）（用户口径 2026-09-03：残痕600点可以造成一次毁伤） */
export const GASH_PER_LAYER = 600
/**
 * **同时存量**上限 3 层（敌人身上最多挂 3 层，超出部分溢出浪费）。
 * ⚠️ 这**不是整局毁伤次数上限**（用户口径 2026-09-12：「3层限制这个是单次，我们全局计算器怎么可能一局只有3次毁伤呢」）——
 * 本计算器走整局总量口径：攒够就消耗、消耗完继续攒，故整局可用层数 = floor(总残痕值/600) 不设 3 的钳制，
 * 真正的上限是**消耗需求**（斩金断铁/葬血强袭能打几次）。此常量只用于展示与「单次存量」文案。
 *
 * ## ★★ 残痕时序分诊（R54 结清 §R52-J2；**与风眼/余响都不同族，别互相照抄**）
 *
 * 原文（`data/raw/nanoka_missing/full/1611.json` `passive.level.1611501.desc[0]`）：
 * 「部分锐化伤害会积累残痕值，残痕值满时，敌人会进入[残痕]，**[残痕]最多叠加3层**，
 *   发动[斩金断铁]、[葬血强袭]命中处于[残痕]状态下的敌人时，**会消耗一层[残痕]**」
 * ⚠ **原文没有任何时长/衰减/自然消失子句**（外部 6 语言 × 4 版本独立复核：nanoka zh/en/ja/ko
 * 3.2 与 3.3.3 逐字符串零差异，官方名词表 `3000038` 亦只写「最多叠加3层」；同段落对猩红铭刻
 * 16s / 残锋 40s / 进场锐能 180s / 喧响 18s **都明写秒数** ⇒ 残痕的省略是刻意的）。
 *   ⇒ 层**只会被毁伤消耗**，上限是**纯计数**约束 ⇒ **只需事件顺序，不需绝对时刻**。
 *   ⇒ R52 对风眼成立的那条否决理由（「引擎无逐发绝对时刻 ⇒ 必须编造发次间隔」）**对本条不成立**：
 *     本条不需要时刻，只需要顺序，而顺序可以由「积累是速率×时间（连续）」这一事实定性。
 *
 * 记号：`L` = 整局可造层数 = `floor(P/600)`；`Ds` = **可消耗**层预算 = `cleave + 3·burial`
 *      （★ 不含影画6 —— C6 原文「**不消耗[残痕]**直接触发1次单体[毁伤]」）；`cap` = 3。
 *
 * ★【定理】现行式 `consumed = min(L, Ds)` 是**所有自洽读法的共同上界**，且**是紧的**：
 *   · 上界（穷举证明）：`L ∈ 0..12 × Ds ∈ 0..12 × 全部交错` = **10 400 599 个交错零越界**
 *     ⇒ **单向高估、不可能低估**。
 *   · 紧性（可达）：细粒度交错（积累与消耗交替）取到 `min(L, Ds)` —— 而 `平A` 项**按定义**
 *     就是 `秒均 × 时间`（连续），故细粒度交错正是本式自身隐含的读法。
 * ⚠【天花板】病态读法（先攒满再消耗）取到 `min(L, Ds, cap)` ⇒ 高估幅度 = `max(0, min(L,Ds) − cap)`，
 *   且 **cap 咬合的充要条件是 `L > cap 且 Ds > cap`**（二者任一 ≤ 3 则本式精确）。
 *   实测默认夹具：`L`=24~26 / `Ds`=4 ⇒ 幅度 **≤ 1 层**；滑块推满（`Ds`=80）⇒ 幅度可达 53 层。
 *   ⚠ 本条**纠正**原债务记的「极端配装（积累远快于消耗节奏）下偏乐观」：误差**不随积累速率 `L` 单调放大**，
 *     而是被 `Ds` 与 `cap` 夹住（`L` 再大，幅度也 ≤ `Ds − cap`）——原表述把两个因子说成了一个。
 *
 * @fact agent:1611/残痕时序 近似: 「同时存量≤3层」是时序约束，总量口径下 `consumed = min(L, Ds)` 是**所有自洽读法的共同上界且紧**（10 400 599 个交错穷举零越界；细粒度交错可达该界，而平A项按定义即「秒均×时间」= 连续）；天花板 = 病态「先攒满再消耗」读法取 `min(L,Ds,cap)`，幅度 `max(0, min(L,Ds)−cap)`，cap 咬合充要条件 `L>3 且 Ds>3`（实测默认夹具 ≤1 层、滑块推满 ≤53 层） | 据 nanoka 3.2 raw passive.level.1611501.desc[0]@2026-09-20·外部 6 语言×4 版本复核零差异@2026-09-20·R54 穷举 10400599 交错@2026-09-20·复核@2026-09-25·复核@2026-09-30·复核@2026-10-07 | 验 src/mechanics/__tests__/claretGashTiming.test.ts | 锚 src/mechanics/agents/claret.ts#computeClaretSharpResource | 信 高
 * ⟳复核: 官方若给出 [残痕] 的时长/衰减子句，或引擎获得逐事件顺序通道（可落真队列）时，替换本上界并复核 cap 咬合域 | 到期 2027-03-31
 */
export const GASH_MAX_STACKS = 3
/** 残余积蓄效率：核心被动 +50%（Lv.7）/ 影画1 锐暴 +20% */
export const GASH_EFF_CORE = 50
export const GASH_EFF_C1 = 20
/** 核心被动（Lv.7）：猩红铭刻/连携/终结/无垢熔锋期间暴击率 +30% */
export const CORE_CRIT_RATE = 30
/**
 * 影画1/影画2 效果分档（★ R55 订正 —— 旧实现把两档**互换**了）。
 *
 * 原文（`data/raw/nanoka_missing/full/1611.json`，本仓 raw 即可自验）：
 *   · `talent.1.desc`（淋漓古志 / C1）=「克拉蕾攻击命中敌人并造成锐暴时，**残痕积蓄效率提升20%**；
 *     克拉蕾触发[毁伤]造成的**伤害倍率提升至原本的130%**。」
 *   · `talent.2.desc`（薪火荣冠 / C2）=「[猩红铭刻]**最大持续时间延长2秒**；克拉蕾处于[猩红铭刻]，
 *     或是在发动[连携技]、[终结技]、[反制支援]、[支援突击]期间，攻击命中时**无视目标18%电属性伤害抗性**。」
 * ⚠ 旧实现是 `>=1` 给「电抗 16%」、`>=2` 给「积蓄 +20% / 毁伤 ×1.3」⇒ **两档完全互换**，
 *   且电抗数值 16 是过期值 ⇒ 后果 = **C1 玩家少拿、C2 玩家多拿**（R54 外部复核发现，刻意未修；
 *   R55 单独立项修复，避免与 R54 的「时序口径」混批致 delta 无法归因 —— 规则 17②）。
 *
 * @fact agent:1611/影画分档 口径: 影画1（淋漓古志）= 锐暴命中残痕积蓄效率 +20% 且 [毁伤] 伤害倍率 → 130%；影画2（薪火荣冠）= 猩红铭刻最大持续 +2s 且 [猩红铭刻]/[连携技]/[终结技]/[反制支援]/[支援突击] 期间攻击命中无视 **18%** 电属性伤害抗性 | 据 nanoka raw talent.1.desc + talent.2.desc@2026-09-20（外部 6 语言 × 4 版本 + gachabase 四方一致复核）·复核@2026-09-25·复核@2026-09-30·复核@2026-10-07 | 验 src/mechanics/__tests__/claretSmoke.test.ts | 锚 src/mechanics/agents/claret.ts#C2_RES_IGNORE + src/mechanics/agents/claret.ts#GASH_EFF_C1 + src/mechanics/agents/claret.ts#C1_MAIM_MULT + src/mechanics/agents/claret.ts#C2_INSCRIPTION_WINDOW_BONUS_SECONDS + src/mechanics/agents/claret.ts#applyClaretPanel | 信 确认
 * ⟳复核: 若官方改版重排影画顺序或改电抗数值（现 18%），改本组常量并同步 character-constellations.json | 到期 2027-03-31
 */
export const C1_MAIM_MULT = 1.3
/** 影画2：猩红铭刻/连携/终结/反制支援/支援突击期间攻击命中无视 18% 电抗（raw `talent.2.desc`） */
export const C2_RES_IGNORE = 18
/** 影画4：锻星第三段/血契共鸣/千锤百炼 伤害 +20% */
export const M4_DMG_BONUS = 20
export const M4_MOVE_IDS = new Set(['1611007', '1611029', '1611020', '1611021'])
/** 残锋：全队锋御 锐暴伤害 +25%（40s 刷新，满覆盖近似） */
export const RESIDUAL_EDGE_SHARP_CRIT_DMG = 25
/**
 * 核心被动·初始转化：每 1% **初始**暴击伤害 → 初始暴击率 +0.35%。
 *
 * @fact agent:1611/初始暴伤转暴击 口径: 每1%初始暴击伤害→初始暴击率+0.35%（读局外面板 critDmg，局内暴伤拐如珂蕾妲潜能不参与转化；初始暴伤按整 1% 计，`floor(源值+1e-9)`，CC-135 §2.18）；锋御模板基础暴伤=50（与其他 61 名角色同模板），初始暴伤 = 基础 50 + 副词条/主词条/驱动盘 | 据 nanoka live3.2原文@2026-09-12（stats.crit_damage=5000→50%；**旧写「锋御模板基础暴伤=0」是错的**——它把 8 月过期快照的 critDmg=0 当成模板口径，已订正 catalog 1611 critDmg 0→50、critRate 19.4→33.8）·复核@2026-09-25·复核@2026-09-30·复核@2026-10-07 | 验 src/mechanics/__tests__/claretSmoke.test.ts | 锚 src/mechanics/agents/claret.ts#INITIAL_CRIT_DMG_TO_CRIT_RATE + src/mechanics/agents/claret.ts#applyClaretPanel | 信 确认
 */
export const INITIAL_CRIT_DMG_TO_CRIT_RATE = 0.35
/** 葬血强袭每施放至多 3 次毁伤（连续 3 段横斩，各命中触发） */
export const BURIAL_MAIM_PER_CAST = 3
/**
 * 葬血强袭·**打断**（用户技巧，2026-10-09）：在 2.317s 的三连横斩打到一半时打断，
 * 只结算**前半段**——秒数与各项数值都减半，但 **3 次毁伤照常全部触发**（毁伤挂在命中判定上，
 * 不随前半/后半走）。
 *
 * 为什么这招是**正收益**（用户口径：「预计提升伤害」）：葬血强袭的 DPS 明显低于[锻星]平A
 * （(153.6+626.3)/2.884 ≈ 270.4%/s vs 锻星 531.88%/s），所以把它的后半段省下来的时间还给平A
 * 是净赚；且平A时间变多 ⇒ 残痕积累变多（锻星 120%/s > 血锻 100%/s）⇒ 毁伤次数也更多。
 *
 * 省下的时间 = 每次 `BURIAL_SECONDS × (1 − BURIAL_INTERRUPT_RATIO)` = 1.1585s。
 * ⚠ 秽盾（`ether_purify`）不是执行行通道（只在标准式演算里），故「各项数值减半」落在
 * 伤害/失衡/喧响三列 + 时间；积蓄列本是空（`anomaly_buildup` 表内无该行）。
 *
 * @fact agent:1611/葬血强袭打断 口径: 打断葬血强袭 = 只打前半段：时间与伤害/失衡/喧响各项数值均减半（2.317s→1.1585s、626.3%→313.15%、失衡 382.5→191.25、喧响 70.098→35.049），但 **3 次毁伤照常全部触发**（不随打断减少）；入场「斩金断铁·上挑」那一下仍完整打（153.6%/0.567s） | 据 用户@2026-10-09（「打断葬血强袭，使其2.317s的招式只需打一半，伤害失衡等各项数值都丢失一半，时间也短了一半，变成1.1585s」「这个技巧之所以预计上升强度，是因为他把3次毁伤全都触发了，只是把后半部分的普通伤害去掉，节约时间」）·复核@2026-10-09 | 验 src/mechanics/__tests__/claretInterrupt.test.ts | 锚 src/mechanics/agents/claret.ts#BURIAL_INTERRUPT_RATIO + src/mechanics/agents/claret.ts#buildClaretExecutions | 信 确认
 * ⟳复核: 若官方改葬血强袭时长/段数（现 2.317s 三段），或实战实测打断点不在正中（现按 50% 结算），改 BURIAL_INTERRUPT_RATIO 与 BURIAL_SECONDS 并重跑 claretInterrupt | 到期 2027-03-31
 */
export const BURIAL_INTERRUPT_RATIO = 0.5
/** 葬血强袭单次动作时长（秒，catalog 1611014 actionTime）——打断时 × `BURIAL_INTERRUPT_RATIO` */
export const BURIAL_SECONDS = 2.317
/** 斩金断铁·上挑段时长（秒）——葬血强袭的入场段，两种结算都完整打 */
export const CLEAVE_ENTRY_SECONDS = 0.567
/**
 * 斩金断铁·横斩段（1611012）时长 0.649s —— **只在 spec 事件里声明**（`1611.json` 的
 * `claret_cleave_b.actionTime`，值来自 catalog actionTime），模块不重复持有该常量：
 * 融合口径只需要「入场上挑 + 三连横斩」两项（见 `CLEAVE_ENTRY_SECONDS` / `BURIAL_SECONDS`）。
 */
/** 斩金断铁·上挑段表 id（1611011，v12 = 153.6%）——葬血强袭的入场段 */
export const CLEAVE_ENTRY_MOVE_ID = '1611011'
/** 斩金断铁·横斩段表 id（1611012，v12 = 175.7%） */
export const CLEAVE_SLASH_MOVE_ID = '1611012'
/**
 * 猩红铭刻平A基准段：锻星#3（表 id 1611007，531.88%/s、gash 120/s）。
 *
 * @fact agent:1611/平A双基准 口径: 常态平A只能用[血锻四式]（基准=血锻#3 345.21%/s·gash 100/s），[猩红铭刻]下用[锻星]/[伏钺]（基准=锻星#3 531.88%/s·gash 120/s）；两态秒均倍率与残痕积累都不同，引擎单基准段必须按 `claret.inscriptionBasicTimeShare` 加权 | 据 用户@2026-09-11（gachabase 列 gash_buildup 佐证：锻星 120% vs 血锻 100%）·复核@2026-09-25·复核@2026-09-30 | 验 src/mechanics/__tests__/claretSmoke.test.ts | 锚 src/mechanics/agents/claret.ts#INSCRIPTION_BENCHMARK_MOVE_ID + src/mechanics/agents/claret.ts#resolveNormalBenchmark + src/mechanics/agents/claret.ts#computeClaretBasicPerSec | 信 确认
 */
export const INSCRIPTION_BENCHMARK_MOVE_ID = '1611007'
/** 默认铭刻平A时间占比（%）：**0 = 由锐能账本推导**（默认口径，用户 2026-09-11：时间由进次数与锐能账本反推）；1–100 = 手动覆盖。 */
export const DEFAULT_INSCRIPTION_BASIC_TIME_SHARE = 0
/** 猩红铭刻窗口基础时长（秒）——raw `skill.special.description[1]`「进入[猩红铭刻]，持续16秒」 */
export const DEFAULT_INSCRIPTION_WINDOW_SECONDS = 16
/**
 * 影画2：猩红铭刻**最大持续时间延长 2 秒**（每轮窗口 16s → 18s）。
 *
 * 原文 raw `talent.2.desc`：「[猩红铭刻]**最大持续时间延长2秒**」。
 * ⚠ 旧实现**完全没建模**它，且 `claret.ts` 头注释错写成「影画1 猩红铭刻最大持续 **+3s**（时长无数值影响）」
 *   —— 两处都错：① 档位是影画2 不是影画1；② **+2 秒不是 +3 秒**；③ 它**有数值影响**
 *   （`DEFAULT_INSCRIPTION_WINDOW_SECONDS` 直接进两态时间解，见 `deriveClaretTwoStateTime`）。
 *   R55 实测 delta：建模后 1611 c3~c6 伤害 1.724% → 3.269~3.514%（窗口变长 ⇒ 铭刻态时间份额上升）。
 *
 * @fact agent:1611/铭刻窗口·影画2 口径: 影画2 使猩红铭刻单窗基础时长 16s → 18s（+2秒）；该窗口直接进两态时间解（铭刻总时间 = 轮数×窗口 + 连携/停表延长秒） | 据 nanoka raw talent.2.desc@2026-09-20（外部 6 语言 × 4 版本复核一致）·复核@2026-09-25·复核@2026-09-30·复核@2026-10-07 | 验 src/mechanics/__tests__/claretSmoke.test.ts | 锚 src/mechanics/agents/claret.ts#C2_INSCRIPTION_WINDOW_BONUS_SECONDS + src/mechanics/agents/claret.ts#deriveClaretTwoStateTime | 信 确认
 * ⟳复核: 官方若调整影画2 的窗口延长量（现 +2s），改本常量并重跑 timeGolden | 到期 2027-03-31
 */
export const C2_INSCRIPTION_WINDOW_BONUS_SECONDS = 2
/** 连携技延长铭刻窗口（秒/次）——raw 核心被动「发动[连携技]时延长[猩红铭刻]2秒持续时间」 */
export const INSCRIPTION_CHAIN_EXTENSION_SECONDS = 2
/** 连携/终结技表 id（窗口停表口径要它们的动作时长） */
export const CHAIN_MOVE_ID = '1611020'
export const ULTIMATE_MOVE_ID = '1611021'
/** 击杀延长（3s/ICD）**不建模**：计算器算单挑 Boss、不算小怪（用户口径 2026-09-11） */
/** 常态打满一发秘血铸锋所需锐能 */
const SHARPNESS_PER_ENTRY = SHARPNESS_COST_PER_EX
/** 循环轮数上限（防病态输入下 while 不收敛；180s/16s 窗口 实测只需 ~8） */
const MAX_INSCRIPTION_ENTRIES = 60

/** 招式某行的秒均（行值 / actionTime；无动作时间 → 0）。 */
function perSeconds(move: SkillMove | null | undefined, rowId: string): number {
  const at = move?.actionTime ?? 0
  return at > 0 ? getRowValue(move, rowId) / at : 0
}

function applyClaretPanel({ panel, cinemaLevel, outOfCombatPanel }: AgentPanelInput): void {
  // 核心被动·初始转化：每 1% 初始暴击伤害 → 初始暴击率 +0.35%。
  // 初始口径 → 只读局外面板（珂蕾妲潜能等局内暴伤拐不参与转化）；基础暴伤 50（锋御同模板，见 `@fact agent:1611/初始暴伤转暴击`），其余来自副/主词条与驱动盘。
  const initialCritDmg = outOfCombatPanel.critDmg
  if (initialCritDmg > 0) {
    // CC-135 第 159 轮：「每超过 N」统一 floor 整步，docs/mcp-r6-refactor-list.md §2.18：「每拥有 1% 初始暴伤」按整 1% 计（原连续）
    panel.critRate = panel.critRate + Math.floor(initialCritDmg + 1e-9) * INITIAL_CRIT_DMG_TO_CRIT_RATE
  }
  // 核心被动 Lv.7：猩红铭刻/连携/终结/无垢熔锋期间 暴击率 +30%（状态高频维持，满覆盖近似）
  panel.critRate = panel.critRate + CORE_CRIT_RATE
  // 残锋：队友/自身触发[毁伤]后全队锋御 锐暴伤害 +25%（40s 刷新；按自身面板近似）
  panel.sharpCritDmg = panel.sharpCritDmg + RESIDUAL_EDGE_SHARP_CRIT_DMG
  // 影画2（薪火荣冠）：猩红铭刻/连携/终结/反制支援/支援突击期间攻击命中无视 18% 电抗
  //   （状态高频维持，满覆盖近似）——★ R55 订正：旧实现是 `>=1` + 16%，门控与数值双错
  if (cinemaLevelOf(cinemaLevel) >= 2) {
    panel.enemyElectricResReduction = panel.enemyElectricResReduction + C2_RES_IGNORE
  }
}

/**
 * 打断版葬血强袭的**轴内伪块 key**（用户口径 2026-10-12：「你可以把它作为一个单独的招式」）。
 *
 * 它在 catalog 里没有对应行（`1611014` 是完整版），故走 `expandAxisAction` 展开成真实招式：
 * 上挑（1611011）+ 完整版葬血强袭行（1611014，时间由模块按 `BURIAL_INTERRUPT_RATIO` 折算——
 * 但轴内时间门控用的是 `StackActionCost.actionTime`，所以这里**直接给折算后的时长**）。
 */
export const CLARET_INTERRUPT_BURIAL_BLOCK_ID = 'claret-burial-interrupted'

/**
 * 轴内伪块展开（CC-43f 协议，先例 = 希格莉德破阵连段）：把「葬血强袭·打断」展开成真实招式。
 *
 * 时间口径：打断版 = 入场上挑 0.567s + 三连横斩 2.317s × 50% = **1.7255s**；
 * 完整版 = 2.884s（既有 `combos['claret-burial']` 走 moves 求和，无需展开）。
 * 数值口径由 `buildClaretExecutions` 的打断行负责（伤害/失衡/喧响减半）——本函数只管**时间门控**。
 */
export function expandClaretAxisAction(input: AgentAxisActionExpandInput): StackActionCost[] | undefined {
  if (input.moveId !== CLARET_INTERRUPT_BURIAL_BLOCK_ID) return undefined
  const entryTime = input.actionTimeOf(CLEAVE_ENTRY_MOVE_ID) || CLEAVE_ENTRY_SECONDS
  const bodyTime = input.actionTimeOf(BLOOD_BURIAL_MOVE_ID) || BURIAL_SECONDS
  return [{
    slot: input.slot,
    // 用真实 moveId 进栈 ⇒ 它的轴内次数会被 `axisActionCounts`/`axisSequence` 记到 1611014 上，
    // 与「完整版」同键累加——两者对残痕的消耗/毁伤完全一致（用户口径），故同键是**正确**的。
    moveId: BLOOD_BURIAL_MOVE_ID,
    count: input.count,
    actionTime: entryTime + bodyTime * BURIAL_INTERRUPT_RATIO,
    energyCost: 0,
    decibelCost: 0,
    startTime: input.startTime,
  }]
}

/**
 * **轴内残痕时序推演**（用户口径 2026-10-12）——回答「这一轮失衡轴内打了 6 次还是 7 次毁伤」。
 *
 * 用户原话（本函数全部判据的出处）：
 *   「主要为了计算失衡轴内打了6次毁伤还是7次，是轴内专门计算的一个量，用于计算失衡内毁伤计数」
 *   「你知道招式可以积累残痕值。假设一开始1800残痕值进去，打3层毁伤，残痕值归零，
 *     然后又积累1800，又打毁伤3层。再积累600点，再打一次，如果时间足够，就可以在轴内打出7次」
 *   「轴模式下，失衡轴内是选取了部分内容拿来吃易伤。自动补足的内容全在非失衡去了，也就是说
 *     捏了多少消耗多少后，剩下的自动计算然后放在失衡轴外，吃不到易伤」
 *   「要吃，这就是为什么我要你建模轴内的残痕数值，需要判断这次残痕是否达标，能否消耗残痕造成毁伤」
 *
 * ## 语义（与全局总量口径的关系）
 * 全局侧不变：**失衡轴从总量里选取一部分来做计数判定**（用户 2026-10-12 纠正），
 * 本函数只负责**轴内本地**的推演——按轴自身的**执行先后**逐条走：
 *   · 遇到**积累**类块（平A/EX/连携/终结… 即 `gash_buildup > 0` 的招式）→ 累加残痕值；
 *   · 遇到**消耗**类块（斩金断铁 1 层 / 葬血强袭 3 层）→ **先判够不够**：
 *     够 ⇒ 扣层、该次毁伤**触发**；不够 ⇒ 招式本体照打（伤害/失衡/时间不减免），**但毁伤不触发**
 *     （用户口径「不是说你这个招式就一定能消耗残痕打出毁伤的」）。
 *
 * ⚠ 与「自动补足」的分工（用户口径）：轴内捏了多少就消耗多少；**剩下的层数在轴外**按
 *   `computeClaretSharpResource` 的既有口径自动补足（那部分吃不到失衡易伤）。
 *   ⇒ 本函数产出的 `consumed` 要从轴外可消耗层数里**扣掉**（同一池、总量守恒）。
 *
 * @fact agent:1611/轴内残痕时序 口径: 轴内残痕按**执行先后**逐条推演（积累块加分、消耗块先判够不够再扣），够才触发毁伤、不够则招式本体照打但不触发毁伤；轴内消耗的层数从轴外「自动补足」的可消耗层数里扣除（同一池、总量守恒——用户「捏了多少消耗多少后，剩下的自动计算然后放在失衡轴外」） | 据 用户@2026-10-12（「假设一开始1800残痕值进去，打3层毁伤，残痕值归零，然后又积累1800，又打毁伤3层。再积累600点，再打一次…就可以在轴内打出7次」+「需要判断这次残痕是否达标，能否消耗残痕造成毁伤」）·复核@2026-10-12 | 验 src/mechanics/__tests__/claretAxisGash.test.ts | 锚 src/mechanics/agents/claret.ts#simulateAxisGashTimeline + src/mechanics/agents/claret.ts#buildClaretResourceSource | 信 确认
 * ⟳复核: 若官方给出残痕的时长/衰减子句（当前无），或轴编辑器改为支持「同一块跨窗携带残痕状态」，重核本推演 | 到期 2027-03-31
 */
/** 轴内残痕推演的**一步**（`simulateAxisGashTimeline` 的轨迹元素；判据 29：同形状只写一次） */
export interface AxisGashStep {
  moveId: string
  /** 该步是积累还是消耗 */
  kind: 'gain' | 'consume'
  /** 积累步骤 = 增加的点数/600（层）；消耗步骤 = 该次要消耗的层数 */
  layers: number
  /** 消耗步骤：是否真的够层并触发了毁伤（积累步骤恒 true） */
  fired: boolean
}

export function simulateAxisGashTimeline(input: {
  /**
   * 该槽位轴内**逐次执行序列**（`cfg.axisSequence`，已按槽切分）。
   * ⚠ 跨槽位并行 ⇒ 只看本槽的相对先后（调用方保证已切分）。
   */
  sequence: ReadonlyArray<{ moveId: string; count: number }>
  /** moveId → 该招一发的残痕积累表值（%）；不在表里 = 0（不积累） */
  gashByMoveId: Readonly<Record<string, number>>
  /**
   * 进轴时敌人身上已有的残痕值（%，已 × 积蓄效率）。
   * 口径 = 轴外阶段攒下的值；由调用方给出（见 `buildClaretResourceSource`）。
   */
  entryGashValue: number
  /** 各消耗类 moveId → 该招一次消耗的层数（斩金断铁 1 / 葬血强袭 3） */
  consumePerCastByMoveId: Readonly<Record<string, number>>
  /** 残痕值 → 层（每层 600 点） */
  perLayer?: number
  /** 覆盖该序列各 moveId 的**实打次数**（缺省 = `count`）；用于「一次块含多段」的折算 */
  castsByMoveId?: Readonly<Record<string, number>>
}): {
  /** 轴内触发的毁伤次数（= 真正扣掉层数的那几次） */
  maimCount: number
  /** 轴内实际消耗的层数 */
  consumedLayers: number
  /** 走完整条序列后剩余的残痕值（%）——归还给轴外继续结算 */
  gashValueAfter: number
  /** 消耗块里因层数不足而**没触发**毁伤的次数（用户要看的「差几次」） */
  unfiredMaim: number
  /** 逐条推演轨迹（展示 / 判据用） */
  steps: AxisGashStep[]
} {
  const perLayer = Math.max(1, Number(input.perLayer ?? GASH_PER_LAYER))
  let gash = Math.max(0, Number(input.entryGashValue))
  let maimCount = 0
  let consumedLayers = 0
  let unfiredMaim = 0
  const steps: AxisGashStep[] = []
  for (const entry of input.sequence) {
    const count = Math.max(0, Math.floor(Number(input.castsByMoveId?.[entry.moveId] ?? entry.count)))
    if (count <= 0) continue
    const consumePerCast = Number(input.consumePerCastByMoveId[entry.moveId] ?? 0)
    if (consumePerCast > 0) {
      // 消耗块：逐次判「够不够」——够才扣层并触发毁伤
      for (let i = 0; i < count; i++) {
        const pool = Math.floor(gash / perLayer)
        const fired = pool >= consumePerCast
        if (fired) {
          // ⚠ 扣的是**层**（整数），不是「按比例扣点数」：残痕以层为原子消耗
          gash = Math.max(0, gash - consumePerCast * perLayer)
          consumedLayers += consumePerCast
          maimCount += consumePerCast
        } else {
          // 不够：招式本体照打（调用方另行结算），但**不触发毁伤**、不扣层
          unfiredMaim += consumePerCast
        }
        steps.push({ moveId: entry.moveId, kind: 'consume', layers: consumePerCast, fired })
      }
      continue
    }
    // 积累块：按表值 × 次数累加
    const gain = Number(input.gashByMoveId[entry.moveId] ?? 0)
    if (gain <= 0) continue
    const total = gain * count
    gash += total
    steps.push({ moveId: entry.moveId, kind: 'gain', layers: total / perLayer, fired: true })
  }
  return { maimCount, consumedLayers, gashValueAfter: gash, unfiredMaim, steps }
}

/**
 * 克拉蕾残痕/锐能资源（v12）：
 * **残痕值 = 平A聚合（两态秒均 × 平A时间）+ Σ 其余招式实打次数 × 该招 `gash_buildup` 表值**
 *   （2026-09-12 用户更正的口径：闪反/连携/终结/支援突击/反制支援… 每招都在实打实积累，
 *    旧实现只算平A+EX 且 EX 错读 `anomaly_buildup` 列，低估一大截）→ × 积蓄效率；
 * 每 600 点 = 1 层；**`GASH_MAX_STACKS=3` 是敌人身上同时存量的上限，不是整局次数上限**
 *   （全局计算器按总量走：攒够就消耗，一局毁伤次数 = min(总层数, 消耗需求)，不被 3 钳死）；
 * 反制支援整组化解控制技时，琢形「直接添加1层」= 每组 +600 点、**不吃积蓄效率倍率**（送层不是积累）；
 * 毁伤需求 = 斩金断铁×1 + 葬血强袭×3 + 影画6(连携+终结)；**层预算**只含真正消耗层的斩金断铁/葬血强袭
 *   （影画6 原文「不消耗[残痕]」⇒ 不进层预算，R54 修正），毁伤 = min(层数, 层预算) × 覆盖率 + 影画6 直接毁伤；
 * 锐能 = 进场 60 + 终结技 10/次（raw chain.description[1]），秘血铸锋 60/发。
 */
export function computeClaretSharpResource(input: {
  /** 平A 残痕秒均（两态基准加权，% / s）——平A 是唯一按「秒均×时间」计的招式 */
  basicGashPerSec: number
  basicAttackTime: number
  /**
   * 平A 之外**全部招式**的残痕积累合计（%）= Σ 该招实打次数 × `gash_buildup` 表值
   * （强特/闪反/连携/终结/快支/支援突击/反制支援…，2026-09-12 用户更正：每招都在实打实积累，
   *  旧实现只算平A+EX 且 EX 错读 `anomaly_buildup` 列）。取代旧的 `exGashValue`/`exCount` 两参。
   */
  moveGashTotal?: number
  cleaveSpecialCount: number
  bloodBurialCount: number
  gashCoverage: number
  cinemaLevel: number
  chainCountTotal?: number
  ultimateCount?: number
  /** 平A伤害秒均（%）——两态基准加权结果，仅回传给展示层 */
  basicDamagePerSec?: number
  /** 平A失衡秒均（%）——同法加权 */
  basicDazePerSec?: number
  /** 铭刻平A时间占比 0–1（两态基准加权系数），仅回传给展示层 */
  inscriptionBasicTimeShare?: number
  /** 占比来源：ledger（账本推导）/ manual（面板滑块覆盖） */
  inscriptionBasicTimeShareSource?: 'ledger' | 'manual'
  /** 账本推导出的常态平A时间（秒）与推导占比（见 `deriveClaretTwoStateTime`） */
  normalBasicTimeNeeded?: number
  derivedInscriptionTimeShare?: number
  /** 常态血锻四式锐能产出（合自动累积，/s）——账本推导的分母，仅回传展示 */
  normalSharpnessPerSec?: number
  /** 自动累积的时长基准 = 接战时间（秒） */
  combatTime?: number
  /** 铭刻平A时间（秒）——与常态时间成对回传 */
  inscriptionBasicTime?: number
  /** 单窗基础时长（秒）——16s（raw）；影画2 起 18s（+2s） */
  inscriptionWindowSecondsPerEntry?: number
  /** 反制支援送的**直接残痕层数**（= 化解的控制技组数）：琢形原文「重击命中敌人时，
   *  **直接为目标添加1层[残痕]**」（用户口径 2026-09-12「他的确是送了」）。
   *  直接给层 → **不吃积蓄效率倍率**（不是"积累"，是"添加"），但仍受 3 层上限约束。 */
  counterAssistGashStacks?: number
  /** 锐能基础自动累积（/s，catalog level60.sharpnessRegen） */
  sharpnessAutoPerSec?: number
  /** 常态血锻四式的锐能招式增益（/s，catalog sharpness_gain 列） */
  normalAttackSharpnessPerSec?: number
  /** 平A时间能支撑的进场轮数（常态攒能 → EX 进场 → 铭刻窗口） */
  inscriptionEntries?: number
  /** 单轮铭刻窗口时长（秒） */
  inscriptionWindowSeconds?: number
  /** 单次进场锐能成本 */
  sharpnessPerEntry?: number
  /** EX 发数覆盖（由两态循环解给出；缺省回落「锐能总量 / 60」） */
  affordableExCountOverride?: number
  /** 反制支援（整组化解控制技）次数 → 琢形「重击命中**直接**为目标添加1层[残痕]」 */
  counterAssistCount?: number
  /**
   * **轴内残痕时序推演结果**（用户口径 2026-10-12；非轴 = undefined）。
   *
   * 语义：轴内按执行先后已经消耗掉的层数**从轴外可消耗层数里扣除**（同一池、总量守恒）——
   * 「捏了多少消耗多少后，剩下的自动计算然后放在失衡轴外，吃不到易伤」。
   * · `consumedLayers` 轴内已消耗的层 → 轴外可用层数先减掉它；
   * · `maimCount` 轴内已触发的毁伤数 → 直接加进总毁伤数（这部分吃失衡易伤）。
   */
  axisGash?: { consumedLayers: number; maimCount: number; unfiredMaim: number } | undefined
}): ClaretSharpResourceSource {
  const cinemaLevel = cinemaLevelOf(input.cinemaLevel)
  // 平A = 秒均×时间（两态加权）；**其余全部招式** = Σ 实打次数 × 表列 `gash_buildup`
  // （2026-09-12 用户更正：每招都在实打实积累，旧实现只算平A+EX 且 EX 那项错读了 `anomaly_buildup` 列）
  const moveGashTotal = Math.max(0, Number(input.moveGashTotal ?? 0))
  const baseGash = Math.max(0, input.basicGashPerSec * input.basicAttackTime) + moveGashTotal
  const buildupMultiplier = 1 + GASH_EFF_CORE / 100 + (cinemaLevel >= 1 ? GASH_EFF_C1 / 100 : 0)
  // 直接送的层**不进**积蓄效率倍率（原文是「添加1层」，不是「积累残痕值」；
  // 表列 gash_buildup（本体 446 + 琢形 134）按全角色同口径仍不计——只认这一条明写的赠送）。
  //
  // @fact agent:1611/琢形送残痕 口径: 反制支援整组化解一组控制技 = 琢形「重击命中直接为目标添加1层[残痕]」→ 每组 +600 点**且不吃积蓄效率倍率**（送层不是积累），仍受 3 层上限；表列 gash_buildup（1611028=446 / 1611030=134）按「非平A非E 不计」的全局同口径仍不计入 | 据 用户@2026-09-12（「残痕建模一下，他的确是送了」）+ nanoka full/1611.json 琢形条目·复核@2026-09-25·复核@2026-09-30·复核@2026-10-07 | 验 src/mechanics/__tests__/claretSmoke.test.ts::反制支援送残痕 | 锚 src/mechanics/agents/claret.ts#computeClaretSharpResource | 信 确认
  const counterAssistGashStacks = Math.max(0, Math.floor(input.counterAssistCount ?? 0))
  const gashValuePct = baseGash * buildupMultiplier + counterAssistGashStacks * GASH_PER_LAYER
  // 整局可用层数**不设 3 钳制**：3 层是敌人身上的同时存量上限（见 GASH_MAX_STACKS 注释），
  // 总量口径下攒够就消耗、消耗完继续攒，真正的上限是下面的消耗需求次数（斩金断铁/葬血强袭）。
  // debt: 残痕总量口径天花板 「同时存量≤3层」是时序约束，总量口径只能给出 `min(L, Ds)`（已证为**紧上界**：
  // 10400599 交错零越界且细粒度交错可达，见 GASH_MAX_STACKS 上方 @fact）。病态「先攒满再消耗」读法取
  // `min(L, Ds, cap)` ⇒ 高估幅度 `max(0, min(L,Ds) − cap)`，充要条件 `L>cap 且 Ds>cap`；实测默认夹具 ≤1 层、
  // 滑块推满（Ds=80）≤53 层。升级路径 = 引擎获得逐事件顺序通道后落真队列（**不需要绝对时刻**，只需顺序）。
  const gashStacks = Math.max(0, Math.floor(gashValuePct / GASH_PER_LAYER))
  const cleaveCount = Math.max(0, Math.floor(input.cleaveSpecialCount))
  const burialCount = Math.max(0, Math.floor(input.bloodBurialCount))
  const c6Extra = cinemaLevel >= 6
    ? Math.max(0, Math.floor(Number(input.chainCountTotal ?? 0))) + Math.max(0, Math.floor(Number(input.ultimateCount ?? 0)))
    : 0
  // ★ R54 修正：影画6 的毁伤**不进层预算**。原文 `talent.6.desc`：「发动[连携技：血华誓·血契共鸣]、
  // [终结技：血华誓·千锤百炼]重击命中敌人时，**不消耗[残痕]**直接触发1次单体[毁伤]」。
  // 旧实现把它并进 `maimDemand` 后**又拿 demand 当层预算**（`consumed = min(stacks, demand)`）
  // ⇒ 白白抬高钳位上限，让**本来无层可消耗**的连携/终结把 cleave/burial 的层"腾"出来
  // ⇒ `maimCount` 虚高（实测 62/253 夹具越界、最大 +8 次）。
  // 正解 = 两个量分开：`maimStackBudget`（**真正消耗层**的招式）管消耗，`maimDemand`（总需求）管展示。
  //
  // ★★ 毁伤**按层数结算**（用户裁决 2026-10-09，推翻旧的「滑块层预算钳制」）：
  //   原话「这个滑块限制就很背离计算逻辑了」「该结算就放」「不需要斩金断铁，只打葬血强袭。
  //   轴模式下有 斩金断铁和葬血强袭对总量的消耗，剩下的自动用葬血强袭打完」。
  //   ⇒ 层预算**不再由滑块封顶**，而是「滑块声明的那几次先扣，剩余层数一律由葬血强袭打完」。
  //   · 葬血强袭「这个招式没有成本，可以一直用，只是收益比平A低」（用户原话）⇒ **不设次数上限**，
  //     真正的约束是**时间**（每次 2.884s 必做前台，由折叠环挤平A，见 `buildClaretExecutions`）。
  //   · 旧口径把这里的上限记成「消耗需求次数（斩金断铁/葬血强袭能打几次）」，那是把**滑块**当成了
  //     真实上限 —— 实测默认夹具 48 层只结算 4 次毁伤（层预算 1+3），与用户预期严重不符。
  //
  // 结算顺序（与旧式 `maimFromCleave` 先扣的次序一致）：覆盖率折算 → 斩金断铁 → 声明的葬血强袭
  //   → **自动补足的葬血强袭**（剩余层数 ÷ 3 向上取整）。
  const coverage = Math.max(0, Math.min(1, input.gashCoverage))
  /** 覆盖率折算后可消耗的层数（层数本身不随覆盖率变化，见既有 `mechanicSettingsEffect` 口径） */
  const consumableStacks = Math.max(0, gashStacks * coverage)
  // ── 轴内先扣（用户口径 2026-10-12）──
  // 轴内那部分「捏了多少消耗多少」，其层数由 `simulateAxisGashTimeline` 按**执行先后**推演得出；
  // 这里把它从**轴外**可消耗层数里扣掉（同一池、总量守恒）。毁伤数则相加：
  //   轴内触发的那部分吃失衡易伤（走 `attachedEvents` 的轴内占比），轴外自动补足的吃不到。
  // 非轴（`axisGash` 缺省）⇒ 轴内消耗恒 0，逐位回到旧行为。
  const axisConsumed = Math.max(0, Math.min(consumableStacks, Number(input.axisGash?.consumedLayers ?? 0)))
  const axisMaim = Math.max(0, Number(input.axisGash?.maimCount ?? 0))
  /** 轴外还能消耗的层数（= 轴内吃完剩下的） */
  const outOfAxisStacks = Math.max(0, consumableStacks - axisConsumed)
  const maimFromCleave = Math.min(outOfAxisStacks, cleaveCount)
  const declaredBurialStacks = burialCount * BURIAL_MAIM_PER_CAST
  const declaredBurialConsumed = Math.min(Math.max(0, outOfAxisStacks - maimFromCleave), declaredBurialStacks)
  /** 声明部分吃完后还剩多少层 —— 这些**全部**由自动补足的葬血强袭打完（均在轴外） */
  const remainingStacks = Math.max(0, outOfAxisStacks - maimFromCleave - declaredBurialConsumed)
  // ⚠ 自动补足用 `ceil`（不是 floor）：层数不是 3 的整数倍时，最后一发**部分消耗**（1~2 层）
  //   也是实打的一次完整动作；floor 会让那几层白扔（且少算一次动作的时间/伤害）。
  const autoBurialCasts = Math.ceil(remainingStacks / BURIAL_MAIM_PER_CAST - 1e-9)
  const autoBurialConsumed = Math.min(remainingStacks, autoBurialCasts * BURIAL_MAIM_PER_CAST)
  const maimFromBurial = declaredBurialConsumed + autoBurialConsumed
  /** **轴外**实际消耗的层数 */
  const outOfAxisConsumed = maimFromCleave + maimFromBurial
  /** 实际消耗的总层数（轴内 + 轴外；影画6 不计入） */
  const gashStackConsumed = outOfAxisConsumed + axisConsumed
  /** 毁伤总数 = 轴内已触发 + 轴外结算 + 影画6 直接毁伤 */
  const maimCount = axisMaim + Math.floor(outOfAxisConsumed) + c6Extra
  /** 葬血强袭实际结算次数 = 滑块声明 + 自动补足（发行行与时间都按它） */
  const burialCastsSettled = burialCount + autoBurialCasts
  /**
   * 毁伤需求（展示用总量）= 实际结算的段数 + 影画6。
   * ⚠ 与 `gashStackConsumed` 的区别：这里按「**招式段数**」算（葬血强袭每次 3 段），
   *   后者按「**层数**」算——自动补足那发部分消耗时两者会差几层（层不够 3 的倍数）。
   */
  const maimDemand = (cleaveCount + burialCastsSettled * BURIAL_MAIM_PER_CAST) + c6Extra
  // 锐能总量 = 进场 60（开局赠送）+ 终结技 ×10 + 常态平A自动回复（锻星 0）
  const ultimateCount = Math.max(0, Math.floor(Number(input.ultimateCount ?? 0)))
  const sharpnessGain = SHARPNESS_INITIAL + ultimateCount * SHARPNESS_ULTIMATE_GAIN
  // EX 发数：优先用循环解（每轮 = 常态攒 60 锐能 + 一度进场），否则回落「总量 / 60」
  const cycleExCount = Number(input.affordableExCountOverride)
  const affordableExCount = Number.isFinite(cycleExCount)
    ? Math.max(0, Math.floor(cycleExCount))
    : Math.floor(sharpnessGain / SHARPNESS_COST_PER_EX)
  const sharpnessSpend = affordableExCount * SHARPNESS_COST_PER_EX
  // ── 两态时间：由账本推导（用户口径 2026-09-11）──
  // 锐能只用于进[猩红铭刻]、每一发 EX 就是一次进场；总量口径不设单次上限。
  // 锐能产出只长在常态血锻四式上（锻星/伏钺/E/连携全 0），所以：
  //   下一次进场的锐能缺口 / 常态产出速率 = 常态需要打的平A秒数
  const normalSharpnessPerSec = Math.max(0, Number(input.normalSharpnessPerSec ?? 0))
  const normalBasicTimeNeeded = Math.max(0, Number(input.normalBasicTimeNeeded ?? 0))
  const derivedInscriptionTimeShare = Math.max(0, Math.min(1, Number(input.derivedInscriptionTimeShare ?? 0)))
  return {
    ultimateCount,
    basicDamagePerSec: Number(input.basicDamagePerSec ?? 0),
    basicDazePerSec: Number(input.basicDazePerSec ?? 0),
    basicGashPerSec: input.basicGashPerSec,
    // 占比直接取调用方传入的账本/手动值（唯一来源 = deriveClaretTwoStateTime）
    inscriptionBasicTimeShare: Math.max(0, Math.min(1, Number(input.inscriptionBasicTimeShare ?? 0))),
    inscriptionBasicTimeShareSource: input.inscriptionBasicTimeShareSource === 'manual' ? 'manual' : 'ledger',
    normalSharpnessPerSec,
    combatTime: Math.max(0, Number(input.combatTime ?? input.basicAttackTime ?? 0)),
    sharpnessAutoPerSec: Math.max(0, Number(input.sharpnessAutoPerSec ?? 0)),
    normalAttackSharpnessPerSec: Math.max(0, Number(input.normalAttackSharpnessPerSec ?? 0)),
    normalBasicTimeNeeded,
    inscriptionBasicTime: Math.max(0, Number(input.inscriptionBasicTime ?? 0)),
    inscriptionWindowSecondsPerEntry: Math.max(
      0,
      Number(input.inscriptionWindowSecondsPerEntry
        ?? DEFAULT_INSCRIPTION_WINDOW_SECONDS + (cinemaLevel >= 2 ? C2_INSCRIPTION_WINDOW_BONUS_SECONDS : 0)),
    ),
    cinemaLevel,
    derivedInscriptionTimeShare,
    inscriptionEntries: Math.max(0, Number(input.inscriptionEntries ?? 0)),
    inscriptionWindowSeconds: Math.max(0, Number(input.inscriptionWindowSeconds ?? DEFAULT_INSCRIPTION_WINDOW_SECONDS)),
    sharpnessPerEntry: Math.max(1, Number(input.sharpnessPerEntry ?? SHARPNESS_PER_ENTRY)),
    gashValuePct,
    gashBuildupMultiplier: buildupMultiplier,
    moveGashValuePct: moveGashTotal * buildupMultiplier,
    basicGashValuePct: Math.max(0, input.basicGashPerSec * input.basicAttackTime) * buildupMultiplier,
    gashStacks,
    counterAssistGashStacks,
    maimDemand,
    gashStackConsumed,
    maimCount,
    maimFromCleave,
    maimFromBurial,
    maimFromC6: c6Extra,
    burialCastsSettled,
    autoBurialCasts,
    sharpnessGain,
    affordableExCount,
    sharpnessSpend,
    sharpnessRemaining: Math.max(0, sharpnessGain - sharpnessSpend),
    note: 'v12 口径：残痕值 = 平A（两态秒均×时间）+ 其余全部招式（实打次数 × gash_buildup 表值）→ × 积蓄效率，每 600 点 = 1 层；3 层是敌人身上同时存量上限、不是整局毁伤次数上限；**毁伤按层数结算**（用户 2026-10-09）——滑块的斩金断铁/葬血强袭先扣，**剩余层数一律由葬血强袭打完**（不设次数上限，真正的约束是时间：每次 2.884s 必做前台，由折叠环挤平A）；葬血强袭可**打断**（只打前半段：时间与数值减半，但 3 次毁伤照常全触发，每次省 1.1585s 还给平A）；反制支援整组化解控制技时琢形「重击命中直接添加 1 层残痕」（每组 +600 点、不吃积蓄效率倍率）；锐能 = 进场 60（勘域 180s 一次）+ 终结技 10/次，秘血铸锋 60/发。',
  }
}

/**
 * 平A两态基准段实测（秒均）：常态 = 血锻四式基准段，猩红铭刻 = 锻星基准段。
 *
 * 为什么需要：引擎 `getBasicComboMoves` 只挑**一个**基准段（默认 basic 第 3 段 = 血锻#3），
 * 但克拉蕾两态打的不是同一套招式（用户口径 2026-09-11），且 gachabase `gash_buildup` 列
 * 显示两态残痕积累也不同（血锻 100/s vs 锻星 120/s）。故本模块自己按两套基准算秒均，
 * 再按铭刻时间占比加权覆盖执行行（见 `applyClaretBasicRows`）。
 */
function computeClaretBasicPerSec(
  normalMove: SkillMove | null | undefined,
  inscriptionMove: SkillMove | null | undefined,
  inscriptionTimeShare: number,
): { damage: number; daze: number; gash: number; normalDamage: number; inscriptionDamage: number; normalGash: number; inscriptionGash: number; share: number } {
  const share = Math.max(0, Math.min(1, inscriptionTimeShare))
  const perSec = (move: SkillMove | null | undefined, rowId: string) => {
    const at = move?.actionTime ?? 0
    return at > 0 ? getRowValue(move, rowId) / at : 0
  }
  const normalDamage = perSec(normalMove, 'damage')
  const inscriptionDamage = perSec(inscriptionMove, 'damage')
  const normalGash = perSec(normalMove, 'gash_buildup') || perSec(normalMove, 'anomaly_buildup')
  const inscriptionGash = perSec(inscriptionMove, 'gash_buildup') || perSec(inscriptionMove, 'anomaly_buildup')
  // 加权只在两套基准都有值时才混（缺一套 → 用有值的那套，避免半截数据造出 0.6×零）
  const mix = (a: number, b: number) => (a > 0 && b > 0 ? a * (1 - share) + b * share : (a || b))
  return {
    damage: mix(normalDamage, inscriptionDamage),
    daze: mix(perSec(normalMove, 'daze'), perSec(inscriptionMove, 'daze')),
    gash: mix(normalGash, inscriptionGash),
    normalDamage,
    inscriptionDamage,
    normalGash,
    inscriptionGash,
    share,
  }
}

/** 常态平A基准段：catalog `basicBenchmarkMoveId` 优先（缺省无配置），回落引擎同款「第 3 段」= 血锻#3（1611003）。 */
function resolveNormalBenchmark(skills: AgentSkills | undefined): SkillMove | null {
  const basic = skills?.categories.find(c => c.id === 'basic')
  if (!basic) return null
  return pickThirdNamedBasicSegment(basic.moves)
}

/**
 * 完整的两态加权入口（`buildCharConfig` 与 `buildClaretResourceSource` 共用）：
 * 从已缓存的两套基准 moveId 现算秒均，避免两处各写一遍混合公式。
 */
function computeClaretBasicPerSecFromCfg(cfg: AgentCharConfigInput['cfg'], share: number) {
  const skills = cfg.claretSkills
  return computeClaretBasicPerSec(
    findMoveById(skills, String(cfg.claretNormalBenchmarkMoveId ?? '')),
    findMoveById(skills, String(cfg.claretInscriptionBenchmarkMoveId ?? '')),
    share,
  )
}

function buildClaretCharConfig({ agent, skills, cinemaLevel, cfg, char }: AgentCharConfigInput): void {
  cfg.claretSkills = skills
  // 交互栏用户输入（CC-35b 同款：模块从 `char` 读本角色专属次数，不让 helpers 的 cfg 字面量替每槽拷一遍）。
  cfg.claretBurialInterruptCount = Math.max(0, Math.floor(Number(char?.claretBurialInterruptCount ?? 0)))
  // （2026-09-19 R37 清理）曾在此写 cfg.claretExMoveId / claretExDamageMultiplier：全仓零读取点的死诊断键
  //   （EX 行倍率由 enrichExecutionPlan 按 moveId 从倍率表回填，不经这里），判据 14 看不见 record 动态键 ⇒ 手工核销。
  /**
   * 残痕积累表（moveId → 该招一发的 `gash_buildup` 点数）——**全类别**（**含 basic**）。
   *
   * ⚠ 平A段入表**不会**造成双计（这是本表与「平A两态秒均」的分工，2026-10-12 澄清）：
   *   · **非轴**路径：`buildClaretResourceSource` 的 `moveGashTotal` 只查**非平A**的招式 id
   *     （EX/闪反/弹防/支援突击/反制支援/终结/连携），平A 走「两态秒均 × 平A时间」⇒ 本表里的
   *     basic 行（1611001–1611008/1611029）**在非轴路径上没有任何读取点**，不参与求和。
   *   · **轴内**路径（2026-10-12 新增）：轴编辑器允许把**锻星/血锻四式**当作块拖进轴内
   *     （它们就是轴内的积累来源）——`simulateAxisGashTimeline` 按 moveId 查本表，
   *     若 basic 段不入表，轴内积累恒 0 ⇒ 轴内毁伤永远触发不了（实测 `1611007` 查表 undefined）。
   *   ⇒ 两处读取口径不同、互不重叠：本表必须收全，非轴侧的「不含平A」由**调用点**保证。
   *
   * 融合组走 `fusedRowValue`（反制支援 = 本体 446 + 琢形 134 = 580/次，一次动作一次积累）。
   * ⚠️ 历史坑（2026-09-12 更正）：这里原先只取秘血铸锋一发、且读的是 `anomaly_buildup` 列
   *   （234.96，真值 = `gash_buildup` 281.97）——列名混淆的老病根，见 GAME_TERM_TO_CODE_FIELD §11.1。
   */
  const gashByMoveId: Record<string, number> = {}
  for (const cat of skills.categories) {
    for (const m of cat.moves) {
      const v = fusedRowValue(skills, String(m.id), 'gash_buildup') ?? getRowValue(m, 'gash_buildup')
      if (v > 0) gashByMoveId[String(m.id)] = v
    }
  }
  cfg.claretGashByMoveId = gashByMoveId
  cfg.claretMaimDamageMultiplier = getRowValue(findMoveById(skills, MAIM_MOVE_ID), 'damage') || 1625.6
  cfg.claretBloodBurialDamageMultiplier = getRowValue(findMoveById(skills, BLOOD_BURIAL_MOVE_ID), 'damage') || 626.3
  /**
   * 葬血强袭（1611014）与它的入场段「斩金断铁·上挑」（1611011）的**全通道**表值。
   *
   * 为什么需要：`buildClaretExecutions` 把两者**融合成一次动作**发行（用户口径 2026-10-09），
   * 融合后的失衡/喧响不再是单行表值 ⇒ 必须显式覆盖（`dazeMultiplierOverride` /
   * `decibelRecoveryOverride`），否则 `enrichExecutionPlan` 会按 moveId 1611014 回填**单行**值，
   * 静默丢掉上挑段那一份。伤害侧同理（打断版要按比例缩）。
   */
  cfg.claretBloodBurialDaze = getRowValue(findMoveById(skills, BLOOD_BURIAL_MOVE_ID), 'daze')
  cfg.claretBloodBurialDecibel = getRowValue(findMoveById(skills, BLOOD_BURIAL_MOVE_ID), 'decibel_recovery')
  /**
   * 段时长从 **catalog actionTime** 读（规则 11：跨文件常量单一来源；`CLEAVE_ENTRY_SECONDS` 等常量
   * 只作 catalog 缺值时的兜底，且值与其一致）。葬血强袭的融合时长 = 入场上挑 + 三连横斩。
   */
  cfg.claretCleaveEntrySeconds = findMoveById(skills, CLEAVE_ENTRY_MOVE_ID)?.actionTime ?? CLEAVE_ENTRY_SECONDS
  cfg.claretBurialSeconds = findMoveById(skills, BLOOD_BURIAL_MOVE_ID)?.actionTime ?? BURIAL_SECONDS
  cfg.claretCleaveEntryDamage = getRowValue(findMoveById(skills, CLEAVE_ENTRY_MOVE_ID), 'damage')
  cfg.claretCleaveEntryDaze = getRowValue(findMoveById(skills, CLEAVE_ENTRY_MOVE_ID), 'daze')
  cfg.claretCleaveEntryDecibel = getRowValue(findMoveById(skills, CLEAVE_ENTRY_MOVE_ID), 'decibel_recovery')
  /**
   * spec 事件载体行的**表值预取**（CC-250 协议：`buildSpecEventExecutions` 缺省读 `cfg.mechanicRowValues`）。
   *
   * ⚠ 克拉蕾是**自定义 TS 模块**，不走 `specToMechanicModule.buildCharConfig`，而那份预取只长在
   *   spec 模块里 ⇒ 本模块若不自己写，`buildSpecEventExecutions` 读到的 base 恒为 0；damage 行又
   *   没有 override ⇒ 命中 `if (multiplier <= 0 && !usesOverride) continue` **静默丢弃整行**。
   *   实测缺陷：斩金断铁本体两段（1611011 上挑 153.6% / 1611012 横斩 175.7%）**从未被发行**——
   *   滑块默认 1 次，但伤害/失衡/喧响一分没进账（`roxy.ts` 有同款先例，是唯一写该键的自定义模块）。
   *   判据：`claretSmoke.test.ts` 的「斩金断铁本体两段必须发行」组。
   */
  cfg.mechanicRowValues = {
    ...(cfg.mechanicRowValues ?? {}),
    [CLEAVE_ENTRY_MOVE_ID]: getRowValue(findMoveById(skills, CLEAVE_ENTRY_MOVE_ID), 'damage'),
    [CLEAVE_SLASH_MOVE_ID]: getRowValue(findMoveById(skills, CLEAVE_SLASH_MOVE_ID), 'damage'),
    [MAIM_MOVE_ID]: getRowValue(findMoveById(skills, MAIM_MOVE_ID), 'damage'),
  }
  // 平A两态基准（秒均）：常态=血锻基准段、猩红铭刻=锻星#3（用户口径 2026-09-11）
  cfg.claretNormalBenchmarkMoveId = resolveNormalBenchmark(skills)?.id ?? ''
  cfg.claretInscriptionBenchmarkMoveId = INSCRIPTION_BENCHMARK_MOVE_ID
  // 锐能收入两条腿（用户口径 2026-09-11）：
  //   ① 基础**自动累积** 1.5/s（不进招式表，来自 catalog `level60.sharpnessRegen` ← nanoka `stats.ep_recover`/100）
  //   ② 常态血锻四式的招式增益（`sharpness_gain` 列 3.0/s；锻星/E/连携全 0）
  cfg.claretSharpnessAutoPerSec = Math.max(0, Number(agent.level60.sharpnessRegen ?? 0))
  cfg.claretNormalAttackSharpnessPerSec = perSeconds(resolveNormalBenchmark(skills), 'sharpness_gain')
  cfg.claretNormalSharpnessPerSec = Number(cfg.claretSharpnessAutoPerSec)
    + Number(cfg.claretNormalAttackSharpnessPerSec)
  // 窗口覆盖率项要用的动作时长（停表口径：连携/终结发动期间窗口不减 = 等价白送该动作时长）
  const chainMove = findMoveById(skills, CHAIN_MOVE_ID)
  const ultMove = findMoveById(skills, ULTIMATE_MOVE_ID)
  cfg.claretChainActionSeconds = chainMove?.actionTime ?? 0
  cfg.claretUltimateActionSeconds = ultMove?.actionTime ?? 0
  // 面板滑块：0 = 账本推导（默认），1–100 = 手动覆盖（见 deriveClaretTwoStateTime）
  cfg.claretInscriptionShareSetting = Math.max(
    0,
    Math.min(100, cfgSetting(cfg, 'claret.inscriptionBasicTimeShare')),
  )
  cfg.claretChainInWindowCoverage = Math.max(
    0,
    Math.min(1, cfgSetting(cfg, 'claret.chainInWindowCoverage') / 100),
  )
  // 静态初值（账本推导时常态时间 = 0 → 整段铭刻）；真实占比在 buildClaretResourceSource 里按账本重算
  const bench = computeClaretBasicPerSecFromCfg(cfg, 1)
  cfg.claretBasicDazePerSec = bench.daze
  cfg.claretNormalDamagePerSec = bench.normalDamage
  cfg.claretInscriptionDamagePerSec = bench.inscriptionDamage
  cfg.claretCinemaLevel = cinemaLevel
  // 秘血铸锋是锐能强特（costType=resource）：通用引擎不扣能量，强特行由本模块按锐能账本发行
  const exMove = findMoveById(skills, EX_MOVE_ID)
  cfg.claretExActionTime = exMove?.actionTime ?? 0
  cfg.claretExDecibelRecovery = getRowValue(exMove, 'decibel_recovery')
  cfg.skipGenericExSpecial = true
}

/**
 * 停表覆盖率（默认 1，raw 口径）。
 *
 * 口径要点（用户 2026-09-11 裁决）：**不算「每度窗口摊多少连携」**，直接按总额口径——
 * 连携总共延长多少秒 + 总共多少强化时间。连携 ×2s/次 与 停表白送时长（连携/终结动作时长）
 * 合并成一个「全局总延长秒」，一次性加到铭刻总时间上。
 * 该系数留作停表实测不满时的调节口（1 = 停表完全不消耗窗口）。
 */
export const DEFAULT_CHAIN_IN_WINDOW_COVERAGE = 1

/**
 * 两态平A时间账本推导（用户口径 2026-09-11）。
 *
 * 恒等式（用户明确：进场 60 只是开局给的，其余锐能靠平A**自动回复**）：
 *   · 锐能自动回复只长在**常态血锻四式**上（`sharpness_gain` 列 3.0/s；锻星/伏钺/E/连携全 0）
 *   · 进[猩红铭刻] = 打一发秘血铸锋，花 60 锐能 → 常态攒满 60 的秒数 = 60 / 常态锐能速率
 *   · 铭刻窗口内有 锻星 的锐能产出（0）+ 终结技被动（10/次）→ 循环会跨多轮
 * 于是循环形状是 **常态攒能（farm）→ EX 进场 → 铭刻窗口（锻星）→ 再攒**，
 * 由「铭刻总时间 + 常态总时间 = 平A总时间」求解轮数（每次进场 1 轮）：
 *   T_铭刻 = N × 窗口时长 , T_常态 = N × farm 秒数 ⇒ N = 平A时间 / (farm + 窗口)
 *
 * 本函数只做「账本 → 时间」，不改变锐能/残痕结算（那部分在 `computeClaretSharpResource`）。
 */
function deriveClaretTwoStateTime(input: {
  basicAttackTime: number
  ultimateCount: number
  /** 常态锐能速率（/s）= 基础自动累积 + 血锻招式增益 */
  normalSharpnessPerSec: number
  /** 基础自动累积（/s）——**铭刻态也在回**（用户口径 2026-09-11），所以单独传入 */
  sharpnessAutoPerSec?: number
  /** 全局总延长秒（连携 ×2s/次 + 停表白送时长），由 `computeInscriptionExtension` 给出 */
  totalExtensionSeconds?: number
  /**
   * 接战时间（秒）——锐能**自动累积**的时长基准。
   * 用户口径 2026-09-11：自动回复按**接战时间**算，前后台都回，**不是平A时间**。
   * 缺省 = 平A总时间 + 必要时间（= 该角色接战时长）。
   */
  combatTime?: number
  /** 面板滑块值（%）：0 = 由账本推导（默认），1–100 = 手动覆盖 */
  inscriptionTimeShareSetting?: number
  /** 单窗基础时长（秒）——缺省 `DEFAULT_INSCRIPTION_WINDOW_SECONDS`；影画2 由调用方传入 +2s 后的值 */
  windowSeconds?: number
}): {
  normalBasicTimeNeeded: number
  inscriptionTime: number
  share: number
  source: 'ledger' | 'manual'
  entries: number
  farmSecondsPerEntry: number
  extensionSeconds: number
  /** 单窗基础时长（秒）——16s；影画2 起 18s */
  windowSeconds: number
  sharpnessTotal: number
  /** 该轮数下账本能支撑的进场次数（应 ≥ entries，即自洽） */
  affordableExCountAtSolve: number
} {
  const basicAttackTime = Math.max(0, input.basicAttackTime)
  const normalPerSec = Math.max(0, input.normalSharpnessPerSec)
  const autoPerSec = Math.max(0, Number(input.sharpnessAutoPerSec ?? 0))
  const extensionSeconds = Math.max(0, Number(input.totalExtensionSeconds ?? 0))
  // 单窗基础时长（秒）：影画2「最大持续时间延长2秒」由调用方在 windowSeconds 里传入（默认 16s）
  const windowSeconds = Math.max(0, Number(input.windowSeconds ?? DEFAULT_INSCRIPTION_WINDOW_SECONDS))
  // 自动累积按**接战时间**（前后台都回），不是平A时间
  const combatTime = Math.max(0, Number(input.combatTime ?? basicAttackTime))
  // farm 只作「够不够打出下一发」的判据（按常态速率），**不是**常态时间的长度
  const farmSecondsPerEntry = normalPerSec > 0 ? SHARPNESS_PER_ENTRY / normalPerSec : 0

  // 铭刻窗口可变长，延长量按**全局总额**计入（用户口径 2026-09-11：不算「每度窗口摊多少连携」）。
  //  铭刻总时间 = N × 窗口(16s；影画2 → 18s) + 总延长秒
  //  常态时间   = 平A总时间 − 铭刻总时间
  //  锐能总量   = 自动累积 × **接战时间**（前后台都回，含铭刻态）+ 血锻增益 × 常态时间
  // 轮数 N 取最大可行解：铭刻时间塞得进平A时间，且锐能总量 ≥ N×60。
  // 注意自动累积在铭刻内也产 ⇒ N 越大锐能越多（正反馈），故从 1 往上逐轮试。
  //
  // ⚠ 否决记录（T131 实测，别再改）：本循环**保留逐轮试**，不要改代数闭式。
  //   T126 已证谓词对 k 单调递减 ⇒ 闭式（两条上界取小）**逐位等价**（T131 实测 0 差 /
  //   748,040 点 + 临界构造 0 差 / 1,323,092 点，含 354,448 个精确取等点）——但等价不等于更直白：
  //   ① 闭式把「两条上界取小」的**证明义务**转给读者（循环是自明的「两条约束都成立就再试一轮」）；
  //   ② 它引入一条**代码里没写、只在数据里成立**的前提 `normalPerSec ≥ autoPerSec`
  //      （谓词由递减翻递增；`sharpness_gain` 是未夹紧的 catalog 列，一旦为负/录错即**静默错**：
  //      实测 auto=3.3/normal=0.79 时循环 5、闭式 1）。要补前提就得显式回退分支 ⇒ 比原循环更长。
  //   ⇒ 结论：纯可读性收益不成立（规则 12），维持现状。
  let n = 1
  while (n < MAX_INSCRIPTION_ENTRIES) {
    const k = n + 1
    const inscriptionTime = k * windowSeconds + extensionSeconds
    if (inscriptionTime > basicAttackTime + 1e-9) break
    const normalTime = basicAttackTime - inscriptionTime
    const available = autoPerSec * combatTime + (normalPerSec - autoPerSec) * normalTime
    if (available + 1e-9 < k * SHARPNESS_PER_ENTRY) break
    n = k
  }
  const inscriptionTime = Math.min(basicAttackTime, n * windowSeconds + extensionSeconds)
  const ledgerNormalTime = Math.max(0, basicAttackTime - inscriptionTime)
  const ledgerShare = basicAttackTime > 0 ? Math.min(1, inscriptionTime / basicAttackTime) : 0
  const setting = Number(input.inscriptionTimeShareSetting)
  const manual = Number.isFinite(setting) && setting > 0
  const share = manual ? Math.max(0.01, Math.min(1, setting / 100)) : ledgerShare
  const normalTime = manual ? basicAttackTime * (1 - share) : ledgerNormalTime
  const sharpnessTotal = autoPerSec * combatTime + (normalPerSec - autoPerSec) * normalTime
  return {
    normalBasicTimeNeeded: normalTime,
    inscriptionTime: Math.max(0, basicAttackTime - normalTime),
    share,
    source: manual ? 'manual' : 'ledger',
    entries: manual ? Math.max(1, Math.max(0, basicAttackTime - normalTime) / windowSeconds) : n,
    farmSecondsPerEntry,
    extensionSeconds,
    windowSeconds,
    sharpnessTotal,
    affordableExCountAtSolve: Math.floor(sharpnessTotal / SHARPNESS_PER_ENTRY),
  }
}

/**
 * 全局总延长秒：连携 ×2s/次 + **非强化招式不占强化时间**的白送时长。
 *
 * @fact agent:1611/铭刻窗口·停表 口径: 停表覆盖率 100%——铭刻时间**只被吃强化的招式（血锻/锻星/E）消耗**；连携技/终结技**不吃强化**（伤害不随态变化，所以也不消耗强化时间），其动作时长全额等价于延长窗口；连携另按 raw 送 +2s/次 | 据 用户@2026-09-11「连携大招不分强化态，这些招式不掉时间，是因为它没有消耗强化时间进行招式强化」·复核@2026-09-25·复核@2026-09-30 | 验 src/mechanics/__tests__/claretSmoke.test.ts | 锚 src/mechanics/agents/claret.ts#computeInscriptionExtension | 信 确认
 *
 * 这条与 raw 描述一致（「发动期间，[猩红铭刻]持续时间不再减少」），但**理由更本质**：
 * 不是「停表」这个动作，而是「这些招式本就不申请强化」。两处口径同时成立，停表覆盖率固定 100%；
 * `stopwatchCoverage` 参数保留只为将来出现「吃强化的非平A招式」时能按比例回退。
 */
function computeInscriptionExtension(params: {
  chainCount: number
  chainActionSeconds: number
  ultimateCount: number
  ultimateActionSeconds: number
  stopwatchCoverage?: number
}): number {
  const chains = Math.max(0, Number(params.chainCount) || 0)
  const ults = Math.max(0, Number(params.ultimateCount) || 0)
  const coverage = Math.max(0, Math.min(1, Number(params.stopwatchCoverage ?? 1)))
  return chains * INSCRIPTION_CHAIN_EXTENSION_SECONDS
    + coverage * (chains * Math.max(0, Number(params.chainActionSeconds) || 0)
      + ults * Math.max(0, Number(params.ultimateActionSeconds) || 0))
}


function buildClaretResourceSource(cfg: AgentCharConfigInput['cfg'], state: AgentResourceInput['state']) {
  const ultimateCount = Math.max(0, Math.floor(state.ultimateCount))
  // 全局总延长秒（总额口径，不算每窗摊多少连携）：连携×2s + 停表白送时长
  const stopwatchCoverage = Math.max(0, Math.min(1, Number(cfg.claretChainInWindowCoverage ?? DEFAULT_CHAIN_IN_WINDOW_COVERAGE)))
  const totalExtensionSeconds = computeInscriptionExtension({
    chainCount: Math.max(0, state.chainCountTotal),
    chainActionSeconds: Number(cfg.claretChainActionSeconds ?? 0),
    ultimateCount,
    ultimateActionSeconds: Number(cfg.claretUltimateActionSeconds ?? 0),
    stopwatchCoverage,
  })
  // 两态时间：账本推导（滑块 0 = auto）
  const basicAttackTime = Math.max(0, state.basicAttackTime)
  // 接战时间：优先读 state.frontlineTime；缺省 = 平A + 必要（同一口径）
  const combatTime = Math.max(
    basicAttackTime,
    state.frontlineTime || (basicAttackTime + Math.max(0, state.necessaryTime)),
  )
  const twoState = deriveClaretTwoStateTime({
    basicAttackTime,
    ultimateCount,
    normalSharpnessPerSec: Number(cfg.claretNormalSharpnessPerSec ?? 0),
    sharpnessAutoPerSec: Number(cfg.claretSharpnessAutoPerSec ?? 0),
    totalExtensionSeconds,
    combatTime,
    inscriptionTimeShareSetting: Number(cfg.claretInscriptionShareSetting ?? 0),
    // 影画2「猩红铭刻最大持续时间延长2秒」⇒ 单窗 16s → 18s（★ R55 建模，旧实现整条漏掉）
    windowSeconds: DEFAULT_INSCRIPTION_WINDOW_SECONDS
      + (cinemaLevelOf(cfg.claretCinemaLevel) >= 2 ? C2_INSCRIPTION_WINDOW_BONUS_SECONDS : 0),
  })
  // EX 发数 = 循环轮数（每轮 = 一次 EX 进场；窗口内也在回锐能，故轮数由上面的双约束解出）
  const affordableExCount = Math.max(0, Math.floor(twoState.entries))
  const blended = computeClaretBasicPerSecFromCfg(cfg, twoState.share)
  // ── 轴内残痕时序（用户口径 2026-10-12）──
  // 轴模式下：**轴内先按执行先后推演消耗**（积累 → 消耗 → 再积累，够不够决定这次毁伤触不触发），
  // 轴内吃掉的层从轴外可消耗层数里**扣除**（同一池、总量守恒）——用户原话「捏了多少消耗多少后，
  // 剩下的自动计算然后放在失衡轴外，吃不到易伤」。非轴（`axisSequence` 空）⇒ 恒 null，零变化。
  const axisSequence = cfg.axisSequence ?? []
  const axisGashSim = axisSequence.length > 0
    ? simulateAxisGashTimeline({
        sequence: axisSequence,
        gashByMoveId: cfg.claretGashByMoveId ?? {},
        // 进轴残痕值 = 轴内积累**之前**已攒下的量。本模块用「轴内积累量」从总量里反推：
        // 轴内各块的积累在总账里已计（下方 `moveGashTotal` 走全局次数），故进轴值取 0 起算，
        // 轴内积累由序列自身提供 ⇒ 与用户例子「一开始1800进去」等价建模为
        // 「轴内先攒 1800 再打 3 层」（序列里就有那 15 次锻星）。
        entryGashValue: 0,
        consumePerCastByMoveId: { [CLEAVE_SLASH_MOVE_ID]: 1, [BLOOD_BURIAL_MOVE_ID]: BURIAL_MAIM_PER_CAST },
      })
    : null
  // ── 残痕：平A 之外的**全部招式**按「本局实打次数 × 该招 `gash_buildup` 表值」累加 ──
  // 次数取**引擎发行那些行时读的同一批字段**，不去翻已生成的行：模块的 buildExecutions 钩子在
  // 闪反/弹刀/支援突击/反制支援行**之前**派发（core/resource/helpers#buildExecutions 的顺序），
  // 按行求和会随调用点漏项。平A 段不入这张表（按两态秒均×时间算，再按行算=双计）。
  // 无物化行的交互（快速支援）不计积累 —— 与伤害/失衡侧同一近似。
  const gashByMoveId = cfg.claretGashByMoveId ?? {}
  const gashOf = (moveId: string | undefined) => (moveId ? gashByMoveId[moveId] ?? 0 : 0)
  const moveGashTotal
    = gashOf(cfg.exSpecialMoveId) * affordableExCount
    + gashOf(cfg.dodgeCounterMoveId) * Math.max(0, cfg.dodgeCounterCount)
    + gashOf(cfg.defensiveAssistMoveId) * (Math.max(0, cfg.parryCount) + Math.max(0, cfg.parryNoFollowUpCount))
    + gashOf(cfg.assistFollowUpMoveId) * Math.max(0, cfg.parryCount)
    + gashOf(cfg.counterAssistMoveId) * Math.max(0, Math.floor(cfg.counterAssistCount))
    + gashOf(cfg.ultimateMoveId) * Math.max(0, state.ultimateCount)
    + gashOf(cfg.chainMoveId) * Math.max(0, cfg.chainCountTotalOverride ?? state.chainCountTotal ?? 0)
  return computeClaretSharpResource({
    basicGashPerSec: blended.gash,
    basicAttackTime: Math.max(0, state.basicAttackTime),
    moveGashTotal,
    axisGash: axisGashSim
      ? { consumedLayers: axisGashSim.consumedLayers, maimCount: axisGashSim.maimCount, unfiredMaim: axisGashSim.unfiredMaim }
      : undefined,
    cleaveSpecialCount: Math.max(0, Math.floor(cfgSetting(cfg, 'claret.cleaveSpecialCount'))),
    bloodBurialCount: Math.max(0, Math.floor(cfgSetting(cfg, 'claret.bloodBurialCount'))),
    gashCoverage: Math.max(0, Math.min(1, Math.min(100, cfgSetting(cfg, 'claret.gashCoverage')) / 100)),
    cinemaLevel: cinemaLevelOf(cfg.claretCinemaLevel),
    chainCountTotal: state.chainCountTotal,
    ultimateCount,
    basicDamagePerSec: blended.damage,
    basicDazePerSec: blended.daze,
    inscriptionBasicTimeShare: twoState.share,
    inscriptionBasicTimeShareSource: twoState.source,
    normalBasicTimeNeeded: twoState.normalBasicTimeNeeded,
    inscriptionBasicTime: twoState.inscriptionTime,
    derivedInscriptionTimeShare: twoState.share,
    normalSharpnessPerSec: Number(cfg.claretNormalSharpnessPerSec ?? 0),
    combatTime,
    sharpnessAutoPerSec: Number(cfg.claretSharpnessAutoPerSec ?? 0),
    normalAttackSharpnessPerSec: Number(cfg.claretNormalAttackSharpnessPerSec ?? 0),
    inscriptionEntries: twoState.entries,
    inscriptionWindowSeconds: twoState.extensionSeconds,
    inscriptionWindowSecondsPerEntry: twoState.windowSeconds,
    sharpnessPerEntry: SHARPNESS_PER_ENTRY,
    affordableExCountOverride: affordableExCount,
    // 反制支援（boss 控制技整组化解，store 折算注入 cfg）→ 琢形每次直接送 1 层残痕
    counterAssistCount: Math.max(0, Math.floor(cfg.counterAssistCount)),
  })
}

function buildClaretResourceResult({ cfg, state }: AgentResourceResultInput): Partial<CharacterResourceResult> {
  return {
    claretSharpResourceSource: buildClaretResourceSource(cfg, state),
  }
}

function buildClaretExecutions({ cfg, state, executions }: AgentResourceInput): void {
  const cinemaLevel = cinemaLevelOf(cfg.claretCinemaLevel)
  // 残痕值来源：平A（两态秒均×时间）+ 其余全部招式（实打次数 × gash_buildup 表值）
  const source = buildClaretResourceSource(cfg, state)
  // 平A双基准覆盖：引擎只认一个基准段（默认血锻#3），但克拉蕾常态/铭刻两态招式不同
  // → 用账本推导出的铭刻时间占比加权出的秒均覆盖（enrich 见 damageMultiplierOverride 分支）
  const basicRow = executions.find(e => e.moveId === 'basic_attack')
  if (basicRow) {
    const share = source.inscriptionBasicTimeShare
    const normalDps = Number(cfg.claretNormalDamagePerSec ?? 0)
    const inscriptionDps = Number(cfg.claretInscriptionDamagePerSec ?? 0)
    const blendedDps = share * inscriptionDps + (1 - share) * normalDps
    basicRow.damageMultiplier = blendedDps
    basicRow.dazeMultiplier = Number(cfg.claretBasicDazePerSec ?? 0)
    basicRow.anomalyBuildUp = source.basicGashPerSec
    basicRow.totalAnomalyBuildUp = source.basicGashPerSec * Math.max(0, basicRow.totalTime)
    basicRow.damageMultiplierOverride = true
    basicRow.dazeMultiplierOverride = true
    const sourceNote = `（${source.inscriptionBasicTimeShareSource === 'ledger' ? '账本推导' : '手动覆盖'}）`
    basicRow.skillTableNote = `平A双基准${sourceNote}：铭刻占比 ${fmt(share * 100)}%（常态 ${fmt(normalDps)}%/s 血锻四式 · 铭刻 ${fmt(inscriptionDps)}%/s 锻星）· 加权 ${fmt(blendedDps)}%/s · 残痕 ${fmt(source.basicGashPerSec)}%/s`
  }
  const exCount = Math.max(0, Math.floor(source.affordableExCount))
  if (exCount > 0) {
    executions.push(moduleExecRow({
      moveId: EX_MOVE_ID,
      moveName: '强化特殊技（EX Special）：秘血铸锋（锐能 60/发）',
      category: 'special',
      count: exCount,
      actionTime: Number(cfg.claretExActionTime ?? 0),
      totalTime: exCount * Number(cfg.claretExActionTime ?? 0),
      decibelRecovery: Number(cfg.claretExDecibelRecovery ?? 0),
      totalDecibelRecovery: exCount * Number(cfg.claretExDecibelRecovery ?? 0),
      ...ENERGY_RECOVERY_OFF,
      timeBucket: 'necessary',
    }))
  }
  const spec = getAgentSpec(CLARET_AGENT_ID)
  if (!spec) return
  const cleaveCount = Math.max(0, Math.floor(cfgSetting(cfg, 'claret.cleaveSpecialCount')))
  const burialCount = Math.max(0, Math.floor(source.burialCastsSettled))
  // 打断次数（交互栏录入）：夹到 [0, 实际结算次数]——打断了就没有那一次完整施放。
  const interruptCount = Math.min(
    Math.max(0, Math.floor(Number(cfg.claretBurialInterruptCount ?? 0))),
    burialCount,
  )
  const fullBurialCount = Math.max(0, burialCount - interruptCount)
  // ── 葬血强袭（含入场「斩金断铁·上挑」）按**真实时间**发行 ──
  // 用户口径 2026-10-09：这是普通招式，必须吃前台时间；进「必做动作」池自然挤平A，由折叠环收敛。
  // 融合口径：每次 = 上挑（1611011，153.6%/0.567s）+ 三连横斩（1611014，626.3%/2.317s）= 779.9%/2.884s
  //   —— 原文「在[特殊技：血华誓·斩金断铁]**上挑期间**，保持长按…发动」；用户确认「要：每次葬血强袭都含上挑那一下」。
  // ⚠ 这两行原由 spec 事件发行且 `actionTime` 记 0（历史遗漏，行时间整段丢失）⇒ 改由模块按融合口径发行，
  //   spec 的 `claret_blood_burial` 事件已停用（`1611.json` 的 `enabledField`）。
  // ⚠ 必须用**真 moveId 1611014**（不是自造 id）：`enrichExecutionPlan` 按 moveId 找行、`skillDamageTarget`
  //   定向、M4 的 `patchExecutions` 都依赖它；融合后的倍率/失衡/喧响全部走 `*Override` 显式覆盖。
  // 段时长（秒）：catalog 为源、常量为兜底（见 buildClaretCharConfig）
  const entrySeconds = Math.max(0, Number(cfg.claretCleaveEntrySeconds ?? CLEAVE_ENTRY_SECONDS))
  const bodySeconds = Math.max(0, Number(cfg.claretBurialSeconds ?? BURIAL_SECONDS))
  const entry = {
    damage: Number(cfg.claretCleaveEntryDamage ?? 0),
    daze: Number(cfg.claretCleaveEntryDaze ?? 0),
    decibel: Number(cfg.claretCleaveEntryDecibel ?? 0),
  }
  const body = {
    damage: Number(cfg.claretBloodBurialDamageMultiplier ?? 626.3),
    daze: Number(cfg.claretBloodBurialDaze ?? 0),
    decibel: Number(cfg.claretBloodBurialDecibel ?? 0),
  }
  const ratio = BURIAL_INTERRUPT_RATIO
  /** 一次完整施放：上挑 + 三连横斩全额 */
  if (fullBurialCount > 0) {
    executions.push(moduleExecRow({
      moveId: BLOOD_BURIAL_MOVE_ID,
      moveName: '特殊技：血华誓·葬血强袭（含上挑）',
      category: 'special',
      count: fullBurialCount,
      actionTime: entrySeconds + bodySeconds,
      totalTime: fullBurialCount * (entrySeconds + bodySeconds),
      damageMultiplier: entry.damage + body.damage,
      damageMultiplierOverride: true,
      dazeMultiplier: entry.daze + body.daze,
      dazeMultiplierOverride: true,
      decibelRecovery: entry.decibel + body.decibel,
      decibelRecoveryOverride: true,
      ...ENERGY_RECOVERY_OFF,
      timeBucket: 'necessary',
    }))
  }
  // 打断版：三连横斩只打一半（时间与伤害/失衡/喧响减半），**上挑那一下照打**；
  // 毁伤**照常 3 次**（毁伤由独立的 `claret_maim` 行结算，不随这里的数值减半）
  if (interruptCount > 0) {
    executions.push(moduleExecRow({
      moveId: BLOOD_BURIAL_MOVE_ID,
      moveName: '特殊技：血华誓·葬血强袭（含上挑·已打断）',
      category: 'special',
      count: interruptCount,
      actionTime: entrySeconds + bodySeconds * ratio,
      totalTime: interruptCount * (entrySeconds + bodySeconds * ratio),
      damageMultiplier: entry.damage + body.damage * ratio,
      damageMultiplierOverride: true,
      dazeMultiplier: entry.daze + body.daze * ratio,
      dazeMultiplierOverride: true,
      decibelRecovery: entry.decibel + body.decibel * ratio,
      decibelRecoveryOverride: true,
      ...ENERGY_RECOVERY_OFF,
      timeBucket: 'necessary',
    }))
  }
  const generated = buildSpecEventExecutions(spec, {
    cfg,
    state,
    counts: {
      claretCleaveCount: cleaveCount,
      // 葬血强袭已由本模块按融合口径发行（含时间）⇒ spec 事件传 0 避免双计
      claretBloodBurialCount: 0,
      claretMaimCount: Math.max(0, Math.floor(source.maimCount)),
      claretMaimFromCleave: Math.max(0, Math.floor(source.maimFromCleave)),
      claretMaimFromBurial: Math.max(0, Math.floor(source.maimFromBurial)),
      claretMaimFromC6: Math.max(0, Math.floor(source.maimFromC6)),
    },
    overrides: {
      claret_maim: { multiplier: Number(cfg.claretMaimDamageMultiplier ?? 1625.6) * (cinemaLevel >= 1 ? C1_MAIM_MULT : 1) },
    },
  })
  executions.push(...generated)
}

function patchClaretExecutions({ cfg, state: _state, executions }: AgentResourceInput): void {
  const cinema = cinemaLevelOf(cfg.claretCinemaLevel)
  if (cinema < 4) return
  for (const exec of executions) {
    if (exec.moveId && M4_MOVE_IDS.has(exec.moveId)) {
      exec.dmgBonus = (exec.dmgBonus ?? 0) + M4_DMG_BONUS
    }
  }
}

function buildClaretResourceSections({ result }: AgentResourceSectionsInput) {
  const source = result.claretSharpResourceSource
  if (!source) return []
  return [
    {
      id: 'claret-gash-maim',
      title: '克拉蕾残痕·毁伤（v12）',
      summary: `残痕值 ${fmt(source.gashValuePct)}% → ${source.gashStacks} 层 · 消耗 ${Math.floor(source.gashStackConsumed)} 层 · 毁伤 × ${source.maimCount}`,
      rows: [
        { label: '残痕值', value: `${fmt(source.gashValuePct)}%`, detail: `平A ${fmt(source.basicGashValuePct ?? 0)}%（两态基准 ${fmt(source.basicGashPerSec)}%/s × 时间）+ 其余招式积累 ${fmt(source.moveGashValuePct ?? 0)}%（各招实打次数 × 表列 gash_buildup，含强特/闪反/连携/终结/支援突击/反制支援），合计再 × 积蓄效率；每 600 点 = 1 层` },
        { label: '积蓄效率', value: `×${fmt(source.gashBuildupMultiplier)}`, detail: `1 + 核心 50%（Lv.7）+ 影画1 20%` },
        ...(source.counterAssistGashStacks
          ? [{
              label: '反制支援送层',
              value: `+${source.counterAssistGashStacks} 层`,
              detail: `整组化解 ${source.counterAssistGashStacks} 组控制技，琢形「重击命中直接添加 1 层[残痕]」（不吃积蓄效率倍率）`,
            }]
          : []),
        { label: '毁伤需求', value: `${source.maimDemand} 段`, detail: `斩金断铁×1 + 葬血强袭×3/次（结算 ${source.burialCastsSettled} 次，含自动补足 ${source.autoBurialCasts} 次）+ 影画6(连携+终结)×1；其中影画6 **不消耗残痕**，不占层预算。段数按招式段算，与层数会差几层（葬血强袭每次 3 段）` },
        { label: '残痕消耗', value: `-${Math.floor(source.gashStackConsumed)} 层`, detail: `命中残痕状态敌人，每层一次毁伤（覆盖率 ${fmt(Math.min(100, Math.max(0, source.gashStackConsumed / Math.max(1e-9, source.gashStacks) * 100)))}% 折算）。**按层数结算**：滑块的斩金断铁/葬血强袭先扣，剩余层数一律由葬血强袭自动打完（不再被滑块封顶）` },
        { label: '毁伤触发', value: `${source.maimCount} 次`, detail: `斩金断铁 ${source.maimFromCleave} + 葬血强袭 ${source.maimFromBurial} + 影画6 ${source.maimFromC6}` },
        { label: '葬血强袭结算', value: `${source.burialCastsSettled} 次`, detail: `滑块声明 + **自动补足 ${source.autoBurialCasts} 次**（剩余层数 ÷ 3 向上取整）；每次 2.884s 必做前台（入场上挑 0.567s + 三连横斩 2.317s），由折叠环自然挤平A——这是毁伤次数真正的约束（滑块不是上限）` },
      ],
      footer: `v12：残痕值 = 平A（两态秒均×时间）+ 其余招式（实打次数 × gash_buildup 表值），每 600 点 = 1 层（用户口径）；敌人身上同时最多挂 ${GASH_MAX_STACKS} 层，但整局可用层数不钳制。**毁伤按层数结算**（用户 2026-10-09）：滑块的斩金断铁/葬血强袭先扣，**剩余层数一律由葬血强袭自动补足打完**（不设次数上限，真正的约束是时间）；反制支援化解控制技时琢形**额外直接送 1 层/组**（送层不吃积蓄效率，与招式自身的表值积累是两件事）；快速支援等无物化行的交互不计积累。`,
    },
    {
      id: 'claret-two-state-time',
      title: '克拉蕾·平A两态时间账（常态/猩红铭刻）',
      summary: `铭刻占比 ${fmt(source.inscriptionBasicTimeShare * 100)}%（${source.inscriptionBasicTimeShareSource === 'ledger' ? '账本推导' : '手动覆盖'}）· 常态 ${fmt(source.normalBasicTimeNeeded)}s / 铭刻 ${fmt(source.inscriptionBasicTime)}s`,
      rows: [
        { label: '锐能总量', value: `${fmt(source.sharpnessGain)}`, detail: `开局进场 +${fmt(SHARPNESS_INITIAL)}（勘域 180s 一次）+ 终结技 ${source.ultimateCount}×${SHARPNESS_ULTIMATE_GAIN}；其余靠常态平A自动回复` },
        { label: '常态锐能产出', value: `${fmt(source.normalSharpnessPerSec)}/s`, detail: `基础自动累积 ${fmt(source.sharpnessAutoPerSec)}/s（catalog level60.sharpnessRegen）+ 血锻四式招式增益 ${fmt(source.normalAttackSharpnessPerSec)}/s（锻星/伏钺/E/连携全 0）→ 攒满一发 EX（60）需 ${fmt(source.normalBasicTimeNeeded / Math.max(1, source.inscriptionEntries))}s 常态` },
        { label: '循环轮数', value: `${fmt(source.inscriptionEntries)} 轮`, detail: `每轮 = 秘血铸锋进场（60 锐能）→ 打成锻星；常态只在需要补锐能时出现。判据：轮数×60 ≤ 自动累积×平A总时间（铭刻内也回）+ 血锻增益×常态时间` },
        { label: '全局总延长秒', value: `${fmt(source.inscriptionWindowSeconds)}s`, detail: `连携×${INSCRIPTION_CHAIN_EXTENSION_SECONDS}s/次 + 停表白送时长（连携/终结发动期间窗口不减）；总额口径一次性加到铭刻总时间上（不按每窗摊连携）` },
        { label: '常态平A时间', value: `${fmt(source.normalBasicTimeNeeded)}s`, detail: `= 轮数 × 20s；与铭刻时间之和 = 平A总时间（由最大不动点求解）` },
        { label: '铭刻平A时间', value: `${fmt(source.inscriptionBasicTime)}s`, detail: `= 轮数 × 单窗 ${fmt(source.inscriptionWindowSecondsPerEntry)}s + 总延长 ${fmt(source.inscriptionWindowSeconds)}s` },
        { label: '平A秒均', value: `${fmt(source.basicDamagePerSec)}%/s`, detail: `常态 345.21（血锻#3）×${fmt((1 - source.inscriptionBasicTimeShare) * 100)}% + 铭刻 531.88（锻星#3）×${fmt(source.inscriptionBasicTimeShare * 100)}%` },
      ],
      footer: `常态只能打血锻四式、锻星是猩红铭刻专属（用户口径 2026-09-11）；两态平A秒均与残痕积累都不同，按时间占比加权。锐能自动回复按公告列 sharpness_gain（血锻 3.0/s、锻星 0）计入总账。单窗基础 ${fmt(DEFAULT_INSCRIPTION_WINDOW_SECONDS)}s（raw）${cinemaLevelOf(source.cinemaLevel) >= 2 ? ` + 影画2 ${fmt(C2_INSCRIPTION_WINDOW_BONUS_SECONDS)}s` : ''}，另有连携 +2s/次；击杀延长 3s/ICD 未逐秒建模。状态符（核心 +30% 暴击/+50% 积蓄/影画2 18% 电抗）仍按满覆盖计。`,
    },
    {
      id: 'claret-sharpness',
      title: '克拉蕾锐能',
      summary: `进场 +${fmt(SHARPNESS_INITIAL)} · 终结技 +${fmt(source.ultimateCount * SHARPNESS_ULTIMATE_GAIN)}（${source.ultimateCount} 次）· 秘血铸锋 -${fmt(source.sharpnessSpend)} · 结余 ${fmt(source.sharpnessRemaining)}`,
      rows: [
        { label: '锐能获取', value: `+${fmt(source.sharpnessGain)}`, detail: `进场 +${fmt(SHARPNESS_INITIAL)}（勘域 180s 一次 → 每局一次）+ 终结技 ${source.ultimateCount} 次 × ${SHARPNESS_ULTIMATE_GAIN}` },
        { label: '秘血铸锋', value: `${source.affordableExCount} 发`, detail: `每发 60 锐能（v12 原文「锐能消耗：60点」）` },
      ],
      footer: source.note,
    },
  ]
}

const settings: MechanicSetting[] = [
  {
    id: 'claret.cleaveSpecialCount',
    label: '克拉蕾斩金断铁（短按E）次数',
    description: '手法：失衡外离散的短按E 结算残痕（命中残痕敌 → 1 次毁伤）。'
      + '**默认 0**（用户口径 2026-10-09：「不需要斩金断铁，只打葬血强袭」）——轴模式下若要打就在此填，或由轴带入。'
      + '每次占前台 0.567s（上挑）+ 0.649s（横斩）= 1.216s，两段都进伤害/失衡/喧响。',
    default: 0,
    min: 0,
    max: 20,
    step: 1,
    suffix: '次',
  },
  {
    id: 'claret.bloodBurialCount',
    label: '克拉蕾葬血强袭（长按E）声明次数',
    description: '**声明**要打几次葬血强袭——它只决定「前几次由你指定」，**不是结算上限**：'
      + '剩余残痕层数一律由葬血强袭**自动补足打完**（用户口径 2026-10-09「剩下的自动用葬血强袭打完」'
      + '「这个滑块限制就很背离计算逻辑了」）。每次占前台 2.884s（入场上挑 0.567s + 三连横斩 2.317s），'
      + '由折叠环自然挤平A。默认 0 = 全部交给自动补足（想表达「打不到残痕敌人」请用残痕覆盖率）。',
    default: 0,
    min: 0,
    max: 20,
    step: 1,
    suffix: '次',
  },
  {
    id: 'claret.gashCoverage',
    label: '克拉蕾残痕覆盖率',
    description: '命中残痕状态敌人的覆盖率，默认 100%。',
    default: 100,
    min: 0,
    max: 100,
    step: 1,
    suffix: '%',
  },
  {
    id: 'claret.inscriptionBasicTimeShare',
    label: '克拉蕾·猩红铭刻平A时间占比',
    description: '两态平A不是同一套招式（用户口径 2026-09-11）：常态只能打血锻四式（基准 345.21%/s、残痕 100%/s、锐能 3.0/s），猩红铭刻下打锻星（基准 531.88%/s、残痕 120%/s、锐能 0）。**0%（默认）= 由锐能账本推导**：锐能总量 = 进场 60 + 终结技 10/次 → 可进场次数 → 常态补缺口所需秒数（缺口 ÷ 3.0/s）；填 1–100 则按该值手动覆盖。',
    default: DEFAULT_INSCRIPTION_BASIC_TIME_SHARE,
    min: 0,
    max: 100,
    step: 5,
    suffix: '%',
  },
  {
    id: 'claret.chainInWindowCoverage',
    label: '克拉蕾·铭刻窗口内连携占比',
    description: '总额口径（用户 2026-09-11 裁决：不算每窗摊多少连携）：铭刻总时间 = 轮数×16s + 总延长秒，总延长秒 = 连携×2s/次 + (连携+终结)动作时长×本系数。默认 100% = 停表完全不消耗窗口（raw「发动期间，[猩红铭刻]持续时间不再减少」）；若实测停表不满，调低该值即可按比例缩减这部分白送时长。击杀延长（3s/ICD）不建模（单挑 Boss、不算小怪）。',
    default: DEFAULT_CHAIN_IN_WINDOW_COVERAGE * 100,
    min: 0,
    max: 100,
    step: 5,
    suffix: '%',
  },
]

export const claretMechanic: AgentMechanicModule = {
  id: 'agent:claret',
  agentIds: [CLARET_AGENT_ID],
  name: '克拉蕾',
  characterCountInputs: [
    {
      field: 'claretBurialInterruptCount',
      label: '葬血强袭打断',
      title: '打断[特殊技：血华誓·葬血强袭]的次数：在 2.317s 的三连横斩打到一半时打断——**时间与伤害/失衡/喧响都减半**（2.317s→1.1585s、626.3%→313.15%、失衡 382.5→191.25、喧响 70.098→35.049），但**3 次毁伤照常全部触发**（毁伤挂在命中判定上，不随后半段走）。'
        + '入场「斩金断铁·上挑」（153.6%/0.567s）两种结算都完整打。'
        + '为什么是正收益：葬血强袭 DPS（≈270%/s）明显低于[锻星]平A（531.88%/s），省下的 1.1585s/次还给平A是净赚，且平A时间变多 ⇒ 残痕积累变多（锻星 120%/s > 血锻 100%/s）⇒ 毁伤更多。'
        + '操作难度按一次闪避反击（1.2）计，不需要 boss 先出手。',
    },
  ],
  /**
   * CC-258：本角色引擎交互字段的**专属类型名**——打断葬血强袭在难度轴上是一个独立交互类型
   * （不在通用六类里），按「一次闪避反击」权重 1.2 计，公式 `c*w`（不吃非失衡占比修正：
   * 它不需要 boss 先出手，与快支/嘲讽取消同类，见 `teamCompare#BOSS_ATTACK_INTERACTIONS`）。
   */
  interactionFieldTypes: { claretBurialInterruptCount: 'claretBurialInterrupt' },
  /**
   * 轴编辑器「连段」块（用户口径 2026-10-12：「3个招式需要打包，一个是斩金，用来触发1次毁伤。
   * 一个是葬血，用来触发3次毁伤。一个是取消了后半段的葬血，也能触发3次，但时间更短」）。
   *
   * 三个块都用**招式原名**（用户：「用招式原名，附带的毁伤事件另外表现，因为要判断残痕值够不够，
   * 不是说你这个招式就一定能消耗残痕打出毁伤的」）⇒ 毁伤**不进块的 moves**：
   * 它是附带事件，由 `simulateAxisGashTimeline` 按轴内残痕时序判定触发与否。
   *
   * ⚠ 块的 `moves` 只影响**时间/能量**（`roundInputs` 按 moves 求 actionTime），
   *   `energyCost: 0` —— 斩金断铁/葬血强袭都是锐能之外的普通特殊技（消耗强化时间而非能量）。
   * ⚠ 打断版是**独立块**（用户：「你可以把它作为一个单独的招式」），其 `moveId` 是自造键
   *   `claret-burial-interrupted`：它只在轴内出现，由 `expandAxisAction` 展开成真实招式行
   *   （否则引擎找不到该 moveId 的倍率/时间）。
   */
  combos: {
    'claret-cleave': {
      label: '斩金断铁',
      energyCost: 0,
      moves: [{ moveId: CLEAVE_ENTRY_MOVE_ID, count: 1 }, { moveId: CLEAVE_SLASH_MOVE_ID, count: 1 }],
    },
    'claret-burial': {
      label: '葬血强袭',
      energyCost: 0,
      moves: [{ moveId: BLOOD_BURIAL_MOVE_ID, count: 1 }],
    },
    // 打断版：**独立块**（用户 2026-10-12「你可以把它作为一个单独的招式」）。
    // moves 用自造键 ⇒ 走 `expandAxisAction` 展开（时间 = 上挑 + 半段三连斩 = 1.7255s）；
    // 残痕消耗/毁伤触发与完整版**完全一致**（用户：「不变的是，触发3次毁伤的额外事件功能
    // 是在前半段没有被掐断的」）——只是时间更短、伤害/失衡/喧响减半。
    [CLARET_INTERRUPT_BURIAL_BLOCK_ID]: {
      label: '葬血强袭·打断',
      energyCost: 0,
      moves: [{ moveId: CLARET_INTERRUPT_BURIAL_BLOCK_ID, count: 1 }],
    },
  },
  /** 轴内伪块展开（打断版葬血强袭 → 真实招式行 + 折算时长） */
  expandAxisAction: expandClaretAxisAction,
  /**
   * **毁伤 = 附带事件**（用户口径 2026-10-12）：「就是我的特殊技可以触发毁伤，藏血强袭的
   * 前一段可以触发3次毁伤」。
   *
   * 登记父动作 → 毁伤子行，让毁伤吃**触发它的那一招**的轴内易伤占比（与般岳影画6 摧岳附伤同口径）：
   *   · 斩金断铁的**横斩**（1611012）触发 1 次（原文「横向斩击命中持有[残痕]的敌人时，对目标
   *     触发[毁伤]」——⚠ 是**横斩**不是上挑；上挑只积累不触发）；
   *   · 葬血强袭（1611014）的三连横斩触发至多 3 次（原文「每次横向斩击命中…最多可以连续触发3次」）。
   *
   * ⚠ 毁伤**不是**「捏了块就一定出」——够不够消耗由 `simulateAxisGashTimeline` 按轴内残痕时序判定
   *   （用户：「因为要判断残痕值够不够，不是说你这个招式就一定能消耗残痕打出毁伤的」）。
   *   本声明只解决「触发时吃谁的易伤占比」。
   */
  attachedEvents: {
    [CLEAVE_SLASH_MOVE_ID]: [MAIM_MOVE_ID],
    [BLOOD_BURIAL_MOVE_ID]: [MAIM_MOVE_ID],
  },
  description: 'v12：锐化伤害积累残痕值（每600点=1层，上限3），毁伤按层数结算——滑块的斩金断铁/葬血强袭先扣、剩余层数自动由葬血强袭打完（不设次数上限，约束是时间）；葬血强袭可打断（数值减半但毁伤照常 3 次）；锐能进场60/秘血铸锋60发；核心被动暴击率+30%与残锋锐暴+25%；影画1锐暴积蓄+20%与毁伤×130%、2铭刻+2s与电抗无视18%、4+20%、6直接毁伤。',
  applyPanel: applyClaretPanel,
  buildCharConfig: buildClaretCharConfig,
  buildExecutions: buildClaretExecutions,
  patchExecutions: patchClaretExecutions,
  buildResourceResult: buildClaretResourceResult,
  resourceSections: buildClaretResourceSections,
  settings,
}

/**
 * D2（CC-359）：本模块私有的 cfg 字段——只有本文件读写，声明随模块走，不再堆在 `types/resource/config.ts`。
 * 仍是 `CharacterOperationConfig` 的成员（模块扩充，纯类型、零运行时）；被第二处引用时请迁回公共接口。
 */
declare module '@/types/resource/config' {
  interface CharacterOperationConfig {
    /** 技能表缓存：buildCharConfig 写，供 computeClaretBasicPerSecFromCfg 现算两套基准 */
    claretSkills?: AgentSkills
    /** 各招式「割伤」值（moveId → 值，只收 >0） */
    claretGashByMoveId?: Record<string, number>
    /** 「致残」伤害倍率（技能表，缺省 1625.6） */
    claretMaimDamageMultiplier?: number
    /** 常态平A基准段 moveId（catalog basicBenchmarkMoveId 优先，回落第 3 段） */
    claretNormalBenchmarkMoveId?: string
    /** 铭刻态基准段 moveId（常量 INSCRIPTION_BENCHMARK_MOVE_ID） */
    claretInscriptionBenchmarkMoveId?: string
    /** 锐度自然回复/秒（level60.sharpnessRegen） */
    claretSharpnessAutoPerSec?: number
    /** 常态平A基准段的锐度获取/秒 */
    claretNormalAttackSharpnessPerSec?: number
    /** 常态锐度/秒（取 claretSharpnessAutoPerSec） */
    claretNormalSharpnessPerSec?: number
    /** 连携技动作时长（秒） */
    claretChainActionSeconds?: number
    /** 终结技动作时长（秒） */
    claretUltimateActionSeconds?: number
    /** 铭刻态占比（机制设置，夹到 0–1） */
    claretInscriptionShareSetting?: number
    /** 连携技落在窗口内的覆盖率 */
    claretChainInWindowCoverage?: number
    /** 两态加权后的平A失衡/秒 */
    claretBasicDazePerSec?: number
    /** 常态平A伤害倍率/秒 */
    claretNormalDamagePerSec?: number
    /** 铭刻态平A伤害倍率/秒 */
    claretInscriptionDamagePerSec?: number
    /** 克拉蕾秘血铸锋（锐能强特）单次动作时长（秒，倍率表） */
    claretExActionTime?: number
    /** 克拉蕾秘血铸锋（锐能强特）单次喧响回复（倍率表行） */
    claretExDecibelRecovery?: number
    /** 克拉蕾葬血强袭基础伤害倍率（倍率表 1611014 damage 行） */
    claretBloodBurialDamageMultiplier?: number
    /** 葬血强袭（1611014）失衡/喧响表值——融合行需显式覆盖，见 `claretCleaveEntryDamage` */
    claretBloodBurialDaze?: number
    claretBloodBurialDecibel?: number
    /** 葬血强袭入场段「斩金断铁·上挑」（1611011）时长（秒，catalog actionTime；缺省 `CLEAVE_ENTRY_SECONDS`） */
    claretCleaveEntrySeconds?: number
    /** 葬血强袭三连横斩段（1611014）时长（秒，catalog actionTime；缺省 `BURIAL_SECONDS`） */
    claretBurialSeconds?: number
    /** 葬血强袭入场段「斩金断铁·上挑」（1611011）的伤害/失衡/喧响表值（融合发行用） */
    claretCleaveEntryDamage?: number
    claretCleaveEntryDaze?: number
    claretCleaveEntryDecibel?: number
    /** 葬血强袭打断次数（交互栏 `claretBurialInterruptCount` 的 cfg 镜像） */
    claretBurialInterruptCount?: number
    /** 克拉蕾命座等级（用于二命锐能额外回复） */
    claretCinemaLevel?: number
  }
}

/**
 * D2（CC-359/360）：本模块私有的结果字段——只有本文件读写，声明随模块走，不堆在 `types/resource/agentResources.ts`。
 * 仍是 `CharacterResourceResult` 的成员（模块扩充，纯类型、零运行时）；被第二处引用时请迁回公共接口。
 */
declare module '@/types/resource/agentResources' {
  interface CharacterResourceResult {
    /** 克拉蕾残痕/锐能资源明细 */
    claretSharpResourceSource?: ClaretSharpResourceSource
  }
}

// ===== 本模块私有的结果类型（D2 / CC-360：原在 types/resource/agentResources.ts，只有本文件引用）=====

/** 克拉蕾残痕/锐能资源明细（v12 口径 2026-09-03） */
export interface ClaretSharpResourceSource {
  /** 残痕值来源（%）：平A（两态秒均×时间）+ **其余全部招式**（实打次数 × `gash_buildup` 表值），已 × 积蓄效率 */
  gashValuePct: number
  /** 其中平A 贡献（%）——两态基准秒均 × 平A时间 × 积蓄效率 */
  basicGashValuePct?: number
  /** 其中「其余招式」贡献（%）= Σ 实打次数 × 该招 gash_buildup 表值 × 积蓄效率 */
  moveGashValuePct?: number
  /** 残痕积蓄效率倍率 = 1 + 核心被动 50%（Lv7，猩红铭刻期间近似常驻）+ 影画1 20%（锐暴命中近似常驻；★R55 订正，旧写「影画2」是两档互换） */
  gashBuildupMultiplier: number
  /** 残痕层数 = floor(残痕值 / 100)，上限 3 层（溢出浪费） */
  gashStacks: number
  /** 反制支援送层数（= 整组化解的控制技组数）：琢形「重击命中**直接**添加1层[残痕]」，
   *  每组 +600 点且**不吃积蓄效率倍率**（用户口径 2026-09-12）；0 = 本次计算没有反制支援。 */
  counterAssistGashStacks?: number
  /** 血华誓毁伤需求**段数**（斩金断铁×1 + 葬血强袭×3/次 + 影画6 连携/终结各1）——**展示用总量**。
   *  按「招式段数」算（葬血强袭每次 3 段）；`gashStackConsumed` 按「层数」算，自动补足那发部分消耗时两者会差几层。
   *  ⚠ 不等于层预算：影画6 原文「不消耗[残痕]」⇒ 层预算只含斩金断铁/葬血强袭（R54 修正）。 */
  maimDemand: number
  /** 实际消耗的残痕层数 = 斩金断铁消耗 + 葬血强袭（声明+自动补足）消耗，已 × 覆盖率。
   *  ★ 2026-10-09 起**不再被滑块封顶**——滑块声明的那几次先扣，剩余层数一律由葬血强袭打完；
   *  层预算**不含**影画6（它不消耗残痕，R54）。 */
  gashStackConsumed: number
  /** 触发毁伤次数 = 消耗残痕层数 + 影画6 不消耗残痕的单体毁伤 */
  maimCount: number
  /** 斩金断铁触发的毁伤数 */
  maimFromCleave: number
  /** 葬血强袭触发的毁伤数（含自动补足的那些次） */
  maimFromBurial: number
  /** 影画6 连携/终结重击直接触发的单体毁伤数（不消耗残痕） */
  maimFromC6: number
  /** **葬血强袭实际结算次数** = 滑块声明 + 自动补足（剩余层数 ÷ 3 向上取整）。
   *  引擎按它发行行（伤害/失衡/喧响/时间）——用户口径 2026-10-09「剩下的自动用葬血强袭打完」。 */
  burialCastsSettled: number
  /** 其中**自动补足**的次数（= `burialCastsSettled` − 滑块声明值），用于资源卡展示「自动 ×N」 */
  autoBurialCasts: number
  /** 参与锐能账本的终结技次数（锐能额外来源 10/次） */
  ultimateCount: number
  /** 平A伤害秒均（%）＝常态基准 345.21 与铭刻基准 531.88 按铭刻时间占比加权 */
  basicDamagePerSec: number
  /** 平A失衡秒均（%）＝两态基准同法加权 */
  basicDazePerSec: number
  /** 平A残痕积累秒均（%）＝血锻 100/s 与锻星 120/s 同法加权（catalog `gash_buildup` 行） */
  basicGashPerSec: number
  /** 铭刻平A时间占比 0–1（账本推导或面板滑块覆盖） */
  inscriptionBasicTimeShare: number
  /** 占比来源：ledger = 由锐能账本推导（默认）；manual = 面板滑块覆盖 */
  inscriptionBasicTimeShareSource: 'ledger' | 'manual'
  /** 常态锐能产出合计（/s）= 自动累积（接战时间基准）+ 血锻招式增益 */
  normalSharpnessPerSec: number
  /** 锐能基础自动累积（/s，catalog `level60.sharpnessRegen`） */
  sharpnessAutoPerSec: number
  /** 常态血锻四式的锐能招式增益（/s，catalog `sharpness_gain` 列） */
  normalAttackSharpnessPerSec: number
  /** 账本推导出的常态平A时间（秒）＝轮数 × 攒能秒数 */
  normalBasicTimeNeeded: number
  /** 铭刻平A时间（秒）＝轮数 × 单窗时长 + 总延长秒 */
  inscriptionBasicTime: number
  /**
   * **单窗**基础时长（秒）：raw 基础 16s；**影画2「最大持续时间延长2秒」⇒ 18s**（★ R55 建模）。
   * ⚠ 与 `inscriptionWindowSeconds` 区分：那个是**总延长秒**（连携×2s + 停表白送），这个是**每轮窗口本身**。
   */
  inscriptionWindowSecondsPerEntry: number
  /** 本结果的命座档（影画2 起单窗 +2s，展示层据此标注） */
  cinemaLevel: number
  /** 账本推导出的铭刻平A时间占比（面板未覆盖时的口径，供展示对照） */
  derivedInscriptionTimeShare: number
  /** 平A时间能支撑的进场轮数（常态攒能 → EX 进场 → 铭刻窗口），= EX 发数 */
  inscriptionEntries: number
  /** 全局总延长秒（连携×2s + 停表白送时长）——总额口径一次性加到铭刻总时间 */
  inscriptionWindowSeconds: number
  /** 自动累积的时长基准 = 接战时间（秒，前后台都回；用户口径 2026-09-11） */
  combatTime: number
  /** 单次进场锐能成本（60） */
  sharpnessPerEntry: number
  /** 锐能总量 = 进场 60（勘域 180s 一次）+ 终结技 ×10（单次上限不参与总量口径） */
  sharpnessGain: number
  /** 锐能可负担的秘血铸锋次数 = floor(锐能 / 60) */
  affordableExCount: number
  /** 锐能消耗（秘血铸锋 60/次） */
  sharpnessSpend: number
  sharpnessRemaining: number
  note: string
}
