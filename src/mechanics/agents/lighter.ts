/**
 * 莱特（1161）—— 整局近似口径
 *
 * 核心·助燃剂
 * - 士气：时间 2.9/s + 全队普通能量消耗 ×0.26（不含闪能/命破）；上限 100；C6 回复效率 ×2。
 * - 士气喷发：士气≥80 后进入；喷发中耗尽士气打出强力终结一击；默认整局可维持喷发（用户口径：
 *   第一次快速刺拳实时叠昂扬后永续）。
 * - 喷发耗士气：每 10 点冲击力 +2%（满级），最多 +20%，持续 6s → 默认吃满 +20%。
 * - 减抗：轻拳/刺拳命中 → 冰火抗 -15%（30s）；C1 再 -10%。由 teammate-buffs 承载。
 * - 溃败：终结一击命中 → 失衡时长 +3s（C1→+5s），同目标失衡前最多一次 → 整局按每失衡窗口吃满。
 *
 * 额外·斗志昂扬（强攻或同阵营）
 * - 喷发中普攻第五段命中叠昂扬，最多 20 层；每层冰火伤 +1.25%，冲击力>170 时每超 10 点每层再 +0.25%；
 *   硬顶 75%。用户口径：第一次快速刺拳实时算层/强度，之后永续 → 默认按冲击力算满层满覆盖。
 * - C2：昂扬增益 ×1.2；溃败失衡易伤 +25%（teammate-buffs）。
 * - 昂扬数值只由 teammate-buffs 1161「额外能力」条承载（公式读莱特局内冲击力；门控 = spec 1161
 *   teamConditions；C2 ×1.2 = 影画二 buffModifiers）。r761 删本模块的同式副本（结果只写进无人读的字段）。
 *
 * 影画
 * - C1：溃败 +5s、减抗 +10%、耗尽士气强力终结伤害 +30%（执行级，默认覆盖强力终结行）。
 * - C2：见上。
 * - C3/C5：通用技能等级。
 * - C4：莱特在后场时前场能量获得效率 +10%（按莱特后台时间/总时长折覆盖）；进士气喷发时后场角色 +4 能量，
 *   18s CD → floor(combatTime/18) 次。
 * - C6：士气回复 ×2；重击触发火焰冲击 250% 火伤（每敌 8s CD，按战斗时长折算），冲击力>170 每超 1 点倍率 +5%
 *   最多 +500%；耗尽士气的强力终结可额外无视 CD 触发 1 次/次。
 *
 * 未建模：士气喷发逐帧进出、垫步/组合拳段数、逐敌火焰冲击独立 CD（按整场单目标 8s CD 近似）。
 */
import { carveBasicPool, moduleExecRow, RECOVERY_OFF } from '@/mechanics/moduleExecRow'
import type {
  AgentCharConfigInput,
  AgentMechanicModule,
  AgentNextRoundFeedbackInput,
  AgentPanelInput,
  AgentTeamPanelEffectInput,
  AgentResourceInput,
  AgentResourceResultInput,
  AgentResourceSectionsInput,
} from '../types'
import type { ModuleFeedback } from '../types'
import type { CharacterOperationConfig, CharacterResourceResult, SkillExecution } from '@/types/resource'
import { effectiveCombatTime } from '@/core/effectiveTime'
import { fmt } from '@/utils/format'
import { cinemaLevelOf } from '@/data/cinemaLevel'

import { mechanicSettingPanelReader } from '@/utils/mechanicSettingCfg'
const settingOf = mechanicSettingPanelReader(() => lighterMechanic.settings)
export const LIGHTER_ID = '1161'

/** 士气时间回复（点/秒） */
export const LIGHTER_MORALE_PER_SEC = 2.9
/** 全队每消耗 1 点普通能量 → 士气 */
export const LIGHTER_MORALE_PER_ENERGY = 0.26
/** 士气上限 */
export const LIGHTER_MORALE_CAP = 100
export const LIGHTER_IMPACT_CAP_PCT = 20
/** 0 命溃败失衡延长（秒） */
export const LIGHTER_ROUT_STUN_BONUS = 3
/** 1 命溃败失衡延长（秒） */
export const LIGHTER_ROUT_STUN_BONUS_C1 = 5
/** 冲击力阈值：C6 火焰冲击的超额倍率从这里起算 */
export const LIGHTER_IMPACT_SOFT_CAP = 170
/** C6 火焰冲击基础倍率% */
export const LIGHTER_C6_FLAME_BASE = 250
/** C6 火焰冲击冲击力超额每点 +5% 倍率，最多 +500% */
export const LIGHTER_C6_FLAME_PER_IMPACT = 5
export const LIGHTER_C6_FLAME_EXTRA_CAP = 500
export const LIGHTER_C6_FLAME_CD = 8
/** C1 强力终结伤害 +30% */
export const LIGHTER_C1_FINISHER_DMG = 30
/** C4 喷发回能 */
export const LIGHTER_C4_BURST_ENERGY = 4
export const LIGHTER_C4_BURST_CD = 18
/** C4 后场→前场能量获得效率 +10% */
export const LIGHTER_C4_FRONT_EFFICIENCY = 10

/** 假 id：火焰冲击附加火伤（不进失衡/异常池） */
export const MOVE_FLAME_SHOCK = '1161c6_flame_shock'

