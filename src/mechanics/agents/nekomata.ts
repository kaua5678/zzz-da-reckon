import type {
  AgentCharConfigInput,
  AgentMechanicModule,
  AgentResourceInput,
  AgentResourceResultInput,
  AgentResourceSectionsInput,
  AgentSkillTransformInput,
} from '../types'
import { getAgentSpec } from '@/specs/registry'
import { buildSpecEventExecutions, specToMechanicModule } from '@/specs/mechanics'
import { computeSpecResources } from '@/specs/resources'

/**
 * 猫又（1021）呼噜能量口径（用户口供 2026-08-23）：
 * - 呼噜能量全部用于释放[闪避反击：绒爪穿刺](1021019)，两档消耗同一伤害载体：
 *   30 档 = 极限闪避后点按（尾巴失踪术无伤害，价值 = 免费接一次穿刺，净省 10 点）；
 *   40 档 = 长按直接穿刺。
 * - 失衡内无法极限闪避 → 失衡内只能打 40 档；失衡外一律 30 档。
 * - 非轴模式：按「失衡内释放占比」滑杆拆分（-1 = 自动按失衡时间覆盖率，编排层通用注入 teamStunCoverage）；
 *   轴模式：轴内捏的穿刺块精确计 40 档（axisActionCounts），其余预算全打 30 档。
 * - 预算分配：先保 40 档（失衡内是硬约束），剩余预算全部按 30 档释放。
 */

const NEKOMATA_AGENT_ID = '1021'
const PIERCE_MOVE_ID = '1021019'
const COST_DODGE_PATH = 30
const COST_HOLD = 40
const spec = getAgentSpec(NEKOMATA_AGENT_ID)!
const base = specToMechanicModule(spec)

export interface NekomataPiercePlan {
  /** 40 档次数（失衡内长按） */
  holdCount: number
  /** 30 档次数（失衡外极限闪避点按） */
  dodgeCount: number
  /** 总穿刺行数（两档同载体） */
  totalCount: number
  /** 呼噜能量总收入 */
  budget: number
  /** 实际消耗（≤ 预算，尾数不足一档时剩余） */
  spent: number
}

/** 按口供口径把呼噜能量预算分配成 40 档（失衡内）/30 档（失衡外）两次数；纯函数便于测试 */
export function planNekomataPierceCasts(
  budget: number,
  opts: { holdBudgetShare?: number; axisHoldPicks?: number } = {},
): NekomataPiercePlan {
  const total = Math.max(0, Math.floor(budget))
  // 轴模式：轴内捏块精确决定 40 档；否则按占比滑杆（-1=自动覆盖率）折算
  let holdBudget: number
  if (opts.axisHoldPicks != null) {
    holdBudget = Math.max(0, Math.floor(opts.axisHoldPicks)) * COST_HOLD
  } else {
    const share = Math.max(0, Math.min(1, opts.holdBudgetShare ?? 0))
    holdBudget = total * share
  }
  const holdCount = Math.min(Math.floor(holdBudget / COST_HOLD), Math.floor(total / COST_HOLD))
  const restBudget = Math.max(0, total - holdCount * COST_HOLD)
  // 两档都要求「拥有至少40点呼噜能量」才能施放：30 档净耗 30，但每发都须从 ≥40 起跳，
  // 序列收尾必然沉底 10 点不可用 → 可发数 = floor((剩余预算 − 10)/30)；剩余 < 40 时为 0。
  const dodgeCount = restBudget >= COST_HOLD
    ? Math.floor((restBudget - (COST_HOLD - COST_DODGE_PATH)) / COST_DODGE_PATH)
    : 0
  return {
    holdCount,
    dodgeCount,
    totalCount: holdCount + dodgeCount,
    budget: total,
    spent: holdCount * COST_HOLD + dodgeCount * COST_DODGE_PATH,
  }
}

