/**
 * 薇薇安（1331）—— 落羽生花追击、护羽/飞羽与影画整局总量模型
 *
 * 原文来源：data/raw/nanoka_missing/full/1331.json，按核心被动 Lv.7。
 * - 额外能力预言之泪：其他异常或同属性队友激活；队友施加属性异常时薇薇安消耗1点护羽发动一次
 *   落羽生花（真实 moveId 1331008，440% 以太伤，actionTime=0 不占前台），次数显式可调。
 * - 影画4 苇间风：裙裾浮游·悬落与落羽生花命中必定暴击（critRateBonus+100），攻击力+12%按覆盖率折算；
 *   进场获得5点护羽并入资源明细。
 * - 影画6 薇薇安：以太伤害+40%计入面板 etherDmg；极限闪避/强特额外回飞羽仅入资源明细。
 * - 影画1：累计消耗4点护羽返1点飞羽（资源折算）；预言下异常/紊乱增伤沿用 spec teamBuffs。
 *
 * 明确未建模（异常结算区，calcAnomalyDamage 已内置精通乘区，直接叠加会重复计入精通，故不臆造）：
 * - 核心被动异放：落羽生花命中异常目标额外结算属性异常伤害，比例为每10点异常精通
 *   6.15%/3.2%/8%/0.75%/1.08%/0.32%（以太/电/火/物理/冰/风）。
 * - 薇薇安的预言：每0.55秒55%攻击力以太 DoT。
 * - 影画2 异放精通收益×130% 与无视15%全属性抗性；影画6 悬落消耗护羽提高异放比例（最多5倍）。
 * - 额外能力全队侵蚀/紊乱伤害+12%（全队向增益，模块仅作用于自身面板，未接全队通道）。
 */
import type {
  AgentCharConfigInput,
  AgentMechanicModule,
  AgentResourceInput,
  AgentResourceResultInput,
  AgentResourceSectionsInput,
  AgentSkillTransformInput,
} from '../types'

export const VIVIAN_ID = '1331'
export const VIVIAN_XUANLUO_MOVE_ID = '1331006'
export const VIVIAN_LUOYU_MOVE_ID = '1331008'
export const VIVIAN_C4_ATK_PCT = 12
export const VIVIAN_C6_ETHER_DMG = 40
export const VIVIAN_C1_REFUND_PER_GUARD = 4

