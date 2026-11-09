import type {
  AgentCharConfigInput,
  AgentDamageResolution,
  AgentDamageResolutionInput,
  AgentMechanicModule,
  AgentPanelInput,
  AgentResourceInput,
  AgentResourceResultInput,
  AgentResourceSectionsInput,
  AgentSkillTransformInput,
  AgentTeamPanelEffectInput,
  ExtraNecessaryAction,
  ReadonlyTeam,
} from '../types'
import type {
  CharacterOperationConfig,
  IterationState,
  SpecialResourceSection,
} from '@/types/resource'
import { fmt } from '@/utils/format'
import { getAgentSpec } from '@/specs/registry'
import { computeSpecResources } from '@/specs/resources'
import { additionalAbilityActiveOf } from '@/core/additionalAbilityActive'
import { findMoveById } from '@/data/moveTableQueries'
import { mechanicSettingReader, capOfAuto } from '@/utils/mechanicSettingCfg'
import { cfgMoveActionTime } from '@/utils/moveActionTimeCfg'
import { chargeLockComboAlignRatio } from '@/mechanics/chargeLock'
import { moduleExecRow, RECOVERY_OFF, ENERGY_RECOVERY_OFF } from '@/mechanics/moduleExecRow'
import { cinemaLevelOf } from '@/data/cinemaLevel'
import type { AgentNextRoundFeedbackInput } from '../types'

const setting = mechanicSettingReader(() => miyabiMechanic.settings)
const MIYABI_AGENT_ID = '1091'
/** 烈霜元素（独立元素，可在紊乱中与冰互紊） */
const FROSTFIRE = 'frostfire'
/** 霜月架势三段（最赚，消耗6落霜） */
const FROST_MOON_MOVE_ID = '1091029'
/** 0命且无风队时冰焰覆盖率的自动默认：手法上总是打出霜寒后才够6豆，三段蓄力全打在[霜寒]上，全吃不到 80% 加成（用户口径） */
/**
 * C0 的冰焰覆盖率（**招式级区分**，用户口径 2026-10-24）。
 *
 * 「设 C0 只玩快速玩法，就可以直接进行招式级区分了，**拔刀吃不到，其他全吃**。这样也不用管覆盖率。」
 *
 * ⇒ C0 的面板层按**全程有冰焰**给（= 1），再由 `transformMiyabiSkillExecutions` 把霜月三段
 *   （拔刀，1091027/1028/1029）那一行的加成**扣回去**——拔刀总打在霜灼上（本轮霜寒已消掉冰焰）。
 *
 * 为什么这样可以不建覆盖率模型：C0 的差异化玩法（慢循环、长时间霜灼态）属于「玩家自选打法」，
 * 建模面按快循环（默认强玩法）钉死；慢循环用户可用 `miyabi.iceFlameCoverage` 滑块下调。
 * 招式级区分让「哪一种招吃得到」由机制决定，不再靠一个全局百分比猜。
 */
const MIYABI_C0_ICEFLAME_DEFAULT_COVERAGE = 1
/** 霜月架势三段消耗落霜 */
const FROST_MOON_COST = 6
/**
 * 一局最多能打出的霜月三段（拔刀）次数 —— **时间约束下的实测上限**，不是资源上限。
 *
 * @fact agent:1091/霜月次数上限 口径: 默认 19 次/局（顶尖玩家实测上限，时间约束；资源回复会溢出，落霜总量不是瓶颈） | 据 用户@2026-10-24 | 验 src/mechanics/__tests__/miyabiFrostFallSources.test.ts | 锚 src/mechanics/agents/miyabi.ts#FROST_MOON_COUNT_DEFAULT_CAP | 信 确认
 * ⟳复核: 若官方改版/新手法使一局拔刀上限变化（或战斗时长档改变），改本常量并同步滑块默认 | 到期 2027-04-30
 *
 * 为什么必须有这道闸：落霜改真口径后 C2 队的落霜总量可达 100+ ⇒ floor(/6) 会给出 17~20 次，
 * 而 180s 里每次霜月独占 1s 锁定 + 收招，实际打不出那么多；不封顶会把「资源溢出」当成「能打出」。
 */
const FROST_MOON_COUNT_DEFAULT_CAP = 19
/** 冰焰积蓄效率 = 暴击率×100%，上限80% */
const ICE_FLAME_BUILDUP_MAX = 80

/** 霜月三段（拔刀）的全部 moveId —— C0 口径下这几行**永远吃不到**冰焰（总打在霜灼上） */
const FROST_MOON_ALL_MOVE_IDS: ReadonlySet<string> = new Set(['1091027', '1091028', '1091029'])
/** 额外能力：霜月伤害+60% */
const FROST_MOON_DMG_BONUS = 60
/** 额外能力：霜月架势期间无视30%冰抗（每次紊乱触发） */
const FROST_MOON_ICE_RES_IGNORE = 30
/** 霜灼·破倍率（Lv.7 最高，毕业终局战斗） */
const FROSTBURN_BREAK_MULTIPLIER = 1500
/** 霜灼·破 10s CD（原文 passive.level.1091507.desc[0] 末句「10秒内最多触发一次」） */
const FROSTBURN_BREAK_CD_SECONDS = 10
/** 入场落霜（基础技 skill.basic.description：「进入战场时，星见雅立刻获得3点[落霜]」） */
const BASE_ENTRY_FROST_FALL = 3
/** 入场落霜（影画二 talent.2.desc：「进入战场时，星见雅立刻获得6点[落霜]」，替换基础的 3 点） */
const C2_ENTRY_FROST_FALL = 6
/** C2：暴击率+15% */
const C2_CRIT_RATE = 15
/** C2：风花/闪避反击伤害+30% */
const C2_NA_AND_DODGE_COUNTER_DMG = 30
/** C4：霜灼·破伤害+30% */
const C4_FROSTBURN_DMG = 30
/** C4：霜灼·破额外喧响 */
const C4_FROSTBURN_DECIBEL = 250
/** 核心被动「寒炎」：霜灼状态下所有单位（全队）属性异常积蓄效率 +20%（Lv.7，F2 裁决 2026-09-25 改全队） */
const FROSTBURN_TEAM_BUILDUP_BONUS = 20
/** C6：极意霜月伤害+30% */
const C6_FROST_MOON_DMG = 30
/** 霜月 #1 move id（C6 赠送） */
const FROST_MOON_1_MOVE_ID = '1091027'
/** 霜月 #2 move id（C6 赠送） */
const FROST_MOON_2_MOVE_ID = '1091028'
/** 霜月 #3 合轴锁定时间（秒）：非6命蓄力1秒后即可合轴 */
/** 霜月 #3 蓄力锁定 1 秒（其余时间合轴给队友——统一口径见 `mechanics/chargeLock.ts`） */
const FROST_MOON_3_LOCK_SECONDS = 1.0

/** 队伍中是否有风属性角色（影响霜灼状态覆盖率） */
function hasWindTeammate(team: ReadonlyTeam, slot: number): boolean {
  return team.some(m => m.slot !== slot && m.agent?.damageElement === 'wind')
}

