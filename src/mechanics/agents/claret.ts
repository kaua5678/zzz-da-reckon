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

/**
 * 克拉蕾（1611）v12 重录（2026-09-03，raw = nanoka 3.2.12+18601660）：
 *
 * 核心被动·苍白血宴（Lv.7）：伤害均为锐化伤害（def 基底，引擎 SHARPEN_DAMAGE_PROFILE 消费，
 * 锐暴伤害 150% 已随 level60.sharpCritDmg 接入）；**部分**锐化伤害命中积累残痕值，
 * 残痕值满时敌人进入[残痕]（最多 3 层）；斩金断铁/葬血强袭命中[残痕]敌人消耗 1 层触发[毁伤]。
 * 口径：残痕值每命中积累 = 招式 anomaly_buildup 表值（%），满 100 = 1 层（溢出浪费）；
 * 积蓄效率 = 1 + 核心 50% + 影画2 20%（状态近似常驻）。
 * 锐能：进场 +60（勘域 180s 一次 → 每局一次）；秘血铸锋（EX）消耗 60 → 每局 1 发。
 *   —— 旧「2 毁伤/局 → 2.5 锐能放不出 EX」问题由 v12 文本解决（用户 2026-09 口径确认）。
 * 核心被动（猩红铭刻/连携/终结/无垢熔锋期间）：暴击率 +30%、残痕积蓄效率 +50%（满覆盖近似）。
 * 额外能力·血裔传承：全队触发[浸染]时克拉蕾回 300 喧响（20s CD）；队友/自身触发[毁伤]时
 *   全队[锋御]进入[残锋]（锐暴伤害 +25%，40s 刷新）——残锋按自身面板近似（全队锋御同源）。
 * 影画1：猩红铭刻最大持续 +3s（时长无数值影响）；状态期间攻击命中无视 16% 电抗（满覆盖近似）。
 * 影画2：锐暴命中时残痕积蓄效率 +20%（并入积蓄效率倍率）；毁伤伤害倍率 ×130%（执行行 override）。
 * 影画4：锻星第三段（1611007 连续斩击 + 1611029 下砸）/血契共鸣(1611020)/千锤百炼(1611021)
 *   伤害 +20%（patchExecutions dmgBonus）。
 * 影画6：血契共鸣/千锤百炼重击命中不消耗残痕直接触发 1 次单体毁伤（连携+终结次数）。
 */
const CLARET_AGENT_ID = '1611'
/** 毁伤（斩金断铁/葬血强袭/影画6 共用载体的表 id，v12 = 1625.6%） */
export const MAIM_MOVE_ID = '1611013'
/** 葬血强袭表 id（v12 = 626.3%，3 段横斩合计） */
export const BLOOD_BURIAL_MOVE_ID = '1611014'
/** 秘血铸锋（锐能强特）表 id（v12 = 1249.6%） */
export const EX_MOVE_ID = '1611010'
/** 锐能：进场 60（勘域 180s 一次）；秘血铸锋 60/发 */
export const SHARPNESS_INITIAL = 60
export const SHARPNESS_COST_PER_EX = 60
/** 残痕值：满 100 = 1 层，上限 3 层 */
export const GASH_PER_LAYER = 100
export const GASH_MAX_STACKS = 3
/** 残余积蓄效率：核心被动 +50%（Lv.7）/ 影画2 锐暴 +20% */
export const GASH_EFF_CORE = 50
export const GASH_EFF_C2 = 20
/** 核心被动（Lv.7）：猩红铭刻/连携/终结/无垢熔锋期间暴击率 +30% */
export const CORE_CRIT_RATE = 30
/** 影画1：状态期间攻击命中无视 16% 电抗 */
export const C1_RES_IGNORE = 16
/** 影画2：毁伤倍率 ×130% */
export const C2_MAIM_MULT = 1.3
/** 影画4：锻星第三段/血契共鸣/千锤百炼 伤害 +20% */
export const M4_DMG_BONUS = 20
export const M4_MOVE_IDS = new Set(['1611007', '1611029', '1611020', '1611021'])
/** 影画6：连携/终结重击直接触发单体毁伤（不消耗残痕） */
/** 残锋：全队锋御 锐暴伤害 +25%（40s 刷新，满覆盖近似） */
export const RESIDUAL_EDGE_SHARP_CRIT_DMG = 25
/** 葬血强袭每施放至多 3 次毁伤（连续 3 段横斩，各命中触发） */
export const BURIAL_MAIM_PER_CAST = 3

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

