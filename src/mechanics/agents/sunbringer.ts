import type {
  AgentCharConfigInput,
  AgentMechanicModule,
  AgentNextRoundFeedbackInput,
  AgentPanelInput,
  AgentResourceInput,
  AgentResourceResultInput,
  AgentResourceSectionsInput,
  AgentTeamConfigInput,
  ModuleFeedback,
} from '../types'
import type { CharacterResourceResult } from '@/types/resource/agentResources'
import { getRowValue } from '@/data/moveTableQueries'
import { effectiveCombatTime } from '@/core/effectiveTime'
import { cinemaLevelOf } from '@/data/cinemaLevel'
import { moduleExecRow, RECOVERY_OFF, ENERGY_RECOVERY_OFF } from '@/mechanics/moduleExecRow'
import { allocateBossGashPool, GASH_PER_LAYER, GASH_MAX_STACKS, collectSharpenGashClaims, collectTeamMaimMultiplier, resolveTeamGashPool } from '@/mechanics/gashMaim'
import { SHARPNESS_INITIAL, sharpnessIncome } from '@/mechanics/sharpnessIncome'
import { fmt } from '@/utils/format'
import { mechanicSettingReader } from '@/utils/mechanicSettingCfg'
import type { MechanicSetting } from '@/types/resource'

/**
 * 挽昼（1601·锋御/燎原）——测试服角色（`Test1` 占位包起，**3.4.3+20278274** 重录），2026-10-25 第二刀 = **六条资源循环**。
 *
 * ## 面板层（已接线）
 * - 初始暴伤 → 初始暴击率：每 1% 初始暴伤 +0.35%（整 1% floor、只读局外面板，克拉蕾同口径）。
 * - 极昼：暴击率 +40、造成伤害无视目标 20% 防御力（15s 状态，后场不减 + 强特/聚锋刷新）；
 *   debt: 状态机未建模（满覆盖近似），等引擎有逐事件时间通道后落真窗口（DEBT_REGISTRY 已登记）。
 *
 * ## 资源循环（本文件 `buildExecutions`，口径逐条来自用户 2026-10-25 裁决）
 * | 环节 | 口径 | 数据来源 |
 * |---|---|---|
 * | 锐能 | 进场 +60；自动 1.5/s；强化特殊技 **30/发** | raw「锐能消耗 30点」×3 行；catalog `level60.sharpnessRegen` |
 * | 残痕 | 招式级 `gash_buildup` 积累（平A 秒均 + 强特 + 连携 + **招架支援** + **支援突击 ×1.15**），**600 点 = 1 层**，存量 ≤3 | catalog gash 行（gachabase 补入）+ gachabase 1601206/7/8 |
 * | 毁伤 | 重击消耗层（每层 1 次），**伤害 = moveId 1601114（Lv12 336.3%）** | 3.4.1+19850203 热更新增行 |
 * | 愿力 | 每层 +40（上限 160）⇒ **每 3 层 = 1 次聚锋**（120） | raw 核心被动 Lv.7 |
 * | 链齿/旗令 | 每次聚锋各 +1；链齿 → 长暗终焉；**旗令优先终结技·此行共赴前路**（永昼之炬按 0 次） | 用户裁决 2026-10-25 |
 * | 愿核 | 终结技 A 消耗 1 旗令 → 1 愿核 → 解除 B（此愿，重塑万象） | raw |
 * | 烬痕 | **5 个积攒招式**（聚锋/长暗终焉/永昼之炬/两个终结技）**实际伤害的 60%**（3.4.3 核心被动）+ **全队[毁伤]实际伤害的 35%**（3.4.3 新增来源），存下来就是**固定数值**——不吃失衡易伤、不吃任何属性；B/永昼之炬的终结一击清空时等量计入总伤害 | raw 3.4.3+20278274 + 用户裁决 2026-10-25（"存下来的数字已经固定死了"） |
 *
 * ## 建模取舍（都写在行名/注释里，便于复核）
 * - **次数上限靠时间**：模块按 `combatTime` 顺序分配预算（EX → 聚锋 → 长暗终焉），超预算就少打；
 *   不挤平A 的秒数由折叠环自己收敛（与克拉蕾葬血强袭同款）。
 * - **终结技可行性**用 `floor(totalDecibel / ultimateCost)` 封顶（引擎对 1601 没有 ultimate 行 ——
 *   两个终结技的 `skillType` 都没标 ultimate）；两条终结技行一律 `RECOVERY_OFF`，不回填喧响，避免虚增。
 *   ⚠ 该封顶只约束**一段**（喧响大）；**二段由 [愿核] 购买、不耗喧响**（轴内见模块能力
 *   `axisMoveFreeOfDecibel` + `axisSwayFlow`，用户口径 2026-10-31）。
 * - 毁伤**不进时间**（附带事件，actionTime 0）；烬痕均摊到每次 B 的倍率上。
 * - 影画 1/2 已实现（C1：残痕效率 ×1.1 + 进战 120 愿力 + 15% 火抗；C2：烬痕积攒 ×1.2 + 其他招式 15%），
 *   C4/C6 走面板与烬灭，C3/C5 只是技能等级。
 */
const SUNBRINGER_AGENT_ID = '1601'

const cfgSetting = mechanicSettingReader(() => settings)

/** 每 1% 初始暴击伤害 → 初始暴击率（核心被动 Lv.7） */
export const INITIAL_CRIT_DMG_TO_CRIT_RATE = 0.35
/** 极昼：暴击率 +40（满覆盖近似） */
export const POLAR_DAY_CRIT_RATE = 40
/** 极昼：造成伤害无视目标 20% 防御力（满覆盖近似） */
export const POLAR_DAY_DEF_IGNORE = 20
/**
 * 锐能：进场 +60（勘域 180s 一次 ⇒ 每局一次）。
 *
 * ⚠ 进场基数**不在本文件定义**——单一事实源 = `mechanics/sharpnessIncome#SHARPNESS_INITIAL`
 * （规则 11：改造前本文件与 `claret.ts` 各抄一份字面量 60）。本行 re-export 保持既有 import 路径不变。
 */
export { SHARPNESS_INITIAL }
/** 锐能：强化特殊技单发消耗（raw「锐能消耗 30点」） */
export const SHARPNESS_COST_PER_EX = 30
/** 愿力：每消除 1 层残痕 +40，上限 160 */
export const WISH_PER_MAIM = 40
export const WISH_MAX = 160
/** 愿力：一次聚锋消耗 120 */
export const JU_FENG_WISH_COST = 120
/**
 * 烬痕·核心来源（**3.4.3+20278274** 核心被动）：5 个积攒招式按实际伤害的 **60%** 累积。
 * 沿革：3.4.1 = 75%、v2（3.4.2+20049556）= 65%、v3（3.4.3）= **60%**。
 */
export const EMBER_SCAR_RATE = 0.6
/**
 * 烬痕·第二条来源（**3.4.3 新增**，原文逐字）：「全队代理人造成的[毁伤]也可使目标积攒
 * 等同于该次实际伤害 **35%** 的[烬痕]」。
 *
 * 落点 = 本模块自己产出的毁伤行（`meta.maim.damage × maimCount`）× 35%，与核心来源相加后再吃影画2 的 ×1.2
 * （影画2 原文是「使敌人积攒的[烬痕]量提升 20%」，对两条来源一视同仁 —— 与 2026-11-01 对「其他招式 15%」的
 * 裁决同口径）。⚠ 队友（其它锋御）打出的毁伤伤害本仓库没有通道（毁伤伤害不是跨槽可读量）⇒ 只算自己的，
 * 缺口写在 spec 1601 的「未建模」段（debt：跨槽毁伤伤害通道）。
 */
export const EMBER_SCAR_MAIM_RATE = 0.35
/** 影画2：使敌人积攒的[烬痕]量提升 20%（v2 文本） */
export const EMBER_SCAR_C2_BONUS = 0.2
/** 影画2：其他招式（除 5 个积攒招式外）按实际伤害 15% 也积攒（v2 文本） */
export const EMBER_SCAR_OTHER_RATE = 0.15
/** 影画6：终结技额外一次[烬灭] = 该次终结技积攒[烬痕]量的 150%（v2 文本） */
export const EMBER_SCAR_C6_EXTRA_MULT = 1.5
/** 影画1：残痕积蓄效率 +10%（v2 文本）；灯塔白送的整层不吃此效率 */
export const SUNBRINGER_C1_GASH_EFFICIENCY = 1.1
/**
 * **[支援突击]残痕积蓄效率 +15%**（nanoka 3.4.1+19997538，与下面 `PARRY_ASSIST_DAZE_BONUS` 同一句原文）：
 * > 「德蕾琪娜发动[招架支援]造成的失衡值提升50%，**艾尔妲与林德薇恩发动的[支援突击]残痕积蓄效率提升15%**，
 * >  造成的伤害提升20%」
 *
 * 落点 = 招架后紧跟的那一发**支援突击**（`cfg.assistFollowUpMoveId`）表值 ×1.15。为什么只这一招：
 * 原文点的是「[支援突击]」这一招族，快速支援（Quick Assist）不在句内。
 *
 * **外部实录判据**（用户 2026-11-10 提供的 8 场 M0/M2 逐招 gash 回放，gachabase 回放口径）：
 * 同一场里支援突击两条（1601013 坚定信仰 / 1601113 不灭的热情）的 rate = **1.15**，
 * 而普攻/连携/EX/冲刺/闪避反击/快速支援 全部 1.00；M2 场（+10% 来自 `Sunbringer_Talent_01` = 影画1）
 * 它们变成 **1.25 = 1.15 × 1.10**、其余招式 1.10 ⇒ 两个效率因子**同处连乘、互不替代**
 * （这条也反过来证明「rate 是残痕唯一的乘算通道」：除此之外没有第二个因子会变）。
 * 反算：1601013 的合计表值 186.98（= gachabase 18698 ÷100）⇒ 实录单段 19.55 = 17.00 × 1.15（逐段取整，合计差 0.02）。
 *
 * ⚠ 与 `SUNBRINGER_C1_GASH_EFFICIENCY` 相乘，且两者**都只在「积累括号」里**（见 `gash` 表达式）；
 *   灯塔白送的整层仍然不吃任何效率。
 */
