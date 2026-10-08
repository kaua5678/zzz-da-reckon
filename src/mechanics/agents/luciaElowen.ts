import { clampRatio } from '@/utils/finiteClamp'
import type { AgentMechanicModule, AgentCharConfigInput, AgentFinalAssembleInput, AgentPanelInput, AgentResourceInput, AgentResourceResultInput, AgentResourceSectionsInput } from '../types'
import type { CharacterResourceResult, MechanicSetting, SkillExecution } from '@/types/resource'
import { fmt } from '@/utils/format'
import { countFrontActions, effectiveBackstageTime, effectiveBattleTime, frontBlockSeconds, phaseDelayedCooldown } from '@/core/effectiveTime'
import { applyAgentAttributeConversions } from '@/specs/runtime'
import { mechanicSettingPanelReader, mechanicSettingReader } from '@/utils/mechanicSettingCfg'
import { findMoveById } from '@/data/moveTableQueries'
import { moduleExecRow, RECOVERY_OFF } from '@/mechanics/moduleExecRow'
import { cinemaLevelOf } from '@/data/cinemaLevel'

const cfgNum = mechanicSettingReader(() => settings)
const settingOf = mechanicSettingPanelReader(() => settings)
/**
 * 卢西娅·艾洛温（1451）战斗逻辑（用户确认口径）：
 * - 帷幕延长按全覆盖，不单独建模。
 * - 快支有单独输入，梦境值不依赖快支。
 * - 追加攻击默认 20 次；全局只需约 500 梦境值覆盖。队友命中触发、CD 8s 全球性（180s/8s≈22 次），
 *   不受失衡轴窗口限制——按 CD 全局消耗接近 500 梦境值不难（用户口径 2026-08，废除「轴模式按轴内时间折算」）。
 *   次数同时受 CD 封顶 = floor(有效后台时间 / 等效CD)（2026-08-30 相位延后口径，见 additionalAttackCapOf）：
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

/** 梦境内强特数与帷幕开启/延长拆解（CC-333：计划、4命触发与展示源三处同源） */
function computeLuciaCurtainBreakdown(exSpecialCount: number, ultimateCount: number): {
  totalE: number
  q: number
  dreamE: number
  curtainOpens: number
  curtainExtends: number
} {
  const totalE = Math.max(0, Math.floor(exSpecialCount))
  const q = Math.max(0, Math.floor(ultimateCount))
  const dreamE = Math.min(totalE, Math.max(0, 4 - q))
  return {
    totalE,
    q,
    dreamE,
    curtainOpens: 1 + (dreamE > 0 ? 1 : 0) + q,
    curtainExtends: dreamE + q,
  }
}

/** 按用户口径计算梦境值计划：Q 与总 E 已知，求需要打几个 E/A5 达到 500 梦境值 */
export function computeLuciaDreamPlan(totalExSpecialCount: number, ultimateCount: number, additionalAttackCap: number): LuciaDreamPlan {
  // 基础需求：Q=2 时 E=2、A5=3；Q 每少 1 多一组 E+A5，Q 每多 1 少一组 E+A5。
  // 即 dreamE = clamp(4 - Q, 0, totalE)，A5 补足 500 目标。
  const { totalE, q, dreamE } = computeLuciaCurtainBreakdown(totalExSpecialCount, ultimateCount)
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
  teammateCurtainCount: number,
  coverage: number,
  totalTime: number,
): number {
  const { curtainOpens, curtainExtends } = computeLuciaCurtainBreakdown(exSpecialCount, ultimateCount)
  const raw = curtainOpens + curtainExtends + Math.max(0, Math.floor(teammateCurtainCount))
  const cap = Math.max(1, Math.ceil(Math.max(0, totalTime) / CURTAIN_CD_SECONDS))
  return Math.min(cap, raw) * Math.max(0, Math.min(1, coverage))
}

/** 星光汇聚之地每次终结技回血量（%卢西娅最大生命）= 8s × (1% + 0.05%×终结技等级)/秒；12级=12.8% */
export function computeLuciaHealPctPerUlt(skillLevelBonus = 0): number {
  const ultLevel = 12 + Math.max(0, Math.floor(skillLevelBonus))
  return HEAL_SECONDS * (HEAL_RATE_PCT_BASE + HEAL_RATE_PCT_PER_LEVEL * ultLevel)
}

