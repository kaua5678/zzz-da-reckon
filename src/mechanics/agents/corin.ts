/**
 * 可琳（1061）—— 专注电锯增伤与影画整局总量模型
 *
 * 原文来源：data/raw/nanoka_missing/full/1061.json，按核心被动 Lv.7。
 * - 核心被动专注：电锯持续斩击（强化普攻）伤害+37.5%。普攻聚合行（moveId basic_attack）
 *   代表琳的普攻时间主体，按覆盖率把增伤挂到 basic_attack 行 dmgBonus。
 * - 额外能力扫除帮手：同属性/同阵营队友激活，命中失衡敌人自身伤害+35%，按覆盖率折算面板 dmgBonus。
 * - 影画1 开放性创伤：连携/终结命中后对目标伤害+12%（15秒），按覆盖率折算面板 dmgBonus。
 * - 影画2 裂解效应：强特/连携/终结命中使目标物理抗性-0.5%×20层（上限10%），按覆盖率折算
 *   面板 enemyPhysicalResReduction。
 * - 影画6 厚积薄发：持续斩击叠充能（上限40），闪避反击/特殊技/强特/快速支援/支援突击引爆电锯时
 *   消耗全部充能，每层额外造成3%攻击力伤害，按引爆次数×充能层数生成合成执行行
 *   （damageMultiplierOverride，不伪造 catalog moveId）。
 *
 * 明确未建模：
 * - 影画4 战场随侍：快速支援/招架支援/连携回7.2能量（16秒一次）无干净回能通道，未接入能量结算。
 * - 影画2 每层独立结算5秒持续、影画6 充能逐层积累/消耗时序，均按覆盖率/层数滑块近似。
 * - 核心被动电锯增伤仅挂普攻聚合行，无法精确区分电锯持续斩击与其他普攻段。
 */
import type {
  AgentCharConfigInput,
  AgentMechanicModule,
  AgentResourceInput,
  AgentResourceResultInput,
  AgentResourceSectionsInput,
  AgentSkillTransformInput,
} from '../types'

export const CORIN_ID = '1061'
export const CORIN_CORE_SAW_DMG = 37.5
export const CORIN_ADDITIONAL_DMG = 35
export const CORIN_C1_DMG = 12
export const CORIN_C2_RES_PER_STACK = 0.5
export const CORIN_C2_MAX_STACKS = 20
export const CORIN_C6_DMG_PER_CHARGE = 3
export const CORIN_C6_MAX_CHARGES = 40

export interface CorinCycle {
  cinemaLevel: number
  additionalActive: boolean
  coreSawDmg: number
  additionalDmg: number
  c1Dmg: number
  c2ResReduction: number
  c6DetonationCount: number
  c6DamagePerDetonation: number
  note: string
}

function setting(cfg: AgentCharConfigInput['cfg'], id: string, fallback: number): number {
  const value = Number((cfg as unknown as Record<string, unknown>)[`setting:${id}`])
  return Number.isFinite(value) ? value : fallback
}

function clampRatio(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0))
}

function whole(value: number): number {
  return Math.max(0, Math.floor(Number.isFinite(value) ? value : 0))
}

export function computeCorinCycle(input: {
  cinemaLevel: number
  additionalActive: boolean
  coreSawCoverage: number
  additionalStunCoverage: number
  c1Coverage: number
  c2ResCoverage: number
  c6DetonationCount: number
  c6ChargeStacks: number
}): CorinCycle {
  const cinemaLevel = whole(input.cinemaLevel)
  const c6ChargeStacks = Math.max(0, Math.min(CORIN_C6_MAX_CHARGES, input.c6ChargeStacks))
  return {
    cinemaLevel,
    additionalActive: input.additionalActive,
    coreSawDmg: CORIN_CORE_SAW_DMG * clampRatio(input.coreSawCoverage),
    additionalDmg: input.additionalActive ? CORIN_ADDITIONAL_DMG * clampRatio(input.additionalStunCoverage) : 0,
    c1Dmg: cinemaLevel >= 1 ? CORIN_C1_DMG * clampRatio(input.c1Coverage) : 0,
    c2ResReduction: cinemaLevel >= 2
      ? CORIN_C2_RES_PER_STACK * CORIN_C2_MAX_STACKS * clampRatio(input.c2ResCoverage)
      : 0,
    c6DetonationCount: cinemaLevel >= 6 ? whole(input.c6DetonationCount) : 0,
    c6DamagePerDetonation: cinemaLevel >= 6 ? CORIN_C6_DMG_PER_CHARGE * c6ChargeStacks : 0,
    note: '影画4回能与影画2/6逐层时序未建模，按覆盖率/层数滑块近似。',
  }
}

