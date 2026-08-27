import type {
  AgentCharConfigInput,
  AgentMechanicModule,
  AgentPanelInput,
  AgentResourceInput,
  AgentResourceResultInput,
  AgentResourceSectionsInput,
} from '../types'
import type { SkillExecution } from '@/types/resource'
import { getAgentSpec } from '@/specs/registry'
import { computeSpecResources } from '@/specs/resources'
import { specToMechanicModule } from '@/specs/mechanics'

/**
 * 波可娜（1351，物理·击破/支援）—— 整局近似口径
 *
 * 已接管：
 * - 核心被动·猎手本能（Lv.7）：强特/支援突击/连携/终结进入[猎步]，失衡值 +30%
 *   （spec resource `pulchra_hunt_step` 供资源卡；失衡 +30% 由 applyPanel 恒常挂，猎步不断触发）。
 * - 额外能力·业务搭档[困迹]：波可娜 5 招命中施加困迹(15s)，困迹下全队[追加攻击]伤害 +30%
 *   ——用户确认困迹全覆盖（后台招式 15s 内续上不会断）。走 spec teamBuffs
 *   `pulchra_extra_trap_followup`（target=team，effect skillDmgBonus targetSkillType=additionalAttack）。
 *
 * 本轮补录（2026-08-27 用户口径）：
 * - **核心循环·噬爪·噩梦袭影**：猎步进入次数 = 强特 + 支援突击(≈招架) + 连携 + 终结；
 *   每次进入猎步打这个[后台追加攻击]特殊技——0 命 = 第一行(1351006)×5 + 终结一击(1351007)×1，
 *   6 命 = 第一行×7 + 终结一击×1（buildExecutions，timeBucket=backstage 不占前台）。
 * - 影画1·利己主义：困迹敌人自身暴击率 +10%（困迹全覆盖 → critRate +10 全覆盖）。
 * - 影画2·借势而为：猎步状态自身攻击力 +10%（猎步恒常 → atk ×1.1）。
 * - 影画4·狩猎乐趣：强特·噬爪瞬步能量消耗 -5（buildCharConfig cfg.exSpecialEnergyConsume -5）。
 * - 影画6·面具之下：①噬爪·噩梦袭影 伤害 +15%（patchExecutions）；②第一行次数 +2（buildExecutions）；
 *   ③困迹对追加攻击以外也生效（spec teamBuffs `pulchra_cinema_6_trap_all`）。
 */

const PULCHRA_ID = '1351'
const MOVE_NIGHTMARE_1 = '1351006' // 特殊技：噬爪·噩梦袭影 #1（普通行）
const MOVE_NIGHTMARE_2 = '1351007' // 特殊技：噬爪·噩梦袭影 #2（终结一击）
export const PULCHRA_C6_NIGHTMARE_MOVE_IDS = new Set([MOVE_NIGHTMARE_1, MOVE_NIGHTMARE_2])
export const PULCHRA_C1_CRIT_RATE = 10
export const PULCHRA_C2_ATK_PCT = 10
export const PULCHRA_C4_EX_ENERGY_CUT = 5
export const PULCHRA_C6_NIGHTMARE_DMG = 15
export const PULCHRA_HUNT_STEP_STUN = 30
/** 0 命：每次猎步打第一行 5 次 + 终结一击 1 次；6 命：第一行 7 次 + 终结一击 1 次 */
export const PULCHRA_NIGHTMARE_FIRST_HITS = 5
export const PULCHRA_NIGHTMARE_FIRST_HITS_C6 = 7

export interface PulchraHuntStepInput {
  exSpecialCount: number
  /** 支援突击 ≈ 招架次数（defensive assist follow-up，由 parryCount 驱动） */
  parryCount: number
  chainCountTotal: number
  ultimateCount: number
}

/** 猎步进入次数 = 强特 + 支援突击(招架) + 连携 + 终结 */
export function computePulchraHuntStepCount(i: PulchraHuntStepInput): number {
  return Math.max(0, Math.floor(Number(i.exSpecialCount) || 0))
    + Math.max(0, Math.floor(Number(i.parryCount) || 0))
    + Math.max(0, Math.floor(Number(i.chainCountTotal) || 0))
    + Math.max(0, Math.floor(Number(i.ultimateCount) || 0))
}

function applyPulchraPanel({ panel, cinemaLevel }: AgentPanelInput): void {
  // 猎步：恒常（强特/连携/终结不断触发，6s 刷新 → 失衡值 +30% 常驻）
  panel.stunBuildUpBonus = (panel.stunBuildUpBonus ?? 0) + PULCHRA_HUNT_STEP_STUN
  if (cinemaLevel >= 1) {
    panel.critRate = (panel.critRate ?? 0) + PULCHRA_C1_CRIT_RATE
  }
  if (cinemaLevel >= 2) {
    panel.atk = Math.round((panel.atk ?? 0) * (1 + PULCHRA_C2_ATK_PCT / 100))
  }
}

