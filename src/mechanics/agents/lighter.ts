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
import type {
  AgentCharConfigInput,
  AgentMechanicModule,
  AgentPanelInput,
  AgentResourceInput,
  AgentResourceResultInput,
  AgentResourceSectionsInput,
} from '../types'
import type { CharacterOperationConfig, SkillExecution } from '@/types/resource'
import { fmt } from '@/utils/format'

export const LIGHTER_ID = '1161'

/** 士气时间回复（点/秒） */
export const LIGHTER_MORALE_PER_SEC = 2.9
/** 全队每消耗 1 点普通能量 → 士气 */
export const LIGHTER_MORALE_PER_ENERGY = 0.26
/** 士气上限 */
export const LIGHTER_MORALE_CAP = 100
/** 进入士气喷发阈值 */
export const LIGHTER_MORALE_BURST_THRESHOLD = 80
/** 满级：每耗 10 士气冲击力 +2%，最多 +20% */
export const LIGHTER_IMPACT_PER_10_MORALE = 2
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
  const mult = (input.cinemaLevel ?? 0) >= 2 ? 1.2 : 1
  return base * mult
}

/** 满级核心冲击力加成%（喷发耗士气，默认吃满） */
export function computeLighterImpactBonusPct(_cinemaLevel = 0): number {
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
  const mult = (input.cinemaLevel ?? 0) >= 6 ? 2 : 1
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
  characters: CharacterOperationConfig[],
  exCounts: number[],
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
  executions.push({
    moveId,
    moveName,
    category: opts?.category ?? 'basic',
    count,
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
    damageMultiplier: dmg,
    damageMultiplierOverride: true,
    element: 'fire',
    skillTableNote: note,
    ...(opts?.dmgBonus ? { dmgBonus: opts.dmgBonus } : {}),
  } as SkillExecution)
}

function combatTimeOf(state: AgentResourceInput['state']): number {
  return (state.frontlineTime ?? 0) + (state.backstageTime ?? 0)
}

function cfgNum(cfg: CharacterOperationConfig, key: string, fallback = 0): number {
  const record = cfg as unknown as Record<string, unknown>
  const raw = Number(record[key] ?? fallback)
  return Number.isFinite(raw) ? raw : fallback
}

function applyPanel({ cinemaLevel, panel, team, slot, agent }: AgentPanelInput): void {
  const cinema = cinemaLevel ?? 0
  // 喷发耗士气冲击力 +20%（默认吃满）
  const impactPct = computeLighterImpactBonusPct(cinema)
  panel.impact = (panel.impact ?? 0) * (1 + impactPct / 100)

  // 溃败：失衡时长延长
  panel.stunDurationBonusSeconds =
    (panel.stunDurationBonusSeconds ?? 0) + computeLighterRoutStunBonus(cinema)

  // 昂扬：额外能力门控 + 冲击力实时（面板已含自身冲击加成）
  const additionalActive = (panel.additionalAbilityActive ?? 0) > 0
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
    // 策略：昂扬改由模块写入，teammate-buffs 额外能力条 hidden 或由 helpers 过滤。
    // 实际由 helpers 过滤 lighter.additional_* 后在此统一写入（含本人+通过 teammates 循环？）
    // applyPanel 只作用于本人面板。全队昂扬在 helpers 的 lighter 块给每个角色加。
    ;(panel as any).lighterMoraleDmgBonus = computeLighterMoraleDmgBonus({
      impact: panel.impact ?? 0,
      cinemaLevel: cinema,
      additionalActive: true,
    })
  }

  // C1 强力终结 +30% 标记（执行级 patch）
  if (cinema >= 1) {
    ;(panel as any).lighterC1FinisherDmgBonus = LIGHTER_C1_FINISHER_DMG
  }
}

function buildCharConfig({ cinemaLevel, cfg, panel }: AgentCharConfigInput): void {
  const record = cfg as unknown as Record<string, unknown>
  const cinema = cinemaLevel ?? 0
  record.lighterCinemaLevel = cinema
  record.lighterImpact = panel.impact ?? 0
  record.lighterAdditionalActive = (panel.additionalAbilityActive ?? 0) > 0 ? 1 : 0
  record.lighterMoraleDmgBonus = Number((panel as any).lighterMoraleDmgBonus ?? 0) || 0
  record.lighterRoutStunBonus = computeLighterRoutStunBonus(cinema)
  record.lighterImpactBonusPct = computeLighterImpactBonusPct(cinema)
  if (cinema >= 1) record.lighterC1FinisherDmgBonus = LIGHTER_C1_FINISHER_DMG
  if (cinema >= 6) {
    record.lighterFlameShockMult = computeLighterFlameShockMultiplier(panel.impact ?? 0)
  }
}

