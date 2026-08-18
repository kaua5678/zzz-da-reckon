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
import type { CharacterResourceResult, ClaretSharpResourceSource } from '@/types/resource'
import { fmt } from '@/utils/format'
import { getAgentSpec } from '@/specs/registry'
import { buildSpecEventExecutions } from '@/specs/mechanics'

const CLARET_AGENT_ID = '1611'
const MAIM_MOVE_ID = '1611013'
const BLOOD_BURIAL_MOVE_ID = '1611014'
const MAIM_BURIAL_MOVE_ID = '1611015'
const SHARPNESS_COST_PER_EX = 60
const C2_SHARPNESS_PER_MAIM = 0.25
const GASH_PCT_PER_ACTIVE_SECOND = 3
const GASH_PCT_PER_STACK = 100 / 3
const PERSONAL_RESOURCE_DMG_BONUS_PER_POINT = 6.5

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

function applyClaretPanel({ panel }: AgentPanelInput): void {
  // 锋芒毕露：穿透率 +20%，造成失衡值 +10%；全局资源计算默认满覆盖。
  panel.penRatio = (panel.penRatio ?? 0) + 20
  panel.stunBuildUpBonus = (panel.stunBuildUpBonus ?? 0) + 10
}

/**
 * 克拉蕾残痕/锐能资源：
 * 队友为当前操作角色时每秒为敌人积累 3% 残痕值，1 层残痕 = 33.33%；斩金断铁/葬血强袭命中残痕敌人消耗 1 层并触发毁伤；
 * 全队触发毁伤时克拉蕾获得 1 点个人资源（二命额外回复 0.25 锐能）；葬血强袭发动时消耗所有个人资源，
 * 每消耗 1 点使葬血强袭与毁伤伤害倍率提升 6.5%；秘血铸锋消耗 60 锐能。
 */
export function computeClaretSharpResource(input: {
  teammateFrontlineSeconds: number
  exSpecialCount: number
  cleaveSpecialCount: number
  bloodBurialCount: number
  gashCoverage: number
  cinemaLevel: number
  sharpnessCost: number
}): ClaretSharpResourceSource {
  const teammateFrontlineSeconds = Math.max(0, input.teammateFrontlineSeconds)
  const gashValuePct = teammateFrontlineSeconds * GASH_PCT_PER_ACTIVE_SECOND
  const gashStacks = gashValuePct / GASH_PCT_PER_STACK
  const exCount = Math.max(0, Math.floor(input.exSpecialCount))
  const cleaveCount = Math.max(0, Math.floor(input.cleaveSpecialCount))
  const bloodBurialCount = Math.max(0, Math.floor(input.bloodBurialCount))
  const gashStackGain = cleaveCount + bloodBurialCount
  const coverage = Math.max(0, Math.min(1, input.gashCoverage))
  const gashStackConsumed = Math.floor(Math.min(gashStacks, gashStackGain) * coverage)
  const maimCount = gashStackConsumed
  const personalResourceGain = maimCount
  const personalResourcesConsumed = bloodBurialCount >= 1 ? personalResourceGain : 0
  const personalResourceDamageBonusPct = personalResourcesConsumed * PERSONAL_RESOURCE_DMG_BONUS_PER_POINT
  const sharpnessGain = maimCount + (input.cinemaLevel >= 2 ? maimCount * C2_SHARPNESS_PER_MAIM : 0)
  const costPerUse = Math.max(0, input.sharpnessCost || SHARPNESS_COST_PER_EX)
  const affordableExCount = Math.min(exCount, costPerUse > 0 ? Math.floor(sharpnessGain / costPerUse) : 0)
  const sharpnessSpend = affordableExCount * costPerUse
  const sharpnessRemaining = Math.max(0, sharpnessGain - sharpnessSpend)

  return {
    teammateFrontlineSeconds,
    gashValuePct,
    gashStacks,
    gashStackGain,
    gashStackConsumed,
    maimCount,
    personalResourceGain,
    personalResourcesConsumed,
    personalResourceDamageBonusPct,
    sharpnessGain,
    sharpnessSpend,
    sharpnessRemaining,
    note: '队友为当前操作角色时每秒积累3%残痕值，1层=33.33%；斩金断铁/葬血强袭命中消耗1层触发毁伤；全队毁伤给1点个人资源，二命额外回复0.25锐能；葬血强袭消耗所有个人资源，每点使葬血强袭与毁伤伤害倍率+6.5%；秘血铸锋消耗60锐能。',
  }
}