function applyClaretPanel({ panel, cinemaLevel }: AgentPanelInput): void {
  // 核心被动 Lv.7：猩红铭刻/连携/终结/无垢熔锋期间 暴击率 +30%（状态高频维持，满覆盖近似）
  panel.critRate = (panel.critRate ?? 0) + CORE_CRIT_RATE
  // 残锋：队友/自身触发[毁伤]后全队锋御 锐暴伤害 +25%（40s 刷新；按自身面板近似）
  panel.sharpCritDmg = (panel.sharpCritDmg ?? 0) + RESIDUAL_EDGE_SHARP_CRIT_DMG
  // 影画1：猩红铭刻/连携/终结/无垢熔锋期间攻击命中无视 16% 电抗（状态高频维持，满覆盖近似）
  if ((cinemaLevel ?? 0) >= 1) {
    panel.enemyElectricResReduction = (panel.enemyElectricResReduction ?? 0) + C1_RES_IGNORE
  }
}

/**
 * 克拉蕾残痕/锐能资源（v12）：
 * 残痕值 = 平A聚合（秒均残痕值 × 平A时间）+ 秘血铸锋单发（234.96%）→ × 积蓄效率；
 * 满 100 = 1 层（上限 3，溢出浪费）；毁伤需求 = 斩金断铁×1 + 葬血强袭×3 + 影画6(连携+终结)；
 * 毁伤 = min(层数, 需求) × 覆盖率 + 影画6 直接毁伤；锐能 = 进场 60，秘血铸锋 60/发 → 1 发/局。
 */
export function computeClaretSharpResource(input: {
  basicGashPerSec: number
  basicAttackTime: number
  exGashValue: number
  exCount: number
  cleaveSpecialCount: number
  bloodBurialCount: number
  gashCoverage: number
  cinemaLevel: number
  chainCountTotal?: number
  ultimateCount?: number
}): ClaretSharpResourceSource {
  const cinemaLevel = Math.max(0, Math.floor(input.cinemaLevel ?? 0))
  const baseGash = Math.max(0, input.basicGashPerSec * input.basicAttackTime + input.exGashValue * input.exCount)
  const buildupMultiplier = 1 + GASH_EFF_CORE / 100 + (cinemaLevel >= 2 ? GASH_EFF_C2 / 100 : 0)
  const gashValuePct = baseGash * buildupMultiplier
  const gashStacks = Math.min(GASH_MAX_STACKS, Math.floor(gashValuePct / GASH_PER_LAYER))
  const cleaveCount = Math.max(0, Math.floor(input.cleaveSpecialCount))
  const burialCount = Math.max(0, Math.floor(input.bloodBurialCount))
  const c6Extra = cinemaLevel >= 6
    ? Math.max(0, Math.floor(Number(input.chainCountTotal ?? 0))) + Math.max(0, Math.floor(Number(input.ultimateCount ?? 0)))
    : 0
  const maimDemand = cleaveCount + burialCount * BURIAL_MAIM_PER_CAST + c6Extra
  const coverage = Math.max(0, Math.min(1, input.gashCoverage))
  const gashStackConsumed = Math.min(gashStacks, Math.max(0, maimDemand)) * coverage
  const maimFromCleave = Math.min(gashStackConsumed, cleaveCount)
  const maimFromBurial = Math.min(gashStackConsumed - maimFromCleave, burialCount * BURIAL_MAIM_PER_CAST)
  const maimCount = Math.floor(gashStackConsumed) + c6Extra
  const sharpnessGain = SHARPNESS_INITIAL
  const affordableExCount = Math.floor(sharpnessGain / SHARPNESS_COST_PER_EX)
  const sharpnessSpend = affordableExCount * SHARPNESS_COST_PER_EX
  return {
    gashValuePct,
    gashBuildupMultiplier: buildupMultiplier,
    gashStacks,
    maimDemand,
    gashStackConsumed,
    maimCount,
    maimFromCleave,
    maimFromBurial,
    maimFromC6: c6Extra,
    sharpnessGain,
    affordableExCount,
    sharpnessSpend,
    sharpnessRemaining: Math.max(0, sharpnessGain - sharpnessSpend),
    note: 'v12 口径：锐化伤害命中积累残痕值（平A聚合 + 秘血铸锋 234.96%），满 100 = 1 层（上限 3）；斩金断铁×1/葬血强袭×3 命中残痕各消耗 1 层触发毁伤；锐能 = 进场 60（勘域 180s 一次），秘血铸锋 60/发 → 1 发/局。',
  }
}

