/**
 * 照（1341）—— 整局近似口径
 *
 * 原文来源：data/raw/nanoka_missing/full/1341.json。
 * - 核心 Lv.12：每 1000 点初始最大生命值提高 1.4% 暴击率；影画6 将该效果提升至 125%。
 * - 影画2：生命回复触发后，自身攻击 +20%（50 秒，整局按满覆盖）。
 * - 影画4：开启帷幕获得 250 喧响；终结技、连携技、最终裁决暴伤 +40%。
 * - 霜寒值循环（用户口径 2026-08-26）：照不战场，只打 E（流霜冻土，合轴不耗时间）+ Q（终结技）积攒霜寒值；
 *   进场 100 + 强特 20 + 终结 20 + 队友命中 6/3s；霜寒值满（100）直接消耗开帷幕（登场技·霜迸），
 *   并在后台蓄力一次「普通攻击：最终裁决」（蓄力最多5秒）。
 * - 最终裁决蓄力生命附伤（影画6 接线）：每 1 秒蓄力时长造成 23% 最大生命值额外伤害（Lv.12 = 0.12+11×0.01），
 *   满蓄 5 秒 = 115% 最大生命值；影画6 提升至 140% 且蓄力时长不消耗（恒满 5 秒）。
 *   附伤走 flatDamageBonus（卢西娅[合唱]先例），落在最终裁决(1341008)行，后台行不占前台时间。
 */
import type {
  AgentCharConfigInput,
  AgentExSpecialTimeEstimate,
  AgentExSpecialTimeInput,
  AgentMechanicModule,
  AgentPanelInput,
  AgentResourceInput,
  AgentResourceResultInput,
  AgentResourceSectionsInput,
} from '../types'

export const ZHAO_ID = '1341'
export const ZHAO_CORE_CRIT_PER_1000_HP = 1.4
export const ZHAO_C6_CORE_MULTIPLIER = 1.25
export const ZHAO_C2_SELF_ATK_PCT = 20
export const ZHAO_C4_DECIBEL = 250
export const ZHAO_C4_CRIT_DMG = 40

export const ZHAO_C4_MOVE_IDS = new Set([
  '1341008', // 普通攻击：最终裁决
  '1341013', // 连携技：临时合作
  '1341014', // 终结技：兔兔连斩 #1
  '1341023', // 终结技：兔兔连斩 #2
])

/** 最终裁决蓄力生命附伤 */
export const ZHAO_VERDICT_MOVE_ID = '1341008'
export const ZHAO_VERDICT_ACTION_TIME = 0.475
export const ZHAO_CHARGE_MAX_SECONDS = 5
/** 每 1 秒蓄力时长 = 0.12 + 11×0.01 = 0.23（Lv.12）最大生命值 */
export const ZHAO_CHARGE_LIFE_RATIO = 0.23
export const ZHAO_C6_CHARGE_MULTIPLIER = 1.4
/** 霜寒值 */
export const ZHAO_FROST_INITIAL = 100
export const ZHAO_FROST_CAP = 100
export const ZHAO_EX_FROST_GAIN = 20
export const ZHAO_ULT_FROST_GAIN = 20
export const ZHAO_TEAMMATE_FROST_GAIN = 6
export const ZHAO_TEAMMATE_FROST_INTERVAL = 3

export interface ZhaoFrostCycle {
  cinemaLevel: number
  exSpecialCount: number
  ultimateCount: number
  teammateAttackCount: number
  frostTotal: number
  veilCount: number
  verdictCount: number
  chargeLifePerHit: number
  note: string
}

function applyPanel({ cinemaLevel, outOfCombatPanel, panel }: AgentPanelInput): void {
  const hp = Math.max(0, Number(outOfCombatPanel.hp ?? 0))
  const coreMultiplier = cinemaLevel >= 6 ? ZHAO_C6_CORE_MULTIPLIER : 1
  const coreCritRate = hp / 1000 * ZHAO_CORE_CRIT_PER_1000_HP * coreMultiplier
  panel.critRate = (panel.critRate ?? 0) + coreCritRate
  panel.zhaoCoreCritRate = coreCritRate

  if (cinemaLevel >= 2) {
    const selfAtkBonus = Math.max(0, Number(outOfCombatPanel.atk ?? 0)) * ZHAO_C2_SELF_ATK_PCT / 100
    panel.atk = (panel.atk ?? 0) + selfAtkBonus
    panel.zhaoCinema2SelfAtk = selfAtkBonus
  }
}

