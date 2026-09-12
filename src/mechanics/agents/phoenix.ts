/**
 * 菲欧妮（1641，火属性·异常，坎卜斯黑枝）—— ⚠️ 3.3 测试服临时录入（nanoka 3.3.2+18895034）。
 * 原文来源：data/raw/nanoka_missing/full/1641.json（双源对账 data/raw/gachabase/1641.json）。
 *
 * - 核心被动：异常精通 +40；[脆弱]敌方 debuff——属性异常伤害可暴击：
 *   anomalyCritRate 30 + 0.7×(异常掌控-145)、anomalyCritDmg 15/25/40（队伍异常角色数 2/3，
 *   额外能力门控），影画1 再 +20。引擎异常结算区已有 EV 乘区（calcAnomalyCritExpect = 1+率×伤，
 *   爱芮异放暴击同通道）——不造新乘区。
 * - 异放（普罗米娅绝裁同款固定 releaseMultiplier 通道）：
 *   长按普攻 1641005（225+20×(s-1)，s=普攻技能等级）、终结技 1641013（300+27×(s-1)）、
 *   影画6 强特 200% + releaseModifier 无视 15% 防御（异放限定）。
 * - [余火]→长按普攻：燃烧攻击行 attack_data（引擎收集为 totalSpecialResourceRecovery）×
 *   影画1 获取效率 1.15 / 90 = 次数（buildExecutions 产行 + estimateExSpecialTime 同源计时）。
 * - [蓄能]附加攻击 1641021：次数 = 强特二段 + 长按普攻 + 终结（重击命中来源）。
 * - 影画2 焚化积蓄效率 +15%×覆盖率；第二段回 8 能量（行级）；影画4 长按普攻 +200 喧响（行级）。
 *
 * 未建模（spec notes 在册）：[重生]/[消亡]状态机、影画2 保留段数、队友向脆弱异常暴击。
 */
import type {
  AgentCharConfigInput,
  AgentExSpecialTimeInput,
  AgentEventInput,
  AgentMechanicModule,
  AgentPanelInput,
  AgentResourceInput,
  AgentResourceResultInput,
  AgentResourceSectionsInput,
  ReleaseModifierInput,
} from '../types'
import type { MechanicSetting } from '@/types/resource'

export const PHOENIX_ID = '1641'
/** 核心被动：异常精通 +40 */
export const PHOENIX_CORE_PROFICIENCY = 40
/** [脆弱]：基础暴击率 30%、暴伤 15%；掌控>145 每点 +0.7% 率 */
export const PHOENIX_WEAKNESS_CRIT_RATE = 30
export const PHOENIX_WEAKNESS_CRIT_DMG = 15
export const PHOENIX_WEAKNESS_MASTERY_THRESHOLD = 145
export const PHOENIX_WEAKNESS_PER_POINT_RATE = 0.7
/** 额外能力：队伍异常角色数 2/3 → 脆弱暴伤提升为 25/40（门控 additionalAbilityActive） */
export const PHOENIX_WEAKNESS_CRIT_DMG_BY_COUNT: Record<number, number> = { 1: 15, 2: 25, 3: 40 }
/** 影画1：脆弱目标异常伤害触发暴击时暴伤 +20（近似为自身异常暴伤面板 +20） */
export const PHOENIX_C1_CRIT_DMG = 20
/** 影画1：燃烧攻击余火获取效率 +15% */
export const PHOENIX_C1_EMBER_EFFICIENCY = 15
/** 影画2：焚化下异常积蓄效率 +15% × 覆盖率；第二段回 8 能量 */
export const PHOENIX_C2_BUILDUP_EFF = 15
export const PHOENIX_C2_EX2_ENERGY = 8
/** 影画4：长按普攻 +200 喧响 */
export const PHOENIX_C4_CHARGED_DECIBEL = 200
/** 影画6：异放无视 15% 防御 */
export const PHOENIX_C6_RELEASE_DEF_IGNORE = 15

