import type {
  AgentCharConfigInput,
  AgentMechanicModule,
  AgentPanelInput,
  AgentResourceInput,
  AgentResourceResultInput,
  AgentResourceSectionsInput,
  AgentSkillTransformInput,
  AgentTeamConfigInput,
} from '../types'
import { getAgentSpec } from '@/specs/registry'
import { computeSpecResources } from '@/specs/resources'
import { specToMechanicModule } from '@/specs/mechanics'

/**
 * 安比（1011，电·强攻）—— 整局近似口径
 *
 * 已接管（原先分散在 helpers.ts / specPanelBuffs）：
 * - 影画1 快充模式：普攻第四段命中 → 能量获得效率 +12%（30s 刷新，覆盖率滑块 `anby.fastChargeCoverage` 默认 100%）。
 * - 影画6 充能电场：强特 +8 层充能，普攻/冲刺命中消耗 1 层，当前招式伤害 +45%
 *   （spec resource `anby_charge`，transformSkillExecutions 读 resource.total>0 挂 panel.dmgBonus）。
 *
 * 本轮补录（2026-08-27 用户口径）：
 * - 核心被动·波动电压（Lv.7）：落雷(1011005)/特殊技(1011006)/强化特殊技(1011007) 失衡值 +64%
 *   ——**招式限定、全覆盖**（patchExecutions 按 moveId 挂 stunBuildUpBonus，非覆盖率滑块）。
 * - 额外能力·并联电路：同属性/同阵营队友触发（spec.additionalAbility）→ 闪避反击命中回 7.2 能量、
 *   5s 至多一次。整局能量 = min(dodgeCounterCount, floor(combatTime/5)) × 7.2，converge 阶段并入 initialEnergyGift。
 * - 影画2·精准放电：落雷命中失衡敌伤害 +30%（× 失衡覆盖率）；强化特殊技命中未失衡敌失衡 +10%（× (1-覆盖率)）。
 *   覆盖率滑块 `anby.c2StunCoverage`（默认 0.5）。
 * - 影画4·电荷传导：连携/终结为后场电属性角色回 `3 + min(6, floor(自身能量获得效率/12)×2)` 能量
 *   （applyTeamConfig postRound 阶段直接写入后场电队友 initialEnergyGift，幂等）。
 */

const ANBY_ID = '1011'
const MOVE_EX = '1011007' // 强化特殊技：苍雷斩
/** 落雷(1011005)在通用平A聚合行内（basic_attack，含伏特速攻#1~#4+落雷），招式限定近似落到该聚合行 */
const MOVE_BASIC_POOL = 'basic_attack'

/** 核心被动·波动电压 Lv.7 失衡值提升（%） */
export const ANBY_CORE_STUN_BONUS = 64
/** 额外能力·并联电路：闪反回能 */
export const ANBY_AA_ENERGY = 7.2
/** 并联电路 CD（秒） */
export const ANBY_AA_CD = 5
/** 影画1 快充模式：能量获得效率（%） */
export const ANBY_C1_ENERGY_EFF = 12
/** 影画2 落雷命中失衡敌增伤（%） */
export const ANBY_C2_LIGHTNING_DMG = 30
/** 影画2 强特命中未失衡敌失衡（%） */
export const ANBY_C2_EX_STUN = 10
/** 影画4 电荷传导：基础回能 */
export const ANBY_C4_BASE_ENERGY = 3
/** 影画4 每 12% 能量效率额外回能 */
export const ANBY_C4_ENERGY_STEP = 2
/** 影画4 额外回能上限 */
export const ANBY_C4_ENERGY_CAP = 6

/** 波动电压 作用的招式集合：强特 + 落雷所在 basic 聚合行（原文另含特殊技 1011006，但安比循环不用普通特殊技，不单独执行） */
export const ANBY_CORE_STUN_MOVE_IDS = new Set([MOVE_EX, MOVE_BASIC_POOL])

