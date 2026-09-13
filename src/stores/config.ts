/**
 * 配置 Store - 3人队伍配置 + 全局Buff + 敌人配置
 */
import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import type {
  Agent, WEngine, DriveDiscConfig, SkillDamageTarget, CharacterBuildRecommendation, TeammateBuffGroup,
} from '@/types/catalog'
import { computeOptimalSubStats, getTemplate, type OptimizeSubstatsOutput, type TeammateInfo } from '@/core/substatOptimizer'
import { buildTeammateBuffSourceContext } from '@/core/teammateBuffSource'
import { calcPanel } from '@/core/panel'
import { useCatalogStore } from './catalog'
import { getAgentSpec } from '@/specs/registry'
import { evalAdditionalAbility } from '@/specs/teamCondition'
import type { MechanicTeamMember } from '@/mechanics/types'
import type { AppliedBossPreset } from '@/types/bossPreset'
import { counterAssistOf } from '@/data/counterAssists'

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
  chainCountPerStun: number  // 每次失衡的连携次数（per-character，默认非辅助1辅助0）
  basicAttackTimeWeight: number // 平A时间分配权重（0=不分配平A时间）
}

/** 全局 Buff 行（用户自由添加） */
export interface GlobalBuffRow {
  id: string
  name: string       // 名称，如"危局buff"、"boss"、"角色被动"
  stat: string       // 属性，如"atkPct"、"critRate"、"dmgBonus"
  value: number      // 数值
  enabled: boolean
  targetSkillType?: SkillDamageTarget
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
  quickAssistCount: number   // 快速支援次数
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
}

// ========== 默认配置 ==========

function defaultDriveDisc(element: string): DriveDiscConfig {
  return {
    fourPieceSetId: '',
    twoPieceSetId: '',
    mainStats: {
      4: 'atkPct' as any,
      5: `${element}Dmg` as any || 'atkPct' as any,
      6: 'critRate' as any,
    },
    subStatAllocation: {},
  }
}

