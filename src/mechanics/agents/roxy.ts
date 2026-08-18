import type {
  AgentCharConfigInput,
  AgentMechanicModule,
  AgentPanelInput,
  AgentResourceInput,
  AgentResourceResultInput,
  AgentResourceSectionsInput,
} from '../types'
import type { MechanicSetting } from '@/types/resource'
import type { AgentSkills, SkillMove } from '@/types/catalog'
import type { CharacterResourceResult, RoxyWindEnergySource } from '@/types/resource'
import { fmt } from '@/utils/format'
import { getAgentSpec } from '@/specs/registry'
import { buildSpecEventExecutions } from '@/specs/mechanics'
import { applySpecAttributeConversions } from '@/specs/runtime'

const ROXY_AGENT_ID = '1621'
const ENERGY_PER_WIND_ENERGY = 30
const WIND_ENERGY_MAX = 3
const WIND_CANNON_MOVE_ID = '1621009'
const WIND_EYE_MOVE_ID = '1621021'
const MINI_TORNADO_MOVE_ID = '1621006'
const CYCLONE_HAMMER_MOVE_ID = '1621005'
const DEFAULT_MINI_TORNADO_SECONDS = 5

function findMoveById(skills: AgentSkills | undefined, moveId: string): SkillMove | null {
  if (!skills) return null
  for (const category of skills.categories) {
    const move = category.moves.find(item => item.id === moveId)
    if (move) return move
  }
  return null
}

function getRowValue(move: SkillMove | null | undefined, rowId: string): number {
  if (!move) return 0
  return move.rows.find(row => row.id === rowId)?.values[0] ?? 0
}