export interface VivianCycle {
  cinemaLevel: number
  followUpCount: number
  additionalActive: boolean
  c4AtkCoverage: number
  c4AtkBonus: number
  c6EtherDmg: number
  guardFeatherSpent: number
  c1FeatherRefund: number
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

export function computeVivianCycle(input: {
  cinemaLevel: number
  followUpCount: number
  additionalActive: boolean
  c4AtkCoverage: number
}): VivianCycle {
  const cinemaLevel = whole(input.cinemaLevel)
  const followUpCount = whole(input.followUpCount)
  const c4AtkCoverage = clampRatio(input.c4AtkCoverage)
  const guardFeatherSpent = followUpCount
  return {
    cinemaLevel,
    followUpCount,
    additionalActive: input.additionalActive,
    c4AtkCoverage,
    c4AtkBonus: cinemaLevel >= 4 ? VIVIAN_C4_ATK_PCT * c4AtkCoverage : 0,
    c6EtherDmg: cinemaLevel >= 6 ? VIVIAN_C6_ETHER_DMG : 0,
    guardFeatherSpent,
    c1FeatherRefund: cinemaLevel >= 1 ? Math.floor(guardFeatherSpent / VIVIAN_C1_REFUND_PER_GUARD) : 0,
    note: '落羽生花追击次数显式可调；异放/预言DoT/侵蚀紊乱全队增益属异常结算区，未建模。',
  }
}

function buildVivianCharConfig({ cinemaLevel, cfg, panel }: AgentCharConfigInput): void {
  const record = cfg as unknown as Record<string, unknown>
  record.vivianCinemaLevel = cinemaLevel
  record.vivianFollowUpCount = whole(setting(cfg, 'vivian.followUpCount', 6))
  record.vivianC4AtkCoverage = clampRatio(setting(cfg, 'vivian.c4AtkCoverage', 1))
  record.vivianAdditionalActive = (panel.additionalAbilityActive ?? 0) > 0
}

function cycleFromInput({ cfg, state }: Pick<AgentResourceInput, 'cfg' | 'state'>): VivianCycle {
  const record = cfg as unknown as Record<string, unknown>
  return computeVivianCycle({
    cinemaLevel: Number(record.vivianCinemaLevel ?? 0),
    followUpCount: Number(record.vivianFollowUpCount ?? 6),
    additionalActive: record.vivianAdditionalActive === true,
    c4AtkCoverage: Number(record.vivianC4AtkCoverage ?? 1),
  })
}

function buildVivianExecutions({ cfg, state, executions }: AgentResourceInput): void {
  const cycle = cycleFromInput({ cfg, state })
  if (cycle.additionalActive && cycle.followUpCount > 0) {
    executions.push({
      moveId: VIVIAN_LUOYU_MOVE_ID,
      moveName: '普通攻击：落羽生花（额外能力追击）',
      category: 'basic',
      element: 'ether',
      count: cycle.followUpCount,
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
    })
  }
}

function patchVivianExecutions({ cfg, state, executions }: AgentResourceInput): void {
  const cycle = cycleFromInput({ cfg, state })
  if (cycle.cinemaLevel < 4) return
  for (const exec of executions) {
    if (exec.moveId === VIVIAN_XUANLUO_MOVE_ID || exec.moveId === VIVIAN_LUOYU_MOVE_ID) {
      exec.critRateBonus = (exec.critRateBonus ?? 0) + 100
    }
  }
}

function applyVivianPanel({ charResult, panel }: AgentSkillTransformInput): void {
  if (!panel) return
  if ((panel as Record<string, unknown>).__vivianPanelApplied) return
  ;(panel as Record<string, unknown>).__vivianPanelApplied = true
  const cycle = charResult.specResources?.vivian_cycle as VivianCycle | undefined
  if (!cycle) return
  if (cycle.c6EtherDmg > 0) panel.etherDmg = (panel.etherDmg ?? 0) + cycle.c6EtherDmg
  if (cycle.c4AtkBonus > 0) panel.atk = Math.round((panel.atk ?? 0) * (1 + cycle.c4AtkBonus / 100))
}

function buildVivianResourceResult({ cfg, state }: AgentResourceResultInput) {
  return { specResources: { vivian_cycle: cycleFromInput({ cfg, state }) } }
}

function buildVivianResourceSections({ result }: AgentResourceSectionsInput) {
  const cycle = result.specResources?.vivian_cycle as VivianCycle | undefined
  if (!cycle) return []
  return [{
    id: 'vivian-cycle',
    title: '薇薇安·护羽与落羽生花',
    summary: `落羽生花追击 ${cycle.followUpCount} 次 · 消耗护羽 ${cycle.guardFeatherSpent}`,
    rows: [
      { label: '额外能力追击', value: `${cycle.followUpCount} 次`, detail: cycle.additionalActive ? '已激活（异常/同属性队友）' : '未激活' },
      { label: '影画1返还飞羽', value: `${cycle.c1FeatherRefund} 点`, detail: '每消耗4点护羽返1点飞羽' },
      { label: '影画4攻击力', value: `+${cycle.c4AtkBonus}%`, detail: '悬落/落羽生花必定暴击，攻击按覆盖率折算' },
      { label: '影画6以太伤害', value: `+${cycle.c6EtherDmg}%`, detail: '计入面板以太增伤' },
    ],
    footer: cycle.note,
  }]
}

export const vivianMechanic: AgentMechanicModule = {
  id: 'agent:vivian',
  agentIds: [VIVIAN_ID],
  name: '薇薇安·命运悲歌',
  description: '落羽生花追击、护羽/飞羽折算、影画4必暴与影画6以太增伤；异放/预言DoT未建模。',
  settings: [
    { id: 'vivian.followUpCount', label: '落羽生花追击次数', description: '队友施加属性异常时薇薇安消耗护羽发动的落羽生花次数', default: 6, min: 0, max: 40, step: 1, suffix: '次' },
    { id: 'vivian.c4AtkCoverage', label: '影画4攻击力覆盖率', description: '悬落/落羽生花命中触发攻击力+12%的整局覆盖率', default: 1, min: 0, max: 1, step: 0.05, suffix: '%' },
  ],
  buildCharConfig: buildVivianCharConfig,
  buildExecutions: buildVivianExecutions,
  patchExecutions: patchVivianExecutions,
  transformSkillExecutions: applyVivianPanel,
  buildResourceResult: buildVivianResourceResult,
  resourceSections: buildVivianResourceSections,
}

export default vivianMechanic