/** moveId（param 空间） */
export const PHOENIX_CHARGED_MOVE_ID = '1641005' // 普通攻击：普通攻击长按（消耗 90 余火）
export const PHOENIX_EX1_MOVE_ID = '1641008' // 强化特殊技：第一段
export const PHOENIX_EX2_MOVE_ID = '1641009' // 强化特殊技：第二段
export const PHOENIX_ENERGIZE_MOVE_ID = '1641021' // 蓄能附加攻击（视为强化特殊技）
export const PHOENIX_ULT_MOVE_ID = '1641013' // 终结技
/** 长按普攻消耗余火 */
export const PHOENIX_CHARGED_EMBER_COST = 90
/** 异放固定倍率（满级 s=12）：长按普攻 225+20×11=445、终结 300+27×11=597、影画6 强特 200 */
export const PHOENIX_RELEASE_BASE = { charged: 225, chargedPerLevel: 20, ult: 300, ultPerLevel: 27, c6Ex: 200 } as const
/** 通用技能等级口径：影画3 +2、影画5 累计 +4 */
export function phoenixSkillLevel(cinemaLevel: number): number {
  const cinema = Math.max(0, Math.floor(cinemaLevel))
  return 12 + (cinema >= 5 ? 4 : cinema >= 3 ? 2 : 0)
}

function setting(cfg: AgentCharConfigInput['cfg'], id: string, fallback: number): number {
  const v = Number((cfg as unknown as Record<string, unknown>)[`setting:${id}`])
  return Number.isFinite(v) ? v : fallback
}
function settingOf(settings: Readonly<Record<string, number>>, id: string, fallback: number): number {
  const v = Number(settings?.[id])
  return Number.isFinite(v) ? v : fallback
}
function whole(value: number): number { return Math.max(0, Math.floor(Number.isFinite(value) ? value : 0)) }
function clamp01(value: number): number { return Math.max(0, Math.min(1, value)) }

export interface PhoenixCycle {
  cinemaLevel: number
  additionalActive: boolean
  coreProficiency: number
  weaknessCritRate: number
  weaknessCritDmg: number
  c1CritDmg: number
  teamAnomalyCount: number
  c2BuildUpEff: number
  emberGain: number
  chargedCount: number
  note: string
}

/** 脆弱异常暴击：率 = 30 + 0.7×(掌控-145)；伤 = 15/25/40（队伍异常数，需额外能力门控） */
export function computePhoenixWeaknessCrit(input: {
  anomalyMastery: number
  additionalActive: boolean
  teamAnomalyCount: number
  cinemaLevel: number
}): { rate: number; dmg: number } {
  const mastery = Math.max(0, Number.isFinite(input.anomalyMastery) ? input.anomalyMastery : 0)
  const rate = PHOENIX_WEAKNESS_CRIT_RATE
    + Math.max(0, mastery - PHOENIX_WEAKNESS_MASTERY_THRESHOLD) * PHOENIX_WEAKNESS_PER_POINT_RATE
  // 影画6：额外能力所需异常角色数 -1 → 同等编成下档位更高
  const effectiveCount = Math.min(3, Math.max(1, input.teamAnomalyCount + (input.cinemaLevel >= 6 ? 1 : 0)))
  const tierDmg = input.additionalActive
    ? (PHOENIX_WEAKNESS_CRIT_DMG_BY_COUNT[effectiveCount] ?? PHOENIX_WEAKNESS_CRIT_DMG)
    : PHOENIX_WEAKNESS_CRIT_DMG
  const c1 = input.cinemaLevel >= 1 ? PHOENIX_C1_CRIT_DMG : 0
  return { rate, dmg: tierDmg + c1 }
}

