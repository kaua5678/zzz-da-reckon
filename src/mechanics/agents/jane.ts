import type {
  AgentMechanicModule,
  AgentPanelInput,
  AgentResourceResultInput,
  AgentResourceSectionsInput,
} from '../types'
import type { CharacterResourceResult, JaneMechanicSource, MechanicSetting } from '@/types/resource'
import { fmt } from '@/utils/format'

const JANE_AGENT_ID = '1261'
const ASSAULT_CRIT_BASE = 20
const ASSAULT_CRIT_PER_MASTERY = 0.1
const ASSAULT_CRIT_DMG = 50
const BITE_DURATION_SECONDS = 10
const FRENZY_BUILD_UP_BONUS_CORE = 25
const MASTERY_ATK_THRESHOLD = 120
const ATK_PER_MASTERY_OVER = 2
const ATK_FROM_MASTERY_CAP = 600
const POTENTIAL_ASSAULT_CRIT_DMG = 30

export function computeJaneMechanic(input: {
  anomalyProficiency: number
  frenzyActive: boolean
  frontlineSeconds: number
}): JaneMechanicSource {
  const mastery = Math.max(0, input.anomalyProficiency)
  const assaultCritRate = ASSAULT_CRIT_BASE + mastery * ASSAULT_CRIT_PER_MASTERY
  return {
    assaultCritBaseRate: ASSAULT_CRIT_BASE,
    assaultCritRatePerMastery: ASSAULT_CRIT_PER_MASTERY,
    assaultCritRate,
    assaultCritDmgBonus: POTENTIAL_ASSAULT_CRIT_DMG,
    frenzyBuildUpBonus: FRENZY_BUILD_UP_BONUS_CORE,
    atkFromMastery: Math.min(ATK_FROM_MASTERY_CAP, Math.max(0, mastery - MASTERY_ATK_THRESHOLD) * ATK_PER_MASTERY_OVER),
    frenzyActive: input.frenzyActive,
    biteSeconds: Math.max(0, input.frontlineSeconds),
    note: '啮咬：攻击命中使敌人进入状态，持续10秒；强击对啮咬目标可暴击（基础20%+精通0.1%/点，暴伤50%），潜能觉醒满级额外+30%强击暴伤；狂热心流满进入狂热，物理异常积蓄效率+25%，精通>120每点+2攻击（上限600）。',
  }
}

function applyJanePanel({ panel }: AgentPanelInput): void {
  const source = computeJaneMechanic({
    anomalyProficiency: panel.anomalyProficiency ?? 0,
    frenzyActive: true,
    frontlineSeconds: 0,
  })
  panel.assaultCritRate = (panel.assaultCritRate ?? 0) + source.assaultCritRate
  panel.assaultCritDmg = (panel.assaultCritDmg ?? 0) + ASSAULT_CRIT_DMG
  // 潜能觉醒只给简自身触发的强击吃，乱流不继承；由异常池按 janeAssaultCritDmgBonus 单独结算。
  panel.janeAssaultCritDmgBonus = source.assaultCritDmgBonus
}

function buildJaneResourceResult({ cfg, state }: AgentResourceResultInput): Partial<CharacterResourceResult> {
  return {
    janeMechanicSource: computeJaneMechanic({
      anomalyProficiency: cfg.panel.anomalyProficiency ?? 0,
      frenzyActive: true,
      frontlineSeconds: state.frontlineTime,
    }),
  }
}

function buildJaneResourceSections({ result }: AgentResourceSectionsInput) {
  const source = result.janeMechanicSource
  if (!source) return []
  return [{
    id: 'jane-mechanic',
    title: '简·啮咬/狂热/强击暴击',
    summary: `强击暴击率 ${fmt(source.assaultCritRate)}% · 狂热 ${source.frenzyActive ? '生效' : '未生效'}`,
    rows: [
      { label: '啮咬覆盖', value: `${fmt(source.biteSeconds)}s`, detail: '攻击命中使敌人陷入啮咬，持续10秒' },
      { label: '强击暴击率', value: `${fmt(source.assaultCritRate)}%`, detail: `基础20% + 异常精通×0.1%` },
      { label: '强击暴击伤害', value: '50%', detail: '强击对啮咬目标可暴击' },
      { label: '潜能强击暴伤', value: `+${source.assaultCritDmgBonus}%`, detail: '潜能觉醒：致命舞步' },
      { label: '狂热积蓄提升', value: `+${source.frenzyBuildUpBonus}%`, detail: '物理异常积蓄效率（核心，默认满覆盖）' },
      { label: '精通转攻击', value: `+${fmt(source.atkFromMastery)}`, detail: '精通>120每点+2，上限600' },
    ],
    footer: source.note,
  }]
}

const settings: MechanicSetting[] = [
  {
    id: 'jane.frenzyActive',
    label: '简狂热状态生效',
    description: '全局资源计算默认按满覆盖生效。',
    default: 1,
    min: 0,
    max: 1,
    step: 1,
    suffix: '',
  },
]

export const janeMechanic: AgentMechanicModule = {
  id: 'agent:jane',
  agentIds: [JANE_AGENT_ID],
  name: '简',
  description: '啮咬/狂热/强击暴击：攻击施加啮咬10秒，强击对啮咬目标可暴击（基础20%+精通0.1%/点，暴伤50%）。',
  applyPanel: applyJanePanel,
  buildResourceResult: buildJaneResourceResult,
  resourceSections: buildJaneResourceSections,
  settings,
}