function buildClaretCharConfig({ skills, cinemaLevel, cfg }: AgentCharConfigInput): void {
  cfg.claretMaimMoveId = findMoveById(skills, MAIM_MOVE_ID)?.id ?? ''
  cfg.claretBloodBurialMoveId = findMoveById(skills, BLOOD_BURIAL_MOVE_ID)?.id ?? ''
  cfg.claretMaimBurialMoveId = findMoveById(skills, MAIM_BURIAL_MOVE_ID)?.id ?? ''
  cfg.claretBloodBurialDamageMultiplier = getRowValue(findMoveById(skills, BLOOD_BURIAL_MOVE_ID), 'damage') || 1711.2
  cfg.claretMaimBurialDamageMultiplier = getRowValue(findMoveById(skills, MAIM_BURIAL_MOVE_ID), 'damage') || 1232
  cfg.mechanicRowValues = {
    [MAIM_MOVE_ID]: getRowValue(findMoveById(skills, MAIM_MOVE_ID), 'damage'),
    [BLOOD_BURIAL_MOVE_ID]: cfg.claretBloodBurialDamageMultiplier,
    [MAIM_BURIAL_MOVE_ID]: cfg.claretMaimBurialDamageMultiplier,
  }
  cfg.claretSharpnessCost = SHARPNESS_COST_PER_EX
  cfg.claretCinemaLevel = cinemaLevel
  cfg.claretCleaveCount = Math.max(0, Math.floor(cfgSetting(cfg, 'claret.cleaveSpecialCount', 1)))
  cfg.claretBloodBurialCount = Math.max(0, Math.floor(cfgSetting(cfg, 'claret.bloodBurialCount', 1)))
  cfg.claretGashCoverage = Math.max(0, Math.min(1, cfgSetting(cfg, 'claret.gashCoverage', 1)))
}

function buildClaretResourceResult({ cfg, state, teamFrontlineSeconds }: AgentResourceResultInput): Partial<CharacterResourceResult> {
  return {
    claretSharpResourceSource: computeClaretSharpResource({
      teammateFrontlineSeconds: teamFrontlineSeconds ?? 0,
      exSpecialCount: state.exSpecialCount,
      cleaveSpecialCount: cfg.claretCleaveCount ?? 0,
      bloodBurialCount: cfg.claretBloodBurialCount ?? 0,
      gashCoverage: cfg.claretGashCoverage ?? 1,
      cinemaLevel: cfg.claretCinemaLevel ?? 0,
      sharpnessCost: cfg.claretSharpnessCost ?? SHARPNESS_COST_PER_EX,
    }),
  }
}

function buildClaretExecutions({ cfg, state, executions, teamFrontlineSeconds }: AgentResourceInput): void {
  const source = computeClaretSharpResource({
    teammateFrontlineSeconds: teamFrontlineSeconds ?? 0,
    exSpecialCount: state.exSpecialCount,
    cleaveSpecialCount: cfg.claretCleaveCount ?? 0,
    bloodBurialCount: cfg.claretBloodBurialCount ?? 0,
    gashCoverage: cfg.claretGashCoverage ?? 1,
    cinemaLevel: cfg.claretCinemaLevel ?? 0,
    sharpnessCost: cfg.claretSharpnessCost ?? SHARPNESS_COST_PER_EX,
  })
  const bonusMultiplier = 1 + source.personalResourceDamageBonusPct / 100
  const maimFromCleave = Math.min(source.maimCount, Math.max(0, Math.floor(cfg.claretCleaveCount ?? 0)))
  const maimFromBurial = Math.max(0, source.maimCount - maimFromCleave)
  const spec = getAgentSpec(CLARET_AGENT_ID)
  if (!spec) return
  const generated = buildSpecEventExecutions(spec, {
    cfg,
    state,
    counts: {
      claretBloodBurialCount: Math.max(0, Math.floor(cfg.claretBloodBurialCount ?? 0)),
      claretMaimFromCleave: maimFromCleave,
      claretMaimFromBurial: maimFromBurial,
    },
    overrides: {
      claret_blood_burial: { multiplier: (cfg.claretBloodBurialDamageMultiplier ?? 1711.2) * bonusMultiplier },
      claret_maim_burial: { multiplier: (cfg.claretMaimBurialDamageMultiplier ?? 1232) * bonusMultiplier },
    },
    getRowValue: (moveId, rowId) => (rowId === 'damage' ? (cfg.mechanicRowValues?.[moveId] ?? 0) : 0),
  })
  executions.push(...generated)
}

