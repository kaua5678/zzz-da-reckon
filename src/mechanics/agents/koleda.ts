/**
 * 珂蕾妲（1101）—— 爆破锤失衡、熔炉升温与影画整局总量模型
 *
 * 原文来源：data/raw/nanoka_missing/full/1101.json，按核心被动 Lv.7。
 * - 核心被动爆破锤：强化特殊技（及消耗熔炉升温的强化普攻）失衡值+60%。普攻聚合行无法拆出
 *   强化普攻，故仅对强化特殊技行挂 stunBuildUpBonus+60，强化普攻部分如实留白。
 * - 额外能力白祇管理学：同属性/同阵营/命破/锋御队友激活；目标失衡后连携技伤害+35%×2层，
 *   按覆盖率折算为连携行 dmgBonus。
 * - 影画1 锤击节奏：衔接特定普攻后快速发动特殊技/强化特殊技失衡值+15%，按覆盖率近似。
 * - 影画4 熔炉余温：消耗熔炉升温得充能（上限2），连携/终结每层充能伤害+18%，按层数滑块折算。
 * - 影画6 饱和爆破：强化特殊技/连携/终结引发爆炸命中时额外360%攻击力伤害，按三类招式次数
 *   之和生成合成执行行（damageMultiplierOverride，不伪造 catalog moveId）。
 *
 * 明确未建模：
 * - 影画2 动能回收：强化特殊技命中回60能量（45秒一次）无干净回能通道，未接入能量结算。
 * - 强化普攻（消耗熔炉升温）的失衡+60%与普攻聚合行无法拆分。
 * - 熔炉升温/熔炉充能逐状态时序（仅保留资源展示口径）。
 * - 旧 koledaFurnaceMechanic 的无出处 +25% 增伤占位已随模块替换移除。
 */
import type {
  AgentCharConfigInput,
  AgentMechanicModule,
  AgentResourceInput,
  AgentResourceResultInput,
  AgentResourceSectionsInput,
} from '../types'

export const KOLEDA_ID = '1101'
export const KOLEDA_CORE_STUN = 60
export const KOLEDA_ADDITIONAL_CHAIN_PER_STACK = 35
export const KOLEDA_ADDITIONAL_CHAIN_MAX_STACKS = 2
export const KOLEDA_C1_STUN = 15
export const KOLEDA_C4_DMG_PER_CHARGE = 18
export const KOLEDA_C4_MAX_CHARGES = 2
export const KOLEDA_C6_EXPLOSION_MULT = 360