// @fact engine:平A权重阶梯 口径: 不设职业统一阶梯（强攻/异常/击破默认同为1）——用户裁决「不同情况不同权重，不能一概而论」，抬权重归角色级滑块/预设 | 据 用户@2026-09-04·复核@2026-09-08 | 锚 src/stores/config.ts#defaultBasicAttackTimeWeight | 信 确认
function defaultBasicAttackTimeWeight(agent?: Agent | null): number {
  if (!agent) return 1
  if (agent.id === '1581' || agent.teammateBuffId === '1581') return 0
  if (agent.id === '1331' || agent.teammateBuffId === '1331') return 0 // 薇薇安：后台/合轴快切，基本不平A
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

/** 按角色的交互次数默认值（主页「战斗动作次数」预填展示，相当于帮用户填好；用户可改） */
export const AGENT_INTERACTION_DEFAULTS: Record<string, { parry: number; dodge: number; block: number; dual: number }> = {
  '1531': { parry: 4, dodge: 0, block: 5, dual: 0 }, // 星徽·比利（用户确认：招架4/闪反0/格挡5）
  '1471': { parry: 6, dodge: 10, block: 20, dual: 5 }, // 般岳（用户确认：闪反10/招架6/金身20/双反5，嗔火来源）
}

/** 读角色交互次数默认值（无条目 = 全 0） */
export function getInteractionDefaults(agentId: string): { parry: number; dodge: number; block: number; dual: number } {
  return AGENT_INTERACTION_DEFAULTS[agentId] ?? { parry: 0, dodge: 0, block: 0, dual: 0 }
}

/**
 * 通用交互基准（无角色专属默认时按职业；用户口径 2026-09-04 回调）：
 * - 支援/防护：0 交互——支援上战场 1 秒 = 浪费主C 1 秒输出，其后台时间不是发呆（主C 在打）。
 * - 其余（强攻/异常/击破）：弹刀 6 + 闪反 10（闪反在动作时间内给 2× 伤害+失衡；弹刀靠后续
 *   支援突击 + 喧响/失衡纯赚）。基准是「默认大家会打」，不是硬凑——时间紧的队（如叶瞬光
 *   白毛优先）由非轴降配 interactionScale 按必要时间挤占缩放（useResourceCalc 738-742）。
 * 之前一度全默认 0 导致「谁都不打、留时间发呆」，是过度矫正（叶瞬光个案不该推广到全队池）。
 */
// @fact engine:交互基准 口径: 非支援/防护默认弹刀6/闪反10（闪反动作时间内2×伤害失衡、弹刀喧响失衡纯赚），支援/防护0；基准可被必要时间挤占（超预算时 interactionScale 缩放），不硬凑 | 据 用户@2026-09-04·复核@2026-09-08 | 验 src/stores/__tests__/roleInteractionBaseline.test.ts | 锚 src/stores/config.ts#roleInteractionBaseline | 信 确认
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
 */
const NO_GENERIC_INTERACTION_AGENTS: ReadonlySet<string> = new Set(['1051'])

/**
 * 手动队默认交互（单一事实源，setAgent 预填用）：
 * 角色专属默认（getInteractionDefaults）> 正反馈排除（0）> 职业基准（roleInteractionBaseline）。
 */
export function interactionBaselineFor(agentId: string, specialty?: string): { parry: number; dodge: number; block: number; dual: number } {
  if (NO_GENERIC_INTERACTION_AGENTS.has(agentId)) return { parry: 0, dodge: 0, block: 0, dual: 0 }
  const defs = getInteractionDefaults(agentId)
  const hasCustom = defs.parry > 0 || defs.dodge > 0 || defs.block > 0 || defs.dual > 0
  return hasCustom ? defs : roleInteractionBaseline(specialty)
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

function localizedName(obj: any): string {
  if (!obj) return ''
  if (typeof obj === 'string') return obj
  return obj.zhCN ?? obj.en ?? ''
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
    quickAssistCount: 6,
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
 *  解析失败默认 0（总是启用）
 */
function parseCinemaRequirement(sourceLabel: string): number {
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
export function deriveTeammateBuffEnabled(
  team: ReadonlyArray<Pick<CharacterConfig, 'slot' | 'agentId' | 'cinemaLevel' | 'potentialLevel' | 'wEngineId' | 'wEngineModLevel'>>,
  groups: readonly TeammateBuffGroup[],
  getAgent: (agentId: string) => Agent | null | undefined,
): Array<{ id: string; enabled: boolean }> {
  // 收集队伍中每个角色的影画等级，同时建立 agentId → teammateBuffId 的映射
  const teamCinema: Record<string, number> = {}
  const teamAgents = team
    .filter(char => !!char.agentId)
    .map(char => ({ char, agent: getAgent(char.agentId!) }))
    .filter(item => !!item.agent)

  for (const { char, agent } of teamAgents) {
    if (char.agentId) {
      // 直接用 agentId 匹配（仅队友角色的 id 就是 teammateBuffId）
      teamCinema[char.agentId] = char.cinemaLevel
      // nanoka 角色有 teammateBuffId 字段，用它也建立映射
      if (agent?.teammateBuffId) {
        teamCinema[agent.teammateBuffId] = char.cinemaLevel
      }
    }
  }

  const getRemielleAdditionalState = () => {
    const remielleItem = teamAgents.find(({ agent }) => agent?.id === '1581' || agent?.teammateBuffId === '1581')
    if (!remielleItem?.agent) return { active: false, anomalyCount: 0, tier: 0 }

    const remielleFaction = remielleItem.agent.faction
    const otherAgents = teamAgents
      .filter(item => item !== remielleItem)
      .map(item => item.agent)
      .filter(Boolean)
    const active = otherAgents.some(agent =>
      agent?.specialty === 'anomaly' || (!!remielleFaction && agent?.faction === remielleFaction)
    )
    const anomalyCount = teamAgents.filter(({ agent }) => agent?.specialty === 'anomaly').length
    const tier = active ? Math.max(1, Math.min(3, anomalyCount)) : 0
    return { active, anomalyCount, tier }
  }

  const remielleAdditional = getRemielleAdditionalState()

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
  // 预计算每个角色的额外能力是否激活（agentId → boolean）
  const aaActiveMap = new Map<string, boolean>()
  for (const mtm of mechanicTeam) {
    if (!mtm.agent) continue
    const aaSpec = getAgentSpec(mtm.agentId)?.additionalAbility
    if (aaSpec) {
      aaActiveMap.set(mtm.agentId, evalAdditionalAbility(mechanicTeam, mtm.slot, mtm.agent, aaSpec) === true)
    }
  }

  function resolveSpecialTeammateBuffEnabled(buffId: string, baseEnabled: boolean): boolean {
    if (buffId === '1581.additional_ability.atk_1_anomaly') return baseEnabled && remielleAdditional.active && remielleAdditional.tier === 1
    if (buffId === '1581.additional_ability.atk_2_anomaly') return baseEnabled && remielleAdditional.active && remielleAdditional.tier === 2
    if (buffId === '1581.additional_ability.atk_3_anomaly') return baseEnabled && remielleAdditional.active && remielleAdditional.tier === 3
    if (buffId === '1581.core_passive.refringe_3_anomaly') return baseEnabled && remielleAdditional.tier === 3
    if (buffId === '1581.additional_ability.prismatic_buildup') return baseEnabled && remielleAdditional.active
    return baseEnabled
  }

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
      let shouldEnable = resolveSpecialTeammateBuffEnabled(buff.id, baseShouldEnable)
      // 波可娜 C6：困迹增伤从「仅追加攻击」扩展为「全伤害」——base 条在 C6 时禁用，防与 pulchra_cinema_6_trap_all 双计
      if (agentId === '1351' && buff.id === 'pulchra_extra_trap_followup' && cinemaLevel >= 6) {
        shouldEnable = false
      }
      // 通用额外能力门控：若 buff 来源为"额外能力"且来源角色额外能力未激活，则自动禁用
      if (shouldEnable && buff.ownerId && sourceLabel === '额外能力') {
        const aaActive = aaActiveMap.get(buff.ownerId)
        if (aaActive === false) shouldEnable = false
      }
      out.push({ id: buff.id, enabled: shouldEnable })
    }
  }
  return out
}

export const useConfigStore = defineStore('config', () => {
  const catalogStore = useCatalogStore()

  // 当前选中的角色槽位（用于队伍配置页的详细编辑）
  const selectedSlot = ref<number>(0)

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
    return discEffectCoverages.value[effectId] ?? 100
  }

  // 资源利用率（slot:actionId -> { rate, cap }），用于把资源池上限折算为实际释放次数
  const resourceUtilization = ref<Record<string, ResourceUtilizationOverride>>({})
  // 机制模块通用可调参数：settingId -> 数值
  const mechanicSettings = ref<Record<string, number>>({})
  // 按角色槽位/机制命名的可调参数，例如蕾米 Q 虚耀分配
  const teamMechanicSettings = ref<Record<string, number>>({})
  // 每个角色异常积蓄利用率（0-1）：默认 1（应用率已由执行次数体现，支援/防护同样按实际招式积蓄——
  // 旧「支援/防护 0.1」启发式会把丽娜等电异常支援的总积蓄 ÷10，与实际应用量不符；用户可经滑块微调）
  const anomalyUtilizationRates = ref<Record<number, number>>({})
  // 每个元素/槽位的结算占比覆盖：key = `${element}:${slot}`，值为0-1
  const anomalySettlementShares = ref<Record<string, number>>({})

  // 敌人配置
  const enemy = ref<EnemyConfig>(defaultEnemy())

  // 合轴率覆盖（slot → moveId → ratio 0-1）
  // 用户在结果页调节，覆盖倍率表中的默认值（默认0）
  const comboAlignOverrides = ref<Record<number, Record<string, number>>>({})

  // 刷新触发器：递增后强制资源池重新计算
  const refreshTrigger = ref(0)

  // 失衡轴配置
  const stunAxes = ref<import('@/types/resource').StunAxis[]>([])
  // 条件轴方案（按资源量自选轴：resolveStunAxisPlan 按 when 命中；存在时优先于 stunAxes）
  const stunAxisPlans = ref<import('@/types/resource').StunAxisPlan[]>([])
  const useStunAxis = ref(false)
  // 章鱼自动轴（队伍含伊德海莉 1051 时按 章×有琉 自动开失衡轴并选预设；手动配置过轴时让路）
  const autoYidhariAxis = ref(true)
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

  // 融合贪心边际收益（按槽位存储，用于 UI 展示）
  const perSlotMarginalGains = ref<Record<number, Record<string, number>>>({})

  // 当前 Tab
  const activeTab = ref<string>('team')

  // ========== Computed ==========

  const selectedChar = computed<CharacterConfig>(() => team.value[selectedSlot.value])

  const selectedAgent = computed<Agent | null>(() => {
    const id = selectedChar.value.agentId
    if (!id) return null
    return catalogStore.getAgent(id) ?? null
  })

  const selectedWEngine = computed<WEngine | null>(() => {
    const id = selectedChar.value.wEngineId
    if (!id) return null
    return catalogStore.getWEngine(id) ?? null
  })

  // 获取某个槽位的角色
  function getChar(slot: number): CharacterConfig {
    return team.value[slot]
  }

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

  function selectSlot(slot: number) {
    selectedSlot.value = slot
  }

  /**
   * 换人 + 自动推荐。
   * opts.defer = 批量换人（applyTeamPreset）时挂起同步/推荐副作用，
   * 避免 3 次 setAgent 各跑一遍融合贪心优化器导致卡顿；由调用方最后统一触发。
   */
  function setAgent(slot: number, agentId: string, opts?: { defer?: boolean }) {
    const char = team.value[slot]
    if (!char) return
    char.agentId = agentId

    const agent = catalogStore.getAgent(agentId)
    if (agent) {
      // 手动队默认会打（用户口径 2026-09-04「接线」）：换人即按 角色专属默认 > 正反馈排除 > 职业基准
      // 预填交互次数（相当于帮用户填好，用户可改）；预设显式 interactions 在 setAgent 之后应用会覆盖本预填。
      const base = interactionBaselineFor(agentId, agent.specialty)
      char.parryCount = base.parry
      char.dodgeCounterCount = base.dodge
      char.blockCount = base.block
      char.dualCounterCount = base.dual

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
      const dmgEl = agent.damageElement
      if (dmgEl && char.driveDisc.mainStats) {
        char.driveDisc.mainStats[5] = `${dmgEl}Dmg` as any
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
    }
  }

  function setCinemaLevel(slot: number, level: number) {
    const char = team.value[slot]
    if (char) {
      char.cinemaLevel = Math.max(0, Math.min(6, level))
      // 触发 resourceConfig 失效重算：模块 buildCharConfig 写入的命座字段（如仪玄 yixuanCinemaLevel）依赖此刷新
      refreshTrigger.value++
    }
  }

  function setPotentialLevel(slot: number, level: number) {
    const char = team.value[slot]
    if (char) {
      char.potentialLevel = Math.max(1, Math.min(6, level))
      // 潜能效果多数在 applyPanel/buildCharConfig 里按档位取值，切换档位同样需失效重算
      refreshTrigger.value++
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

  function setTauntCancelCount(slot: number, count: number) { setActionCount(slot, 'tauntCancelCount', count) }

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
    ;(char.driveDisc.mainStats as any)[slotNum] = statId
  }

  function setSubStatCount(slot: number, statId: string, count: number) {
    const char = team.value[slot]
    if (!char?.driveDisc.subStatAllocation) return
    const pool = catalogStore.statRules?.driveDisc?.subStatPool ?? []
    if (pool.length > 0 && !pool.includes(statId as any)) {
      delete char.driveDisc.subStatAllocation[statId]
      return
    }
    const safeCount = Math.max(0, Math.min(54, count))
    if (safeCount <= 0) delete char.driveDisc.subStatAllocation[statId]
    else char.driveDisc.subStatAllocation[statId] = safeCount
  }

  // ========== 角色动作次数：统一写入通道 ==========
  //
  // 下方 15 个命名 setter 都是一行包装（上下界见模块级 ACTION_COUNT_BOUNDS / clampActionCount）。
  // **新角色不必再往 store 加 setter**：直接调 `setActionCount(slot, '<字段>', n)` 即可——
  // 这正是评审 #9「角色 setter 泛化」要解决的「store 随角色数线性增长」。
  // 命名 setter 保留是为了既有 14 个消费文件零改动；旧调用点可择机迁到通用入口。
  function setActionCount(slot: number, field: ActionCountField, count: number) {
    const char = team.value[slot]
    if (char) char[field] = clampActionCount(field, count)
  }

  function setParryCount(slot: number, count: number) { setActionCount(slot, 'parryCount', count) }

  function setDodgeCounterCount(slot: number, count: number) { setActionCount(slot, 'dodgeCounterCount', count) }

  function setAssaultOrderCount(slot: number, count: number) { setActionCount(slot, 'assaultOrderCount', count) }

  function setPerfectBlockCount(slot: number, count: number) { setActionCount(slot, 'perfectBlockCount', count) }

  function setBlockCount(slot: number, count: number) { setActionCount(slot, 'blockCount', count) }
  function setDualCounterCount(slot: number, count: number) { setActionCount(slot, 'dualCounterCount', count) }

  function setYixuanInk2Count(slot: number, count: number) { setActionCount(slot, 'yixuanInk2Count', count) }

  function setPromiaNiyingCount(slot: number, count: number) { setActionCount(slot, 'promiaNiyingCount', count) }

  // 3连/完美格挡 ≤0 = 自动（剩余闪能打3连 / 全弹刀完美），≥1 手填（与模块哨兵同口径）
  function setYixuanInk3Count(slot: number, count: number) { setActionCount(slot, 'yixuanInk3Count', count) }

  function setYixuanPerfectBlockCount(slot: number, count: number) { setActionCount(slot, 'yixuanPerfectBlockCount', count) }

  function setYixuanExtremeAssistCount(slot: number, count: number) { setActionCount(slot, 'yixuanExtremeAssistCount', count) }

  function setYixuanBackstageComboCount(slot: number, count: number) { setActionCount(slot, 'yixuanBackstageComboCount', count) }

  function setQuickAssistCount(slot: number, count: number) { setActionCount(slot, 'quickAssistCount', count) }

  function setChainCountPerStun(slot: number, count: number) { setActionCount(slot, 'chainCountPerStun', count) }

  function setBasicAttackTimeWeight(slot: number, weight: number) { setActionCount(slot, 'basicAttackTimeWeight', weight) }

  function getDefaultBasicAttackTimeWeight(agent?: Agent | null): number {
    return defaultBasicAttackTimeWeight(agent)
  }

  function findDriveDiscSetByRecommendationName(name?: string) {
    if (!name) return undefined
    return catalogStore.displayDriveDiscSets.find(set => localizedName(set.name) === name)
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

    const fourPieceName = rec.drive_disc_sets?.four_piece?.name_zh || rec.drive_disc_sets?.four_piece?.name_en
    const fourPieceSet = findDriveDiscSetByRecommendationName(fourPieceName)
    if (fourPieceSet) char.driveDisc.fourPieceSetId = fourPieceSet.id

    const twoPieceName = rec.drive_disc_sets?.two_piece?.name_zh || rec.drive_disc_sets?.two_piece?.name_en
    const twoPieceSet = findDriveDiscSetByRecommendationName(twoPieceName)
    if (twoPieceSet) char.driveDisc.twoPieceSetId = twoPieceSet.id

    for (const slotNum of [4, 5, 6] as const) {
      const recStat = rec.main_stats?.[String(slotNum) as '4' | '5' | '6']
      const statId = recStat ? REC_MAIN_STAT_MAP[recStat.name] : undefined
      if (statId) char.driveDisc.mainStats[slotNum] = statId as any
    }

    char.driveDisc.subStatAllocation = {}
    if (rec.substats?.length) {
      const agent = catalogStore.getAgent(char.agentId)
      const wEngine = char.wEngineId ? catalogStore.getWEngine(char.wEngineId) : undefined
      if (agent) {
        // 使用融合贪心优化器（替代旧的固定步数启发式）
        const statCap = getMechanicSetting('optimizer.substatCap', 20)
        // 按有效词条数取对应档的总步数设置：0=自动使用该档默认值
        const tmpl = getTemplate(agent)
        const statsCount = tmpl.stats.length
        const totalStepsKey = statsCount <= 2 ? 'optimizer.totalSteps2'
          : statsCount === 3 ? 'optimizer.totalSteps3'
          : 'optimizer.totalSteps4'
        const totalSteps = getMechanicSetting(totalStepsKey, 0)

        // 快速默认路径（用户口径 2026-08：最优词条固定——暴击叠满、其余按序顶上限；跳过贪心 + 队友面板）。
        // 辅助/防护/击破伤害影响小、不跑贪心（击破「不一定给」——默认不给，转模源在模板首位吃满即可）。
        const isDpsSpecialty = agent.specialty === 'attack' || agent.specialty === 'anomaly' || agent.specialty === 'rupture'
        const useDefault = getMechanicSetting('optimizer.useDefault', 1) === 1 || !isDpsSpecialty

        let optResult: OptimizeSubstatsOutput
        if (useDefault) {
          optResult = computeOptimalSubStats({
            agent,
            wEngine,
            driveDiscConfig: char.driveDisc,
            setsMap: catalogStore.driveDiscSetsMap,
            teammateBuffs: [],
            statRules: catalogStore.statRules,
            statCap,
            totalSteps,
            useDefault: true,
            config: { cinemaLevel: char.cinemaLevel, wEngineModLevel: char.wEngineModLevel },
          })
        } else {
          const { enabledTeammateBuffs, sourcePanelsByOwner } = buildTeammateBuffSourceContext(team.value, {
            teammateBuffGroups: catalogStore.teammateBuffGroups,
            driveDiscSetsMap: catalogStore.driveDiscSetsMap,
            statRules: catalogStore.statRules,
            getAgent: (id) => catalogStore.getAgent(id),
            getWEngine: (id) => catalogStore.getWEngine(id),
            isTeammateBuffEnabled: (id) => isTeammateBuffEnabled(id),
          })

          // 构建队友信息（用于拐力计算）
          const teammates: TeammateInfo[] = []
          for (let i = 0; i < team.value.length; i++) {
            if (i === slot) continue
            const otherChar = team.value[i]
            if (!otherChar?.agentId) continue
            const otherAgent = catalogStore.getAgent(otherChar.agentId)
            if (!otherAgent) continue
            const otherWEngine = otherChar.wEngineId ? catalogStore.getWEngine(otherChar.wEngineId) : undefined
            try {
              const otherPanel = calcPanel(otherAgent, otherWEngine, otherChar.driveDisc,
                catalogStore.driveDiscSetsMap, enabledTeammateBuffs, catalogStore.statRules,
                { cinemaLevel: otherChar.cinemaLevel ?? 0, wEngineModLevel: otherChar.wEngineModLevel ?? 1 })
              const p = otherPanel.inCombat
              const cr = Math.min(100, Math.max(0, p.critRate)) / 100
              const directEst = p.atk * (1 + cr * (p.critDmg / 100)) * (1 + (p.dmgBonus ?? 0) / 100)
              const anomalyEst = p.atk * ((p.anomalyProficiency ?? 0) / 100) * (1 + (p.dmgBonus ?? 0) / 100)
              const isAnomaly = otherAgent.specialty === 'anomaly'
              teammates.push({
                agentId: otherChar.agentId,
                atk: p.atk,
                expectedDamage: isAnomaly ? anomalyEst : directEst,
                anomalyRelevant: isAnomaly,
              })
            } catch { /* 面板计算失败时跳过该队友 */ }
          }

          optResult = computeOptimalSubStats({
            agent,
            wEngine,
            driveDiscConfig: char.driveDisc,
            setsMap: catalogStore.driveDiscSetsMap,
            teammateBuffs: enabledTeammateBuffs,
            statRules: catalogStore.statRules,
            statCap,
            totalSteps,
            teammates: teammates.length > 0 ? teammates : undefined,
            config: {
              cinemaLevel: char.cinemaLevel,
              wEngineModLevel: char.wEngineModLevel,
              sourcePanelsByOwner,
            },
          })
        }

        for (const [statId, count] of Object.entries(optResult.subStatAllocation)) {
          if (count > 0) char.driveDisc.subStatAllocation[statId] = Math.max(0, Math.min(54, count))
        }
        // 存储边际收益供 UI 展示
        perSlotMarginalGains.value = {
          ...perSlotMarginalGains.value,
          [slot]: optResult.marginalGains,
        }
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

  /** 触发资源池重新计算 */
  function triggerRefresh() {
    refreshTrigger.value++
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

  function getWEngineEffectCoverageMap(): Map<string, number> {
    const map = new Map<string, number>()
    for (const [id, coverage] of Object.entries(wEngineEffectCoverages.value)) {
      map.set(id, Math.max(0, Math.min(100, coverage)) / 100)
    }
    return map
  }

  function resourceUtilizationKey(slot: number, actionId: string): string {
    return `${slot}:${actionId}`
  }

  function getResourceUtilization(slot: number, actionId: string): ResourceUtilizationOverride {
    return resourceUtilization.value[resourceUtilizationKey(slot, actionId)] ?? { rate: 1, cap: null }
  }

  function setResourceUtilization(slot: number, actionId: string, patch: Partial<ResourceUtilizationOverride>) {
    const key = resourceUtilizationKey(slot, actionId)
    const current = resourceUtilization.value[key] ?? { rate: 1, cap: null }
    const next = { ...current, ...patch }
    next.rate = Math.max(0, Math.min(1, Number.isFinite(next.rate) ? next.rate : 1))
    if (next.cap === undefined || next.cap === null || !Number.isFinite(Number(next.cap))) next.cap = null
    else next.cap = Math.max(0, Number(next.cap))
    resourceUtilization.value[key] = next
    refreshTrigger.value++
  }

  function resetResourceUtilization(slot?: number, actionId?: string) {
    if (slot !== undefined && actionId) {
      delete resourceUtilization.value[resourceUtilizationKey(slot, actionId)]
    } else if (slot !== undefined) {
      const prefix = `${slot}:`
      for (const key of Object.keys(resourceUtilization.value)) {
        if (key.startsWith(prefix)) delete resourceUtilization.value[key]
      }
    } else {
      resourceUtilization.value = {}
    }
    refreshTrigger.value++
  }

  /** 读取机制模块声明参数的当前值 */
  function getMechanicSetting(id: string, fallback: number): number {
    const value = mechanicSettings.value[id]
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback
  }

  /** 写入机制模块声明参数 */
  function setMechanicSetting(id: string, value: number) {
    mechanicSettings.value[id] = Number.isFinite(value) ? value : 0
    refreshTrigger.value++
  }

  function getTeamMechanicSetting(key: string, fallback: number): number {
    const value = teamMechanicSettings.value[key]
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback
  }

  function setTeamMechanicSetting(key: string, value: number) {
    teamMechanicSettings.value[key] = Number.isFinite(value) ? value : 0
    refreshTrigger.value++
  }

  function getAnomalyUtilizationRate(slot: number): number {
    const override = anomalyUtilizationRates.value[slot]
    if (typeof override === 'number' && Number.isFinite(override)) {
      return Math.max(0, Math.min(1, override))
    }
    return 1
  }

  function setAnomalyUtilizationRate(slot: number, rate: number) {
    anomalyUtilizationRates.value[slot] = Math.max(0, Math.min(1, Number.isFinite(rate) ? rate : 1))
    refreshTrigger.value++
  }

  function getAnomalySettlementShare(element: string, slot: number): number | null {
    const value = anomalySettlementShares.value[`${element}:${slot}`]
    return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : null
  }

  function setAnomalySettlementShare(element: string, slot: number, share: number) {
    anomalySettlementShares.value[`${element}:${slot}`] = Math.max(0, Math.min(1, Number.isFinite(share) ? share : 0))
    refreshTrigger.value++
  }

  /** 维琳娜2命风蚀利用率的兼容别名 */
  const velinaCinema2CorrosionRate = computed(() => getMechanicSetting('velina.cinema2CorrosionRate', 2 / 3))

  function setVelinaCinema2CorrosionRate(value: number) {
    setMechanicSetting('velina.cinema2CorrosionRate', Math.max(0, Math.min(1, Number.isFinite(value) ? value : 2 / 3)))
  }



  function isTeammateBuffEnabled(buffId: string): boolean {
    return teammateBuffSelections.value[buffId]?.enabled ?? false
  }

  function getTeammateBuffCoverage(buffId: string): number {
    return teammateBuffSelections.value[buffId]?.coverage ?? 100
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

  // 有效时间 = 180 - 无敌时间
  const effectiveTime = computed(() => Math.max(0, 180 - enemy.value.invincibleTime))

  // ========== 初始化 ==========

  function initDefaultTeam() {
    // 自动选择前3个角色作为默认队伍
    const agents = catalogStore.displayAgents.filter(a => !a.hidden)
    if (agents.length >= 3) {
      for (let i = 0; i < 3; i++) {
        setAgent(i, agents[i].id)
      }
    }
    // 初始化后同步一次队友 buff，再按完整队伍重刷推荐配置
    syncTeammateBuffsFromTeam()
    for (let i = 0; i < team.value.length; i++) {
      applyBuildRecommendationForSlot(i)
    }
  }

  /** 一键套用预设队伍（按槽位 0/1/2 的 agentId）。
   *  批量模式：defer 掉 setAgent 内的同步/推荐（各跑一遍融合贪心优化器很重），
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

  // 监听队伍变化，自动同步队友 buff 启用状态
  watch(
    () => team.value.map(c => ({ agentId: c.agentId, cinemaLevel: c.cinemaLevel })),
    () => {
      syncTeammateBuffsFromTeam()
    },
    { deep: true }
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

  // 监听优化器设置变化，自动重新执行融合贪心
  watch(
    () => [
      mechanicSettings.value['optimizer.substatCap'],
      mechanicSettings.value['optimizer.totalSteps2'],
      mechanicSettings.value['optimizer.totalSteps3'],
      mechanicSettings.value['optimizer.totalSteps4'],
    ],
    () => {
      for (let i = 0; i < 3; i++) {
        if (team.value[i]?.agentId) applyBuildRecommendationForSlot(i)
      }
    },
  )

  return {
    // state
    selectedSlot,
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
    velinaCinema2CorrosionRate,
    enemy,
    activeTab,
    // computed
    selectedChar,
    selectedAgent,
    selectedWEngine,
    usedAgentIds,
    effectiveTime,
    // actions
    selectSlot,
    getChar,
    getAgent,
    getWEngine,
    setAgent,
    setCinemaLevel,
    setPotentialLevel,
    setWEngine,
    setWEngineModLevel,
    setTauntCancelCount,
    setFourPieceSet,
    setTwoPieceSet,
    setMainStat,
    setSubStatCount,
    // 动作次数统一入口（新角色走这个，不必再加命名 setter）
    setActionCount,
    setParryCount,
    setDodgeCounterCount,
    setBlockCount,
    setPerfectBlockCount,
    setAssaultOrderCount,
    setDualCounterCount,
    setYixuanInk2Count,
    setPromiaNiyingCount,
    setYixuanInk3Count,
    setYixuanPerfectBlockCount,
    setYixuanExtremeAssistCount,
    setYixuanBackstageComboCount,
    setQuickAssistCount,
    setChainCountPerStun,
    setBasicAttackTimeWeight,
    getDefaultBasicAttackTimeWeight,
    applyBuildRecommendationForSlot,
    comboAlignOverrides,
    getComboAlignOverride,
    setComboAlignOverride,
    clearComboAlignOverrides,
    refreshTrigger,
    triggerRefresh,
    addGlobalBuff,
    removeGlobalBuff,
    updateGlobalBuff,
    toggleTeammateBuff,
    setTeammateBuffCoverage,
    setWEngineEffectCoverage,
    getWEngineEffectCoverage,
    getWEngineEffectCoverageMap,
    setDiscEffectCoverage,
    getDiscEffectCoverage,
    getResourceUtilization,
    setResourceUtilization,
    resetResourceUtilization,
    getMechanicSetting,
    setMechanicSetting,
    perSlotMarginalGains,
    stunAxes,
    stunAxisPlans,
    useStunAxis,
    autoYidhariAxis,
    timeWeightStrategy,
    setTimeWeightStrategy,
    getTeamMechanicSetting,
    setTeamMechanicSetting,
    getAnomalyUtilizationRate,
    setAnomalyUtilizationRate,
    getAnomalySettlementShare,
    setAnomalySettlementShare,
    setVelinaCinema2CorrosionRate,
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
})
