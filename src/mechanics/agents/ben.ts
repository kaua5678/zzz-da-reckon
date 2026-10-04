/**
 * 本（1121）—— 整局近似口径
 *
 * 核心·守卫（满级）
 * - 初始攻击随初始防御提升：局外防御×80% 作为局外小攻击加成计入面板
 * - 强特追加强力打击 → 全队护盾（30%防+550，30s）—— 吸收量不进伤害
 *
 * 额外能力·协议合同（同属性或同阵营）
 * - 触发额外能力后全队暴击 +16%（默认满覆盖；teammate-buffs + helpers 门控）
 *
 * 影画
 * - C1：不建模
 * - C2：格挡反击额外 300% 防御力伤害 → 仅按成功招架的强特连招次数触发
 * - C3/C5：通用技能等级
 * - C4：无敌格挡后的后继反击伤害 +30% → 仅 moveId 1121011
 * - C6：普通攻击/冲刺攻击/闪避反击失衡 +20% → 对三类招式全局生效
 *
 * 强特口径
 * - 总连招次数 = floor(可用总能量 / 60)，每组两段各耗 30
 * - 未招架：1121008 + 1121009；招架成功：1121010 + 1121011
 * - 招架成功率由 `ben.exParrySuccessRate` 调节，默认 100%；C2 只跟随成功组次数
 *
 * 旧 benGuardShieldMechanic（仅自身暴击）由本模块 + teammate-buffs 全队暴击替代。
 *
 * @author kaua5678
 */
import type {
  AgentCharConfigInput,
  AgentMechanicModule,
  AgentPanelInput,
  AgentResourceInput,
} from '../types'
import { cfgMechanicSettingRaw } from '@/utils/mechanicSettingCfg'
import { moduleExecRow } from '@/mechanics/moduleExecRow'

export const BEN_ID = '1121'

/** 满级：初始防 → 攻击 80% */
export const BEN_DEF_TO_ATK = 0.8

export const BEN_C2_DEF_MULT = 300
export const BEN_C4_COUNTER_DMG = 30
export const BEN_C6_STUN_BONUS = 20
export const BEN_EX_COMBO_ENERGY = 60
export const BEN_EX_PART_ENERGY = 30
export const BEN_EX_PARRY_RATE_SETTING = 'ben.exParrySuccessRate'

export const BEN_EX_NORMAL_MOVE_IDS = ['1121008', '1121009'] as const
export const BEN_EX_PARRY_MOVE_IDS = ['1121010', '1121011'] as const

/** 假 id：C2 格挡反击附加（防御力基底） */
export const MOVE_C2_COUNTER = '1121c2_guard_counter'

/** 影画4：只有成功格挡后的后继反击招式 1121011 获得增伤 */
export const BEN_C4_MOVE_IDS = new Set(['1121011'])

function clamp01(value: unknown, fallback = 1): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : fallback
}

function findMoveActionTime(
  skills: AgentCharConfigInput['skills'],
  moveId: string,
): number {
  for (const category of skills.categories ?? []) {
    const move = category.moves?.find(item => item.id === moveId)
    if (move) return Math.max(0, move.actionTime ?? 0)
  }
  return 0
}

function applyPanel({ cinemaLevel, outOfCombatPanel, panel }: AgentPanelInput): void {
  // 「初始」严格取局外面板：局外防御×80% 作为局外小攻击加成计入最终面板。
  const outOfCombatDef = Math.max(0, outOfCombatPanel.def ?? 0)
  const bonus = outOfCombatDef * BEN_DEF_TO_ATK
  if (bonus > 0) panel.atk = (panel.atk ?? 0) + bonus
  panel.benDefToAtk = bonus

  const cinema = cinemaLevel ?? 0
  if (cinema >= 6) {
    panel.stunBuildUpBonus__basic = (panel.stunBuildUpBonus__basic ?? 0) + BEN_C6_STUN_BONUS
    panel.stunBuildUpBonus__dashAttack = (panel.stunBuildUpBonus__dashAttack ?? 0) + BEN_C6_STUN_BONUS
    panel.stunBuildUpBonus__dodgeCounter = (panel.stunBuildUpBonus__dodgeCounter ?? 0) + BEN_C6_STUN_BONUS
  }
}

function buildCharConfig({ cinemaLevel, cfg, panel, skills }: AgentCharConfigInput): void {
  cfg.benCinemaLevel = cinemaLevel ?? 0
  cfg.benDef = panel.def ?? 0
  cfg.benExParrySuccessRate = clamp01(cfgMechanicSettingRaw(cfg, BEN_EX_PARRY_RATE_SETTING), 1)
  cfg.benExActionTimes = Object.fromEntries(
    [...BEN_EX_NORMAL_MOVE_IDS, ...BEN_EX_PARRY_MOVE_IDS]
      .map(moveId => [moveId, findMoveActionTime(skills, moveId)]),
  )

  // 一组强特固定消耗 30+30；让资源池用可用总能量 / 60 推导总组数，模块接管真实两段执行。
  cfg.exSpecialEnergyConsume = BEN_EX_COMBO_ENERGY
  cfg.skipGenericExSpecial = true
}

