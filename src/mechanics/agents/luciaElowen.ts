import type { AgentMechanicModule, AgentCharConfigInput, AgentPanelInput, AgentResourceInput, AgentResourceResultInput, AgentResourceSectionsInput } from '../types'
import type { CharacterResourceResult, MechanicSetting, SkillExecution } from '@/types/resource'
import type { LuciaMechanicSource } from '@/types/resource'
import type { SkillMove } from '@/types/catalog'
import { fmt } from '@/utils/format'
import { countFrontActions, effectiveBackstageTime, effectiveBattleTime, frontBlockSeconds, phaseDelayedCooldown } from '@/core/effectiveTime'
import { getAgentSpec } from '@/specs/registry'
import { applySpecAttributeConversions } from '@/specs/runtime'

/**
 * 卢西娅·艾洛温（1451）战斗逻辑（用户确认口径）：
 * - 帷幕延长按全覆盖，不单独建模。
 * - 快支有单独输入，梦境值不依赖快支。
 * - 追加攻击默认 20 次；全局只需约 500 梦境值覆盖。队友命中触发、CD 8s 全球性（180s/8s≈22 次），
 *   不受失衡轴窗口限制——按 CD 全局消耗接近 500 梦境值不难（用户口径 2026-08，废除「轴模式按轴内时间折算」）。
 *   次数同时受 CD 封顶 = floor(有效战斗时间/8)（有效战斗时间 = 战斗时间 − boss 无敌，core/effectiveTime.ts）：
 *   无敌期间队友命中不了 boss、追击也不结算。
 * - 梦境值：开局白送 60；场地外 A5 +40；战斗中 E(+60)+A5(+40)；Q +100。
 * - 默认 Q=2 时：A5×3、E×2、Q×2 → 60+120+120+200=500。
 *   Q 不足就多打一组 E+A5；Q 多了就少打一组 E+A5。
 * - 计划外强特直接合轴，耗时 0 秒。
 * - 强特后衔接第五段普攻按梦境值计划驱动（不是每下都打）；梦境内/外不区分。
 * - [合唱]最后一段：按最大生命值 (34% + 3%×终结技等级) 附加固定伤害（乘区前），全部[合唱]行整行近似。
 * - 4命：帷幕开启/延长（含伊德海莉大招开帷幕）→ 全队每人 +100 喧响，15s CD 封顶 × 利用率滑块。
 * - 6命：初始最大生命值 2% → 攻击力；[合唱]必定暴击 + 暴击伤害 +30%。
 */

const LUCIA_AGENT_ID = '1451'
const A5_MOVE_ID = '1451005' // 普通攻击：星轨连击 #5（随想）
const ADDITIONAL_ATTACK_MOVE_ID = '1451007' // 追加攻击（合唱，1100%/200异常/0失衡）
const DREAM_TARGET = 500
const INITIAL_DREAM = 60
const A5_DREAM_GAIN = 40
const EX_DREAM_GAIN = 60
const ULTIMATE_DREAM_GAIN = 100
const ADDITIONAL_ATTACK_DREAM_COST = 25
const DEFAULT_ADDITIONAL_ATTACK_COUNT = 20 // ≈ 500 梦境值 ÷ 25/次；CD 8s × 180s ≈ 22 次 > 20，梦境值才是瓶颈
const ADDITIONAL_ATTACK_CD_SECONDS = 8 // 追加攻击触发 CD；次数封顶 = floor(有效后台时间/等效CD)
const DEFAULT_FRONT_SWITCH_RATIO = 1 // 切上前台频率滑块默认（实测支援位 p≈0.09、全档封顶 20 不挤压默认次数）
const HEAL_SECONDS = 8 // 星光汇聚之地持续 8 秒
const HEAL_RATE_PCT_BASE = 1 // 每秒回血 = 1% + 0.05%×终结技等级（爬取公式 0.01+AvatarSkillLevel(3)*0.0005）
const HEAL_RATE_PCT_PER_LEVEL = 0.05
const DEFAULT_HEALING_COVERAGE = 0.5 // 队友不一定全程站在回血圈内
const CURTAIN_CD_SECONDS = 15 // 4命触发 15s CD

export interface LuciaDreamPlan {
  dreamExSpecialCount: number
  excessExSpecialCount: number
  a5Count: number
  dreamTotal: number
  additionalAttackCount: number
  additionalAttackDreamCost: number
}