/**
 * 每轮喷发里「连续冲拳」的段数（用户视频实测 2026-10-26）。
 *
 * 用户原话：「我看了下视频，80 士气打连续冲拳只兑现了 2 次，也就是 1.4 秒左右，
 * 然后就是终结一击耗时 1 秒。」
 *
 * ⚠ **只用 moveId 认招**（用户 2026-10-26：「这个编号每个网站都不一样，只是一种描述。
 * moveid 才是唯一的」）。B 站/nanoka 的显示编号与 catalog 的「#N」是两套编号，本文件一律不引用：
 *   1161020 快速支援（0.317s）—— 本轮起手（原文见下）
 *   1161027 连续冲拳（五段连击，0.777s / 729.5%）—— 每轮 2 段
 *   1161025 强化一击（五段强力终结，1.002s / 871.0%）—— 耗尽士气自动衔接
 *   1161028 未强化的最终一击（0.837s）—— 未耗尽士气就收招才打出，本模型不产行
 *   1161026 五段起攻（1.239s）—— **实战不走这一支**（见下），不产行
 *
 * **每轮 = 1161020 快支 + 1161027 连续冲拳 ×2 + 1161025 强化一击**
 * （用户口径 2026-10-26：「实战都是快支直接加冲拳，打完再来强化一击」。原文佐证：
 *  skill.assist.description[0]「快速支援：烈闪-守…招式发动后，点按或长按可以直接衔接发动第五段
 *  [普通攻击]」⇒ 士气攒到 80 后换入自动发快支，快支直接接第五段，不必从 a1 起手、也不经过起攻段）。
 */
export const LIGHTER_BURST_JAB_COUNT = 2

/** 进入士气喷发的士气门槛（原文：「[士气]大于等于 80 点后，莱特发动第五段[普通攻击]时，将进入[士气喷发]状态」） */
export const LIGHTER_BURST_ENTRY = 80

// ============ 五段四招（士气喷发态）============
// 原文 data/raw/nanoka_missing/full/1161.json · skill.basic.description[1].param（**认招一律用 moveId**）：
//   快速支援            → 1161020｜0.317s（每轮起手；原文「招式发动后可直接衔接发动第五段」）
//   五段起攻（喷发态）   → 1161026｜1.239s（实战不经过）
//   五段连击（喷发态）   → 1161027｜0.777s（连续冲拳）
//   五段终结（喷发态）   → 1161028｜0.837s（未强化的最终一击）
//   五段强力终结（喷发态）→ 1161025｜1.002s（耗尽士气的强化一击）
// 用户口径 2026-10-26：「士气这个是强化a，肯定比普通a3厉害」⇒ 喷发态必须物化，不能拿通用 a3 秒均顶替。
/** 五段起攻（喷发态，1161026，1.239s）：实战不走这一支（快支直接接第五段）——不产行，仅保留作 fireShock/诊断口径 */
export const MOVE_BURST_OPENER = '1161026'
/** 快速支援（1161020，0.317s）：士气攒到 80 换入自动发动，并直接衔接第五段——每轮真正的起手 */
export const MOVE_QUICK_ASSIST = '1161020'
/** 连续冲拳（五段连击，1161027，0.777s）：每轮 2 段（用户视频实测） */
export const MOVE_BURST_JAB = '1161027'
/** 未强化的最终一击（五段终结，1161028，0.837s）：未耗尽士气就收招时打出——本模型每轮打满至耗尽，故不产行 */
export const MOVE_BURST_FINISHER = '1161028'
/** 强力终结一击（喷发态，1161025，1.002s / 871.0%）：连续冲拳期间耗尽士气自动衔接 */
export const MOVE_POWER_FINISHER = '1161025'

export interface LighterMoraleInput {
  combatTime: number
  /** 全队普通能量消耗（不含闪能/命破） */
  teamEnergyConsumed: number
  cinemaLevel: number
  /** 每轮喷发占用秒数（原文「喷发状态下不再随时间自动获得士气」⇒ 这段时间不回时间气） */
  burstSecondsPerCycle?: number
}

export interface LighterMoraleResult {
  moraleGain: number
  moraleGainTime: number
  moraleGainEnergy: number
  /** 理论可进入喷发次数（整局士气总量 / 80，下限 0） */
  burstEntries: number
  /** 耗尽士气打出的强力终结次数（≈ 喷发次数，整局近似） */
  powerFinisherCount: number
}

/** 满级核心冲击力加成%（喷发耗士气，默认吃满） */
function computeLighterImpactBonusPct(_cinemaLevel = 0): number {
  return LIGHTER_IMPACT_CAP_PCT
}

export function computeLighterRoutStunBonus(cinemaLevel = 0): number {
  return cinemaLevel >= 1 ? LIGHTER_ROUT_STUN_BONUS_C1 : LIGHTER_ROUT_STUN_BONUS
}

/**
 * 士气总量与喷发/强力终结次数。
 * C6：回复效率 ×2（时间+能量来源均 ×2）。
 *
 * **每轮成本 = 入场门槛 80 + 喷发期消耗（用户口径 2026-10-26）**：
 * 「连击会消耗士气啊，一轮失衡莱特基本就连击几秒钟打完士气接个终结一击就没了，要重新攒了」
 * ⇒ 喷发一轮的真实士气开销 = 进场那 80 点 + 喷发中连击消耗掉的那部分（≈ 整条）。
 * 而原文「[士气喷发]状态下，莱特**不再随时间自动获得**[士气]」⇒ 喷发那几秒也不产时间回能。
 * 故每轮净成本 ≈ 100（上限，用户「多了也溢出」），喷发占用时间还要从可回气时间里扣掉。
 * 修前按 /100 直接除且**不扣喷发时间**，等于白送喷发期的回气——这才是「爆发这么少」的真实原因之一。
 */
