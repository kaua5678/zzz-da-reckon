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
import { moduleExecRow, RECOVERY_OFF } from '@/mechanics/moduleExecRow'
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
import { additionalAbilityActiveOf } from '@/core/additionalAbilityActive'

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
/** 昂扬每层基础冰火伤% */
export const LIGHTER_MORALE_STACK_BASE = 1.25
/** 冲击力超过 170 时，每 10 点每层额外% */
export const LIGHTER_MORALE_STACK_EXTRA_PER_10 = 0.25
export const LIGHTER_IMPACT_SOFT_CAP = 170
export const LIGHTER_MORALE_MAX_STACKS = 20
export const LIGHTER_MORALE_DMG_CAP = 75
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
/** 强力终结一击（耗尽士气自动衔接；用 #16 高倍率段近似） */
export const MOVE_POWER_FINISHER = '1161025'

export interface LighterMoraleInput {
  combatTime: number
  /** 全队普通能量消耗（不含闪能/命破） */
  teamEnergyConsumed: number
  cinemaLevel: number
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

export interface LighterMoraleBuffInput {
  impact: number
  cinemaLevel: number
  /** 额外能力是否激活 */
  additionalActive: boolean
}

/**
 * 昂扬提供的冰/火伤%（单属性）。
 * 用户口径：第一次快速刺拳实时算，之后永续 → 默认满层。
 * perStack = 1.25 + floor(max(0, impact-170)/10)*0.25
 * total = min(75, perStack * 20)；C2 ×1.2 后再吃硬顶？原文「提升至原本的120%」且昂扬自身有 75% 顶——
 * 采用：先算基础封顶 75，再 ×1.2（C2 可突破到 90），与 teammate-buffs multiplyResolvedValue 一致。
 */
export function computeLighterMoraleDmgBonus(input: LighterMoraleBuffInput): number {
  if (!input.additionalActive) return 0
  const impact = Math.max(0, Number(input.impact) || 0)
  const overSteps = Math.floor(Math.max(0, impact - LIGHTER_IMPACT_SOFT_CAP) / 10)
  const perStack = LIGHTER_MORALE_STACK_BASE + overSteps * LIGHTER_MORALE_STACK_EXTRA_PER_10
  const base = Math.min(LIGHTER_MORALE_DMG_CAP, perStack * LIGHTER_MORALE_MAX_STACKS)
  const mult = cinemaLevelOf(input.cinemaLevel) >= 2 ? 1.2 : 1
  return base * mult
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
 */
export function computeLighterMorale(input: LighterMoraleInput): LighterMoraleResult {
  const t = Math.max(0, Number(input.combatTime) || 0)
  const energy = Math.max(0, Number(input.teamEnergyConsumed) || 0)
  const mult = cinemaLevelOf(input.cinemaLevel) >= 6 ? 2 : 1
  const moraleGainTime = LIGHTER_MORALE_PER_SEC * t * mult
  const moraleGainEnergy = energy * LIGHTER_MORALE_PER_ENERGY * mult
  const moraleGain = moraleGainTime + moraleGainEnergy
  // 每次喷发至少消耗接近满条士气（阈值 80，实战通常打光至 0）→ 按 100 点一轮近似
  const burstEntries = Math.floor(moraleGain / LIGHTER_MORALE_CAP)
  const powerFinisherCount = burstEntries
  return {
    moraleGain,
    moraleGainTime,
    moraleGainEnergy,
    burstEntries,
    powerFinisherCount,
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

function applyPanel({ cinemaLevel, panel, team, slot, agent }: AgentPanelInput): void {
  const cinema = cinemaLevelOf(cinemaLevel)
  // 喷发耗士气冲击力 +20%（默认吃满）
  const impactPct = computeLighterImpactBonusPct(cinema)
  panel.impact = (panel.impact ?? 0) * (1 + impactPct / 100)

  // 溃败：失衡时长延长
  panel.stunDurationBonusSeconds =
    (panel.stunDurationBonusSeconds ?? 0) + computeLighterRoutStunBonus(cinema)

  // 昂扬：额外能力门控 + 冲击力实时（面板已含自身冲击加成）
  const additionalActive = additionalAbilityActiveOf(panel)
    || (() => {
      // applyPanel 时 additionalAbilityActive 通常已写入；兜底再判一次
      const hasAttack = team.some(m => m.slot !== slot && m.agent?.specialty === 'attack')
      const hasFaction = team.some(
        m => m.slot !== slot && m.agent?.faction != null && m.agent.faction === agent.faction,
      )
      return hasAttack || hasFaction
    })()

  if (additionalActive) {
    // 队友增益侧默认 75 会被 C2×1.2；这里若 buff 已启用会双算。
    // 策略：昂扬改由模块写入，teammate-buffs 额外能力条标记 singleSourced（原字段名 hidden）或由 helpers 过滤。
    // 实际由 helpers 过滤 lighter.additional_* 后在此统一写入（含本人+通过 teammates 循环？）
    // applyPanel 只作用于本人面板。全队昂扬在 helpers 的 lighter 块给每个角色加。
    panel.lighterMoraleDmgBonus = computeLighterMoraleDmgBonus({
      impact: panel.impact ?? 0,
      cinemaLevel: cinema,
      additionalActive: true,
    })
  }

}

function buildCharConfig({ cinemaLevel, cfg, panel }: AgentCharConfigInput): void {
  const cinema = cinemaLevelOf(cinemaLevel)
  cfg.lighterCinemaLevel = cinema
  cfg.lighterImpact = panel.impact ?? 0
  cfg.lighterMoraleDmgBonus = Number(panel.lighterMoraleDmgBonus ?? 0) || 0
  if (cinema >= 6) {
    cfg.lighterFlameShockMult = computeLighterFlameShockMultiplier(panel.impact ?? 0)
  }
}

function lighterMoraleOf(cfg: AgentResourceInput['cfg'], state: AgentResourceInput['state']): LighterMoraleResult {
  const cinema = cinemaLevelOf(cfg.lighterCinemaLevel)
  return computeLighterMorale({
    combatTime: effectiveCombatTime(state, cfg),
    teamEnergyConsumed: Math.max(0, Number(cfg.lighterTeamEnergyConsumed ?? 0)),
    cinemaLevel: cinema,
  })
}

function buildExecutions({ cfg, state, executions }: AgentResourceInput): void {
  const cinema = cinemaLevelOf(cfg.lighterCinemaLevel)
  const combatTime = effectiveCombatTime(state, cfg)
  const morale = lighterMoraleOf(cfg, state)

  // 强力终结：耗尽士气自动衔接；次数 = 喷发轮次；后台/前台混合，整局不另占必做时间（合入普攻循环）
  if (morale.powerFinisherCount > 0) {
    // 不强制覆盖倍率表——若通用普攻计划已含该 move，则 patch；否则追加近似行
    const existing = executions.find(e => e.moveId === MOVE_POWER_FINISHER)
    const c1Bonus = cinema >= 1 ? LIGHTER_C1_FINISHER_DMG : 0
    if (existing) {
      existing.count = (existing.count ?? 0) + morale.powerFinisherCount
      if (c1Bonus > 0) {
        existing.dmgBonus = (existing.dmgBonus ?? 0) + c1Bonus
      }
      existing.skillTableNote =
        `${existing.skillTableNote ?? ''}；士气喷发强力终结 +${morale.powerFinisherCount}`
          + (c1Bonus ? `（C1 伤害+${c1Bonus}%）` : '')
    } else {
      // 倍率交 enrich 回填；先占位 0 并关 override，若 enrich 后仍 0 则无伤
      executions.push(moduleExecRow({
        moveId: MOVE_POWER_FINISHER,
        moveName: '普通攻击：强力终结一击（士气喷发）',
        category: 'basic',
        count: morale.powerFinisherCount,
        damageMultiplier: 0,
        damageMultiplierOverride: false,
        element: 'fire',
        skillTableNote:
          `士气喷发强力终结 ×${morale.powerFinisherCount}`
          + (c1Bonus ? `（C1 伤害+${c1Bonus}%）` : ''),
        ...(c1Bonus ? { dmgBonus: c1Bonus } : {}),
      }) as SkillExecution)
    }
  }

  // C6 火焰冲击
  if (cinema >= 6) {
    const mult = Number(cfg.lighterFlameShockMult ?? 0)
      || computeLighterFlameShockMultiplier(Number(cfg.lighterImpact ?? 0))
    const count = computeLighterFlameShockCount(combatTime, morale.powerFinisherCount)
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
  const flameCount = cinema >= 6
    ? computeLighterFlameShockCount(combatTime, morale.powerFinisherCount)
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
  const morale = result?.lighterMorale
  if (!morale) return []
  const flame = Number(result?.lighterFlameShockCount ?? 0) || 0
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
  opts?: { exCounts?: number[]; combatTime?: number; teamEnergyConsumed?: number },
): void {
  const cinema = cinemaLevelOf(cfgNum(lighter, 'lighterCinemaLevel', 0))
  const combatTime = Math.max(0, Number(opts?.combatTime ?? 180))
  const exCounts = opts?.exCounts ?? characters.map(() => 0)
  const estimated = estimateTeamNormalEnergyConsumed(characters, exCounts)
  const teamEnergy = Math.max(
    0,
    Number(opts?.teamEnergyConsumed ?? lighter.lighterTeamEnergyConsumed ?? estimated) || 0,
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
  const exByAgent = new Map(teamResult.characters.map(ch => [ch.agentId, ch.exSpecialCount ?? 0]))
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
        impact: (source.inCombat.impact ?? 0) * 1.2,
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
      applyLighterTeamEnergyFlags(lighter, characters, { exCounts: characters.map(() => 0), combatTime: 180 })
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
        lighter.lighterTeamEnergyConsumed = Math.max(0, (threads.moduleFeedback?.consumedTeamEnergy ?? 0) || 0)
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
  teamPanelEffects: ({ cinemaLevel, targetAgent, panel, settings }: AgentTeamPanelEffectInput) => {
    if (targetAgent.id === LIGHTER_ID) return // 莱特本人不吃
    if (cinemaLevelOf(cinemaLevel) < 4) return
    const ratio = Math.max(0, Math.min(1, settingOf(settings, 'lighter.backstageRatio')))
    panel.energyGainEfficiency = (panel.energyGainEfficiency ?? 0) + LIGHTER_C4_FRONT_EFFICIENCY * ratio
  },
  buildCharConfig,
  buildExecutions,
  patchExecutions,
  buildResourceResult,
  resourceSections,
  nextRoundFeedback: lighterNextRoundFeedback,
}

export default lighterMechanic

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
    /** 额外能力「昂扬」增伤：buildCharConfig 从 panel.lighterMoraleDmgBonus 读入 */
    lighterMoraleDmgBonus?: number
    /** 6 命烈焰冲击倍率：按冲击力算，buildCharConfig 仅 6 命写入 */
    lighterFlameShockMult?: number
    /** 莱特：全队普通能量消耗（士气能量来源；编排注入，不含闪能） */
    lighterTeamEnergyConsumed?: number
    /** 莱特影画等级（模块缓存） */
    lighterCinemaLevel?: number
  }
}

/**
 * D2（r402 CC-376，`docs/mcp-panel-fields.md` §4 S2+S4）：本模块私有的面板字段——只有本文件读写（测试读不算引用者），声明随模块走。
 * 仍是 `PanelValues` 的成员（模块扩充，纯类型、零运行时）；出现第二个**生产**引用者时迁回 `types/catalog.ts`。
 */
declare module '@/types/catalog' {
  interface PanelValues {
    /** 额外能力「昂扬」增伤：applyPanel 按冲击力算出写入，buildCharConfig 读回进 cfg */
    lighterMoraleDmgBonus?: number
  }
}
