/**
 * 配置 Store - 3人队伍配置 + 全局Buff + 敌人配置
 */
import { clampRatio } from '@/utils/finiteClamp'
import { defineStore } from 'pinia'
import { ref, computed, watch, type UnwrapRef } from 'vue'
import type {
  Agent, WEngine, DriveDiscConfig, SkillDamageTarget, CharacterBuildRecommendation, TeammateBuffGroup,
} from '@/types/catalog'
import { computeDefaultSubStatAllocation, getTemplate, normalizeSubstatAllocation, resolveSubstatBudget, SUBSTAT_BUDGET_SETTINGS } from '@/core/substatOptimizer'
import { effectiveBattleTime } from '@/core/effectiveTime'
import { useCatalogStore } from './catalog'
import { AUTO_AXIS_PRESET_HINTS, getAgentMechanic } from '@/mechanics'
import { autoStunAxisPresetOf, prefillPresetGuarantee } from '@/data/stunAxisPresets'
import { evalAdditionalAbilityBuffGates, teammateBuffGateBlocks } from '@/mechanics/additionalAbilityGates'
import type { MechanicTeamMember } from '@/mechanics/types'
import type { AppliedBossPreset, PhaseBuffEffect } from '@/types/bossPreset'
import { counterAssistOf } from '@/data/counterAssists'
import { localized } from '@/utils/format'
import { elementStatKey } from '@/utils/elementStatKeys'
import {
  discEffectCoverageOf,
  mechanicSettingOf,
  teammateBuffCoverageOf,
  teammateBuffEnabledOf,
} from './selectionReads'

// ========== 类型定义 ==========

/** 单个角色的完整配置 */
export interface CharacterConfig {
  slot: number       // 0, 1, 2
  agentId: string
  cinemaLevel: number  // 影画/命座 0-6
  potentialLevel?: number  // 潜能觉醒等级 1-6（缺省 6 = 满级；潜能效果见各模块按档位取值）
  wEngineId: string
  wEngineModLevel: number  // 精修/精炼 1-5
  driveDisc: DriveDiscConfig
  parryCount: number       // 弹刀次数（per-character）
  dodgeCounterCount: number  // 闪避反击次数（per-character）
  blockCount: number        // 金身格挡/不动如山招架次数（per-character，般岳嗔火来源）
  perfectBlockCount?: number // 强特完美格挡次数（per-character，佩洛伊斯日珥回复来源，主页交互栏填写）
  assaultOrderCount?: number // 特殊技：强袭训令次数（per-character，佩洛伊斯，主页交互栏填写）
  dualCounterCount?: number  // 双反次数（per-character，般岳专属：完美闪避+金身弹刀组合，+10嗔火/次；缺省 0）
  tauntCancelCount?: number  // 嘲讽取消次数（per-character，般岳专属：失衡外强特连段末尾后摇的嘲讽取消，每次取消一次后摇；缺省 0）
  yixuanInk2Count?: number  // 仪玄·2连墨痕化形次数（#1+#3，40闪能/次；主页交互栏填写）
  promiaNiyingCount?: number  // 普罗米娅·处刑式·匿影次数（强特变体，耗强特能量；每次+10寒蚀并解锁重霜；交互栏填写，用户自控能量预算）
  yixuanInk3Count?: number  // 仪玄·3连墨痕化形次数（#1+#3+#4，60闪能/次；≤0=自动=剩余闪能全打3连，≥1 手填）
  yixuanPerfectBlockCount?: number  // 仪玄·完美格挡次数（#2 赠送 + 回10闪能/次；≤0=自动=弹刀次数全完美，≥1 手填）
  yixuanExtremeAssistCount?: number  // 仪玄·极限支援换场次数（落雷 225% 贯穿力 + 5闪能/次；缺省 -1 = 自动取队友弹刀和上限）
  yixuanBackstageComboCount?: number  // 仪玄·墨影凝云合轴次数（后台墨影凝云+霄云劲#5，不占战场时间但有倍率行调用）
  quickAssistCount: number  // 快速支援次数（per-character）
  chainCountPerStun: number  // 每次失衡的连携次数（per-character；setAgent 预填 ASSIST_ACTION_BASELINE.chainPerStun = 1，CC-264）
  basicAttackTimeWeight: number // 平A时间分配权重（0=不分配平A时间）
}

/** 全局 Buff 行（用户自由添加） */
/**
 * 失衡轴状态三件套：固定轴 / 条件轴方案 / 总开关。
 * 快照、恢复、应用轴预设一律走 store 的 `getAxisState` / `setAxisState` / `applyStunAxisPreset`
 * （arena-D 第 368 轮；修前 configSnapshot、teamCompare、difficultyLadder、StunAxisPage 各自 splice，
 * 「方案与固定轴互斥」的规则在 teamCompare 与 StunAxisPage 各写一份，快照字段靠 `unknown[]` + `as never[]` 绕类型）。
 */
export interface StunAxisState {
  stunAxes: import('@/types/resource').StunAxis[]
  stunAxisPlans: import('@/types/resource').StunAxisPlan[]
  useStunAxis: boolean
}

export interface GlobalBuffRow {
  id: string
  name: string       // 名称，如"危局buff"、"boss"、"角色被动"
  stat: string       // 属性，如"atkPct"、"critRate"、"dmgBonus"
  value: number      // 数值
  enabled: boolean
  targetSkillType?: SkillDamageTarget
  /** CC-341：危局 buff 牌条件（特性限定 / 特性人数分档；应用 Boss / 当期牌写入时随行带上，见 `utils/phaseBuff#phaseBuffRows`）。
   *  管线按**当前队伍**解析（`resolvePhaseBuffValue`）：不成立的行不生效、人数分档取生效档的值；用户手动添加的行没有此字段。 */
  cond?: PhaseBuffEffect['cond']
}

/** 单个资源利用率覆盖：按 slot + actionId/eventId 作用于最终执行计划 */
export interface ResourceUtilizationOverride {
  rate: number       // 释放率，0-1
  cap?: number | null // 次数上限；空表示不封顶
}

/** 敌人配置 */
export interface EnemyConfig {
  hp: number
  stunValue: number      // 失衡值
  stunTime: number       // 失衡时间(s)
  stunVuln: number       // 失衡易伤倍率
  defense: number        // 怪物防御
  level: number          // 怪物等级
  anomalyCoeff: number   // 异常条系数
  bossAnomalyCoeff: number  // 危局异常系数
  bossStunGift: number   // boss赠送失衡
  shieldCount: number    // 秽盾数量
  energyShield: number   // 能量盾数量
  invincibleTime: number   // boss无敌时间（仅用于 DoT 扣减）
  battleTime: number       // 总战斗时间（秒，默认180）
  stunCountLock: number    // 锁定失衡次数（-1 = 正常收敛；命座对比固定场景用）
  /** 敌方体型：影响体型相关招式倍率（如艾莲霜锋剑气 0/3/6 段） */
  bodySize?: 'small' | 'medium' | 'large'
  /** 伤害抗性：用于直伤、异常伤害、紊乱/乱流结算 */
  damageResistances: Record<string, number>
  /** 失衡抗性：用于失衡值计算 */
  stunResistances: Record<string, number>
  /** 积蓄抗性：用于异常积蓄值计算 */
  anomalyResistances: Record<string, number>
  /** 兼容旧配置：旧版单表抗性 */
  resistances?: Record<string, number>
  /**
   * 当前敌人弱点（中文，与 Boss 预设 phase.weakness 同口径）。
   * 缺省或空 = 未声明，音擎 attributeCounter 不拦截。
   * setEnemy 是合并写入，切 Boss 时必须显式覆盖，否则上一个弱点会粘住。
   */
  weakness?: string[]
}

// ========== 默认配置 ==========

function defaultDriveDisc(element: string): DriveDiscConfig {
  return {
    fourPieceSetId: '',
    twoPieceSetId: '',
    mainStats: {
      4: 'atkPct',
      5: elementStatKey('dmg', element) ?? 'atkPct', // CC-225：旧 `${element}Dmg` || 'atkPct' 的回落是死代码（模板串恒真）
      6: 'critRate',
    },
    subStatAllocation: {},
  }
}

// @fact engine:平A权重阶梯 口径: 不设职业统一阶梯（强攻/异常/击破默认同为1）——用户裁决「不同情况不同权重，不能一概而论」，抬权重归角色级滑块/预设 | 据 用户@2026-09-04·复核@2026-09-08·复核@2026-09-25·复核@2026-09-27·复核@2026-09-30 | 锚 src/stores/config.ts#defaultBasicAttackTimeWeight | 信 确认
function defaultBasicAttackTimeWeight(agent?: Agent | null): number {
  if (!agent) return 1
  // CC-64：角色级默认值经模块声明 defaultBasicAttackTimeWeight（现：蕾米埃尔 / 薇薇安 = 0）
  const declared = getAgentMechanic(agent.id)?.defaultBasicAttackTimeWeight
  if (declared !== undefined) return declared
  if (agent.specialty === 'support' || agent.specialty === 'defense') return 0
  return 1
}

function defaultCharacter(slot: number, agentId: string, element: string): CharacterConfig {
  return {
    slot,
    agentId,
    cinemaLevel: 6,
    potentialLevel: 6,
    wEngineId: '',
    wEngineModLevel: 5,
    driveDisc: defaultDriveDisc(element),
    parryCount: 0,
    dodgeCounterCount: 0,
    blockCount: 0,
    perfectBlockCount: 0,
    assaultOrderCount: 0,
    dualCounterCount: 0,
    tauntCancelCount: 0,
    yixuanInk2Count: 0,
    promiaNiyingCount: 0,
    yixuanInk3Count: 0, // ≤0 = 自动：剩余闪能全部轴外打 3 连墨痕化形（60/次）；≥1 手填
    yixuanPerfectBlockCount: 0, // ≤0 = 自动：全完美格挡 = 弹刀次数（+10 闪能/次）；≥1 手填
    yixuanExtremeAssistCount: -1,
    yixuanBackstageComboCount: 0,
    quickAssistCount: 0,
    chainCountPerStun: 0,
    basicAttackTimeWeight: 1,
  }
}