export function computeLighterMorale(input: LighterMoraleInput): LighterMoraleResult {
  const t = Math.max(0, Number(input.combatTime) || 0)
  const energy = Math.max(0, Number(input.teamEnergyConsumed) || 0)
  const mult = cinemaLevelOf(input.cinemaLevel) >= 6 ? 2 : 1
  const perSec = LIGHTER_MORALE_PER_SEC * mult
  const energyGainTotal = energy * LIGHTER_MORALE_PER_ENERGY * mult
  const burstBusy = Math.max(0, Number(input.burstSecondsPerCycle) || 0)

  // 逐轮推进：每轮先攒够 80，再花掉喷发时间（期间不回气），循环到时间或士气用尽
  let timeLeft = t
  let energyLeft = energyGainTotal
  let timeGainUsed = 0
  let entries = 0
  // 单轮最多能兑现 100 点（上限，多了一轮内溢出）；入场只需 80 ⇒ 每轮可预支能量回能
  const guard = 10000
  for (let i = 0; i < guard; i++) {
    if (timeLeft <= 0) break
    // 本轮可用：剩余时间回能 + 剩余能量回能（两者相加够 80 才进得去）
    const timeGainThis = perSec * timeLeft
    if (timeGainThis + energyLeft < LIGHTER_BURST_ENTRY) break
    // 先把能量回能算进来（够 80 的部分），不足的用时间补
    const takeEnergy = Math.min(energyLeft, LIGHTER_MORALE_CAP)
    const needTime = Math.max(0, LIGHTER_BURST_ENTRY - takeEnergy)
    const secondsNeeded = perSec > 0 ? needTime / perSec : Infinity
    if (secondsNeeded > timeLeft) break
    entries += 1
    timeGainUsed += needTime
    energyLeft -= takeEnergy
    // 喷发占用：不回时间气（原文），只能烧掉已攒的士气
    timeLeft = Math.max(0, timeLeft - secondsNeeded - burstBusy)
  }
  // 尾段：剩余时间继续攒气但不构成一轮
  const moraleGainTime = timeGainUsed + perSec * timeLeft
  const moraleGain = moraleGainTime + energyGainTotal
  return {
    moraleGain,
    moraleGainTime,
    moraleGainEnergy: energyGainTotal,
    burstEntries: entries,
    powerFinisherCount: entries,
  }
}
/** 五段四招的秒数表（buildCharConfig 从倍率表预存） */
export interface LighterBurstTimes {
  /** 快速支援 1161020（每轮起手） */
  quickAssist: number
  /** 连续冲拳 1161027 */
  jab: number
  /** 强化一击 1161025 */
  finisher: number
}

export interface LighterBurstPlan {
  /** 快速支援（1161020）次数 = 实际兑现的喷发轮数 */
  quickAssist: number
  /** 刺拳连击（1161027）次数：填满本轮平A池的余量 */
  jab: number
  /** 强力终结（1161025）次数 = 喷发轮数 */
  finisher: number
  /** 这些行合计占用的秒数（从平A池挤出） */
  usedTime: number
}

/**
 * 士气喷发循环排布：每轮 = 五段起攻 → 刺拳连击循环（耗尽士气）→ 强力终结。
 *
 * 口径来源（原文 data/raw/nanoka_missing/full/1161.json · skill.basic.description[0]）：
 * - 「第五段轻拳起攻期间…可以循环发动轻拳起攻和第四段[普通攻击]」⇒ 起手是**轻拳起攻**（1161026），
 *   之后是刺拳连击（1161027）循环；
 * - 「保持连点或长按时可以延长刺拳连击的持续时间」「刺拳连击至持续时间上限后…发动终结一击」
 *   ⇒ 刺拳次数由**时间**决定，不是固定段数；
 * - 「轻拳起攻或刺拳连击期间耗尽[士气]时，会自动衔接发动更加强力的终结一击」⇒ 收招固定是 1161025。
 *
 * **已建模**：每轮的原子骨架 = 五段起攻（1161026, 1.239s）+ 强力终结（1161025, 1.002s），
 * 次数 = 士气轮次，再被平A池钳制（每轮 2.241s，池装不下就少打——与凤凰 1431 planPhoenixBasic 同款
 * 「段是离散动作、不按比例折半段」）。
 * **连续冲拳（1161027）**：每轮固定 LIGHTER_BURST_JAB_COUNT = 2 段——用户视频实测 2026-10-26
 * 「80 士气打连续冲拳只兑现了 2 次，也就是 1.4 秒左右，然后就是终结一击耗时 1 秒」。
undefined
 * 轮数上限 = 士气轮次（computeLighterMorale.burstEntries），再被平A池时间钳制。
 */
/**
 * 士气喷发循环排布：每轮 = 快速支援(1161020) → 连续冲拳(1161027) ×N → 强化一击(1161025)。
 *
 * 依据：用户口径 2026-10-26「实战都是快支直接加冲拳，打完再来强化一击」；原文佐证
 * skill.assist.description[0] / [2]：快速支援与支援突击发动后都「可以直接衔接发动第五段[普通攻击]」，
 * 故起手是快支而不是五段起攻(1161026)——起攻那一支实战不走，不产行。
 *
 * 每轮是**原子组合**（缺任一段就不成一轮，不按比例折半段）：
 *   1161020 + 1161027 ×N + 1161025
 * 轮数上限 = 士气轮次（computeLighterMorale.burstEntries），再被平A池时间钳制。
 */