export const SUNBRINGER_ASSIST_FOLLOW_UP_GASH_EFFICIENCY = 1.15
/**
 * **[支援突击]造成的伤害 +20%**（与上面 15% 同一句原文的后半；用户裁决 2026-11-10 逐字：
 * 「增伤肯定做啊，挽昼关键机制就在于这个，预计一局弹刀很多次」）。
 *
 * 落点 = **招式限定**的增伤区（执行行 dmgBonus += 20），不是全局面板：
 * 原文点的只是 [支援突击] 那一行，写 panel.dmgBonus 会让她的强特/连携/终结一起吃到，
 * 与「招式限定」不符（同一取向的先例：柚叶 1411 影画4 patchYuzuhaExecutions）。
 *
 * ⚠ 次数 = parryCount（引擎按它产支援突击行），所以这条在「一局弹刀很多次」的配装里权重很大——
 *   这正是用户要求必须建模的理由。
 * ⚠ 反制支援的专属追击（灯塔 1601205）**不**吃这条：原文说的是艾尔妲与林德薇恩发动的[支援突击]，
 *   灯塔走 counterAssists.ts 的融合行（moveId = 1601204），行级门控天然分开。
 */
export const SUNBRINGER_ASSIST_FOLLOW_UP_DMG_BONUS = 20
/**
 * **招架+支援突击的自合轴率**默认值（%，用户裁决 2026-11-10）。
 *
 * 原文机制：挽昼的[招架支援]可以**自己接自己**、且不打断已有招式 ⇒ 她的合轴率能作用在**自己身上**，
 * 让同一段时间里多打招式。用户口径：「实现就是加个滑块叫做招架+支突的合轴率，默认60%，
 * 这样削减自身招架的耗时，流出更多时间给挽昼平a」。
 *
 * 落点 = cfg.defensiveAssistComboAlignRatio / cfg.assistFollowUpComboAlignRatio（同一滑块的同一个值）：
 * 这两个字段既是 rowBuild 产行的 comboAlignRatio 来源，也是时间账 comboAlignGeneric 抵扣项的来源
 * （core/resource/helpers.ts）⇒ 行与账本同源，不会犯 CC-454「行上写了比例但账本没读」的死数据病。
 */
export const SUNBRINGER_PARRY_COMBO_ALIGN_DEFAULT = 60
/**
 * **[招架支援]残痕**：每成功招架 1 次给 Boss 池加多少点（3.4.3+20278274 新增句「德蕾琪娜成功招架敌人
 * 的攻击时，可为敌人积累残痕值」）。
 *
 * ## 为什么是模块常量而不是 catalog 行（二选一的依据）
 * 数值在 gachabase `data/raw/gachabase/1601.json` 的 **1601206 / 1601207 / 1601208** 三行
 * （`animator_event` = ParryAid_L / ParryAid_H / ParryAid_…，即轻 / 重 / 连续三档），
 * `gash_buildup` = 5664 / 9914 / 9914，除以 100 得 **56.64 / 99.14 / 99.14**（与 base 网页显示值一致）。
 *
 * ⚠ **不走 `scripts/upsert-gachabase-rows.mjs`，也不硬塞进 catalog 的 1601201/2/3**，三条理由：
 *   ① 1601206/7/8 在 catalog 里**不是 move**（没有 damage/daze/actionTime，只有 gash 一列）——
 *      upsert 脚本按 moveId 逐条对齐，它们对不上任何 move；
 *   ② 想让脚本落进 catalog，就得造一张**跨 id 别名表**（1601206→1601201…）。那张表的依据是
 *      「ParryAid_**L** = **轻**招架」这条**推断**（L/H 与 轻/重 同名族，但没有共同的显式 key）——
 *      把推断写进 catalog 会让它变成「数据事实」，而 catalog 是数值唯一事实源（规则 2），
 *      不该装推断；
 *   ③ 常量 + `data/raw` 引用 + **钉值测试**（`sunbringerParryGash.test.ts` 直接读 raw 对拍）= 可复核、
 *      raw 一变测试就红，与 `handCopiedConstants.test.ts` 的 T129 反推单价同一手法。
 *
 * ## 哪一档
 * 由**引擎选中的那条**招架支援行决定（`cfg.defensiveAssistMoveId`，来自 `moveLookup#findDefensiveAssist`：
 * 优先 en 含 `#1`，否则取 min-id ⇒ 挽昼取 **1601201 轻招架**）。模块不自己猜档、也不列 id 名单——
 * 只把「引擎选中的 moveId」翻译成点数值；引擎换档，数值自动跟着换。
 *
 * ⚠ 吃掉影画1 的 ×1.1 积蓄效率：与 basic/ex/chain 三条积累来源**在同一处乘**（见 `gash` 表达式），
 *   因为原文说的是「积累残痕值」——它是**积累**，不是灯塔那种「直接添加」层。
 */
export const SUNBRINGER_PARRY_GASH_BY_ASSIST_MOVE_ID: Readonly<Record<string, number>> = {
  /** 1601201 轻招架 ← gachabase 1601206 ParryAid_L，gash 5664/100 */
  '1601201': 56.64,
  /** 1601202 重招架 ← gachabase 1601207 ParryAid_H，gash 9914/100 */
  '1601202': 99.14,
  /** 1601203 连续招架 ← gachabase 1601208，gash 9914/100 */
  '1601203': 99.14,
}
/**
 * [招架支援]造成的失衡值提升 50%（nanoka **3.4.1+19997538** 新包新增的一句，3.4.1+19850203 及更早没有）：
 * > 「德蕾琪娜发动[招架支援]**造成的失衡值提升50%**，艾尔妲与林德薇恩发动的[支援突击]残痕积蓄效率提升15%，
 * >  造成的伤害提升20%」
 * 落点 = **自身招架行（轻/重/连续三行）的 daze 倍率 ×1.5**，经 `dazeMultiplierOverride` 精确结算
 * （与琥珀 1272 影画4「招架支援失衡 +25%」同款，见 seth.ts#patchSethExecutions——引擎取哪一段
 * 由 `findDefensiveAssist` 决定，故三行一起放大，不押注引擎选哪一行）。
 */
export const PARRY_ASSIST_DAZE_BONUS = 50
/**
 * 耗能 30 的强化特殊技代表行 = 焚夜·曦生（1601106）。
 * 燃灯·晦尽（1601006，at 2.433）与它是**多形态对称数据**（收益公式相同，用户 2026-10-27
 * 「两段耗能 30 的 e 只需考虑一个」）⇒ 只走这一条线，不再另开。
 */
export const SUNBRINGER_EX_MOVE_ID = '1601106'

/** 招式元数据缓存（buildCharConfig 写，buildExecutions 读；单一来源 = 倍率表） */
interface SunbringerMoveMeta {
  moveId: string
  actionTime: number
  damage: number
  daze: number
  decibel: number
  gash: number
  sharpness: number
}
interface SunbringerMeta {
  basic: { damagePerSec: number; gashPerSec: number; sharpPerSec: number }
  ex: SunbringerMoveMeta
  jufeng: SunbringerMoveMeta
  changan: SunbringerMoveMeta
  /** 强化特殊技：燃灯·永昼之炬（消耗[旗令]；2026-10-27 补录，见 solveSunbringerLoops 的旗令分配） */
  torch: SunbringerMoveMeta
  ultA: SunbringerMoveMeta
  ultB: SunbringerMoveMeta
  maim: SunbringerMoveMeta
  chain: SunbringerMoveMeta
  /**
   * 招架后紧跟的那一发**支援突击**（引擎 `findAssistFollowUp` 选中的 `cfg.assistFollowUpMoveId`）。
   * 残痕来源之一（表值 × `SUNBRINGER_ASSIST_FOLLOW_UP_GASH_EFFICIENCY`，见 `solveSunbringerLoops`）。
   * 缺省（该角色没有支援突击 / 引擎没解析到）⇒ 这条来源本局不发生，其余来源不受影响。
   */
  assistFollowUp?: SunbringerMoveMeta
  sharpnessRegen: number
}

/**
 * 本局循环解的完整形状 = `solveSunbringerLoops` 的返回（单一事实源：函数改字段，类型自动跟随）。
 * 资源卡（`resourceSections`）只读它——展示层不许自己重算（见 `sunbringerLoopSource` 注释）。
 */
export type SunbringerLoop = ReturnType<typeof solveSunbringerLoops>

declare module '@/types/resource/agentResources' {
  interface CharacterResourceResult {
    /**
     * 挽昼对**团队残痕池**的申报（双锋御队；单锋御时无人读）。
     * 形状由 `gashMaim#SharpenGashClaimLike` 约束（结构子类型，无 import 耦合）。
     */
    sunbringerGashSource?: { points: number; demandLayers: number; gashLayers?: number; maimCount?: number }
    /**
     * **本局循环解**（残痕/毁伤/愿火/链齿/旗令/愿核/锐能 全部读数）：资源卡唯一数据源。
     * 由 `buildResourceResult` 每轮写入（与 `sunbringerGashSource` 同一个 `solveSunbringerLoops` 结果）。
     */
    sunbringerLoopSource?: SunbringerLoop
  }
}

declare module '@/types/resource/config' {
  interface CharacterOperationConfig {
    /** 挽昼招式元数据（本模块私有） */
    sunbringerMeta?: SunbringerMeta
    /** 命座等级（buildCharConfig 写；影画1/2 分支用） */
    sunbringerCinemaLevel?: number
    /** 招架支援行 moveId → 已 ×1.5 的失衡值（buildCharConfig 预存；见 PARRY_ASSIST_DAZE_BONUS） */
    sunbringerParryDazeById?: Record<string, number>
    /**
     * **队友锋御的[毁伤]累计倍率**（`gashMaim#collectTeamMaimMultiplier`，排除自己那份）。
     * 写入方 = `sunbringerNextRoundFeedback`（`ModuleFeedback.sunbringerTeamMaimMultiplier`）→
     * `applySunbringerTeamConfig` 的 converge 相位写本字段；消费方 = `computeEmberScar`。
     * 缺省 0 = 无队友锋御 ⇒ 与接线前逐位不变。
     */
    sunbringerTeammateMaimMultiplier?: number
  }
}