function pushExPart(
  executions: AgentResourceInput['executions'],
  moveId: string,
  count: number,
  actionTime: number,
  label: string,
): void {
  if (count <= 0) return
  executions.push(moduleExecRow({
    moveId,
    moveName: label,
    category: 'special',
    count,
    actionTime,
    totalTime: count * actionTime,
    energyConsume: BEN_EX_PART_ENERGY,
    totalEnergyConsume: count * BEN_EX_PART_ENERGY,
    energyRecovery: 0,
    totalEnergyRecovery: 0,
    skillTableNote: `${label} ×${count}；每段耗能 ${BEN_EX_PART_ENERGY}`,
  }))
}

function buildExecutions({ cfg, state, executions }: AgentResourceInput): void {
  const cinema = Math.max(0, Math.floor(Number(cfg.benCinemaLevel ?? 0)))
  const comboCount = Math.max(0, Math.floor(state.exSpecialCount ?? 0))
  if (comboCount <= 0) return

  const successRate = clamp01(cfg.benExParrySuccessRate, 1)
  const successCount = comboCount * successRate
  const normalCount = comboCount - successCount
  const actionTimes: Record<string, number> = cfg.benExActionTimes ?? {}

  for (const moveId of BEN_EX_NORMAL_MOVE_IDS) {
    pushExPart(executions, moveId, normalCount, actionTimes[moveId] ?? 0, '强化特殊技·未招架')
  }
  for (const moveId of BEN_EX_PARRY_MOVE_IDS) {
    pushExPart(executions, moveId, successCount, actionTimes[moveId] ?? 0, '强化特殊技·招架成功')
  }

  // C2 只由成功触发格挡反击的强特组触发；成功率允许期望值小数。
  if (cinema < 2 || successCount <= 0) return
  const def = Math.max(0, Number(cfg.benDef ?? 0))
  executions.push(moduleExecRow({
    moveId: MOVE_C2_COUNTER,
    moveName: '影画2·格挡反击附加',
    category: 'special',
    count: successCount,
    decibelRecovery: 0,
    totalDecibelRecovery: 0,
    energyRecovery: 0,
    totalEnergyRecovery: 0,
    damageMultiplier: BEN_C2_DEF_MULT,
    damageMultiplierOverride: true,
    basisValueOverride: def,
    basisLabelOverride: '本的防御力',
    element: 'fire',
    skillTableNote: `C2 格挡反击附加 ×${successCount}（仅成功招架；300% 防御力）`,
  }))
}

function patchExecutions({ cfg, executions }: AgentResourceInput): void {
  const cinema = Math.max(0, Math.floor(Number(cfg.benCinemaLevel ?? 0)))
  if (cinema < 4) return
  for (const exec of executions) {
    if (!exec.moveId || !BEN_C4_MOVE_IDS.has(exec.moveId)) continue
    exec.dmgBonus = (exec.dmgBonus ?? 0) + BEN_C4_COUNTER_DMG
    exec.skillTableNote = `${exec.skillTableNote ?? ''}；影画4 后继反击伤害 +${BEN_C4_COUNTER_DMG}%`
  }
}

export const benMechanic: AgentMechanicModule = {
  id: 'agent:ben',
  agentIds: [BEN_ID],
  name: '本·守卫',
  description: '防转攻、护盾暴击（全队）、强特招架分流与影画2/4/6。',
  settings: [{
    id: BEN_EX_PARRY_RATE_SETTING,
    label: '强特招架成功率',
    description: '强化特殊技连招中成功招架的比例；决定招式分支与影画2反击次数。',
    default: 1,
    min: 0,
    max: 1,
    step: 0.1,
  }],
  /** CC-402：强特连招两分支互斥（未招架 1121008/1121009 ↔ 招架成功 1121010/1121011）；两段都列。 */
  moveBranchGroups: [[...BEN_EX_NORMAL_MOVE_IDS, ...BEN_EX_PARRY_MOVE_IDS]],
  applyPanel,
  buildCharConfig,
  buildExecutions,
  patchExecutions,
}

export default benMechanic

/**
 * D2（CC-359/362）：本模块私有的 cfg 字段——只有本文件读写，声明随模块走，不堆在 `types/resource/config.ts`。
 * 仍是 `CharacterOperationConfig` 的成员（模块扩充，纯类型、零运行时）；被第二处引用时请迁回公共接口。
 */
declare module '@/types/resource/config' {
  interface CharacterOperationConfig {
    /** 本命座等级（buildCharConfig 写） */
    benCinemaLevel?: number
    /** 本局内防御力（buildCharConfig 从 panel 预存，防御转攻击用） */
    benDef?: number
    /** 本强化特殊技各招式动作时间（buildCharConfig 按 moveId 预存） */
    benExActionTimes?: Record<string, number>
    /** 本强化特殊技格挡成功率（buildCharConfig 由机制设置 clamp 到 [0,1]） */
    benExParrySuccessRate?: number
  }
}

/**
 * D2（r402 CC-376，`docs/mcp-panel-fields.md` §4 S2+S4）：本模块私有的面板字段——只有本文件读写（测试读不算引用者），声明随模块走。
 * 仍是 `PanelValues` 的成员（模块扩充，纯类型、零运行时）；出现第二个**生产**引用者时迁回 `types/catalog.ts`。
 */
declare module '@/types/catalog' {
  interface PanelValues {
    /** 局外防御×80% 转攻击的留痕：与 `panel.atk` 增量同块写入 */
    benDefToAtk?: number
  }
}