function planLighterBurst(input: {
  basicTime: number
  entries: number
  times: LighterBurstTimes
  /** 每轮连续冲拳段数（用户实测：80 士气 2 次） */
  jabPerRound?: number
}): LighterBurstPlan {
  const times = input.times
  const t = Math.max(0, Number(input.basicTime) || 0)
  const maxEntries = Math.max(0, Math.floor(Number(input.entries) || 0))
  const jabTime = Math.max(0, times.jab)
  const jabPerRound = Math.max(0, Math.floor(Number(input.jabPerRound) || 0))
  const empty: LighterBurstPlan = { quickAssist: 0, jab: 0, finisher: 0, usedTime: 0 }
  const unitPerRound = Math.max(0, times.quickAssist) + jabPerRound * jabTime + Math.max(0, times.finisher)
  if (unitPerRound <= 0 || t <= 0 || maxEntries <= 0) return empty
  const rounds = Math.min(maxEntries, Math.floor((t + 1e-9) / unitPerRound))
  if (rounds <= 0) return empty
  return {
    quickAssist: rounds,
    jab: rounds * jabPerRound,
    finisher: rounds,
    usedTime: rounds * unitPerRound,
  }
}
/** C6 火焰冲击倍率%（含冲击力超额） */
export function computeLighterFlameShockMultiplier(impact: number): number {
  const over = Math.max(0, Math.floor(Number(impact) || 0) - LIGHTER_IMPACT_SOFT_CAP)
  const extra = Math.min(LIGHTER_C6_FLAME_EXTRA_CAP, over * LIGHTER_C6_FLAME_PER_IMPACT)
  return LIGHTER_C6_FLAME_BASE + extra
}

/**
 * C6 火焰冲击次数：
 * - 常规：战斗时长 / 8s CD（用户：普攻可触发 → 次数远大于 CD，按 CD）
 * - 额外：每次耗尽士气的强力终结 +1（无视 CD）
 */
export function computeLighterFlameShockCount(combatTime: number, powerFinisherCount: number): number {
  const t = Math.max(0, Number(combatTime) || 0)
  const regular = Math.floor(t / LIGHTER_C6_FLAME_CD)
  const extra = Math.max(0, Math.floor(powerFinisherCount || 0))
  return regular + extra
}

/**
 * 全队普通能量消耗（强特次数 × 单次耗能）；命破/闪能用户不计入。
 * 在资源迭代收敛后由编排层写入 lighterTeamEnergyConsumed。
 */
export function estimateTeamNormalEnergyConsumed(
  characters: ReadonlyArray<Pick<CharacterOperationConfig, 'isFlashUser' | 'exSpecialEnergyConsume'>>,
  exCounts: readonly number[],
): number {
  let total = 0
  for (let i = 0; i < characters.length; i++) {
    const cfg = characters[i]
    if (!cfg || cfg.isFlashUser) continue
    const cost = Math.max(0, Number(cfg.exSpecialEnergyConsume) || 0)
    const count = Math.max(0, Number(exCounts[i]) || 0)
    total += cost * count
  }
  return total
}

function pushExec(
  executions: SkillExecution[],
  moveId: string,
  moveName: string,
  count: number,
  dmg: number,
  note: string,
  opts?: { dmgBonus?: number; category?: string },
) {
  if (count <= 0 || dmg <= 0) return
  executions.push(moduleExecRow({
    moveId,
    moveName,
    category: opts?.category ?? 'basic',
    count,
    ...RECOVERY_OFF,
    damageMultiplier: dmg,
    damageMultiplierOverride: true,
    element: 'fire',
    skillTableNote: note,
    ...(opts?.dmgBonus ? { dmgBonus: opts.dmgBonus } : {}),
  }))
}

function cfgNum(cfg: CharacterOperationConfig, key: keyof CharacterOperationConfig, fallback = 0): number {
  const raw = Number(cfg[key] ?? fallback)
  return Number.isFinite(raw) ? raw : fallback
}

function applyPanel({ cinemaLevel, panel }: AgentPanelInput): void {
  const cinema = cinemaLevelOf(cinemaLevel)
  // 喷发耗士气冲击力 +20%（默认吃满）
  const impactPct = computeLighterImpactBonusPct(cinema)
  panel.impact = panel.impact * (1 + impactPct / 100)

  // 溃败：失衡时长延长
  panel.stunDurationBonusSeconds =
    panel.stunDurationBonusSeconds + computeLighterRoutStunBonus(cinema)
}

function buildCharConfig({ cinemaLevel, cfg, panel, skills }: AgentCharConfigInput): void {
  const cinema = cinemaLevelOf(cinemaLevel)
  cfg.lighterCinemaLevel = cinema
  cfg.lighterImpact = panel.impact
  // 士气喷发循环三段的 actionTime 在 cfg 构建期预存：buildExecutions 入参没有 skills，
  // 单一事实源仍是倍率表（与琉音 liuyinFarewellActionTime / 希格莉德 sigridLanceSegments 同法）。
  const basicMoves = skills.categories.find(c => c.id === 'basic')?.moves ?? []
  const atOf = (moveId: string) => basicMoves.find(m => m.id === moveId)?.actionTime ?? 0
  cfg.lighterBurstJabActionTime = atOf(MOVE_BURST_JAB)
  cfg.lighterPowerFinisherActionTime = atOf(MOVE_POWER_FINISHER)
  // 快支在 assist 分类，不在 basic —— 单独找
  const assistMoves = skills.categories.find(c => c.id === 'assist')?.moves ?? []
  cfg.lighterQuickAssistActionTime = assistMoves.find(m => m.id === MOVE_QUICK_ASSIST)?.actionTime ?? 0
  if (cinema >= 6) {
    cfg.lighterFlameShockMult = computeLighterFlameShockMultiplier(panel.impact)
  }
}