/** 长按普攻次数（估时与物化唯一共用入口）：floor(余火收入×效率/90)，滑块覆盖优先 */
export function phoenixChargedCount(cfg: AgentCharConfigInput['cfg'], executions: AgentResourceInput['executions']): number {
  const override = setting(cfg, 'phoenix.chargedAttackCount', 0)
  if (override > 0) return whole(override)
  const cinema = whole(Number((cfg as unknown as Record<string, unknown>).phoenixCinemaLevel ?? 0))
  const emberGain = Math.max(0, executions.reduce((s, e) => s + (e.totalSpecialResourceRecovery ?? 0), 0))
  const eff = cinema >= 1 ? 1 + PHOENIX_C1_EMBER_EFFICIENCY / 100 : 1
  return Math.floor(emberGain * eff / PHOENIX_CHARGED_EMBER_COST)
}

function buildPhoenixCharConfig({ cfg, cinemaLevel, panel, skills }: AgentCharConfigInput): void {
  const record = cfg as unknown as Record<string, unknown>
  record.phoenixCinemaLevel = cinemaLevel
  record.phoenixAdditionalActive = (panel.additionalAbilityActive ?? 0) > 0
  record.phoenixAnomalyMastery = panel.anomalyMastery ?? 0
  record.phoenixTeamAnomalyCount = Math.max(1, Math.min(3, Math.round(setting(cfg, 'phoenix.teamAnomalyCount', 2))))
  // 影画4：长按普攻 +200 喧响/次——行级 decibel 会被 enrich 按倍率表回填，改走 initialDecibelGift。
  // 次数：滑块覆盖优先；自动按 战斗时长/15s 一次长按普攻估算 [猜测·低]（余火循环收敛值在 buildExecutions 才有）。
  if (cinemaLevel >= 4) {
    const override = setting(cfg, 'phoenix.chargedAttackCount', 0)
    const count = override > 0 ? whole(override) : Math.max(0, Math.floor((cfg.battleTime ?? 180) / 15))
    cfg.initialDecibelGift = (cfg.initialDecibelGift ?? 0) + PHOENIX_C4_CHARGED_DECIBEL * count
  }
  // 强化特殊技走通用通道：第一段（能量消耗 60 [猜测·低]）
  const special = skills?.categories?.find(c => c.id === 'special')?.moves?.find(m => m.id === PHOENIX_EX1_MOVE_ID)
  if (special) {
    cfg.exSpecialMoveId = PHOENIX_EX1_MOVE_ID
    if (special.actionTime) cfg.exSpecialActionTime = special.actionTime
    const ec = parseFloat(special.energyCost?.['Energy Cost'] ?? '')
    if (Number.isFinite(ec) && ec > 0) cfg.exSpecialEnergyConsume = ec
  }
  const all = skills?.categories?.flatMap(c => c.moves ?? []) ?? []
  const metaOf = (moveId: string) => {
    const m = all.find(mm => mm.id === moveId)
    return {
      moveId,
      actionTime: m?.actionTime ?? 0,
      damage: m?.rows?.find(r => r.id === 'damage')?.values?.[0] ?? 0,
      decibelRecovery: m?.rows?.find(r => r.id === 'decibel_recovery')?.values?.[0] ?? 0,
    }
  }
  record.phoenixChargedMeta = metaOf(PHOENIX_CHARGED_MOVE_ID)
  record.phoenixEx2Meta = metaOf(PHOENIX_EX2_MOVE_ID)
  record.phoenixEnergizeMeta = metaOf(PHOENIX_ENERGIZE_MOVE_ID)
}

