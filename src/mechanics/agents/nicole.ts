/**
 * 妮可（1031）—— 整局近似口径
 *
 * 拐力（teammate-buffs）
 * - 核心：强化子弹/能量场命中 → 目标防御 -40%（默认满覆盖）
 * - 额外能力（同属性或同阵营）：核心减益期间全队以太伤 +25%
 * - 影画6：能量场叠暴击 +1.5%×10 层（默认满层 15%）
 *
 * 模块
 * - 影画1：强特伤害与异常积蓄 +16%（执行级，EX 段）；每多蓄力 0.1s → 能量场持续 +0.15s
 *   （等比延长能量场 1031106 的倍率行：scale = 1 + 1.5×蓄力秒 / 能量场基准秒）
 * - 影画2：触发核心减益回 5 能量，15s CD → floor(战斗时长/15)×5 并入开局能量赠送（整局总量）
 * - 影画3/5：通用技能等级
 * - 影画4 范围扩大：不建模（无数值乘区）
 *
 * 未建模：能量场 3.5s 逐秒覆盖、子弹强化普攻循环细节。
 */
import type {
  AgentCharConfigInput,
  AgentMechanicModule,
  AgentResourceInput,
  ExtraNecessaryAction,
} from '../types'
import type { CharacterOperationConfig, IterationState } from '@/types/resource'
import { findMoveById as findMove, getRowValue as rowValue } from '@/data/moveTableQueries'
import { cinemaLevelOf } from '@/data/cinemaLevel'

export const NICOLE_ID = '1031'

/** 强化特殊技：夹心糖衣炮弹 四段 */
export const NICOLE_EX_MOVE_IDS = new Set([
  '1031103', '1031104', '1031105', '1031106',
])

export const NICOLE_C1_EX_BONUS = 16
export const NICOLE_C2_ENERGY = 5
export const NICOLE_C2_CD = 15
/** 蓄力（持续段）moveId */
export const NICOLE_CHARGE_MOVE = '1031103'
/** 能量场（必放）moveId */
export const NICOLE_ENERGY_FIELD_MOVE = '1031106'
/** 影画1：每蓄力 1 秒 → 能量场持续时间 +1.5 秒（0.1s→0.15s） */
export const NICOLE_C1_FIELD_SECONDS_PER_CHARGE_SECOND = 1.5

/** 核心被动：防-40%，持续 3.5s（每次强化子弹/能量场命中刷新一次） */
export const NICOLE_DEBUFF_TAIL_SECONDS = 3.5
/** 每次上弹最多强化 8 次普通攻击/冲刺攻击（原文「最多触发8次」）⇒ 一次技能最多供 8 发强化子弹 */
export const NICOLE_BULLETS_PER_APPLY = 8
/** 「a 一下」= 普通攻击：狡兔连打 #1（最短一段）——减防接力用最小的前台代价 */
export const NICOLE_POKE_MOVE_ID = '1031001'

// @fact agent:1031/影画1能量场 口径: 影画1「每多蓄力0.1秒→能量场持续+0.15秒」=能量场(1031106)倍率行等比延长，scale=1+1.5×蓄力秒/能量场基准秒(actionTime) | 据 nanoka full/1031.json + 用户@2026-09 | 验 src/mechanics/__tests__/nicole.test.ts | 锚 src/mechanics/agents/nicole.ts#NICOLE_C1_FIELD_SECONDS_PER_CHARGE_SECOND + src/mechanics/agents/nicole.ts#buildCharConfig | 信 确认

function buildCharConfig({ cinemaLevel, cfg, skills }: AgentCharConfigInput): void {
  const cinema = cinemaLevelOf(cinemaLevel)
  cfg.nicoleCinemaLevel = cinema

  // 影画1：能量场倍率行等比延长（蓄力秒/能量场基准秒）。蓄力秒取持续段 1 段 = 1031103.actionTime。
  const chargeMove = findMove(skills, NICOLE_CHARGE_MOVE)
  const fieldMove = findMove(skills, NICOLE_ENERGY_FIELD_MOVE)
  const chargeSeconds = chargeMove?.actionTime ?? 0
  const fieldBaseSeconds = fieldMove?.actionTime ?? 0
  const scale = cinema >= 1 && chargeSeconds > 0 && fieldBaseSeconds > 0
    ? 1 + NICOLE_C1_FIELD_SECONDS_PER_CHARGE_SECOND * chargeSeconds / fieldBaseSeconds
    : 1
  cfg.nicoleC1EnergyFieldScale = scale
  cfg.nicoleEnergyFieldBaseSeconds = fieldBaseSeconds
  cfg.nicoleC1EnergyFieldDamage = rowValue(fieldMove, 'damage') * scale
  cfg.nicoleC1EnergyFieldDaze = rowValue(fieldMove, 'daze') * scale
  cfg.nicoleC1EnergyFieldAnomaly = rowValue(fieldMove, 'anomaly_buildup') * scale

  // 「a 一下」的动作秒数（减防接力用的最短普攻段，见 nicoleBulletReserve）
  cfg.nicolePokeActionTime = findMove(skills, NICOLE_POKE_MOVE_ID)?.actionTime ?? 0

  // 影画2：核心减益触发回 5 能量 / 15s → 整局 floor(t/15)×5
  if (cinema >= 2) {
    const battleTime = cfg.battleTime
    const triggers = Math.max(0, Math.floor(battleTime / NICOLE_C2_CD))
    cfg.initialEnergyGift = cfg.initialEnergyGift + triggers * NICOLE_C2_ENERGY
  }
}

