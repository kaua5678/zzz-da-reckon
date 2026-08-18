import type {
  AgentMechanicModule,
  AgentPanelInput,
  AgentResourceResultInput,
  AgentResourceSectionsInput,
} from '../types'
import type { CharacterResourceResult, MechanicSetting, NangongMechanicSource } from '@/types/resource'
import { fmt } from '@/utils/format'

const NANGONG_AGENT_ID = '1511'
const ANOMALY_PROFICIENCY_BONUS = 60
const MASTERY_THRESHOLD = 110
const VIBRATO_MAX = 4
const VIBRATO_PER_STACK_BONUS = 25
const BEAT_INITIAL = 30
const BEAT_CAP = 100
const BEAT_PER_SECOND = 3.8
const BEAT_PER_ANOMALY = 12
const RELEASE_RATIOS: Record<string, number> = {
  ether: 720,
  electric: 360,
  fire: 900,
  physical: 63,
  ice: 90,
  wind: 36,
}

export function computeNangongMechanic(input: {
  anomalyMastery: number
  totalTime: number
  anomalyProcCount: number
  vibratoStacks: number
  releaseCount: number
}): NangongMechanicSource {
  const impactFromMastery = Math.max(0, input.anomalyMastery - MASTERY_THRESHOLD)
  const vibratoStacks = Math.min(VIBRATO_MAX, Math.max(0, Math.floor(input.vibratoStacks)))
  const beatRegen = input.totalTime * BEAT_PER_SECOND + Math.min(input.totalTime / 6, input.anomalyProcCount) * BEAT_PER_ANOMALY
  const beatTotal = Math.min(BEAT_CAP, BEAT_INITIAL + beatRegen)
  return {
    anomalyProficiencyBonus: ANOMALY_PROFICIENCY_BONUS,
    impactFromMastery,
    vibratoStacks,
    vibratoMax: VIBRATO_MAX,
    releaseCount: Math.max(0, Math.floor(input.releaseCount)),
    releaseRatios: RELEASE_RATIOS,
    beatInitial: BEAT_INITIAL,
    beatRegen,
    beatTotal,
    beatCap: BEAT_CAP,
    note: '颤音：失衡状态下异放/紊乱/进入异常+1层，最多4层；清除时按属性比例结算异放（以太720/电360/火900/物理63/冰90/风36%，每层+25%）。重拍：进场30，每秒3.8，队友异常+12（6秒一次），上限100。',
  }
}

function applyNangongPanel({ panel }: AgentPanelInput): void {
  panel.anomalyProficiency = (panel.anomalyProficiency ?? 0) + ANOMALY_PROFICIENCY_BONUS
  panel.impact = (panel.impact ?? 0) + Math.max(0, (panel.anomalyMastery ?? 0) - MASTERY_THRESHOLD)
}

function buildNangongResourceResult({ cfg, state }: AgentResourceResultInput): Partial<CharacterResourceResult> {
  return {
    nangongMechanicSource: computeNangongMechanic({
      anomalyMastery: cfg.panel.anomalyMastery ?? 0,
      totalTime: state.frontlineTime + state.backstageTime,
      anomalyProcCount: 0,
      vibratoStacks: 0,
      releaseCount: 0,
    }),
  }
}

function buildNangongResourceSections({ result }: AgentResourceSectionsInput) {
  const source = result.nangongMechanicSource
  if (!source) return []
  return [
    {
      id: 'nangong-beat',
      title: '南宫羽重拍',
      summary: `${fmt(source.beatTotal)}/${source.beatCap}`,
      rows: [
        { label: '进场', value: `+${source.beatInitial}` },
        { label: '接战回复', value: `+${fmt(source.beatRegen)}`, detail: `每秒${BEAT_PER_SECOND} + 异常触发×${BEAT_PER_ANOMALY}` },
      ],
      footer: '重拍回复来源与消耗手段待进一步确认。',
    },
    {
      id: 'nangong-vibrato',
      title: '南宫羽颤音·异放',
      summary: `${source.vibratoStacks}/${source.vibratoMax} 层 · 异放 × ${source.releaseCount}`,
      rows: [
        { label: '叠层', value: `${source.vibratoStacks}/${source.vibratoMax}`, detail: '失衡状态异常事件+1层' },
        { label: '属性比例', value: Object.entries(source.releaseRatios).map(([k, v]) => `${k} ${v}%`).join(' / ') },
        { label: '每层加成', value: `+${VIBRATO_PER_STACK_BONUS}%`, detail: '异放伤害比例每层+25%' },
      ],
      footer: source.note,
    },
  ]
}

const settings: MechanicSetting[] = [
  {
    id: 'nangong.anomalyProcCount',
    label: '南宫羽异常触发次数',
    description: '失衡期间全队异放/紊乱/异常进入次数，用于颤音叠层与重拍回复。',
    default: 0,
    min: 0,
    max: 30,
    step: 1,
    suffix: '次',
  },
]

export const nangongMechanic: AgentMechanicModule = {
  id: 'agent:nangong',
  agentIds: [NANGONG_AGENT_ID],
  name: '南宫羽',
  description: '重拍/颤音/异放：接战回重拍，失衡异常叠颤音，清除时按属性比例结算异放；异常精通+60，掌控超110转冲击。',
  applyPanel: applyNangongPanel,
  buildResourceResult: buildNangongResourceResult,
  resourceSections: buildNangongResourceSections,
  settings,
}