function applyPhoenixPanel({ cinemaLevel, outOfCombatPanel, panel, settings }: AgentPanelInput): void {
  if (!panel) return
  panel.anomalyProficiency = (panel.anomalyProficiency ?? 0) + PHOENIX_CORE_PROFICIENCY
  const teamCount = Math.max(1, Math.min(3, Math.round(settingOf(settings, 'phoenix.teamAnomalyCount', 2))))
  const weakness = computePhoenixWeaknessCrit({
    // 掌控取局外面板（applyPanel 期局内掌控尚未定型；掌控词条来自驱动盘，局外局内同值）
    anomalyMastery: outOfCombatPanel?.anomalyMastery ?? panel.anomalyMastery ?? 0,
    additionalActive: (panel.additionalAbilityActive ?? 0) > 0,
    teamAnomalyCount: teamCount,
    cinemaLevel,
  })
  panel.anomalyCritRate = (panel.anomalyCritRate ?? 0) + weakness.rate
  panel.anomalyCritDmg = (panel.anomalyCritDmg ?? 0) + weakness.dmg
  if (cinemaLevel >= 2) {
    const cov = clamp01(settingOf(settings, 'phoenix.c2IncinerationCoverage', 1))
    panel.anomalyBuildUpEfficiency = (panel.anomalyBuildUpEfficiency ?? 0) + PHOENIX_C2_BUILDUP_EFF * cov
  }
  // releaseModifier 用（影画6 异放限定无视防御需读命座）
  ;(panel as unknown as Record<string, unknown>).phoenixCinemaLevel = cinemaLevel
}

/** 影画6：异放限定无视 15% 防御（普罗米娅同款通道） */
function phoenixReleaseModifier({ panels }: ReleaseModifierInput): { enemyResReduction: number; enemyDefReduction?: number; note: string } {
  const phoenix = panels.find(p => (p as Record<string, unknown>).phoenixCinemaLevel !== undefined)
  const cinema = phoenix ? Number((phoenix as Record<string, unknown>).phoenixCinemaLevel ?? 0) : 0
  return cinema >= 6
    ? { enemyResReduction: 0, enemyDefReduction: PHOENIX_C6_RELEASE_DEF_IGNORE, note: `；影画6：异放无视 ${PHOENIX_C6_RELEASE_DEF_IGNORE}% 防御（releaseModifier 异放限定）` }
    : { enemyResReduction: 0, note: '' }
}

/** 长按普攻/强化特殊技第二段/蓄能附加攻击执行行 */
function buildPhoenixExecutions({ cfg, state, executions }: AgentResourceInput): void {
  const record = cfg as unknown as Record<string, unknown>
  const cinema = whole(Number(record.phoenixCinemaLevel ?? 0))
  const chargedCount = phoenixChargedCount(cfg, executions)
  record.phoenixChargedCount = chargedCount
  const exCount = Math.max(0, Number(state.exSpecialCount ?? 0))
  const ultCount = Math.max(0, Number(state.ultimateCount ?? 0))

  const chargedMeta = record.phoenixChargedMeta as { moveId: string; actionTime: number } | undefined
  if (chargedMeta && chargedCount > 0) {
    executions.push({
      moveId: chargedMeta.moveId,
      moveName: '普通攻击：普通攻击长按（消耗90余火）',
      category: 'basic',
      element: 'fire',
      count: chargedCount,
      actionTime: chargedMeta.actionTime,
      comboAlignRatio: 0,
      totalTime: chargedCount * chargedMeta.actionTime,
      totalComboAlignTime: 0,
      energyConsume: 0,
      totalEnergyConsume: 0,
      // 影画4 喧响走 initialDecibelGift（行级 decibel 会被 enrich 按倍率表回填）
      skillTableNote: `余火驱动 ×${chargedCount}${cinema >= 4 ? `；影画4 +${PHOENIX_C4_CHARGED_DECIBEL} 喧响/次（initialDecibelGift）` : ''}`,
    })
  }
  // 强化特殊技第二段：按「每轮强特 = 第一段→第二段」近似 [猜测·低]；影画2 回 8 能量挂行级
  const ex2Meta = record.phoenixEx2Meta as { moveId: string; actionTime: number } | undefined
  if (ex2Meta && exCount > 0) {
    executions.push({
      moveId: ex2Meta.moveId,
      moveName: '强化特殊技：第二段',
      category: 'special',
      element: 'fire',
      count: exCount,
      actionTime: ex2Meta.actionTime,
      comboAlignRatio: 0,
      totalTime: exCount * ex2Meta.actionTime,
      totalComboAlignTime: 0,
      energyConsume: 0,
      totalEnergyConsume: 0,
      energyRecovery: cinema >= 2 ? PHOENIX_C2_EX2_ENERGY : 0,
      totalEnergyRecovery: exCount * (cinema >= 2 ? PHOENIX_C2_EX2_ENERGY : 0),
      skillTableNote: '每轮强特按两段近似（第二段能量消耗未计）',
    })
  }
  // 蓄能附加攻击（视为强化特殊技）：重击命中来源 = 强特二段 + 长按普攻 + 终结
  const energizeCount = exCount + chargedCount + ultCount
  const energizeMeta = record.phoenixEnergizeMeta as { moveId: string; actionTime: number } | undefined
  if (energizeMeta && energizeCount > 0) {
    executions.push({
      moveId: energizeMeta.moveId,
      moveName: '蓄能附加攻击（视为强化特殊技）',
      category: 'special',
      element: 'fire',
      count: energizeCount,
      actionTime: energizeMeta.actionTime,
      comboAlignRatio: 0,
      totalTime: 0,
      totalComboAlignTime: 0,
      energyConsume: 0,
      totalEnergyConsume: 0,
      skillTableNote: `重击命中送 ×${energizeCount}（强特二段+长按普攻+终结；附加攻击不占前台时间）`,
    })
  }
}

