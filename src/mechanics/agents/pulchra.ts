import type {
  AgentCharConfigInput,
  AgentMechanicModule,
  AgentPanelInput,
  AgentResourceInput,
  AgentResourceResultInput,
  AgentResourceSectionsInput,
} from '../types'
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
 * - 影画1·利己主义：困迹敌人自身暴击率 +10%（困迹全覆盖 → critRate +10 全覆盖）。
 * - 影画2·借势而为：猎步状态自身攻击力 +10%（猎步恒常 → atk ×1.1，orphie C2 同款）。
 * - 影画4·狩猎乐趣：强特·噬爪瞬步能量消耗 -5（引擎无干净通道，未建模，见 spec pending）。
 * - 影画6·面具之下：噬爪·噩梦袭影(1351006/1351007) 伤害 +15%（patchExecutions 招式限定）。
 *   「重复攻击可触发次数额外+2」与「困迹对追加攻击外也生效」为次数类/范围类，未建模（见 spec pending）。
 */

const PULCHRA_ID = '1351'
const MOVE_NIGHTMARE_1 = '1351006' // 特殊技：噬爪·噩梦袭影 #1
const MOVE_NIGHTMARE_2 = '1351007' // 特殊技：噬爪·噩梦袭影 #2
export const PULCHRA_C6_NIGHTMARE_MOVE_IDS = new Set([MOVE_NIGHTMARE_1, MOVE_NIGHTMARE_2])
export const PULCHRA_C1_CRIT_RATE = 10
export const PULCHRA_C2_ATK_PCT = 10
export const PULCHRA_C6_NIGHTMARE_DMG = 15
export const PULCHRA_HUNT_STEP_STUN = 30

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
  name: '波可娜·猎步/困迹',
  description: '核心被动猎步（失衡+30%，spec resource）+ 额外能力困迹（全队追加攻击+30%，spec teamBuffs）+ 影画1 暴击/影画2 攻击/影画6 噬爪增伤；影画4 耗能-5 未建模。',
  applyPanel: applyPulchraPanel,
  buildCharConfig: buildPulchraCharConfig,
  patchExecutions: patchPulchraExecutions,
  buildResourceResult: buildPulchraResourceResult,
  resourceSections: buildPulchraResourceSections,
}
