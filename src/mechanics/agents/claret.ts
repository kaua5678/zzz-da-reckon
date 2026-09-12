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
import type { CharacterResourceResult, ClaretSharpResourceSource } from '@/types/resource'
import { fmt } from '@/utils/format'
import { getAgentSpec } from '@/specs/registry'
import { buildSpecEventExecutions } from '@/specs/mechanics'
import { pickThirdNamedBasicSegment, fusedRowValue } from '@/composables/resourceCalc/helpers'

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
 * 积蓄效率 = 1 + 核心 50% + 影画2 20%（状态近似常驻）。
 * 锐能：进场 +60（勘域 180s 一次 → 每局一次）；秘血铸锋（EX）消耗 60 → 每局 1 发。
 *   —— 旧「2 毁伤/局 → 2.5 锐能放不出 EX」问题由 v12 文本解决（用户 2026-09 口径确认）。
 * 核心被动（猩红铭刻/连携/终结/无垢熔锋期间）：暴击率 +30%、残痕积蓄效率 +50%（满覆盖近似）。
 * 核心被动·初始转化：每 1% 初始暴击伤害 → 初始暴击率 +0.35%（读 outOfCombatPanel，
 *   局内暴伤拐不转化；旧「未建模，初始暴伤≈0」判断已修正——锋御词条第三优先就是暴伤）。
 * 额外能力·血裔传承：全队触发[浸染]时克拉蕾回 300 喧响（20s CD）；队友/自身触发[毁伤]时
 *   全队[锋御]进入[残锋]（锐暴伤害 +25%，40s 刷新）——残锋按自身面板近似（全队锋御同源）。
 * 影画1：猩红铭刻最大持续 +3s（时长无数值影响）；状态期间攻击命中无视 16% 电抗（满覆盖近似）。
 * 影画2：锐暴命中时残痕积蓄效率 +20%（并入积蓄效率倍率）；毁伤伤害倍率 ×130%（执行行 override）。
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
 * @fact agent:1611/锐能·终结技回复 口径: 终结技「血华誓·千锤百炼」发动时 +10 锐能（与进场 60 同为锐能来源；单次上限不参与总量口径，用户 2026-09 裁决） | 据 用户@2026-09-11 | 验 src/mechanics/__tests__/claretSmoke.test.ts | 锚 src/mechanics/agents/claret.ts#SHARPNESS_ULTIMATE_GAIN | 信 确认
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
 * 真正的上限是**消耗需求**（斩金断铁/葬血强袭/影画6 能打几次）。此常量只用于展示与「单次存量」文案。
 */
export const GASH_MAX_STACKS = 3
/** 残余积蓄效率：核心被动 +50%（Lv.7）/ 影画2 锐暴 +20% */
export const GASH_EFF_CORE = 50
export const GASH_EFF_C2 = 20
/** 核心被动（Lv.7）：猩红铭刻/连携/终结/无垢熔锋期间暴击率 +30% */
export const CORE_CRIT_RATE = 30
/** 影画1：状态期间攻击命中无视 16% 电抗 */
export const C1_RES_IGNORE = 16
/** 影画2：毁伤倍率 ×130% */
export const C2_MAIM_MULT = 1.3
/** 影画4：锻星第三段/血契共鸣/千锤百炼 伤害 +20% */
export const M4_DMG_BONUS = 20
export const M4_MOVE_IDS = new Set(['1611007', '1611029', '1611020', '1611021'])
/** 残锋：全队锋御 锐暴伤害 +25%（40s 刷新，满覆盖近似） */
export const RESIDUAL_EDGE_SHARP_CRIT_DMG = 25
/**
 * 核心被动·初始转化：每 1% **初始**暴击伤害 → 初始暴击率 +0.35%。
 *
 * @fact agent:1611/初始暴伤转暴击 口径: 每1%初始暴击伤害→初始暴击率+0.35%（读局外面板 critDmg，局内暴伤拐如珂蕾妲潜能不参与转化）；锋御模板基础暴伤=0，初始暴伤来自副词条/主词条/驱动盘 | 据 nanoka live3.2原文@2026-09（此前误记「未建模，初始暴伤≈0 无影响」——锋御词条优先级第三位就是暴伤，优化器分配后有实际收益） | 验 src/mechanics/__tests__/claretSmoke.test.ts | 锚 src/mechanics/agents/claret.ts#INITIAL_CRIT_DMG_TO_CRIT_RATE | 信 确认
 */