function buildCharConfig({ cinemaLevel, cfg }: AgentCharConfigInput): void {
  const record = cfg as unknown as Record<string, unknown>
  record.zhaoCinemaLevel = cinemaLevel ?? 0
  if ((cinemaLevel ?? 0) >= 4) {
    cfg.initialDecibelGift = (cfg.initialDecibelGift ?? 0) + ZHAO_C4_DECIBEL
  }
  // 照不战场（用户口径）：Q（终结技·兔兔连斩）打一半可快速支援取消，另一半进合轴，
  // 前台时间只按一半计；E（流霜冻土）前台时间见 estimateExSpecialTime（全合轴=0）。
  cfg.ultimateActionTime = (cfg.ultimateActionTime ?? 0) / 2
}

/** 照的 E（流霜冻土）完全合轴，不占前台时间；后台蓄力最终裁决走 timeBucket=backstage，也不算前台。 */
// @fact agent:1341/EQ合轴 口径: 照不战场，就 E+Q；E(流霜冻土)全合轴不占前台，Q(终结技·兔兔连斩)打一半能快速支援取消→前台时间减半；后台蓄力最终裁决走 timeBucket=backstage 不算前台 | 据 用户@2026-09 | 验 src/mechanics/__tests__/zhao.test.ts | 锚 src/mechanics/agents/zhao.ts#estimateExSpecialTime | 信 确认
function estimateExSpecialTime({ cfg, exSpecialCount }: AgentExSpecialTimeInput): AgentExSpecialTimeEstimate {
  return {
    necessaryTime: 0,
    comboAlignTime: Math.max(0, Math.floor(exSpecialCount ?? 0)) * (cfg.exSpecialActionTime ?? 0),
    // NET 约定：E 已从 necessaryTime 剔除（不占前台），合轴不再抵扣团队预算（防双重记账）
    comboAlignIncludedInNecessary: false,
  }
}

function computeZhaoFrostCycle(input: {
  cinemaLevel: number
  exSpecialCount: number
  ultimateCount: number
  teamFrontlineSeconds: number
  panelHp: number
}): ZhaoFrostCycle {
  const cinemaLevel = Math.max(0, Math.floor(input.cinemaLevel))
  const exSpecialCount = Math.max(0, Math.floor(input.exSpecialCount))
  const ultimateCount = Math.max(0, Math.floor(input.ultimateCount))
  const teammateAttackCount = Math.max(0, Math.floor(input.teamFrontlineSeconds / ZHAO_TEAMMATE_FROST_INTERVAL))
  const frostTotal = ZHAO_FROST_INITIAL
    + exSpecialCount * ZHAO_EX_FROST_GAIN
    + ultimateCount * ZHAO_ULT_FROST_GAIN
    + teammateAttackCount * ZHAO_TEAMMATE_FROST_GAIN
  const veilCount = Math.floor(frostTotal / ZHAO_FROST_CAP)
  const panelHp = Math.max(0, Number(input.panelHp))
  const chargeLifePerHit = panelHp * ZHAO_CHARGE_MAX_SECONDS * ZHAO_CHARGE_LIFE_RATIO
    * (cinemaLevel >= 6 ? ZHAO_C6_CHARGE_MULTIPLIER : 1)
  return {
    cinemaLevel,
    exSpecialCount,
    ultimateCount,
    teammateAttackCount,
    frostTotal,
    veilCount,
    verdictCount: veilCount,
    chargeLifePerHit,
    note: '霜寒值满→开帷幕→后台蓄力最终裁决一次；蓄力生命附伤按满蓄5秒（影画6×1.4且不消耗）flatDamageBonus。',
  }
}

function cycleFromInput({ cfg, state, teamFrontlineSeconds }: AgentResourceInput): ZhaoFrostCycle {
  const record = cfg as unknown as Record<string, unknown>
  return computeZhaoFrostCycle({
    cinemaLevel: Number(record.zhaoCinemaLevel ?? 0),
    exSpecialCount: state.exSpecialCount,
    ultimateCount: state.ultimateCount,
    teamFrontlineSeconds: teamFrontlineSeconds ?? 0,
    panelHp: Number(cfg.panel.hp ?? 0),
  })
}

function buildZhaoExecutions(input: AgentResourceInput): void {
  const cycle = cycleFromInput(input)
  if (cycle.verdictCount <= 0) return
  input.executions.push({
    moveId: ZHAO_VERDICT_MOVE_ID,
    moveName: '普通攻击：最终裁决（蓄力生命附伤）',
    category: 'basic',
    element: 'ice',
    count: cycle.verdictCount,
    actionTime: ZHAO_VERDICT_ACTION_TIME,
    comboAlignRatio: 0,
    totalTime: cycle.verdictCount * ZHAO_VERDICT_ACTION_TIME,
    totalComboAlignTime: 0,
    energyConsume: 0,
    totalEnergyConsume: 0,
    decibelRecovery: 0,
    totalDecibelRecovery: 0,
    energyRecovery: 0,
    totalEnergyRecovery: 0,
    flatDamageBonus: cycle.chargeLifePerHit,
    timeBucket: 'backstage',
  })
}