/**
 * 霜灼·破次数的**唯一算法**：1500% 直伤行的次数与 spec 落霜 gain（countSource frostburnBreakCount）共用本函数（规则 11）。
 *
 * 原文（passive.level.1091507.desc[0]）：「星见雅对附着[冰焰]的敌人施加[霜寒]效果时，将会消除[冰焰]并触发[霜灼·破]……
 * 触发[霜灼·破]时，星见雅获得1点[落霜]，10秒内最多触发一次」。
 *
 * 口径 = 触发上限 ∩ 10s CD：
 * - 触发上限 = **烈霜(frostfire)异常触发次数**——每次烈霜异常结算都会对目标施加[霜寒]，而霜寒正是霜灼·破的触发条件
 *   （冰焰在雅造成烈霜伤害时自动附着，被霜灼·破消耗后要等本次霜寒结束才恢复 ⇒ 一次霜寒至多换一次霜灼·破）。
 *   次数由异常池逐轮收敛产出，经下一轮 applyTeamConfig(converge) 写入 cfg（见本模块 applyTeamConfig）。
 * - 10s CD 上界 = max(1, floor(战斗时间 / 10))（首个 10s 窗口在 t=0 就能触发一次）。
 * - 再乘 miyabi.frostburnBreakRate（利用率滑块），最后吃 miyabi.frostburnBreakCount（次数上限滑块，
 *   用户口径 2026-10-19「是修改上限而不是修改招式次数」，0 = 不设上限）。
 *
 * ⚠ 修复前这里（以及 spec 的 countSource: frostburnBreakCount）读的是 state.exSpecialCount——强特次数与霜灼·破次数
 * 没有因果关系（霜灼·破由霜寒触发，强特只是众多积蓄来源之一），实测方向都会错。
 *
 * 上一轮为 0（首轮/预热）时**不兜底成别的量**：0 是合法读数，兜底会把「用强特次数冒充」重新引回来。
 */
/**
 * @fact agent:1091/霜灼·破次数 口径: min(烈霜异常触发次数, max(1, ⌊战斗时间/10⌋)) × 利用率，再吃次数上限滑块（只压不抬）；与 1500% 直伤行同源 | 据 nanoka full/1091.json passive.level.1091507.desc[0]「对带[冰焰]的敌人施加[霜寒]时触发…10秒内最多触发一次」+ 用户@2026-10-23 | 验 src/mechanics/__tests__/miyabiFrostFallSources.test.ts | 锚 src/mechanics/agents/miyabi.ts#miyabiFrostburnBreakCountOf | 信 高
 * ⟳复核: 若官方改版调整落霜来源/霜灼·破 CD/影画二条目，改本组取值并同步 spec 1091.json | 到期 2027-04-30
 */
export function miyabiFrostburnBreakCountOf(cfg: CharacterOperationConfig, battleTime: number): number {
  const cap = setting(cfg, 'miyabi.frostburnBreakCount')
  const rate = Math.max(0, Math.min(2, setting(cfg, 'miyabi.frostburnBreakRate')))
  const triggers = Math.max(0, Math.floor(cfg.miyabiFrostfireTriggerCount ?? 0))
  // 10s CD 上界 = 战斗时间里能装下的完整 10s 窗口数（首个窗口在 t=0 即可用 ⇒ 至少 1 次）
  const cdCap = Math.max(1, Math.floor(Math.max(0, battleTime) / FROSTBURN_BREAK_CD_SECONDS))
  return capOfAuto(Math.floor(Math.min(triggers, cdCap) * rate), cap)
}

/**
 * 霜月架势（拔刀）次数的**唯一算法**（规则 11：执行行 / 资源卡 / 测试同源）。
 *
 * ## 口径：攒满 6 点就打一刀，一局最多 19 刀
 *
 * 落霜上限 6 点、每刀消耗 6 点 ⇒ **刀数 = ⌊落霜总回复量 / 6⌋**，再被 19 刀（顶尖玩家时间极限，用户
 * 2026-10-24）截断。这一段**不需要按「轮」建模**——用户逐字：「**就算 0 次紊乱，他也有回复豆子的
 * 能力，凑齐 6 豆他也可以拔刀啊**」。
 *
 * ## 为什么「19 刀上限」本身就是溢出机制
 *
 * 快循环（雅南柚这类双异常队）豆子回复远超 19 刀所需 ⇒ 超出部分**全部浪费**（用户：「19 轮紊乱拔刀
 * 已经做完，剩下能量就算打出 e 也没办法变成 20 次拔刀」）。这类队的蒸发量在资源卡上体现为
 * `evaporatedFrostFall`（= 总回复 − 刀数×6，按**豆**计，用户口径 2026-10-24「溢出的确实没有
 * 成为豆，而是直接蒸发」）。
 *
 * 慢循环（雅耀妮这类队友积蓄跟不上、一局上百秒打不出紊乱）到不了上限 ⇒ 平A 时间长 ⇒ 强化特殊技次数多
 * ⇒ **多余的 E 全部用来补豆子**（用户：「如果你不是快循环，有大把时间平a但是没办法紊乱了，这时候
 * 就该把多余的e用来补豆子」）。⇒ 这类队的刀数由**豆子总量**决定，不是由紊乱次数。
 *
 * ## 逐条的溢出说明（快循环语境；蒸发总量由 evaporatedFrostFall 呈现，逐条不分离）
 *
 * - 终结技的 +3 点：每轮只用得到 2 点（1 次 E/Q + 2 次紊乱 = 6 点），+1 溢；
 * - 霜寒（烈霜异常）的 +1 点：落在轮与轮之间的满桶时刻，全部溢；
 * - 影画二风花#5 的持续收入：快循环里基础循环已占满 180s，全部溢。
 *
 * 这三条都是**快循环专属**的浪费；慢循环里同样的收入会兑现成刀。聚合口径下不知道每笔收入落在
 * 时轴的哪一刻 ⇒ 逐条归因无法分离，蒸发只报**总量**（用户 2026-10-24：「快循环就是 2紊乱1拔刀
 * 的循环中进行的资源浪费，需要计算」——算的是总量，不逐条拆）。
 *
 * ⚠ 修复前这里读的是「紊乱配比轮」，慢循环队被系统性低估（雅耀妮 C0 只给 4 刀，实际靠 E 补豆能打 13 刀）。
 *
 * @fact agent:1091/霜月刀数 口径: 刀数 = min(⌊落霜总回复量/6⌋, 19)——攒满 6 点即拔刀，无紊乱也能靠强化特殊技攒豆；19 上限即快循环的溢出机制 | 据 用户@2026-10-24（「就算 0 次紊乱…凑齐 6 豆他也可以拔刀」+「不是快循环…多余的 e 用来补豆子」） | 验 src/mechanics/__tests__/miyabiFrostFallSources.test.ts | 锚 src/mechanics/agents/miyabi.ts#miyabiFrostMoonCountOf | 信 确认
 * ⟳复核: 若官方改版调整落霜上限/霜月消耗，或实战拔刀上限不再是 19，改本函数与 FROST_MOON_COUNT_DEFAULT_CAP | 到期 2027-04-30
 */