function buildClaretCharConfig({ skills, cinemaLevel, cfg }: AgentCharConfigInput): void {
  cfg.claretMaimMoveId = findMoveById(skills, MAIM_MOVE_ID)?.id ?? ''
  cfg.claretBloodBurialMoveId = findMoveById(skills, BLOOD_BURIAL_MOVE_ID)?.id ?? ''
  cfg.claretExMoveId = findMoveById(skills, EX_MOVE_ID)?.id ?? ''
  cfg.claretExDamageMultiplier = getRowValue(findMoveById(skills, EX_MOVE_ID), 'damage') || 1249.6
  cfg.claretExGashValue = getRowValue(findMoveById(skills, EX_MOVE_ID), 'anomaly_buildup') || 234.96
  cfg.claretMaimDamageMultiplier = getRowValue(findMoveById(skills, MAIM_MOVE_ID), 'damage') || 1625.6
  cfg.claretBloodBurialDamageMultiplier = getRowValue(findMoveById(skills, BLOOD_BURIAL_MOVE_ID), 'damage') || 626.3
  // 平A聚合残痕值（秒均）：血锻四式/锻星等 basic 行 anomaly_buildup 之和 × 时间 → 由资源结果回填
  cfg.claretCinemaLevel = cinemaLevel
  cfg.claretCleaveCount = Math.max(0, Math.floor(cfgSetting(cfg, 'claret.cleaveSpecialCount', 1)))
  cfg.claretBloodBurialCount = Math.max(0, Math.floor(cfgSetting(cfg, 'claret.bloodBurialCount', 1)))
  cfg.claretGashCoverage = Math.max(0, Math.min(1, Math.min(100, cfgSetting(cfg, 'claret.gashCoverage', 100)) / 100))
  // 秘血铸锋是锐能强特（costType=resource）：通用引擎不扣能量，强特行由本模块按锐能账本发行
  const exMove = findMoveById(skills, EX_MOVE_ID)
  cfg.claretExActionTime = exMove?.actionTime ?? 0
  cfg.claretExDecibelRecovery = getRowValue(exMove, 'decibel_recovery')
  cfg.skipGenericExSpecial = true
}

/** 从执行的执行行聚合残痕值来源（%）：anomaly_buildup × count，除毁伤/葬血强袭行（表值 0）外 */
export function sumGashValueFromExecutions(
  executions: Array<{ moveId?: string; count?: number; anomalyBuildUp?: number }>,
): number {
  let total = 0
  for (const exec of executions) {
    const bu = Number(exec.anomalyBuildUp ?? 0)
    if (bu <= 0) continue
    const count = Math.max(0, Number(exec.count) || 0)
    if (exec.moveId === 'basic_attack') {
      // 平A聚合行：anomalyBuildUp 已是秒均（× totalTime）
      total += bu * Math.max(0, Number((exec as any).totalTime) || 0)
    } else {
      total += bu * count
    }
  }
  return total
}