export function applySunbringerPanel({ panel, outOfCombatPanel, cinemaLevel }: AgentPanelInput): void {
  // 核心被动·初始转化：只读局外面板，整 1% floor（与克拉蕾同口径）
  const initialCritDmg = outOfCombatPanel.critDmg
  if (initialCritDmg > 0) {
    panel.critRate = panel.critRate + Math.floor(initialCritDmg + 1e-9) * INITIAL_CRIT_DMG_TO_CRIT_RATE
  }
  // 极昼：满覆盖近似（见文件头）
  panel.critRate = panel.critRate + POLAR_DAY_CRIT_RATE
  panel.enemyDefIgnoreDirect = panel.enemyDefIgnoreDirect + POLAR_DAY_DEF_IGNORE
  // 影画1（隐世的虚狩）：造成伤害无视 15% 火属性抗性（满覆盖）；「残痕积蓄效率 +10%」在 solveSunbringerLoops
  // 「发动招式造成的伤害无视敌人 15% 火抗」⇒ 自身直伤族（异常读不到）
  if (cinemaLevel >= 1) panel.enemyFireResIgnoreDirect = panel.enemyFireResIgnoreDirect + 15
  // 影画2（继承者的叛旗）v2 文本 = 烬痕积攒（+20% / 其他招式 15% / 击溃）——**不再是无视 12% 防御**
  //   （旧文本 3.4.1+19850203 的「无视 12% 防御」随 v2 删除；烬痕侧在 computeEmberScar）
  // 影画4（奉献者的虚像）：自身造成的伤害 +15%（满覆盖）
  if (cinemaLevel >= 4) panel.dmgBonus = panel.dmgBonus + 15
  // 影画6（破晓的希冀）：招式造成伤害无视目标 20% 防御力（满覆盖；额外[烬灭]在 computeEmberScar）
  if (cinemaLevel >= 6) panel.enemyDefIgnoreDirect = panel.enemyDefIgnoreDirect + 20
}

export function buildSunbringerCharConfig({ cfg, skills, agent, cinemaLevel }: AgentCharConfigInput): void {
  cfg.sunbringerCinemaLevel = cinemaLevel
  // 影画4（奉献者的虚像）：进入战场立刻获得 1000 点喧响值（勘域 180s 一次 ⇒ 每局一次）
  if (cinemaLevelOf(cinemaLevel) >= 4) cfg.initialDecibelGift = cfg.initialDecibelGift + 1000
  const all = skills.categories.flatMap(c => c.moves)
  const metaOf = (id: string): SunbringerMoveMeta => {
    const m = all.find(x => x.id === id)
    return {
      moveId: id,
      actionTime: m?.actionTime ?? 0,
      damage: getRowValue(m, 'damage'),
      daze: getRowValue(m, 'daze'),
      decibel: getRowValue(m, 'decibel_recovery'),
      gash: getRowValue(m, 'gash_buildup'),
      sharpness: getRowValue(m, 'sharpness_gain'),
    }
  }
  const basicId = agent.basicBenchmarkMoveId ?? '1601003'
  const basic = metaOf(basicId)
  const perSeconds = (v: number) => (basic.actionTime > 0 ? v / basic.actionTime : 0)
  cfg.sunbringerMeta = {
    basic: {
      damagePerSec: perSeconds(basic.damage),
      gashPerSec: perSeconds(basic.gash),
      sharpPerSec: perSeconds(basic.sharpness),
    },
    ex: metaOf('1601106'),
    jufeng: metaOf('1601015'),
    changan: metaOf('1601107'),
    torch: metaOf('1601007'),
    ultA: metaOf('1601111'),
    ultB: metaOf('1601011'),
    maim: metaOf('1601114'),
    chain: metaOf('1601110'),
    // 招架后的支援突击（残痕 +15% 的载体）：moveId 由**引擎**解析（`core/resource/moveLookup#findAssistFollowUp`），
    // 模块只把 moveId 翻成表值——与招架档位同一个取向（不列 id 名单，换档换招数值自动跟着走）。
    ...(cfg.assistFollowUpMoveId ? { assistFollowUp: metaOf(cfg.assistFollowUpMoveId) } : {}),
    sharpnessRegen: agent.level60.sharpnessRegen ?? 0,
  }
  // 招架+支援突击的**自身合轴率**（用户裁决 2026-11-10）：两个字段共用一个滑块值——她的招架能自己接
  // 自己、不打断已有招式，所以合轴率作用在自己身上，削减这两段的实际耗时、把时间让回平A 池。
  // ⚠ 写的是**时间账真正读的那两个 cfg 字段**（不是只在行上写 comboAlignRatio）：行与账本同源，
  //   否则就是 CC-454 的死数据（core/__tests__/comboAlignLedgerInvariant.test.ts 会当场标红）。
  const parryAlign = Math.max(0, Math.min(100, cfgSetting(cfg, 'sunbringer.parryComboAlign'))) / 100
  cfg.defensiveAssistComboAlignRatio = parryAlign
  cfg.assistFollowUpComboAlignRatio = parryAlign
  // 招架支援失衡 +50%（3.4.1+19997538 新增）：按**表值**预缩，patchExecutions 里打 override。
  // 认行口径 = 本角色的「招架支援」行（原文点的是德蕾琪娜的招架，即挽昼自己的招架段），
  // 不列 moveId 名单——角色自己的表结构变了也不会漏（规则 6 的同一取向：按数据认行）。
  const parryMoves = all.filter(m => m.skillType === 'assist' && /招架支援/.test(m.name.zhCN ?? ''))
  if (parryMoves.length > 0) {
    cfg.sunbringerParryDazeById = Object.fromEntries(parryMoves.map(m => [
      m.id,
      Math.round(getRowValue(m, 'daze') * (1 + PARRY_ASSIST_DAZE_BONUS / 100) * 1000) / 1000,
    ]))
  }
}

/**
 * 六条循环的**唯一求解入口**（executions 与测试都读它）：按时间预算顺序分配次数，
 * 口径见文件头表格。返回值为「本局各段次数 + 中间池」，全部为可展示/可断言的纯数。
 */