export function miyabiFrostMoonCountOf(input: {
  /**
   * 落霜**总回复量**（五源合计：入场 + 紊乱×2 + 强化特殊技×2 + 终结×3 + 霜灼·破×1 + 影画二风花×1）。
   * 调用方直接传 spec 解释器算出的 `res.total`（与资源卡同源，规则 11）。
   */
  frostFallTotal: number
  /** 上限（刀）：默认 19，滑块可覆盖（只压不抬） */
  countCap?: number
}): number {
  const total = Math.max(0, input.frostFallTotal)
  const cap = Math.max(0, Math.floor(input.countCap ?? FROST_MOON_COUNT_DEFAULT_CAP))
  const byBeans = Math.floor(total / FROST_MOON_COST)
  return cap > 0 ? Math.min(byBeans, cap) : byBeans
}

/**
 * 落霜 spec 资源的**外部次数源**（computeSpecResources 的第 4 参）。三条各有原因，都是「state 里没有这个量」：
 *
 * ① disorderCount：全队紊乱次数由异常池产出，而异常池**晚于** buildExecutions（它消费执行行）
 *    ⇒ 只能读 applyTeamConfig(converge) 写入 cfg 的**上一轮**收敛值（与爱丽丝 1401 剑仪的 aliceDisorderCount
 *    同一通道、同一理由：见 alice.ts#cfgExternalCountsProbe 注释）。
 * ② frostburnBreakCount：同上（烈霜触发次数来自异常池），再叠加 10s CD 与两个滑块 ⇒ 由
 *    miyabiFrostburnBreakCountOf 统一算，与 1500% 直伤行同源。
 * ③ basicAttackCount：影画二门控在**命座**上（tier 在 cfg），不是状态量 ⇒ 由本模块按 cinemaLevel >= 2
 *    决定是否把平A时间折算成风花#5命中数（C0/C1 恒 0）。修复前这条规则没有门控，0 命也在拿这份落霜
 *    （实测 C0「雅白」队白拿 17 点 ≈ 2.8 次霜月）。
 *
 * @fact agent:1091/落霜·C2风花 口径: 影画二「风花#5 命中 +1 落霜」按 cinemaLevel ≥ 2 门控（C0/C1 恒 0），命中数 = ⌊平A时间/2⌋ | 据 nanoka full/1091.json talent.2.desc + 用户@2026-10-23 | 验 src/mechanics/__tests__/miyabiFrostFallSources.test.ts | 锚 src/mechanics/agents/miyabi.ts#miyabiFrostFallContext | 信 高
 * ⟳复核: 若官方改版调整落霜来源/霜灼·破 CD/影画二条目，改本组取值并同步 spec 1091.json | 到期 2027-04-30
 */
/**
 * @fact agent:1091/落霜·紊乱来源 口径: 全队紊乱次数 × 2（异常池 disorderCount 经 applyTeamConfig converge 跨轮注入 cfg.miyabiDisorderCount），不再用强特次数近似 | 据 nanoka full/1091.json passive.level.1091507.desc[1]「队伍中任意角色触发[紊乱]效果时，星见雅获得2点[落霜]」+ 用户@2026-10-23 | 验 src/mechanics/__tests__/miyabiFrostFallSources.test.ts | 锚 src/mechanics/agents/miyabi.ts#miyabiFrostFallContext | 信 高
 * ⟳复核: 若官方改版调整落霜来源/霜灼·破 CD/影画二条目，改本组取值并同步 spec 1091.json | 到期 2027-04-30
 */
function miyabiFrostFallContext(cfg: CharacterOperationConfig, state: Readonly<IterationState>) {
  const cinemaLevel = cinemaLevelOf(cfg.miyabiCinemaLevel)
  return {
    disorderCount: Math.max(0, Math.floor(cfg.miyabiDisorderCount ?? 0)),
    frostburnBreakCount: miyabiFrostburnBreakCountOf(cfg, cfg.battleTime),
    // 与解释器 case basicAttackCount 同式（floor(平A时间/2)），只多了命座门控
    basicAttackCount: cinemaLevel >= 2 ? Math.max(0, Math.floor(state.basicAttackTime / 2)) : 0,
  }
}

function getFrostFallResource(
  cfg: CharacterOperationConfig,
  state: Readonly<IterationState>,
): MiyabiFrostFallSource | null {
  const spec = getAgentSpec(MIYABI_AGENT_ID)
  if (!spec) return null
  const res = computeSpecResources(spec, cfg, state, miyabiFrostFallContext(cfg, state)).get('miyabi_frost_fall')
  if (!res) return null
  // 刀数 = ⌊落霜总回复量 / 6⌋，被 19 刀（滑块可覆盖）截断——见 miyabiFrostMoonCountOf 头注释
  const frostMoonByResource = Math.max(0, Math.floor(res.total / FROST_MOON_COST))
  const countCap = Math.max(0, Math.floor(setting(cfg, 'miyabi.frostMoonCountCap')))
  const frostMoonCount = miyabiFrostMoonCountOf({ frostFallTotal: res.total, countCap })
  // 蒸发 = 回复了但没兑现成刀的豆（用户口径 2026-10-24：「溢出的确实没有成为豆，而是直接蒸发」）：
  // 快循环「2 紊乱 + 1 拔刀」一轮恰好 6 豆，终结技 +3 每轮只用 2（+1 溢）、霜寒 +1 落在满桶时刻、
  // (C2+) 风花#5 持续收入都打不进循环 ⇒ 桶满即蒸发；19 刀上限之外多出的整刀同样蒸发。
  const evaporatedFrostFall = Math.max(0, res.total - frostMoonCount * FROST_MOON_COST)
  return {
    total: res.total,
    frostMoonCount,
    frostMoonByResource,
    evaporatedFrostFall,
  }
}

// ============ applyPanel ============