/** 必做前台时间：长按普攻 + 强特第二段（长按普攻次数读上一轮 buildExecutions 的收敛值） */
function phoenixExSpecialTime({ cfg, exSpecialCount }: AgentExSpecialTimeInput): { necessaryTime: number; comboAlignTime: number } {
  const record = cfg as unknown as Record<string, unknown>
  const exTime = Math.max(0, exSpecialCount) * (cfg.exSpecialActionTime ?? 0)
  const chargedMeta = record.phoenixChargedMeta as { actionTime: number } | undefined
  const ex2Meta = record.phoenixEx2Meta as { actionTime: number } | undefined
  const chargedCount = whole(Number(record.phoenixChargedCount ?? 0))
  const ex2Time = ex2Meta ? Math.max(0, exSpecialCount) * ex2Meta.actionTime : 0
  const chargedTime = chargedMeta ? chargedCount * chargedMeta.actionTime : 0
  return {
    necessaryTime: exTime + ex2Time + chargedTime,
    comboAlignTime: exTime * (cfg.exSpecialComboAlignRatio ?? 0),
  }
}

/** 异放事件：长按普攻终结一击 + 终结技终结一击（+ 影画6 强特） */
function buildPhoenixAnomalyEvents({ cfg, state, events, totalTime }: AgentEventInput): void {
  const record = cfg as unknown as Record<string, unknown>
  const cinema = whole(Number(record.phoenixCinemaLevel ?? 0))
  const s = phoenixSkillLevel(cinema)
  const coverage = clamp01(setting(cfg, 'phoenix.releaseCoverage', 1))
  if (coverage <= 0) return
  const chargedCount = whole(Number(record.phoenixChargedCount ?? 0))
  const exCount = Math.max(0, Number(state.exSpecialCount ?? 0))
  const ultCount = Math.max(0, Number(state.ultimateCount ?? 0))

  const chargedRelease = Math.round(chargedCount * coverage)
  if (chargedRelease > 0) {
    const mult = PHOENIX_RELEASE_BASE.charged + PHOENIX_RELEASE_BASE.chargedPerLevel * (s - 1)
    events.push({
      eventId: 'phoenix_charged_release',
      eventName: '长按普攻终结一击·异放',
      eventType: 'release',
      element: 'dominant',
      carrierMoveId: PHOENIX_CHARGED_MOVE_ID,
      carrierMoveName: '普通攻击：普通攻击长按（终结一击）',
      followCarrierInStun: true,
      count: chargedRelease,
      formula: `releaseMultiplier=${mult}（225+20×(${s}-1)，固定倍率）`,
      fields: [`releaseMultiplier=${mult}`, `charged=${chargedCount}`, `coverage=${coverage}`],
      note: `终结一击命中属性异常状态敌人触发（异常队默认满覆盖，滑块 phoenix.releaseCoverage）；元素按目标当前异常分配。`,
    })
  }
  const ultRelease = Math.round(ultCount * coverage)
  if (ultRelease > 0) {
    const mult = PHOENIX_RELEASE_BASE.ult + PHOENIX_RELEASE_BASE.ultPerLevel * (s - 1)
    events.push({
      eventId: 'phoenix_ultimate_release',
      eventName: '终结技终结一击·异放',
      eventType: 'release',
      element: 'dominant',
      carrierMoveId: PHOENIX_ULT_MOVE_ID,
      carrierMoveName: '终结技（终结一击）',
      followCarrierInStun: true,
      count: ultRelease,
      formula: `releaseMultiplier=${mult}（300+27×(${s}-1)，固定倍率）`,
      fields: [`releaseMultiplier=${mult}`, `ult=${ultCount}`, `coverage=${coverage}`],
      note: '终结一击命中属性异常状态敌人触发；元素按目标当前异常分配。',
    })
  }
  if (cinema >= 6) {
    const c6Release = Math.round(exCount * coverage)
    if (c6Release > 0) {
      events.push({
        eventId: 'phoenix_c6_ex_release',
        eventName: '影画6·强化特殊技异放',
        eventType: 'release',
        element: 'dominant',
        carrierMoveId: PHOENIX_EX2_MOVE_ID,
        carrierMoveName: '强化特殊技：第二段（终结一击）',
        followCarrierInStun: true,
        count: c6Release,
        formula: `releaseMultiplier=${PHOENIX_RELEASE_BASE.c6Ex}（固定倍率）`,
        fields: [`releaseMultiplier=${PHOENIX_RELEASE_BASE.c6Ex}`, `ex=${exCount}`],
        note: `影画6：终结一击命中异常状态敌人触发 1 次异放 200%，异放无视 15% 防御（releaseModifier）。整局约 ${totalTime}s。`,
      })
    }
  }
}