export const INITIAL_CRIT_DMG_TO_CRIT_RATE = 0.35
/** 葬血强袭每施放至多 3 次毁伤（连续 3 段横斩，各命中触发） */
export const BURIAL_MAIM_PER_CAST = 3
/**
 * 猩红铭刻平A基准段：锻星#3（表 id 1611007，531.88%/s、gash 120/s）。
 *
 * @fact agent:1611/平A双基准 口径: 常态平A只能用[血锻四式]（基准=血锻#3 345.21%/s·gash 100/s），[猩红铭刻]下用[锻星]/[伏钺]（基准=锻星#3 531.88%/s·gash 120/s）；两态秒均倍率与残痕积累都不同，引擎单基准段必须按 `claret.inscriptionBasicTimeShare` 加权 | 据 用户@2026-09-11（gachabase 列 gash_buildup 佐证：锻星 120% vs 血锻 100%） | 验 src/mechanics/__tests__/claretSmoke.test.ts | 锚 src/mechanics/agents/claret.ts#INSCRIPTION_BENCHMARK_MOVE_ID | 信 确认
 */
export const INSCRIPTION_BENCHMARK_MOVE_ID = '1611007'
/** 默认铭刻平A时间占比（%）：**0 = 由锐能账本推导**（默认口径，用户 2026-09-11：时间由进次数与锐能账本反推）；1–100 = 手动覆盖。 */
export const DEFAULT_INSCRIPTION_BASIC_TIME_SHARE = 0
/** 猩红铭刻窗口基础时长（秒）——raw `skill.special.description[1]`「进入[猩红铭刻]，持续16秒」 */
export const DEFAULT_INSCRIPTION_WINDOW_SECONDS = 16
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

function findMoveById(skills: AgentSkills | undefined, moveId: string): SkillMove | null {
  if (!skills) return null
  for (const category of skills.categories) {
    const move = category.moves.find(item => item.id === moveId)
    if (move) return move
  }
  return null
}

function getRowValue(move: SkillMove | null | undefined, rowId: string): number {
  if (!move) return 0
  return move.rows.find(row => row.id === rowId)?.values[0] ?? 0
}

/** 招式某行的秒均（行值 / actionTime；无动作时间 → 0）。 */
function perSeconds(move: SkillMove | null | undefined, rowId: string): number {
  const at = move?.actionTime ?? 0
  return at > 0 ? getRowValue(move, rowId) / at : 0
}