function applyMiyabiPanel({ slot, cinemaLevel, team, panel, settings }: AgentPanelInput): void {
  // 额外能力·同沐霜雪（支援 / 同阵营 / 异常任一在队）：面板阶段按 spec 1091 additionalAbility 求值写入面板标记，这里只读标记
  // （原手写判定把同阵营臂写成同角色 id 的漂移史见 miyabiAdditionalAbility.test.ts）。
  const aa = additionalAbilityActiveOf(panel)
  const hasWind = hasWindTeammate(team, slot)

  // 面板级机制全部在 applyPanel 静态算（2026-09-01 架构修复：面板静态、循环只算招式/资源；
  // 曾由 transformSkillExecutions 每轮写面板 → 收敛轮间累积成 anomalyBuildUpEfficiency 600）。
  // 额外能力：紊乱触发霜月无视 30% 冰抗（面板近似；原 transform 判 frostFall 资源存在——
  // 紊乱正常发生时落霜必存在，静态化以 AA 激活为准）
  if (aa) {
    // 「紊乱后霜月架势无视 30% 冰抗」——霜月是**烈霜直伤** ⇒ 自身直伤族（异常读不到）
    panel.enemyIceResIgnoreDirect = panel.enemyIceResIgnoreDirect + FROST_MOON_ICE_RES_IGNORE
  }

  // 额外能力：霜月伤害+60%（限定基本攻击，通过 targetSkillType 机制）
  if (aa) {
    panel['skillDmgBonus__basic'] = (panel['skillDmgBonus__basic'] ?? 0) + FROST_MOON_DMG_BONUS
  }

  // C2：暴击率+15%；风花/闪避反击伤害+30%
  if (cinemaLevel >= 2) {
    panel.critRate = panel.critRate + C2_CRIT_RATE
    // 风花（普攻）与闪避反击：通过 targetSkillType 定向增伤
    panel['skillDmgBonus__basic'] = (panel['skillDmgBonus__basic'] ?? 0) + C2_NA_AND_DODGE_COUNTER_DMG
    panel['skillDmgBonus__dodgeCounter'] = (panel['skillDmgBonus__dodgeCounter'] ?? 0) + C2_NA_AND_DODGE_COUNTER_DMG
  }

  // C4：霜灼·破伤害+30% —— 在执行级结算（本文件 `C4_FROSTBURN_DMG` 的 resolveExecutionDamage 读者），面板无字段。
  // r400：原在此写 `panel.miyabiFrostburnDmgBonus`，全仓零读者，只会让命座自检误判「面板有变化」（docs/mcp-panel-fields.md §2）。

  // C6：极意霜月伤害+30%（限定基本攻击）
  if (cinemaLevel >= 6) {
    panel['skillDmgBonus__basic'] = (panel['skillDmgBonus__basic'] ?? 0) + C6_FROST_MOON_DMG
  }

  // 冰焰积蓄效率：min(80, 暴击率) × 覆盖率（冰焰与霜灼互斥）。
  // 覆盖率自动默认：有风队友或≥影画1（霜寒后保留冰焰）→ 100%；0命无风队 → 0%
  // （蓄力斩打在霜寒上吃不到加成）；显式设为非 100% 的滑块值优先。
  // 原 buildCharConfig 算 coverage + transform 施加——静态化后都在 applyPanel（C2 暴击已加）。
  // ⚠ 显式滑块值优先（含 1）——旧实现写成 `coverageRaw !== 1`，导致「填 100%」被当成「没填」
  // 而回落 autoDefault（C0 无风队 = 0）⇒ 用户把滑块拉满反而得到 0%。2026-10-24 修。
  const coverageRaw = Number(settings['miyabi.iceFlameCoverage'])
  const explicit = Number.isFinite(coverageRaw)
    ? Math.max(0, Math.min(1, coverageRaw))
    : undefined
  const autoDefault = hasWind || cinemaLevel >= 1 ? 1 : MIYABI_C0_ICEFLAME_DEFAULT_COVERAGE
  const coverage = explicit ?? autoDefault
  panel.miyabiIceFlameCoverage = coverage
  const iceFlameBonus = Math.min(ICE_FLAME_BUILDUP_MAX, panel.critRate) * coverage
  if (iceFlameBonus > 0) {
    panel.anomalyBuildUpEfficiency = panel.anomalyBuildUpEfficiency + iceFlameBonus
  }
  // 核心被动「霜灼状态：所有单位积蓄 +20%」已迁到 `teamPanelEffects`（F2 裁决 2026-09-25：
  // 原文「所有单位」= 全队，不是只写雅本人）；风队门控在那里直接调 `hasWindTeammate`。
}

// ============ buildCharConfig ============

function buildMiyabiCharConfig({ cfg, panel, cinemaLevel }: AgentCharConfigInput): void {
  // 霜月架势三段 actionTime 读 cfg.moveActionTimes（catalog，CC-409）
  cfg.miyabiCinemaLevel = cinemaLevel
  /**
   * 入场落霜（spec resources[miyabi_frost_fall].initialValueSource = cfgField）：
   * 基础 3 点 / 影画二 6 点（talent.2 是**替换**不是叠加）。
   *
   * @fact agent:1091/落霜·入场 口径: 进入战场立刻获得 3 点，影画二替换为 6 点（不是叠加）；走 spec initialValueField=miyabiEntryFrostFall | 据 nanoka full/1091.json skill.basic.description「立刻获得3点」+ talent.2.desc「立刻获得6点」+ 用户@2026-10-23 | 验 src/mechanics/__tests__/miyabiFrostFallSources.test.ts | 锚 src/mechanics/agents/miyabi.ts#buildMiyabiCharConfig | 信 高
   * ⟳复核: 若官方改版调整入场落霜点数或影画二条目，改本组常量并同步 spec 1091.json | 到期 2027-04-30
   *
   * 修复前：spec 只有 `initialValue: 0` + 零读者的 `properties.cinema2EntryGift` ⇒ 这一份收入整块缺失
   * （命座账本里写的「panel.miyabiCinema2EntryFrostFall=6」也是死字段，全仓零读者）。
   */
  cfg.miyabiEntryFrostFall = cinemaLevel >= 2 ? C2_ENTRY_FROST_FALL : BASE_ENTRY_FROST_FALL

  // ---- 霜月三段：哪部分时间交给队友（用户口径 2026-10-24）----
  //
  // 「雅合轴的时间，雅在蓄力斩啊，蓄力斩 3 秒多，我合轴变成 1 秒前台，然后**队友也能同步打两秒多**。
  //  你不合轴雅也是要斩」（逐字）。⇒ 霜月三段 actionTime 里只有 FROST_MOON_3_LOCK_SECONDS 那 1s
  // 占雅自己的前台，其余（≈2.434s/刀）是**队友在场上行动的时间**。
  //
  // 这份时间由引擎计入零权重队友的**必要时间**（消费点 = `core/resource/helpers.ts` 的
  // 「并行时间转移」块）——不留在平A池里被主C 吃掉。账本净额守恒：同量的 `comboAlignCredit`
  // 已让池扩大，这里让对应的 necessary 同量上涨。
  //
  // 刀数取决于紊乱/强特次数（build 阶段未知）⇒ build 写 0，converge 阶段按上一轮次数覆盖。

  // 冰焰覆盖率已由 applyPanel 静态算好（settings + 队伍/命座自动默认），buildCharConfig 只读
  void panel
}

// ============ buildExecutions ============

/**
 * 霜月时间的账本预留（CC-202）：走通用 `extraNecessaryAction`，**不带 moveId** ⇒ 引擎只预留时间（含合轴抵扣）、
 * 不补行；行仍由 buildMiyabiExecutions 产出。原先霜月 #3（3.434s，仅 1s 锁定、其余合轴）的时间全靠
 * timeBudgetExcess 事后折叠，行上的合轴抵扣因此丢失（≈ 次数 × 2.434s 挤了平A池，§24.48 预筛）。
 * 次数来自 spec 资源「落霜」（cfg + state），不依赖当前执行行 ⇒ 无滞后。
 * 与产行逐项对齐：`miyabiFrostMoonReserveCc202.test.ts`。回退：删模块登记里的 extraNecessaryAction。
 */
