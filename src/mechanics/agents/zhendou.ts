import type {
  AgentCharConfigInput,
  AgentMechanicModule,
  AgentPanelInput,
  AgentResourceInput,
  AgentResourceResultInput,
  AgentResourceSectionsInput,
  AgentTeamConfigInput,
} from '../types'
import type { SkillExecution } from '@/types/resource'
import { getAgentSpec } from '@/specs/registry'
import { computeSpecResources } from '@/specs/resources'
import { specToMechanicModule } from '@/specs/mechanics'

/**
 * 真斗（1441，命破/火 DPS）—— 整局近似口径
 *
 * 已接管：
 * - 贯穿力转模由引擎命破基底自动结算（atk×0.3 + hp×0.1 + sheerForceFlat，damage.ts RUPTURE_DAMAGE_PROFILE），
 *   不额外转模（般岳/星徽·比利同款：spec attributeConversion 已删除，防 hp×0.1 双计）。
 * - [炽心] 走 spec resource（归烬·舍身蓄力 +100/次、招架支援 +75/次、影画6 失衡 +75/次）；
 *   蓄力次数 = 炽心守恒反推 max(0, ceil((3.3×t − 招架×75 − 影画6×75)/100))，维持熔锋全覆盖。
 * - [残焰] 走 spec resource（终结 +8 / 连携 +4，影画6 失衡 +4）。
 * - 熔锋 buff（炽心≥75 → 暴击率+10%/火伤+20%）：applyPanel 恒常挂（uptime≈100%，用户口径）。
 *
 * 本轮补录（2026-08-27 用户口径）：
 * - 熔锋 uptime≈100%（归烬·舍身 +100 + 招架 +75 获取量足以一直熔锋，用户确认）。
 * - 炽风·胧切/支援突击连续斩击消耗生命时暴伤 +50%（Lv.7）、闪能回复效率 +100%
 *   ——归烬·舍身持续耗血，按常驻近似，patchExecutions 招式限定挂 critDmgBonus（闪能回复效率按未建模标注）。
 * - 影画1·流浪生存法则：生命损失转火伤（每 1% 损失 +0.4%，上限 +20%）——按覆盖率滑块 `zhendou.c1LossCoverage`（默认 0.5）近似。
 * - 影画2·昼夜厨房与爱：熔锋下无视 8% 火抗（enemyFireResReduction +8，熔锋恒常）。
 * - 影画4·幼年的誓言：最大生命 +8%（hpPct +8，经转模 hp×0.1 增贯穿力）；免疫死亡防御向不建模。
 * - 影画6·越过昔年梦：归烬命中失衡敌回 75 炽心 + 4 残焰（20s 一次）+ 支援突击火伤 +3%/层×5层——
 *   归烬回炽心为反馈环（熔锋已恒常，影响小）；支援突击火伤按满层 +15% 挂支援突击行。
 */

const ZHENDOU_ID = '1441'
/** 炽风·胧切（普通攻击连续斩击） */
const MOVE_LONGQIE_1 = '1441009'
const MOVE_LONGQIE_2 = '1441010'
const MOVE_LONGQIE_3 = '1441011'
const MOVE_LONGQIE_4 = '1441012'
/** 支援突击·孤影·断獠 */
const MOVE_ASSIST_1 = '1441024'
const MOVE_ASSIST_2 = '1441025'
/** 耗血暴伤受益招式（炽风·胧切 + 支援突击） */
export const ZHENDOU_HP_DRAIN_MOVE_IDS = new Set([
  MOVE_LONGQIE_1, MOVE_LONGQIE_2, MOVE_LONGQIE_3, MOVE_LONGQIE_4, MOVE_ASSIST_1, MOVE_ASSIST_2,
])
export const ZHENDOU_CORE_CRIT_DMG = 50 // 耗血暴伤 Lv.7
export const ZHENDOU_FURY_CRIT_RATE = 10
export const ZHENDOU_FURY_FIRE_DMG = 20
export const ZHENDOU_C1_FIRE_DMG_CAP = 20
export const ZHENDOU_C2_FIRE_RES_IGNORE = 8
export const ZHENDOU_C4_HP_PCT = 8
export const ZHENDOU_C6_ASSIST_FIRE_DMG = 15