/**
 * 按角色的交互次数默认值（主页「战斗动作次数」预填展示，相当于帮用户填好；用户可改）。
 * CC-65b：数据下沉为角色模块声明 `interactionDefaults`（星徽·比利 starlightBilly.ts、般岳 banyue.ts）；无声明 = 全 0。
 * 返回副本（原实现返回共享表对象，调用方均只读；副本更安全）。
 */
export function getInteractionDefaults(agentId: string): { parry: number; dodge: number; block: number; dual: number } {
  const d = agentId ? getAgentMechanic(agentId)?.interactionDefaults : undefined
  return d ? { ...d } : { parry: 0, dodge: 0, block: 0, dual: 0 }
}

/**
 * 通用交互基准（无角色专属默认时按职业；用户口径 2026-09-04 回调）：
 * - 支援/防护：0 交互——支援上战场 1 秒 = 浪费主C 1 秒输出，其后台时间不是发呆（主C 在打）。
 * - 其余（强攻/异常/击破）：弹刀 6 + 闪反 10（闪反在动作时间内给 2× 伤害+失衡；弹刀靠后续
 *   支援突击 + 喧响/失衡纯赚）。基准是「默认大家会打」，不是硬凑——时间紧的队（如叶瞬光
 *   白毛优先）由非轴降配 interactionScale 按必要时间挤占缩放（useResourceCalc 738-742）。
 * 之前一度全默认 0 导致「谁都不打、留时间发呆」，是过度矫正（叶瞬光个案不该推广到全队池）。
 */
// @fact engine:交互基准 口径: 非支援/防护默认弹刀6/闪反10（闪反动作时间内2×伤害失衡、弹刀喧响失衡纯赚），支援/防护0；基准可被必要时间挤占（超预算时 interactionScale 缩放），不硬凑 | 据 用户@2026-09-04·复核@2026-09-08·复核@2026-09-25·锚未变@2026-09-27·复核@2026-09-30 | 验 src/stores/__tests__/roleInteractionBaseline.test.ts | 锚 src/stores/config.ts#roleInteractionBaseline | 信 确认
export function roleInteractionBaseline(specialty: string | undefined): { parry: number; dodge: number; block: number; dual: number } {
  if (specialty === 'support' || specialty === 'defense') return { parry: 0, dodge: 0, block: 0, dual: 0 }
  return { parry: 6, dodge: 10, block: 0, dual: 0 }
}

/**
 * 角色「动作次数」类字段的上下界表（单一事实源，2026-09-11）。
 *
 * 为什么集中：这些字段此前各有 4 行逐字复制的 setter（`const char = team.value[slot]; if (char)
 * char.x = Math.max(a, Math.min(b, count))`），16 份只有「字段名 + 上下界」不同（99 / 999 / 3 / -1
 * 四档）。代价有二：①改 clamp 语义要改 16 处；②每录一个带动作次数的角色就再抄一份样板。
 * （其余 setter 属别的语义族——等级 0..6/1..6/1..5、字符串 id、驱动盘——**不并入本表**。）
 *
 * 口径（逐字段与原 setter 逐位一致，改一个数字就是数值回归）：
 * - 常规计数 `0..99`；`assaultOrderCount` / `perfectBlockCount` `0..999`（强袭训令/完美格挡可上百）；
 * - `chainCountPerStun` `0..3`（每次失衡最多 3 连携）；
 * - `yixuanExtremeAssistCount` `-1..99`（**-1 = 自动**取队友弹刀和上限，模块哨兵口径）。
 */
export const ACTION_COUNT_BOUNDS = {
  parryCount: { min: 0, max: 99 },
  dodgeCounterCount: { min: 0, max: 99 },
  blockCount: { min: 0, max: 99 },
  dualCounterCount: { min: 0, max: 99 },
  quickAssistCount: { min: 0, max: 99 },
  chainCountPerStun: { min: 0, max: 3 },
  basicAttackTimeWeight: { min: 0, max: 99 },
  assaultOrderCount: { min: 0, max: 999 },
  perfectBlockCount: { min: 0, max: 999 },
  yixuanInk2Count: { min: 0, max: 99 },
  yixuanInk3Count: { min: 0, max: 99 },
  yixuanPerfectBlockCount: { min: 0, max: 99 },
  yixuanExtremeAssistCount: { min: -1, max: 99 },
  yixuanBackstageComboCount: { min: 0, max: 99 },
  promiaNiyingCount: { min: 0, max: 99 },
  tauntCancelCount: { min: 0, max: 99 },
} as const satisfies Record<string, { min: number; max: number }>

export type ActionCountField = keyof typeof ACTION_COUNT_BOUNDS

/** 按字段上下界钳制动作次数（纯函数，供 store 与测试共用；越界输入一律收敛到界内） */
export function clampActionCount(field: ActionCountField, count: number): number {
  const { min, max } = ACTION_COUNT_BOUNDS[field]
  return Math.max(min, Math.min(max, count))
}

/**
 * 正反馈 refund 模块不吃通用交互基准（用户口径 2026-09-04「接线」）：伊德海莉是蓄力→极寒重碾
 * 循环 carry，弹刀/闪反归击破位，给她通用弹刀6/闪反10 会失真。refund 反馈本身已由
 * resolveExSpecialCount 连续松弛修复（种子无关），此排除是玩法口径而非确定性补丁。
 * CC-65b：名单下沉为角色模块声明 `noGenericInteraction`（yidhari.ts），见 interactionBaselineFor。
 */

/**
 * 手动队默认交互（单一事实源，setAgent 预填用）：
 * 角色专属默认（getInteractionDefaults）> 正反馈排除（0）> 职业基准（roleInteractionBaseline）。
 */
export function interactionBaselineFor(agentId: string, specialty?: string): { parry: number; dodge: number; block: number; dual: number } {
  if (agentId && getAgentMechanic(agentId)?.noGenericInteraction) return { parry: 0, dodge: 0, block: 0, dual: 0 }
  return hasCustomInteractionDefaults(agentId) ? getInteractionDefaults(agentId) : roleInteractionBaseline(specialty)
}

/**
 * **快支 / 连携基准**（CC-264 单一来源；setAgent 预填、轻量装配 teamTimelineStore、部署 runArchiveDeploy 共用）。
 * 口径 = 用户 2026-08-30 部署口径（runArchiveDeploy 原注释）：「快支固定 3 作为喧响基础供给；连携基准 1
 * （轴模式由轴内连携块反推覆盖）」。修前 setAgent 不写这两项 ⇒ 散点 / 难度曲线 / 定位对比对 auto 预设
 * 继承用户 store 里的隐藏值（新用户 = defaultCharacter 0/0，即**完全没有连携**：104 预设伤害中位 −3.3%、最多 −23.7%），
 * 而轻量装配与部署是 3/1 ⇒ 同一支队在不同页面口径不同。全体角色同值（含支援位与 noGenericInteraction：
 * 那条声明只管弹刀 / 闪反归属）。回退：setAgent 删两行赋值即回到「继承用户值」。
 */
export const ASSIST_ACTION_BASELINE = { quickAssist: 3, chainPerStun: 1 } as const

/**
 * 角色是否有专属交互默认值（任一项 > 0）。CC-255：此前 pullPlannerEngine / teamTimelineStore / charIncrement /
 * runArchiveDeploy 各内联一份「hasCustom ? defs : 职业基准」，都漏了 noGenericInteraction（1051 伊德海莉被发通用弹刀/闪反）；
 * 现一律调 interactionBaselineFor，只有「不预设弹刀」的部署口径（runArchiveDeploy）另需本判定。
 */
export function hasCustomInteractionDefaults(agentId: string): boolean {
  const defs = getInteractionDefaults(agentId)
  return defs.parry > 0 || defs.dodge > 0 || defs.block > 0 || defs.dual > 0
}

/** 推荐主词条 prop name → catalog statId 映射（含中文别名）。
 *  探针（panelProbe.test.ts）与配装推荐应用共用，导出防两处漂移。 */
export const REC_MAIN_STAT_MAP: Record<string, string> = {
  'ATK': 'atkPct',
  'HP': 'hpPct',
  'DEF': 'defPct',
  'CRIT Rate': 'critRate',
  'CRIT DMG': 'critDmg',
  'PEN Ratio': 'penRatio',
  'Impact': 'impact',
  'Anomaly Proficiency': 'anomalyProficiency',
  'Anomaly Mastery': 'anomalyMastery',
  'Energy Regen': 'energyRegen',
  'Physical DMG Bonus': 'physicalDmg',
  'Fire DMG Bonus': 'fireDmg',
  'Ice DMG Bonus': 'iceDmg',
  'Electric DMG Bonus': 'electricDmg',
  'Ether DMG Bonus': 'etherDmg',
  'Wind DMG Bonus': 'windDmg',
  // 中文别名（build-recommendations 的 name 可能是中文）
  '攻击力': 'atkPct',
  '生命值': 'hpPct',
  '防御力': 'defPct',
  '暴击率': 'critRate',
  '暴击伤害': 'critDmg',
  '穿透率': 'penRatio',
  '冲击力': 'impact',
  '异常精通': 'anomalyProficiency',
  '异常掌控': 'anomalyMastery',
  '能量自动回复': 'energyRegen',
  '物理伤害加成': 'physicalDmg',
  '火属性伤害加成': 'fireDmg',
  '冰属性伤害加成': 'iceDmg',
  '电属性伤害加成': 'electricDmg',
  '以太伤害加成': 'etherDmg',
  '风属性伤害加成': 'windDmg',
}