function hasMiyabiCinema6(cfg: CharacterOperationConfig, cinemaLevel?: number): boolean {
  const c = cinemaLevel ?? cinemaLevelOf(cfg.miyabiCinemaLevel)
  return c >= 6
}

export function miyabiFrostMoonReserve(cfg: CharacterOperationConfig, state?: Readonly<IterationState>): ExtraNecessaryAction[] | null {
  if (!state) return null
  const res = getFrostFallResource(cfg, state)
  if (!res || res.frostMoonCount <= 0) return null
  const count = res.frostMoonCount
  const actionTime = cfgMoveActionTime(cfg, FROST_MOON_MOVE_ID)
  const out: ExtraNecessaryAction[] = [{
    count, moveName: '霜月 #3（账本预留）', actionTime,
    comboAlignRatio: chargeLockComboAlignRatio(actionTime, FROST_MOON_3_LOCK_SECONDS), decibelRecovery: 0,
  }]
  if (hasMiyabiCinema6(cfg)) {
    out.push({ count, moveName: '霜月 #1（C6赠送，账本预留）', actionTime: cfgMoveActionTime(cfg, FROST_MOON_1_MOVE_ID), comboAlignRatio: 0, decibelRecovery: 0 })
    out.push({ count, moveName: '霜月 #2（C6赠送，账本预留）', actionTime: cfgMoveActionTime(cfg, FROST_MOON_2_MOVE_ID), comboAlignRatio: 0, decibelRecovery: 0 })
  }
  return out
}

function buildMiyabiExecutions({ cfg, state, executions }: AgentResourceInput): void {
  const cinemaLevel = cinemaLevelOf(cfg.miyabiCinemaLevel)

  // ---- 霜灼·破直伤执行（倍率固定 1500% ×（1+C4），毕业终局）----
  // ⚠ 这一段**必须在霜月次数的早退之前**：霜灼·破由「对带[冰焰]的敌人施加[霜寒]」触发，与雅这局有没有
  // 攒够 6 点落霜打霜月**没有因果关系**。修复前它排在 `frostMoonCount <= 0` 的早退之后 ⇒ 只要落霜总量
  // 不足 6（0 命小战斗、或次数上限滑块被调低），霜灼·破行连带整块消失（实测 cap=3/4/5 ⇒ 行数 0）。
  // 次数与落霜的霜灼·破 gain 同源：miyabiFrostburnBreakCountOf（烈霜异常触发次数 ∩ 10s CD × 利用率，
  // 吃次数上限滑块；滑块 = 上限，用户口径 2026-10-19「是修改上限而不是修改招式次数」，0 = 不设上限）。
  const frostbreakCount = miyabiFrostburnBreakCountOf(cfg, cfg.battleTime)
  if (frostbreakCount > 0) {
    // C4「[霜灼·破]造成的伤害提升30%」（talent.4.desc）：进**倍率**，不是在 note 里写一句。
    // 修复前 `C4_FROSTBURN_DMG` 只出现在 resolveExecutionDamage 的说明文字里（死口径），
    // 实测 C3/C4 的霜灼·破行 perDamage 逐位相同（10411）⇒ C4 只有 +250 喧响那半条在生效。
    const perDecibel = cinemaLevel >= 4 ? C4_FROSTBURN_DECIBEL : 0
    const frostburnMultiplier = cinemaLevel >= 4
      ? FROSTBURN_BREAK_MULTIPLIER * (1 + C4_FROSTBURN_DMG / 100)
      : FROSTBURN_BREAK_MULTIPLIER
    executions.push(moduleExecRow({
      moveId: 'miyabi_frostburn_break',
      moveName: '霜灼·破',
      category: 'basic',
      count: frostbreakCount,
      decibelRecovery: perDecibel,
      totalDecibelRecovery: perDecibel * frostbreakCount,
      ...ENERGY_RECOVERY_OFF,
      damageMultiplier: frostburnMultiplier,
    }))
  }

  // ---- 霜月架势（消耗落霜）----
  const res = getFrostFallResource(cfg, state)
  if (!res || res.frostMoonCount <= 0) return

  const frostMoonCount = res.frostMoonCount
  const actionTime = cfgMoveActionTime(cfg, FROST_MOON_MOVE_ID)
  // 影画1（招式限定）：三段蓄力的每一段按已消耗落霜无视防御——#1(2豆)=12%、#2(4豆)=24%、#3(6豆)=36%
  const m1DefShred = cinemaLevel >= 1

  // 霜月架势三段
  // 合轴：蓄力1秒后即可合轴，totalComboAlignTime = count × 1.0
  executions.push(moduleExecRow({
    moveId: FROST_MOON_MOVE_ID,
    moveName: '普通攻击：霜月 #3（蓄力三段，烈霜）',
    category: 'basic',
    count: frostMoonCount,
    actionTime: actionTime,
    // 用户口径：三段蓄力只有 1s 锁定窗口在前台，其余时间全部合轴
    comboAlignRatio: chargeLockComboAlignRatio(actionTime, FROST_MOON_3_LOCK_SECONDS),
    totalTime: frostMoonCount * actionTime,
    totalComboAlignTime: frostMoonCount * (actionTime - FROST_MOON_3_LOCK_SECONDS),
    ...(m1DefShred ? { defIgnore: 36 } : {}),
  }))

  // C6：消耗落霜释放霜月#3时，额外赠送一次霜月#1 与 #2
  // 非C6只有霜月#3；C6固定额外赠送#1（910.1%）和#2（1717.2%），各随次数翻倍
  // 前台时间：霜月#1（0.4s完整动作，不合轴）+霜月#2（0.567s完整动作，不合轴）
  // +霜月#3（仅 1s 锁定在前台，其余合轴）= 每次前台合计 1.967s
  const hasC6 = hasMiyabiCinema6(cfg, cinemaLevel)
  if (hasC6 && frostMoonCount > 0) {
    for (const gift of [
      { moveId: FROST_MOON_1_MOVE_ID, moveName: '普通攻击：霜月 #1（C6赠送）', at: cfgMoveActionTime(cfg, FROST_MOON_1_MOVE_ID) },
      { moveId: FROST_MOON_2_MOVE_ID, moveName: '普通攻击：霜月 #2（C6赠送）', at: cfgMoveActionTime(cfg, FROST_MOON_2_MOVE_ID) },
    ]) {
      executions.push(moduleExecRow({
        moveId: gift.moveId,
        moveName: gift.moveName,
        category: 'basic',
        count: frostMoonCount,
        actionTime: gift.at,
        totalTime: frostMoonCount * gift.at,
        ...RECOVERY_OFF,
        ...(m1DefShred ? { defIgnore: gift.moveId === FROST_MOON_1_MOVE_ID ? 12 : 24 } : {}),
      }))
    }
  }

}

// ============ transformSkillExecutions ============