export function solveSunbringerLoops(input: {
  meta: SunbringerMeta
  combatTime: number
  basicTime: number
  chainCount: number
  totalDecibel: number
  ultimateCost: number
  /** 命座等级（影画1：进战 +120 愿力 + 残痕效率 +10%；影画2：烬痕 +20% + 其他招式 15%；影画4/6：面板） */
  cinemaLevel?: number
  /**
   * 本局反制支援次数（Boss 控制技组数，store 折算注入 `cfg.counterAssistCount`）。
   * 一次反制支援 = 1601204 希望堡垒 + 1601205 灯塔（融合成一次动作）；灯塔原文「重击命中敌人时，
   * **直接为目标添加 1 层[残痕]**」⇒ 每组**白送 1 层**（600 点），不吃积蓄效率倍率、受同时存量 3 层上限。
   * 与克拉蕾 1611028+1611030 的「琢形送层」同口径（`claret.ts#computeClaretSharpResource`）。
   */
  counterAssistCount?: number
  /**
   * **跨槽锐能给养**（点）：3.4.3 知更鸟终结技「全队[锋御]固定回复 20 点锐能」。
   * 由 `robin.ts#applyRobinSharpnessGift` 在 postRound 相位写进本槽 `cfg.sharpnessGiftFromTeam`，
   * 两个调用点（buildExecutions / patchExecutions）都从 cfg 透传进来。缺省 0 = 本局无来源。
   */
  giftSharpness?: number
  /**
   * 本局**成功招架**次数（= `cfg.parryCount`；引擎按它同时产「招架支援行 + 支援突击行」，见
   * `core/resource/rowBuild.ts:433`）。3.4.3 新增「成功招架 ⇒ 为敌人积累残痕值」，数值见
   * `SUNBRINGER_PARRY_GASH_BY_ASSIST_MOVE_ID`（按引擎选中的那一档取）。
   */
  parryCount?: number
  /**
   * 引擎**选中的那一档**招架支援 moveId（= `cfg.defensiveAssistMoveId`，由 `findDefensiveAssist` 决定）。
   * 模块只做「moveId → 点数值」的翻译，不自己猜档、不列 id 名单（引擎换档数值自动跟着换）。
   */
  defensiveAssistMoveId?: string
  /**
   * **团队残痕池核定的本槽份额**（双锋御队专用；单锋御 / 首轮未收敛 = undefined）。
   * 由 `applyTeamConfig({phase:'converge'})` 读 `threads.moduleFeedback.gashPoolClaims` →
   * `gashMaim#resolveTeamGashPool` 算好后写进 `cfg.gashPoolGrantedLayers`。
   * 缺省 ⇒ 回落下面的私有单槽池，**逐位不变**。
   */
  teamGrantedLayers?: number
  /** 团队池**总**层数（展示用；缺省 ⇒ 用私有池层数）。 */
  teamPoolLayers?: number
}) {
  const { meta, combatTime, basicTime, chainCount, totalDecibel, ultimateCost } = input
  /**
   * 跨槽给养（点，入参已由调用点清洗成 ≥0）：3.4.3 知更鸟终结技「全队[锋御]固定回复 20 点锐能」。
   * ⚠ 只加进**锐能池**：它不改残痕/愿力/烬痕任何一条循环的输入（原文只说「回复锐能」）。
   */
  const giftSharpness = Number(input.giftSharpness ?? 0)
  // 式子单源 = `mechanics/sharpnessIncome`（规则 11）：进场 + 自动累积×接战 + 招式回复×平A时间
  // + 跨槽给养（3.4.3 知更鸟终结技「全队[锋御]固定回复 20 点锐能」；无来源时缺省 0）。
  const sharpPool = sharpnessIncome({
    initial: SHARPNESS_INITIAL,
    regenPerSec: meta.sharpnessRegen,
    seconds: combatTime,
    movePerSec: meta.basic.sharpPerSec,
    moveSeconds: basicTime,
    gifts: [giftSharpness],
  }).total
  let budget = Math.max(0, combatTime)
  const exMax = meta.ex.actionTime > 0 ? Math.floor(budget / meta.ex.actionTime) : 0
  const exCount = Math.max(0, Math.min(Math.floor(sharpPool / SHARPNESS_COST_PER_EX), exMax))
  budget = Math.max(0, budget - exCount * meta.ex.actionTime)

  // 残痕来源：平A 秒均 + 强特/连携表值 + **招架支援**（3.4.3）+ **支援突击**（同句 +15% 效率）
  //          + **反制支援灯塔送的层**（每组 +600 点，不吃效率）
  const counterGiftStacks = Math.max(0, Math.floor(input.counterAssistCount ?? 0))
  // 影画1（v2 文本「残痕积蓄效率提升10%」）：只放大**积累来源**，灯塔白送的整层不吃效率
  const gashEfficiency = cinemaLevelOf(input.cinemaLevel) >= 1 ? SUNBRINGER_C1_GASH_EFFICIENCY : 1
  /**
   * **招架支援的残痕**（3.4.3+20278274 原文「德蕾琪娜成功招架敌人的攻击时，可为敌人积累残痕值」）。
   *
   * 数值按**引擎选中的那一档**取（`defensiveAssistMoveId`）：轻 56.64 / 重 99.14 / 连续 99.14 点/次
   * （gachabase 1601206/7/8，落法依据见该常量头注释）。
   * ⚠ 与 basic/ex/chain **在同一处乘** `gashEfficiency`：原文说它是「**积累**残痕值」，
   *   与灯塔「直接为目标添加 1 层」不同——积累吃积蓄效率，白送层不吃。
   * ⚠ 未选中任何招架档（无招架支援 / 引擎没解析到）⇒ 0，不影响其余来源。
   */
  const parryCount = Math.max(0, Math.floor(Number(input.parryCount ?? 0)))
  const parryGashPerCast = SUNBRINGER_PARRY_GASH_BY_ASSIST_MOVE_ID[String(input.defensiveAssistMoveId ?? '')] ?? 0
  const parryGash = parryCount * parryGashPerCast
  /**
   * **支援突击的残痕**（同一句原文的后半：「艾尔妲与林德薇恩发动的[支援突击]残痕积蓄效率提升15%」）。
   *
   * 次数 = 同一次招架后紧跟的那一行，引擎按 `parryCount` 产行（`core/resource/rowBuild.ts` 支援突击段），
   * 表值 = `cfg.assistFollowUpMoveId` 的 `gash_buildup`（catalog 值 = gachabase ÷100，**不含**这 15%）。
   * 引擎当前为 1601 选的是 1601013（坚定信仰，186.98）⇒ 每招架 1 次 = 186.98 × 1.15 = **215.027 点**。
   *
   * ⚠ 同样进「积累括号」吃影画1 的 ×1.1（两者相乘：实录 M2 场该招 rate 1.25 = 1.15 × 1.10）；
   *   灯塔白送的整层仍不吃任何效率。
   * ⚠ 反制支援整组化解时 `parryCount` 不增加（`counterAssistCount` 另走灯塔白送层）⇒ 这里不会双计。
   */
  // 门控 = 引擎真的会产这一行：`buildExecutions` 的支援突击段要求 `assistFollowUpActionTime > 0`。
  // （actionTime=0 的角色即便有 moveId 也不产行 ⇒ 这里必须同步记 0，否则凭空多出残痕。）
  const assistFollowUpGashPerCast = meta.assistFollowUp && meta.assistFollowUp.actionTime > 0
    ? meta.assistFollowUp.gash * SUNBRINGER_ASSIST_FOLLOW_UP_GASH_EFFICIENCY
    : 0
  const assistFollowUpGash = parryCount * assistFollowUpGashPerCast
  const gash = (meta.basic.gashPerSec * basicTime + exCount * meta.ex.gash + chainCount * meta.chain.gash
    + parryGash + assistFollowUpGash) * gashEfficiency
    + counterGiftStacks * GASH_PER_LAYER
  // 消耗层：强化特殊技与连携技都会「重击命中后消耗」，每次最多 3 层
  //
  // 3.4.3 给这条消耗加了两个限定（原文）：「重击命中处于[残痕]状态下的敌人，**且挽昼为操作中的代理人时**，
  // 会消耗一层[残痕]」、「第四段…**且挽昼为操作中的代理人、[愿火]未达上限时**，消耗…」。
  // 前者恒成立（这些招式都是她自己打的，模块按她前台出招建轴）；后者只在愿火卡在 160 时咬合——
  // 而下面的入账顺序是「逐层入账、≥120 立刻转聚锋」，愿火银行恒 < 120 < 160 ⇒ 钳制在稳态里不会真的挡消耗
  // （判据 sunbringerLoops.test.ts「愿火未达上限」把这条写成断言，而不是留一句注释）。
  //
  // ⚠ **仍未建模的一条 3.4.3 残痕来源**（原文见 spec 1601 未建模段）：
  //   燎源属性说明「触发[灼烧]效果时，额外为目标累积少量[残痕]，每 15 秒最多一次」——**原文没数值**。
  //   （「成功招架 ⇒ 积累残痕」= 上面的 `parryGash`，2026-11-08 已落地；「支援突击 +15% 效率」
  //    = 上面的 `assistFollowUpGash`，2026-11-10 依据实录补入。别再把这句读成「两条都未建模」。）
  const maimDemand = 3 * (exCount + chainCount)
  /**
   * 残痕池走**锋御通用池**（`mechanics/gashMaim#allocateBossGashPool`）：单槽调用 = `min(层, 需求)`，逐位不变。
   *
   * **双锋御队**：`teamGrantedLayers` 由全队申报表核定（见 `gashMaim#resolveTeamGashPool`）⇒
   * 用核定份额替代私有池结果，同一 Boss 残痕池不再各算各的。缺省（单锋御 / 首轮未收敛）⇒ 回落私有池。
   */
  const gashPool = allocateBossGashPool({
    contributions: [{ slot: 0, points: gash }],
    demand: [{ slot: 0, layers: maimDemand }],
    priority: [0],
  })
  const teamPoolLayers = Number(input.teamPoolLayers)
  const gashLayers = Number.isFinite(teamPoolLayers) ? Math.max(0, Math.floor(teamPoolLayers)) : gashPool.layers
  const maimCount = input.teamGrantedLayers === undefined
    ? (gashPool.bySlot[0] ?? 0)
    : Math.max(0, Math.min(Math.floor(Number(input.teamGrantedLayers) || 0), maimDemand))

  // 影画1：进入战场立即获得 120 愿力（勘域 180s 一次 ⇒ 每局一次）
  const wishFromEntry = cinemaLevelOf(input.cinemaLevel) >= 1 ? 120 : 0
  const wishTotal = maimCount * WISH_PER_MAIM + wishFromEntry
  /**
   * 愿力**上限 160**（raw 核心被动 Lv.7「每消除 1 层残痕获得 40 点愿力，最多 160 点」）：
   * 逐层入账、攒满 120 立刻转化一次聚锋（银行余量永远 < 120，故上限只防「攒过 160」这件不可能的事）。
   *
   * ⚠ 与闭式 `floor(wishTotal / 120)` 逐位等价（WISH_MAX = 160 > 120 + 40 ⇒ 钳制永不咬合）：
   *   这条钳制不是数值近似，而是把「上限」这个原文口径写进代码，避免下一个人再从注释里推断它。
   */
  let wishBank = 0
  let jufengFromWish = 0
  const depositWish = (amount: number) => {
    wishBank = Math.min(WISH_MAX, wishBank + Math.max(0, amount))
    if (wishBank >= JU_FENG_WISH_COST) {
      wishBank -= JU_FENG_WISH_COST
      jufengFromWish += 1
    }
  }
  // 顺序与原文一致：先进场（影画1 的 +120），再逐层消除残痕换愿力
  if (wishFromEntry > 0) depositWish(wishFromEntry)
  for (let i = 0; i < maimCount; i++) depositWish(WISH_PER_MAIM)
  const jufengMax = meta.jufeng.actionTime > 0 ? Math.floor(budget / meta.jufeng.actionTime) : 0
  const jufengCount = Math.max(0, Math.min(jufengFromWish, jufengMax))
  budget = Math.max(0, budget - jufengCount * meta.jufeng.actionTime)

  const changanMax = meta.changan.actionTime > 0 ? Math.floor(budget / meta.changan.actionTime) : 0
  const changanCount = Math.max(0, Math.min(jufengCount, changanMax))
  budget = Math.max(0, budget - changanCount * meta.changan.actionTime)

  const ultFeasible = ultimateCost > 0 ? Math.floor(Math.max(0, totalDecibel) / ultimateCost) : 0
  // 旗令优先给「此行，共赴前路」（产愿核）；二段「此愿，重塑万象」由引擎既有的终结技行承担
  const ultACount = Math.max(0, Math.min(jufengCount, ultFeasible))
  /**
   * **强化特殊技·永昼之炬（1601007，消耗[旗令]）必须建模**（用户口径 2026-10-27，逐字）：
   * > 「而**强化 e 两个都要建模**，消耗特殊资源的那个是挽昼自己独特的资源循环。」
   *
   * 「强化 E」= 不耗锐能、改耗**专属资源**的两发：长暗终焉（1601107，耗[链齿]）与
   * 永昼之炬（1601007，耗[旗令]）。raw 原文：「拥有[旗令]时，点按特殊技发动：消耗[旗令]，
   * ……造成大量燎源属性伤害」；长暗终焉同构（「拥有[链齿]时…消耗[链齿]」）。
   * 两种资源都由聚锋各发 1 个 ⇒ 互不挤占槽位，可以各打各的。
   *
   * 分配：旗令**先给**「此行，共赴前路」（产愿核；2026-10-25 裁决不变），**剩余旗令**才由
   * 永昼之炬消化——相对旧「永昼之炬按 0 次」，差别只在「旗令打不完时多打一发」，
   * 终结技次数一位不动。
   *
   * ⚠ 与「耗能 30 的 E」区分（同句）：「两段耗能 30 的 e **只需考虑一个**」——燃灯·晦尽
   * （1601006，at 2.433）与焚夜·曦生（1601106，at 2.5）是**多形态对称数据**（同收益公式）
   * ⇒ 只取已在轮换里的焚夜·曦生，不另开一条线。
   */
  const torchMax = meta.torch.actionTime > 0 ? Math.floor(budget / meta.torch.actionTime) : 0
  const torchCount = Math.max(0, Math.min(jufengCount - ultACount, torchMax))
  budget = Math.max(0, budget - torchCount * meta.torch.actionTime)
  return {
    sharpPool, sharpUsed: exCount * SHARPNESS_COST_PER_EX, exCount, exMax,
    gash, gashLayers, maimDemand, maimCount, counterGiftStacks,
    parryGash, parryGashPerCast, parryCount,
    assistFollowUpGash, assistFollowUpGashPerCast,
    wishTotal, wishSpent: jufengCount * JU_FENG_WISH_COST, wishFromEntry, jufengCount,
    jufengMax, changanMax, torchMax,
    changanCount, ultFeasible, ultACount, torchCount,
    /**
     * **残痕点数的来源拆分**（资源卡展示的唯一来源，用户 2026-11-10：「资源池没展示残痕积蓄」）。
     * 五个"积累"来源都已乘过 `gashEfficiency`（灯塔白送层不吃效率，单列），
     * 加起来逐位等于上面那个 `gash`（判据 sunbringerResourceCard.test.ts ②）。
     * ⚠ 展示层不许自己重算这五个分量：那等于把这条式子抄第二份，引擎换来源时会静默分叉。
     */
    gashEfficiency,
    gashFromBasic: meta.basic.gashPerSec * basicTime * gashEfficiency,
    gashFromEx: exCount * meta.ex.gash * gashEfficiency,
    gashFromChain: chainCount * meta.chain.gash * gashEfficiency,
    gashFromParry: parryGash * gashEfficiency,
    gashFromAssistFollowUp: assistFollowUpGash * gashEfficiency,
    gashFromCounterGift: counterGiftStacks * GASH_PER_LAYER,
    basicGashPerSec: meta.basic.gashPerSec,
    giftSharpness,
    /** 团队残痕池核定的本槽份额（单锋御 / 首轮未收敛 = null，展示层据此区分「私有池」与「团队池」） */
    teamGranted: input.teamGrantedLayers === undefined ? null : Math.max(0, Math.floor(Number(input.teamGrantedLayers) || 0)),
  }
}

