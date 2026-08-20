/**
 * 派派（1281）—— 动力与影画整局总量模型
 *
 * 原文来源：data/raw/nanoka_missing/full/1281.json。
 * - 核心：引擎转/终结技旋转命中每次获得1层动力，20层上限；每层物理异常积蓄效率+4%。
 * - C1：轮胎转/引擎转/终结技旋转命中有50%概率额外+1层，动力上限提升至30层。
 * - C2：有亿点重、非常重、终结技下砸物理伤害+10%+每层动力1%。
 * - C4：队伍触发属性异常时回20能量，30秒CD；整局由可调触发次数注入能量池。
 *
 * 近似：引擎转/终结技默认按5/8次旋转命中；C1额外动力按50%期望值。
 * C6的引擎转时长+2秒与动力持续+4秒仅记录，不伪造额外命中；当前资源池不做12/16秒逐层衰减。
 */
import type {
  AgentCharConfigInput,
  AgentMechanicModule,
  AgentResourceInput,
  AgentResourceResultInput,
  AgentResourceSectionsInput,
  AgentSkillTransformInput,
} from '../types'

export const PIPER_ID = '1281'
export const PIPER_EX_HITS = 5
export const PIPER_ULT_HITS = 8
export const PIPER_C1_EXTRA_RATE = 0.5
export const PIPER_C2_BASE_DMG = 10
export const PIPER_C4_ENERGY = 20
export const PIPER_C4_CD = 30
export const PIPER_C2_MOVE_IDS = new Set(['1281006', '1281007', '1281008', '1281009', '1281014'])

export interface PiperMomentumCycle {
  cinemaLevel: number
  exHitCount: number
  ultimateHitCount: number
  specialHitCount: number
  baseGain: number
  c1ExpectedGain: number
  totalGain: number
  cap: number
  stacks: number
  durationSeconds: number
  note: string
}