function buildExecutions({ cfg, state, executions }: AgentResourceInput): void {
  const record = cfg as unknown as Record<string, unknown>
  const cinema = Math.max(0, Math.floor(Number(record.lighterCinemaLevel ?? 0)))
  const combatTime = combatTimeOf(state)
  const teamEnergy = Math.max(0, Number(record.lighterTeamEnergyConsumed ?? 0))
  const morale = computeLighterMorale({
    combatTime,
    teamEnergyConsumed: teamEnergy,
    cinemaLevel: cinema,
  })
  record.lighterMorale = morale

  // 强力终结：耗尽士气自动衔接；次数 = 喷发轮次；后台/前台混合，整局不另占必做时间（合入普攻循环）
  if (morale.powerFinisherCount > 0) {
    // 不强制覆盖倍率表——若通用普攻计划已含该 move，则 patch；否则追加近似行
    const existing = executions.find(e => e.moveId === MOVE_POWER_FINISHER)
    const c1Bonus = cinema >= 1 ? LIGHTER_C1_FINISHER_DMG : 0
    if (existing) {
      existing.count = (existing.count ?? 0) + morale.powerFinisherCount
      if (c1Bonus > 0) {
        ;(existing as any).dmgBonus = ((existing as any).dmgBonus ?? 0) + c1Bonus
      }
      existing.skillTableNote =
        `${existing.skillTableNote ?? ''}；士气喷发强力终结 +${morale.powerFinisherCount}`
          + (c1Bonus ? `（C1 伤害+${c1Bonus}%）` : '')
    } else {
      // 倍率交 enrich 回填；先占位 0 并关 override，若 enrich 后仍 0 则无伤
      executions.push({
        moveId: MOVE_POWER_FINISHER,
        moveName: '普通攻击：强力终结一击（士气喷发）',
        category: 'basic',
        count: morale.powerFinisherCount,
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
        damageMultiplier: 0,
        damageMultiplierOverride: false,
        element: 'fire',
        skillTableNote:
          `士气喷发强力终结 ×${morale.powerFinisherCount}`
          + (c1Bonus ? `（C1 伤害+${c1Bonus}%）` : ''),
        ...(c1Bonus ? { dmgBonus: c1Bonus } : {}),
      } as SkillExecution)
    }
  }

  // C6 火焰冲击
  if (cinema >= 6) {
    const mult = Number(record.lighterFlameShockMult ?? 0)
      || computeLighterFlameShockMultiplier(Number(record.lighterImpact ?? 0))
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
    record.lighterFlameShockCount = count
  }
}

function patchExecutions({ cfg, executions }: AgentResourceInput): void {
  const cinema = Math.max(0, Math.floor(cfgNum(cfg, 'lighterCinemaLevel', 0)))
  if (cinema < 1) return
  const bonus = LIGHTER_C1_FINISHER_DMG
  for (const exec of executions) {
    if (exec.moveId !== MOVE_POWER_FINISHER) continue
    const cur = Number((exec as any).dmgBonus ?? 0) || 0
    // buildExecutions 可能已加过，避免双加
    if (cur >= bonus) continue
    ;(exec as any).dmgBonus = cur + bonus
  }
}