function buildSunbringerExecutions({ cfg, state, executions }: AgentResourceInput): void {
  const meta = cfg.sunbringerMeta
  if (!meta) return
  const loops = solveSunbringerLoops({
    meta,
    cinemaLevel: cinemaLevelOf(cfg.sunbringerCinemaLevel),
    combatTime: effectiveCombatTime(state, cfg),
    basicTime: Math.max(0, state.basicAttackTime),
    chainCount: Math.max(0, Math.floor(state.chainCountTotal)),
    totalDecibel: Math.max(0, state.totalDecibel),
    ultimateCost: Number(cfg.ultimateCost),
    counterAssistCount: cfg.counterAssistCount,
    // 跨槽锐能给养（知更鸟终结技）——postRound 写 cfg、这里读，缺少即 0
    giftSharpness: Math.max(0, Number(cfg.sharpnessGiftFromTeam ?? 0)),
    // 3.4.3 招架残痕：次数 = 本槽招架次数；档位 = 引擎选中的那条招架支援行（不自己猜档）
    parryCount: Math.max(0, Math.floor(cfg.parryCount)),
    defensiveAssistMoveId: cfg.defensiveAssistMoveId,
    // 双锋御团队池份额（单锋御 = undefined ⇒ 私有池；见 solveSunbringerLoops 头注释）
    teamGrantedLayers: cfg.gashPoolGrantedLayers,
    teamPoolLayers: cfg.gashPoolTotalLayers,
  })
  const push = (row: Parameters<typeof moduleExecRow>[0]) => executions.push(moduleExecRow(row))

  if (loops.exCount > 0) {
    const t = meta.ex.actionTime
    push({
      moveId: meta.ex.moveId,
      moveName: '强化特殊技：焚夜·曦生（锐能 30/发）',
      category: 'special',
      count: loops.exCount,
      actionTime: t,
      totalTime: loops.exCount * t,
      damageMultiplier: meta.ex.damage,
      dazeMultiplier: meta.ex.daze,
      decibelRecovery: meta.ex.decibel,
      totalDecibelRecovery: loops.exCount * meta.ex.decibel,
      ...ENERGY_RECOVERY_OFF,
      timeBucket: 'necessary',
    })
  }
  if (loops.jufengCount > 0) {
    const t = meta.jufeng.actionTime
    push({
      moveId: meta.jufeng.moveId,
      moveName: '普通攻击：执旌·聚锋（愿力 120/次）',
      category: 'basic',
      count: loops.jufengCount,
      actionTime: t,
      totalTime: loops.jufengCount * t,
      damageMultiplier: meta.jufeng.damage,
      dazeMultiplier: meta.jufeng.daze,
      decibelRecovery: meta.jufeng.decibel,
      totalDecibelRecovery: loops.jufengCount * meta.jufeng.decibel,
      ...ENERGY_RECOVERY_OFF,
      timeBucket: 'necessary',
    })
  }
  if (loops.changanCount > 0) {
    const t = meta.changan.actionTime
    push({
      moveId: meta.changan.moveId,
      moveName: '强化特殊技：焚夜·长暗终焉（消耗链齿）',
      category: 'special',
      count: loops.changanCount,
      actionTime: t,
      totalTime: loops.changanCount * t,
      damageMultiplier: meta.changan.damage,
      dazeMultiplier: meta.changan.daze,
      decibelRecovery: meta.changan.decibel,
      totalDecibelRecovery: loops.changanCount * meta.changan.decibel,
      ...ENERGY_RECOVERY_OFF,
      timeBucket: 'necessary',
    })
  }
  if (loops.maimCount > 0) {
    // 毁伤 = 附带事件（不占时间）；倍率 = 3.4.1+19850203 新增行 1601114
    push({
      moveId: meta.maim.moveId,
      moveName: '毁伤（每消耗 1 层残痕触发 1 次）',
      category: 'basic',
      count: loops.maimCount,
      actionTime: 0,
      totalTime: 0,
      damageMultiplier: meta.maim.damage,
      ...RECOVERY_OFF,
      timeBucket: 'necessary',
    })
  }
  if (loops.torchCount > 0) {
    const t = meta.torch.actionTime
    push({
      moveId: meta.torch.moveId,
      moveName: '强化特殊技：燃灯·永昼之炬（消耗旗令）',
      category: 'special',
      count: loops.torchCount,
      actionTime: t,
      totalTime: loops.torchCount * t,
      damageMultiplier: meta.torch.damage,
      dazeMultiplier: meta.torch.daze,
      decibelRecovery: meta.torch.decibel,
      totalDecibelRecovery: loops.torchCount * meta.torch.decibel,
      ...ENERGY_RECOVERY_OFF,
      timeBucket: 'necessary',
    })
  }
  if (loops.ultACount > 0) {
    const t = meta.ultA.actionTime
    push({
      moveId: meta.ultA.moveId,
      moveName: '终结技：此行，共赴前路（旗令 → 愿核）',
      category: 'chain',
      count: loops.ultACount,
      actionTime: t,
      totalTime: loops.ultACount * t,
      damageMultiplier: meta.ultA.damage,
      dazeMultiplier: meta.ultA.daze,
      ...RECOVERY_OFF,
      timeBucket: 'necessary',
    })
  }
}

/**
 * 烬痕存量（纯函数；3.4.3+20278274 核心被动 + 影画 2/6）：
 * **0.60 × 5 个积攒招式（聚锋 / 长暗终焉 / 永昼之炬 / 此行共赴前路 / 此愿重塑万象）的实际伤害之和
 * + 0.35 × 自己打出的[毁伤]实际伤害**（3.4.3 新增第二条来源，队友那份无通道）
 * ——存下来的数字是死数：不再吃失衡易伤、也不吃任何属性。引擎里以「同乘区倍率」承载（挂到二段大招行上），
 * 因为积攒行与结算行共用同一套乘区（同基底 def、同元素/防御/抗性/增伤，失衡易伤由引擎全局 coverage 统一供给）⇒
 * 「攒的时候吃到易伤、结算时不再追加」在总量上等价：总贡献 = 0.65 × Σ倍率 × 乘区 × 易伤(一次)。
 * ⚠ 影画2：积攒量整体 ×1.2——核心被动 60%→**72%**、**其他招式**（除上面 5 招外）实际伤害
 *   15%→**18%**（用户 2026-11-01 口径；3.4.3 把核心率降到 60% 后，同一 ×1.2 给出 72%）；
 *   挽昼所有招式都是锐化/火/DEF 基底 ⇒ 同基底倍率等价（`otherMultiplierSum`）。
 * ⚠ 影画6（v2）：终结技额外一次[烬灭] = 该次终结技积攒[烬痕]量的 150%。
 * ⚠ 前提：积攒行与结算行同乘区。若将来给某招挂招式级增伤/易伤差异，这里要改成按行加权。
 */