function buildCorinCharConfig({ cinemaLevel, cfg, panel }: AgentCharConfigInput): void {
  const record = cfg as unknown as Record<string, unknown>
  record.corinCinemaLevel = cinemaLevel
  record.corinCoreSawCoverage = clampRatio(setting(cfg, 'corin.coreSawCoverage', 1))
  record.corinAdditionalStunCoverage = clampRatio(setting(cfg, 'corin.additionalStunCoverage', 1))
  record.corinC1Coverage = clampRatio(setting(cfg, 'corin.c1Coverage', 1))
  record.corinC2ResCoverage = clampRatio(setting(cfg, 'corin.c2ResCoverage', 1))
  record.corinC6DetonationCount = whole(setting(cfg, 'corin.c6DetonationCount', 8))
  record.corinC6ChargeStacks = Math.max(0, Math.min(CORIN_C6_MAX_CHARGES, setting(cfg, 'corin.c6ChargeStacks', 40)))
  record.corinAdditionalActive = (panel.additionalAbilityActive ?? 0) > 0
}

function cycleFromInput({ cfg, state }: Pick<AgentResourceInput, 'cfg' | 'state'>): CorinCycle {
  const record = cfg as unknown as Record<string, unknown>
  return computeCorinCycle({
    cinemaLevel: Number(record.corinCinemaLevel ?? 0),
    additionalActive: record.corinAdditionalActive === true,
    coreSawCoverage: Number(record.corinCoreSawCoverage ?? 1),
    additionalStunCoverage: Number(record.corinAdditionalStunCoverage ?? 1),
    c1Coverage: Number(record.corinC1Coverage ?? 1),
    c2ResCoverage: Number(record.corinC2ResCoverage ?? 1),
    c6DetonationCount: Number(record.corinC6DetonationCount ?? 8),
    c6ChargeStacks: Number(record.corinC6ChargeStacks ?? 40),
  })
}

function buildCorinExecutions({ cfg, state, executions }: AgentResourceInput): void {
  const cycle = cycleFromInput({ cfg, state })
  if (cycle.c6DetonationCount <= 0 || cycle.c6DamagePerDetonation <= 0) return
  executions.push({
    moveId: '1061_c6_chainsaw_detonation',
    moveName: '电锯引爆（影画6）',
    category: 'special',
    element: 'physical',
    count: cycle.c6DetonationCount,
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
    damageMultiplier: cycle.c6DamagePerDetonation,
    damageMultiplierOverride: true,
    skillDamageTarget: 'additionalAttack',
  })
}

function patchCorinExecutions({ cfg, state, executions }: AgentResourceInput): void {
  const cycle = cycleFromInput({ cfg, state })
  if (cycle.coreSawDmg <= 0) return
  for (const exec of executions) {
    if (exec.moveId === 'basic_attack') {
      exec.dmgBonus = (exec.dmgBonus ?? 0) + cycle.coreSawDmg
    }
  }
}