/** 并联电路整局能量 = min(闪反次数, floor(战斗时间/5)) × 7.2 */
export function computeAnbyParallelCircuitEnergy(dodgeCounterCount: number, combatTime: number): number {
  const dodge = Math.max(0, Math.floor(Number(dodgeCounterCount) || 0))
  const t = Math.max(0, Number(combatTime) || 0)
  const triggers = Math.min(dodge, Math.floor(t / ANBY_AA_CD))
  return triggers * ANBY_AA_ENERGY
}

/** 影画4 电荷传导：单次连携/终结为后场电角色回复的能量 */
export function computeAnbyC4ChargeEnergy(energyGainEfficiency: number): number {
  const eff = Math.max(0, Number(energyGainEfficiency) || 0)
  const extra = Math.min(ANBY_C4_ENERGY_CAP, Math.floor(eff / 12) * ANBY_C4_ENERGY_STEP)
  return ANBY_C4_BASE_ENERGY + extra
}

function applyAnbyPanel({ panel, cinemaLevel, settings }: AgentPanelInput): void {
  // 影画1 快充模式
  if (cinemaLevel >= 1) {
    const cov = clampRatio(settings['anby.fastChargeCoverage'] ?? 1)
    panel.energyGainEfficiency = (panel.energyGainEfficiency ?? 0) + ANBY_C1_ENERGY_EFF * cov
  }
}

function buildAnbyCharConfig({ cfg, cinemaLevel, panel }: AgentCharConfigInput): void {
  const record = cfg as unknown as Record<string, unknown>
  record.anbyCinemaLevel = Math.max(0, Math.floor(Number(cinemaLevel ?? 0)))
  record.anbyAdditionalActive = (panel.additionalAbilityActive ?? 0) > 0
  record.anbyEnergyGainEfficiency = panel.energyGainEfficiency ?? 0
}

/** 并联电路（converge）+ 影画4 电荷传导（postRound）回能，幂等并入各槽初始能量礼物 */
function applyAnbyTeamConfig({ slot, cinemaLevel, characters, team, phase, combatTime, stunCount, ultimateCounts }: AgentTeamConfigInput): void {
  const cfg = characters[slot]
  if (!cfg) return
  const record = cfg as unknown as Record<string, unknown>

  if (phase === 'converge') {
    // 并联电路：闪反回 7.2 能量/5s（additionalAbility 门控）
    const active = record.anbyAdditionalActive === true
    const gift = active
      ? computeAnbyParallelCircuitEnergy(cfg.dodgeCounterCount ?? 0, combatTime)
      : 0
    const prev = Math.max(0, Number(record.anbyParallelEnergyTotal ?? 0))
    cfg.initialEnergyGift = Math.max(0, (cfg.initialEnergyGift ?? 0) - prev) + gift
    record.anbyParallelEnergyTotal = gift
  }

  if (phase === 'postRound' && cinemaLevel >= 4) {
    // 影画4 电荷传导：连携/终结为后场电角色回 3+min(6,floor(能量效率/12)×2) 能量
    const chainTotal = cfg.chainCountTotalOverride ?? (cfg.chainCountPerStun ?? 0) * stunCount
    const ult = Math.max(0, Math.floor(Number(ultimateCounts?.[slot] ?? 0)))
    const triggers = Math.max(0, Math.floor(chainTotal)) + ult
    const perTrigger = computeAnbyC4ChargeEnergy(Number(record.anbyEnergyGainEfficiency ?? 0))
    const energy = triggers * perTrigger
    for (const mate of team) {
      if (mate.slot === slot) continue
      if (mate.agent?.damageElement !== 'electric') continue
      const mateCfg = characters[mate.slot]
      if (!mateCfg) continue
      const mateRecord = mateCfg as unknown as Record<string, unknown>
      const prevC4 = Math.max(0, Number(mateRecord.anbyC4EnergyTotal ?? 0))
      mateCfg.initialEnergyGift = Math.max(0, (mateCfg.initialEnergyGift ?? 0) - prevC4) + energy
      mateRecord.anbyC4EnergyTotal = energy
    }
  }
}