function buildResourceResult({ cfg, state }: AgentResourceResultInput) {
  const record = cfg as unknown as Record<string, unknown>
  const cinema = Math.max(0, Math.floor(Number(record.lighterCinemaLevel ?? 0)))
  const combatTime = combatTimeOf(state as any)
  const teamEnergy = Math.max(0, Number(record.lighterTeamEnergyConsumed ?? 0))
  const morale = computeLighterMorale({
    combatTime,
    teamEnergyConsumed: teamEnergy,
    cinemaLevel: cinema,
  })
  record.lighterMorale = morale
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
  const morale = (result as any)?.lighterMorale as LighterMoraleResult | undefined
  if (!morale) return []
  const flame = Number((result as any)?.lighterFlameShockCount ?? 0) || 0
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
 * C4：莱特后场时，给前场角色能量获得效率。
 * 覆盖率 = 莱特后台时间 / 总时长（迭代态写入 lighterBackstageRatio）。
 * 喷发回能：后场角色每次喷发 +4，18s CD。
 */
export function applyLighterTeamEnergyFlags(
  characters: CharacterOperationConfig[],
  opts?: { exCounts?: number[]; combatTime?: number; teamEnergyConsumed?: number },
): void {
  const lighter = characters.find(c => c.agentId === LIGHTER_ID)
  if (!lighter) return
  const cinema = Math.max(0, Math.floor(cfgNum(lighter, 'lighterCinemaLevel', 0)))
  const combatTime = Math.max(0, Number(opts?.combatTime ?? 180))
  const exCounts = opts?.exCounts ?? characters.map(() => 0)
  const estimated = estimateTeamNormalEnergyConsumed(characters, exCounts)
  const teamEnergy = Math.max(
    0,
    Number(opts?.teamEnergyConsumed ?? (lighter as any).lighterTeamEnergyConsumed ?? estimated) || 0,
  )
  ;(lighter as any).lighterTeamEnergyConsumed = teamEnergy

  if (cinema < 4) {
    for (const ch of characters) {
      ;(ch as any).lighterC4BurstEnergy = 0
      ;(ch as any).lighterC4FrontEfficiency = 0
    }
    return
  }

  // 后台覆盖：用 lighter 自身 backstage 比例（若尚未收敛则默认 2/3）
  const ratio = Math.max(0, Math.min(1, Number((lighter as any).lighterBackstageRatio ?? 2 / 3)))
  const bursts = computeLighterMorale({
    combatTime,
    teamEnergyConsumed: teamEnergy,
    cinemaLevel: cinema,
  }).burstEntries
  const capped = Math.min(bursts, Math.floor(combatTime / LIGHTER_C4_BURST_CD))
  const burstEnergy = capped * LIGHTER_C4_BURST_ENERGY
  for (const ch of characters) {
    if (ch.agentId === LIGHTER_ID) {
      ;(ch as any).lighterC4BurstEnergy = 0
      ;(ch as any).lighterC4FrontEfficiency = 0
      continue
    }
    // 前场效率在 helpers 面板层按占比写入 energyGainEfficiency；此处仅保留喷发定额回能。
    ;(ch as any).lighterC4FrontEfficiency = LIGHTER_C4_FRONT_EFFICIENCY * ratio
    ;(ch as any).lighterC4BurstEnergy = burstEnergy
  }
}

export const lighterMechanic: AgentMechanicModule = {
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
   * - build：写后场占比滑块 + 用 exCounts=0 预置标记；
   * - converge：用**上一轮**全队能量消耗重算喷发回能；
   * - postRound：用本轮收敛的 exCounts 估出全队能量消耗，供下一轮使用。
   */
  applyTeamConfig: ({ characters, phase, settings, combatTime, exCounts, teamEnergyConsumed }) => {
    const lighter = characters.find(c => c.agentId === LIGHTER_ID)
    if (!lighter) return
    if (phase === 'build') {
      const ratio = Math.max(0, Math.min(1, settings['lighter.backstageRatio'] ?? 2 / 3))
      ;(lighter as any).lighterBackstageRatio = ratio
      applyLighterTeamEnergyFlags(characters, { exCounts: characters.map(() => 0), combatTime: 180 })
      return
    }
    if (phase === 'converge') {
      applyLighterTeamEnergyFlags(characters, {
        combatTime,
        teamEnergyConsumed: Math.max(0, teamEnergyConsumed || 0),
      })
      return
    }
    // postRound：本轮次数已知 → 估下一轮全队普通能量消耗
    applyLighterTeamEnergyFlags(characters, {
      exCounts,
      combatTime,
      teamEnergyConsumed: estimateTeamNormalEnergyConsumed(characters, exCounts),
    })
  },
  applyPanel,
  buildCharConfig,
  buildExecutions,
  patchExecutions,
  buildResourceResult,
  resourceSections,
}

export default lighterMechanic