function applyZhendouPanel({ panel, cinemaLevel, settings }: AgentPanelInput): void {
  // 熔锋 buff：恒常（炽心获取量足以一直熔锋，用户口径 2026-08-27）
  panel.critRate = (panel.critRate ?? 0) + ZHENDOU_FURY_CRIT_RATE
  panel.fireDmg = (panel.fireDmg ?? 0) + ZHENDOU_FURY_FIRE_DMG
  if (cinemaLevel >= 1) {
    const cov = Math.max(0, Math.min(1, Number(settings['zhendou.c1LossCoverage'] ?? 0.5)))
    panel.fireDmg = (panel.fireDmg ?? 0) + ZHENDOU_C1_FIRE_DMG_CAP * cov
  }
  if (cinemaLevel >= 2) {
    panel.enemyFireResReduction = (panel.enemyFireResReduction ?? 0) + ZHENDOU_C2_FIRE_RES_IGNORE
  }
  if (cinemaLevel >= 4) {
    panel.hpPct = (panel.hpPct ?? 0) + ZHENDOU_C4_HP_PCT
  }
}

function buildZhendouCharConfig({ cfg, cinemaLevel }: AgentCharConfigInput): void {
  const record = cfg as unknown as Record<string, unknown>
  record.zhendouCinemaLevel = Math.max(0, Math.floor(Number(cinemaLevel ?? 0)))
}

/** 归烬·舍身（特殊技）两段：点按 #1 + 长按蓄力释放 #2（actionTime 来自 catalog） */
const MOVE_GUIJIN_1 = '1441013'
const MOVE_GUIJIN_2 = '1441014'
const GUIJIN_1_TIME = 0.475
const GUIJIN_2_TIME = 1.225
/** 熔锋状态炽心消耗（点/秒） */
const ZHENDOU_FURY_DRAIN_PER_SEC = 3.3

export interface ZhendouChargeInput {
  combatTime: number
  parryCount: number
  /** 影画6 是否提供失衡回炽心（每失衡 75） */
  c6StunCount: number
}

/**
 * 炽心守恒反推蓄力次数（归烬·舍身 100/次）：
 * 消耗 = 3.3/s × 战斗时长（熔锋全覆盖）；来源 = 招架 75×parryCount + 影画6 75×stunCount。
 * 缺口用蓄力次数补足：max(0, ceil((消耗 − 来源) / 100))。
 */
export function computeZhendouChargeCount(i: ZhendouChargeInput): number {
  const consume = ZHENDOU_FURY_DRAIN_PER_SEC * Math.max(0, Number(i.combatTime) || 0)
  const parryGain = 75 * Math.max(0, Math.floor(Number(i.parryCount) || 0))
  const c6Gain = 75 * Math.max(0, Math.floor(Number(i.c6StunCount) || 0))
  const need = consume - parryGain - c6Gain
  return Math.max(0, Math.ceil(need / 100))
}

/** 耗血暴伤 +50%（炽风·胧切/支援突击）；影画6 支援突击火伤 +15% */
function patchZhendouExecutions({ cfg, executions }: AgentResourceInput): void {
  const record = cfg as unknown as Record<string, unknown>
  const cinema = Math.max(0, Math.floor(Number(record.zhendouCinemaLevel ?? 0)))
  for (const exec of executions) {
    if (!exec.moveId) continue
    if (ZHENDOU_HP_DRAIN_MOVE_IDS.has(exec.moveId)) {
      exec.critDmgBonus = (exec.critDmgBonus ?? 0) + ZHENDOU_CORE_CRIT_DMG
    }
    if (cinema >= 6 && (exec.moveId === MOVE_ASSIST_1 || exec.moveId === MOVE_ASSIST_2)) {
      exec.dmgBonus = (exec.dmgBonus ?? 0) + ZHENDOU_C6_ASSIST_FIRE_DMG
    }
  }
}