export function computeEmberScar(input: {
  meta: SunbringerMeta
  loops: { jufengCount: number; changanCount: number; torchCount?: number; ultACount: number; maimCount?: number }
  ultBCount: number
  /** 影画2：其他招式（除 5 个积攒招式外）的执行行「倍率 × 次数」之和（同基底近似） */
  otherMultiplierSum?: number
  /**
   * **队友锋御的[毁伤]累计倍率**（`gashMaim#collectTeamMaimMultiplier`，排除自己那份）。
   * 原文 3.4.3：「全队代理人造成的[毁伤]也可使目标积攒等同于该次实际伤害 35% 的[烬痕]」。
   * 缺省 0 = 无队友锋御（单锋御队逐位不变）。单位 = 倍率空间（与自身那份同空间，见该函数注释的 debt）。
   */
  teammateMaimMultiplier?: number
  cinemaLevel?: number
}): number {
  const { meta, loops, ultBCount } = input
  const cinema = cinemaLevelOf(input.cinemaLevel)
  // 3.4.3 核心被动：5 个积攒招式，率 60%（影画1 的「首次聚锋 150%」早在 v2 已删）
  const qualifying = (
    loops.jufengCount * meta.jufeng.damage
    + loops.changanCount * meta.changan.damage
    + (loops.torchCount ?? 0) * meta.torch.damage
    + loops.ultACount * meta.ultA.damage
    + ultBCount * meta.ultB.damage
  ) * EMBER_SCAR_RATE
  // 3.4.3 第二条来源：**全队**[毁伤]按该次实际伤害 35% 也积攒——自己那份按本槽表值算，
  // 队友锋御那份由 `gashMaim#collectTeamMaimMultiplier` 经 ModuleFeedback 跨轮送进来（2026-11-10 接线）。
  const maimEmber = ((loops.maimCount ?? 0) * meta.maim.damage
    + Math.max(0, Number(input.teammateMaimMultiplier ?? 0))) * EMBER_SCAR_MAIM_RATE
  // 影画2：积攒量整体 ×1.2——**三条来源都乘**：核心被动 60%→**72%**、毁伤 35%→**42%**、其他招式 15%→**18%**
  // （用户 2026-11-01 逐字「2命分别是 78% 和 18%」是 65% 时代的口径；按比值口径 60/15 同样各 ×1.2）
  const base = qualifying + maimEmber
  const c2 = cinema >= 2
    ? (base + (input.otherMultiplierSum ?? 0) * EMBER_SCAR_OTHER_RATE) * (1 + EMBER_SCAR_C2_BONUS)
    : base
  // 影画6（v2）：额外一次[烬灭] = 该次终结技积攒[烬痕]量的 150%
  const ultBEmber = ultBCount * meta.ultB.damage * EMBER_SCAR_RATE * (cinema >= 2 ? 1 + EMBER_SCAR_C2_BONUS : 1)
  const c6 = cinema >= 6 ? ultBEmber * EMBER_SCAR_C6_EXTRA_MULT : 0
  return c2 + c6
}

/**
 * 「其他招式」执行行倍率和（影画2 的 15% 烬痕来源）：只数本角色自己的行，排除 5 个已积攒招式。
 * ⚠ 前缀从 `meta` 的 moveId 现取，**不用 agentId 常量**：beta 冻结副本的 agentId 被改写成 `1601v1`，
 * 但 moveId 仍是 `1601xxx` 原样——用 agentId 常量取前缀在副本里会一条都数不到。
 */
function sumOtherDamageMultipliers(executions: AgentResourceInput['executions'], meta: SunbringerMeta): number {
  const prefix = meta.ultB.moveId.slice(0, 4)
  const qualifying = new Set([meta.jufeng.moveId, meta.changan.moveId, meta.torch.moveId, meta.ultA.moveId, meta.ultB.moveId])
  let sum = 0
  for (const e of executions) {
    if (!e.moveId.startsWith(prefix) || qualifying.has(e.moveId)) continue
    sum += (e.damageMultiplier ?? 0) * e.count
  }
  return sum
}

/**
 * 烬痕结算（用户裁决 2026-10-25：计入总伤害）：
 * 聚锋 / 长暗终焉 / 此行共赴前路 / 此愿重塑万象 的**实际伤害 75%** 累积，被二段终结技消除时等量扣血。
 * 引擎对 1601 只发**一条**终结技行（moveId 1601011「此愿，重塑万象」，由既有的终结技通道认出），
 * 所以：① 本模块不再自己发二段行（否则双计，实测会多出 2 次 16146% 的虚增行）；
 * ② 烬痕按**已物化行的倍率**结算（同一基底，龙格等价），均摊进那次终结技的倍率并打 override。
 * 行名会带上烬痕数值，资源页与执行行都能复核。
 */
/**
 * **本槽对团队残痕池的申报**（双锋御队；单锋御时由 `collectSharpenGashClaims` 整体返回 null）。
 *
 * 为什么在 `buildResourceResult` 暴露而不是让 `nextRoundFeedback` 自己重算：点数依赖本轮的
 * `state.basicAttackTime`（折叠环产物），重算要复制一遍 `solveSunbringerLoops` 的全部入参；
 * 而资源结果里**已经有**这份解，暴露它就是「同一份时间只花一次」。
 */
export function buildSunbringerResourceResult({ cfg, state }: AgentResourceResultInput): Partial<CharacterResourceResult> {
  const meta = cfg.sunbringerMeta
  if (!meta) return {}
  const loops = solveSunbringerLoops({
    meta,
    cinemaLevel: cinemaLevelOf(cfg.sunbringerCinemaLevel),
    combatTime: effectiveCombatTime(state, cfg),
    basicTime: Math.max(0, state.basicAttackTime),
    chainCount: Math.max(0, Math.floor(state.chainCountTotal)),
    totalDecibel: Math.max(0, state.totalDecibel),
    ultimateCost: Number(cfg.ultimateCost),
    counterAssistCount: cfg.counterAssistCount,
    giftSharpness: Math.max(0, Number(cfg.sharpnessGiftFromTeam ?? 0)),
    parryCount: Math.max(0, Math.floor(cfg.parryCount)),
    defensiveAssistMoveId: cfg.defensiveAssistMoveId,
    teamGrantedLayers: cfg.gashPoolGrantedLayers,
    teamPoolLayers: cfg.gashPoolTotalLayers,
  })
  return {
    sunbringerGashSource: {
      points: loops.gash,
      demandLayers: loops.maimDemand,
      gashLayers: loops.gashLayers,
      maimCount: loops.maimCount,
    },
    // 资源卡的孩子：同一份循环解（不重算），展示层只读它
    sunbringerLoopSource: loops,
  }
}

/**
 * **资源卡三张**（用户 2026-11-10，逐字：「挽昼资源池没展示残痕积蓄，毁伤次数和自身那个特殊条子的
 * 数量呢」）：残痕·毁伤 / 愿火循环 / 锐能——与克拉蕾的 `claret-gash-maim` / `claret-sharpness` 同构。
 *
 * ## 为什么读 `result.sunbringerLoopSource` 而不是在展示层重算
 * 循环解吃**折叠环产物**（`basicAttackTime` / `chainCountTotal` / `totalDecibel`），展示层拿不到这些
 * 输入，重算只能近似或复制一份式子 ⇒ 一旦引擎改了来源（如 2026-11-10 新补的支援突击残痕），卡片会
 * 静默停在旧数上。`buildResourceResult` 每轮已经算过这份解（团队残痕池申报也是从它来的）⇒ 同一份时间
 * 只花一次。
 */