function defaultResistanceTable(value: number): Record<string, number> {
  return {
    physical: value,
    fire: value,
    ice: value,
    electric: value,
    ether: value,
    wind: value,
  }
}

function defaultEnemy(): EnemyConfig {
  return {
    hp: 205970837,
    stunValue: 15486,
    stunTime: 12,
    stunCountLock: -1,
    stunVuln: 1.5,
    defense: 953,
    level: 70,
    anomalyCoeff: 1,
    bossAnomalyCoeff: 1.1,
    bossStunGift: 0,
    shieldCount: 1,
    energyShield: 0,
    invincibleTime: 0,
    battleTime: 180,
    bodySize: 'large',
    damageResistances: defaultResistanceTable(0),
    stunResistances: defaultResistanceTable(0),
    anomalyResistances: defaultResistanceTable(0),
    weakness: [],
  }
}

function defaultGlobalBuffs(): GlobalBuffRow[] {
  return [
    { id: 'b1', name: '危局buff', stat: 'atkPct', value: 20, enabled: true, targetSkillType: 'all' },
    { id: 'b2', name: '危局buff', stat: 'dmgBonus', value: 15, enabled: true, targetSkillType: 'all' },
    { id: 'b3', name: 'boss增伤', stat: 'enemyDamageTakenBonus', value: 0, enabled: false, targetSkillType: 'all' },
  ]
}

// ========== Store ==========

// ========== 队友 buff 启用状态：纯派生（模块级，可独立单测）==========
// 2026-09-12 评审 #9：原内联在 store 方法里；因顶格书写而看似模块级，实际在 defineStore
// 回调内（`export` 会报 TS1184）。抽到模块级后可用合成输入直接单测边界。

/** 从 buff source 名称解析所需的影画等级
 *  "核心被动" → 0, "额外能力" → 0, "强化特殊技" → 0
 *  "影画一" → 1, "影画二" → 2, "影画三" → 3, "影画四" → 4, "影画五" → 5, "影画六" → 6
 *  解析失败默认 0（总是启用）——所以「影画2」这类阿拉伯数字写法会被当成无影画要求；
 *  additionalGate.test.ts 的 CC-311 不变量锁保证数据里凡含「影画」的标签都解析出 1..6。
 */
export function parseCinemaRequirement(sourceLabel: string): number {
  const cnNums: Record<string, number> = {
    '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6,
  }
  const match = sourceLabel.match(/影画([一二三四五六])/)
  if (match) return cnNums[match[1]] ?? 0
  // 核心被动/额外能力/强化特殊技 等不需要影画
  return 0
}

/**
 * 队友 buff 启用状态的**纯派生**（2026-09-12 抽自 store 方法 `syncTeammateBuffsFromTeam`，评审 #9）。
 *
 * 为什么抽出来：这段判定（队伍 × 影画等级 × 额外能力激活 × 三个角色特例）此前内联在 store 方法里，
 * 只能靠「建 store + 载 catalog」才测得到；抽成纯函数后可用**合成输入**直接单测边界
 * （不在队 / 影画不足 / 额外能力未激活 / 雷米尔分层 / 波可娜 C6 互斥）。
 *
 * 语义与抽取前逐条一致（这是零行为抽取，不是重构）：
 * - 返回顺序 = `groups` 遍历顺序（写入端依赖该顺序决定对象键序，positionCompare 会快照该对象）；
 * - 只回答「**应该**启用吗」——用户手动开关与覆盖率由 store 的选择表持有（见 sync 的合并逻辑）。
 */
/**
 * `deriveTeammateBuffEnabled` 读取的**全部**槽位字段——入参类型与 store 的重同步 watch 源都由它生成。
 * 2026-09-24：watch 源曾手写成 `{agentId, cinemaLevel}`，而派生函数还读潜能/音擎（经额外能力判定），
 * 两边各写一份就会漂。现在新增依赖字段只改这一处，类型与 watch 同时跟上。
 */
const TEAMMATE_BUFF_INPUT_KEYS = ['slot', 'agentId', 'cinemaLevel', 'potentialLevel', 'wEngineId', 'wEngineModLevel'] as const
type TeammateBuffInput = Pick<CharacterConfig, typeof TEAMMATE_BUFF_INPUT_KEYS[number]>

export function deriveTeammateBuffEnabled(
  team: ReadonlyArray<TeammateBuffInput>,
  groups: readonly TeammateBuffGroup[],
  getAgent: (agentId: string) => Agent | null | undefined,
): Array<{ id: string; enabled: boolean }> {
  // 收集队伍中每个角色的影画等级（键 = agentId = 队友 buff 组 id）
  const teamCinema: Record<string, number> = {}
  const teamAgents = team
    .filter(char => !!char.agentId)
    .map(char => ({ char, agent: getAgent(char.agentId!) }))
    .filter(item => !!item.agent)

  for (const { char } of teamAgents) {
    if (char.agentId) {
      // 队友 buff 组 id = agentId（CC-276：别名字段退役）
      teamCinema[char.agentId] = char.cinemaLevel
    }
  }

  // 构建 MechanicTeamMember[] 用于额外能力条件统一判定
  const mechanicTeam: MechanicTeamMember[] = teamAgents.map(({ char, agent }) => ({
    slot: char.slot,
    agentId: char.agentId ?? '',
    agent: agent ?? null,
    cinemaLevel: char.cinemaLevel ?? 0,
    potentialLevel: char.potentialLevel ?? 6,
    wEngineId: char.wEngineId ?? '',
    wEngineModLevel: char.wEngineModLevel ?? 1,
  }))
  // CC-206：额外能力门控直接调引擎同一个求值函数（含凯撒「有任意队友」、菲欧妮 tier3「异常数≥3」等模块修正）。
  // 此前这里另算一份 aaActiveMap（只看 spec 声明、不经模块修正）⇒ 凯撒有异阵营队友时引擎放行、这里默认不勾；
  // 菲欧妮 tier3 异常数不足时这里默认勾上、引擎丢弃。现在「默认勾不勾」==「引擎认不认」。
  const aaGates = evalAdditionalAbilityBuffGates(mechanicTeam, aid => getAgent(aid) ?? null, groups)
  // CC-64b / CC-207：模块钩子 teammateBuffGate（蕾米埃尔档位、波可娜 C6 互斥）——与引擎共用 teammateBuffGateBlocks（r403 起只问组拥有者）
  const gateBlocked = teammateBuffGateBlocks(mechanicTeam, groups)

  const out: Array<{ id: string; enabled: boolean }> = []
  // 遍历所有队友 buff 组（保持 groups 顺序 = 抽取前写入对象键序）
  for (const group of groups) {
    const agentId = group.id
    const cinemaLevel = teamCinema[agentId]
    const inTeam = cinemaLevel !== undefined

    for (const buff of group.buffs ?? []) {
      const sourceLabel = buff.source?.zhCN ?? buff.sourceLabel?.zhCN ?? ''
      const requiredCinema = parseCinemaRequirement(sourceLabel)
      const baseShouldEnable = inTeam && cinemaLevel >= requiredCinema
      // CC-64c：波可娜 C6 base 条互斥也经 teammateBuffGate（pulchra.ts 声明；原为此处写死 1351 分支）
      let shouldEnable = baseShouldEnable && !gateBlocked.has(buff.id)
      // 通用额外能力门控（CC-203 表 + CC-206 同一求值函数）：引擎门控关 ⇒ 默认不勾。
      // CC-199：按组 id（= 拥有者）查，不按 buff.ownerId——catalog 里 1411/1581/1511 的 ownerId 是拼音 slug
      // （youye/remielle/nangongyu），按它查恒 undefined ⇒ 柚叶额外能力曾无条件生效。
      if (shouldEnable && aaGates.get(buff.id) === false) shouldEnable = false
      out.push({ id: buff.id, enabled: shouldEnable })
    }
  }
  return out
}

/** 配置装配只读的目录能力；既可由 UI catalog 提供，也可由任务捕获的数据提供。 */
export type ConfigCatalogReader = Readonly<Pick<ReturnType<typeof useCatalogStore>,
  | 'ready' | 'teammateBuffsReady' | 'teammateBuffsLoaded' | 'buildRecsLoaded'
  | 'teammateBuffGroups' | 'displayAgents' | 'displayWEngines' | 'displayDriveDiscSets'
  | 'driveDiscSetsMap' | 'statRules' | 'getAgent' | 'getWEngine' | 'getBuildRecommendation'
>>

/**
 * 配置的唯一 Implementation：显式注入只读目录，不查找 active Pinia、不加载数据。
 * UI store 和独立场景使用同一套装配/派生规则；独立调用方负责 effectScope 生命周期。
 *
 * `initialState`（可选，2026-10-01 arena-C r369）= 独立场景的**出生态**：键 = `$state` 的键，值必须是调用方
 * 独占的深拷贝（`composables/analysisScenario#createAnalysisScenario` 负责拷贝）。它在任何依赖 state 的
 * watcher 注册之前写入（见下方「独立场景出生态」段），watcher 只见出生之后的修改。UI store 不传，行为不变。
 */