function buildClaretResourceSource(cfg: AgentCharConfigInput['cfg'], state: AgentResourceInput['state'], gashFromPlan: number) {
  return computeClaretSharpResource({
    basicGashPerSec: 0, // 平A聚合部分由 gashFromPlan 直接给定（= 0 时仅 EX 来源）
    basicAttackTime: 0,
    exGashValue: cfg.claretExGashValue ?? 234.96,
    exCount: Math.floor(SHARPNESS_INITIAL / SHARPNESS_COST_PER_EX),
    cleaveSpecialCount: cfg.claretCleaveCount ?? 0,
    bloodBurialCount: cfg.claretBloodBurialCount ?? 0,
    gashCoverage: cfg.claretGashCoverage ?? 1,
    cinemaLevel: cfg.claretCinemaLevel ?? 0,
    chainCountTotal: state.chainCountTotal ?? 0,
    ultimateCount: state.ultimateCount ?? 0,
  })
}

function buildClaretResourceResult({ cfg, state }: AgentResourceResultInput): Partial<CharacterResourceResult> {
  return {
    claretSharpResourceSource: buildClaretResourceSource(cfg, state, 0),
  }
}

function buildClaretExecutions({ cfg, state, executions, teamFrontlineSeconds: _t }: AgentResourceInput): void {
  const cinemaLevel = Math.max(0, Math.floor(cfg.claretCinemaLevel ?? 0))
  // 残痕值来源：按当前执行行聚合（平A聚合行秒均×时间 + 秘血铸锋单发）
  const gashFromPlan = sumGashValueFromExecutions(executions)
  const source = buildClaretResourceSource(cfg, state, gashFromPlan)
  const exCount = Math.max(0, Math.floor(source.affordableExCount))
  if (exCount > 0) {
    executions.push({
      moveId: EX_MOVE_ID,
      moveName: '强化特殊技（EX Special）：秘血铸锋（锐能 60/发）',
      category: 'special',
      count: exCount,
      actionTime: cfg.claretExActionTime ?? 0,
      comboAlignRatio: 0,
      totalTime: exCount * (cfg.claretExActionTime ?? 0),
      totalComboAlignTime: 0,
      energyConsume: 0,
      totalEnergyConsume: 0,
      decibelRecovery: cfg.claretExDecibelRecovery ?? 0,
      totalDecibelRecovery: exCount * (cfg.claretExDecibelRecovery ?? 0),
      energyRecovery: 0,
      totalEnergyRecovery: 0,
      timeBucket: 'necessary',
    })
  }
  const spec = getAgentSpec(CLARET_AGENT_ID)
  if (!spec) return
  const generated = buildSpecEventExecutions(spec, {
    cfg,
    state,
    counts: {
      claretCleaveCount: Math.max(0, Math.floor(cfg.claretCleaveCount ?? 0)),
      claretBloodBurialCount: Math.max(0, Math.floor(cfg.claretBloodBurialCount ?? 0)),
      claretMaimCount: Math.max(0, Math.floor(source.maimCount)),
      claretMaimFromCleave: Math.max(0, Math.floor(source.maimFromCleave)),
      claretMaimFromBurial: Math.max(0, Math.floor(source.maimFromBurial)),
      claretMaimFromC6: Math.max(0, Math.floor(source.maimFromC6)),
    },
    overrides: {
      claret_maim: { multiplier: (cfg.claretMaimDamageMultiplier ?? 1625.6) * (cinemaLevel >= 2 ? C2_MAIM_MULT : 1) },
      claret_blood_burial: { multiplier: cfg.claretBloodBurialDamageMultiplier ?? 626.3 },
    },
    getRowValue: (moveId, rowId) => (rowId === 'damage' ? ((cfg as any).mechanicRowValues?.[moveId] ?? 0) : 0),
  })
  executions.push(...generated)
}