function transformMiyabiSkillExecutions(input: AgentSkillTransformInput): void {
  const {
    slot,
    agent: _agent,
    skills,
    charResult,
    panel,
    cinemaLevel,
    team: _team,
    dazeCoef,
    stunExecs,
    anomalyExecs,
    getRowValue,
    normalizeResourceSkillType,
  } = input
  // 本钩子只做 exec 构建（烈霜归并/锁定）；面板写入一律在 applyPanel（静态，2026-09-01 架构修复）

  // ---- 生成 stun/anomaly execs ----
  for (const exec of charResult.executions) {
    if (exec.count <= 0 && exec.totalTime <= 0) continue
    if (exec.moveId === 'basic_attack') continue

    const foundMove = findMoveById(skills, exec.moveId)
    if (!foundMove) continue
    const count = exec.count
    const daze = getRowValue(foundMove, 'daze')
    const anomaly = getRowValue(foundMove, 'anomaly_buildup')
    const moveName = exec.moveName.replace(/（.*）/g, '').trim()
    // 雅的所有招式积蓄/失衡都归为烈霜（独立元素）
    const element = FROSTFIRE

    if (daze > 0 && count > 0) {
      stunExecs.push({
        moveId: exec.moveId,
        moveName,
        slot,
        count,
        baseDaze: daze * dazeCoef,
        element,
        skillType: normalizeResourceSkillType(foundMove, exec.moveId),
      })
    }

if (anomaly > 0 && count > 0) {
	      anomalyExecs.push({
	        moveId: exec.moveId,
	        moveName,
	        slot,
	        count,
	        baseBuildUp: anomaly,
	        element,
	      })
	    }
	  }

  // ---- 冰焰积蓄效率的**招式级**修正（用户口径 2026-10-24）----
  //
  // 面板级 `anomalyBuildUpEfficiency` 里的冰焰加成按「全程吃得到」给；但原文
  // （passive.level.1091501.desc.0）的计时是「对**附着[冰焰]**的敌人累积烈霜积蓄值」，而
  // 「[霜灼]状态下…星见雅无法再次为其附着[冰焰]」。霜月三段的时机固定：**拔刀发生在霜灼·破之后**
  // （本轮霜寒已经消掉冰焰）⇒ 霜月总打在霜灼上。
  //
  // C0：霜灼只能靠队友异常覆盖霜寒来消除 ⇒ 霜月**永远吃不到**（用户：「c0 可以认为霜月总是打在霜灼上」）。
  // C1+：影画一让霜寒后**保留冰焰**、可取消霜灼·破 ⇒ 霜月也吃得到（用户：「c1 后霜月可以吃冰焰」）。
  const iceFlameBonusPct = panel
    ? Math.min(ICE_FLAME_BUILDUP_MAX, panel.critRate) * Math.max(0, Math.min(1, panel.miyabiIceFlameCoverage ?? 0))
    : 0
  if (iceFlameBonusPct > 0 && cinemaLevel < 1) {
    for (const exec of anomalyExecs) {
      if (!FROST_MOON_ALL_MOVE_IDS.has(exec.moveId)) continue
      // 行级效率区**加算**百分点 ⇒ 负值即扣回面板已给的那份（不新增乘区，规则 11）
      exec.buildUpEfficiencyBonusPct = (exec.buildUpEfficiencyBonusPct ?? 0) - iceFlameBonusPct
    }
  }

	  // 修正 generic 路径推入的 basic_attack 元素：从 fallbackElement(ice) 改为 FROSTFIRE
	  for (const exec of stunExecs) {
	    if (exec.moveId === 'basic_attack') exec.element = FROSTFIRE
	  }
	  for (const exec of anomalyExecs) {
	    if (exec.moveId === 'basic_attack') exec.element = FROSTFIRE
	  }
}

// ============ resolveExecutionDamage ============

function resolveMiyabiExecutionDamage(input: AgentDamageResolutionInput): AgentDamageResolution | null {
  const { move, exec, cinemaLevel } = input
  if (!move) return null

  // 霜灼·破直伤（从buildExecutions推入的自定义执行）
  if (exec.moveId === 'miyabi_frostburn_break') {
    // C4 的 +30% 已在 buildMiyabiExecutions 里乘进 damageMultiplier（单一来源）；这里只写说明，不再重复算。
    const hasC4Bonus = cinemaLevel >= 4
    return {
      element: FROSTFIRE,
      source: '霜灼·破',
      note: `霜灼·破直伤，${hasC4Bonus ? `${FROSTBURN_BREAK_MULTIPLIER * (1 + C4_FROSTBURN_DMG / 100)}%（Lv.7 × C4 +${C4_FROSTBURN_DMG}%）` : `${FROSTBURN_BREAK_MULTIPLIER}%（Lv.7）`} ATK 倍率；吃双爆不吃精通。`,
    }
  }

  // 所有雅招式元素 -> 烈霜
  return {
    element: FROSTFIRE,
    note: '雅的所有伤害均为烈霜（独立元素，可在紊乱中与冰互紊）。',
  }
}

// ============ buildResourceResult / resourceSections ============

function buildMiyabiResourceResult({ cfg, state }: AgentResourceResultInput): Partial<import('@/types/resource').CharacterResourceResult> {
  const res = getFrostFallResource(cfg, state)
  return {
    miyabiFrostFallSource: res ?? undefined,
  }
}

function buildMiyabiResourceSections({ result }: AgentResourceSectionsInput): SpecialResourceSection[] {
  const src = result.miyabiFrostFallSource
  if (!src) return []
  // 字段全必填（构造点唯一 = getFrostFallResource）⇒ 不写 `?? 0` 死兜底（判据 28）。
  // 2026-10-24 报的「雅柚苍整页崩溃」根因不在字段缺——src 整体缺（首轮/预热）由上一行 short-circuit 防住。
  const total = src.total
  const moon = src.frostMoonCount
  const byResource = src.frostMoonByResource
  const evaporated = src.evaporatedFrostFall
  const wastedWholeCuts = Math.max(0, byResource - moon) * FROST_MOON_COST
  const oddBeans = evaporated - wastedWholeCuts
  const rows: Array<{ label: string; value: string; detail: string }> = [
    { label: '落霜总量', value: fmt(total, 1), detail: '入场 3/6 + 强化特殊技×2 + 终结技×3 + 紊乱×2 + 霜灼·破×1 + 影画二风花#5×1（C2 起）' },
    { label: '霜月三段消耗', value: `${moon} 次`, detail: `${FROST_MOON_COST} 落霜/次 → 4282.8% 烈霜直伤（攒满 6 点即一刀；一局上限 19 刀）` },
  ]
  if (evaporated > 0) {
    // 用户口径 2026-10-24：溢出的豆「确实没有成为豆，而是直接蒸发」——产出侧按豆计（不再是「X 刀」）。
    // 快循环「2 紊乱 + 1 拔刀」一轮恰好 6 豆：终结 +3 每轮只用 2（+1 溢）、霜寒 +1 落在满桶时刻、
    // (C2+) 风花#5 持续收入都打不进循环 ⇒ 桶满即蒸发；19 刀之外的整刀收入同样蒸发。
    const parts = [`回复 ${fmt(total, 1)} 豆，只兑现 ${moon} 刀 × ${FROST_MOON_COST} = ${moon * FROST_MOON_COST} 豆`]
    if (wastedWholeCuts > 0) parts.push(`被刀数上限压掉 ${wastedWholeCuts} 豆（够 ${byResource} 刀只打得出 ${moon} 刀）`)
    if (oddBeans > 0) parts.push(`攒不满下一刀的零头 ${oddBeans} 豆`)
    rows.push({ label: '蒸发（未成为豆）', value: `${fmt(evaporated, 1)} 豆`, detail: `${parts.join('；')} —— 快循环 2紊乱1拔刀 循环中的资源浪费，直接蒸发不回流` })
  }
  return [{ id: 'miyabi-frost-fall', title: '雅·落霜', summary: `产出 ${fmt(total, 1)} / 兑现 ${moon} 刀 / 蒸发 ${fmt(evaporated, 1)} 豆`, rows }]
}

