/**
 * 派派（1281）—— 动力与影画整局总量模型
 *
 * 原文来源：data/raw/nanoka_missing/full/1281.json。
 * 用户口径 2026-08-26：动力默认一直满（平A回能 + 强特耗能，很容易续上——一开始转满，后面点一下就能续），
 * 所以动力恒为满层，不用管旋转命中次数。影画2 增伤 = 10% + 满层动力（C0 20层=30%、影画1 30层=40%）。
 * - 核心：每层动力物理异常积蓄效率 +4%，满层恒生效。
 * - 强特（引擎转）：先持续耗能 20/秒、末段下砸耗能 20；通常秒接下砸（耗能慢），能量太多才长按——不影响动力满层口径。
 * - C1：动力上限 20→30（额外 50% 动力不影响，因为恒满）。
 * - C2：有亿点重、非常重、终结下砸物理增伤 10%+满层动力（恒 30%/40%）。
 * - C4：队伍触发属性异常回 20 能量，30 秒 CD；整局由可调触发次数注入能量池。
 * - C6：动力持续 12→16 秒（仅记录）；引擎转时长 +2 秒不伪造额外命中。
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
export const PIPER_C2_BASE_DMG = 10
export const PIPER_C4_ENERGY = 20
export const PIPER_C4_CD = 30
export const PIPER_C2_MOVE_IDS = new Set(['1281006', '1281007', '1281008', '1281009', '1281014'])

export interface PiperMomentumCycle {
  cinemaLevel: number
  cap: number
  stacks: number
  durationSeconds: number
  note: string
}

function cfgSetting(cfg: AgentCharConfigInput['cfg'], id: string, fallback: number): number {
  const value = (cfg as unknown as Record<string, unknown>)[`setting:${id}`]
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/** 动力默认满层（用户口径：平A回能+强特耗能容易续，一开始转满后面点一下续，不用管命中次数） */
export function computePiperMomentum(input: { cinemaLevel: number }): PiperMomentumCycle {
  const cinema = Math.max(0, Math.floor(input.cinemaLevel))
  const cap = cinema >= 1 ? 30 : 20
  return {
    cinemaLevel: cinema,
    cap,
    stacks: cap,
    durationSeconds: cinema >= 6 ? 16 : 12,
    note: '动力默认一直满（平A回能+强特耗能易续），影画2增伤恒为满层。',
  }
}

function buildPiperCharConfig({ cinemaLevel, cfg }: AgentCharConfigInput): void {
  const record = cfg as unknown as Record<string, unknown>
  record.piperCinemaLevel = cinemaLevel
  if (cinemaLevel >= 4) {
    const maxTriggers = Math.max(1, Math.ceil((cfg.battleTime ?? 180) / PIPER_C4_CD))
    const triggers = Math.min(maxTriggers, Math.max(0, Math.floor(cfgSetting(cfg, 'piper.c4AnomalyTriggers', 1))))
    cfg.initialEnergyGift = (cfg.initialEnergyGift ?? 0) + triggers * PIPER_C4_ENERGY
    record.piperC4AnomalyTriggers = triggers
  }
}

function cycleFromInput({ cfg }: Pick<AgentResourceInput, 'cfg' | 'state'>): PiperMomentumCycle {
  const record = cfg as unknown as Record<string, unknown>
  return computePiperMomentum({ cinemaLevel: Number(record.piperCinemaLevel ?? 0) })
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
    summary: `动力 ${cycle.stacks} / ${cycle.cap}（恒满） · 物理积蓄 +${cycle.stacks * 4}%`,
    rows: [
      { label: '动力层数', value: `${cycle.stacks} 层`, detail: '默认一直满（平A回能+强特耗能易续，不用管命中次数）' },
      { label: '影画2下砸增伤', value: `+${PIPER_C2_BASE_DMG + cycle.stacks}%`, detail: `10% + 满层动力 ${cycle.stacks} 层，恒满` },
      { label: '动力持续', value: `${cycle.durationSeconds}秒`, detail: cycle.cinemaLevel >= 6 ? '影画6：基础12秒+4秒' : '基础持续12秒' },
    ],
    footer: cycle.note,
  }]
}

export const piperMechanic: AgentMechanicModule = {
  id: 'agent:piper',
  agentIds: [PIPER_ID],
  name: '派派·动力蓄能',
  description: '动力循环（默认满层）、物理异常积蓄、C2下砸增伤、C4异常回能。',
  settings: [
    { id: 'piper.c4AnomalyTriggers', label: '影画4异常触发', description: '全队触发属性异常并满足30秒冷却的次数', default: 1, min: 0, max: 6, step: 1, suffix: '次' },
  ],
  buildCharConfig: buildPiperCharConfig,
  buildResourceResult: buildPiperResourceResult,
  transformSkillExecutions: transformPiperSkills,
  patchExecutions: patchPiperExecutions,
  resourceSections: buildPiperResourceSections,
}

export default piperMechanic