function buildPhoenixResourceResult({ cfg }: AgentResourceResultInput) {
  const record = cfg as unknown as Record<string, unknown>
  const cinema = whole(Number(record.phoenixCinemaLevel ?? 0))
  const additionalActive = record.phoenixAdditionalActive === true
  const teamCount = Math.max(1, Math.min(3, Math.round(Number(record.phoenixTeamAnomalyCount ?? 2))))
  const chargedCount = whole(Number(record.phoenixChargedCount ?? 0))
  const weakness = computePhoenixWeaknessCrit({
    anomalyMastery: Number(record.phoenixAnomalyMastery ?? 0),
    additionalActive,
    teamAnomalyCount: teamCount,
    cinemaLevel: cinema,
  })
  return {
    specResources: {
      phoenix_cycle: {
        cinemaLevel: cinema,
        additionalActive,
        coreProficiency: PHOENIX_CORE_PROFICIENCY,
        weaknessCritRate: Math.round(weakness.rate * 100) / 100,
        weaknessCritDmg: weakness.dmg,
        c1CritDmg: cinema >= 1 ? PHOENIX_C1_CRIT_DMG : 0,
        teamAnomalyCount: Math.min(3, teamCount + (cinema >= 6 ? 1 : 0)),
        c2BuildUpEff: cinema >= 2 ? PHOENIX_C2_BUILDUP_EFF : 0,
        emberGain: 0,
        chargedCount,
        note: '重生/消亡状态机与队友向脆弱异常暴击未建模；余火按总量口径。',
      } as PhoenixCycle,
    },
  }
}