/** 按用户口径计算梦境值计划：Q 与总 E 已知，求需要打几个 E/A5 达到 500 梦境值 */
export function computeLuciaDreamPlan(totalExSpecialCount: number, ultimateCount: number, additionalAttackCap: number): LuciaDreamPlan {
  const totalE = Math.max(0, Math.floor(totalExSpecialCount))
  const q = Math.max(0, Math.floor(ultimateCount))

  // 基础需求：Q=2 时 E=2、A5=3；Q 每少 1 多一组 E+A5，Q 每多 1 少一组 E+A5。
  // 即 dreamE = clamp(4 - Q, 0, totalE)，A5 补足 500 目标。
  const dreamE = Math.min(totalE, Math.max(0, 4 - q))
  const baseDream = INITIAL_DREAM + EX_DREAM_GAIN * dreamE + ULTIMATE_DREAM_GAIN * q
  const needFromA5 = Math.max(0, DREAM_TARGET - baseDream)
  const a5Count = Math.ceil(needFromA5 / A5_DREAM_GAIN)
  const dreamTotal = INITIAL_DREAM + A5_DREAM_GAIN * a5Count + EX_DREAM_GAIN * dreamE + ULTIMATE_DREAM_GAIN * q

  const additionalAttackCount = Math.min(Math.max(0, Math.floor(additionalAttackCap)), Math.floor(dreamTotal / ADDITIONAL_ATTACK_DREAM_COST))
  return {
    dreamExSpecialCount: dreamE,
    excessExSpecialCount: Math.max(0, totalE - dreamE),
    a5Count,
    dreamTotal,
    additionalAttackCount,
    additionalAttackDreamCost: additionalAttackCount * ADDITIONAL_ATTACK_DREAM_COST,
  }
}

/**
 * 4命「深夜时间」帷幕开启/延长触发次数（用户确认口径）：
 * - 开启 = 开局入梦 1 + 战中 E+A5 组入梦 1（有梦境内强特时）+ Q 退出再入梦 ×Q
 * - 延长 = 梦境内强特 ×dreamE + 梦境内终结技 ×Q
 * - 队友开帷幕（如伊德海莉终结技）每次 +1
 * - 15s CD 封顶 ceil(战斗时间/15)，再乘利用率滑块（帷幕连着放卡 CD 时调低）
 */
export function computeLuciaCurtainTriggers(
  exSpecialCount: number,
  ultimateCount: number,
  teammateCurtainCount = 0,
  coverage = 1,
  totalTime = 180,
): number {
  const q = Math.max(0, Math.floor(ultimateCount))
  const totalE = Math.max(0, Math.floor(exSpecialCount))
  const dreamE = Math.min(totalE, Math.max(0, 4 - q))
  const opens = 1 + (dreamE > 0 ? 1 : 0) + q
  const extendsCount = dreamE + q
  const raw = opens + extendsCount + Math.max(0, Math.floor(teammateCurtainCount))
  const cap = Math.max(1, Math.ceil(Math.max(0, totalTime) / CURTAIN_CD_SECONDS))
  return Math.min(cap, raw) * Math.max(0, Math.min(1, coverage))
}

/** 星光汇聚之地每次终结技回血量（%卢西娅最大生命）= 8s × (1% + 0.05%×终结技等级)/秒；12级=12.8% */
export function computeLuciaHealPctPerUlt(skillLevelBonus = 0): number {
  const ultLevel = 12 + Math.max(0, Math.floor(skillLevelBonus))
  return HEAL_SECONDS * (HEAL_RATE_PCT_BASE + HEAL_RATE_PCT_PER_LEVEL * ultLevel)
}

function findMoveById(skills: { categories: { moves: SkillMove[] }[] } | undefined, moveId: string): SkillMove | null {
  if (!skills) return null
  for (const cat of skills.categories) {
    for (const m of cat.moves) {
      if (m.id === moveId) return m
    }
  }
  return null
}

function buildLuciaCharConfig({ skills, cinemaLevel, cfg }: AgentCharConfigInput): void {
  cfg.skipGenericExSpecial = true // 强特由本模块生成：计划内接 A5，计划外合轴 0 秒
  cfg.exSpecialCountFloor = true // 强特次数取整
  cfg.timeWeight = 0 // 卢西娅不打通用平A，只打计划内 A5（由本模块生成）
  const record = cfg as unknown as Record<string, unknown>
  record.luciaCinemaLevel = cinemaLevel
  const a5Move = findMoveById(skills, A5_MOVE_ID)
  cfg.luciaA5ActionTime = a5Move?.actionTime ?? 1.887
}