function buildLuciaCharConfig({ skills, cinemaLevel, cfg }: AgentCharConfigInput): void {
  cfg.skipGenericExSpecial = true // 强特由本模块生成：计划内接 A5，计划外合轴 0 秒
  cfg.timeWeight = 0 // 卢西娅不打通用平A，只打计划内 A5（由本模块生成）
  cfg.luciaCinemaLevel = cinemaLevel
  const a5Move = findMoveById(skills, A5_MOVE_ID)
  cfg.luciaA5ActionTime = a5Move?.actionTime ?? 1.887
}

function applyLuciaPanel({ panel, cinemaLevel, outOfCombatPanel }: AgentPanelInput): void {
  // 影画6·永不结束的旅途：处于任意[以太帷幕]内时，按初始最大生命值（局外生命）的2%提升自身攻击力。
  // CC-118（第 145 轮）：spec `lucia_c6_hp_to_atk` 声明 sourcePanelPhase=outOfCombat，经 sources.outOfCombat 真读局外生命；
  // 此前按局内生命（含涌泉 +5% 等局内生命加成）执行并注释「近似接受」，属规格与实现不一致（R5 口径：数据可信）。
  if (cinemaLevel >= 6) {
    applyAgentAttributeConversions(panel, LUCIA_AGENT_ID, 1, { outOfCombat: outOfCombatPanel })
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
  const cinemaLevel = cinemaLevelOf(cfg.luciaCinemaLevel)
  const panel = cfg.panel
  if (!panel) return
  const chorusMoveIds = new Set([
    ADDITIONAL_ATTACK_MOVE_ID,
    cfg.exSpecialMoveId,
    cfg.ultimateMoveId,
    cfg.chainMoveId,
    cfg.assistFollowUpMoveId,
  ].filter(Boolean))
  for (const exec of executions) {
    if (exec.moveId && chorusMoveIds.has(exec.moveId)) {
      applyChorusBonuses(exec, cinemaLevel, panel)
    }
  }
}

function buildLuciaExecutions({ cfg, state, executions }: AgentResourceInput): void {
  // cap 依赖本轮 state + 物化钩子当时已产出的引擎行（相位延后修正）。**不回写 cfg**（阶段1 第二刀
  // 2026-09-09）：旧口径写 cfg.luciaAdditionalAttackCap 供 buildResourceResult 复用，使物化钩子对
  // cfg 有副作用（试探/装配同 state 不同相位拿到不同行）；现在两处各自用同一纯函数 + 同一行基准重算
  // （buildResourceResult 经 AgentResourceResultInput.preModuleExecutions 拿到同一批行）。
  const cap = additionalAttackCapOf(
    cfg,
    state,
    countFrontActions(executions, cfg.assistFollowUpMoveId),
  )
  const plan = computeLuciaDreamPlan(
    state.exSpecialCount,
    state.ultimateCount,
    cap,
  )

  const a5Time = cfg.luciaA5ActionTime ?? 1.887
  const exTime = cfg.exSpecialActionTime

  // A5：开局场地外 1 次（随想），其余为战斗中 E 后衔接；这里统一用随想 1451005（合唱升级未单独拆分，用户确认）
  if (plan.a5Count > 0) {
    executions.push(moduleExecRow({
      moveId: A5_MOVE_ID,
      moveName: '普通攻击：星轨连击 #5（随想·A5）',
      category: 'basic',
      count: plan.a5Count,
      actionTime: a5Time,
      totalTime: plan.a5Count * a5Time,
      skillTableNote: '卢西娅必要时间：A5（随想）×' + plan.a5Count,
    }))
  }

  // 计划内强特：接 A5，占用前台时间
  if (plan.dreamExSpecialCount > 0) {
    executions.push(moduleExecRow({
      moveId: cfg.exSpecialMoveId,
      moveName: '强化特殊技：死神协奏曲·破晓（接A5）',
      category: 'special',
      count: plan.dreamExSpecialCount,
      actionTime: exTime,
      totalTime: plan.dreamExSpecialCount * exTime,
      skillTableNote: '卢西娅必要时间：强特（接A5）×' + plan.dreamExSpecialCount,
    }))
  }

  // 计划外强特：直接合轴，耗时 0 秒
  if (plan.excessExSpecialCount > 0) {
    executions.push(moduleExecRow({
      moveId: cfg.exSpecialMoveId,
      moveName: '强化特殊技：死神协奏曲·破晓（合轴）',
      category: 'special',
      count: plan.excessExSpecialCount,
      actionTime: exTime,
      comboAlignRatio: 1,
      totalTime: plan.excessExSpecialCount * exTime,
      totalComboAlignTime: plan.excessExSpecialCount * exTime,
      skillTableNote: '卢西娅计划外强特：合轴 0 秒',
    }))
  }

  // 追加攻击（合唱）：默认 20 次（≈500 梦境值 ÷ 25/次），由队友命中触发，不占卢西娅前台时间
  if (plan.additionalAttackCount > 0) {
    executions.push(moduleExecRow({
      moveId: ADDITIONAL_ATTACK_MOVE_ID,
      moveName: '追加攻击（合唱）',
      category: 'special',
      count: plan.additionalAttackCount,
      ...RECOVERY_OFF,
      skillTableNote: '追加攻击 1100%/200异常（默认20次，CD 8s 队友命中触发，不受失衡轴窗口限制；次数受相位延后 CD 封顶 = 有效后台时间/等效CD，无敌期间不结算）',
    }))
  }
}

function computeLuciaSource(
  cfg: AgentResourceInput['cfg'],
  state: { exSpecialCount: number; ultimateCount: number },
  additionalAttackCap: number,
  healingCoverage: number,
): LuciaMechanicSource {
  const plan = computeLuciaDreamPlan(state.exSpecialCount, state.ultimateCount, additionalAttackCap)
  const q = Math.max(0, Math.floor(state.ultimateCount))
  const panel = cfg.panel
  const healPctPerUlt = computeLuciaHealPctPerUlt(panel.skillLevelBonus)
  const curtainTriggerCount = Number.isFinite(Number(cfg.luciaCurtainTriggerCount))
    ? Math.max(0, Number(cfg.luciaCurtainTriggerCount))
    : computeLuciaCurtainTriggers(state.exSpecialCount, state.ultimateCount, 0, 1, cfg.battleTime)
  const c4PerTrigger = Math.max(0, Number(cfg.decibelPerCurtainTrigger ?? 0))
  // 帷幕来源拆分（展示用）：引擎同点写入自开/队友归因；外部直调（缺写入）时自开回退 = 总次数。
  const curtainSelfRaw = Number(cfg.luciaCurtainSelfCount)
  const curtainSelfCount = Number.isFinite(curtainSelfRaw) ? Math.max(0, curtainSelfRaw) : curtainTriggerCount
  const { curtainOpens, curtainExtends } = computeLuciaCurtainBreakdown(state.exSpecialCount, state.ultimateCount)
  const curtainTeammatesRaw = Array.isArray(cfg.luciaCurtainTeammates)
    ? cfg.luciaCurtainTeammates
    : []
  const curtainTeammates = curtainTeammatesRaw
    .map(m => ({
      agentId: m.agentId,
      rawCount: Math.max(0, Math.floor(Number(m.rawCount) || 0)),
      triggers: Math.max(0, Number(m.triggers) || 0),
    }))
    .filter(m => m.agentId && m.rawCount > 0)
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
    curtainSelfCount,
    curtainOpens,
    curtainExtends,
    curtainTeammates,
    c4DecibelPerTrigger: c4PerTrigger,
    c4TeamDecibelPerChar: curtainTriggerCount * c4PerTrigger,
    note: '追加攻击默认20次（CD 8s 全球性、队友命中触发，不受失衡轴窗口限制；受相位延后 CD 封顶 = 有效后台时间/等效CD，无敌期间不结算）；计划外强特合轴0秒；回血按终结技等级公式（12级12.8%/大）×覆盖滑块折算；4命帷幕触发次数含15s CD封顶。',
  }
}

