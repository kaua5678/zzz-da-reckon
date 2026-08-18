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

const NEKOMATA_AGENT_ID = '1021'
const spec = getAgentSpec(NEKOMATA_AGENT_ID)!
const base = specToMechanicModule(spec)

function readShare(cfg: AgentResourceInput['cfg']): number {
  const record = cfg as unknown as Record<string, unknown>
  const raw = Number(record['setting:nekomata.tailLossShare'] ?? 0.5)
  return Math.max(0, Math.min(1, Number.isFinite(raw) ? raw : 0.5))
}

function adjustPurrSpendCounts(cfg: AgentResourceInput['cfg'], state: AgentResourceInput['state']) {
  const map = computeSpecResources(spec, cfg, state)
  const purr = map.get('nekomata_purr')
  if (!purr) return map
  const share = readShare(cfg)
  const tailBudget = purr.total * share
  const nailBudget = purr.total * (1 - share)
  purr.spendCounts['nekomata_tail_loss'] = Math.floor(tailBudget / 30)
  purr.spendCounts['nekomata_nail_pierce'] = Math.floor(nailBudget / 40)
  purr.spendCosts['nekomata_tail_loss'] = purr.spendCounts['nekomata_tail_loss'] * 30
  purr.spendCosts['nekomata_nail_pierce'] = purr.spendCounts['nekomata_nail_pierce'] * 40
  return map
}

function buildNekoCharConfig(input: AgentCharConfigInput): void {
  base.buildCharConfig?.(input)
}

function buildNekoResourceResult({ cfg, state }: AgentResourceResultInput) {
  return { specResources: Object.fromEntries(adjustPurrSpendCounts(cfg, state)) }
}

function buildNekoExecutions({ cfg, state, executions }: AgentResourceInput): void {
  const map = adjustPurrSpendCounts(cfg, state)
  const purr = map.get('nekomata_purr')
  const counts = {
    'resource:nekomata_purr:nekomata_tail_loss': purr?.spendCounts['nekomata_tail_loss'] ?? 0,
    'resource:nekomata_purr:nekomata_nail_pierce': purr?.spendCounts['nekomata_nail_pierce'] ?? 0,
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
    id: 'nekomata.tailLossShare',
    label: '尾巴失踪术消耗占比',
    description: '总呼噜能量按此比例分配给尾巴失踪术（30点/次），剩余部分分配给绒爪穿刺（40点/次）；默认各 50%。',
    default: 0.5,
    min: 0,
    max: 1,
    step: 0.05,
    suffix: '%',
  }],
}