function applyLuciaPanel({ panel, cinemaLevel }: AgentPanelInput): void {
  // 影画6·永不结束的旅途：处于任意[以太帷幕]内时，按初始最大生命值（局外生命）的2%提升自身攻击力。
  // 面板为局内生命（含涌泉+5%），局外/局内差异约5%，近似接受。
  if (cinemaLevel >= 6) {
    applySpecAttributeConversions(panel, getAgentSpec(LUCIA_AGENT_ID)?.attributeConversions ?? [])
  }
}

/** 给单条[合唱]执行补专属字段（最后一段固定附加伤害 / 影画2增伤 / 影画6必暴暴伤） */
function applyChorusBonuses(exec: SkillExecution, cinemaLevel: number, panel: { hp?: number; skillLevelBonus?: number }): void {
  // 强化特殊技：[合唱]造成伤害时，最后一段按最大生命值 (34% + 3%×终结技等级) 附加固定伤害（乘区前）。
  // 简化：全部[合唱]行整行近似（追加攻击为单段，几乎就是整段）。
  const ultLevel = 12 + Math.max(0, panel.skillLevelBonus ?? 0)
  exec.flatDamageBonus = (exec.flatDamageBonus ?? 0) + (panel.hp ?? 0) * ((34 + 3 * ultLevel) / 100)
  // 影画2·魔术大师：处于[以太帷幕·涌泉]内时[合唱]伤害 +15%（增伤区；帷幕默认全覆盖）
  if (cinemaLevel >= 2) {
    exec.dmgBonus = (exec.dmgBonus ?? 0) + 15
  }
  // 影画6·永不结束的旅途：[合唱]必定暴击、暴击时暴击伤害 +30%
  if (cinemaLevel >= 6) {
    exec.critRateBonus = (exec.critRateBonus ?? 0) + 100
    exec.critDmgBonus = (exec.critDmgBonus ?? 0) + 30
  }
}

/** 执行计划完全构建后：给全部[合唱]行（强特/追加攻击/连携/终结技/支援突击）补专属字段；随想行（A5/闪反/快支）不补 */
function patchLuciaExecutions({ cfg, executions }: AgentResourceInput): void {
  const record = cfg as unknown as Record<string, unknown>
  const cinemaLevel = Math.max(0, Math.floor(Number(record.luciaCinemaLevel ?? 0)))
  const panel = cfg.panel
  if (!panel) return
  const chorusMoveIds = new Set([
    ADDITIONAL_ATTACK_MOVE_ID,
    cfg.exSpecialMoveId,
    cfg.ultimateMoveId,
    cfg.chainMoveId,
    cfg.assistFollowUpMoveId,
  ].filter(Boolean) as string[])
  for (const exec of executions) {
    if (exec.moveId && chorusMoveIds.has(exec.moveId)) {
      applyChorusBonuses(exec, cinemaLevel, panel)
    }
  }
}