function cfgSetting(cfg: AgentCharConfigInput['cfg'], id: string, fallback: number): number {
  const record = cfg as unknown as Record<string, unknown>
  const value = record[`setting:${id}`]
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function applyClaretPanel({ panel, cinemaLevel, outOfCombatPanel }: AgentPanelInput): void {
  // 核心被动·初始转化：每 1% 初始暴击伤害 → 初始暴击率 +0.35%。
  // 初始口径 → 只读局外面板（珂蕾妲潜能等局内暴伤拐不参与转化）；基础暴伤 0，收益全来自副/主词条。
  const initialCritDmg = Number(outOfCombatPanel?.critDmg ?? 0)
  if (initialCritDmg > 0) {
    panel.critRate = (panel.critRate ?? 0) + initialCritDmg * INITIAL_CRIT_DMG_TO_CRIT_RATE
  }
  // 核心被动 Lv.7：猩红铭刻/连携/终结/无垢熔锋期间 暴击率 +30%（状态高频维持，满覆盖近似）
  panel.critRate = (panel.critRate ?? 0) + CORE_CRIT_RATE
  // 残锋：队友/自身触发[毁伤]后全队锋御 锐暴伤害 +25%（40s 刷新；按自身面板近似）
  panel.sharpCritDmg = (panel.sharpCritDmg ?? 0) + RESIDUAL_EDGE_SHARP_CRIT_DMG
  // 影画1：猩红铭刻/连携/终结/无垢熔锋期间攻击命中无视 16% 电抗（状态高频维持，满覆盖近似）
  if ((cinemaLevel ?? 0) >= 1) {
    panel.enemyElectricResReduction = (panel.enemyElectricResReduction ?? 0) + C1_RES_IGNORE
  }
}

/**
 * 克拉蕾残痕/锐能资源（v12）：
 * **残痕值 = 平A聚合（两态秒均 × 平A时间）+ Σ 其余招式实打次数 × 该招 `gash_buildup` 表值**
 *   （2026-09-12 用户更正的口径：闪反/连携/终结/支援突击/反制支援… 每招都在实打实积累，
 *    旧实现只算平A+EX 且 EX 错读 `anomaly_buildup` 列，低估一大截）→ × 积蓄效率；
 * 每 600 点 = 1 层；**`GASH_MAX_STACKS=3` 是敌人身上同时存量的上限，不是整局次数上限**
 *   （全局计算器按总量走：攒够就消耗，一局毁伤次数 = min(总层数, 消耗需求)，不被 3 钳死）；
 * 反制支援整组化解控制技时，琢形「直接添加1层」= 每组 +600 点、**不吃积蓄效率倍率**（送层不是积累）；
 * 毁伤需求 = 斩金断铁×1 + 葬血强袭×3 + 影画6(连携+终结)；毁伤 = min(层数, 需求) × 覆盖率 + 影画6 直接毁伤；
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
}): ClaretSharpResourceSource {
  const cinemaLevel = Math.max(0, Math.floor(input.cinemaLevel ?? 0))
  // 平A = 秒均×时间（两态加权）；**其余全部招式** = Σ 实打次数 × 表列 `gash_buildup`
  // （2026-09-12 用户更正：每招都在实打实积累，旧实现只算平A+EX 且 EX 那项错读了 `anomaly_buildup` 列）
  const moveGashTotal = Math.max(0, Number(input.moveGashTotal ?? 0))
  const baseGash = Math.max(0, input.basicGashPerSec * input.basicAttackTime) + moveGashTotal
  const buildupMultiplier = 1 + GASH_EFF_CORE / 100 + (cinemaLevel >= 2 ? GASH_EFF_C2 / 100 : 0)
  // 直接送的层**不进**积蓄效率倍率（原文是「添加1层」，不是「积累残痕值」；
  // 表列 gash_buildup（本体 446 + 琢形 134）按全角色同口径仍不计——只认这一条明写的赠送）。
  //
  // @fact agent:1611/琢形送残痕 口径: 反制支援整组化解一组控制技 = 琢形「重击命中直接为目标添加1层[残痕]」→ 每组 +600 点**且不吃积蓄效率倍率**（送层不是积累），仍受 3 层上限；表列 gash_buildup（1611028=446 / 1611030=134）按「非平A非E 不计」的全局同口径仍不计入 | 据 用户@2026-09-12（「残痕建模一下，他的确是送了」）+ nanoka full/1611.json 琢形条目 | 验 src/mechanics/__tests__/claretSmoke.test.ts::反制支援送残痕 | 锚 src/mechanics/agents/claret.ts#computeClaretSharpResource | 信 确认
  const counterAssistGashStacks = Math.max(0, Math.floor(input.counterAssistCount ?? 0))
  const gashValuePct = baseGash * buildupMultiplier + counterAssistGashStacks * GASH_PER_LAYER
  // 整局可用层数**不设 3 钳制**：3 层是敌人身上的同时存量上限（见 GASH_MAX_STACKS 注释），
  // 总量口径下攒够就消耗、消耗完继续攒，真正的上限是下面的消耗需求次数（斩金断铁/葬血强袭/影画6）。
  const gashStacks = Math.max(0, Math.floor(gashValuePct / GASH_PER_LAYER))
  const cleaveCount = Math.max(0, Math.floor(input.cleaveSpecialCount))
  const burialCount = Math.max(0, Math.floor(input.bloodBurialCount))
  const c6Extra = cinemaLevel >= 6
    ? Math.max(0, Math.floor(Number(input.chainCountTotal ?? 0))) + Math.max(0, Math.floor(Number(input.ultimateCount ?? 0)))
    : 0
  const maimDemand = cleaveCount + burialCount * BURIAL_MAIM_PER_CAST + c6Extra
  const coverage = Math.max(0, Math.min(1, input.gashCoverage))
  const gashStackConsumed = Math.min(gashStacks, Math.max(0, maimDemand)) * coverage
  const maimFromCleave = Math.min(gashStackConsumed, cleaveCount)
  const maimFromBurial = Math.min(gashStackConsumed - maimFromCleave, burialCount * BURIAL_MAIM_PER_CAST)
  const maimCount = Math.floor(gashStackConsumed) + c6Extra
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
    sharpnessGain,
    affordableExCount,
    sharpnessSpend,
    sharpnessRemaining: Math.max(0, sharpnessGain - sharpnessSpend),
    note: 'v12 口径：残痕值 = 平A（两态秒均×时间）+ 其余全部招式（实打次数 × gash_buildup 表值）→ × 积蓄效率，每 600 点 = 1 层；3 层是敌人身上同时存量上限、不是整局毁伤次数上限（毁伤 = min(总层数, 消耗需求) × 覆盖率）；斩金断铁×1/葬血强袭×3 命中残痕各消耗 1 层触发毁伤；反制支援整组化解控制技时琢形「重击命中直接添加 1 层残痕」（每组 +600 点、不吃积蓄效率倍率，与招式自身表值积累是两件事）；锐能 = 进场 60（勘域 180s 一次）+ 终结技 10/次，秘血铸锋 60/发。',
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
function computeClaretBasicPerSecFromCfg(record: Record<string, unknown>, share: number) {
  const skills = record.claretSkills as AgentSkills | undefined
  return computeClaretBasicPerSec(
    findMoveById(skills, String(record.claretNormalBenchmarkMoveId ?? '')),
    findMoveById(skills, String(record.claretInscriptionBenchmarkMoveId ?? '')),
    share,
  )
}

function buildClaretCharConfig({ agent, skills, cinemaLevel, cfg }: AgentCharConfigInput): void {
  const record = cfg as unknown as Record<string, unknown>
  record.claretSkills = skills
  record.claretMaimMoveId = findMoveById(skills, MAIM_MOVE_ID)?.id ?? ''
  record.claretBloodBurialMoveId = findMoveById(skills, BLOOD_BURIAL_MOVE_ID)?.id ?? ''
  record.claretExMoveId = findMoveById(skills, EX_MOVE_ID)?.id ?? ''
  record.claretExDamageMultiplier = getRowValue(findMoveById(skills, EX_MOVE_ID), 'damage') || 1249.6
  /**
   * 残痕积累表（moveId → 该招一发的 `gash_buildup` 点数）——**平A 段不入表**：
   * 平A 按两态秒均 × 平A时间 计（见 `computeClaretBasicPerSec`），再按行计就是双计。
   * 融合组走 `fusedRowValue`（反制支援 = 本体 446 + 琢形 134 = 580/次，一次动作一次积累）。
   * ⚠️ 历史坑（2026-09-12 更正）：这里原先只取秘血铸锋一发、且读的是 `anomaly_buildup` 列
   *   （234.96，真值 = `gash_buildup` 281.97）——列名混淆的老病根，见 GAME_TERM_TO_CODE_FIELD §11.1。
   */
  const gashByMoveId: Record<string, number> = {}
  for (const cat of skills.categories) {
    if (cat.id === 'basic') continue
    for (const m of cat.moves ?? []) {
      const v = fusedRowValue(skills, String(m.id), 'gash_buildup') ?? getRowValue(m, 'gash_buildup')
      if (v > 0) gashByMoveId[String(m.id)] = v
    }
  }
  record.claretGashByMoveId = gashByMoveId
  record.claretMaimDamageMultiplier = getRowValue(findMoveById(skills, MAIM_MOVE_ID), 'damage') || 1625.6
  record.claretBloodBurialDamageMultiplier = getRowValue(findMoveById(skills, BLOOD_BURIAL_MOVE_ID), 'damage') || 626.3
  // 平A两态基准（秒均）：常态=血锻基准段、猩红铭刻=锻星#3（用户口径 2026-09-11）
  record.claretNormalBenchmarkMoveId = resolveNormalBenchmark(skills)?.id ?? ''
  record.claretInscriptionBenchmarkMoveId = INSCRIPTION_BENCHMARK_MOVE_ID
  // 锐能收入两条腿（用户口径 2026-09-11）：
  //   ① 基础**自动累积** 1.5/s（不进招式表，来自 catalog `level60.sharpnessRegen` ← nanoka `stats.ep_recover`/100）
  //   ② 常态血锻四式的招式增益（`sharpness_gain` 列 3.0/s；锻星/E/连携全 0）
  record.claretSharpnessAutoPerSec = Math.max(0, Number(agent?.level60?.sharpnessRegen ?? 0))
  record.claretNormalAttackSharpnessPerSec = perSeconds(resolveNormalBenchmark(skills), 'sharpness_gain')
  record.claretNormalSharpnessPerSec = Number(record.claretSharpnessAutoPerSec)
    + Number(record.claretNormalAttackSharpnessPerSec)
  // 窗口覆盖率项要用的动作时长（停表口径：连携/终结发动期间窗口不减 = 等价白送该动作时长）
  const chainMove = findMoveById(skills, CHAIN_MOVE_ID)
  const ultMove = findMoveById(skills, ULTIMATE_MOVE_ID)
  record.claretChainActionSeconds = chainMove?.actionTime ?? 0
  record.claretUltimateActionSeconds = ultMove?.actionTime ?? 0
  // 面板滑块：0 = 账本推导（默认），1–100 = 手动覆盖（见 deriveClaretTwoStateTime）
  record.claretInscriptionShareSetting = Math.max(
    0,
    Math.min(100, cfgSetting(cfg, 'claret.inscriptionBasicTimeShare', DEFAULT_INSCRIPTION_BASIC_TIME_SHARE)),
  )
  record.claretChainInWindowCoverage = Math.max(
    0,
    Math.min(1, cfgSetting(cfg, 'claret.chainInWindowCoverage', DEFAULT_CHAIN_IN_WINDOW_COVERAGE * 100) / 100),
  )
  // 静态初值（账本推导时常态时间 = 0 → 整段铭刻）；真实占比在 buildClaretResourceSource 里按账本重算
  const bench = computeClaretBasicPerSecFromCfg(record, 1)
  record.claretInscriptionBasicTimeShare = 1
  record.claretBasicDamagePerSec = bench.damage
  record.claretBasicDazePerSec = bench.daze
  record.claretBasicGashPerSec = bench.gash
  record.claretNormalDamagePerSec = bench.normalDamage
  record.claretInscriptionDamagePerSec = bench.inscriptionDamage
  record.claretCinemaLevel = cinemaLevel
  record.claretCleaveCount = Math.max(0, Math.floor(cfgSetting(cfg, 'claret.cleaveSpecialCount', 1)))
  record.claretBloodBurialCount = Math.max(0, Math.floor(cfgSetting(cfg, 'claret.bloodBurialCount', 1)))
  record.claretGashCoverage = Math.max(0, Math.min(1, Math.min(100, cfgSetting(cfg, 'claret.gashCoverage', 100)) / 100))
  // 秘血铸锋是锐能强特（costType=resource）：通用引擎不扣能量，强特行由本模块按锐能账本发行
  const exMove = findMoveById(skills, EX_MOVE_ID)
  record.claretExActionTime = exMove?.actionTime ?? 0
  record.claretExDecibelRecovery = getRowValue(exMove, 'decibel_recovery')
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
}): {
  normalBasicTimeNeeded: number
  inscriptionTime: number
  share: number
  source: 'ledger' | 'manual'
  entries: number
  farmSecondsPerEntry: number
  extensionSeconds: number
  sharpnessTotal: number
  /** 该轮数下账本能支撑的进场次数（应 ≥ entries，即自洽） */
  affordableExCountAtSolve: number
} {
  const basicAttackTime = Math.max(0, Number(input.basicAttackTime ?? 0))
  const normalPerSec = Math.max(0, Number(input.normalSharpnessPerSec ?? 0))
  const autoPerSec = Math.max(0, Number(input.sharpnessAutoPerSec ?? 0))
  const extensionSeconds = Math.max(0, Number(input.totalExtensionSeconds ?? 0))
  // 自动累积按**接战时间**（前后台都回），不是平A时间
  const combatTime = Math.max(0, Number(input.combatTime ?? basicAttackTime))
  // farm 只作「够不够打出下一发」的判据（按常态速率），**不是**常态时间的长度
  const farmSecondsPerEntry = normalPerSec > 0 ? SHARPNESS_PER_ENTRY / normalPerSec : 0

  // 铭刻窗口可变长，延长量按**全局总额**计入（用户口径 2026-09-11：不算「每度窗口摊多少连携」）。
  //  铭刻总时间 = N × 16s + 总延长秒
  //  常态时间   = 平A总时间 − 铭刻总时间
  //  锐能总量   = 自动累积 × **接战时间**（前后台都回，含铭刻态）+ 血锻增益 × 常态时间
  // 轮数 N 取最大可行解：铭刻时间塞得进平A时间，且锐能总量 ≥ N×60。
  // 注意自动累积在铭刻内也产 ⇒ N 越大锐能越多（正反馈），故从 1 往上逐轮试。
  let n = 1
  while (n < MAX_INSCRIPTION_ENTRIES) {
    const k = n + 1
    const inscriptionTime = k * DEFAULT_INSCRIPTION_WINDOW_SECONDS + extensionSeconds
    if (inscriptionTime > basicAttackTime + 1e-9) break
    const normalTime = basicAttackTime - inscriptionTime
    const available = autoPerSec * combatTime + (normalPerSec - autoPerSec) * normalTime
    if (available + 1e-9 < k * SHARPNESS_PER_ENTRY) break
    n = k
  }
  const inscriptionTime = Math.min(basicAttackTime, n * DEFAULT_INSCRIPTION_WINDOW_SECONDS + extensionSeconds)
  const ledgerNormalTime = Math.max(0, basicAttackTime - inscriptionTime)
  const ledgerShare = basicAttackTime > 0 ? Math.min(1, inscriptionTime / basicAttackTime) : 0
  const setting = Number(input.inscriptionTimeShareSetting)
  const manual = Number.isFinite(setting) && setting > 0
  const share = manual ? Math.max(0.01, Math.min(1, (setting as number) / 100)) : ledgerShare
  const normalTime = manual ? basicAttackTime * (1 - share) : ledgerNormalTime
  const sharpnessTotal = autoPerSec * combatTime + (normalPerSec - autoPerSec) * normalTime
  return {
    normalBasicTimeNeeded: normalTime,
    inscriptionTime: Math.max(0, basicAttackTime - normalTime),
    share,
    source: manual ? 'manual' : 'ledger',
    entries: manual ? Math.max(1, Math.max(0, basicAttackTime - normalTime) / DEFAULT_INSCRIPTION_WINDOW_SECONDS) : n,
    farmSecondsPerEntry,
    extensionSeconds,
    sharpnessTotal,
    affordableExCountAtSolve: Math.floor(sharpnessTotal / SHARPNESS_PER_ENTRY),
  }
}