function buildPhoenixResourceSections({ result }: AgentResourceSectionsInput) {
  const cycle = result.specResources?.phoenix_cycle as PhoenixCycle | undefined
  if (!cycle) return []
  return [{
    id: 'phoenix-cycle',
    title: '菲欧妮·脆弱与余火',
    summary: `异常精通 +${cycle.coreProficiency} · 脆弱暴击 率${Math.round(cycle.weaknessCritRate * 100) / 100}%/伤${cycle.weaknessCritDmg}% · 长按普攻 ×${cycle.chargedCount}`,
    rows: [
      { label: '核心异常精通', value: `+${cycle.coreProficiency}`, detail: '计入面板' },
      { label: '脆弱异常暴击率', value: `${cycle.weaknessCritRate}%`, detail: '30 + 0.7×(掌控-145)' },
      { label: '脆弱异常暴伤', value: `${cycle.weaknessCritDmg}%`, detail: `队伍异常数${cycle.teamAnomalyCount}${cycle.additionalActive ? '（额外能力已触发）' : '（额外能力未触发）'}${cycle.cinemaLevel >= 1 ? ' +影画1 20' : ''}` },
      { label: '影画2焚化积蓄效率', value: `+${cycle.c2BuildUpEff}%`, detail: '×覆盖率' },
      { label: '长按普攻次数', value: `×${cycle.chargedCount}`, detail: '余火收入/90' },
    ],
    footer: cycle.note,
  }]
}

const settings: MechanicSetting[] = [
  {
    id: 'phoenix.teamAnomalyCount',
    label: '菲欧妮·队伍异常角色数',
    description: '额外能力档位：队伍[异常]角色数 2/3 → 脆弱暴伤 25%/40%（1=仅自己=基础15%；影画6 需求-1 按同编成档位+1 自动处理）。',
    default: 2,
    min: 1,
    max: 3,
    step: 1,
    suffix: '名',
  },
  {
    id: 'phoenix.chargedAttackCount',
    label: '菲欧妮·长按普攻次数覆盖',
    description: '手动指定整局长按普通攻击（消耗90余火）次数；0=自动（燃烧攻击行 attack_data 余火收入×影画1效率1.15/90）。',
    default: 0,
    min: 0,
    max: 40,
    step: 1,
    suffix: '次',
  },
  {
    id: 'phoenix.releaseCoverage',
    label: '菲欧妮·异放触发覆盖率',
    description: '长按普攻/终结技/影画6 强特的终结一击命中「属性异常状态敌人」的占比（异常队默认满覆盖）。',
    default: 1,
    min: 0,
    max: 1,
    step: 0.05,
    suffix: '%',
  },
  {
    id: 'phoenix.c2IncinerationCoverage',
    label: '菲欧妮·影画2焚化覆盖率',
    description: '影画2 [焚化]状态（强特进入10秒，燃烧攻击命中刷新）的整局覆盖率——异常积蓄效率+15%。',
    default: 1,
    min: 0,
    max: 1,
    step: 0.05,
    suffix: '%',
  },
]

export const phoenixMechanic: AgentMechanicModule = {
  id: 'agent:phoenix',
  agentIds: [PHOENIX_ID],
  name: '菲欧妮·脆弱',
  description: '⚠️3.3 测试服临时录入：核心异常精通+40、脆弱异常暴击（EV 乘区，率30+0.7×(掌控-145)/伤15-40+影画1 20）；长按普攻/终结/影画6 异放（固定 releaseMultiplier，普罗米娅同款）；余火→长按普攻计数；影画2 焚化积蓄效率、影画4 喧响、蓄能附加攻击。',
  applyPanel: applyPhoenixPanel,
  buildCharConfig: buildPhoenixCharConfig,
  estimateExSpecialTime: phoenixExSpecialTime,
  buildExecutions: buildPhoenixExecutions,
  buildAnomalyEvents: buildPhoenixAnomalyEvents,
  buildResourceResult: buildPhoenixResourceResult,
  resourceSections: buildPhoenixResourceSections,
  releaseModifier: phoenixReleaseModifier,
  settings,
}

export default phoenixMechanic