function lighterMoraleOf(cfg: AgentResourceInput['cfg'], state: AgentResourceInput['state']): LighterMoraleResult {
  const cinema = cinemaLevelOf(cfg.lighterCinemaLevel)
  return computeLighterMorale({
    combatTime: effectiveCombatTime(state, cfg),
    teamEnergyConsumed: Math.max(0, Number(cfg.lighterTeamEnergyConsumed ?? 0)),
    cinemaLevel: cinema,
    // 每轮喷发占用 = 起攻 + 刺拳 ×2 + 强力终结（用户实测：80 士气打 2 次连续冲拳 ≈1.4s，再接 1s 终结）
    burstSecondsPerCycle: Math.max(0, Number(cfg.lighterQuickAssistActionTime ?? 0))
      + LIGHTER_BURST_JAB_COUNT * Math.max(0, Number(cfg.lighterBurstJabActionTime ?? 0))
      + Math.max(0, Number(cfg.lighterPowerFinisherActionTime ?? 0)),
  })
}

function buildExecutions({ cfg, state, executions }: AgentResourceInput): void {
  const cinema = cinemaLevelOf(cfg.lighterCinemaLevel)
  const combatTime = effectiveCombatTime(state, cfg)
  const morale = lighterMoraleOf(cfg, state)

  // ===== 士气喷发循环（用户口径 2026-10-26：「士气爆发肯定必须建模，这是莱特核心」）=====
  // 物化五段四招：起攻 1161026 / 刺拳连击 1161027 / 强力终结 1161025，占的**就是平A池那段时间**
  // （与朱鸢 1241 霰弹、艾莲 1191 循环行、凤凰 1431 a34 同款：carveBasicPool 等量挤出，时间守恒）。
  // 池上两种回能按剩余比例缩——模块行是真实 moveId，enrich 会按表回填 energy/decibel，不缩即双计。
  // 「不花时间打伤害 = 白嫖」（用户 2026-10-25）同样约束这里：行有真实 actionTime 才进折叠环。
  const burstTimes: LighterBurstTimes = {
    quickAssist: Math.max(0, Number(cfg.lighterQuickAssistActionTime ?? 0)),
    jab: Math.max(0, Number(cfg.lighterBurstJabActionTime ?? 0)),
    finisher: Math.max(0, Number(cfg.lighterPowerFinisherActionTime ?? 0)),
  }
  const basicPool = executions.find(e => e.moveId === 'basic_attack')
  const burstPlan = planLighterBurst({
    basicTime: basicPool?.totalTime ?? 0,
    entries: morale.powerFinisherCount,
    times: burstTimes,
    jabPerRound: LIGHTER_BURST_JAB_COUNT,
  })
  if (burstPlan.usedTime > 0) {
    const c1Bonus = cinema >= 1 ? LIGHTER_C1_FINISHER_DMG : 0
    const pushSeg = (moveId: string, moveName: string, count: number, actionTime: number, dmgBonus = 0, category = 'basic') => {
      if (count <= 0 || actionTime <= 0) return
      executions.push(moduleExecRow({
        moveId,
        moveName,
        category,
        count,
        actionTime,
        totalTime: count * actionTime,
        damageMultiplier: 0,
        damageMultiplierOverride: false,
        element: 'fire',
        skillTableNote: `士气喷发循环 ×${count}（${actionTime}s/次）` + (dmgBonus ? `（C1 伤害+${dmgBonus}%）` : ''),
        ...(dmgBonus ? { dmgBonus } : {}),
      }))
    }
    // 回能/喧响按表回填（与弹刀行同口径：行内表值 + `calcSpecialActionBonus` 的特殊动作奖励是两笔）。
    // ⚠ 原「已知缺口」已收口（2026-10-26）：特殊动作喧响里的快支 20/次通道随 `quickAssistCount` 字段
    // 整体删除（手动快支下线），机制快支不再是「走错了通道」——它就是普通招式，只结算行内表值
    // （17.435 喧响 + 2.28 能量/次），不存在「少算 9×20」这回事。
    pushSeg(MOVE_QUICK_ASSIST, '快速支援：烈闪-守（喷发循环起手）', burstPlan.quickAssist, burstTimes.quickAssist, 0, 'assist')
    // 刺拳连击吃 C1 的强力终结加伤？不吃——C1 只加「强力终结一击」本体，见下
    pushSeg(MOVE_BURST_JAB, '普通攻击：刺拳连击（士气喷发）', burstPlan.jab, burstTimes.jab)
    pushSeg(MOVE_POWER_FINISHER, '普通攻击：强力终结一击（士气喷发）', burstPlan.finisher, burstTimes.finisher, c1Bonus)
    // 占的秒数从平A池等量挤出；池上回能按剩余比例缩（行回填 + 池原额 = 双计）
    carveBasicPool(executions, burstPlan.usedTime, ['totalDecibelRecovery', 'totalEnergyRecovery'])
    cfg.lighterBurstRounds = burstPlan.quickAssist
    cfg.lighterBurstJabCount = burstPlan.jab
  }
  // C6 火焰冲击
  if (cinema >= 6) {
    const mult = Number(cfg.lighterFlameShockMult ?? 0)
      || computeLighterFlameShockMultiplier(Number(cfg.lighterImpact ?? 0))
    // ⚠ 用实际兑现的轮数（burstPlan.finisher）：士气够但平A池装不下时，轮数被时间钳制，
    // 火焰冲击的「耗尽士气终结额外 +1」也只能按真打出来的次数算（否则凭空多发）。
    const count = computeLighterFlameShockCount(combatTime, burstPlan.finisher)
    pushExec(
      executions,
      MOVE_FLAME_SHOCK,
      '影画6·火焰冲击',
      count,
      mult,
      `火焰冲击 ×${count}（${LIGHTER_C6_FLAME_CD}s CD ${Math.floor(combatTime / LIGHTER_C6_FLAME_CD)}`
        + ` + 耗尽士气终结 ${morale.powerFinisherCount}；倍率 ${fmt(mult)}%）`,
      { category: 'basic' },
    )
  }
}

