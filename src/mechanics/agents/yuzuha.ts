import type {
  AgentMechanicModule,
  AgentResourceResultInput,
  AgentResourceSectionsInput,
} from '../types'
import type { CharacterResourceResult, MechanicSetting, YuzuhaMechanicSource } from '@/types/resource'
import { fmt } from '@/utils/format'

const YUZUHA_AGENT_ID = '1411'
const SWEETNESS_INITIAL = 3
const SWEETNESS_CAP = 6
const TEAM_ATK_RATIO = 0.4
const TEAM_ATK_CAP = 600
const TEAM_DMG_BONUS = 15
const CHARGED_CANNON_DMG_RATIO = 300

export function computeYuzuhaMechanic(input: {
  initialAtk: number
  chainEntryCount: number
  chargedCannonCount: number
}): YuzuhaMechanicSource {
  const sweetnessTotal = Math.min(SWEETNESS_CAP, SWEETNESS_INITIAL + Math.max(0, input.chainEntryCount))
  const teamAtkBonus = Math.min(TEAM_ATK_CAP, Math.max(0, input.initialAtk) * TEAM_ATK_RATIO)
  return {
    sweetnessInitial: SWEETNESS_INITIAL,
    sweetnessFromChain: Math.max(0, input.chainEntryCount),
    sweetnessTotal,
    sweetnessCap: SWEETNESS_CAP,
    teamAtkBonus,
    teamAtkCap: TEAM_ATK_CAP,
    teamDmgBonus: TEAM_DMG_BONUS,
    note: '甜度点：进场3点、上限6，其他角色连携入场+1（二命），六命招架成功额外+1；狸之愿：40%初始攻击力（上限600）并+15%伤害，持续40秒；蓄能强力炮弹每0.4秒消耗1甜度点，300%攻击力物理伤害。',
  }
}

function buildYuzuhaResourceResult({ cfg }: AgentResourceResultInput): Partial<CharacterResourceResult> {
  return {
    yuzuhaMechanicSource: computeYuzuhaMechanic({
      initialAtk: cfg.panel.atk ?? 0,
      chainEntryCount: 0,
      chargedCannonCount: 0,
    }),
  }
}

function buildYuzuhaResourceSections({ result }: AgentResourceSectionsInput) {
  const source = result.yuzuhaMechanicSource
  if (!source) return []
  return [
    {
      id: 'yuzuha-sweetness',
      title: '柚叶甜度点',
      summary: `${source.sweetnessTotal}/${source.sweetnessCap}`,
      rows: [
        { label: '进场甜度', value: `+${source.sweetnessInitial}` },
        { label: '连携入场', value: `+${source.sweetnessFromChain}`, detail: '其他角色连携技入场+1（二命）' },
      ],
      footer: '六命招架成功额外+1；支援突击蓄能每0.4秒消耗1点追加300%攻击力物理伤害。',
    },
    {
      id: 'yuzuha-liwang-wish',
      title: '柚叶狸之愿（全队）',
      summary: `攻击 +${fmt(source.teamAtkBonus)}（上限${source.teamAtkCap}）· 伤害 +${source.teamDmgBonus}%`,
      rows: [
        { label: '攻击力加成', value: `+${fmt(source.teamAtkBonus)}`, detail: `40%初始攻击力` },
        { label: '伤害提升', value: `+${source.teamDmgBonus}%`, detail: '持续40秒，重复触发刷新' },
      ],
      footer: source.note,
    },
  ]
}

const settings: MechanicSetting[] = [
  {
    id: 'yuzuha.chainEntryCount',
    label: '柚叶连携入场次数',
    description: '其他角色通过连携技入场时柚叶获得1甜度点；默认0，可按轮转调整。',
    default: 0,
    min: 0,
    max: 20,
    step: 1,
    suffix: '次',
  },
]

export const yuzuhaMechanic: AgentMechanicModule = {
  id: 'agent:yuzuha',
  agentIds: [YUZUHA_AGENT_ID],
  name: '柚叶',
  description: '甜度点/狸之愿：进场3甜度点，连携入场+1；强化特殊技/终结技命中为全队提供攻击与伤害增益。',
  buildResourceResult: buildYuzuhaResourceResult,
  resourceSections: buildYuzuhaResourceSections,
  settings,
}