// ============ module export ============

export const miyabiMechanic: AgentMechanicModule = {
  id: 'agent:miyabi',
  agentIds: [MIYABI_AGENT_ID],
  name: '雅',
  description: '烈霜独立元素、冰焰积蓄效率、落霜状态机、霜月架势三段、霜灼·破直伤与命座机制。',
  applyPanel: applyMiyabiPanel,
  /**
   * 核心被动「寒炎」：霜灼状态下，**所有单位**对目标累积的属性异常积蓄值 +20%（Lv.7）。
   *
   * F2 用户裁决 2026-09-25：原文「所有单位」= 全队，不是只写雅本人——从 `applyPanel`
   * （只写雅面板）迁入本钩子，对全队每个槽位统一 +20%（含雅本人：雅在 `team` 里，
   * 派发到自己槽位时同吃）。风队门控沿用（风化状态不被覆盖，霜灼无法触发 ⇒ 覆盖率为 0），
   * 与 `applyPanel` 同源调 `hasWindTeammate(team, slot)`（`slot` 是雅自己的槽位，见下方 CC-335 注）。
   *
   * 与 spec teamBuff `miyabi_c1_team_buildup`（影画一 +20%）是**两条独立 +20%**，可叠加：
   * 无风队里 C1 激活时每名队友与雅本人各 +40%（F1 裁决：核心被动与影画一在雅身上叠加为 +40）。
   * 契约见 `AgentTeamPanelEffectInput`（本钩子只允许可交换的加法 `+=`）。
   */
  teamPanelEffects: ({ slot, team, panel, report }: AgentTeamPanelEffectInput): void => {
    // CC-335：panel 是 targetSlot 的面板，原先读的风队标记只写在雅自己的面板上 ⇒ 有风队时队友误吃 +20%。
    // 改为与 applyMiyabiPanel 同源调 hasWindTeammate(team, slot)。r762 删掉那个面板标记：它只剩这里一个读者，且恒被前一条蕴含。
    if (hasWindTeammate(team, slot)) return
    panel.anomalyBuildUpEfficiency = panel.anomalyBuildUpEfficiency + FROSTBURN_TEAM_BUILDUP_BONUS
    // 结构化记账（2026-10-20）：写入与上报共用同一份结果
    report?.({ stat: 'anomalyBuildUpEfficiency', value: FROSTBURN_TEAM_BUILDUP_BONUS, mode: 'flat' })
  },
  buildCharConfig: buildMiyabiCharConfig,
  /**
   * 落霜的两条**外部次数源**注入（全队紊乱次数 / 烈霜异常触发次数）。
   *
   * 为什么必须走跨轮反馈、不能在 buildExecutions 里直接读异常池：`buildExecutions` 跑在异常池**之前**
   * （异常池消费执行行，执行行又含霜月），读不到本轮次数——这是循环依赖，不是懒。爱丽丝 1401 剑仪
   * （aliceDisorderCount / aliceTeamAssaultCount）就是同一通道的先例，本模块照抄，不改契约。
   *
   * 相位纪律（与爱丽丝同款）：
   * - build：次数全未知 ⇒ 置 0（首轮不吃这两条收入）；
   * - converge：带**上一轮**收敛出的异常池次数 ⇒ 写进 cfg，本轮 buildExecutions 消费；
   * - postRound：不动（这两个次数是异常池的产物，本模块只做消费者）。
   */
  applyTeamConfig: ({ cfg, phase, threads }) => {
    if (phase === 'build') {
      cfg.miyabiDisorderCount = 0
      cfg.miyabiFrostfireTriggerCount = 0
      return
    }
    if (phase !== 'converge') return
    cfg.miyabiDisorderCount = Math.max(0, Math.floor(threads?.moduleFeedback.miyabiDisorderCount ?? 0))
    cfg.miyabiFrostfireTriggerCount = Math.max(0, Math.floor(threads?.moduleFeedback.miyabiFrostfireTriggerCount ?? 0))
  },
  /**
   * 落霜外部次数源的「下一轮注入」：本轮异常池 → moduleFeedback → 下一轮 applyTeamConfig(converge) 写 cfg。
   * 紊乱那条取全队 disorderCount（原文主语是「队伍中任意角色」）；烈霜触发次数取 frostfire 的 perElement.triggerCount
   * （霜灼·破的触发条件「对带[冰焰]的敌人施加[霜寒]」⇒ 每次烈霜异常结算都有一次霜寒，见 miyabiFrostburnBreakCountOf）。
   * ⚠ 只读入参、只返回结果（nextRoundFeedback 契约：写 cfg 会在钩子被深冻结时抛错）。
   */
  nextRoundFeedback: ({ anomalyPool }: AgentNextRoundFeedbackInput) => {
    // anomalyPool 在契约里必填、非 null（CC-423/CC-434：无异常行队伍 = 合法空池）⇒ 直接读，不加 ?. / ?? 兜底
    const frostfire = anomalyPool.perElement.find(p => p.element === FROSTFIRE)
    // 单测/直调可能不传 teamResult（契约必填，但钩子应能容错）⇒ 缺省按 0，不抛
    return {
      miyabiDisorderCount: Math.max(0, Math.floor(anomalyPool.disorderCount)),
      miyabiFrostfireTriggerCount: Math.max(0, Math.floor(frostfire?.triggerCount ?? 0)),
    }
  },
  buildExecutions: buildMiyabiExecutions,
  // CC-202：霜月时间进账本（只预留、不补行，合轴抵扣随之生效）
  extraNecessaryAction: miyabiFrostMoonReserve,
  anomalyBuildupElement: FROSTFIRE,
  replaceSkillExecutionExtraction: true,
  transformSkillExecutions: transformMiyabiSkillExecutions,
  resolveExecutionDamage: resolveMiyabiExecutionDamage,
  buildResourceResult: buildMiyabiResourceResult,
  resourceSections: buildMiyabiResourceSections,
  settings: [
    {
      id: 'miyabi.iceFlameCoverage',
      label: '雅·冰焰覆盖率',
      description: '冰焰（烈霜积蓄效率+80%上限）的覆盖率。自动默认：有风队友或≥影画1（霜寒后保留冰焰）= 100%；0命无风队 = 0%（手法上总是先打霜寒才够 6 豆，三段蓄力全打在霜寒上，吃不到加成）。显式设为非 100% 的值优先。',
      default: 1.0,
      min: 0,
      max: 1,
      step: 0.05,
      suffix: '%',
    },
    {
      id: 'miyabi.frostMoonCountCap',
      label: '雅·霜月次数上限',
      // 默认值 = 单一来源常量（FROST_MOON_COUNT_DEFAULT_CAP，带 @fact 与复核触发器）
      description: '一局最多打出几次霜月三段（拔刀）。默认 19 = 顶尖玩家实测的时间约束上限（资源回复会溢出，落霜总量不是瓶颈）。填 0 = 不设上限（纯按资源算）。',
      default: FROST_MOON_COUNT_DEFAULT_CAP,
      min: 0,
      max: 30,
      step: 1,
      suffix: '次',
    },
    {
      id: 'miyabi.frostburnBreakCount',
      label: '雅·霜灼·破次数上限',
      description: '霜灼·破直伤触发次数的**上限**。次数自动 = min(烈霜异常触发次数, ⌊战斗时间/10⌋) × 利用率；调低 = 你手动吞掉一部分。填 0 = 不设上限。',
      default: 0,
      min: 0,
      max: 60,
      step: 1,
      suffix: '次',
    },
    {
      id: 'miyabi.frostburnBreakRate',
      label: '雅·霜灼·破利用率',
      description: '霜灼·破默认次数（烈霜异常触发 ∩ 10s CD）的利用率，默认 100%。',
      default: 1,
      min: 0,
      max: 2,
      step: 0.05,
      suffix: '%',
    },
  ],
}