function cfgSetting(cfg: AgentCharConfigInput['cfg'], id: string, fallback: number): number {
  const value = (cfg as unknown as Record<string, unknown>)[`setting:${id}`]
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

export function computePiperMomentum(input: {
  cinemaLevel: number
  exSpecialCount: number
  ultimateCount: number
  specialHitCount?: number
  exHitsPerUse?: number
  ultimateHitsPerUse?: number
}): PiperMomentumCycle {
  const cinema = Math.max(0, Math.floor(input.cinemaLevel))
  const exHitCount = Math.max(0, input.exSpecialCount) * Math.max(0, input.exHitsPerUse ?? PIPER_EX_HITS)
  const ultimateHitCount = Math.max(0, input.ultimateCount) * Math.max(0, input.ultimateHitsPerUse ?? PIPER_ULT_HITS)
  const specialHitCount = Math.max(0, input.specialHitCount ?? 0)
  const baseGain = exHitCount + ultimateHitCount
  const c1ExpectedGain = cinema >= 1
    ? (specialHitCount + exHitCount + ultimateHitCount) * PIPER_C1_EXTRA_RATE
    : 0
  const totalGain = baseGain + c1ExpectedGain
  const cap = cinema >= 1 ? 30 : 20
  return {
    cinemaLevel: cinema,
    exHitCount,
    ultimateHitCount,
    specialHitCount,
    baseGain,
    c1ExpectedGain,
    totalGain,
    cap,
    stacks: Math.min(cap, totalGain),
    durationSeconds: cinema >= 6 ? 16 : 12,
    note: '引擎转/终结技旋转命中按5/8次近似；C1的50%额外动力按期望值结算。',
  }
}

function buildPiperCharConfig({ cinemaLevel, cfg }: AgentCharConfigInput): void {
  const record = cfg as unknown as Record<string, unknown>
  record.piperCinemaLevel = cinemaLevel
  record.piperSpecialSpinHits = Math.max(0, cfgSetting(cfg, 'piper.specialSpinHits', 0))
  record.piperExHitsPerUse = Math.max(0, cfgSetting(cfg, 'piper.exHitsPerUse', PIPER_EX_HITS))
  record.piperUltHitsPerUse = Math.max(0, cfgSetting(cfg, 'piper.ultHitsPerUse', PIPER_ULT_HITS))
  if (cinemaLevel >= 4) {
    const maxTriggers = Math.max(1, Math.ceil((cfg.battleTime ?? 180) / PIPER_C4_CD))
    const triggers = Math.min(maxTriggers, Math.max(0, Math.floor(cfgSetting(cfg, 'piper.c4AnomalyTriggers', 1))))
    cfg.initialEnergyGift = (cfg.initialEnergyGift ?? 0) + triggers * PIPER_C4_ENERGY
    record.piperC4AnomalyTriggers = triggers
  }
}

function cycleFromInput({ cfg, state }: Pick<AgentResourceInput, 'cfg' | 'state'>): PiperMomentumCycle {
  const record = cfg as unknown as Record<string, unknown>
  return computePiperMomentum({
    cinemaLevel: Number(record.piperCinemaLevel ?? 0),
    exSpecialCount: state.exSpecialCount,
    ultimateCount: state.ultimateCount,
    specialHitCount: Number(record.piperSpecialSpinHits ?? 0),
    exHitsPerUse: Number(record.piperExHitsPerUse ?? PIPER_EX_HITS),
    ultimateHitsPerUse: Number(record.piperUltHitsPerUse ?? PIPER_ULT_HITS),
  })
}

function buildPiperResourceResult({ cfg, state }: AgentResourceResultInput) {
  return { specResources: { piper_momentum: cycleFromInput({ cfg, state }) } }
}

function transformPiperSkills({ charResult, panel }: AgentSkillTransformInput): void {
  if (!panel) return
  const cycle = charResult.specResources?.piper_momentum as PiperMomentumCycle | undefined
  const stacks = cycle?.stacks ?? 0
  panel.physicalAnomalyBuildUpEfficiency = (panel.physicalAnomalyBuildUpEfficiency ?? 0) + stacks * 4
  panel.piperMomentumStacks = stacks
}

function patchPiperExecutions({ cfg, state, executions }: AgentResourceInput): void {
  const cycle = cycleFromInput({ cfg, state })
  if (cycle.cinemaLevel < 2) return
  const bonus = PIPER_C2_BASE_DMG + cycle.stacks
  for (const exec of executions) {
    if (!exec.moveId || !PIPER_C2_MOVE_IDS.has(exec.moveId)) continue
    exec.dmgBonus = (exec.dmgBonus ?? 0) + bonus
  }
}

function buildPiperResourceSections({ result }: AgentResourceSectionsInput) {
  const cycle = result.specResources?.piper_momentum as PiperMomentumCycle | undefined
  if (!cycle) return []
  return [{
    id: 'piper-momentum',
    title: '派派·动力',
    summary: `动力 ${cycle.stacks} / ${cycle.cap} · 物理积蓄 +${cycle.stacks * 4}%`,
    rows: [
      { label: '引擎转命中', value: `${cycle.exHitCount} 次`, detail: '默认每次强化特殊技5次，可调' },
      { label: '终结技命中', value: `${cycle.ultimateHitCount} 次`, detail: '默认每次终结技8次，可调' },
      { label: 'C1期望额外动力', value: `+${cycle.c1ExpectedGain}`, detail: '轮胎转/引擎转/终结技旋转命中的50%期望值' },
      { label: '动力持续', value: `${cycle.durationSeconds}秒`, detail: cycle.cinemaLevel >= 6 ? '影画6：基础12秒+4秒' : '基础持续12秒' },
    ],
    footer: cycle.note,
  }]
}

export const piperMechanic: AgentMechanicModule = {
  id: 'agent:piper',
  agentIds: [PIPER_ID],
  name: '派派·动力蓄能',
  description: '动力循环、物理异常积蓄、C1动力期望、C2下砸增伤、C4异常回能。',
  settings: [
    { id: 'piper.specialSpinHits', label: '轮胎转旋转命中', description: '影画1计算50%额外动力使用', default: 0, min: 0, max: 60, step: 1, suffix: '次' },
    { id: 'piper.exHitsPerUse', label: '引擎转每次命中', description: '每次强化特殊技的旋转斩击命中数', default: PIPER_EX_HITS, min: 0, max: 30, step: 1, suffix: '次' },
    { id: 'piper.ultHitsPerUse', label: '终结技每次命中', description: '每次终结技的旋转斩击命中数', default: PIPER_ULT_HITS, min: 0, max: 30, step: 1, suffix: '次' },
    { id: 'piper.c4AnomalyTriggers', label: '影画4异常触发', description: '全队触发属性异常并满足30秒冷却的次数', default: 1, min: 0, max: 6, step: 1, suffix: '次' },
  ],
  buildCharConfig: buildPiperCharConfig,
  buildResourceResult: buildPiperResourceResult,
  transformSkillExecutions: transformPiperSkills,
  patchExecutions: patchPiperExecutions,
  resourceSections: buildPiperResourceSections,
}

export default piperMechanic