function patchExecutions({ cfg, executions }: AgentResourceInput): void {
  const cinema = cinemaLevelOf(cfg.nicoleCinemaLevel)
  const fieldScale = Number(cfg.nicoleC1EnergyFieldScale ?? 1)
  if (cinema < 1) return
  for (const exec of executions) {
    if (!exec.moveId || !NICOLE_EX_MOVE_IDS.has(exec.moveId)) continue
    exec.dmgBonus = (exec.dmgBonus ?? 0) + NICOLE_C1_EX_BONUS
    if (exec.moveId === NICOLE_ENERGY_FIELD_MOVE && fieldScale > 1) {
      // 影画1：能量场持续时间等比延长 → 倍率行等比放大（增伤区 +16% 另计）
      exec.damageMultiplier = Number(cfg.nicoleC1EnergyFieldDamage ?? 0)
      exec.damageMultiplierOverride = true
      exec.dazeMultiplier = Number(cfg.nicoleC1EnergyFieldDaze ?? 0)
      exec.dazeMultiplierOverride = true
      exec.anomalyBuildUp = Number(cfg.nicoleC1EnergyFieldAnomaly ?? 0)
      exec.anomalyBuildUpOverride = true
      exec.totalAnomalyBuildUp = Number(cfg.nicoleC1EnergyFieldAnomaly ?? 0) * exec.count
    }
    if ((exec.anomalyBuildUp ?? 0) > 0) {
      exec.anomalyBuildUp = (exec.anomalyBuildUp ?? 0) * (1 + NICOLE_C1_EX_BONUS / 100)
      if (exec.totalAnomalyBuildUp != null) {
        exec.totalAnomalyBuildUp = exec.anomalyBuildUp * exec.count
      }
    }
    exec.skillTableNote =
      `${exec.skillTableNote ?? ''}；影画1 强特伤害/积蓄 +${NICOLE_C1_EX_BONUS}%${exec.moveId === NICOLE_ENERGY_FIELD_MOVE && fieldScale > 1 ? `，能量场持续×${fieldScale.toFixed(2)}` : ''}`
  }
}

/**
 * **减防覆盖率所需的「强化子弹」平A 时间**（用户口径 2026-10-22）
 *
 * 原文（核心被动）：妮可在特殊技/强化特殊技/连携技/终结技中「上弹并强化普通攻击与冲刺攻击」，
 * 「强化子弹或能量场命中敌人时，目标的防御力降低 40%，持续 3.5 秒」。⇒ 减防的触发源**只有强化子弹**，
 * 每次上弹最多 **8 发**；**普通平A（未强化）不触发**。
 *
 * 用户原话：「妮可技能会给强化子弹，这个平a也能上3.5秒的持续减防，a一下就是这么多，填充剩余的不需要很多时间。
 * 剩下的时间就要用妮可的平a时间来填充了，这样可以自动计算出他应当填充的固定平a时间，放进必要时间里面」。
 *
 * ## 单次技能能盖住的秒数（三段相加，缺一不可）
 * ① **发炮动作期间**（`cfg.exSpecialActionTime`，C0 = 0.742+0.371+0.371 = 1.484s；能量场 1031106 是
 *    `countsTime:false` 的自动攻击段，不占前台但**时间照走**）；
 * ② **能量场持续段**（基准 1.484s，影画1 按蓄力等比延长 ×`nicoleC1EnergyFieldScale`）；
 * ③ **减防尾 3.5s**。
 * ⇒ C0 单次 = 6.47s；11 次触发 ≈ 74s ≈ **41%**，剩下 59% 靠强化子弹平A 接力。
 * 每发子弹 = 一段最短普攻（0.194s）换 3.5s 覆盖 ⇒ 补满只需 **5~7s**（见 tests 实测表）。
 *
 * ## 为什么进 necessaryTime 而不是平A池
 * 这是**覆盖率驱动**的固定时间：不补则覆盖率只有 33~46%，补了才配得上 teammate-buffs 的默认满覆盖。
 * 池里的平A 是「资源富余时填缝」的通用A，语义不同，且**未强化平A 本来就不触发减防**。
 *
 * 口径边界：
 * · 触发次数取 `ex + ult + chain`（这三类都会上弹）；子弹上限 = 8 × 触发次数，需求超过上限时只发上限并发不出满覆盖
 *   （实测全库 11 队需求 28~35 发 vs 上限 73~102 发 ⇒ **无一队触顶**）；
 * · 该行 `comboAlignRatio = 0`（站场时间，不借合轴抵扣）；要改成「偷合轴」需先有平A 合轴率通道（引擎暂无）；
 * · 行带 `moveId` ⇒ 物化成真实招式行（拿到该段的伤害/回能，不是纯时间预留）。
 */
