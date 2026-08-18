import type {
  AgentMechanicModule,
  AgentResourceResultInput,
  AgentResourceSectionsInput,
} from '../types'
import type { CharacterResourceResult, RemielleMechanicSource } from '@/types/resource'
import { fmt } from '@/utils/format'

const REMIELLE_AGENT_ID = '1581'
const VOIDFLARE_MAX = 3
const VOIDFLARE_INITIAL = 3
const REFRINGE_COEFFICIENT_PER_AP = 0.02
const LUMINIZE_MULTIPLIER_PER_AP = 0.1

export function computeRemielleMechanic(input: {
  anomalyProficiency: number
}): RemielleMechanicSource {
  const ap = Math.max(0, input.anomalyProficiency)
  return {
    voidflareStored: VOIDFLARE_INITIAL,
    voidflareMax: VOIDFLARE_MAX,
    refringeCoefficient: ap * REFRINGE_COEFFICIENT_PER_AP,
    luminizeMultiplierBonus: ap * LUMINIZE_MULTIPLIER_PER_AP,
    note: '虚曜：最多储存3个，队友触发异常反应生成；花羽轮舞/缭乱终幕/垂虹/惊鸿命中后触发耀变，按储存异常效果强度结算招式对应倍率；异化系数=异常精通×0.02%，耀变倍率提升=异常精通×0.1%。耀变次数由异常池按队友异常触发自动结算，不由用户直接调整。',
  }
}

function buildRemielleResourceResult({ cfg }: AgentResourceResultInput): Partial<CharacterResourceResult> {
  return {
    remielleMechanicSource: computeRemielleMechanic({
      anomalyProficiency: cfg.panel.anomalyProficiency ?? 0,
    }),
  }
}

function buildRemielleResourceSections({ result }: AgentResourceSectionsInput) {
  const source = result.remielleMechanicSource
  if (!source) return []
  return [
    {
      id: 'remielle-voidflare',
      title: '蕾米埃尔虚曜·耀变',
      summary: `虚曜 ${source.voidflareStored}/${source.voidflareMax} · 耀变由异常池自动结算`,
      rows: [
        { label: '虚曜储存', value: `${source.voidflareStored}/${source.voidflareMax}`, detail: '队友异常反应生成，最多存3个' },
        { label: '耀变触发', value: '自动', detail: '花羽轮舞/缭乱终幕/垂虹/惊鸿命中后触发，次数由队友异常触发池自动计算' },
        { label: '异化系数', value: `${fmt(source.refringeCoefficient)}%`, detail: '异常精通 × 0.02%' },
        { label: '耀变倍率提升', value: `${fmt(source.luminizeMultiplierBonus)}%`, detail: '异常精通 × 0.1%' },
      ],
      footer: source.note,
    },
  ]
}

export const remielleMechanic: AgentMechanicModule = {
  id: 'agent:remielle',
  agentIds: [REMIELLE_AGENT_ID],
  name: '蕾米埃尔',
  description: '虚曜/耀变/异化系数：队友异常反应生成虚曜，特定招式命中触发耀变；异化系数与耀变倍率随异常精通提升。',
  buildResourceResult: buildRemielleResourceResult,
  resourceSections: buildRemielleResourceSections,
}