function buildSunbringerResourceSections({ result }: AgentResourceSectionsInput) {
  const s = result.sunbringerLoopSource
  if (!s) return []
  const teamPool = s.teamGranted !== null
  return [
    {
      id: 'sunbringer-gash-maim',
      title: '挽昼·残痕 / 毁伤',
      summary: `残痕 ${fmt(s.gash)} 点 → ${s.gashLayers} 层 · 毁伤 ${s.maimCount} / ${s.maimDemand} 段`,
      rows: [
        {
          label: '残痕积累',
          value: `${fmt(s.gash)} 点`,
          detail: `平A ${fmt(s.basicGashPerSec)}/s × 平A时间 = ${fmt(s.gashFromBasic)}；强化特殊技 ${s.exCount} 发 = ${fmt(s.gashFromEx)}；连携 = ${fmt(s.gashFromChain)}；招架支援 ${s.parryCount} 次 × ${fmt(s.parryGashPerCast)} = ${fmt(s.gashFromParry)}；支援突击 ${s.parryCount} 次 × ${fmt(s.assistFollowUpGashPerCast)}（表值 ×1.15）= ${fmt(s.gashFromAssistFollowUp)}；上面五条之和 × 积蓄效率；反制支援·灯塔每组白送 1 层 = ${fmt(s.gashFromCounterGift)} 点（不吃效率）`,
        },
        {
          label: '积蓄效率',
          value: `×${fmt(s.gashEfficiency)}`,
          detail: '1 + 影画1 的 +10%（原文「残痕积蓄效率提升10%」）；支援突击自带的 ×1.15 是**招式族**效率，已单列在「残痕积累」里，两者连乘',
        },
        {
          label: '残痕层数（整局可用）',
          value: `${s.gashLayers} 层`,
          detail: `每 ${GASH_PER_LAYER} 点 = 1 层；敌人身上同时最多 ${GASH_MAX_STACKS} 层，但整局可用层数不封顶（层是消耗品，攒多少用多少）`,
        },
        {
          label: '毁伤需求',
          value: `${s.maimDemand} 段`,
          detail: '强化特殊技 / 连携技每次命中至多消耗 3 层（原文「重击命中…消耗一层，最多连续触发 3 次」）',
        },
        {
          label: '毁伤触发',
          value: `${s.maimCount} 次`,
          detail: teamPool
            ? `双锋御队：全队共用同一个 Boss 残痕池（池 ${s.gashLayers} 层），本槽核定份额 ${s.teamGranted} 段——不是各算各的`
            : `单锋御队：min(可用层 ${s.gashLayers}, 需求 ${s.maimDemand} 段)`,
        },
      ],
      footer: '残痕/毁伤是**锋御职业的通用机制**（不是克拉蕾专属）：多个锋御同队时共用同一个 Boss 残痕池。挽昼的消耗方 = 强化特殊技 + 连携技；毁伤是附带事件（不占前台时间），伤害按招式的 actual 伤害结算。',
    },
    {
      id: 'sunbringer-wish',
      title: '挽昼·愿火 → 聚锋 → 链齿/旗令 → 愿核',
      summary: `愿火 ${fmt(s.wishTotal)}（花 -${fmt(s.wishSpent)}）· 聚锋 ${s.jufengCount} 次 · 长暗终焉 ${s.changanCount} · 此行共赴前路 ${s.ultACount} · 永昼之炬 ${s.torchCount} · 愿核 ${s.ultACount}`,
      rows: [
        {
          label: '愿火总量',
          value: `${fmt(s.wishTotal)}`,
          detail: `每消除 1 层残痕 +${WISH_PER_MAIM} 点（上限 ${WISH_MAX}）⇒ 毁伤 ${s.maimCount} 层 × ${WISH_PER_MAIM}${s.wishFromEntry > 0 ? ` + 影画1 进战 +${fmt(s.wishFromEntry)}` : ''}`,
        },
        {
          label: '聚锋次数',
          value: `${s.jufengCount} 次`,
          detail: `每 ${JU_FENG_WISH_COST} 点愿火 = 1 次聚锋；愿火够买 ${Math.floor(s.wishTotal / JU_FENG_WISH_COST)} 次，时间预算封顶 ${s.jufengMax} 次；余量 ${fmt(s.wishTotal - s.wishSpent)} 点`,
        },
        {
          label: '链齿 → 长暗终焉',
          value: `${s.changanCount} 次`,
          detail: `每次聚锋各发 1 个[链齿]，长暗终焉消耗 1 个；时间预算封顶 ${s.changanMax} 次`,
        },
        {
          label: '旗令 → 此行共赴前路',
          value: `${s.ultACount} 次`,
          detail: `旗令**优先**给终结技一段（消耗 1 旗令 → 产 1 愿核）；受喧响封顶 ${s.ultFeasible} 次`,
        },
        {
          label: '旗令 → 永昼之炬',
          value: `${s.torchCount} 次`,
          detail: `打完一段后剩下的旗令才给永昼之炬（强化 E，不耗锐能）；时间预算封顶 ${s.torchMax} 次`,
        },
        {
          label: '愿核 → 二段终结技',
          value: `${s.ultACount} 次`,
          detail: '一段每产 1 点[愿核]，二段「此愿，重塑万象」消耗 1 点——**二段不耗喧响**（否则两段会被算成 6000 喧响）',
        },
      ],
      footer: '烬痕不在这张卡上重复计数：5 个积攒招式实际伤害的 60% + 全队[毁伤]实际伤害的 35%（影画2 整体 ×1.2）存成固定数值后由二段终结技消除，引擎按「同乘区倍率」摊进二段那一行的倍率里，执行行名会带 +N%。',
    },
    {
      id: 'sunbringer-sharpness',
      title: '挽昼锐能',
      summary: `锐能池 ${fmt(s.sharpPool)} · 强化特殊技 ${s.exCount} 发（-${fmt(s.sharpUsed)}）· 结余 ${fmt(s.sharpPool - s.sharpUsed)}`,
      rows: [
        {
          label: '锐能总量',
          value: `${fmt(s.sharpPool)}`,
          detail: `进场 +${SHARPNESS_INITIAL} + 自动累积 × 战斗时间 + 平A 招式回复${s.giftSharpness > 0 ? ` + 队友给养 ${fmt(s.giftSharpness)}（知更鸟终结技 20/次）` : ''}`,
        },
        {
          label: '强化特殊技',
          value: `${s.exCount} 发`,
          detail: `每发 ${SHARPNESS_COST_PER_EX} 点；发数 = min(锐能够买, 时间预算 ${s.exMax} 发)`,
        },
      ],
      footer: '锐能循环是「自动回复 + 平A」驱动的：发数不足通常不是卡锐能，而是卡时间（动作时长 × 发数 > 时战斗时间）。',
    },
  ]
}

/**
 * 下一轮残痕池申报（双锋御队）：从**本轮全队资源结果**收集所有锋御槽的（点数, 需求）。
 *
 * 两个锋御模块都会产出**同一份**申报表（同一输入 ⇒ 同一输出），故 `Object.assign` 的后写覆盖先写无害。
 * 单锋御队 `collectSharpenGashClaims` 返回 null ⇒ 不写该键 ⇒ 与改造前逐位不变。
 */
export function sunbringerNextRoundFeedback({ slot, adjustedResult }: AgentNextRoundFeedbackInput): ModuleFeedback {
  const claims = collectSharpenGashClaims(adjustedResult.characters)
  // 队友锋御的[毁伤]累计倍率（烬痕 35% 那条来源的跨槽输入）：读**本轮**执行计划里的毁伤行，
  // 下一轮 converge 写回 cfg ⇒ 与残痕池申报同一个跨轮通道（同轮拿不到别的槽的折叠环产物）。
  const teammateMaimMultiplier = collectTeamMaimMultiplier(adjustedResult.characters, slot)
  return {
    ...(claims ? { gashPoolClaims: claims } : {}),
    sunbringerTeamMaimMultiplier: teammateMaimMultiplier,
  }
}

/**
 * **团队残痕池写回**（双锋御队，converge 相位）：把上一轮全队申报核定出的本槽份额写进 cfg。
 *
 * 三件事必须一起看：
 * ① 只有 `threads.moduleFeedback.gashPoolClaims` 存在（= 上一轮确有两个锋御槽申报）才动手；
 * ② `resolveTeamGashPool` 返回 null（申报不足 2 槽）⇒ 不写 ⇒ 资源解回落私有池，单锋御逐位不变；
 * ③ 写的是**绝对量**（不是 +=）：cfg 每轮从 base.characters 重新克隆，写回只在当轮有效。
 */
export function applySunbringerTeamConfig({ cfg, phase, threads }: AgentTeamConfigInput): void {
  if (phase !== 'converge' || !threads) return
  // 队友锋御[毁伤] → 烬痕 35%（2026-11-10）：与残痕池申报**分开**取值——
  // 池申报要求「本队有两个锋御槽」，这条只要求「有别人打出了毁伤」，两件事互不前置。
  cfg.sunbringerTeammateMaimMultiplier = Math.max(
    0,
    Number(threads.moduleFeedback.sunbringerTeamMaimMultiplier ?? 0),
  )
  const claims = threads.moduleFeedback.gashPoolClaims
  if (!claims) return
  const pool = resolveTeamGashPool(claims)
  if (!pool) return
  cfg.gashPoolGrantedLayers = pool.bySlot[cfg.slot] ?? 0
  cfg.gashPoolTotalLayers = pool.layers
}

/**
 * [支援突击]伤害 +20%（3.4.1+19997538 同句原文；用户裁决 2026-11-10）。
 *
 * 为什么走行级 dmgBonus 而不是面板：这是**招式限定**增伤（只有支援突击那一行），
 * 写 panel.dmgBonus 会外溢到强特/连携/终结（先例与理由同 yuzuha.ts#patchYuzuhaExecutions）。
 * 为什么是累加而不是绝对写：patchExecutions 每轮都会跑，但 dmgBonus 是**增伤区加成**（不是被
 * enrich 回填的倍率字段），行本身每轮重建 ⇒ 与柚子 C4 同款累加即可；不存在重复放大的可能
 * （对比 daze/倍率类字段必须绝对写，见 applySunbringerParryDaze 的注释）。
 */
function applySunbringerAssistFollowUpDamage(
  cfg: { assistFollowUpMoveId?: string },
  executions: AgentResourceInput['executions'],
): void {
  const assistId = String(cfg.assistFollowUpMoveId ?? '')
  if (!assistId) return
  for (const exec of executions) {
    if (exec.moveId !== assistId) continue
    exec.dmgBonus = (exec.dmgBonus ?? 0) + SUNBRINGER_ASSIST_FOLLOW_UP_DMG_BONUS
    exec.skillTableNote = `${exec.skillTableNote ?? ''}；[支援突击]伤害+${SUNBRINGER_ASSIST_FOLLOW_UP_DMG_BONUS}%（3.4.1 被动）`
  }
}

export function patchSunbringerExecutions({ cfg, state, executions }: AgentResourceInput): void {
  applySunbringerParryDaze(cfg, executions)
  applySunbringerAssistFollowUpDamage(cfg, executions)
  const meta = cfg.sunbringerMeta
  if (!meta) return
  const ultRow = executions.find(e => e.moveId === meta.ultB.moveId && e.count > 0)
  if (!ultRow) return
  // 烬痕按**同一套循环解**结算（不读已物化行的倍率：patch 与 buildExecutions 的调用次序
  // 在不同轮次里不一致，实测会读到上一轮的次数）。同一基底 ⇒ 倍率空间等价。
  const loops = solveSunbringerLoops({
    meta,
    combatTime: effectiveCombatTime(state, cfg),
    basicTime: Math.max(0, state.basicAttackTime),
    chainCount: Math.max(0, Math.floor(state.chainCountTotal)),
    totalDecibel: Math.max(0, state.totalDecibel),
    ultimateCost: Number(cfg.ultimateCost),
    cinemaLevel: cinemaLevelOf(cfg.sunbringerCinemaLevel),
    // 反制支援送的残痕层会改毁伤次数 ⇒ 烬痕的同源解必须吃同一个输入（否则两处解法分叉）
    counterAssistCount: cfg.counterAssistCount,
    // 锐能给养会影响强特发数 ⇒ 烬痕同源解也必须吃同一输入（理由同上）
    giftSharpness: Math.max(0, Number(cfg.sharpnessGiftFromTeam ?? 0)),
    // 招架残痕会改毁伤次数 ⇒ 烬痕同源解同样必须吃同一输入（与 counterAssistCount 同理由）
    parryCount: Math.max(0, Math.floor(cfg.parryCount)),
    defensiveAssistMoveId: cfg.defensiveAssistMoveId,
    // 团队池份额会改毁伤次数 ⇒ 烬痕同源解同样必须吃同一输入（与 parryCount 同理由）
    teamGrantedLayers: cfg.gashPoolGrantedLayers,
    teamPoolLayers: cfg.gashPoolTotalLayers,
  })
  const ember = computeEmberScar({
    meta,
    loops,
    ultBCount: ultRow.count,
    cinemaLevel: cinemaLevelOf(cfg.sunbringerCinemaLevel),
    otherMultiplierSum: sumOtherDamageMultipliers(executions, meta),
    teammateMaimMultiplier: Math.max(0, Number(cfg.sunbringerTeammateMaimMultiplier ?? 0)),
  })
  if (!(ember > 0)) return
  const perCast = ember / Math.max(1, ultRow.count)
  // 绝对写（不是 +=）：patch 每轮都会跑，累加会把烬痕重复计入（幂等口径）
  ultRow.damageMultiplier = meta.ultB.damage + perCast
  ultRow.damageMultiplierOverride = true
  ultRow.moveName = `终结技：此愿，重塑万象（愿核；烬痕消除 +${Math.round(ember)}%）`
}