export function createConfigModel(catalogStore: ConfigCatalogReader, initialState?: Readonly<Record<string, unknown>>) {

  // 3人队伍
  const team = ref<CharacterConfig[]>([
    defaultCharacter(0, '', 'physical'),
    defaultCharacter(1, '', 'physical'),
    defaultCharacter(2, '', 'physical'),
  ])

  // 全局 Buff 表
  const globalBuffs = ref<GlobalBuffRow[]>(defaultGlobalBuffs())

  // 队友 Buff 选择（buffId -> { enabled, coverage }）
  const teammateBuffSelections = ref<Record<string, { enabled: boolean; coverage: number }>>({})

  // 音擎效果覆盖率（effectId -> 0-100）；默认未设置时按100%覆盖
  const wEngineEffectCoverages = ref<Record<string, number>>({})

  // 驱动盘套装效果覆盖率（effectId -> 0-100）：条件类 4pc/2pc 效果的 uptime 折算，与音擎覆盖率同模式
  const discEffectCoverages = ref<Record<string, number>>({})
  function setDiscEffectCoverage(effectId: string, coverage: number) {
    discEffectCoverages.value[effectId] = Math.max(0, Math.min(100, coverage))
  }
  function getDiscEffectCoverage(effectId: string): number {
    return discEffectCoverageOf(discEffectCoverages.value, effectId)
  }

  // 资源利用率（agentId:actionId -> { rate, cap }），用于把资源池上限折算为实际释放次数（CC-386：键随角色，见 ownerKeyOf）
  const resourceUtilization = ref<Record<string, ResourceUtilizationOverride>>({})
  // 机制模块通用可调参数：settingId -> 数值
  const mechanicSettings = ref<Record<string, number>>({})
  // 按角色槽位/机制命名的可调参数，例如蕾米 Q 虚耀分配
  const teamMechanicSettings = ref<Record<string, number>>({})
  // 每个角色异常积蓄利用率（0-1）：默认 1（应用率已由执行次数体现，支援/防护同样按实际招式积蓄——
  // 旧「支援/防护 0.1」启发式会把丽娜等电异常支援的总积蓄 ÷10，与实际应用量不符；用户可经滑块微调）
  // CC-386：key = agentId（不是槽位）
  const anomalyUtilizationRates = ref<Record<string, number>>({})
  // 每个元素/角色的结算占比覆盖：key = `${element}:${agentId}`（CC-386），值为0-1
  const anomalySettlementShares = ref<Record<string, number>>({})

  // 敌人配置
  const enemy = ref<EnemyConfig>(defaultEnemy())

  // 合轴率覆盖（slot → moveId → ratio 0-1）
  // 用户在结果页调节，覆盖倍率表中的默认值（默认0）
  const comboAlignOverrides = ref<Record<number, Record<string, number>>>({})

  // 失衡轴配置
  const stunAxes = ref<import('@/types/resource').StunAxis[]>([])
  // 条件轴方案（按资源量自选轴：resolveStunAxisPlan 按 when 命中；存在时优先于 stunAxes）
  const stunAxisPlans = ref<import('@/types/resource').StunAxisPlan[]>([])
  const useStunAxis = ref(false)
  const cloneJson = <T>(v: T): T => JSON.parse(JSON.stringify(v))
  /** 轴状态深拷贝（快照用；与 store 不共享对象） */
  function getAxisState(): StunAxisState {
    return { stunAxes: cloneJson(stunAxes.value), stunAxisPlans: cloneJson(stunAxisPlans.value), useStunAxis: useStunAxis.value }
  }
  /** 整体写回轴状态（深拷贝写入：同一份快照可反复恢复，store 后续编辑不会改到快照） */
  function setAxisState(s: StunAxisState) {
    stunAxes.value.splice(0, stunAxes.value.length, ...cloneJson(s.stunAxes))
    stunAxisPlans.value.splice(0, stunAxisPlans.value.length, ...cloneJson(s.stunAxisPlans))
    useStunAxis.value = s.useStunAxis
  }
  /**
   * 应用轴预设：条件方案与固定轴**互斥**写入（resolveAxes 优先级 plans > stunAxes > 自动，留着另一条会遮蔽或被遮蔽），
   * 写入后打开总开关。预设两者皆空 ⇒ 什么都不改、返回 false（内置预设全部非空，见 stunAxisState.test）。
   */
  function applyStunAxisPreset(p: { axes?: StunAxisState['stunAxes']; plans?: StunAxisState['stunAxisPlans'] }): boolean {
    const plans = p.plans?.length ? p.plans : null
    const axes = !plans && p.axes?.length ? p.axes : null
    if (!plans && !axes) return false
    setAxisState({ stunAxes: axes ?? [], stunAxisPlans: plans ?? [], useStunAxis: true })
    return true
  }
  // 章鱼自动轴（队伍含伊德海莉 1051 时按 章×有琉 自动开失衡轴并选预设；手动配置过轴时让路）
  const autoYidhariAxis = ref(true)
  /**
   * **降配档单向闸门**（用户口径 2026-09-20）：
   * 「合轴率、交互档等正向因子可以单调，不要一个上升一个下降，这样对伤害的计算不确定，
   *  交互的计算也不确定。合轴降低是难度降低伤害降低，交互升高就是难度升高」。
   *
   * 治的形态（实测 叶瞬光+琉音+照 C0）：`stageResolveFeasibility` 每轮重求「最大可行 scale」——
   * 合轴率 0.20 → 0.10 时时间账变宽，交互档从 0.25 **回升**到 0.375（闪反 3→4、伤害 24.21M→24.36M）
   * ⇒ 正因子下降却把伤害推上去，难度轴与伤害都不再单调。
   *
   * 语义 = 本轮自动降配允许到达的**最大 scale**（1 = 不设限，历史行为）。难度曲线在跑某一档前
   * 把它钉成该档的交互系数 ⇒ 「合轴率↓ ⇒ 交互档不回升 ⇒ 伤害同向」。
   * ⚠ 缺省 1 + monotone=false：普通计算路径逐位不变（降配逻辑与历史完全一致）。
   */
  const interactionScaleCeiling = ref(1)
  /** 降配档单调闸门开关（见上；难度曲线跑一般化档位时置 true，缺省 false = 历史行为） */
  const interactionScaleMonotone = ref(false)
  /**
   * 平A池权重·**分配策略三态**（默认 `'balanced'`；用户 2026-09-10 裁决）。
   *
   * · `'static'`   = **不跑策略**：用静态默认权重（强攻/异常/击破=1、支援/防护=0）或用户手填值。
   *   —— 难度曲线「全关」档的落点，也把手填权重的自由度还回来（此前默认跑 B 后没有静态模式了）。
   * · `'balanced'` = **边际均衡（B）**：按团队总伤在槽位间转移平A时间（≈3 倍求值）——默认。
   * · `'joint'`    = **多杠杆联合（C，更慢）**：均衡 + **弹刀次数**阶梯（≈15~20 次求值 ~1.5s）；
   *   硬门 = 不发生时间线截断（前台净占用 ≤ 预算）——用户口径「弹刀多了也不能超过总时间」。
   *
   * 切到 `'static'` **不还原**已写回的权重/弹刀（B 只承诺权重、不承担还原，用户 2026-09-10 已裁决）：
   * 要回到干净静态值，重新套一次预设即可。策略映射单源 = `timeWeightAllocation#timeWeightStrategyIdForMode`。
   */
  const timeWeightStrategy = ref<import('@/types/resource').TimeWeightMode>('balanced')
  function setTimeWeightStrategy(v: import('@/types/resource').TimeWeightMode) {
    timeWeightStrategy.value = v === 'static' || v === 'joint' ? v : 'balanced'
  }

  // ========== Computed ==========

  function getAgent(slot: number): Agent | null {
    const id = team.value[slot]?.agentId
    if (!id) return null
    return catalogStore.getAgent(id) ?? null
  }

  function getWEngine(slot: number): WEngine | null {
    const id = team.value[slot]?.wEngineId
    if (!id) return null
    return catalogStore.getWEngine(id) ?? null
  }

  // 队伍中已选的角色 ID（用于过滤重复选择）
  const usedAgentIds = computed<string[]>(() =>
    team.value.map(c => c.agentId).filter(Boolean)
  )

  // ========== Actions - 队伍 ==========

  /**
   * 换人 + 自动推荐。
   * opts.defer = 批量换人（applyTeamPreset）时挂起同步/推荐副作用，
   * 避免 3 次 setAgent 各跑一遍配装推荐（副词条默认分配）；由调用方最后统一触发。
   */
  function setAgent(slot: number, agentId: string, opts?: { defer?: boolean }) {
    const char = team.value[slot]
    if (!char) return
    char.agentId = agentId
    // CC-267：换人 = **全部**动作次数回到模板值（ACTION_COUNT_BOUNDS 全集，含嘲讽取消 / 仪玄系 / 普罗米娅等专属字段），
    // 再由下方按新角色预填基准。修前只重置弹刀 / 闪反 / 格挡 / 双反 / 平A权重，上一个角色的专属次数留在槽上：
    // liveInteractions 对任意槽都读 tauntCancel / perfectBlock / yixuanPerfectBlock ⇒ 散点 104 预设 x 全体虚高，
    // 仪玄 / 普罗米娅预设伤害随用户残留值变（实测 −23% ~ +2%）。本行让逐预设循环不再需要 restoreActionCounts（已删）。
    {
      const tpl = defaultCharacter(slot, agentId, '')
      for (const f of Object.keys(ACTION_COUNT_BOUNDS) as ActionCountField[]) (char as Record<ActionCountField, number | undefined>)[f] = tpl[f]
      // CC-268：潜能同属「随角色」字段且没有任何分析器 / applyTeamPreset 显式设置 ⇒ 上一个角色的潜能会漏给新角色
      // （散点实测：用户槽潜能 1 时 40/104 预设伤害变化，最多 −20.7%，艾莲 / 悠真（harumasa 1201）/ 零号安比模块与 spec 公式 p 变量读它）。
      // 命座 / 精炼不在此重置：所有分析器与 applyTeamPreset 都显式设置；主页换人保留用户所选档位是有意的 UX。
      char.potentialLevel = tpl.potentialLevel
    }

    const agent = catalogStore.getAgent(agentId)
    if (agent) {
      // 手动队默认会打（用户口径 2026-09-04「接线」）：换人即按 角色专属默认 > 正反馈排除 > 职业基准
      // 预填交互次数（相当于帮用户填好，用户可改）；预设显式 interactions 在 setAgent 之后应用会覆盖本预填。
      const base = interactionBaselineFor(agentId, agent.specialty)
      char.parryCount = base.parry
      char.dodgeCounterCount = base.dodge
      char.blockCount = base.block
      char.dualCounterCount = base.dual
      // CC-264：快支 / 连携同为「默认会打」的基础交互，按单一来源预填（预设显式声明仍在其后覆盖）
      char.quickAssistCount = ASSIST_ACTION_BASELINE.quickAssist
      char.chainCountPerStun = ASSIST_ACTION_BASELINE.chainPerStun

      // 自动推荐音擎：优先该角色的专属音擎（ownerAgentId），其次同职业第一个 S 级，最后任意 S 级
      const wEngines = catalogStore.displayWEngines
      const exclusive = wEngines.find(w => w.ownerAgentId === agentId)
      const sameSpecialty = wEngines.filter(
        w => w.rarity === 'S' && w.specialty === agent.specialty
      )
      if (exclusive) {
        char.wEngineId = exclusive.id
      } else if (sameSpecialty.length > 0) {
        char.wEngineId = sameSpecialty[0].id
      } else {
        const sRanked = wEngines.filter(w => w.rarity === 'S')
        char.wEngineId = sRanked[0]?.id || ''
      }

      // 自动设置驱动盘5号位主词条
      const dmgKey = elementStatKey('dmg', agent.damageElement) // CC-225 单一来源
      if (dmgKey && char.driveDisc.mainStats) {
        char.driveDisc.mainStats[5] = dmgKey
      }

      // 自动设置平A时间分配权重：蕾米埃尔、支援、防护默认不分配平A时间
      char.basicAttackTimeWeight = defaultBasicAttackTimeWeight(agent)

      // 先给一个兜底套装；如果配装推荐已加载，下面会被推荐配置覆盖
      const sets = catalogStore.displayDriveDiscSets
      if (sets.length > 0) {
        char.driveDisc.fourPieceSetId = sets[0].id
        char.driveDisc.twoPieceSetId = sets[0].id
      }

      if (!opts?.defer) {
        syncTeammateBuffsFromTeam()
        applyBuildRecommendationForSlot(slot)
      }
    } else {
      // CC-340：清空槽位（setAgent(slot, '')）时一并清空音擎，避免旧角色的专武残留在空槽上
      char.wEngineId = ''
      if (!opts?.defer) syncTeammateBuffsFromTeam()
    }
  }

  function setCinemaLevel(slot: number, level: number) {
    const char = team.value[slot]
    if (char) {
      char.cinemaLevel = Math.max(0, Math.min(6, level))
    }
  }

  function setPotentialLevel(slot: number, level: number) {
    const char = team.value[slot]
    if (char) {
      char.potentialLevel = Math.max(1, Math.min(6, level))
    }
  }

  function setWEngine(slot: number, wEngineId: string) {
    const char = team.value[slot]
    if (char) char.wEngineId = wEngineId
  }

  function setWEngineModLevel(slot: number, level: number) {
    const char = team.value[slot]
    if (char) char.wEngineModLevel = Math.max(1, Math.min(5, level))
  }

  function setFourPieceSet(slot: number, setId: string) {
    const char = team.value[slot]
    if (char) char.driveDisc.fourPieceSetId = setId
  }

  function setTwoPieceSet(slot: number, setId: string) {
    const char = team.value[slot]
    if (char) char.driveDisc.twoPieceSetId = setId
  }

  function setMainStat(slot: number, slotNum: 4 | 5 | 6, statId: string) {
    const char = team.value[slot]
    if (!char?.driveDisc.mainStats) return
    char.driveDisc.mainStats[slotNum] = statId
  }

  function setSubStatCount(slot: number, statId: string, count: number) {
    const char = team.value[slot]
    if (!char?.driveDisc.subStatAllocation) return
    const pool = catalogStore.statRules?.driveDisc?.subStatPool ?? []
    if (pool.length > 0 && !pool.includes(statId)) {
      delete char.driveDisc.subStatAllocation[statId]
      return
    }
    const safeCount = Math.max(0, Math.min(54, count))
    if (safeCount <= 0) delete char.driveDisc.subStatAllocation[statId]
    else char.driveDisc.subStatAllocation[statId] = safeCount
  }

  // ========== 角色动作次数：唯一写入通道 ==========
  //
  // 所有动作次数 / 平A时间权重字段都经 `setActionCount(slot, '<字段>', n)` 写入（上下界见模块级
  // ACTION_COUNT_BOUNDS / clampActionCount）。CC-357（r387）删掉了原 15 个一行包装的命名 setter
  // （`set<字段名>` 形式，如平A权重 / 各角色专属次数）：store 不再随角色数线性增长，新角色只需在界表加字段。
  // 锁：actionCountBounds.test.ts「store 不导出按字段命名的 setter」。
  function setActionCount(slot: number, field: ActionCountField, count: number) {
    const char = team.value[slot]
    if (char) char[field] = clampActionCount(field, count)
  }

  function getDefaultBasicAttackTimeWeight(agent?: Agent | null): number {
    return defaultBasicAttackTimeWeight(agent)
  }

  /**
   * CC-269：推荐套装按 **id** 解析（build-recommendations 每条都带 catalog 套装 id，类型必填），名字只作兜底且去首尾空白。
   * 修前只按 name_zh 全等匹配：数据里「雪兔梦游仙境 」带尾随空格 ⇒ 凯撒 / 赛斯 / 照 / 潘引壶四名防护的 4pc 解析失败，
   * 静默落到 setAgent 的兜底套装（displayDriveDiscSets[0]），全队 +18% 伤害的雪兔 teamBuff 从未进入推荐配装与散点。
   */
  function findDriveDiscSetForRecommendation(entry?: { id?: string; name_zh?: string; name_en?: string }) {
    if (!entry) return undefined
    const sets = catalogStore.displayDriveDiscSets
    const byId = entry.id ? sets.find(set => set.id === String(entry.id)) : undefined
    if (byId) return byId
    const name = (entry.name_zh || entry.name_en || '').trim()
    if (!name) return undefined
    return sets.find(set => localized(set.name).trim() === name)
  }

  /** 自动/手动应用当前角色的配装推荐：专武、驱动盘、主词条、副词条 */
  function applyBuildRecommendationForSlot(slot: number): boolean {
    const char = team.value[slot]
    if (!char?.agentId) return false
    const rec = catalogStore.getBuildRecommendation(char.agentId) as CharacterBuildRecommendation | undefined
    if (!rec) return false

    if (rec.wengine?.catalog_wengine_id) {
      char.wEngineId = rec.wengine.catalog_wengine_id
    }

    const fourPieceSet = findDriveDiscSetForRecommendation(rec.drive_disc_sets?.four_piece)
    if (fourPieceSet) char.driveDisc.fourPieceSetId = fourPieceSet.id

    const twoPieceSet = findDriveDiscSetForRecommendation(rec.drive_disc_sets?.two_piece)
    if (twoPieceSet) char.driveDisc.twoPieceSetId = twoPieceSet.id

    for (const slotNum of [4, 5, 6] as const) {
      const recStat = rec.main_stats?.[String(slotNum) as '4' | '5' | '6']
      const statId = recStat ? REC_MAIN_STAT_MAP[recStat.name] : undefined
      if (statId) char.driveDisc.mainStats[slotNum] = statId
    }

    char.driveDisc.subStatAllocation = {}
    if (rec.substats?.length) {
      const agent = catalogStore.getAgent(char.agentId)
      const wEngine = char.wEngineId ? catalogStore.getWEngine(char.wEngineId) : undefined
      if (agent) {
        // 默认分配（用户口径 2026-08：按模板优先序填词条，暴击填到「百暴」）；0 = 该档默认总步数。
        // CC-186（第 209 轮）：原 `optimizer.useDefault=0` 整队贪心分支已删——该设置自引入起从无写入点（无 UI / 导入 / 持久化），
        // 分支生产不可达，它写的 perSlotMarginalGains 永远为空。求最优走编排层真实伤害精修（composables/substatOptimizer.ts）。
        // 详见 docs/mcp-stun-dual-source.md §24.33。
        // 预算（设置键 / 缺省 / 分档）与写回规整的唯一来源在 core/substatOptimizer（arena-D 第 361 轮）
        const alloc = computeDefaultSubStatAllocation({
          agent,
          wEngine,
          driveDiscConfig: char.driveDisc,
          setsMap: catalogStore.driveDiscSetsMap,
          teammateBuffs: [],
          statRules: catalogStore.statRules,
          ...resolveSubstatBudget(getTemplate(agent), getMechanicSetting),
          config: { cinemaLevel: char.cinemaLevel, wEngineModLevel: char.wEngineModLevel, potentialLevel: char.potentialLevel, enemyWeakness: enemy.value.weakness },
        })
        char.driveDisc.subStatAllocation = normalizeSubstatAllocation(alloc)
      }
    }

    return true
  }

  /** 获取某角色某招式的合轴率覆盖值，无覆盖时返回 defaultValue */
  function getComboAlignOverride(slot: number, moveId: string, defaultValue: number = 0): number {
    return comboAlignOverrides.value[slot]?.[moveId] ?? defaultValue
  }

  /** 设置某角色某招式的合轴率覆盖值 */
  function setComboAlignOverride(slot: number, moveId: string, ratio: number) {
    if (!comboAlignOverrides.value[slot]) {
      comboAlignOverrides.value[slot] = {}
    }
    comboAlignOverrides.value[slot][moveId] = Math.max(0, Math.min(1, ratio))
  }

  /** 清除某角色所有合轴率覆盖 */
  function clearComboAlignOverrides(slot: number) {
    delete comboAlignOverrides.value[slot]
  }

  // ========== Actions - 全局 Buff ==========

  function addGlobalBuff() {
    const id = 'b' + Date.now()
    globalBuffs.value.push({
      id,
      name: '新buff',
      stat: 'atkPct',
      value: 0,
      enabled: true,
      targetSkillType: 'all',
    })
  }

  function removeGlobalBuff(id: string) {
    const idx = globalBuffs.value.findIndex(b => b.id === id)
    if (idx > -1) globalBuffs.value.splice(idx, 1)
  }

  function updateGlobalBuff(id: string, patch: Partial<GlobalBuffRow>) {
    const buff = globalBuffs.value.find(b => b.id === id)
    if (buff) Object.assign(buff, patch)
  }

  // ========== Actions - 队友 Buff ==========

  function toggleTeammateBuff(buffId: string, enabled: boolean) {
    if (!teammateBuffSelections.value[buffId]) {
      teammateBuffSelections.value[buffId] = { enabled, coverage: 100 }
    } else {
      teammateBuffSelections.value[buffId].enabled = enabled
    }
  }

  function setTeammateBuffCoverage(buffId: string, coverage: number) {
    if (!teammateBuffSelections.value[buffId]) {
      teammateBuffSelections.value[buffId] = { enabled: false, coverage }
    } else {
      teammateBuffSelections.value[buffId].coverage = Math.max(0, Math.min(100, coverage))
    }
  }

  function setWEngineEffectCoverage(effectId: string, coverage: number) {
    wEngineEffectCoverages.value[effectId] = Math.max(0, Math.min(100, coverage))
  }

  function getWEngineEffectCoverage(effectId: string): number {
    return wEngineEffectCoverages.value[effectId] ?? 100
  }

  // CC-386：随角色的用户覆盖（资源利用率 / 异常积蓄利用率 / 异常结算份额）的**唯一键构造点**。
  // 键 = 槽上当前 agentId，不是槽位：换人（setAgent / 预设 / 独立场景直写 team）后旧角色的覆盖天然读不到，
  // 换回或挪槽时设置跟着角色走。修前按槽位存、引擎按槽位直读，换人不清 ⇒ 上一个角色的 0.3 利用率原样作用到新角色
  // （锁：stores/__tests__/agentKeyedOverridesCc386.test.ts）。对外 API 仍收槽位——调用方不必知道键的形态。
  // 空槽返回 null：读默认、写无效。
  function ownerKeyOf(slot: number): string | null {
    const agentId = team.value[slot]?.agentId
    return agentId ? agentId : null
  }

  function resourceUtilizationKey(slot: number, actionId: string): string | null {
    const owner = ownerKeyOf(slot)
    return owner ? `${owner}:${actionId}` : null
  }

  function getResourceUtilization(slot: number, actionId: string): ResourceUtilizationOverride {
    const key = resourceUtilizationKey(slot, actionId)
    return (key ? resourceUtilization.value[key] : undefined) ?? { rate: 1, cap: null }
  }

  /** 该槽当前角色的全部资源利用率覆盖（actionId -> 覆盖）。引擎经此读取，不自己拼键。 */
  function resourceUtilizationOf(slot: number): Record<string, ResourceUtilizationOverride> {
    const owner = ownerKeyOf(slot)
    if (!owner) return {}
    const prefix = `${owner}:`
    return Object.fromEntries(
      Object.entries(resourceUtilization.value)
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, value]) => [key.slice(prefix.length), value]),
    )
  }

  function setResourceUtilization(slot: number, actionId: string, patch: Partial<ResourceUtilizationOverride>) {
    const key = resourceUtilizationKey(slot, actionId)
    if (!key) return
    const current = resourceUtilization.value[key] ?? { rate: 1, cap: null }
    const next = { ...current, ...patch }
    next.rate = Math.max(0, Math.min(1, Number.isFinite(next.rate) ? next.rate : 1))
    if (next.cap === undefined || next.cap === null || !Number.isFinite(Number(next.cap))) next.cap = null
    else next.cap = Math.max(0, Number(next.cap))
    resourceUtilization.value[key] = next
  }

  function resetResourceUtilization(slot?: number, actionId?: string) {
    if (slot === undefined) {
      resourceUtilization.value = {}
      return
    }
    const owner = ownerKeyOf(slot)
    if (!owner) return
    if (actionId) {
      delete resourceUtilization.value[`${owner}:${actionId}`]
    } else {
      const prefix = `${owner}:`
      for (const key of Object.keys(resourceUtilization.value)) {
        if (key.startsWith(prefix)) delete resourceUtilization.value[key]
      }
    }
  }

  /** 读取机制模块声明参数的当前值 */
  function getMechanicSetting(id: string, fallback: number): number {
    return mechanicSettingOf(mechanicSettings.value, id, fallback)
  }

  /** 写入机制模块声明参数 */
  function setMechanicSetting(id: string, value: number) {
    mechanicSettings.value[id] = Number.isFinite(value) ? value : 0
  }

  function getTeamMechanicSetting(key: string, fallback: number): number {
    const value = teamMechanicSettings.value[key]
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback
  }

  function setTeamMechanicSetting(key: string, value: number) {
    teamMechanicSettings.value[key] = Number.isFinite(value) ? value : 0
  }

  function getAnomalyUtilizationRate(slot: number): number {
    const owner = ownerKeyOf(slot)
    const override = owner ? anomalyUtilizationRates.value[owner] : undefined
    if (typeof override === 'number' && Number.isFinite(override)) {
      return Math.max(0, Math.min(1, override))
    }
    return 1
  }

  function setAnomalyUtilizationRate(slot: number, rate: number) {
    const owner = ownerKeyOf(slot)
    if (!owner) return
    anomalyUtilizationRates.value[owner] = Math.max(0, Math.min(1, Number.isFinite(rate) ? rate : 1))
  }

  function getAnomalySettlementShare(element: string, slot: number): number | null {
    const owner = ownerKeyOf(slot)
    const value = owner ? anomalySettlementShares.value[`${element}:${owner}`] : undefined
    return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : null
  }

  function setAnomalySettlementShare(element: string, slot: number, share: number) {
    const owner = ownerKeyOf(slot)
    if (!owner) return
    anomalySettlementShares.value[`${element}:${owner}`] = clampRatio(share)
  }




  function isTeammateBuffEnabled(buffId: string): boolean {
    return teammateBuffEnabledOf(teammateBuffSelections.value, buffId)
  }

  function getTeammateBuffCoverage(buffId: string): number {
    return teammateBuffCoverageOf(teammateBuffSelections.value, buffId)
  }

  /** 根据队伍配置自动同步队友 buff 的启用状态
   *  规则：队伍中有该角色 + 影画等级 >= buff 所需影画 → 启用
   */
  // teammate-buffs 晚到自动补同步：加载完成时若队伍已就位（存档恢复/预设应用先于 fetch 返回），
  // 重跑一次选择——消除「数据到达时机决定 buff 是否生效」的竞态
  watch(() => catalogStore.teammateBuffsLoaded, loaded => {
    if (loaded) syncTeammateBuffsFromTeam()
  })
  function syncTeammateBuffsFromTeam() {
    const groups = catalogStore.teammateBuffGroups
    if (!groups.length) return
    // 派生口径在模块级纯函数里（可单测）；此处只做「合并进选择表」——
    // 保留用户覆盖率、仅在变化时改 enabled，与抽取前逐条一致。
    for (const { id, enabled } of deriveTeammateBuffEnabled(team.value, groups, aid => catalogStore.getAgent(aid))) {
      const current = teammateBuffSelections.value[id]
      if (!current) {
        teammateBuffSelections.value[id] = { enabled, coverage: 100 }
      } else if (current.enabled !== enabled) {
        current.enabled = enabled
      }
    }
  }

  // ========== Actions - 敌人 ==========

  function setEnemy(patch: Partial<EnemyConfig>) {
    Object.assign(enemy.value, patch)
  }

  function ensureResistanceTables() {
    const legacy = enemy.value.resistances
    if (!enemy.value.damageResistances) enemy.value.damageResistances = { ...(legacy ?? defaultResistanceTable(0)) }
    if (!enemy.value.stunResistances) enemy.value.stunResistances = { ...(legacy ?? defaultResistanceTable(0)) }
    if (!enemy.value.anomalyResistances) enemy.value.anomalyResistances = { ...(legacy ?? defaultResistanceTable(0)) }
  }

  function setResistance(kind: 'damage' | 'stun' | 'anomaly', element: string, value: number) {
    ensureResistanceTables()
    const key = kind === 'damage' ? 'damageResistances' : kind === 'stun' ? 'stunResistances' : 'anomalyResistances'
    enemy.value[key][element] = value
  }

  /**
   * 当前应用的 Boss 预设（仅内存态，用于 UI 高亮 + 计算器弹刀反推/喧响赠礼；不随 enemy 持久化）。
   * `parryTotal`/`parryNoFollowUpTotal` 存**生效值**（含控制技组在无替换时的并入量），
   * 由 `syncBossInteractionPlan` 按队伍/开关折算；预设原值另存 `presetParry*` 快照（见 types/bossPreset）。
   */
  const appliedBoss = ref<AppliedBossPreset | null>(null)

  /**
   * 反制支援（Counter Assist）整组替换控制技（紫光技）——**承接槽位**，-1 = 不替换。
   *
   * 判据全部来自数据层登记表 `src/data/counterAssists.ts`（无 agentId 分支）：
   * - 预设必须声明 `counterAssistGroups`（该 Boss 有控制技）；
   * - 开关 `boss.counterAssistReplace`（缺省 **1 = 开**，用户口径 2026-09-12「Boss 卡勾选，自动默认开」）；
   * - 队内有声明反制支援招式的角色；`boss.counterAssistSlot` 可指定槽位（-1 = 自动取首个有的角色，
   *   指定的槽位没有该招式则回退自动——避免"选了个没这招的人"静默失效）。
   */
  const counterAssistSlot = computed<number>(() => {
    const groups = appliedBoss.value?.counterAssistGroups ?? []
    if (groups.length === 0) return -1
    if (getMechanicSetting('boss.counterAssistReplace', 1) === 0) return -1
    const capable = (slot: number) => !!counterAssistOf(team.value[slot]?.agentId)
    const pinned = Math.floor(getMechanicSetting('boss.counterAssistSlot', -1))
    if (pinned >= 0 && capable(pinned)) return pinned
    for (let i = 0; i < team.value.length; i++) if (capable(i)) return i
    return -1
  })

  /**
   * Boss 交互计划折算：控制技组（`counterAssistGroups`，逐组记招架段数）在无替换时
   * 按「每组 1 次正常弹刀（头段招架 + 完美反制的支援突击）+ 段数−1 次无突击弹刀」**并入**
   * 强制弹刀总数；被反制支援整组化解时不并入（= 当初就没录这些弹刀，无需反扣）。
   * 幂等：只从 `presetParry*` 原值重算，反复调用不累积。
   */
  function syncBossInteractionPlan() {
    const applied = appliedBoss.value
    if (!applied) return
    if (applied.presetParryTotal === undefined) applied.presetParryTotal = applied.parryTotal ?? 0
    if (applied.presetParryNoFollowUpTotal === undefined) {
      applied.presetParryNoFollowUpTotal = applied.parryNoFollowUpTotal ?? 0
    }
    const groups = applied.counterAssistGroups ?? []
    const folded = counterAssistSlot.value >= 0 ? 0 : groups.length
    const foldedNoFollowUp = counterAssistSlot.value >= 0
      ? 0
      : groups.reduce((sum, segs) => sum + Math.max(0, Math.floor(segs) - 1), 0)
    applied.parryTotal = applied.presetParryTotal + folded
    applied.parryNoFollowUpTotal = applied.presetParryNoFollowUpTotal + foldedNoFollowUp
  }

  /**
   * 用户编辑控制技组（Boss 卡）：对导入默认值不满意可改逐组段数/组数（引擎与折算全读
   * `appliedBoss.counterAssistGroups` 活引用，改这里 = 全链生效）。约束：组 ≤8、每组段数 1~12；
   * 空数组 = 清除（该 Boss 按无控制技处理）。折算幂等（只从 presetParry* 快照重算）。
   * 重新应用 Boss 即回落预设默认值（编辑只活在 appliedBoss，不落预设静态数据）。
   */
  function setCounterAssistGroups(groups: number[]) {
    const applied = appliedBoss.value
    if (!applied) return
    const clean = groups.slice(0, 8).map(g => Math.min(12, Math.max(1, Math.floor(g) || 1)))
    applied.counterAssistGroups = clean.length > 0 ? clean : undefined
    syncBossInteractionPlan()
  }

  // ========== 独立场景出生态（initialState，2026-10-01 arena-C r369）==========
  // 写在这里是刻意的：全部 state ref 已声明，依赖 state 的 watcher 一个都还没注册（上方唯一的 watch 只看目录加载）。
  // 出生之后再逐键写入（「朴素注水」）会被 watcher 当成用户改动：副词条设置 watcher（pre-flush）下一拍把三个槽的
  // 配装重刷成推荐值，队友 buff watcher（sync）按队伍改写已有选择——场景就不再等于源现场。
  // 判据：analysisScenario.test.ts「出生态 = 源现场」及其反例。新增 state ref 必须登记进下表，未登记的键直接抛错。
  if (initialState) {
    const stateRefs: Record<string, { value: unknown }> = {
      team, globalBuffs, teammateBuffSelections, wEngineEffectCoverages, discEffectCoverages,
      resourceUtilization, mechanicSettings, teamMechanicSettings, anomalyUtilizationRates, anomalySettlementShares,
      enemy, comboAlignOverrides, stunAxes, stunAxisPlans, useStunAxis, autoYidhariAxis,
      interactionScaleCeiling, interactionScaleMonotone, timeWeightStrategy, appliedBoss,
    }
    for (const [key, value] of Object.entries(initialState)) {
      const target = stateRefs[key]
      if (!target) throw new Error(`createConfigModel: initialState 含未登记的 state 键「${key}」（新增 state ref 须登记进出生态键表）`)
      target.value = value
    }
  }

  // 队伍换人 / 两个开关翻转 → 立刻重算（**flush: 'sync'**：引擎与弹刀下限在同一 tick 内直读
  // appliedBoss.parryTotal，pre-flush 会晚一帧导致「刚关掉替换但仍按弹刀计」的错值；
  // 源只有 counterAssistSlot 与预设 id 快照，改的又是 parry* 本身 → 无回环）
  watch(
    [
      counterAssistSlot,
      () => appliedBoss.value?.presetId,
      () => appliedBoss.value?.phaseId,
    ],
    syncBossInteractionPlan,
    { flush: 'sync' },
  )

  /**
   * 一键应用 Boss 预设：填充血量/失衡值/防御/等级/危局异常系数/失衡易伤/失衡时间 + 三张抗性表
   * + 默认值（战斗时间 180s/秽盾/能量盾/无敌时间）。
   * 无敌时间：preset.defaults.invincibleTime 有值即填（如 叶释渊 24s），缺省 0；
   * 快支不动：快支是角色侧与 Boss 无关。
   * 弹刀反推：defaults.parryTotal > 0（如 叶释渊 13）时自动勾选「保底4失衡」
   * （guarantee.stun）——计算器据此按当前队伍反推击破位弹刀、主C 拿剩余（core/parrySplit.ts）。
   */
  function applyBossPreset(preset: { id: string }, phase: {
    phaseId: string
    hp: number
    stunValue: number
    defense: number
    level: number
    bossAnomalyCoeff: number
    damageResistances: Record<string, number>
    stunResistances: Record<string, number>
    anomalyResistances: Record<string, number>
    weakness?: string[]
  }, monster: {
    stunVuln: number
    stunTime: number
  }, defaults: {
    battleTime: number
    shieldCount: number
    energyShield: number
    invincibleTime?: number
    parryTotal?: number
    parryNoFollowUpTotal?: number
    parryDecibelOnlyTotal?: number
    xParryTotal?: number
    counterAssistGroups?: number[]
    stunGiftRatio?: number
    decibelGift?: { slot: number; amount: number }
  }) {
    setEnemy({
      hp: Math.round(phase.hp),
      stunValue: Math.round(phase.stunValue * 100) / 100,
      defense: Math.round(phase.defense),
      level: phase.level,
      bossAnomalyCoeff: phase.bossAnomalyCoeff,
      stunVuln: monster.stunVuln,
      stunTime: monster.stunTime,
      battleTime: defaults.battleTime,
      shieldCount: defaults.shieldCount,
      energyShield: defaults.energyShield,
      invincibleTime: defaults.invincibleTime ?? 0,
      damageResistances: { ...phase.damageResistances },
      stunResistances: { ...phase.stunResistances },
      anomalyResistances: { ...phase.anomalyResistances },
      bossStunGift: Math.round((defaults.stunGiftRatio ?? 0) * phase.stunValue),
      weakness: [...(phase.weakness ?? [])],
    })
    // 声明了默认弹刀总数（正常/不带支援突击/只喧响）**或控制技组**的 Boss → 自动勾选「保底4失衡」
    // （弹刀反推的开关；用户可手动取消）。控制技组无替换时会并入弹刀总数，故也算弹刀来源；
    // 整组被反制支援化解时折算后总数可能归零 → parrySplitActive 自然为假，勾选无害。
    const groups = defaults.counterAssistGroups ?? []
    if (((defaults.parryTotal ?? 0) + (defaults.parryNoFollowUpTotal ?? 0) + (defaults.parryDecibelOnlyTotal ?? 0)) > 0
      || groups.length > 0) setMechanicSetting('guarantee.stun', 1)
    appliedBoss.value = {
      presetId: preset.id,
      phaseId: phase.phaseId,
      at: Date.now(),
      parryTotal: defaults.parryTotal,
      parryNoFollowUpTotal: defaults.parryNoFollowUpTotal,
      parryDecibelOnlyTotal: defaults.parryDecibelOnlyTotal,
      xParryTotal: defaults.xParryTotal,
      decibelGift: defaults.decibelGift,
      counterAssistGroups: groups.length > 0 ? [...groups] : undefined,
      presetParryTotal: defaults.parryTotal ?? 0,
      presetParryNoFollowUpTotal: defaults.parryNoFollowUpTotal ?? 0,
    }
    // 控制技组按当前队伍折算（有反制支援角色 + 开关开 → 整组不并入弹刀；否则并入）
    syncBossInteractionPlan()
  }

  function clearBossPreset() {
    appliedBoss.value = null
  }

  // 有效时间 = 战斗时间 − 无敌时间。单一来源 core/effectiveTime#effectiveBattleTime（CC-216：原写死 180，不读 battleTime）
  const effectiveTime = computed(() => effectiveBattleTime(enemy.value))

  // ========== 初始化 ==========

  // store 生命周期内只自动填一次；不是页面局部标志，因此 retry/remount 不会重置。
  // 首次队伍写入即永久让路（含直接恢复 team / 改完又清空），不以「当前有无 agentId」猜测用户意图。
  // 只观察第一次写入，随后停止，避免给正常配置与场景求值增加深监听开销；不进入计算用 $state。
  let defaultTeamInitialized = false
  let defaultTeamPristine = true
  const stopDefaultTeamTracking = watch(team, () => {
    defaultTeamPristine = false
    stopDefaultTeamTracking()
  }, { deep: true, flush: 'sync' })

  // @fact ui:startup/默认队伍自动初始化 口径: 完整依赖就绪且队伍从未被改动时仅自动初始化一次；延迟推荐、重试与重挂载不得覆写已有编辑 | 据 用户任务@2026-09-28·复核@2026-09-30 | 验 src/composables/__tests__/calculatorStartup.test.ts | 锚 src/stores/config.ts#initDefaultTeam | 信 确认
  // ⟳复核: 增加配置恢复或启动入口时复核延迟编辑与清空队伍哨兵 | 到期 2026-12-31
  /** 返回是否填入默认队伍；false 也可能表示保留用户配置，不代表加载失败。 */
  function initDefaultTeam(): boolean {
    if (defaultTeamInitialized || !defaultTeamPristine) return false
    if (!catalogStore.ready || !catalogStore.teammateBuffsReady || !catalogStore.buildRecsLoaded) return false
    const agents = catalogStore.displayAgents.filter(a => !a.hidden)
    if (agents.length < 3) return false

    defaultTeamInitialized = true
    stopDefaultTeamTracking()
    // 自动选择前3个角色作为默认队伍，保留原来的配装和同步顺序。
    for (let i = 0; i < 3; i++) {
      setAgent(i, agents[i].id)
    }
    // 初始化后同步一次队友 buff，再按完整队伍重刷推荐配置
    syncTeammateBuffsFromTeam()
    for (let i = 0; i < team.value.length; i++) {
      applyBuildRecommendationForSlot(i)
    }
    return true
  }

  /** 一键套用预设队伍（按槽位 0/1/2 的 agentId）。
   *  批量模式：defer 掉 setAgent 内的同步/推荐（各跑一遍配装推荐），
   *  换完三人后统一 sync + 推荐一次，与手动逐个换的总计算量一致。 */
  function applyTeamPreset(agentIds: [string, string, string]) {
    // 配装推荐没加载就套预设 = **静默留在 setAgent 兜底盘上**（34200 荆棘玫瑰，2件套防御+16%），
    // 主C穿防御套还能跑完、数字还自洽——2026-09-07 探针就这么算了一整轮归档伤害才被发现。
    // 这里必须炸：调用方（预设按钮/部署/teamTimeline）都在启动流程之后，正常路径不可能没加载。
    if (!catalogStore.buildRecsLoaded) {
      throw new Error(
        'applyTeamPreset: 配装推荐数据未加载（buildRecsLoaded=false），套完会静默留在兜底防御套上。'
        + ' 调用方必须先 `await catalogStore.loadBuildRecommendations()`（App 在 CalculatorView 启动时加载；测试/探针自行 await）。',
      )
    }
    for (let i = 0; i < 3; i++) {
      setAgent(i, agentIds[i], { defer: true })
    }
    syncTeammateBuffsFromTeam()
    for (let i = 0; i < 3; i++) {
      applyBuildRecommendationForSlot(i)
    }
  }

  // 监听队伍变化，自动同步队友 buff 启用状态。
  // **flush: 'sync'（2026-09-23 修）**：旧的默认 pre-flush 要等下一个 tick 才同步，而批量路径（队伍对比最优加金 /
  // 难度曲线 / 命座边际）都是「setCinemaLevel → 同一 tick 内读 teamTotalDamage」——读到的是**改命座前**的 buff 选择。
  // 实测：最优加金贪心全程看不到队友命座 buff（般琉卢 12 金选了「般岳 1–4 命」55.7M，正确应为三人各 2 命 81.1M）；
  // 全库 624 场景中 41 个命座 6 场景偏低 1–40%。sync 后 sync 自己只写 teammateBuffSelections，不写 team ⇒ 无回环。
  // 源 = 派生函数读取的全部字段（`TEAMMATE_BUFF_INPUT_KEYS` 单一事实源），不手写子集。
  watch(
    () => team.value.map(c => TEAMMATE_BUFF_INPUT_KEYS.map(k => c[k])),
    () => {
      syncTeammateBuffsFromTeam()
    },
    { deep: true, flush: 'sync' }
  )

  // 兼容旧版本保存的 enemy.resistances 单表配置
  watch(enemy, () => ensureResistanceTables(), { deep: true, immediate: true })

  // 监听队友 buff 数据加载完成，同步一次
  watch(
    () => catalogStore.teammateBuffGroups.length,
    (len) => {
      if (len > 0) syncTeammateBuffsFromTeam()
    }
  )

  // 监听副词条设置变化，自动重算默认分配
  watch(
    () => SUBSTAT_BUDGET_SETTINGS.map(id => mechanicSettings.value[id]),
    () => {
      for (let i = 0; i < 3; i++) {
        if (team.value[i]?.agentId) applyBuildRecommendationForSlot(i)
      }
    },
  )

  return {
    // state
    team,
    globalBuffs,
    teammateBuffSelections,
    wEngineEffectCoverages,
    discEffectCoverages,
    resourceUtilization,
    mechanicSettings,
    teamMechanicSettings,
    anomalyUtilizationRates,
    anomalySettlementShares,
    enemy,
    // computed
    usedAgentIds,
    effectiveTime,
    // actions
    getAgent,
    getWEngine,
    setAgent,
    setCinemaLevel,
    setPotentialLevel,
    setWEngine,
    setWEngineModLevel,
    setFourPieceSet,
    setTwoPieceSet,
    setMainStat,
    setSubStatCount,
    // 动作次数统一入口（新角色走这个，不必再加命名 setter）
    setActionCount,
    getDefaultBasicAttackTimeWeight,
    applyBuildRecommendationForSlot,
    comboAlignOverrides,
    getComboAlignOverride,
    setComboAlignOverride,
    clearComboAlignOverrides,
    addGlobalBuff,
    removeGlobalBuff,
    updateGlobalBuff,
    toggleTeammateBuff,
    setTeammateBuffCoverage,
    setWEngineEffectCoverage,
    getWEngineEffectCoverage,
    setDiscEffectCoverage,
    getDiscEffectCoverage,
    getResourceUtilization,
    resourceUtilizationOf,
    setResourceUtilization,
    resetResourceUtilization,
    getMechanicSetting,
    setMechanicSetting,
    stunAxes,
    stunAxisPlans,
    useStunAxis,
    getAxisState,
    setAxisState,
    applyStunAxisPreset,
    autoYidhariAxis,
    interactionScaleCeiling,
    interactionScaleMonotone,
    timeWeightStrategy,
    setTimeWeightStrategy,
    getTeamMechanicSetting,
    setTeamMechanicSetting,
    getAnomalyUtilizationRate,
    setAnomalyUtilizationRate,
    getAnomalySettlementShare,
    setAnomalySettlementShare,
    isTeammateBuffEnabled,
    getTeammateBuffCoverage,
    syncTeammateBuffsFromTeam,
    setEnemy,
    setResistance,
    appliedBoss,
    applyBossPreset,
    clearBossPreset,
    /** 反制支援整组替换控制技：承接槽位（-1 = 不替换）。UI 与引擎同源判据。 */
    counterAssistSlot,
    /** Boss 控制技组用户可编辑（默认来自预设；改后即时重折算，重新应用 Boss 回落默认） */
    setCounterAssistGroups,
    initDefaultTeam,
    applyTeamPreset,
  }
}