/**
 * 全局总延长秒：连携 ×2s/次 + **非强化招式不占强化时间**的白送时长。
 *
 * @fact agent:1611/铭刻窗口·停表 口径: 停表覆盖率 100%——铭刻时间**只被吃强化的招式（血锻/锻星/E）消耗**；连携技/终结技**不吃强化**（伤害不随态变化，所以也不消耗强化时间），其动作时长全额等价于延长窗口；连携另按 raw 送 +2s/次 | 据 用户@2026-09-11「连携大招不分强化态，这些招式不掉时间，是因为它没有消耗强化时间进行招式强化」 | 验 src/mechanics/__tests__/claretSmoke.test.ts | 锚 src/mechanics/agents/claret.ts#computeInscriptionExtension | 信 确认
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
  const record = cfg as unknown as Record<string, unknown>
  const ultimateCount = Math.max(0, Math.floor(Number(state.ultimateCount ?? 0)))
  // 全局总延长秒（总额口径，不算每窗摊多少连携）：连携×2s + 停表白送时长
  const stopwatchCoverage = Math.max(0, Math.min(1, Number(record.claretChainInWindowCoverage ?? DEFAULT_CHAIN_IN_WINDOW_COVERAGE)))
  const totalExtensionSeconds = computeInscriptionExtension({
    chainCount: Math.max(0, Number(state.chainCountTotal ?? 0)),
    chainActionSeconds: Number(record.claretChainActionSeconds ?? 0),
    ultimateCount,
    ultimateActionSeconds: Number(record.claretUltimateActionSeconds ?? 0),
    stopwatchCoverage,
  })
  // 两态时间：账本推导（滑块 0 = auto）
  const basicAttackTime = Math.max(0, Number(state.basicAttackTime ?? 0))
  // 接战时间：优先读 state.frontlineTime；缺省 = 平A + 必要（同一口径）
  const combatTime = Math.max(
    basicAttackTime,
    Number(state.frontlineTime ?? 0) || (basicAttackTime + Math.max(0, Number(state.necessaryTime ?? 0))),
  )
  const twoState = deriveClaretTwoStateTime({
    basicAttackTime,
    ultimateCount,
    normalSharpnessPerSec: Number(record.claretNormalSharpnessPerSec ?? 0),
    sharpnessAutoPerSec: Number(record.claretSharpnessAutoPerSec ?? 0),
    totalExtensionSeconds,
    combatTime,
    inscriptionTimeShareSetting: Number(record.claretInscriptionShareSetting ?? 0),
  })
  // EX 发数 = 循环轮数（每轮 = 一次 EX 进场；窗口内也在回锐能，故轮数由上面的双约束解出）
  const affordableExCount = Math.max(0, Math.floor(twoState.entries))
  const blended = computeClaretBasicPerSecFromCfg(record, twoState.share)
  // ── 残痕：平A 之外的**全部招式**按「本局实打次数 × 该招 `gash_buildup` 表值」累加 ──
  // 次数取**引擎发行那些行时读的同一批字段**，不去翻已生成的行：模块的 buildExecutions 钩子在
  // 闪反/弹刀/支援突击/反制支援行**之前**派发（core/resource/helpers#buildExecutions 的顺序），
  // 按行求和会随调用点漏项。平A 段不入这张表（按两态秒均×时间算，再按行算=双计）。
  // 无物化行的交互（快速支援）不计积累 —— 与伤害/失衡侧同一近似。
  const gashByMoveId = (record.claretGashByMoveId ?? {}) as Record<string, number>
  const gashOf = (moveId: string | undefined) => (moveId ? gashByMoveId[moveId] ?? 0 : 0)
  const moveGashTotal
    = gashOf(cfg.exSpecialMoveId) * affordableExCount
    + gashOf(cfg.dodgeCounterMoveId) * Math.max(0, cfg.dodgeCounterCount ?? 0)
    + gashOf(cfg.defensiveAssistMoveId) * (Math.max(0, cfg.parryCount ?? 0) + Math.max(0, cfg.parryNoFollowUpCount ?? 0))
    + gashOf(cfg.assistFollowUpMoveId) * Math.max(0, cfg.parryCount ?? 0)
    + gashOf(cfg.counterAssistMoveId) * Math.max(0, Math.floor(cfg.counterAssistCount ?? 0))
    + gashOf(cfg.ultimateMoveId) * Math.max(0, state.ultimateCount ?? 0)
    + gashOf(cfg.chainMoveId) * Math.max(0, cfg.chainCountTotalOverride ?? state.chainCountTotal ?? 0)
  return computeClaretSharpResource({
    basicGashPerSec: blended.gash,
    basicAttackTime: Math.max(0, Number(state.basicAttackTime ?? 0)),
    moveGashTotal,
    cleaveSpecialCount: Number(record.claretCleaveCount ?? 0),
    bloodBurialCount: Number(record.claretBloodBurialCount ?? 0),
    gashCoverage: Number(record.claretGashCoverage ?? 1),
    cinemaLevel: Number(record.claretCinemaLevel ?? 0),
    chainCountTotal: state.chainCountTotal ?? 0,
    ultimateCount,
    basicDamagePerSec: blended.damage,
    basicDazePerSec: blended.daze,
    inscriptionBasicTimeShare: twoState.share,
    inscriptionBasicTimeShareSource: twoState.source,
    normalBasicTimeNeeded: twoState.normalBasicTimeNeeded,
    inscriptionBasicTime: twoState.inscriptionTime,
    derivedInscriptionTimeShare: twoState.share,
    normalSharpnessPerSec: Number(record.claretNormalSharpnessPerSec ?? 0),
    combatTime,
    sharpnessAutoPerSec: Number(record.claretSharpnessAutoPerSec ?? 0),
    normalAttackSharpnessPerSec: Number(record.claretNormalAttackSharpnessPerSec ?? 0),
    inscriptionEntries: twoState.entries,
    inscriptionWindowSeconds: twoState.extensionSeconds,
    sharpnessPerEntry: SHARPNESS_PER_ENTRY,
    affordableExCountOverride: affordableExCount,
    // 反制支援（boss 控制技整组化解，store 折算注入 cfg）→ 琢形每次直接送 1 层残痕
    counterAssistCount: Math.max(0, Math.floor(Number(cfg.counterAssistCount ?? 0))),
  })
}

function buildClaretResourceResult({ cfg, state }: AgentResourceResultInput): Partial<CharacterResourceResult> {
  return {
    claretSharpResourceSource: buildClaretResourceSource(cfg, state),
  }
}

function buildClaretExecutions({ cfg, state, executions }: AgentResourceInput): void {
  const record = cfg as unknown as Record<string, unknown>
  const cinemaLevel = Math.max(0, Math.floor(Number(record.claretCinemaLevel ?? 0)))
  // 残痕值来源：平A（两态秒均×时间）+ 其余全部招式（实打次数 × gash_buildup 表值）
  const source = buildClaretResourceSource(cfg, state)
  // 平A双基准覆盖：引擎只认一个基准段（默认血锻#3），但克拉蕾常态/铭刻两态招式不同
  // → 用账本推导出的铭刻时间占比加权出的秒均覆盖（enrich 见 damageMultiplierOverride 分支）
  const basicRow = executions.find(e => e.moveId === 'basic_attack')
  if (basicRow) {
    const share = source.inscriptionBasicTimeShare
    const normalDps = Number(record.claretNormalDamagePerSec ?? 0)
    const inscriptionDps = Number(record.claretInscriptionDamagePerSec ?? 0)
    const blendedDps = share * inscriptionDps + (1 - share) * normalDps
    basicRow.damageMultiplier = blendedDps
    basicRow.dazeMultiplier = Number(record.claretBasicDazePerSec ?? 0)
    basicRow.anomalyBuildUp = source.basicGashPerSec
    basicRow.totalAnomalyBuildUp = source.basicGashPerSec * Math.max(0, basicRow.totalTime ?? 0)
    basicRow.damageMultiplierOverride = true
    basicRow.dazeMultiplierOverride = true
    const sourceNote = `（${source.inscriptionBasicTimeShareSource === 'ledger' ? '账本推导' : '手动覆盖'}）`
    basicRow.skillTableNote = `平A双基准${sourceNote}：铭刻占比 ${fmt(share * 100)}%（常态 ${fmt(normalDps)}%/s 血锻四式 · 铭刻 ${fmt(inscriptionDps)}%/s 锻星）· 加权 ${fmt(blendedDps)}%/s · 残痕 ${fmt(source.basicGashPerSec)}%/s`
  }
  const exCount = Math.max(0, Math.floor(source.affordableExCount))
  if (exCount > 0) {
    executions.push({
      moveId: EX_MOVE_ID,
      moveName: '强化特殊技（EX Special）：秘血铸锋（锐能 60/发）',
      category: 'special',
      count: exCount,
      actionTime: Number(record.claretExActionTime ?? 0),
      comboAlignRatio: 0,
      totalTime: exCount * Number(record.claretExActionTime ?? 0),
      totalComboAlignTime: 0,
      energyConsume: 0,
      totalEnergyConsume: 0,
      decibelRecovery: Number(record.claretExDecibelRecovery ?? 0),
      totalDecibelRecovery: exCount * Number(record.claretExDecibelRecovery ?? 0),
      energyRecovery: 0,
      totalEnergyRecovery: 0,
      timeBucket: 'necessary',
    })
  }
  const spec = getAgentSpec(CLARET_AGENT_ID)
  if (!spec) return
  const generated = buildSpecEventExecutions(spec, {
    cfg,
    state,
    counts: {
      claretCleaveCount: Math.max(0, Math.floor(Number(record.claretCleaveCount ?? 0))),
      claretBloodBurialCount: Math.max(0, Math.floor(Number(record.claretBloodBurialCount ?? 0))),
      claretMaimCount: Math.max(0, Math.floor(source.maimCount)),
      claretMaimFromCleave: Math.max(0, Math.floor(source.maimFromCleave)),
      claretMaimFromBurial: Math.max(0, Math.floor(source.maimFromBurial)),
      claretMaimFromC6: Math.max(0, Math.floor(source.maimFromC6)),
    },
    overrides: {
      claret_maim: { multiplier: Number(record.claretMaimDamageMultiplier ?? 1625.6) * (cinemaLevel >= 2 ? C2_MAIM_MULT : 1) },
      claret_blood_burial: { multiplier: Number(record.claretBloodBurialDamageMultiplier ?? 626.3) },
    },
    getRowValue: (moveId, rowId) => (rowId === 'damage' ? Number((cfg as any).mechanicRowValues?.[moveId] ?? 0) : 0),
  })
  executions.push(...generated)
}

function patchClaretExecutions({ cfg, state: _state, executions }: AgentResourceInput): void {
  const record = cfg as unknown as Record<string, unknown>
  const cinema = Math.max(0, Math.floor(Number(record.claretCinemaLevel ?? 0)))
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
        { label: '积蓄效率', value: `×${fmt(source.gashBuildupMultiplier)}`, detail: `1 + 核心 50%（Lv.7）+ 影画2 20%` },
        ...(source.counterAssistGashStacks
          ? [{
              label: '反制支援送层',
              value: `+${source.counterAssistGashStacks} 层`,
              detail: `整组化解 ${source.counterAssistGashStacks} 组控制技，琢形「重击命中直接添加 1 层[残痕]」（不吃积蓄效率倍率）`,
            }]
          : []),
        { label: '毁伤需求', value: `${source.maimDemand} 次`, detail: '斩金断铁×1 + 葬血强袭×3 + 影画6(连携+终结)×1' },
        { label: '残痕消耗', value: `-${Math.floor(source.gashStackConsumed)} 层`, detail: '命中残痕状态敌人，每层一次毁伤（覆盖率折算）' },
        { label: '毁伤触发', value: `${source.maimCount} 次`, detail: `斩金断铁 ${source.maimFromCleave} + 葬血强袭 ${source.maimFromBurial} + 影画6 ${source.maimFromC6}` },
      ],
      footer: `v12：残痕值 = 平A（两态秒均×时间）+ 其余招式（实打次数 × gash_buildup 表值），每 600 点 = 1 层（用户口径）；敌人身上同时最多挂 ${GASH_MAX_STACKS} 层，但整局可用层数不钳制（攒够就消耗，毁伤上限是消耗需求次数）；反制支援化解控制技时琢形**额外直接送 1 层/组**（送层不吃积蓄效率，与招式自身的表值积累是两件事）；快速支援等无物化行的交互不计积累。`,
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
        { label: '铭刻平A时间', value: `${fmt(source.inscriptionBasicTime)}s`, detail: `= 轮数 × 窗口 ${fmt(source.inscriptionWindowSeconds)}s` },
        { label: '平A秒均', value: `${fmt(source.basicDamagePerSec)}%/s`, detail: `常态 345.21（血锻#3）×${fmt((1 - source.inscriptionBasicTimeShare) * 100)}% + 铭刻 531.88（锻星#3）×${fmt(source.inscriptionBasicTimeShare * 100)}%` },
      ],
      footer: `常态只能打血锻四式、锻星是猩红铭刻专属（用户口径 2026-09-11）；两态平A秒均与残痕积累都不同，按时间占比加权。锐能自动回复按公告列 sharpness_gain（血锻 3.0/s、锻星 0）计入总账。窗口 ${fmt(source.inscriptionWindowSeconds)}s 为 raw 基础时长（连携 +2s/次、击杀延长 3s/ICD 未逐秒建模）。状态符（核心 +30% 暴击/+50% 积蓄/C1 16% 电抗）仍按满覆盖计。`,
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
    description: '手法（用户 2026-09-03）：失衡外离散的短按E 结算残痕（命中残痕敌 → 1 次毁伤）；默认每轮 1 次。',
    default: 1,
    min: 0,
    max: 20,
    step: 1,
    suffix: '次',
  },
  {
    id: 'claret.bloodBurialCount',
    label: '克拉蕾葬血强袭（长按E）次数',
    description: '手法（用户 2026-09-03）：失衡轴内用长按E 结算残痕（每施放至多 3 次毁伤，3 段横斩各命中触发）；默认每轮 1 次。',
    default: 1,
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
  description: 'v12：锐化伤害积累残痕值（每600点=1层，上限3），斩金断铁/葬血强袭消耗残痕触发毁伤；锐能进场60/秘血铸锋60发；核心被动暴击率+30%与残锋锐暴+25%；影画1电抗无视16%、2毁伤×130%、4+20%、6直接毁伤。',
  applyPanel: applyClaretPanel,
  buildCharConfig: buildClaretCharConfig,
  buildExecutions: buildClaretExecutions,
  patchExecutions: patchClaretExecutions,
  buildResourceResult: buildClaretResourceResult,
  resourceSections: buildClaretResourceSections,
  settings,
}