function buildClaretResourceSections({ result }: AgentResourceSectionsInput) {
  const source = result.claretSharpResourceSource
  if (!source) return []
  return [
    {
      id: 'claret-gash-maim',
      title: '克拉蕾残痕·毁伤',
      summary: `残痕值 ${fmt(source.gashValuePct)}% · ${fmt(source.gashStacks)} 层 · 消耗 ${source.gashStackConsumed} 层 · 毁伤 × ${source.maimCount}`,
      rows: [
        { label: '队友前台时间', value: `${fmt(source.teammateFrontlineSeconds)}s`, detail: '每秒积累 3% 残痕值' },
        { label: '总残痕值', value: `${fmt(source.gashValuePct)}%`, detail: `${fmt(source.gashStacks)} 层（1 层 = 33.33%）` },
        { label: '血华誓命中', value: `${source.gashStackGain} 次`, detail: '斩金断铁 + 葬血强袭' },
        { label: '残痕消耗', value: `-${source.gashStackConsumed} 层`, detail: '斩金断铁/葬血强袭命中残痕敌人' },
        { label: '毁伤触发', value: `${source.maimCount} 次`, detail: '每次消耗1层残痕' },
      ],
      footer: '残痕：队友当前操作时每秒 +3%，1 层 = 33.33%；全局资源计算，不关心单次满值。',
    },
    {
      id: 'claret-sharpness',
      title: '克拉蕾锐能',
      summary: `获取 +${fmt(source.sharpnessGain)} · 消耗 -${fmt(source.sharpnessSpend)} · 结余 ${fmt(source.sharpnessRemaining)}`,
      rows: [
        { label: '个人资源', value: `+${source.personalResourceGain}`, detail: '全队每次毁伤 +1' },
        { label: '葬血强袭消耗', value: `-${source.personalResourcesConsumed}`, detail: `每点使葬血强袭/毁伤伤害倍率 +${PERSONAL_RESOURCE_DMG_BONUS_PER_POINT}%` },
        { label: '个人资源增伤', value: `+${fmt(source.personalResourceDamageBonusPct)}%`, detail: `${source.personalResourcesConsumed} × ${PERSONAL_RESOURCE_DMG_BONUS_PER_POINT}%` },
        { label: '二命额外锐能', value: `+${fmt(Math.max(0, source.sharpnessGain - source.personalResourceGain))}`, detail: '每次毁伤 +0.25' },
        { label: '锐能消耗', value: `-${fmt(source.sharpnessSpend)}`, detail: `秘血铸锋 ${SHARPNESS_COST_PER_EX}/次` },
      ],
      footer: source.note,
    },
  ]
}

const settings: MechanicSetting[] = [
  {
    id: 'claret.cleaveSpecialCount',
    label: '克拉蕾斩金断铁次数',
    description: '残痕消耗来源之一；默认每轮 1 次，可按实际轮转调整。',
    default: 1,
    min: 0,
    max: 20,
    step: 1,
    suffix: '次',
  },
  {
    id: 'claret.bloodBurialCount',
    label: '克拉蕾葬血强袭次数',
    description: '发动时消耗所有个人资源，每点使葬血强袭与毁伤伤害倍率提升6.5%；默认每轮1次。',
    default: 1,
    min: 0,
    max: 20,
    step: 1,
    suffix: '次',
  },
  {
    id: 'claret.gashCoverage',
    label: '克拉蕾残痕覆盖率',
    description: '命中残痕状态敌人的覆盖率，默认 100%。',
    default: 100,
    min: 0,
    max: 100,
    step: 1,
    suffix: '%',
  },
]

export const claretMechanic: AgentMechanicModule = {
  id: 'agent:claret',
  agentIds: [CLARET_AGENT_ID],
  name: '克拉蕾',
  description: '残痕/锐能专属资源：队友前台时间每秒积累3%残痕值（1层=33.33%），血华誓招式消耗残痕触发毁伤；全队毁伤回复个人资源，葬血强袭消耗所有个人资源每点+6.5%伤害，秘血铸锋消耗锐能。',
  applyPanel: applyClaretPanel,
  buildCharConfig: buildClaretCharConfig,
  buildExecutions: buildClaretExecutions,
  buildResourceResult: buildClaretResourceResult,
  resourceSections: buildClaretResourceSections,
  settings,
}