function cfgSetting(cfg: AgentCharConfigInput['cfg'], id: string, fallback: number): number {
  const record = cfg as unknown as Record<string, unknown>
  const value = record[`setting:${id}`]
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/**
 * 洛克茜风能/风眼资源：
 * 每消耗 30 能量获得 1 点风能（3 只是存量上限，不限制整局总消耗）；起风/乘风结束时消耗 1 点风能触发风炮并生成 1 个风眼；
 * 旋风锤引爆风眼生成追踪小旋风，其余风眼被摧毁时同样结算一次风眼伤害。
 */
export function computeRoxyWindEnergy(input: {
  exSpecialCount: number
  exSpecialEnergyConsume: number
  cycloneHammerCount?: number
  miniTornadoSeconds?: number
}): RoxyWindEnergySource {
  const exCount = Math.max(0, Math.floor(input.exSpecialCount))
  const perUse = Math.max(0, input.exSpecialEnergyConsume || 20)
  const energySpentTotal = exCount * perUse
  const windEnergyGain = Math.floor(energySpentTotal / ENERGY_PER_WIND_ENERGY)
  const windCannonCount = Math.min(windEnergyGain, exCount)
  const windEyeGenerated = windCannonCount
  const hammerCount = Math.max(0, Math.floor(input.cycloneHammerCount ?? windEyeGenerated))
  const windEyeDestroyedByCyclone = Math.min(hammerCount, windEyeGenerated)
  const windEyeDestroyedOther = Math.max(0, windEyeGenerated - windEyeDestroyedByCyclone)
  const miniTornadoSeconds = Math.max(0, input.miniTornadoSeconds ?? DEFAULT_MINI_TORNADO_SECONDS)

  return {
    energySpentTotal,
    windEnergyGain,
    windEnergyCap: WIND_ENERGY_MAX,
    windCannonCount,
    windEyeGenerated,
    windEyeDestroyedByCyclone,
    windEyeDestroyedOther,
    miniTornadoSeconds,
    miniTornadoDamageSeconds: windEyeDestroyedByCyclone * miniTornadoSeconds,
    note: '每消耗30能量获得1点风能（3为存量上限，整局总获得不设上限）；默认获得多少消耗多少；风炮消耗1点风能并生成1个风眼；旋风锤引爆风眼生成小旋风，其余风眼被摧毁时结算一次风眼伤害。',
  }
}

function buildRoxyCharConfig({ skills, cfg }: AgentCharConfigInput): void {
  cfg.roxyWindCannonMoveId = findMoveById(skills, WIND_CANNON_MOVE_ID)?.id ?? ''
  cfg.roxyWindEyeMoveId = findMoveById(skills, WIND_EYE_MOVE_ID)?.id ?? ''
  cfg.roxyMiniTornadoMoveId = findMoveById(skills, MINI_TORNADO_MOVE_ID)?.id ?? ''
  cfg.roxyCycloneHammerMoveId = findMoveById(skills, CYCLONE_HAMMER_MOVE_ID)?.id ?? ''
  cfg.roxyCycloneHammerCount = Math.max(0, cfgSetting(cfg, 'roxy.cycloneHammerCount', 0))
  cfg.roxyMiniTornadoSeconds = Math.max(0, cfgSetting(cfg, 'roxy.miniTornadoSeconds', DEFAULT_MINI_TORNADO_SECONDS))
  cfg.mechanicRowValues = {
    '1621008': getRowValue(findMoveById(skills, '1621008'), 'damage'),
    '1621009': getRowValue(findMoveById(skills, WIND_CANNON_MOVE_ID), 'damage'),
    '1621021': getRowValue(findMoveById(skills, WIND_EYE_MOVE_ID), 'damage'),
    '1621006': getRowValue(findMoveById(skills, MINI_TORNADO_MOVE_ID), 'damage'),
  }
}

function applyRoxyPanel({ panel }: AgentPanelInput): void {
  // 初始防御 >1500：每点 +1.4 攻击、+0.2 冲击（上限 1000/60），由 spec attributeConversions 驱动。
  applySpecAttributeConversions(panel, getAgentSpec(ROXY_AGENT_ID)?.attributeConversions ?? [])
}

function buildRoxyResourceResult({ cfg, state }: AgentResourceResultInput): Partial<CharacterResourceResult> {
  return {
    roxyWindEnergySource: computeRoxyWindEnergy({
      exSpecialCount: state.exSpecialCount,
      exSpecialEnergyConsume: cfg.exSpecialEnergyConsume,
      cycloneHammerCount: cfg.roxyCycloneHammerCount,
      miniTornadoSeconds: cfg.roxyMiniTornadoSeconds,
    }),
  }
}

function buildRoxyExecutions({ cfg, state, executions }: AgentResourceInput): void {
  const source = computeRoxyWindEnergy({
    exSpecialCount: state.exSpecialCount,
    exSpecialEnergyConsume: cfg.exSpecialEnergyConsume,
    cycloneHammerCount: cfg.roxyCycloneHammerCount,
    miniTornadoSeconds: cfg.roxyMiniTornadoSeconds,
  })
  const spec = getAgentSpec(ROXY_AGENT_ID)
  if (!spec) return
  const generated = buildSpecEventExecutions(spec, {
    cfg,
    state,
    counts: {
      roxyWindCannonCount: source.windCannonCount,
      roxyWindEyeGenerated: source.windEyeGenerated,
      roxyMiniTornadoDamageSeconds: source.miniTornadoDamageSeconds,
    },
    getRowValue: (moveId, rowId) => (rowId === 'damage' ? (cfg.mechanicRowValues?.[moveId] ?? 0) : 0),
  })
  executions.push(...generated)
}

function buildRoxyResourceSections({ result }: AgentResourceSectionsInput) {
  const source = result.roxyWindEnergySource
  if (!source) return []
  return [
    {
      id: 'roxy-wind-energy',
      title: '洛克茜风能',
      summary: `风能 +${source.windEnergyGain} · 风炮 × ${source.windCannonCount}`,
      rows: [
        { label: '强特耗能', value: `${fmt(source.energySpentTotal)}`, detail: '每 30 能量获得 1 点风能' },
        { label: '风能获取', value: `+${source.windEnergyGain}`, detail: '整局总获得不设上限' },
        { label: '风炮触发', value: `${source.windCannonCount} 次`, detail: '每次消耗 1 点风能' },
      ],
      footer: '风能：每消耗30能量+1，整局获得不设上限。',
    },
    {
      id: 'roxy-wind-eye',
      title: '洛克茜风眼',
      summary: `生成 ${source.windEyeGenerated} · 旋风锤引爆 ${source.windEyeDestroyedByCyclone} · 小旋风 ${source.miniTornadoDamageSeconds} 秒`,
      rows: [
        { label: '风眼生成', value: `${source.windEyeGenerated} 个`, detail: '风炮消耗风能后生成' },
        { label: '旋风锤引爆', value: `${source.windEyeDestroyedByCyclone} 个`, detail: '生成追踪小旋风' },
        { label: '其余摧毁', value: `${source.windEyeDestroyedOther} 个`, detail: '同样结算风眼毁坏伤害' },
        { label: '小旋风秒伤', value: `${source.miniTornadoDamageSeconds} 次`, detail: `每个引爆风眼持续 ${source.miniTornadoSeconds} 秒` },
      ],
      footer: source.note,
    },
  ]
}

const settings: MechanicSetting[] = [
  {
    id: 'roxy.cycloneHammerCount',
    label: '洛克茜旋风锤引爆风眼次数',
    description: '0 表示自动按风眼数全部引爆；也可手动设置实际旋风锤次数。',
    default: 0,
    min: 0,
    max: 9,
    step: 1,
    suffix: '次',
  },
  {
    id: 'roxy.miniTornadoSeconds',
    label: '洛克茜小旋风持续秒数',
    description: '每个被旋风锤引爆的风眼生成的小旋风按秒结算伤害的持续时长，默认 5 秒。',
    default: 5,
    min: 0,
    max: 30,
    step: 1,
    suffix: '秒',
  },
]

export const roxyMechanic: AgentMechanicModule = {
  id: 'agent:roxy',
  agentIds: [ROXY_AGENT_ID],
  name: '洛克茜',
  description: '风能/风眼专属资源：每30能量获得1点风能，风炮消耗风能生成风眼，旋风锤引爆风眼产生小旋风并按秒造成伤害。',
  applyPanel: applyRoxyPanel,
  buildCharConfig: buildRoxyCharConfig,
  buildExecutions: buildRoxyExecutions,
  buildResourceResult: buildRoxyResourceResult,
  resourceSections: buildRoxyResourceSections,
  settings,
}