/** 波动电压（招式限定失衡+64%）+ 影画2（落雷增伤/强特失衡） */
function patchAnbyExecutions({ cfg, executions }: AgentResourceInput): void {
  const record = cfg as unknown as Record<string, unknown>
  const cinema = Math.max(0, Math.floor(Number(record.anbyCinemaLevel ?? 0)))
  const stunCov = clampRatio(Number(record.anbyC2StunCoverage ?? 0.5))
  for (const exec of executions) {
    if (!exec.moveId) continue
    // 波动电压：落雷/特殊技/强特 失衡 +64%
    if (ANBY_CORE_STUN_MOVE_IDS.has(exec.moveId)) {
      exec.stunBuildUpBonus = (exec.stunBuildUpBonus ?? 0) + ANBY_CORE_STUN_BONUS
    }
    if (cinema >= 2) {
      // 影画2：落雷（basic 聚合行）命中失衡敌伤害 +30%
      if (exec.moveId === MOVE_BASIC_POOL) {
        exec.dmgBonus = (exec.dmgBonus ?? 0) + ANBY_C2_LIGHTNING_DMG * stunCov
      }
      // 影画2：强特命中未失衡敌失衡 +10%
      if (exec.moveId === MOVE_EX) {
        exec.stunBuildUpBonus = (exec.stunBuildUpBonus ?? 0) + ANBY_C2_EX_STUN * (1 - stunCov)
      }
    }
  }
}

/** 影画6 充能电场：resource.anby_charge.total>0 时伤害 +45%（挂 panel.dmgBonus） */
function transformAnbySkillExecutions({ charResult, panel }: AgentSkillTransformInput): void {
  if (!panel) return
  const res = (charResult.specResources ?? {})['anby_charge']
  if ((res?.total ?? 0) > 0) {
    panel.dmgBonus = (panel.dmgBonus ?? 0) + 45
  }
}

function buildAnbyResourceResult({ cfg, state }: AgentResourceResultInput) {
  const spec = getAgentSpec(ANBY_ID)
  return {
    specResources: spec ? Object.fromEntries(computeSpecResources(spec, cfg, state)) : {},
  }
}

function buildAnbyResourceSections(input: AgentResourceSectionsInput) {
  const spec = getAgentSpec(ANBY_ID)
  return spec ? specToMechanicModule(spec).resourceSections?.(input) ?? [] : []
}

function clampRatio(v: number): number {
  return Math.max(0, Math.min(1, Number(v) || 0))
}

export const anbyMechanic: AgentMechanicModule = {
  id: 'agent:1011',
  agentIds: [ANBY_ID],
  name: '安比·波动电压',
  description: '核心被动波动电压（强特/落雷 失衡+64% 招式限定）+ 额外能力并联电路（闪反回能）+ 影画1 快充/影画2 精准放电/影画4 电荷传导（后场电角色回能）/影画6 充能。',
  settings: [
    {
      id: 'anby.fastChargeCoverage',
      label: '安比·影画1 快充覆盖率',
      description: '普攻第四段命中 → 能量获得效率 +12%（30s 刷新），按覆盖率折算，默认 100%。',
      default: 1,
      min: 0,
      max: 1,
      step: 0.05,
    },
    {
      id: 'anby.c2StunCoverage',
      label: '安比·影画2 失衡覆盖率',
      description: '落雷命中失衡敌人增伤 +30%（×覆盖率）；强特命中未失衡敌人失衡 +10%（×(1-覆盖率)）。默认 0.5。',
      default: 0.5,
      min: 0,
      max: 1,
      step: 0.05,
    },
  ],
  applyPanel: applyAnbyPanel,
  buildCharConfig: buildAnbyCharConfig,
  applyTeamConfig: applyAnbyTeamConfig,
  patchExecutions: patchAnbyExecutions,
  transformSkillExecutions: transformAnbySkillExecutions,
  buildResourceResult: buildAnbyResourceResult,
  resourceSections: buildAnbyResourceSections,
}