function planWithMap(map: ReturnType<typeof computeSpecResources>, cfg: AgentResourceInput['cfg']): NekomataPiercePlan {
  const purr = map.get('nekomata_purr')
  const budget = purr?.total ?? 0
  const record = cfg as unknown as Record<string, unknown>
  const axisMode = Number(record.axisInSeconds ?? 0) > 0
  const axisPicks = Number((record.axisActionCounts as Record<string, number> | undefined)?.[PIERCE_MOVE_ID] ?? 0)
  const rawSetting = Number(record['setting:nekomata.stunCastShare'] ?? -1)
  const share = Number.isFinite(rawSetting) && rawSetting >= 0 ? rawSetting : Math.max(0, Math.min(1, Number(record.teamStunCoverage ?? 0)))
  const plan = planNekomataPierceCasts(budget, axisMode && axisPicks > 0 ? { axisHoldPicks: axisPicks } : { holdBudgetShare: share })
  // 回写 spendCounts/spendCosts 供资源卡展示（与 spec spendRule id 对齐）
  if (purr) {
    purr.spendCounts['nekomata_pierce_hold'] = plan.holdCount
    purr.spendCounts['nekomata_pierce_dodge'] = plan.dodgeCount
    purr.spendCosts['nekomata_pierce_hold'] = plan.holdCount * COST_HOLD
    purr.spendCosts['nekomata_pierce_dodge'] = plan.dodgeCount * COST_DODGE_PATH
  }
  return plan
}

function planFromCfg(cfg: AgentResourceInput['cfg'], state: AgentResourceInput['state']): NekomataPiercePlan {
  return planWithMap(computeSpecResources(spec, cfg, state), cfg)
}

function buildNekoCharConfig(input: AgentCharConfigInput): void {
  base.buildCharConfig?.(input)
}

function buildNekoResourceResult({ cfg, state }: AgentResourceResultInput) {
  const map = computeSpecResources(spec, cfg, state)
  planWithMap(map, cfg)
  return { specResources: Object.fromEntries(map) }
}

function buildNekoExecutions({ cfg, state, executions }: AgentResourceInput): void {
  const plan = planFromCfg(cfg, state)
  const counts = {
    'resource:nekomata_purr:nekomata_casts_total': plan.totalCount,
  }
  executions.push(...buildSpecEventExecutions(spec, {
    cfg,
    state,
    counts,
    getRowValue: (moveId, rowId) => rowId === 'damage' ? (cfg.mechanicRowValues?.[moveId] ?? 0) : 0,
  }))
}

function transformNekoPanel({ charResult, panel }: AgentSkillTransformInput): void {
  if (!panel) return
  if ((panel as any).__specPanelBuffApplied) return
  ;(panel as any).__specPanelBuffApplied = true
  const purr = charResult.specResources?.['nekomata_purr']
  if ((purr?.total ?? 0) > 0) {
    panel.dmgBonus = (panel.dmgBonus ?? 0) + 60
  }
}

function buildNekoResourceSections(input: AgentResourceSectionsInput) {
  return base.resourceSections?.(input) ?? []
}

export const nekomataMechanic: AgentMechanicModule = {
  id: 'agent:nekomata',
  agentIds: [NEKOMATA_AGENT_ID],
  name: '猫又',
  buildCharConfig: buildNekoCharConfig,
  buildResourceResult: buildNekoResourceResult,
  buildExecutions: buildNekoExecutions,
  transformSkillExecutions: transformNekoPanel,
  resourceSections: buildNekoResourceSections,
  settings: [{
    id: 'nekomata.stunCastShare',
    label: '猫又·失衡内释放占比',
    description: '失衡内无法极限闪避只能打 40 档长按，其余全打 30 档（尾巴失踪术+免费穿刺，净省10点）。-1 = 自动按失衡时间覆盖率拆分；0~1 手动覆盖。',
    default: -1,
    min: -1,
    max: 1,
    step: 0.05,
    suffix: '%',
  }],
}