/**
 * [招架支援]失衡值 ×1.5（3.4.1+19997538）：把 `buildCharConfig` 预缩好的值写到命中行上。
 *
 * ⚠ 绝对写 + `dazeMultiplierOverride`（不是 +=）：patch 每轮都会跑，累加会重复放大。
 * ⚠ 与烬痕那段共用同一个 patchExecutions ⇒ 必须**在 meta 早退之前**调用（本函数不依赖 meta）。
 */
function applySunbringerParryDaze(cfg: { sunbringerParryDazeById?: Record<string, number> }, executions: AgentResourceInput['executions']): void {
  const scaled = cfg.sunbringerParryDazeById
  if (!scaled) return
  for (const exec of executions) {
    const daze = scaled[exec.moveId]
    if (!(daze > 0)) continue
    exec.dazeMultiplier = daze
    exec.dazeMultiplierOverride = true
  }
}

/**
 * 兜底池（用户口径 2026-10-27）：「每失衡兜底可以放多个 e」。
 *
 * 窗尾秒数优先塞**耗能 30 的强化特殊技**（焚夜·曦生 1601106；与燃灯·晦尽 1601006 是多形态
 * 对称数据，只取一条线），塞不下的余量仍记 basic。这里**不自己算上限**：引擎
 * `roundInputs#expandExecutedToCounts` 会把认领量**逐招夹紧到本轮真物化的次数**
 * （`FillResourceBudget.executed`），夹掉的秒数退回平A ⇒ 角色一发强特都没打出来时，
 * 下面这个贪心不会抢走平A的轴内占比。
 */
export function expandSunbringerBasicFill(input: {
  fillSec: number
  actionTimeOf: (moveId: string) => number | undefined
}): ReadonlyArray<{ readonly moveId: string; readonly count: number }> {
  const fillSec = Math.max(0, Number(input.fillSec) || 0)
  if (!(fillSec > 0)) return []
  const exT = Math.max(0, input.actionTimeOf(SUNBRINGER_EX_MOVE_ID) ?? 0)
  const n = exT > 0 ? Math.floor(fillSec / exT) : 0
  return [
    { moveId: SUNBRINGER_EX_MOVE_ID, count: n },
    { moveId: 'basic', count: Math.max(0, fillSec - n * exT) },
  ]
}

/**
 * **第二段大招（此愿·重塑万象 1601011）的伤害段 = 1 秒**（用户口径 2026-10-30，逐字）：
 * > 「v1挽昼**第二段大招在第一秒就会把所有伤害打出来，后面3秒都是后摇**，所以这里大招后摇
 * >  放在失衡后面也应当算他所有伤害都吃到失衡易伤了……这个16s的失衡轴最后大招超出去了，
 * >  但你要算都吃到易伤」
 *
 * 落地 = 模块钩子 `axisMoveDamageSeconds`（引擎不认角色 id，判据 26）：轴栈把这一招的易伤折算
 * 分母从「动作全长 4.083s」换成「伤害段 1s」，而后摇照旧占满前台时间（`count`/时间/资源按整段）。
 *
 * ⚠ **只对 1601011 声明**：第一段 1601111（此行，共赴前路 2.883s）没有这句原文，按整段折算。
 * ⚠ 不声明成「窗口延长」：窗口一秒都不变长（那是佩洛伊斯决算 1551016 的口径，见 `stunWindowExtendOnEnd`）。
 */
export const SUNBRINGER_ULT_B_DAMAGE_SECONDS = 1
/** 第二段终结技·此愿，重塑万象（`meta.ultB` 的 moveId；轴内伤害段声明的键） */
export const SUNBRINGER_ULT_B_MOVE_ID = '1601011'
/**
 * 第一段终结技·此行，共赴前路（`meta.ultA` 的 moveId）：**由喧响购买**、消耗 [旗令] 并产出
 * **1 点 [愿核]**（spec 1601「愿核」段原文：「为此类招式消耗 1 点[旗令]」→「获得 1 点[愿核]」）。
 * 轴内它是唯一收费的终结点（`axisMoveFreeOfDecibel` 对二段返回 true）。
 */
export const SUNBRINGER_ULT_A_MOVE_ID = '1601111'
const settings: MechanicSetting[] = [
  {
    id: 'sunbringer.parryComboAlign',
    label: '挽昼·招架+支突合轴率',
    description: '她的[招架支援]可以自己接自己、不打断已有招式 ⇒ 合轴率作用在**自己身上**：'
      + '按该比例削减「招架支援 + 支援突击」两段的实际占用，省下来的时间回流平A 池（打更多招式）。'
      + '默认 60%（用户口径 2026-11-10）。0% = 完全串行（旧行为）；100% = 这两段完全不占前台时间。',
    default: SUNBRINGER_PARRY_COMBO_ALIGN_DEFAULT,
    min: 0,
    max: 100,
    step: 5,
    suffix: '%',
  },
]

export const sunbringerMechanic: AgentMechanicModule = {
  id: 'agent:sunbringer',
  agentIds: [SUNBRINGER_AGENT_ID],
  name: '挽昼',
  description: '3.4.3（3.4.3+20278274）：面板层（初始暴伤→暴击 0.35%/1%、极昼 +40% 暴击 / 无视 20% 防御）'
    + ' + 六条资源循环执行行（锐能→残痕→毁伤→愿火→聚锋→链齿/旗令→愿核→烬痕 60% + 毁伤 35%）+ 招架支援失衡 +50%'
    + ' + 影画 1（残痕效率+10%/120愿火/无视15%火抗）、2（烬痕+20% + 其他招式15%）、4（自身+15%伤害/1000喧响）、6（无视20%防御 + 额外烬灭150%）；C3/C5=技能等级+2。',
  applyPanel: applySunbringerPanel,
  // 兜底池：窗尾秒数优先塞耗能 30 的强化特殊技（见 expandSunbringerBasicFill 注释）
  expandBasicFill: expandSunbringerBasicFill,
  buildCharConfig: buildSunbringerCharConfig,
  buildExecutions: buildSunbringerExecutions,
  patchExecutions: patchSunbringerExecutions,
  // 双锋御共用池：本轮申报（读全队资源结果）+ 下一轮按核定份额写回 cfg（见 gashMaim 头注释）
  buildResourceResult: buildSunbringerResourceResult,
  // 资源卡：残痕·毁伤 / 愿火循环 / 锐能 三张（用户 2026-11-10 报「资源池没展示」）
  resourceSections: buildSunbringerResourceSections,
  nextRoundFeedback: sunbringerNextRoundFeedback,
  applyTeamConfig: applySunbringerTeamConfig,
  // 轴内易伤折算：第二段大招伤害前置 1s、其余为后摇（用户口径 2026-10-30）
  axisMoveDamageSeconds: (moveId: string) =>
    (moveId === SUNBRINGER_ULT_B_MOVE_ID ? SUNBRINGER_ULT_B_DAMAGE_SECONDS : undefined),
  /**
   * ## 二段终结技**不是喧响大**（用户口径 2026-10-31，逐字）
   * > 「挽昼失衡轴第二个大招消耗的资源不是喧响，但却说我喧响不够只打了一个。」
   *
   * 原文链条：一段「此行，共赴前路」消耗 [旗令] → 产出 1 点 [愿核]；二段「此愿，重塑万象」
   * **消耗 [愿核]**（spec 1601「愿核」表：结果行写死「解除二段终结技（不耗喧响）」）。
   * ⇒ 轴栈里二段不得再收 3000 喧响，否则两段会被算成 6000：实测槽0 喧响 7577 只够
   * 一次「一段+二段」组合 ⇒ 第 2/3 窗两段一起被判 `decibel` 跳过（总量 2 发、轴内 1 发）。
   *
   * 两段的关系用**专属资源流向**表达（`axisSwayFlow`）：一段产 1 愿核、二段耗 1 —— 因此
   * 二段也不会在「一段没打出来」的窗口凭空执行（`producesSway` 未发生 ⇒ `swayLeft` 不足 ⇒ 跳过）。
   * ⚠ 只有二段免喧响：一段仍是真正的喧响大（模块资源解也按 `floor(喧响/单价)` 封顶）。
   */
  axisMoveFreeOfDecibel: (moveId: string) => moveId === SUNBRINGER_ULT_B_MOVE_ID,
  settings,
  axisSwayFlow: (moveId: string) => {
    if (moveId === SUNBRINGER_ULT_A_MOVE_ID) return { produce: 1 }
    if (moveId === SUNBRINGER_ULT_B_MOVE_ID) return { cost: 1 }
    return undefined
  },
}