/** converge 阶段：写 cfg.zhendouChargeCount（蓄力次数反推）+ cfg.zhendouC6StunFuryCount（影画6 失衡次数） */
function applyZhendouTeamConfig({ slot, cinemaLevel, characters, phase, combatTime, stunCount }: AgentTeamConfigInput): void {
  if (phase !== 'converge') return
  const cfg = characters[slot]
  if (!cfg) return
  const record = cfg as unknown as Record<string, unknown>
  record.zhendouChargeCount = computeZhendouChargeCount({
    combatTime,
    parryCount: cfg.parryCount ?? 0,
    c6StunCount: cinemaLevel >= 6 ? Math.max(0, Math.floor(Number(stunCount) || 0)) : 0,
  })
  record.zhendouC6StunFuryCount = cinemaLevel >= 6 ? Math.max(0, Math.floor(Number(stunCount) || 0)) : 0
}

/** 归烬·舍身（特殊技）前台执行行：蓄力攒炽心，占前台时间（掉伤害） */
function buildZhendouExecutions({ cfg, executions }: AgentResourceInput): void {
  const record = cfg as unknown as Record<string, unknown>
  const chargeCount = Math.max(0, Math.floor(Number(record.zhendouChargeCount ?? 0)))
  if (chargeCount <= 0) return
  pushSpecial(executions, MOVE_GUIJIN_1, '特殊技：归烬 #1（点按）', chargeCount, GUIJIN_1_TIME)
  pushSpecial(executions, MOVE_GUIJIN_2, '特殊技：归烬 #2（长按蓄力释放）', chargeCount, GUIJIN_2_TIME)
}

function pushSpecial(executions: SkillExecution[], moveId: string, moveName: string, count: number, actionTime: number): void {
  executions.push({
    moveId,
    moveName,
    category: 'special',
    count,
    actionTime,
    comboAlignRatio: 0,
    totalTime: count * actionTime,
    totalComboAlignTime: 0,
    energyConsume: 0,
    totalEnergyConsume: 0,
    decibelRecovery: 0,
    totalDecibelRecovery: 0,
    energyRecovery: 0,
    totalEnergyRecovery: 0,
    skillTableNote: `归烬·舍身 ×${count}（蓄力 ${count} 秒攒炽心，占前台时间）`,
  })
}

function buildZhendouResourceResult({ cfg, state }: AgentResourceResultInput) {
  const spec = getAgentSpec(ZHENDOU_ID)
  return {
    specResources: spec ? Object.fromEntries(computeSpecResources(spec, cfg, state)) : {},
  }
}

function buildZhendouResourceSections(input: AgentResourceSectionsInput) {
  const spec = getAgentSpec(ZHENDOU_ID)
  return spec ? specToMechanicModule(spec).resourceSections?.(input) ?? [] : []
}

export const zhendouMechanic: AgentMechanicModule = {
  id: 'agent:1441',
  agentIds: [ZHENDOU_ID],
  name: '真斗·熔锋',
  description: '熔锋 buff（炽心≥75 → 暴击+10%/火伤+20%，spec resource）+ 炽风·胧切/支援突击耗血暴伤+50%（招式限定）+ 影画1 生命损失火伤/影画2 火抗/影画4 最大生命/影画6 支援突击火伤；贯穿力转模走 spec attributeConversion。',
  settings: [
    {
      id: 'zhendou.c1LossCoverage',
      label: '真斗·影画1 生命损失覆盖率',
      description: '累积已损失生命转火伤（每 1% +0.4%，上限 +20%），按覆盖率折算，默认 0.5。',
      default: 0.5,
      min: 0,
      max: 1,
      step: 0.05,
    },
  ],
  applyPanel: applyZhendouPanel,
  buildCharConfig: buildZhendouCharConfig,
  applyTeamConfig: applyZhendouTeamConfig,
  buildExecutions: buildZhendouExecutions,
  patchExecutions: patchZhendouExecutions,
  buildResourceResult: buildZhendouResourceResult,
  resourceSections: buildZhendouResourceSections,
}