function buildLuciaResourceResult({ cfg, state, preModuleExecutions }: AgentResourceResultInput): Partial<CharacterResourceResult> {
  // cap 与 buildExecutions 同口径：同一纯函数 + **同一行基准**（物化钩子派发前的引擎行）。
  const cap = additionalAttackCapOf(
    cfg,
    state,
    countFrontActions(preModuleExecutions, cfg.assistFollowUpMoveId),
  )
  return {
    luciaMechanicSource: computeLuciaSource(
      cfg,
      state,
      cap,
      cfgNum(cfg, 'lucia.healingCoverage'),
    ),
  }
}

function buildLuciaResourceSections({ result, agentNames }: AgentResourceSectionsInput) {
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
    // 来源拆分（用户口径 2026-09-19「全队的帷幕次数，分别是谁给的」）：≈ 前缀使该行不进难度曲线关键次数
    // 解析器（拆分=边际法，受 CD 封顶/覆盖滑块影响，非精确整数）。总数行保持精确 `N 次` 格式。
    rows.push({
      label: '　├ 卢西娅自开/自延',
      value: `≈${fmt(source.curtainSelfCount)} 次`,
      detail: `原始 开启${fmt(source.curtainOpens)}（开局1+入场1+Q退出再入梦×${Math.max(0, Math.floor(source.ultimateCount))}）+ 延长${fmt(source.curtainExtends)}（梦境E+Q）`,
    })
    for (const mate of source.curtainTeammates) {
      const who = agentNames?.[mate.agentId] || `槽位角色 ${mate.agentId}`
      rows.push({
        label: `　└ ${who}开帷幕`,
        value: `≈${fmt(mate.triggers)} 次`,
        detail: `终结技 ×${mate.rawCount}（每次 +1）；与自开共享 15s CD 封顶/覆盖滑块，计入 ${fmt(mate.triggers)}`,
      })
    }
  }
  return [
    {
      id: 'lucia-dream-plan',
      title: '卢西娅·梦境值计划（500点）',
      summary: `梦境值 ${fmt(source.dreamTotal)} · 追加攻击 ${source.additionalAttackCount} 次 · 计划内强特 ${source.dreamExSpecialCount} 次 · 合轴强特 ${source.excessExSpecialCount} 次`,
      rows,
      footer: '计划外强特直接合轴耗时0秒；A5为随想1451005（合唱升级未单独拆分）；[合唱]行已按最大生命值附加最后一段固定伤害，2命+15%增伤，6命必暴+暴伤30%。帷幕来源拆分=边际法（总 − 自开归因给队友），总数精确、拆分≈。',
    },
  ]
}