export type ConfigModel = UnwrapRef<ReturnType<typeof createConfigModel>>

/**
 * 求值入口收的配置（CC-343 S5，2026-10-02 arena-E）：model 全部成员 + `$state`（state ref 的响应式视图，
 * calcOutputMemo 的 memo 键读它）。UI store 与独立场景（analysisScenario）的 config 都满足；
 * **不含** Pinia 的 `$patch` / `$subscribe` / `$reset` / `$onAction`。
 * 只读写 model 成员的管线 / 分析器函数收 `ConfigModel` 即可，不必要求 `$state`。
 */
export type EvalConfig = ConfigModel & { readonly $state: ReturnType<typeof useConfigStore>['$state'] }

/**
 * UI Adapter；批量场景直接实例化 Model，不创建或替换全局 Pinia。
 * UI store = Model + **UI 会话效果**（CC-349）。会话效果只装在这里、**不进** `createConfigModel`：
 * 独立场景（analysisScenario / CC-343）会在 `await yieldNow()` 间隙反复换队，场景模型若也挂这类 watcher，
 * 预填会在批量求值中途按调度时序写进场景 ⇒ 分析结果依赖时序。
 */
export const useConfigStore = defineStore('config', () => {
  const model = createConfigModel(useCatalogStore())
  installUiSessionEffects(model)
  return model
})

/**
 * 通用自动轴命中的预设**变化**时，按预设 `guarantee` 预填「保底目标」（只写预设声明的键，不清除用户手勾）。
 * 原住 TeamConfigPage（`watch(autoPreset)`）⇒ 只在配装页挂载期间生效：别页换队 / 档案部署时不预填，
 * 同一队伍的 guarantee.* 取决于用户走过哪些页。非 immediate：建 store 时不触发；默认页即配装页，
 * 故启动时默认队伍写入触发与否与旧口径一致。判据：`src/stores/__tests__/autoAxisGuaranteePrefill.test.ts`。
 */
function installUiSessionEffects(model: ReturnType<typeof createConfigModel>): void {
  watch(
    () => autoStunAxisPresetOf({ autoYidhariAxis: model.autoYidhariAxis.value, team: model.team.value }, AUTO_AXIS_PRESET_HINTS),
    (p) => prefillPresetGuarantee(model, p),
  )
}