function buildLuciaExecutions({ cfg, state, executions }: AgentResourceInput): void {
  // cap 依赖本轮 state/executions（相位延后修正），写入 cfg 供 buildResourceResult 同口径复用（防账本与行不一致）
  const cap = additionalAttackCapOf(
    cfg,
    state,
    countFrontActions(executions, { fusedMoveIds: [cfg.assistFollowUpMoveId] }),
  )
  ;(cfg as unknown as Record<string, unknown>).luciaAdditionalAttackCap = cap
  const plan = computeLuciaDreamPlan(
    state.exSpecialCount,
    state.ultimateCount,
    cap,
  )

  const a5Time = cfg.luciaA5ActionTime ?? 1.887
  const exTime = cfg.exSpecialActionTime

  // A5：开局场地外 1 次（随想），其余为战斗中 E 后衔接；这里统一用随想 1451005（合唱升级未单独拆分，用户确认）
  if (plan.a5Count > 0) {
    executions.push({
      moveId: A5_MOVE_ID,
      moveName: '普通攻击：星轨连击 #5（随想·A5）',
      category: 'basic',
      count: plan.a5Count,
      actionTime: a5Time,
      comboAlignRatio: 0,
      totalTime: plan.a5Count * a5Time,
      totalComboAlignTime: 0,
      energyConsume: 0,
      totalEnergyConsume: 0,
      decibelRecovery: 0,
      totalDecibelRecovery: 0,
      energyRecovery: 0,
      totalEnergyRecovery: 0,
      skillTableNote: '卢西娅必要时间：A5（随想）×' + plan.a5Count,
    })
  }

  // 计划内强特：接 A5，占用前台时间
  if (plan.dreamExSpecialCount > 0) {
    executions.push({
      moveId: cfg.exSpecialMoveId,
      moveName: '强化特殊技：死神协奏曲·破晓（接A5）',
      category: 'special',
      count: plan.dreamExSpecialCount,
      actionTime: exTime,
      comboAlignRatio: 0,
      totalTime: plan.dreamExSpecialCount * exTime,
      totalComboAlignTime: 0,
      energyConsume: 0,
      totalEnergyConsume: 0,
      decibelRecovery: 0,
      totalDecibelRecovery: 0,
      energyRecovery: 0,
      totalEnergyRecovery: 0,
      skillTableNote: '卢西娅必要时间：强特（接A5）×' + plan.dreamExSpecialCount,
    })
  }

  // 计划外强特：直接合轴，耗时 0 秒
  if (plan.excessExSpecialCount > 0) {
    executions.push({
      moveId: cfg.exSpecialMoveId,
      moveName: '强化特殊技：死神协奏曲·破晓（合轴）',
      category: 'special',
      count: plan.excessExSpecialCount,
      actionTime: exTime,
      comboAlignRatio: 1,
      totalTime: plan.excessExSpecialCount * exTime,
      totalComboAlignTime: plan.excessExSpecialCount * exTime,
      energyConsume: 0,
      totalEnergyConsume: 0,
      decibelRecovery: 0,
      totalDecibelRecovery: 0,
      energyRecovery: 0,
      totalEnergyRecovery: 0,
      skillTableNote: '卢西娅计划外强特：合轴 0 秒',
    })
  }

  // 追加攻击（合唱）：默认 20 次（180s / 9s），由队友命中触发，不占卢西娅前台时间
  if (plan.additionalAttackCount > 0) {
    executions.push({
      moveId: ADDITIONAL_ATTACK_MOVE_ID,
      moveName: '追加攻击（合唱）',
      category: 'special',
      count: plan.additionalAttackCount,
      actionTime: 0,
      comboAlignRatio: 0,
      totalTime: 0,
      totalComboAlignTime: 0,
      energyConsume: 0,
      totalEnergyConsume: 0,
      decibelRecovery: 0,
      totalDecibelRecovery: 0,
      energyRecovery: 0,
      totalEnergyRecovery: 0,
      skillTableNote: '追加攻击 1100%/200异常（默认20次，CD 8s 队友命中触发，不受失衡轴窗口限制；次数按有效战斗时间/8 封顶，无敌期间不结算）',
    })
  }
}

function computeLuciaSource(
  cfg: Record<string, unknown>,
  state: { exSpecialCount: number; ultimateCount: number },
  additionalAttackCap: number,
  healingCoverage: number,
): LuciaMechanicSource {
  const plan = computeLuciaDreamPlan(state.exSpecialCount, state.ultimateCount, additionalAttackCap)
  const q = Math.max(0, Math.floor(state.ultimateCount))
  const panel = cfg.panel as { skillLevelBonus?: number } | undefined
  const healPctPerUlt = computeLuciaHealPctPerUlt(panel?.skillLevelBonus ?? 0)
  const curtainTriggerCount = Number.isFinite(Number(cfg.luciaCurtainTriggerCount))
    ? Math.max(0, Number(cfg.luciaCurtainTriggerCount))
    : computeLuciaCurtainTriggers(state.exSpecialCount, state.ultimateCount, 0)
  const c4PerTrigger = Math.max(0, Number(cfg.luciaC4DecibelPerTrigger ?? 0))
  return {
    dreamTarget: DREAM_TARGET,
    dreamExSpecialCount: plan.dreamExSpecialCount,
    excessExSpecialCount: plan.excessExSpecialCount,
    a5Count: plan.a5Count,
    ultimateCount: q,
    dreamTotal: plan.dreamTotal,
    additionalAttackCount: plan.additionalAttackCount,
    additionalAttackDreamCost: plan.additionalAttackDreamCost,
    healPctPerUlt,
    healTotalHpPct: q * healPctPerUlt * Math.max(0, Math.min(1, healingCoverage)),
    curtainTriggerCount,
    c4DecibelPerTrigger: c4PerTrigger,
    c4TeamDecibelPerChar: curtainTriggerCount * c4PerTrigger,
    note: '追加攻击默认20次（CD 8s 全球性、队友命中触发，不受失衡轴窗口限制；按有效战斗时间/8 封顶，无敌期间不结算）；计划外强特合轴0秒；回血按终结技等级公式（12级12.8%/大）×覆盖滑块折算；4命帷幕触发次数含15s CD封顶。',
  }
}