function patchExecutions({ cfg, executions }: AgentResourceInput): void {
  const cinema = cinemaLevelOf(cfgNum(cfg, 'lighterCinemaLevel', 0))
  // ⚠ 平A聚合行**不归零**：喷发循环只吃掉池的一部分（每轮 2.241s），剩余时间仍是普通平A，
  // 按秒均 × 剩余时长结算才对。归零会凭空删掉这部分输出（实测误差 −7%，见提交说明）。
  // 与凤凰 1431「所有平A都落在 a3/a4」不同——莱特喷发外照常打普通平A。
  if (cinema < 1) return
  const bonus = LIGHTER_C1_FINISHER_DMG
  for (const exec of executions) {
    if (exec.moveId !== MOVE_POWER_FINISHER) continue
    const cur = Number(exec.dmgBonus ?? 0) || 0
    // buildExecutions 可能已加过，避免双加
    if (cur >= bonus) continue
    exec.dmgBonus = cur + bonus
  }
}

function buildResourceResult({ cfg, state }: AgentResourceResultInput): Partial<CharacterResourceResult> {
  const cinema = cinemaLevelOf(cfg.lighterCinemaLevel)
  const combatTime = effectiveCombatTime(state, cfg)
  const morale = lighterMoraleOf(cfg, state)
  // 火焰冲击额外次数按**实际打出**的喷发轮数（buildExecutions 写进 cfg），不是理论士气轮次
  const actualRounds = Math.max(0, Number(cfg.lighterBurstRounds ?? 0))
  const flameCount = cinema >= 6
    ? computeLighterFlameShockCount(combatTime, actualRounds)
    : 0
  return {
    lighterMorale: morale,
    lighterFlameShockCount: flameCount,
    specResources: {
      lighter_morale: {
        id: 'lighter_morale',
        name: '士气',
        initialValue: 0,
        maxValue: LIGHTER_MORALE_CAP,
        totalGain: morale.moraleGain,
        gains: {
          time: morale.moraleGainTime,
          energy: morale.moraleGainEnergy,
        },
        bonusCount: 0,
        total: morale.moraleGain,
        remaining: morale.moraleGain % LIGHTER_MORALE_CAP,
        spendCounts: {
          burst: morale.burstEntries,
          powerFinisher: morale.powerFinisherCount,
          flameShock: flameCount,
        },
        spendCosts: {},
      },
    },
  }
}

function resourceSections({ result }: AgentResourceSectionsInput) {
  const morale = result.lighterMorale
  if (!morale) return []
  const flame = Number(result.lighterFlameShockCount ?? 0) || 0
  return [{
    id: 'lighter-morale',
    title: '莱特·士气喷发',
    summary:
      `士气 ${fmt(morale.moraleGain, 0)} · 喷发 ${morale.burstEntries}`
      + (flame > 0 ? ` · 火焰冲击 ${flame}` : ''),
    rows: [
      {
        label: '士气获取',
        value: fmt(morale.moraleGain, 1),
        detail: `时间 ${fmt(morale.moraleGainTime, 1)} + 能量消耗 ${fmt(morale.moraleGainEnergy, 1)}（不含闪能）`,
      },
      {
        label: '喷发/强力终结',
        value: String(morale.powerFinisherCount),
        detail: `按每 ${LIGHTER_MORALE_CAP} 点士气一轮近似`,
      },
      ...(flame > 0
        ? [{
            label: '火焰冲击',
            value: String(flame),
            detail: `${LIGHTER_C6_FLAME_CD}s CD + 耗尽士气终结额外次数`,
          }]
        : []),
    ],
  }]
}

/**
 * C4 喷发回能：后场角色每次喷发 +4，18s CD（写落点 cfg 通用字段 crossAgentFlatEnergyBySource）。
 * 前场能量获得效率不在这里：见本模块 `teamPanelEffects`（直接读滑块 `lighter.backstageRatio`）。
 * r403：删除旧的 cfg 侧链路 build 写 `lighterBackstageRatio` → 本函数读 → 写队友 `lighterC4FrontEfficiency`（R20 迁到 teamPanelEffects 后全链零消费者）。
 */
function applyLighterTeamEnergyFlags(
  lighter: CharacterOperationConfig,
  characters: CharacterOperationConfig[],
  opts: { exCounts?: number[]; combatTime: number; teamEnergyConsumed?: number },
): void {
  const cinema = cinemaLevelOf(cfgNum(lighter, 'lighterCinemaLevel', 0))
  const combatTime = Math.max(0, opts.combatTime)
  const exCounts = opts.exCounts ?? characters.map(() => 0)
  const estimated = estimateTeamNormalEnergyConsumed(characters, exCounts)
  const teamEnergy = Math.max(
    0,
    Number(opts.teamEnergyConsumed ?? lighter.lighterTeamEnergyConsumed ?? estimated) || 0,
  )
  lighter.lighterTeamEnergyConsumed = teamEnergy

  if (cinema < 4) {
    for (const ch of characters) {
      ch.crossAgentFlatEnergyBySource = { ...(ch.crossAgentFlatEnergyBySource ?? {}), lighterC4Energy: 0 }
    }
    return
  }

  const bursts = computeLighterMorale({
    combatTime,
    teamEnergyConsumed: teamEnergy,
    cinemaLevel: cinema,
  }).burstEntries
  const capped = Math.min(bursts, Math.floor(combatTime / LIGHTER_C4_BURST_CD))
  const burstEnergy = capped * LIGHTER_C4_BURST_ENERGY
  for (const ch of characters) {
    if (ch.agentId === LIGHTER_ID) {
      ch.crossAgentFlatEnergyBySource = { ...(ch.crossAgentFlatEnergyBySource ?? {}), lighterC4Energy: 0 }
      continue
    }
    // 前场效率由本模块面板钩子按占比写 energyGainEfficiency（LIGHTER_C4_FRONT_EFFICIENCY）；此处仅写喷发定额回能。
    ch.crossAgentFlatEnergyBySource = { ...(ch.crossAgentFlatEnergyBySource ?? {}), lighterC4Energy: burstEnergy }
  }
}