function patchExecutions({ cfg, executions }: AgentResourceInput): void {
  const cinemaLevel = Math.max(0, Math.floor(Number((cfg as any).zhaoCinemaLevel ?? 0)))
  if (cinemaLevel < 4) return
  for (const exec of executions) {
    if (!exec.moveId || !ZHAO_C4_MOVE_IDS.has(exec.moveId)) continue
    exec.critDmgBonus = (exec.critDmgBonus ?? 0) + ZHAO_C4_CRIT_DMG
  }
}

function buildResourceResult({ cfg, state, teamFrontlineSeconds }: AgentResourceResultInput) {
  const record = cfg as unknown as Record<string, unknown>
  const cycle = computeZhaoFrostCycle({
    cinemaLevel: Number(record.zhaoCinemaLevel ?? 0),
    exSpecialCount: state.exSpecialCount,
    ultimateCount: state.ultimateCount,
    teamFrontlineSeconds: teamFrontlineSeconds ?? 0,
    panelHp: Number(cfg.panel.hp ?? 0),
  })
  return { specResources: { zhao_frost: cycle } }
}

/** 照：霜寒值满开帷幕次数（总量口径；队友命中按战斗时间近似——postRound 无队友前台秒数）。
 * 供队伍级帷幕通道（teamVeil.ts 汇总全队帷幕次数，喂叶瞬光溯影惊鸿/爱芮合作舞台/千夏磨爪器）复用。 */
export function computeZhaoVeilCount(exSpecialCount: number, ultimateCount: number, combatTime = 180): number {
  const teammateAttackCount = Math.max(0, Math.floor(Math.max(0, combatTime) / ZHAO_TEAMMATE_FROST_INTERVAL))
  const frostTotal = ZHAO_FROST_INITIAL
    + Math.max(0, Math.floor(exSpecialCount)) * ZHAO_EX_FROST_GAIN
    + Math.max(0, Math.floor(ultimateCount)) * ZHAO_ULT_FROST_GAIN
    + teammateAttackCount * ZHAO_TEAMMATE_FROST_GAIN
  return Math.floor(frostTotal / ZHAO_FROST_CAP)
}

function buildResourceSections({ result }: AgentResourceSectionsInput) {
  const cycle = result.specResources?.zhao_frost as ZhaoFrostCycle | undefined
  if (!cycle) return []
  return [{
    id: 'zhao-frost',
    title: '照·霜寒值',
    summary: `霜寒值 ${cycle.frostTotal} · 开帷幕 ${cycle.veilCount} 次 · 最终裁决 ${cycle.verdictCount} 次`,
    rows: [
      { label: '霜寒值来源', value: `${cycle.frostTotal}`, detail: `进场${ZHAO_FROST_INITIAL} + 强特${cycle.exSpecialCount}×${ZHAO_EX_FROST_GAIN} + 终结${cycle.ultimateCount}×${ZHAO_ULT_FROST_GAIN} + 队友命中${cycle.teammateAttackCount}×${ZHAO_TEAMMATE_FROST_GAIN}` },
      { label: '开帷幕', value: `${cycle.veilCount} 次`, detail: `霜寒值满 ${ZHAO_FROST_CAP} 消耗开帷幕（登场技·霜迸）` },
      { label: '最终裁决蓄力附伤', value: `${cycle.chargeLifePerHit.toFixed(0)}/次`, detail: `满蓄${ZHAO_CHARGE_MAX_SECONDS}秒×${(ZHAO_CHARGE_LIFE_RATIO * 100).toFixed(1)}%最大生命${cycle.cinemaLevel >= 6 ? '×1.4' : ''}，后台行` },
    ],
    footer: cycle.note,
  }]
}

export const zhaoMechanic: AgentMechanicModule = {
  id: 'agent:zhao',
  agentIds: [ZHAO_ID],
  name: '照·最佳同事',
  description: '初始生命转暴击、影画2自身增攻、影画4开帷幕喧响与指定招式暴伤、霜寒值循环开帷幕、最终裁决蓄力生命附伤（影画6×1.4）。',
  applyPanel,
  buildCharConfig,
  estimateExSpecialTime,
  buildExecutions: buildZhaoExecutions,
  patchExecutions,
  buildResourceResult,
  resourceSections: buildResourceSections,
}

export default zhaoMechanic