function applyCorinPanel({ charResult, panel }: AgentSkillTransformInput): void {
  if (!panel) return
  if ((panel as Record<string, unknown>).__corinPanelApplied) return
  ;(panel as Record<string, unknown>).__corinPanelApplied = true
  const cycle = charResult.specResources?.corin_cycle as CorinCycle | undefined
  if (!cycle) return
  const dmgBonus = cycle.additionalDmg + cycle.c1Dmg
  if (dmgBonus > 0) panel.dmgBonus = (panel.dmgBonus ?? 0) + dmgBonus
  if (cycle.c2ResReduction > 0) {
    panel.enemyPhysicalResReduction = (panel.enemyPhysicalResReduction ?? 0) + cycle.c2ResReduction
  }
}

function buildCorinResourceResult({ cfg, state }: AgentResourceResultInput) {
  return { specResources: { corin_cycle: cycleFromInput({ cfg, state }) } }
}

function buildCorinResourceSections({ result }: AgentResourceSectionsInput) {
  const cycle = result.specResources?.corin_cycle as CorinCycle | undefined
  if (!cycle) return []
  return [{
    id: 'corin-cycle',
    title: '可琳·专注电锯',
    summary: `电锯增伤 +${cycle.coreSawDmg}% · 失衡增伤 +${cycle.additionalDmg}%`,
    rows: [
      { label: '核心电锯增伤', value: `+${cycle.coreSawDmg}%`, detail: '持续斩击伤害，挂普攻聚合行' },
      { label: '额外能力失衡增伤', value: `+${cycle.additionalDmg}%`, detail: cycle.additionalActive ? '命中失衡敌人+35%' : '未激活' },
      { label: '影画1连携终结增伤', value: `+${cycle.c1Dmg}%`, detail: '命中后15秒按覆盖率' },
      { label: '影画2物理减抗', value: `+${cycle.c2ResReduction}%`, detail: '0.5%×20层上限10%' },
      { label: '影画6电锯引爆', value: `${cycle.c6DetonationCount} 次`, detail: `每次 ${cycle.c6DamagePerDetonation}% 攻击力` },
    ],
    footer: cycle.note,
  }]
}

export const corinMechanic: AgentMechanicModule = {
  id: 'agent:corin',
  agentIds: [CORIN_ID],
  name: '可琳·专注',
  description: '电锯增伤37.5%、额外能力失衡增伤、影画1/2/6；影画4回能与逐层时序未建模。',
  settings: [
    { id: 'corin.coreSawCoverage', label: '电锯增伤覆盖率', description: '核心被动持续斩击伤害+37.5%的整局覆盖率', default: 1, min: 0, max: 1, step: 0.05, suffix: '%' },
    { id: 'corin.additionalStunCoverage', label: '失衡增伤覆盖率', description: '额外能力命中失衡敌人+35%的整局覆盖率', default: 1, min: 0, max: 1, step: 0.05, suffix: '%' },
    { id: 'corin.c1Coverage', label: '影画1增伤覆盖率', description: '影画1连携/终结命中后+12%的整局覆盖率', default: 1, min: 0, max: 1, step: 0.05, suffix: '%' },
    { id: 'corin.c2ResCoverage', label: '影画2减抗覆盖率', description: '影画2物理抗性-10%的整局覆盖率', default: 1, min: 0, max: 1, step: 0.05, suffix: '%' },
    { id: 'corin.c6DetonationCount', label: '影画6引爆次数', description: '闪避反击/特殊技/强特/快支/支援突击引爆电锯次数', default: 8, min: 0, max: 40, step: 1, suffix: '次' },
    { id: 'corin.c6ChargeStacks', label: '影画6充能层数', description: '引爆时消耗的充能层数（每层+3%攻击力，上限40）', default: 40, min: 0, max: 40, step: 1, suffix: '层' },
  ],
  buildCharConfig: buildCorinCharConfig,
  buildExecutions: buildCorinExecutions,
  patchExecutions: patchCorinExecutions,
  transformSkillExecutions: applyCorinPanel,
  buildResourceResult: buildCorinResourceResult,
  resourceSections: buildCorinResourceSections,
}

export default corinMechanic