function buildLuciaResourceResult({ cfg, state }: AgentResourceResultInput): Partial<CharacterResourceResult> {
  const record = cfg as unknown as Record<string, unknown>
  // cap 与 buildExecutions 同口径：优先读本轮缓存（含相位延后修正），未跑过 executions 时现算（count 缺省回退块长≈CD）
  const cap = Number.isFinite(Number(record.luciaAdditionalAttackCap))
    ? Math.max(0, Math.floor(Number(record.luciaAdditionalAttackCap)))
    : additionalAttackCapOf(cfg, state)
  return {
    luciaMechanicSource: computeLuciaSource(
      cfg as unknown as Record<string, unknown>,
      state,
      cap,
      cfgNum(cfg, 'lucia.healingCoverage', DEFAULT_HEALING_COVERAGE),
    ),
  }
}

function buildLuciaResourceSections({ result }: AgentResourceSectionsInput) {
  const source = result.luciaMechanicSource
  if (!source) return []
  const rows = [
    { label: '获取', value: String(source.dreamTotal), detail: `初始60 + A5×${source.a5Count} + E×${source.dreamExSpecialCount} + Q×${source.ultimateCount}` },
    { label: '消耗', value: String(source.additionalAttackDreamCost), detail: `追加攻击 ${source.additionalAttackCount} 次 × 25` },
    { label: '队友回血（星光汇聚之地）', value: `${fmt(source.healTotalHpPct)}% 卢西娅最大生命`, detail: `终结技${source.ultimateCount}次 × ${fmt(source.healPctPerUlt)}%/大 × 覆盖滑块（12级 12.8%/大）` },
  ]
  if (source.c4DecibelPerTrigger > 0) {
    rows.push({
      label: '4命·帷幕触发',
      value: `${fmt(source.curtainTriggerCount)} 次`,
      detail: `每次开启/延长全队每人 +${fmt(source.c4DecibelPerTrigger)} 喧响 = 每人 +${fmt(source.c4TeamDecibelPerChar)}（含伊德海莉大招开帷幕，15s CD 封顶）`,
    })
  }
  return [
    {
      id: 'lucia-dream-plan',
      title: '卢西娅·梦境值计划（500点）',
      summary: `梦境值 ${fmt(source.dreamTotal)} · 追加攻击 ${source.additionalAttackCount} 次 · 计划内强特 ${source.dreamExSpecialCount} 次 · 合轴强特 ${source.excessExSpecialCount} 次`,
      rows,
      footer: '计划外强特直接合轴耗时0秒；A5为随想1451005（合唱升级未单独拆分）；[合唱]行已按最大生命值附加最后一段固定伤害，2命+15%增伤，6命必暴+暴伤30%。',
    },
  ]
}

function cfgNum(cfg: AgentCharConfigInput['cfg'], key: string, fallback: number): number {
  const record = cfg as unknown as Record<string, unknown>
  const raw = Number(record[`setting:${key}`] ?? fallback)
  return Number.isFinite(raw) ? raw : fallback
}

/**
 * 追加攻击次数上限 = min(滑块/默认, CD 封顶)。
 * CD 封顶（2026-08-30 相位延后口径，core/effectiveTime.ts）= floor(有效后台时间 / 等效CD)：
 * 等效CD = 8s + 前台占比×前台块长/2——卢西娅本人被换上前台做动作（A5/强特/终结/合轴）时，
 * 队友命中触发的追击同样会被她自己的前台块延后；无敌期间不结算。
 * state 缺失（estimate/无收敛信息）时回退 有效战斗时间/CD 的旧口径。
 */