function buildPulchraCharConfig({ cfg, cinemaLevel }: AgentCharConfigInput): void {
  const record = cfg as unknown as Record<string, unknown>
  record.pulchraCinemaLevel = Math.max(0, Math.floor(Number(cinemaLevel ?? 0)))
  // 影画4：强化特殊技·噬爪瞬步能量消耗 -5
  if (cinemaLevel >= 4) {
    const prev = Number(record.pulchraC4EnergyCut ?? 0)
    cfg.exSpecialEnergyConsume = Math.max(0, (cfg.exSpecialEnergyConsume ?? 0) + prev - PULCHRA_C4_EX_ENERGY_CUT)
    record.pulchraC4EnergyCut = PULCHRA_C4_EX_ENERGY_CUT
  }
}

/** 后台追加攻击行（真实 moveId，enrich 回填倍率/元素） */
function pushBackstage(executions: SkillExecution[], moveId: string, moveName: string, count: number, note: string): void {
  if (count <= 0) return
  executions.push({
    moveId,
    moveName,
    category: 'special',
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
    anomalyBuildUp: 0,
    skillTableNote: note,
    timeBucket: 'backstage',
  })
}

/** 核心循环：猎步进入次数 → 后台追加攻击特殊技（噬爪·噩梦袭影） */
function buildPulchraExecutions({ cfg, state, executions }: AgentResourceInput): void {
  const record = cfg as unknown as Record<string, unknown>
  const cinema = Math.max(0, Math.floor(Number(record.pulchraCinemaLevel ?? 0)))
  const n = computePulchraHuntStepCount({
    exSpecialCount: state.exSpecialCount ?? 0,
    parryCount: cfg.parryCount ?? 0,
    chainCountTotal: state.chainCountTotal ?? 0,
    ultimateCount: state.ultimateCount ?? 0,
  })
  if (n <= 0) return
  const firstHits = cinema >= 6 ? PULCHRA_NIGHTMARE_FIRST_HITS_C6 : PULCHRA_NIGHTMARE_FIRST_HITS
  pushBackstage(executions, MOVE_NIGHTMARE_1, '特殊技：噬爪·噩梦袭影（后台追加攻击）', n * firstHits,
    `猎步 ${n} 次 × ${firstHits} 行（后台追加攻击，0命5/6命7）`)
  pushBackstage(executions, MOVE_NIGHTMARE_2, '特殊技：噬爪·噩梦袭影·终结一击（后台追加攻击）', n,
    `猎步 ${n} 次 × 1 终结一击（后台追加攻击）`)
}

/** 影画6：噬爪·噩梦袭影伤害 +15% */
function patchPulchraExecutions({ cfg, executions }: AgentResourceInput): void {
  const record = cfg as unknown as Record<string, unknown>
  const cinema = Math.max(0, Math.floor(Number(record.pulchraCinemaLevel ?? 0)))
  if (cinema < 6) return
  for (const exec of executions) {
    if (exec.moveId && PULCHRA_C6_NIGHTMARE_MOVE_IDS.has(exec.moveId)) {
      exec.dmgBonus = (exec.dmgBonus ?? 0) + PULCHRA_C6_NIGHTMARE_DMG
    }
  }
}

function buildPulchraResourceResult({ cfg, state }: AgentResourceResultInput) {
  const spec = getAgentSpec(PULCHRA_ID)
  return {
    specResources: spec ? Object.fromEntries(computeSpecResources(spec, cfg, state)) : {},
  }
}

function buildPulchraResourceSections(input: AgentResourceSectionsInput) {
  const spec = getAgentSpec(PULCHRA_ID)
  return spec ? specToMechanicModule(spec).resourceSections?.(input) ?? [] : []
}

export const pulchraMechanic: AgentMechanicModule = {
  id: 'agent:1351',
  agentIds: [PULCHRA_ID],
  name: '波可娜·猎步/困迹/噬爪',
  description: '核心被动猎步（失衡+30%）+ 核心循环噬爪·噩梦袭影（后台追加攻击，猎步次数×(5/7+1)）+ 额外能力困迹（全队追加攻击+30%）+ 影画1 暴击/影画2 攻击/影画4 耗能-5/影画6 送数+伤害+困迹范围。',
  applyPanel: applyPulchraPanel,
  buildCharConfig: buildPulchraCharConfig,
  buildExecutions: buildPulchraExecutions,
  patchExecutions: patchPulchraExecutions,
  buildResourceResult: buildPulchraResourceResult,
  resourceSections: buildPulchraResourceSections,
}