/**
 * 追加攻击次数上限 = min(滑块/默认, CD 封顶)。
 * CD 封顶（2026-08-30 相位延后口径，core/effectiveTime.ts）= floor(有效后台时间 / 等效CD)：
 * 等效CD = 8s + 前台占比×前台块长/2——卢西娅本人被换上前台做动作（A5/强特/终结/合轴）时，
 * 队友命中触发的追击同样会被她自己的前台块延后；无敌期间不结算。
 */
function additionalAttackCapOf(
  cfg: AgentCharConfigInput['cfg'],
  state: AgentResourceInput['state'],
  frontActionCount: number,
): number {
  const slider = cfgNum(cfg, 'lucia.additionalAttackCount')
  const w = effectiveBattleTime(cfg)
  const f = state.frontlineTime
  const b = effectiveBackstageTime(state.backstageTime, cfg)
  const block = frontBlockSeconds(
    f,
    frontActionCount,
    cfgNum(cfg, 'lucia.frontSwitchRatio'),
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

/**
 * 装配期写回（2026-09-26 CC-14e，自 `core/resource/assembleSlot.ts` 逐字迁入）：卢西娅 4 命
 * 帷幕触发总次数写回 cfg（供模块资源卡展示）。
 *
 * 三个写回（`luciaCurtainTriggerCount` / `luciaCurtainSelfCount` / `luciaCurtainTeammates`）的算式、
 * 顺序、取整与 filter 逐字保留原 core 块；自开次数调用本模块 `curtainTriggers` 实现
 * （`teammateOpenCount: 0`），不复制算式。`curtainOpeners` 由引擎按 `curtain-open` 跨槽供给收集
 * （已滤掉 `rawCount <= 0`），模块只做比例分摊。
 *
 * 展示拆分（2026-09-19，零求值改动）：自开部分 + 队友来源归因（边际法：队友份额 = 总 − 自开，
 * 15s CD 封顶与覆盖滑块折算效应按比例落到两边）。2026-09-25 CC-6b：队友源改为按 `curtain-open`
 * 跨槽供给的全部提供者收集，并按各自 rawCount 比例分摊队友份额。
 * ⚠ **多提供者比例分摊是新语义、当前不可达**（唯一提供者 = 伊德海莉）：单提供者时
 * mateTotal > 0 ⇒ 比例 = 1 ⇒ triggers 与原式 `max(0, 总 − 自开)` 逐位相同；出现第二个
 * 提供者时行为与迁移前不同（旧实现只取按角色字段找到的那一个槽作来源），故此处**不是**逐位等价承诺。
 */
function luciaOnFinalAssemble({ cfg, isCurtainProvider, curtainTriggers, state, totalTime, curtainOpeners }: AgentFinalAssembleInput): void {
  if (!isCurtainProvider) return
  cfg.luciaCurtainTriggerCount = curtainTriggers
  cfg.luciaCurtainSelfCount = luciaElowenMechanic.curtainTriggers!({
    cfg,
    state,
    teammateOpenCount: 0,
    totalTime,
  })
  const raw = curtainOpeners
  const mateTotal = raw.reduce((n, m) => n + m.rawCount, 0)
  const mateTriggers = Math.max(0, curtainTriggers - cfg.luciaCurtainSelfCount)
  cfg.luciaCurtainTeammates = raw.map(m => ({
    agentId: m.agentId,
    rawCount: m.rawCount,
    triggers: mateTotal > 0 ? mateTriggers * (m.rawCount / mateTotal) : 0,
  }))
}

export const luciaElowenMechanic: AgentMechanicModule = {
  id: 'agent:lucia_elowen',
  agentIds: ['1451'],
  // 副词条优化模板（CC-81：原 core/substatOptimizer.ts AGENT_TEMPLATES）
  // 卢西娅（1451）：生命→全队攻击（局外）→ hpPct 优先
  substatTemplate: {
    stats: ['hpPct', 'atkPct', 'defPct'],
  },
  name: '卢西娅·艾洛温',
  description: '梦境值计划（500点→20次追加攻击）、计划外强特合轴0秒、[合唱]最后一段固定伤害/2命增伤/6命必暴暴伤、4命帷幕喧响、星光汇聚之地回血（全队通用字段，伊德海莉烧血消费）。',
  /**
   * 队伍级机制（规则 6 迁入，棘轮站点 2-3/8，2026-09-12 #10 真清偿）：两块原本共用一个
   * 「卢西娅在队」守卫，故合并进本钩子一次清两处：
   *
   * ① **影画4·帷幕开启/延长** → 全队每人 +100 喧响（触发次数按梦境轴 + 15s CD 封顶 × 利用率滑块）。
   *    写通用 cfg 字段 `decibelPerCurtainTrigger`（CC-35c-C 2026-09-27 由 `luciaC4DecibelPerTrigger` 改名），引擎
   *    `core/resource/helpers.ts` / `assembleSlot.ts` 按「帷幕触发次数 × 每次喧响」结算；`luciaC4CurtainCoverage` 只有本模块读。
   * ② **星光汇聚之地回血** → 终结技等级公式（12级 12.8%/大）× 覆盖滑块，换算成**伊德海莉自身生命%**
   *    CC-313 起换算成**各槽自身**生命%写通用字段 `healPctPerCurtainProviderUlt` 给全队（不再认伊德海莉），
   *    现唯一消费者 = 伊德海莉烧血→喧响（`yidhari.ts#yidhariSelfBurnDecibel` / `onFinalAssemble`）。
   *
   * 等价性：settings 已含注册默认兜底（lucia.c4CurtainCoverage=1 / lucia.healingCoverage=0.5），
   * 与原 `configStore.getMechanicSetting(id, default)` 逐位等价；命座由派发器直接给（cinemaLevel）。
   */
  applyTeamConfig: ({ slot, characters, settings, cinemaLevel, phase }) => {
    if (phase !== 'build') return
    const self = characters.find(c => c.slot === slot)
    if (!self) return
    // ① 影画4：帷幕触发 → 全队 +100 喧响/次（非 4 命不写字段 = 引擎既有无字段语义）
    if (cinemaLevel >= 4) {
      for (const cfg of characters) {
        cfg.decibelPerCurtainTrigger = 100
        cfg.luciaC4CurtainCoverage = clampRatio(settingOf(settings, 'lucia.c4CurtainCoverage'))
      }
    }
    // ② 回血：星光汇聚之地给「当前操作中的角色」回卢西娅生命% ⇒ 换算成**各槽自身**生命%写给全队
    //    （CC-313：不再按身份找伊德海莉；谁消费、怎么用由消费者模块决定，现唯一消费者 = 伊德海莉烧血→喧响）
    const healPctPerUlt = computeLuciaHealPctPerUlt(self.panel.skillLevelBonus)
    const healingCoverage = clampRatio(settingOf(settings, 'lucia.healingCoverage'))
    const luciaHp = Math.max(1, self.panel.hp)
    for (const cfg of characters) {
      cfg.healPctPerCurtainProviderUlt = healPctPerUlt * healingCoverage * (luciaHp / Math.max(1, cfg.panel.hp))
    }
  },
  applyPanel: applyLuciaPanel,
  buildCharConfig: buildLuciaCharConfig,
  // 4命帷幕触发次数（规则 6 引擎落点，2026-09-25 CC-6b）：队友开帷幕量由引擎按跨槽供给
  // 类别（帷幕开启）收集成标量 `teammateOpenCount` 传入，本能力只读自己 cfg/state ⇒ 纯函数。
  // `luciaC4CurtainCoverage` 由本模块 applyTeamConfig 写给全队（含自己）。
  curtainTriggers: ({ cfg, state, teammateOpenCount, totalTime }) =>
    computeLuciaCurtainTriggers(
      state.exSpecialCount,
      state.ultimateCount,
      teammateOpenCount,
      Number(cfg.luciaC4CurtainCoverage ?? 1),
      totalTime,
    ),
  // 装配期写回（2026-09-26 CC-14e）：卢西娅 C4 帷幕三写回，见上方 luciaOnFinalAssemble 注释。
  onFinalAssemble: luciaOnFinalAssemble,
  estimateExSpecialTime: ({ cfg, exSpecialCount, ultimateCount }) => {
    const plan = computeLuciaDreamPlan(exSpecialCount, ultimateCount, cfgNum(cfg, 'lucia.additionalAttackCount'))
    const exTime = cfg.exSpecialActionTime
    const a5Time = cfg.luciaA5ActionTime ?? 1.887
    return {
      // 计划内强特接 A5，A5 也占用前台时间；计划外强特合轴 0 秒
      necessaryTime: plan.dreamExSpecialCount * exTime + plan.a5Count * a5Time,
      comboAlignTime: plan.excessExSpecialCount * exTime,
      // NET 约定：计划外强特已从 necessaryTime 剔除（合轴 0 秒），不再抵扣团队预算
      comboAlignIncludedInNecessary: false,
    }
  },
  buildExecutions: buildLuciaExecutions,
  patchExecutions: patchLuciaExecutions,
  buildResourceResult: buildLuciaResourceResult,
  resourceSections: buildLuciaResourceSections,
  settings,
}

/**
 * D2（CC-359）：本模块私有的 cfg 字段——只有本文件读写，声明随模块走，不再堆在 `types/resource/config.ts`。
 * 仍是 `CharacterOperationConfig` 的成员（模块扩充，纯类型、零运行时）；被第二处引用时请迁回公共接口。
 */
declare module '@/types/resource/config' {
  interface CharacterOperationConfig {
    /** 卢西娅4命帷幕触发利用率（0-1，帷幕连着放卡15s CD 时调低），默认 1 */
    luciaC4CurtainCoverage?: number
    /** 卢西娅4命帷幕触发中**自开/自延**部分（同点写入，供卡片按来源拆分；零求值影响） */
    luciaCurtainSelfCount?: number
    /** 卢西娅4命帷幕的队友来源分摊（展示用）：rawCount=队友原始触发次数，triggers=边际法计入总次数的份额（总 − 自开） */
    luciaCurtainTeammates?: CurtainTeammateShare[]
    /** 卢西娅 A5（随想 1451005）actionTime，buildCharConfig 从倍率表读取 */
    luciaA5ActionTime?: number
    /** 卢西娅4命本局帷幕触发总次数（收敛后由资源池按最终终结技次数写入，供模块展示） */
    luciaCurtainTriggerCount?: number
    /** 卢西娅命座等级（buildCharConfig 写入，供 patchExecutions 按命座补合唱行专属字段） */
    luciaCinemaLevel?: number
  }
}

/**
 * D2（CC-359/360）：本模块私有的结果字段——只有本文件读写，声明随模块走，不堆在 `types/resource/agentResources.ts`。
 * 仍是 `CharacterResourceResult` 的成员（模块扩充，纯类型、零运行时）；被第二处引用时请迁回公共接口。
 */
declare module '@/types/resource/agentResources' {
  interface CharacterResourceResult {
    /** 卢西娅梦境值/追加攻击/回血明细 */
    luciaMechanicSource?: LuciaMechanicSource
  }
}

// ===== 本模块私有的结果类型（D2 / CC-360：原在 types/resource/agentResources.ts，只有本文件引用）=====

/** 4命帷幕的一个队友来源（展示用）：rawCount = 队友原始触发次数，triggers = 边际法计入总次数的份额（总 − 自开） */
interface CurtainTeammateShare { agentId: string; rawCount: number; triggers: number }

/** 卢西娅·艾洛温梦境值/追加攻击/回血资源明细（用户确认口径） */
export interface LuciaMechanicSource {
  /** 全局目标梦境值（默认 500） */
  dreamTarget: number
  /** 计划内强特次数（占用前台时间） */
  dreamExSpecialCount: number
  /** 计划外强特次数（合轴 0 秒） */
  excessExSpecialCount: number
  /** A5 次数（开局场地外 1 次 + 战斗中 E 后接） */
  a5Count: number
  /** 终结技次数 */
  ultimateCount: number
  /** 梦境值总计 = 60 + A5×40 + E×60 + Q×100 */
  dreamTotal: number
  /** 追加攻击次数 = min(设置上限, floor(dreamTotal/25)) */
  additionalAttackCount: number
  /** 追加攻击消耗梦境值 */
  additionalAttackDreamCost: number
  /** 每次终结技回血量（%卢西娅最大生命）= 8s × (1% + 0.05%×终结技等级)/秒，12级=12.8% */
  healPctPerUlt: number
  /** 队友回血总量 = 终结技次数 × healPctPerUlt × 覆盖滑块（% 卢西娅最大生命） */
  healTotalHpPct: number
  /** 4命帷幕触发次数（开启/延长，含队友如伊德海莉大招开帷幕；15s CD 封顶 × 利用率滑块） */
  curtainTriggerCount: number
  /** 4命帷幕触发中卢西娅**自开/自延**部分（边际拆分；缺写入方时回退 = 总次数） */
  curtainSelfCount: number
  /** 4命帷幕开启次数（原始，未受 CD 封顶/覆盖率折算）：开局1 + 入场1（有梦境E）+ Q 退出再入梦 ×Q */
  curtainOpens: number
  /** 4命帷幕延长次数（原始）：梦境内强特 + 梦境内终结技 */
  curtainExtends: number
  /** 4命帷幕队友来源分摊（展示用；triggers=边际法计入总次数的份额） */
  curtainTeammates: CurtainTeammateShare[]
  /** 4命每次触发给全队每人的喧响（100；未开4命为 0） */
  c4DecibelPerTrigger: number
  /** 4命全队每人喧响合计 = curtainTriggerCount × c4DecibelPerTrigger */
  c4TeamDecibelPerChar: number
  note: string
}