/**
 * 莱特「下一轮全队普通能量消耗」反馈（`nextRoundFeedback` 钩子，2026-09-17 round 20 C-β
 * 自 `convergence.ts` 迁入）。返回线程值 `consumedTeamEnergy` → 下一轮 `converge` 相位由本模块
 * 的 `applyTeamConfig` 读回（`(threads.moduleFeedback?.consumedTeamEnergy ?? 0)` → `cfg.lighterTeamEnergyConsumed`）。
 *
 * **逐位等价论证**（原编排层式子：`if (characters.some(c => c.agentId === '1161'))
 * lighterTeamEnergyNext = estimateTeamNormalEnergyConsumed(characters, exCounts)`）：
 * ① **守卫**：`collectNextRoundFeedback` 按槽位**只对在队模块**派发 ⇒ 钩子被调到 ⟺ 队里有 1161
 *    （等价于原 `some`）；不在队 ⇒ 返回值缺席 ⇒ 编排层 `?? 0`（等价于原 `let … = 0`）。
 * ② **入参**：原式两个实参原样搬入 —— `characters` 是派发器直递的**同一个** cfg 数组
 *    （本钩子的入参，非压缩下标反查），`exCounts` 仍按**身份**建 Map 再按 `characters` 顺序取
 *    （逐位保留原式的 `Math.max(0, … ?? 0)` 与 agentId 查找口径，不改成按下标取）。
 * ③ **时机**：原式在 `collectNextRoundFeedback`（派发点）之后、`applyTeamMechanics(postRound)`
 *    之前读 cfg；本钩子就在派发点**内部**读同一份 —— 两处之间没有任何写 `exSpecialEnergyConsume`
 *    / `isFlashUser` 的代码（postRound 相位在两者之后），且收敛相位的写入早于本轮结果装配
 *    ⇒ 读到的 cfg 状态逐位一致。
 * ④ **同一个函数**：估计式仍是本模块导出的 `estimateTeamNormalEnergyConsumed`（规则 11 单一事实源）。
 *
 * ⚠ **本钩子与 `applyTeamConfig({phase:'postRound'})` 那份调用不是同一通道的重复实现**：
 * 那一份写**同一轮 cfg** 快照（`lighterTeamEnergyConsumed`），本钩子产**跨轮线程值**
 * （`threadsNext.consumedTeamEnergy` → 下一轮 converge 读回）。实测两处**都必须在**——删掉本钩子
 * ⇒ 线程恒 0（下一轮 C4 喷发回能归零）；删掉 postRound 那份 ⇒ 同轮 cfg 快照缺值。
 * （登记：postRound 写的 `lighterTeamEnergyConsumed` 在本轮内**无读点**——`buildExecutions` /
 * `buildResourceResult` 都早于 postRound，而下一轮 converge 会用线程值覆盖它 ⇒ 该写当前是
 * 死写。是否删除属独立决策，本批不动它，只留痕。）
 */
function lighterNextRoundFeedback({ characters, teamResult }: AgentNextRoundFeedbackInput): ModuleFeedback {
  // 本槽 = 莱特自己那份结果行；`teamResult.characters` 与 `characters` 同序但**只许按身份查**
  // （按位置压缩，槽位号 ≠ 下标）。
  if (!teamResult.characters.some(c => c.agentId === LIGHTER_ID)) return { consumedTeamEnergy: 0 }
  const exByAgent = new Map(teamResult.characters.map(ch => [ch.agentId, ch.exSpecialCount]))
  const exCounts = characters.map(c => Math.max(0, exByAgent.get(c.agentId) ?? 0))
  return { consumedTeamEnergy: estimateTeamNormalEnergyConsumed(characters, exCounts) }
}