function patchClaretExecutions({ cfg, state: _state, executions }: AgentResourceInput): void {
  const cinema = Math.max(0, Math.floor(cfg.claretCinemaLevel ?? 0))
  if (cinema < 4) return
  for (const exec of executions) {
    if (exec.moveId && M4_MOVE_IDS.has(exec.moveId)) {
      exec.dmgBonus = (exec.dmgBonus ?? 0) + M4_DMG_BONUS
    }
  }
}

function buildClaretResourceSections({ result }: AgentResourceSectionsInput) {
  const source = result.claretSharpResourceSource
  if (!source) return []
  return [
    {
      id: 'claret-gash-maim',
      title: '克拉蕾残痕·毁伤（v12）',
      summary: `残痕值 ${fmt(source.gashValuePct)}% → ${source.gashStacks} 层 · 消耗 ${Math.floor(source.gashStackConsumed)} 层 · 毁伤 × ${source.maimCount}`,
      rows: [
        { label: '残痕值', value: `${fmt(source.gashValuePct)}%`, detail: `平A聚合 + 秘血铸锋 234.96%；满 100 = 1 层（上限 3）` },
        { label: '积蓄效率', value: `×${fmt(source.gashBuildupMultiplier)}`, detail: `1 + 核心 50%（Lv.7）+ 影画2 20%` },
        { label: '毁伤需求', value: `${source.maimDemand} 次`, detail: '斩金断铁×1 + 葬血强袭×3 + 影画6(连携+终结)×1' },
        { label: '残痕消耗', value: `-${Math.floor(source.gashStackConsumed)} 层`, detail: '命中残痕状态敌人，每层一次毁伤（覆盖率折算）' },
        { label: '毁伤触发', value: `${source.maimCount} 次`, detail: `斩金断铁 ${source.maimFromCleave} + 葬血强袭 ${source.maimFromBurial} + 影画6 ${source.maimFromC6}` },
      ],
      footer: 'v12：残痕值由锐化伤害命中积累（平A + 秘血铸锋表值），详情见模块头注释；溢出（>3 层）浪费。',
    },
    {
      id: 'claret-sharpness',
      title: '克拉蕾锐能',
      summary: `进场 +${fmt(source.sharpnessGain)} · 秘血铸锋 -${fmt(source.sharpnessSpend)} · 结余 ${fmt(source.sharpnessRemaining)}`,
      rows: [
        { label: '锐能获取', value: `+${fmt(source.sharpnessGain)}`, detail: '进场 +60（勘域 180s 一次 → 每局一次）' },
        { label: '秘血铸锋', value: `${source.affordableExCount} 发`, detail: `每发 60 锐能（v12 原文「锐能消耗：60点」）` },
      ],
      footer: source.note,
    },
  ]
}

const settings: MechanicSetting[] = [
  {
    id: 'claret.cleaveSpecialCount',
    label: '克拉蕾斩金断铁次数',
    description: '残痕消耗来源之一（命中残痕敌 → 1 次毁伤）；默认每轮 1 次，可按实际轮转调整。',
    default: 1,
    min: 0,
    max: 20,
    step: 1,
    suffix: '次',
  },
  {
    id: 'claret.bloodBurialCount',
    label: '克拉蕾葬血强袭次数',
    description: '每施放至多 3 次毁伤（连续 3 段横斩各命中触发）；默认每轮 1 次。',
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
  description: 'v12：锐化伤害积累残痕值（满100=1层，上限3），斩金断铁/葬血强袭消耗残痕触发毁伤；锐能进场60/秘血铸锋60发；核心被动暴击率+30%与残锋锐暴+25%；影画1电抗无视16%、2毁伤×130%、4+20%、6直接毁伤。',
  applyPanel: applyClaretPanel,
  buildCharConfig: buildClaretCharConfig,
  buildExecutions: buildClaretExecutions,
  patchExecutions: patchClaretExecutions,
  buildResourceResult: buildClaretResourceResult,
  resourceSections: buildClaretResourceSections,
  settings,
}