/**
 * D2（CC-359）：本模块私有的 cfg 字段——只有本文件读写，声明随模块走，不再堆在 `types/resource/config.ts`。
 * 仍是 `CharacterOperationConfig` 的成员（模块扩充，纯类型、零运行时）；被第二处引用时请迁回公共接口。
 */
declare module '@/types/resource/config' {
  interface CharacterOperationConfig {
    /** 星见雅命座等级（影画1 招式限定减防、影画2 风花#5 落霜等按此门控） */
    miyabiCinemaLevel?: number
    /** 入场落霜（buildCharConfig 写入：基础 3 / 影画二 6；spec initialValueField 读取） */
    miyabiEntryFrostFall?: number

    /**
     * 上一轮收敛的全队**紊乱次数**（applyTeamConfig converge 写入，build 置 0）。
     * 落霜 spec 规则 `miyabi_disorder_frost_fall_gain`（countSource disorderCount）的输入。
     * 走跨轮字段的理由见 `miyabiFrostFallContext` 与 alice.ts 的 `cfgExternalCountsProbe`（同一通道）。
     */
    miyabiDisorderCount?: number
    /**
     * 上一轮收敛的**烈霜(frostfire)异常触发次数**（applyTeamConfig converge 写入，build 置 0）。
     * 霜灼·破次数的触发上限（原文：对带[冰焰]的敌人施加[霜寒]时触发）；见 `miyabiFrostburnBreakCountOf`。
     */
    miyabiFrostfireTriggerCount?: number
  }
}

/**
 * 落霜外部次数源的跨轮反馈键（自产自读 ⇒ 声明随模块走，见 mechanics/types.ts#ModuleFeedback 的键放置约定）。
 * 产出：本模块 `nextRoundFeedback`（读本轮异常池）；消费：本模块 `applyTeamConfig(converge)` 写 cfg。
 */
declare module '@/mechanics/types' {
  interface ModuleFeedback {
    /** 星见雅落霜：全队紊乱次数（原文「队伍中任意角色触发[紊乱]」） */
    miyabiDisorderCount?: number
    /** 星见雅落霜/霜灼·破：烈霜(frostfire)异常触发次数 */
    miyabiFrostfireTriggerCount?: number
  }
}

/**
 * D2（CC-359/360）：本模块私有的结果字段——只有本文件读写，声明随模块走，不堆在 `types/resource/agentResources.ts`。
 * 仍是 `CharacterResourceResult` 的成员（模块扩充，纯类型、零运行时）；被第二处引用时请迁回公共接口。
 */
declare module '@/types/resource/agentResources' {
  interface CharacterResourceResult {
    /** 雅落霜资源明细 */
    miyabiFrostFallSource?: MiyabiFrostFallSource
  }
}

// ===== 本模块私有的结果类型（D2 / CC-360：原在 types/resource/agentResources.ts，只有本文件引用）=====

/** 雅落霜资源明细 */
export interface MiyabiFrostFallSource {
  /** 落霜总量（上限 6 只是单次存量上限，全局按总回复算，不截断） */
  total: number
  /** 一局能打出的霜月三段次数 = min(⌊总量/6⌋, 「霜月次数上限」滑块) */
  frostMoonCount: number
  /** 纯按资源算的次数（总量 ÷ 6，不含滑块截断）—— 只作溢出对照展示，**不是刀数** */
  frostMoonByResource: number
  /**
   * 蒸发的豆 = 总回复量 − 兑现成刀的消耗（total − frostMoonCount×6）。
   * 回复了但没成为豆、直接蒸发的量：含被 19 刀上限压掉的整刀浪费与攒不满下一刀的零头。
   * 聚合口径下逐条归因（终结+1/轮、霜寒+1 满桶、风花溢出）无法按时序分离 ⇒ 只报总量，不回流任何通道。
   *
   * @fact agent:1091/落霜·蒸发 口径: 蒸发豆 = 落霜总回复量 − 刀数×6——溢出的没有成为豆而是直接蒸发（快循环 2紊乱1拔刀 循环中的资源浪费），产出侧按豆呈现，不回流 | 据 用户@2026-10-24（「溢出的确实没有成为豆，而是直接蒸发…快循环就是2紊乱1拔刀的循环中，进行的资源浪费，需要计算」） | 验 src/mechanics/__tests__/miyabiFrostFallSources.test.ts | 锚 src/mechanics/agents/miyabi.ts#MiyabiFrostFallSource | 信 确认
   * ⟳复核: 若官方改版让落霜溢出可留存/转化（不再是直接蒸发），或霜月消耗不再是 6，改 evaporatedFrostFall 算式与资源卡行 | 到期 2027-04-30
   */
  evaporatedFrostFall: number
}

/**
 * D2（r402 CC-376，`docs/mcp-panel-fields.md` §4 S2+S4）：本模块私有的面板字段——只有本文件读写（测试读不算引用者），声明随模块走。
 * 仍是 `PanelValues` 的成员（模块扩充，纯类型、零运行时）；出现第二个**生产**引用者时迁回 `types/catalog.ts`。
 */
declare module '@/types/catalog' {
  interface PanelValues {
    /** 冰焰覆盖率：与积蓄效率增量同块写入；测试读 */
    miyabiIceFlameCoverage?: number
  }
}