function additionalAttackCapOf(
  cfg: AgentCharConfigInput['cfg'],
  state?: { backstageTime?: number; frontlineTime?: number },
  frontActionCount?: number,
): number {
  const slider = cfgNum(cfg, 'lucia.additionalAttackCount', DEFAULT_ADDITIONAL_ATTACK_COUNT)
  const w = effectiveBattleTime(cfg)
  if (!state || typeof state.backstageTime !== 'number') {
    return Math.min(slider, Math.floor(w / ADDITIONAL_ATTACK_CD_SECONDS))
  }
  const f = Math.max(0, state.frontlineTime ?? 0)
  const b = effectiveBackstageTime(state.backstageTime, cfg)
  const block = frontBlockSeconds(
    f,
    frontActionCount,
    cfgNum(cfg, 'lucia.frontSwitchRatio', DEFAULT_FRONT_SWITCH_RATIO),
    ADDITIONAL_ATTACK_CD_SECONDS,
  )
  const cd = phaseDelayedCooldown(ADDITIONAL_ATTACK_CD_SECONDS, f, w, block)
  return Math.min(slider, Math.floor(b / cd))
}

const settings: MechanicSetting[] = [
  {
    id: 'lucia.additionalAttackCount',
    label: '卢西娅·追加攻击次数',
    description: '全局追加攻击（合唱）次数；默认 20 次（≈500 梦境值 ÷ 25/次，CD 8s 队友命中触发、不限失衡窗口；受相位延后 CD 封顶 = 有效后台时间/等效CD）。',
    default: DEFAULT_ADDITIONAL_ATTACK_COUNT,
    min: 0,
    max: 40,
    step: 1,
    suffix: '次',
  },
  {
    id: 'lucia.frontSwitchRatio',
    label: '卢西娅·切上前台频率',
    description: '切上前台次数 / 前台动作次数（2026-08-31 相位延后口径）。100% = 每次切上只做一个动作；0 = 一次切上做完全部前台。实测支援位（0 交互）前台占比 ~9%，滑块 0.2~1.0 全档 CD 封顶均为 20 次、不挤压默认次数，默认 1.0。',
    default: DEFAULT_FRONT_SWITCH_RATIO,
    min: 0,
    max: 1,
    step: 0.05,
  },
  {
    id: 'lucia.healingCoverage',
    label: '卢西娅·队友回血覆盖率',
    description: '队友站在星光汇聚之地内吃到回血的时间占比；默认 50%，可按实战站位调整。回血按终结技等级公式换算成伊德海莉生命%接入烧血→喧响（伊德海莉在队时）。',
    default: DEFAULT_HEALING_COVERAGE,
    min: 0,
    max: 1,
    step: 0.05,
    suffix: '%',
  },
  {
    id: 'lucia.c4CurtainCoverage',
    label: '卢西娅·4命帷幕触发利用率',
    description: '帷幕开启/延长事件的触发利用率；默认 100%，帷幕连着放卡15s CD 时按实战调低。',
    default: 1,
    min: 0,
    max: 1,
    step: 0.05,
    suffix: '%',
  },
]

export const luciaElowenMechanic: AgentMechanicModule = {
  id: 'agent:lucia_elowen',
  agentIds: ['1451'],
  name: '卢西娅·艾洛温',
  description: '梦境值计划（500点→20次追加攻击）、计划外强特合轴0秒、[合唱]最后一段固定伤害/2命增伤/6命必暴暴伤、4命帷幕喧响、星光汇聚之地回血接入伊德海莉。',
  applyPanel: applyLuciaPanel,
  buildCharConfig: buildLuciaCharConfig,
  estimateExSpecialTime: ({ cfg, exSpecialCount, ultimateCount }) => {
    const plan = computeLuciaDreamPlan(exSpecialCount, ultimateCount, cfgNum(cfg, 'lucia.additionalAttackCount', DEFAULT_ADDITIONAL_ATTACK_COUNT))
    const exTime = cfg.exSpecialActionTime
    const a5Time = cfg.luciaA5ActionTime ?? 1.887
    return {
      // 计划内强特接 A5，A5 也占用前台时间；计划外强特合轴 0 秒
      necessaryTime: plan.dreamExSpecialCount * exTime + plan.a5Count * a5Time,
      comboAlignTime: plan.excessExSpecialCount * exTime,
    }
  },
  buildExecutions: buildLuciaExecutions,
  patchExecutions: patchLuciaExecutions,
  buildResourceResult: buildLuciaResourceResult,
  resourceSections: buildLuciaResourceSections,
  settings,
}