export const lighterMechanic: AgentMechanicModule = {
  crossAgentEnergyLabels: [{ key: 'lighterC4Energy', label: '莱特影画4 喷发', detail: `后场 +${LIGHTER_C4_BURST_ENERGY}/次 × ${LIGHTER_C4_BURST_CD}s 冷却` }],  // CC-445
  // CC-35c-B：昂扬公式读局内冲击力；喷发耗士气冲击 +20% 需并入来源面板，否则公式少算一层（原 panelPhases 按 '1161' 写死，逐字迁入）
  adjustTeammateBuffSource: ({ source }) => {
    if (source.inCombat) {
      source.inCombat = {
        ...source.inCombat,
        impact: source.inCombat.impact * 1.2,
      }
    }
  },
  id: 'agent:lighter',
  agentIds: [LIGHTER_ID],
  name: '莱特·士气喷发',
  description: '士气循环、溃败失衡延长、昂扬冰火伤、影画1/2/4/6。',
  settings: [{
    id: 'lighter.backstageRatio',
    label: '莱特后场时间占比',
    description: '影画4「后场时前场回能效率+10%」的覆盖率；默认 2/3。',
    default: 2 / 3,
    min: 0,
    max: 1,
    step: 0.05,
  }],
  /**
   * 队伍级机制（原先 useResourceCalc 手工 import 并在**三处**调用
   * `applyLighterTeamEnergyFlags`——漏掉任一处就是静默错值；后场占比也在编排层内联写 cfg）。
   * 三个阶段对应迁移前的三个调用点，语义逐一保持：
   * - build：用 exCounts=0 预置标记；
   * - converge：用**上一轮**全队能量消耗重算喷发回能；
   * - postRound：用本轮收敛的 exCounts 估出全队能量消耗，供下一轮使用。
   */
  applyTeamConfig: ({ cfg: lighter, characters, phase, combatTime, exCounts, teamEnergyConsumed, threads }) => {
    // （CC-383：本人 = 派发器给的 `cfg`；派发器只对在队模块、按 cfg.agentId 取模块调用，不再在 characters 里自找）
    if (phase === 'build') {
      applyLighterTeamEnergyFlags(lighter, characters, { exCounts: characters.map(() => 0), combatTime })
      return
    }
    if (phase === 'converge') {
      applyLighterTeamEnergyFlags(lighter, characters, {
        combatTime,
        teamEnergyConsumed: Math.max(0, teamEnergyConsumed || 0),
      })
      // 2026-09-15 arch 棘轮第 2 批：本槽的「上一轮全队能量消耗」线程值写进 cfg（莱特 C4 消费）。
      // 自 `convergence.ts` 原 `merged.agentId === '1161'` 分支搬入（规则 6）；地板语义逐位保留。
      if (threads) {
        lighter.lighterTeamEnergyConsumed = Math.max(0, (threads.moduleFeedback.consumedTeamEnergy ?? 0) || 0)
      }
      return
    }
    // postRound：本轮次数已知 → 估下一轮全队普通能量消耗
    applyLighterTeamEnergyFlags(lighter, characters, {
      exCounts,
      combatTime,
      teamEnergyConsumed: estimateTeamNormalEnergyConsumed(characters, exCounts),
    })
  },
  applyPanel,
  /**
   * 莱特影画4：莱特位于后场时，**前场队友**能量获得效率 +10%（按后场时间占比折算；**莱特本人不吃**）。
   *
   * 2026-09-17 round 20 R20-h3 自 `helpers.ts#computePanelPhases` 的
   * `if (agent.id === '1161')` 跨槽硬编码块迁入（规则 6）。语义逐位保留：
   * 门控「目标槽 ≠ 莱特」+ 命座 ≥4 + 滑块 `lighter.backstageRatio`（默认 2/3）折算。
   *
   * ⚠ 这是**队伍级**效果（加成随目标槽不同而不同）⇒ 只能写在本钩子，不能进自己的 `applyPanel`
   * （那只会加到莱特本人面板上）。契约见 `AgentTeamPanelEffectInput`。
   */
  teamPanelEffects: ({ cinemaLevel, targetAgent, panel, settings, report }: AgentTeamPanelEffectInput) => {
    if (targetAgent.id === LIGHTER_ID) return // 莱特本人不吃
    if (cinemaLevelOf(cinemaLevel) < 4) return
    const ratio = Math.max(0, Math.min(1, settingOf(settings, 'lighter.backstageRatio')))
    const bonus = LIGHTER_C4_FRONT_EFFICIENCY * ratio
    panel.energyGainEfficiency = panel.energyGainEfficiency + bonus
    // 结构化记账（2026-10-20）：写入与上报共用同一份结果
    report?.({ stat: 'energyGainEfficiency', value: bonus, mode: 'flat' })
  },
  buildCharConfig,
  buildExecutions,
  patchExecutions,
  buildResourceResult,
  resourceSections,
  nextRoundFeedback: lighterNextRoundFeedback,
}


/**
 * D2（CC-359）：本模块私有的 cfg 字段——只有本文件读写，声明随模块走，不再堆在 `types/resource/config.ts`。
 * 仍是 `CharacterOperationConfig` 的成员（模块扩充，纯类型、零运行时）；被第二处引用时请迁回公共接口。
 */
/**
 * r406：本模块 `buildResourceResult` 写、`resourceSections` 等读的结果字段（模块扩充，纯类型、零运行时）。
 * 此前未声明 ⇒ 写端无类型、读端 `as any`，拼错键两头都不报错。
 */
declare module '@/types/resource/agentResources' {
  interface CharacterResourceResult {
    /** 莱特士气循环明细 */
    lighterMorale?: LighterMoraleResult
    /** 莱特火焰冲击次数 */
    lighterFlameShockCount?: number
  }
}

declare module '@/types/resource/config' {
  interface CharacterOperationConfig {
    /** 莱特冲击力：buildCharConfig 从面板 impact 写入 */
    lighterImpact?: number
    /** 6 命烈焰冲击倍率：按冲击力算，buildCharConfig 仅 6 命写入 */
    lighterFlameShockMult?: number
    /** 莱特：全队普通能量消耗（士气能量来源；编排注入，不含闪能） */
    lighterTeamEnergyConsumed?: number
    /** 莱特影画等级（模块缓存） */
    lighterCinemaLevel?: number
    /** 快速支援（1161020）actionTime（buildCharConfig 从倍率表预存；快支在 assist 分类） */
    lighterQuickAssistActionTime?: number
    /** 刺拳连击（1161027）actionTime（同上） */
    lighterBurstJabActionTime?: number
    /** 强力终结（1161025）actionTime（同上） */
    lighterPowerFinisherActionTime?: number
    /** 本轮实际兑现的喷发轮数（buildExecutions 写入，buildResourceResult 读） */
    lighterBurstRounds?: number
    /** 本轮刺拳连击段数（同上） */
    lighterBurstJabCount?: number
  }
}