export function nicoleBulletReserve(cfg: CharacterOperationConfig, state?: Readonly<IterationState>): ExtraNecessaryAction[] | null {
  if (!state) return null
  const pokeTime = Number(cfg.nicolePokeActionTime ?? 0)
  if (!(pokeTime > 0)) return null
  const triggers = state.exSpecialCount + state.ultimateCount + state.chainCountTotal
  if (!(triggers > 0)) return null
  const total = cfg.battleTime
  if (!(total > 0)) return null
  const fieldScale = Math.max(1, Number(cfg.nicoleC1EnergyFieldScale ?? 1))
  const field = (Number(cfg.nicoleEnergyFieldBaseSeconds ?? 0) || 0) * fieldScale
  const tail = NICOLE_DEBUFF_TAIL_SECONDS
  const perTrigger = (actionTime: number) => actionTime + field + tail
  const covered = state.exSpecialCount * perTrigger(cfg.exSpecialActionTime)
    + state.ultimateCount * perTrigger(cfg.ultimateActionTime)
    + state.chainCountTotal * perTrigger(cfg.chainActionTime)
  const gap = Math.max(0, total - covered)
  if (gap <= 0) return null
  const cap = NICOLE_BULLETS_PER_APPLY * triggers
  const need = Math.min(cap, Math.ceil(gap / tail))
  if (!(need > 0)) return null
  return [{
    count: need,
    moveId: NICOLE_POKE_MOVE_ID,
    moveName: '强化子弹平A（减防接力）',
    actionTime: pokeTime,
    comboAlignRatio: 0,
    decibelRecovery: 0,
  }]
}

export const nicoleMechanic: AgentMechanicModule = {
  id: 'agent:nicole',
  agentIds: [NICOLE_ID],
  name: '妮可·机关箱',
  description: '核心减防、额外以太伤、影画1强特增伤积蓄、影画2回能、影画6暴击。',
  buildCharConfig,
  patchExecutions,
  extraNecessaryAction: nicoleBulletReserve,
}


/**
 * D2（CC-359/362）：本模块私有的 cfg 字段——只有本文件读写，声明随模块走，不堆在 `types/resource/config.ts`。
 * 仍是 `CharacterOperationConfig` 的成员（模块扩充，纯类型、零运行时）；被第二处引用时请迁回公共接口。
 */
declare module '@/types/resource/config' {
  interface CharacterOperationConfig {
    /** 妮可命座等级（buildCharConfig 写） */
    nicoleCinemaLevel?: number
    /** 能量场基准秒数（1031106 actionTime，buildCharConfig 写）——减防接力覆盖率算能量场持续段 */
    nicoleEnergyFieldBaseSeconds?: number
    /** 「a 一下」动作秒数（狡兔连打 #1，buildCharConfig 写） */
    nicolePokeActionTime?: number
    /** 妮可影画1 能量场倍率缩放（buildCharConfig 写） */
    nicoleC1EnergyFieldScale?: number
    /** 妮可影画1 能量场伤害倍率（行值 × 缩放） */
    nicoleC1EnergyFieldDamage?: number
    /** 妮可影画1 能量场失衡值（行值 × 缩放） */
    nicoleC1EnergyFieldDaze?: number
    /** 妮可影画1 能量场异常积蓄（行值 × 缩放） */
    nicoleC1EnergyFieldAnomaly?: number
  }
}