export interface KoledaCycle {
  cinemaLevel: number
  additionalActive: boolean
  additionalChainDmg: number
  c1StunBonus: number
  c4DmgBonus: number
  c6ExplosionCount: number
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

export function computeKoledaCycle(input: {
  cinemaLevel: number
  additionalActive: boolean
  chainStunCoverage: number
  c1Coverage: number
  c4ChargeStacks: number
  exSpecialCount: number
  chainCount: number
  ultimateCount: number
}): KoledaCycle {
  const cinemaLevel = whole(input.cinemaLevel)
  return {
    cinemaLevel,
    additionalActive: input.additionalActive,
    additionalChainDmg: input.additionalActive
      ? KOLEDA_ADDITIONAL_CHAIN_PER_STACK * KOLEDA_ADDITIONAL_CHAIN_MAX_STACKS * clampRatio(input.chainStunCoverage)
      : 0,
    c1StunBonus: cinemaLevel >= 1 ? KOLEDA_C1_STUN * clampRatio(input.c1Coverage) : 0,
    c4DmgBonus: cinemaLevel >= 4
      ? KOLEDA_C4_DMG_PER_CHARGE * Math.max(0, Math.min(KOLEDA_C4_MAX_CHARGES, input.c4ChargeStacks))
      : 0,
    c6ExplosionCount: cinemaLevel >= 6
      ? whole(input.exSpecialCount) + whole(input.chainCount) + whole(input.ultimateCount)
      : 0,
    note: '强化普攻失衡加成与影画2回能未建模；熔炉升温/充能仅资源展示口径。',
  }
}

function buildKoledaCharConfig({ cinemaLevel, cfg, panel }: AgentCharConfigInput): void {
  const record = cfg as unknown as Record<string, unknown>
  record.koledaCinemaLevel = cinemaLevel
  record.koledaChainStunCoverage = clampRatio(setting(cfg, 'koleda.chainStunCoverage', 1))
  record.koledaC1Coverage = clampRatio(setting(cfg, 'koleda.c1Coverage', 1))
  record.koledaC4ChargeStacks = Math.max(0, Math.min(KOLEDA_C4_MAX_CHARGES, setting(cfg, 'koleda.c4ChargeStacks', 2)))
  record.koledaAdditionalActive = (panel.additionalAbilityActive ?? 0) > 0
}

function cycleFromInput({ cfg, state }: Pick<AgentResourceInput, 'cfg' | 'state'>): KoledaCycle {
  const record = cfg as unknown as Record<string, unknown>
  return computeKoledaCycle({
    cinemaLevel: Number(record.koledaCinemaLevel ?? 0),
    additionalActive: record.koledaAdditionalActive === true,
    chainStunCoverage: Number(record.koledaChainStunCoverage ?? 1),
    c1Coverage: Number(record.koledaC1Coverage ?? 1),
    c4ChargeStacks: Number(record.koledaC4ChargeStacks ?? 2),
    exSpecialCount: state.exSpecialCount,
    chainCount: state.chainCountTotal,
    ultimateCount: state.ultimateCount,
  })
}

function buildKoledaExecutions({ cfg, state, executions }: AgentResourceInput): void {
  const cycle = cycleFromInput({ cfg, state })
  if (cycle.c6ExplosionCount <= 0) return
  executions.push({
    moveId: '1101_c6_saturation_explosion',
    moveName: '饱和爆破（影画6）',
    category: 'special',
    element: 'fire',
    count: cycle.c6ExplosionCount,
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
    damageMultiplier: KOLEDA_C6_EXPLOSION_MULT,
    damageMultiplierOverride: true,
    skillDamageTarget: 'additionalAttack',
  })
}

function patchKoledaExecutions({ cfg, state, executions }: AgentResourceInput): void {
  const cycle = cycleFromInput({ cfg, state })
  const exMoveId = cfg.exSpecialMoveId
  const chainMoveId = cfg.chainMoveId
  const ultMoveId = cfg.ultimateMoveId
  for (const exec of executions) {
    // 核心被动：强化特殊技失衡值+60%（强化普攻部分未建模）。
    if (exec.moveId === exMoveId) {
      exec.stunBuildUpBonus = (exec.stunBuildUpBonus ?? 0) + KOLEDA_CORE_STUN + cycle.c1StunBonus
    }
    // 影画1：特殊技失衡值+15%（按覆盖率）。
    if (exec.category === 'special' && exec.moveId !== exMoveId && cycle.c1StunBonus > 0) {
      exec.stunBuildUpBonus = (exec.stunBuildUpBonus ?? 0) + cycle.c1StunBonus
    }
    // 连携：额外能力失衡增伤 + 影画4充能增伤。
    if (exec.moveId === chainMoveId) {
      if (cycle.additionalChainDmg > 0) exec.dmgBonus = (exec.dmgBonus ?? 0) + cycle.additionalChainDmg
      if (cycle.c4DmgBonus > 0) exec.dmgBonus = (exec.dmgBonus ?? 0) + cycle.c4DmgBonus
    }
    // 终结：影画4充能增伤。
    if (exec.moveId === ultMoveId && cycle.c4DmgBonus > 0) {
      exec.dmgBonus = (exec.dmgBonus ?? 0) + cycle.c4DmgBonus
    }
  }
}

function buildKoledaResourceResult({ cfg, state }: AgentResourceResultInput) {
  return { specResources: { koleda_cycle: cycleFromInput({ cfg, state }) } }
}

function buildKoledaResourceSections({ result }: AgentResourceSectionsInput) {
  const cycle = result.specResources?.koleda_cycle as KoledaCycle | undefined
  if (!cycle) return []
  return [{
    id: 'koleda-cycle',
    title: '珂蕾妲·爆破锤',
    summary: `强特失衡 +${KOLEDA_CORE_STUN + cycle.c1StunBonus}% · 连携增伤 +${cycle.additionalChainDmg}%`,
    rows: [
      { label: '核心强特失衡', value: `+${KOLEDA_CORE_STUN}%`, detail: '强化特殊技失衡值提升' },
      { label: '影画1衔接失衡', value: `+${cycle.c1StunBonus}%`, detail: '特殊技/强特按覆盖率' },
      { label: '额外能力连携增伤', value: `+${cycle.additionalChainDmg}%`, detail: cycle.additionalActive ? '失衡后35%×2层' : '未激活' },
      { label: '影画4充能增伤', value: `+${cycle.c4DmgBonus}%`, detail: '连携/终结，每层18%上限2层' },
      { label: '影画6饱和爆破', value: `${cycle.c6ExplosionCount} 次`, detail: '360%攻击力火伤合成行' },
    ],
    footer: cycle.note,
  }]
}

export const koledaMechanic: AgentMechanicModule = {
  id: 'agent:koleda',
  agentIds: [KOLEDA_ID],
  name: '珂蕾妲·爆破锤',
  description: '强特失衡+60%、额外能力连携增伤、影画1/4/6；强化普攻与影画2回能未建模。',
  settings: [
    { id: 'koleda.chainStunCoverage', label: '连携失衡增伤覆盖率', description: '额外能力连携技对失衡敌人+35%×2层的整局覆盖率', default: 1, min: 0, max: 1, step: 0.05, suffix: '%' },
    { id: 'koleda.c1Coverage', label: '影画1衔接覆盖率', description: '影画1特殊技/强特失衡值+15%的整局覆盖率', default: 1, min: 0, max: 1, step: 0.05, suffix: '%' },
    { id: 'koleda.c4ChargeStacks', label: '影画4充能层数', description: '连携/终结消耗熔炉充能层数（每层+18%）', default: 2, min: 0, max: 2, step: 1, suffix: '层' },
  ],
  buildCharConfig: buildKoledaCharConfig,
  buildExecutions: buildKoledaExecutions,
  patchExecutions: patchKoledaExecutions,
  buildResourceResult: buildKoledaResourceResult,
  resourceSections: buildKoledaResourceSections,
}

export default koledaMechanic
